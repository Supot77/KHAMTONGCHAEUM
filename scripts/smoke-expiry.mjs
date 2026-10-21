// Explicit opt-in: creates named QA rooms and ages only the room created by this run.
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import pg from 'pg';
import {createSqlStore,postgresPlaceholders} from '../lib/sql-store.ts';
import {ROOM_IDLE_MS} from '../lib/room-lifecycle.ts';
if(!process.argv.includes('--allow-test-rooms'))throw new Error('Use --allow-test-rooms to create and age named expiry-test rooms.');
nextEnv.loadEnvConfig(process.cwd());
const base=process.env.GAME_TEST_URL||'http://127.0.0.1:5173';
const status=await (await fetch(base+'/api/status')).json();
if(process.argv.includes('--require-neon'))assert.equal(status.storage,'neon');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:10000});
const store=createSqlStore(async(q,p)=>(await pool.query(postgresPlaceholders(q),p)).rows);
async function call(session,action,extra={}){
 const response=await fetch(base+'/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...session,action,commandId:crypto.randomUUID(),...extra})});return {status:response.status,value:await response.json()};
}
async function create(label){const token=crypto.randomUUID()+crypto.randomUUID();const r=await call({token},'create',{mode:'shared',names:[`QA อายุห้อง ${label}`,'QA เพื่อน'],seconds:0});assert.equal(r.status,200);return {code:r.value.code,token};}
try{
 const expired=await create('หมดอายุ'),active=await create('ยังใช้');
 const count=async()=>{
  const {rows}=await pool.query("SELECT to_regclass('public.syllable_cache') IS NOT NULL AS legacy_exists, (SELECT count(*)::int FROM word_dictionary) AS analyses");
  const legacy=rows[0].legacy_exists?(await pool.query('SELECT count(*)::int AS n FROM syllable_cache')).rows[0].n:null;
  return {legacy,analyses:rows[0].analyses};
 };
 const before=await count();
 // Only this test's authenticated room codes and explicit QA names can be aged.
 for(const [session,age] of [[active,ROOM_IDLE_MS-10000],[expired,ROOM_IDLE_MS+1000]]){
  const r=await pool.query("UPDATE rooms SET last_active_at=$1 WHERE code=$2 AND data LIKE $3 RETURNING code",[Date.now()-age,session.code,'%QA อายุห้อง%']);assert.equal(r.rowCount,1);
 }
 assert.equal((await call(active,'heartbeat')).status,200);
 const gone=await call(expired,'read');assert.equal(gone.status,410);assert.equal(gone.value.code,'ROOM_UNAVAILABLE');
 assert.equal((await call(expired,'heartbeat')).status,410,'expired rooms must never revive');
 const deleted=await store.pruneExpired(Date.now());assert.ok(deleted>=1);
 assert.equal((await pool.query('SELECT code FROM rooms WHERE code=$1',[expired.code])).rowCount,0);
 assert.equal((await call(active,'read')).status,200);
 const after=await count();if(before.legacy!==null)assert.ok(after.legacy>=before.legacy);assert.ok(after.analyses>=before.analyses);
 console.log(JSON.stringify({backend:status.storage,expiryMs:ROOM_IDLE_MS,accessAfterExpiry:410,heartbeatCannotRevive:'PASS',activeRoomPreserved:'PASS',physicalDelete:'PASS',sharedWordCachePreserved:'PASS',deleted,result:'PASS'}));
}finally{await pool.end();}

import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createSqlStore} from '../lib/sql-store.ts';
import {createGame} from '../lib/game.ts';
import {RoomService} from '../lib/rooms.ts';
import {ROOM_IDLE_MS,RoomUnavailableError} from '../lib/room-lifecycle.ts';
import {handleRoomCleanup} from '../lib/cleanup-handler.ts';

function fixture(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../database/schema.sql',import.meta.url),'utf8'));let now=1000;const store=createSqlStore(async(q,p)=>db.prepare(q).all(...p),()=>now);return {db,store,now:()=>now,time:value=>now=value};}
const newGame=code=>createGame(code,'shared',['เอ','บี'],'hash',0,1000);
test('one-hour boundary: reads and background writes never renew activity; expired rooms cannot revive',async()=>{
 const f=fixture();await f.store.insert(newGame('OLDOLD'));await f.store.cache('m',{'ปลา':['ปลา']});
 await f.store.saveAnalyses('m',{'ปลา':{syllables:['ปลา'],category:'noun',nounType:'common',reason:'คำนาม',suggestions:[],titleContext:''}},'players');
 f.time(1000+ROOM_IDLE_MS-1);let row=await f.store.read('OLDOLD');assert.ok(row);row.game.notice='background timer or model result';assert.equal(await f.store.write('OLDOLD',row.revision,row.game),true);
 assert.equal(f.db.prepare('SELECT last_active_at FROM rooms').get().last_active_at,1000);
 f.time(1000+ROOM_IDLE_MS);assert.equal(await f.store.read('OLDOLD'),null);assert.equal(await f.store.touch('OLDOLD',f.now()),false);assert.equal(await f.store.write('OLDOLD',1,row.game),false);
 assert.equal(await f.store.pruneExpired(f.now()),1);assert.equal(await f.store.pruneExpired(f.now()),0);
 assert.deepEqual(await f.store.cached('m',['ปลา']),{'ปลา':['ปลา']});assert.equal((await f.store.analyses('m',['ปลา']))['ปลา'].category,'noun');f.db.close();
});
test('authenticated presence keeps a room alive; delete/touch races cannot delete an active room',async()=>{
 const f=fixture();await f.store.insert(newGame('ACTIVE'));await f.store.insert(newGame('OLDOLD'));
 f.time(1000+ROOM_IDLE_MS-1);assert.equal(await f.store.touch('ACTIVE',f.now()),true);
 f.time(1000+ROOM_IDLE_MS);assert.equal(await f.store.pruneExpired(f.now()),1);assert.ok(await f.store.read('ACTIVE'));assert.equal(await f.store.touch('OLDOLD',f.now()),false);
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM rooms').get().n,1);f.db.close();
});
test('legacy writers default to updated_at until first presence signal',async()=>{
 const f=fixture();const g=newGame('LEGACY');f.db.prepare('INSERT INTO rooms(code,data,revision,updated_at) VALUES (?,?,0,?)').run(g.code,JSON.stringify(g),1000);
 assert.ok(await f.store.read(g.code));f.time(1000+ROOM_IDLE_MS);assert.equal(await f.store.read(g.code),null);assert.equal(await f.store.pruneExpired(f.now()),1);f.db.close();
});
test('service heartbeat requires membership; missing/expired rooms consistently invalidate old sessions',async()=>{
 const f=fixture(),provider={configured:false,model:'test'},service=new RoomService(f.store,provider,f.now),token=crypto.randomUUID()+crypto.randomUUID();
 const room=await service.command({action:'create',mode:'shared',names:['เอ','บี'],token,commandId:crypto.randomUUID()});
 f.time(1000+ROOM_IDLE_MS-100);await assert.rejects(()=>service.command({action:'heartbeat',code:room.code,token:crypto.randomUUID()+crypto.randomUUID()}),/ไม่ได้อยู่/);
 assert.equal(f.db.prepare('SELECT last_active_at FROM rooms').get().last_active_at,1000);
 f.time(1000+ROOM_IDLE_MS);await assert.rejects(()=>service.command({action:'heartbeat',code:room.code,token}),RoomUnavailableError);await assert.rejects(()=>service.check(room.code,token),RoomUnavailableError);
 f.db.close();
});
test('valid heartbeat extends expiry without changing game revision or scores',async()=>{
 const f=fixture(),service=new RoomService(f.store,{configured:false,model:'test'},f.now),token=crypto.randomUUID()+crypto.randomUUID();
 const r=await service.command({action:'create',mode:'shared',names:['เอ','บี'],token,commandId:crypto.randomUUID()});f.time(1000+ROOM_IDLE_MS-1);
 const heartbeat=await service.command({action:'heartbeat',code:r.code,token});assert.equal(heartbeat.revision,r.revision);assert.deepEqual(heartbeat.players,r.players);
 f.time(1000+ROOM_IDLE_MS);assert.ok(await f.store.read(r.code));f.db.close();
});
const delivery=(changes={})=>({version:1,invocation_id:'test-invocation',trigger:{type:'schedule',id:'trigger-test',name:'expired-rooms'},data:{scheduled_at:'2026-10-20T12:00:00Z'},...changes});
function request(body,header='test-invocation'){return new Request('https://cleanup.test/',{method:'POST',headers:{'Content-Type':'application/json',...(header?{'x-neon-trigger-invocation-id':header}:{})},body:JSON.stringify(body)});}
test('scheduled endpoint rejects unauthenticated/mismatched deliveries before DB work',async()=>{
 let calls=0;const cleanup=async()=>{calls++;return 0;};assert.equal((await handleRoomCleanup(request(delivery(),null),cleanup)).status,401);assert.equal((await handleRoomCleanup(request(delivery(),'wrong-id'),cleanup)).status,401);assert.equal((await handleRoomCleanup(new Request('https://cleanup.test/'),cleanup)).status,405);assert.equal(calls,0);
});
test('verified schedule uses server expiry policy; repeated deliveries are harmless',async()=>{
 const f=fixture();await f.store.insert(newGame('OLDOLD'));f.time(1000+ROOM_IDLE_MS);
 const result=await handleRoomCleanup(request(delivery()),()=>f.store.pruneExpired(f.now()));assert.equal(result.status,200);assert.equal((await result.json()).deleted,1);
 assert.equal((await (await handleRoomCleanup(request(delivery()),()=>f.store.pruneExpired(f.now()))).json()).deleted,0);f.db.close();
});

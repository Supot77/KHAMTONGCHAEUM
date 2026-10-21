import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import {Pool} from 'pg';
if(!process.argv.includes('--allow-test-rooms'))throw new Error('Use --allow-test-rooms for isolated QA only.');
const host=process.argv.find(x=>x.startsWith('--qa-host='))?.slice(10);if(!host||!/^[a-z0-9.-]+\.neon\.tech$/.test(host))throw new Error('Supply the observed isolated --qa-host.');
nextEnv.loadEnvConfig(process.cwd());const url=new URL(process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL);if(url.hostname===host)throw new Error('Do not run against the configured application database.');url.hostname=host;
const pool=new Pool({connectionString:url.toString(),max:1});
const base=process.env.GAME_TEST_URL||'http://127.0.0.1:5174',tokens=Array.from({length:4},()=>crypto.randomUUID()+crypto.randomUUID());let code;
async function post(path,input,status=200){const res=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(20000)});const data=await res.json();assert.equal(res.status,status,JSON.stringify(data));return data;}
const cmd=(i,action,extra={},status=200)=>post('/api/room',{code,token:tokens[i],action,commandId:crypto.randomUUID(),...extra},status);
const dict=(i,action,extra={},status=200)=>post('/api/dictionary',{code,token:tokens[i],action,...extra},status);
try{
 const analysis={syllables:['มหา','สมุทร'],category:'noun',nounType:'common',reason:'QA dictionary fixture',suggestions:[],titleContext:''};
 await pool.query("INSERT INTO word_dictionary(word,analysis,source,model,policy,updated_at) VALUES($1,$2,'model','qa-fixture','qa-fixture',$3) ON CONFLICT(word) DO NOTHING",['มหาสมุทร',JSON.stringify(analysis),Date.now()]);
 let r=await cmd(0,'create',{mode:'online',name:'QA เจ้าของเดิม',seconds:0});code=r.code;await cmd(1,'join',{name:'QA ผู้เล่นแก้คำ'});await cmd(2,'join',{name:'QA คนสุดท้าย'});
 const listed=await dict(1,'list',{query:'มหาสมุทร'}),entry=listed.items.find(x=>x.word==='มหาสมุทร');assert.ok(entry);
 const saved=await dict(1,'save',{originalWord:entry.word,word:entry.word,analysis:{...entry.analysis,syllables:['ม','หา','ส','มุทร'],reason:'QA สมาชิกในห้องยืนยันการแบ่งละเอียด'},expectedUpdatedAt:entry.updatedAt});assert.deepEqual(saved.entry.analysis.syllables,['ม','หา','ส','มุทร']);assert.equal(saved.entry.source,'players');
 await dict(0,'save',{originalWord:entry.word,word:entry.word,analysis:entry.analysis,expectedUpdatedAt:entry.updatedAt},409);
 const row=(await pool.query('SELECT analysis,source FROM word_dictionary WHERE word=$1',[entry.word])).rows[0];assert.deepEqual(JSON.parse(row.analysis).syllables,['ม','หา','ส','มุทร']);assert.equal(row.source,'players');
 await cmd(0,'leave');r=await cmd(1,'read');assert.equal(r.isHost,true);assert.equal(r.players.length,2);await cmd(0,'read',{},410);await dict(0,'list',{},410);
 r=await cmd(1,'start',{manual:true,text:'ทะเล'});assert.equal(r.status,'playing');await cmd(1,'leave');r=await cmd(2,'read');assert.equal(r.isHost,true);assert.equal(r.competition.setComplete,true);await cmd(2,'leave');assert.equal((await pool.query('SELECT code FROM rooms WHERE code=$1',[code])).rows.length,0);
 r=await cmd(3,'create',{mode:'shared',names:['QA เครื่องเดียว เอ','QA เครื่องเดียว บี'],seconds:0});code=r.code;await cmd(3,'leave');assert.equal((await pool.query('SELECT code FROM rooms WHERE code=$1',[code])).rows.length,0);
 console.log(JSON.stringify({guestDictionaryEdit:'PASS',table:'word_dictionary',syllables:['ม','หา','ส','มุทร'],staleEditStatus:409,hostTransfer:'PASS',departedSessionRevoked:'PASS',leaveDuringSet:'PASS',emptyAndSharedRoomsDeleted:'PASS',modelCalls:0,result:'PASS'}));
}finally{await pool.end();}

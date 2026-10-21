import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createSqlStore} from '../lib/sql-store.ts';
import {RoomService} from '../lib/rooms.ts';
import {createGame,startRound,reserveSubmission,releaseSubmission,advanceTimeout,SUBMISSION_GRACE_MS,SUBMISSION_LEASE_MS,finishRound} from '../lib/game.ts';
const noun=syllables=>({syllables,category:'noun',nounType:'common',reason:'คำนาม',suggestions:[],titleContext:''});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function until(check){for(let i=0;i<100;i++){if(await check())return;await new Promise(r=>setTimeout(r,1));}throw new Error('reservation not reached');}
async function fixture(mode='online',seconds=15){
 let now=1000;const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../database/schema.sql',import.meta.url),'utf8'));
 const store=createSqlStore(async(q,p)=>db.prepare(q).all(...p),()=>now);store.randomNoun=async()=>({text:'ทะเล',analysis:noun(['ทะ','เล'])});await store.saveAnalyses('old',{'เหล็ก':noun(['เหล็ก']),'แมว':noun(['แมว'])});
 const service=new RoomService(store,{configured:false,model:'unused',analyze:async()=>{throw new Error('not a model task');}},()=>now);
 const tokens=Array.from({length:3},()=>crypto.randomUUID()+crypto.randomUUID());let code;
 const command=(i,action,extra={},id=crypto.randomUUID())=>service.command({code,token:tokens[i],action,commandId:id,...extra});
 let r=await command(0,'create',{mode,names:['เอ','บี','ซี'],name:'เอ',seconds});code=r.code;if(mode==='online')for(let i=1;i<3;i++)await command(i,'join',{name:['เอ','บี','ซี'][i]});r=await command(0,'start');
 return {db,store,service,command,code,initial:r,time:x=>now=x,row:()=>store.read(code)};
}
for(const mode of ['online','shared'])test(`${mode}: slow dictionary lookup freezes this turn; next clock gets its full budget only at successful commit`,async()=>{
 const f=await fixture(mode),gate=deferred(),base=f.store.analyses;f.store.analyses=async(...args)=>{await gate.promise;return base(...args);};f.time(15900);
 const pending=f.command(0,'submit',{text:'เหล็ก',turn:f.initial.turnNumber});await until(async()=>Boolean((await f.row()).game.submission));
 f.time(30000);const during=await f.command(mode==='shared'?0:1,'read');assert.equal(during.status,'playing');assert.equal(during.turnNumber,f.initial.turnNumber);assert.equal(during.deadline,null);assert.equal(during.submission.remainingMs,100);assert.equal(during.chain[0].text,'ทะเล');assert.equal('text' in during.submission,false);assert.equal('id' in during.submission,false);
 await assert.rejects(()=>f.command(0,'pass',{turn:during.turnNumber}),/กำลังส่ง/);await assert.rejects(()=>f.command(0,'challenge',{turn:during.turnNumber}),/กำลังส่ง/);
 gate.resolve();const after=await pending;assert.equal(after.status,'playing');assert.equal(after.submission,null);assert.equal(after.chain[0].text,'เหล็ก');assert.equal(after.turnNumber,f.initial.turnNumber+1);assert.equal(after.deadline,45000);assert.equal(after.chain[0].at,30000);f.db.close();
});

test('failed dictionary lookup resumes the original remaining time and permits another submission',async()=>{
 const f=await fixture(),gate=deferred(),base=f.store.analyses;f.store.analyses=async()=>gate.promise;f.time(15900);
 const pending=f.command(0,'submit',{text:'เหล็ก',turn:f.initial.turnNumber});const rejected=assert.rejects(pending,/database busy/);await until(async()=>Boolean((await f.row()).game.submission));f.time(30000);gate.reject(new Error('database busy'));await rejected;
 let r=await f.command(0,'read');assert.equal(r.status,'playing');assert.equal(r.deadline,30100);assert.equal(r.submission,null);assert.equal(r.turnNumber,f.initial.turnNumber);assert.equal(r.wordCount,0);
 f.store.analyses=base;f.time(30050);r=await f.command(0,'submit',{text:'เหล็ก',turn:r.turnNumber});assert.equal(r.chain[0].text,'เหล็ก');assert.equal(r.deadline,45050);f.db.close();
});

test('network grace accepts server receipt shortly after zero but rejects outside the bounded window',async()=>{
 const f=await fixture();f.time(16000+SUBMISSION_GRACE_MS-1);let r=await f.command(1,'read');assert.equal(r.status,'playing');r=await f.command(0,'submit',{text:'เหล็ก',turn:r.turnNumber});assert.equal(r.chain[0].text,'เหล็ก');assert.equal(r.result,null);f.db.close();
 const late=await fixture();late.time(16000+SUBMISSION_GRACE_MS);await assert.rejects(()=>late.command(0,'submit',{text:'เหล็ก',turn:late.initial.turnNumber,clickedAt:15000}),/หมดเวลา/);r=await late.command(1,'read');assert.equal(r.result.reason,'timeout');assert.equal(r.result.loserId,r.players[0].id);late.db.close();
});

test('lost response and overlapping retries with the same ID commit exactly one word and one turn',async()=>{
 const f=await fixture(),gate=deferred(),base=f.store.analyses,id=crypto.randomUUID();let reads=0;f.store.analyses=async(...args)=>{reads++;await gate.promise;return base(...args);};f.time(15000);
 const payload={text:'เหล็ก',turn:f.initial.turnNumber};const first=f.command(0,'submit',payload,id);await until(()=>reads===1);f.time(25000);const retry=f.command(0,'submit',payload,id);await until(()=>reads===2);assert.equal((await f.row()).game.submission.until,15000+SUBMISSION_LEASE_MS);
 gate.resolve();const [a,b]=await Promise.all([first,retry]);assert.equal(a.turnNumber,b.turnNumber);assert.equal(a.wordCount,1);assert.equal(b.chain[0].id,a.chain[0].id);f.time(26000);const again=await f.command(0,'submit',payload,id);assert.equal(again.wordCount,1);assert.equal(again.deadline,a.deadline);assert.equal(again.submission,null);f.db.close();
});

test('different command IDs, payload changes and another player cannot take over a pending reservation',async()=>{
 const f=await fixture(),gate=deferred(),base=f.store.analyses,id=crypto.randomUUID();f.store.analyses=async(...args)=>{await gate.promise;return base(...args);};f.time(15000);
 const first=f.command(0,'submit',{text:'เหล็ก',turn:f.initial.turnNumber},id);await until(async()=>Boolean((await f.row()).game.submission));
 await assert.rejects(()=>f.command(0,'submit',{text:'แมว',turn:f.initial.turnNumber},id),/กำลังส่ง/);await assert.rejects(()=>f.command(0,'submit',{text:'แมว',turn:f.initial.turnNumber}),/กำลังส่ง/);await assert.rejects(()=>f.command(1,'submit',{text:'แมว',turn:f.initial.turnNumber}),/กำลังส่ง/);
 gate.resolve();assert.equal((await first).wordCount,1);f.db.close();
});

test('abandoned reservations expire automatically and late requests cannot revive them',async()=>{
 const f=await fixture(),gate=deferred(),base=f.store.analyses;f.store.analyses=async(...args)=>{await gate.promise;return base(...args);};f.time(15000);
 const pending=f.command(0,'submit',{text:'เหล็ก',turn:f.initial.turnNumber});const rejected=assert.rejects(pending,/หมดอายุ|ตาเปลี่ยน/);await until(async()=>Boolean((await f.row()).game.submission));const expiry=(await f.row()).game.submission.until;
 f.time(expiry);let r=await f.command(1,'read');assert.equal(r.submission,null);assert.equal(r.deadline,expiry+1000);assert.equal(r.status,'playing');
 f.time(expiry+1000+SUBMISSION_GRACE_MS);r=await f.command(1,'read');assert.equal(r.result.reason,'timeout');const points=structuredClone(r.players.map(p=>p.score));gate.resolve();await rejected;r=await f.command(1,'read');assert.equal(r.wordCount,0);assert.deepEqual(r.players.map(p=>p.score),points);f.db.close();
});

test('host cancellation prevents an in-flight submission from changing a new lobby',async()=>{
 const f=await fixture(),gate=deferred(),base=f.store.analyses;f.store.analyses=async(...args)=>{await gate.promise;return base(...args);};const pending=f.command(0,'submit',{text:'เหล็ก',turn:f.initial.turnNumber});const rejected=assert.rejects(pending,/หมดอายุ|ตาเปลี่ยน/);await until(async()=>Boolean((await f.row()).game.submission));await f.command(0,'lobby');gate.resolve();await rejected;const r=await f.command(0,'read');assert.equal(r.status,'lobby');assert.equal(r.submission,null);assert.equal(r.wordCount,0);f.db.close();
});

test('untimed games remain untimed and invalid/stale/out-of-turn submissions never pause time',async()=>{
 const f=await fixture('online',0);await assert.rejects(()=>f.command(1,'submit',{text:'เหล็ก',turn:f.initial.turnNumber}),/ยังไม่ถึง/);await assert.rejects(()=>f.command(0,'submit',{text:'',turn:f.initial.turnNumber}),/พิมพ์|คำนาม/);await assert.rejects(()=>f.command(0,'submit',{text:'เหล็ก',turn:0}),/ตาเปลี่ยน/);assert.equal((await f.row()).game.submission,null);
 const r=await f.command(0,'submit',{text:'เหล็ก',turn:f.initial.turnNumber});assert.equal(r.deadline,null);assert.equal(r.submission,null);f.db.close();
});

test('expired release does not extend the lease and elimination clears an outstanding reservation',()=>{
 const g=createGame('ABCDEF','shared',['หนึ่ง','สอง','สาม'],'hash',15,1000);startRound(g,{text:'ทะเล',syllables:['ทะ','เล']},1000);reserveSubmission(g,g.hostId,'เหล็ก',g.turnNumber,'first',15000);const expiry=g.submission.until;releaseSubmission(g,'first',expiry+100);assert.equal(g.deadline,expiry+1000);assert.equal(advanceTimeout(g,expiry+1000+SUBMISSION_GRACE_MS),true);
 const h=createGame('ABCDEF','shared',['หนึ่ง','สอง','สาม'],'hash',15,1000);startRound(h,{text:'ทะเล',syllables:['ทะ','เล']},1000);reserveSubmission(h,h.hostId,'เหล็ก',h.turnNumber,'second',15000);finishRound(h,h.players[1].id,'human',15001);assert.equal(h.submission,null);
});

test('a stale request cannot commit or release a newer reservation reusing its command ID after expiry',async()=>{
 const f=await fixture(),old=deferred(),fresh=deferred(),base=f.store.analyses,id=crypto.randomUUID();let calls=0;f.store.analyses=async(...args)=>{await (++calls===1?old.promise:fresh.promise);return base(...args);};f.time(15000);
 const first=f.command(0,'submit',{text:'เหล็ก',turn:f.initial.turnNumber},id);const rejected=assert.rejects(first,/หมดอายุ|ตาเปลี่ยน/);await until(()=>calls===1);const expiry=(await f.row()).game.submission.until;f.time(expiry);await f.command(1,'read');
 f.time(expiry+10);const second=f.command(0,'submit',{text:'แมว',turn:f.initial.turnNumber},id);await until(()=>calls===2);const newUntil=(await f.row()).game.submission.until;f.time(expiry+20);old.resolve();await rejected;assert.equal((await f.row()).game.submission.until,newUntil);
 fresh.resolve();const r=await second;assert.equal(r.wordCount,1);assert.equal(r.chain[0].text,'แมว');assert.equal(r.submission,null);f.db.close();
});

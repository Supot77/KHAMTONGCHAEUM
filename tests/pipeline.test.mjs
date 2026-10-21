import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createSqlStore} from '../lib/sql-store.ts';
import {RoomService} from '../lib/rooms.ts';
import {applyAnalyses,createGame,startRound,submitWord,finishRound} from '../lib/game.ts';
import {AiError,createProvider} from '../lib/gemini.ts';
import {EventEmitter} from 'node:events';
import {observePoolErrors} from '../lib/pool-errors.ts';

const schema=readFileSync(new URL('../database/schema.sql',import.meta.url),'utf8');
const noun=(syllables,extra={})=>({syllables,category:'noun',nounType:'common',reason:'คำนามทดสอบ',suggestions:[],titleContext:'',...extra});
const command=(action,auth,extra={})=>({action,...auth,...extra,commandId:crypto.randomUUID()});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,1));}throw new Error('Expected operation did not start');}
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(schema);let now=1000;
 const store=createSqlStore(async(q,p)=>db.prepare(q).all(...p),()=>now);
 store.randomNoun=async()=>({text:'ปลา',analysis:noun(['ปลา'])});
 const provider={configured:true,model:'first-model',seed:async()=>({text:'ปลา',syllables:['ปลา']}),analyze:async words=>Object.fromEntries(words.map(w=>[w,noun([w])])),reviewAnalysis:async({proposal})=>({verdict:'agree',analysis:proposal,reason:'ตรวจแล้ว เห็นด้วยกับข้อเสนอ'}),judgeConnection:async()=>({connected:true,reason:'ทดสอบ'})};
 const service=new RoomService(store,provider,()=>now);
 return {db,store,provider,service,time:x=>now=x,next:()=>now+=5000,
  async room(names=['QA หนึ่ง','QA สอง'],mode='shared'){
   const token=crypto.randomUUID()+crypto.randomUUID();const r=await service.command(command('create',{token},{mode,names,name:names[0],seconds:0}));const auth={code:r.code,token};
   return {auth,read:()=>service.command({action:'read',...auth}),send:(action,extra={})=>service.command(command(action,auth,extra)),async start(){await this.send('start');await service.check(auth.code,auth.token);return this.read();},async submit(text){const r=await this.read();return this.send('submit',{text,turn:r.turnNumber});}};
  }};
}

test('cached nouns are checked on submit even during model cooldown and without a key',async()=>{
 const f=fixture(),r=await f.room();await r.start();await f.store.saveAnalyses('old-model',{'ปลาดาว':noun(['ปลา','ดาว'])});
 await f.service.mutate(r.auth.code,g=>{g.nextCheckAt=999999;g.lease={id:'another-job',roundId:g.roundId,until:999999};});
 f.provider.configured=false;f.provider.analyze=async()=>{throw new Error('Must not call model');};
 const state=await r.submit('ปลาดาว');assert.equal(state.result.reason,'duplicate');assert.deepEqual(state.events[0].syllables,['ปลา']);assert.equal(state.reviewWords.find(w=>w.text==='ปลาดาว').analysisSource,'database');f.db.close();
});

test('cached non-nouns include their type, reason and suggestions in the immediate rejection',async()=>{
 const f=fixture(),r=await f.room();await r.start();await f.store.saveAnalyses('old',{'วิ่ง':noun(['วิ่ง'],{category:'verb',nounType:'none',reason:'เป็นคำกริยา',suggestions:['การวิ่ง']})});
 const state=await r.submit('วิ่ง');assert.equal(state.result.reason,'not_noun');assert.equal(state.reviewWords.find(w=>w.text==='วิ่ง').analysis.category,'verb');assert.deepEqual(state.events[0].suggestions,['การวิ่ง']);f.db.close();
});

test('cached successor is checked again when its earlier unknown neighbor finishes',async()=>{
 const f=fixture(),r=await f.room();await r.start();await f.store.saveAnalyses('old',{'แมวป่า':noun(['แมว','ป่า'])});
 await r.submit('แมว');let state=await r.submit('แมวป่า');assert.equal(state.chain[0].verification.status,'waiting_previous');
 const wait=deferred();f.provider.analyze=async words=>{assert.deepEqual(words,['แมว']);return wait.promise;};
 const job=f.service.check(r.auth.code,r.auth.token);await until(()=>f.db.prepare('SELECT count(*) AS n FROM word_analysis_jobs').get().n===1);
 wait.resolve({'แมว':noun(['แมว'])});await job;state=await r.read();assert.equal(state.result.reason,'duplicate');assert.equal(state.events[0].word,'แมวป่า');f.db.close();
});

test('cache hits are applied while an unrelated model request is still in flight',async()=>{
 const f=fixture(),r=await f.room(['QA A','QA B','QA C']);await r.start();await r.submit('ต้นไม้');
 let called=false;const wait=deferred();f.provider.analyze=async()=>{called=true;return wait.promise;};const task=f.service.check(r.auth.code,r.auth.token);await until(()=>called);
 await f.store.saveAnalyses('old',{'แมว':noun(['แมว']),'แมวป่า':noun(['แมว','ป่า'])});await r.submit('แมว');const state=await r.submit('แมวป่า');assert.equal(state.result.reason,'duplicate');
 wait.resolve({'ต้นไม้':noun(['ต้น','ไม้'])});await task;assert.equal((await r.read()).result.reason,'duplicate');f.db.close();
});

test('automatic cached/new-word duplicate checks finish all five sets with correct totals',async()=>{
 const f=fixture(),r=await f.room();await f.store.saveAnalyses('previous-model',{'แมว':noun(['แมว'])});let calls=0,seeds=0;
 f.store.randomNoun=async()=>{seeds++;return {text:'ปลา',analysis:noun(['ปลา'])};};
 f.provider.analyze=async words=>{calls++;assert.equal(words.length,1);return {[words[0]]:noun(['แมว',words[0].slice(3)])};};
 const cases=['แมวป่า','แมวบ้าน','แมวดำ','แมวส้ม','แมวขาว'];
 for(let i=0;i<5;i++){
  f.next();let state=await r.start();assert.equal(state.competition.set,i+1);
  state=await r.submit('แมว');assert.equal(state.chain[0].verification.status,'valid');
  await r.submit(cases[i]);await f.service.check(r.auth.code,r.auth.token);state=await r.read();
  assert.equal(state.result.reason,'duplicate');assert.equal(state.events[0].word,cases[i]);assert.equal(state.competition.setComplete,true);
  if(i<4)await r.send('lobby');
 }
 assert.equal(calls,5);assert.equal(seeds,5);assert.deepEqual((await r.read()).players.map(p=>p.score),[15,5]);f.db.close();
});

test('reverse analysis arrival and ended findings never lose a duplicate or change frozen scores',()=>{
 const g=createGame('ABCDEF','shared',['A','B','C'],'hash',0,0);startRound(g,{text:'ปลา',syllables:['ปลา']},0);
 const a=submitWord(g,g.hostId,'แมว',1,g.turnNumber),b=submitWord(g,g.hostId,'แมวป่า',2,g.turnNumber);
 applyAnalyses(g,g.roundId,[{id:b.id,analysis:noun(['แมว','ป่า'])}],3);assert.equal(b.verification.status,'waiting_previous');
 finishRound(g,g.players[2].id,'surrender',4);const frozen=structuredClone(g.competition.totals),result=structuredClone(g.result);
 applyAnalyses(g,g.roundId,[{id:a.id,analysis:noun(['แมว'])}],5);
 assert.equal(b.verification.status,'duplicate');assert.deepEqual(b.verification.repeated,['แมว']);assert.equal(b.verification.applied,false);assert.deepEqual(g.result,result);assert.deepEqual(g.competition.totals,frozen);
});

test('new live words are analyzed ahead of archived pending words',async()=>{
 const f=fixture(),r=await f.room(['A','B','C']);await r.start();await r.submit('คำเก่า');await r.send('pass',{turn:(await r.read()).turnNumber});f.next();await r.read();
 await r.submit('แมว');let requested;f.provider.analyze=async words=>{requested=words;return {'แมว':noun(['แมว'])};};await f.service.check(r.auth.code,r.auth.token);
 assert.deepEqual(requested,['แมว']);assert.equal((await r.read()).chain[0].verification.status,'valid');f.db.close();
});

test('two rooms requesting the same new word share one model call and reuse the result',async()=>{
 const f=fixture(),a=await f.room(),b=await f.room();await a.start();await b.start();await a.submit('แมว');await b.submit('แมว');let calls=0;const wait=deferred();
 f.provider.analyze=async()=>{calls++;return wait.promise;};const first=f.service.check(a.auth.code,a.auth.token);await until(()=>calls===1);
 await f.service.check(b.auth.code,b.auth.token);assert.equal(calls,1);
 wait.resolve({'แมว':noun(['แมว'])});await first;
 await f.service.check(b.auth.code,b.auth.token);assert.equal((await b.read()).chain[0].verification.status,'valid');assert.equal(calls,1);f.db.close();
});

test('model failure does not prevent cache hits; uncertain results are not accepted or retried forever',async()=>{
 const f=fixture(),r=await f.room(['A','B','C']);await r.start();await r.submit('คำใหม่');f.provider.analyze=async()=>{throw new AiError('quota',60000);};await f.service.check(r.auth.code,r.auth.token);
 await f.store.saveAnalyses('old',{'แมว':noun(['แมว']),'ชื่อ':noun(['ชื่อ'],{category:'uncertain',nounType:'none'})});
 let state=await r.submit('แมว');assert.equal(state.chain[0].verification.status,'waiting_previous');state=await r.submit('ชื่อ');assert.equal(state.chain[0].verification.status,'review');assert.equal(state.chain[0].languageStatus,'uncertain');f.db.close();
});

test('dictionary is model-independent, preserves exact written words and retains protected history',async()=>{
 const f=fixture();await f.store.saveAnalyses('old',{'จันทร์':noun(['จันทร์']),'จันทน์':noun(['จันทน์'])});
 assert.deepEqual(Object.keys(await f.store.analyses('new',['จันทร์','จันทน์','จัน'])),['จันทน์','จันทร์']);
 await f.store.saveAnalyses('new',{'จันทร์':noun(['จันทร์'],{reason:'ผู้เล่นยืนยัน'})},'players');
 await f.store.saveAnalyses('other',{'จันทร์':noun(['จันทร์'],{reason:'ไม่ควรทับ'})});
 assert.equal((await f.store.analyses('new',['จันทร์']))['จันทร์'].reason,'ผู้เล่นยืนยัน');assert.equal(f.db.prepare('SELECT count(*) AS n FROM word_analysis_history WHERE word=?').get('จันทร์').n,2);f.db.close();
});

test('legacy backfill chooses player corrections and rerunning migration cannot overwrite current data',async()=>{
 const f=fixture();const ins=f.db.prepare('INSERT INTO word_analysis_cache VALUES(?,?,?,?,?,?)');
 ins.run('p','old','แมว',JSON.stringify(noun(['แมว'],{reason:'ผู้เล่นเก่า'})),'players',1);
 ins.run('p','new','แมว',JSON.stringify(noun(['แมว'],{reason:'โมเดลใหม่'})),'model',2);f.db.exec(schema);
 assert.equal((await f.store.analyses('anything',['แมว']))['แมว'].reason,'ผู้เล่นเก่า');
 await f.store.saveAnalyses('latest',{'แมว':noun(['แมว'],{reason:'ผู้เล่นแก้ล่าสุด'})},'players');f.db.exec(schema);
 assert.equal((await f.store.analyses('anything',['แมว']))['แมว'].reason,'ผู้เล่นแก้ล่าสุด');assert.equal(f.db.prepare('SELECT count(*) AS n FROM word_analysis_cache').get().n,2);f.db.close();
});

test('global word leases expire and stale workers cannot release a newer claim',async()=>{
 const f=fixture();assert.deepEqual(await f.store.claimAnalyses(['แมว'],'a',2000,1000),['แมว']);assert.deepEqual(await f.store.claimAnalyses(['แมว'],'b',3000,1999),[]);
 assert.deepEqual(await f.store.claimAnalyses(['แมว'],'b',4000,2000),['แมว']);await f.store.releaseAnalyses(['แมว'],'a');assert.equal(f.db.prepare('SELECT lease_id FROM word_analysis_jobs').get().lease_id,'b');f.db.close();
});

test('review explicitly waits for model answer and cannot write the dictionary before host approval',async()=>{
 const f=fixture(),r=await f.room();await r.start();const state=await r.submit('แมว');const wordId=state.chain[0].id;await r.send('end');
 let reply=await r.send('review',{wordId,analysis:noun(['แมว'])});const proposalId=reply.reviews[wordId].id;
 await assert.rejects(()=>r.send('confirmReview',{wordId,proposalId}),/รอคำตอบ/);
 const wait=deferred();let calls=0;f.provider.reviewAnalysis=async input=>{calls++;assert.equal(input.word,'แมว');return wait.promise;};
 const task=f.service.review(r.auth.code,r.auth.token,wordId,proposalId);await until(()=>calls===1);
 assert.equal((await r.read()).reviews[wordId].status,'checking');await f.service.review(r.auth.code,r.auth.token,wordId,proposalId);assert.equal(calls,1);assert.deepEqual(await f.store.analyses('any',['แมว']),{});
 wait.resolve({verdict:'agree',analysis:noun(['แมว']),reason:'โมเดลตรวจข้อเสนอแล้ว'});await task;reply=await r.read();assert.equal(reply.reviews[wordId].status,'answered');assert.deepEqual(await f.store.analyses('any',['แมว']),{});
 await r.send('confirmReview',{wordId,proposalId});assert.equal((await f.store.analyses('any',['แมว']))['แมว'].category,'noun');const count=f.db.prepare('SELECT count(*) AS n FROM word_analysis_history').get().n;
 await r.send('confirmReview',{wordId,proposalId});assert.equal(f.db.prepare('SELECT count(*) AS n FROM word_analysis_history').get().n,count);f.db.close();
});

test('failed review retains proposal, retries explicitly, and stale answers cannot replace newer requests',async()=>{
 const f=fixture(),r=await f.room();await r.start();const wordId=(await r.submit('แมว')).chain[0].id;await r.send('end');const analysis=noun(['แมว']);
 let reply=await r.send('review',{wordId,analysis});let id=reply.reviews[wordId].id;f.provider.reviewAnalysis=async()=>{throw new Error('ลองใหม่ได้');};
 reply=await f.service.review(r.auth.code,r.auth.token,wordId,id);assert.equal(reply.reviews[wordId].status,'error');assert.equal(reply.reviews[wordId].analysis.category,'noun');
 let called=false;const wait=deferred();f.provider.reviewAnalysis=async()=>{called=true;return wait.promise;};const old=f.service.review(r.auth.code,r.auth.token,wordId,id);await until(()=>called);
 reply=await r.send('review',{wordId,analysis:{...analysis,reason:'ข้อเสนอใหม่'}});const newer=reply.reviews[wordId].id;
 wait.resolve({verdict:'agree',analysis,reason:'คำตอบเก่า'});await old;reply=await r.read();assert.equal(reply.reviews[wordId].id,newer);assert.equal(reply.reviews[wordId].response,undefined);
 await assert.rejects(()=>r.send('confirmReview',{wordId,proposalId:id}),/เปลี่ยนแล้ว/);f.db.close();
});

test('provider sends the player request as data and validates a structured review response',async()=>{
 const proposal=noun(['ปลา','ดาว'],{reason:'ขอให้ตรวจตามการอ่าน'});let payload;
 const p=createProvider('test-key','test-model',async(_url,init)=>{payload=JSON.parse(init.body);return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({verdict:'agree',analysis:proposal,reason:'เห็นด้วย'})}]}}]});});
 const reply=await p.reviewAnalysis({word:'ปลาดาว',original:null,proposal});assert.equal(reply.verdict,'agree');assert.equal(JSON.parse(payload.contents[0].parts[0].text).proposal.reason,proposal.reason);assert.match(payload.systemInstruction.parts[0].text,/DATA/);
});

test('review requires room membership and only host can confirm a guest proposal',async()=>{
 const f=fixture(),r=await f.room(['QA เจ้าของ'],'online');const guest={code:r.auth.code,token:crypto.randomUUID()+crypto.randomUUID()};
 await f.service.command(command('join',guest,{name:'QA เพื่อน'}));await r.start();const wordId=(await r.submit('แมว')).chain[0].id;await r.send('end');
 const state=await f.service.command(command('review',guest,{wordId,analysis:noun(['แมว'])}));const proposalId=state.reviews[wordId].id;
 await assert.rejects(()=>f.service.review(r.auth.code,crypto.randomUUID()+crypto.randomUUID(),wordId,proposalId),/ไม่ได้อยู่/);
 await f.service.review(guest.code,guest.token,wordId,proposalId);
 await assert.rejects(()=>f.service.command(command('confirmReview',guest,{wordId,proposalId})),/เจ้าของห้อง/);
 await r.send('confirmReview',{wordId,proposalId});const history=f.db.prepare("SELECT metadata FROM word_analysis_history WHERE word='แมว'").get();assert.equal(JSON.parse(history.metadata).proposalId,proposalId);f.db.close();
});

test('model revision is shown separately and host explicitly chooses what becomes authoritative',async()=>{
 const f=fixture(),r=await f.room();await r.start();const wordId=(await r.submit('ปลาดาว')).chain[0].id;await r.send('end');
 const state=await r.send('review',{wordId,analysis:noun(['ปลาดาว'])});const proposalId=state.reviews[wordId].id;
 f.provider.reviewAnalysis=async()=>({verdict:'revise',analysis:noun(['ปลา','ดาว']),reason:'ต้องแบ่งเป็นสองพยางค์'});
 const result=await f.service.review(r.auth.code,r.auth.token,wordId,proposalId);assert.deepEqual(result.reviews[wordId].analysis.syllables,['ปลาดาว']);assert.deepEqual(result.reviews[wordId].response.analysis.syllables,['ปลา','ดาว']);
 await r.send('confirmReview',{wordId,proposalId,useModel:true});assert.deepEqual((await f.store.analyses('new',['ปลาดาว']))['ปลาดาว'].syllables,['ปลา','ดาว']);f.db.close();
});

test('a late model draft cannot overwrite a human correction in the dictionary or live word',async()=>{
 const f=fixture(),r=await f.room();await r.start();await r.submit('แมว');let called=false;const wait=deferred();f.provider.analyze=async()=>{called=true;return wait.promise;};
 const job=f.service.check(r.auth.code,r.auth.token);await until(()=>called);await f.store.saveAnalyses('human-reviewed',{'แมว':noun(['แมว'],{reason:'มนุษย์ยืนยันแล้ว'})},'players');
 wait.resolve({'แมว':noun(['แมว'],{reason:'โมเดลตอบทีหลัง'})});await job;assert.equal((await r.read()).chain[0].analysis.reason,'มนุษย์ยืนยันแล้ว');f.db.close();
});

test('dictionary and history roll back together if recording provenance fails',async()=>{
 const f=fixture();const raw=async(q,p)=>f.db.prepare(q).all(...p);
 const store=createSqlStore(raw,()=>1000,async work=>{f.db.exec('BEGIN');try{const value=await work(async(q,p)=>{if(q.startsWith('INSERT INTO word_analysis_history'))throw new Error('history unavailable');return raw(q,p);});f.db.exec('COMMIT');return value;}catch(error){f.db.exec('ROLLBACK');throw error;}});
 await assert.rejects(()=>store.saveAnalyses('m',{'แมว':noun(['แมว'])}),/history unavailable/);assert.deepEqual(await store.analyses('m',['แมว']),{});f.db.close();
});

test('pre-deployment room facts without a game verdict are reconciled without a model call',async()=>{
 const f=fixture(),r=await f.room();await r.start();await r.submit('ปลาดาว');
 await f.service.mutate(r.auth.code,g=>{const w=g.chain.at(-1);w.analysis=noun(['ปลา','ดาว']);w.syllables=['ปลา','ดาว'];delete w.verification;});
 assert.equal((await r.read()).needsCheck,true);f.provider.configured=false;await f.service.check(r.auth.code,r.auth.token);
 assert.equal((await r.read()).result.reason,'duplicate');f.db.close();
});

test('legacy words written during rolling deployment are reused without another migration or model call',async()=>{
 const f=fixture();f.db.prepare('INSERT INTO word_analysis_cache VALUES(?,?,?,?,?,?)').run('old-policy','old-model','แมว',JSON.stringify(noun(['แมว'])),'model',1000);
 assert.deepEqual((await f.store.analyses('new-model',['แมว']))['แมว'].syllables,['แมว']);f.db.close();
});

test('idle pool resets cannot crash the server or log connection credentials',()=>{
 const pool=new EventEmitter(),logs=[];observePoolErrors(pool,message=>logs.push(message));
 assert.doesNotThrow(()=>pool.emit('error',Object.assign(new Error('ECONNRESET'),{client:{password:'private-fixture'}})));
 assert.equal(logs.length,1);assert.equal(logs[0].includes('private-fixture'),false);
});

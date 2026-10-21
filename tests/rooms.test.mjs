import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomService } from '../lib/rooms.ts';
import { createProvider,parseSegments,AiError } from '../lib/gemini.ts';

class MemoryStore{
  rows=new Map();words={};facts={};writes=0;claims=new Map();
  async read(code){const row=this.rows.get(code);return row?structuredClone(row):null;}
  async insert(game){if(this.rows.has(game.code))return false;this.rows.set(game.code,{game:structuredClone(game),revision:0});return true;}
  async write(code,revision,game){if(this.rows.get(code)?.revision!==revision)return false;this.rows.set(code,{game:structuredClone(game),revision:revision+1});return true;}
  async touch(code){return this.rows.has(code);}
  async pruneExpired(){return 0;}
  async analyses(model,words){return Object.fromEntries(words.filter(w=>this.facts[w]).map(w=>[w,this.facts[w].analysis]));}
  async saveAnalyses(model,entries,source='model'){for(const [word,analysis] of Object.entries(entries)){if(this.facts[word]?.source==='players'&&source==='model')continue;this.facts[word]={analysis:structuredClone(analysis),source};this.writes++;}}
  async claimAnalyses(words,id,until,now){return words.filter(w=>{const old=this.claims.get(w);if(old&&old.until>now)return false;this.claims.set(w,{id,until});return true;});}
  async releaseAnalyses(words,id){for(const w of words)if(this.claims.get(w)?.id===id)this.claims.delete(w);}
  async cached(model,words){return Object.fromEntries(words.filter(w=>this.words[w]).map(w=>[w,this.words[w]]));}
  async cache(model,entries){Object.assign(this.words,entries);}
}
const token=()=>crypto.randomUUID()+crypto.randomUUID();
const cmd=(action,rest={})=>({action,commandId:crypto.randomUUID(),...rest});
const basicProvider=()=>({configured:true,model:'test',reviewAnalysis:async({proposal})=>({verdict:'agree',analysis:proposal,reason:'โมเดลตรวจแล้ว'}),seed:async()=>({text:'ทะเล',syllables:['ทะ','เล']}),analyze:async function(words){return Object.fromEntries(Object.entries(await this.segment(words)).map(([word,syllables])=>[word,{syllables,category:'noun',nounType:'common',reason:'คำนาม',suggestions:[],titleContext:''}]));},segment:async words=>Object.fromEntries(words.map(w=>[w,({'ปลา':['ปลา'],'ปลาดาว':['ปลา','ดาว'],'เมฆ':['เมฆ'],'ท้องฟ้า':['ท้อง','ฟ้า']})[w]??[w]]))});
async function shared(provider=basicProvider()){
  let now=1000;const store=new MemoryStore(),service=new RoomService(store,provider,()=>now),key=token();
  const room=await service.command(cmd('create',{mode:'shared',names:['เอ','บี','ซี'],token:key,seconds:30}));
  const auth={code:room.code,token:key};await service.command(cmd('start',auth));await service.check(room.code,key);
  return {service,store,auth,clock:value=>now=value,read:()=>service.command({action:'read',...auth})};
}
test('online authorization, join retries and concurrent turn submissions',async()=>{
  const store=new MemoryStore(),service=new RoomService(store,basicProvider(),()=>1000),a=token(),b=token();
  const created=await service.command(cmd('create',{mode:'online',name:'เอ',token:a}));const host={code:created.code,token:a},guest={code:created.code,token:b};
  const join=cmd('join',{...guest,name:'บี'});await service.command(join);await service.command(join);
  await assert.rejects(()=>service.command(cmd('start',guest)),/เจ้าของห้อง/);
  await service.command(cmd('start',host));await service.check(created.code,a);
  const state=await service.command({action:'read',...host});assert.equal(state.players.length,2);
  await assert.rejects(()=>service.command(cmd('submit',{...guest,text:'ปลา',turn:state.turnNumber})),/ยังไม่ถึงตา/);
  const attempts=await Promise.allSettled([service.command(cmd('submit',{...host,text:'ปลา',turn:state.turnNumber})),service.command(cmd('submit',{...host,text:'เมฆ',turn:state.turnNumber}))]);
  assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1);
  assert.equal((await service.command({action:'read',...host})).wordCount,1);
  assert.equal(JSON.stringify(state).includes('tokenHash'),false);assert.equal('lease' in state,false);assert.equal('processed' in state,false);
});
test('stable command ID cannot award two points or consume two turns',async()=>{
  const f=await shared();const r=await f.read();const action=cmd('submit',{...f.auth,text:'ปลา',turn:r.turnNumber});
  await f.service.command(action);await f.service.command(action);assert.equal((await f.read()).wordCount,1);
});
test('LLM can finish after later submissions; rollback is durable and human review works',async()=>{
  let complete;const provider=basicProvider();provider.segment=async words=>new Promise(resolve=>{complete=()=>resolve(Object.fromEntries(words.map(w=>[w,{'ปลา':['ปลา'],'ปลาดาว':['ปลา','ดาว']}[w]??[w]])));});
  const f=await shared(provider);let r=await f.read();
  r=await f.service.command(cmd('submit',{...f.auth,text:'ปลา',turn:r.turnNumber}));r=await f.service.command(cmd('submit',{...f.auth,text:'ปลาดาว',turn:r.turnNumber}));
  const task=f.service.check(r.code,f.auth.token);while(!complete)await new Promise(resolve=>setTimeout(resolve,0));
  r=await f.service.command(cmd('submit',{...f.auth,text:'ท้องฟ้า',turn:r.turnNumber}));r=await f.service.command(cmd('submit',{...f.auth,text:'เมฆ',turn:r.turnNumber}));
  complete();await task;r=await f.read();
  assert.deepEqual(r.chain.map(w=>w.text),['ปลา']);assert.equal(r.status,'ended');assert.deepEqual(r.events[0].reusable.map(w=>w.text),['ท้องฟ้า','เมฆ']);
  assert.equal(r.events[0].playerName,'บี');assert.equal(r.events[0].previous,'ปลา');
  await assert.rejects(()=>f.service.command(cmd('appeal',{...f.auth,eventId:r.events[0].id})),/จบแล้ว/);
});
test('failed provider preserves unresolved status, retries with backoff',async()=>{
  const provider=basicProvider();provider.segment=async()=>{throw new AiError('quota',60000);};const f=await shared(provider);let r=await f.read();
  await f.service.command(cmd('submit',{...f.auth,text:'ปลา',turn:r.turnNumber}));await f.service.check(r.code,f.auth.token);r=await f.read();
  assert.equal(r.chain.at(-1).check,'error');assert.equal(r.status,'playing');assert.equal(r.aiError,'quota');assert.equal(r.nextCheckAt,61000);
  assert.equal((await f.service.check(r.code,f.auth.token)).checked,false);
});
test('stale seed never starts a canceled round',async()=>{
  let complete;const provider=basicProvider();provider.seed=()=>new Promise(resolve=>{complete=resolve;});
  const service=new RoomService(new MemoryStore(),provider,()=>1000),key=token();const room=await service.command(cmd('create',{mode:'shared',names:['เอ','บี'],token:key}));const auth={code:room.code,token:key};
  await service.command(cmd('start',auth));const task=service.check(room.code,key);while(!complete)await new Promise(resolve=>setTimeout(resolve,0));
  await service.command(cmd('lobby',auth));complete({text:'ทะเล',syllables:['ทะ','เล']});await task;
  assert.equal((await service.command({action:'read',...auth})).status,'lobby');
});
test('strict provider contract rejects phonetic rewrites; no-key never calls fetch',async()=>{
  assert.throws(()=>parseSegments(['จันทร์'],{items:[{word:'จันทร์',syllables:['จัน']}]}),/รูปเขียน/);
  assert.deepEqual(parseSegments(['จันทร์'],{items:[{word:'จันทร์',syllables:['จันทร์']}]}),{'จันทร์':['จันทร์']});
  let calls=0;const p=createProvider('',undefined,async()=>{calls++;return Response.json({});});await assert.rejects(()=>p.seed(),/API Key/);assert.equal(calls,0);
});

test('database is authoritative: existing words cause zero model classification calls',async()=>{
 let calls=0;const provider=basicProvider();const original=provider.analyze;provider.analyze=async function(words){calls++;return original.call(this,words);};
 const f=await shared(provider);let r=await f.read();r=await f.service.command(cmd('submit',{...f.auth,text:'ปลา',turn:r.turnNumber}));await f.service.check(r.code,f.auth.token);
 assert.equal(calls,1);await f.service.command(cmd('end',f.auth));await f.service.command(cmd('lobby',f.auth));await f.service.command(cmd('start',f.auth));await f.service.check(r.code,f.auth.token);
 r=await f.read();await f.service.command(cmd('submit',{...f.auth,text:'ปลา',turn:r.turnNumber}));await f.service.check(r.code,f.auth.token);assert.equal(calls,1);
});
test('post-round proposals are not global writes until host confirms; confirmed data is reused next round',async()=>{
 const f=await shared();let r=await f.read();r=await f.service.command(cmd('submit',{...f.auth,text:'ปลา',turn:r.turnNumber}));const wordId=r.chain[0].id;await f.service.command(cmd('end',f.auth));
 const analysis={syllables:['ปลา'],category:'noun',nounType:'common',reason:'ผู้เล่นยืนยัน',suggestions:[],titleContext:''};const writes=f.store.writes;
 r=await f.service.command(cmd('review',{...f.auth,wordId,analysis}));assert.equal(f.store.writes,writes);
 const proposal=r.reviews[wordId];await f.service.review(f.auth.code,f.auth.token,wordId,proposal.id);r=await f.service.command(cmd('confirmReview',{...f.auth,wordId,proposalId:proposal.id}));assert.equal(f.store.facts['ปลา'].source,'players');assert.equal(r.reviews[wordId].approvedId,proposal.id);
 await f.store.saveAnalyses('test',{'ปลา':{...analysis,reason:'ผลโมเดลที่มาช้า'}});assert.equal(f.store.facts['ปลา'].analysis.reason,'ผู้เล่นยืนยัน');
 await f.service.command(cmd('lobby',f.auth));await f.service.command(cmd('start',f.auth));await f.service.check(r.code,f.auth.token);r=await f.read();assert.equal(r.roundNumber,1);
 await f.service.command(cmd('submit',{...f.auth,text:'ปลา',turn:r.turnNumber}));await f.service.check(r.code,f.auth.token);r=await f.read();assert.equal(r.chain[0].analysis.reason,'ผู้เล่นยืนยัน');
});
test('online guest can propose but only host can update the shared dictionary',async()=>{
 const store=new MemoryStore(),service=new RoomService(store,basicProvider(),()=>1000),a=token(),b=token();
 const created=await service.command(cmd('create',{mode:'online',name:'เอ',token:a}));const host={code:created.code,token:a},guest={code:created.code,token:b};
 await service.command(cmd('join',{...guest,name:'บี'}));await service.command(cmd('start',{...host,manual:true,text:'ทะเล'}));let r=await service.command(cmd('submit',{...host,text:'ปลา',turn:(await service.command({action:'read',...host})).turnNumber}));const wordId=r.chain[0].id;
 await service.command(cmd('end',host));const analysis={syllables:['ปลา'],category:'noun',nounType:'common',reason:'ถูกต้อง',suggestions:[],titleContext:''};r=await service.command(cmd('review',{...guest,wordId,analysis}));const proposalId=r.reviews[wordId].id;
 await assert.rejects(()=>service.command(cmd('confirmReview',{...guest,wordId,proposalId})),/เจ้าของห้อง/);assert.equal(store.facts['ปลา'],undefined);
 await service.review(host.code,host.token,wordId,proposalId);await service.command(cmd('confirmReview',{...host,wordId,proposalId}));assert.equal(store.facts['ปลา'].source,'players');
});

test('tie invokes model only after votes, even with manual word checks; online actor spoofing fails',async()=>{
 let judgeCalls=0;const provider=basicProvider();provider.judgeConnection=async input=>{judgeCalls++;assert.equal(input.previous,'ทะเล');assert.equal(input.word,'ปลา');return {connected:true,reason:'ปลาอยู่ในทะเล'};};
 const store=new MemoryStore(),service=new RoomService(store,provider,()=>1000),keys=Array.from({length:4},token);
 const created=await service.command(cmd('create',{mode:'online',name:'คน0',token:keys[0]}));
 const auth=i=>({code:created.code,token:keys[i]});for(let i=1;i<4;i++)await service.command(cmd('join',{...auth(i),name:`คน${i}`}));
 let r=await service.command(cmd('start',{...auth(0),manual:true,text:'ทะเล'}));const ids=r.players.map(p=>p.id);r=await service.command(cmd('submit',{...auth(0),text:'ปลา',turn:r.turnNumber}));const wordId=r.chain[0].id;
 await assert.rejects(()=>service.command(cmd('challenge',{...auth(1),actorId:ids[2],wordId,turn:r.turnNumber,reason:'ไม่เชื่อม'})),/ชาเลนจ์ไม่ได้/);
 r=await service.command(cmd('challenge',{...auth(2),wordId,turn:r.turnNumber,reason:'ไม่เชื่อมอย่างไร'}));
 await assert.rejects(()=>service.command(cmd('vote',{...auth(1),challengeId:'stale-challenge',connected:true})),/ชาเลนจ์เปลี่ยนแล้ว/);
+ await service.command(cmd('debate',{challengeId:r.challenge.id,...auth(0),text:'ปลาอยู่ทะเล',finish:true}));await service.command(cmd('debate',{challengeId:r.challenge.id,...auth(2),text:'ขอโหวต',finish:true}));assert.equal(judgeCalls,0);
 await service.command(cmd('vote',{challengeId:r.challenge.id,...auth(1),connected:true}));r=await service.command(cmd('vote',{challengeId:r.challenge.id,...auth(3),connected:false}));assert.equal(r.challenge.phase,'judging');
 await service.check(created.code,keys[0]);r=await service.command({action:'read',...auth(0)});assert.equal(judgeCalls,1);assert.equal(r.challenge.result.by,'model');assert.equal(r.result.loserId,ids[2]);assert.equal(r.players[0].score,3);
 await service.check(created.code,keys[0]);assert.equal(judgeCalls,1);
});

test('uncertain classifications stay reviewable without repeatedly consuming model tokens',async()=>{
 let calls=0;const provider=basicProvider();provider.analyze=async words=>{calls++;return Object.fromEntries(words.map(w=>[w,{syllables:[w],category:'uncertain',nounType:'none',reason:'ชื่อเฉพาะที่ไม่แน่ใจ',suggestions:[],titleContext:''}]));};
 const f=await shared(provider);let r=await f.read();await f.service.command(cmd('submit',{...f.auth,text:'ชื่อ',turn:r.turnNumber}));await f.service.check(r.code,f.auth.token);r=await f.read();assert.equal(r.chain[0].check,'review');assert.equal(r.needsCheck,false);f.clock(10000);await f.service.check(r.code,f.auth.token);assert.equal(calls,1);
});

test('cached non-nouns are rejected by code without consulting the model',async()=>{
 const provider=basicProvider();let calls=0;provider.analyze=async()=>{calls++;throw new Error('should not run');};const f=await shared(provider);
 await f.store.saveAnalyses('test',{'วิ่ง':{syllables:['วิ่ง'],category:'verb',nounType:'none',reason:'คำกริยา',suggestions:['การวิ่ง'],titleContext:''}});
 let r=await f.read();await f.service.command(cmd('submit',{...f.auth,text:'วิ่ง',turn:r.turnNumber}));await f.service.check(r.code,f.auth.token);r=await f.read();assert.equal(calls,0);assert.equal(r.status,'ended');assert.equal(r.result.reason,'not_noun');assert.equal(r.events[0].word,'วิ่ง');
});

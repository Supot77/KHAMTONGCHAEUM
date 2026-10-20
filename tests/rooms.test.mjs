import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomService } from '../lib/rooms.ts';
import { createProvider,parseSegments,AiError } from '../lib/gemini.ts';

class MemoryStore{
  rows=new Map();words={};
  async read(code){const row=this.rows.get(code);return row?structuredClone(row):null;}
  async insert(game){if(this.rows.has(game.code))return false;this.rows.set(game.code,{game:structuredClone(game),revision:0});return true;}
  async write(code,revision,game){if(this.rows.get(code)?.revision!==revision)return false;this.rows.set(code,{game:structuredClone(game),revision:revision+1});return true;}
  async cached(model,words){return Object.fromEntries(words.filter(w=>this.words[w]).map(w=>[w,this.words[w]]));}
  async cache(model,entries){Object.assign(this.words,entries);}
}
const token=()=>crypto.randomUUID()+crypto.randomUUID();
const cmd=(action,rest={})=>({action,commandId:crypto.randomUUID(),...rest});
const basicProvider=()=>({configured:true,model:'test',seed:async()=>({text:'ทะเล',syllables:['ทะ','เล']}),segment:async words=>Object.fromEntries(words.map(w=>[w,({'ปลา':['ปลา'],'ปลาดาว':['ปลา','ดาว'],'เมฆ':['เมฆ'],'ท้องฟ้า':['ท้อง','ฟ้า']})[w]??[w]]))});
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
  assert.equal((await service.command({action:'read',...host})).chain.length,2);
  assert.equal(JSON.stringify(state).includes('tokenHash'),false);assert.equal('lease' in state,false);assert.equal('processed' in state,false);
});
test('stable command ID cannot award two points or consume two turns',async()=>{
  const f=await shared();const r=await f.read();const action=cmd('submit',{...f.auth,text:'ปลา',turn:r.turnNumber});
  await f.service.command(action);await f.service.command(action);assert.equal((await f.read()).chain.length,2);
});
test('LLM can finish after later submissions; rollback is durable and human review works',async()=>{
  let complete;const provider=basicProvider();provider.segment=async words=>new Promise(resolve=>{complete=()=>resolve(Object.fromEntries(words.map(w=>[w,{'ปลา':['ปลา'],'ปลาดาว':['ปลา','ดาว']}[w]??[w]])));});
  const f=await shared(provider);let r=await f.read();
  r=await f.service.command(cmd('submit',{...f.auth,text:'ปลา',turn:r.turnNumber}));r=await f.service.command(cmd('submit',{...f.auth,text:'ปลาดาว',turn:r.turnNumber}));
  const task=f.service.check(r.code,f.auth.token);while(!complete)await new Promise(resolve=>setTimeout(resolve,0));
  r=await f.service.command(cmd('submit',{...f.auth,text:'ท้องฟ้า',turn:r.turnNumber}));r=await f.service.command(cmd('submit',{...f.auth,text:'เมฆ',turn:r.turnNumber}));
  complete();await task;r=await f.read();
  assert.deepEqual(r.chain.map(w=>w.text),['ทะเล','ปลา']);assert.deepEqual(r.events[0].reusable.map(w=>w.text),['ท้องฟ้า','เมฆ']);
  assert.equal(r.events[0].playerName,'บี');assert.equal(r.events[0].previous,'ปลา');
  r=await f.service.command(cmd('appeal',{...f.auth,eventId:r.events[0].id}));assert.equal(r.chain.at(-1).text,'ปลาดาว');assert.equal(r.chain.at(-1).manual,true);
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

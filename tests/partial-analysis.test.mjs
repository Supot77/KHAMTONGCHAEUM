import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createProvider,parseAnalyses,AiError} from '../lib/gemini.ts';
import {createSqlStore} from '../lib/sql-store.ts';
import {RoomService} from '../lib/rooms.ts';
const noun=(word,syllables=[word])=>({word,syllables,category:'noun',nounType:'common',reason:'คำนามทดสอบ',suggestions:[],titleContext:''});
test('malformed, missing, duplicate and unsolicited rows cannot discard valid exact-spelling peers',()=>{
 const bad=noun('จรวด',['จะ','รวด']);
 const result=parseAnalyses(['แมว','จรวด','ขนม','มด'],{items:[noun('แมว'),bad,noun('ขนม',['ข','นม']),noun('ขนม',['ขนม']),noun('คำที่ไม่ได้ขอ')]});
 assert.deepEqual(Object.keys(result),['แมว']);
 assert.throws(()=>parseAnalyses(['จรวด'],{items:[bad]}),AiError);
 assert.throws(()=>parseAnalyses(['แมว'],{items:null}),AiError);
 const wrongType={...noun('สวย'),category:'adjective'};
 assert.deepEqual(Object.keys(parseAnalyses(['แมว','สวย'],{items:[noun('แมว'),wrongType]})),['แมว']);
});
test('partial model results reach dictionary and duplicate verdict; next request contains only unresolved word',async()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../database/schema.sql',import.meta.url),'utf8'));
 let now=1000;const store=createSqlStore(async(q,p)=>db.prepare(q).all(...p),()=>now);
 store.randomNoun=async()=>({text:'ปลา',analysis:noun('ปลา')});
 const requests=[];const provider=createProvider('fake','fake-model',async(url,options)=>{
  const {words}=JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);requests.push(words);
  const items=words.map(word=>noun(word,word==='จรวด'&&requests.length===1?['จะ','รวด']:word==='ปลาดาว'?['ปลา','ดาว']:[word]));
  return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({items})}]}}]});
 });
 const svc=new RoomService(store,provider,()=>now),token=crypto.randomUUID()+crypto.randomUUID();
 const cmd=(action,extra={})=>svc.command({action,token,code,commandId:crypto.randomUUID(),...extra});let code;
 code=(await cmd('create',{mode:'shared',names:['เอ','บี','ซี'],seconds:0})).code;
 await cmd('start');await svc.check(code,token);
 const submit=async text=>{const g=await cmd('read');return cmd('submit',{text,turn:g.turnNumber});};
 await submit('จรวด');await submit('แมว');await submit('ปลาดาว');
 await svc.check(code,token);
 assert.equal((await store.analyses('any',['แมว']))['แมว'].category,'noun');
 assert.deepEqual(await store.analyses('any',['จรวด']),{});
 let raw=await store.read(code);assert.ok(raw.game.aiError.includes('1 คำ'));assert.equal(raw.game.nextCheckAt,16000);
 assert.ok(raw.game.chain.find(w=>w.text==='แมว').analysis);
 await svc.check(code,token);assert.equal(requests.length,1,'cooldown must prevent immediate retry');
 now=17000;await svc.check(code,token);assert.deepEqual(requests[1],['จรวด']);
 raw=await store.read(code);assert.equal(raw.game.chain.find(w=>w.text==='จรวด').analysis.category,'noun');assert.equal(raw.game.aiError,null);
 // A subsequent full-word repeat must still be decided by code from the cached fact.
 const count=requests.length;const state=await submit('แมว');assert.equal(state.result.reason,'duplicate');assert.equal(requests.length,count);
 db.close();
});

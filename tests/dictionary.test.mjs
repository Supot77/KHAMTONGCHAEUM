import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createSqlStore} from '../lib/sql-store.ts';
import {RoomService} from '../lib/rooms.ts';
import {dictionaryCommand} from '../lib/dictionary-service.ts';
import {DictionaryConflictError} from '../lib/dictionary.ts';
import {RoomUnavailableError} from '../lib/room-lifecycle.ts';
import {createProvider} from '../lib/gemini.ts';
const noun=(syllables,extra={})=>({syllables,category:'noun',nounType:'common',reason:'คำนามทดสอบ',suggestions:[],titleContext:'',...extra});
const fine=['กรุง','เทพ','ม','หา','น','คร'],ocean=['ม','หา','ส','มุทร'];
async function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../database/schema.sql',import.meta.url),'utf8'));let now=1000,tail=Promise.resolve();
 const raw=async(q,p)=>db.prepare(q).all(...p),serial=work=>{const next=tail.then(work);tail=next.catch(()=>{});return next;};
 const store=createSqlStore((q,p)=>serial(()=>raw(q,p)),()=>now,work=>serial(async()=>{db.exec('BEGIN IMMEDIATE');try{const value=await work(raw);db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}));
 await store.saveAnalyses('old',{'กรุงเทพมหานคร':noun(['กรุงเทพ','มหานคร'],{nounType:'proper'}),'มหาสมุทร':noun(['มหา','สมุทร']),'มหาสมุด':noun(['ม','หา','ส','มุด'])});
 const service=new RoomService(store,{configured:false,model:'unused'},()=>now),tokens=Array.from({length:3},()=>crypto.randomUUID()+crypto.randomUUID());let code;
 const cmd=(i,action,extra={})=>service.command({code,token:tokens[i],action,commandId:crypto.randomUUID(),...extra});let room=await cmd(0,'create',{mode:'online',name:'เจ้าของ',seconds:0});code=room.code;await cmd(1,'join',{name:'ผู้เล่น'});
 const api=(i,action,extra={})=>dictionaryCommand(store,{code,token:tokens[i],action,...extra});
 const get=async word=>(await api(1,'list',{query:word})).items.find(x=>x.word===word);
 const edit=(entry,extra={})=>({originalWord:entry.word,word:entry.word,analysis:entry.analysis,expectedUpdatedAt:entry.updatedAt,...extra});
 return {db,store,service,cmd,api,get,edit,time:x=>now=x};
}

test('non-host room member can search and edit word_dictionary, recording actor and preserving model-independent reuse',async()=>{
 const f=await fixture(),entry=await f.get('กรุงเทพมหานคร');const result=await f.api(1,'save',f.edit(entry,{analysis:noun(fine,{nounType:'proper',reason:'แยกละเอียดตามการอ่าน'})}));assert.deepEqual(result.entry.analysis.syllables,fine);assert.equal(result.entry.source,'players');assert.equal(result.entry.updatedAt,1001);
 const history=f.db.prepare('SELECT metadata FROM word_analysis_history WHERE word=? ORDER BY updated_at').all(entry.word).map(x=>JSON.parse(x.metadata));assert.equal(history.at(-1).action,'edit');assert.ok(history.at(-1).playerId);assert.equal(JSON.stringify(history).includes('token'),false);
 await f.store.saveAnalyses('late-model',{[entry.word]:noun(['กรุงเทพ','มหานคร'])});assert.deepEqual((await f.store.analyses('any',[entry.word]))[entry.word].syllables,fine);f.db.close();
});

test('invalid phonetic/spelling fragments cannot corrupt a word or create history',async()=>{
 const f=await fixture(),entry=await f.get('มหาสมุทร'),before=f.db.prepare('SELECT count(*) n FROM word_analysis_history').get().n;
 await assert.rejects(()=>f.api(1,'save',f.edit(entry,{analysis:noun(['มะ','หา','สะ','หมุด'])})),/รูปเขียน/);assert.deepEqual(await f.get(entry.word),entry);assert.equal(f.db.prepare('SELECT count(*) n FROM word_analysis_history').get().n,before);f.db.close();
});

test('outsiders, departed members and expired rooms cannot read or edit the shared dictionary',async()=>{
 const f=await fixture(),entry=await f.get('มหาสมุทร');await assert.rejects(()=>f.api(2,'list'),RoomUnavailableError);await assert.rejects(()=>f.api(2,'save',f.edit(entry)),RoomUnavailableError);await f.cmd(1,'leave');await assert.rejects(()=>f.api(1,'save',f.edit(entry)),RoomUnavailableError);f.time(3601001);await assert.rejects(()=>f.api(0,'list'),RoomUnavailableError);f.db.close();
});

test('membership is checked again inside the transaction if the editor leaves after API authentication',async()=>{
 const f=await fixture(),entry=await f.get('มหาสมุทร'),update=f.store.updateDictionary;f.store.updateDictionary=async input=>{await f.cmd(1,'leave');return update(input);};await assert.rejects(()=>f.api(1,'save',f.edit(entry,{analysis:noun(ocean)})),RoomUnavailableError);assert.deepEqual((await f.store.listDictionary(entry.word,'')).items[0],entry);f.db.close();
});

test('spelling correction keeps the old form rejected with a suggestion and preserves all legacy data',async()=>{
 const f=await fixture(),entry=await f.get('มหาสมุด');const result=await f.api(1,'save',f.edit(entry,{word:'มหาสมุทรใหม่',analysis:noun([...ocean,'ใหม่'])}));assert.equal(result.entry.word,'มหาสมุทรใหม่');assert.deepEqual(result.entry.analysis.syllables,[...ocean,'ใหม่']);const original=await f.get('มหาสมุด');assert.equal(original.analysis.category,'other');assert.deepEqual(original.analysis.suggestions,['มหาสมุทรใหม่']);assert.equal(f.db.prepare('SELECT count(*) n FROM word_dictionary').get().n,4);assert.equal(f.db.prepare('SELECT count(*) n FROM word_analysis_history WHERE word=?').get('มหาสมุด').n,3);f.db.close();
});

test('renaming onto an existing word conflicts and rolls back the original word and audit',async()=>{
 const f=await fixture(),entry=await f.get('มหาสมุด'),count=f.db.prepare('SELECT count(*) n FROM word_analysis_history').get().n;await assert.rejects(()=>f.api(1,'save',f.edit(entry,{word:'มหาสมุทร',analysis:noun(ocean)})),DictionaryConflictError);assert.deepEqual(await f.get(entry.word),entry);assert.equal(f.db.prepare('SELECT count(*) n FROM word_analysis_history').get().n,count);f.db.close();
});

test('simultaneous editors cannot silently overwrite each other, even with a fixed clock',async()=>{
 const f=await fixture(),entry=await f.get('มหาสมุทร');const outcomes=await Promise.allSettled([f.api(0,'save',f.edit(entry,{analysis:noun(ocean,{reason:'ฉบับหนึ่ง'})})),f.api(1,'save',f.edit(entry,{analysis:noun(ocean,{reason:'ฉบับสอง'})}))]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.ok(outcomes.find(x=>x.status==='rejected').reason instanceof DictionaryConflictError);const latest=await f.get(entry.word);const again=await f.api(1,'save',f.edit(latest,{analysis:noun(ocean)}));assert.equal(again.entry.updatedAt,latest.updatedAt+1);f.db.close();
});

test('audit failure rolls back both spelling correction and current dictionary facts',async()=>{
 const f=await fixture(),entry=await f.get('มหาสมุด');f.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON word_analysis_history BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");await assert.rejects(()=>f.api(1,'save',f.edit(entry,{word:'มหาสมุทรใหม่',analysis:noun([...ocean,'ใหม่'])})),/audit unavailable/);assert.deepEqual(await f.get(entry.word),entry);assert.equal((await f.api(1,'list',{query:'มหาสมุทรใหม่'})).items.length,0);f.db.close();
});

test('dictionary pagination is bounded, stable and treats percent and underscore as literal searches',async()=>{
 const f=await fixture();for(let i=0;i<32;i++)await f.store.saveAnalyses('old',{['คำ'+String(i).padStart(3,'0')]:noun(['คำ',String(i).padStart(3,'0')])});const a=await f.api(1,'list'),b=await f.api(1,'list',{after:a.nextCursor});assert.equal(a.items.length,30);assert.equal(b.items.length,5);assert.equal(b.nextCursor,null);assert.equal(new Set([...a.items,...b.items].map(x=>x.word)).size,35);assert.equal((await f.api(1,'list',{query:'%'})).items.length,0);assert.equal((await f.api(1,'list',{query:'_'})).items.length,0);f.db.close();
});

test('model analyze and player review receive fine Thai reading examples while retaining noun/title and exact-spelling rules',async()=>{
 const requests=[];const provider=createProvider('test-key','test-model',async(url,options)=>{const request=JSON.parse(options.body);requests.push(request);const input=JSON.parse(request.contents[0].parts[0].text);const result=input.proposal?{verdict:'agree',analysis:input.proposal,reason:'ตรงการอ่าน'}:{items:[{word:'กรุงเทพมหานคร',...noun(fine,{nounType:'proper'})},{word:'มหาสมุทร',...noun(ocean)}]};return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(result)}]}}]});});
 const result=await provider.analyze(['กรุงเทพมหานคร','มหาสมุทร']);assert.deepEqual(result['กรุงเทพมหานคร'].syllables,fine);assert.deepEqual(result['มหาสมุทร'].syllables,ocean);await provider.reviewAnalysis({word:'มหาสมุทร',original:null,proposal:noun(ocean)});
 for(const req of requests){const text=req.systemInstruction.parts[0].text;assert.ok(text.includes('["กรุง","เทพ","ม","หา","น","คร"]'));assert.ok(text.includes('["ม","หา","ส","มุทร"]'));assert.ok(text.includes('ห้ามเติม มะ นะ สะ'));assert.ok(text.includes('ชื่อเพลง ภาพยนตร์ ซีรีส์'));assert.ok(text.includes('สีต้องมีคำว่า สี'));}
});

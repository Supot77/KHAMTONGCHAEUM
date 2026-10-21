import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {validateSyllables,duplicates,createGame,startRound,submitWord,applyAnalyses} from '../lib/game.ts';
import {createProvider} from '../lib/gemini.ts';
import {createSqlStore} from '../lib/sql-store.ts';
import {ANALYSIS_POLICY} from '../lib/word-analysis.ts';
const noun=syllables=>({syllables,category:'noun',nounType:'common',reason:'หน่วยเสียงตามกติกาเกม',suggestions:[],titleContext:''});
const examples={
 'วิทยาศาสตร์':['วิท','ท','ยา','ศาสตร์'],'อวัยวะ':['อ','วัย','ย','วะ'],
 'วิทยาลัย':['วิท','ท','ยา','ลัย'],'จิตวิทยา':['จิต','ต','วิท','ท','ยา'],
 'ประวัติศาสตร์':['ประ','วัติ','ศาสตร์'],'กรุงเทพมหานคร':['กรุง','เทพ','ม','หา','น','คร'],
 'มหาสมุทร':['ม','หา','ส','มุทร'],'โทรศัพท์':['โท','ร','ศัพท์'],
};
test('game units retain spelling while permitting a separately voiced boundary consonant',()=>{
 for(const [word,units] of Object.entries(examples))assert.deepEqual(validateSyllables(word,units),units);
 assert.deepEqual(validateSyllables('แปลรักฉันด้วยใจเธอ',['แปล','รัก','ฉัน','ด้วย','ใจ','เธอ']),['แปล','รัก','ฉัน','ด้วย','ใจ','เธอ']);
 assert.deepEqual(duplicates(examples['วิทยาศาสตร์'],['ท','หาร']),['ท']);
 assert.deepEqual(duplicates(examples['อวัยวะ'],['ย','โส','ธร']),['ย']);
 assert.deepEqual(duplicates(['จันทร์'],['จันทน์']),[]);
 assert.deepEqual(duplicates(['ท'],['ทะ']),[],'different written units remain different under the confirmed rule');
});
test('echoes do not allow phonetic rewrites, marked syllable repetition, letter invention or endless repeats',()=>{
 for(const [word,units] of [
  ['ประวัติศาสตร์',['ประ','วัติ','ติ','ศาสตร์']],['ประวัติ',['ประ','วัติ','ติ']],
  ['วิทยาศาสตร์',['วิท','ทะ','ยา','ศาสตร์']],['วิทยาศาสตร์',['วิท','ท','ท','ยา','ศาสตร์']],
  ['วิทยาศาสตร์',['วิท','ก','ยา','ศาสตร์']],['วิทยาศาสตร์',['วิท','ท','ยา','สาด']],
  ['วิทยาศาสตร์',['วิท','ท','ยา','ศาสตร์','ท']],['จรวด',['จะ','รวด']],
  ['มหาสมุทร',['มะ','หา','สะ','หมุด']],['จันทร์',['จันทร์','ร์']],
 ])assert.throws(()=>validateSyllables(word,units),/รูปเขียน/,word+' '+units.join('/'));
});
test('a duplicate carried by the new echo is caught by the actual game verdict',()=>{
 const g=createGame('ABC234','shared',['เอ','บี','ซี'],'host',0,1000);
 startRound(g,{text:'วิทยาศาสตร์',syllables:examples['วิทยาศาสตร์']},1000);
 submitWord(g,g.hostId,'ทหาร',1001,g.turnNumber);const w=g.chain.at(-1);
 applyAnalyses(g,g.roundId,[{id:w.id,analysis:noun(['ท','หาร'])}],1002);
 assert.equal(g.events[0].reason,'duplicate');assert.deepEqual(g.events[0].syllables,['ท']);
});
test('overlapping units survive dictionary persistence, read validation and protected human edits',async()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../database/schema.sql',import.meta.url),'utf8'));
 const store=createSqlStore(async(q,p)=>db.prepare(q).all(...p),()=>1000);
 await store.saveAnalyses('current',{'วิทยาศาสตร์':noun(examples['วิทยาศาสตร์'])},'players');
 assert.deepEqual((await store.analyses('other',['วิทยาศาสตร์']))['วิทยาศาสตร์'].syllables,examples['วิทยาศาสตร์']);
 const entry=await store.getDictionary('วิทยาศาสตร์');assert.equal(entry.validationError,null);assert.equal(entry.policy,ANALYSIS_POLICY);
 await store.saveAnalyses('late',{'วิทยาศาสตร์':noun(['วิท','ยา','ศาสตร์'])});
 assert.deepEqual((await store.getDictionary('วิทยาศาสตร์')).analysis.syllables,examples['วิทยาศาสตร์']);db.close();
});
test('changing the rule policy never silently rewrites or reanalyzes an existing dictionary fact',async()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../database/schema.sql',import.meta.url),'utf8'));
 const store=createSqlStore(async(q,p)=>db.prepare(q).all(...p),()=>1000);
 await store.saveAnalyses('old',{'วิทยาศาสตร์':noun(['วิท','ยา','ศาสตร์'])});
 db.prepare('UPDATE word_dictionary SET policy=? WHERE word=?').run('thai-noun-titles-v2-fine-syllables','วิทยาศาสตร์');
 assert.deepEqual((await store.analyses('new',['วิทยาศาสตร์']))['วิทยาศาสตร์'].syllables,['วิท','ยา','ศาสตร์']);
 assert.equal((await store.getDictionary('วิทยาศาสตร์')).policy,'thai-noun-titles-v2-fine-syllables');db.close();
});
test('both new analyses and explicit player review receive the game-unit rule and the วัติ exception',async()=>{
 const requests=[];const provider=createProvider('fake','fake',async(url,options)=>{
  const body=JSON.parse(options.body);requests.push(body);const input=JSON.parse(body.contents[0].parts[0].text);
  const value=input.proposal?{verdict:'agree',analysis:input.proposal,reason:'ตรงกติกาเกม'}:{items:input.words.map(word=>({word,...noun(examples[word])}))};
  return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(value)}]}}]});
 });
 await provider.analyze(['วิทยาศาสตร์','อวัยวะ']);await provider.reviewAnalysis({word:'ประวัติศาสตร์',original:null,proposal:noun(examples['ประวัติศาสตร์'])});
 for(const r of requests){const prompt=r.systemInstruction.parts[0].text;assert.ok(prompt.includes('["วิท","ท","ยา","ศาสตร์"]'));assert.ok(prompt.includes('["อ","วัย","ย","วะ"]'));assert.ok(prompt.includes('วัติ เป็นหน่วยเดียว ห้ามเติม ติ'));assert.ok(prompt.includes('ไม่ใช่การแบ่งพยางค์ตามตำรา'));}
});

import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import {createProvider} from '../lib/gemini.ts';
if(!process.argv.includes('--allow-model-call'))throw Error('Use --allow-model-call for two explicit live requests, with no database writes.');
nextEnv.loadEnvConfig(process.cwd());
const raw=[];const provider=createProvider(process.env.GEMINI_API_KEY,process.env.GEMINI_MODEL,async(url,options)=>{const response=await fetch(url,options);if(response.ok){const data=await response.clone().json();try{const value=JSON.parse(data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join(''));if(value.items)raw.push(...value.items.map(i=>({word:i.word,syllables:i.syllables,category:i.category})));}catch{}}return response;});
const expected={
 'วิทยาศาสตร์':['วิท','ท','ยา','ศาสตร์'],'อวัยวะ':['อ','วัย','ย','วะ'],
 'ประวัติศาสตร์':['ประ','วัติ','ศาสตร์'],'วิทยาลัย':['วิท','ท','ยา','ลัย'],
 'จิตวิทยา':['จิต','ต','วิท','ท','ยา'],'มหาสมุทร':['ม','หา','ส','มุทร'],
 'วิทยานิพนธ์':['วิท','ท','ยา','นิ','พนธ์'],'อาชีวศึกษา':['อา','ชี','ว','ศึก','ษา'],
};
const result=await provider.analyze(Object.keys(expected));
const rows=Object.entries(expected).map(([word,units])=>({word,expected:units,actual:result[word]?.syllables??null,pass:JSON.stringify(result[word]?.syllables)===JSON.stringify(units),category:result[word]?.category}));
console.log(JSON.stringify({model:provider.model,rows,rejectedRows:raw.filter(r=>!result[r.word]),dictionaryWrites:0}));
const review=await provider.reviewAnalysis({word:'ประวัติศาสตร์',original:null,proposal:{syllables:['ประ','วัติ','ติ','ศาสตร์'],category:'noun',nounType:'common',reason:'ช่วยตรวจตามกติกาเกม',suggestions:[],titleContext:''},request:'วัติ ไม่ต้องเพิ่ม ติ เพราะไม่ได้ออกเสียงซ้ำตามกติกาเกมนี้'});
console.log(JSON.stringify({word:'ประวัติศาสตร์',review,dictionaryWrites:0}));
assert.ok(rows.every(r=>r.pass&&r.category==='noun'),'Some model results still need human review');assert.deepEqual(review.analysis.syllables,expected['ประวัติศาสตร์']);
console.log(JSON.stringify({result:'PASS',liveRequests:2,dictionaryWrites:0}));

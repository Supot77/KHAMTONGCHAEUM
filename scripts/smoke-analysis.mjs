// Explicit opt-in. No secrets are printed; use the configured free-tier account.
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import {createProvider} from '../lib/gemini.ts';
import pg from 'pg';
import {createSqlStore,postgresPlaceholders} from '../lib/sql-store.ts';
import {nounDecision} from '../lib/word-analysis.ts';
if(!process.argv.includes('--allow-live'))throw new Error('Use --allow-live to invoke the configured Gemini model.');
nextEnv.loadEnvConfig(process.cwd());
const provider=createProvider(process.env.GEMINI_API_KEY,process.env.GEMINI_MODEL);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:10000});
const store=createSqlStore(async(q,p)=>(await pool.query(postgresPlaceholders(q),p)).rows);
const cases=[['วิ่ง','reject'],['การวิ่ง','accept'],['สุข','reject'],['ความสุข','accept'],['แดง','reject'],['สีแดง','accept'],['ส้ม','accept'],['การบ้าน','accept'],['ถ้าเราเจอกันอีก','accept'],['แปลรักฉันด้วยใจเธอ','accept'],['ฉันเดินไปซื้อข้าวที่ตลาดทุกวัน','reject'],['ความโต๊ะ','reject']];
let modelCalls=0;
for(let offset=0;offset<cases.length;offset+=4){
 const batch=cases.slice(offset,offset+4),words=batch.map(([word])=>word);
 const cached=await store.analyses(provider.model,words),missing=words.filter(w=>!Object.hasOwn(cached,w));
 if(missing.length){const fresh=await provider.analyze(missing);modelCalls++;await store.saveAnalyses(provider.model,fresh);Object.assign(cached,fresh);}
 for(const [word,expected] of batch){const a=cached[word];console.log(JSON.stringify({word,category:a.category,nounType:a.nounType,syllables:a.syllables,reason:a.reason}));assert.equal(nounDecision(a),expected,word);}
 const repeated=await store.analyses(provider.model,words);assert.equal(Object.keys(repeated).length,words.length);
}
console.log(JSON.stringify({cases:cases.length,modelCalls,secondRead:'all database hits; no model calls',result:'PASS'}));
await pool.end();

import nextEnv from '@next/env';
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createSqlStore,postgresPlaceholders} from '../lib/sql-store.ts';
nextEnv.loadEnvConfig(process.cwd());
const host=process.argv.find(a=>a.startsWith('--host='))?.slice(7);
if(!host&&!process.argv.includes('--allow-production'))throw new Error('Supply --host=<observed Neon QA branch host>, or explicitly use --allow-production after branch verification.');
const url=new URL(process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL);
if(host){if(!/^[a-z0-9.-]+\.neon\.tech$/.test(host)||host.includes('-pooler'))throw new Error('Use an observed direct Neon hostname');url.hostname=host;}
const client=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:15000});
const digest=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
await client.connect();
try{
 const legacy=async()=>(await client.query('SELECT * FROM word_analysis_cache ORDER BY policy,model,word')).rows;
 const before=await legacy(),hash=digest(before);
 await client.query('BEGIN');
 for(const sql of readFileSync(new URL('../database/schema.sql',import.meta.url),'utf8').split('-- statement-breakpoint').map(s=>s.trim()).filter(Boolean))await client.query(sql);
 assert.equal(digest(await legacy()),hash,'legacy analyses must remain unchanged');
 const counts=(await client.query('SELECT (SELECT count(*)::int FROM word_dictionary) AS dictionary, (SELECT count(*)::int FROM word_analysis_history) AS history')).rows[0];
 assert.ok(counts.dictionary>=new Set(before.map(r=>r.word)).size);assert.ok(counts.history>=before.length);
 await client.query('COMMIT');
 // Exercise the real PostgreSQL statements, then roll back every QA dictionary/lease row.
 await client.query('BEGIN');
 const store=createSqlStore(async(q,p)=>(await client.query(postgresPlaceholders(q),p)).rows);
 const word='ทดสอบฐานคำ'+Date.now(),analysis={syllables:['ทดสอบฐานคำ',word.replace('ทดสอบฐานคำ','')],category:'noun',nounType:'common',reason:'QA rollback fixture',suggestions:[],titleContext:''};
 await store.saveAnalyses('qa-model-a',{[word]:analysis});assert.equal((await store.analyses('qa-model-b',[word]))[word].category,'noun');
 await store.saveAnalyses('qa-model-b',{[word]:{...analysis,reason:'human QA'}},'players',{proposalId:'qa-rollback'});
 await store.saveAnalyses('qa-model-c',{[word]:analysis});assert.equal((await store.analyses('any',[word]))[word].reason,'human QA');
 const at=Date.now();assert.deepEqual(await store.claimAnalyses([word],'owner',at+65000,at),[word]);assert.deepEqual(await store.claimAnalyses([word],'other',at+65000,at),[]);
 await store.releaseAnalyses([word],'wrong');assert.equal((await client.query('SELECT lease_id FROM word_analysis_jobs WHERE word=$1',[word])).rows[0].lease_id,'owner');
 await client.query('ROLLBACK');
 console.log(JSON.stringify({target:host?'neon-qa-branch':'neon-production',legacyRows:before.length,legacyUnchanged:'PASS',...counts,modelIndependentRead:'PASS',humanProtection:'PASS',globalLease:'PASS',qaWritesRolledBack:true,result:'PASS'}));
}catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}

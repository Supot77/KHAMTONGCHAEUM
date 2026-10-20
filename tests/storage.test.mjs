import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createSqlStore,postgresPlaceholders } from '../lib/sql-store.ts';
import { createGame } from '../lib/game.ts';
test('real SQL store persists, CAS prevents stale writes, cache upserts and model isolation',async()=>{
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../database/schema.sql',import.meta.url),'utf8'));
  const store=createSqlStore(async(q,p)=>db.prepare(q).all(...p));
  const game=createGame('ABCDEF','shared',['เอ','บี'],'hash',30,1000);
  assert.equal(await store.insert(game),true);assert.equal(await store.insert(game),false);
  let row=await store.read('ABCDEF');assert.equal(row.revision,0);
  row.game.notice='saved';assert.equal(await store.write('ABCDEF',0,row.game),true);assert.equal(await store.write('ABCDEF',0,game),false);
  assert.equal((await store.read('ABCDEF')).game.notice,'saved');
  await store.cache('model-a',{'ปลา':['ปลา'],'ทะเล':['ทะ','เล']});
  assert.deepEqual(await store.cached('model-a',['ปลา','ทะเล']),{'ปลา':['ปลา'],'ทะเล':['ทะ','เล']});
  assert.deepEqual(await store.cached('model-b',['ปลา']),{});
  await store.cache('model-a',{'ปลา':['ปลา']});assert.deepEqual(await store.cached('model-a',['ปลา']),{'ปลา':['ปลา']});
  db.close();
});
test('Postgres adapter numbers only parameter slots',()=>{assert.equal(postgresPlaceholders('WHERE code = ? AND revision = ?'),'WHERE code = $1 AND revision = $2');});

test('analysis cache keeps classifications, negatives, and player corrections across SQL reads',async()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../database/schema.sql',import.meta.url),'utf8'));const store=createSqlStore(async(q,p)=>db.prepare(q).all(...p));
 const noun={syllables:['ปลา'],category:'noun',nounType:'common',reason:'คำนาม',suggestions:[],titleContext:''};
 const verb={syllables:['วิ่ง'],category:'verb',nounType:'none',reason:'คำกริยา',suggestions:['การวิ่ง'],titleContext:''};
 await store.saveAnalyses('m',{'ปลา':noun,'วิ่ง':verb});assert.deepEqual(await store.analyses('m',['วิ่ง']),{'วิ่ง':verb});assert.deepEqual(await store.analyses('other',['วิ่ง']),{});
 const corrected={...noun,reason:'ผู้เล่นยืนยัน'};await store.saveAnalyses('m',{'ปลา':corrected},'players');await store.saveAnalyses('m',{'ปลา':noun});assert.deepEqual(await store.analyses('m',['ปลา']),{'ปลา':corrected});
 const unknown={...noun,category:'uncertain',nounType:'none'};await store.saveAnalyses('m',{'ปลา':unknown});assert.deepEqual(await store.analyses('m',['ปลา']),{'ปลา':corrected});db.close();
});

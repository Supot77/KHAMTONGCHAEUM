import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startRound, submitWord, applySegments, duplicates, scoreboard, advanceTimeout, rollback, resolveManually } from '../lib/game.ts';

const setup = () => {
  const r = createGame('ABCDEF', 'shared', ['เอ', 'บี', 'ซี'], 'hash', 30, 0);
  startRound(r, { text: 'ทะเล', syllables: ['ทะ','เล'] }, 1000);
  return r;
};
const send = (r, text, at=2000) => submitWord(r, r.hostId, text, at, r.turnNumber);

test('different written homophones pass; exact syllables fail', () => {
  assert.deepEqual(duplicates(['จันทร์'], ['จันทน์']), []);
  assert.deepEqual(duplicates(['ปลา'], ['ปลา','ดาว']), ['ปลา']);
});
test('submit moves turn and clock immediately, without syllables', () => {
  const r = setup(); const id = r.players[0].id;
  const w = send(r,'ปลา');
  assert.equal(w.check,'pending'); assert.equal(r.turnIndex,1);
  assert.equal(r.deadline,32000); assert.equal(scoreboard(r).find(p=>p.id===id).pending,1);
});
test('late duplicate rolls back descendants, scores, restores culprit turn and reusable list', () => {
  const r = setup(); const fish=send(r,'ปลา'); const star=send(r,'ปลาดาว');
  send(r,'ท้องฟ้า'); send(r,'เมฆ');
  applySegments(r, r.roundId, [{id:fish.id,syllables:['ปลา']},{id:star.id,syllables:['ปลา','ดาว']}], 8000);
  assert.deepEqual(r.chain.map(w=>w.text),['ทะเล','ปลา']);
  assert.equal(r.turnIndex,1); assert.equal(r.deadline,38000);
  const event=r.events.at(-1);
  assert.equal(event.playerName,'บี'); assert.equal(event.previous,'ปลา');
  assert.deepEqual(event.syllables,['ปลา']); assert.deepEqual(event.reusable.map(w=>w.text),['ท้องฟ้า','เมฆ']);
  assert.equal(scoreboard(r).find(p=>p.name==='เอ').score,1);
  assert.equal(scoreboard(r).find(p=>p.name==='เอ').pending,0);
  const replay=send(r,'ท้องฟ้า',9000); assert.equal(replay.text,'ท้องฟ้า');
});
test('only adjacent words count and replayed word IDs cannot receive stale results', () => {
  const r=setup(); const fish=send(r,'ปลา'); const sky=send(r,'ท้องฟ้า'); const sea=send(r,'ทะเล');
  applySegments(r,r.roundId,[{id:fish.id,syllables:['ปลา']},{id:sky.id,syllables:['ท้อง','ฟ้า']},{id:sea.id,syllables:['ทะ','เล']}],5000);
  assert.equal(r.chain.length,4); assert.equal(r.chain.at(-1).check,'valid');
  rollback(r,sky.id,'human',[],6000); const again=send(r,'ท้องฟ้า',7000);
  applySegments(r,r.roundId,[{id:sky.id,syllables:['ท้อง','ฟ้า']}],8000);
  assert.equal(r.chain.at(-1).id,again.id); assert.equal(r.chain.at(-1).check,'pending');
});
test('results from old rounds are ignored', () => {
  const r=setup(); const oldRound=r.roundId; const w=send(r,'ปลา');
  startRound(r,{text:'แมว',syllables:['แมว']},4000);
  applySegments(r,oldRound,[{id:w.id,syllables:['ปลา']}],5000);
  assert.equal(r.chain.length,1); assert.equal(r.chain[0].text,'แมว');
});
test('model cannot change spelling, drop marks or invent readings', () => {
  const r=setup(); const w=send(r,'จันทร์');
  assert.throws(()=>applySegments(r,r.roundId,[{id:w.id,syllables:['จัน']}],3000),/รูปเขียน/);
  assert.equal(w.check,'pending');
  const invalid=send(r,'ทะเล');assert.throws(()=>applySegments(r,r.roundId,[{id:invalid.id,syllables:['ท','ะ','เล']}],3000),/รูปเขียน/);
});
test('expired submissions fail; timeout advances by all elapsed turns', () => {
  const r=setup(); const turn=r.turnNumber;
  assert.throws(()=>submitWord(r,r.players[0].id,'ปลา',31000,turn),/หมดเวลา/);
  advanceTimeout(r,62000); assert.equal(r.turnIndex,2); assert.equal(r.deadline,91000);
});
test('manual acceptance is scoped to an exact adjacent word instance', () => {
  const r=setup(); const w=send(r,'ทะเลสาบ');
  resolveManually(r,w.id,2000);
  applySegments(r,r.roundId,[{id:w.id,syllables:['ทะ','เล','สาบ']}],3000);
  assert.equal(r.chain.length,2); assert.equal(r.chain[1].check,'valid');
});
test('internal syllable repetitions are not compared to themselves', () => {
  assert.deepEqual(duplicates(['ทะ','เล'],['นาน','นาน']),[]);
});

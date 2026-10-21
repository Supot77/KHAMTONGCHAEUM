import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createSqlStore} from '../lib/sql-store.ts';
import {RoomService} from '../lib/rooms.ts';
import {createGame,startRound,submitWord,applyAnalyses,finishRound,advanceContinuation,publicGame,roundWords} from '../lib/game.ts';
import {openChallenge,debate,castVote} from '../lib/challenge.ts';
const noun=syllables=>({syllables,category:'noun',nounType:'common',reason:'คำนาม',suggestions:[],titleContext:''});
function game(n=4){const g=createGame('ABCDEF','shared',Array.from({length:n},(_,i)=>'คน'+i),'hash',30,0);startRound(g,{text:'ทะเล',syllables:['ทะ','เล']},1000);return g;}
function send(g,text,syllables,at=1100){const w=submitWord(g,g.hostId,text,at,g.turnNumber);if(syllables)applyAnalyses(g,g.roundId,[{id:w.id,analysis:noun(syllables)}],at);return w;}

test('five seconds are enforced, next survivor starts from the same valid word with a full turn',()=>{
 const g=game(),fish=send(g,'ปลา',['ปลา']),oldTurn=g.turnNumber,oldPhase=g.roundId;
 finishRound(g,g.players[1].id,'timeout',2000);assert.equal(g.continuation.starterId,g.players[2].id);assert.equal(g.continuation.anchorId,fish.id);assert.equal(g.continuation.at,7000);
 assert.equal(advanceContinuation(g,6999),false);assert.equal(g.deadline,null);assert.throws(()=>submitWord(g,g.hostId,'แมว',6999,oldTurn),/รอให้เริ่ม/);
 assert.equal(advanceContinuation(g,7000),true);assert.equal(g.chain.at(-1).id,fish.id);assert.equal(g.turnIndex,2);assert.equal(g.deadline,37000);assert.notEqual(g.roundId,oldPhase);
 assert.throws(()=>submitWord(g,g.hostId,'แมว',7001,oldTurn),/ตาเปลี่ยน/);const scores=structuredClone(g.competition.totals);assert.equal(advanceContinuation(g,8000),false);assert.deepEqual(g.competition.totals,scores);
});

test('pending tail is released, retained for final review, and late old facts cannot eliminate twice',()=>{
 const g=game(),fish=send(g,'ปลา',['ปลา']),pending=send(g,'คำรอผล');const oldPhase=g.roundId;
 finishRound(g,g.players[2].id,'surrender',2000);const view=publicGame(g,0,g.hostId,2000);assert.deepEqual(view.reviewWords,[]);assert.equal(JSON.stringify(view).includes('ทะเล'),false);
 advanceContinuation(g,7000);assert.equal(g.chain.at(-1).id,fish.id);assert.deepEqual(g.releasedWords.map(w=>w.text),['คำรอผล']);assert.ok(roundWords(g).some(w=>w.id===pending.id));
 const alive=[...g.competition.activeIds];applyAnalyses(g,oldPhase,[{id:pending.id,analysis:{...noun(['คำ','รอ','ผล']),category:'verb',nounType:'none'}}],7100);assert.deepEqual(g.competition.activeIds,alive);
 applyAnalyses(g,g.roundId,[{id:pending.id,analysis:{...noun(['คำ','รอ','ผล']),category:'verb',nounType:'none'}}],7200);assert.deepEqual(g.competition.activeIds,alive);assert.equal(pending.verification.status,'not_noun');assert.equal(pending.verification.applied,false);
});

test('disconnected challenge removes the disputed word; connected challenge preserves it',()=>{
 for(const connected of [false,true]){
  const g=game(),fish=send(g,'ปลา',['ปลา']);openChallenge(g,g.players[2].id,fish.id,g.turnNumber,'ขอโหวต',1200);
  debate(g,g.players[0].id,'ปลาอยู่ในทะเล',true,1300);debate(g,g.players[2].id,'ขอให้โหวต',true,1400);
  castVote(g,g.players[1].id,connected,1500);castVote(g,g.players[3].id,connected,1600);
  assert.equal(g.continuation.word,connected?'ปลา':'ทะเล');assert.equal(g.continuation.starterId,g.players[connected?3:1].id);
  advanceContinuation(g,6600);assert.equal(g.chain.at(-1).text,connected?'ปลา':'ทะเล');assert.equal(g.challenge,null);
  assert.ok(roundWords(g).some(w=>w.id===fish.id));
 }
});

test('new words still compare against the carried anchor without re-penalizing old words',()=>{
 const g=game();send(g,'ปลา',['ปลา']);finishRound(g,g.players[1].id,'surrender',2000);advanceContinuation(g,7000);
 const w=send(g,'ปลาดาว',['ปลา','ดาว'],7100);assert.equal(g.result.loserId,g.players[2].id);assert.equal(g.result.reason,'duplicate');assert.equal(g.events.at(-1).wordId,w.id);assert.equal(g.competition.activeIds.length,2);
});

test('all five sets eliminate eight players automatically until one winner and award points once',()=>{
 const g=game(8),ids=g.players.map(p=>p.id);let now=2000;
 for(let set=1;set<=5;set++){
  for(let i=0;i<7;i++){
   finishRound(g,ids[i],'timeout',now);if(i<6){assert.ok(g.continuation);now+=5000;advanceContinuation(g,now);assert.equal(g.players[g.turnIndex].id,ids[i+1]);}else {assert.equal(g.continuation,null);assert.equal(g.competition.setComplete,true);}
   now+=100;
  }
  assert.equal(g.competition.set,set);if(set<5)startRound(g,{text:'ทะเล',syllables:['ทะ','เล']},now);
 }
 assert.deepEqual(ids.map(id=>g.competition.totals[id]??0),[0,0,0,0,0,5,5,15]);assert.equal(g.competition.completedSets.length,5);
});

async function fixture(n=4,withNoun=true){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../database/schema.sql',import.meta.url),'utf8'));let now=1000;
 const store=createSqlStore(async(q,p)=>db.prepare(q).all(...p),()=>now);if(withNoun)await store.saveAnalyses('old',{'ทะเล':noun(['ทะ','เล'])});
 const provider={configured:false,model:'unused',seed:async()=>{throw new Error('must not call Gemini for an opening');},analyze:async()=>{throw new Error('unexpected model call');}};
 const service=new RoomService(store,provider,()=>now),tokens=Array.from({length:n},()=>crypto.randomUUID()+crypto.randomUUID());
 const cmd=(i,action,extra={})=>service.command({code,token:tokens[i],action,commandId:crypto.randomUUID(),...extra});let code;
 const created=await cmd(0,'create',{mode:'online',name:'คน0',seconds:30});code=created.code;for(let i=1;i<n;i++)await cmd(i,'join',{name:'คน'+i});
 return {db,store,service,cmd,code,time:x=>now=x};
}

test('database noun opens without a Gemini key, and a guest advances the countdown with no host action',async()=>{
 const f=await fixture();let r=await f.cmd(0,'start');assert.equal(r.status,'playing');assert.equal(r.chain[0].analysisSource,'database');
 r=await f.cmd(0,'pass',{turn:r.turnNumber});assert.equal(r.continuation.at,6000);
 await assert.rejects(()=>f.cmd(0,'lobby'),/อัตโนมัติ/);await assert.rejects(()=>f.cmd(0,'start'),/อัตโนมัติ/);
 f.time(5999);assert.equal((await f.cmd(1,'read')).status,'ended');f.time(6000);
 const [a,b]=await Promise.all([f.cmd(1,'read'),f.cmd(2,'read')]);assert.equal(a.status,'playing');assert.equal(a.roundId,b.roundId);assert.equal(a.turnNumber,b.turnNumber);assert.equal(a.players[a.turnIndex].name,'คน1');assert.equal(a.deadline-a.serverNow,30000);f.db.close();
});

test('random opening query excludes verbs and uncertain entries; an empty noun database gives a clear error',async()=>{
 const f=await fixture(2);await f.store.saveAnalyses('old',{'วิ่ง':{...noun(['วิ่ง']),category:'verb',nounType:'none'},'ชื่อ':{...noun(['ชื่อ']),category:'uncertain',nounType:'none'}});
 for(let i=0;i<15;i++)assert.equal((await f.store.randomNoun()).text,'ทะเล');f.db.close();
 const empty=await fixture(2,false);await assert.rejects(()=>empty.cmd(0,'start'),/ฐานคำยังไม่มีคำนาม/);assert.equal((await empty.cmd(0,'read')).status,'lobby');empty.db.close();
});

test('set winner and explicit review pause never create an automatic continuation',async()=>{
 const f=await fixture(2);let r=await f.cmd(0,'start');r=await f.cmd(0,'pass',{turn:r.turnNumber});assert.equal(r.continuation,null);assert.equal(r.competition.setComplete,true);assert.ok(r.reviewWords.length);
 f.time(100000);assert.equal((await f.cmd(1,'read')).status,'ended');f.db.close();
 const g=game();g.status='ended';g.deadline=null;assert.equal(advanceContinuation(g,100000),false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,startRound,submitWord,finishRound,publicGame,advanceTimeout} from '../lib/game.ts';
import {openChallenge,debate,castVote,advanceChallenge,resolveChallenge} from '../lib/challenge.ts';

function setup(n=4){const g=createGame('ABCDEF','shared',Array.from({length:n},(_,i)=>`คน ${i+1}`),'hash',30,0);startRound(g,{text:'ทะเล',syllables:['ทะ','เล']},1000);return g;}
function loss(g,id,now=2000){finishRound(g,id,'human',now);}
const next=g=>startRound(g,{text:'ทะเล',syllables:['ทะ','เล']},3000);
function challenge(g){const word=submitWord(g,g.hostId,'ปลา',1500,g.turnNumber);openChallenge(g,g.players[2].id,word.id,g.turnNumber,'คำนี้เกี่ยวกันอย่างไร',2000);return word;}

test('last three receive one point once; winner receives two additional points',()=>{
 const g=setup(8);const ids=g.players.map(p=>p.id);
 for(let i=0;i<5;i++){loss(g,ids[i]);assert.equal(g.status,'ended');if(i<4)next(g);}
 assert.deepEqual(g.competition.activeIds,ids.slice(5));assert.deepEqual(ids.map(id=>g.competition.totals[id]??0),[0,0,0,0,0,1,1,1]);
 next(g);loss(g,ids[5]);next(g);loss(g,ids[6]);assert.equal(g.competition.winnerId,ids[7]);assert.equal(g.competition.totals[ids[7]],3);assert.equal(g.competition.totals[ids[5]],1);assert.equal(g.competition.completedSets.length,1);
 const totals=structuredClone(g.competition.totals);loss(g,ids[6]);assert.deepEqual(g.competition.totals,totals);
});
test('exactly five completed sets per round, all players return and totals persist',()=>{
 const g=setup(2),[a,b]=g.players.map(p=>p.id);
 for(let set=1;set<=5;set++){assert.equal(g.competition.set,set);assert.equal(g.competition.activeIds.length,2);loss(g,a);assert.equal(g.competition.winnerId,b);if(set<5)next(g);}
 assert.equal(g.competition.totals[a],5);assert.equal(g.competition.totals[b],15);assert.equal(g.competition.completedSets.length,5);
 next(g);assert.equal(g.competition.round,2);assert.equal(g.competition.set,1);assert.equal(g.competition.history.length,1);assert.equal(g.competition.history[0].points[b],15);assert.equal(g.competition.totals[b],16);
});
test('eliminated players cannot receive a turn; previous phase history remains hidden',()=>{
 const g=setup();loss(g,g.players[0].id);next(g);assert.equal(g.turnIndex,1);
 submitWord(g,g.hostId,'ปลา',3100,g.turnNumber);assert.equal(g.turnIndex,2);submitWord(g,g.hostId,'แมว',3200,g.turnNumber);assert.equal(g.turnIndex,3);submitWord(g,g.hostId,'นก',3300,g.turnNumber);assert.equal(g.turnIndex,1);
 const view=publicGame(g,0,g.hostId);assert.equal('archiveWords' in view,false);assert.equal(JSON.stringify(view).includes('ทะเล'),false);
});
test('only eligible non-current non-owner players challenge and normal clock pauses',()=>{
 const g=setup();const word=submitWord(g,g.hostId,'ปลา',1500,g.turnNumber);
 for(const id of [g.players[0].id,g.players[1].id])assert.throws(()=>openChallenge(g,id,word.id,g.turnNumber,'ไม่เกี่ยว',2000),/ชาเลนจ์ไม่ได้/);
 openChallenge(g,g.players[2].id,word.id,g.turnNumber,'ไม่เกี่ยวอย่างไร',2000);assert.equal(g.deadline,null);
 assert.equal(advanceTimeout(g,300000),false);assert.throws(()=>submitWord(g,g.hostId,'แมว',3000,g.turnNumber),/ชาเลนจ์/);
 assert.throws(()=>debate(g,g.players[2].id,'พูดแทรก',true,3000),/ช่วงพูด/);
});
test('votes are private, participants cannot vote, and connected verdict eliminates challenger',()=>{
 const g=setup();challenge(g);const [owner,voter,challenger,other]=g.players.map(p=>p.id);
 debate(g,owner,'ปลาอยู่ในทะเล',true,3000);debate(g,challenger,'ขอโหวต',true,4000);
 assert.throws(()=>castVote(g,owner,true,5000),/ไม่ได้ดีเบต/);assert.throws(()=>castVote(g,challenger,false,5000),/ไม่ได้ดีเบต/);
 castVote(g,voter,true,5000);const view=publicGame(g,0,other);assert.equal(view.challenge.tally,null);assert.equal(view.challenge.youVote,null);assert.equal('votes' in view.challenge,false);
 castVote(g,other,true,6000);assert.equal(g.status,'ended');assert.equal(g.result.loserId,challenger);assert.equal(g.challenge.result.winnerId,owner);assert.equal(g.competition.totals[owner],3); // 2 challenge + 1 finalist
 const total=g.competition.totals[owner];assert.throws(()=>castVote(g,other,true,7000),/ปิดโหวต/);assert.equal(g.competition.totals[owner],total);
});
test('disconnected verdict gives challenger two bonus points and eliminates owner',()=>{
 const g=setup(3);challenge(g);const [owner,voter,challenger]=g.players.map(p=>p.id);debate(g,owner,'คำชี้แจง',true,3000);debate(g,challenger,'คำโต้แย้ง',true,4000);castVote(g,voter,false,5000);
 assert.equal(g.result.loserId,owner);assert.equal(g.competition.totals[challenger],3);assert.equal(g.challenge.result.connected,false);
});
test('60/60/30 deadlines advance from server time; no votes and ties request model only',()=>{
 const g=setup();challenge(g);advanceChallenge(g,62000);assert.equal(g.challenge.phase,'challenger');advanceChallenge(g,122000);assert.equal(g.challenge.phase,'vote');advanceChallenge(g,152000);assert.equal(g.challenge.phase,'judging');assert.equal(g.status,'playing');
 resolveChallenge(g,true,'model','ปลาอาศัยในทะเล',153000);assert.equal(g.challenge.result.by,'model');assert.equal(g.status,'ended');
 const h=setup();challenge(h);debate(h,h.players[0].id,'ชี้แจง',true,3000);debate(h,h.players[2].id,'โต้แย้ง',true,4000);castVote(h,h.players[1].id,true,5000);castVote(h,h.players[3].id,false,5000);assert.equal(h.challenge.phase,'judging');assert.equal(h.status,'playing');
});

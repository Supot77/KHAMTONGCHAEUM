import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createSqlStore} from '../lib/sql-store.ts';
import {RoomService} from '../lib/rooms.ts';
import {RoomUnavailableError} from '../lib/room-lifecycle.ts';
import {playerName} from '../lib/player-name.ts';
const noun=syllables=>({syllables,category:'noun',nounType:'common',reason:'คำนาม',suggestions:[],titleContext:''});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function until(check){for(let i=0;i<100;i++){if(await check())return;await new Promise(r=>setTimeout(r,1));}throw new Error('expected reservation');}
async function fixture(n=3,mode='online'){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../database/schema.sql',import.meta.url),'utf8'));let now=1000;
 const store=createSqlStore(async(q,p)=>db.prepare(q).all(...p),()=>now);store.randomNoun=async()=>({text:'ทะเล',analysis:noun(['ทะ','เล'])});await store.saveAnalyses('old',{'เหล็ก':noun(['เหล็ก']),'แมว':noun(['แมว']),'ปลา':noun(['ปลา'])});
 const service=new RoomService(store,{configured:false,model:'unused',analyze:async()=>{throw new Error('must not call model');}},()=>now);
 const tokens=Array.from({length:8},()=>crypto.randomUUID()+crypto.randomUUID());let code;
 const cmd=(i,action,extra={},id=crypto.randomUUID())=>service.command({code,token:tokens[i],action,commandId:id,...extra});
 const room=await cmd(0,'create',{mode,name:'คน0',names:Array.from({length:n},(_,i)=>'คน'+i),seconds:30,setsPerRound:3});code=room.code;
 if(mode==='online')for(let i=1;i<n;i++)await cmd(i,'join',{name:'คน'+i});
 return {db,store,service,cmd,code,tokens,time:x=>now=x,row:()=>store.read(code),start:()=>cmd(0,'start')};
}

test('guest leave removes the name, preserves host and dictionary, revokes session and is retry-safe',async()=>{
 const f=await fixture(),initial=await f.cmd(0,'read');assert.deepEqual(await f.cmd(1,'leave'),{left:true});const r=await f.cmd(0,'read');assert.deepEqual(r.players.map(p=>p.name),['คน0','คน2']);assert.equal(r.hostId,initial.hostId);assert.equal(r.departedPlayers[0].name,'คน1');assert.equal('tokenHash' in r.departedPlayers[0],false);
 await assert.rejects(()=>f.cmd(1,'read'),RoomUnavailableError);await assert.rejects(()=>f.cmd(1,'start'),/เจ้าของห้อง/);assert.deepEqual(await f.cmd(1,'leave'),{left:true});assert.equal(f.db.prepare('SELECT count(*) AS n FROM word_dictionary').get().n,3);f.db.close();
});

test('host transfers to earliest remaining member whose existing token gains host rights',async()=>{
 const f=await fixture();await f.cmd(0,'leave');let r=await f.cmd(1,'read');assert.equal(r.hostId,r.youId);assert.equal(r.isHost,true);assert.deepEqual(r.players.map(p=>p.name),['คน1','คน2']);r=await f.cmd(1,'start');assert.equal(r.status,'playing');assert.equal(r.setsPerRound,3);await assert.rejects(()=>f.cmd(0,'start'),/เจ้าของห้อง/);f.db.close();
});

test('concurrent departures retain a valid host; last member departure deletes only the room',async()=>{
 const f=await fixture();await Promise.all([f.cmd(0,'leave'),f.cmd(1,'leave')]);const r=await f.cmd(2,'read');assert.equal(r.players.length,1);assert.equal(r.isHost,true);await f.cmd(2,'leave');assert.equal(await f.row(),null);assert.deepEqual(await f.cmd(2,'leave'),{left:true});assert.equal(f.db.prepare('SELECT count(*) AS n FROM word_dictionary').get().n,3);f.db.close();
});

test('a nonmember cannot delete names or transfer host ownership',async()=>{
 const f=await fixture();const before=await f.row();await f.cmd(7,'leave');const after=await f.row();assert.deepEqual(after,before);f.db.close();
});

test('last-member delete uses a revision guard so a concurrent successful join survives',async()=>{
 const f=await fixture(1),remove=f.store.remove;let injected=false;f.store.remove=async(code,revision)=>{if(!injected){injected=true;await f.cmd(1,'join',{name:'คน1'});}return remove(code,revision);};await f.cmd(0,'leave');const r=await f.cmd(1,'read');assert.equal(r.players.length,1);assert.equal(r.players[0].name,'คน1');assert.equal(r.isHost,true);f.db.close();
});

test('active host exit removes and eliminates once, then guests advance the correct countdown starter',async()=>{
 const f=await fixture(4);await f.start();f.time(2000);await f.cmd(0,'leave');let r=await f.cmd(1,'read');assert.equal(r.isHost,true);assert.equal(r.result.reason,'leave');assert.equal(r.players.length,3);assert.equal(r.continuation.starterId,r.youId);assert.deepEqual(r.players.map(p=>p.score),[1,1,1]);assert.equal(playerName(r,r.result.loserId),'คน0');
 f.time(7000);r=await f.cmd(2,'read');assert.equal(r.status,'playing');assert.equal(r.players[r.turnIndex].name,'คน1');assert.equal(r.turnIndex,0);assert.equal(r.deadline,37000);assert.equal(r.competition.activeIds.length,3);f.db.close();
});

test('eliminated spectator host exit preserves current player, deadline and in-flight submission',async()=>{
 const f=await fixture(4);let r=await f.start();r=await f.cmd(0,'pass',{turn:r.turnNumber});f.time(6000);r=await f.cmd(1,'read');const deadline=r.deadline,turn=r.turnNumber;await f.cmd(0,'leave');r=await f.cmd(1,'read');assert.equal(r.isHost,true);assert.equal(r.status,'playing');assert.equal(r.turnNumber,turn);assert.equal(r.deadline,deadline);assert.equal(r.players[r.turnIndex].name,'คน1');r=await f.cmd(1,'submit',{text:'เหล็ก',turn});assert.equal(r.chain[0].text,'เหล็ก');f.db.close();
});

test('leaving with two active players ends the set and keeps the departed winner name in later summaries',async()=>{
 const f=await fixture(3);let r=await f.start();r=await f.cmd(0,'pass',{turn:r.turnNumber});f.time(6000);r=await f.cmd(1,'read');await f.cmd(1,'leave');r=await f.cmd(2,'read');assert.equal(r.competition.setComplete,true);assert.equal(r.continuation,null);assert.equal(r.competition.winnerId,r.youId);assert.equal(r.players.find(p=>p.id===r.youId).score,3);const winner=r.youId;await f.cmd(2,'leave');r=await f.cmd(0,'read');assert.equal(playerName(r,winner),'คน2');assert.equal(r.competition.completedSets.length,1);assert.equal(r.players.length,1);f.db.close();
});

test('departing countdown starter is replaced; further exits ending the set cancel the countdown',async()=>{
 const f=await fixture(4);let r=await f.start();await f.cmd(0,'pass',{turn:r.turnNumber});await f.cmd(1,'leave');r=await f.cmd(2,'read');assert.equal(r.continuation.starterId,r.youId);await f.cmd(2,'leave');r=await f.cmd(3,'read');assert.equal(r.continuation,null);assert.equal(r.competition.setComplete,true);assert.equal(r.competition.winnerId,r.youId);assert.equal(r.competition.completedSets.length,1);f.db.close();
});

test('departure during a slow submission invalidates the old word and transfers the room safely',async()=>{
 const f=await fixture(3);const r=await f.start(),gate=deferred(),base=f.store.analyses;f.store.analyses=async(...args)=>{await gate.promise;return base(...args);};const request=f.cmd(0,'submit',{text:'เหล็ก',turn:r.turnNumber});const rejected=assert.rejects(request,/ไม่ได้อยู่|หมดอายุ/);await until(async()=>Boolean((await f.row()).game.submission));await f.cmd(0,'leave');gate.resolve();await rejected;const after=await f.cmd(1,'read');assert.equal(after.isHost,true);assert.equal(after.submission,null);assert.equal(after.wordCount,0);assert.equal(after.players.length,2);f.db.close();
});

test('active departure cancels debate without granting a challenge-win bonus',async()=>{
 const f=await fixture(4);let r=await f.start();r=await f.cmd(0,'submit',{text:'ปลา',turn:r.turnNumber});await f.cmd(2,'challenge',{wordId:r.chain[0].id,turn:r.turnNumber,reason:'ขอเหตุผล'});await f.cmd(2,'leave');r=await f.cmd(0,'read');assert.equal(r.challenge.phase,'cancelled');assert.equal(r.result.reason,'leave');assert.deepEqual(r.players.map(p=>p.score),[1,1,1]);assert.equal(r.continuation.word,'ปลา');f.db.close();
});

test('surviving words still reject exact duplicates with the departed original author evidence',async()=>{
 const f=await fixture(4);let r=await f.start();r=await f.cmd(0,'submit',{text:'เหล็ก',turn:r.turnNumber});await f.cmd(0,'leave');f.time(6000);r=await f.cmd(1,'read');r=await f.cmd(1,'submit',{text:'แมว',turn:r.turnNumber});r=await f.cmd(2,'submit',{text:'เหล็ก',turn:r.turnNumber});assert.equal(r.events[0].duplicateKind,'word');assert.equal(r.events[0].previousPlayerName,'คน0');assert.equal(r.events[0].previousTurn,1);f.db.close();
});

test('shared-device controller departure closes the entire local room',async()=>{
 const f=await fixture(3,'shared');await f.start();await f.cmd(0,'leave');assert.equal(await f.row(),null);assert.equal(f.db.prepare('SELECT count(*) AS n FROM word_dictionary').get().n,3);f.db.close();
});

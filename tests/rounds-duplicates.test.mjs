import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createSqlStore} from '../lib/sql-store.ts';
import {RoomService} from '../lib/rooms.ts';
import {createGame,startRound,submitWord,applyAnalyses,finishRound,advanceContinuation,rollback,publicGame,needsAnalysis} from '../lib/game.ts';
import {verificationLabel} from '../lib/verification-label.ts';
const noun=syllables=>({syllables,category:'noun',nounType:'common',reason:'คำนาม',suggestions:[],titleContext:''});
const seed={text:'ทะเล',syllables:['ทะ','เล']};
const game=(sets=5,n=4)=>{const g=createGame('ABCDEF','shared',Array.from({length:n},(_,i)=>'คน'+i),'hash',0,1000,sets);startRound(g,seed,1000);return g;};
function send(g,text,syllables,at=1100){const w=submitWord(g,g.hostId,text,at,g.turnNumber);if(syllables)applyAnalyses(g,g.roundId,[{id:w.id,analysis:noun(syllables)}],at);return w;}

test('exact whole word after intervening turns is immediate without syllables and records original speaker and turn',()=>{
 const g=game();const first=send(g,'เหล็ก');send(g,'แมว');const repeat=send(g,' เหล็ก ');
 assert.equal(g.result.reason,'duplicate');assert.equal(g.result.loserId,g.players[2].id);assert.equal(g.continuation.at,6100);
 const e=g.events.at(-1);assert.equal(e.duplicateKind,'word');assert.equal(e.previousId,first.id);assert.equal(e.previousPlayerId,g.players[0].id);assert.equal(e.previousPlayerName,'คน0');assert.equal(e.previousTurn,1);assert.equal(e.turn,3);assert.equal(e.previous,'เหล็ก');
 assert.equal(repeat.verification.duplicateKind,'word');assert.equal(needsAnalysis(repeat),false);assert.equal(verificationLabel(repeat),'พบคำเต็มซ้ำ');
 const view=publicGame(g,0,g.hostId,1100);assert.deepEqual(view.reviewWords,[]);assert.equal(view.events[0].previousPlayerName,'คน0');assert.equal('removed' in view.events[0],false);
});

test('exact check also works in manual checking mode, and includes the opening word at turn zero',()=>{
 const g=game();g.manual=true;send(g,'แมว');send(g,'ทะเล');assert.equal(g.events[0].duplicateKind,'word');assert.equal(g.events[0].previousTurn,0);assert.equal(g.events[0].previousPlayerName,'คำตั้งต้น');
});

test('different cached segmentation cannot bypass the full-word check',()=>{
 const g=game();send(g,'โรงเรียน',['โรง','เรียน']);send(g,'แมว',['แมว']);const w=send(g,'โรงเรียน',['โรงเรียน']);assert.equal(g.result.reason,'duplicate');assert.equal(w.verification.duplicateKind,'word');assert.equal(g.events[0].previousTurn,1);
 const points=structuredClone(g.competition.totals);applyAnalyses(g,g.roundId,[{id:w.id,analysis:noun(['โรง','เรียน'])}],1200);assert.deepEqual(g.competition.totals,points);assert.equal(w.verification.duplicateKind,'word');
});

test('only adjacent syllables collide and written homophones remain distinct',()=>{
 const g=game();send(g,'ปลา',['ปลา']);send(g,'แมว',['แมว']);const fine=send(g,'ปลาดาว',['ปลา','ดาว']);assert.equal(fine.verification.status,'valid');
 send(g,'ปลาทู',['ปลา','ทู']);assert.equal(g.events[0].duplicateKind,'syllable');assert.deepEqual(g.events[0].syllables,['ปลา']);assert.equal(g.events[0].previous,'ปลาดาว');
 const h=game();send(h,'จันทร์',['จันทร์']);const other=send(h,'จันทน์',['จันทน์']);assert.equal(other.verification.status,'valid');
});

test('reset descendants can be reused while surviving words remain forbidden across an automatic continuation',()=>{
 const g=game(3,5);send(g,'เหล็ก',['เหล็ก']);const bad=send(g,'คำผิด');send(g,'แมว');send(g,'นก');
 rollback(g,bad.id,'human',[],2000);assert.deepEqual(g.events[0].reusable.map(w=>w.text),['แมว','นก']);advanceContinuation(g,7000);
 const cat=send(g,'แมว',['แมว'],7100);assert.equal(cat.verification.status,'valid');assert.equal(cat.playNumber,5);
 send(g,'เหล็ก',undefined,7200);assert.equal(g.events.at(-1).duplicateKind,'word');assert.equal(g.events.at(-1).previousTurn,1);assert.equal(g.competition.activeIds.length,3);
});

for(const count of [3,5])test(`${count} separate sets reset word history and aggregate scores exactly once per completed set`,()=>{
 const g=game(count,2),[a,b]=g.players.map(p=>p.id);
 for(let set=1;set<=count;set++){
  assert.equal(g.competition.set,set);assert.equal(g.competition.round,1);assert.equal(g.chain.length,1);assert.deepEqual(g.archiveWords,[]);assert.deepEqual(g.events,[]);
  const w=send(g,'เหล็ก',['เหล็ก']);assert.equal(w.playNumber,1);assert.equal(w.verification.status,'valid');
  finishRound(g,a,'surrender',2000);const points=structuredClone(g.competition.totals);finishRound(g,a,'surrender',2001);assert.deepEqual(g.competition.totals,points);
  assert.equal(g.competition.completedSets.length,set);assert.equal(g.competition.totals[b],set*3);assert.equal(g.competition.roundPoints[a],set);
  if(set<count)startRound(g,seed,3000);
 }
 assert.equal(g.competition.roundPoints[b],count*3);startRound(g,seed,4000);assert.equal(g.competition.round,2);assert.equal(g.competition.set,1);assert.equal(g.competition.history[0].sets.length,count);assert.equal(g.competition.history[0].points[b],count*3);assert.equal(g.competition.roundPoints[b],1);assert.equal(g.setsPerRound,count);
});

test('legacy rooms default to five sets and unsupported counts are rejected',()=>{
 for(const bad of [0,1,4,6,'3',null])assert.throws(()=>game(bad),/3 หรือ 5/);
 const g=game(5,2);delete g.setsPerRound;for(let i=1;i<=5;i++){finishRound(g,g.players[0].id,'surrender',2000);if(i<5)startRound(g,seed,3000);}startRound(g,seed,4000);assert.equal(g.competition.round,2);assert.equal(g.competition.history[0].sets.length,5);
});

async function fixture(mode,setsPerRound){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../database/schema.sql',import.meta.url),'utf8'));
 const store=createSqlStore(async(q,p)=>db.prepare(q).all(...p),()=>1000);await store.saveAnalyses('old',{'ทะเล':noun(['ทะ','เล']),'เหล็ก':noun(['เหล็ก']),'แมว':noun(['แมว'])});let calls=0;store.randomNoun=async()=>({text:'ทะเล',analysis:noun(['ทะ','เล'])});
 const service=new RoomService(store,{configured:false,model:'unused',analyze:async()=>{calls++;throw new Error('must not call model');}},()=>1000);
 const tokens=Array.from({length:3},()=>crypto.randomUUID()+crypto.randomUUID());let code;
 const command=(i,action,extra={})=>service.command({code,token:tokens[i],action,commandId:crypto.randomUUID(),...extra});
 let state=await command(0,'create',{mode,names:['คน0','คน1','คน2'],name:'คน0',setsPerRound,seconds:0});code=state.code;
 if(mode==='online')for(let i=1;i<3;i++)await command(i,'join',{name:'คน'+i,setsPerRound:setsPerRound===3?5:3});
 return {db,service,command,code,tokens,calls:()=>calls};
}
for(const mode of ['shared','online'])test(`${mode}: selected set count survives SQL and guest joins; dictionary reuse detects the non-adjacent duplicate with zero model calls`,async()=>{
 const f=await fixture(mode,3);let state=await f.command(0,'start');assert.equal(state.setsPerRound,3);
 for(const [i,text] of ['เหล็ก','แมว','เหล็ก'].entries())state=await f.command(mode==='shared'?0:i,'submit',{text,turn:state.turnNumber});
 assert.equal(state.result.reason,'duplicate');assert.equal(state.events[0].previousPlayerName,'คน0');assert.equal(state.events[0].previousTurn,1);assert.equal(state.events[0].turn,3);
 await f.service.check(f.code,f.tokens[0]);state=await f.command(0,'read');assert.equal(state.setsPerRound,3);assert.equal(state.events.length,1);assert.equal(f.calls(),0);f.db.close();
});

test('create API rejects unsupported set settings instead of silently changing them',async()=>{
 const f=await fixture('shared',5);await assert.rejects(()=>f.command(0,'create',{mode:'shared',names:['หนึ่ง','สอง'],setsPerRound:4}),/3 หรือ 5/);f.db.close();
});

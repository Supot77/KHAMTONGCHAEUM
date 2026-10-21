import assert from 'node:assert/strict';
if(!process.argv.includes('--allow-test-rooms'))throw new Error('Use --allow-test-rooms to create an explicit QA room. No model calls are made.');
const base=process.env.GAME_TEST_URL||'http://127.0.0.1:5174';
const tokens=Array.from({length:4},()=>crypto.randomUUID()+crypto.randomUUID());let code;
async function cmd(i,action,data={},expected=200){const response=await fetch(base+'/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,token:tokens[i],action,commandId:crypto.randomUUID(),...data})});const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;}
let r=await cmd(0,'create',{mode:'online',name:'QA อัตโนมัติ 0',seconds:30});code=r.code;
for(let i=1;i<4;i++)await cmd(i,'join',{name:`QA อัตโนมัติ ${i}`});let countdowns=0;
for(let set=1;set<=5;set++){
 r=await cmd(0,'start');assert.equal(r.competition.set,set);assert.equal(r.chain[0].analysisSource,'database');assert.equal(r.chain[0].analysis.category,'noun');const anchor=r.chain[0].id;
 for(let loser=0;loser<3;loser++){
  const phase=r.roundId;r=await cmd(loser,'pass',{turn:r.turnNumber});
  if(loser<2){
   const due=r.continuation.at;assert.equal(r.continuation.starterId,r.players[loser+1].id);assert.equal(due-r.result.at,5000);assert.equal(r.deadline,null);assert.deepEqual(r.reviewWords,[]);
   await cmd(0,'lobby',{},400);
   const end=Date.now()+12000;
   do{await new Promise(resolve=>setTimeout(resolve,300));r=await cmd(3,'read');}while(r.continuation&&Date.now()<end);
   assert.equal(r.status,'playing');assert.notEqual(r.roundId,phase);assert.equal(r.players[r.turnIndex].id,r.players[loser+1].id);assert.equal(r.chain.at(-1).id,anchor);assert.equal(r.deadline,due+30000);countdowns++;
   const again=await cmd(2,'read');assert.equal(again.roundId,r.roundId);assert.equal(again.turnNumber,r.turnNumber);
  }else {assert.equal(r.continuation,null);assert.equal(r.competition.setComplete,true);assert.equal(r.competition.winnerId,r.players[3].id);}
 }
 console.log(JSON.stringify({set,winner:r.players[3].name,autoCountdowns:countdowns}));
 if(set<5)await cmd(0,'lobby');
}
assert.deepEqual(r.players.map(p=>p.score),[0,5,5,15]);
console.log(JSON.stringify({sets:5,automaticContinuations:countdowns,countdownMs:5000,guestCanResume:'PASS',sameAnchor:'PASS',fullTurnBudget:'PASS',databaseOpenings:'PASS',modelCalls:0,scores:r.players.map(p=>p.score),result:'PASS'}));

import assert from 'node:assert/strict';
if(!process.argv.includes('--allow-test-rooms'))throw new Error('Pass --allow-test-rooms to create isolated QA rooms. No model calls are requested.');
const base=process.env.GAME_TEST_URL||'http://127.0.0.1:5174';
for(const [mode,sets] of [['shared',3],['online',5]]){
 let code;const tokens=Array.from({length:2},()=>crypto.randomUUID()+crypto.randomUUID());
 async function cmd(i,action,data={}){const res=await fetch(base+'/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,code,token:tokens[i],commandId:crypto.randomUUID(),...data}),signal:AbortSignal.timeout(20000)});const r=await res.json();assert.equal(res.status,200,JSON.stringify(r));return r;}
 let r=await cmd(0,'create',{mode,names:['QA เหล็ก เอ','QA เหล็ก บี'],name:'QA เหล็ก เอ',seconds:0,setsPerRound:sets});code=r.code;
 if(mode==='online')await cmd(1,'join',{name:'QA เหล็ก บี',setsPerRound:3});
 for(let set=1;set<=sets;set++){
  r=await cmd(0,'start',{manual:true,text:'ทะเล'});assert.equal(r.setsPerRound,sets);assert.equal(r.competition.round,1);assert.equal(r.competition.set,set);assert.equal(r.wordCount,0);
  for(const [i,text] of ['เหล็ก','แมว','เหล็ก'].entries())r=await cmd(mode==='shared'?0:i%2,'submit',{text,turn:r.turnNumber});
  const e=r.events[0];assert.equal(e.duplicateKind,'word');assert.equal(e.previous,'เหล็ก');assert.equal(e.previousPlayerName,'QA เหล็ก เอ');assert.equal(e.previousTurn,1);assert.equal(e.turn,3);assert.equal(r.competition.setComplete,true);assert.equal(r.events.length,1);assert.deepEqual(r.players.map(p=>p.score),[set,set*3]);
  const read=await cmd(mode==='shared'?0:1,'read');assert.equal(read.events[0].previousId,e.previousId);assert.equal(read.setsPerRound,sets);
  if(set<sets)await cmd(0,'lobby');
 }
 assert.equal(r.competition.completedSets.length,sets);assert.deepEqual(r.players.map(p=>p.roundScore),[sets,sets*3]);
 await cmd(0,'lobby');r=await cmd(0,'start',{manual:true,text:'ทะเล'});assert.equal(r.competition.round,2);assert.equal(r.competition.set,1);assert.equal(r.competition.history[0].sets.length,sets);assert.equal(r.events.length,0);
 console.log(JSON.stringify({mode,sets,exactRepeat:'เหล็ก → แมว → เหล็ก',immediateDetection:'PASS',evidence:'speaker + turn 1',freshWordsEachSet:'PASS',roundScores:[sets,sets*3],modelRequests:0,result:'PASS'}));
}

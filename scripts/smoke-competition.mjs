import assert from 'node:assert/strict';
const base=process.env.GAME_TEST_URL||'http://127.0.0.1:5173';
const status=await (await fetch(base+'/api/status')).json();if(process.argv.includes('--require-neon'))assert.equal(status.storage,'neon');
const tokens=Array.from({length:4},()=>crypto.randomUUID()+crypto.randomUUID());let code,challengeId;
async function cmd(index,action,data={},expected=200){const response=await fetch(base+'/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,code,challengeId,token:tokens[index],commandId:crypto.randomUUID(),...data})});const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));challengeId=value.challenge?.id??challengeId;return value;}
let r=await cmd(0,'create',{mode:'online',name:'QA เซ็ต โฮสต์',seconds:30});code=r.code;
for(let i=1;i<4;i++)await cmd(i,'join',{name:`QA เซ็ต คน ${i}`});
r=await cmd(0,'start',{manual:true,text:'ทะเล'});const ids=r.players.map(p=>p.id);
r=await cmd(0,'submit',{text:'ปลา',turn:r.turnNumber});const wordId=r.chain[0].id;
await cmd(1,'challenge',{wordId,turn:r.turnNumber,reason:'ลองตรวจความเชื่อมโยง'},400);
r=await cmd(2,'challenge',{wordId,turn:r.turnNumber,reason:'ทดสอบระบบชาเลนจ์'});assert.equal(r.deadline,null);
await cmd(1,'debate',{actorId:ids[0],text:'ปลาว่ายในทะเล',finish:true},400);
await cmd(0,'debate',{text:'ปลาว่ายในทะเล',finish:true});r=await cmd(2,'debate',{text:'ส่งให้ผู้เล่นลงคะแนน',finish:true});
await cmd(2,'vote',{connected:false},400);r=await cmd(1,'vote',{connected:false});assert.equal(r.challenge.tally,null);assert.equal('votes' in r.challenge,false);
const voteCommand={action:'vote',code,challengeId,token:tokens[3],commandId:crypto.randomUUID(),connected:false};
const results=await Promise.all([fetch(base+'/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(voteCommand)}),fetch(base+'/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(voteCommand)})]);
for(const response of results)assert.equal(response.status,200);r=await cmd(0,'read');
assert.equal(r.status,'ended');assert.equal(r.result.loserId,ids[0]);assert.equal(r.players[2].score,3);assert.equal(r.competition.activeIds.length,3);
const analysis={syllables:['ปลา'],category:'noun',nounType:'common',reason:'QA ตรวจคำนามและรูปเขียน ปลา',suggestions:[],titleContext:''};
const proposal=await cmd(1,'review',{wordId,analysis});assert.equal(proposal.reviews[wordId].approvedId,undefined);
await cmd(1,'confirmReview',{wordId,proposalId:proposal.reviews[wordId].id},400);
r=await cmd(0,'confirmReview',{wordId,proposalId:proposal.reviews[wordId].id});assert.equal(r.reviews[wordId].approvedId,proposal.reviews[wordId].id);
// Complete all five sets using explicit host judgments in this named QA room.
while(!(r.competition.set===5&&r.competition.setComplete)){
 await cmd(0,'lobby');r=await cmd(0,'start',{manual:true,text:'ทะเล'});
 assert.equal(JSON.stringify(r).includes('QA ตรวจคำนาม'),false,'active play must hide archived analysis');
 const currentIndex=ids.indexOf(r.players[r.turnIndex].id);r=await cmd(currentIndex,'submit',{text:'แมว',turn:r.turnNumber});
 r=await cmd(0,'reject',{wordId:r.chain[0].id});
}
assert.equal(r.competition.completedSets.length,5);const scores=r.players.map(p=>({name:p.name,score:p.score}));
// Read through another authenticated session to prove persistence, not just a returned payload.
const saved=await cmd(3,'read');assert.deepEqual(saved.players.map(p=>p.score),r.players.map(p=>p.score));
console.log(JSON.stringify({backend:status.storage,sets:r.competition.completedSets.length,challengeAuthorization:'PASS',votePrivacy:'PASS',concurrentVoteIdempotency:'PASS',humanConfirmation:'PASS',elimination:'PASS',scores,savedAcrossSessions:'PASS',result:'PASS'}));

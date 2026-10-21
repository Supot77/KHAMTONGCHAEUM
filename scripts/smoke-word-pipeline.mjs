import assert from 'node:assert/strict';
if(!process.argv.includes('--allow-live'))throw new Error('Use --allow-live: this creates a QA room, calls Gemini for five opening words and one explicit review. Run on a Neon QA branch.');
const base=process.env.GAME_TEST_URL||'http://127.0.0.1:5174';
const token=crypto.randomUUID()+crypto.randomUUID();let code;
async function post(path,data){const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,code,...data}),signal:AbortSignal.timeout(60000)});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;}
const cmd=(action,data={})=>post('/api/room',{action,commandId:crypto.randomUUID(),...data});
const check=()=>post('/api/check',{});
const status=await(await fetch(base+'/api/status')).json();assert.equal(status.storage,'neon');
let state=await cmd('create',{mode:'shared',names:['QA อัตโนมัติ เอ','QA อัตโนมัติ บี'],seconds:0});code=state.code;let reviewedWord,proposalId,cacheHits=0;
const sets=[];
// Select from known real vocabulary; server must prove each is a database hit.
for(let set=1;set<=5;set++){
 await cmd('start');const result=await check();state=await cmd('read');assert.equal(state.status,'playing',JSON.stringify(result));assert.equal(state.competition.set,set);
 const seed=state.chain[0].text;
 const [first,duplicate]=[['ปลา','ปลาดาว'],['แมว','แมวน้ำ'],['นก','นกแก้ว']].find(([word])=>word!==seed);
 state=await cmd('submit',{text:first,turn:state.turnNumber});assert.equal(state.chain[0].analysisSource,'database',`${first} must already be in QA dictionary`);assert.equal(state.chain[0].verification.status,'valid');cacheHits++;
 state=await cmd('submit',{text:duplicate,turn:state.turnNumber});
 // An absent compound is analyzed once; existing compounds must finish directly on submit.
 if(state.status!=='ended'){await check();state=await cmd('read');}
 assert.equal(state.result?.reason,'duplicate');assert.equal(state.events[0].word,duplicate);assert.equal(state.competition.setComplete,true);
 const word=state.reviewWords.find(w=>w.text===duplicate);if(word.analysisSource==='database')cacheHits++;
 sets.push({set,seed,word:duplicate,source:word.analysisSource,result:state.result.reason});
 if(set===5)reviewedWord=word;
 else await cmd('lobby');
}
assert.deepEqual(state.players.map(p=>p.score),[15,5]);
// Deliberately propose a single chunk so the real model can agree or revise it explicitly.
const proposal={...reviewedWord.analysis,syllables:[reviewedWord.text],reason:'QA ขอให้ตรวจจำนวนพยางค์ตามการอ่านไทย คำนี้ควรแยกอย่างไร'};
state=await cmd('review',{wordId:reviewedWord.id,analysis:proposal});proposalId=state.reviews[reviewedWord.id].id;
state=await post('/api/review',{wordId:reviewedWord.id,proposalId});const answer=state.reviews[reviewedWord.id];
assert.equal(answer.status,'answered',answer.error);assert.ok(answer.response.reason);assert.ok(answer.response.analysis.syllables.length>1);
assert.equal(answer.approvedId,undefined);const frozen=state.players.map(p=>p.score);
state=await cmd('confirmReview',{wordId:reviewedWord.id,proposalId,useModel:true});assert.equal(state.reviews[reviewedWord.id].status,'approved');assert.deepEqual(state.players.map(p=>p.score),frozen);
const saved=await cmd('read');assert.equal(saved.reviews[reviewedWord.id].approvedId,proposalId);
console.log(JSON.stringify({backend:status.storage,sets,cacheHits,review:{verdict:answer.response.verdict,syllables:answer.response.analysis.syllables,reason:answer.response.reason},explicitHumanConfirmation:'PASS',scoresFrozenDuringReview:'PASS',scores:frozen,result:'PASS'}));

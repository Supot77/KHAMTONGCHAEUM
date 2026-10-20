// Explicit opt-in: this test makes one seed request and one segmentation request.
import assert from 'node:assert/strict';
if(!process.argv.includes('--allow-live'))throw new Error('Use --allow-live to test the configured Gemini API.');
const base=process.env.GAME_TEST_URL||'http://127.0.0.1:5173';
const status=await (await fetch(base+'/api/status')).json();
if(process.argv.includes('--require-neon'))assert.equal(status.storage,'neon','This run must use the actual Neon database.');
console.log(JSON.stringify({backend:status.storage,model:status.model}));
const token=crypto.randomUUID()+crypto.randomUUID();let code;
async function room(action,data={}){const response=await fetch(base+'/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,token,code,commandId:crypto.randomUUID(),...data})});const r=await response.json();if(!response.ok)throw new Error(r.error);return r;}
async function check(){const response=await fetch(base+'/api/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,token})});return response.json();}
let r=await room('create',{mode:'shared',names:['ทดสอบ เอ','ทดสอบ บี','ทดสอบ ซี'],seconds:30});code=r.code;
await room('start');const seedCheck=await check();r=await room('read');
assert.equal(r.status,'playing',JSON.stringify(seedCheck));assert.equal(r.chain[0].syllables.join(''),r.chain[0].text);
const pairs=[['ปลา','ปลาดาว'],['นก','นกแก้ว'],['แมว','แมวน้ำ']];
const [first,duplicate]=pairs.find(([word])=>!r.chain[0].syllables.includes(word));
for(const word of [first,duplicate,'ท้องฟ้า','เมฆ'])r=await room('submit',{text:word,turn:r.turnNumber});
assert.equal(r.chain.length,5);assert.equal(r.pending,4);assert.ok(r.deadline>r.serverNow);
console.log(JSON.stringify({phase:'before check',words:r.chain.map(w=>w.text),pending:r.pending,turn:r.players[r.turnIndex].name}));
const result=await check();r=await room('read');
if(result.error)throw new Error(result.error);
assert.equal(r.chain.length,2);assert.equal(r.events.at(-1).word,duplicate);assert.equal(r.events.at(-1).previous,first);
assert.deepEqual(r.events.at(-1).reusable.map(w=>w.text),['ท้องฟ้า','เมฆ']);assert.equal(r.turnIndex,1);
const replay=await room('submit',{text:'ท้องฟ้า',turn:r.turnNumber});assert.equal(replay.chain.at(-1).text,'ท้องฟ้า');
await room('end');
console.log(JSON.stringify({phase:'after check',seed:r.chain[0].text,chain:r.chain.map(w=>w.text),culprit:r.events.at(-1).playerName,repeated:r.events.at(-1).syllables,reusable:r.events.at(-1).reusable.map(w=>w.text),replay:'accepted',result:'PASS'}));

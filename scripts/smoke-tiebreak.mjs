import assert from 'node:assert/strict';
if(!process.argv.includes('--allow-live'))throw new Error('Use --allow-live for the model tie-break test.');
const base=process.env.GAME_TEST_URL||'http://127.0.0.1:5173',tokens=Array.from({length:4},()=>crypto.randomUUID()+crypto.randomUUID());let code,challengeId;
async function cmd(i,action,data={}){const response=await fetch(base+'/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,code,challengeId,token:tokens[i],commandId:crypto.randomUUID(),...data})});const r=await response.json();assert.equal(response.status,200,JSON.stringify(r));challengeId=r.challenge?.id??challengeId;return r;}
let r=await cmd(0,'create',{mode:'online',name:'QA กรรมการ โฮสต์',seconds:30});code=r.code;for(let i=1;i<4;i++)await cmd(i,'join',{name:`QA กรรมการ ${i}`});
r=await cmd(0,'start',{manual:true,text:'ทะเล'});r=await cmd(0,'submit',{text:'ปลา',turn:r.turnNumber});
r=await cmd(2,'challenge',{wordId:r.chain[0].id,turn:r.turnNumber,reason:'ขอให้ชี้แจงว่าปลากับทะเลเชื่อมอย่างไร'});
await cmd(0,'debate',{text:'ปลาหลายชนิดอาศัยอยู่ในทะเล จึงเชื่อมกันด้วยที่อยู่อาศัย',finish:true});await cmd(2,'debate',{text:'ปลาบางชนิดอยู่ในน้ำจืด จึงขอให้เพื่อนช่วยตัดสิน',finish:true});
await cmd(1,'vote',{connected:true});r=await cmd(3,'vote',{connected:false});assert.equal(r.challenge.phase,'judging');
const response=await fetch(base+'/api/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,token:tokens[0]})});const check=await response.json();if(check.error)throw new Error(check.error);
r=await cmd(0,'read');assert.equal(r.challenge.result.by,'model');assert.equal(r.challenge.result.connected,true);assert.equal(r.status,'ended');
console.log(JSON.stringify({phase:'tied vote',verdict:r.challenge.result,bonus:2,result:'PASS'}));

import { finishRound } from './game.ts';
import type { Game } from './game.ts';
import { activeIds,award } from './competition.ts';

export type Challenge={
  id:string;wordId:string;ownerId:string;challengerId:string;previous:string;word:string;
  phase:'owner'|'challenger'|'vote'|'judging'|'resolved'|'cancelled';deadline:number|null;remainingMs:number|null;
  opening:string;ownerArgument:string;challengerArgument:string;voterIds:string[];votes:Record<string,boolean>;
  result?:{connected:boolean;winnerId:string;loserId:string;by:'vote'|'model';reason:string};
};
export function argumentText(input:unknown,required=false){
  if(typeof input!=='string'||input.length>1000||/[\u0000-\u001f\u007f]/.test(input))throw new Error('คำอธิบายต้องไม่เกิน 1,000 ตัวอักษรและอยู่ในบรรทัดเดียว');
  const text=input.trim();if(required&&!text)throw new Error('อธิบายก่อนว่าคำไม่เชื่อมกันอย่างไร');return text;
}
export function openChallenge(game:Game,actorId:string,wordId:string,turn:number,reason:unknown,now:number){
  if(game.status!=='playing'||game.turnNumber!==turn)throw new Error('ตาเปลี่ยนแล้ว กรุณาตรวจคำล่าสุด');
  if(game.challenge&&!['resolved','cancelled'].includes(game.challenge.phase))throw new Error('มีชาเลนจ์ที่ยังไม่จบ');
  const active=activeIds(game),word=game.chain.at(-1),previous=game.chain.at(-2);
  if(active.length<3)throw new Error('ชาเลนจ์ต้องมีผู้เล่นที่ยังอยู่ในเซ็ตอย่างน้อย 3 คน');
  if(!active.includes(actorId)||actorId===game.players[game.turnIndex].id||actorId===word?.playerId)throw new Error('คนที่เล่นตาปัจจุบัน เจ้าของคำ และคนที่ตกรอบแล้ว ชาเลนจ์ไม่ได้');
  if(!word||!previous||word.id!==wordId||!word.playerId||!active.includes(word.playerId))throw new Error('ชาเลนจ์ได้เฉพาะคำล่าสุดของผู้เล่นที่ยังอยู่');
  game.challenge={id:crypto.randomUUID(),wordId,ownerId:word.playerId,challengerId:actorId,previous:previous.text,word:word.text,phase:'owner',deadline:now+60000,remainingMs:game.deadline===null?null:Math.max(0,game.deadline-now),opening:argumentText(reason,true),ownerArgument:'',challengerArgument:'',voterIds:active.filter(id=>id!==actorId&&id!==word.playerId),votes:{}};
  game.deadline=null;game.turnNumber++;
}
export function resolveChallenge(game:Game,connected:boolean,by:'vote'|'model',reason:string,now:number){
  const c=game.challenge;if(!c||game.status!=='playing'||!['vote','judging'].includes(c.phase))return;
  const winnerId=connected?c.ownerId:c.challengerId,loserId=connected?c.challengerId:c.ownerId;
  c.phase='resolved';c.deadline=null;c.result={connected,winnerId,loserId,by,reason};
  award(game,[winnerId],2);finishRound(game,loserId,'challenge',now);
}
function finishVote(game:Game,now:number){
  const c=game.challenge!;const votes=Object.values(c.votes),yes=votes.filter(Boolean).length,no=votes.length-yes;
  if(yes===no){c.phase='judging';c.deadline=null;game.nextCheckAt=0;game.aiError=null;}
  else resolveChallenge(game,yes>no,'vote',`เชื่อม ${yes} เสียง · ไม่เชื่อม ${no} เสียง`,now);
}
export function advanceChallenge(game:Game,now:number):boolean{
  const c=game.challenge;if(!c||game.status!=='playing')return false;let changed=false;
  while(c.deadline!==null&&now>=c.deadline){
    changed=true;
    if(c.phase==='owner'){c.phase='challenger';c.deadline+=60000;}
    else if(c.phase==='challenger'){c.phase='vote';c.deadline+=30000;}
    else if(c.phase==='vote'){finishVote(game,now);break;}else break;
  }
  return changed;
}
export function debate(game:Game,actorId:string,text:unknown,finish:boolean,now:number){
  const c=game.challenge;if(!c||game.status!=='playing')throw new Error('ไม่มีชาเลนจ์ที่กำลังดีเบต');
  const owner=c.phase==='owner';if(!['owner','challenger'].includes(c.phase)||actorId!==(owner?c.ownerId:c.challengerId))throw new Error('ยังไม่ถึงช่วงพูดของคุณ');
  const argument=argumentText(text);if(owner)c.ownerArgument=argument;else c.challengerArgument=argument;
  if(finish){c.phase=owner?'challenger':'vote';c.deadline=now+(owner?60000:30000);}
}
export function castVote(game:Game,actorId:string,connected:unknown,now:number){
  const c=game.challenge;if(!c||game.status!=='playing'||c.phase!=='vote')throw new Error('ยังไม่เปิดโหวตหรือปิดโหวตแล้ว');
  if(!c.voterIds.includes(actorId)||typeof connected!=='boolean')throw new Error('เฉพาะผู้เล่นที่เหลือซึ่งไม่ได้ดีเบตเท่านั้นที่โหวตได้');
  c.votes[actorId]=connected;
  if(c.voterIds.every(id=>Object.hasOwn(c.votes,id)))finishVote(game,now);
}

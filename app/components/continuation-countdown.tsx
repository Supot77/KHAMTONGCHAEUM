'use client';
import {playerName} from '@/lib/player-name';
import type {PublicGame} from '@/lib/game';
export function ContinuationCountdown({game,now}:{game:PublicGame;now:number}){
  const next=game.continuation;if(!next)return null;
  const event=game.events.at(-1);
  const duplicate=game.result?.reason==='duplicate'&&event?.playerId===next.loserId&&event.at===game.result.at?event:null;
  const seconds=Math.max(0,Math.ceil((next.at-now)/1000));
  const name=(id:string)=>playerName(game,id);
  return <div className="continuation-backdrop"><section className="continuation-card" role="status" aria-live="polite" aria-atomic="true">
    <p className="continuation-out">{name(next.loserId)} ตกรอบจากเซ็ตนี้</p>
    {duplicate&&<p>“{duplicate.word}” {duplicate.duplicateKind==='word'?'ใช้คำเต็มซ้ำกับ':'พยางค์ซ้ำกับ'} “{duplicate.previous}”<br/>{duplicate.previousPlayerName??'ผู้เล่น'}{duplicate.previousTurn===0?' (คำตั้งต้น)':duplicate.previousTurn!==undefined?` · ตาที่ ${duplicate.previousTurn}`:''}</p>}
    <h2>คนที่เหลือ เตรียมเชื่อมต่อ</h2>
    <div className="continuation-number" aria-label={seconds?`เริ่มใน ${seconds} วินาที`:'กำลังเริ่ม'}>{seconds||'เริ่ม!'}</div>
    <p className="continuation-starter">เริ่มที่ <strong>{name(next.starterId)}</strong></p>
    <p className="continuation-word">ต่อจาก <b>“{next.word}”</b></p>
    <small>เซ็ต {game.competition?.set??1}/{game.setsPerRound??5} · เหลือ {game.players.filter(p=>p.active).length} คน</small>
  </section></div>;
}

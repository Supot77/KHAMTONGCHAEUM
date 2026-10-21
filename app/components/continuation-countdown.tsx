'use client';
import type {PublicGame} from '@/lib/game';
export function ContinuationCountdown({game,now}:{game:PublicGame;now:number}){
  const next=game.continuation;if(!next)return null;
  const seconds=Math.max(0,Math.ceil((next.at-now)/1000));
  const name=(id:string)=>game.players.find(p=>p.id===id)?.name??'ผู้เล่น';
  return <div className="continuation-backdrop"><section className="continuation-card" role="status" aria-live="polite" aria-atomic="true">
    <p className="continuation-out">{name(next.loserId)} ตกรอบจากเซ็ตนี้</p>
    <h2>คนที่เหลือ เตรียมเชื่อมต่อ</h2>
    <div className="continuation-number" aria-label={seconds?`เริ่มใน ${seconds} วินาที`:'กำลังเริ่ม'}>{seconds||'เริ่ม!'}</div>
    <p className="continuation-starter">เริ่มที่ <strong>{name(next.starterId)}</strong></p>
    <p className="continuation-word">ต่อจาก <b>“{next.word}”</b></p>
    <small>เซ็ต {game.competition?.set??1}/5 · เหลือ {game.players.filter(p=>p.active).length} คน</small>
  </section></div>;
}

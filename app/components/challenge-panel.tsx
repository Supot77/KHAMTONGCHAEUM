'use client';
import { useEffect,useState } from 'react';
import { Flag,MessageCircle,Vote,LoaderCircle } from 'lucide-react';
import type { PublicGame } from '@/lib/game';

type Props={game:PublicGame;busy:boolean;now:number;send:(action:string,payload?:Record<string,unknown>)=>Promise<boolean>};
export function ChallengePanel({game,busy,now,send}:Props){
  const challenge=game.challenge,last=game.chain.at(-1),shared=game.mode==='shared'&&game.isHost;
  const eligible=game.players.filter(p=>p.active&&p.id!==last?.playerId&&p.id!==game.players[game.turnIndex]?.id);
  const [actor,setActor]=useState(''),[reason,setReason]=useState(''),[argument,setArgument]=useState(''),[voteActor,setVoteActor]=useState('');
  useEffect(()=>{setArgument('');},[challenge?.id,challenge?.phase]);
  const actorId=shared?(eligible.some(p=>p.id===actor)?actor:eligible[0]?.id):game.youId;
  const name=(id:string)=>game.players.find(p=>p.id===id)?.name??'ผู้เล่น';
  if(challenge){
    const speaker=challenge.phase==='owner'?challenge.ownerId:challenge.challengerId;
    const canSpeak=game.status==='playing'&&['owner','challenger'].includes(challenge.phase)&&(shared||game.youId===speaker);
    const voters=game.players.filter(p=>challenge.voterIds.includes(p.id));
    const voterId=shared?(voters.some(p=>p.id===voteActor)?voteActor:voters.find(p=>!challenge.votedIds.includes(p.id))?.id??voters[0]?.id):game.youId;
    const seconds=challenge.deadline===null?null:Math.max(0,Math.ceil((challenge.deadline-now)/1000));
    return <section className="challenge-panel" aria-label="ชาเลนจ์คำเชื่อม"><div className="panel-heading"><h2><MessageCircle size={18}/> ชาเลนจ์</h2><strong>{seconds!==null?`${seconds} วินาที`:challenge.phase==='judging'?'รอคำตัดสิน':challenge.phase==='cancelled'?'ยุติแล้ว':'ตัดสินแล้ว'}</strong></div>
      <p className="challenge-pair"><strong>{challenge.previous}</strong><span>→</span><strong>{challenge.word}</strong></p>
      <p><b>{name(challenge.challengerId)}:</b> {challenge.opening}</p>
      {challenge.ownerArgument&&<p><b>{name(challenge.ownerId)}:</b> {challenge.ownerArgument}</p>}
      {challenge.challengerArgument&&<p><b>{name(challenge.challengerId)} โต้แย้ง:</b> {challenge.challengerArgument}</p>}
      {['owner','challenger'].includes(challenge.phase)&&<p className="challenge-phase">ช่วงพูดของ {name(speaker)} · คนละ 60 วินาที</p>}
      {canSpeak&&<form onSubmit={e=>{e.preventDefault();void send('debate',{challengeId:challenge.id,actorId:speaker,text:argument,finish:true});setArgument('');}}><label className="field-label">คำชี้แจงของ {name(speaker)}<textarea key={`${challenge.id}:${challenge.phase}`} value={argument} onChange={e=>setArgument(e.target.value.replace(/[\r\n]/g,' '))} maxLength={1000} placeholder="อธิบายว่าคำสองคำเชื่อมกันหรือไม่ อย่างไร"/></label><div className="challenge-actions"><button className="button subtle" type="button" disabled={busy} onClick={()=>send('debate',{challengeId:challenge.id,actorId:speaker,text:argument})}>บันทึกคำชี้แจง</button><button className="button primary" disabled={busy} type="submit">จบช่วงพูด</button></div></form>}
      {challenge.phase==='vote'&&<div><p className="challenge-phase"><Vote size={17}/> ผู้เล่นที่เหลือโหวต · {challenge.votesCast}/{challenge.voterIds.length} คน</p>{shared&&<label className="field-label">ผู้โหวต<select value={voterId} onChange={e=>setVoteActor(e.target.value)}>{voters.map(p=><option key={p.id} value={p.id}>{p.name}{challenge.votedIds.includes(p.id)?' · โหวตแล้ว':''}</option>)}</select></label>}{(shared||challenge.voterIds.includes(game.youId))?<div className="challenge-actions"><button className="button primary" disabled={busy} onClick={()=>send('vote',{challengeId:challenge.id,actorId:voterId,connected:true})}>เชื่อมกัน</button><button className="button subtle" disabled={busy} onClick={()=>send('vote',{challengeId:challenge.id,actorId:voterId,connected:false})}>ไม่เชื่อมกัน</button></div>:<p>เจ้าของคำและผู้ชาเลนจ์ไม่มีสิทธิ์โหวต</p>}<small>ผลโหวตจะเปิดเมื่อตัดสิน · เสมอหรือไม่มีเสียงให้โมเดลช่วยตัดสิน</small></div>}
      {challenge.phase==='judging'&&<p className="challenge-phase"><LoaderCircle className="spin" size={17}/> เสียงเท่ากันหรือไม่มีเสียง โมเดลกำลังช่วยตัดสิน</p>}
      {challenge.result&&<div className="challenge-result"><strong>{challenge.result.connected?'คำเชื่อมกัน':'คำไม่เชื่อมกัน'} · {name(challenge.result.winnerId)} ได้ 2 แต้ม</strong><p>{challenge.result.reason}</p><small>ตัดสินโดย{challenge.result.by==='model'?'โมเดล (โหวตเสมอ/ไม่มีเสียง)':'เสียงโหวต'}</small></div>}
      {challenge.phase==='cancelled'&&<p>ยุติชาเลนจ์เนื่องจากมีผลแพ้อื่นของช่วงนี้</p>}
    </section>;
  }
  if(game.status!=='playing'||game.players.filter(p=>p.active).length<3||!last?.playerId||!eligible.some(p=>p.id===actorId))return null;
  return <details className="challenge-open"><summary><Flag size={16}/> ชาเลนจ์ความเชื่อมโยงของคำล่าสุด</summary><form onSubmit={e=>{e.preventDefault();void send('challenge',{actorId,wordId:last.id,turn:game.turnNumber,reason});}}>{shared&&<label className="field-label">ผู้ชาเลนจ์<select value={actorId} onChange={e=>setActor(e.target.value)}>{eligible.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}<label className="field-label">คำสองคำไม่เชื่อมกันอย่างไร?<textarea required value={reason} onChange={e=>setReason(e.target.value.replace(/[\r\n]/g,' '))} maxLength={1000}/></label><p>ดีเบตคนละ 60 วินาที โหวต 30 วินาที · ผู้แพ้ตกรอบในเซ็ตนี้ ผู้ชนะได้ 2 แต้ม</p><button className="button subtle" type="submit" disabled={busy||!reason.trim()}>เปิดชาเลนจ์</button></form></details>;
}

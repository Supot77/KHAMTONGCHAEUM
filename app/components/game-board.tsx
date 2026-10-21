'use client';
import { useEffect,useRef,useState } from 'react';
import { ArrowRight,ArrowUpRight,Check,Copy,Flag,Link2,LoaderCircle,MonitorSmartphone,Play,RotateCcw,Send,SkipForward,Trophy,Users,CheckCheck,AlertCircle,Undo2,Clock3 } from 'lucide-react';
import { ChallengePanel } from './challenge-panel';
import { verificationLabel } from '@/lib/verification-label';
import { RoundReview } from './round-review';
import { ContinuationCountdown } from './continuation-countdown';
import type { PublicGame } from '@/lib/game';

type Props={game:PublicGame;busy:boolean;configured:boolean;send:(action:string,payload?:Record<string,unknown>)=>Promise<boolean>;onSetup:()=>void;onLeave:()=>void};
export function GameBoard({game,busy,configured,send,onSetup,onLeave}:Props){
  const [text,setText]=useState(''),[manual,setManual]=useState(false),[seed,setSeed]=useState(''),[copied,setCopied]=useState(false),[now,setNow]=useState(Date.now()),[askEnd,setAskEnd]=useState(false),[noticeDismissed,setNoticeDismissed]=useState('');
  const input=useRef<HTMLInputElement>(null),serverOffset=useRef(0);
  useEffect(()=>{serverOffset.current=game.serverNow-Date.now();},[game.serverNow]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),150);return()=>clearInterval(timer);},[]);
  const current=game.players[game.turnIndex],last=game.chain.at(-1),remaining=game.deadline===null?null:Math.max(0,Math.ceil((game.deadline-now-serverOffset.current)/1000));
  const isTurn=game.mode==='shared'?game.isHost:game.youId===current?.id;
  const debating=Boolean(game.challenge&&!['resolved','cancelled'].includes(game.challenge.phase));
  const canType=game.status==='playing'&&!debating&&isTurn&&(remaining===null||remaining>0);
  const reset=game.events.at(-1),showReset=reset&&noticeDismissed!==reset.id;
  async function submit(e:React.FormEvent){e.preventDefault();if(!canType||!text.trim())return;if(await send('submit',{text,turn:game.turnNumber})){setText('');input.current?.focus();}}
  async function copy(){try{await navigator.clipboard.writeText(game.code);setCopied(true);setTimeout(()=>setCopied(false),2000);}catch{setCopied(false);}}
  const share=game.mode==='online';
  const totalSets=game.setsPerRound??5;
  const roundComplete=Boolean(game.competition?.setComplete&&game.competition.set===totalSets);
  const roundWinners=roundComplete?game.players.filter(p=>p.roundScore===Math.max(...game.players.map(p=>p.roundScore))):[];
  useEffect(()=>{setText('');},[game.roundId]);
  useEffect(()=>{if(game.status==='playing'&&isTurn&&!debating)input.current?.focus();},[game.status,game.turnNumber,isTurn,debating]);
  if(game.status==='lobby'||game.status==='starting')return <main className="lobby-layout">
    <section className="lobby-card">
      <div className="lobby-icon">{share?<Users size={30}/>:<MonitorSmartphone size={30}/>}</div>
      <div className="card-kicker">{share?'ห้องออนไลน์':'เล่นเครื่องเดียวกัน'}</div>
      <h1>{game.status==='starting'?'กำลังสุ่มคำจากฐาน…':'วงพร้อม คนพร้อม?'}</h1>
      <p className="muted">{game.status==='starting'?'คำแรกกำลังมา นาฬิกาจะเริ่มเมื่อเปิดคำแล้ว':share?'ส่งรหัสนี้ให้เพื่อน แล้วมาเริ่มคำแรกด้วยกัน':'เรียงลำดับตามรายชื่อ แล้วผลัดกันพิมพ์ได้เลย'}</p>
      {share&&<button className="room-code-box" onClick={copy} aria-label="คัดลอกรหัสห้อง"><span>รหัสห้อง</span><strong>{game.code}</strong>{copied?<Check size={20}/>:<Copy size={20}/>}</button>}
      <div className="lobby-players">{game.players.map((p,i)=><div key={p.id}><span className={`avatar color-${i%4}`}>{p.name.slice(0,1)}</span><strong>{p.name}</strong>{p.id===game.hostId?<span className="tiny-tag">เจ้าของห้อง</span>:<span className="ready-label"><Check size={13}/> พร้อม</span>}</div>)}</div>
      <div className="lobby-meta"><span><Users size={16}/>{game.players.length}/8 คน</span><span>รอบละ {totalSets} เซ็ต</span><span><Clock3 size={16}/>{game.turnSeconds?`${game.turnSeconds} วินาที/ตา`:'ไม่จับเวลา'}</span></div>
      {game.aiError&&<div className="inline-error" role="status"><AlertCircle size={18}/><span>{game.aiError}</span>{game.isHost&&<button className="text-button" disabled={busy} onClick={()=>send('retry')}>ลองใหม่</button>}</div>}
      {game.isHost&&game.status==='lobby'&&<>
        {!configured&&<div className="provider-notice"><strong>คำแรกสุ่มจากฐานคำนาม</strong><p>คำที่มีข้อมูลแล้วตรวจได้เลย ส่วนคำใหม่ต้องตั้งคีย์ Gemini หรือให้ผู้เล่นรับรอง</p><button className="text-button" onClick={onSetup}>ดูวิธีตั้งค่า <ArrowUpRight size={14}/></button></div>}
        <label className="manual-option"><input type="checkbox" checked={manual} onChange={e=>setManual(e.target.checked)}/><span>ช่วงนี้ให้ผู้เล่นตรวจคำเอง<small>ผู้เล่นตั้งคำแรกและตรวจชนิดคำ; โหวตเสมอยังใช้โมเดล</small></span></label>
        {manual&&<label className="field-label">คำตั้งต้นของเซ็ตนี้<input value={seed} onChange={e=>setSeed(e.target.value)} placeholder="พิมพ์คำนามตั้งต้น" maxLength={200}/></label>}
        <button className="button primary wide" disabled={busy||game.players.length<2||(manual&&!seed.trim())} onClick={()=>send('start',{manual,text:seed})}><Play size={18}/>{game.players.length<2?'รอเพื่อนอีกอย่างน้อย 1 คน':'เริ่มเชื่อมคำ'}</button>
      </>}
      {!game.isHost&&<p className="waiting-label"><LoaderCircle size={17} className="spin"/>รอเจ้าของห้องเริ่มเกม</p>}
      {game.status==='starting'&&<div className="seed-wait"><span className="seed-dot"/><span className="seed-dot"/><span className="seed-dot"/>{game.isHost&&<button className="text-button" disabled={busy} onClick={()=>send('lobby')}>กลับไปห้องรอ</button>}</div>}
      <button className="text-button leave-button" onClick={onLeave}>กลับหน้าแรก</button>
    </section>
    <aside className="lobby-note"><Link2 size={26}/><h2>ต่อความหมาย<br/>อย่าต่อพยางค์ซ้ำ</h2><p>พิมพ์เฉพาะคำนาม ให้เชื่อมกับคำก่อนหน้า เรื่องความหมาย คนในวงเป็นกรรมการ</p><div className="note-example"><span>ทะเล</span><ArrowRight size={17}/><span>ปลา</span><Check size={17}/></div><p className="small">เสียงเหมือนแต่เขียนต่างกันใช้ได้ เช่น จันทร์ กับ จันทน์</p></aside>
  </main>;


  return <main className="play-layout">
    <ContinuationCountdown game={game} now={now+serverOffset.current}/>
    <aside className="players-panel" inert={Boolean(game.continuation)}>
      <div className="panel-heading"><h2>เพื่อนในวง</h2><span className="count-pill">{game.players.length}</span></div>
      <div className="players-list">{game.players.map((p,i)=><div key={p.id} className={`player-row ${game.status==='playing'&&p.id===current.id?'current':''}`}><span className={`avatar color-${i%4}`}>{p.name.slice(0,1)}</span><div><strong>{p.name} {p.id===game.youId&&share&&<small>(คุณ)</small>}</strong><small>{game.status==='playing'&&p.id===current.id?'กำลังเชื่อมคำ':!p.active?'ตกรอบเซ็ตนี้':`เซ็ตนี้ ${p.setScore} แต้ม`}</small></div><span className="player-score">{p.score}<small>แต้มสะสม</small></span></div>)}</div>
      <p className="score-explainer"><span className="pending-dot"/>สามคนสุดท้าย +1 · ผู้ชนะเซ็ต +2 เพิ่ม · ชาเลนจ์ชนะ +2</p>
      <div className="room-mini"><span>{share?'ห้องออนไลน์':'เครื่องเดียวกัน'}</span><button onClick={copy} className="text-button">{game.code}{copied?<Check size={14}/>:<Copy size={14}/>}</button></div>
      <div className="host-controls">{game.isHost&&game.status==='playing'&&(askEnd?<div className="end-confirm"><p>พักช่วงคำนี้เพื่อตรวจทานไหม?</p><button className="button subtle small-button" onClick={()=>setAskEnd(false)}>เล่นต่อ</button><button className="button small-button" disabled={busy} onClick={()=>{void send('end');setAskEnd(false);}}>พักตรวจคำ</button></div>:<button className="text-button" onClick={()=>setAskEnd(true)}><Flag size={15}/> พักตรวจคำ</button>)}<button className="text-button muted" onClick={onLeave}>กลับหน้าแรก</button></div>
    </aside>
    <section className="board-main" inert={Boolean(game.continuation)}>
      <div className="board-topline"><span className="live-chip"><span className="small-dot green"/>{game.status==='ended'?'จบช่วงคำแล้ว':debating?'กำลังชาเลนจ์':'วงกำลังเล่น'}</span><span>{game.manual?'ผู้เล่นตรวจคำเอง':`รอตรวจ ${game.pending} คำ`}</span></div>
      <div className="set-progress"><strong>รอบ {game.competition?.round??1} · เซ็ต {game.competition?.set??1}/{totalSets}</strong><span>เหลือ {game.players.filter(p=>p.active).length} คน</span></div>
      {showReset&&<div className="reset-alert" role="status"><div className="reset-alert-title"><Undo2 size={19}/><strong>{reset.playerName} · ตกรอบจากคำนี้</strong><button className="text-button" aria-label="ปิดแจ้งเตือนการย้อนคำ" onClick={()=>setNoticeDismissed(reset.id)}>ปิด</button></div><p><b>“{reset.word}”</b> {reset.reason==='duplicate'?<>{reset.duplicateKind==='word'?'ใช้คำเต็มซ้ำกับ':'พยางค์ซ้ำกับ'} “{reset.previous}”{reset.duplicateKind!=='word'&&<> ที่พยางค์ <b>{reset.syllables.join(' · ')}</b></>}{reset.previousPlayerName&&<> · {reset.previousPlayerName}{reset.previousTurn===0?' (คำตั้งต้น)':` · ตาที่ ${reset.previousTurn}`}</>}</>:reset.reason==='not_noun'?<>{reset.explanation}{Boolean(reset.suggestions?.length)&&<> · ลองใช้ {reset.suggestions?.join(' / ')}</>}</>:'เจ้าของห้องตัดสินว่าไม่ผ่าน'}</p>{reset.reusable.length>0&&<p>ใช้ใหม่ได้: {reset.reusable.map(w=>w.text).join(' · ')}</p>}{reset.appealed?<small>เจ้าของห้องรับรองคำนี้แล้ว</small>:game.status==='playing'&&game.isHost&&last?.id===(reset.resumeId??reset.previousId)&&<button className="text-button" disabled={busy} onClick={()=>send('appeal',{eventId:reset.id})}>ทบทวนแล้วรับรอง “{reset.word}”</button>}</div>}
      {game.notice&&<p className="turn-notice" role="status">{game.notice}</p>}
      {game.aiError&&<div className="inline-error" role="status"><AlertCircle size={18}/><span>{game.aiError}</span>{game.isHost&&<button className="text-button" disabled={busy} onClick={()=>send('retry')}>ลองใหม่</button>}</div>}
      {game.status==='ended'&&!game.continuation&&<div className="results-card"><Trophy size={28}/><div><span className="card-kicker">รอบ {game.competition?.round??1} · เซ็ต {game.competition?.set??1}/{totalSets}</span><h2>{game.competition?.setComplete?`${game.players.find(p=>p.id===game.competition?.winnerId)?.name} ชนะเซ็ตนี้`:game.result?`${game.players.find(p=>p.id===game.result?.loserId)?.name} ตกรอบจากเซ็ตนี้`:'เจ้าของห้องพักช่วงคำ'}</h2><p>{game.result?.reason==='timeout'?'หมดเวลา':game.result?.reason==='surrender'?'ยอมแพ้':game.manual?'เปิดคำด้านล่างเพื่อเสนอและยืนยันผลตรวจ':game.pending?`ยังมี ${game.pending} คำรอผลวิเคราะห์ ดูรายละเอียดด้านล่าง`:'ดูผลตรวจและช่วยกันยืนยันฐานคำด้านล่าง'}</p></div>{game.isHost&&<button className="button subtle" disabled={busy} onClick={()=>send('lobby')}><RotateCcw size={16}/>{game.competition?.setComplete?(roundComplete?`เริ่มรอบใหม่ (${totalSets} เซ็ต)`:`เริ่มเซ็ตที่ ${game.competition.set+1}`):'ให้คนที่เหลือเล่นต่อ'}</button>}</div>}
      <div className="current-word-card">
        <div className="current-word-label"><span>{last?.playerId?'ต่อจากคำนี้':'คำตั้งต้นของวง'}</span><span className={`check-label ${last?.check==='valid'?'verified':''}`}>{verificationLabel(last)}</span></div>
        <div className="word-and-clock"><div className="current-word-text"><h1>{last?.text}</h1>{last?.syllables&&<div className="syllable-chips">{last.syllables.map((s,i)=><span key={i}>{s}</span>)}</div>}</div>{game.status==='playing'&&<div className={`clock ${remaining!==null&&remaining<=5?'urgent':''}`} aria-label={remaining===null?'ไม่จับเวลา':`เหลือ ${remaining} วินาที`}><svg viewBox="0 0 112 112" aria-hidden="true"><circle className="clock-track" cx="56" cy="56" r="48"/><circle className="clock-progress" cx="56" cy="56" r="48" strokeDasharray="301.59" strokeDashoffset={remaining===null?0:301.59*(1-Math.min(1,remaining/game.turnSeconds))}/></svg><div><strong>{debating?'พัก':remaining===null?'∞':String(remaining).padStart(2,'0')}</strong><span>{debating?'ระหว่างชาเลนจ์':remaining===null?'ไม่จับเวลา':'วินาที'}</span></div></div>}</div>
        <div className="current-word-footer"><span>คำของ {last?.playerId?game.players.find(p=>p.id===last.playerId)?.name:game.manual?'ผู้เล่น':'ฐานคำ'}</span><span>คำที่ {game.wordCount}</span></div>
      </div>
      <ChallengePanel key={game.challenge?.id??`open:${last?.id}`} game={game} busy={busy} now={now+serverOffset.current} send={send}/>
      {game.status==='playing'&&<div className={`submit-area ${!isTurn?'waiting-turn':''}`}><div className="your-turn"><span className={`avatar small-avatar color-${game.turnIndex%4}`}>{current.name.slice(0,1)}</span><strong>{isTurn?`ตาของ ${current.name}`:`รอ ${current.name} เชื่อมคำ`}</strong><span>{isTurn?'คิดคำได้แล้ว ส่งเลย!':'ตาถัดไปอาจเป็นคุณ'}</span></div><form onSubmit={submit} className="word-form"><label className="sr-only" htmlFor="next-word">คำที่จะเชื่อม</label><input ref={input} id="next-word" placeholder={isTurn?'พิมพ์คำนามที่เชื่อมกัน…':'รอเพื่อนต่อคำ…'} autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={200} disabled={!canType||busy} value={text} onChange={e=>setText(e.target.value)}/><button className="button primary" type="submit" disabled={!canType||busy||!text.trim()} aria-label="ส่งคำ"><span>เชื่อมคำ</span><Send size={18}/></button></form><div className="input-footnote"><span>{game.manual?'เจ้าของห้องกดรับรองคำล่าสุดได้':'ส่งแล้วเล่นต่อได้เลย ระบบตรวจย้อนหลังให้'}</span><button className="text-button" disabled={!canType||busy} onClick={()=>send('pass',{turn:game.turnNumber})}><SkipForward size={15}/> ยอมแพ้ · ตกรอบ</button></div></div>}
      {game.status==='playing'&&!debating&&game.isHost&&last?.playerId&&(!last.phaseId||last.phaseId===game.roundId)&&<div className="word-detail"><span>เจ้าของห้องทบทวนคำล่าสุดได้</span><div className="word-actions"><button className="text-button" disabled={busy} onClick={()=>send('accept',{wordId:last.id})}><Check size={15}/>รับรองคำ</button><button className="text-button danger-text" disabled={busy} onClick={()=>send('reject',{wordId:last.id})}><Undo2 size={15}/>ตัดสินว่าผิด · ตกรอบ</button></div></div>}
      <p className="memory-note">จำคำที่เล่นไปด้วยตัวเอง วงนี้แสดงเฉพาะคำล่าสุด</p>
      {game.status==='ended'&&game.competition?.setComplete&&<section className="set-summary"><h2>{roundComplete?`ครบ ${totalSets} เซ็ต · ผลรวมรอบนี้`:'สรุปแต้มเซ็ตนี้'}</h2>{roundComplete&&<p><strong>{roundWinners.length>1?'ผู้ชนะร่วมรอบนี้':'ผู้ชนะรอบนี้'}: {roundWinners.map(p=>p.name).join(' · ')}</strong></p>}{[...game.players].sort((a,b)=>(roundComplete?b.roundScore-a.roundScore:b.setScore-a.setScore)).map(p=><p key={p.id}><strong>{p.name}</strong><span>{roundComplete?p.roundScore:p.setScore} แต้ม · สะสม {p.score}</span></p>)}</section>}
      <RoundReview game={game} busy={busy} send={send}/>

    </section>
    <aside className="history-panel" inert={Boolean(game.continuation)}><div className="panel-heading"><h2><RotateCcw size={17}/> คำที่รีเซ็ต</h2><span className="count-pill">{game.events.length}</span></div>{game.events.length===0?<div className="empty-resets"><div><Link2 size={28}/></div><strong>สายคำยังไปได้สวย</strong><p>ถ้าพบคำซ้ำย้อนหลัง<br/>คำที่ใช้ใหม่ได้จะแสดงตรงนี้</p></div>:<div className="reset-history">{[...game.events].reverse().map(event=><article key={event.id}><div className="reset-meta"><span>{event.reason==='duplicate'?(event.duplicateKind==='word'?'คำเต็มซ้ำ':'พยางค์ซ้ำ'):event.reason==='not_noun'?'ไม่ผ่านคำนาม':'ผู้เล่นตัดสิน'}</span><time>{new Date(event.at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}</time></div><strong>{event.playerName}: {event.word}</strong><p>{event.reason==='duplicate'?<>ซ้ำ “{event.previous}”{event.previousPlayerName&&<> · {event.previousPlayerName}{event.previousTurn===0?' (คำตั้งต้น)':` · ตาที่ ${event.previousTurn}`}</>}{event.duplicateKind!=='word'&&<><br/><b>{event.syllables.join(' · ')}</b></>}</>:event.reason==='not_noun'?event.explanation:'เจ้าของห้องยกเลิกคำนี้'}</p>{event.appealed&&<span className="appealed-label">ทบทวนและรับรองแล้ว</span>}{event.reusable.length>0?<><small>นำกลับมาใช้ได้</small><div className="reusable-chips">{event.reusable.map((word,i)=><span key={i}>{word.text}</span>)}</div></>:<small>ยังไม่มีคำต่อท้าย</small>}</article>)}</div>}{Boolean(game.releasedWords?.length)&&<div className="reset-history"><h3>คำที่พักไว้ ใช้ใหม่ได้</h3><div className="reusable-chips">{game.releasedWords!.map((w,i)=><span key={i}>{w.text}</span>)}</div></div>}<div className="human-note"><Users size={18}/><p>ความเชื่อมโยงของคำ<br/><strong>คนในวงเป็นคนตัดสิน</strong></p></div></aside>
  </main>;
}

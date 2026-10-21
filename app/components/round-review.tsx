'use client';
import { useEffect,useRef,useState } from 'react';
import { Check,Database,Send,LoaderCircle } from 'lucide-react';
import { verificationLabel } from '@/lib/verification-label';
import type { PublicGame,Word,Review } from '@/lib/game';
import type { WordAnalysis } from '@/lib/word-analysis';

const choices=[['noun:common','คำนามทั่วไป'],['noun:proper','ชื่อเฉพาะ'],['noun:nominalized','อาการนาม (การ/ความ)'],['noun:song','ชื่อเพลง'],['noun:movie','ชื่อภาพยนตร์'],['noun:series','ชื่อซีรีส์'],['verb:none','คำกริยา'],['adjective:none','คำคุณศัพท์ / บอกลักษณะ'],['adverb:none','คำวิเศษณ์'],['sentence:none','ประโยคทั่วไป'],['phrase:none','วลีที่ไม่ใช่คำนาม'],['other:none','ประเภทอื่น'],['uncertain:none','ยังไม่แน่ใจ']];
type SendCommand=(action:string,payload?:Record<string,unknown>)=>Promise<boolean>;
function ReviewWord({word,proposal,isHost,busy,send,now}:{word:Word;proposal?:Review;isHost:boolean;busy:boolean;send:SendCommand;now:number}){
  const analysis=proposal?.analysis??word.analysis;
  const [syllables,setSyllables]=useState((analysis?.syllables??word.syllables??[word.text]).join(' / '));
  const [kind,setKind]=useState(analysis?`${analysis.category}:${analysis.nounType}`:'uncertain:none');
  const [context,setContext]=useState(analysis?.titleContext??'');
  const [note,setNote]=useState(analysis?.reason??'');
  const dirty=useRef(false);
  useEffect(()=>{
    if(dirty.current)return;
    setSyllables((analysis?.syllables??word.syllables??[word.text]).join(' / '));
    setKind(analysis?`${analysis.category}:${analysis.nounType}`:'uncertain:none');setContext(analysis?.titleContext??'');setNote(analysis?.reason??'');
  },[analysis,word.syllables,word.text]);
  const approved=Boolean(proposal&&proposal.approvedId===proposal.id);
  const checking=proposal?.status==='checking'&&(proposal.leaseUntil??0)>now;
  const response=proposal?.response;
  async function propose(event:React.FormEvent){
    event.preventDefault();const [category,nounType]=kind.split(':');
    const next={syllables:syllables.split('/').map(s=>s.trim()).filter(Boolean),category,nounType,reason:note.trim()||'ผู้เล่นตรวจทานหลังจบรอบ',suggestions:analysis?.suggestions??[],titleContext:context.trim()} as WordAnalysis;
    await send('review',{wordId:word.id,analysis:next});
  }
  return <details className="review-word"><summary><strong>{word.text}</strong><span>{approved?'ยืนยันเข้าฐานคำแล้ว':checking?'กำลังรอคำตอบโมเดล':response?'โมเดลตอบแล้ว · รอยืนยัน':proposal?.status==='error'?'ตรวจไม่สำเร็จ · ส่งใหม่ได้':choices.find(([value])=>value===`${analysis?.category}:${analysis?.nounType}`)?.[1]??'รอผลวิเคราะห์'}</span></summary>
    <p className="review-syllables">{analysis?.syllables.join(' · ')??word.syllables?.join(' · ')??'ยังไม่มีผลแบ่งพยางค์'}</p>
    <p className="review-verification">{verificationLabel(word)}{word.verification?.repeated.length?` · ซ้ำ ${word.verification.repeated.join(' / ')}`:''}{word.verification&&['duplicate','not_noun'].includes(word.verification.status)&&!word.verification.applied?' · ผลย้อนหลัง ไม่เปลี่ยนผู้แพ้หรือคะแนน':''}</p>
    {word.analysis&&<p className="muted">ข้อมูลเดิม: {word.analysis.syllables.join(' / ')} · {choices.find(([value])=>value===`${word.analysis?.category}:${word.analysis?.nounType}`)?.[1]} · {word.analysis.reason}</p>}
    <form onSubmit={propose} onChange={()=>{dirty.current=true;}} className="review-form">
      <label className="field-label">แบ่งพยางค์ด้วย /<input value={syllables} onChange={e=>setSyllables(e.target.value)} maxLength={700} required/></label>
      <label className="field-label">ประเภทคำ<select value={kind} onChange={e=>setKind(e.target.value)}>{choices.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      {['noun:song','noun:movie','noun:series'].includes(kind)&&<label className="field-label">ศิลปิน / ผู้สร้าง / ข้อมูลผลงาน<input value={context} onChange={e=>setContext(e.target.value)} maxLength={300} required/></label>}
      <label className="field-label">เหตุผล / หมายเหตุ<input value={note} onChange={e=>setNote(e.target.value)} maxLength={500}/></label>
      <button className="button subtle" disabled={busy||checking||proposal?.status==='confirming'} type="submit"><Send size={15}/>ส่งคำขอให้โมเดลตรวจ</button>
    </form>
    {proposal&&<div className="review-confirm" aria-live="polite">
      <p>ข้อเสนอที่ส่ง: {proposal.analysis.syllables.join(' / ')} · {proposal.analysis.reason}</p>
      {checking&&<p role="status"><LoaderCircle className="spin" size={16}/> ส่งคำขอแล้ว กำลังรอโมเดลตรวจสอบ</p>}
      {!checking&&!response&&!approved&&<><p role="status">{proposal.error??(proposal.status==='draft'?'คำขอยังไม่ได้รับคำตอบจากโมเดล':'การตรวจยังไม่เสร็จ สามารถลองใหม่ได้')}</p><button className="button subtle" disabled={busy} onClick={()=>send('recheckReview',{wordId:word.id,proposalId:proposal.id})}>ส่งคำขออีกครั้ง</button></>}
      {response&&<div className="model-review-result"><strong>โมเดลตอบแล้ว · {response.verdict==='agree'?'เห็นด้วยกับข้อเสนอ':response.verdict==='revise'?'เสนอให้แก้ไข':'ยังไม่แน่ใจ'}</strong><p>{response.reason}</p><p>ผลที่โมเดลเสนอ: <b>{response.analysis.syllables.join(' / ')}</b> · {choices.find(([value])=>value===`${response.analysis.category}:${response.analysis.nounType}`)?.[1]}</p><small>{response.analysis.reason}</small></div>}
      {approved?<p><Check size={15}/> บันทึกแล้ว: {proposal.approvedAnalysis?.syllables.join(' / ')??proposal.analysis.syllables.join(' / ')} · ใช้กับการตรวจครั้งต่อไป</p>:isHost&&response&&<div className="review-actions"><button className="button primary" disabled={busy||response.verdict==='uncertain'||response.analysis.category==='uncertain'} onClick={()=>send('confirmReview',{wordId:word.id,proposalId:proposal.id,useModel:true})}><Database size={15}/>ยืนยันผลโมเดลและบันทึก</button>{response.verdict!=='agree'&&<button className="button subtle" disabled={busy||proposal.analysis.category==='uncertain'} onClick={()=>send('confirmReview',{wordId:word.id,proposalId:proposal.id,useModel:false})}>ยืนยันข้อเสนอของผู้เล่นแทน</button>}</div>}
      {response&&!approved&&<small>ยังไม่เปลี่ยนฐานคำ จนกว่าเจ้าของห้องจะยืนยัน</small>}
    </div>}
  </details>;
}
export function RoundReview({game,busy,send}:{game:PublicGame;busy:boolean;send:SendCommand}){
  if(game.status!=='ended')return null;
  return <section className="round-review" aria-labelledby="review-heading"><h2 id="review-heading">ช่วยกันตรวจคำของรอบนี้</h2><p>ส่งพยางค์ ประเภท และเหตุผลให้โมเดลตรวจ รออ่านคำตอบ แล้วเจ้าของห้องยืนยันจึงบันทึกฐานคำ มีผลกับครั้งต่อไป ผลการแข่งขันเดิมคงเดิม</p>
    <p className="muted">ผลจากโมเดลเป็นฉบับร่าง · ช่องว่างและเครื่องหมายไม่ใช้เทียบพยางค์ · คงตัวสะกดเดิม</p>
    {game.reviewWords.map(word=><ReviewWord key={word.id} word={word} proposal={game.reviews?.[word.id]} isHost={game.isHost} busy={busy} send={send} now={game.serverNow}/>)}
  </section>;
}

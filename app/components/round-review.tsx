'use client';
import { useState } from 'react';
import { Check,Database,Send } from 'lucide-react';
import type { PublicGame,Word,Review } from '@/lib/game';
import type { WordAnalysis } from '@/lib/word-analysis';

const choices=[['noun:common','คำนามทั่วไป'],['noun:proper','ชื่อเฉพาะ'],['noun:nominalized','อาการนาม (การ/ความ)'],['noun:song','ชื่อเพลง'],['noun:movie','ชื่อภาพยนตร์'],['noun:series','ชื่อซีรีส์'],['verb:none','คำกริยา'],['adjective:none','คำคุณศัพท์ / บอกลักษณะ'],['adverb:none','คำวิเศษณ์'],['sentence:none','ประโยคทั่วไป'],['phrase:none','วลีที่ไม่ใช่คำนาม'],['other:none','ประเภทอื่น'],['uncertain:none','ยังไม่แน่ใจ']];
type SendCommand=(action:string,payload?:Record<string,unknown>)=>Promise<boolean>;
function ReviewWord({word,proposal,isHost,busy,send}:{word:Word;proposal?:Review;isHost:boolean;busy:boolean;send:SendCommand}){
  const analysis=proposal?.analysis??word.analysis;
  const [syllables,setSyllables]=useState((analysis?.syllables??word.syllables??[word.text]).join(' / '));
  const [kind,setKind]=useState(analysis?`${analysis.category}:${analysis.nounType}`:'uncertain:none');
  const [context,setContext]=useState(analysis?.titleContext??'');
  const [note,setNote]=useState(analysis?.reason??'');
  const approved=Boolean(proposal&&proposal.approvedId===proposal.id);
  async function propose(event:React.FormEvent){
    event.preventDefault();const [category,nounType]=kind.split(':');
    const next={syllables:syllables.split('/').map(s=>s.trim()).filter(Boolean),category,nounType,reason:note.trim()||'ผู้เล่นตรวจทานหลังจบรอบ',suggestions:analysis?.suggestions??[],titleContext:context.trim()} as WordAnalysis;
    await send('review',{wordId:word.id,analysis:next});
  }
  return <details className="review-word"><summary><strong>{word.text}</strong><span>{approved?'ยืนยันเข้าฐานคำแล้ว':choices.find(([value])=>value===`${analysis?.category}:${analysis?.nounType}`)?.[1]??'รอผลวิเคราะห์'}</span></summary>
    <p className="review-syllables">{analysis?.syllables.join(' · ')??word.syllables?.join(' · ')??'ยังไม่มีผลแบ่งพยางค์'}</p>
    <form onSubmit={propose} className="review-form">
      <label className="field-label">แบ่งพยางค์ด้วย /<input value={syllables} onChange={e=>setSyllables(e.target.value)} maxLength={700} required/></label>
      <label className="field-label">ประเภทคำ<select value={kind} onChange={e=>setKind(e.target.value)}>{choices.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      {['noun:song','noun:movie','noun:series'].includes(kind)&&<label className="field-label">ศิลปิน / ผู้สร้าง / ข้อมูลผลงาน<input value={context} onChange={e=>setContext(e.target.value)} maxLength={300} required/></label>}
      <label className="field-label">เหตุผล / หมายเหตุ<input value={note} onChange={e=>setNote(e.target.value)} maxLength={500}/></label>
      <button className="button subtle" disabled={busy} type="submit"><Send size={15}/>เสนอผลตรวจ</button>
    </form>
    {proposal&&<div className="review-confirm"><p>{approved?<><Check size={15}/> บันทึกแล้ว ใช้กับการตรวจครั้งต่อไป</>:'มีข้อเสนอให้เจ้าของห้องตรวจทานก่อนบันทึก'}</p>{isHost&&!approved&&<button className="button primary" disabled={busy||proposal.analysis.category==='uncertain'} onClick={()=>send('confirmReview',{wordId:word.id,proposalId:proposal.id})}><Database size={15}/>ยืนยันและบันทึกฐานคำ</button>}</div>}
  </details>;
}
export function RoundReview({game,busy,send}:{game:PublicGame;busy:boolean;send:SendCommand}){
  if(game.status!=='ended')return null;
  return <section className="round-review" aria-labelledby="review-heading"><h2 id="review-heading">ช่วยกันตรวจคำของรอบนี้</h2><p>เปิดดูคำเพื่อแก้พยางค์หรือประเภทคำ ทุกคนเสนอได้ เจ้าของห้องยืนยันแล้วจึงบันทึกคำแก้ลงฐานข้อมูล มีผลกับครั้งต่อไป ผลรอบนี้คงเดิม</p>
    <p className="muted">ผลจากโมเดลเป็นฉบับร่าง · ช่องว่างและเครื่องหมายไม่ใช้เทียบพยางค์ · คงตัวสะกดเดิม</p>
    {game.reviewWords.map(word=><ReviewWord key={`${word.id}:${game.reviews?.[word.id]?.id??'model'}:${Boolean(word.analysis)}`} word={word} proposal={game.reviews?.[word.id]} isHost={game.isHost} busy={busy} send={send}/>)}
  </section>;
}

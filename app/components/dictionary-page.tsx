'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,BookOpen,Search,Save,LoaderCircle} from 'lucide-react';
import {useRoom} from './use-room';
import {CATEGORIES,NOUN_TYPES} from '@/lib/word-analysis';
import type {WordAnalysis} from '@/lib/word-analysis';
import type {DictionaryEntry,DictionaryPage as WordPage} from '@/lib/dictionary';
const categoryLabel:Record<string,string>={noun:'คำนาม',verb:'คำกริยา',adjective:'คำคุณศัพท์',adverb:'คำวิเศษณ์',sentence:'ประโยค',phrase:'วลี',other:'ประเภทอื่น / คำสะกดเดิม',uncertain:'ยังไม่แน่ใจ'};
const nounLabel:Record<string,string>={common:'นามทั่วไป',proper:'ชื่อเฉพาะ',nominalized:'อาการนาม',song:'ชื่อเพลง',movie:'ภาพยนตร์',series:'ซีรีส์',none:'ไม่ใช่คำนาม'};
async function call<T>(body:unknown):Promise<T>{
 const response=await fetch('/api/dictionary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const data=await response.json();if(!response.ok)throw new Error(data.error??'อ่านหรือบันทึกคำไม่สำเร็จ');return data;
}
export function DictionaryPage(){
 const room=useRoom(false),[query,setQuery]=useState(''),[items,setItems]=useState<DictionaryEntry[]>([]),[cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState<DictionaryEntry|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const serial=useRef(0),code=room.session?.code,token=room.session?.token;
 const load=useCallback(async(search:string,after='',append=false)=>{
  if(!code||!token)return;const id=++serial.current;setLoading(true);setError('');
  try{const page=await call<WordPage>({action:'list',code,token,query:search,after});if(id!==serial.current)return;setItems(old=>append?[...old,...page.items]:page.items);setCursor(page.nextCursor);}
  catch(e){if(id===serial.current)setError(e instanceof Error?e.message:'อ่านคลังคำไม่สำเร็จ');}
  finally{if(id===serial.current)setLoading(false);}
 },[code,token]);
 useEffect(()=>{void load('');return()=>{serial.current++;};},[load]);
 async function save(entry:DictionaryEntry,word:string,analysis:WordAnalysis){
  const result=await call<{entry:DictionaryEntry}>({action:'save',code,token,originalWord:entry.word,word,analysis,expectedUpdatedAt:entry.updatedAt});
  setSelected(result.entry);setNotice('บันทึกแล้ว คำที่ส่งครั้งถัดไปจะใช้ข้อมูลนี้');await load(query);
 }
 return <div className="app-shell dictionary-shell"><header className="site-header"><a className="text-button" href="/"><ArrowLeft size={18}/> กลับไปเกม</a><span><BookOpen size={19}/> คลังคำ</span></header>
 <main className="dictionary-main"><div className="dictionary-intro"><h1>คลังคำของวงเรา</h1><p>แก้ตัวสะกด แบ่งพยางค์ และประเภทคำร่วมกัน ผู้เล่นทุกคนที่ยังอยู่ในห้องแก้ได้</p><p className="muted small">การแก้คำใช้กับการส่งครั้งถัดไป ผลการแข่งขันเดิมคงเดิม · หน้านี้ไม่เรียกโมเดล</p></div>
 {!room.session||!room.game?<section className="dictionary-message"><p>{room.session?'กำลังตรวจสมาชิกห้อง…':'เข้าห้องเกมก่อนเพื่อเปิดและแก้ไขคลังคำ'}</p><a className="button subtle" href="/">กลับไปเข้าห้อง</a>{room.error&&<p role="alert">{room.error}</p>}</section>:<>
 <p className="dictionary-membership">ห้อง {code} · {room.game.players.find(p=>p.id===room.game?.youId)?.name} · ระหว่างเล่น เวลาของเกมยังเดินเมื่อเปิดหน้านี้</p>
 {notice&&<p className="dictionary-notice" role="status">{notice}</p>}{error&&<p className="inline-error" role="alert">{error}</p>}
 <div className="dictionary-layout"><section className="dictionary-list" aria-label="รายการคำศัพท์"><form className="dictionary-search" onSubmit={e=>{e.preventDefault();setSelected(null);void load(query);}}><label className="sr-only" htmlFor="dictionary-search">ค้นหาคำศัพท์</label><input id="dictionary-search" value={query} onChange={e=>setQuery(e.target.value)} maxLength={200} placeholder="ค้นหาคำศัพท์…"/><button className="button subtle" disabled={loading} aria-label="ค้นหาคำศัพท์"><Search size={18}/></button></form>
 <div className="dictionary-rows">{items.map(entry=><button type="button" key={entry.word} className={`dictionary-row ${selected?.word===entry.word?'selected':''}`} onClick={()=>{setSelected(entry);setNotice('');}}><strong>{entry.word}</strong><span>{entry.analysis.syllables.join(' / ')}</span><small>{categoryLabel[entry.analysis.category]} · {entry.source==='players'?'ผู้เล่นยืนยัน':'โมเดลวิเคราะห์'}</small></button>)}</div>
 {!loading&&!items.length&&<p className="dictionary-empty">ยังไม่พบคำที่ค้นหา</p>}{loading&&<p role="status" className="dictionary-empty">กำลังอ่านคำ…</p>}{cursor&&<button className="button subtle wide" disabled={loading} onClick={()=>void load(query,cursor,true)}>โหลดคำถัดไป</button>}
 </section><section className="dictionary-editor-panel" aria-label="แก้ไขคำศัพท์">{selected?<WordEditor key={selected.word+':'+selected.updatedAt} entry={selected} onSave={save} onReload={()=>{setSelected(null);void load(query);}}/>:<div className="dictionary-empty"><BookOpen size={32}/><h2>เลือกคำที่ต้องการแก้</h2><p>แบ่งให้ละเอียดตามการอ่าน แล้วคงตัวสะกดเดิมไว้ครบ</p><p>กรุง / เทพ / ม / หา / น / คร<br/>ม / หา / ส / มุทร</p></div>}</section></div></>}
 </main></div>;
}
function WordEditor({entry,onSave,onReload}:{entry:DictionaryEntry;onSave:(entry:DictionaryEntry,word:string,analysis:WordAnalysis)=>Promise<void>;onReload:()=>void}){
 const [word,setWord]=useState(entry.word),[chunks,setChunks]=useState(entry.analysis.syllables.join(' / ')),[category,setCategory]=useState(entry.analysis.category),[nounType,setNounType]=useState(entry.analysis.nounType),[reason,setReason]=useState(entry.analysis.reason),[suggestions,setSuggestions]=useState(entry.analysis.suggestions.join(' / ')),[titleContext,setTitleContext]=useState(entry.analysis.titleContext),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false);
 async function submit(e:React.FormEvent){e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await onSave(entry,word,{syllables:chunks.split('/').map(s=>s.trim()).filter(Boolean),category,nounType:category==='noun'?nounType:'none',reason,suggestions:suggestions.split('/').map(s=>s.trim()).filter(Boolean),titleContext});}catch(e){setError(e instanceof Error?e.message:'บันทึกไม่สำเร็จ');}finally{lock.current=false;setBusy(false);}}
 return <form className="dictionary-editor" onSubmit={submit}><h2>แก้ไขคำศัพท์</h2><label>คำศัพท์<input required maxLength={200} value={word} onChange={e=>setWord(e.target.value)}/></label>
 {word.trim()!==entry.word&&<p className="dictionary-rename-note">คำสะกดเดิมจะเก็บไว้เพื่อแจ้งว่าไม่ผ่าน พร้อมแนะนำคำสะกดใหม่ ไม่ลบประวัติเดิม</p>}
 <label>แบ่งพยางค์ด้วย /<input required maxLength={1000} value={chunks} onChange={e=>setChunks(e.target.value)}/></label><small>เช่น ม / หา / ส / มุทร · เมื่อนำส่วนที่แบ่งมาต่อกันต้องได้รูปสะกดเดิมครบ ห้ามเติมสระแฝง</small>
 <div className="dictionary-selects"><label>ประเภทคำ<select value={category} onChange={e=>{const next=e.target.value as WordAnalysis['category'];setCategory(next);setNounType(next==='noun'?'common':'none');}}>{CATEGORIES.map(c=><option key={c} value={c}>{categoryLabel[c]}</option>)}</select></label><label>ชนิดคำนาม<select value={category==='noun'?nounType:'none'} disabled={category!=='noun'} onChange={e=>setNounType(e.target.value as WordAnalysis['nounType'])}>{NOUN_TYPES.filter(t=>category==='noun'?t!=='none':t==='none').map(t=><option key={t} value={t}>{nounLabel[t]}</option>)}</select></label></div>
 <label>เหตุผลที่แก้<textarea required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><label>คำแนะนำ (ไม่เกิน 3 คำ คั่นด้วย /)<input maxLength={605} value={suggestions} onChange={e=>setSuggestions(e.target.value)}/></label>
 {['song','movie','series'].includes(nounType)&&category==='noun'&&<label>ข้อมูลประกอบชื่อผลงาน<input required maxLength={300} value={titleContext} onChange={e=>setTitleContext(e.target.value)}/></label>}
 {error&&<div role="alert" className="inline-error"><p>{error}</p><button type="button" className="text-button" disabled={busy} onClick={onReload}>โหลดข้อมูลล่าสุด</button></div>}
 <button className="button primary" disabled={busy} type="submit">{busy?<LoaderCircle className="spin" size={18}/>:<Save size={18}/>} {busy?'กำลังบันทึก…':'บันทึกคำ'}</button><p className="muted small">ฉบับวันที่ {new Date(entry.updatedAt).toLocaleString('th-TH')} · เก็บผู้แก้และประวัติทุกครั้ง</p></form>;
}

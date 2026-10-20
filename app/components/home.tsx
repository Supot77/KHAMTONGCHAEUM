'use client';
import { useState } from 'react';
import { ArrowRight,MonitorSmartphone,Users,Plus,X,Link2,ArrowUpRight,Timer,Infinity as InfinityIcon } from 'lucide-react';
type Props={busy:boolean;configured:boolean;connect:(action:'create'|'join',payload:Record<string,unknown>)=>Promise<boolean>;onSetup:()=>void};
export function Home({busy,configured,connect,onSetup}:Props){
  const [mode,setMode]=useState<'shared'|'online'>('shared'),[join,setJoin]=useState(false),[names,setNames]=useState(['','']),[name,setName]=useState(''),[code,setCode]=useState(''),[seconds,setSeconds]=useState(30);
  async function submit(e:React.FormEvent){e.preventDefault();await connect(mode==='online'&&join?'join':'create',{mode,names,name,code:code.toUpperCase().trim(),seconds});}
  return <main className="home-layout">
    <section className="intro">
      <div className="eyebrow"><span className="mini-link"><Link2 size={15}/></span> เกมต่อคำ สำหรับคนคิดไว</div>
      <h1>ต่อคำให้<span className="violet">ไหล</span><br/>อย่าให้พยางค์<span className="underline-coral">ซ้ำ</span></h1>
      <p className="intro-description">หนึ่งคำ เชื่อมไปได้อีกหลายเรื่อง<br/>ชวนเพื่อนมาต่อคำนาม แล้วดูว่าใครจะไปได้ไกลกว่า</p>
      <div className="word-art" aria-label="ตัวอย่าง ทะเล เชื่อมกับ ปลา เชื่อมกับ แมว">
        <span className="art-caption">ความหมายเชื่อมกัน · พยางค์ไม่ซ้ำ</span>
        <div className="art-chain"><span className="art-tile art-one">ทะเล<span>ทะ · เล</span></span><Link2 className="art-connector"/><span className="art-tile art-two">ปลา<span>ปลา</span></span><Link2 className="art-connector"/><span className="art-tile art-three">แมว<span>แมว</span></span></div>
        <div className="art-footnote"><span className="small-dot"/> ความเชื่อมโยง เพื่อนในวงเป็นคนตัดสิน</div>
      </div>
      <div className="home-facts"><span><Users size={17}/> 2–8 คน</span><span><Timer size={17}/> ตั้งเวลาได้</span><span><Link2 size={17}/> ตรวจซ้ำย้อนหลัง</span></div>
    </section>
    <section className="setup-card" aria-labelledby="setup-heading">
      <div className="card-kicker">วงคำของคุณ</div><h2 id="setup-heading">วันนี้เล่นแบบไหนดี?</h2><p className="muted">เลือกโหมด แล้วชวนเพื่อนมาเชื่อมคำ</p>
      <div className="mode-options">
        <button type="button" className={`mode-option ${mode==='shared'?'selected':''}`} aria-pressed={mode==='shared'} onClick={()=>setMode('shared')}><MonitorSmartphone size={25}/><strong>เครื่องเดียวกัน</strong><span>ผลัดกันพิมพ์ในวง</span><i className="radio-dot"/></button>
        <button type="button" className={`mode-option ${mode==='online'?'selected':''}`} aria-pressed={mode==='online'} onClick={()=>setMode('online')}><Users size={25}/><strong>ห้องออนไลน์</strong><span>คนละเครื่อง ก็เล่นได้</span><i className="radio-dot"/></button>
      </div>
      {mode==='online'&&<div className="tabs"><button type="button" aria-pressed={!join} className={!join?'active':''} onClick={()=>setJoin(false)}>สร้างห้อง</button><button type="button" aria-pressed={join} className={join?'active':''} onClick={()=>setJoin(true)}>เข้าห้องเพื่อน</button></div>}
      <form onSubmit={submit} className="setup-form">
        {mode==='shared'?<fieldset><legend>ใครอยู่ในวงบ้าง? <span className="field-hint">{names.length}/8 คน</span></legend><div className="name-grid">{names.map((value,i)=><div className="name-field" key={i}><span className={`avatar color-${i%4}`}>{i+1}</span><input aria-label={`ชื่อผู้เล่น ${i+1}`} placeholder={`ผู้เล่น ${i+1}`} required maxLength={20} autoComplete="off" value={value} onChange={e=>setNames(names.map((n,index)=>index===i?e.target.value:n))}/>{names.length>2&&<button type="button" className="remove-name" aria-label={`ลบผู้เล่น ${i+1}`} onClick={()=>setNames(names.filter((_,index)=>index!==i))}><X size={14}/></button>}</div>)}</div>{names.length<8&&<button className="text-button add-player" type="button" onClick={()=>setNames([...names,''])}><Plus size={16}/> เพิ่มผู้เล่น</button>}</fieldset>:<><label className="field-label" htmlFor="player-name">ชื่อเล่นของคุณ</label><input id="player-name" placeholder="ชื่อที่เพื่อนเรียก" autoComplete="nickname" required maxLength={20} value={name} onChange={e=>setName(e.target.value)}/>{join&&<><label className="field-label" htmlFor="room-code">รหัสห้อง</label><input className="code-input" id="room-code" placeholder="ABC123" required minLength={6} maxLength={6} autoComplete="off" value={code} onChange={e=>setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g,''))}/></>}</>}
        {!(mode==='online'&&join)&&<fieldset className="time-field"><legend><Timer size={16}/> เวลาต่อตา</legend><div className="time-options">{[15,30,45,60,0].map(time=><button key={time} type="button" className={seconds===time?'active':''} aria-pressed={seconds===time} aria-label={time?`${time} วินาที`:'ไม่จับเวลา'} onClick={()=>setSeconds(time)}>{time||<InfinityIcon size={18}/>}</button>)}<span>วินาที</span></div></fieldset>}
        <button className="button primary wide" disabled={busy} type="submit">{busy?'กำลังเปิดวง…':mode==='shared'?'ตั้งวงเลย':join?'เข้าห้องเพื่อน':'สร้างห้องของเรา'}<ArrowRight size={19}/></button>
      </form>
      <div className="setup-bottom"><span className={`small-dot ${configured?'green':''}`}/><span>{configured?'พร้อมตรวจคำอัตโนมัติ':'ยังไม่ได้เชื่อมระบบตรวจคำ'}</span>{!configured&&<button className="text-button" onClick={onSetup}>ตั้งค่า <ArrowUpRight size={13}/></button>}</div>
    </section>
  </main>;
}

'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import type { PublicGame } from '@/lib/game';

type Session={code:string;token:string};
type ProviderStatus={configured:boolean;model:string};
const STORAGE='khamtongchaeum-session-v1';
async function request<T=PublicGame>(path:string,body?:unknown):Promise<T>{
  const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(path==='/api/check'?35000:15000)}:{cache:'no-store'});
  const data=await response.json() as T & {error?:string};if(!response.ok)throw new Error(data.error??'เชื่อมต่อไม่ได้ กรุณาลองใหม่');return data;
}
export function useRoom(){
  const [session,setSession]=useState<Session|null>(null),[game,setGame]=useState<PublicGame|null>(null);
  const [provider,setProvider]=useState<ProviderStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[connectionError,setConnectionError]=useState('');
  const current=useRef<Session|null>(null),checking=useRef(false),reading=useRef(false),mounted=useRef(true),lastCheck=useRef(0);
  const accept=useCallback((next:PublicGame)=>{if(current.current?.code!==next.code)return;setGame(previous=>previous?.code===next.code&&previous.revision>next.revision?previous:next);setConnectionError('');},[]);
  const refreshProvider=useCallback(async()=>{try{setProvider(await request<ProviderStatus>('/api/status'));}catch{setProvider(null);}},[]);
  const refresh=useCallback(async()=>{const s=current.current;if(!s||reading.current)return;reading.current=true;try{const next=await request('/api/room',{...s,action:'read'});if(mounted.current)accept(next);}catch(e){if(mounted.current)setConnectionError(e instanceof Error?e.message:'เชื่อมต่อไม่ได้');}finally{reading.current=false;}},[accept]);
  useEffect(()=>{
    mounted.current=true;
    try{const saved=sessionStorage.getItem(STORAGE);if(saved){const s=JSON.parse(saved);if(typeof s.code==='string'&&typeof s.token==='string'){current.current=s;setSession(s);void refresh();}}}catch{/* blocked storage still permits current-tab play */}
    void refreshProvider();return()=>{mounted.current=false;};
  },[refresh,refreshProvider]);
  useEffect(()=>{if(!session)return;const timer=setInterval(()=>{void refresh();},1000);return()=>clearInterval(timer);},[session,refresh]);
  useEffect(()=>{
    if(!game||!session||!provider?.configured||game.manual||checking.current)return;
    if(game.status!=='starting'&&!game.chain.some(w=>!w.syllables))return;
    if(game.serverNow<game.nextCheckAt)return;
    if(Date.now()-lastCheck.current<1500)return;
    lastCheck.current=Date.now();
    checking.current=true;const active=session;
    void request('/api/check',active).catch(()=>{}).finally(()=>{checking.current=false;if(current.current?.code===active.code)void refresh();});
  },[game,session,provider,refresh]);
  const connect=useCallback(async(action:'create'|'join',payload:Record<string,unknown>)=>{
    setBusy(true);setError('');
    const token=crypto.randomUUID()+crypto.randomUUID();
    try{const next=await request('/api/room',{...payload,action,token,commandId:crypto.randomUUID()});const s={code:next.code,token};current.current=s;setSession(s);setGame(next);try{sessionStorage.setItem(STORAGE,JSON.stringify(s));}catch{}return true;}
    catch(e){setError(e instanceof Error?e.message:'เชื่อมต่อไม่ได้');return false;}finally{setBusy(false);}
  },[]);
  const send=useCallback(async(action:string,payload:Record<string,unknown>={})=>{
    const s=current.current;if(!s)return false;setBusy(true);setError('');
    const command={...payload,...s,action,commandId:crypto.randomUUID()};
    try{
      let next:PublicGame;
      try{next=await request('/api/room',command);}catch(e){if(e instanceof TypeError||e instanceof DOMException)next=await request('/api/room',command);else throw e;}
      accept(next);return true;
    }catch(e){setError(e instanceof Error?e.message:'ส่งคำไม่ได้');void refresh();return false;}finally{setBusy(false);}
  },[accept,refresh]);
  const leave=()=>{current.current=null;setSession(null);setGame(null);setError('');setConnectionError('');try{sessionStorage.removeItem(STORAGE);}catch{}};
  return {session,game,provider,busy,error,connectionError,connect,send,leave,refresh,refreshProvider,setError};
}

'use client';
import { useEffect,useRef } from 'react';
import { X } from 'lucide-react';
export function Dialog({title,children,onClose}:{title:string;children:React.ReactNode;onClose:()=>void}){
  const ref=useRef<HTMLDialogElement>(null),close=useRef(onClose);close.current=onClose;
  useEffect(()=>{const d=ref.current;d?.showModal();const handler=()=>close.current();d?.addEventListener('close',handler);return()=>{d?.removeEventListener('close',handler);d?.close();};},[]);
  return <dialog ref={ref} className="dialog" aria-labelledby="dialog-title" onClick={e=>{if(e.target===ref.current)onClose();}}><div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="ปิด"><X size={20}/></button></div>{children}</dialog>;
}

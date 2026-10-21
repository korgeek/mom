import { useEffect, useId, useRef, type ReactNode } from 'react';

export default function SettingsDialog({ title, closeLabel, busy=false, onClose, children, className='', role='dialog' }: {
  title:string;closeLabel:string;busy?:boolean;onClose:()=>void;children:ReactNode;className?:string;role?:'dialog'|'alertdialog';
}) {
  const dialog=useRef<HTMLDialogElement>(null), id=useId();
  useEffect(()=>{
    const node=dialog.current!, opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    node.showModal();node.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')?.focus();
    return ()=>{node.close();if(opener?.isConnected&&!opener.matches(':disabled'))opener.focus();};
  },[]);
  return <dialog ref={dialog} role={role} className={`settings-dialog stack gap16 ${className}`} aria-labelledby={id} onCancel={event=>{event.preventDefault();event.stopPropagation();if(!busy)onClose();}}>
    <header className="row-between"><h2 id={id}>{title}</h2><button type="button" disabled={busy} onClick={onClose}>{closeLabel}</button></header>
    {children}
  </dialog>;
}

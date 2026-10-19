'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {usePartyAction} from './query-actions';
import type {MailInbox} from './mail-inbox';
const control='border border-cyan-700 bg-[#07100f] text-cyan-100 hover:bg-cyan-950';
export function MailboxControls({inbox,tab,onTab}:{inbox:MailInbox;tab:'inbox'|'outbox';onTab:(tab:'inbox'|'outbox')=>void}){
  const action=usePartyAction(),[error,setError]=useState('');
  const settings=inbox.settings||{autoCollect:false,autoDelete:false};
  const mutate=action.mutateAsync;
  useEffect(()=>{if((inbox.newCount||0)>0)void mutate({path:'/mail/seen',body:{}}).catch(e=>setError(String(e.message||e)));},[inbox.newCount,mutate]);
  const save=async(name:'autoCollect'|'autoDelete',checked:boolean)=>{setError('');try{await mutate({path:'/mail/settings',body:{...settings,[name]:checked}});}catch(e){setError(e instanceof Error?e.message:String(e));}};
  return <div className="space-y-3 rounded border border-cyan-800 bg-[#06110f] p-3 text-emerald-50">
    <div className="flex flex-wrap gap-4 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" className="accent-cyan-400 border-cyan-700 bg-[#07100f]" checked={settings.autoCollect} disabled={action.isPending} onChange={e=>void save('autoCollect',e.target.checked)} />Automatically collect mail attachments</label>
      <label className="flex items-center gap-2"><input type="checkbox" className="accent-cyan-400 border-cyan-700 bg-[#07100f]" checked={settings.autoDelete} disabled={action.isPending} onChange={e=>void save('autoDelete',e.target.checked)} />Automatically delete messages after attachments are collected</label>
    </div>
    <div className="flex gap-2"><Button className={control} aria-pressed={tab==='inbox'} onClick={()=>onTab('inbox')}>Inbox</Button><Button className={control} aria-pressed={tab==='outbox'} onClick={()=>onTab('outbox')}>Outbox</Button></div>
    {error&&<p role="alert" className="text-amber-200">{error}</p>}
    {tab==='outbox'&&<section aria-label="Sent mail" className="max-h-[65vh] space-y-3 overflow-y-auto">
      {!inbox.outbox?.length&&<p>No sent mail recorded.</p>}
      {inbox.outbox?.map(mail=><article key={mail.id} className="rounded border border-cyan-800 bg-[#07100f] p-3">
        <h3 className="font-semibold">{mail.subject}</h3><p className="text-sm text-cyan-200">To {mail.recipient} · {new Date(mail.sent).toLocaleString()}</p><p className="whitespace-pre-wrap text-sm">{mail.message}</p>
        {mail.item!=null&&<p className="text-sm text-amber-200">Attachment: {String((mail.item as {name?:string}).name||'item')} × {mail.quantity||1}</p>}
        <Button className={control+' mt-2'} disabled={action.isPending} aria-label={'Delete sent record '+mail.subject} onClick={()=>void mutate({path:'/mail/outbox-delete',body:{id:mail.id}}).catch(e=>setError(String(e.message||e)))}>Delete sent record</Button>
      </article>)}
      <p className="text-xs text-emerald-100/70">Deleting a sent record does not recall the message or its attachment.</p>
    </section>}
  </div>;
}

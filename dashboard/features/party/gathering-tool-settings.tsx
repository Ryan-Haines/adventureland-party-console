"use client";
import {usePartyAction} from './query-actions';
export function GatheringToolSettings({enabled={}}:{enabled?:Record<string,boolean>}){
 const action=usePartyAction();
 return <fieldset disabled={action.isPending} className="space-y-2 rounded-lg border border-slate-600 bg-slate-900 p-4 text-sm text-slate-100">
  <legend className="px-1">Replacement gathering tools</legend>
  {(['fishing','mining'] as const).map(mode=><label key={mode} className="flex items-center gap-2">
   <input type="checkbox" checked={enabled['craft '+mode+' tools']===true} className="size-4 border border-slate-400 bg-slate-950 accent-emerald-400"
    onChange={event=>action.mutate({path:'/merchant/routine-priorities',body:{priorities:{},enabled:{['craft '+mode+' tools']:event.target.checked}}})}/>
   Automatically craft new {mode==='fishing'?'fishing poles':'pickaxes'}
  </label>)}
  <p className="text-xs text-slate-300">When gathering has no tool in inventory or bank, queue one through normal crafting. This may buy materials and spend crafting gold.</p>
  {action.error&&<p role="alert" className="text-rose-200">{action.error.message}</p>}
 </fieldset>;
}

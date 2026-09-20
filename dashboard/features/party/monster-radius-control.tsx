"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
export function MonsterRadiusControl({radius,onSave,context}:{radius:number;onSave:(radius:number)=>Promise<void>;context?:string}) {
 const [draft,setDraft]=useState(String(radius)),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 async function save(){const value=Math.round(Number(draft));if(!Number.isFinite(value)||value<1||value>10000){setError('Enter a radius from 1 to 10,000.');return;}
 setBusy(true);setError(null);try{await onSave(value);setDraft(String(value));}catch(e){setError(e instanceof Error?e.message:'Could not save radius');}finally{setBusy(false);}}
 return <div className="rounded border border-violet-800 bg-[#091614] p-3 text-emerald-50">
 <p className="text-sm text-violet-200">Monster search radius</p>
 <div className="mt-2 flex gap-2"><Input aria-label="Monster search radius" type="number" min={1} max={10000} step={1} value={draft} disabled={busy}
 onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void save();}} className="border-violet-700 bg-[#07100f] text-emerald-50"/>
 <Button type="button" disabled={busy} onClick={()=>void save()} className="border border-violet-400 bg-violet-600 text-white hover:bg-violet-500">{busy?'Saving…':'Set'}</Button></div>
 <p className="mt-2 text-xs text-emerald-100/80">{context} Clearing monster focus resets this to 400.</p>
 <p className="mt-2 text-xs text-emerald-100/80">Targets in the selected spawn zone come first. This radius allows nearby targets only when no eligible targets are visible inside that zone.</p>
 {error&&<p role="alert" className="mt-2 text-sm text-rose-200">{error}</p>}</div>;
}

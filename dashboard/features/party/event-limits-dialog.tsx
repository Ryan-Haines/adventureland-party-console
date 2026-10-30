'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { validEventLimits, type EventLimits } from '@/lib/event-policy';
import {CipherControls,type CipherView} from './cipher-controls';
import {defaultCipherSettings} from '../../../runtime/events/october';
import {NestedItemDetails} from './party-item-details';

const button = 'rounded border border-slate-500 bg-slate-950 px-3 py-2 text-emerald-50 hover:bg-slate-800 disabled:opacity-50';
export function EventLimitsDialog({ event, label, limits, inherited, onClose, onSave, onAnniversary, cipherView, onManual, cipherOwner }: {
  cipherOwner?:string;
  cipherView?:CipherView; onManual?:(mix:string[],limits:EventLimits)=>Promise<unknown>;
  event: string; label: string; limits: EventLimits; inherited: boolean;
  onClose: () => void; onSave: (event: string, limits: EventLimits) => Promise<unknown> | void;
  onAnniversary: () => void;
}) {
  const [deaths, setDeaths] = useState(limits.deathLimit == null ? '' : String(limits.deathLimit));
  const [minutes, setMinutes] = useState(limits.timeLimitMinutes == null ? '' : String(limits.timeLimitMinutes));
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [monsters,setMonsters]=useState(limits.monsters??['zombie','ghoul','gargoyle']);
  const [cipher,setCipher]=useState({...defaultCipherSettings,...limits.cipher});
  const [inspectedIngredient,setInspectedIngredient]=useState<string|null>(null);
  const value:EventLimits = { ...limits, deathLimit: deaths.trim() ? Number(deaths) : null, timeLimitMinutes: minutes.trim() ? Number(minutes) : null,
    ...(event==='graveyard'?{monsters}:{}),...(event==='witchcipher'?{cipher}:{}) };
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className={`max-h-[90vh] overflow-y-auto border border-slate-500 bg-[#101c1a] text-emerald-50 [&_[data-slot=dialog-close]]:border [&_[data-slot=dialog-close]]:border-slate-500 [&_[data-slot=dialog-close]]:bg-slate-950 [&_[data-slot=dialog-close]]:text-emerald-50 [&_[data-slot=dialog-close]]:hover:bg-slate-800 ${event==='witchcipher'?'sm:max-w-2xl':''}`}>
      <DialogHeader><DialogTitle>{label} settings</DialogTitle><DialogDescription className="text-slate-300">Blank means unlimited. Exceeding a limit skips the current event instance, then resumes farming or attends the next eligible event.</DialogDescription></DialogHeader>
      <label className="space-y-2">Death limit<input aria-label="Death limit" type="number" min="0" step="1" value={deaths} disabled={inherited || saving} onChange={e => setDeaths(e.target.value)} placeholder="Unlimited" className="block w-full rounded border border-slate-500 bg-slate-950 p-2 text-emerald-50" /></label>
      <p className="text-xs text-slate-300">Stop rejoining after more than this many deaths. 0 stops after the first death.</p>
      <label className="space-y-2">Time limit (mins)<input aria-label="Time limit (mins)" type="number" min="0.01" step="any" value={minutes} disabled={inherited || saving} onChange={e => setMinutes(e.target.value)} placeholder="Unlimited" className="block w-full rounded border border-slate-500 bg-slate-950 p-2 text-emerald-50" /></label>
      {inherited && <p className="text-amber-200">Using the leader’s event settings.</p>}
      {event==='witchcipher'&&cipherOwner&&<p className="text-amber-200">Shared Cipher policy with {cipherOwner}. Changes here apply to the party.</p>}
      {event==='graveyard'&&<fieldset className="space-y-2 rounded border border-slate-600 bg-slate-950 p-3"><legend className="px-1">Monsters to fight</legend>{[['zombie','Zombie'],['ghoul','Ghoul'],['gargoyle','Gargoyle']].map(([id,name])=><label key={id} className="flex items-center gap-2"><input type="checkbox" checked={monsters.includes(id)} disabled={inherited||saving} onChange={e=>setMonsters(e.target.checked?[...monsters,id]:monsters.filter(value=>value!==id))}/>{name}</label>)}<p className="text-xs text-slate-300">Unchecked monsters will not be pulled. The party can defend itself if attacked.</p></fieldset>}
      {event==='trickortreat'&&<p className="rounded border border-orange-700 bg-slate-950 p-3 text-sm text-orange-100">Visits all seven doors, then resumes the saved farming activity. Each character can knock once per door per UTC day; the account shares a limit of 14 knocks. Resets at 00:00 UTC.</p>}
      {event==='witchcipher'&&<CipherControls value={cipher} onChange={setCipher} view={cipherView} onInspectIngredient={setInspectedIngredient} disabled={inherited||saving} onManual={async mix=>{if(!onManual)throw Error('Merchant submission unavailable');await onManual(mix,value);}}/>}
      {inspectedIngredient&&<NestedItemDetails key={inspectedIngredient} itemId={inspectedIngredient} onClose={()=>setInspectedIngredient(null)}/>}
      {error && <p role="alert" className="text-red-300">{error}</p>}
      {event === 'anniversary' && <button type="button" className={button} onClick={() => { onClose(); onAnniversary(); }}>Anniversary visit settings</button>}
      <div className="flex justify-end gap-2">
        <button type="button" aria-label="Close event settings" disabled={saving} className={button} onClick={onClose}>Close</button>
        {!inherited && <button type="button" disabled={saving || !validEventLimits(value)} className={button} onClick={async () => {
          setSaving(true); setError('');
          try { await onSave(event, value); onClose(); }
          catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
          finally { setSaving(false); }
        }}>Save event settings</button>}
      </div>
    </DialogContent>
  </Dialog>;
}

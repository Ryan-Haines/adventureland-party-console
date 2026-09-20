"use client";
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CharacterPortrait } from './character-portrait';

import { API } from './api';
import type { PartyState } from './party-state';
export function AccountSettings({ state }: { state: PartyState }) {
  const [prefix, setPrefix] = useState(state.bankboiPrefix || ''), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const members = [...(state.roster || []), ...(state.bankbois || []).map(b => ({ name: b.name, ctype: b.ctype || 'merchant', level: b.level }))].filter((v, i, a) => a.findIndex(x => x.name === v.name) === i);
  return <div className="mt-4 space-y-4">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{members.map(member => {
      const live = state.characters[member.name];
      const c = live?.characterSprite || live?.characterDollHtml ? live : state.characterAppearances?.[member.name];
      const characterClass = live?.ctype || member.ctype;
      const level = live?.level ?? member.level;
      return <div key={member.name} className="rounded border border-slate-600 bg-slate-950 p-2 text-center">
        <div className="relative mx-auto h-20 w-16">{c?.characterSprite || c?.characterDollHtml ? <CharacterPortrait html={c.characterDollHtml} sprite={c.characterSprite} skin={c.skin} centered /> : <span className="grid h-full place-items-center text-xs text-slate-400">Appearance saved after first connection</span>}</div>
        <p className="break-all text-sm text-slate-100">{member.name}</p><p className="text-xs text-slate-300"><span className="capitalize">{characterClass}</span> · Lv {level ?? "—"}</p>
      </div>;
    })}{Array.from({length: Math.max(0, 8 - members.length)}, (_, index) => <div key={`empty-${index}`} aria-label="Empty character slot" className="min-h-28 rounded border border-dotted border-slate-500 bg-slate-950 p-2" />)}</div>
    <label className="grid gap-2 text-sm">Default name for bankboi<input aria-label="Default name for bankboi" value={prefix} maxLength={11} onChange={e => {setPrefix(e.target.value);setSaved(false);}} className="rounded border border-slate-500 bg-slate-950 p-2 text-slate-100" /></label>
    <p className="text-xs text-slate-300">Use 3–11 letters, numbers, or underscores. A number is added automatically, such as {prefix || 'MyBank'}0.</p>
    <Button className="border border-slate-500 bg-slate-950 text-slate-100 hover:bg-slate-800" onClick={async () => { setError(''); try {const r = await fetch(`${API}/dashboard-preferences`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bankboiPrefix:prefix.trim()})});if(!r.ok)throw new Error(((await r.json()) as {error:string}).error);setSaved(true);}catch(e){setError(String((e as Error).message));}}}>{saved ? 'Saved' : 'Save name'}</Button>
    {error && <p role="alert" className="text-rose-300">{error}</p>}
  </div>;
}

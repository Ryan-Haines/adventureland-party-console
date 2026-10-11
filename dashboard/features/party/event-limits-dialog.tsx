'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { validEventLimits, type EventLimits } from '@/lib/event-policy';

const button = 'rounded border border-slate-500 bg-slate-950 px-3 py-2 text-emerald-50 hover:bg-slate-800 disabled:opacity-50';
export function EventLimitsDialog({ event, label, limits, inherited, onClose, onSave, onAnniversary }: {
  event: string; label: string; limits: EventLimits; inherited: boolean;
  onClose: () => void; onSave: (event: string, limits: EventLimits) => Promise<unknown> | void;
  onAnniversary: () => void;
}) {
  const [deaths, setDeaths] = useState(limits.deathLimit == null ? '' : String(limits.deathLimit));
  const [minutes, setMinutes] = useState(limits.timeLimitMinutes == null ? '' : String(limits.timeLimitMinutes));
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const value = { deathLimit: deaths.trim() ? Number(deaths) : null, timeLimitMinutes: minutes.trim() ? Number(minutes) : null };
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className="border-slate-500 bg-[#101c1a] text-emerald-50">
      <DialogHeader><DialogTitle>{label} settings</DialogTitle><DialogDescription className="text-slate-300">Blank means unlimited. Exceeding a limit skips the current event instance, then resumes farming or attends the next eligible event.</DialogDescription></DialogHeader>
      <label className="space-y-2">Death limit<input aria-label="Death limit" type="number" min="0" step="1" value={deaths} disabled={inherited || saving} onChange={e => setDeaths(e.target.value)} placeholder="Unlimited" className="block w-full rounded border border-slate-500 bg-slate-950 p-2 text-emerald-50" /></label>
      <p className="text-xs text-slate-300">Stop rejoining after more than this many deaths. 0 stops after the first death.</p>
      <label className="space-y-2">Time limit (mins)<input aria-label="Time limit (mins)" type="number" min="0.01" step="any" value={minutes} disabled={inherited || saving} onChange={e => setMinutes(e.target.value)} placeholder="Unlimited" className="block w-full rounded border border-slate-500 bg-slate-950 p-2 text-emerald-50" /></label>
      {inherited && <p className="text-amber-200">Using the leader’s event settings.</p>}
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

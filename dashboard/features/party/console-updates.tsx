"use client";
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { UpdateStatus } from '../../../tools/update/contracts';

const colors = 'border border-slate-500 bg-slate-950 text-slate-100 hover:bg-slate-800 hover:text-white';
function useUpdates() {
  const [state, setState] = useState<UpdateStatus | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const response = await fetch('/console-update');
        if (!response.ok) throw new Error('Update service is starting or unavailable.');
        const value = await response.json() as UpdateStatus;
        if (alive) { setState(value); setError(''); }
      } catch (e) { if (alive) setError((e as Error).message); }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 3000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  async function action(name: string, value = {}) {
    try {
      setError('');
      const response = await fetch(`/console-update/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
      const reply = await response.json() as { error?: string };
      if (!response.ok) throw new Error(reply.error || 'Update request failed');
    } catch (e) { setError((e as Error).message); }
  }
  return { state, error, action };
}
export function ConsoleUpdateIndicator({ open }: { open(): void }) {
  const { state } = useUpdates();
  if (!state?.available) return null;
  return <button type="button" title="New version available" aria-label="New version available" onClick={() => {
    open();
    let attempts = 0;
    const timer = setInterval(() => {
      const target = document.getElementById('console-updates');
      if (target || ++attempts > 20) { clearInterval(timer); target?.scrollIntoView({ behavior: 'smooth', block: 'end' }); target?.focus({ preventScroll: true }); }
    }, 50);
  }} className="ml-3 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-emerald-300 bg-emerald-700 text-base font-bold text-white hover:bg-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-200">!</button>;
}
export function ConsoleUpdateSettings() {
  const { state, error, action } = useUpdates();
  const busy = !!state && ['checking', 'downloading', 'restarting'].includes(state.phase);
  return <section id="console-updates" tabIndex={-1} className="space-y-3 rounded border border-slate-600 bg-slate-950 p-4 text-sm text-slate-100">
    <h3 className="font-semibold">Adventureland Party Console</h3>
    <p>Installed version: <span className="font-mono">{state?.current || 'Checking…'}</span></p>
    {state?.available && <p className="text-emerald-200">New release available: {state.available} {state.notes && <a href={state.notes} target="_blank" rel="noreferrer" className="underline">Release notes</a>}</p>}
    {state && <p role="status">{state.phase === 'ready' ? 'Update downloaded. Restart when you are ready.' : state.phase === 'restarting' ? 'Pausing work and restarting. This page will reconnect automatically.' : state.phase === 'idle' ? (state.checkedAt ? 'Up to date.' : 'Waiting for the first update check.') : state.phase.replace(/^[a-z]/, c => c.toUpperCase())}</p>}
    <div className="flex flex-wrap gap-2">
      <Button className={colors} disabled={busy || !state} onClick={() => void action('check')}>Check now</Button>
      {state?.available && state.managed && !['ready', 'blocked'].includes(state.phase) && <Button className={colors} disabled={busy} onClick={() => void action('download')}>Download and install update</Button>}
      {state?.managed && ['ready', 'blocked'].includes(state.phase) && <Button className="border border-emerald-500 bg-emerald-950 text-emerald-100 hover:bg-emerald-900 hover:text-white" onClick={() => void action('restart')}>Restart now</Button>}
    </div>
    <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-4 accent-emerald-500" checked={state?.automatic || false} disabled={!state?.managed || busy} onChange={event => void action('preferences', { automatic: event.target.checked })} />Automatically download and install new versions when available</label>
    <p className="text-xs text-slate-300">While running, updates download and wait for Restart now. At startup, enabled automatic updates install before characters start. Local source edits must be reconciled before installing.</p>
    {state && !state.managed && <p className="text-amber-200">Development checkout: update notifications only. Update your source manually, or use the editable release package for managed updates.</p>}
    {(error || state?.error) && <p role="alert" className="text-rose-300">{error || state?.error}</p>}
  </section>;
}

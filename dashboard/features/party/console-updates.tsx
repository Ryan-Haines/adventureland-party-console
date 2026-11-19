"use client";
import { DebugInstanceSettings } from './debug-instance';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hostAction } from './query-actions';
import { Button } from '@/components/ui/button';
import type { UpdateStatus } from '../../../tools/update/contracts';
import { polls, useHidden } from './query-cache';

const colors = 'border border-slate-500 bg-slate-950 text-slate-100 hover:bg-slate-800 hover:text-white';
// One query serves the header's indicator and the settings section, at the status owner's `dashboardPolls`
// updates row. A hidden tab stops polling, and a tab that becomes visible reads at once.
export function useUpdates() {
  // An action's refusal shows until the next action, or until the next status read answers, as
  // b9b5c91e's refresh cleared it.
  const [actionError, setError] = useState({ message: '', at: 0 });
  const hidden = useHidden();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['console-update'],
    queryFn: async ({ signal }) => await hostAction<UpdateStatus>(client, '/console-update', {}, { method: 'GET', signal }),
    enabled: !hidden,
    refetchInterval: polls.updates!.interval,
    retry: false,
  });
  const shownAction = actionError.at > query.dataUpdatedAt ? actionError.message : '';
  const state = query.data ?? null, error = shownAction || (query.isError ? 'Update service is starting or unavailable.' : '');
  async function action(name: string, value = {}) {
    try {
      setError({ message: '', at: 0 });
      await hostAction(client, `/console-update/${name}`, value);
    } catch (e) { setError({ message: (e as Error).message, at: Date.now() }); }
  }
  return { state, error, action };
}
export function ConsoleUpdateIndicator({ open }: { open(): void }) {
  const { state } = useUpdates();
  if (!state?.available) return null;
  return <button type="button" title="New version available" aria-label="New version available" onClick={() => {
    open();
    // The settings dialog mounts the updates section after this press; it scrolls into view the moment
    // it exists, and the dialog closing first ends the wait.
    const show = (target: HTMLElement) => { target.scrollIntoView({ behavior: 'smooth', block: 'end' }); target.focus({ preventScroll: true }); };
    const mounted = document.getElementById('console-updates');
    if (mounted) return show(mounted);
    let opened = false;
    const watch = new MutationObserver(() => {
      const target = document.getElementById('console-updates'), dialog = !!document.querySelector('[role="dialog"]');
      if (target) { watch.disconnect(); show(target); }
      else if (opened && !dialog) watch.disconnect();
      opened ||= dialog;
    });
    watch.observe(document.body, { childList: true, subtree: true });
  }} className="ml-3 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-emerald-300 bg-emerald-700 text-base font-bold text-white hover:bg-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-200">!</button>;
}
export function ConsoleUpdateSettings() {
  const { state, error, action } = useUpdates();
  const busy = !!state && ['checking', 'downloading', 'restarting'].includes(state.phase);
  return <section data-area="console-updates" id="console-updates" tabIndex={-1} className="space-y-3 rounded border border-slate-600 bg-slate-950 p-4 text-sm text-slate-100">
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
    <DebugInstanceSettings />
    {(error || state?.error) && <p role="alert" className="text-rose-300">{error || state?.error}</p>}
  </section>;
}

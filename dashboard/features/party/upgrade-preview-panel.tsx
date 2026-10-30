'use client';
import { useEffect, useRef, useState } from 'react';
import { ContextMenuItem } from '@/components/ui/context-menu';
import { API } from './api';
import { useUpgradeOfferings, type OfferingSource } from './upgrade-offering-controls';
import { upgradeOfferings } from '../../../runtime/upgrade-offerings';
import { previewOptions, type UpgradePreviewResult } from '../../../runtime/upgrade-preview';
import type { Item } from './item';
import { useHidden } from './query-cache';

export function UpgradePreviewPanel({ item, source }: { item: Item; source?: OfferingSource }) {
  const controls = useUpgradeOfferings();
  const refreshBody = useRef<string | null>(null);
  const [revision, refresh] = useState(0);
  const [state, setState] = useState<{key:string; result?:UpgradePreviewResult; status?:string; error?:string}>();
  const body = JSON.stringify({ character:controls?.character, ...source, item });
  const key = `${body}:${controls?.executor}:${revision}`;
  const hidden = useHidden();
  const unavailable = !controls?.executor ? 'No merchant configured'
    : !source || source.equipped || controls.character !== controls.executor ? 'Item not in merchant inventory' : '';
  useEffect(() => {
    // Ticks only read the stored preview (refresh:false). A hidden tab stops
    // them, and a tab that becomes visible reads at once.
    if (unavailable || hidden) return;
    const controller = new AbortController();
    let polling = false;
    async function read(queue = false) {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch(API + '/upgrade-preview', {method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({...JSON.parse(body),refresh:queue}),signal:controller.signal});
        if (response.status === 401 || response.status === 403 || response.redirected) {
          window.dispatchEvent(new Event('party-auth-loss'));
          throw Error('Session expired. Reconnect this browser.');
        }
        const value = await response.json() as {error?:string;result?:UpgradePreviewResult;status?:string};
        if (!response.ok) throw Error(value.error || 'Server preview unavailable');
        if (!controller.signal.aborted) setState({key,result:value.result,status:value.status});
      } catch(error) {
        if (!controller.signal.aborted) setState({key,error:error instanceof Error ? error.message : 'Server preview unavailable'});
      } finally { polling = false; }
    }
    const queue = refreshBody.current === body;
    refreshBody.current = null;
    void read(queue);
    const timer = setInterval(() => void read(), 2000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [body, key, unavailable, hidden]);
  const current = state?.key === key ? state : undefined;
  return <section aria-label="Upgrade chances" className="w-64 max-w-full border-t border-slate-300 !bg-white p-3 text-sm !text-black sm:border-l sm:border-t-0">
    <p className="font-semibold">Next attempt: +{item.level || 0} → +{(item.level || 0)+1}</p>
    <p className="mt-1 text-xs text-black">Server preview{controls?.executor ? ` · ${controls.executor}` : ''}</p>
    <p role="status" className="mt-2 text-xs text-black">{unavailable || current?.error ||
      (current?.status === 'queued' ? 'Queued — waiting for merchant priority' : current?.status === 'running' ? 'Refreshing chances…' :
       current?.status === 'unavailable' ? 'No chances calculated - resolve the missing supplies and refresh' : current?.status === 'partial' ? 'Some chances saved - see unavailable options below' : current?.status === 'complete' ? 'Stored preview — valid until the next upgrade' : current?.status === 'invalidated' ? 'Upgrade performed — refresh chances again' : 'Choose Refresh chances to queue a preview')}</p>
    <dl aria-live="polite" className="mt-3 space-y-3">
      {previewOptions.map(option => {
        const value = current?.result?.options[option];
        return <div key={option} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
          <dt>{option === 'none' ? 'No offering' : upgradeOfferings[option]}</dt>
          <dd className="text-right">{value && 'preview' in value
            ? <><span className="font-mono tabular-nums">{(Math.min(1,value.preview.chance)*100).toFixed(2)}%</span><span className="block text-xs text-black">{new Date(value.observedAt).toLocaleTimeString()}</span></>
            : <span className="block text-xs text-black">{unavailable || current?.error || (value && 'reason' in value ? value.reason : 'Not calculated')}</span>}</dd>
        </div>;
      })}
    </dl>
    <ContextMenuItem className="mt-3 justify-center border border-slate-500 !bg-white !text-black focus:!bg-slate-100 data-highlighted:!bg-slate-100"
      disabled={!!unavailable || current?.status === 'queued' || current?.status === 'running'} closeOnClick={false}
      onClick={() => { refreshBody.current = body; refresh(value => value+1); }}>Refresh chances</ContextMenuItem>
    <p className="mt-3 text-xs text-black">Chances can change before upgrading. The server preview excludes the separate lucky-slot roll bonus.</p>
  </section>;
}

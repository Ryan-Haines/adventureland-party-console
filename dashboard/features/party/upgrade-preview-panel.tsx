'use client';
import { useEffect, useState } from 'react';
import { ContextMenuItem } from '@/components/ui/context-menu';
import { API } from './api';
import { useUpgradeOfferings, type OfferingSource } from './upgrade-offering-controls';
import { upgradeOfferings } from '../../../runtime/upgrade-offerings';
import { previewOptions, type UpgradePreviewResult } from '../../../runtime/upgrade-preview';
import type { Item } from './item';

export function UpgradePreviewPanel({ item, source }: { item: Item; source?: OfferingSource }) {
  const controls = useUpgradeOfferings();
  const [revision, refresh] = useState(0);
  const [state, setState] = useState<{key:string; result?:UpgradePreviewResult; error?:string}>();
  const body = JSON.stringify({ character:controls?.character, ...source, item });
  const key = `${body}:${controls?.executor}:${revision}`;
  const unavailable = !controls?.executor ? 'No merchant configured'
    : !source || source.equipped || controls.character !== controls.executor ? 'Item not in merchant inventory' : '';
  useEffect(() => {
    if (unavailable) return;
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); setState({key,error:'Preview timed out; refresh'}); }, 12000);
    void fetch(API + '/upgrade-preview', {method:'POST',headers:{'Content-Type':'application/json'},body,signal:controller.signal})
      .then(async response => {
        if (response.status === 401 || response.status === 403 || response.redirected) {
          window.dispatchEvent(new Event('party-auth-loss'));
          throw Error('Session expired. Reconnect this browser.');
        }
        const result = await response.json() as UpgradePreviewResult & {error?:string};
        if (!response.ok || response.redirected) throw Error(result.error || 'Server preview unavailable');
        if (!result.options) throw Error('Invalid preview response');
        if (!controller.signal.aborted) setState({key,result});
      }).catch(error => {
        if (!controller.signal.aborted) setState({key,error:error instanceof Error ? error.message : 'Server preview unavailable'});
      }).finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [body, key, unavailable]);
  const current = state?.key === key ? state : undefined;
  return <section aria-label="Upgrade chances" className="w-64 max-w-full border-t border-slate-300 p-3 text-sm text-black sm:border-l sm:border-t-0">
    <p className="font-semibold">Next attempt: +{item.level || 0} → +{(item.level || 0)+1}</p>
    <p className="mt-1 text-xs text-slate-700">Server preview{controls?.executor ? ` · ${controls.executor}` : ''}</p>
    <dl aria-live="polite" className="mt-3 space-y-3">
      {previewOptions.map(option => {
        const value = current?.result?.options[option];
        return <div key={option} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
          <dt>{option === 'none' ? 'No offering' : upgradeOfferings[option]}</dt>
          <dd className="text-right">{value && 'preview' in value
            ? <><span className="font-mono tabular-nums">{(Math.min(1,value.preview.chance)*100).toFixed(2)}%</span><span className="block text-xs text-slate-600">{new Date(value.observedAt).toLocaleTimeString()}</span></>
            : <span className="block text-xs text-slate-600">{unavailable || current?.error || (value && 'reason' in value ? value.reason : 'Loading…')}</span>}</dd>
        </div>;
      })}
    </dl>
    <ContextMenuItem className="mt-3 justify-center border border-slate-400 !bg-white !text-black focus:!bg-slate-100 data-highlighted:!bg-slate-100" disabled={!!unavailable || !current} closeOnClick={false} onClick={() => refresh(value => value+1)}>Refresh chances</ContextMenuItem>
    <p className="mt-3 text-xs text-slate-600">Chances can change before upgrading. The server preview excludes the separate lucky-slot roll bonus.</p>
  </section>;
}

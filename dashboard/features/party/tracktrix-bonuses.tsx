'use client';
import type { Char } from './char';
import { useCharacterData } from './dashboard-live';
import { characterKey } from './dashboard-live';
import { useQueries } from '@tanstack/react-query';

export function SharedTracktrixBonuses({ names }: { names: string[] }) {
  const records = useQueries({ queries: names.map(name => ({ queryKey: characterKey(name, 'diagnostics'), enabled: false,
    staleTime: Infinity, queryFn: (): Partial<Char> => ({}) })) });
  const data = records.slice().sort((a, b) => b.dataUpdatedAt - a.dataUpdatedAt).map(record => record.data?.tracktrix).find(value => value?.active && value.bonuses != null);
  return <TracktrixBonusList data={data && {...data, active: true}} title="Current bonuses for holding a tracktrix" theme="rose" />;
}

export function TracktrixBonuses({ name }: { name: string }) {
  const data = useCharacterData(name, 'diagnostics')?.tracktrix;
  return <TracktrixBonusList data={data} />;
}

export function TracktrixBonusList({ data, title = 'Current Tracktrix bonuses', theme = 'violet' }: { data?: Char['tracktrix']; title?: string; theme?: 'violet' | 'rose' }) {
  const bonuses = Object.entries(data?.bonuses || {}).filter(([, value]) => Number.isFinite(value) && value !== 0);
  return <section className={`rounded border p-3 text-sm ${theme === 'rose' ? 'border-rose-800 bg-[#251218] text-rose-100' : 'border-violet-700 bg-[#101724] text-violet-100'}`}>
    <h4 className="mb-2 font-semibold">{title}</h4>
    {!data || (data.active && data.bonuses === null) ? <p>Waiting for Tracktrix data.</p>
      : !data.active ? <p>Inactive — this character is not receiving Tracktrix bonuses.</p>
      : !bonuses.length ? <p>No stat bonuses unlocked yet.</p>
      : <dl className="grid grid-cols-2 gap-x-4 gap-y-1">{bonuses.map(([stat, value]) =>
        <div key={stat} className="flex justify-between gap-3"><dt>{stat.replaceAll('_', ' ').toUpperCase()}</dt>
          <dd className={`font-mono ${theme === 'rose' ? 'text-rose-200' : 'text-emerald-200'}`}>{value > 0 ? '+' : ''}{value.toLocaleString()}</dd></div>)}</dl>}
  </section>;
}

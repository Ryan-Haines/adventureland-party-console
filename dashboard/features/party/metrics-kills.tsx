'use client';
import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MetricsKillsResponse } from '../../../runtime/status/api.ts';
import type { BestiaryMonster } from './bestiary-monster';
import { pollOf, read, useVisible } from './query-cache';
import { METRIC_DAY_NOTE, metricDay, metricDayStart, shiftMetricDay, validMetricRange } from './metrics-days';
import { MetricsChart, RATE_UNITS, rateLabel } from './metrics-chart';
import { MetricsSelect } from './metrics-controls';
import { MetricsFilter } from './metrics-filter';

interface Props {
  active: boolean; live: boolean; from: number; to: number; clock: number;
  characters: string[]; server: string; catalog?: BestiaryMonster[]; resetAt: number;
  onReset(): void; resetting: boolean; resetDisabled: boolean; resetTitle: string;
}
/** Rate labels normalize the selected observation range, not the latest short
 * bucket. Rare monsters retain useful averages between spawns.
 */
export function MetricsKills(props: Props) {
  const client = useQueryClient(), visible = useVisible();
  const [selected, setSelected] = useState<string[]>([]), [rateMs, setRateMs] = useState(3_600_000);
  const today = metricDay(props.clock);
  const dayFrom = metricDayStart(today), dayTo = metricDayStart(shiftMetricDay(today, 1));
  const valid = validMetricRange(props.from, props.to);
  const query = useQuery({
    queryKey: ['party', 'metrics', 'kills', props.from, props.to, dayFrom, dayTo, props.characters, props.server],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ from: String(props.from), to: String(props.to), dayFrom: String(dayFrom), dayTo: String(dayTo) });
      if (props.characters.length) params.set('characters', props.characters.join(','));
      if (props.server) params.set('servers', props.server);
      return read<MetricsKillsResponse>(client, '/metrics/kills?' + params, signal);
    },
    enabled: props.active && visible && valid && !props.resetDisabled, staleTime: props.live ? pollOf('metrics').staleTime : Infinity, gcTime: pollOf('metrics').gcTime,
    placeholderData: keepPreviousData, retry: false,
  });
  const data = query.data, staleReset = !!data && data.resetAt < props.resetAt;
  const totals = staleReset ? [] : data?.monsters || [];
  const options = useMemo(() => {
    const names = new Map((props.catalog || []).map(monster => [monster.id, monster.name]));
    for (const row of data?.monsters || []) if (!names.has(row.monster)) names.set(row.monster, row.monster);
    return [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [props.catalog, data]);
  const names = new Map(options.map(option => [option.id, option.name]));
  const byMonster = new Map(totals.map(row => [row.monster, row]));
  const monsters = (selected.length ? selected.map(monster => byMonster.get(monster) || { monster, count: 0, total: 0, today: 0 }) : totals)
    .slice().sort((a, b) => b.count - a.count || (names.get(a.monster) || a.monster).localeCompare(names.get(b.monster) || b.monster));
  const unit = RATE_UNITS.find(unit => unit.value === rateMs) || RATE_UNITS[2];
  const daily = monsters.reduce((count, row) => count + row.today, 0);
  const labels = monsters.map(row => {
    const rate = data && data.elapsedMs > 0 ? row.count * rateMs / data.elapsedMs : null;
    // The total is a lifetime count that only a metrics reset clears.
    return { label: names.get(row.monster) || row.monster, total: row.total, detailLabel: 'Lifetime',
      rate: (rate === null ? '—' : rateLabel(rate)) + unit.suffix };
  });
  return <MetricsChart title="Kills" data={monsters.map((row, at) => ({ at, kills: row.count }))} series={[{ key: 'kills', label: 'Kills in selected range', color: '#22d3ee' }]}
    yLabel="Kills" xFormat={value => labels[Math.round(value)]?.label || ''} type="bar" barCategories={labels} logarithmic
    currentValue={{ amount: data && !query.isError ? daily : null, unit: 'today', label: 'Total kills today. ' + METRIC_DAY_NOTE, exact: true }}
    onReset={props.onReset} resetDisabled={props.resetDisabled} resetting={props.resetting} resetTitle={props.resetTitle}
    empty={query.isError ? 'Kills unavailable' : query.isPending ? 'Loading…' : 'No recorded kills'}
    controls={<>
      <MetricsFilter label="Filter monsters" allLabel="All monsters" selected={selected} options={options.map(option => ({ id: option.id, label: option.name }))} onChange={setSelected} />
      <MetricsSelect label="Kill rate unit" value={String(rateMs)} onChange={value => setRateMs(Number(value))} options={RATE_UNITS.map(unit => ({ value: String(unit.value), label: unit.label }))} className="w-32" />
    </>} />;
}

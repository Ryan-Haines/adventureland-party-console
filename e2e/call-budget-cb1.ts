// The model of the call budget's `used`, apart from live-fixtures.ts so
// scripts/tests/call-budget-cb1.test.cjs loads it without the live stack.
import {CALL_WINDOW_MS} from '../runtime/characters/call-budget-limits.ts';
import {used} from '../runtime/characters/call-budget.ts';

// One sampler tick: the server's sum per character, and the budget's `used` where it runs.
export type CallSample = {at: number; server: Record<string, number | null>; calls?: Record<string, [number, string, number][] | null>;
  used: Record<string, BudgetRead | null>};
// One read of a character's budget: its `used`, margin and ledger, and the server figure with the
// time it arrived, all on the character's clock.
export type BudgetRead = {at: number; used: number; margin: number; latest?: number; ledger: {at: number; method: string; cost: number; seq?: number}[]; cc: number | null; ccAt: number | null; ccSeq?: number | null; ccFrom?: number | null};

// The sampler's measures for one character: the
// server sum's peak and 95th percentile over the samples, and the budget's bound. The budget's reads
// come every second or so, and each holds the ledger of the last window and the server figure, so
// `used` is rebuilt at any moment from them with the budget's own rule; each server sample above
// the largest `used` within one margin of it is in `above`, null where the character ran no budget.
export function callMeasures(samples: CallSample[], name: string) {
  const server = samples.map(s => s.server[name]).filter((v): v is number => Number.isFinite(v));
  const sorted = [...server].sort((a, b) => a - b);
  const reads = samples.map(s => s.used[name]).filter((u): u is BudgetRead => !!u);
  // Each read holds the whole ledger of its window, so an entry counts as often as the read that
  // holds it most often has it: on ChronAL's virtual clock a burst books several equal entries in
  // one millisecond (the stand reconcile's 16 unequips), which a set keyed by value counted once.
  const entries = new Map<string, {entry: {at: number; cost: number; seq?: number}; count: number}>(), figures = new Map<number, {value: number; seq: number | null; from: number | null}>();
  for (const read of reads) {
    const counts = new Map<string, number>();
    for (const e of read.ledger ?? []) {
      const key = `${e.at}|${e.method}|${e.cost}`, n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      if ((entries.get(key)?.count ?? 0) < n) entries.set(key, {entry: e, count: n});
    }
    if (read.cc !== null && read.ccAt !== null) figures.set(read.ccAt, {value: read.cc, seq: read.ccSeq ?? null, from: read.ccFrom ?? null});
  }
  const ledger = [...entries.values()].flatMap(({entry, count}) => Array(count).fill(entry) as {at: number; cost: number; seq?: number}[]), ccs = [...figures].sort((a, b) => a[0] - b[0]);
  // The budget's `used`: the ledger keeps each entry the latest round
  // trip longer; a figure holds each entry sent between one window and its own round trip before
  // it arrived (`from`) and each entry booked in its clock step before it, gives each one back as
  // it leaves the window, and adds every entry it does not hold. A read with no `from` (a budget
  // without it) takes the largest margin.
  // The budget keeps an own entry for the window and the largest round trip within it, as it keeps
  // its figure's held entries, so the model reads the reads' margin.
  // On ChronAL's gameplay clock the server runs a handler on its next 250 ms step, so it dates a
  // call up to one step after the client booked it; the round trip the game measured holds only
  // the step's phase at its own ping. The model keeps
  // each entry one step longer, read from the row's own server dates as the smallest gap between
// two of them, as the turns rows read the step from the replies. On the live server the dates fall on
  // any millisecond and the step reads about 1 ms.
  const dates = [...new Set(samples.flatMap(s => (s.calls?.[name] ?? []).map(([at]) => at)))].sort((a, b) => a - b);
  const step = dates.slice(1).reduce((least, at, i) => Math.min(least, at - dates[i]!), Infinity);
  const margin = Math.max(0, ...reads.map(r => r.margin)), latest = margin + (Number.isFinite(step) ? step : 0);
  // `used` at a moment is the budget's own used() (runtime/characters/call-budget.ts) over the
  // ledger booked by then and the latest figure, which holds each entry from one window before it
  // up to its `from`, and the entries booked in its clock step before it. A figure with no seq
  // holds by time alone.
  type Entry = {at: number; method: string; cost: number; seq: number};
  const booked = ledger.map(e => ({method: '', ...e, seq: e.seq ?? NaN}) as Entry);
  const usedAt = (t: number) => {
    const now = booked.filter(e => e.at <= t), last = ccs.filter(([at]) => at <= t).at(-1);
    if (!last) return used({ledger: now, cc: undefined}, t, latest);
    const [at, fig] = last, from = fig.from ?? at - margin, seq = fig.seq ?? Infinity;
    const held = new Set(now.filter(e => e.at >= at - CALL_WINDOW_MS && (e.at <= from || e.at === at && fig.seq !== null && e.seq < fig.seq)));
    const heldCost = [...held].reduce((sum, e) => sum + e.cost, 0);
    return used({ledger: now, cc: {value: fig.value, at, seq, from, held, heldCost}}, t, latest);
  };
  // used() changes only where an entry is booked or leaves the window, or a figure arrives or
  // ages out, so the most within a margin is read at those moments and one millisecond after each.
  const changes = [...booked.flatMap(e => [e.at, e.at + CALL_WINDOW_MS + latest]), ...ccs.flatMap(([at]) => [at, at + CALL_WINDOW_MS])];
  const mostWithin = (from: number, to: number) => [from, to, ...changes.flatMap(at => [at, at + 1])]
    .filter(t => t >= from && t <= to).reduce((most, t) => Math.max(most, usedAt(t)), 0);
  const above = reads.length ? samples.flatMap(s => {
    const value = s.server[name];
    // A sample is judged only where reads cover one margin on both sides of it: the last samples
    // of a run can precede a door's new_map that no read after them saw.
    if (!Number.isFinite(value) || !reads.some(r => r.at >= s.at + margin) || !reads.some(r => r.at <= s.at - margin)) return [];
    const most = mostWithin(s.at - margin, s.at + margin);
    // The sample's server entries beside the ledger's within the window, so the call the ledger
    // did not hold is named.
    return value! > most ? [{ at: s.at, server: value, used: most, calls: s.calls?.[name] ?? null,
      ledger: ledger.filter(e => e.at > s.at - CALL_WINDOW_MS - latest && e.at <= s.at).map(e => [e.at, (e as {method?: string}).method, e.cost]) }] : [];
  }) : null;
  // The server's entries are sums of 0.1 charges (a skill's resends), so a float sum reads 0.1 in
  // tenths: 40.50000000000001 is 40.5.
  const tenths = (v: number | undefined) => v === undefined ? null : Math.round(v * 10) / 10;
  return { samples: server.length, peak: tenths(sorted.at(-1)), p95: tenths(sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1]! : undefined),
    usedSamples: reads.length, step: Number.isFinite(step) ? step : null, above };
}

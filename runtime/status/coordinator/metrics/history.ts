// The metrics history's bucket shape, its merge rules and its resolution table.
// service.ts keeps the buckets; this file decides how
// two buckets merge, how a saved bucket parses, and which width a bucket of a given age holds.
import { requestObject } from '../../../lifecycle/api.ts';
import { HISTORY_KEPT_MS, METRIC_BUCKET_MS, METRIC_RESET_KINDS, type MetricResetKind, metricNumber, metricText, parseMetricSample, type MetricBoundCount, type MetricDeathTotal, type MetricPoint, type MetricTotals } from '../../api.ts';
import { METRIC_ID_CHARS, STATUS_PICKS } from '../../rules.ts';
import { capReached } from '../bounds.ts';

// A kill or loot id, or a loot variant, within METRIC_ID_CHARS; a longer one counts under the cap and
// refuses the bucket like any malformed field.
function idText(value: unknown): value is string {
  if (typeof value === 'string' && value.length > METRIC_ID_CHARS) capReached('METRIC_ID_CHARS', '12');
  return metricText(value, METRIC_ID_CHARS);
}

/** A run of frame sequences that one collector runtime sent: character, runtime, first, last. */
export type ReceiptRun = [character: string, runtime: string, first: number, last: number];

export interface StoredBucket extends MetricPoint {
  width: number;
  // A finest bucket's receipts and event ids dedupe a resent frame or event; a rollup drops both.
  receipts: ReceiptRun[];
  events: { id: string; at: number }[];
  // A v1.5.0 rollup listed each finer bucket it had merged, so a crash between its write and the
  // source's delete could resume. rollUp reads the list and writes none.
  sources?: string[];
}

const history = STATUS_PICKS.metricHistory;
/** Each width the history holds, finest first, with the age at which its buckets move on. */
export const HISTORY_ROWS = [METRIC_BUCKET_MS, ...history.merges.map(row => row.width)].map((width, index) =>
  ({ width, until: history.merges[index]?.after ?? HISTORY_KEPT_MS }));
/** The coarsest width: the account gold history thins its points as each bucket of it starts. */
export const RETENTION_WIDTH = HISTORY_ROWS[HISTORY_ROWS.length - 1].width;
/** The span of one day file: the age of the finest row, so memory holds the finest row and at most
 * one span of the next row (service.ts). Every coarser width divides it. */
export const DAY_SPAN = HISTORY_ROWS[0].until;

export function resetKind(value: unknown): value is MetricResetKind {
  return METRIC_RESET_KINDS.some(kind => kind === value);
}
export const bucketKey =(width: number, at: number) => `${width}:${at}`;
export function copy<T>(value: T): T { return structuredClone(value); }
export function emptyBucket(at: number, width: number): StoredBucket {
  return { at, width, values: [], kills: [], bounds: [], receipts: [], events: [] };
}

/** The width that holds a point of this age, or null once the history no longer keeps it. */
export function widthAt(age: number): number | null {
  return HISTORY_ROWS.find(row => age <= row.until)?.width ?? null;
}

export function hasReceipt(runs: ReceiptRun[], character: string, runtime: string, sequence: number): boolean {
  return runs.some(([name, run, first, last]) => name === character && run === runtime && sequence >= first && sequence <= last);
}
/** Adds sequences to the run they extend or touch, or as a run of their own. A collector numbers its
 * frames in order, so a bucket holds one run per character and runtime. */
export function addReceipt(runs: ReceiptRun[], character: string, runtime: string, first: number, last = first) {
  const run = runs.find(([name, value, start, end]) => name === character && value === runtime && first <= end + 1 && last >= start - 1);
  if (!run) { runs.push([character, runtime, first, last]); return; }
  run[2] = Math.min(run[2], first); run[3] = Math.max(run[3], last);
}

/** Adds a bucket's measurements to the target: its rows, kills and bound firings. */
export function mergeMeasures(target: StoredBucket, source: Pick<StoredBucket, 'values' | 'kills' | 'bounds'>) {
  for (const value of source.values) mergeTotals(target.values, value);
  mergeDeaths(target.kills, source.kills);
  mergeBounds(target.bounds, source.bounds);
}
/** Adds one saved part of a finest bucket (service.ts writes one per commit) with its receipts and
 * event ids. */
export function mergePart(target: StoredBucket, part: StoredBucket) {
  mergeMeasures(target, part);
  target.events.push(...part.events);
  for (const [character, runtime, first, last] of part.receipts) addReceipt(target.receipts, character, runtime, first, last);
}
/**
 * Merges every bucket finer than `width` into the bucket of `width` that holds it, starting from the
 * bucket of that time already there. A bucket that another lists in its v1.5.0 `sources` is already
 * inside that one, so it is left out. The result lists no sources and drops receipts and event ids.
 */
export function rollUp(input: StoredBucket[], width: number): StoredBucket[] {
  const merged = new Set(input.flatMap(bucket => bucket.sources ?? []));
  const result = new Map<string, StoredBucket>();
  const kept = input.filter(bucket => !merged.has(bucketKey(bucket.width, bucket.at)));
  for (const bucket of kept) if (bucket.width >= width) {
    const { sources: _merged, ...rest } = bucket;
    result.set(bucketKey(bucket.width, bucket.at), { ...rest, receipts: [], events: [] });
  }
  for (const bucket of kept) if (bucket.width < width) {
    const at = Math.floor(bucket.at / width) * width, key = bucketKey(width, at);
    const target = result.get(key) ?? emptyBucket(at, width);
    result.set(key, target);
    mergeMeasures(target, bucket);
  }
  return [...result.values()].sort((a, b) => a.at - b.at || a.width - b.width);
}
/** Merges buckets into one per `width`, each spanning from its first bucket's start to its last
 * bucket's end, so a reader of starts and ends sees the span its buckets covered. */
export function binBuckets(input: StoredBucket[], width: number): StoredBucket[] {
  const bins = new Map<number, StoredBucket>();
  for (const bucket of input) {
    const at = Math.floor(bucket.at / width) * width, bin = bins.get(at) ?? emptyBucket(bucket.at, bucket.width);
    const end = Math.max(bin.at + bin.width, bucket.at + bucket.width);
    bin.at = Math.min(bin.at, bucket.at); bin.width = end - bin.at;
    mergeMeasures(bin, bucket);
    bins.set(at, bin);
  }
  return [...bins.values()];
}

function mergeMeasurements(row: MetricTotals, incoming: MetricTotals) {
  for (const hit of incoming.damage) {
    const previous = row.damage.find(value => value.monster === hit.monster && value.skill === hit.skill);
    if (previous) { previous.amount += hit.amount; previous.hits += hit.hits; }
    else row.damage.push(copy(hit));
  }
  for (const item of incoming.loot) {
    const previous = row.loot.find(value => value.item === item.item && value.variant === item.variant);
    if (previous) previous.quantity += item.quantity; else row.loot.push(copy(item));
  }
  for (const credit of incoming.credits) {
    const previous = row.credits.find(value => value.monster === credit.monster);
    if (previous) previous.count += credit.count; else row.credits.push(copy(credit));
  }
}

/** Aggregate sums and exposure, preserving endpoints when history is downsampled. */
export function mergeTotals(target: MetricTotals[], incoming: MetricTotals) {
  const row = target.find(value => value.character === incoming.character && value.server === incoming.server);
  if (!row) { target.push(copy(incoming)); return; }
  row.observedMs += incoming.observedMs;
  row.partial ||= incoming.partial;
  row.samples += incoming.samples;
  row.luckSum += incoming.luckSum;
  row.pingSum += incoming.pingSum;
  row.pingSamples += incoming.pingSamples;
  if (incoming.first.at < row.first.at) row.first = copy(incoming.first);
  if (incoming.last.at > row.last.at) row.last = copy(incoming.last);
  if (incoming.goldStart && (!row.goldStart || incoming.goldStart.at < row.goldStart.at)) row.goldStart = copy(incoming.goldStart);
  mergeMeasurements(row, incoming);
}

export function mergeDeaths(target: MetricDeathTotal[], incoming: MetricDeathTotal[]) {
  for (const kill of incoming) {
    const previous = target.find(value => value.server === kill.server && value.monster === kill.monster && value.actor === kill.actor);
    if (previous) previous.count += kill.count; else target.push(copy(kill));
  }
}

/** Adds each bound's firings to the series, one row per bound and owner. */
export function mergeBounds(target: MetricBoundCount[], incoming: MetricBoundCount[]) {
  for (const firing of incoming) {
    const previous = target.find(value => value.bound === firing.bound && value.owner === firing.owner);
    if (previous) previous.count += firing.count; else target.push(copy(firing));
  }
}

/** A sample's gold baseline with only the fields it carries. */
export function goldBaseline(baseline: Pick<NonNullable<MetricTotals['goldStart']>, 'at' | 'gold'> &
  { goldMovement?: unknown; consumableCost?: unknown; consumablePurchases?: unknown }): NonNullable<MetricTotals['goldStart']> {
  return { at: baseline.at, gold: baseline.gold,
    ...(baseline.goldMovement === undefined ? {} : { goldMovement: Number(baseline.goldMovement) }),
    ...(baseline.consumableCost === undefined ? {} : { consumableCost: Number(baseline.consumableCost) }),
    ...(baseline.consumablePurchases === undefined ? {} : { consumablePurchases: Number(baseline.consumablePurchases) }) };
}

function storedList<T>(value: unknown, error: string, parse: (row: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(value)) throw Error(error);
  return value.map(input => {
    const row = parse(requestObject(input));
    if (!row) throw Error(error);
    return row;
  });
}

function storedGoldStart(input: unknown): NonNullable<MetricTotals['goldStart']> {
  const baseline = requestObject(input);
  if (!metricNumber(baseline.at) || !metricNumber(baseline.gold)) throw Error('Invalid gold baseline');
  if (baseline.goldMovement !== undefined && !metricNumber(baseline.goldMovement, -Number.MAX_SAFE_INTEGER)) throw Error('Invalid gold movement baseline');
  for (const field of ['consumableCost', 'consumablePurchases']) if (baseline[field] !== undefined && !metricNumber(baseline[field])) throw Error('Invalid consumable baseline');
  return goldBaseline({ ...baseline, at: baseline.at, gold: baseline.gold });
}

function storedTotals(value: Record<string, unknown>): MetricTotals {
  const first = parseMetricSample(value.first), last = parseMetricSample(value.last);
  if (!metricText(value.character) || !metricText(value.server) || !first || !last ||
      !metricNumber(value.observedMs) || typeof value.partial !== 'boolean' || !metricNumber(value.samples) ||
      !metricNumber(value.luckSum) || !metricNumber(value.pingSum) || !metricNumber(value.pingSamples)) throw Error('Invalid metrics history totals');
  const damage = storedList(value.damage, 'Invalid damage history', hit => metricText(hit.monster) && metricText(hit.skill) && metricNumber(hit.amount) && metricNumber(hit.hits)
    ? { monster: hit.monster, skill: hit.skill, amount: hit.amount, hits: hit.hits } : null);
  const loot = storedList(value.loot, 'Invalid loot history', item => metricText(item.item) && idText(item.variant) && metricNumber(item.quantity)
    ? { item: item.item, variant: item.variant, quantity: item.quantity } : null);
  const credits = storedList(value.credits, 'Invalid credit history', credit => metricText(credit.monster) && metricNumber(credit.count)
    ? { monster: credit.monster, count: credit.count } : null);
  return { character: value.character, server: value.server, first, last, observedMs: value.observedMs, partial: value.partial,
    samples: value.samples, luckSum: value.luckSum, pingSum: value.pingSum, pingSamples: value.pingSamples, damage, loot, credits,
    ...(value.goldStart === undefined ? {} : { goldStart: storedGoldStart(value.goldStart) }) };
}

/** A saved receipt run, or a v1.5.0 receipt id (`JSON.stringify([character, runtime, sequence])`) as a run of one. */
function receiptRun(entry: unknown): ReceiptRun {
  const run = typeof entry === 'string' ? JSON.parse(entry) as unknown : entry;
  if (!Array.isArray(run) || !metricText(run[0]) || !metricText(run[1]) || !metricNumber(run[2])) throw Error('Invalid metrics history receipt');
  const last: unknown = run.length === 4 ? run[3] : run[2];
  if (!metricNumber(last)) throw Error('Invalid metrics history receipt');
  return [run[0], run[1], run[2], last];
}
function storedReceipts(value: unknown): ReceiptRun[] {
  if (!Array.isArray(value)) throw Error('Invalid metrics history envelope');
  const runs: ReceiptRun[] = [];
  for (const entry of value) addReceipt(runs, ...receiptRun(entry));
  return runs;
}

/** A saved bucket, refused whole when any field is malformed. */
export function storedBucket(value: unknown): StoredBucket {
  const row = requestObject(value);
  const strings = (list: unknown) => Array.isArray(list) && list.every(entry => typeof entry === 'string');
  if (!metricNumber(row.at) || !metricNumber(row.width) || (row.sources !== undefined && !strings(row.sources)))
    throw Error('Invalid metrics history envelope');
  const values = storedList(row.values, 'Invalid metrics history envelope', storedTotals);
  const kills = storedList(row.kills, 'Invalid kill history', kill => metricText(kill.server) && metricText(kill.monster) && metricText(kill.actor) && metricNumber(kill.count)
    ? { server: kill.server, monster: kill.monster, actor: kill.actor, count: kill.count } : null);
  // A bucket saved before the bound series holds no firings.
  const bounds = row.bounds === undefined ? [] : storedList(row.bounds, 'Invalid bound history', firing =>
    metricText(firing.bound) && metricText(firing.owner) && metricNumber(firing.count)
      ? { bound: firing.bound, owner: firing.owner, count: firing.count } : null);
  const events = storedList(row.events, 'Invalid metrics event identity', event => idText(event.id) && metricNumber(event.at)
    ? { id: event.id, at: event.at } : null);
  return { at: row.at, width: row.width, values, kills, bounds, events, receipts: storedReceipts(row.receipts),
    ...(row.sources === undefined ? {} : { sources: row.sources as string[] }) };
}

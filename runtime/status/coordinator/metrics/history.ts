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

export interface StoredBucket extends MetricPoint {
  width: number;
  receipts: string[];
  events: { id: string; at: number }[];
  sources: string[];
}

const history = STATUS_PICKS.metricHistory;
/** Each width the history holds, finest first, with the age at which its buckets move on. */
export const HISTORY_ROWS = [METRIC_BUCKET_MS, ...history.merges.map(row => row.width)].map((width, index) =>
  ({ width, until: history.merges[index]?.after ?? HISTORY_KEPT_MS }));
/** The coarsest width: the retention pass runs as each bucket of it starts, so a finer bucket is
 * read past its row's age by at most this long. */
export const RETENTION_WIDTH = HISTORY_ROWS[HISTORY_ROWS.length - 1].width;

export function resetKind(value: unknown): value is MetricResetKind {
  return METRIC_RESET_KINDS.some(kind => kind === value);
}
export const bucketKey =(width: number, at: number) => `${width}:${at}`;
export function copy<T>(value: T): T { return structuredClone(value); }
export function emptyBucket(at: number, width: number): StoredBucket {
  return { at, width, values: [], kills: [], bounds: [], receipts: [], events: [], sources: [] };
}

/** The width that holds a point of this age, or null once the history no longer keeps it. */
export function widthAt(age: number): number | null {
  return HISTORY_ROWS.find(row => age <= row.until)?.width ?? null;
}
/** The next coarser width a bucket of this width merges into, or null for the coarsest. */
export function parentWidth(width: number): number | null {
  const index = HISTORY_ROWS.findIndex(row => row.width === width);
  return HISTORY_ROWS[index + 1]?.width ?? null;
}
/** The age past which a bucket of this width leaves its row. */
export function rowUntil(width: number): number {
  return HISTORY_ROWS.find(row => row.width === width)?.until ?? HISTORY_KEPT_MS;
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

/** A saved bucket, refused whole when any field is malformed. */
export function storedBucket(value: unknown): StoredBucket {
  const row = requestObject(value);
  const strings = (list: unknown) => Array.isArray(list) && list.every(entry => typeof entry === 'string');
  if (!metricNumber(row.at) || !metricNumber(row.width) || !strings(row.receipts) || !strings(row.sources))
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
  return { at: row.at, width: row.width, values, kills, bounds, events, receipts: row.receipts as string[], sources: row.sources as string[] };
}

import { CoordinatorJsonlStore } from '../../../settings/coordinator/api.ts';
import { requestObject, type HttpHandler, type HttpRouter } from '../../../lifecycle/api.ts';
import { METRIC_BUCKET_MS, METRIC_RESET_KINDS, type MetricsKillsResponse, type MonsterKillSummary, type MetricResetKind, type MetricResets, type MetricDeathTotal, type MetricFrame, type MetricPoint, type MetricTotals, type MetricsResponse, type AccountGoldPoint } from '../../api.ts';
import { metricNumber, metricText } from '../../api.ts';
import { ERASE_YIELD_BUCKETS, chartWidth } from '../../rules.ts';
import { createMeasurementIndex } from './measurement-index.ts';
import { DAY_SPAN, HISTORY_ROWS, RETENTION_WIDTH, addReceipt, binBuckets, bucketKey, copy, emptyBucket, goldBaseline, hasReceipt, mergeBounds, mergeDeaths, mergePart, mergeTotals,
  resetKind, rollUp, storedBucket, widthAt, type StoredBucket } from './history.ts';
import { dayFile, dayRecord, readDay, removeDay, removeUnnamed, storedDayRecord, writeDay, type DayRecord } from './days.ts';
import { installMetricsRoutes } from './http.ts';
import { boundSeries, capReached, type BoundFiring } from '../bounds.ts';

interface Ports { owned(name: string): boolean; now(): number; warn(error: unknown): void; accountGold?(): number | null;
  // The status owner's run scope handle (application.ts `scopes.observe12`): the bucket timer,
  // the long passes' yields and the journal store's compaction turn go through it, so the run's
  // stop ends them.
  timers: ConstructorParameters<typeof CoordinatorJsonlStore>[2] }

/** A frame's totals for one character, with the measurements before each reset cut left out. */
function incomingTotals(character: string, server: string, frame: MetricFrame, resets: MetricResets): MetricTotals {
  const cut = (kind: MetricResetKind) => resets[kind] || 0;
  const incoming: MetricTotals = { character, server, observedMs: frame.observedMs, partial: frame.partial,
    first: copy(frame.first), last: copy(frame.last), damage: frame.first.at >= cut('damage') ? frame.damage : [],
    credits: frame.first.at >= cut('kills') ? frame.credits : [], loot: [], samples: 1,
    luckSum: frame.last.luck, pingSum: frame.last.at >= cut('ping') ? frame.last.ping ?? 0 : 0,
    pingSamples: frame.last.at >= cut('ping') && frame.last.ping !== null ? 1 : 0 };
  if (frame.first.at < cut('gold')) { incoming.first.gold = 0; delete incoming.first.goldMovement; }
  if (frame.last.at < cut('gold')) { incoming.last.gold = 0; delete incoming.last.goldMovement; }
  else incoming.goldStart = goldBaseline(frame.first.at >= cut('gold') ? frame.first : frame.last);
  if (frame.first.at < cut('ping')) incoming.first.ping = null;
  if (frame.last.at < cut('ping')) incoming.last.ping = null;
  return incoming;
}

/** Whether a reset of these kinds changes this bucket. */
function resetChanges(bucket: StoredBucket, kinds: MetricResetKind[]): boolean {
  return (kinds.includes('kills') && bucket.kills.length > 0) || bucket.values.some(row =>
    (kinds.includes('kills') && row.credits.length > 0) || (kinds.includes('damage') && row.damage.length > 0) ||
    (kinds.includes('loot') && row.loot.length > 0) || (kinds.includes('gold') && (row.first.gold !== 0 || row.last.gold !== 0 || row.goldStart !== undefined)) ||
    (kinds.includes('ping') && (row.first.ping !== null || row.last.ping !== null || row.pingSamples > 0)));
}
function resetRow(row: MetricTotals, kinds: MetricResetKind[]) {
  if (kinds.includes('kills')) row.credits = [];
  if (kinds.includes('damage')) row.damage = [];
  if (kinds.includes('loot')) row.loot = [];
  if (kinds.includes('gold')) {
    row.first.gold = row.last.gold = 0;
    delete row.first.goldMovement; delete row.last.goldMovement; delete row.goldStart;
  }
  if (kinds.includes('ping')) { row.first.ping = row.last.ping = null; row.pingSum = row.pingSamples = 0; }
}

/** The metrics service. A disk or startup failure leaves the saved history as it was, keeps party
 * coordination running, and the metrics routes answer 503. */
export function openMetricsService(path: string, ports: Ports & { unavailable(error: unknown): void }) {
  try {
    return createMetricsService(path, ports);
  } catch (error) {
    ports.unavailable(error);
    return { close() {}, install(router: HttpRouter) {
      const unavailable: HttpHandler = (_request, response) => response.status(503).json({ error: 'Metrics storage unavailable' });
      router.get('/party-api/metrics', unavailable); router.post('/party-api/metrics', unavailable);
      router.post('/party-api/metrics/reset', unavailable);
      router.get('/party-api/metrics/kills', unavailable);
      router.get('/party-api/metrics/bars', unavailable);
      router.get('/party-api/metrics/account-gold', unavailable);
    } };
  }
}

export function createMetricsService(path: string, ports: Ports) {
  // The journal is the settings owner's store: it appends each record as it is set and
  // compacts on its own growth rule, so the metrics keep no store or compaction timer of their
  // own.
  const store = new CoordinatorJsonlStore(path, path + '.compact', ports.timers);
  const folder = path + '.days';
  // One turn of the event loop on the run scope, so socket and status work run during a long pass.
  const yieldTurn = () => new Promise<void>(resolve => { ports.timers.setTimeout(() => resolve()); });
  const warn = (error: unknown) => ports.warn(error);
  const [finest, next] = HISTORY_ROWS;
  // Memory holds the finest row's buckets, each the sum of its saved parts (`parts`), and the next
  // row's buckets until their day's file is written (docs/metrics.md, Delivery and retention).
  // Older days stay on disk, and the journal keeps a record of each (`days`).
  const buckets = new Map<string, StoredBucket>();
  const parts = new Map<string, string[]>();
  const days = new Map<number, DayRecord>();
  const accountGold = new Map<number, AccountGoldPoint>();
  const measurements = createMeasurementIndex();
  const killTotals = new Map<string, MetricDeathTotal>();
  // The kills of the days that left the history, through the last one folded in. The lifetime total
  // is this base, the day records after `through` and the buckets in memory.
  let killBase: { totals: MetricDeathTotal[]; through: number } = { totals: [], through: 0 };
  function indexDeaths(deaths: MetricDeathTotal[], direction: 1 | -1 = 1) {
    for (const death of deaths) {
      const key = JSON.stringify([death.server, death.actor, death.monster]);
      const count = (killTotals.get(key)?.count || 0) + direction * death.count;
      if (count > 0) killTotals.set(key, { ...death, count }); else killTotals.delete(key);
    }
  }
  const validDeaths = (list: unknown[]) => list.map(requestObject).filter(death => metricText(death.server) && metricText(death.monster) &&
    metricText(death.actor) && metricNumber(death.count)) as unknown as MetricDeathTotal[];
  const savedResetState = requestObject(store.peek('resetState'));
  const resets: MetricResets = {};
  for (const kind of METRIC_RESET_KINDS) {
    const at = requestObject(savedResetState.cuts)[kind];
    if (metricNumber(at)) resets[kind] = at;
  }
  const savedStart = store.peek('startedAt');
  const startedAt = metricNumber(savedStart) ? savedStart : ports.now();
  const dayOf = (at: number) => Math.floor(at / DAY_SPAN) * DAY_SPAN;
  /** The journal records a bucket in memory is made of. */
  const recordsOf = (key: string) => parts.get(key) ?? ['bucket:' + key];
  function forget(key: string) {
    for (const record of recordsOf(key)) store.delete(record);
    buckets.delete(key); parts.delete(key);
  }
  // A malformed saved record costs that record, reported through `warn`, and the rest of the history
  // loads. A part of a finest bucket (`part:`), and v1.5.0's whole finest bucket (`bucket:`), add to
  // that bucket.
  const loadedParts = new Map<string, { key: string; part: StoredBucket }[]>();
  function restoreBucket(key: string) {
    const bucket = storedBucket(store.peek(key)), at = bucketKey(bucket.width, bucket.at);
    if (bucket.width !== finest.width) { buckets.set(at, bucket); return; }
    loadedParts.set(at, [...(loadedParts.get(at) ?? []), { key, part: bucket }]);
  }
  // A bucket start writes the span's part before it deletes the span's batch parts, so a crash
  // between them leaves batch parts whose frames the span's part holds: the parts merge largest
  // first, and a part whose every receipt is already held is that leftover.
  function mergeParts() {
    const runs = (part: StoredBucket) => part.receipts.reduce((sum, run) => sum + run[3] - run[2] + 1, 0);
    const held = (bucket: StoredBucket, part: StoredBucket) => part.receipts.length > 0 && part.receipts.every(([character, runtime, first, last]) =>
      Array.from({ length: last - first + 1 }, (_, index) => first + index).every(sequence => hasReceipt(bucket.receipts, character, runtime, sequence)));
    for (const [at, loaded] of loadedParts) {
      loaded.sort((a, b) => runs(b.part) - runs(a.part));
      const list: string[] = [];
      for (const { key, part } of loaded) {
        const bucket = buckets.get(at);
        if (!bucket) { buckets.set(at, part); list.push(key); continue; }
        if (held(bucket, part)) { store.delete(key); continue; }
        mergePart(bucket, part); list.push(key);
      }
      parts.set(at, list);
    }
  }
  function restoreRecord(key: string) {
    if (key.startsWith('part:') || key.startsWith('bucket:')) { restoreBucket(key); return; }
    if (key.startsWith('day:')) { const record = storedDayRecord(store.peek(key)); days.set(record.day, record); return; }
    if (!key.startsWith('accountGold:')) return;
    const point = requestObject(store.peek(key));
    if (!metricNumber(point.at) || (point.total !== null && !metricNumber(point.total))) throw Error('Invalid account gold history');
    accountGold.set(point.at, { at: point.at, total: point.total });
  }
  // Each step a crash can cut short leaves records this removes: a day expiry its record (at or
  // before `through`), a day close its buckets, a minute roll its finest buckets (the next row's
  // bucket is written whole, with no v1.5.0 `sources`), a v1.5.0 rollup the sources it lists.
  function removeLeftovers() {
    for (const day of days.keys()) if (day <= killBase.through) { store.delete('day:' + day); days.delete(day); }
    removeUnnamed(folder, new Set([...days.values()].map(record => record.file)));
    for (const [key, bucket] of buckets) {
      const parent = buckets.get(bucketKey(next.width, Math.floor(bucket.at / next.width) * next.width));
      if (days.has(dayOf(bucket.at)) || (bucket.width === finest.width && parent && !parent.sources)) forget(key);
    }
    for (const key of new Set([...buckets.values()].flatMap(bucket => bucket.sources ?? []))) if (buckets.has(key)) forget(key);
  }
  function restore() {
    if (savedStart === undefined) store.set('startedAt', startedAt);
    for (const key of store.keys()) {
      try { restoreRecord(key); } catch (error) { ports.warn(Error(`Skipped the saved metrics record ${key}: ${(error as Error).message}`)); }
    }
    mergeParts();
    const saved = store.peek('killTotals');
    if (!Array.isArray(saved) && Array.isArray(requestObject(saved).totals) && metricNumber(requestObject(saved).through))
      killBase = { totals: validDeaths(requestObject(saved).totals as unknown[]), through: requestObject(saved).through as number };
    removeLeftovers();
    // v1.5.0 saved the lifetime list itself, the buckets' kills included; the base keeps the rest.
    // A journal from before that list has no base, so its total is its buckets'.
    if (Array.isArray(saved)) {
      indexDeaths(validDeaths(saved));
      for (const bucket of buckets.values()) indexDeaths(bucket.kills, -1);
      killBase = { totals: [...killTotals.values()], through: 0 };
      store.set('killTotals', killBase);
      killTotals.clear();
    }
  }
  try { restore(); } catch (error) { store.close(); throw error; }
  indexDeaths(killBase.totals);
  // `closing` holds from the close's start: the routes answer 503 and touch no store, so a POST that
  // the shutdown's HTTP server still takes keeps its frames in the collector's outbox for the next
  // process.
  const state = { lastReceivedAt: null as number | null, unavailable: false, resetting: false, closing: false };
  function storageFailed(error: unknown) { if (!state.unavailable) ports.warn(error); state.unavailable = true; }
  const allCharacters = new Set<string>(), allServers = new Set<string>();
  for (const record of days.values()) {
    indexDeaths(record.kills); measurements.addIndexed(record.damage, record.loot);
    for (const name of record.characters) allCharacters.add(name);
    for (const name of record.servers) allServers.add(name);
  }
  for (const bucket of buckets.values()) {
    indexDeaths(bucket.kills); measurements.add(bucket.values);
    for (const row of bucket.values) { allCharacters.add(row.character); allServers.add(row.server); }
  }
  // Accepted frames (docs/efficiency.md, Metrics history compaction). A POST writes its frames as
  // one part per bucket before it answers, so the answer names a commit already on disk and the
  // collector drops those frames from its outbox at once: the game's local_cm_logic walks every
  // localStorage key every 16 ms, and the outbox keeps a key per frame it holds. The write is one
  // synchronous append; a POST that waited for a shared commit delayed the status and combat
  // requests the characters of one browser send on the same connections (live-hunt-sparkbot-follow
  // lost its target selection in 3-4 of the status owner runs). The next metrics bucket's start
  // writes each bucket's frames and bound firings since the last start (`pending`) as one part and
  // deletes that span's batch parts, so the journal keeps about two parts per bucket. Each
  // answer names its commit (`commit`) and the last commit on disk (`durableCommit`), both counted
  // within this process (`commitEpoch`); the collector keeps a frame until an answer from the same
  // process shows its commit on disk.
  const pending = new Map<string, StoredBucket>();
  // The batch parts written since each bucket's last start, which its consolidated part replaces.
  const batchParts = new Map<string, string[]>();
  const commitEpoch = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  const commits = { durable: 0, parts: 0 };
  /** A bucket's part in `target`: the frames since the last bucket start, or one batch's. */
  function partOf(target: Map<string, StoredBucket>, key: string, at: number) {
    let part = target.get(key);
    if (!part) target.set(key, part = emptyBucket(at, finest.width));
    return part;
  }
  /** The finest bucket that holds `at`, held in memory from its first frame. */
  function finestBucket(at: number) {
    const key = bucketKey(finest.width, at);
    let bucket = buckets.get(key);
    if (!bucket) { buckets.set(key, bucket = emptyBucket(at, finest.width)); parts.set(key, []); }
    return { key, bucket };
  }
  /** Saves a part of a finest bucket as a record of its own; answers the record's key. */
  function savePart(key: string, part: StoredBucket): string | null {
    const list = parts.get(key);
    // A part whose bucket rolled while the store was out is already in the rolled bucket.
    if (!list) return null;
    const record = `part:${part.at}:${commitEpoch}:${++commits.parts}`;
    store.set(record, part); list.push(record);
    return record;
  }
  // One POST's frames, one part per bucket. A write that throws answers 503; the frames stay in
  // memory and `pending`, so the bucket start writes them.
  function writeBatch(batch: Map<string, StoredBucket>) {
    for (const [key, part] of batch) {
      const record = savePart(key, part);
      if (record) batchParts.set(key, [...(batchParts.get(key) ?? []), record]);
    }
    commits.durable++;
  }
  // Each bucket's span since its last start becomes one part, written before its batch parts go, so
  // a crash between the two leaves parts that restore skips by their receipts. A commit that throws
  // keeps the rest pending for the next bucket start. Answers whether it wrote, which ends an outage.
  function commit(): boolean {
    if (!pending.size) return false;
    for (const [key, part] of pending) {
      if (savePart(key, part)) for (const record of batchParts.get(key) ?? []) {
        store.delete(record);
        const list = parts.get(key)!;
        list.splice(list.indexOf(record), 1);
      }
      batchParts.delete(key); pending.delete(key);
    }
    commits.durable++;
    return true;
  }
  // A kill or a drop counts once by its id (the kill's id, not a 5 s window); a resent
  // event lands in its own bucket or a neighbour.
  function seen(id: string, at: number) {
    const start = Math.floor(at / finest.width) * finest.width;
    for (const time of [start - finest.width, start, start + finest.width])
      if (buckets.get(bucketKey(finest.width, time))?.events.some(event => event.id === id)) return true;
    return false;
  }
  function acceptEvents(server: string, frame: MetricFrame, targets: StoredBucket[], incoming: MetricTotals): MetricDeathTotal[] {
    const bucket = targets[0]!;
    const fresh = (id: string, at: number) => !seen(id, at) && !bucket.events.some(value => value.id === id);
    const deaths: MetricDeathTotal[] = [];
    const counted = (event: { id: string; at: number }) => { for (const target of targets) target.events.push({ id: event.id, at: event.at }); };
    for (const event of frame.kills) {
      if (event.at < (resets.kills || 0) || !fresh(event.id, event.at)) continue;
      // Store a death once, attributed to the native attacker even when a tank
      // or healer reports it. Uninstrumented party members remain labelled.
      const death = { server, monster: event.monster, actor: event.actor, count: 1 };
      for (const target of targets) mergeDeaths(target.kills, [death]);
      counted(event); deaths.push(death);
    }
    for (const event of frame.loot) {
      if (event.at < (resets.loot || 0) || !fresh(event.id, event.at)) continue;
      incoming.loot.push({ item: event.item, variant: event.variant, quantity: event.quantity });
      counted(event);
    }
    return deaths;
  }
  /** Adds a frame to its bucket, the bucket's pending span and this POST's batch. */
  function accept(character: string, server: string, runtime: string, frame: MetricFrame, batch: Map<string, StoredBucket>) {
    const allResetAt = Math.min(...METRIC_RESET_KINDS.map(kind => resets[kind] || 0));
    if (frame.last.at < allResetAt) return;
    const held = buckets.get(bucketKey(finest.width, frame.at));
    if (held && hasReceipt(held.receipts, character, runtime, frame.sequence)) return;
    const { key, bucket } = finestBucket(frame.at), targets = [bucket, partOf(pending, key, frame.at), partOf(batch, key, frame.at)];
    const incoming = incomingTotals(character, server, frame, resets);
    const deaths = acceptEvents(server, frame, targets, incoming);
    for (const target of targets) { mergeTotals(target.values, incoming); addReceipt(target.receipts, character, runtime, frame.sequence); }
    allCharacters.add(character); allServers.add(server);
    indexDeaths(deaths);
    measurements.add([incoming]);
  }
  // A kept safety bound's firing counts in the finest bucket of its time, a series the history keeps
  // and merges like the kills (bounds.ts `boundSeries`); the next bucket start writes it.
  function countBound(firing: BoundFiring) {
    const { key, bucket } = finestBucket(Math.floor(ports.now() / finest.width) * finest.width);
    const count = [{ bound: firing.bound, owner: firing.owner, count: 1 }];
    mergeBounds(bucket.bounds, count); mergeBounds(partOf(pending, key, bucket.at).bounds, count);
  }
  boundSeries(countBound);
  function retainGold(now: number) {
    const retained = new Map<string, AccountGoldPoint>();
    for (const point of accountGold.values()) {
      const width = widthAt(now - point.at);
      if (width === null) continue;
      const key = width + ':' + Math.floor(point.at / width), previous = retained.get(key);
      if (!previous || point.at > previous.at) retained.set(key, point);
    }
    const kept = new Set([...retained.values()].map(point => point.at));
    for (const at of accountGold.keys()) if (!kept.has(at)) { accountGold.delete(at); store.delete('accountGold:' + at); }
  }
  /** Rolls each minute whose last finest bucket is past the finest row's age into one bucket of the
   * next row, written once, then deletes the minute's parts. */
  function rollMinutes(now: number) {
    const due = new Map<number, string[]>();
    for (const [key, bucket] of buckets) if (bucket.width === finest.width) {
      const at = Math.floor(bucket.at / next.width) * next.width;
      if (now - (at + next.width) > finest.until) due.set(at, [...(due.get(at) ?? []), key]);
    }
    for (const [at, keys] of [...due].sort((a, b) => a[0] - b[0])) {
      const key = bucketKey(next.width, at), held = buckets.get(key);
      const [rolled] = rollUp([...(held ? [held] : []), ...keys.map(source => buckets.get(source)!)], next.width);
      store.set('bucket:' + key, rolled); buckets.set(key, rolled!);
      for (const source of keys) forget(source);
    }
  }
  // Day work (closing, rolling, expiring and erasing days) and the reads of day files run one at a
  // time, so a query never reads a file that a roll is replacing.
  let chain: Promise<unknown> = Promise.resolve();
  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = chain.then(work);
    chain = result.catch(() => undefined);
    return result;
  }
  /** The width a day's buckets hold by the age of its end, or null once the history keeps none of it. */
  const dayWidth = (day: number, now: number) => widthAt(now - (day + DAY_SPAN));
  function dayWorkDue(now: number) {
    for (const bucket of buckets.values()) if (bucket.width !== finest.width && dayWidth(dayOf(bucket.at), now) !== finest.width) return true;
    for (const record of days.values()) if (dayWidth(record.day, now) !== record.width) return true;
    return false;
  }
  /** Writes a day's buckets at `width` as its file and record, written before the sources go. */
  async function saveDay(day: number, width: number, held: StoredBucket[]) {
    const rolled = rollUp(held, width), file = dayFile(day, width);
    await writeDay(folder, file, rolled);
    const record = dayRecord(day, file, width, rolled);
    store.set('day:' + day, record); days.set(day, record);
    return record;
  }
  // A day leaves the history once its last bucket is past the history's age. Its kills join the base
  // before its record goes, and `through` names the day, so a crash between the two counts it once.
  async function expireDay(record: DayRecord) {
    mergeDeaths(killBase.totals, record.kills);
    killBase.through = Math.max(killBase.through, record.day);
    store.set('killTotals', killBase);
    store.delete('day:' + record.day); days.delete(record.day);
    measurements.addIndexed(record.damage, record.loot, -1);
    await removeDay(folder, record.file);
  }
  // A day closes once every minute of it has rolled: its next-row buckets leave the journal for its
  // file. A day file moves to the next row, whole, once the day's end is past its row's age.
  async function closeDays(now: number) {
    const closing = new Map<number, string[]>();
    for (const [key, bucket] of buckets) if (bucket.width !== finest.width && dayWidth(dayOf(bucket.at), now) !== finest.width)
      closing.set(dayOf(bucket.at), [...(closing.get(dayOf(bucket.at)) ?? []), key]);
    for (const [day, keys] of [...closing].sort((a, b) => a[0] - b[0])) {
      // v1.5.0 kept buckets past the history's age until its next pass; they close at the coarsest
      // width and expire below.
      await saveDay(day, dayWidth(day, now) ?? HISTORY_ROWS[HISTORY_ROWS.length - 1]!.width, keys.map(key => buckets.get(key)!));
      for (const key of keys) forget(key);
    }
  }
  async function maintainDays() {
    const now = ports.now();
    // The same clock rolls the minutes first, so a closing day holds every minute of it.
    rollMinutes(now);
    await closeDays(now);
    for (const record of [...days.values()].sort((a, b) => a.day - b.day)) {
      const width = dayWidth(record.day, now);
      if (width === record.width) continue;
      if (width === null) { await expireDay(record); continue; }
      const saved = await saveDay(record.day, width, await readDay(folder, record.file, warn));
      if (saved.file !== record.file) await removeDay(folder, record.file);
    }
  }
  let dayWork: Promise<void> | undefined;
  // A reset's erasure reads the buckets in passes, so nothing moves while it runs.
  function moveOn(now: number) {
    if (state.resetting) return;
    try { rollMinutes(now); } catch (error) { storageFailed(error); }
    if (dayWork || !dayWorkDue(now)) return;
    dayWork = exclusive(maintainDays).catch(storageFailed).finally(() => { dayWork = undefined; });
  }
  // One timer, at each metrics bucket's start: the commit writes the bucket before, the minutes and
  // days past their row's age move on, and the account gold history takes its one point for the
  // bucket and thins its points as each bucket of the coarsest width starts. Collection belongs to
  // the coordinator, so closing the dashboard cannot stop it.
  let timer: number | undefined;
  let retainedSlot = Math.floor(ports.now() / RETENTION_WIDTH);
  function sampleGold(at: number) {
    if (state.unavailable || state.resetting || !ports.accountGold || accountGold.has(at)) return;
    const point = { at, total: ports.accountGold() };
    store.set('accountGold:' + at, point); accountGold.set(at, point);
  }
  function bucketStart() {
    timer = ports.timers.setTimeout(bucketStart, METRIC_BUCKET_MS - ports.now() % METRIC_BUCKET_MS);
    const now = ports.now(), at = Math.floor(now / METRIC_BUCKET_MS) * METRIC_BUCKET_MS;
    // The outage ends on a write that returns, so the routes answer 503 only while the last
    // write failed. While the store is out, each bucket start tries the waiting commit, or, with
    // none waiting, writes the run's start record again, so the outage ends at the first bucket
    // the store writes again.
    let wrote = false;
    try { wrote = commit(); } catch (error) { storageFailed(error); }
    if (state.unavailable && !wrote)
      try { store.set('startedAt', startedAt); wrote = true; } catch (error) { storageFailed(error); }
    if (wrote) state.unavailable = false;
    moveOn(now);
    if (state.unavailable || Math.floor(at / RETENTION_WIDTH) !== retainedSlot) {
      retainedSlot = Math.floor(at / RETENTION_WIDTH);
      try { retainGold(now); } catch (error) { storageFailed(error); }
    }
    try { sampleGold(at); } catch (error) { storageFailed(error); }
  }
  bucketStart();
  function resetBucket(bucket: StoredBucket, kinds: MetricResetKind[]) {
    if (kinds.includes('kills')) bucket.kills = [];
    for (const row of bucket.values) resetRow(row, kinds);
  }
  // Each saved record is reset on its own (a part, a next-row bucket, a day file), so an erasure that
  // a crash cuts short resumes on the same records.
  async function eraseMemory(kinds: MetricResetKind[], all: boolean) {
    let count = 0;
    for (const [key, current] of buckets) {
      // Yield between small batches so character coordination can keep running.
      if (++count % ERASE_YIELD_BUCKETS === 0) { capReached('ERASE_YIELD_BUCKETS', '12'); await yieldTurn(); }
      if (all) { forget(key); continue; }
      if (!resetChanges(current, kinds)) continue;
      resetBucket(current, kinds);
      for (const record of recordsOf(key)) {
        const saved = storedBucket(store.peek(record));
        if (resetChanges(saved, kinds)) { resetBucket(saved, kinds); store.set(record, saved); }
      }
    }
  }
  async function eraseDays(kinds: MetricResetKind[], all: boolean) {
    for (const record of days.values()) {
      if (all) { store.delete('day:' + record.day); days.delete(record.day); await removeDay(folder, record.file); continue; }
      const saved = await readDay(folder, record.file, warn);
      if (!saved.some(bucket => resetChanges(bucket, kinds))) continue;
      for (const bucket of saved) resetBucket(bucket, kinds);
      await saveDay(record.day, record.width, saved);
    }
  }
  async function erase(kinds: MetricResetKind[]) {
    const all = kinds.length === METRIC_RESET_KINDS.length;
    await eraseMemory(kinds, all);
    await eraseDays(kinds, all);
    cache.clear(); cachedBy.clear();
    store.set('resetState', { cuts: copy(resets), pending: [] });
    if (kinds.includes('kills')) { killTotals.clear(); killBase = { totals: [], through: killBase.through }; store.set('killTotals', killBase); }
    measurements.clear(kinds);
    // Replace the append journal so the old measurement records are removed too.
    store.refactor();
  }
  const savedPending = savedResetState.pending;
  if (Array.isArray(savedPending) && savedPending.length && savedPending.every(resetKind)) {
    state.resetting = true;
    void exclusive(() => erase(savedPending)).catch(storageFailed).finally(() => { state.resetting = false; });
  }
  const inRange = (bucket: StoredBucket, from: number, to: number) => bucket.at >= Math.floor(from / bucket.width) * bucket.width && bucket.at < to;
  // A closed day's buckets that a query read, binned at its width, kept while the latest query of a
  // route reads them, so a live chart's next poll reads only memory.
  const cache = new Map<string, StoredBucket[]>(), cachedBy = new Map<string, Set<string>>();
  /**
   * The buckets whose start falls in `from`..`to`, as v1.5.0 chose them: the buckets in memory as
   * they are, and each closed day's binned at `width` (one bin per day when null). The routes'
   * merges add up, so a bin answers as its buckets would.
   */
  function range(route: string, from: number, to: number, width: number | null): Promise<StoredBucket[]> {
    return exclusive(async () => {
      const matching = [...buckets.values()].filter(bucket => inRange(bucket, from, to)), used = new Set<string>();
      for (const record of [...days.values()].sort((a, b) => a.day - b.day)) {
        const start = Math.max(record.day, Math.floor(from / record.widths[0]!) * record.widths[0]!), end = Math.min(record.day + DAY_SPAN, to);
        if (start >= end) continue;
        const key = [record.file, start, end, width].join(':');
        let binned = cache.get(key);
        if (!binned) {
          binned = binBuckets((await readDay(folder, record.file, warn)).filter(bucket => inRange(bucket, from, to)), width ?? DAY_SPAN);
          cache.set(key, binned);
        }
        used.add(key); matching.push(...binned);
      }
      cachedBy.set(route, used);
      const kept = new Set([...cachedBy.values()].flatMap(keys => [...keys]));
      for (const key of cache.keys()) if (!kept.has(key)) cache.delete(key);
      return matching;
    });
  }
  /** The widest bucket in `from`..`to`, which sets the chart's resolution. */
  function largestWidth(from: number, to: number) {
    let largest = METRIC_BUCKET_MS;
    for (const bucket of buckets.values()) if (inRange(bucket, from, to)) largest = Math.max(largest, bucket.width);
    for (const record of days.values()) if (record.day < to && record.day + DAY_SPAN > from) largest = Math.max(largest, ...record.widths);
    return largest;
  }
  async function query(from: number, to: number, characters: string[], servers: string[]): Promise<MetricsResponse> {
    const width = chartWidth(from, to, largestWidth(from, to));
    const points = new Map<number, MetricPoint>();
    for (const bucket of await range('history', from, to, width)) {
      const at = Math.floor(bucket.at / width) * width;
      const point = points.get(at) || { at, values: [], kills: [], bounds: [] };
      mergeBounds(point.bounds, bucket.bounds);
      mergeDeaths(point.kills, bucket.kills.filter(kill => (!characters.length || characters.includes(kill.actor)) && (!servers.length || servers.includes(kill.server))));
      for (const row of bucket.values) {
        if (servers.length && !servers.includes(row.server)) continue;
        if (!characters.length || characters.includes(row.character)) mergeTotals(point.values, row);
      }
      points.set(at, point);
    }
    const ordered = [...points.values()].sort((a, b) => a.at - b.at);
    return { version: 1, startedAt, from: Math.floor(from / width) * width, to: Math.min(ports.now(), Math.ceil(to / width) * width), resolutionMs: width, points: ordered,
      characters: [...allCharacters].sort(), servers: [...allServers].sort(), lastReceivedAt: state.lastReceivedAt,
      incomplete: ordered.some(point => point.values.some(row => row.partial)), resets: copy(resets) };
  }
  async function killsQuery(from: number, to: number, dayFrom: number, dayTo: number, characters: string[], servers: string[]): Promise<MetricsKillsResponse> {
    const wanted = (death: MetricDeathTotal) => (!characters.length || characters.includes(death.actor)) && (!servers.length || servers.includes(death.server));
    const monsters = new Map<string, MonsterKillSummary>();
    function row(monster: string) {
      const value = monsters.get(monster) || { monster, count: 0, total: 0, today: 0 };
      monsters.set(monster, value); return value;
    }
    for (const death of killTotals.values()) if (wanted(death)) row(death.monster).total += death.count;
    const span = await range('kills', from, to, null);
    const countedFrom = span.reduce((start, bucket) => Math.min(start, bucket.at), from);
    const countedTo = Math.min(ports.now(), span.reduce((end, bucket) => Math.max(end, bucket.at + bucket.width), to));
    for (const bucket of span) for (const death of bucket.kills) if (wanted(death)) row(death.monster).count += death.count;
    for (const bucket of await range('kills:day', dayFrom, dayTo, null)) for (const death of bucket.kills) if (wanted(death)) row(death.monster).today += death.count;
    return { version: 1, from: countedFrom, to: countedTo, elapsedMs: Math.max(0, countedTo - Math.max(countedFrom, startedAt, resets.kills || 0)), dayFrom, dayTo, resetAt: resets.kills || 0,
      monsters: [...monsters.values()].sort((a, b) => b.count - a.count || a.monster.localeCompare(b.monster)), lastReceivedAt: state.lastReceivedAt };
  }
  function goldPoints(from: number, to: number) {
    const width = chartWidth(from, to, METRIC_BUCKET_MS);
    const points = new Map<number, AccountGoldPoint>();
    for (const point of accountGold.values()) if (point.at >= from && point.at <= to) {
      const at = Math.floor(point.at / width) * width, previous = points.get(at);
      if (!previous || point.at > previous.at) points.set(at, point);
    }
    return [...points.values()].sort((a, b) => a.at - b.at);
  }
  /** Accepts a batch's frames; a frame older than the finest row's age is counted expired. */
  function receive(character: string, server: string, runtime: string, frames: MetricFrame[]) {
    const now = ports.now();
    let expired = 0;
    const batch = new Map<string, StoredBucket>();
    for (const frame of frames) {
      if (frame.at < now - finest.until) { expired++; continue; }
      accept(character, server, runtime, frame, batch);
    }
    if (frames.length) state.lastReceivedAt = now;
    // A batch without new frames (none, or only frames already held) writes nothing; its frames are
    // on disk since the commit that took them, which an outage would have answered with 503.
    if (batch.size) writeBatch(batch);
    return { ok: true, expired, commitEpoch, commit: commits.durable, durableCommit: commits.durable };
  }
  async function reset(kinds: MetricResetKind[]) {
    state.resetting = true;
    try {
      const now = ports.now();
      for (const kind of kinds) resets[kind] = now;
      // The cutoff and pending erasure survive a crash. Older outbox frames
      // are acknowledged without resurrecting deleted measurements.
      store.set('resetState', { cuts: copy(resets), pending: kinds });
      await exclusive(() => erase(kinds));
      return resets;
    } finally { state.resetting = false; }
  }
  const service = { ports, state, startedAt, resets, storageFailed, receive, reset, query, killsQuery, goldPoints, range, largestWidth, yieldTurn,
    measurements, characters: () => [...allCharacters].sort(), firstGoldAt: () => accountGold.keys().next().value as number | undefined };
  return { install: installMetricsRoutes(service),
    async close() {
      state.closing = true;
      ports.timers.clearTimeout(timer);
      boundSeries(null);
      try { await chain; commit(); } finally { store.close(); }
    } };
}

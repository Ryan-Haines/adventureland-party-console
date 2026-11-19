import { CoordinatorJsonlStore } from '../../../settings/coordinator/api.ts';
import { requestObject, type HttpHandler, type HttpRouter } from '../../../lifecycle/api.ts';
import { METRIC_BUCKET_MS, METRIC_RESET_KINDS, type MetricsKillsResponse, type MonsterKillSummary, type MetricResetKind, type MetricResets, type MetricDeathTotal, type MetricFrame, type MetricPoint, type MetricTotals, type MetricsResponse, type AccountGoldPoint } from '../../api.ts';
import { HISTORY_KEPT_MS, metricNumber, metricText } from '../../api.ts';
import { ERASE_YIELD_BUCKETS, chartWidth } from '../../rules.ts';
import { createMeasurementIndex } from './measurement-index.ts';
import { HISTORY_ROWS, RETENTION_WIDTH, bucketKey, copy, emptyBucket, goldBaseline, mergeBounds, mergeDeaths, mergeTotals, parentWidth, resetKind, rowUntil, storedBucket, widthAt, type StoredBucket } from './history.ts';
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
  // One turn of the event loop on the run scope, so socket and status work run during a long pass.
  const yieldTurn = () => new Promise<void>(resolve => { ports.timers.setTimeout(() => resolve()); });
  const buckets = new Map<string, StoredBucket>();
  const accountGold = new Map<number, AccountGoldPoint>();
  const measurements = createMeasurementIndex();
  const killTotals = new Map<string, MetricDeathTotal>();
  // Whether the totals changed since the last write, so a commit writes the list only then.
  let totalsChanged = false;
  function indexDeaths(deaths: MetricDeathTotal[], direction: 1 | -1 = 1) {
    if (deaths.length) totalsChanged = true;
    for (const death of deaths) {
      const key = JSON.stringify([death.server, death.actor, death.monster]);
      const count = (killTotals.get(key)?.count || 0) + direction * death.count;
      if (count > 0) killTotals.set(key, { ...death, count }); else killTotals.delete(key);
    }
  }
  const savedResetState = requestObject(store.get('resetState'));
  const resets: MetricResets = {};
  for (const kind of METRIC_RESET_KINDS) {
    const at = requestObject(savedResetState.cuts)[kind];
    if (metricNumber(at)) resets[kind] = at;
  }
  const savedStart = store.get('startedAt');
  const startedAt = metricNumber(savedStart) ? savedStart : ports.now();
  // A malformed saved bucket or gold point costs that record, reported through `warn`, and the rest
  // of the history loads.
  function restoreRecord(key: string, value: unknown) {
    if (key.startsWith('bucket:')) buckets.set(key.slice(7), storedBucket(value));
    if (!key.startsWith('accountGold:')) return;
    const point = requestObject(value);
    if (!metricNumber(point.at) || (point.total !== null && !metricNumber(point.total))) throw Error('Invalid account gold history');
    accountGold.set(point.at, { at: point.at, total: point.total });
  }
  function restore() {
    if (savedStart === undefined) store.set('startedAt', startedAt);
    for (const [key, value] of store.entries()) {
      try { restoreRecord(key, value); } catch (error) { ports.warn(Error(`Skipped the saved metrics record ${key}: ${(error as Error).message}`)); }
    }
  }
  try { restore(); } catch (error) { store.close(); throw error; }
  const state = { lastReceivedAt: null as number | null, unavailable: false, resetting: false };
  function storageFailed(error: unknown) { if (!state.unavailable) ports.warn(error); state.unavailable = true; }
  const allCharacters = new Set<string>(), allServers = new Set<string>();
  for (const bucket of buckets.values()) for (const row of bucket.values) { allCharacters.add(row.character); allServers.add(row.server); }
  function write(key: string, bucket: StoredBucket) {
    // Receipt identities and measurements share one append record. A lost HTTP
    // acknowledgement can retry safely, including after coordinator restart.
    store.set('bucket:' + key, bucket);
    buckets.set(key, bucket);
  }
  // Group commit for accepted frames (docs/efficiency.md § Metrics history). Accepted frames update
  // their bucket in memory and mark it dirty; the commit writes each dirty bucket once as the next
  // metrics bucket starts, the moment the last frame of the bucket before is due. A POST answers
  // once memory holds its frames: characters in one browser share its connections to the
  // coordinator, and a POST held for the commit delayed their status and combat requests
  // (live-hunt-sparkbot-follow lost its target selection in 3-4 of the status owner runs). Each
  // answer names the commit that will write its frames (`commit`) and the last commit on disk
  // (`durableCommit`), both counted within this process (`commitEpoch`). The collector keeps a
  // frame in its outbox until an answer from the same process shows its commit on disk.
  const dirty = new Set<string>();
  const commitEpoch = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  // nextCommit counts the commit that frames accepted now join.
  const commits = { next: 1, durable: 0, waiting: false };
  function writeDirty() {
    for (const key of dirty) { const bucket = buckets.get(key); if (bucket) store.set('bucket:' + key, bucket); }
    if (totalsChanged) { store.set('killTotals', [...killTotals.values()]); totalsChanged = false; }
    dirty.clear();
  }
  // A commit that throws stays waiting with its buckets dirty, so the next bucket start writes them
  // again. Answers whether it wrote, which ends an outage.
  function commit(): boolean {
    if (!commits.waiting) return false;
    const id = commits.next;
    writeDirty();
    commits.waiting = false;
    commits.next++;
    // The store's append is written when `set` returns, so the commit is on disk once written.
    commits.durable = id;
    return true;
  }
  // A kill or a drop counts once by its id (the kill's id, not a 5 s window); a resent
  // event lands in its own bucket or a neighbour.
  function seen(id: string, at: number) {
    const start = Math.floor(at / METRIC_BUCKET_MS) * METRIC_BUCKET_MS;
    for (const time of [start - METRIC_BUCKET_MS, start, start + METRIC_BUCKET_MS])
      if (buckets.get(bucketKey(METRIC_BUCKET_MS, time))?.events.some(event => event.id === id)) return true;
    return false;
  }
  function acceptEvents(server: string, frame: MetricFrame, bucket: StoredBucket, incoming: MetricTotals): MetricDeathTotal[] {
    const fresh = (id: string, at: number) => !seen(id, at) && !bucket.events.some(value => value.id === id);
    const deaths: MetricDeathTotal[] = [];
    for (const event of frame.kills) {
      if (event.at < (resets.kills || 0) || !fresh(event.id, event.at)) continue;
      // Store a death once, attributed to the native attacker even when a tank
      // or healer reports it. Uninstrumented party members remain labelled.
      mergeDeaths(bucket.kills, [{ server, monster: event.monster, actor: event.actor, count: 1 }]);
      deaths.push({ server, monster: event.monster, actor: event.actor, count: 1 });
      bucket.events.push({ id: event.id, at: event.at });
    }
    for (const event of frame.loot) {
      if (event.at < (resets.loot || 0) || !fresh(event.id, event.at)) continue;
      incoming.loot.push({ item: event.item, variant: event.variant, quantity: event.quantity });
      bucket.events.push({ id: event.id, at: event.at });
    }
    return deaths;
  }
  function accept(character: string, server: string, runtime: string, frame: MetricFrame) {
    const allResetAt = Math.min(...METRIC_RESET_KINDS.map(kind => resets[kind] || 0));
    if (frame.last.at < allResetAt) return;
    const key = bucketKey(METRIC_BUCKET_MS, frame.at), receipt = JSON.stringify([character, runtime, frame.sequence]);
    const current = buckets.get(key);
    if (current?.receipts.includes(receipt)) return;
    const bucket = current ? copy(current) : emptyBucket(frame.at, METRIC_BUCKET_MS);
    const incoming = incomingTotals(character, server, frame, resets);
    const deaths = acceptEvents(server, frame, bucket, incoming);
    mergeTotals(bucket.values, incoming);
    allCharacters.add(character); allServers.add(server);
    bucket.receipts.push(receipt);
    buckets.set(key, bucket); dirty.add(key);
    indexDeaths(deaths);
    measurements.add([incoming]);
  }
  // A kept safety bound's firing counts in the finest bucket of its time, a series the history keeps
  // and merges like the kills (bounds.ts `boundSeries`); the next commit writes it.
  function countBound(firing: BoundFiring) {
    const start = Math.floor(ports.now() / METRIC_BUCKET_MS) * METRIC_BUCKET_MS, key = bucketKey(METRIC_BUCKET_MS, start);
    const bucket = buckets.get(key) ? copy(buckets.get(key)!) : emptyBucket(start, METRIC_BUCKET_MS);
    mergeBounds(bucket.bounds, [{ bound: firing.bound, owner: firing.owner, count: 1 }]);
    buckets.set(key, bucket); dirty.add(key); commits.waiting = true;
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
  function retainBucket(key: string, source: StoredBucket, now: number) {
    const age = now - (source.at + source.width);
    // The kill total is a lifetime count that only a reset clears, so an expired bucket
    // leaves it as it is.
    if (age > HISTORY_KEPT_MS) { store.delete('bucket:' + key); buckets.delete(key); measurements.add(source.values, -1); return; }
    const width = age > rowUntil(source.width) ? parentWidth(source.width) : null;
    if (!width) return;
    const at = Math.floor(source.at / width) * width, destinationKey = bucketKey(width, at), existing = buckets.get(destinationKey);
    const destination = existing ? copy(existing) : emptyBucket(at, width);
    // Checkpoint the source inside the destination before removing it. A crash
    // between these writes resumes without merging the same source twice.
    if (!destination.sources.includes(key)) {
      for (const value of source.values) mergeTotals(destination.values, value);
      mergeDeaths(destination.kills, source.kills);
      mergeBounds(destination.bounds, source.bounds);
      destination.sources.push(key);
      write(destinationKey, destination);
    }
    store.delete('bucket:' + key); buckets.delete(key);
  }
  function retain() {
    if (state.resetting) return;
    const now = ports.now();
    retainGold(now);
    // Finest first, so a bucket merged into a coarser row moves on in the same pass.
    for (const { width } of HISTORY_ROWS)
      for (const [key, source] of [...buckets].filter(([, bucket]) => bucket.width === width).sort((a, b) => a[1].at - b[1].at))
        retainBucket(key, source, now);
  }
  // The saved lifetime total; a journal from before it rebuilds the total from its buckets
  // before retention expires any of them.
  const savedTotals = store.get('killTotals');
  if (Array.isArray(savedTotals)) indexDeaths(savedTotals.map(requestObject).filter(death => metricText(death.server) && metricText(death.monster) &&
    metricText(death.actor) && metricNumber(death.count)) as unknown as MetricDeathTotal[]);
  else for (const bucket of buckets.values()) indexDeaths(bucket.kills);
  try { retain(); } catch (error) { store.close(); throw error; }
  for (const bucket of buckets.values()) measurements.add(bucket.values);
  // One timer, at each metrics bucket's start: the commit writes the bucket before, the account
  // gold history takes its one point for the bucket, and the retention pass runs as each bucket of
  // the coarsest width starts. Collection belongs to the coordinator, so closing the dashboard
  // cannot stop it.
  let timer: number | undefined;
  let retainedSlot = Math.floor(ports.now() / RETENTION_WIDTH);
  function sampleGold(at: number) {
    if (state.unavailable || state.resetting || !ports.accountGold || accountGold.has(at)) return;
    const point = { at, total: ports.accountGold() };
    store.set('accountGold:' + at, point); accountGold.set(at, point);
  }
  function bucketStart() {
    timer = ports.timers.setTimeout(bucketStart, METRIC_BUCKET_MS - ports.now() % METRIC_BUCKET_MS);
    const at = Math.floor(ports.now() / METRIC_BUCKET_MS) * METRIC_BUCKET_MS;
    // The outage ends on a write that returns, so the routes answer 503 only while the last
    // write failed. While the store is out, each bucket start tries the waiting commit, or, with
    // none waiting, writes the run's start record again, so the outage ends at the first bucket
    // the store writes again.
    let wrote = false;
    try { wrote = commit(); } catch (error) { storageFailed(error); }
    if (state.unavailable && !wrote)
      try { store.set('startedAt', startedAt); wrote = true; } catch (error) { storageFailed(error); }
    if (wrote) state.unavailable = false;
    if (state.unavailable || Math.floor(at / RETENTION_WIDTH) !== retainedSlot) {
      retainedSlot = Math.floor(at / RETENTION_WIDTH);
      try { retain(); } catch (error) { storageFailed(error); }
    }
    try { sampleGold(at); } catch (error) { storageFailed(error); }
  }
  bucketStart();
  async function erase(kinds: MetricResetKind[]) {
    let count = 0;
    for (const [key, current] of buckets) {
      // Yield between small batches so character coordination can keep running.
      if (++count % ERASE_YIELD_BUCKETS === 0) { capReached('ERASE_YIELD_BUCKETS', '12'); await yieldTurn(); }
      if (kinds.length === METRIC_RESET_KINDS.length) { store.delete('bucket:' + key); buckets.delete(key); continue; }
      if (!resetChanges(current, kinds)) continue;
      const bucket = copy(current);
      if (kinds.includes('kills')) bucket.kills = [];
      for (const row of bucket.values) resetRow(row, kinds);
      write(key, bucket);
    }
    store.set('resetState', { cuts: copy(resets), pending: [] });
    if (kinds.includes('kills')) { killTotals.clear(); store.set('killTotals', []); }
    measurements.clear(kinds);
    // Replace the append journal so the old measurement records are removed too.
    store.refactor();
  }
  const pending = savedResetState.pending;
  if (Array.isArray(pending) && pending.length && pending.every(resetKind)) {
    state.resetting = true;
    void erase(pending).catch(storageFailed).finally(() => { state.resetting = false; });
  }
  function matchingBuckets(from: number, to: number): StoredBucket[] {
    // Normal one-hour reads visit hundreds of keys, not six months of history. A finer row is read
    // one retention width past its age, since the pass that moves it on runs at that width.
    const matching: StoredBucket[] = [];
    for (const { width, until } of HISTORY_ROWS) {
      const parent = parentWidth(width), retention = parent ? until + RETENTION_WIDTH : until;
      const start = Math.floor(Math.max(from, ports.now() - retention) / width) * width;
      for (let at = start; at < to; at += width) {
        const key = bucketKey(width, at), bucket = buckets.get(key);
        if (!bucket) continue;
        const merged = parent ? buckets.get(bucketKey(parent, Math.floor(at / parent) * parent)) : undefined;
        if (!merged?.sources.includes(key)) matching.push(bucket);
      }
    }
    return matching;
  }
  function query(from: number, to: number, characters: string[], servers: string[]): MetricsResponse {
    const matching = matchingBuckets(from, to);
    const largest = matching.reduce((width, bucket) => Math.max(width, bucket.width), METRIC_BUCKET_MS);
    const width = chartWidth(from, to, largest);
    const points = new Map<number, MetricPoint>();
    for (const bucket of matching) {
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
  function killsQuery(from: number, to: number, dayFrom: number, dayTo: number, characters: string[], servers: string[]): MetricsKillsResponse {
    const wanted = (death: MetricDeathTotal) => (!characters.length || characters.includes(death.actor)) && (!servers.length || servers.includes(death.server));
    const monsters = new Map<string, MonsterKillSummary>();
    function row(monster: string) {
      const value = monsters.get(monster) || { monster, count: 0, total: 0, today: 0 };
      monsters.set(monster, value); return value;
    }
    for (const death of killTotals.values()) if (wanted(death)) row(death.monster).total += death.count;
    const range = matchingBuckets(from, to);
    const countedFrom = range.reduce((start, bucket) => Math.min(start, bucket.at), from);
    const countedTo = Math.min(ports.now(), range.reduce((end, bucket) => Math.max(end, bucket.at + bucket.width), to));
    for (const bucket of range) for (const death of bucket.kills) if (wanted(death)) row(death.monster).count += death.count;
    for (const bucket of matchingBuckets(dayFrom, dayTo)) for (const death of bucket.kills) if (wanted(death)) row(death.monster).today += death.count;
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
    for (const frame of frames) {
      if (frame.at < now - HISTORY_ROWS[0].until) { expired++; continue; }
      accept(character, server, runtime, frame);
    }
    // A batch without frames only reads durableCommit.
    if (frames.length) { commits.waiting = true; state.lastReceivedAt = now; }
    return { ok: true, expired, commitEpoch, commit: commits.next, durableCommit: commits.durable };
  }
  async function reset(kinds: MetricResetKind[]) {
    state.resetting = true;
    try {
      const now = ports.now();
      for (const kind of kinds) resets[kind] = now;
      // The cutoff and pending erasure survive a crash. Older outbox frames
      // are acknowledged without resurrecting deleted measurements.
      store.set('resetState', { cuts: copy(resets), pending: kinds });
      await erase(kinds);
      return resets;
    } finally { state.resetting = false; }
  }
  const service = { ports, state, startedAt, resets, storageFailed, receive, reset, query, killsQuery, goldPoints, matchingBuckets, yieldTurn,
    measurements, characters: () => [...allCharacters].sort(), firstGoldAt: () => accountGold.keys().next().value as number | undefined };
  return { install: installMetricsRoutes(service),
    async close() {
      ports.timers.clearTimeout(timer);
      boundSeries(null);
      try { writeDirty(); } finally { store.close(); }
    } };
}

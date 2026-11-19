// The metrics routes: each checks
// its request and asks service.ts, which holds the history.
import { requestObject, type HttpResponse, type HttpRouter } from '../../../lifecycle/api.ts';
import { HISTORY_KEPT_MS, METRIC_BUCKET_MS, METRIC_RESET_KINDS, metricNumber, metricText, parseMetricFrame, type MetricFrame, type MetricResetKind, type MetricResets, type MetricsKillsResponse, type MetricsResponse, type AccountGoldPoint } from '../../api.ts';
import { BAR_NAMES, CALENDAR_DAY_MS, CLOCK_SKEW_MS, FRAME_AHEAD_MS, HISTORY_NAMES } from '../../rules.ts';
import { boundFired, capReached } from '../bounds.ts';
import { measurementSummary } from './measurement-summary.ts';
import { goldHistory } from './gold-history.ts';
import { resetKind, type StoredBucket } from './history.ts';
import type { createMeasurementIndex } from './measurement-index.ts';

const HOUR = 3_600_000;
/** What the routes ask of the metrics service (service.ts). */
interface Metrics {
  ports: { now(): number; owned(name: string): boolean };
  state: { lastReceivedAt: number | null; unavailable: boolean; resetting: boolean };
  startedAt: number;
  // A turn on the status owner's run scope, which the gold history yields with.
  yieldTurn(): Promise<void>;
  resets: MetricResets;
  storageFailed(error: unknown): void;
  receive(character: string, server: string, runtime: string, frames: MetricFrame[]): object;
  reset(kinds: MetricResetKind[]): Promise<MetricResets>;
  query(from: number, to: number, characters: string[], servers: string[]): MetricsResponse;
  killsQuery(from: number, to: number, dayFrom: number, dayTo: number, characters: string[], servers: string[]): MetricsKillsResponse;
  goldPoints(from: number, to: number): AccountGoldPoint[];
  matchingBuckets(from: number, to: number): StoredBucket[];
  measurements: ReturnType<typeof createMeasurementIndex>;
  characters(): string[];
  firstGoldAt(): number | undefined;
}

/** A query's name list; the summary routes drop empty names, the history routes keep them. A list
 *  past its cap counts under the cap's name. */
const NAME_CAPS = { BAR_NAMES, HISTORY_NAMES };
function names(value: unknown, cap: keyof typeof NAME_CAPS, dropEmpty = true): string[] {
  if (typeof value !== 'string') return [];
  const list = dropEmpty ? value.split(',').filter(Boolean) : value.split(',');
  if (list.length > NAME_CAPS[cap]) capReached(cap, '12');
  return list.slice(0, NAME_CAPS[cap]);
}
/** An end past the coordinator's clock by more than CLOCK_SKEW_MS: the asking clock runs ahead, so
 *  the bound fires. */
function pastClock(to: number, now: number, route: string) {
  if (to <= now + CLOCK_SKEW_MS) return false;
  boundFired({ bound: 'CLOCK_SKEW_MS', owner: '12', subject: route, state: { to, now, ms: CLOCK_SKEW_MS } });
  return true;
}
/** A range the history can answer: ordered, within what it keeps, not past the clock's skew. */
function validRange(from: number, to: number, now: number, route: string) {
  return metricNumber(from) && metricNumber(to) && from < to && to - from <= HISTORY_KEPT_MS && !pastClock(to, now, route);
}
/** A calendar day, which a daylight saving change lengthens to 25 hours (CALENDAR_DAY_MS allows 26). */
function validDay(from: number, to: number) {
  return metricNumber(from) && metricNumber(to) && from < to && to - from <= CALENDAR_DAY_MS;
}
function batchFrames(inputs: unknown[], now: number): MetricFrame[] | null {
  const frames: MetricFrame[] = [];
  for (const input of inputs) {
    const frame = parseMetricFrame(input);
    if (!frame || frame.at % METRIC_BUCKET_MS) return null;
    // A frame whose last sample is past the coordinator's clock comes from a window whose clock runs
    // ahead, so the bound fires and the batch is refused.
    if (frame.last.at > now + FRAME_AHEAD_MS) {
      boundFired({ bound: 'FRAME_AHEAD_MS', owner: '12', subject: 'metrics', state: { at: frame.last.at, now, ms: FRAME_AHEAD_MS } });
      return null;
    }
    frames.push(frame);
  }
  return frames;
}

export function installMetricsRoutes(metrics: Metrics) {
  const { ports, state } = metrics;
  const closed = (response: HttpResponse, resetCode = 503) => {
    if (state.unavailable) { response.status(503).json({ error: 'Metrics storage unavailable' }); return true; }
    if (state.resetting) { response.status(resetCode).json({ error: resetCode === 409 ? 'Metrics reset already in progress' : 'Metrics reset in progress' }); return true; }
    return false;
  };
  function install(router: HttpRouter) {
    router.get('/party-api/metrics/account-gold', (request, response) => {
      if (state.unavailable) return response.status(503).json({ error: 'Metrics storage unavailable' });
      const now = ports.now(), input = request.query || {}, resetAt = Number(input.resetAt ?? 0), to = Number(input.to ?? now);
      if (!metricNumber(resetAt) || !metricNumber(to) || pastClock(to, now, 'account-gold')) return response.status(400).json({ error: 'Invalid gold range' });
      const from = Math.max(resetAt, metrics.firstGoldAt() ?? now, now - HISTORY_KEPT_MS);
      return response.json({ from, to, points: metrics.goldPoints(from, to) });
    });
    router.get('/party-api/metrics/bars', (request, response) => {
      if (closed(response)) return;
      const input = request.query || {}, metric = input.metric, now = ports.now(), from = Number(input.from ?? now - HOUR), to = Number(input.to ?? now), dayFrom = Number(input.dayFrom), dayTo = Number(input.dayTo);
      if ((metric !== 'damage' && metric !== 'loot') || !validRange(from, to, now, 'bars') || !validDay(dayFrom, dayTo))
        return response.status(400).json({ error: 'Invalid measurement range' });
      const scope = { from, to, now, startedAt: metrics.startedAt, resetAt: metrics.resets[metric] || 0, dayFrom, dayTo: Math.min(dayTo, now),
        characters: names(input.characters, 'BAR_NAMES'), servers: names(input.servers, 'BAR_NAMES'), monsters: names(input.monsters, 'BAR_NAMES'), skills: names(input.skills, 'BAR_NAMES'), items: names(input.items, 'BAR_NAMES') };
      const source = { range: metrics.matchingBuckets(from, to), day: metrics.matchingBuckets(dayFrom, Math.min(dayTo, now)),
        damage: metrics.measurements.damage(), loot: metrics.measurements.loot(), lastReceivedAt: state.lastReceivedAt };
      return response.json(metric === 'damage' ? measurementSummary({ ...scope, metric, by: input.by === 'skill' ? 'skill' : 'character' }, source)
        : measurementSummary({ ...scope, metric, by: 'item' }, source));
    });
    router.get('/party-api/metrics/kills', (request, response) => {
      if (closed(response)) return;
      const input = request.query || {}, now = ports.now(), from = Number(input.from ?? now - HOUR), to = Number(input.to ?? now),
        dayFrom = Number(input.dayFrom), dayTo = Number(input.dayTo);
      if (!validRange(from, to, now, 'kills') || !validDay(dayFrom, dayTo)) return response.status(400).json({ error: 'Invalid kills range' });
      return response.json(metrics.killsQuery(from, to, dayFrom, Math.min(dayTo, now), names(input.characters, 'HISTORY_NAMES', false), names(input.servers, 'HISTORY_NAMES', false)));
    });
    router.post('/party-api/metrics', async (request, response) => {
      if (closed(response)) return;
      const body = requestObject(request.body);
      if (!metricText(body.character) || !ports.owned(body.character) || !metricText(body.runtime) || !metricText(body.server) ||
          !Array.isArray(body.frames)) return response.status(400).json({ error: 'Invalid metrics batch' });
      const frames = batchFrames(body.frames, ports.now());
      if (!frames) return response.status(400).json({ error: 'Invalid metrics frame' });
      try { return response.json(metrics.receive(body.character, body.server, body.runtime, frames)); }
      catch (error) {
        metrics.storageFailed(error);
        return response.status(503).json({ error: 'Metrics storage unavailable' });
      }
    });
    router.get('/party-api/metrics', async (request, response) => {
      if (closed(response)) return;
      const now = ports.now(), input = request.query || {}, to = Number(input.to ?? now);
      const resetAt = Number(input.resetAt ?? 0), gold = input.sinceReset === 'gold';
      if (gold && !metricNumber(resetAt)) return response.status(400).json({ error: 'Invalid gold reset' });
      const from = gold ? Math.max(metrics.startedAt, metrics.resets.gold || 0, resetAt, now - HISTORY_KEPT_MS) : Number(input.from ?? now - HOUR);
      if (!validRange(from, to, now, 'history')) return response.status(400).json({ error: `Choose a valid metrics range of at most ${HISTORY_KEPT_MS / (24 * HOUR)} days` });
      if (!gold) return response.json(metrics.query(from, to, names(input.characters, 'HISTORY_NAMES', false), names(input.servers, 'HISTORY_NAMES', false)));
      const cuts = structuredClone(metrics.resets);
      const history = await goldHistory(metrics.matchingBuckets(from, to), from, to, metrics.yieldTurn);
      return response.json({ ...history, startedAt: metrics.startedAt, characters: metrics.characters(), resets: cuts });
    });
    router.post('/party-api/metrics/reset', async (request, response) => {
      if (closed(response, 409)) return;
      const metric = requestObject(request.body).metric;
      if (metric !== 'all' && metric !== 'performance' && !resetKind(metric)) return response.status(400).json({ error: 'Unknown metric' });
      const kinds: MetricResetKind[] = metric === 'all' ? [...METRIC_RESET_KINDS] : metric === 'performance' ? ['kills', 'damage'] : [metric];
      try { return response.json({ ok: true, resets: await metrics.reset(kinds) }); }
      catch (error) {
        metrics.storageFailed(error);
        return response.status(503).json({ error: 'Metrics storage unavailable' });
      }
    });
  }
  return install;
}

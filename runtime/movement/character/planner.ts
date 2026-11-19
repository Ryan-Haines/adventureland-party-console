// The character's route planning: the native planner adapter, the Town and walk candidate choice
// for a return, the shared route remainder a follower walks. owner.ts owns the budgets each search
// runs under; corrections.ts observes the server's corrections and destinations.ts names the places
// a request may carry.
import { type Point, type Step, distance, isTransition, type PlanRequest, type PlanResult } from '../geometry/contracts.ts';
import type { MovementHost, NativeFunctions, MovementPorts } from '../../protocol/records.ts';
import { movementError, retryableMovementRequest } from './records.ts';
import { validateRoute, type ValidationPorts } from '../geometry/validation.ts';
import { repairDoorApproaches } from '../geometry/door-approach.ts';
import { RENDEZVOUS_RANGE } from '../../protocol/ladder.ts';
import { NATIVE_FRONTIER_WINDOW_MS } from '../rules.ts';
import { boundFired } from '../../status/api.ts';
interface SliceMetrics { version?: number; mode: '40ms' | 'native'; reason?: string; hidden?: boolean; calls: number; totalMs: number; maxMs: number; intervalTotal: number; intervalMin: number; intervalMax: number }
/** Only this adapter touches the game's planner globals. It never runs the native walker. */
// Neither of its two game calls sends a packet, so neither asks calls.band: stop('smart') ends the
// search and resolves (js/runner_functions.js:2646-2650 at the pinned game 16881a27), and
// smart_move's start only queues the client-side search (:2541-2645), which the slices below run.
export function createNativePlanner(host: MovementHost, native: NativeFunctions) {
  let running = false, failure = '', deadline = 0, serial = 0, limit = 0, budget = '';
  let hardDeadline = 0, hardLimit = 0, lastIndex: number | undefined, advancedAt = 0, progressValid = false;
  let searchQueue: unknown[] | undefined;
  let metrics: SliceMetrics | undefined, lastSliceStart: number | undefined;
  function cancel() { running = false; serial++; void Promise.resolve(native.stop('smart')).catch(() => {}); }
  // `bound` names the owner's budget the timeout comes from (owner.ts `budgets`), which a search that
  // ends on it reports.
  function begin(destination: Point, town: boolean, now: number, timeout: number, bound: 'movementPlanningMs' | 'movementRepairMs', progressLimit?: number) {
    cancel(); metrics = undefined; lastSliceStart = undefined; failure = ''; limit = timeout; deadline = now + timeout; budget = bound;
    hardLimit = progressLimit ?? timeout; hardDeadline = now + hardLimit; lastIndex = undefined; searchQueue = undefined; advancedAt = now; progressValid = progressLimit !== undefined;
    const token = serial;
    const promise = native.move(destination);
    void promise.catch(error => { if (running && token === serial) failure = String(error?.reason || error); });
    host.smart.use_town = town; running = true;
  }
  function validFrontier(index: number | undefined, queue: unknown): queue is unknown[] {
    return Number.isSafeInteger(index) && index! >= 0 && Array.isArray(queue) && index! <= queue.length &&
      (searchQueue === undefined || searchQueue === queue) && (lastIndex === undefined || index! >= lastIndex);
  }
  function observeProgress(now: number) {
    if (!progressValid) return;
    const index = host.start, queue = host.queue;
    if (!validFrontier(index, queue)) { progressValid = false; return; }
    searchQueue = queue;
    if (lastIndex !== undefined && index! > lastIndex) advancedAt = now;
    lastIndex = index;
  }
  function stalled(now: number) { return now - advancedAt > NATIVE_FRONTIER_WINDOW_MS; }
  function expired(now: number) {
    return now >= hardDeadline || now >= deadline && (!progressValid || stalled(now));
  }
  // A search that ends on its budget or on the frontier window tells the status owner's bound record which one
  // ended it; a search the game failed ends on the game's reason.
  function checkDeadline(now: number) {
    if (!failure && !expired(now)) return;
    if (!failure) boundFired(now < hardDeadline && progressValid && stalled(now)
      ? { bound: 'nativeFrontierWindowMs', owner: '02', state: { index: lastIndex, ms: now - advancedAt } }
      : { bound: budget, owner: '02', state: { ms: now >= hardDeadline ? hardLimit : limit } });
    const reason = failure || `Native planning timed out (${(now >= hardDeadline ? hardLimit : limit) / 1000} seconds)`; cancel(); throw Error(reason);
  }
  function search() {
    if (!host.smart.searching) native.start(); else if (!host.smart.found) native.next();
  }
  function sliceProfile() {
    const parent = host.parent, version = Number(parent?.__partyClientVersion || host.G?.version);
    if (![15555,17665].includes(version)) return {version, reason:'unverified-version'};
    const descriptor = Object.getOwnPropertyDescriptor(parent, 'is_hidden');
    // A scoped parent getter returns a CODE-owned wrapper; restoring it would poison native draw/watchdog calls.
    const visibility = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    if (!descriptor) return {version, reason:'hook-unavailable'};
    if (!descriptor || !('value' in descriptor) || !descriptor.writable) return {version, reason:'hook-not-writable'};
    if (typeof visibility !== 'function') return {version, reason:'hook-unavailable'};
    return {version, visibility: visibility as () => boolean};
  }
  function recordSlice(started: number, profile: ReturnType<typeof sliceProfile>) {
    let hidden: boolean | undefined;
    try { hidden = profile.visibility?.(); } catch { /* Diagnostics cannot alter native dispatch. */ }
    metrics ??= {version:Number.isFinite(profile.version)?profile.version:undefined,
      mode:profile.visibility?'40ms':'native',reason:profile.reason,hidden,
      calls:0,totalMs:0,maxMs:0,intervalTotal:0,intervalMin:Infinity,intervalMax:0};
    if (lastSliceStart !== undefined) {
      const interval = Math.max(0, started-lastSliceStart);
      metrics.intervalTotal += interval; metrics.intervalMin = Math.min(metrics.intervalMin,interval);
      metrics.intervalMax = Math.max(metrics.intervalMax,interval);
    }
    lastSliceStart = started; metrics.calls++;
  }
  function searchSlice() {
    const profile = sliceProfile(), started = performance.now();
    recordSlice(started,profile);
    if (profile.visibility) host.parent.is_hidden = () => false;
    try { search(); }
    finally {
      if (profile.visibility) host.parent.is_hidden = profile.visibility;
      const elapsed = Math.max(0,performance.now()-started);
      metrics!.totalMs += elapsed; metrics!.maxMs = Math.max(metrics!.maxMs,elapsed);
    }
  }
  function report() {
    if (!metrics) return;
    const {intervalTotal,intervalMin,intervalMax,...sample}=metrics;
    return {...sample,intervals:{minMs:sample.calls>1?intervalMin:0,maxMs:intervalMax,
      meanMs:sample.calls>1?intervalTotal/(sample.calls-1):0}};
  }
  function tick(now: number): Step[] | undefined {
    if (!running) throw Error('Native search not initialized');
    if (lastIndex !== undefined) observeProgress(now);
    checkDeadline(now);
    searchSlice();
    observeProgress(now);
    if (!host.smart.moving && !host.smart.found) throw Error('Native planner found no route');
    if (!host.smart.found) return;
    const plot = host.smart.plot.map(p => ({ ...p }));
    cancel(); return plot;
  }
  return { begin, tick, cancel, report };
}

// The Town and crossing costs that compare the Town and walking candidates (7 s, 1 s) have no
// appendix C row (audit 6-32); CF14's Town row (3 s channel plus a round trip) bounds the cast, not
// this comparison, so b9b5c91e value kept.
export function routeDuration(request: PlanRequest, plot: Step[]): number {
  let at = request.from,
    ms = 0;
  for (const step of plot) {
    ms += step.town
      ? 7000
      : isTransition(step)
        ? 1000
        : (distance(at, step) * 1000) / Math.max(1, request.speed);
    at = step;
  }
  return ms;
}
// A return candidate's plan request waits this long for the coordinator's answer, the earlier
// console's value (its runtime/characters/return-planner.ts:42): a bound against a lost
// request or a stopped coordinator process. A cut request reports through boundFired under this
// name and rejects as before, so the caller's retryable-request rule decides what follows.
const PLAN_CANDIDATE_REQUEST_MS = 2000;
export async function planReturnCandidates(
  ports: MovementPorts,
  validation: ValidationPorts,
  request: PlanRequest,
  tolerance: number,
  townFirst = false,
): Promise<PlanResult> {
  const outcomes = await Promise.allSettled(
    [false, true].map(async (town) => {
      // The coordinator keys in-flight work by ID, including parallel candidates.
      const candidateId = `${request.id}:${town ? "town" : "walk"}`;
      const spawn=validation.game.maps[request.from.map]?.spawns[0];
      const warp: Step | undefined = townFirst && town && spawn && Math.hypot(request.from.x-spawn[0],request.from.y-spawn[1])>RENDEZVOUS_RANGE
        ? {map:request.from.map,x:spawn[0],y:spawn[1],town:true} : undefined;
      const response = (await ports.request("/movement-plan", {
        method: "POST",
        timeout: PLAN_CANDIDATE_REQUEST_MS,
        body: { ...request, from: warp || request.from, id: candidateId, town },
      }).catch((error: unknown) => {
        if ((movementError(error).partyRequest as { kind?: string } | undefined)?.kind === 'timeout')
          boundFired({ bound: 'PLAN_CANDIDATE_REQUEST_MS', owner: '02', state: { candidate: town ? 'town' : 'walk', ms: PLAN_CANDIDATE_REQUEST_MS } });
        throw error;
      })) as PlanResult & { error?: string; mode?: string };
      if (response.error) throw Error(response.error);
      if (
        response.id !== candidateId ||
        response.version !== request.version ||
        response.fingerprint !== request.fingerprint
      )
        throw Error("Planner response identity mismatch");
      if (response.mode === "shadow") return response;
      const remainder=warp && response.plot[0]?.town && distance(warp,response.plot[0])<=1 ? response.plot.slice(1) : response.plot;
      const plot = repairDoorApproaches(validation, request.from, warp ? [warp,...remainder] : remainder);
      const issue = validateRoute(validation, request.from, request.to, plot, town, tolerance);
      if (issue) throw Error((town ? "Town" : "Walking") + " route: " + issue.reason);
      return { ...response, plot };
    }),
  );
  const valid = outcomes.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!valid.length) {
    const unavailable = outcomes.find(r => r.status === 'rejected' && retryableMovementRequest(r.reason));
    if (unavailable?.status === 'rejected') throw unavailable.reason;
    throw Error(
      "Return route candidates failed: " +
        outcomes.map((r) => (r.status === "rejected" ? String(r.reason) : "")).join("; "),
    );
  }
  const selected = valid.sort((a, b) => (townFirst ? Number(!a.plot[0]?.town)-Number(!b.plot[0]?.town) : 0) || routeDuration(request, a.plot) - routeDuration(request, b.plot))[0];
  // Candidate identity is transport-local; movement still owns the parent journey.
  return { ...selected, id: request.id };
}

/** Local owned-route cache protocol; never a complete native smart-move state. */
export interface SharedRouteRemainder {
  id: string;
  revision: number;
  runtimeId: string;
  destinationKey: string;
  destination: Point;
  origin: Point;
  server: string;
  geometry: Pick<PlanResult, 'version' | 'fingerprint'>;
  transporting: boolean;
  plot: Step[];
  source?: string;
  /** Absent for older caches and non-continuous navigation. */
  townAllowed?: boolean;
}

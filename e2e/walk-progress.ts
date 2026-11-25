// The progress rule a live walk wait reads in place of a fixed walk timeout (test-windows
// BUILD-BRIEF.md "no made-up numbers"). A walk passes while it keeps closing on its destination
// and fails as stalled as soon as it stops.
// - Progress is any member's map change, a route step within one journey, a move of 2 units or more
//   (the movement executor's own progress unit, runtime/movement/character/executor.ts:203) or an
//   attack, since a walk that meets a monster on the way fights it before it walks on.
// - A new journey alone is a replan, not progress: a route that fails and restarts from the same
//   point counts against the planning budget below (walk-progress.test.mts P5).
// - The party counts as one walk: a member waiting at a door for the other is progress while the
//   other one closes the gap.
// - While a member is moving on a walking step, the walk is stalled after two report intervals
//   with no progress, the rule the executor applies to one member (executor.ts:235), read from the
//   longest interval the members reported. That bound counts from the first walking sample at the
//   earliest, since the executor starts its own stall clock at the step it issues (executor.ts:203),
//   not during the route planning before it (walk-progress.test.mts P6).
// - While no member is moving on a walking step (planning a route, waiting at a barrier, crossing
//   a door), the quiet stretch is bounded by the route planning budget, `movementPlanningMs`
//   (runtime/movement/saved-fields.ts), the longest the movement owner waits on one try itself.
export interface WalkSample {
  map: string; x: number; y: number; journey: string | null; step: number | null; attackAt: number | null;
  // The executor's phase is 'walking' and the game shows the character moving.
  walking: boolean;
  reportIntervalMs: number;
}
export interface WalkSnapshot {
  startedAt: number; lastProgressAt: number; boundMs: number | null; bound: string | null;
  causes: Record<string, number>; lastProgress: { at: number; name: string; cause: string } | null;
}
export interface WalkProgress { observe(at: number, samples: Record<string, WalkSample>): void; snapshot(): WalkSnapshot }

const STEP_UNIT = 2;

export function walkProgress(startedAt: number, planningMs: number): WalkProgress {
  let lastProgressAt = startedAt, boundMs: number | null = null, bound: string | null = null;
  let walkingFrom: number | null = null;
  let lastProgress: WalkSnapshot['lastProgress'] = null;
  const last: Record<string, WalkSample> = {}, causes: Record<string, number> = {};
  function cause(before: WalkSample, now: WalkSample): string | null {
    if (now.map !== before.map) return 'map';
    if (now.journey === before.journey && now.step !== before.step) return 'step';
    if (Math.hypot(now.x - before.x, now.y - before.y) >= STEP_UNIT) return 'moved';
    if (now.attackAt !== before.attackAt) return 'attack';
    return null;
  }
  return {
    observe(at, samples) {
      for (const [name, sample] of Object.entries(samples)) {
        const before = last[name];
        if (!before) { last[name] = sample; continue; }
        const why = cause(before, sample);
        if (why) { lastProgressAt = at; last[name] = sample; causes[why] = (causes[why] ?? 0) + 1; lastProgress = {at, name, cause: why}; }
      }
      const members = Object.values(samples);
      if (members.some(s => s.walking)) {
        const intervals = members.map(s => s.reportIntervalMs).filter(ms => Number.isFinite(ms) && ms > 0);
        if (!intervals.length) throw Error('No member reported a report interval, so the walking walk has no stall bound');
        boundMs = 2 * Math.max(...intervals); bound = 'two report intervals'; walkingFrom ??= at;
      } else { boundMs = planningMs; bound = 'movementPlanningMs'; walkingFrom = null; }
      const quiet = at - Math.max(lastProgressAt, walkingFrom ?? lastProgressAt);
      if (quiet > boundMs) throw Error(`The walk stalled: no member made progress for ${quiet} ms, past ${bound} (${boundMs} ms)`);
    },
    snapshot: () => ({ startedAt, lastProgressAt, boundMs, bound, causes: { ...causes }, lastProgress }),
  };
}

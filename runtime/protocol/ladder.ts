import type { Point, WalkMaps } from './walk.ts';
// The movement owner's one escalation ladder.
// The requester gives a round of
// rungs; the ladder keeps the step, the failures since the last progress and when that
// progress happened. A failure moves one rung on; getting closer to the goal, or onto a
// map not reached in this climb, returns it to the first rung. No count or time ends the
// ladder: its `wait` rung waits for the console's next report and starts the round over.

// What is left of a planned route: the transitions it still has to take and the walking distance.
export interface Closeness { transitions: number; walking: number }
export interface LadderOutcome {
  arrived: boolean; at: Point;
  engine?: string; planned?: Closeness; remaining?: Closeness;
}
export interface LadderOptions { native?: boolean; town?: boolean; avoidLeave?: boolean; relocation?: 'town' }
export interface LadderAttempt {
  rung: string; trying: string;
  // A relocation walks here first; the other rungs walk to the requester's goal.
  destination?: Point;
  options: LadderOptions;
}
// What a rung reads to build its attempt: the requester's context, the planner the last
// journey used and how many rounds have ended.
// `failed` is the failure the climb answers, for a journey's own round (`journeyRound`).
export interface RungContext { townAllowed?: boolean; engine?: string; rounds: number; failed?: string }
export interface Rung {
  name: string;
  // A rung that walks away from the goal on purpose counts only a new map as progress.
  toward: boolean;
  // Undefined when the rung has nothing to try from here; the ladder moves on.
  attempt(at: Point, context: RungContext): Omit<LadderAttempt, 'rung'> | undefined;
}
// The progress test of the console's walk home on b9b5c91e (shared.js eventReturnRouteToMain), as the design's § 3.2 rule.
export const PROGRESS_DISTANCE = 10;

export function closer(a: Closeness, b: Closeness): boolean {
  return a.transitions < b.transitions || a.transitions === b.transitions && a.walking <= b.walking - PROGRESS_DISTANCE;
}
const best = (a: Closeness | undefined, b: Closeness | undefined) => !a ? b : !b ? a : closer(b, a) ? b : a;

// What a ladder keeps between rungs, as plain data. The coordinator's walk ladder saves it on
// its convoy, so a coordinator restart resumes the climb where it stood (design § 5.2).
export interface LadderState {
  index: number; rounds: number; failures: number; progressAt: number;
  nearest?: Closeness; engine?: string; visited: string[];
}

export function createOwnerLadder(round: readonly Rung[], now: () => number, saved?: LadderState) {
  let index = saved?.index ?? 0, rounds = saved?.rounds ?? 0, failures = saved?.failures ?? 0, progressAt = saved?.progressAt ?? now();
  let nearest: Closeness | undefined = saved?.nearest, engine: string | undefined = saved?.engine;
  if (index >= round.length) index = 0;
  // `working` is true from a rung's start until its result or the end of its wait.
  let current: LadderAttempt | undefined, working = false;
  const visited = new Set<string>(saved?.visited);
  const progressed = () => { index = 0; failures = 0; progressAt = now(); };
  return {
    state: (): LadderState => ({ index, rounds, failures, progressAt, ...(nearest ? { nearest } : {}), ...(engine ? { engine } : {}), visited: [...visited] }),
    next(at: Point, context: Omit<RungContext, 'engine' | 'rounds'> = {}): LadderAttempt {
      visited.add(at.map);
      for (let tried = 0; tried < round.length; tried++) {
        const rung = round[index], attempt = rung.attempt(at, { ...context, engine, rounds });
        if (attempt) { working = true; return current = { rung: rung.name, ...attempt }; }
        index = (index + 1) % round.length;
      }
      throw Error('Owner ladder has no rung to try');
    },
    result(outcome: LadderOutcome): 'arrived' | 'progress' | 'failed' {
      working = false;
      if (outcome.engine) engine = outcome.engine;
      if (outcome.arrived) { progressed(); return 'arrived'; }
      const toward = round[index]?.toward ?? true;
      const newMap = !visited.has(outcome.at.map);
      visited.add(outcome.at.map);
      const before = toward ? best(nearest, outcome.planned) : undefined;
      const gained = newMap || !!(toward && before && outcome.remaining && closer(outcome.remaining, before));
      if (toward) nearest = best(before, outcome.remaining);
      if (gained) { progressed(); return 'progress'; }
      failures++;
      index = (index + 1) % round.length;
      return 'failed';
    },
    // A rung that could not finish, such as one an owner error broke, fails like a rung
    // that made no progress.
    fail() { working = false; failures++; index = (index + 1) % round.length; },
    // The wait ended with the next report; the round starts over from the first rung.
    waited() { working = false; rounds++; index = 0; },
    report: () => ({ rung: round[index]?.name, index, rounds, failures, progressAt, trying: current?.trying, inProgress: working }),
  };
}
export type OwnerLadder = ReturnType<typeof createOwnerLadder>;

// How far from the rally a member may stand at departure (characters/shared.js asks the same of
// a follower). It lives in the protocol because the relocation rungs and the walk's regroup read
// it; movement's route-store.ts and planner.ts import it from here.
export const RENDEZVOUS_RANGE = 55;
// The movement owner counts a walk as arrived within this distance (character/owner.ts reads it
// through movement/rules.ts), so a member that walked home always counts as home. It lives in the
// protocol because the task round's via rung reads the same arrival.
export const ARRIVAL_TOLERANCE = 20;

export interface Relocation {
  method: "town" | "door";
  origin: Point;
  destination: Point;
}
// movementRelocation offers only ordinary catalogued exits; the caller still validates the route it plans.
export function movementRelocation(
  game: WalkMaps,
  origin: Point,
  townAllowed: boolean,
): Relocation | undefined {
  const map = game.maps[origin.map];
  if (!map || restrictedMap(map, origin)) return;
  const spawn = map.spawns[0];
  // The spawn point carries no `in`, so geometry's `distance` to it is the straight line.
  if (townAllowed && spawn && Math.hypot(origin.x - spawn[0], origin.y - spawn[1]) > RENDEZVOUS_RANGE)
    return {
      method: "town",
      origin: positionOf(origin),
      destination: { map: origin.map, x: spawn[0], y: spawn[1] },
    };
  const doors = (map.doors || [])
    .filter((d) => ordinaryDoor(game, d))
    .sort(
      (a, b) =>
        Math.hypot(Number(a[0]) - origin.x, Number(a[1]) - origin.y) -
        Math.hypot(Number(b[0]) - origin.x, Number(b[1]) - origin.y),
    );
  const door = doors[0];
  if (!door) return;
  const target = game.maps[String(door[4])].spawns[Number(door[5])];
  return {
    method: "door",
    origin: positionOf(origin),
    destination: { map: String(door[4]), x: target[0], y: target[1] },
  };
}
// The position fields alone, as geometry's `point` (runtime/movement/geometry/contracts.ts) keeps them.
const positionOf = (p: Point): Point => ({ map: p.map, x: p.x, y: p.y, ...(p.in === undefined ? {} : { in: p.in }) });
function ordinaryDoor(game: WalkMaps, door: unknown[]): boolean {
  const map = game.maps[String(door[4])],
    spawn = map?.spawns[Number(door[5])];
  return (
    !!map &&
    !map.instance &&
    !map.event &&
    !!spawn &&
    door[7] !== "key" &&
    door[8] !== "complicated" &&
    spawn.every(Number.isFinite)
  );
}

function restrictedMap(map: WalkMaps["maps"][string], origin: Point): boolean {
  return !!map.instance || !!map.event || String(origin.in ?? origin.map) !== origin.map;
}

const rung = (name: string, toward: boolean, attempt: Rung['attempt']): Rung => ({ name, toward, attempt });
// A rung that tries the same thing from anywhere.
const fixed = (name: string, toward: boolean, trying: string): Rung => rung(name, toward, () => ({ trying, options: {} }));
// The last rung of the survival, task, event exit and errand rounds: the next report, then the round again.
const waitRung = rung('wait', true, (_at, { rounds }) => ({ trying: `waiting for the next report, then starting over (round ${rounds + 1})`, options: {} }));

// The escape walk home (design § 3.3 UP-2): replan, the other route, a relocation, then
// the next report. Each relocation is followed by a walk to the goal from where it lands.
// `townAllowed` is false at an event (queue AV: the team does not Town out of one).
export function survivalRound(game: WalkMaps): Rung[] {
  function relocate(name: string, other: boolean): Rung {
    return rung(name, false, (at, { townAllowed }) => {
      const primary = movementRelocation(game, at, !!townAllowed);
      // The other method is a door after Town; a door has no other method.
      const target: Relocation | undefined = !other ? primary : primary?.method === 'town' ? movementRelocation(game, at, false) : undefined;
      if (!target) return;
      return target.method === 'town'
        ? { trying: 'casting Town to the map spawn', destination: target.destination, options: { relocation: 'town' } }
        : { trying: 'walking to the nearest exit', destination: target.destination, options: { town: false } };
    });
  }
  const replan = rung('replan', true, (_at, { townAllowed }) => ({ trying: 'walking home', options: townAllowed ? {} : { town: false } }));
  return [
    replan, otherRoute('trying the other route home'),
    relocate('relocate', false), replan, relocate('relocate-other', true), replan,
    waitRung,
  ];
}

// Design § 3.2 step 1 with the console's own planner rule (docs/movement.md "Execution and
// recovery"; route-store.ts `recoveryPlanner`): the ladder reaches this rung only after a
// rung that made no progress, which is the evidence a planner switch needs. It plans natively,
// so a native route that failed stays native. It turns Town off, never on, and leaves out the
// leave transition.
function otherRoute(trying: string): Rung {
  return rung('other-route', true, (_at, { engine }) => ({ trying: engine === 'native' ? trying + ' without Town' : trying,
    options: { native: true, town: false, avoidLeave: true } }));
}

// A task walk's way to its goal: a rare path or a member's
// regroup with its group. Its relocation walks to the nearest exit, never
// casts Town, because a task walk keeps its character with the task. With `via`, the
// round also walks through that point when the direct way fails: a regroup goes by the
// saved farm point.
export function taskRound(game: WalkMaps, goal: string, via?: { point: Point; name: string }): Rung[] {
  const walk = rung('walk', true, () => ({ trying: 'walking to ' + goal, options: {} }));
  const exit = rung('relocate', false, at => {
    const target = movementRelocation(game, at, false);
    return target && { trying: 'walking to the nearest exit', destination: target.destination, options: { town: false } };
  });
  const through = via && rung('via', false, at => at.map === via.point.map && Math.hypot(at.x - via.point.x, at.y - via.point.y) <= ARRIVAL_TOLERANCE ? undefined
    : { trying: 'walking by ' + via.name, destination: via.point, options: {} });
  return [walk, ...(through ? [through, walk] : []), otherRoute('trying the other route to ' + goal), exit, walk,
    waitRung];
}

// The way out of an event instance with no exit door, abtesting or ship0 (design § 3.2, the
// "3 event exit instance attempts" row): the instance's own exit with the transporter to Main
// as its fallback, then the next report and the round again. Leaving the map is the goal, so
// an exit that changes maps arrives.
export function eventExitRound(): Rung[] {
  return [rung('exit', true, () => ({ trying: 'leaving the event instance', options: {} })),
    waitRung];
}

// An errand's walk to a member who moves, such as the merchant's delivery (design § 3.2): the
// route again, the other route, then the next report and the round again. A relocation walks
// away from a target that keeps moving, so the round has none.
export function errandRound(goal: string): Rung[] {
  return [rung('walk', true, () => ({ trying: 'walking to ' + goal, options: {} })), otherRoute('trying the other route to ' + goal),
    waitRung];
}

// A journey's own round: one failing plan is never walked again.
// `replan` plans again with the same planner around the crossing that failed: it applies after a
// failed leave transition, which it leaves out, or after the character moved while planning.
// `other-route` plans natively, the console's own planner rule (`otherRoute`), with Town off
// after a Town failure. `end` ends the journey failed, and its requester's own round takes the
// next step. Progress toward the destination, or a new map, starts the round again.
export function journeyRound(): Rung[] {
  return [
    rung('replan', true, (_at, { failed }) => failed === 'drift' ? { trying: 'planning again from here', options: {} }
      : /leave transition/i.test(failed ?? '') ? { trying: 'planning again without the leave transition', options: { avoidLeave: true } } : undefined),
    rung('other-route', true, (_at, { failed }) => ({ trying: 'trying the native planner', options: { native: true, ...(/town/i.test(failed ?? '') ? { town: false } : {}) } })),
    rung('end', true, () => ({ trying: 'ending the journey for its requester to climb', options: {} })),
  ];
}

// A respawned member's way back to its event (design § 3.3 UP-1, step 7 correction 2).
// `rejoin` is the party's shared walk, or the join of a join event. `lone-walk` walks to
// the event as a `death-recovery` request. `relocate` walks to the event map's spawn
// first. A join event has no walk of its own: its server join is the only way in.
export function rejoinRound(join: boolean): Rung[] {
  const rejoin = fixed('rejoin', true, 'rejoining the event with the party');
  const wait = rung('wait', true, (_at, { rounds }) => ({ trying: `waiting for the next report, then asking the group task again (ask ${rounds + 1})`, options: {} }));
  if (join) return [rejoin, wait];
  const lone = fixed('lone-walk', true, 'walking to the event alone');
  return [rejoin, lone, fixed('relocate', false, 'walking to the event map spawn'), lone, wait];
}

export interface WalkPoint { map: string; x: number; y: number; in?: string | number }
// The convoy fields the ladder keeps: its state, and the rung it is on in plain words for
// the activity line and the convoy history.
// `ladderWaitUntil` is the earliest time the wait rung may end, when an add-on's `retry.policy`
// lengthened the wait; the next report still has to arrive first.
export interface WalkClimb { ladder?: LadderState; ladderRung?: string; ladderTrying?: string; ladderWaitAt?: number; ladderWaitUntil?: number }

const near = (a: WalkPoint, b: WalkPoint) => a.map === b.map && Math.hypot(a.x - b.x, a.y - b.y) <= RENDEZVOUS_RANGE;

// The group walk's own ladder: this
// module's ladder, one level up. A route failure moves the walk one rung on; a failure that comes
// after the group got closer to the destination, or onto a new map, starts the round again. No
// count ends it. The ladder's state lives on the convoy as plain data, so a coordinator
// restart resumes the climb where it stood.
// The rungs, in the design's order: re-plan the shared route under a new epoch; the other
// route (the native planner, without Town or the leave transition); rebuild the walk at its
// leader; walk every member to the group's safe point and start the walk again from there;
// then the next report and a new round. A walk that is already at its safe point, or has
// none, skips that rung.
export function walkRound(safePoint: WalkPoint | null): Rung[] {
  return [
    fixed('replan', true, 're-planning the shared route'),
    fixed('other-route', true, 'trying the other route'),
    fixed('rebuild', true, 'regrouping at the leader'),
    { name: 'safe-point', toward: false, attempt: at => !safePoint || near(at, safePoint) ? undefined
      : { trying: 'walking to the safe point to start again', destination: safePoint, options: {} } },
    fixed('wait', true, 'waiting for the next report, then starting over'),
  ];
}

// How far the group still has to go, as the leader stands: a transition left when it is on
// another map, else the straight walking distance.
export function walkCloseness(at: WalkPoint | undefined, goal: WalkPoint): Closeness {
  if (!at || at.map !== goal.map) return { transitions: 1, walking: 0 };
  return { transitions: 0, walking: Math.hypot(at.x - goal.x, at.y - goal.y) };
}

// One failure of the walk: judges the rung that ran against the group's progress and
// returns the next rung. The first failure judges nothing: it starts the climb from where
// the group stands.
export function climbWalk(walk: WalkClimb, round: readonly Rung[], at: WalkPoint, remaining: Closeness, now: number): LadderAttempt {
  const first = !walk.ladder;
  const ladder = createOwnerLadder(round, () => now, walk.ladder ?? { index: 0, rounds: 0, failures: 0, progressAt: now, nearest: remaining, visited: [at.map] });
  if (!first) ladder.result({ arrived: false, at, remaining });
  const attempt = ladder.next(at);
  walk.ladder = ladder.state(); walk.ladderRung = attempt.rung; walk.ladderTrying = attempt.trying;
  return attempt;
}

// The wait rung ended with a fresh report: the round starts over from its first rung.
export function walkWaited(walk: WalkClimb, round: readonly Rung[], now: number): void {
  const ladder = createOwnerLadder(round, () => now, walk.ladder);
  ladder.waited();
  walk.ladder = ladder.state(); delete walk.ladderWaitAt; delete walk.ladderWaitUntil;
}
// The wait rung's time is up: with no `ladderWaitUntil` the next report alone ends it.
export function walkWaitOver(walk: WalkClimb, now: number): boolean {
  return now >= (walk.ladderWaitUntil ?? 0);
}

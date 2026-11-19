// The movement owner on the character (R1.1 `owner.ts`). It holds two parts: the owner service
// `installPartyMovement`, which decides every journey, hold, step and stop through its rank
// table (sections 2 to 4), and the requesters `installMovementRequesters`, the
// identities a character's movers name to it and the holds, Town cast and task walk climb they
// share.
import type { FarmSpot } from '../../hunting/api.ts';
import type { MoveState, MovementHost, MovementContext, MovementKind, MovementRequest, MovementStopper, MovementOptions, StepResult, StepOptions, MovementPorts, Request } from '../../protocol/records.ts';
import { type Point, type Step, distance, isTransition, cachedGeometryFingerprint, point, type PlanResult, type Issue } from '../geometry/contracts.ts';
import { heldLabel, clickLabel, ARRIVAL_TOLERANCE, MOVEMENT_PICKS, clickRule, sendBand, STOP_AND_STEP_BAND, decide, type Requester, judgeStop, stepAllowed, type Stopper, isSafeAt, townGoal, returnWorkflowSuperseded, departureWindow } from '../rules.ts';
import { stepWindowMs } from './steps.ts';
import { createNativePlanner, planReturnCandidates } from './planner.ts';
import { observeMovementCorrections } from './corrections.ts';
import { resolveDestination } from './destinations.ts';
import { movementError, movementFailureCause, retryableMovementRequest, movementDiagnostics } from './records.ts';
import { validateRoute, stepIssue, type ValidationPorts } from '../geometry/validation.ts';
import { createMovementExecutor, sendLeave, sendTown, sendTransport, standStillSend, NOT_NOW, type Sent } from './executor.ts';
import { repairDoorApproaches, transporterApproach } from '../geometry/door-approach.ts';
import { createPlanningScheduleMetrics } from '../../status/character/api.ts';
import { boundFired } from '../../status/api.ts';
import { repairWalkingEndpoint } from '../geometry/walking-endpoint.ts';
import { createMovementRing, callerSite, leadUp, type MovementCaller, type MovementRecordInput, type MovementIncident, type IncidentKind } from '../../protocol/records.ts';
import type { WalkRequester } from '../../protocol/walk.ts';
import { partyHooks } from '../../hooks/index.ts';
import { coreRegistrations } from '../../hooks/core.ts';
import { departureGate, type WalkClient } from './walk-client.ts';
import { CLICK_WAIT_DEFAULT_MS, movementSavedFields } from '../saved-fields.ts';
import { closer, createOwnerLadder, journeyRound, walkCloseness, rejoinRound, taskRound, movementRelocation, type Closeness, type OwnerLadder, type Rung } from '../../protocol/ladder.ts';
import { stepSafety, chooseStep, fighting, type SafetyMonster, type SafetyPoint, type StepSafetyInput } from '../geometry/step-safety.ts';
import { routeAroundIdleAggro } from '../geometry/route-aggro.ts';
import { fresh, setReadings, setClockError, reportInterval, STATUS_TIMER_MS } from '../../protocol/reports.ts';
import { eventFacts } from '../../events/api.ts';
import type { NavigationIntent } from '../saved-fields.ts';
// The movement owner's own two rules for its holder and its cost meter. The service `installPartyMovement`
// builds below runs every decision through `measured`.

// The live request as the owner sees it. A hold (invariant 2) has neither
// journey nor destination.
export interface Held extends Requester { journeyId?: string; destination?: Point; tolerance: number }
export interface OwnerPorts {
  now(this: void): number;
  // An error the owner caught; the service records it and recovers through the ladder.
  caught?(this: void, error: unknown): void;
  // The real clock the cost per call reads (runtime/protocol/records.ts `MovementPorts.cpu`).
  cpu?(this: void): number;
}

const sameInstance = (a: Point, b: Point) => a.map === b.map && String(a.in ?? a.map) === String(b.in ?? b.map);

// The rule table plus the owner's own two rules for its holder. A hold has no destination, so its
// holder's request is a new journey.
export function decideRequest(live: Held | undefined, incoming: Requester, destination: Point, from: Point, clear: (from: Point, to: Point) => boolean) {
  const rule = decide(live, incoming);
  if (rule.decision !== 'same-owner') return rule;
  if (!live!.destination) return { decision: 'granted' as const };
  // Design section 2.2: the same owner asking for the same place keeps the live journey.
  if (sameInstance(destination, live!.destination) && distance(destination, live!.destination) <= live!.tolerance)
    return { decision: 'kept' as const };
  // Design section 2.3: a new point on the same map with a clear straight line retargets in place.
  if (sameInstance(destination, live!.destination) && sameInstance(from, destination) && clear(from, destination))
    return { decision: 'retargeted' as const };
  return { decision: 'granted' as const };
}

// Design section 9.3: the owner's calls and their cost on the host's real clock, and the errors
// it caught. A call that throws answers `onError`, the answer a free character gets (a
// granted journey, an allowed stop, a sent step), and the error becomes a caught-error
// record whose climber tries its next rung.
export function createOwnerMeter(ports: OwnerPorts) {
  let calls = 0, totalMs = 0, maxMs = 0, errors = 0;
  const clock = ports.cpu ?? (() => globalThis.performance?.now() ?? ports.now());
  return {
    measured<T>(run: () => T, onError: T): T {
      const started = clock();
      try { return run(); }
      catch (error) {
        errors++;
        // The recorder runs outside the measured call, so its own failure cannot loop here.
        try { ports.caught?.(error); } catch { /* The error count above still holds it. */ }
        return onError;
      }
      finally {
        const spent = clock() - started;
        calls++; totalMs += spent; maxMs = Math.max(maxMs, spent);
      }
    },
    report: () => ({ calls, totalMs, maxMs, errors }),
  };
}

interface SegmentRepair { plot: Step[]; index: number; target: Point; started: boolean; instance?: string | number; retainEndpoint?: boolean }
// How a journey ended (end codes) and which caller ended it.
interface End { code: string; by?: MovementCaller }
// A caller waiting on a journey's end: the starter, and every repeat the owner kept.
interface Listener { callback?: (done: boolean) => void; resolve(value: unknown): void; reject(error: unknown): void }
// A request that holds the character without a journey (a Town cast), or one that waits for the
// live journey to end (`waiting`). Both carry the navigation revision and runtime they were
// asked under, so a revision change ends them (section 1.3), and the request's own deadline and
// currency test (section 2.1 rule 3).
const labelOf = (held: Requester, journey: boolean) => { const label = heldLabel(held, journey); return label ? { label } : {}; };
type Hold = Requester & Pick<MovementRequest, 'deadline' | 'current' | 'yields'> & { revision: number; runtime: string };
type Waiting = Hold & { destination: unknown; options: MovementOptions; listeners: Listener[] };
// A request waiting on combat: `fighting` is the requester's own fight test and `start` its
// answer. It carries no revision: only its currency test ends it, as the job's token did.
type CombatWait = Requester & { owner: string } & Pick<MovementRequest, 'current'> & { fighting(): boolean; start(started: boolean): void };
interface Journey { routeAggro?: { detours: number; crossings: number }; listeners: Listener[]; terminalSettlement?: Record<string,unknown>; scheduling?: ReturnType<typeof createPlanningScheduleMetrics>; settlingAt?: number; repair?: SegmentRepair; repaired?: boolean; repairEndpoints?: string[]; repairRemaining?: Closeness; firstIssue?: Issue; failureContext?: Record<string, unknown>; id: string; context: MovementContext; options: MovementOptions; native: boolean; pending: boolean; searches: number; ladder: OwnerLadder; started: number; planningAt: number; fallback: boolean; plannerMs?: number; collisionError?: string; requestMs?: number; distance?: number; transitions?: number; importedEngine?: string }
const failurePhases = new Map([
  ['superseded', 'Movement cancelled'],
  ['convoy-communication-hold', 'Movement paused: coordinator communication unavailable'],
  ['convoy-failure', 'Movement failed'],
]);
// Rule 4: a step to within this distance of the step being walked is not sent again,
// the same bound as `sendCombatMove` (characters/shared.js).
const STEP_REPEAT = 2;
function arrivalTolerance(options: MovementOptions): number {
  const tolerance = options.arrivalTolerance ?? ARRIVAL_TOLERANCE;
  if (!Number.isFinite(tolerance) || tolerance < 1) throw Error('Arrival tolerance must be at least 1');
  return tolerance;
}
// The planner's budget for one try: a request may name its own within the planner's bounds, 1 to
// 120 s, and otherwise gets the player's `movementPlanningMs`. A coordinator request that ended
// on its own timeout (characters/shared.js `request` names it `partyRequest.kind`).
function requestTimedOut(error: unknown): boolean {
  return (movementError(error).partyRequest as { kind?: string } | undefined)?.kind === 'timeout';
}
function nativePlanningTimeout(options: MovementOptions, planningMs: number): number {
  const timeout = options.nativePlanningTimeoutMs ?? planningMs;
  if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 120000)
    throw Error('Native planning timeout must be between 1 and 120 seconds');
  return timeout;
}
// A request may let the same search run on while it keeps advancing, with no maximum: the
// planner's frontier is the progress rule.
function nativePlanningProgress(options: MovementOptions): number | undefined {
  return options.nativePlanningWhileAdvancing ? Infinity : undefined;
}
function finalApproach(plot: Step[], from: Point, to: Point, options?: MovementOptions): Step[] {
  // Precision callers need the final approach that coarse planner nodes omit.
  // The caller validates this connector with native collision rules too.
  if (options?.arrivalTolerance === undefined || options.shared) return plot;
  const remaining = distance(plot.at(-1) || from, to);
  return remaining > 0 && remaining <= ARRIVAL_TOLERANCE ? [...plot, point(to)] : plot;
}
// Movement's walk state on the character: the navigation intent, the runtime id the coordinator binds
// walk leases to, the clock difference the heartbeat measures, and the flags of the walks this
// character runs (the follow, the forced walk, the party walk, the party Town and its own Town trip).
// The owner holds it; movement's parts and the character's code read and write it as
// `movement.walkState`.
export interface WalkState {
  intent: NavigationIntent;
  runtimeId: string;
  clockOffset: number;
  following: boolean;
  forceTraveling: boolean;
  convoyActive: boolean;
  townTraveling: boolean;
  townActive: boolean;
  // The character departs (the Town, an event exit, a merchant job's walk): the departure loot and
  // the departure turn row hold until it ends.
  departing: boolean;
  // The party's farm spot, which each reply's `party-walks` row and the walk commands write, and the
  // coordinator's farm travel pause from the reply.
  partyLocation: FarmSpot | null;
  farmTravelPaused: boolean;
  // The party Town loop's generation: an accepted command, an escape and each Town loop move it
  // on, and a Town loop acts while the generation is the one it started under.
  townGeneration: number;
  // The convoy this character defends, or null (walk-client.ts `interruptConvoyForDefense`).
  convoyDefense: string | null;
  // The card's navigation detail line, which the status owner's report sends
  // while a walk runs.
  navigationDetail: string | null;
}
// The one writer of each of the three fields above.
export function nextTownGeneration(state: WalkState): number { return ++state.townGeneration; }
export function defendConvoy(state: WalkState, convoy: string | null): void { state.convoyDefense = convoy; }
export function showNavigation(state: WalkState, detail: string | null): void { state.navigationDetail = detail; }
// Step safety's view of the monsters the character sees, each at its real position.
export function safetyMonsters(entities: MovementHost['parent']['entities']): SafetyMonster[] {
  const list: SafetyMonster[] = [];
  for (const [key, e] of Object.entries(entities ?? {})) {
    if (!e || e.type !== 'monster') continue;
    list.push({ id: String(e.id ?? key), x: Number.isFinite(e.real_x) ? e.real_x! : Number(e.x), y: Number.isFinite(e.real_y) ? e.real_y! : Number(e.y),
      target: e.target, aggro: e.aggro, range: e.range, dead: !!e.dead, visible: e.visible });
  }
  return list;
}
// Step safety's view of the character on its host: its real position, its attack target, its
// range, the monsters and the game's walk test. `zones` is the add-on's step refusal, when one
// keeps zones.
export function safetyInput(host: Pick<MovementHost, 'character' | 'can_move'>, monsters: SafetyMonster[], target?: string,
    zones?: StepSafetyInput['zones']): Omit<StepSafetyInput, 'to'> {
  const c = host.character;
  return { name: c.name, from: { x: c.real_x, y: c.real_y }, target, attacking: c.target == null ? undefined : String(c.target), range: c.range, monsters,
    walkable: (from: SafetyPoint, to: SafetyPoint) => host.can_move({ map: c.map, x: from.x, y: from.y, going_x: to.x, going_y: to.y, base: c.base }), zones };
}
export function installPartyMovement(host: MovementHost, ports: MovementPorts) {
  host.__partyMovement?.dispose();
  // The intent outlives a CODE reload on the root, where the navigation writes it (walk-client.ts
  // `createNavigation`); the runtime id is new on each load.
  const walkState: WalkState = { intent: (host as { __partyNavigationIntent?: WalkState['intent'] }).__partyNavigationIntent || { revision: 0, cancelled: false },
    runtimeId: Date.now() + '-' + Math.random().toString(36).slice(2), clockOffset: 0, following: false, forceTraveling: false,
    convoyActive: false, townTraveling: false, townActive: false, departing: false, partyLocation: null, farmTravelPaused: false,
    townGeneration: 0, convoyDefense: null, navigationDetail: null };
  const native = host.__partyNativeMovement ||= { move: host.smart_move, stop: host.stop, start: host.start_pathfinding, next: host.continue_pathfinding, tick: host.smart_move_logic };
  const planner = createNativePlanner(host, native);
  const state: MoveState = { map: host.character.map, x: 0, y: 0, moving: false, searching: false, found: false, plot: [], use_town: true, try_exact_spot: false, edge: 20, on_done() {} };
  let version = Number(host.parent.__partyClientVersion || host.G.version), fingerprint = cachedGeometryFingerprint(host.G);
  let report = movementDiagnostics(host, ports, host.character.name, version, fingerprint);
  // The console's pause sources (appendix A2 `consoleMovementPaused`): Manual holds every walk, and
  // the drain parks it when the lifecycle owner's drain answer says park.
  function consolePaused(): boolean {
    const p = ports.pauses;
    return p.manual() || p.drainPark();
  }
  // The journey context (A2 `context`): a runner whose socket dropped is no longer current, and
  // the console's pauses, a typed pause, the Cave's gate and the run scope's hold each pause
  // movement. The game's runner calls the scheduler every 80 ms outside the run scope
  // (runner_functions.js `smart_move_logic`), so a held character's journey still ticks; the hold
  // pauses it here, which records the pause and Play's resume.
  function readContext(): MovementContext {
    const parent = host.parent;
    return { server: parent.server_region && parent.server_identifier ? String(parent.server_region) + String(parent.server_identifier) : undefined,
      runtime: walkState.runtimeId, revision: Number(walkState.intent && walkState.intent.revision) || 0, current: ports.current() && (!parent.socket || parent.socket.connected !== false),
      paused: consolePaused() || !!host.__partyMovementPaused || ports.pauses.caveHolds() || ports.pauses.held() };
  }
  const validation: ValidationPorts = {
    get game() { return host.G; },
    walk: (a, b) => host.can_move({ map: a.map, x: a.x, y: a.y, going_x: b.x, going_y: b.y, base: host.character.base }),
    door: (p, d) => host.is_door_close(p.map, d, p.x, p.y) && host.can_use_door(p.map, d, p.x, p.y),
    hasKey: key => host.character.items.some(item => item?.name === key),
  };
  // The departure gate's reads (T4 `ready`): the game's monsters on this character, and the window
  // of its attack period from the game and two of its own report intervals.
  const gate = departureGate({ chests: ports.departureChests, now: ports.now,
    attackers: () => Object.values(host.parent.entities ?? {}).filter(e => e?.type === 'monster' && e.target === host.character.name && !e.dead),
    windowMs: () => departureWindow(Number(host.character.frequency) > 0 ? 1000 / Number(host.character.frequency) : 0, reportGapMs) }, partyHooks());
  // The requesters' measured report gap (`reportSucceeded`), which `reported` hands in.
  let reportGapMs = STATUS_TIMER_MS;
  const executor = createMovementExecutor(host, state, validation, ports.now, gate, { band: () => sendBand(journey?.options.request), stopTown: () => nativeStop('town'), standStill, roundTrip: () => hooks.calls.margin() });
  let journey: Journey | undefined, sequence = 0, disposed = false, contextPaused = false;
  const ring = createMovementRing(ports.now, ports.ringSize);
  // Design section 7 trigger 4, churn: 10 replacements, refusals or refused stops inside 10 s
  // (the design's own figures) save one snapshot, and the count starts again after it.
  const CHURN_COUNT = 10, CHURN_WINDOW_MS = 10_000;
  const churn: number[] = [];
  const push = ring.push;
  const hooks = partyHooks();
  ring.push = entry => {
    push(entry);
    announce(entry);
    const conflict = entry.decision === 'refused' || entry.decision === 'refused-stop' || entry.decision === 'ended' && String(entry.code).startsWith('replaced:');
    if (!conflict) return;
    const now = ports.now();
    churn.push(now);
    while (churn.length && now - churn[0] > CHURN_WINDOW_MS) churn.shift();
    if (churn.length >= CHURN_COUNT) { churn.length = 0; snapshot('churn'); }
  };
  // Section 6's and R5's notices, from the ring entries that record them: after a granted, kept or
  // retargeted journey, a pause, a resume, every end, a request that waits or is refused, a hold
  // that starts and a click that takes the character. Each names `by` (D:7826, contract part 2):
  // the requester's owner identity, or `rule:<row>` where the table decided. A listener that
  // throws leaves one `notice-error` entry and changes nothing else.
  function announce(entry: MovementRecordInput): void {
    const d = entry.decision, journeyId = entry.journeyId as string | undefined;
    const character = host.character.name, by = entry.by;
    if (journeyId && (d === 'started' || d === 'kept' || d === 'retargeted'))
      tell('journey.started', { character, requestId: journeyId, kind: entry.kind, owner: entry.owner, destination: entry.destination, status: d === 'started' ? 'granted' : d, by: entry.owner });
    else if (journeyId && d === 'paused') tell('journey.paused', { character, requestId: journeyId, by: by ?? entry.cause, reason: entry.cause, state: d });
    else if (journeyId && d === 'resumed') tell('journey.resumed', { character, requestId: journeyId, by: by ?? entry.cause, reason: entry.cause });
    else if (journeyId && d === 'ended' || d === 'expired') tell('journey.ended', { character, requestId: journeyId, kind: entry.kind, owner: entry.owner, code: entry.code, by });
    else if (d === 'waiting') tell('request.waiting', { character, kind: entry.kind, owner: entry.owner, tier: entry.tier, cause: entry.cause, by });
    else if (d === 'refused' || d === 'refused-stop') tell('request.refused', { character, kind: entry.kind, owner: entry.owner, stop: d === 'refused-stop', rule: entry.code ?? entry.cause, by });
    else if (d === 'held') tell('hold.started', { character, kind: entry.kind, owner: entry.owner, tier: entry.tier, deadline: hold?.deadline, by });
    else if (d === 'click') tell('click.taken', { character, state: 'taken', destination: entry.destination, by: entry.owner });
  }
  // One notice to every listener, at the change it tells.
  function tell(hook: Parameters<typeof hooks.notify>[0], payload: Record<string, unknown>): void {
    for (const name of hooks.notify(hook, payload)) push({ decision: 'notice-error', owner: name, code: hook });
  }
  // Every console caller names its requester, so a call that names none is code the player
  // typed in the game client, and it ranks as the player's command. A typed stop clears
  // movement before the player's own request, so it ranks as that request.
  const typed: MovementRequest = { kind: 'manual', owner: 'manual' }, typedStop: Stopper = { ...typed, takeover: true };
  // The hold without a journey and the waiting requests, newest first.
  let hold: Hold | undefined;
  const waiting: Waiting[] = [];
  // The requests waiting on combat (the request table `waiting`), oldest first.
  const combatWaiting: CombatWait[] = [];
  // Design section 2.4: the combat pause of the live journey, the last step or hold, the step the character walks, and the holder whose
  // refusal the ring already holds. `stepMs` is how long the last step keeps the pause (rule 5): the time to walk that step at the
  // character's speed plus one movement tick; a hold walks nothing.
  let paused = false, stepAt = 0, stepMs = 0, refusedFor: string | undefined;
  let stepping: { x: number; y: number } | undefined;
  // `unsafe` counts steps step safety refused, `risky` the least risky steps it let through. `budget`
  // counts combat steps the call budget held, which are no refusal of the step.
  const steps = { sent: 0, kept: 0, refused: 0, stops: 0, pauses: 0, resumes: 0, unsafe: 0, risky: 0, budget: 0 };
  // Queue C1 (user): a click to walk in the game client is the player's command.
  // The game asks the code page's `on_map_click` before it walks (game.js map_click), so the
  // owner hears each click with no polling. The click ranks `manual` while its walk runs and
  // for `clickWaitMs` after the walk ends. A journey it outranks pauses; lower requests, holds
  // and combat steps wait or are refused as the rank table says; a newer command of the
  // player's own replaces it. When the countdown ends the paused journey resumes by itself,
  // and a new click starts the walk and the countdown again, so the pause never stays open.
  const clicker: MovementRequest = { kind: 'manual', owner: 'click' };
  const clickHeld: Held = { kind: clicker.kind, owner: clicker.owner, tolerance: 0 };
  // `town` names the Town holder the click interrupted, whose cast its requester asks again.
  let click: { to: SafetyPoint; walking: boolean; until?: number; paused: boolean; town?: string } | undefined;
  let clickWaitMs = CLICK_WAIT_DEFAULT_MS;
  function clickWait(ms: number | undefined) { clickWaitMs = ms !== undefined && Number.isFinite(ms) && ms >= 0 ? ms : CLICK_WAIT_DEFAULT_MS; }
  // The player's planning budget per try as the last reply delivered it (saved-fields.ts `deliver:
  // ['characters']`, R2F4); the repair, sight search and crossing picks are rules.ts
  // `MOVEMENT_PICKS`.
  let planningMs = SAVED.movementPlanningMs.default;
  // The delivered routine picks (`routines`, per character and slot), which the formation solver reads.
  let routinePicks: Record<string, Record<string, unknown> | undefined> = {};
  function clicked(to: SafetyPoint): void {
    if (disposed) return;
    owner.measured(() => {
      expireHeld();
      const live = journey ? held(journey) : hold && !hold.yields ? heldHold(hold) : undefined;
      // The request table's click column: a row the player's commands do not end (the Cave, lifecycle) keeps the
      // character; a dashboard travel or typed code is an older command of the player's own, and
      // the click replaces it as the newer one. The click also takes the console's Town (user): a
      // click breaks a Town channel whatever the console does, so the owner recovers instead of
      // preventing it, and the Town requester casts again after the click.
      if (live && !click && clickRule(live) === 'ranks' && decide(live, clicker).decision !== 'granted') {
        ring.push({ decision: 'refused', journeyId: live.journeyId, kind: clicker.kind, owner: clicker.owner, code: 'click' });
        return;
      }
      // A hold whose request table click column `waits` (the console's Town) is interrupted and its requester
      // casts again after the click; the click replaces any other hold.
      const waits = !journey && !!hold && clickRule(hold) === 'waits';
      const interrupted = waits ? hold!.owner : click?.town;
      if (!journey && hold) endHold(waits ? 'interrupted:click' : 'replaced:manual', { kind: clicker.kind, owner: clicker.owner });
      const j = journey, pausing = !!j && !click?.paused;
      click = { to, walking: true, paused: !!j, ...(interrupted ? { town: interrupted } : {}) };
      ring.push({ decision: 'click', kind: clicker.kind, owner: clicker.owner, destination: { map: host.character.map, x: to.x, y: to.y } });
      if (pausing) {
        ring.push({ decision: 'paused', journeyId: j!.id, kind: j!.options.request!.kind, owner: j!.options.request!.owner, cause: 'click' });
        // The game's own move for the click replaces the travel move.
        executor.pause(false);
      }
      stepping = undefined;
      // map_click sets `moving` right after this hook returns, so the walk is seen at once.
      ports.scope.queueMicrotask(clickTick);
    }, undefined);
  }
  function clickTick(): void {
    if (!click) return;
    if (click.walking) {
      if (!host.character.moving) { click.walking = false; click.until = ports.now() + clickWaitMs; }
      return;
    }
    if (ports.now() >= click.until!) endClick('elapsed');
  }
  function endClick(code: string): void {
    const ended = click;
    if (!ended) return;
    click = undefined;
    ring.push({ decision: 'ended', kind: clicker.kind, owner: clicker.owner, code });
    // The request table's click column decides when the click hands the character back (contract part 2 `by`).
    tell('click.taken', { character: host.character.name, state: 'returned', code, by: 'rule:T1' });
    const j = journey;
    if (ended.paused && j) {
      ring.push({ decision: 'resumed', journeyId: j.id, kind: j.options.request!.kind, owner: j.options.request!.owner, cause: 'click' });
      paused = false; executor.resume();
    }
    if (waiting.length) ports.scope.queueMicrotask(() => resumeWaiting(true));
  }
  // The click against an incoming request or hold: undefined when the click is not in the
  // way, else the decision the rank table gives the incoming one.
  function clickDecides(incoming: Requester): 'waiting' | 'refused' | undefined {
    if (!click) return;
    // The request table's click column: a newer command of the player's own (typed code, a dashboard travel)
    // replaces the click, and the console's Town waits for it to hand back (user).
    const rule = clickRule(incoming);
    if (rule === 'replaces') { endClick('replaced:manual'); return; }
    if (rule === 'waits') return 'refused';
    const ranked = decide(clickHeld, incoming).decision;
    if (ranked === 'granted') { endClick('replaced:' + incoming.kind); return; }
    return ranked === 'waiting' ? 'waiting' : 'refused';
  }
  // Design section 1.2 `ladder` and section 3.2: the one climber's ladder,
  // and the per-tick audit's counts. `unowned` counts climbers that stood between rungs
  // with nothing holding the character for two ticks, `untimed` holds with no deadline,
  // `expired` and `stale` the requests the audit or a tick ended.
  let climber: { owner: string; activity?: string; ladder: OwnerLadder; startSeq: number; idle: number; flagged: boolean } | undefined, untimedFor: Hold | undefined;
  const invariants = { unowned: 0, untimed: 0, expired: 0, stale: 0 };
  // Every call that named no request, by call site: code typed in the game client, or a console
  // caller that lost its requester and now ranks as the player's command. It counts every typed
  // move and every typed stop of a live journey or hold, so the ring's bound drops none of
  // them.
  const typedSites: Record<string, number> = {};
  const typedAt = (stack: string | undefined) => { const site = callerSite(stack); typedSites[site] = (typedSites[site] || 0) + 1; return site; };
  // Stuck and caught-error records. A stuck moment shows as a notice on the next rung until
  // that rung's first progress or `noticeMs`, whichever comes first; the heartbeat sets
  // `noticeMs`.
  const incidents = createMovementRing<MovementIncident>(ports.now, ports.ringSize);
  let previousClimb: { startSeq: number; endedAt: number } | undefined, noticeMs: number | undefined;
  let notice: { text: string; until?: number; incident: string } | undefined, stuckId: string | undefined;
  // A caught error is recorded with its lead-up, and a live climber tries its next rung.
  const owner = createOwnerMeter({ now: ports.now, cpu: ports.cpu,
    caught: error => { incident('caught-error', { error: String(error) }); climber?.ladder.fail(); } });
  let last: Record<string, unknown> | null = null;
  const position = (): Point => ({ map: host.character.map, in: host.character.in, x: host.character.real_x, y: host.character.real_y });
  function current(j: Journey): boolean {
    if (disposed || journey !== j) return false;
    try {
      const c = readContext();
      return c.current && c.runtime === j.context.runtime && c.revision === j.context.revision && !host.character.rip;
    } catch { return false; } // A retired runner's guarded parent can no longer be read.
  }
  const corrections=observeMovementCorrections(host, () => {
    const j=journey,p=executor.progress(),destination=p.destination;
    return !!j && current(j) && state.moving && state.found && p.phase==='walking' &&
      destination?.map===host.character.map && String(destination.in??destination.map)===String(host.character.in??host.character.map);
  },()=>executor.pause(),ports.now,ports.scope);
  function finish(done: boolean, failure?: unknown, cause?: Record<string, unknown>, end?: End) {
    const j = journey;
    if (!j) return;
    const reason = failure === undefined ? undefined : movementError(failure).message;
    cause = movementFailureCause(failure, cause);
    end ??= { code: done ? 'arrived' : cause?.code === 'superseded' ? 'superseded' : 'failed:' + String(cause?.code || 'route-failed') };
    ring.push({ decision: 'ended', journeyId: j.id, kind: j.options.request!.kind, owner: j.options.request!.owner,
      destination: point(state), code: end.code, by: end.by, cause: typeof cause?.code === 'string' ? cause.code : undefined });
    const progress=executor.progress(), remaining=state.found ? routeLeft(state.plot.slice(progress.step)) : undefined;
    journey = undefined; paused = false; state.moving = state.searching = false; planner.cancel();
    if (done) executor.reset(); else executor.cancel();
    last = {id:j.id,engine:engine(j),version,fingerprint,done,reason,elapsedMs:ports.now()-j.started,
      failureContext:{code: done ? 'arrived' : 'route-failed', character:host.character.name, journeyId:j.id, planner:engine(j), base:{...host.character.base}, ...j.options.owner,...j.failureContext,...cause,origin:position(),destination:point(state),firstIssue:j.firstIssue, relocation:movementRelocation(host.G,position(),state.use_town)},
      end:end.code,endedBy:end.by,routeAggro:j.routeAggro,nativeCorrections:corrections.report(),terminalSettlement:j.terminalSettlement,searches:j.searches,rung:j.ladder.report().rung,plannerMs:j.plannerMs,collisionError:j.collisionError,requestMs:j.requestMs,walkingDistance:j.distance,transitions:j.transitions,remaining,nativePlanning:planner.report(),planningSchedule:j.scheduling?.report(),progress};
    ports.metrics?.(last);
    if (j.fallback || !done) report(j.id, state, outcome(done, reason, cause), j.firstIssue, reason, last.failureContext as Record<string, unknown>);
    report.end(j.id);
    state.on_done(done, reason, failure);
    // A replacement starts its journey before this runs, so only a free character resumes.
    if (waiting.length) ports.scope.queueMicrotask(resumeWaiting);
  }
  // The walking distance and transitions from where the character stands through `plot`.
  // The survival ladder compares them to tell progress from a walk that gets no closer.
  function routeLeft(plot: Step[]) {
    let previous = position(), walking = 0, transitions = 0;
    for (const step of plot) { if (isTransition(step)) transitions++; else walking += distance(previous, step); previous = step; }
    return { walking, transitions };
  }
  function engine(j: Journey) { return j.importedEngine || (j.native ? 'native' : 'alclient'); }
  function outcome(done: boolean, reason?: string, cause?: Record<string,unknown>): string {
    const causePhase = failurePhases.get(String(cause?.code));
    if (causePhase) return causePhase;
    if (done) return 'Native fallback succeeded';
    if (reason === 'Combat handoff') return 'Travel paused for combat';
    return /cancelled|replaced|superseded|stop|regroup|takeover|hold/i.test(reason || '') ? 'Movement cancelled' : 'Movement failed';
  }
  function fallback(j: Journey, issue: Issue) {
    if (!current(j)) return;
    if (j.options.owner?.recoveryStage === 'post-relocation') { finish(false, 'ALClient retry failed after relocation: ' + issue.reason); return; }
    report(j.id, state, j.native ? 'Native movement recovery' : 'Trying native pathfinding', issue, 'falling back to native smart_move');
    j.firstIssue ||= issue;
    delete j.repair;
    j.fallback = true; j.native = true; j.pending = false; j.planningAt = ports.now();
    state.found = state.searching = false; state.plot.length = 0; executor.reset();
  }
  // `planned` marks a plot this character's own planner produced, as opposed to an
  // imported route or a repair of one.
  function install(plot: Step[], nativeRoute: boolean, planned = false) {
    if (!nativeRoute) plot = repairDoorApproaches(validation, position(), plot);
    plot = trimUncheckedFinal(finalApproach(plot, position(), state, journey?.options));
    if(journey&&sameJourneyInstance(journey,position()))plot=repairWalkingEndpoint(validation,position(),state,plot);
    // A journey's walking segments go around idle aggro blocks when a walkable detour exists. A shared route takes the detour once, when its leader
    // plans it, so the route it publishes is the plot every member walks and its barriers count. An imported shared route stays as published.
    if (journey && (planned || !journey.options.shared)) {
      // The walk from where the character stands to the first point is a segment too.
      const routed = routeAroundIdleAggro([position(), ...plot], visibleMonsters(), validation.walk, host.character.map);
      plot = routed.plot.slice(1);
      const total = journey.routeAggro ||= { detours: 0, crossings: 0 };
      total.detours += routed.detours; total.crossings += routed.crossings;
    }
    const issue = validateRoute(validation, position(), state, plot, state.use_town, state.edge);
    if (issue) {
      if (nativeRoute) throw Error(`Native route rejected: ${issue.reason} between ${JSON.stringify(issue.from)} and ${JSON.stringify(issue.to)}`);
      if (!beginRepair(journey!, plot, issue)) fallback(journey!, issue); return false;
    }
    const { walking, transitions } = routeLeft(plot);
    if (journey) { journey.distance = walking; journey.transitions = transitions; }
    state.plot.splice(0, state.plot.length, ...plot); state.searching = false; state.found = true; executor.reset(); return true;
  }
  function beginRepair(j: Journey, plot: Step[], issue: Issue): boolean {
    j.firstIssue ||= issue;
    const remaining = routeLeft(plot);
    if (j.options.owner?.recoveryStage === 'post-relocation' || !repairAllowed(j,issue.to,remaining) || issue.reason !== 'collisions detected' || issue.from.map !== position().map) return false;
    const index = plot.findIndex(p => p === issue.to);
    if (index < 0 || isTransition(plot[index])) return false;
    recordRepair(j,issue.to,remaining);
    j.repair = {plot, index, target: point(issue.to), started: false};
    j.pending = false; state.searching = false;
    report(j.id, state, 'Repairing rejected walking segment', issue, `native same-map connector; limit ${MOVEMENT_PICKS.movementRepairMs / 1000} seconds`);
    return true;
  }
  function repairEndpoint(target: Point): string { return JSON.stringify([target.map,target.x,target.y]); }
  // `remaining` is the route left from where the character stands when the repair starts.
  function recordRepair(j: Journey, target: Point, remaining: Closeness): void {
    j.repaired = true;
    if(j.options.shared && j.options.repairSharedDrift){(j.repairEndpoints ||= []).push(repairEndpoint(target));j.repairRemaining=remaining;}
  }
  // A shared walk repairs its drift at a new endpoint while each repair finds the walk closer to
  // its goal than the last repair did (ladder.ts `closer`, the climb's progress test), so a
  // repair with no progress since the last ends the repairs. Any other walk repairs once.
  function repairAllowed(j: Journey, target: Point, remaining: Closeness): boolean {
    if(!j.options.shared || !j.options.repairSharedDrift)return !j.repaired;
    return !j.repairRemaining || !j.repairEndpoints!.includes(repairEndpoint(target)) && closer(remaining,j.repairRemaining);
  }
  function repairTick(j: Journey): void {
    const repair = j.repair!;
    try {
      if (!repairInstanceValid(j,repair)) throw Error('Repair instance changed');
      if (!repair.started) { planner.begin(repair.target, false, ports.now(), MOVEMENT_PICKS.movementRepairMs, 'movementRepairMs'); repair.started = true; j.searches++; }
      const bridge = planner.tick(ports.now());
      if (!bridge) return;
      if (distance(bridge.at(-1) || position(), repair.target) > ARRIVAL_TOLERANCE) throw Error('Repair missed its connector endpoint');
      if (bridge.some(p => isTransition(p) || p.map !== position().map)) throw Error('Repair left the current map');
      const plot = repair.retainEndpoint ? [...bridge,repair.target,...repair.plot.slice(repair.index)]
        : [...bridge, ...repair.plot.slice(repair.index + 1)];
      const invalid = validateRoute(validation, position(), state, plot, state.use_town, state.edge);
      if (invalid) throw Error('Repair did not validate: ' + invalid.reason);
      delete j.repair; install(plot, true);
      report(j.id, state, 'Walking segment repaired', j.firstIssue);
    } catch (error) { repairFailed(j,error); }
  }
  function repairInstanceValid(j: Journey, repair: SegmentRepair): boolean {
    const from = position(), expected = repair.instance ?? repair.target.map;
    return !j.options.repairSharedDrift || String(from.in ?? from.map) === String(expected);
  }
  function repairFailed(j: Journey, error: unknown): void {
    planner.cancel();
    j.failureContext = {repairFailure: String(error)};
    if (j.options.repairSharedDrift && j.options.shared) { finish(false, 'Shared connector repair failed: ' + String(error)); return; }
    fallback(j, j.firstIssue!);
  }
  function trimUncheckedFinal(plot: Step[]): Step[] {
    // Both planners may append an exact endpoint across a thin obstacle.
    // Shared routes retain their exact, coordinator-owned endpoints.
    if (journey?.options.shared) return plot;
    const last = plot.at(-1), previous = plot.at(-2);
    return last && previous && !isTransition(last) && last.map === previous.map &&
      !validation.walk(previous, last) && distance(previous, state) <= state.edge
      ? plot.slice(0, -1) : plot;
  }
  function nativeTick(j: Journey) {
    // `prepare` (movement.ts:370): a follower waits for its leader's route within the
    // planner's own budget.
    if (j.options.awaitSharedRoute) {
      const ms = nativePlanningProgress(j.options) ?? nativePlanningTimeout(j.options, planningMs);
      if (ports.now() - j.started <= ms) return;
      boundFired({ bound: 'movementPlanningMs', owner: '02', state: { ms, shared: true } });
      throw Error('Shared route preparation timed out');
    }
    if (!state.searching) { planner.begin(point(state), state.use_town, ports.now(), nativePlanningTimeout(j.options, planningMs), 'movementPlanningMs', nativePlanningProgress(j.options)); state.searching = true; j.searches++; }
    const plot = planner.tick(ports.now());
    if (plot) install(plot, true, true);
  }
  function planFailure(j: Journey, result: PlanResult & {mode?: string}, from: Point, destination: Point) {
    const verified = result.failure === 'unreachable' && result.mode === 'alclient' && result.id === j.id &&
      result.version === version && result.fingerprint === fingerprint;
    if (j.options.rejectUnreachableGoal && verified) finish(false, result.error);
    else fallback(j, {reason:result.error!,from,to:destination});
  }
  function requestPlan(j: Journey) {
    if (j.pending) return;
    j.pending = true; state.searching = true; j.searches++;
    const from = position(), destination = point(state), town = state.use_town;
    const requestedAt = ports.now();
    const body = {
      base: {...host.character.base}, id: j.id, character: host.character.name, from, to: destination, speed: j.options.speed || host.character.speed, town, version, fingerprint, avoidLeave: j.options.avoidLeave,
    };
    // The coordinator's planner answers within its own ALClient budget, so the request's bound is
    // the try's planning budget, against a coordinator that never answers.
    // A return's two candidates go through planReturnCandidates, whose own bound reports a cut request.
    const planMs = planningMs, candidates = !!(j.options.compareTown && town);
    const planning = candidates ? planReturnCandidates(ports, validation, body, state.edge, true)
      : ports.request('/movement-plan', { method: 'POST', timeout: planMs, body });
    planning.then(value => {
      if (!current(j)) return;
      const result = value as PlanResult & { mode?: string; error?: string };
      if (result.error) {
        planFailure(j, result, from, destination);
        return;
      }
      if (result.id !== j.id || result.version !== version || result.fingerprint !== fingerprint) throw Error('Planner response identity mismatch');
      if (distance(position(), from) > 1) {
        replanDrift(j);
        return;
      }
      // `collisionError`: the coordinator planned this route without the game's collision check
      // (planner-worker.ts), which the member's report names.
      j.plannerMs = result.ms; j.collisionError = result.collisionError; j.requestMs = ports.now() - requestedAt;
      if (result.mode === 'shadow') {
        const issue = validateRoute(validation, from, destination, result.plot, town, state.edge);
        ports.metrics?.({id:j.id,phase:'shadow',version,fingerprint,valid:!issue,issue,plot:result.plot,plannerMs:result.ms,requestMs:j.requestMs});
        fallback(j, issue || { reason: 'Shadow comparison valid; native execution selected', from, to: destination }); return;
      }
      install(result.plot, false, true);
    }).catch(error => {
      if (!current(j)) return;
      if (retryableMovementRequest(error)) {
        if (!candidates && requestTimedOut(error)) boundFired({ bound: 'movementPlanningMs', owner: '02', state: { ms: planMs, coordinator: true } });
        finish(false, error); return;
      }
      const reason = String(error);
      if (/geometry|route|path|walk|segment|collision|blocked/i.test(reason)) fallback(j, { reason, from, to: destination });
      else finish(false, error);
    });
  }
  function replanDrift(j: Journey) {
    j.pending = false; state.searching = false;
    const attempt = climb(j, 'drift');
    if (attempt.rung === 'end') finish(false, 'Character moved while planning');
    else if (attempt.rung === 'other-route') fallback(j, { reason: 'Character moved while planning', from: position(), to: point(state) });
  }
  function planningBlocked(metrics: ReturnType<typeof createPlanningScheduleMetrics>): boolean {
    if(host.character.moving){metrics.blockedMoving();return true;}
    if(host.is_transporting(host.character)){metrics.blockedTransporting();return true;}
    return false;
  }
  function planTick() {
    const j = journey;
    if (!j || state.found) return;
    if (!current(j)) { finish(false, 'Navigation revision or runtime superseded this journey', {code:'superseded'}); return; }
    const scheduling=j.scheduling ??= createPlanningScheduleMetrics();scheduling.plan();
    // movement.ts:437: the stop before a plan settles when the game reports `moving` false,
    // within one measured round trip; a transport waits on the game's map change.
    if (planningBlocked(scheduling)) {
      if (host.is_transporting(host.character)) { j.settlingAt = undefined; return; }
      j.settlingAt ??= ports.now();
      if (ports.now() - j.settlingAt > hooks.calls.margin()) finish(false, 'Character did not settle before route planning');
      return;
    }
    j.settlingAt = undefined;
    try { planningStep(j); }
    catch (error) { finish(false, error); }
  }
  function planningStep(j: Journey): void {
    if (j.options.relocation === 'town') { install([{...point(state),town:true}],true); return; }
    if (j.repair) repairTick(j); else if (j.native) nativeTick(j); else requestPlan(j);
  }
  function recover(j: Journey, error: unknown) {
    if (j.options.shared) {
      if (!repairSharedConnector(j)) finish(false, error);
      return;
    }
    const attempt = climb(j, String(error));
    if (attempt.rung === 'end') { finish(false, /leave transition/i.test(String(error)) ? 'Leave transition failed: ' + String(error) : error); return; }
    if (attempt.rung === 'replan') {
      j.options = {...j.options, ...attempt.options};
      j.pending = false; state.found = state.searching = false; state.plot = []; executor.reset();
      report(j.id, state, 'Leave transition failed; replanning with ALClient');
      return;
    }
    if (attempt.options.town === false) state.use_town = false;
    void standStill();
    fallback(j, { reason: `${String(error)}; ${attempt.trying}`, from: position(), to: state.plot[0] || point(state) });
  }
  // One failure of the journey's own plan, judged by the one climber: progress
  // toward the destination, or a new map, starts the round again.
  function climb(j: Journey, failed: string) {
    const at = position();
    j.ladder.result({ arrived: false, at, remaining: walkCloseness(at, point(state)) });
    return j.ladder.next(at, { failed });
  }
  function repairSharedConnector(j: Journey): boolean {
    const next = state.plot[0], from = position();
    if (!j.options.repairSharedDrift || !next || isTransition(next) || !sameJourneyInstance(j,from)) return false;
    const reason = stepIssue(validation, from, next, state.use_town);
    if (reason === 'collisions detected' && rejoinForwardWalking(j,from)) return true;
    const join=localWalkingJoin(from,next);
    if (reason !== 'collisions detected' || !join || !beginRepair(j,state.plot.slice(),{reason,from,to:next})) return false;
    j.repair!.target=join.target;
    j.repair!.retainEndpoint=join.retainEndpoint;
    j.repair!.instance = from.in ?? from.map;
    state.found = false;
    executor.cancel();
    return true;
  }
  function rejoinForwardWalking(j: Journey, from: Point): boolean {
    // Combat can carry a participant past an unconsumed corner. Join only a
    // native-clear part of the remaining walking prefix; never skip a
    // door, Town cast, map/instance boundary, or the coordinator's destination.
    const edge=executor.walkingEdge(), remaining=routeLeft(state.plot);
    let previous = edge?.from || state.plot[0];
    let selected: {index:number;target:Point;distance:number} | undefined;
    for (let index=edge ? 0 : 1;index<state.plot.length;index++) {
      const next=state.plot[index];
      if (isTransition(previous) || isTransition(next) || previous.map!==from.map || next.map!==from.map
        || previous.in!==undefined && String(previous.in)!==String(from.in??from.map)
        || next.in!==undefined && String(next.in)!==String(from.in??from.map)) break;
      if (!validation.walk(previous,next)) break;
      const dx=next.x-previous.x,dy=next.y-previous.y,length=dx*dx+dy*dy;
      const along=length ? Math.max(0,Math.min(1,((from.x-previous.x)*dx+(from.y-previous.y)*dy)/length)) : 0;
      const target={map:from.map,in:from.in,x:previous.x+dx*along,y:previous.y+dy*along};
      const separation=distance(from,target);
      // Nearby current-edge repairs retain their existing bounded BFS path.
      // A proven direct connector has the same geometry contract as ordinary
      // walking; distance alone must not force a full-floor regroup/search.
      if ((index>0 || separation>150) && (!selected || separation<selected.distance)
        && validation.walk(from,target) && validation.walk(target,next) && repairAllowed(j,target,remaining))
        selected={index,target,distance:separation};
      previous=next;
    }
    if (!selected) return false;
    const plot=[selected.target,...state.plot.slice(selected.index)];
    if (validateRoute(validation,from,state,plot,state.use_town,state.edge)) return false;
    recordRepair(j,selected.target,remaining);
    executor.cancel();
    install(plot,true);
    report(j.id,state,'Rejoined forward walking segment',j.firstIssue);
    return true;
  }
  function localWalkingJoin(from: Point, next: Step): {target:Point;retainEndpoint:boolean} | undefined {
    const edge=executor.walkingEdge();
    if(!edge)return distance(from,next)<=150 ? {target:point(next),retainEndpoint:false} : undefined;
    if(edge.from.map!==from.map || String(edge.from.in??edge.from.map)!==String(from.in??from.map))return;
    const dx=next.x-edge.from.x,dy=next.y-edge.from.y,length=dx*dx+dy*dy;
    const along=length ? Math.max(0,Math.min(1,((from.x-edge.from.x)*dx+(from.y-edge.from.y)*dy)/length)) : 0;
    const target={map:from.map,x:edge.from.x+dx*along,y:edge.from.y+dy*along};
    return distance(from,target)<=150 ? {target,retainEndpoint:true} : undefined;
  }
  function sameJourneyInstance(j: Journey, from: Point): boolean {
    return from.map === j.context.map && String(from.in ?? from.map) === String(j.context.instance ?? j.context.map);
  }
  function terminalOwner(j: Journey, owner: NonNullable<MovementOptions['owner']>): boolean {
    const stored=j.options.owner;
    return !!stored && Object.keys(owner).length===Object.keys(stored).length &&
      Object.entries(owner).every(([key,value])=>stored[key as keyof typeof owner]===value);
  }
  function terminalContext(j: Journey): boolean {
    const c=host.character,context=readContext();
    return current(j) && !context.paused && !c.rip && Number(c.hp)>0 && !!context.server && context.server===j.context.server;
  }
  function terminalGoal(): boolean {
    const c=host.character;
    return c.map===state.map && String(c.in??c.map)===String(state.in??state.map) && distance(position(),state)<=1;
  }
  function settleTerminal(id: string, owner: NonNullable<MovementOptions['owner']>): boolean {
    const j=journey;
    if(!j || j.id!==id || !state.moving || !state.found || !terminalContext(j) ||
      !terminalOwner(j,owner) || !terminalGoal())return false;
    const receipt=executor.settleTerminal(j.options);if(!receipt)return false;
    j.terminalSettlement={...receipt,...j.options.owner,runtimeId:j.context.runtime,server:j.context.server,
      geometry:{version,fingerprint},journeyId:j.id};
    finish(true);return true;
  }
  function completeOwnedRoute(j: Journey): void {
    const p=position(),expectedInstance=state.in ?? (state.map===j.context.map ? j.context.instance : undefined);
    if(p.map!==state.map || expectedInstance!==undefined && String(p.in??p.map)!==String(expectedInstance)) {
      finish(false,'Owned route completion map or instance changed');return;
    }
    // Exhausting a plot is not arrival: combat may move the actor between
    // consuming its last walking point and the following scheduler callback.
    if(host.character.moving || host.is_transporting(host.character))return;
    if(distance(p,state)>state.edge) {
      recover(j,Error('Owned route exhausted before destination arrival'));return;
    }
    finish(true);
  }
  // The executor's reached rule (executor.ts `consumeReachedWalks`) for a planned route with no
  // crossing left: standing still within 1 of the goal, on its map and instance. A crossing ends on
  // its own acknowledgement (`settleTerminal`).
  function standsAtGoal(): boolean {
    const p = position();
    return state.found && !state.plot.some(isTransition) && !host.character.moving && !host.is_transporting(host.character) && p.map === state.map &&
      (state.in === undefined || String(p.in ?? p.map) === String(state.in)) && distance(p, state) <= 1;
  }
  // The journey context's pause holds the walk, and each change records a pause or a resume.
  function contextHolds(j: Journey): boolean {
    const contextHeld = readContext().paused;
    if (contextHeld !== contextPaused) { contextPaused = contextHeld; ring.push({ decision: contextHeld ? 'paused' : 'resumed', journeyId: j.id, cause: 'context' }); }
    if (contextHeld) { if(!state.found)(j.scheduling ??= createPlanningScheduleMetrics()).paused();j.settlingAt = undefined; executor.pause(); }
    return contextHeld;
  }
  function tick() {
    const j = journey;
    if (!j || !state.moving) return;
    if (!current(j)) { finish(false, 'Navigation revision or runtime superseded this journey', {code:'superseded'}); return; }
    if (expireJourney()) return;
    // A journey to the spot the character stands on has arrived. A pause holds walking, and this
    // walk has none left: parked, it would never end, and a walk command's travel token would keep
    // the character's targeting off (queue-client.ts 'travel intent').
    if (standsAtGoal()) { finish(true); return; }
    if (contextHolds(j)) return;
    if (click?.paused) { j.settlingAt = undefined; return; }
    if (paused) {
      if (ports.now() - stepAt < stepMs) { j.settlingAt = undefined; return; }
      resumeSteps('idle');
    }
    if (!state.found) { planTick(); return; }
    try { if (executor.tick(j.options)) completeOwnedRoute(j); }
    catch (error) { recover(j, error); }
  }
  function move(destination: unknown, callback?: (done: boolean) => void, options: MovementOptions = {}): Promise<unknown> {
    if (host.smart_move_logic !== scheduler) return Promise.reject(Error('Movement scheduler was replaced'));
    let site: string | undefined;
    if (!options.request) { site = typedAt(new Error().stack); options = { ...options, request: typed }; }
    const from = position();
    const decided = owner.measured(() => ownerDecides(destination, callback, options, from), undefined);
    if (decided) return decided;
    if (journey) {
      const by = caller(options.request, new Error().stack, site);
      finish(false, 'Movement replaced by a new destination', {code:'destination-replaced',replacement:destination}, {code: 'replaced:' + by.kind, by});
    }
    refreshGeometry();
    let target: Point, tolerance: number;
    try { target = resolveDestination(host, destination); tolerance = arrivalTolerance(options); } catch (error) { return Promise.reject(error); }
    if (target.in !== undefined && target.map === host.character.map && String(target.in) !== String(host.character.in ?? host.character.map))
      return Promise.reject(Error('Destination is in another instance; use its instance-entry workflow'));
    delete state.in;
    Object.assign(state, target, { moving: true, found: false, searching: false, plot: [], use_town: options.town !== false, edge: tolerance });
    if (host.character.moving) void standStill();
    stepping = undefined;
    executor.reset(); const context = {...readContext(), map:host.character.map, instance:host.character.in ?? host.character.map};
    const j: Journey = journey = { listeners: [], id: `${host.character.name}:${context.runtime}:${++sequence}`, context, options, native: !!options.native, pending: false, searches: 0, ladder: createOwnerLadder(journeyRound(), ports.now), started: ports.now(), planningAt: ports.now(), fallback: !!options.native };
    contextPaused = false;
    ring.push({ decision: 'started', journeyId: j.id, kind: options.request!.kind, owner: options.request!.owner,
      tier: options.request!.tier, destination: point(target), from, ...(site ? { by: { kind: typed.kind, owner: typed.owner, site } } : {}) });
    // Every caller of this journey hears its end: the starter and each repeat the owner kept.
    state.on_done = (done, reason, failure) => {
      for (const listener of j.listeners.splice(0)) {
        listener.callback?.(done);
        if (done) listener.resolve({ success: true }); else listener.reject(Object.assign(movementError(failure || reason), {movementReported: true}));
      }
    };
    return listen(j, callback);
  }
  // Design section 2.1 rule 3 for the live journey: its request's deadline or currency test ends it.
  function expireJourney(): boolean {
    const j = journey, request = j?.options.request;
    if (!j || !request) return false;
    const code = request.deadline !== undefined && ports.now() >= request.deadline ? 'expired' : request.current && !request.current() ? 'stale' : undefined;
    if (!code) return false;
    invariants[code]++;
    finish(false, Object.assign(Error(code === 'stale' ? 'Movement request went stale' : 'Movement request deadline passed'), { code, reason: code }), { code }, { code });
    return true;
  }
  function listen(j: Journey, callback?: (done: boolean) => void): Promise<unknown> {
    return new Promise((resolve, reject) => { j.listeners.push({ callback, resolve, reject }); });
  }
  // The rule table decides before the service touches the live journey. It returns the
  // caller's promise when the request does not start a journey of its own; a granted request
  // falls through to `move`.
  function ownerDecides(destination: unknown, callback: ((done: boolean) => void) | undefined, options: MovementOptions, from: Point): Promise<unknown> | undefined {
    expireHeld();
    // A standing hold gives way to any request.
    if (!journey && hold?.yields) endHold('replaced:' + options.request!.kind, caller(options.request, new Error().stack));
    const clickRule = clickDecides(options.request!);
    if (clickRule) {
      const asked: MovementRecordInput = { decision: 'asked', kind: options.request!.kind, owner: options.request!.owner, tier: options.request!.tier, by: caller(options.request, new Error().stack) };
      if (clickRule === 'waiting') return wait(destination, options, options.request!, [], callback, asked);
      ring.push({ ...asked, decision: 'refused', code: 'click' });
      return Promise.reject(Object.assign(Error('Movement refused: your click holds the character'), { code: 'refused', reason: 'refused', movementReported: true }));
    }
    const live = journey ? held(journey) : hold && heldHold(hold);
    if (!live) return;
    let target: Point;
    // An unresolvable destination takes the ordinary path, which rejects it.
    try { refreshGeometry(); target = point(resolveDestination(host, destination)); } catch { return; }
    const incoming: Requester = options.request!, by = caller(options.request, new Error().stack);
    const rule = decideRequest(live, incoming, target, from, validation.walk);
    const entry: MovementRecordInput = { decision: 'asked', journeyId: live.journeyId, kind: incoming.kind, owner: incoming.owner, tier: incoming.tier, destination: target, by };
    if (rule.decision === 'kept') { renew(incoming); ring.push({ ...entry, decision: 'kept' }); return listen(journey!, callback); }
    if (rule.decision === 'retargeted' && retargetPlot(target, options)) { renew(incoming); ring.push({ ...entry, decision: 'retargeted' }); return listen(journey!, callback); }
    if (rule.decision === 'waiting') return wait(destination, options, incoming, [], callback, entry);
    if (rule.decision === 'refused') {
      ring.push({ ...entry, decision: 'refused' });
      return Promise.reject(Object.assign(Error(`Movement refused: ${live.kind} holds the journey`), { code: 'refused', reason: 'refused', movementReported: true }));
    }
    // Queue N2: a group walk keeps the group walk or errand it interrupts waiting.
    if (rule.decision === 'granted' && rule.interrupted === 'wait' && journey) requeue(journey, by);
    if (!journey && hold) endHold(hold.owner === incoming.owner ? 'released' : 'replaced:' + incoming.kind, by);
    return;
  }
  // A holder that asks again for its live journey takes its new deadline and currency
  // test, as a hold that is asked again does.
  function renew(incoming: Requester): void {
    const request = journey?.options.request;
    if (!request || request.owner !== incoming.owner) return;
    const asked = incoming as Partial<MovementRequest>;
    journey!.options = { ...journey!.options, request: { ...request, deadline: asked.deadline, current: asked.current } };
  }
  // Design section 2.3: the holder's new point on a clear line replaces the plot in place, with
  // no stop packet, no settle wait and no new plan. A journey still planning starts anew.
  function retargetPlot(target: Point, options: MovementOptions): boolean {
    if (!journey || !state.moving || !state.found) return false;
    let tolerance: number;
    try { tolerance = arrivalTolerance(options); } catch { return false; }
    const prior = { map: state.map, in: state.in, x: state.x, y: state.y, edge: state.edge, plot: state.plot.slice() };
    delete state.in;
    Object.assign(state, target, { edge: tolerance });
    try { if (install([target], true)) return true; } catch { /* The prior plot stays below. */ }
    delete state.in;
    Object.assign(state, prior);
    return false;
  }
  function wait(destination: unknown, options: MovementOptions, request: Requester, listeners: Listener[], callback: ((done: boolean) => void) | undefined, entry: MovementRecordInput): Promise<unknown> {
    // Design section 1.2: one waiting entry per kind; the newer request supersedes the older.
    const older = waiting.findIndex(item => item.kind === request.kind);
    if (older >= 0) settleWaiting(waiting.splice(older, 1)[0], 'superseded');
    const c = readContext();
    ring.push({ ...entry, decision: 'waiting' });
    return new Promise((resolve, reject) => {
      waiting.unshift({ ...request, revision: c.revision, runtime: c.runtime, destination, options, listeners: [...listeners, { callback, resolve, reject }] });
    });
  }
  // The interrupted journey keeps its callers and resumes from where the character stands.
  function requeue(j: Journey, by: MovementCaller) {
    const request = j.options.request!, listeners = j.listeners.splice(0);
    void wait(point(state), j.options, request, listeners, undefined, { decision: 'waiting', journeyId: j.id, kind: request.kind, owner: request.owner, tier: request.tier, destination: point(state), by }).catch(() => {});
  }
  function settleWaiting(item: Waiting, code: 'expired' | 'superseded' | 'stale') {
    ring.push({ decision: code === 'superseded' ? 'ended' : 'expired', kind: item.kind, owner: item.owner, code });
    const error = Object.assign(Error(code === 'expired' ? 'Waiting movement expired' : code === 'stale' ? 'Waiting movement went stale' : 'Waiting movement superseded'), { code, reason: code, movementReported: true });
    for (const listener of item.listeners) { listener.callback?.(false); listener.reject(error); }
  }
  // `reask` asks again with a journey live: the click that a request waited on ended, and the
  // request now ranks against the resumed journey.
  function resumeWaiting(reask = false) {
    if (!reask && (journey || hold) || disposed) return;
    expireHeld();
    const next = waiting.shift();
    if (!next) return;
    move(next.destination, undefined, next.options).then(
      value => { for (const listener of next.listeners) { listener.callback?.(true); listener.resolve(value); } },
      error => { for (const listener of next.listeners) { listener.callback?.(false); listener.reject(error); } });
  }
  // A hold or a waiting request asked under an older revision or runtime, past its
  // deadline, or whose identity went stale ends (rule 3).
  function lapsed(item: Hold, c: MovementContext): 'superseded' | 'expired' | 'stale' | undefined {
    if (item.revision !== c.revision || item.runtime !== c.runtime) return 'superseded';
    if (item.deadline !== undefined && ports.now() >= item.deadline) return 'expired';
    if (item.current && !item.current()) return 'stale';
  }
  function expireHeld() {
    const c = readContext();
    const held = hold && lapsed(hold, c);
    if (held) { if (held !== 'superseded') invariants[held]++; endHold(held); }
    for (let i = waiting.length - 1; i >= 0; i--) {
      const code = lapsed(waiting[i], c);
      if (!code) continue;
      if (code !== 'superseded') invariants[code]++;
      settleWaiting(waiting.splice(i, 1)[0], code === 'superseded' ? 'expired' : code);
    }
    settleCombat(false);
  }
  // A request waiting on combat ends when its currency test lapses, and starts when combat lets go
  // (`letGo`, section 2.4 rule 5's `resume('combat')`) while its fight test reads none. Starting
  // clears the combat target through targeting, as `afterCombat` did.
  function settleCombat(letGo: boolean) {
    for (let i = 0; i < combatWaiting.length; i++) {
      const item = combatWaiting[i], stale = !!item.current && !item.current();
      if (!stale && (!letGo || item.fighting())) continue;
      combatWaiting.splice(i--, 1);
      if (stale) invariants.stale++;
      ring.push(stale ? { decision: 'expired', kind: item.kind, owner: item.owner, code: 'stale' } : { decision: 'resumed', kind: item.kind, owner: item.owner, cause: 'combat' });
      if (!stale) partyHooks().ask('targeting.setTargetId', null, item.owner);
      item.start(!stale);
    }
  }
  function endHold(code: string, by?: MovementCaller) {
    if (!hold) return;
    ring.push({ decision: 'ended', kind: hold.kind, owner: hold.owner, code, by });
    tell('hold.ended', { character: host.character.name, kind: hold.kind, owner: hold.owner, code, by });
    hold = undefined;
    if (waiting.length) ports.scope.queueMicrotask(resumeWaiting);
  }
  function heldHold(h: Hold): Held { return { kind: h.kind, owner: h.owner, tier: h.tier, tolerance: 0 }; }
  // Design section 2.4. A combat step borrows the character: the first step
  // pauses the live journey, later steps and formation holds keep the pause, and the
  // journey resumes when combat lets go or once the last step's `stepMs` passes without either.
  function resumeSteps(cause: 'let-go' | 'idle') {
    const j = journey;
    // A click's pause outlasts combat's: the journey resumes when the click hands back.
    if (!paused || !j || click?.paused) return;
    paused = false; steps.resumes++;
    ring.push({ decision: 'resumed', journeyId: j.id, kind: j.options.request!.kind, owner: j.options.request!.owner, cause });
    executor.resume();
  }
  // A step or hold keeps the combat pause from now for the time to walk to `to` (none for a hold).
  function stepTaken(to?: { x: number; y: number }): void {
    const c = host.character, at = { x: c.real_x, y: c.real_y };
    stepAt = ports.now(); stepMs = stepWindowMs(at, to ?? at, c.speed);
  }
  // The character still walks toward its own step, so stopping or repeating it is ours.
  function walkingStep(to: { x: number; y: number } | undefined): boolean {
    const c = host.character;
    return !!stepping && !!to && Math.hypot(stepping.x - to.x, stepping.y - to.y) < STEP_REPEAT && !!c.moving &&
      Number.isFinite(c.going_x) && Number.isFinite(c.going_y) && Math.hypot(c.going_x! - stepping.x, c.going_y! - stepping.y) < STEP_REPEAT;
  }
  // Rule 6: combat stops only its own step, never a journey's move.
  function stopStep() {
    if (!walkingStep(stepping)) return;
    stepping = undefined; steps.stops++;
    void standStill();
  }
  // Rule 1 and queue A30: why the live request does not lend the character to a step.
  function stepRefusal(): string | undefined {
    if (click) return 'click';
    if (!journey) return hold && !hold.yields && !stepAllowed(hold, true) ? 'hold' : undefined;
    const transition = executor.transition();
    if (transition) return transition === 'town' ? 'town-cast' : 'transition';
    return stepAllowed(journey.options.request!) ? undefined : 'row';
  }
  // A mover's candidate search checks many points in one pass, so the monster list is read once
  // per millisecond of the service clock.
  let seenMonsters: { at: number; list: SafetyMonster[] } | undefined;
  function visibleMonsters(): SafetyMonster[] {
    const at = ports.now();
    if (seenMonsters?.at !== at) seenMonsters = { at, list: safetyMonsters(host.parent.entities ?? {}) };
    return seenMonsters.list;
  }
  function safetyFor(target?: string): Omit<StepSafetyInput, 'to'> {
    // An enabled add-on that keeps zones answers `step.safety`; with none the check is one read
    // of an empty list.
    const hooks = partyHooks(), c = host.character, zones = hooks.guardsSteps()
      ? (to: SafetyPoint) => hooks.stepRefusal({ character: c, entities: host.parent?.entities ?? {}, G: host.G, target,
        joinedEvent: eventFacts().joinedEventName() }, to) : undefined;
    return safetyInput(host, visibleMonsters(), target, zones);
  }
  // One ring entry per holder and refusal, because combat asks again every tick. Unsafe
  // steps share one entry per journey, so alternating movers cannot flood the ring.
  function refuseStep(live: Record<string, unknown> & { journeyId?: string; owner?: string }, refusal: string, mode: string, key = [live.journeyId ?? live.owner, refusal].join(':')): StepResult {
    steps.refused++;
    if (refusedFor !== key) { refusedFor = key; ring.push({ decision: 'step-refused', ...live, cause: refusal, code: mode }); }
    return { status: 'refused', reason: refusal, sent: Promise.resolve() };
  }
  // What the owner decides for one combat step, with no side effect: refused by the live row, kept
  // as the step being walked, refused as unsafe, or sent.
  function judgedStep(to: { x: number; y: number }, options: StepOptions): { decision: 'refused' | 'kept' | 'unsafe' | 'sent'; reason?: string; risky?: boolean } {
    const refusal = stepRefusal();
    if (refusal) return { decision: 'refused', reason: refusal };
    if (walkingStep(to)) return { decision: 'kept' };
    // Rule 2 (queue AV): an unsafe step sends nothing, so the character stands. The least
    // risky step goes when standing still fights nothing.
    const input = safetyFor(options.target);
    let chosen: ReturnType<typeof chooseStep>;
    if (options.closes) {
      const verdict = stepSafety({ ...input, to });
      const passes = verdict.refusal !== 'terrain' && (options.closes === 'terrain' || !verdict.attackers.length);
      chosen = passes ? { point: to, verdict, risky: false } : null;
    } else chosen = chooseStep([to], input);
    if (!chosen) {
      // A zone refusal carries the add-on's name and reason, so the step's record says who refused it.
      const verdict = stepSafety({ ...input, to });
      return { decision: 'unsafe', reason: 'unsafe:' + verdict.refusal + (verdict.zone ? ' ' + verdict.zone : '') };
    }
    return { decision: 'sent', risky: chosen.risky };
  }
  function combatStep(to: { x: number; y: number }, mode: string, options: StepOptions): StepResult {
    expireHeld();
    const judged = judgedStep(to, options);
    if (judged.decision === 'refused') {
      const live = judged.reason === 'click' ? { kind: clicker.kind, owner: clicker.owner }
        : journey ? { journeyId: journey.id, kind: journey.options.request!.kind, owner: journey.options.request!.owner }
        : { kind: hold!.kind, owner: hold!.owner };
      return refuseStep(live, judged.reason!, mode);
    }
    if (judged.decision === 'kept') { stepTaken(to); steps.kept++; return { status: 'kept', sent: Promise.resolve() }; }
    if (judged.decision === 'unsafe') {
      steps.unsafe++;
      // Standing still is the step: it keeps a combat pause, as a formation hold does.
      if (paused) stepTaken();
      return refuseStep({ journeyId: journey?.id, kind: journey?.options.request?.kind, owner: journey?.options.request?.owner },
        judged.reason!, mode, [journey?.id ?? 'none', 'unsafe'].join(':'));
    }
    // A combat step is a survival call. The budget holding it, or a stop still owed, makes no
    // call this pass and leaves a journey unpaused: the step answers refused with the reason
    // `call budget`, which the owner counts apart from its refusals. A character that cannot walk
    // asks nothing: the game refuses its move with no emit.
    if (host.can_walk(host.character) && (!sendDecided() || hooks.calls.band({ band: STOP_AND_STEP_BAND, method: 'move' }) !== 'send')) {
      steps.budget++;
      return { status: 'refused', reason: 'call budget', sent: Promise.resolve() };
    }
    if (judged.risky) steps.risky++;
    stepTaken(to);
    const j = journey;
    if (j && !paused) {
      paused = true; steps.pauses++;
      ring.push({ decision: 'paused', journeyId: j.id, kind: j.options.request!.kind, owner: j.options.request!.owner, cause: 'combat', code: mode });
      executor.pause(false);
    }
    stepping = { x: to.x, y: to.y }; steps.sent++;
    // The request table's Steps column lent the character to this step (contract part 2 `by`).
    const told = { character: host.character.name, mover: mode, point: { x: to.x, y: to.y }, target: options.target, by: 'rule:T1' };
    tell('step.sent', told);
    if (FORMATION_MOVERS.test(mode)) tell('formation.moved', told);
    return { status: 'sent', sent: Promise.resolve(host.move(to.x, to.y)) };
  }
  // T7: sends follow the owner's state. A stop or a crossing the call budget holds stays the
  // owner's decision, not yet sent; each scheduler pass, and a combat step before its own send,
  // asks the budget for it again. A later decision replaces an unsent one, so nothing waits in a
  // queue and no stop goes after a step decided later. The replaced decision's caller hears it: a
  // stop resolves, since the later decision moves the character anyway, and a crossing rejects,
  // since it never went. The budget's hold has no cap and ends on the server's call cost, which a
  // closed connection no longer sends, so a decision also ends when the socket it was decided on
  // disconnects or the game replaces it (game.js `init_socket`), as the band wait does
  // (hooks/rows/09-calls.ts `wait`), and tells the status owner's bound record as `unsentDisconnected`.
  let unsent: { what: 'stop' | 'crossing'; send: () => Sent; socket: unknown; settle: { resolve(value: unknown): void; reject(error: unknown): void }[] } | undefined;
  function decideSend(what: 'stop' | 'crossing', send: () => Sent): Promise<unknown> {
    if (unsent) replaceUnsent();
    const sent = send();
    if (sent !== NOT_NOW) return Promise.resolve(sent);
    return new Promise((resolve, reject) => { unsent = { what, send, socket: host.parent.socket, settle: [{ resolve, reject }] }; });
  }
  function replaceUnsent(reason: 'replaced' | 'disconnected' = 'replaced'): void {
    const replaced = unsent!;
    unsent = undefined;
    for (const one of replaced.settle) {
      if (replaced.what === 'stop') one.resolve(undefined);
      else one.reject(Object.assign(Error(reason === 'replaced' ? 'Movement replaced an unsent crossing with a later decision'
        : 'The connection closed before an unsent crossing could go'), { reason }));
    }
  }
  // True when nothing the owner decided is left unsent.
  function sendDecided(): boolean {
    if (!unsent) return true;
    const decided = unsent, socket = decided.socket as { connected?: boolean } | null | undefined;
    if (socket && (host.parent.socket !== socket || socket.connected === false)) {
      boundFired({ bound: 'unsentDisconnected', owner: '02', state: { what: decided.what } });
      replaceUnsent('disconnected');
      return true;
    }
    let sent: Sent;
    try { sent = decided.send(); } catch (error) { unsent = undefined; for (const one of decided.settle) one.reject(error); return true; }
    if (sent === NOT_NOW) return false;
    unsent = undefined;
    for (const one of decided.settle) one.resolve(sent);
    return true;
  }
  function standStill(): Promise<unknown> { return decideSend('stop', () => standStillSend(host)); }
  // The game's stop: stop("smart") ends only the plan and emits nothing; every other action
  // emits a move or a `stop` (runner_functions.js stop), a survival call that asks first. A
  // character that cannot walk gets no move from the game, so it asks nothing.
  function nativeStop(action?: string, success?: boolean): Promise<unknown> {
    if (action === 'smart') return native.stop(action, success);
    const move = !action || action === 'move';
    if (move && !host.can_walk(host.character)) return native.stop(action, success);
    return decideSend('stop', (): Sent => hooks.calls.band({ band: STOP_AND_STEP_BAND, method: move ? 'move' : 'stop', data: move ? undefined : { action } }) === 'send'
      ? native.stop(action, success) : NOT_NOW);
  }
  // The stop rule (queue A2). A refused stop leaves the journey and sends no native stop packet.
  function ruling(by: Stopper | undefined, stack: string | undefined): 'stop' | 'takeover' | 'refused' {
    const live = journey ? held(journey) : heldHold(hold!), stopper = by ?? typedStop;
    const verdict = judgeStop(live, stopper);
    if (verdict === 'refused') ring.push({ decision: 'refused-stop', journeyId: live.journeyId, kind: live.kind, owner: live.owner, by: caller(by, stack) });
    return verdict;
  }
  // A stop that reaches only a hold: the holder's own stop keeps it, any other allowed stop ends it.
  function stopHold(by: Stopper | undefined, verdict: 'stop' | 'takeover', stack: string | undefined) {
    if (by?.owner && by.owner === hold!.owner) return;
    const stopper = caller(by, stack);
    endHold((verdict === 'takeover' ? 'replaced:' : 'stopped:') + stopper.kind, stopper);
  }
  function refreshGeometry() {
    const nextVersion = Number(host.parent.__partyClientVersion || host.G.version), nextFingerprint = cachedGeometryFingerprint(host.G);
    if (nextVersion === version && nextFingerprint === fingerprint) return;
    version = nextVersion; fingerprint = nextFingerprint;
    report = movementDiagnostics(host, ports, host.character.name, version, fingerprint);
  }
  // A typed call is recorded with its call site, which also names a console caller that
  // lost its requester. Only calls that touch a live journey reach here, so idle stops cost
  // no stack capture. move() counts its own typed call once; a stop with no stopper is counted here.
  function caller(request: Requester | undefined, stack: string | undefined, site?: string): MovementCaller {
    return request && request !== typed ? { kind: request.kind, owner: request.owner } : { kind: typed.kind, owner: typed.owner, site: site ?? (request === typed ? callerSite(stack) : typedAt(stack)) };
  }
  function held(j: Journey): Held {
    return { kind: j.options.request!.kind, owner: j.options.request!.owner, tier: j.options.request!.tier,
      journeyId: j.id, destination: point(state), tolerance: state.edge };
  }
  function ending(by: MovementCaller, success?: boolean): End {
    const holder = !!by.owner && by.owner === journey?.options.request?.owner;
    return { code: success ? 'arrived' : holder ? 'released' : 'stopped:' + by.kind, by };
  }
  // `by` names the caller; the native stop ignores it.
  function stop(action?: string, success?: boolean, stopper?: MovementStopper) {
    const superseded = !!stopper && 'superseded' in stopper, by = superseded ? undefined : stopper as Stopper | undefined;
    const ends = !action || action === 'move' || action === 'smart';
    if (ends && !superseded && (journey || hold && !hold.yields)) {
      const stack = new Error('Movement stop caller').stack;
      const verdict = owner.measured(() => ruling(by, stack), 'stop');
      if (verdict === 'refused') return Promise.resolve({ success: false, refused: true });
      if (!journey) { stopHold(by, verdict, stack); return nativeStop(action, success); }
      if (verdict === 'takeover') {
        const taker = caller(by, stack);
        finish(false, 'Movement taken over by ' + taker.kind, {code:'takeover',action:action || 'all'}, { code: 'replaced:' + taker.kind, by: taker });
        return nativeStop(action, success);
      }
    }
    if (journey && ends) {
      // A superseded stop names its cause (a navigation revision change), not a requester, so it
      // is no typed call and its end record reads `superseded`.
      const stoppedBy: MovementCaller = superseded ? { kind: typed.kind, owner: typed.owner } : caller(by, new Error('Movement stop caller').stack);
      finish(!!success, success ? undefined : 'Movement stopped by ' + stoppedBy.kind, {code:'stopped',action:action || 'all'}, superseded ? { code: 'superseded' } : ending(stoppedBy, success));
    }
    return nativeStop(action, success);
  }
  function scheduler() {
    if(disposed)return;
    // The send the owner decided and the call budget held goes first.
    sendDecided();
    townChannelTick();
    clickTick();
    driveLoops();
    if(hold || waiting.length || combatWaiting.length)expireHeld();
    const drive = journey && state.moving ? journey.options.gate : undefined;
    if(journey&&state.moving&&!state.found)(journey.scheduling ??= createPlanningScheduleMetrics()).scheduler(!!drive);
    // A group walk's gate reaches the owner's tick only once its own checks pass, and a walk that
    // waits for its departure phase returns first, so the scheduler reads the Pause (`held`) here.
    // The Cave's hold, Manual and the drain park stay in `tick`, after the gate.
    // After the Pause lifts, the read still runs once to record the resume, and `tick` holds on any other source.
    if(drive){const held=ports.pauses.held();if(!(current(journey!)&&(held||contextPaused)&&contextHolds(journey!)&&held))drive.tick();}else tick();
  }
  host.smart_move = move; host.stop = stop; host.smart_move_logic = scheduler;
  // A handler that answers true keeps the game from walking, so only an unanswered click is
  // the player's walk.
  const nativeClick = host.on_map_click;
  const onClick = (x: number, y: number) => {
    const handled = nativeClick?.(x, y);
    if (!handled && Number.isFinite(x) && Number.isFinite(y)) clicked({ x, y });
    return handled;
  };
  host.on_map_click = onClick;
  function importRoute(plot: Step[], identity?: {version: number; fingerprint: string}, plannerEngine = 'shared') {
    refreshGeometry();
    if (!identity || identity.version !== version || identity.fingerprint !== fingerprint)
      throw Error('Shared route game geometry mismatch: expected ' + JSON.stringify(identity) + '; actual ' + JSON.stringify({version, fingerprint}));
    const issue = validateRoute(validation, position(), state, plot, state.use_town, state.edge);
    if (issue) {
      report(journey!.id, state, 'Shared route rejected', issue, 'falling back to native smart_move after party regroup');
      throw Error(`${issue.reason} between ${JSON.stringify(issue.from)} and ${JSON.stringify(issue.to)}; native regroup required`);
    }
    if (journey) journey.importedEngine = plannerEngine;
    planner.cancel();
    return install(plot, true);
  }
  // The lead-up window starts at the climb's start. It reaches back over the previous climb
  // when that climb ended after the current one's last progress, because no progress came
  // between them. Without a climb it starts after the last arrival.
  function windowStart(entries: ReturnType<typeof ring.entries>): number {
    if (climber) {
      const progressAt = climber.ladder.report().progressAt;
      return previousClimb && previousClimb.endedAt >= progressAt ? previousClimb.startSeq : climber.startSeq;
    }
    const arrival = entries.findLast(entry => entry.decision === 'ended' && entry.code === 'arrived');
    return arrival ? arrival.seq + 1 : 0;
  }
  function incident(kind: IncidentKind, facts: Partial<MovementIncident>): string {
    const entries = ring.entries(), from = windowStart(entries);
    const id = `${kind}:${host.character.name}:${readContext().runtime}:${ring.lastSeq + 1}`;
    ring.push({ decision: kind, owner: climber?.owner, code: facts.rung, cause: id });
    const before = leadUp(entries, from);
    const blocked = before.findLast(entry => entry.decision === 'ended' && !!entry.journeyId && entry.code !== 'arrived');
    incidents.push({ id, kind, character: host.character.name, owner: climber?.owner, activity: climber?.activity, position: position(),
      ...(blocked ? { blocked: { code: blocked.code, by: blocked.by, kind: blocked.kind, owner: blocked.owner, cause: blocked.cause } } : {}), ...facts, leadUp: before });
    snapshot(kind, id);
    return id;
  }
  // Design section 7: the ring and the stuck and caught-error records go to disk on the
  // coordinator only when something worth reading later happens. The post is bound by two
  // measured report intervals, the coordinator's own answer cadence, and a failed post stays in
  // the ring, so the next snapshot carries it.
  function snapshot(trigger: 'death' | 'stuck' | 'caught-error' | 'churn', incident?: string): void {
    if (disposed) return;
    let runtime: string | undefined;
    try { runtime = readContext().runtime; } catch { /* A retired runner keeps its last records. */ }
    const ms = 2 * reportGapMs;
    void Promise.resolve().then(() => ports.request('/movement-snapshot', { method: 'POST', timeout: ms,
      body: { character: host.character.name, trigger, runtime, incident, records: ring.entries(), incidents: incidents.entries() } })).catch(error => {
      if (requestTimedOut(error)) boundFired({ bound: 'movementSnapshotMs', owner: '02', state: { trigger, ms } });
      ring.push({ decision: 'snapshot-failed', owner: trigger, code: movementError(error).message.slice(0, 120) });
    });
  }
  // The ladder the requester climbs, with each rung in the ring (`ladderStep`) and the stuck
  // moment recorded and announced.
  function watched(base: OwnerLadder, holder: string): OwnerLadder {
    return { ...base,
      next(at, context) {
        const attempt = base.next(at, context);
        ring.push({ decision: 'rung', owner: holder, code: attempt.rung, ladderStep: base.report().index, cause: 'ladder' });
        tell('ladder.climbed', { character: host.character.name, owner: holder, rung: attempt.rung, trying: attempt.trying, step: base.report().index });
        if (stuckId) { notice = { text: 'Stuck - trying ' + attempt.trying, incident: stuckId, ...(noticeMs !== undefined ? { until: ports.now() + noticeMs } : {}) }; stuckId = undefined; }
        return attempt;
      },
      result(outcome) {
        const before = base.report(), result = base.result(outcome);
        ring.push({ decision: 'rung-' + result, owner: holder, code: before.rung, ladderStep: before.index, cause: 'ladder' });
        if (result === 'failed') stuckId = incident('stuck', { rung: before.rung, trying: before.trying, noProgressMs: ports.now() - before.progressAt });
        else { notice = undefined; stuckId = undefined; }
        return result;
      },
    };
  }
  function ended(holder: string, code: string): void {
    ring.push({ decision: 'ended', owner: holder, code, cause: 'ladder' });
    previousClimb = { startSeq: climber!.startSeq, endedAt: ports.now() };
    climber = undefined; notice = undefined; stuckId = undefined;
  }
  // A requester's own crossing with no journey: a door, an instance exit, a Town cast or a
  // Blink. The owner ranks it as a hold of the requester's identity, so a higher request
  // refuses it and a lower journey ends, and then sends the native call itself. A hold taken
  // for the call ends when the server answers. A requester that already holds the character
  // keeps its own hold: shared.js `townCast` holds through the whole channel.
  let townSent = 0;
  // An accepted Town cast until its channel ends: a channel the client saw that ends on the map it
  // began on landed nowhere, and the ring names the last crossing this owner sent before.
  let townChannel: { kind: MovementKind; owner?: string; map: string; seen: boolean } | null = null, lastCrossing: string | null = null;
  function townChannelTick(): void {
    if (!townChannel) return;
    const town = (host.character as { c?: { town?: unknown } }).c?.town;
    if (town) { townChannel.seen = true; return; }
    if (townChannel.seen && host.character.map === townChannel.map)
      ring.push({ decision: 'ended', kind: townChannel.kind, owner: townChannel.owner, code: 'town-channel', cause: 'channel ended with no landing; last crossing sent ' + (lastCrossing ?? 'none') });
    if (townChannel.seen || host.character.map !== townChannel.map) townChannel = null;
  }
  // A transport, leave or Town reply the network lost (rows 02-06, 06-41 and 07-25 of the removed numbers
  // audit): the crossing ends `timed-out` past its kept bound (rules.ts `MOVEMENT_PICKS`), which tells the
  // status owner's bound record. A false firing in the end run shows the bound is shorter than the real reply.
  function replyBound(sent: Sent, name: 'crossingTransportBoundMs' | 'crossingLeaveBoundMs' | 'crossingTownBoundMs', what: string): Sent {
    if (sent === NOT_NOW) return sent;
    const ms = MOVEMENT_PICKS[name];
    return ports.scope.withTimeout(sent, ms, what, () => boundFired({ bound: name, owner: '02', state: { crossing: what, ms } }));
  }
  function crossing(request: MovementRequest, what: string, send: () => Sent): Promise<unknown> {
    // `by` (contract part 2): the requester crosses; a refusal names what refused it.
    const told = { character: host.character.name, crossing: what, kind: request.kind, owner: request.owner, by: request.owner };
    // A Town cast that is refused or fails writes the ring with its reason, so a channel that
    // never starts names why.
    const townFailed = (decision: 'refused' | 'failed', reason: string) => {
      if (what === 'town') ring.push({ decision, kind: request.kind, owner: request.owner, code: 'town', cause: reason });
    };
    const refused = (reason: string, by: string) => {
      townFailed('refused', reason);
      tell('crossing.ended', { ...told, code: 'refused', reason, by });
      return Promise.reject(Object.assign(Error('Movement refused ' + what + ': ' + reason), { reason: 'refused', refused: true }));
    };
    // `crossing.allows`: an add-on refuses a crossing for its own reason, and the requester
    // climbs its round as on any refused crossing.
    const refusal = hooks.movement.crossingRefusal(told);
    if (refusal) return refused(refusal, 'hook:crossing.allows');
    const owns = journey ? journey.options.request?.owner === request.owner : hold?.owner === request.owner;
    let took = false;
    if (!owns) {
      const verdict = service.hold(request);
      if (verdict === 'refused') return refused('a higher request holds the character', 'rule:T1');
      took = verdict === 'granted';
    }
    ring.push({ decision: 'crossing', kind: request.kind, owner: request.owner, code: what });
    lastCrossing = what;
    tell('crossing.started', told);
    // A crossing the call budget holds goes on a later pass, and its promise settles then.
    let sent: Promise<unknown>;
    try { sent = decideSend('crossing', send); } catch (error) { sent = Promise.reject(error); }
    // The end names how the server answered: a landing, a refusal, a timeout or an interruption.
    sent.then(() => { if (what === 'town') townChannel = { kind: request.kind, owner: request.owner, map: host.character.map, seen: false }; tell('crossing.ended', { ...told, code: 'landed' }); },
      (error: { refused?: boolean; reason?: unknown; message?: unknown } | undefined) => {
        townFailed('failed', String(error?.reason ?? error?.message ?? error));
        tell('crossing.ended', { ...told, code: error?.refused ? 'refused' : /timed? ?out/i.test(String(error?.message ?? error)) ? 'timed-out' : 'interrupted', reason: String(error?.message ?? error) });
      });
    // Only the hold this crossing took ends: by the answer the requester may walk a journey of
    // the same identity, which release() would end too.
    return took ? sent.finally(() => { if (!journey && hold?.owner === request.owner) service.release(request.owner); }) : sent;
  }
  // Requester loops the owner drives, one run at a time.
  const loops = new Map<string, { run: () => unknown; busy: boolean }>();
  function driveLoops(): void {
    for (const [holder, loop] of loops) {
      if (loop.busy) continue;
      loop.busy = true;
      void Promise.resolve().then(loop.run)
        .catch(error => { ring.push({ decision: 'loop-error', owner: holder, code: String((error as Error)?.message ?? error).slice(0, 120) }); })
        .finally(() => { loop.busy = false; });
    }
  }
  const service = { state, move, stop, consolePaused, walkState,
    transporterApproach(map: string, spawn: number) { const target=validation.game.maps[map]?.spawns[spawn];return target ? transporterApproach(validation,position(),{map,x:target[0],y:target[1],transport:true,s:spawn}) : undefined; },
    // Whether a transporter crossing to `map`'s `spawn` works from where the character stands: the
    // route validation's own transport check (validation.ts `stepIssue`).
    transportAllowed(map: string, spawn: number) { const target=validation.game.maps[map]?.spawns[spawn];return !!target && !stepIssue(validation,position(),{map,x:target[0],y:target[1],transport:true,s:spawn},true); },
    settleTerminal,
    // `cause.by` names the caller, as `stop`'s third argument does.
    cancel(reason: string, cause?: Record<string, unknown> & { by?: Stopper }) {
      if (journey || hold && !hold.yields) {
        const stack = new Error().stack, by = cause?.by, verdict = owner.measured(() => ruling(by, stack), 'stop');
        if (verdict === 'refused') return Promise.resolve({ success: false, refused: true });
        if (!journey) stopHold(by, verdict, stack);
        else if (verdict === 'takeover') { const taker = caller(by, stack); finish(false, reason, cause, { code: 'replaced:' + taker.kind, by: taker }); }
        else finish(false, reason, cause, ending(caller(by, stack)));
      }
      return native.stop('smart');
    },
    // A journey's gate (`MovementOptions.gate`) runs the service's own tick through `tick`.
    tick, planTick, transition: executor.transition,
    // The call budget's measured round trip, the bound of a crossing's answer.
    roundTrip: () => hooks.calls.margin(),
    // A Town cast counts from its send until the server answers, because the server starts the
    // channel before the client sees `c.town` and a heal in that gap cancels it.
    townCasting: () => townSent > 0 || executor.townCasting(),
    // Step 12: the crossings a requester makes with no journey (`crossing` above). Each crossing asks its
    // request's band before it sends, and its reply bound starts at the send.
    transport: (request: MovementRequest, map: string, spawn?: number) => crossing(request, 'transport:' + map, () =>
      replyBound(sendTransport(host, map, spawn, sendBand(request)), 'crossingTransportBoundMs', 'transport:' + map)),
    leave: (request: MovementRequest) => crossing(request, 'leave', () => replyBound(sendLeave(host, sendBand(request)), 'crossingLeaveBoundMs', 'leave')),
    town: (request: MovementRequest) => crossing(request, 'town', () => {
      const sent = replyBound(sendTown(host, sendBand(request)), 'crossingTownBoundMs', 'town');
      if (sent === NOT_NOW) return NOT_NOW;
      townSent++;
      return sent.finally(() => { townSent--; });
    }),
    // Blink and Magiport are `skill` emits; accepting a Magiport is a `magiport` emit (the game's
    // use_skill and accept_magiport).
    blink: (request: MovementRequest, to: { x: number; y: number }) => crossing(request, 'blink', () => {
      if (!host.use_skill) return Promise.reject(Error('Blink needs the game\'s use_skill'));
      if (hooks.calls.band({ band: sendBand(request), method: 'skill', data: { name: 'blink' } }) !== 'send') return NOT_NOW;
      return host.use_skill('blink', [to.x, to.y]);
    }),
    // Magiport moves another character and accepting one moves this one; the ownership map
    // gives both to movement.
    magiport: (request: MovementRequest, name: string) => crossing(request, 'magiport:' + name, () => {
      if (!host.use_skill) return Promise.reject(Error('Magiport needs the game\'s use_skill'));
      if (hooks.calls.band({ band: sendBand(request), method: 'skill', data: { name: 'magiport', id: name } }) !== 'send') return NOT_NOW;
      return host.use_skill('magiport', name);
    }),
    acceptMagiport: (request: MovementRequest, name: string) => crossing(request, 'accept-magiport:' + name, () => {
      if (!host.accept_magiport) return Promise.reject(Error('Accepting a Magiport needs the game\'s accept_magiport'));
      if (hooks.calls.band({ band: sendBand(request), method: 'magiport', data: { name } }) !== 'send') return NOT_NOW;
      return host.accept_magiport(name);
    }),
    // The console's maintenance lease parks the character where it stands and keeps its journey
    // (ledger, the shared.js status tick): a journey's travel move stops as a context pause
    // stops it, and a character that moves with no journey stops in place.
    park() {
      owner.measured(() => {
        if (journey) executor.pause();
        else if (host.character.moving) void standStill();
      }, undefined);
    },
    // A requester loop: `run` goes on every pass of the owner's scheduler, which the game's
    // own movement loop calls every 80 ms (runner_functions.js smart_move_logic), and waits
    // there while its last run has not settled. A new loop under the same holder replaces the
    // old one, and the returned function ends it.
    every(holder: string, run: () => unknown): () => void {
      const loop = { run, busy: false };
      loops.set(holder, loop);
      return () => { if (loops.get(holder) === loop) loops.delete(holder); };
    },
    get identity() { return {version, fingerprint}; }, install: importRoute, last: () => last,
    // The holder hands its journey to combat; `by` names it, so the end reads `released`.
    combatHandoff(by?: MovementRequest) { if (journey) finish(false, 'Combat handoff', undefined, ending(caller(by, new Error().stack))); },
    records: ring.entries,
    ownerReport: () => ({ ...owner.report(), steps: { ...steps }, invariants: { ...invariants }, typed: { ...typedSites }, walkTries: executor.tries() }),
    // A hold keeps the character for its holder without a journey (a Town cast). It ranks like a request and ends on `release`, on a
    // navigation revision change, or when a higher request or escape takes over.
    hold(request: MovementRequest): 'granted' | 'kept' | 'refused' {
      return owner.measured(() => {
        expireHeld();
        const by = caller(request, new Error().stack);
        // A standing hold gives way to another holder.
        if (!journey && hold?.yields && hold.owner !== request.owner) endHold('replaced:' + request.kind, by);
        if (clickDecides(request)) { ring.push({ decision: 'refused', kind: request.kind, owner: request.owner, code: 'click', by }); return 'refused' as const; }
        const live = journey ? held(journey) : hold && heldHold(hold);
        if (live) {
          const rule = decide(live, request).decision;
          // The holder asking again renews its hold: the new deadline and currency test apply.
          if (rule === 'same-owner' && !journey) { hold!.deadline = request.deadline; hold!.current = request.current; hold!.yields = request.yields; return 'kept' as const; }
          if (rule !== 'same-owner' && rule !== 'granted') { ring.push({ decision: 'refused', journeyId: live.journeyId, kind: request.kind, owner: request.owner, by }); return 'refused' as const; }
          const code = rule === 'same-owner' ? 'released' : 'replaced:' + request.kind;
          if (journey) finish(false, 'Movement held by ' + request.kind, { code: 'held' }, { code, by }); else endHold(code, by);
        }
        const c = readContext();
        hold = { kind: request.kind, owner: request.owner, tier: request.tier, deadline: request.deadline, current: request.current, yields: request.yields, revision: c.revision, runtime: c.runtime };
        ring.push({ decision: 'held', kind: request.kind, owner: request.owner, tier: request.tier, by });
        // A hold that lends no steps ends a combat step in flight: a moving character
        // breaks a Town channel.
        if (!hold.yields && !stepAllowed(hold, true)) stopStep();
        return 'granted' as const;
      }, 'refused' as const);
    },
    // Design section 1.3 `release(handle)`: the holder ends its own journey or hold. A holder that
    // holds nothing now is a no-op, so no caller checks who moves the character first.
    release(holder: string): boolean {
      const request = journey?.options.request;
      if (request?.owner === holder) {
        finish(false, 'Movement released by its holder', { code: 'released' }, { code: 'released', by: { kind: request.kind, owner: holder } });
        return true;
      }
      if (!hold || hold.owner !== holder) return false;
      ring.push({ decision: 'released', kind: hold.kind, owner: hold.owner });
      tell('hold.ended', { character: host.character.name, kind: hold.kind, owner: hold.owner, code: 'released', by: { kind: hold.kind, owner: hold.owner } });
      hold = undefined;
      if (waiting.length) ports.scope.queueMicrotask(resumeWaiting);
      return true;
    },
    //: the add-on `name` was switched off, so the owner ends what it still holds for it: a
    // request of kind `addon:<name>`, and the add-on's walk, whose identity starts `addon:<name>:`
    // (shared.js `addonWalk`). The registry calls this through its `addon.off` notice, which the owner
    // publishes below. A switched-off add-on sees no hook, so it cannot end them itself.
    endAddon(name: string): void {
      const kind = `addon:${name}` as const, by: MovementCaller = { kind, owner: kind };
      const ours = (owner?: string, of?: string) => of === kind || owner === kind || !!owner?.startsWith(kind + ':');
      const request = journey?.options.request;
      if (request && ours(request.owner, request.kind)) finish(false, `${name} was switched off`, { code: 'addon-off' }, { code: 'addon-off', by });
      if (hold && ours(hold.owner, hold.kind)) endHold('addon-off', by);
      if (climber && ours(climber.owner)) ended(climber.owner, 'addon-off');
    },
    // Who holds movement (`live()`), for readers that need nothing more. `stepAt` is the last
    // combat step or hold of a paused journey, and `stepMs` how long that step keeps the pause
    // (rule 5). `label` is the request's card words.
    live: () => journey ? { kind: journey.options.request!.kind, owner: journey.options.request!.owner, tier: journey.options.request!.tier, journey: true,
      paused, ...(paused ? { stepAt, stepMs } : {}), ...(journey.options.request?.deadline !== undefined ? { deadline: journey.options.request.deadline } : {}),
      ...labelOf(journey.options.request!, true) }
      : hold ? { kind: hold.kind, owner: hold.owner, tier: hold.tier, journey: false, paused: false, ...(hold.deadline !== undefined ? { deadline: hold.deadline } : {}),
        ...labelOf(hold, false) } : null,
    // Design section 1.2 `ladder` and section 3.2: one ladder for the requester that climbs, kept
    // across its rungs. The requester gives the round; asking again with the same
    // identity returns the same ladder, and a new climber replaces the old one.
    // `activity` names what the climb serves, such as "Regrouping after escape", for its
    // records and the card.
    climb(holder: string, round: readonly Rung[], activity?: string): OwnerLadder {
      if (climber?.owner === holder) return climber.ladder;
      if (climber) ended(climber.owner, 'replaced:climb');
      ring.push({ decision: 'climbing', owner: holder, cause: 'ladder' });
      // P9: a core climb's add-on rungs go ahead of its round; an add-on's own go before its fallback.
      const added = hooks.movement.rungs(holder, activity);
      climber = { owner: holder, activity, ladder: watched(createOwnerLadder([...added.ahead, ...withAddonRungs(round, added.own)], ports.now), holder),
        startSeq: ring.lastSeq, idle: 0, flagged: false };
      return climber.ladder;
    },
    endClimb(holder: string): void {
      if (climber?.owner === holder) ended(holder, 'climbed');
    },
    climbing: () => {
      if (!climber) return null;
      if (notice?.until !== undefined && ports.now() >= notice.until) notice = undefined;
      return { owner: climber.owner, activity: climber.activity, ...climber.ladder.report(), ...(notice ? { notice: { ...notice } } : {}) };
    },
    // Stuck and caught-error records, oldest first, and one by its id.
    incidents: incidents.entries,
    // Saves the ring for a death (trigger 1); the others save themselves. Design section 7 trigger
    // 1: survival's `survival.died` for this character saves the movement records once per rip,
    // which the coordinator's store announces with `records.saved` (by the survival owner).
    died(notice: { name?: unknown }) { if (notice.name === host.character.name) snapshot('death'); },
    incident: (id: string) => incidents.entries().find(entry => entry.id === id) ?? null,
    // The player's click (queue C1) for the card: walking, or the countdown before the owner takes
    // over again, with its card words; null without a click. The click is its own answer beside
    // `live()`'s holder: it pauses a journey and ends a hold, and the holds' renewals read `live()`
    // to see whether their own request still holds movement.
    clicking: () => {
      if (!click) return null;
      const state = { walking: click.walking, remainingMs: click.walking ? null : Math.max(0, click.until! - ports.now()), ...(click.town ? { town: click.town } : {}) };
      return { ...state, label: clickLabel(state) };
    },
    // How the holder's last journey or hold ended, from the ring: a Town requester reads
    // `interrupted:click` and casts again after the click hands back. A hold its holder
    // released writes `released`, not `ended`, so that entry counts too; otherwise a Town cast
    // after the click, released when it landed, read the earlier `interrupted:click` and cast
    // Town again every cast.
    endCode(holder: string): string | null {
      const entry = ring.entries().findLast(e => (e.decision === 'ended' || e.decision === 'released') && e.owner === holder);
      return !entry ? null : entry.decision === 'released' ? 'released' : entry.code ?? null;
    },
    // The character's report went out (the requesters' `reportSucceeded`), with the gap since its
    // last one, which the departure gate's window reads.
    reported(gapMs: number) { reportGapMs = gapMs; executor.reported(); },
    // The one report freshness rule for the character's script (runtime/protocol/reports.ts):
    // its readers ask it, the reply sets its ages and each clock sync its own clock difference.
    fresh, setReadings, setClockError,
    // Table A's `settings` row: how long a stuck notice lasts (the coordinator's saved
    // `movementStuckNoticeMs`, or two report intervals when it is unset), the click wait when the
    // reply names this character's, the delivered planning budget (a value its declaration's check
    // refuses leaves the budget as it was) and the report ages (runtime/protocol/reports.ts).
    settingsReply(state: Partial<Record<string, unknown>>) {
      noticeMs = Number(state.movementStuckNoticeMs) > 0 ? Number(state.movementStuckNoticeMs) : 2 * reportGapMs;
      if (typeof state.movementClickWaitMs === 'number') clickWait(state.movementClickWaitMs);
      if ('movementPlanningMs' in state && SAVED.movementPlanningMs.check(state.movementPlanningMs)) planningMs = state.movementPlanningMs as number;
      setReadings(state);
      if (state.routines && typeof state.routines === 'object') routinePicks = state.routines as typeof routinePicks;
    },
    // The entry `name` picked in a routine slot, or undefined for the built-in routine.
    routinePick(name: string, slot: string): string | undefined {
      const pick = routinePicks[name]?.[slot];
      return typeof pick === 'string' ? pick : undefined;
    },
    // One sight search's budget: its time and its steps (steps.ts `createSightRecovery`).
    sightSearch: () => ({ ms: MOVEMENT_PICKS.movementSightSearchMs, steps: MOVEMENT_PICKS.movementSightSteps }),
    // The gap between this character's last two reports, the status timer's second until the first
    // (`reported`).
    reportInterval: () => reportGapMs,
    // "After my click, wait before taking over", per character: the coordinator's saved
    // `movementClickWaitMs` entry for this character, or the decided 5 s.
    setClickWaitMs: clickWait,
    // Design section 3.2's invariants, on each role runner tick. A hold or
    // waiting request past its deadline or stale ends; a journey whose request lapsed
    // ends; a hold with no deadline, and a climber standing between rungs with nothing
    // holding the character for two ticks, each count once and write one ring entry.
    audit(): void {
      if (disposed) return;
      clickTick();
      owner.measured(() => {
        expireHeld(); expireJourney();
        if (hold && hold.deadline === undefined && untimedFor !== hold) {
          untimedFor = hold; invariants.untimed++;
          ring.push({ decision: 'invariant', kind: hold.kind, owner: hold.owner, cause: 'untimed' });
        }
        if (!climber) return;
        const report = climber.ladder.report(), working = report.inProgress && report.rung !== 'wait';
        if (journey || hold || waiting.length || working) { climber.idle = 0; return; }
        if (++climber.idle >= 2 && !climber.flagged) {
          climber.flagged = true; invariants.unowned++;
          ring.push({ decision: 'invariant', owner: climber.owner, cause: 'unowned', code: report.rung });
        }
      }, undefined);
    },
    // Design section 2.4: one native combat step.
    step(to: { x: number; y: number }, mode: string, options: StepOptions = {}): StepResult {
      // `step.point`: an add-on may offer this character's point for the mover's turn, which step
      // safety judges as the mover's own.
      to = hooks.movement.stepPoint({ character: host.character.name, mover: mode, to: { x: to.x, y: to.y }, target: options.target }) ?? to;
      return owner.measured<StepResult | undefined>(() => combatStep(to, mode, options), undefined)
        ?? (!host.can_walk(host.character) || hooks.calls.band({ band: STOP_AND_STEP_BAND, method: 'move' }) === 'send' ? { status: 'sent', sent: Promise.resolve(host.move(to.x, to.y)) }
          : { status: 'refused', reason: 'call budget', sent: Promise.resolve() });
    },
    // Design section 3.1 for the movers' own candidate searches (`safeCombatPoint`): the check
    // `step` applies, and the candidate it would send.
    stepSafe(to: SafetyPoint, target?: string) { return stepSafety({ ...safetyFor(target), to }); },
    // For a mover that checks one candidate at a time: a point passes step safety, or
    // enters only idle blocks while standing still fights nothing.
    stepAllows(to: SafetyPoint, target?: string): boolean {
      const input = { ...safetyFor(target), to }, verdict = stepSafety(input);
      return verdict.safe || verdict.refusal === 'idle-aggro' && !fighting(input);
    },
    chooseStep(candidates: SafetyPoint[], target?: string) { return chooseStep(candidates, safetyFor(target)); },
    // Whether the character fights now (step-safety.ts `fighting`): a monster targets it, or
    // its target stands in its range. A task walk's rung waits while it does, because no smart
    // route starts during combat (docs/combat-movement.md "Formation performance").
    fighting(target?: string): boolean { return fighting(safetyFor(target)); },
    // Combat holds its position (`holdFormation`): a step of zero length. It keeps a
    // combat pause and stops the character's own step.
    holdStep() {
      owner.measured(() => { if (paused) stepTaken(); stopStep(); }, undefined);
    },
    // Combat lets go (`resetCombatMovement`, rule 5): a paused journey resumes and its
    // travel move replaces the step; with nothing to resume, the own step stops.
    letGo() {
      owner.measured(() => {
        if (paused && journey) { resumeSteps('let-go'); stepping = undefined; } else stopStep();
        settleCombat(true);
      }, undefined);
    },
    // The request table `waiting` on combat (replacing shared.js `afterCombat`'s 250 ms poll): true at once when
    // the requester's fight test reads none, else when combat lets go with none; false when the
    // request's currency test lapses first.
    afterCombat(request: Requester & { owner: string } & Pick<MovementRequest, 'current'>, fighting: () => boolean): Promise<boolean> {
      return new Promise(start => {
        if (!fighting()) { partyHooks().ask('targeting.setTargetId', null, request.owner); start(!request.current || request.current()); return; }
        combatWaiting.push({ ...request, fighting, start });
        ring.push({ decision: 'waiting', kind: request.kind, owner: request.owner, tier: request.tier, cause: 'combat' });
      });
    },
    // Design section 2.3 for a holder that re-aims (the independent approach): true when the owner
    // kept the live journey or replaced its plot in place; false leaves the caller to start a
    // new journey.
    retarget(destination: unknown, options: MovementOptions): boolean {
      const incoming = options.request;
      if (!journey || !incoming) return false;
      return owner.measured(() => {
        let target: Point;
        try { refreshGeometry(); target = point(resolveDestination(host, destination)); } catch { return false; }
        const rule = decideRequest(held(journey!), incoming, target, position(), validation.walk);
        if (rule.decision !== 'kept' && (rule.decision !== 'retargeted' || !retargetPlot(target, options))) return false;
        renew(incoming);
        ring.push({ decision: rule.decision, journeyId: journey!.id, kind: incoming.kind, owner: incoming.owner, tier: incoming.tier, destination: target,
          by: { kind: incoming.kind, owner: incoming.owner } });
        return true;
      }, false);
    },
    nativePlanning: planner.report,
    report: () => journey ? { id: journey.id, owner:journey.options.owner, routeAggro: journey.routeAggro, engine: engine(journey), rung: journey.ladder.report().rung, searches: journey.searches, fingerprint, version, remaining: state.plot.length, nativePlanning: planner.report(),planningSchedule:journey.scheduling?.report(),
      elapsedMs:ports.now()-journey.started,plannerMs:journey.plannerMs,collisionError:journey.collisionError,requestMs:journey.requestMs,progress:executor.progress(),nativeCorrections:corrections.report() } : null,
    dispose() { loops.clear(); click = undefined; if (host.on_map_click === onClick) host.on_map_click = nativeClick; corrections.dispose(); finish(false, 'Runtime replaced', undefined, { code: 'runtime-replaced' }); disposed = true; hold = undefined; for (const item of waiting.splice(0)) settleWaiting(item, 'expired'); for (const item of combatWaiting.splice(0)) item.start(false); if (host.smart_move_logic === scheduler) host.smart_move_logic = native.tick; host.smart_move = native.move; host.stop = native.stop; },
  };
  // Movement's core requests and reads on the character are its own functions, published into the
  // role runner's registration on each CODE load, as the follow is (movers.ts `publishFollow`). So
  // are its two listeners: the death snapshot (02 section 7 trigger 1) and the end of a switched-off
  // add-on's requests.
  const published = hooks.publish({ ...roleRunner, hooks: { 'movement.step': service.step, 'movement.acceptMagiport': service.acceptMagiport,
    'movement.live': service.live, 'movement.park': service.park, 'movement.climbing': service.climbing, 'movement.records': ring.entries, 'movement.incidents': incidents.entries,
    'survival.died': notice => service.died(notice), 'addon.off': notice => service.endAddon(String(notice.name)) } });
  if (!published.ok) throw Error(`The movement owner's requests did not load: ${published.message}`);
  host.__partyMovement = service;
  return service;
}
const roleRunner = coreRegistrations.find(r => r.name === 'core:role-runner')!;
// The movement settings the owner reads where it uses them.
const SAVED = movementSavedFields.settings;
// The movers whose step is a formation step (formation.ts), which `formation.moved` tells.
const FORMATION_MOVERS = /^formation-|^spread$|^group-regroup$/;
// R5 `ladder.rung`: an add-on's rungs go into its own request's round before the round's
// fallback, the `safe-point` rung where the round has one and its `wait` rung otherwise.
function withAddonRungs(round: readonly Rung[], added: readonly Rung[]): readonly Rung[] {
  if (!added.length) return round;
  const at = round.findIndex(r => r.name === 'safe-point'), fallback = at >= 0 ? at : round.findIndex(r => r.name === 'wait');
  const cut = fallback >= 0 ? fallback : round.length;
  return [...round.slice(0, cut), ...added, ...round.slice(cut)];
}
// characters/shared.js reads installPartyMovement from the realm. The only realm reader of
// `partySurvival` is e2e/live-movement-owner.spec.ts item 7, which builds a rejoin round in the
// game realm; movement's own files import their rounds from runtime/protocol/ladder.ts.
Object.assign(globalThis, { installPartyMovement, partySurvival: { rejoinRound } });

// The requester identities a character's movers name to the movement owner, and the holds, the
// Town cast and the task walk climb they share. Each identity takes its tier from the member's
// group task through `assignedTier`, the groups and tasks owner's reading of the heartbeat
// assignment (runtime/tasks/character/assignment.ts). characters/shared.js installs it with
// `installMovementRequesters` right after the movement service, and the sliced unit tests
// install the same module into their contexts (scripts/tests/helpers/requesters.cjs).

// The movement service and the game objects are shared.js's untyped values.
type Value = any;
interface AssignedTask { kind: string; owner?: string; tier?: string; phase?: string; apart?: string }
interface TaskWalk {
  // Every task walk ends on its own progress.
  owner: string; request: Request; round: Value; activity: string;
  goal(): Value; current(): boolean;
}
export interface RequesterPorts {
  now(): number;
  // The merchant's running job, as the job owner's runner holds it; none on a fighter.
  merchantJob?(): { jobId: string; commandId: number } | null;
  itemsErrand?(): string | null;
  // shared.js's movement service, its `smart_move` binding and the game's character and data.
  movement(): Value;
  smartMove(destination: Value, callback?: Value, options?: Value): Value;
  character(): Value;
  G(): Value;
  sleep(ms: number): Promise<unknown>;
  // shared.js's runtime root, read for the last report time, the survival rules and the hooks.
  root(): Value;
  current(): boolean;
  // shared.js's walk options for a coordinator command.
  sharedMovementOptions(command: Value): Value;
  // The coordinator's latest command for this member, and whether any heartbeat answered yet.
  coordinatorCommand(): { command: Value; seen: boolean };
  // The tier of the member's group task, or `fallback` for a heartbeat that is lost (the
  // tasks owner's assignment module).
  assignedTier(fallback: string): string;
  // The Town requests' reads and writes of shared.js (appendix A2 TOWN): its coordinator
  // request, the return's saved phase (walk-client.ts `returnPhaseRecord`), the escape, the
  // party Town's flags, the departure and follow flags, survival's
  // respawn ask, and the window that keeps the return progress across a CODE reload.
  request(path: string, options: Value): Promise<Value>;
  returnPhaseRecord(command: Value, kind: string): Value;
  // The return's saved phase on both realm copies (walk-client.ts `keepReturnProgress`), the Town
  // loop's generation and the card's navigation detail (WalkState).
  keepReturnProgress(progress: Value): void;
  townGeneration(): number;
  showNavigation(detail: string | null): void;
  escaping(): boolean;
  town(): { active: boolean; traveling: boolean };
  setDeparture(pending: boolean): void;
  endFollow(): void;
  respawn(by: string): Promise<unknown>;
  parent(): Value;
}

export function installMovementRequesters(client: WalkClient, ports: RequesterPorts) {
  const movement = () => ports.movement(), character = () => ports.character();
  // The console's own movers name one of these, and the rule table ranks them. The service
  // ranks a call that names none as code the player typed in the game client
  // (runtime/movement/character/owner.ts `typed`).
  const manualRequest: Request = { kind: "manual", owner: "manual" };
  const followRequest: Request = { kind: "follow", owner: "follow" };
  // The party Town override's cast.
  const townOverrideRequest: Request = { kind: "town", owner: "town:override" };
  // Terrain and formation recovery routes (formation.ts `createFormationRecoveryClient`).
  const terrainRecoveryRequest: Request = { kind: "formation", owner: "formation-recovery" };
  // sharedMovementOptions holds the walk identity, so cancels name the same walk.
  function walkRequest(command: Value): Request { return ports.sharedMovementOptions(command).request; }
  function commandRequester(command: Value): Request | undefined {
    if (command.type === "party-monster-travel") return walkRequest(command);
    // An app key's travel ranks at `app`, its key's own identity.
    if (["travel", "force-travel", "character-travel", "return-leader"].includes(command.type))
      return command.tier === "app" ? { kind: "app", owner: String(command.by || "app") } : manualRequest;
    if (command.type === "town-party") return townRequest(command);
    return undefined;
  }
  function townRequest(command: Value): Request { return { kind: "town", owner: "town:" + command.id }; }
  // Task walks name their task's tier in the one rank table:
  // a rare, a Hunt encounter catch-up, the farm reunion, the event walks, and a member that walks
  // a shared walk alone. taskWalk builds each of these identities, so one identity ranks at one
  // tier whichever path takes it.
  function taskWalk(owner: string, row: string): Request { return { kind: "task-walk", owner, tier: ports.assignedTier(row) }; }
  function rarePathRequest(path: { id: string }): Request { return taskWalk("rare:" + path.id, "rare"); }
  function catchupRequest(route: { key: string }): Request { return taskWalk("catchup:" + route.key, "hunt-mission"); }
  function reunionRequest(token: { id: string }): Request { return taskWalk("reunion:" + token.id, "farming"); }
  // A lone Town return keeps the Town row. A lone event return walk carries its return's
  // identity, so the return's own hold on the member gives way to it.
  function loneWalkRequest(activity: string, key?: string): Request {
    if (activity === "town-return") return { kind: "town", owner: "lone-walk:town" };
    if (activity === "event-return" && key) return eventReturnRequest(key);
    return taskWalk("lone-walk:" + activity, activity === "event" ? "event-attendance" : "farming");
  }
  // Merchant jobs and fighter errands rank as `errand` (13.2 item 9). While the merchant runs a job,
  // the request names it, `job:<id>:<commandId>`, read from the job owner's runner when a walk reads
  // its owner; a fighter's errand names the bag operation that walks, `items:<op>:<id>` from the
  // items owner's bag holder.
  const errandRequest: Request = { kind: "errand", get owner() {
    const job = ports.merchantJob?.();
    return job ? `job:${job.jobId}:${job.commandId}` : ports.itemsErrand?.() || "errand";
  } };
  // Event walks rank as attendance and their returns as event returns, the anniversary's rounds
  // and returns among them.
  function eventAttendanceRequest(name: string): Request { return taskWalk("event:" + name, "event-attendance"); }
  // The anniversary walks and the walk to the Monster Hunter keep a fixed row. v1.5.0 ran them on
  // their own purpose whatever task the member held (shared.js:15571 for the anniversary
  // return:10649 for the Monster Hunter walk), and v1.5.0's behaviour is the standard.
  const anniversaryRequest: Request = { kind: "task-walk", owner: "anniversary", tier: "event-attendance" };
  const anniversaryReturnRequest: Request = { kind: "task-walk", owner: "anniversary-return", tier: "event-return" };
  const huntNpcRequest: Request = { kind: "task-walk", owner: "hunt-npc", tier: "hunt-turn-in" };
  // The live journey's id (design 1.3 handle): a requester that compares it with the one its
  // request started knows whether its own journey still runs.
  function journeyHandle() { const report = movement().report(); return report ? report.id : null; }
  // The game's xmove walks straight with a native move when it can, which no owner ranks; the
  // console asks the owner as `request` instead. A clear line plans as one leg, and the same
  // requester asking for a new point on that line retargets its journey in place (design 2.3),
  // so a follower that asks on every tick keeps one journey.
  function xmoveAs(request: Request, x: number, y: number) {
    return ports.smartMove({ map: character().map, x, y }, undefined, { request });
  }
  // A farm approach route is an approach walk (design 2.1).
  function farmApproachRequest(route: { at: string }): Request { return { kind: "approach", owner: "farm-approach:" + route.at }; }
  // A walk's request names the row and tier its task named on the coordinator
  // (runtime/movement/coordinator/walk.ts `walkTier`), and the walk's group (`party`, or a
  // solo character), its convoy, epoch and the member's navigation revision. Its currency test
  //  holds while the coordinator's latest command for this member names the same
  // convoy and epoch, so a walk the coordinator dropped, such as a waiting one, ends `stale`
  // instead of resuming alone.
  function walkIdentity(requester: WalkRequester | undefined, convoyId: string, epoch: number, revision: number, group?: string): Request {
    return { kind: requester && requester.kind || "group-walk", owner: "walk:" + (group || "party") + ":" + convoyId + ":" + epoch + ":" + (Number(revision) || 0),
      tier: requester && requester.tier, current() {
        const { command: c, seen } = ports.coordinatorCommand();
        return !seen || !!c && c.type === "party-monster-travel" && c.convoyId === convoyId && Number(c.epoch) === Number(epoch);
      } };
  }
  function convoyRequest(convoy: Value) { return walkIdentity(convoy.requester, convoy.id, convoy.epoch, convoy.navigationRevision, convoy.group); }
  // A hold lasts two of the console's report intervals unless its holder asks again (design
  // 3.2 invariant 2, queue A20). The gap is the last one between completed heartbeats, at
  // least the status timer's second.
  let reportGapMs = STATUS_TIMER_MS;
  const reportWaiters: Array<() => void> = [], reportRenewals: Array<() => void> = [];
  function reportGap() { return reportGapMs; }
  function reportSucceeded() {
    const root = ports.root(), now = ports.now(), last = root.__partyStatusSuccessAt;
    if (last) reportGapMs = reportInterval({ reportIntervalMs: now - last });
    root.__partyStatusSuccessAt = now;
    reportWaiters.splice(0).forEach(wake => wake());
    reportRenewals.slice().forEach(renew => renew());
    // The walking try reads the character's own reports (R2F3).
    movement()?.reported?.(reportGapMs);
  }
  // Runs `renew` on each completed report until the returned function is called, for a holder
  // that renews its timed hold while it lasts.
  function onEachReport(renew: () => void) {
    reportRenewals.push(renew);
    return () => { const index = reportRenewals.indexOf(renew); if (index >= 0) reportRenewals.splice(index, 1); };
  }
  // Resolves when the next report completes, so a rung that waits for a report starts on it,
  // not on the next poll after it.
  function nextReport() { return new Promise<void>(resolve => { reportWaiters.push(resolve); }); }
  // A wait that must end when the reports stop: the next report answers true, and two report gaps
  // with none, the report-freshness bound `timed` holds by, answer false. Silence means the report
  // loop stalled or the character lost its connection, so it tells the status owner's bound record as
  // `reportSilence` under the waiting holder, and the waiter reads the game's own state again.
  function reportOrSilence(holder: string): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      const ms = 2 * reportGapMs, wake = () => resolve(true);
      reportWaiters.push(wake);
      void ports.sleep(ms).then(() => {
        const index = reportWaiters.indexOf(wake);
        if (index < 0) return;
        reportWaiters.splice(index, 1);
        boundFired({ bound: 'reportSilence', owner: '02', state: { holder, ms } });
        resolve(false);
      });
    });
  }
  // Resolves on the first pass of the owner's scheduler on which `test` holds. The owner drives
  // the check (the service's `every` above), so the waiter registers no timer of its own.
  function ownerTickUntil(holder: string, test: () => boolean) {
    if (test()) return Promise.resolve();
    return new Promise<void>(resolve => {
      const end = movement().every(holder, () => { if (test()) { end(); resolve(); } });
    });
  }
  // Resolves on the owner's next scheduler pass: a loop that reads the game's state once per pass
  // waits on it with no timer of its own and no copy of the tick (separate check S1).
  function nextPass(holder: string) {
    let asked = false;
    return ownerTickUntil(holder, () => { const due = asked; asked = true; return due; });
  }
  // A group walk waits for its combat handoff's answer: the engagement request's own promise
  // (sharedConvoyEngagement) settles with it.
  function handoffSettled(convoy: Value) { return convoy.handoffPending && convoy.handoff || Promise.resolve(); }
  function timed(request: Request): Request { return Object.assign({}, request, { deadline: ports.now() + 2 * reportGapMs }); }
  // A requester that owns the character with no journey holds it that long (invariant 2), as a
  // standing hold (runtime/movement/character/owner.ts `yields`).
  function holdIdle(request: Request) {
    const live = movement().live();
    if (!live || !live.journey && live.owner === request.owner) movement().hold(Object.assign(timed(request), { yields: true }));
  }
  // A requester that clears the character before its own work (Town, the event exit) takes a
  // standing hold at its own rank: the rule table ends a lower journey or hold now, and the
  // hold gives way to the requester's next request, or any other, after it.
  function claim(request: Request) { return movement().hold(Object.assign(timed(request), { yields: true })); }
  // A group walk holds its member at the walk's tier through every phase in which it stands:
  // assembly, a hold, a failed or Town wait (design 3.2 invariant 2, 5.1). The walk takes the
  // hold by rank when it starts, and each completed report renews it while the walk owns the
  // member and nothing else holds it. The hold gives way to the walk's own journeys under the
  // same identity and lends the member to combat steps (rules.ts, the group-walk row's Steps column).
  // A newer command for the same walk keeps the hold under that identity.
  function walkStands(command: Value, owns: () => boolean) {
    const request = walkRequest(command);
    // The first hold ranks against whatever holds the member: it takes over a lower journey.
    if (owns()) movement().hold(timed(request));
    return { end() {
      const walk = client.groupWalk.travel, current = walk && !walk.cancelled && convoyRequest(walk);
      if (!current || current.owner !== request.owner) movement().release(request.owner);
    } };
  }
  function holdForWalk() {
    const walk = client.groupWalk.travel;
    // A defending member stays the walk's: the hold lends it to combat steps (queue A4).
    if (!walk || walk.cancelled) return;
    const request = convoyRequest(walk), live = movement().live();
    if (!live || !live.journey && live.owner === request.owner) movement().hold(timed(request));
  }
  const at = (): Point => { const c = character(); return { map: c.map, in: c.in, x: c.x, y: c.y }; };
  // One rung of a task walk's ladder per call: the rare path and a member's regroup with its group
  // (queue A28). Progress returns the ladder to its first rung and no count ends it. The walk holds
  // the character between rungs, and a rung waits while the character fights, because no smart
  // route starts during combat. It answers "walking" while a rung's journey runs, "arrived" after
  // the goal, else "waiting".
  const taskWalks: Record<string, { busy: boolean; arrived?: boolean }> = {};
  function climbTaskWalk(walk: TaskWalk) {
    const state = taskWalks[walk.owner] || (taskWalks[walk.owner] = { busy: false });
    if (state.arrived) return "arrived";
    if (state.busy) return "walking";
    const ladder = movement().climb(walk.owner, walk.round, walk.activity), target = character().target;
    if (movement().fighting(target ? String(target) : undefined)) { holdIdle(walk.request); return "waiting"; }
    const attempt = ladder.next(at(), {});
    if (attempt.rung === "wait") {
      // The hold lasts two report intervals, the longest this waits for one report.
      state.busy = true; holdIdle(walk.request);
      reportOrSilence(walk.owner)
        .then(reported => { state.busy = false; if (reported && walk.current()) ladder.waited(); });
      return "waiting";
    }
    state.busy = true;
    const before = movement().last(), request = Object.assign({}, walk.request);
    let arrived = false;
    Promise.resolve().then(() => ports.smartMove(attempt.destination || walk.goal(), undefined, Object.assign({ request }, attempt.options)))
      .then(() => { arrived = !attempt.destination; }, () => {})
      .then(() => {
        state.busy = false;
        if (!walk.current()) return;
        // A walk that never started leaves the previous journey as the last one.
        const last = movement().last() !== before && movement().last() || {};
        const outcome = ladder.result({ arrived, at: at(), engine: last.engine,
          planned: last.transitions === undefined ? undefined : { transitions: last.transitions, walking: last.walkingDistance }, remaining: last.remaining });
        if (outcome === "arrived") { state.arrived = true; movement().endClimb(walk.owner); } else holdIdle(walk.request);
      });
    return "walking";
  }
  // An add-on mover's `walk` answer (runtime/hooks/registry.ts MoverAnswer), climbed as a task walk at
  // the mover's tier with the rare path's per-try deadline. A new point ends the old walk. The owner
  // ends the walk when the add-on is switched off (the service's `endAddon` above), and the
  // walk stops being current with the switch, so its climb takes no hold after that end.
  let addonWalkOwner: string | null = null;
  function addonWalk(name: string, tier: string, to: Point, activity: string) {
    const owner = name + ":" + to.map + ":" + Math.round(to.x) + ":" + Math.round(to.y);
    if (addonWalkOwner && addonWalkOwner !== owner) endTaskWalk(addonWalkOwner);
    addonWalkOwner = owner;
    return climbTaskWalk({ owner, request: { kind: "task-walk", owner, tier },
      round: taskRound(ports.G(), activity), activity,
      goal: () => ({ map: to.map, x: to.x, y: to.y }),
      current: () => { const hooks = ports.root().__partyHooks; return addonWalkOwner === owner && (!hooks || hooks.enabled(name.slice("addon:".length))); } });
  }
  function endAddonWalk() { if (addonWalkOwner) endTaskWalk(addonWalkOwner); addonWalkOwner = null; }
  // Ends a task walk's climb and its journey or hold by the walk's own identity.
  function endTaskWalk(owner: string) {
    if (!taskWalks[owner]) return;
    delete taskWalks[owner];
    movement().endClimb(owner); movement().release(owner);
  }
  // Town holds the character while it casts; the hold ends with the channel, and a
  // navigation revision change ends it early. The owner sends the cast and counts it until the
  // server answers, so `movement.townCasting()` is the heal guard's one source.
  async function townCast(request: Request) {
    // A click outranks Town (user, 2026-10-29) and breaks its channel: the cast waits for the
    // click to hand back, and a cast the click interrupted (its hold ended `interrupted:click`)
    // is asked again under the same identity. No count ends it; another end does.
    for (;;) {
      if (movement().clicking()) await ownerTickUntil(request.owner + ":click", () => !ports.current() || !movement().clicking());
      if (!ports.current()) return;
      await townCastOnce(request);
      if (!ports.current() || movement().endCode(request.owner) !== "interrupted:click") return;
    }
  }
  async function townCastOnce(request: Request) {
    const held = movement().hold(timed(request));
    if (held === "refused") throw new Error("Town waits: a higher request holds movement");
    // The cast renews its hold on each completed report while it still holds the character, so
    // the hold outlasts the cast by at most two report intervals.
    const renew = () => { const live = movement().live(); if (live && !live.journey && live.owner === request.owner) movement().hold(timed(request)); };
    const stopRenewing = held === "granted" ? onEachReport(renew) : null;
    try {
      await movement().town(timed(request));
      if (held === "granted") while (ports.current() && character().c && character().c.town && !movement().clicking()) await nextPass(request.owner + ":channel");
    } finally { if (stopRenewing) stopRenewing(); if (held === "granted") movement().release(request.owner); }
  }
  // Class G: a Town cast waits for the game's own readiness, its skill use and cooldown, so the
  // Town command and the party Town override cast on one rule. v1.5.0 spaced both
  // casts 4000 ms apart (shared.js:10732:11065).
  function townReady() { const game = ports.root(); return !!game.can_use("use_town") && !game.is_on_cooldown("use_town"); }
  // A requester's crossing with no journey, through the owner (`crossing` in installPartyMovement): the
  // owner ranks it at the requester's identity for two report intervals.
  function transportAs(request: Request, map: string, spawn?: number) { return movement().transport(timed(request), map, spawn); }
  function leaveAs(request: Request) { return movement().leave(timed(request)); }
  function blinkAs(request: Request, x: number, y: number) { return movement().blink(timed(request), { x, y }); }
  // The safe table's Town landing (runtime/movement/rules.ts, queue A29): spawn 0 of the
  // point's map and its scatter. A map with no spawn has no landing, so nothing lands there.
  function townLanded(point: Point) {
    const goal = townGoal(ports.G().maps, point.map), c = character();
    return !!goal && isSafeAt(goal, { map: c.map, in: c.in, x: Number(c.x), y: Number(c.y) });
  }
  // The event return owns a member it lists, such as one that waits at Main for the checkpoint
  // walk (runtime/coordinator/status/assignment.ts names it `event-return:<cycle>`). While the
  // heartbeat's group task names that return, the member holds as it; once the task names
  // anything else, the hold ends. Its exit holds the same way between its own tries
  // (event-return-town). A task-walk hold lends the member to combat steps, so a listed member
  // still fighting on the event map keeps defending.
  function eventReturnRequest(cycleId: string): Request { return taskWalk("event-return:" + cycleId, "event-return"); }
  // The return exit's local Town: one cast toward the map's exit, saved as `exiting-map`
  // first so a reload never casts it again, and none at the map's spawn. An interrupted
  // cast falls back to the walk.
  async function prepareReturnExit(command: Value, kind: string, current: () => boolean) {
    const progress = ports.returnPhaseRecord(command, kind);
    if (progress.phase !== "local-town") return;
    if (!current()) throw new Error("Return workflow superseded");
    const result = await ports.request("/return-progress", { method: "POST", body: { character: character().name,
      kind, cycleId: command.cycleId, navigationRevision: progress.revision, phase: "exiting-map" } });
    if (!current()) throw new Error("Return workflow superseded");
    const c = character();
    ports.keepReturnProgress(result.progress || Object.assign({}, progress, { phase: "exiting-map" }));
    ports.showNavigation("Return: exiting " + c.map + " toward Main");
    const map = ports.G().maps[c.map], spawn = map && map.spawns && map.spawns[0];
    if (spawn && townLanded({ map: c.map, x: spawn[0], y: spawn[1] })) return;
    // Appendix C shared.js:11019 W class G: the cast ends on the game's answer and its channel
    // (`c.town`), with no clock of its own.
    try { await townCast({ kind: "town", owner: "return-exit:" + command.id }); } catch { /* The walk follows. */ }
    while (current() && character().c && character().c.town) await nextPass("return-exit:" + command.id + ":channel");
    if (!current()) throw new Error("Return workflow superseded");
  }
  // The party Town override (rank 85): a fighter away from Main's Town casts it from where it
  // stands. The retained Town command owns the channel and the exit walk while it runs, so the
  // override never casts over it, and it sends no fallback route that could outlive a cancelled
  // channel. The departure flag stays up while the party Town lasts.
  let townOverrideInFlight = false;
  async function enforcePartyTownOverride() {
    if (ports.escaping()) return;
    const town = ports.town(), root = ports.root();
    if (character().ctype === "merchant" || !town.active || town.traveling || townOverrideInFlight) return;
    if (townLanded({ map: "main", x: 0, y: 0 })) return;
    if (root.__partyTownCycleId) return;
    const generation = ports.townGeneration();
    const ownsTown = () => ports.current() && ports.town().active && !ports.escaping() && ports.townGeneration() === generation;
    townOverrideInFlight = true;
    ports.setDeparture(true);
    ports.endFollow();
    const walk = client.groupWalk.travel;
    if (walk) { client.releaseConvoyCruise(walk); walk.cancelled = true; }
    try {
      claim(townOverrideRequest);
      if (!ownsTown()) return;
      if (character().rip) {
        await ports.respawn("town-override");
        while (ownsTown() && character().rip) await nextPass(townOverrideRequest.owner + ":respawn");
      }
      if (!ownsTown()) return;
      if (townReady()) {
        try { await townCast(townOverrideRequest); } catch { /* The next status pass asks again. */ }
      }
    } finally {
      townOverrideInFlight = false;
      ports.setDeparture(ports.town().active);
    }
  }
  let taskHold: string | null = null;
  function holdForTask(assigned: AssignedTask | null) {
    const returning = !!assigned && assigned.kind === "event-return";
    // A new task releases the hold this function took, by its own identity. The lone event
    // return walk shares that identity and keeps walking, so only a hold is released.
    if (taskHold && (!returning || taskHold !== assigned!.owner)) {
      const live = movement().live();
      if (live && !live.journey && live.owner === taskHold) movement().release(taskHold);
      taskHold = null;
    }
    if (returning) {
      const hold = eventReturnRequest(assigned!.owner!.slice("event-return:".length));
      taskHold = hold.owner;
      holdIdle(hold);
    }
  }
  return {
    manualRequest, followRequest, townOverrideRequest, terrainRecoveryRequest, walkRequest, commandRequester, townRequest,
    rarePathRequest, catchupRequest, reunionRequest, loneWalkRequest, errandRequest, eventAttendanceRequest,
    anniversaryRequest, anniversaryReturnRequest, huntNpcRequest, journeyHandle, xmoveAs, farmApproachRequest,
    walkIdentity, convoyRequest, reportGap, reportSucceeded, onEachReport, nextReport, reportOrSilence, ownerTickUntil, nextPass, handoffSettled,
    timed, holdIdle, claim, walkStands, holdForWalk, climbTaskWalk, addonWalk, endAddonWalk, endTaskWalk, townCast, townReady,
    transportAs, leaveAs, blinkAs, townLanded, eventReturnRequest, holdForTask,
    prepareReturnExit, enforcePartyTownOverride, returnWorkflowSuperseded,
  };
}

// Movement's character owner as targeting's ports hold it.
export type PartyMovement = ReturnType<typeof installPartyMovement>;

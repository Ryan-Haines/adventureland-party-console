// The member side of a group walk (R1.1 `walk-client.ts`). It holds the departure gate (appendix A2
// `townReady`, `transitionReady`; the request table `departure`): a Town cast waits while a departure fight is
// pending or an eligible chest is left, and any other map change waits for the chests alone, so the
// party leaves no loot behind. Each wait is judged by the walk phase table `ready` (rules.ts `departureStep`) on this
// character's own reads: `judge` starts one judgement, which samples the gate's attackers and chests
// on each call.
import type { HookRegistry } from '../../hooks/registry.ts';
import type { Request, WalkView } from '../../protocol/records.ts';
import type { SharedCommand, WalkRequester } from '../../protocol/walk.ts';
import type { ScopeHandle } from '../../lifecycle/api.ts';
import { movementError, retryableMovementRequest } from './records.ts';
import { NOT_NOW, sendCruise } from './executor.ts';
import { attackersHp, cancelEnds, cruisePaced, defensePauses, departureStep, departureWaitsFight, departureWaitsLoot, eventTravelHeld, groupWalkActive, handsCombatOver, ownerOfTier, sendBand, tierOf, walkDeparture, type DepartureSample, type WalkFlags, type DepartureVerdict } from '../rules.ts';
import type { SharedRouteRemainder } from './planner.ts';
import { RENDEZVOUS_RANGE } from '../../protocol/ladder.ts';
import { WALK_PROTOCOL, currentQueue } from '../../protocol/reports.ts';
import { eventIs } from '../../events/api.ts';
import { boundFired } from '../../status/api.ts';
import type { NavigationIntent } from '../saved-fields.ts';

// `chests` is the items owner's list of the chests this character still collects (shared.js
// `eligibleDepartureChests`, the pending fight is targeting's published read; `attackers` are
// the game's monsters on this character and `windowMs` its T4 window.
export interface DepartureReads { chests(): readonly unknown[]; attackers(): readonly { hp?: unknown }[]; windowMs(): number; now(): number }
export function departureGate(reads: DepartureReads, hooks: Pick<HookRegistry, 'ask'>) {
  return {
    // `lootLeft`: the executor's loot wait left the chests, so only the fight holds the cast.
    townReady: (lootLeft = false) => !hooks.ask('targeting.departurePending') && (lootLeft || reads.chests().length === 0),
    transitionReady: () => reads.chests().length === 0,
    judge(fight: boolean): () => DepartureVerdict {
      let from: DepartureSample | undefined;
      return () => {
        const r = departureStep(from, { at: reads.now(), attackersHp: fight ? attackersHp(reads.attackers()) : 0, chests: reads.chests().length }, reads.windowMs());
        from = r.from;
        return r.verdict;
      };
    },
  };
}
export type DepartureGate = ReturnType<typeof departureGate>;

// The member's group walk (appendix A2 WCL): `groupWalk.travel` is the walk this character runs
// and `groupWalk.signal` the coordinator's lease on it, and every reader of either reads it here.
// A walk sets the game's cruise speed to its pace, the slowest member's base speed, and only the
// walk that set it gives it back; a runtime that finds a cap with no walk resets it. Moved from
// shared.js (`convoyTraveling`, `convoySignal`, `convoyCruiseCap`, `setConvoyCruise`,
// `releaseConvoyCruise`, `createLocalConvoy`, `sharedPartyWalk`, the shared route's point,
// distance, identity and movement options, `reloadConvoyGeometry`, `sharedRendezvousSearch`, the
// saved route read, `convoyHandoffReachable`, the rendezvous, the combat handoff, the shared
// route's owner and `coordinatedMonsterTravel`) with today's fields and order. The client builds
// the walk's defense and reports below, which read its walk and lease, and the reports read the
// defense's attackers.
export interface GroupWalk { travel: Convoy | null; signal: Signal | null }
// The walk command the coordinator writes (protocol/walk.ts), as the member reads it.
type Command = SharedCommand;
// The game's reads and calls, and the runtime's globals the walk, its defense and its reports read.
interface WalkHost {
  parent: { __partyGeometryReloaded?: unknown; __partyServer?: string; caracAL?: unknown; location?: { reload(): void };
    start_runner?: (name: string, code: string) => void;
    entities?: Record<string, any>; socket?: { connected?: boolean }; transporting?: unknown };
  performance?: { now?(): number };
  G: { maps: Record<string, { spawns: number[][] }>; conditions?: Record<string, { speed?: number; set_speed?: number }> };
  game_log(message: string, color: string): void;
  can_use(skill: string): boolean;
  is_on_cooldown(skill: string): boolean;
  is_transporting(entity: Record<string, any>): boolean;
  // The game's can_walk comes from old_common_functions.js, which the CODE
  // runner loads in the browser and in caracAL (the client's client_scripts.json `runner` list).
  can_walk(entity: Record<string, any>): boolean;
  eval(code: string): unknown;
  can_move_to(x: number, y: number): boolean;
  // The game's cruise, which executor.ts sendCruise sends.
  cruise(speed?: number): unknown;
  is_in_range(target: Record<string, any>): boolean;
  partyPorcupineEquipment?: { depart(purpose: unknown): void } | null;
  partyQueueClient?: { flush?(): void } | null;
  partyRoleRunner?: { wake(): void } | null;
  __partyTravelCombat?: { revision: number } | null;
  __partyTravelCombatAt?: unknown;
  __partyTravelSampleSequence?: number;
  __partyTravelTransport?: Record<string, any> | null;
  __partyTravelSignalAt?: number;
  __partyConvoyHttp?: { responseAt?: number; failure?: { at: number; kind: string; durationMs: number } };
  __partyServer?: string;
  __partyWalkSequence?: number;
  __partySharedWalking?: Record<string, unknown> | null;
  // The leader's frozen route, which a later walk of the same command reuses.
  __partySharedRouteRemainder?: SharedRouteRemainder;
}
// What shared.js hands the walk client: the game's moves, its runtime generation,
// the three writes a new walk makes to shared.js's forced travel, party location and follow, and
// one read each of the state the walk reads, until those move.
export interface WalkClientPorts {
  // The walk state's convoy defense and navigation detail, each with its one writer in
  // owner.ts: install.ts hands them.
  defendConvoy(convoy: string | null): void;
  showNavigation(detail: string | null): void;
  // Movement's run scope handle, `act`: the geometry repair's reload waits for release on a held
  // character.
  scope: ScopeHandle;
  // The character's run speed from class, gear and stats without conditions (shared.js
  // `unrestrictedRunSpeed(false)`), and whether a dungeon run holds the character (the
  // hunting owner's `cave.state` `owned`), whose cap the dungeon sets and resets.
  baseSpeed(): number | null;
  dungeonOwned(): boolean;
  // The coordinator command the member holds now (the lifecycle owner's intake
  // `command`), which `commandHold` reads.
  walkCommand(): Command | null | undefined;
  generation(): number;
  forceTravel(): void;
  setPartyLocation(location: unknown): void;
  endFollow(): void;
  now(): number;
  character(): Record<string, any>;
  current(): boolean;
  intent(): NavigationIntent;
  runtimeId(): string;
  clockOffset(): number;
  setClockOffset(offset: number): void;
  // The crossings' realm (crossings.ts `reunionRealm`).
  realm(): string;
  movement(): Record<string, any>;
  request(path: string, options: Record<string, unknown>): Promise<any>;
  smartMove(destination: unknown, callback: undefined, options: Record<string, unknown>): Promise<unknown>;
  stop(kind: string | undefined, ignored: boolean | undefined, request: unknown): Promise<unknown>;
  // Resolves when this character's next status report completes (owner.ts `nextReport`): a request
  // to the coordinator that failed asks again then (class B).
  nextReport(): Promise<void>;
  // The party's leader and the follow-leader setting (shared.js `leader`, `followLeader`).
  leader(): string | null;
  followLeader(): boolean;
  // Movement's requesters (owner.ts `installMovementRequesters`), which take this client.
  loneWalkRequest(activity: string, key?: string): Request;
  walkRequest(command: Command): Request;
  walkIdentity(requester: WalkRequester | undefined, convoyId: string, epoch: number, revision: number, group?: string): Request;
  convoyRequest(convoy: Convoy): unknown;
  xmoveAs(request: Request, x: number, y: number): Promise<unknown>;
  ownerTickUntil(holder: string, test: () => boolean): Promise<void>;
  // Resolves on the movement owner's next scheduler pass (owner.ts `nextPass`).
  nextPass(holder: string): Promise<void>;
  handoffSettled(convoy: Convoy): Promise<unknown>;
  journeyHandle(): unknown;
  walkStands(command: Command, owns: () => boolean): { end(): void };
  timed(request: Request): Request;
  // The events owner's event reads and return marks and the escape.
  activeEvent(): { name: string } | null;
  eventTarget(): unknown;
  eventReachable(target: unknown): boolean;
  eventReturnHolds(): boolean;
  eventReturnPending(): boolean;
  escaping(): boolean;
  // The departure fight and the items owner's chests (which the barrier's readiness names.
  departurePending(): boolean;
  chests(): readonly unknown[];
  // The defense's reads: the farm walk's token (shared.js `farmingTravelToken`), the hunting owner's hunt travel
  // stand-ins, and one read each of the party's fight state.
  farmTravel(): Record<string, any> | null;
  huntOutbound(): boolean;
  // The hunting owner's planner request for a Hunt walk (hunting/character/hunt.ts
  // `huntReturnPlan`): whether it may cast Town and compare the Town route, or null for any other
  // walk.
  huntReturnPlan(command: Pick<SharedCommand, 'purpose' | 'continuousReturn' | 'disableTown'>): { town: boolean; compareTown: boolean } | null;
  huntExtraAggro(): boolean;
  huntControl(): Record<string, any> | null;
  // The convoy defence triggers' event facts: the joined event, its target types, and the targeting owner's fact
  // that a monster attacks a party member.
  joinedEvent(): string | null;
  eventTargetTypes(): readonly string[];
  attacking(entity: Record<string, any>): boolean;
  grouped(): boolean;
  groupedCombat(): Record<string, any> | null;
  partyList(): string[];
  fightDeaths(): Record<string, any>[];
  engaged(entity: Record<string, any>): boolean;
  entityReport(entity: Record<string, any>): Record<string, any>;
  passingKey(target: Record<string, any>): string;
  // The combat handoff's reads and writes: the hunting owner's farm target, entry point and
  // hunt log, the hunt target and the convoy mark it sets, and the targeting owner's combat target and
  // selection.
  farmTarget(command: Command): Record<string, any> | null;
  entryPoint(location: Record<string, any>): SharedRouteRemainder['destination'];
  huntLog(command: Command, target: Record<string, any>, reason: string, details: Record<string, unknown> | null, channel: string): void;
  setHuntTarget(name: string): void;
  endConvoyActive(): void;
  // The party walk the heartbeat names for this character (owner.ts `WalkState.convoyActive`).
  convoyActive(): boolean;
  setCombatTarget(id: string): void;
  publishSelection(target: Record<string, any>, clear: boolean): void;
  // A walk's end clears the forced travel mark, and an event return's arrival completes the
  // events owner's return.
  endForceTravel(): void;
  eventReturnComplete(): void;
}
// The walk's own state and lease reads that its defense and reports take.
interface WalkCore {
  groupWalk: GroupWalk;
  monotonic(): number;
  convoyDiagnosticClock(): number | null;
  convoySignalExpired(signal: Signal | null): boolean;
  createLocalConvoy(command: Command): Convoy;
  releaseConvoyCruise(convoy: Convoy | null | undefined): void;
  repaceConvoy(convoy: Convoy, pace: number): void;
  clearStrayCruise(): void;
}

// The walk's coordinator requests, each bounded by its wait for one answer from the coordinator's HTTP
// server: a bound against a lost request or a stopped coordinator process. The walk's next report asks
// again (class B), so a fired bound only reports through boundFired.
const SHARED_TRAVEL_REQUEST_MS = 3000; // characters/shared.js:15118
const CONVOY_ROUTE_REQUEST_MS = 3000; // characters/shared.js:15459
const CONVOY_COMPLETE_REQUEST_MS = 5000; // characters/shared.js:15163
const MOVEMENT_BARRIER_REQUEST_MS = 2000; // characters/shared.js:15283
const REQUEST_BOUNDS: Record<string, [string, number]> = {
  '/shared-travel': ['SHARED_TRAVEL_REQUEST_MS', SHARED_TRAVEL_REQUEST_MS],
  '/convoy-route': ['CONVOY_ROUTE_REQUEST_MS', CONVOY_ROUTE_REQUEST_MS],
  '/convoy-complete': ['CONVOY_COMPLETE_REQUEST_MS', CONVOY_COMPLETE_REQUEST_MS],
  '/movement-barrier': ['MOVEMENT_BARRIER_REQUEST_MS', MOVEMENT_BARRIER_REQUEST_MS],
};
// A bounded coordinator request (REQUEST_BOUNDS): a request the bound cut reports through boundFired
// and rejects as before, so each caller keeps its own lost-request rule.
function coordinatorRequest(ports: Pick<WalkClientPorts, 'request'>, path: string, options: Record<string, unknown>): Promise<any> {
  const route = path.split('?')[0]!, [bound, ms] = REQUEST_BOUNDS[route]!;
  return ports.request(path, { ...options, timeout: ms }).catch(function (error: unknown) {
    if ((movementError(error).partyRequest as { kind?: string } | undefined)?.kind === 'timeout')
      boundFired({ bound, owner: '02', state: { path: route, ms } });
    throw error;
  });
}
export function createWalkClient(host: WalkHost, ports: WalkClientPorts) {
  const groupWalk: GroupWalk = { travel: null, signal: null };
  // Class B: a request to the coordinator that failed waits for the member's next status report
  // and asks again after it, with no backoff of its own. The returned test reads true until that
  // report completes.
  function heldUntilReport(): () => boolean {
    let held = true;
    void ports.nextReport().then(function () { held = false; });
    return () => held;
  }
  const monotonic = () => host.performance && typeof host.performance.now === 'function' ? host.performance.now() : ports.now();
  // Observational only: a failure here never changes how a request settles.
  function convoyDiagnosticClock(): number | null {
    try { return monotonic(); } catch { return null; }
  }
  function convoySignalExpired(signal: Signal | null): boolean {
    if (!signal) return true;
    if (Number.isFinite(signal.localDeadline)) return convoyDiagnosticClock()! >= signal.localDeadline!;
    return Number(signal.validUntil) <= ports.now() + ports.clockOffset();
  }
  // A cruise asks the job band: the group walk's the request table row (rules.ts) names no band. One the budget
  // holds (NOT_NOW) settles as a refusal, so the cap or the reset goes again.
  const sentCruise = (speed: number) => new Promise((resolve, reject) => {
    const sent = sendCruise(host, speed, sendBand(undefined));
    if (sent === NOT_NOW) reject(Error(NOT_NOW)); else resolve(sent);
  });
  let cruiseCap: { id: unknown; owner: Convoy; speed: number } | null = null;
  function setConvoyCruise(convoy: Convoy, speed: number) {
    if (groupWalk.travel !== convoy) return;
    const unchanged = cruiseCap && cruiseCap.id === convoy.id && cruiseCap.speed === speed;
    cruiseCap = {id:convoy.id,owner:convoy,speed};
    convoy.cruiseReleased = false;
    if (unchanged) return;
    delete convoy.cruiseRefused;
    // The game's refusal goes on the walk's report, where readiness names it (route-store.ts
    // readinessIssue), and the cap goes, so the walk's next signal sends it again.
    sentCruise(speed).catch(function (error) {
      if (cruiseCap?.owner !== convoy || cruiseCap.speed !== speed) return;
      cruiseCap = null; convoy.cruiseRefused = String(error?.message || error);
    });
  }
  // The coordinator re-paces a walk when a member's base speed changes, and each signal
  // carries the pace, so the walk's cap follows it.
  // A cap the budget refused goes again on each signal until one is sent: a walk's settle waits on
  // the paced speed, and a leader fighting through its return otherwise waits on a cap it never
  // sends again.
  function repaceConvoy(convoy: Convoy, pace: number) {
    if (!(pace > 0)) return;
    if (convoy.cruiseRefused && !cruiseCap) { convoy.pace = pace; setConvoyCruise(convoy, pace); return; }
    if (convoy.pace === pace) return;
    convoy.pace = pace;
    if (cruiseCap && cruiseCap.owner === convoy) setConvoyCruise(convoy, pace);
  }
  // The game keeps a cap until a reset. A runtime with no walk and no live walk lease resets the
  // cap a hand-over kept for a next command that has ended, and a cap a CODE reload or an update
  // left behind, which it sees as a speed below the base speed with no stand, dungeon run or speed
  // condition on the character. A reset that leaves the speed as it was shows no cap, so the
  // runtime sends one reset per speed.
  let strayReset: number | null = null;
  function speedCondition(character: Record<string, any>) {
    return Object.keys(character.s || {}).some(function (id) {
      const condition = host.G.conditions && host.G.conditions[id];
      return !!(Number(character.s[id] && character.s[id].speed) || condition && (Number(condition.speed) || Number(condition.set_speed)));
    });
  }
  function clearStrayCruise() {
    if (groupWalk.travel || !convoySignalExpired(groupWalk.signal) || ports.dungeonOwned()) return;
    const character = ports.character(), speed = Number(character.speed);
    const left = !cruiseCap && speed > 0 && speed < Number(ports.baseSpeed()) - 0.1 && !character.stand && !speedCondition(character);
    if (!cruiseCap && !left) { strayReset = null; return; }
    if (!cruiseCap && strayReset === speed) return;
    cruiseCap = null; strayReset = speed;
    resetCruise();
  }
  // A refused reset leaves the cap in force, which clearStrayCruise sees on its next tick as a
  // speed below the base speed and resets again.
  function resetCruise() {
    sentCruise(500).catch(function () { strayReset = null; });
  }
  function releaseConvoyCruise(convoy: Convoy | null | undefined) {
    if (!convoy || groupWalk.travel !== convoy || convoy.cruiseReleased || !cruiseCap || cruiseCap.owner !== convoy) return;
    cruiseCap = null;
    convoy.cruiseReleased = true;
    // The reset goes out before the walk gives up the character, never from a delayed callback
    // that could reach a newer route.
    resetCruise();
  }
  // Ends the group walk this runtime runs: its cruise, the walk itself and its journey, as
  // v1.5.0 shared.js:150 and:14121 did.
  function endConvoyWalk(convoy: Convoy): void {
    releaseConvoyCruise(convoy);
    convoy.cancelled = true;
    convoy.release?.();
  }
  function createLocalConvoy(command: Record<string, any>): Convoy {
    const convoy: Convoy = { id: command.convoyId, epoch: Number(command.epoch), commandId: command.id,
      holdRequested: command.phase === 'shared-hold',
      // Fast lease responses arrive during rendezvous, before route preparation finishes, so the
      // issued identity is published before any native travel is awaited.
      routeVersion: command.routeVersion || 0,
      navigationRevision: Number(command.navigationRevision) || 0, pace: Number(command.slowestSpeed) || 0,
      generation: ports.generation(), destination: command.location, cancelled: false,
      phase: "taking-control", routeStarts: 0, replanStarts: 0,
      purpose:command.purpose,requester:command.requester,group:command.group,huntTarget:command.huntTarget,navigationExempt:!!command.navigationExempt,nonPreemptible: !!command.nonPreemptible,continuousReturn:command.continuousReturn,returnWalking:!!command.returnWalking };
    groupWalk.travel = convoy;
    if (cruiseCap && cruiseCap.id === convoy.id) cruiseCap.owner = convoy;
    if (command.purpose === "party-force-travel") ports.forceTravel();
    if (command.purpose !== "grouped-approach" && !/^shared-walk/.test(command.purpose||""))
      ports.setPartyLocation(command.purpose === "franky-exit" ? null : command.location);
    ports.endFollow();
    return convoy;
  }
  // A member walking alone runs its own smart_move; a Halloween event walk ends when its event does.
  // A grouped member asks the coordinator's shared walk until it completes, fails or is superseded,
  // and a walk that did not complete tells the coordinator it is cancelled. An event rejoin names
  // its life in `reentry`; the coordinator may answer it `independent`, and the walk hands that
  // leg's destination back to its caller, the events owner's rejoin, which walks it.
  async function sharedPartyWalk(destination: unknown, activity: string, key: string | undefined, parentCommand: { id: number } | null, current?: () => boolean,
    reentry?: number, search?: boolean) {
    if (ports.character().name !== ports.leader() && !ports.followLeader()) {
      const lone = { request: ports.loneWalkRequest(activity, key) };
      if (activity !== 'event' || !eventIs(key, 'aloneUntilOver') || !current) return ports.smartMove(destination, undefined, lone);
      const independentRevision = ports.intent().revision;
      const independent = { cancelled: false }, walking = ports.smartMove(destination, undefined, lone);
      try {
        await Promise.race([walking, (async function () {
          while (!independent.cancelled && ports.current() && current()) await ports.nextPass(lone.request.owner + ':event');
          if (!independent.cancelled) throw new Error('Event destination superseded');
        })()]);
      } finally {
        independent.cancelled = true;
        if (ports.current() && ports.intent().revision === independentRevision &&
            !ports.eventReturnHolds() && !ports.eventReturnPending() && !ports.escaping()) {
          try { await ports.stop('smart', undefined, lone.request); } catch { /* The stop is best effort. */ }
        }
      }
      return;
    }
    const revision = Number(ports.intent().revision) || 0, generation = ports.generation();
    const body: Record<string, any> = {character:ports.character().name,runtimeId:ports.runtimeId(),navigationRevision:revision,
      destination,activity,key:String(key||activity),parentCommandId:parentCommand?parentCommand.id:0};
    if (reentry !== undefined) body.reentry = reentry;
    // A search point's walk ends on the planner's "no route" (coordinator walk.ts `searchPointRefused`).
    if (search) body.search = true;
    host.__partyWalkSequence = (Number(host.__partyWalkSequence) || 0) + 1;
    body.token = ports.runtimeId() + ':' + host.__partyWalkSequence;
    // T4 `assemble` (W row shared.js:15106): the walk ends on the coordinator's answer,
    // complete or failed, or on a newer intent, never on a clock.
    let completed = false;
    host.__partySharedWalking = body;
    try {
      while (ports.current() && ports.generation() === generation && Number(ports.intent().revision) === revision) {
        if (current && !current()) throw new Error('Shared walking workflow changed');
        if (activity === 'event') {
          const liveEvent = ports.activeEvent();
          if (!liveEvent || liveEvent.name !== key) throw new Error('event_not_live');
          // Join/teleport can finish before the boss entity arrives. Yield the
          // walking owner as soon as combat can acquire it, even while waiting
          // for the rest of the party or a coordinator route.
          if (ports.eventReachable(ports.eventTarget())) return;
        }
        let result;
        try { result = await coordinatorRequest(ports, '/shared-travel', {method:'POST',body}); }
        // A lost request is no failure of the walk: the walk's own ladder on the coordinator
        // decides its next step, and the next report asks again (class B). A refusal ends the walk.
        catch (error) { if (!retryableMovementRequest(error)) throw error; await ports.nextReport(); continue; }
        if (result.error) throw new Error(result.error);
        if (result.phase === 'complete') { completed = true; return; }
        if (result.phase === 'independent') { completed = true; return { independent: result.destination || destination }; }
        if (result.phase === 'failed') throw new Error(result.reason || 'Shared walking failed');
        await ports.nextReport();
      }
      throw new Error('Shared walking superseded');
    } finally {
      if (host.__partySharedWalking === body) host.__partySharedWalking = null;
      if (!completed) coordinatorRequest(ports, '/shared-travel', {method:'POST',body:Object.assign({},body,{cancel:true})}).catch(function () {});
    }
  }
  function sharedConvoyPoint() {
    const c = ports.character();
    return {map:c.map,in:c.in,x:c.real_x,y:c.real_y};
  }
  // The coordinator's geometry repair reloads this runtime once per repair, and only for the held
  // walk the lease names under the current intent and before the repair's deadline on the
  // coordinator's clock, which fails the repair at that moment.
  function reloadConvoyGeometry(signal: Signal | null) {
    const repair = signal && signal.geometryReload, convoy = groupWalk.travel, intent = ports.intent();
    if (!repair || repair.runtimeId !== ports.runtimeId() || repair.deadline < ports.now() + ports.clockOffset() || !convoy ||
        convoy.phase !== 'held' || signal!.id !== convoy.id || signal!.epoch !== convoy.epoch || signal!.commandId !== convoy.commandId ||
        intent.cancelled || convoy.navigationRevision !== intent.revision) return;
    const parent = host.parent;
    if (parent.__partyGeometryReloaded === repair.id) return;
    parent.__partyGeometryReloaded = repair.id;
    // A caracAL worker sets only its CODE window's __partyServer
    // (runtime/lifecycle/character/host.ts configureApiAddress), as api does.
    const url = (host.__partyServer || parent.__partyServer || 'http://127.0.0.1:924') + '/CODE/adventure_land/universal-loader.js?t=';
    const bootstrap = "$.ajax({url:" + JSON.stringify(url) + "+Date.now(),dataType:'text',cache:false}).then(function(source){(0,eval)(source);});";
    host.game_log('Reloading runtime once to repair shared-route geometry', '#f0b429');
    ports.scope.setTimeout(function () {
      if (!ports.current()) return;
      if (!parent.caracAL && repair.expected && Number(ports.movement().identity.version) !== repair.expected.version && parent.location) {
        parent.location.reload();
        return;
      }
      if (!parent.caracAL && typeof parent.start_runner === 'function') parent.start_runner('maincode', bootstrap);
      // The CODE window's own eval, called indirectly, runs the loader at its global scope.
      else (0, host.eval)(bootstrap);
    }, 0);
  }
  function sharedConvoyDistance(a: Record<string, any>, b: Record<string, any>) {
    if (a.map !== b.map || String(a.in == null ? a.map : a.in) !== String(b.in == null ? b.map : b.in)) return Infinity;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function sharedConvoyIdentity(command: Command) {
    return {character:ports.character().name,convoyId:command.convoyId,epoch:Number(command.epoch),commandId:command.id,
      navigationRevision:Number(command.navigationRevision)||0,runtimeId:ports.runtimeId(),routeVersion:command.routeVersion};
  }
  // The walk's options for the movement owner: its identity, Town use, the request table departure, the Town
  // attempt record and the step barrier, which asks the coordinator whether the party is ready for
  // each step while this runtime holds the walk's lease. A lost barrier request is a missed
  // report: it answers not ready after the member's next report, and the executor asks again, so
  // the coordinator's the walk phase table judges the stall.
  function sharedMovementOptions(command: Command) {
    const walk = ports.walkIdentity(command.requester, command.convoyId, command.epoch, command.navigationRevision, command.group);
    return { request: walk, owner: {convoyId:command.convoyId,epoch:command.epoch,commandId:command.id,navigationRevision:command.navigationRevision,routeVersion:command.routeVersion,recoveryStage:command.routeRecovery && command.routeRecovery.stage},
      relocation:command.routeRecovery && command.routeRecovery.relocation, shared: true, avoidLeave: !!command.avoidLeave, native: !!command.nativeFallback, speed: command.slowestSpeed,
      transitionComplete:function (destination: { map: string }) {
        if (groupWalk.travel && groupWalk.travel.commandId === command.id) groupWalk.travel.transitionMap = destination.map;
      },
      departure: walkDeparture(command),
      compareTown: !!ports.huntReturnPlan(command)?.compareTown,
      town: !command.disableTown && ((ports.huntReturnPlan(command)?.town ?? true) || command.routeRecovery && command.routeRecovery.relocation === 'town'),
      townAttempt: command.continuousReturn !== 1 ? undefined : function (state: string, index: number, from: { map: string }, destination: unknown) {
        const c = groupWalk.travel;
        if (!c || c.id !== command.convoyId || c.commandId !== command.id) return;
        c.townAttempt = {round:[command.epoch,command.routeVersion,index].join(':'),map:from.map,state,destination};
      },
      barrier: function (step: Record<string, any>, index: number, completed: boolean, lootLeft: boolean) {
        const departure = walkDeparture(command);
        function matchesOwner() {
          const c = groupWalk.travel, signal = groupWalk.signal;
          return c && c.id === command.convoyId && c.commandId === command.id && signal &&
            signal.id === command.convoyId && Number(signal.epoch) === Number(command.epoch) &&
            Number(signal.commandId) === command.id && signal.runtimeId === ports.runtimeId() &&
            signal.routeVersion === command.routeVersion;
        }
        function owned() { return matchesOwner() && !convoySignalExpired(groupWalk.signal); }
        function ownerError() {
          const waiting = !groupWalk.signal || matchesOwner();
          return Object.assign(new Error(waiting ? 'Barrier waiting for current coordinator signal' : 'Barrier owner superseded'),
            {partyRequest:{path:'/movement-barrier',method:'POST',kind:waiting ? 'network' : 'aborted',status:0}});
        }
        // A lease still on its way (no signal yet, or this walk's signal expired) is a missed report
        // too; a newer owner's lease supersedes the barrier.
        const missed = () => ports.nextReport().then(function () { return false; });
        if (!owned()) return groupWalk.signal && !matchesOwner() ? Promise.reject(ownerError()) : missed();
        return coordinatorRequest(ports, '/movement-barrier', {method:'POST',body:Object.assign(sharedConvoyIdentity(command),{
          step:index, destination:step, completed, ready:completed || (!departureWaitsFight(departure) && !step.town || !ports.departurePending()) && (!departureWaitsLoot(departure) || lootLeft || ports.chests().length === 0) && (!step.town || host.can_use('use_town')),
        })}).then(function (result) {
          if (!owned()) throw ownerError();
          return !!result.ready;
        }).catch(function (error) {
          if (!retryableMovementRequest(error)) throw error;
          if (groupWalk.signal && !matchesOwner()) throw ownerError();
          return missed();
        });
      },
    };
  }
  // A member away from the rally walks to it on the walk's own journey, which counts each search
  // it starts.
  async function sharedRendezvousSearch(convoy: Convoy, rally: unknown, ownsConvoy: () => boolean, command: Command) {
    const movement = ports.movement(), smart = movement.state;
    const owner = {tick:function () {
      if (!ownsConvoy()) return;
      if (smart.moving && !smart.found && !smart.searching) {
        convoy.rendezvousSearches = (convoy.rendezvousSearches || 0) + 1; convoy.routeStarts++;
      }
      return movement.tick();
    }};
    // The gate rides on this walk's journey (owner.ts `scheduler`), so it drives only that journey
    // and ends with it. T4 `assemble`: the journey's own walking try ends a walk that stalls, so no
    // clock bounds it.
    await ports.smartMove(rally, undefined, {request:ports.walkRequest(command),town:sharedMovementOptions(command).town,owner:sharedMovementOptions(command).owner,gate:owner});
  }
  // The leader reuses its frozen route only for the same walk, revision, destination, runtime,
  // realm and geometry, from a walkable first point that is no crossing.
  function sharedConvoyReusable(command: Command, origin: Record<string, any>) {
    const saved = host.__partySharedRouteRemainder, movement = ports.movement();
    if(!saved || saved.id!==command.convoyId || saved.revision!==Number(command.navigationRevision||0) ||
        saved.destinationKey!==JSON.stringify(command.location) || saved.runtimeId!==ports.runtimeId())return null;
    if(!saved.origin || saved.origin.map!==origin.map || saved.origin.in!==origin.in || saved.server!==ports.realm() ||
        !saved.geometry || saved.geometry.version!==movement.identity.version || saved.geometry.fingerprint!==movement.identity.fingerprint)return null;
    if(!saved.plot.length || saved.transporting)return null;
    // Fresh Town eligibility must compare candidates instead of freezing the
    // walking-only route selected while Town was explicitly forbidden.
    if(ports.huntReturnPlan(command)?.compareTown && saved.townAllowed===false)return null;
    if(command.disableTown && saved.plot.some(function(p){return p.town;}))return null;
    if(command.avoidLeave && saved.plot.some(function(p){return p.method === "leave";}))return null;
    const first=saved.plot[0];
    if(first.town || first.transport || first.method === "leave" || first.map!==origin.map || !host.can_move_to(first.x,first.y))return null;
    return saved;
  }
  function convoyHandoffReachable(target: Record<string, any> | null, command: Command | null): target is Record<string, any> {
    // Recovery relinquishes travel to the independently routed, all-ready pull
    // barrier on sight. This authorizes approach, never an immediate attack.
    if (command && command.purpose === "empty-spawn-recovery")
      return !!(target && target.visible && !target.dead && target.hp !== 0);
    // Farming keeps smart-route ownership until the leader can attack now.
    // A walkable future approach does not establish group combat clearance.
    if (command && handsCombatOver(command.purpose, command.combatHandoffAllowed))
      return !!(target && !target.dead && target.hp !== 0 && host.is_in_range(target));
    return ports.eventReachable(target);
  }
  const core: WalkCore = { groupWalk, monotonic, convoyDiagnosticClock, convoySignalExpired, createLocalConvoy, releaseConvoyCruise, repaceConvoy, clearStrayCruise };
  const defense = createWalkDefense(host, core, ports);
  const reports = createWalkReports(host, core, defense, ports);
  const { groupedFollower } = defense;
  const { convoyCommunication, acknowledgeConvoyArrival, captureConvoyFailureContext, logConvoyFailureContext, convoyMovementEvidence } = reports;
  // The walk's travel: each coordinator command phase holds the member, assembles it, casts Town,
  // plans a hunt return, or meets at the rally and prepares and walks the route, and a target in
  // reach on the way hands the walk to combat.
  async function sharedConvoyRendezvous(convoy: Convoy, command: Command, ownsConvoy: () => boolean, phase: (value: string) => void) {
    const character = ports.character();
    phase("rendezvous");
    if(command.huntTarget) {
      sharedConvoyEngagement(convoy,command,ownsConvoy,phase);
      await ports.handoffSettled(convoy);
      if(!ownsConvoy())return;
    }
    // T4 `assemble`: the walk to the rally ends on its journey's walking try and the settle below
    // on the game's own state, with no clock.
    let rally=command.rally;
    if(character.name===command.leader) {
      // Queue A27 (decided by the user): the walk starts from where the leader
      // stands once it is within the rally range every follower already meets.
      if(sharedConvoyDistance(sharedConvoyPoint(),rally)>RENDEZVOUS_RANGE || !host.can_move_to(rally.x,rally.y))throw new Error("Leader moved from planning origin");
    } else if(sharedConvoyDistance(sharedConvoyPoint(),rally)>12 || !host.can_move_to(rally.x,rally.y)) {
      if(Number.isFinite(sharedConvoyDistance(sharedConvoyPoint(),rally)) && host.can_move_to(rally.x,rally.y))
        await ports.xmoveAs(ports.walkRequest(command),rally.x,rally.y);
      else await sharedRendezvousSearch(convoy,rally,ownsConvoy,command);
    }
    function unsettled() { return character.moving || host.is_transporting(character) || !cruisePaced(character.speed, convoy.pace, speedCondition(character)); }
    await ports.ownerTickUntil(ports.walkRequest(command).owner+":settle",function(){return !ownsConvoy() || !unsettled();});
    if(!ownsConvoy())return;
    // A leader that left the rally range while it settled reports the same drift as the check
    // above, which the coordinator answers with a new preparation from where the leader stands
    // (route-store.ts `readinessFailure`). Only a follower's miss is a route failure.
    if(sharedConvoyDistance(sharedConvoyPoint(),rally)>RENDEZVOUS_RANGE || !host.can_move_to(rally.x,rally.y))
      throw new Error(character.name===command.leader ? "Leader moved from planning origin" : "Follower cannot connect to leader origin");
  }
  function sharedConvoyEngagement(convoy: Convoy, command: Command, ownsConvoy: () => boolean, phase: (value: string) => void) {
    const character = ports.character(), movement = ports.movement();
    if(command.purpose === "monster-hunt" || command.combatHandoffAllowed===false || convoy.handoffPending || convoy.handoffHeld && convoy.handoffHeld())return;
    if(!command.huntTarget && groupedFollower())return;
    let target=ports.farmTarget(command);
    if(!convoyHandoffReachable(target,command))return;
    convoy.handoffPending=true;
    if (command.huntTarget) ports.huntLog(command,target,"requesting handoff",null,"request");
    convoy.handoff=ports.request("/convoy-engage",{method:"POST",body:Object.assign(sharedConvoyIdentity(command),{
      target:{id:target.id,mtype:target.mtype,map:character.map,in:character.in,x:target.x,y:target.y}})}).then(function(result: any){
      if (command.huntTarget) ports.huntLog(command,target,result && result.ok ? "handoff accepted" : "handoff rejected",{response:result && result.error,stillOwned:!!ownsConvoy()},"response");
      if(!ownsConvoy() || !result || !result.ok)return;
      if(command.huntTarget && result.location) {
        ports.setPartyLocation(result.location); ports.setHuntTarget(command.huntTarget); ports.endConvoyActive();
        host.__partyTravelCombat=null; host.__partyTravelCombatAt=result.serverNow;
        ports.showNavigation(result.handoff==='temporary' ? 'Fighting encountered '+command.huntTarget+'; continuing to hunt area afterward' : 'Farming encountered hunt spawn');
      }
      convoy.engaged=true;phase("engaging-target");releaseConvoyCruise(convoy);if(convoy.detachRoute)convoy.detachRoute();
      // The handoff is the walk's one release.
      movement.combatHandoff(ports.walkRequest(command));
      convoy.cancelled=true;groupWalk.travel=null;ports.setCombatTarget(target.id);
      ports.publishSelection(target,false);
    }).catch(function(error: any){
      // A failed handoff asks again after the member's next report (class B).
      convoy.handoffHeld=heldUntilReport();
      if (command.huntTarget) ports.huntLog(command,target,"handoff rejected",{error:String(error && error.message || error).slice(0,240)},"response");
    }).finally(function(){convoy.handoffPending=false;});
  }
  async function prepareSharedConvoyRoute(convoy: Convoy, command: Command, ownsConvoy: () => boolean, phase: (value: string) => void) {
    const character = ports.character(), movement = ports.movement(), smart = movement.state;
    await sharedConvoyRendezvous(convoy,command,ownsConvoy,phase);
    if(!ownsConvoy() || convoy.failure || convoy.communication)return;
    let leaderRoute=character.name===command.leader,origin=sharedConvoyPoint();
    let destination: SharedRouteRemainder['destination']=leaderRoute?ports.entryPoint(command.location):command.location,started=ports.now(),identity=sharedConvoyIdentity(command);
    // `held` keeps a failed publish or fetch from asking again before the member's next report (class B).
    let released=false,onDone: unknown,installed=false,published=false,pending=false,held=(): boolean => false,payload: Record<string, any> | null=null,fingerprint: string | null=null;
    let saved: Record<string, any> | null=leaderRoute && !command.nativeFallback?sharedConvoyReusable(command,origin):null;
    if(saved)destination=saved.destination;
    convoy.routeVersion=command.routeVersion;
    phase(leaderRoute?"preparing-route":"waiting-for-route");
    function clone<T extends object>(points: T[]){return points.map(function(p){return Object.assign({},p);});}
    function freeze() {
      if(!leaderRoute || !installed || ports.journeyHandle()!==onDone)return;
      const remaining: SharedRouteRemainder['plot']=clone(smart.plot);
      // Managed execution retains its issued step until observed completion.
      // Prepending a pre-tick snapshot would resurrect already-consumed waypoints.
      host.__partySharedRouteRemainder={id:command.convoyId,revision:Number(command.navigationRevision)||0,
        runtimeId:ports.runtimeId(),destinationKey:JSON.stringify(command.location),destination:destination,
        origin:sharedConvoyPoint(),server:ports.realm(),geometry:Object.assign({},movement.identity),
        transporting:!!host.is_transporting(character),plot:remaining,
        townAllowed:command.continuousReturn===1 ? !command.disableTown : undefined};
    }
    convoy.freezeRoute=freeze;
    // Failure retains command ownership while waiting for the coordinator's hold.
    // An in-flight response must not reinstall a route after movement has stopped.
    function routeActive() {
      return ownsConvoy() && !convoy.failure && !convoy.communication;
    }
    function install(route: Record<string, any>) {
      if(!routeActive())return;
      // Queue A27: the leader's route starts where the leader stood, inside the rendezvous range.
      if(route.version!==command.routeVersion || sharedConvoyDistance(route.origin,command.rally)>RENDEZVOUS_RANGE ||
          route.destination.map!==command.location.map || !Array.isArray(route.plot))throw new Error("Shared route identity changed");
      if(sharedConvoyDistance(sharedConvoyPoint(),route.origin)>RENDEZVOUS_RANGE || !host.can_move_to(route.origin.x,route.origin.y))
        throw new Error("Shared route origin is unreachable");
      destination=route.destination; smart.map=destination.map;smart.x=destination.x;smart.y=destination.y;
      // Keep this runtime's callback/deferred and copy only native route data.
      smart.plot.splice.apply(smart.plot,[0,smart.plot.length].concat(clone(route.plot)));
      if(!leaderRoute && sharedConvoyDistance(sharedConvoyPoint(),route.origin)>1)smart.plot.unshift(Object.assign({},route.origin));
      movement.install(smart.plot.slice(), route.geometry, route.engine);
      smart.try_exact_spot=false;
      installed=true;convoy.routeSource=route.source;convoy.routeImports=leaderRoute?0:1;
      fingerprint=JSON.stringify(smart.plot);
      convoy.waypointCount=smart.plot.length;
      convoy.preparationMs=ports.now()-started;
      convoy.routeReady=true;phase("route-ready");
    }
    function publish() {
      if(pending || published || held())return;
      pending=true;
      coordinatorRequest(ports, "/convoy-route",{method:"POST",body:Object.assign({},identity,{route:payload})}).then(function(result: any){
        if(!routeActive())return;
        if(!result || !result.ok)throw new Error("Leader route publication rejected");
        published=true;convoy.routeReady=true;phase("route-ready");
      }).catch(function(error: unknown){
        // A refusal fails the walk with the coordinator's reason, as fetchRoute's does; a lost
        // request publishes again after the next report.
        if(routeActive() && !retryableMovementRequest(error))convoy.fail(movementError(error).message);
        held=heldUntilReport();
      }).finally(function(){pending=false;});
    }
    function fetchRoute(signal: Signal) {
      if(pending || !signal.routeAvailable || held())return;
      pending=true;
      let query=Object.keys(identity).map(function(k){return encodeURIComponent(k)+"="+encodeURIComponent(String((identity as Record<string, unknown>)[k]));}).join("&");
      coordinatorRequest(ports, "/convoy-route?"+query,{}).then(function(result: any){
        if(!routeActive())return;
        if(!result || !result.ok)throw new Error("Route unavailable");
        install(result.route);
      }).catch(function(error: any){
        if(routeActive()) {
          if(retryableMovementRequest(error))convoyCommunication(convoy,error.partyRequest.path,error.partyRequest.kind);
          convoy.fail(error.message || String(error));
        }
        held=heldUntilReport();
      }).finally(function(){pending=false;});
    }
    function plan() {
      if(installed){publish();return;}
      if(!smart.searching){convoy.destinationSearches=(convoy.destinationSearches||0)+1;convoy.routeStarts++;movement.planTick();}
      else movement.planTick();
      if(!smart.moving || !smart.found)return;
      installed=true;convoy.routeSource="search";convoy.waypointCount=smart.plot.length;
      fingerprint=JSON.stringify(smart.plot);
      convoy.preparationMs=ports.now()-started;
      payload={engine:movement.report().engine,geometry:movement.identity,version:command.routeVersion,origin:origin,destination:destination,plot:clone(smart.plot),source:"search"};
      phase("publishing-route");publish();
    }
    function walk() {
      if(command.purpose==="franky-exit" && character.map==="main") {
        smart.searching=false;smart.plot=[];ports.stop("smart",true,ports.walkRequest(command));return;
      }
      sharedConvoyEngagement(convoy,command,ownsConvoy,phase);
      if(!smart.found)throw new Error("Native replan requested; regroup required");
      // Inspect before the native walker removes a point and starts smart_move again.
      if(!character.moving && !host.is_transporting(character) && smart.plot.length) {
        let next=smart.plot[0];
        if(!next.town && !next.transport && next.method !== "leave" && (character.map!==next.map || !host.can_move_to(next.x,next.y)))
          throw new Error("Shared waypoint blocked; regroup required");
      }
      freeze();
      return movement.tick();
    }
    // Design 2.3: a walk that follows a boss names its destination in the signal. A new point
    // re-aims the live journey in place on a clear straight line, with no stop packet and no new
    // route; a blocked line is reported, and the coordinator holds the walk for a new route.
    let aimed=JSON.stringify(command.location);
    function reaim(signal: Signal) {
      if(!signal.destination || JSON.stringify(signal.destination)===aimed)return;
      aimed=JSON.stringify(signal.destination);
      if(movement.retarget(signal.destination,sharedMovementOptions(command))){destination=signal.destination;convoy.destination=signal.destination;convoy.reaimDeclined=null;}
      else convoy.reaimDeclined=signal.destination;
    }
    let owner={tick:function(){
      if(!ownsConvoy() || convoy.failure)return;
      let nativeTown=smart.use_town;
      if(command.purpose==="monster-hunt")smart.use_town=!!ports.huntReturnPlan(command)?.town;
      try {
        let signal=groupWalk.signal,now=ports.now()+ports.clockOffset();
        let matches=signal && signal.id===convoy.id && Number(signal.epoch)===convoy.epoch &&
          Number(signal.commandId)===convoy.commandId && signal.runtimeId===ports.runtimeId() && signal.routeVersion===command.routeVersion;
        if(!signal || !matches || convoySignalExpired(signal)) {
          // A stale lease cannot authorize movement, but a completed owned final
          // transition can retire its receipt without issuing another action.
          if(matches && released && ports.journeyHandle()===onDone &&
            movement.settleTerminal && movement.settleTerminal(movement.report()?.id, sharedMovementOptions(command).owner))return;
          // W row shared.js:15521: before departure the lease may lag until the route is
          // published (the leader's own publication, a follower's installed copy).
          if(!released && !(leaderRoute ? published : installed))return;
          if(!signal || matches)
            convoyCommunication(convoy, '/status', !signal ? 'missing-signal' : 'expired-signal');
          throw new Error("Shared route coordinator signal expired");
        }
        if(["failed","shared-hold","defending"].indexOf(signal.phase)>=0)throw new Error("Party requested hold");
        if(!released)sharedConvoyEngagement(convoy,command,ownsConvoy,phase);
        if(ports.journeyHandle()!==onDone || !smart.moving)throw new Error("Shared route ownership lost");
        if(released){reaim(signal);return walk();}
        if(character.rip || character.moving || sharedConvoyDistance(sharedConvoyPoint(),origin)>1)throw new Error("Route origin changed before departure");
        if(!cruisePaced(character.speed, convoy.pace, speedCondition(character)))throw new Error("Cruise speed changed");
        // T4 `prepare` (W row shared.js:15532): the leader's planning ends within the planner's
        // budget and a follower's copy arrives when the coordinator names it, so no clock ends it.
        if(installed && (!smart.found || JSON.stringify(smart.plot)!==fingerprint))throw new Error("Prepared shared route changed");
        if(leaderRoute)plan();else if(!installed)fetchRoute(signal);
        // The member departs on the first reply that carries the travel phase, with the
        // matching, unexpired lease and unchanged origin above.
        if(!convoy.routeReady || signal.phase!=="travel")return;
        released=true;convoy.departedAt=now;phase("travelling");
        if (host.partyPorcupineEquipment) host.partyPorcupineEquipment.depart(command.purpose);
        return walk();
      } catch(error: any){freeze();convoy.fail(error.message||String(error));}
      finally {smart.use_town=nativeTown;}
    }};
    // The gate rides on the walk's journey; detaching hands the journey back to the
    // service's own tick.
    let detached=false;
    convoy.detachRoute=function(){if(!detached){freeze();detached=true;}};
    let driver={tick:function(){return detached ? movement.tick() : owner.tick();}};
    // Native smart_move initializes a deferred but does not search until the gated tick.
    let route=ports.smartMove(destination, undefined, Object.assign(sharedMovementOptions(command),{gate:driver}));onDone=ports.journeyHandle();
    if(saved) {
      payload={geometry:movement.identity,version:command.routeVersion,origin:origin,destination:destination,plot:clone(saved.plot),source:saved.source||"remainder"};
      install(payload);convoy.routeReady=false;convoy.reusedRoutes=1;
    }
    return route;
  }

  async function coordinatedMonsterTravel(command: Command) {
    const character = ports.character(), movement = ports.movement();
    let convoy=createLocalConvoy(command);
    function ownsConvoy() {
      return ports.current() && !convoy.cancelled && !convoy.defensePaused && groupWalk.travel === convoy &&
        !cancelEnds(command, ports.intent()) && Number(command.navigationRevision || 0) === Number(ports.intent().revision);
    }
    function phase(value: string) {
      if (convoy.phase !== value && ["assembling", "assembled", "travelling", "travel", "arrived", "failed"].indexOf(value) >= 0)
        host.game_log("Convoy " + value + " · " + (command.purpose || "party navigation") + " · " +
          command.location.map + " [" + Math.round(command.location.x) + ", " + Math.round(command.location.y) + "]", "#51D2E1");
      convoy.phase = value;
      if (ownsConvoy()) ports.showNavigation(value);
    }
    convoy.fail = function (reason: string) {
      if (!ownsConvoy() || convoy.failure) return;
      captureConvoyFailureContext(convoy,command);
      if(convoy.freezeRoute)convoy.freezeRoute();
      convoy.failure = String(reason); convoy.routeReady = false;
      movement.cancel('Convoy stopped: '+reason, {code:convoy.communication ? 'convoy-communication-hold' : 'convoy-failure',convoyId:convoy.id,epoch:convoy.epoch,commandId:command.id,by:ports.walkRequest(command)}).catch(function(){});
      phase(convoy.communication ? "communication-hold" : "failed");
      Promise.resolve(ports.stop(undefined, undefined, ports.walkRequest(command))).catch(function () {});
    };
    // The request table (W row shared.js:15816): a member the game holds (it cannot walk, or it is transporting)
    // waits until the game lets it go or a newer command takes the walk; no clock fails the walk.
    async function stopForConvoy() {
      while(ownsConvoy()) {
        if(character.rip)throw new Error("dead during convoy setup");
        let disabled=!host.can_walk(character);
        let flags={transporting:!!host.parent.transporting,statuses:Object.keys(character.s||{}).filter(function(k){return ["dash","stunned","fingered","stoned","deepfreezed","sleeping"].indexOf(k)>=0;})};
        convoy.movementLock=disabled?flags:null;
        if(!disabled) {
          // Native ports.stop() calls move(real_x, real_y), setting moving=true even
          // at rest. Do not disturb the stationary assembly -> prepare barrier.
          if (!character.moving && !host.parent.transporting) return;
          // The walk's hold already took the character (walkStands), so this stop is the holder's own.
          try {await ports.stop(undefined,undefined,ports.walkRequest(command));return;} catch(error: any){if(!error || error.reason!=="unable")throw error;convoy.movementLock=flags;}
        }
        phase("waiting-movement-unlock");
        await ports.nextPass(ports.walkRequest(command).owner + ':unlock');
      }
    }
    // `walking` keeps Town out of the walk, as the safe-point rung of the walk ladder asks
    // (command.rallyWalking): no member casts Town alone inside a convoy.
    function navigate(destination: unknown, walking: boolean) {
      convoy.routeStarts += 1;
      let result = ports.smartMove(destination,undefined,command.continuousReturn===1 ? Object.assign({},sharedMovementOptions(command),{barrier:undefined}) : Object.assign({request:ports.walkRequest(command)},walking ? {town:false} : {}));
      // A request the owner set waiting or refused leaves another owner's journey live; the
      // walk marks an interruption only on its own journey, with the caller the ring names.
      let owner = ports.walkRequest(command).owner, live = movement.live();
      if (!live || !live.journey || live.owner !== owner) return result;
      Promise.resolve(result).then(null, function (error: any) {
        if (!ownsConvoy()) return;
        let ended = movement.records().filter(function (entry: Record<string, any>) { return entry.decision === "ended" && entry.owner === owner; }).pop();
        convoy.interruption = { reason: String(error && (error.reason || error.message) || error), code: ended ? ended.code : null, by: ended ? ended.by || null : null };
      });
      return result;
    }
    let standing = ports.walkStands(command, ownsConvoy);
    try {
      ports.endFollow();
      // The walk's hold ranks against whatever holds the character.
      if (!ownsConvoy()) return;
      // ports.stop("smart") cancels only path ownership; ports.stop() also sends a move
      // packet. Wait for that physical stop before declaring assembly ready.
      await stopForConvoy();
      if (!ownsConvoy()) return;
      if(command.huntTarget && command.combatHandoffAllowed && !convoy.holdRequested) {
        sharedConvoyEngagement(convoy,command,ownsConvoy,phase);
        await ports.handoffSettled(convoy);
        if(!ownsConvoy())return;
      }
      if (command.phase === "hold") {
        convoy.failure = command.reason || "Navigation halted (" + (command.failureCode || "missing-failure-context") +
          "); convoy " + command.convoyId + ", epoch " + command.epoch + ", destination " + command.location.map +
          " (" + command.location.x + ", " + command.location.y + ")";
        convoy.failureContext = command.failureContext || null;
        releaseConvoyCruise(convoy);
        phase("failed");
        ports.showNavigation("Convoy held: " + convoy.failure);
        host.game_log("Convoy held: " + convoy.failure, "red");
        await new Promise(function (resolve) { convoy.release = resolve; });
        return;
      }
      if (command.phase === "shared-hold") {
        if (command.reason) ports.showNavigation(command.reason);
        phase("held");
        await new Promise(function(resolve){convoy.release=resolve;});
        return;
      }
      if (command.phase === "assemble") {
        phase("assembling");
        let rally = command.rally;
        if (!rally) throw new Error("Convoy rally point is missing");
        let distance = character.map === rally.map
          ? Math.hypot(character.x - rally.x, character.y - rally.y) : Infinity;
        if (distance > 12 && !command.deferRendezvous) {
          await navigate(rally, !!command.rallyWalking);
        }
        if (!ownsConvoy()) return;
        // cruise is a server speed cap; the source does not settle its
        // deferred on the game_response acknowledgement. Observe the resulting
        // character speed instead of awaiting that deferred.
        setConvoyCruise(convoy, convoy.pace || character.speed);
        phase("assembled");
        // Keep ownership until the coordinator sends the scheduled travel
        // command. The role loop must not walk away from the rally.
        await new Promise(function (resolve) { convoy.release = resolve; });
        return;
      }
      if (command.phase === "town") {
        phase("casting-town");
        // Appendix C shared.js:15898 G (class G): the game's own Town readiness. The wait lasts the
        // cooldown the game reports, and a Town the game refuses once it is off cooldown is
        // unavailable at once.
        while (ownsConvoy() && host.is_on_cooldown("use_town"))
          await ports.nextPass(ports.walkRequest(command).owner + ':cooldown');
        if (!ownsConvoy()) return;
        if (!host.can_use("use_town")) throw new Error("Town shortcut unavailable; party remains held");
        {
          let townOrigin = { map: character.map, x: Number(character.x), y: Number(character.y) };
          let spawn = host.G.maps[character.map] && host.G.maps[character.map].spawns[0];
          let result = await movement.town(ports.timed(ports.walkRequest(command)));
          if (result && (result.failed || result.success === false)) throw new Error("Town shortcut rejected");
          // Appendix C shared.js:15908 G transition row: the landing waits while the game shows the
          // channel or the transport, then one measured round trip for the landing position.
          let quietAt: number | null = null;
          while (ownsConvoy()) {
            if (!host.is_transporting(character) && character.map === townOrigin.map && spawn &&
                Math.hypot(Number(character.x)-spawn[0],Number(character.y)-spawn[1])<=150) break;
            if (character.c && character.c.town || host.is_transporting(character)) quietAt = null;
            else if ((quietAt ??= ports.now()) + movement.roundTrip() < ports.now()) break;
            await ports.nextPass(ports.walkRequest(command).owner + ':landing');
          }
          if (ownsConvoy() && (host.is_transporting(character) || character.map !== townOrigin.map || !spawn ||
              Math.hypot(Number(character.x)-spawn[0],Number(character.y)-spawn[1])>150))
            throw new Error("Town shortcut did not complete; party remains held");
        }
        if (!ownsConvoy()) return;
        await ports.stop(undefined, undefined, ports.walkRequest(command));
        phase("towned");
        await new Promise(function (resolve) { convoy.release = resolve; });
        return;
      }
      if (command.phase !== "shared-prepare") throw new Error("A fresh prepared convoy is required");
      // A hot reload releases the old runtime's throttle. Re-establish it
      // when resuming preparation even if assembly was already completed.
      setConvoyCruise(convoy, convoy.pace || character.speed);
      await prepareSharedConvoyRoute(convoy, command, ownsConvoy, phase);
      if (!ownsConvoy()) return;
      if (convoy.failure || convoy.communication) throw new Error(convoy.failure || 'Waiting for coordinator communication');
      if (convoy.detachRoute) convoy.detachRoute();
      phase("arrived");
      let completion = await acknowledgeConvoyArrival(convoy, command, ownsConvoy);
      if(!ownsConvoy())return;
      if (completion && completion.superseded) return;
      if (command.purpose === "event-return") ports.eventReturnComplete();
      host.game_log("Arrived with party at " + (command.label || "selected monster"), "#51D2E1");
    } catch (error: any) {
      if (!ownsConvoy()) return;
      let barrierRejection=error && error.partyRequest;
      if(barrierRejection && barrierRejection.path==='/movement-barrier' &&
          (barrierRejection.kind==='aborted' || barrierRejection.status===409 && barrierRejection.code==='superseded')) {
        convoy.cancelled=true; convoy.routeReady=false; convoy.phase='superseded';
        return;
      }
      if (retryableMovementRequest(error))
        convoyCommunication(convoy, error.partyRequest.path, error.partyRequest.kind);
      if (convoy.communication) {
        if (convoy.freezeRoute) convoy.freezeRoute();
        phase('communication-hold'); convoy.routeReady = false;
        await Promise.resolve(ports.stop(undefined, undefined, ports.walkRequest(command))).catch(function() {});
        if (ownsConvoy()) await new Promise(function(resolve) { convoy.release = resolve; });
        return;
      }
      captureConvoyFailureContext(convoy,command);
      phase("failed");
      let reason = convoy.failure || String(error && (error.reason || error.message || error));
      convoy.failure = reason; convoy.routeReady = false;
      await Promise.resolve(movement.cancel('Convoy stopped: '+reason, {code:'convoy-failure',convoyId:convoy.id,epoch:convoy.epoch,commandId:command.id,by:ports.walkRequest(command)})).catch(function(){});
      await Promise.resolve(ports.stop(undefined, undefined, ports.walkRequest(command))).catch(function () {});
      if (!ownsConvoy()) return;
      await ports.request("/convoy-failed", { method: "POST", body: {
        character: character.name, convoyId: command.convoyId,
        epoch: Number(command.epoch), commandId: command.id, runtimeId: ports.runtimeId(), reason: reason,
        failureCode: convoy.townAttempt && ['interrupted','unavailable'].indexOf(convoy.townAttempt.state)>=0 ? 'town-interrupted' : command.phase === "town" ? "town-unavailable" : "route-failed",
        townAttempt: convoy.townAttempt || null,
        routeVersion: command.routeVersion,
        // Design section 7 trigger 3: the ring rides on the failure report.
        movementRecords: movement.records(),
        movementIncidents: movement.incidents(),
        details: { phase: convoy.phase, failureContext: convoy.failureContext || null, routeStarts: convoy.routeStarts,
          map: character.map, x: character.x, y: character.y, movementLock: convoy.movementLock || null, interruption: convoy.interruption || null,
          movement: convoyMovementEvidence(convoy) },
      }}).catch(function () {});
      host.game_log("Convoy movement failed: " + reason, "red");
      logConvoyFailureContext(convoy.failureContext);
      if (ownsConvoy()) await new Promise(function (resolve) { convoy.release = resolve; });
    } finally {
      if(convoy.defensePaused && !convoy.cancelled && groupWalk.travel===convoy)
        await new Promise(function(resolve){convoy.release=resolve;});
      standing.end();
      if (convoy.detachRoute) convoy.detachRoute();
      // A cancelled assembly coroutine can finish after travel has started.
      // It must never reset the new route's speed, label, or smart state.
      if (groupWalk.travel === convoy) {
        if(command.purpose === "party-force-travel")ports.endForceTravel();
        if (ports.current() && !convoy.cruiseHandoff && (command.phase !== "assemble" || convoy.cancelled)) releaseConvoyCruise(convoy);
        groupWalk.travel = null;
        if (ports.current()) {
          ports.showNavigation(null);
        }
      }
    }
  }
  // shared.js reads the walk's rank rules (rules.ts `eventTravelHeld`, `cancelEnds`) through this install.
  // Whether a group walk holds this character: its own walk, or the party walk the heartbeat names
  // (rules.ts `groupWalkActive`). The fight queue's client and the anniversary preempt read it.
  function convoyActive() { return groupWalkActive(groupWalk.travel, ports.convoyActive()); }
  // The activity of the shared walk this character asks the coordinator for, or null: the tasks
  // owner's farm reunion stands aside while its own `farm-recovery` walk runs.
  function sharedWalkActivity(): string | null { return (host.__partySharedWalking?.activity as string | undefined) ?? null; }
  return { ...defense, ...reports, groupWalk, monotonic, convoyDiagnosticClock, convoySignalExpired, setConvoyCruise, releaseConvoyCruise, endConvoyWalk, createLocalConvoy,
    sharedPartyWalk, sharedConvoyPoint, reloadConvoyGeometry, sharedConvoyDistance, sharedConvoyIdentity, sharedMovementOptions,
    sharedRendezvousSearch, sharedConvoyReusable, convoyHandoffReachable, sharedConvoyRendezvous,
    sharedConvoyEngagement, prepareSharedConvoyRoute, coordinatedMonsterTravel,
    eventTravelHeld, cancelEnds, groupWalkActive, convoyActive, sharedWalkActivity };
}
export type WalkClient = ReturnType<typeof createWalkClient>;

// The walk's reports (appendix A2 WRPT, with the WCL helper `convoyCommunication`): the member's
// travel sample and navigation report on each status, the signal lease and clock sync from each reply, the arrival
// acknowledgement, and the failure context a failed walk logs. Moved from shared.js with today's
// fields and order.
type Convoy = Record<string, any> & WalkView & { communication?: Record<string, unknown>; failureContext?: Record<string, any> | null };
type Signal = Record<string, any> & { localDeadline?: number };
// (audit 2026-11-10): the owner that answers for a member's live request, read
// from the request's tier. The escape is survival's, the event tiers are the events owner's, an
// errand is the merchant job owner's and every task walk, farming and Hunt request is the tasks
// owner's. The walk, its lease and the lease's clock are the walk client's, and the travel sample's
// attackers and their observation time are the defense's.
export function createWalkReports(host: WalkHost, walk: WalkCore, defense: Pick<WalkDefense, 'currentTravelAttackers' | 'travelObservationAt'>, ports: WalkClientPorts) {
  const { monotonic, convoyDiagnosticClock, convoySignalExpired } = walk;
  function convoyMovementEvidence(convoy: Convoy) {
    const current = ports.movement().report(), last = ports.movement().last();
    if (current && current.owner && current.owner.commandId === convoy.commandId) return current;
    if (last && last.failureContext && last.failureContext.commandId === convoy.commandId) return last;
    return null;
  }
  function convoyNavigationReport() {
    const t = walk.groupWalk.travel;
    return t ? { id: t.id, epoch: t.epoch,
      communication: t.communication || null,
      navigationRevision: t.navigationRevision,
      commandId: t.commandId, phase: t.phase,
      encounterCatchup: t.encounterCatchup ? {target:t.encounterCatchup.target,from:t.encounterCatchup.from,map:t.encounterCatchup.map,failed:t.encounterCatchup.failed||null} : null,
      defenseTargets: t.defenseTargets || [],
      defenseInterruption: t.defenseInterruption || null,
      townAttempt: t.townAttempt || null,
      transitionMap: t.transitionMap || null,
      runtimeId: ports.runtimeId(), routeReady: !!t.routeReady,
      routeVersion: t.routeVersion || 0, routeSource: t.routeSource || null,
      departureChests: ports.chests().length, attackPeriodMs: Number(ports.character().frequency) > 0 ? 1000 / Number(ports.character().frequency) : null,
      destinationSearches: t.destinationSearches || 0, rendezvousSearches: t.rendezvousSearches || 0,
      routeImports: t.routeImports || 0, reusedRoutes: t.reusedRoutes || 0,
      preparationMs: t.preparationMs || null, waypointCount: t.waypointCount || 0,
      failure: t.failure || null, reaimDeclined: t.reaimDeclined || null, cruiseRefused: t.cruiseRefused || null,
      failureDetails: t.failure ? {movement: convoyMovementEvidence(t), failureContext:t.failureContext || null} : undefined, replanStarts: t.replanStarts || 0,
      routeStarts: t.routeStarts, departedAt: t.departedAt || null } : null;
  }
  // A member that holds the walk's command and does not run it names what holds it, from its own reads: death
  // (05), the console hold (13), the player's manual control (02) or the owner of the live request the movement
  // owner runs (rules.ts `ownerOfTier`). Null while it runs the walk or holds no walk command, and for a member
  // with nothing holding it, whose walking try stalls and climbs the walk.
  function commandHold(body: Record<string, any>): { owner: string; reason: string } | null {
    const command = ports.walkCommand(), travel = walk.groupWalk.travel, c = ports.character();
    if (!command || command.type !== 'party-monster-travel' || travel && travel.commandId === command.id) return null;
    if (c.rip) return { owner: '05', reason: 'dead' };
    if (body.consoleMaintenance) return { owner: '13', reason: 'paused' };
    const live = ports.movement().live && ports.movement().live();
    if (live && live.kind === 'manual') return { owner: '02', reason: 'manual control' };
    return live ? { owner: ownerOfTier(tierOf(live as Parameters<typeof tierOf>[0]).tier), reason: live.kind + ' ' + live.owner } : null;
  }
  function sampleTravelReport(body: Record<string, any>) {
    const group = body.groupedCombat, c = ports.character(), movement = ports.movement();
    body.travelSample = {runtimeId: ports.runtimeId(), sequence: (host.__partyTravelSampleSequence = (host.__partyTravelSampleSequence || 0) + 1),
      connected: !!(host.parent.socket && host.parent.socket.connected), transport:host.__partyTravelTransport || null};
    Object.assign(body, {map:c.map, in:c.in, x:c.x, y:c.y,
      moving:!!c.moving, transporting:!!host.parent.transporting, speed:c.speed, baseSpeed:ports.baseSpeed(),
      hp:c.hp, max_hp:c.max_hp, rip:!!c.rip,
      convoyProtocol:WALK_PROTOCOL, convoyNavigation:convoyNavigationReport(), commandHold:commandHold(body), movementGeometry:movement.identity,
      movement:movement.report() || movement.last()});
    group.currentAttackers = defense.currentTravelAttackers();
    group.currentAttackersAt = defense.travelObservationAt();
    // Reads the speed this report carries.
    walk.clearStrayCruise();
  }
  function convoyActivityFromStatus(state: Record<string, any>): boolean {
    if (state.partyConvoyActive) return true;
    // Full status can yield while a newer fast heartbeat renews the owned journey. Only newer
    // authoritative inactivity retires that journey.
    const signal = walk.groupWalk.signal, travel = walk.groupWalk.travel;
    return !!(signal && travel && Number.isFinite(Number(state.serverNow)) &&
      Number(state.serverNow)<Number(host.__partyTravelSignalAt || 0) &&
      Number.isFinite(signal.localDeadline) && !convoySignalExpired(signal) &&
      signal.id===travel.id && signal.epoch===travel.epoch && signal.commandId===travel.commandId &&
      signal.runtimeId===ports.runtimeId() && signal.routeVersion===(travel.routeVersion || 0) &&
      signal.navigationRevision===travel.navigationRevision);
  }
  function acceptTravelResponse(state: Record<string, any>, started: { wall: number; mono: number | null }, fast: boolean) {
    const received = convoyDiagnosticClock()!, wall = ports.now(), timing = state.transportTiming;
    const sentAt = timing && Number(timing.sentAt) || Number(state.serverNow);
    if (!Number.isFinite(sentAt)) return;
    const elapsed = Math.max(0, received - Number(started.mono));
    const processing = timing ? Math.max(0, sentAt - Number(timing.receivedAt)) : 0;
    const network = Math.max(0, elapsed - processing);
    const history = host.__partyTravelTransport || (host.__partyTravelTransport = {});
    history[fast ? 'fast' : 'full'] = {at:wall, durationMs:elapsed, processingMs:processing, networkMs:network, eventLoopMaxMs:timing && timing.eventLoopMaxMs,statusStages:timing && timing.statusStages};
    // The 60 s lets a slower sync replace an old best one, so the offset follows clock drift. It is
    // no log throttle, so appendix C shared.js:3129's class D rule has no signal for it: value
    // kept.
    if (timing && (!history.clock || wall-history.clock.at>60000 || network<history.clock.networkMs)) {
      const offset = (Number(timing.receivedAt) + sentAt - started.wall - wall) / 2;
      ports.setClockOffset(offset);
      history.clock = {at:wall, networkMs:network, offset};
      ports.movement().setClockError(history);
    }
    const signal = state.convoySignal, travel = walk.groupWalk.travel;
    if (!signal || !Number.isFinite(Number(signal.validUntil))) return;
    if (sentAt < (host.__partyTravelSignalAt || 0)) return;
    if (fast && (!travel || signal.id!==travel.id || signal.epoch!==travel.epoch ||
        signal.commandId!==travel.commandId || signal.runtimeId!==ports.runtimeId() ||
        signal.routeVersion!==(travel.routeVersion || 0) ||
        signal.navigationRevision !== undefined && signal.navigationRevision!==travel.navigationRevision)) return;
    host.__partyTravelSignalAt = sentAt;
    // All unaccounted transport time counts against the lease, so a delayed reply gains no
    // extra time for arriving late.
    walk.groupWalk.signal = {...signal, localDeadline:received + Math.max(0, Number(signal.validUntil)-sentAt-network)};
    if (travel && signal.id === travel.id && signal.epoch === travel.epoch) walk.repaceConvoy(travel, Number(signal.pace));
  }
  function rememberConvoyStatusRequest(started: number | null, outcome: string) {
    if (started === null) return;
    try {
      const now = convoyDiagnosticClock();
      if (now === null) return;
      const history = host.__partyConvoyHttp || (host.__partyConvoyHttp = {});
      if (outcome === 'success') history.responseAt = now;
      else history.failure = { at: now, kind: outcome, durationMs: Math.max(0, Math.round(now - started)) };
    } catch { /* Observational only. */ }
  }
  // The transport row: the travel diagnostics one coordinator request carries. A grouped report
  // carries the travel sample; a status reply sets the clock offset and the convoy lease; a
  // barrier reply or failure records its timing; a status outcome records its age.
  function travelRequest(path: string, body?: Record<string, any>) {
    if (path === '/status' && body && body.groupedCombat) sampleTravelReport(body);
    const started = { wall: ports.now(), mono: convoyDiagnosticClock() }, status = path === '/status' ? started.mono : null;
    const barrier = (record: Record<string, unknown>) => {
      if (path !== '/movement-barrier') return;
      (host.__partyTravelTransport || (host.__partyTravelTransport = {})).barrier = { at: ports.now(), durationMs: Number(convoyDiagnosticClock()) - Number(started.mono), ...record };
    };
    return {
      // A 204 reply, such as /map-frame's, reaches here with no body.
      succeeded(value: Record<string, any> | undefined, fast: boolean): void {
        const t = value?.transportTiming || {};
        barrier({ processingMs: Math.max(0, (t.sentAt || 0) - (t.receivedAt || 0)), eventLoopMaxMs: t.eventLoopMaxMs, outcome: 'success' });
        if (path === '/status' && value) acceptTravelResponse(value, started, fast);
        rememberConvoyStatusRequest(status, 'success');
      },
      failed(kind: string): void { rememberConvoyStatusRequest(status, kind); barrier({ outcome: kind }); },
    };
  }
  // Class D: a group movement line is written when its content changes, with no clock.
  let groupMovementLog: { key: string; message: string } | null = null;
  function logGroupMovement(key: string, message: string) {
    if (groupMovementLog && groupMovementLog.key === key && groupMovementLog.message === message) return;
    groupMovementLog = { key, message };
    host.game_log(message, '#51D2E1');
  }
  function convoyCommunication(convoy: Convoy, operation: string, kind: string) {
    if (!convoy.communication) {
      convoy.communication = { operation, kind, since: ports.now() + ports.clockOffset() };
      host.game_log('Convoy waiting for coordinator communication: ' + operation + ' (' + kind + ')', '#94a3b8');
    }
    ports.showNavigation(operation === '/convoy-complete' ? 'Arrived; waiting for completion acknowledgement' : 'Waiting for coordinator communication');
  }
  // The arrival acknowledgement (class B): a completion the coordinator holds waiting, or one
  // whose request failed, asks again after the member's next report, with no backoff of its own.
  async function acknowledgeConvoyArrival(convoy: Convoy, command: Record<string, any>, ownsConvoy: () => boolean) {
    while (ownsConvoy()) {
      try {
        const completion = await coordinatorRequest(ports, '/convoy-complete', { method: 'POST', body: {
          character: ports.character().name, convoyId: command.convoyId, epoch: Number(command.epoch), commandId: command.id,
          runtimeId: ports.runtimeId(), navigationRevision: Number(command.navigationRevision) || 0, routeVersion: command.routeVersion,
        }});
        if (convoy.communication) host.game_log('Convoy completion communication restored', '#94a3b8');
        delete convoy.communication;
        if (!completion || !completion.waiting) return completion;
        await ports.nextReport();
      } catch (error) {
        if (/stale convoy completion/.test(String(error && ((error as Error).message || error)))) {
          if (ownsConvoy()) await new Promise(resolve => { convoy.release = resolve; });
          return { superseded: true };
        }
        if (!retryableMovementRequest(error)) { delete convoy.communication; throw error; }
        convoyCommunication(convoy, '/convoy-complete', (error as { partyRequest: { kind: string } }).partyRequest.kind);
        await ports.nextReport();
      }
    }
    return { superseded: true };
  }
  function captureConvoyFailureContext(convoy: Convoy, command: Record<string, any>) {
    try {
      if (convoy.failureContext) return;
      const signal = walk.groupWalk.signal, now = ports.now() + ports.clockOffset(), mono = monotonic(), runtimeId = ports.runtimeId();
      const http = host.__partyConvoyHttp || {}, mismatches: { field: string; expected: unknown; received: unknown }[] = [];
      const expected: Record<string, unknown> = {id:convoy.id,epoch:convoy.epoch,commandId:convoy.commandId,runtimeId};
      expected.routeVersion = command.routeVersion;
      if (signal) Object.keys(expected).forEach(field => {
        const actual = field === 'epoch' || field === 'commandId' ? Number(signal[field]) : signal[field];
        if (actual !== expected[field]) mismatches.push({field,expected:expected[field],received:signal[field]});
      });
      const expiry = signal && Number.isFinite(Number(signal.validUntil)) ? Math.max(0, Math.round(Number.isFinite(signal.localDeadline) ? mono - signal.localDeadline! : now - Number(signal.validUntil))) : null;
      const state = !signal ? 'missing' : mismatches.length ? 'identity mismatch' : expiry === null ? 'unknown' : convoySignalExpired(signal) ? 'expired' : 'matching';
      const age = (at: unknown) => typeof at === 'number' && Number.isFinite(at) && mono >= at ? Math.round(mono-at) : null;
      const p = (value: any) => value ? {map:value.map,x:value.x,y:value.y} : null;
      convoy.failureContext = {phase:convoy.phase,position:p(ports.character()),destination:p(command.location),
        convoyId:convoy.id,epoch:convoy.epoch,commandId:convoy.commandId,runtimeId,routeVersion:command.routeVersion,
        signal:{state,expiredByMs:expiry,mismatches},lastStatusResponseAgeMs:age(http.responseAt), transport:JSON.parse(JSON.stringify(host.__partyTravelTransport || null)),
        lastStatusFailure:http.failure ? {kind:http.failure.kind,durationMs:http.failure.durationMs,ageMs:age(http.failure.at)} : null};
    } catch { /* Observational only. */ }
  }
  function logConvoyFailureContext(context: Record<string, any> | null | undefined) {
    try {
      if (!context) { host.game_log('Convoy context: unknown', '#94a3b8'); return; }
      const text = (value: unknown) => value == null ? 'unknown' : String(value).replace(/[\r\n\t]/g,' ').slice(0,100);
      const ms = (value: unknown) => value == null ? 'unknown' : text(value)+'ms';
      const point = (value: any) => value ? text(value.map)+' ('+text(Number.isFinite(value.x)?Math.round(value.x):null)+','+text(Number.isFinite(value.y)?Math.round(value.y):null)+')' : 'unknown';
      host.game_log('Convoy context: phase='+text(context.phase)+'; position='+point(context.position)+'; destination='+point(context.destination)+
        '; convoy='+text(context.convoyId)+'; epoch='+text(context.epoch)+'; command='+text(context.commandId)+'; runtime='+text(context.runtimeId)+'; route='+text(context.routeVersion), '#94a3b8');
      const signal = context.signal, failure = context.lastStatusFailure;
      const detail = signal.mismatches.map((m: { field: string; expected: unknown; received: unknown }) => m.field+' expected='+text(m.expected)+' received='+text(m.received)).join(', ');
      host.game_log('Convoy signal: '+signal.state+(detail?' ['+detail+']':'')+'; expiry overrun='+ms(signal.expiredByMs)+
        '; last status response='+ms(context.lastStatusResponseAgeMs)+' ago; latest status failure='+
        (failure ? text(failure.kind)+' after '+ms(failure.durationMs)+' ('+ms(failure.ageMs)+' ago)' : 'unknown'), '#94a3b8');
    } catch { /* Observational only. */ }
  }
  return { convoyMovementEvidence, convoyNavigationReport, sampleTravelReport,
    convoyActivityFromStatus, acceptTravelResponse, rememberConvoyStatusRequest, travelRequest, logGroupMovement, convoyCommunication,
    acknowledgeConvoyArrival, captureConvoyFailureContext, logConvoyFailureContext };
}

// The navigation intent (appendix A2 NAV): the coordinator's revision of where the party goes,
// which each status reply carries. A new revision, or a change of its cancel mark, ends every
// walk this character runs and stops the game's moves, so no walk carries on under an intent it
// did not start under. A return's saved phase counts only under the revision it was saved in.
interface ReturnProgress { kind: string; cycleId: unknown; revision: number; phase: string; [field: string]: unknown }
interface NavigationHost {
  __partyNavigationIntent?: NavigationIntent;
  __partyReturnProgress?: ReturnProgress | null;
  parent: { __partyReturnProgress?: ReturnProgress | null };
}
// What shared.js hands the navigation: its intent and the walks besides the group walk that a
// change ends, one read or write each, until those walks move here.
export interface NavigationPorts {
  intent(): NavigationIntent;
  setIntent(next: NavigationIntent): void;
  // The farm walk's token (shared.js `farmingTravelToken`).
  farmTravel(): { cancelled?: boolean } | null;
  // The follow and the forced walk (`followingLeader`, `forceTraveling`).
  follows(): boolean;
  endFollows(): void;
  // The events owner's anniversary return marks (which a new intent clears.
  clearEventReturn(): void;
  // The movement owner's stop, which shared.js binds the game's `stop` to.
  stop(kind: string, ignored: undefined, reason: { superseded: string }): Promise<unknown>;
}

export function createNavigation(host: NavigationHost, walk: WalkClient, ports: NavigationPorts) {
  function navigationRevision() { return Number(ports.intent().revision) || 0; }
  async function applyNavigationIntent(next: NavigationIntent | null | undefined) {
    if (!next) return;
    const current = ports.intent();
    const changed = Number(next.revision) !== Number(current.revision) || !!next.cancelled !== !!current.cancelled;
    ports.setIntent(host.__partyNavigationIntent = next);
    if (!changed) return;
    ports.clearEventReturn();
    const farm = ports.farmTravel(), convoy = walk.groupWalk.travel;
    const ownsMovement = farm || convoy || ports.follows();
    if (farm) farm.cancelled = true;
    if (convoy) walk.endConvoyWalk(convoy);
    ports.endFollows();
    if (ownsMovement) {
      const superseded = { superseded: 'navigation-revision' };
      try { await ports.stop('smart', undefined, superseded); } catch { /* The stop is best effort. */ }
      try { await ports.stop('move', undefined, superseded); } catch { /* The stop is best effort. */ }
    }
  }
  function returnPhaseRecord(command: { cycleId: unknown }, kind: string): ReturnProgress {
    const revision = navigationRevision();
    const saved = [host.__partyReturnProgress, host.parent.__partyReturnProgress].find(p =>
      p && p.kind === kind && p.cycleId === command.cycleId && p.revision === revision);
    return saved || { kind, cycleId: command.cycleId, revision, phase: 'local-town' };
  }
  // The one writer of the return's saved phase, on the realm and the game window, which outlives a
  // CODE reload.
  function keepReturnProgress(progress: ReturnProgress | null): void {
    host.parent.__partyReturnProgress = host.__partyReturnProgress = progress;
  }
  return { navigationRevision, applyNavigationIntent, returnPhaseRecord, keepReturnProgress };
}

// The walk's defense (appendix A2 DEF): a coordinator defense command or a local attacker pauses
// the group walk where it stands and names the party's attackers, and the travel fight reads
// whether a defensive walk owns combat. Moved from shared.js with today's checks, fields and order.
// Which walks a fight pauses is the request table's `defensePauses` (rules.ts).
export function createWalkDefense(host: WalkHost, walk: WalkCore, ports: WalkClientPorts) {
  function acceptConvoyDefenseCommand(command: SharedCommand) {
    const intent = ports.intent();
    if(intent.cancelled || Number(command.navigationRevision||0)!==Number(intent.revision||0))return false;
    let c=walk.groupWalk.travel;
    if(c && (c.id!==command.convoyId || c.epoch>Number(command.epoch) || c.commandId>=command.id))return false;
    if(c && Number(c.navigationRevision||0)!==Number(command.navigationRevision||0))return false;
    if(!c) {
      // Preparation and defense may be coalesced between heartbeats. Install
      // the complete authorized owner before acknowledging this stopped route.
      if(!coldConvoyDefenseAllowed(command))return false;
      c=walk.createLocalConvoy(command);
    }
    if(c) {
      c.commandId=command.id;c.epoch=Number(command.epoch);c.holdRequested=false;
      delete c.communication;delete c.failure;
      if(c.phase==='held' || c.phase==='communication-hold')c.phase='stopped';
    }
    interruptConvoyForDefense(command.convoyId,command.epoch);
    return !!(walk.groupWalk.travel===c && c!.defensePaused);
  }
  function coldConvoyDefenseAllowed(command: Record<string, any>) {
    if(!ports.current() || command.phase!=='defending')return false;
    if(typeof command.convoyId!=='string' || !command.convoyId || !Number.isFinite(command.epoch) || !Number.isFinite(command.id))return false;
    if(!command.location || typeof command.location.map!=='string' || !Number.isFinite(command.location.x) || !Number.isFinite(command.location.y))return false;
    if(!Array.isArray(command.participants) || command.participants.indexOf(ports.character().name)<0)return false;
    return defensePauses(command);
  }
  function interruptConvoyForDefense(id?: string | null, epoch?: unknown, aggressor?: Record<string, any> | null) {
    const c=walk.groupWalk.travel, intent=ports.intent();
    if(c && id && (c.id!==id || Number(epoch)!==c.epoch))return;
    if(c && (c.holdRequested || c.communication || c.phase==='held' || c.phase==='communication-hold'))return;
    if(c && (intent.cancelled || Number(intent.revision||0)!==Number(c.navigationRevision||0)))return;
    if(c && !defensePauses(c as WalkFlags))return;
    if(!c && !id)return;
    if(ports.huntOutbound() && !id && !ports.huntExtraAggro())return;
    ports.defendConvoy(id || c!.id);
    if(c) {
      if(c.defensePaused)return;
      const huntPrimary=ports.huntControl();
      c.defenseTargets = aggressor ? [Object.assign(ports.entityReport(aggressor), {server:ports.realm()})] : currentTravelAttackers();
      if(huntPrimary)c.defenseTargets=c.defenseTargets.concat(huntPrimary.committed||[],huntPrimary.primary?[huntPrimary.primary]:[]);
      c.defenseTargets=Array.from(new Map(c.defenseTargets.map(function(t: Record<string, any>){return [ports.passingKey(t),t];})).values());
      c.defenseInterruption = {at:ports.now(),source:id ? 'coordinator' : 'local-attacker',
        convoyId:c.id,epoch:c.epoch,commandId:c.commandId,navigationRevision:c.navigationRevision,
        phase:c.phase,targets:c.defenseTargets};
      if(c.freezeRoute)c.freezeRoute();
      if(c.detachRoute)c.detachRoute();
      c.defensePaused=true;c.phase='defending';c.routeReady=false;
      try {Promise.resolve(ports.stop(undefined,undefined,ports.convoyRequest(c))).catch(function(){});}catch{ /* The stop is best effort. */ }
      ports.showNavigation('Defending party; convoy will resume after combat');
      if(huntPrimary)host.game_log('Travel encounter: '+(huntPrimary.reason==='passive-setting'?'pursuing ':'defending against ')+c.defenseTargets.map(function(t: Record<string, any>){return t.mtype+' '+t.id;}).join(', '),'#F5B041');
      if(host.partyQueueClient && host.partyQueueClient.flush)host.partyQueueClient.flush();
      if(host.partyRoleRunner)host.partyRoleRunner.wake();
      return;
    }
    ports.showNavigation('Defending party; convoy will resume after combat');
    if(host.partyRoleRunner)host.partyRoleRunner.wake();
  }
  function groupedFollower() {
    const group = ports.groupedCombat();
    return ports.grouped() && (group && currentQueue(group) ? group.targetLeader : ports.leader()) !== ports.character().name;
  }
  function currentTravelAttackers(): Record<string, any>[] {
    return Object.values(host.parent.entities || {}).filter(function(e) {
      const travel = walk.groupWalk.travel;
      if(ports.huntOutbound() || travel && travel.continuousReturn===1)return e && e.type==='monster' && e.visible && !e.dead && e.hp>0 &&
        ports.partyList().indexOf(e.target)>=0 && !ports.fightDeaths().some(function(d){return ports.passingKey(d)===ports.passingKey(e);});
      return e && e.type === "monster" && ports.engaged(e);
    }).map(function(e) { return Object.assign({}, ports.entityReport(e), { target: e.target, server: ports.realm() }); });
  }
  function travelObservationAt() {
    return host.parent.socket && host.parent.socket.connected ? ports.now() + ports.clockOffset() : 0;
  }
  function travelCombatActive() {
    const control = host.__partyTravelCombat, intent = ports.intent();
    return !!localTravelCommand() || !!(control && !intent.cancelled && control.revision >= (intent.revision || 0));
  }
  function localTravelCommand() {
    const token = ports.farmTravel(), intent = ports.intent();
    return token && token.defensiveTravel && !token.cancelled && !intent.cancelled && token.revision === intent.revision
      ? { id: token.id, revision: token.revision } : null;
  }
  // The two convoy defence triggers `isOccupied` fired on each read, run on movement's tick with the
  // same facts: hunt travel with extra aggro, and a group walk outside an event with a monster
  // attacking a party member.
  function convoyDefenseTriggers() {
    if (ports.huntOutbound() && ports.huntExtraAggro()) interruptConvoyForDefense();
    if (walk.groupWalk.travel && !ports.joinedEvent() && !ports.eventTargetTypes().length && Object.values(host.parent.entities || {}).some(e =>
      e && e.type === 'monster' && e.visible && !e.dead && ports.attacking(e))) interruptConvoyForDefense();
  }
  return { acceptConvoyDefenseCommand, coldConvoyDefenseAllowed, interruptConvoyForDefense, groupedFollower,
    currentTravelAttackers, travelObservationAt, travelCombatActive, localTravelCommand, convoyDefenseTriggers };
}
type WalkDefense = ReturnType<typeof createWalkDefense>;

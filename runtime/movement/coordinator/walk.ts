// The one group walk machine: the walk's start and replacement, the event and return walks, the
// shared route's phases, the restart recovery, the continuous return, the terminal settlement,
// the completion receipts, the movement barrier and the geometry repair. Moved here whole from
// coordinator/navigation/convoy.ts, shared-walk.ts, shared-navigation.ts, restart-recovery.ts,
// continuous-return.ts, terminal-settlement.ts, completion-receipts.ts, movement-barrier.ts and
// geometry-repair.ts, and typed from scripts/convoy-navigation.cjs (the barrier phases).
// `walkTier` (from convoy.ts) and `createPartyConvoys>replaces` are movement's functions that
// ask the tasks owner's live task.
import type { ReturnLocation } from '../../events/api.ts';
import { eventIs } from '../../events/api.ts';
import { anniversaryHandedOff, releaseWalkRoutes } from '../../events/coordinator/api.ts';
import type { MerchantCommand } from '../../merchant-jobs/api.ts';
import type { ConvoyNavigationPlatform } from './route-store.ts';
import { requestObject } from '../../lifecycle/api.ts';
import { memberLost } from '../../lifecycle/coordinator/api.ts';
import { recordConvoyHistory, type ConvoyHistoryState } from './records.ts';
import { ownsHuntRoute, inheritedHuntRoute, engageHunt, engageFarming, propagateHuntTarget, writeSpot } from '../../hunting/coordinator/api.ts';
import type { HookRegistry, MemberHold, MemberHoldAsk, WalkNotice, WalkTakeover } from '../../hooks/registry.ts';
import { freshStatus, movingEventDestination, pursuedBoss, observeReturnTown, reconcileReturnArrival, returnWalking, stepHuntArrival } from './arrivals.ts';
import { classifyTravelDefense, createCommunicationRecovery, stepMerchantInterruption } from './defense.ts';
import { characterRuntime, clearSharedRoute, departureConfirmed, distance, point, READINESS_STALLED, readinessFailure, readinessStalled, readinessIssue,
  readRoutePoint, recoveryPlanner, reportMatches, routeIdentityOwned, routeOwner, sameWalk, sameWalkOn, sharedRoute,
  type RoutePoint, type RouteWaypoint, type SharedCommand, type SharedConvoy, type SharedReport, type SharedRoute, type SharedState, type SharedStatus,
  type WalkCommand, type WalkReport, walkCommandOf } from './route-store.ts';
import { cancelEnds, cruisePaced, reportSlowed, decide, defensePauses, GEOMETRY_REPAIR_DEADLINE_MS, eventMayTake, handsCombatOver, ownerOfTier, playerWalk, preemptible, walkDeparture, walkRequester, type AddonWalkFlags } from '../rules.ts';
import { isPoint, type Point } from '../geometry/contracts.ts';
import { type Tier } from '../../protocol/ranks.ts';
import { climbWalk, RENDEZVOUS_RANGE, walkCloseness, walkRound, walkWaited, walkWaitOver, type WalkClimb, type WalkPoint } from '../../protocol/ladder.ts';
import { ageOf, fresh, reportClockError } from '../../protocol/reports.ts';
import { contains, PATROL_WALK, RARE_WALK } from '../../hunting/api.ts';
import { appendCombatLog, boundFired } from '../../status/coordinator/api.ts';
import { merchantSlotCommand } from '../../merchant-jobs/coordinator/api.ts';

// The walk's requester is protocol's wire shape (runtime/protocol/walk.ts).
import type { WalkRequester } from '../../protocol/walk.ts';
export type { WalkRequester } from '../../protocol/walk.ts';

interface ConvoyStatus {
  hp?: number;
  rip?: boolean;
  convoyProtocol?: number;
  seenAt: number;
  map: string;
  x: number;
  y: number;
  server?: string;
  speed?: number;
  // The member's run speed from class, gear and stats, without conditions (walk-client.ts
  // `sampleTravelReport`), which the walk's pace reads (`walkPace`).
  baseSpeed?: number | null;
  mainTownSpawn?: { x: number; y: number };
  convoyNavigation?: { runtimeId?: string };
}
// `WalkClimb` holds the walk's own ladder (protocol/ladder.ts `climbWalk`, `walkRound`).
export interface PartyConvoy extends WalkClimb {
  // The ladder's safe-point rung assembles the members there walking only (protocol/ladder.ts `walkRound`).
  rallyWalking?: boolean;
  routeRecovery?: import('../../hunting/api.ts').RouteRecoveryCommand;
  communicationHold?: { resumeDefense?: boolean; since: number; reason: string; participants: string[]; legacy?: boolean };
  communicationLegacyRecovered?: boolean;
  returnTown?: import('./arrivals.ts').ReturnTownPolicy;
  townRetry?: boolean;
  townRetryAt?: number;
  returnTownRally?: { map: string; x: number; y: number };
  cause?: "farming-conflict";
  huntTarget?: string;
  force?: boolean;
  id: string;
  epoch: number;
  phase: string;
  location: ReturnLocation;
  rally: ReturnLocation;
  label: string;
  leader: string;
  participants: string[];
  slowestSpeed: number;
  paceCharacter: string | null;
  townFirst: boolean;
  completed: string[];
  navigationExempt: boolean;
  combatHandoffAllowed: boolean;
  // P3 `walk.flags`: the add-ons' merged answer, asked once when the walk forms.
  addonFlags?: AddonWalkFlags | null;
  purpose: string | null;
  // What each member's request names: the row and the tier of the task that started the
  // walk (00-overview "The rank table"); and that task's identity, so the same task asking
  // again replaces its own walk.
  requester: WalkRequester;
  task: string;
  // The task group that owns the walk (`party:<leader>` or `solo:<name>`). Each member's walk
  // identity names it.
  group?: string;
  departAt?: number | null;
  failure?: string;
  failureCode?: string;
  failedAt?: number;
  restartRecovery?: boolean;
  restartAttempts?: number;
  restartRevisions?: Record<string, number>;
  // Each member's life at the walk's admission (survival's `survival.life`): a later life
  // means the member died on the walk, and `letGo` lets it go with code `died`.
  lives?: Record<string, number>;
  expected?: Record<
    string,
    { commandId: number; revision: number; phase: string; runtimeId: string | null }
  >;
}
interface ConvoyState extends ConvoyHistoryState {
  leader: string | null;
  merchantCharacter: string | null;
  statuses: Record<string, ConvoyStatus | undefined>;
  followers: Record<string, boolean>;
  commands: Record<string, MerchantCommand | undefined>;
  escape?: { stage: string } | null;
  activeConvoy: PartyConvoy | null;
  navigationEpoch: number;
  location: ReturnLocation | null;
}
interface ConvoyPorts {
  // The coordinator's hook registry, which the group's walk tells and asks (`WalkListeners`).
  listeners: WalkListeners;
  now(): number;
  nextCommand(): number;
  activeNames(): string[];
  intent(name: string): { cancelled?: boolean; revision: number };
  resolve(input: ReturnLocation): ReturnLocation | null;
  persist(): void;
  // The walk group this service owns, read when a walk starts: its task group's id,
  // `party:<leader>` or `solo:<name>`, so a leader change names the new group.
  group?: () => string;
  // The group's live task, asked right before a walk starts, so every provider has asked the
  // owner first and the walk takes its task's tier.
  live?: () => { kind: string; tier: Tier; owner: string } | null;
}

function townFirst(leader: ConvoyStatus, location: ReturnLocation): boolean {
  const town = leader.mainTownSpawn || { x: 0, y: 0 };
  const leaderDistance =
    leader.map === location.map
      ? Math.hypot(Number(leader.x) - location.x, Number(leader.y) - location.y)
      : Infinity;
  const townDistance =
    location.map === "main" ? Math.hypot(town.x - location.x, town.y - location.y) : Infinity;
  return location.map === "main" && (leader.map !== "main" || leaderDistance > townDistance + 200);
}

function allowsEarlyCombat(purpose: string | null | undefined, cause?: string, addonHands?: boolean): boolean {
  return !cause && handsCombatOver(purpose, addonHands);
}

// The walk's pace: the slowest member's base speed, which leaves out Hard Shell, a stand, a slow
// and any cruise cap still in force, so a walk paced in such a window still cruises at the party's
// own speed. A member that reports none adds nothing.
export function walkPace(statuses: Readonly<Record<string, { baseSpeed?: number | null } | undefined>>, names: readonly string[], fallback: string | null) {
  const base = (name: string) => Number(statuses[name]?.baseSpeed) > 0 ? Number(statuses[name]!.baseSpeed) : Infinity;
  const character = [...names].sort((a, b) => base(a) - base(b))[0] || fallback;
  const speed = character ? base(character) : Infinity;
  return { slowestSpeed: Number.isFinite(speed) ? speed : 0, paceCharacter: character };
}

// The party walk start (`createPartyConvoys` `start`), the shape the tasks owner's task owner
// passes it on in.
export type WalkStart = ReturnType<typeof createPartyConvoys>['start'];
export function createPartyConvoys(state: ConvoyState, ports: ConvoyPorts) {
  listening.set(state, ports.listeners);
  function workflowPurpose(purpose: string | null | undefined): boolean {
    return ["shared-walk", "shared-walk-return", "franky-exit", "event-return"].includes(purpose || "");
  }
  function memberRole(name: string, explicitWorkflow: boolean, escape: boolean): boolean {
    if (explicitWorkflow) return true;
    return name !== state.merchantCharacter && (escape || name === state.leader || !!state.followers[name]);
  }
  function leaderFor(
    names: string[] | undefined,
    purpose: string | null | undefined,
  ): string | null | undefined {
    if (purpose === "escape-recovery") return (names || [])[0];
    if (purpose?.startsWith("shared-walk")) return names?.[0] || state.leader;
    if (purpose === "franky-exit")
      return (names || []).find(
        (name) => state.statuses[name] && state.statuses[name]?.map !== "main",
      );
    return state.leader;
  }

  function participants(
    leader: ConvoyStatus,
    names: string[] | undefined,
    escape: boolean,
    exit: boolean,
    workflow: boolean,
  ): string[] {
    const requested = Array.isArray(names) ? new Set(names) : null;
    return ports
      .activeNames()
      .filter(
        (name) =>
          memberRole(name, workflow && !!requested?.has(name), escape) &&
          (exit || !ports.intent(name).cancelled) &&
          state.statuses[name]?.server === leader.server &&
          (!requested || requested.has(name)),
      );
  }

  // `walks.end` names its own end code (runtime.ts `endWalk`); every other cancel ends `cancelled`.
  function cancel(reason = "cancelled by owner", code = "cancelled"): void {
    const convoy = state.activeConvoy;
    if (!convoy) return;
    recordConvoyHistory(state, convoy, "cancelled", ports.now(), { reason });
    for (const name of convoy.participants || []) {
      const command = state.commands[name];
      if (command?.type === "party-monster-travel" && command.convoyId === convoy.id)
        delete state.commands[name];
    }
    walkEnds(state, code);
  }
  // A member that leaves the walk's group leaves the walk, which goes on for the rest. The walk ends
  // when its leader leaves or no member remains. Answers whether the walk ended.
  function leave(member: string, reason: string, code: string): boolean {
    const convoy = state.activeConvoy;
    if (!convoy?.participants.includes(member)) return false;
    const rest = convoy.participants.filter(name => name !== member);
    if (!rest.length || convoy.leader === member) { cancel(reason, code); return true; }
    known(state, convoy);
    convoy.participants = rest;
    if (convoy.expected) delete convoy.expected[member];
    const last = told.get(state);
    if (last?.walk === convoy) last.participants = [...rest];
    if (state.commands[member]?.convoyId === convoy.id) delete state.commands[member];
    tell(state, 'walk.member', convoy, { member, change: 'left', code, by: ownerOfTier(convoy.requester?.tier) });
    return false;
  }

  function issue(convoy: PartyConvoy): void {
    for (const name of convoy.participants) {
      const id = ports.nextCommand(),
        revision = ports.intent(name).revision;
      merchantSlotCommand(state, 'convoy:' + convoy.id, {
        id,
        type: "party-monster-travel",
        phase: "assemble",
        deferRendezvous: true,
        navigationRevision: revision,
        convoyId: convoy.id,
        epoch: convoy.epoch,
        location: convoy.location,
        label: convoy.label,
        leader: convoy.leader,
        participants: convoy.participants,
        slowestSpeed: convoy.slowestSpeed,
        purpose: convoy.purpose,
        // Each member's request ranks the walk at its task's tier.
        requester: convoy.requester,
        group: convoy.group,
        navigationExempt: convoy.navigationExempt,
        combatHandoffAllowed: convoy.combatHandoffAllowed,
        cause: convoy.cause,
        paceCharacter: convoy.paceCharacter,
        rally: convoy.rally,
      }, name);
      (convoy.expected ||= {})[name] = {
        commandId: id,
        revision,
        phase: "assemble",
        runtimeId: state.statuses[name]?.convoyNavigation?.runtimeId || null,
      };
    }
  }

  function assemble(
    location: ReturnLocation,
    label: string | undefined,
    leaderName: string,
    names: string[],
    exit: boolean,
    purpose: string | null | undefined,
    tier: Tier,
    cause?: "farming-conflict",
    by?: string,
    addonHands?: boolean,
  ): void {
    const replacedConvoyId = state.activeConvoy?.id;
    cancel("replaced by a new convoy");
    const epoch = ++state.navigationEpoch,
      id = "convoy-" + ports.now() + "-" + ports.nextCommand();
    const speed = walkPace(state.statuses, names, state.leader),
      leader = state.statuses[leaderName]!;
    // P3 `walk.flags`: every add-on may answer for a core walk's departure, defence and combat
    // handoff. The escape's walk departs at once and is not asked.
    const flags = purpose === 'escape-recovery' ? {} : heard(state)?.movement.walkFlags({ group: ports.group?.() ?? 'party',
      walk: { purpose: purpose || null, phase: 'assemble', flags: { departure: walkDeparture({ purpose, navigationExempt: exit }),
        defencePauses: defensePauses({ purpose, navigationExempt: exit }), handsCombat: allowsEarlyCombat(purpose, cause, addonHands) } } }) ?? {};
    const { handsCombat, ...addonFlags } = flags;
    const convoy = formWalk(state, {
      cause,
      force: purpose === "party-force-travel",
      id,
      epoch,
      phase: "assemble",
      location,
      rally: { map: leader.map, x: Number(leader.x), y: Number(leader.y) },
      label: label || "selected monster",
      leader: leaderName,
      participants: names,
      ...speed,
      townFirst: purpose?.startsWith("shared-walk") ? false : townFirst(leader, location),
      completed: [],
      navigationExempt: exit,
      combatHandoffAllowed: !cause && (handsCombat ?? handsCombatOver(purpose, addonHands)),
      ...(Object.keys(addonFlags).length ? { addonFlags } : {}),
      purpose: purpose || null,
      requester: { kind: walkRequester(taskOf(purpose, tier, by), tier).kind, tier, ...(by ? { by } : {}) },
      task: taskOf(purpose, tier, by),
      group: ports.group?.() ?? "party",
    } as PartyConvoy);
    issue(convoy);
    recordConvoyHistory(state, convoy, "started", ports.now(), { replacedConvoyId, origin: convoy.rally });
    if (!exit && ![RARE_WALK, PATROL_WALK, "grouped-approach", "shared-walk"].includes(purpose || ""))
      writeSpot(state, { location });
    ports.persist();
  }

  // Every player walk shares the `manual` identity, and every walk of one app key that app's
  // identity, so a newer command replaces the older (00-overview "The rank table", manual row);
  // any other task is its purpose.
  function taskOf(purpose: string | null | undefined, tier: Tier, by?: string): string {
    if (tier === "manual") return "manual";
    if (tier === "app") return by || "app";
    return purpose || tier;
  }
  // Movement section 5.1 on the live task's walk: the active walk gives way when its task no longer
  // holds the group or the same task asks again, and two walks of one task at one rank let the
  // older finish. A failed walk no longer holds its members.
  function replaces(tier: Tier, task: string): boolean {
    const active = state.activeConvoy;
    // A walk saved before walks carried tiers ranks nothing, so it gives way.
    if (!active || active.phase === "failed" || !active.requester) return true;
    const held = walkRequester(active.task, active.requester.tier);
    const rule = decide(held, walkRequester(task, tier)).decision;
    return rule === "granted" || rule === "same-owner";
  }
  function start(
    input: ReturnLocation,
    label?: string,
    names?: string[],
    purpose?: string | null,
    cause?: "farming-conflict",
    named?: Tier,
    by?: string,
    addonHands?: boolean,
  ): boolean {
    if (state.escape && state.escape.stage !== "released" && purpose !== "escape-recovery")
      return false;
    const escape = purpose === "escape-recovery",
      exit = purpose === "franky-exit" || purpose === "shared-walk-return" || escape;
    const leaderName = leaderFor(names, purpose),
      leader = leaderName ? state.statuses[leaderName] : undefined;
    if (!leader || !fresh(leader.seenAt, ports.now(), 'presence')) return false;
    // The owner is asked once a leader can lead the walk, so a walk with no leader asks nothing.
    const tier = walkTier(purpose, named, ports.live?.());
    if (!tier || !replaces(tier, taskOf(purpose, tier, by))) return false;
    const location = resolveLocation(input, purpose);
    const workflow = workflowPurpose(purpose);
    const selected = participants(leader, names, escape, exit, workflow);
    if (!selected.includes(leaderName!)) return false;
    assemble(location, label, leaderName!, selected, exit, purpose, tier, cause, by, addonHands);
    return true;
  }
  function resolveLocation(input: ReturnLocation, purpose: string | null | undefined): ReturnLocation {
    // An add-on's walk goes to the point its add-on named, as a player's travel does.
    const direct = [PATROL_WALK, RARE_WALK, "grouped-approach", "party-travel", "party-force-travel", "shared-walk", "shared-walk-return"].includes(purpose || "") ||
      !!purpose?.startsWith("addon:");
    return { ...(direct ? {} : ports.resolve(input)), map: input.map, x: Number(input.x), y: Number(input.y) };
  }
  // R5 `walk.request`: while the group's live task is an add-on's (`addon:<name>`, the tasks owner's
  // `task.request`), that add-on names the task's walk on each walk step. A new point starts or
  // retargets it at the task's tier through `start`, the same point keeps it, and `end` ends the
  // add-on's own walk. Its `handsCombat` lets the walk hand combat over to farming on the way.
  // With nothing registered, or an answer of nothing, nothing changes.
  function addonWalk(): void {
    const live = ports.live?.();
    if (!live?.kind.startsWith("addon:")) return;
    const active = state.activeConvoy, own = active?.purpose === live.kind && active.phase !== "failed" ? active : null;
    const answer = ports.listeners.movement.walkRequest(live.kind.slice("addon:".length), { group: ports.group?.() ?? null, task: live,
      walk: own && { id: own.id, phase: own.phase, destination: own.location, members: [...own.participants] } });
    if (answer === "end") { if (own) cancel("ended by its add-on"); return; }
    const to = answer?.destination;
    if (!to || own && own.location.map === to.map && own.location.x === to.x && own.location.y === to.y) return;
    start(to, answer.label, answer.members, live.kind, undefined, live.tier, undefined, answer.handsCombat === true);
  }
  return { start, cancel, leave, addonWalk };
}

// Whether an event walk waits for a trip, the healer or a fight is the groups and tasks
// owner's wind-down, its `member.holder` answer.

interface WalkRequest {
  name: string; token: string; runtimeId: string; revision: number; at: number;
  activity: string; key: string; destination: RoutePoint; parentId: number;
  parent?: SharedState["commands"][string]; complete?: boolean; failed?: string; convoyId?: string;
  // The requester's life at the request's admission. A request or token from an earlier life is
  // `stale`.
  life?: number;
  // The life a revived member's event rejoin asks for (, the events owner's `rejoin`): its own life at the
  // ask, which the `independent` leg admits only while it is still survival's `survival.life`.
  reentry?: number;
  // An event search's walk to one search point (the events owner's `searchFor`): the planner's own "no route"
  // answer ends it, so the search goes on to its next point.
  search?: boolean;
}
interface WalkSession { requests: WalkRequest[]; convoy: SharedConvoy }
const sessions = new WeakMap<SharedConvoy, WalkSession>();
export function completeSharedWalkMember(convoy: unknown, name: string): SharedState["commands"][string] {
  const session = sessions.get(convoy as SharedConvoy), request = session?.requests.find(r => r.name === name);
  if (!request) return (convoy as SharedConvoy).walkingParents?.[name]?.command;
  request.complete = true;
  return request.parent;
}
interface WalkPorts {
  now(): number; members(): string[]; owned(name: string): unknown;
  enabled(name: string, event?: string): boolean;
  // T3 `walk:<activity>`; an event walk that would take over the live walk hands its event facts.
  allowed(activity: string, takeover?: WalkTakeover): boolean;
  start(destination: RoutePoint, label: string, names: string[], purpose: string, cause?: undefined, tier?: Tier): boolean;
  // The group's live task, asked right before a walk starts: a shared walk starts only
  // while the task it serves holds the group, at that task's tier.
  live(): { kind: string; tier: Tier; owner: string } | null;
  persist(): void;
  cancel(): void;
  // The group the walk serves, for its `member.holder` asks.
  group?(): string | null;
}
// The tasks each shared walk's activity serves. Party Town's walk to the landing keeps
// the Town row. No source asks for an attendance before an Anniversary round is live (the staging
// lead is never a live event, events/coordinator/source.ts `eventFirst`), so the staging walk also
// starts under the farming task, which v1.5.0's staging preempted; a Hunt keeps the group through
// the lead.
const WALK_TASKS: Record<string, readonly string[]> = {
  event: ["event-attendance"], "anniversary-staging": ["event-attendance", "farming"], "event-return": ["event-return"],
  "town-return": ["town"], "farm-recovery": ["farming"],
};
export interface WalkState extends SharedState {
  phoenixPatrolActive?: boolean;
  rareHuntState?: {encounter?: unknown} | null;
  anniversary?: Parameters<typeof anniversaryHandedOff>[0]['anniversary'];
  leader: string | null; merchantCharacter: string | null;
  eventReturn?: {
    event?: string;
    cycleId?: string;
    participants: string[];
    pending?: string[];
    waypoints?: Record<string, {revision: number}>;
    returnRoutes?: Record<string, { commandId?: number; revision: number }> | null;
  } | null;
  deferredEventReturns?: Record<string, {cycleId: string; navigationRevision?: number}>;
}
function parse(body: Record<string, unknown>, now: number): WalkRequest | null {
  const p = readRoutePoint(body.destination);
  if (!p) return null;
  if (!["event", "anniversary-staging", "town-return", "event-return", "farm-recovery"].includes(String(body.activity))) return null;
  if (typeof body.token !== "string" || body.token.length > 300 || typeof body.key !== "string" || body.key.length > 200) return null;
  return { name: String(body.character), token: body.token, runtimeId: String(body.runtimeId),
    revision: Number(body.navigationRevision), activity: String(body.activity), key: body.key, at: now,
    parentId: Number(body.parentCommandId) || 0, destination: p,
    reentry: Number.isFinite(body.reentry) ? Number(body.reentry) : undefined, search: body.search === true || undefined };
}
type Leg = Pick<WalkRequest, "activity" | "key" | "destination">;
export function sameWalkingLeg(a: Leg, b: Leg, bossMoves: (key: string) => boolean): boolean {
  if (a.activity !== b.activity || a.key !== b.key || a.destination.map !== b.destination.map ||
    String(a.destination.in ?? a.destination.map) !== String(b.destination.in ?? b.destination.map)) return false;
  // Each member freezes a moving event boss's position when it requests, so event walks
  // to the same boss and map coalesce at the leader's point. The pursuit reads the same
  // list (queue A26: one list, from game data).
  const movingBoss = a.activity === "event" && bossMoves(a.key);
  return movingBoss || distance(a.destination, b.destination) <= 1;
}
/** Coalesces independently entered workflow walking legs without duplicating their continuations. */
export function createSharedWalks(state: WalkState, ports: WalkPorts) {
  const requests = new Map<string, WalkRequest>();
  const sameWalk = (a: WalkRequest, b: WalkRequest) => sameWalkingLeg(a, b, pursuedBoss);
  function merchantWalk(r: WalkRequest): boolean {
    return r.name === state.merchantCharacter &&
      (["event", "event-return"].includes(r.activity) || recoveryContinuation(r));
  }
  function validIntent(r: WalkRequest): boolean {
    if (!ports.members().includes(r.name) && !merchantWalk(r)) return false;
    const intent = state.navigationIntents?.[r.name];
    if ((intent?.revision || 0) !== r.revision) return false;
    return !intent?.cancelled || ["town-return", "event-return"].includes(r.activity);
  }
  function authorized(r: WalkRequest): boolean {
    const s = state.statuses[r.name];
    if (!managedWalker(r) || !s || !fresh(s.seenAt, ports.now())) return false;
    if (!validIntent(r) || !ports.allowed(r.activity)) return false;
    if (!workflowCurrent(r)) return false;
    return r.activity !== "event" || ports.enabled(r.name, r.key);
  }
  function managedWalker(r: WalkRequest): boolean {
    return !!ports.owned(r.name) && (r.name !== state.merchantCharacter || merchantWalk(r));
  }
  function workflowCurrent(r: WalkRequest): boolean {
    if (!eventReturnAuthority(r)) return false;
    if (rareOwnsRecovery(r)) return false;
    const recoveryOwns = ["farm-recovery", "event", "anniversary-staging"].includes(r.activity) &&
      !!state.eventReturn?.participants.includes(r.name);
    return runtimeMatches(r) && !stagingHandedOff(r) && (!recoveryOwns || recoveryContinuation(r));
  }
  function rareOwnsRecovery(r: WalkRequest): boolean {
    return r.activity === 'farm-recovery' && !recoveryContinuation(r) &&
      !!(state.phoenixPatrolActive || state.rareHuntState?.encounter);
  }
  // Whether the anniversary round handed its staging member to combat is the events
  // owner's answer.
  function stagingHandedOff(r: WalkRequest): boolean {
    return r.activity === "anniversary-staging" && anniversaryHandedOff(state, r.name);
  }
  function recoveryContinuation(r: WalkRequest): boolean {
    const route = state.eventReturn?.returnRoutes?.[r.name];
    return r.activity === "farm-recovery" && r.parentId > 0 &&
      route?.commandId === r.parentId && route.revision === r.revision;
  }
  function runtimeMatches(r: WalkRequest): boolean {
    const runtime = characterRuntime(state.statuses[r.name]);
    return !runtime || runtime === r.runtimeId;
  }
  function eligible(r: WalkRequest): string[] {
    const server = state.statuses[r.name]?.server;
    const names = workflowMembers(r);
    return names.filter(name => {
      const s = state.statuses[name];
      if (!s || s.rip || !fresh(s.seenAt, ports.now()) || s.server !== server) return false;
      return r.activity !== "event" || ports.enabled(name, r.key) && (!s.joinedEvent || s.joinedEvent === r.key);
    });
  }
  function workflowMembers(r: WalkRequest): string[] {
    if (merchantWalk(r)) return [r.name];
    const names = ports.members(), recovery = state.eventReturn;
    // Town-ready members already supplied the native receipt and no longer
    // run an exit command. They cannot join this remaining walking rendezvous.
    if (r.activity === "event-return" && recovery?.cycleId === r.key && recovery.pending)
      return names.filter(name => recovery.pending!.includes(name));
    return names.filter(name => !alreadyFighting(r, name));
  }
  function alreadyFighting(r: WalkRequest, name: string): boolean {
    if (r.activity !== "event" || name === r.name) return false;
    const s = state.statuses[name];
    if (!s) return false;
    const boss = s.eventCombatSighting;
    if (!boss || !boss.id || s.joinedEvent !== r.key) return false;
    if (boss.mtype !== r.key && !(r.key === 'witchcipher' && boss.event === r.key && s.activeEvent === r.key)) return false;
    return freshAttendee(r, s) && freshBoss(boss, s) && bossAtDestination(r, s, boss);
  }
  function freshAttendee(r: WalkRequest, s: NonNullable<SharedState["statuses"][string]>): boolean {
    const now = ports.now(), server = state.statuses[r.name]?.server;
    return !!server && s.server === server && fresh(s.seenAt, now) && !s.rip;
  }
  // The attendee stamps its sighting on its own clock, so its measured clock difference bounds it.
  function freshBoss(boss: NonNullable<SharedState["statuses"][string]>["eventCombatSighting"], s: SharedStatus): boolean {
    if (!boss || boss.attackReachable !== true || !readRoutePoint(boss)) return false;
    return fresh(boss.observedAt, ports.now(), 'report', reportClockError(s));
  }
  function bossAtDestination(r: WalkRequest, s: NonNullable<SharedState["statuses"][string]>,
    boss: NonNullable<typeof s.eventCombatSighting>): boolean {
    return boss.map === s.map && boss.map === r.destination.map &&
      String(boss.in) === String(s.in ?? s.map) &&
      // Destination coordinates can remain the advertised spawn while this
      // actively fought boss moves. Do not recall its attending fighter merely
      // to assemble a respawned member's walking route.
      String(boss.in) === String(r.destination.in ?? r.destination.map);
  }
  // A request waits for its walk while it is as recent as a member counts online (`presence`,
  // appendix C nav/shared-walk.ts:186 P); `at` is the coordinator's own stamp. A request from an
  // earlier life never joins a walk: its member's revival asks again.
  function pending(r: WalkRequest): WalkRequest[] {
    return [...requests.values()].filter(other => !other.complete && !other.failed && !other.convoyId &&
      sameWalk(r, other) && authorized(other) && !earlierLife(other) && fresh(other.at, ports.now(), 'presence', 0, true));
  }
  function earlierLife(r: WalkRequest): boolean { return (r.life ?? 0) < lifeOf(state, r.name); }
  function anchor(r: WalkRequest, waiting: WalkRequest[], name: string): void {
    if (!name || waiting.some(other => other.name === name) || state.commands[name]) return;
    const leader = state.statuses[name];
    if (!leader || leader.moving || !atDestination(leader, r.destination)) return;
    waiting.push({ ...r, name, parentId: 0, token: "anchor:" + r.token, revision: state.navigationIntents?.[name]?.revision || 0 });
  }
  function captureParents(waiting: WalkRequest[]): boolean {
    for (const other of waiting) {
      const command = state.commands[other.name];
      // The selected event supersedes an unfinished farm combat handoff. That
      // continuation cannot finish while event attendance owns movement, and
      // retaining it as a parent would send the fighter back to the old farm.
      // Admission still requires fresh, matching runtime and navigation intent.
      const farmHandoff = other.activity === "event" && other.parentId === 0 &&
        command?.type === "event-resume-travel" && typeof command.convoyHandoff === "string" &&
        command.navigationRevision === other.revision;
      if (command && command.id !== other.parentId && !farmHandoff) return false;
      other.parent = farmHandoff ? undefined : command;
    }
    return true;
  }
  function failedEntry(c: SharedConvoy): boolean {
    return c.phase === "failed" && (c.retryExhausted || c.walkingActivity === "event") === true;
  }
  function canReplace(r: WalkRequest): boolean {
    const c = state.activeConvoy;
    if (!c) return true;
    // A failed event walk is a step of the walk's ladder, so the next request for the event
    // starts the next step; tryStart carries the climb.
    if (failedEntry(c)) return true;
    if (c.restartRecovery && c.walkingParents && !c.retryExhausted) return ports.allowed(r.activity);
    // An event walk replaces the live trip while the group's task answers T3
    // `walk:event` for the takeover, with the walk's event facts.
    return r.activity === "event" && !sessions.has(c) && eventMayTake(c) && ports.allowed(r.activity, { at: ports.now(), group: ports.group?.() ?? null, key: r.key });
  }
  function replaceActive(): void { if (state.activeConvoy) ports.cancel(); }
  function leaderForRequest(r: WalkRequest): string | undefined {
    const names = eligible(r);
    return state.leader && names.includes(state.leader) ? state.leader : names[0];
  }
  function restoreParents(waiting: WalkRequest[]): boolean {
    const c = state.activeConvoy;
    if (!c?.restartRecovery || !c.walkingParents) return true;
    if (waiting.some(r => c.walkingParents![r.name]?.revision !== r.revision || c.walkingParents![r.name]?.parentId !== r.parentId)) return false;
    if (waiting.some(r => state.commands[r.name] && state.commands[r.name]!.convoyId !== c.id)) return false;
    const parents = c.walkingParents;
    ports.cancel();
    for (const r of waiting) if (parents[r.name]?.command) merchantSlotCommand(state, 'convoy:' + c.id, parents[r.name]!.command!, r.name);
    return true;
  }
  function retainParents(c: SharedConvoy, waiting: WalkRequest[]): void {
    c.walkingParents = Object.fromEntries(waiting.map(r => [r.name, { revision: r.revision, parentId: r.parentId, command: r.parent }]));
  }
  function recentExitPeerStatus(status: SharedStatus | undefined, server: string | undefined, now: number): status is SharedStatus {
    if(!status || status.rip || status.hp===0)return false;
    return !!characterRuntime(status) && status.server===server &&
      !fresh(status.seenAt, now) && fresh(status.seenAt, now, 'presence', 0, true);
  }
  function retainedExitParent(command: SharedState['commands'][string], cycleId: string): boolean {
    return command?.type==='event-return-town' && command.cycleId===cycleId;
  }
  function savedExitRevision(recovery: NonNullable<WalkState['eventReturn']>, name: string): boolean {
    const saved=recovery.waypoints?.[name];
    return !!saved && saved.revision===(state.navigationIntents?.[name]?.revision||0);
  }
  function recentPendingExitPeer(r: WalkRequest): boolean {
    const recovery=state.eventReturn,now=ports.now();
    if(!recovery || r.activity!=='event-return' || recovery.cycleId!==r.key)return false;
    return workflowMembers(r).some(name=>{
      const status=state.statuses[name],command=state.commands[name];
      // Admission still needs a fresh real request. Reserve only the existing
      // request window for a known living peer whose same-cycle exit is current.
      return name!==r.name && recentExitPeerStatus(status,state.statuses[r.name]?.server,now) &&
        retainedExitParent(command,r.key) && savedExitRevision(recovery,name) &&
        !!ports.owned(name) && !atDestination(status,r.destination);
    });
  }
  // A member already at the destination need not be pulled away from it.
  function missingMember(r: WalkRequest, waiting: WalkRequest[], expected: string[]): boolean {
    return expected.some(name => !waiting.some(other => other.name === name) && distance(state.statuses[name]!, r.destination) > RENDEZVOUS_RANGE);
  }
  // The start waits for each eligible member that has not asked, as a member's event poll asks again
  // until the walk answers, and goes on without a member that a holder says is not coming, or that
  // the console knows is gone, its game connection offline or its reports stopped (`leaves`), even
  // while a holder says it is coming. No round of reports ends the wait. An event walk also waits while any
  // holder holds a member coming, whether or not it asked: the group's fight finishes first. Each ask
  // names the walk, so a holder answers nothing for the walk that goes where the member already is.
  function startingLeader(r: WalkRequest, waiting: WalkRequest[], leaderName: string): string | undefined {
    const group = ports.group?.() ?? null, now = ports.now(), ask = { activity: r.activity, key: r.key };
    const coming = eligible(r).filter(name => !leaves(state, group, name, now, undefined, ask));
    if (r.activity === "event" && windingDown(state, group, coming, now, ask)) return undefined;
    if (missingMember(r, waiting, coming)) return undefined;
    if (waiting.some(other => other.name === leaderName)) return leaderName;
    return coming.includes(leaderName) ? undefined : waiting[0].name;
  }
  function tryStart(r: WalkRequest): void {
    if(recentPendingExitPeer(r))return;
    const requested = leaderForRequest(r);
    if (!canReplace(r) || !requested) return;
    const waiting = pending(r);
    anchor(r, waiting, requested);
    const leaderName = startingLeader(r, waiting, requested);
    if (!leaderName) return;
    const names = [leaderName, ...waiting.map(other => other.name).filter(name => name !== leaderName)];
    const turnover = turnoverBudget(r);
    const returning = ["town-return", "event-return"].includes(r.activity), purpose = returning ? "shared-walk-return" : "shared-walk";
    // The walk's task must hold the group: a task that waits (an attendance under an escape) has
    // no walk until it is live (rule 6).
    const live = ports.live();
    if (!live || !WALK_TASKS[r.activity]?.includes(live.kind)) return;
    const tier = live.tier;
    if (!restoreParents(waiting)) return;
    replaceActive();
    if (!captureParents(waiting)) return;
    const destination = waiting.find(other => other.name === leaderName)!.destination;
    if (!ports.start(destination, r.activity + " walking leg", names, purpose, undefined, tier)) return;
    attach(waiting, returning);
    restoreTurnoverBudget(turnover);
  }
  function eventReturnAuthority(r: WalkRequest): boolean {
    if (r.activity !== 'event-return') return true;
    const current = state.eventReturn;
    if (current?.cycleId === r.key && current.participants.includes(r.name) &&
        (!current.pending || current.pending.includes(r.name))) return true;
    const deferred = state.deferredEventReturns?.[r.name];
    return deferred?.cycleId === r.key && deferred.navigationRevision === r.revision;
  }
  function turnoverBudget(r: WalkRequest): SharedConvoy | null {
    const c = state.activeConvoy;
    return c && (failedEntry(c) || runtimeTurnoverReady(c, r)) ? c : null;
  }
  function restoreTurnoverBudget(previous: SharedConvoy | null): void {
    const c = state.activeConvoy;
    if (!previous || !c) return;
    // The new walk keeps the failed route's walking failures and continues its ladder where it
    // stood, so new runtime ownership starts no fresh count.
    c.walkingFailures = previous.walkingFailures;
    if (previous.ladder) c.ladder = previous.ladder;
    ports.persist();
  }
  function attach(waiting: WalkRequest[], returning: boolean): void {
    const convoy = state.activeConvoy as SharedConvoy | null;
    if (!convoy) return;
    convoy.walkingActivity = waiting[0]?.activity;
    if (convoy.walkingActivity === "event") convoy.walkingEvent = waiting[0]?.key;
    // Staging shares the moving-defense return policy with Hunt turn-in.
    convoy.navigationExempt = returning;
    if (convoy.walkingActivity === "anniversary-staging" || halloweenExit(convoy, waiting)) convoy.continuousReturn = 1;
    convoy.combatHandoffAllowed = false;
    // Admission records the walk's server and each member's runtime, so a setup that fails
    // before begin() prepares a route holds and recovers with real identities
    // (shared-walk.ts:317-318). begin() records them again from the route's own reports.
    convoy.routeServer = state.statuses[convoy.leader ?? '']?.server;
    convoy.runtimes = Object.fromEntries(waiting.map(r => [r.name, characterRuntime(state.statuses[r.name]) || r.runtimeId]));
    for (const name of convoy.participants) state.commands[name]!.navigationExempt = convoy.navigationExempt;
    waiting.forEach(other => { other.convoyId = convoy.id; });
    retainParents(convoy, waiting);
    sessions.set(convoy, { requests: waiting, convoy });
    ports.persist();
  }
  function halloweenExit(convoy: SharedConvoy, waiting: WalkRequest[]): boolean {
    const recovery = state.eventReturn;
    return convoy.walkingActivity === "event-return" && !!recovery &&
      eventIs(recovery.event, 'assisted') &&
      waiting.some(r => r.key === recovery.cycleId);
  }
  function existing(r: WalkRequest): Record<string, unknown> | null {
    const prior = requests.get(r.name);
    if (!prior || prior.token !== r.token) return null;
    if (!sameWalk(prior, r) || prior.parentId !== r.parentId) return { error: "walking request changed" };
    if (prior.revision !== r.revision || prior.runtimeId !== r.runtimeId) return { error: "walking owner changed" };
    // The request table refuses a token from an earlier life: the request goes, and the revived member's
    // next request starts a leg of its own.
    if (earlierLife(prior)) { requests.delete(r.name); return { error: "stale" }; }
    return progress(prior);
  }
  function progress(prior: WalkRequest): Record<string, unknown> {
    if (prior.failed) return { ok: true, phase: "failed", reason: prior.failed };
    if (prior.complete) return { ok: true, phase: "complete" };
    const c = state.activeConvoy, session = c && sessions.get(c);
    prior.at = ports.now();
    if (session?.requests.includes(prior)) return { ok: true, phase: walkingPhase(c!), reason: c!.failure, convoyId: c!.id };
    if (prior.convoyId) return { error: "walking leg superseded" };
    if (parentSuperseded(prior)) return { error: "walking leg superseded" };
    tryStart(prior);
    return { ok: true, phase: "waiting" };
  }
  function parentSuperseded(prior: WalkRequest): boolean {
    return !!prior.parent && state.commands[prior.name]?.id !== prior.parent.id;
  }
  function cancel(r: WalkRequest): Record<string, unknown> {
    const prior = requests.get(r.name), c = state.activeConvoy, session = c && sessions.get(c);
    // A waiting request no walk admitted yet goes, so pending() gathers it into no later walk
    // (shared-walk.ts:364-367).
    if (prior?.token === r.token && !prior.convoyId) { requests.delete(r.name); return { ok: true, phase: "failed" }; }
    if (prior?.token === r.token && session?.requests.includes(prior)) {
      if (c!.geometryRepair?.phase === 'waiting') return {ok:true,phase:"waiting"};
      session.requests.forEach(entry => { entry.failed = "Walking workflow cancelled"; });
      if (c!.phase !== "failed") ports.cancel();
      ports.persist();
    }
    return { ok: true, phase: "failed" };
  }
  function runtimeTurnoverReady(c: SharedConvoy, r: WalkRequest): boolean {
    if (!turnoverFailure(c, r)) return false;
    const parent = c.walkingParents?.[r.name];
    if (!parent || parent.parentId !== r.parentId || parent.revision !== r.revision) return false;
    return c.participants.every(name => freshTurnoverParticipant(c, name, r.key)) &&
      c.participants.some(name => characterRuntime(state.statuses[name]) !== c.runtimes?.[name]);
  }
  function retireSupersededEventEntry(r: WalkRequest): void {
    const c = state.activeConvoy, s = state.statuses[r.name];
    if (!c || !s || !supersedableEventEntry(c) || !supersedingEventRequest(c, r, s)) return;
    if (!c.participants.every(name => freshSupersededParticipant(c, name))) return;
    // A different native event supersedes this exact failed entry. Same-event
    // recovery still retains its original retry budget and terminal guards.
    cancelObsoleteWalk(c);
  }
  function supersedableEventEntry(c: SharedConvoy): boolean {
    return [c.phase === 'failed', c.walkingActivity === 'event', failureTakenOver(c), !!c.restartRecovery, !c.retryExhausted,
      c.geometryRepair?.phase !== 'failed', !!c.routeServer].every(Boolean);
  }
  function supersedingEventRequest(c: SharedConvoy, r: WalkRequest, s: SharedStatus): boolean {
    if (![r.activity === 'event', !!c.walkingEvent, c.walkingEvent !== r.key, c.participants.includes(r.name)].every(Boolean)) return false;
    const parent = c.walkingParents?.[r.name];
    if (!parent || parent.revision !== r.revision || parent.parentId !== r.parentId) return false;
    return s.joinedEvent === r.key && s.server === c.routeServer && ports.enabled(r.name, r.key);
  }
  function freshSupersededParticipant(c: SharedConvoy, name: string): boolean {
    const report = state.statuses[name];
    if (!report || !revivedReport(report, Number(c.failedAt) || 0)) return false;
    return report.server === c.routeServer && !!characterRuntime(report) &&
      participantOwned(c, name) && turnoverCommand(c, name);
  }
  function turnoverFailure(c: SharedConvoy, r: WalkRequest): boolean {
    if (!preDeathEventFailure(c, r) || !failureTakenOver(c)) return false;
    return !!c.restartRecovery && c.geometryRepair?.phase !== 'failed' && !!c.routeServer;
  }
  function freshTurnoverParticipant(c: SharedConvoy, name: string, event: string): boolean {
    const s = state.statuses[name];
    if (!s || !participantOwned(c, name) || !revivedReport(s, Number(c.failedAt) || 0)) return false;
    return turnoverEvent(c, s, name, event) && turnoverCommand(c, name);
  }
  function turnoverEvent(c: SharedConvoy, s: SharedStatus, name: string, event: string): boolean {
    if (s.server !== c.routeServer || s.joinedEvent !== event || !ports.enabled(name, event)) return false;
    const runtime = characterRuntime(s);
    return !!runtime && !!c.runtimes?.[name];
  }
  function turnoverCommand(c: SharedConvoy, name: string): boolean {
    const command = state.commands[name];
    return !command || command.phase === 'event-walk-release' && command.convoyId === c.id;
  }
  function retirePreDeathWalk(r: WalkRequest): void {
    const c = state.activeConvoy, s = state.statuses[r.name];
    if (!c || !s || !preDeathEventFailure(c, r)) return;
    if (!eventReentryOwner(c, r, s) || !deathInvalidatedPreparation(c, r, s)) return;
    if (!c.participants.every(name => participantOwned(c, name))) return;
    cancelObsoleteWalk(c);
  }
  function preDeathEventFailure(c: SharedConvoy, r: WalkRequest): boolean {
    return r.activity === 'event' && c.phase === 'failed' && c.walkingActivity === 'event' &&
      !c.retryExhausted && c.participants.includes(r.name) && walkingEventMatches(c, r);
  }
  function walkingEventMatches(c: SharedConvoy, r: WalkRequest): boolean {
    return c.walkingEvent === r.key || !!sessions.get(c)?.requests.some(entry => entry.name === r.name && entry.key === r.key);
  }
  function eventReentryOwner(c: SharedConvoy, r: WalkRequest, s: SharedStatus): boolean {
    const parent = c.walkingParents?.[r.name];
    if (!parent) return false;
    return parent.revision === r.revision && parent.parentId === r.parentId &&
      c.runtimes?.[r.name] === r.runtimeId && characterRuntime(s) === r.runtimeId && s.server === c.routeServer;
  }
  // The member died after the walk admitted it when its life (survival's `survival.life`) is later
  // than the life the walk recorded; the death's event trip still comes from its report.
  function deathInvalidatedPreparation(c: SharedConvoy, r: WalkRequest, s: SharedStatus): boolean {
    const death = s.lastDeath, admitted = c.lives?.[r.name], life = lifeOf(state, r.name);
    if (!death || admitted === undefined || life <= admitted) return false;
    return revivedReport(s, life) && deathBindsEvent(death, r, s);
  }
  function revivedReport(s: SharedStatus, deathAt: number): boolean {
    return !s.rip && Number(s.hp) > 0 && s.seenAt > deathAt && fresh(s.seenAt, ports.now());
  }
  function deathBindsEvent(death: NonNullable<SharedStatus['lastDeath']>, r: WalkRequest, s: SharedStatus): boolean {
    return death.eventTrip?.event === r.key && s.joinedEvent === r.key && ports.enabled(r.name, r.key);
  }
  function participantOwned(c: SharedConvoy, name: string): boolean {
    const owner = c.walkingParents?.[name], command = state.commands[name];
    if (!owner || owner.revision !== (state.navigationIntents?.[name]?.revision || 0)) return false;
    return !command || command.convoyId === c.id && command.navigationRevision === owner.revision;
  }
  function cancelObsoleteWalk(c: SharedConvoy): void {
    // Only the pre-death owner's release commands and in-memory session retire.
    for (const name of c.participants) {
      const command = state.commands[name];
      if (command?.convoyId === c.id && command.phase === 'event-walk-release') delete state.commands[name];
    }
    for (const [name, request] of requests) if (request.convoyId === c.id) requests.delete(name);
    sessions.delete(c);
    ports.cancel();
    ports.persist();
  }
  function retainedReturn(r:WalkRequest):Record<string,unknown> | null {
    const c=state.activeConvoy;
    if(!c?.continuousReturn || c.walkingActivity!==r.activity || c.walkingParents?.[r.name]?.revision!==r.revision)return null;
    return {ok:true,phase:'travelling',convoyId:c.id,reason:c.failure};
  }
  // (4) (shared-walk.ts:491-509): a revived member's rejoin for the event the party's walk travels
  // to without it runs as a leg of its own, phase `independent`. The travelling walk keeps its phase
  // and members, and the member's waiting request goes. The rejoin names this life, the death was on
  // this event's trip and the member reports alive since it.
  function independentEventReentry(r: WalkRequest): Record<string, unknown> | null {
    const c = state.activeConvoy, s = state.statuses[r.name], life = lifeOf(state, r.name);
    if (r.activity !== 'event' || r.parentId !== 0 || r.reentry === undefined || r.reentry !== life) return null;
    if (!s?.lastDeath || !revivedReport(s, life) || !deathBindsEvent(s.lastDeath, r, s)) return null;
    if (!c || !travellingEventPeer(c, r, s) || state.commands[r.name] || !sameWalk(r, { ...r, destination: c.location })) return null;
    forgetPendingReentry(r);
    return { ok: true, phase: 'independent', destination: r.destination };
  }
  function travellingEventPeer(c: SharedConvoy, r: WalkRequest, s: SharedStatus): boolean {
    return c.purpose === 'shared-walk' && c.walkingActivity === 'event' && c.walkingEvent === r.key && c.phase === 'travel' &&
      preemptible(c) && !c.participants.includes(r.name) && c.routeServer === s.server;
  }
  function forgetPendingReentry(r: WalkRequest): void {
    const waiting = requests.get(r.name);
    if (waiting?.token === r.token && !waiting.convoyId) requests.delete(r.name);
  }
  function submit(body: Record<string, unknown>): Record<string, unknown> {
    const r = parse(body, ports.now());
    if (!r || !authorized(r)) return { error: "unauthorized walking leg" };
    if (body.cancel === true) return cancel(r);
    retirePreDeathWalk(r);
    retireSupersededEventEntry(r);
    const retained = retainedReturn(r);
    if(retained)return retained;
    const reentry = independentEventReentry(r);
    if (reentry) return reentry;
    const previous = existing(r);
    if (previous) return previous;
    r.life = lifeOf(state, r.name);
    requests.set(r.name, r);
    tryStart(r);
    return { ok: true, phase: "waiting" };
  }
  return { submit };
}
function reaimDeclined(state: SharedState, c: SharedConvoy): boolean {
  return members(c).some(name => {
    const declined = reportMatches(state, name) ? state.statuses[name]!.convoyNavigation?.reaimDeclined : null;
    return !!declined && declined.map === c.location.map && declined.x === c.location.x && declined.y === c.location.y;
  });
}
function atDestination(point: RoutePoint, destination: RoutePoint): boolean {
  return point.map === destination.map && Math.hypot(point.x-destination.x,point.y-destination.y)<=100;
}

function walkingPhase(c:SharedConvoy):string {
  if(c.continuousReturn)return 'travelling';
  return c.phase==='failed'?'failed':'travelling';
}

function assemblyRuntime(state: SharedState, c: SharedConvoy, name: string): string | undefined {
  return c.phase === 'assemble' ? state.statuses[name]?.combatSelection?.runtimeId : undefined;
}

// The walk's command for every phase, the barrier phases (assemble and Town) included: one walk
// machine, so a member answers each phase's command with the same identity, route version,
// communication hold and defense.
export function sharedCommand(state: SharedState, c: SharedConvoy, phase: string, name: string): SharedCommand {
  const command: SharedCommand = { id: state.nextCommandId++, type: "party-monster-travel", phase,
    routeRecovery:c.routeRecovery, reason:c.phase === "observing" ? c.defenseReason || undefined : c.failure, failureCode:c.failureCode, failureContext:c.failureDetails,
    convoyId: c.id, epoch: c.epoch, navigationRevision: state.navigationIntents?.[name]?.revision || 0,
    routeVersion: c.routeVersion || 0, nativeFallback: c.nativeFallback, avoidLeave: c.avoidLeave, location: c.location, rally: c.rally,
    leader: c.leader, participants: c.participants, slowestSpeed: c.slowestSpeed, purpose: c.purpose, requester: c.requester, group: c.group,
    returnRouting: !!c.returnRouting, label: c.label, townFirst: !!c.townFirst,
    // An unset handoff allows it, as `engageWalk` reads it.
    navigationExempt: c.navigationExempt, combatHandoffAllowed: c.combatHandoffAllowed !== false, cause: c.cause, huntTarget: c.huntTarget,
    continuousReturn: c.continuousReturn, disableTown: c.disableTown, returnWalking: returnWalking(c), rallyWalking: c.rallyWalking,
    nonPreemptible: !!c.nonPreemptible, force: c.force, ...(c.addonFlags ? { addonFlags: c.addonFlags } : {}) };
  (c.expected ||= {})[name] = { commandId: command.id, revision: command.navigationRevision,
    phase, runtimeId: characterRuntime(state.statuses[name]) || null };
  return command;
}
function issue(state: SharedState, c: SharedConvoy, phase: string): void {
  for (const name of c.participants) {
    if (!c.completed.includes(name)) merchantSlotCommand(state, 'convoy:' + c.id, sharedCommand(state, c, phase, name), name);
  }
}
function members(c: SharedConvoy): string[] { return c.participants.filter(n => !c.completed.includes(n)); }

// The walk machine's transitions. Every change the machine makes to a group's walk goes through
// `formWalk`, `walkPhase`, `completeMembers` or `walkEnds`, and each fires its notice there, so
// a walk that forms and ends within one 250 ms step is told.
interface ToldWalk { id: string; phase: string; participants: string[]; completed?: string[]; group?: string;
  requester?: { tier?: string } | null; purpose?: string | null; location?: unknown; failure?: string | null; failureCode?: string | null;
  lives?: Record<string, number> }
interface WalkHolder { activeConvoy?: ToldWalk | null }
// The realm hook registry's parts a walk tells and asks: its notices, the member holders, an add-on
// walk's answers and the survival owner's member lives.
export interface WalkListeners { notify(hook: WalkNotice | 'ladder.climbed', payload: Record<string, unknown>): unknown; walks: { holders(ask: MemberHoldAsk): MemberHold[] };
  movement: Pick<HookRegistry['movement'], 'walkRequest' | 'holdsDeparture' | 'safeGoal' | 'walkFlags'>; survival: Pick<HookRegistry['survival'], 'life'>;
  retry?: Pick<HookRegistry['retry'], 'policy'> }
// Each walk state's listeners: `createPartyConvoys` records its coordinator's for the group state it
// walks, so two coordinators in one process keep their own, and a dropped coordinator's go with its
// states.
const listening = new WeakMap<object, WalkListeners>();
const heard = (state: object): WalkListeners | undefined => listening.get(state);
// The group's live walk as last told, per walk state; `over` holds the walks whose end is told.
const told = new WeakMap<WalkHolder, { walk: ToldWalk; participants: string[] }>();
const over = new WeakSet<ToldWalk>();
// A member's life is survival's `survival.life`, the time of its last death; movement keeps no death
// count of its own.
function lifeOf(state: object, name: string): number { return heard(state)?.survival.life(name) ?? 0; }
// Each notice names `by` (contract part 2, D:7826): the requester's owner identity, or
// `rule:<row>` where movement's table decided.
function tell(state: object, hook: WalkNotice, c: ToldWalk, fields: Record<string, unknown> & { by: string }): void {
  heard(state)?.notify(hook, { group: c.group ?? null, walk: c.id, ...fields });
}
function tellEnd(state: WalkHolder, c: ToldWalk, code: string, by: string): void {
  if (over.has(c)) return;
  over.add(c);
  if (told.get(state)?.walk === c) told.delete(state);
  tell(state, 'walk.ended', c, { code, reason: c.failure || null, by });
}
// A walk this coordinator has not told of, such as one restored after a restart, is told formed
// at its first transition.
// The walk records each member's life at that admission.
function known(state: WalkHolder, c: ToldWalk): void {
  if (told.get(state)?.walk === c || over.has(c)) return;
  told.set(state, { walk: c, participants: [...c.participants] });
  c.lives ??= Object.fromEntries(c.participants.map(name => [name, lifeOf(state, name)]));
  tell(state, 'walk.formed', c, { members: [...c.participants], tier: c.requester?.tier ?? null,
    purpose: c.purpose ?? null, destination: c.location ?? null, by: ownerOfTier(c.requester?.tier) });
}
// A walk's tier is its task's: the group's live task names it, because only the live task's provider
// walks. A player's walks share the `manual` row (00-overview "The rank table"; the purpose table's
// `manual` column, rules.ts `playerWalk`), and the grouped approach is combat's walk at the approach
// row (movement section 2.1), not a task's. A caller that restores a saved walk names that walk's own
// tier.
export function walkTier(purpose: string | null | undefined, named: Tier | undefined, live: { tier: Tier } | null | undefined): Tier | null {
  if (named) return named;
  if (playerWalk(purpose)) return "manual";
  if (purpose === "grouped-approach") return "approach";
  return live?.tier ?? null;
}
export function formWalk<W extends ToldWalk>(state: { activeConvoy?: W | null }, c: W): W {
  state.activeConvoy = c;
  known(state, c);
  return c;
}
// The walk phase table decides each phase. The failed phase ends the walk with the failure table code, so the caller names the
// code first.
export function walkPhase(state: WalkHolder, c: ToldWalk, phase: string): void {
  known(state, c);
  if (c.phase === phase) return;
  const from = c.phase;
  c.phase = phase;
  tell(state, 'walk.phase', c, { phase, from, by: 'rule:T4' });
  if (phase === 'failed') tellEnd(state, c, c.failureCode || 'failed', 'rule:T5');
}
export function completeMembers(state: WalkHolder, c: ToldWalk, names: readonly string[]): void {
  known(state, c);
  const completed = c.completed ||= [];
  for (const member of names) if (!completed.includes(member)) {
    completed.push(member);
    tell(state, 'walk.member', c, { member, change: 'completed', by: 'rule:T4' });
  }
}
// The walk lets its members go: `arrived`, `released` (a combat handoff), `replaced`, `cancelled`
// or a `walks.end` code. T4's arrival rows decide `arrived` and `released`; any other end is its
// requester's unless the caller names who decided it.
export function walkEnds(state: WalkHolder, code: string, by?: string): void {
  const c = state.activeConvoy;
  if (!c) return;
  known(state, c);
  state.activeConvoy = null;
  tellEnd(state, c, code, by ?? (code === 'arrived' || code === 'released' ? 'rule:T4' : ownerOfTier(c.requester?.tier)));
}
// Each step of the walk asks `member.holder` for each member. A member that any holder says is not
// coming leaves the walk, which goes on without it, and the walk's command goes with it; the first
// member left leads a walk whose leader left. So does a member whose reports stopped (the failure table
// `runtime-lost`). A member its holders say is coming is waited on, as is a member whose report has
// not yet acknowledged the walk's command: the heartbeat reply carries that command to each report
// until one does. A member whose life is later than the life the walk admitted died on the walk and
// leaves it with code `died`; its revival's request runs as a leg of its own.
// Each step asks the holders with the walk's own activity and key, as its start did
// (`startingLeader`), so a holder answers nothing for the walk that goes where the member already
// is: the events owner's attendance lets a member go from another activity's walk, never from its own event's.
function walkAsk(c: SharedConvoy): Omit<MemberHoldAsk, 'group' | 'member' | 'at'> | undefined {
  // A trip the player or an app started asks as `manual`, which no attendance holds.
  if (c.requester?.tier === 'manual' || c.requester?.tier === 'app') return { activity: 'manual' };
  if (!c.walkingActivity) return undefined;
  const key = c.walkingActivity === 'event' ? c.walkingEvent : sessions.get(c)?.requests[0]?.key;
  return { activity: c.walkingActivity, ...key ? { key } : {} };
}
function letGo(state: SharedState, c: SharedConvoy, now: number): boolean {
  const ask = walkAsk(c);
  const leaving = members(c).flatMap((member): { member: string; by: string; code?: string; lost?: boolean }[] => {
    if (died(state, c, member)) return [{ member, by: 'rule:T1', code: 'died' }];
    const left = leaves(state, c.group ?? null, member, now, c, ask);
    return left ? [{ member, by: left.by, lost: left.lost, ...left.silent ? { code: 'silent' } : {} }] : [];
  });
  if (!leaving.length) return false;
  // Every member silent at once is the console's silence more than the members' (the user's decision
  // of 2026-11-17): the walk holds, its communication hold stops it, until 13 judges the members lost
  // on its stale bound, and then lets them go to recovery. One silent member among live ones leaves.
  const all = members(c);
  if (leaving.length === all.length && leaving.every(entry => entry.lost) &&
      !all.every(name => memberLost(state.statuses[name], now))) return false;
  known(state, c);
  const gone = leaving.map(entry => entry.member);
  c.participants = c.participants.filter(name => !gone.includes(name));
  const last = told.get(state);
  if (last?.walk === c) last.participants = [...c.participants];
  for (const { member, by, code, lost } of leaving) {
    if (state.commands[member]?.convoyId === c.id) delete state.commands[member];
    // A follower whose reports stopped on the player's walk catches up once its runtime is back: it
    // follows its leader, as a member that joins the group does (tasks/coordinator/groups.ts
    // joinFarmingMembership). The heartbeat reply carries the command to its first report.
    if (lost && member !== c.leader && playerWalk(c.purpose) && !state.commands[member])
      state.commands[member] = { id: state.nextCommandId++, type: 'return-leader', purpose: 'farming-follow' };
    // A silent member is a kept bound against game or network silence: it tells the status owner's bound record
    // once as it leaves, and `takeBack` admits it again on its next report.
    if (code === 'silent') {
      (c.silentLeft ??= []).push(member);
      boundFired({ bound: 'walkMemberSilence', owner: '02', subject: member, state: { walk: c.id, phase: c.phase, seenAt: state.statuses[member]?.seenAt ?? null } });
    }
    tell(state, 'walk.member', c, { member, change: 'left', ...code ? { code } : {}, by });
  }
  if (!c.participants.length) walkEnds(state, 'cancelled', leaving[0]!.by);
  else if (gone.includes(c.leader)) c.leader = c.participants[0]!;
  return true;
}
function died(state: SharedState, c: SharedConvoy, member: string): boolean {
  const admitted = c.lives?.[member];
  return admitted !== undefined && lifeOf(state, member) > admitted;
}
// Who lets a member go. The holders answer first: the first `member.holder` answer that says it is
// not coming lets it go; a walk's start hands the holders its activity and key. In a walk's walking
// assembly, the failure table lets go a member whose fresh report names no runtime or another server than the
// leader's (`strayed`). The failure table `runtime-lost` (the movement owner) then lets go a member the console
// already knows is gone (`silent`), even one a holder says is coming, as 13 says for a member whose
// CODE reload runs (the user's decision of 2026-11-17, decisions.md), so neither the walk nor its
// start waits on it. A holder's "coming" keeps any other member.
// `lost` marks a member let go because its reports stopped, by the lifecycle owner's `runtime-lost` hold or `silent`,
// and either is the silent let-go that `takeBack` reverses on the member's next online report.
function leaves(state: SharedState, group: string | null, member: string, at: number, c?: SharedConvoy,
  event?: Omit<MemberHoldAsk, 'group' | 'member' | 'at'>): { by: string; lost: boolean; silent?: true } | undefined {
  const holds = heard(state)?.walks.holders({ group, member, at, ...event }) ?? [];
  const gone = holds.find(hold => !hold.coming), s = state.statuses[member];
  if (gone) return { by: gone.owner, lost: gone.reason === 'runtime-lost', ...gone.reason === 'runtime-lost' ? { silent: true as const } : {} };
  if (s && c && strayed(state, c, s)) return { by: 'rule:T5', lost: false };
  if (s && silent(s, at)) return { by: 'rule:T5', lost: true, silent: true };
  return undefined;
}
// A member the console knows is gone: its report says the game socket is offline, or its reports
// stopped by A20's walk reading with no attacker test and its own report interval.
function silent(s: SharedStatus, at: number): boolean {
  return s.eventFeedConnected === false || !fresh(s.seenAt, at, { reading: 'walk', attackerKnown: false, intervalMs: s.reportIntervalMs });
}
// A holder holds one of `names` coming for an event walk (the tasks owner's live trip or fight, a
// player's manual control, an event, the console's hold), so the walk does not start yet.
function windingDown(state: SharedState, group: string | null, names: readonly string[], at: number, event: Omit<MemberHoldAsk, 'group' | 'member' | 'at'>): boolean {
  return names.some(member => (heard(state)?.walks.holders({ group, member, at, ...event }) ?? []).some(hold => hold.coming));
}
// ("getting stuck on waiting for a response isnt a good answer") and R4's "a walk never waits on
// silence": no answer ever comes for a member that reports with no runtime or from another server,
// so the walk goes on without it and the member catches up through its task. A walk a Hunt route
// owns ends on the same rule, since the Hunt walk has no runtime wait of its own.
function strayed(state: SharedState, c: SharedConvoy, s: SharedStatus): boolean {
  return walkingAssembly(c) && (!characterRuntime(s) || s.server !== state.statuses[c.leader]?.server);
}
function unpreparedHuntReturn(c: SharedConvoy): boolean {
  return c.purpose === "monster-hunt" && !!c.returnRouting && !c.routeServer && !c.routeVersion;
}
function disableFailedTown(c: SharedConvoy, reason: string): void {
  // Interrupted casts use the map-local round counter, never a text match.
  if (!c.continuousReturn && /town/i.test(reason)) c.disableTown = true;
}
function reassembleReturn(state: SharedState, c: SharedConvoy): void {
  walkPhase(state, c, "assemble"); c.departAt = null; c.observedPhase = null;
  c.townFirst = false; c.completed = [];
  c.rally = c.returnTownRally || point(state.statuses[c.leader]!);
  c.failure = undefined; c.failureCode = undefined;
  delete c.sharedStartedAt; delete c.sharedPreparationStartedAt;
  clearSharedRoute(c);
  issue(state, c, "assemble");
}
function deferredAssembly(state: SharedState, c: SharedConvoy): boolean {
  return members(c).some(name => state.commands[name]?.deferRendezvous);
}
function walkingAssembly(c: SharedConvoy): boolean {
  return c.phase === "assemble" && !c.townFirst && (!!c.continuousReturn || !c.returnRouting);
}
function compatible(state: SharedState, c: SharedConvoy, now: number): boolean {
  const leader = state.statuses[c.leader];
  return members(c).every(name => {
    const s = state.statuses[name];
    return freshStatus(s, now) && !!characterRuntime(s) && s.server === leader?.server;
  });
}
function begin(state: SharedState, c: SharedConvoy, now: number): boolean {
  delete c.missingRoutes;
  const leader = state.statuses[c.leader];
  if (!compatible(state, c, now) || !leader || leader.moving || leader.transporting) return false;
  // A late Town transport can interrupt the walking rally. A recovery hold
  // does not imply that its destination has been reached by the whole party.
  if (c.returnTownRally && members(c).some(n => distance(state.statuses[n]!, c.returnTownRally!) > RENDEZVOUS_RANGE)) {
    reassembleReturn(state, c);
    return true;
  }
  walkPhase(state, c, "shared-prepare");
  delete c.arrivalReadySince;
  c.routeVersion = (c.routeVersion || 0) + 1;
  c.rally = point(leader); c.departAt = null;
  delete c.returnTownRally;

  c.routeServer = leader.server;
  c.sharedStartedAt = c.eventRetargetTravelStartedAt ?? now;
  delete c.eventRetargetTravelStartedAt;
  c.sharedPreparationStartedAt = now;
  delete c.routePublishedAt;
  c.runtimes = Object.fromEntries(members(c).map(n => [n, characterRuntime(state.statuses[n])!]));
  delete c.rallyWalking;
  clearSharedRoute(c);
  issue(state, c, "shared-prepare");
  recordConvoyHistory(state, c, "route preparation", now, { routeVersion: c.routeVersion, origin: c.rally, reason: c.failure });
  return true;
}
function lostOwner(state: SharedState, c: SharedConvoy, name: string): boolean {
  const command = state.commands[name], intent = state.navigationIntents?.[name];
  if (!command || command.convoyId !== c.id) return true;
  if (cancelEnds(c, intent)) return true;
  return !!intent && intent.revision !== command.navigationRevision;
}
function scanAssemblyReady(state: SharedState, c: SharedConvoy): boolean {
  if (c.purpose !== PATROL_WALK) return true;
  return members(c).every(name => {
    const s=state.statuses[name], n=s?.convoyNavigation, command=walkCommandOf(state, name);
    return !!n && n.id===c.id && n.epoch===c.epoch && sameWalkOn(command, n, characterRuntime(s)) &&
      n.phase==='assembled' && !s!.moving;
  });
}
function ownerLostReason(state: SharedState, c: SharedConvoy): string {
  const name = members(c).find(n => lostOwner(state, c, n));
  if (!name) return "Convoy owner-lost";
  const command = state.commands[name];
  return "Convoy owner-lost: " + name + " travel replaced by " + (command?.type || "no command") +
    " (saved revision " + c.expected?.[name]?.revision + ", current " + state.navigationIntents?.[name]?.revision + ")";
}
function readyMember(state: SharedState, c: SharedConvoy, name: string): boolean {
  return !readinessIssue(state, c, name);
}
function preparationBlocker(state: SharedState, c: SharedConvoy): string | undefined {
  const missing = members(c).filter(name => !reportMatches(state, name));
  if (missing.length) return 'Waiting for current route acknowledgement: ' + missing.map(n=>n+' ('+acknowledgementReason(state,c,n)+')').join(', ');
  if (!sharedRoute(c)) return 'Waiting for ' + c.leader + ' to publish the return route';
  const waiting = members(c).filter(name => !readyMember(state, c, name));
  if (waiting.length) return 'Waiting for stopped formation and installed route: ' + waiting.join(', ');
  return undefined;
}
function acknowledgementReason(state:SharedState,c:SharedConvoy,name:string):string {
  const n=state.statuses[name]?.convoyNavigation,cmd=state.commands[name];
  if(!n || !n.id)return 'no local return handle';
  if(!cmd || n.commandId!==cmd.id)return 'waiting for command '+cmd?.id+'; reported '+n.commandId;
  if(n.runtimeId!==c.runtimes?.[name])return 'runtime changed';
  return 'return generation or navigation changed';
}
// `assemble` and R4: the walk waits while its members walk to the rally. Each walking member's
// try is bound by its own walking stall, which climbs the ladder (`hold`), and `letGo` answers
// for a member that is not walking, so no round of reports ends the rally. `prepare`: the phase
// ends on the members' planner answers, each try bound by the planner's own budget. A walk a
// Hunt route owns ends on the same rules (the hunting owner's).
function preparing(c: SharedConvoy, assembling: boolean, now: number): void {
  if (assembling) { c.sharedPreparationStartedAt = null; return; }
  if (c.sharedPreparationStartedAt === null) c.sharedPreparationStartedAt = now;
}
function authorizedHold(state: SharedState, c: SharedConvoy, name: string): boolean {
  const intent = state.navigationIntents?.[name], command = state.commands[name];
  if (command && command.convoyId !== c.id) return false;
  if (cancelEnds(c, intent)) return false;
  return holdRevision(state, c, name) === (intent?.revision || 0);
}
function holdRevision(state: SharedState, c: SharedConvoy, name: string): number | undefined {
  return c.expected?.[name]?.revision ?? walkCommandOf(state, name)?.navigationRevision;
}

function eventEntry(c: SharedConvoy): boolean {
  return c.purpose === "shared-walk" && eventMayTake(c) && c.walkingActivity === "event";
}
function terminalCommand(state: SharedState, c: SharedConvoy, name: string): SharedCommand {
  const command = sharedCommand(state, c, eventEntry(c) ? "event-walk-release" : "hold", name);
  command.reason = c.failure || `Navigation halted (${c.failureCode || "missing-failure-context"}); convoy ${c.id}, destination ${c.location.map} (${c.location.x}, ${c.location.y})`;
  return command;
}
// Reports, requests and saved commands name their walk with numbers that may arrive as strings,
// and revision 0 may arrive unset, as the character writes it.
function barrierReport(r: Record<string, unknown> | SharedReport | undefined): WalkReport | undefined {
  const report = r as Record<string, unknown> | undefined;
  return report && { id: String(report.id ?? report.convoyId), epoch: Number(report.epoch), commandId: Number(report.commandId),
    navigationRevision: Number(report.navigationRevision) || 0 };
}
function barrierWalk(command: SharedCommand): WalkCommand {
  return { convoyId: command.convoyId, epoch: command.epoch, id: command.id, navigationRevision: Number(command.navigationRevision) || 0 };
}
// A barrier report: a travel command of the live walk, its expected revision and runtime.
function barrierIdentity(c: SharedConvoy, command: SharedCommand | undefined, navigation: SharedReport | undefined): boolean {
  const expected = command && c.expected && Object.values(c.expected).find(e => e.commandId === command.id);
  return !!(command && navigation && navigation.runtimeId && command.type === 'party-monster-travel' &&
    (!c.expected || expected && expected.revision === command.navigationRevision &&
      (!expected.runtimeId || navigation.runtimeId === expected.runtimeId)) &&
    command.convoyId === c.id && command.epoch === c.epoch && sameWalk(barrierWalk(command), barrierReport(navigation)));
}
// An engagement request: a live participant's command, on the runtime the walk recorded.
export function validReport(input: Parameters<ConvoyNavigationPlatform["validReport"]>[0], body: Record<string, unknown>): boolean {
  const state = input as SharedState, c = state.activeConvoy, character = String(body.character), command = walkCommandOf(state, character);
  return !!(c && c.phase !== 'failed' && c.participants.includes(character) &&
    command && command.convoyId === c.id && command.epoch === c.epoch && sameWalk(barrierWalk(command), barrierReport(body)) &&
    (!c.runtimes || c.runtimes[character] === body.runtimeId));
}
function barrierSignal(input: Parameters<ConvoyNavigationPlatform["signal"]>[0], name: string, now = Date.now()): Record<string, unknown> | null {
  const state = input as SharedState, c = state.activeConvoy, command = state.commands[name];
  if (!c || !c.participants.includes(name) || !command) return null;
  return { id: c.id, epoch: c.epoch, commandId: command.id, phase: c.phase, pace: c.slowestSpeed,
    ...(c.loot ? { loot: c.loot } : {}),
    runtimeId: c.runtimes && c.runtimes[name], departAt: c.departAt || null,
    validUntil: now + ageOf('report'), reason: c.defenseReason || c.failure || null };
}
// A combat handoff ends the shared barrier without claiming waypoint arrival. The remaining
// members get individual, revision-bound recovery commands. The commands map then holds those
// independent travel commands beside the walk's own, so the handoff writes through `handoffs`.
export const engageWalk: ConvoyNavigationPlatform["engage"] = (input, body, options) => {
  const state = input as EngageState, c = state.activeConvoy, target = body.target as EngageTarget | undefined, now = options.now ?? Date.now();
  const character = String(body.character);
  if (!validReport(state, body) || c!.combatHandoffAllowed === false || c!.phase !== 'travel' ||
      Number(body.navigationRevision) !== options.revisions[character] ||
      !target || !target.id || target.map !== c!.location.map ||
      !Number.isFinite(target.x) || !Number.isFinite(target.y) ||
      !contains(c!.location, target, 0, options.radius) ||
      !(options.focus.includes('all') || options.focus.includes(target.mtype))) return false;
  const walk = c!;
  walk.engagement = { character, target: { ...target }, at: now,
    convoyId: walk.id, epoch: walk.epoch,
    reports: Object.fromEntries(walk.participants.map(name => [name, {
      commandId: state.commands[name]?.id, runtimeId: walk.runtimes?.[name],
    }])) };
  const handoffs = state.commands as Record<string, SharedCommand | HandoffCommand | undefined>;
  for (const name of walk.participants) {
    if ((walk.completed || []).includes(name)) continue;
    if (name === character) delete handoffs[name];
    else handoffs[name] = { id: state.nextCommandId++, type: 'event-resume-travel',
      convoyHandoff: walk.id, location: { ...walk.location }, navigationRevision: options.revisions[name]!,
      label: 'the selected farming waypoint' };
  }
  // 06 updates its own return routes for the released walk.
  releaseWalkRoutes(state as Parameters<typeof releaseWalkRoutes>[0], { convoyId: walk.id, participants: walk.participants,
    engaged: character, at: now, revisions: options.revisions,
    handoffs: Object.fromEntries(walk.participants.flatMap(name => handoffs[name]?.convoyHandoff === walk.id ? [[name, handoffs[name]!.id]] : [])) });
  state.lastConvoyEngagement = walk.engagement;
  walkEnds(state, 'released');
  return true;
};
interface BarrierBlocker {
  reason: string; expectedCommandId: number | null; reportedCommandId: number | null; expectedPhase: string;
  reportedPhase: string | null; expectedRevision: number | null; reportedRevision: number | null; runtimeId: string | null;
  map?: string; x?: number; y?: number; speed?: number; moving?: boolean;
}
interface EngageTarget extends RoutePoint { id: string; mtype: string }
interface HandoffCommand { id: number; type: 'event-resume-travel'; convoyHandoff: string; location: RoutePoint; navigationRevision: number; label: string }
interface EngageState extends SharedState {
  lastConvoyEngagement?: SharedConvoy['engagement'];
}

/** The walk's barrier, Town and defense rows run here for every walking leg. */
export function createSharedConvoyNavigation(
  defense: (state: SharedState, now: number, command: typeof sharedCommand) => boolean = () => false): ConvoyNavigationPlatform {
  const communication = createCommunicationRecovery({ owned: authorizedHold, fail: (state, reason, code, now) => failure(state, reason, code, now, true), resume: resumeCommunication,
    hold: (state, c) => {
      c.completed = [];
      clearSharedRoute(c); delete c.readinessStartedAt; delete c.arrivalReadySince;
      c.runtimes = Object.fromEntries(c.participants.map(n => [n, characterRuntime(state.statuses[n]) || '']));
      issue(state, c, 'shared-hold');
    } });
  function resumeCommunication(state: SharedState, c: SharedConvoy, now: number): boolean {
    // Reconcile defense and its loot barrier before granting another movement command.
    if (!c.continuousReturn) {
      walkPhase(state, c, c.communicationHold?.resumeDefense ? 'defending' : 'shared-hold');
      if (defense(state,now,sharedCommand)) {
        if(c.phase==='defending')issue(state,c,'defending');
        return true;
      }
    }
    return begin(state,c,now);
  }
  // The failure table's one reader (read in walk.ts): every failure of the walk names its code, and its `T5` row
  // decides what the walk does. `recovering` marks a failure found while the walk already recovers
  // (a geometry repair or exhausted geometry, a communication hold, an unprepared Hunt return).
  function failure(state: SharedState, reason: string, code: string, now: number, recovering = false): boolean {
    const c = state.activeConvoy;
    if (!c) return false;
    if (code === 'route-failed' && searchPointRefused(c, reason)) return fail(state, c, reason, 'unreachable', T5.unreachable!, now);
    const row = T5[code] ?? FAILS, huntRoute = !c.continuousReturn && ownsHuntRoute(state.monsterHunt, c);
    const does = failureDoes(c, code, recovering);
    if (does === 'keeps') return true;
    if (does === 'recovers') return recover(state, c, reason, now, huntRoute && row.huntRoute === 'fails');
    if (does === 'replaced' && !(huntRoute && row.huntRoute === 'fails')) return replaced(state, c, reason, now);
    return fail(state, c, reason, code, row, now);
  }
  // T4 `shared-hold`: the walk stops where it stands under a new epoch, drops its route and
  // holds every member until `resume` starts the walk again.
  function holdWalk(state: SharedState, c: SharedConvoy, now: number): void {
    c.epoch++; walkPhase(state, c, "shared-hold"); c.departAt = null;
    c.sharedStoppedAt = now; clearSharedRoute(c); issue(state, c, "shared-hold");
  }
  // The failure table `replaced`: the walk ends without a failed hold. Its members' walk commands go, so each
  // member's task asks again and its provider starts the next walk, as convoy.ts `cancel` does.
  function replaced(state: SharedState, c: SharedConvoy, reason: string, now: number): boolean {
    recordConvoyHistory(state, c, "replaced", now, { reason });
    for (const name of c.participants || []) if (state.commands[name]?.convoyId === c.id) delete state.commands[name];
    walkEnds(state, 'replaced', 'rule:T5');
    return true;
  }
  // The failure table `fails`: the walk parks failed and holds each member it still owns.
  function fail(state: SharedState, c: SharedConvoy, reason: string, code: string, row: FailureRow, now: number): boolean {
    if (c.phase === "failed") return false;
    delete c.arrivalReadySince;
    clearSharedRoute(c); c.failure = reason; c.failureCode = code; c.failedAt = now; c.departAt = null;
    walkPhase(state, c, "failed");
    // P5 `retry.policy`: an add-on may exhaust a failure the failure table leaves open, so the walk gives up sooner.
    const exhausts = row.exhausts || heard(state)?.retry?.policy({ owner: '02', subject: c.purpose ?? c.id, failure: code, attempt: 1 },
      { wait: 0, giveUp: false, counts: false }).giveUp;
    if (exhausts) { c.retryExhausted=true; if(c.geometryRepair)c.geometryRepair.phase='failed'; }
    recordConvoyHistory(state, c, "failed", c.failedAt, { reason, code, commands: Object.fromEntries(members(c).map(name => [name, state.commands[name]?.type])) });
    for (const name of members(c)) if (authorizedHold(state, c, name)) merchantSlotCommand(state, 'convoy:' + c.id, terminalCommand(state, c, name), name);
    return true;
  }
  // The failure table `recovers`: a geometry mismatch repairs the geometry, a drift prepares the route again, and
  // any other failure climbs the walk's ladder. A walk a Hunt route owns fails with its route code
  // instead of climbing (the failure table `huntRoute`).
  function recover(state: SharedState, c: SharedConvoy, reason: string, now: number, huntRoute: boolean): boolean {
    delete c.eventRetargetTravelStartedAt;
    if (/game geometry mismatch/i.test(reason)) return repairGeometry(state, c, reason, now);
    if (c.phase === "shared-hold" || c.phase === "failed") return false;
    if (readinessFailure(c, reason)) return prepareAgain(state, c, reason, now);
    if (huntRoute) return fail(state, c, reason, routeFailureCode(reason), T5[routeFailureCode(reason)]!, now);
    return climb(state, c, reason, now);
  }
  // A the walk phase table phase that stalls, or a member whose route failed, fails with its route code (the failure table `recovers`).
  function routeFailed(state: SharedState, reason: string, now: number): boolean {
    return failure(state, reason, routeFailureCode(reason), now);
  }
  // A route failure climbs the walk's own ladder (protocol/ladder.ts `climbWalk`); no count ends it.
  function climb(state: SharedState, c: SharedConvoy, reason: string, now: number): boolean {
    // A continuous return keeps its first cause beside the latest.
    if (c.continuousReturn) c.returnFirstFailure ||= reason;
    recoveryPlanner(c, reason);
    disableFailedTown(c,reason);
    const attempt = climbRung(state, c, now);
    c.failure = reason;
    recordConvoyHistory(state, c, "climbing", now, { reason, rung: attempt.rung, trying: attempt.trying });
    if (attempt.rung === "rebuild" || attempt.rung === "safe-point") { c.epoch++; reassembleReturn(state, c); return true; }
    // A Hunt return that climbs before begin() has no shared-route realm or runtime identity to
    // validate or resume yet.
    if (unpreparedHuntReturn(c)) return recoverUnprepared(state,c,reason,now);
    // A barrier row (`barrier`) that ends without its members' answers climbs here before begin()
    // names the runtimes. health() reads a missing runtime as runtime-lost, so the hold names
    // the runtimes it holds.
    c.runtimes ??= Object.fromEntries(members(c).map(n => [n, characterRuntime(state.statuses[n])!]));
    holdWalk(state, c, now);
    return true;
  }
  // Judges the rung that ran and applies the next one's convoy settings. The other route is
  // the native planner without the leave transition; it never turns Town on (intent audit
  // item 2). The safe-point rung assembles every member at the group's safe point, walking
  // only, so no member casts Town alone inside the walk (docs/movement.md "Execution and
  // recovery"); the walk starts again from there once all stand within the rally range.
  function climbRung(state: SharedState, c: SharedConvoy, now: number) {
    const leader = state.statuses[c.leader];
    const attempt = climbWalk(c, walkRound(safePointOf(state, c)), leader ? point(leader) : c.rally, walkCloseness(leader, c.location), now);
    if (attempt.rung !== "safe-point" && c.rallyWalking) { delete c.returnTownRally; delete c.rallyWalking; }
    if (attempt.rung === "other-route") { c.nativeFallback = true; c.avoidLeave = true; }
    if (attempt.rung === "safe-point") { c.returnTownRally = { ...attempt.destination! }; c.rallyWalking = true; }
    if (attempt.rung === "wait") {
      c.ladderWaitAt = now;
      // P5 `retry.policy`: an add-on may lengthen the wait before the next round, never shorten it.
      const asked = heard(state)?.retry?.policy({ owner: '02', subject: c.purpose ?? c.id, failure: 'ladder-wait', attempt: c.ladder?.rounds ?? 0 },
        { wait: 0, giveUp: false, counts: false });
      if (asked && asked.wait > 0) c.ladderWaitUntil = now + asked.wait; else delete c.ladderWaitUntil;
    }
    // R5 `ladder.climbed`: the walk moved to a rung, with what it tries.
    heard(state)?.notify('ladder.climbed', { group: c.group ?? null, walk: c.id, owner: c.purpose ?? null, rung: attempt.rung, trying: attempt.trying, step: c.ladder?.index ?? 0, by: 'rule:T2' });
    return attempt;
  }
  function repairGeometry(state: SharedState, c: SharedConvoy, reason: string, now: number): boolean {
    if (c.geometryRepair?.phase === 'waiting') return false;
    if (!beginGeometryRepair(state,c,now))
      return failure(state, 'Geometry recovery failed: ' + reason, 'geometry-mismatch', now);
    c.failure = reason; holdWalk(state, c, now);
    recordConvoyHistory(state,c,'geometry repair',now,{reason,repair:c.geometryRepair});
    return true;
  }
  function stepGeometryRepair(state: SharedState, c: SharedConvoy, now: number): boolean {
    if (!members(c).every(n=>authorizedHold(state,c,n))) {
      c.geometryRepair!.phase='failed';
      return failure(state,'Geometry recovery superseded by newer navigation','owner-lost',now,true);
    }
    // A restart preserves the repair budget but recreates only still-owned holds.
    if (members(c).some(n=>!state.commands[n])) { issue(state,c,'shared-hold'); return true; }
    if (geometryRepairReady(state,c,now)) {
      c.geometryRepair!.phase='complete'; c.failure=undefined;
      return begin(state,c,now);
    }
    if (now-c.geometryRepair!.startedAt<GEOMETRY_REPAIR_DEADLINE_MS) return false;
    boundFired({ bound: 'GEOMETRY_REPAIR_DEADLINE_MS', owner: '02', subject: c.id, state: { repair: c.geometryRepair!.id, runtimes: c.geometryRepair!.runtimes } });
    c.geometryRepair!.phase='failed';
    return failure(state,'Geometry recovery failed after one reload: fresh compatible game geometry not received by the repair deadline','geometry-mismatch',now);
  }
  function recoverUnprepared(state: SharedState, c: SharedConvoy, reason: string, now: number): boolean {
    if (!returnRuntimeReady(state,c,now))
      return failure(state,"Hunt return recovery requires fresh compatible participants and unchanged navigation","owner-lost",now,true);
    c.epoch++; reassembleReturn(state,c);
    recordConvoyHistory(state,c,"regrouping",now,{reason});
    return true;
  }
  // The failure stamps failedAt with the caller's clock, as the step's failures do, so a step on
  // virtual time reads the members' next reports against it.
  function hold(input: Parameters<ConvoyNavigationPlatform["hold"]>[0], reason: string, code: string, now: number): boolean {
    return failure(input as SharedState, reason, code, now);
  }
  function health(state: SharedState, c: SharedConvoy, now: number): string | null {
    for (const name of members(c)) {
      if (lostOwner(state, c, name)) return "owner-lost";
      if (!freshStatus(state.statuses[name], now)) return "unavailable";
      // The realm check compares against the route the walk holds; a walk on its hold between
      // rungs has none (`clearSharedRoute`), and its next route takes the members' realm.
      if (c.routeServer && state.statuses[name]!.server !== c.routeServer) return "realm-lost";
      if (characterRuntime(state.statuses[name]) !== c.runtimes?.[name]) return "runtime-lost";
    }
    return null;
  }
  function resume(state: SharedState, c: SharedConvoy, now: number): boolean {
    // And R4: the hold ends when every member's report acknowledges it, standing still. The
    // heartbeat reply carries the hold command to each report until one does, and `letGo` lets a
    // member go that a holder says is not coming, so no round of reports ends it.
    if (!members(c).every(name => reportMatches(state, name) &&
      state.statuses[name]!.convoyNavigation?.phase === "held" && !state.statuses[name]!.moving)) return false;
    // The ladder's wait rung starts its new round on a report every member sent after it began.
    if (c.ladderWaitAt !== undefined) {
      if (members(c).some(name => !(state.statuses[name]!.seenAt > c.ladderWaitAt!))) return false;
      if (!walkWaitOver(c, now)) return false;
      walkWaited(c, walkRound(safePointOf(state, c)), now);
    }
    c.failure = undefined;
    return begin(state, c, now);
  }
  function prepare(state: SharedState, c: SharedConvoy, now: number): boolean {
    if (readinessStalled(state, c)) return readinessTimeout(state, c, now);
    c.preparationBlocker = preparationBlocker(state, c);
    const allReady = !!sharedRoute(c) && members(c).every(n => readyMember(state, c, n));
    if (!allReady) {
      const assembling = members(c).some(n => distance(state.statuses[n]!, c.rally) > RENDEZVOUS_RANGE || state.statuses[n]!.moving);
      preparing(c, assembling, now);
      return false;
    }
    // And R4: one ready report per member departs. `readinessIssue` counts a report only when it
    // acknowledges the walk's current command (`reportMatches`), so a report from before the command
    // never departs the walk. (user 2026-11-04): the walk departs at once. Each member departs on the
    // first heartbeat reply that carries the travel phase, so no member can miss the start and the
    // departure needs no clock time ahead. Departing ends what the walk's ladder tried; the climb
    // itself stays for the next failure. R5 `walk.departs`: an add-on holds its own walk's departure
    // while its condition holds; the readiness and assembly progress tests above still end a hold
    // that makes no progress.
    if (c.purpose?.startsWith("addon:") && heard(state)?.movement.holdsDeparture(c.purpose.slice("addon:".length),
      { group: c.group ?? null, walk: c.id, phase: c.phase, members: members(c) })) return false;
    walkPhase(state, c, "travel"); c.departAt = now; delete c.ladderTrying;
    return true;
  }
  function travel(state: SharedState, c: SharedConvoy, now: number): boolean {
    // The travel phase does not prove each client heard it. The readiness deadline stays
    // until every member reports its departure.
    if (departureConfirmed(state,c,now)) delete c.readinessStartedAt;
    if (reconcileReturnArrival(state, c, now)) return true;
    const missing = missingTravelRoute(state, c, now);
    if (missing) return routeFailed(state, "Travel route disappeared: " + missing, now);
    return false;
  }
  function readinessTimeout(state: SharedState, c: SharedConvoy, now: number): boolean {
    return routeFailed(state, READINESS_STALLED + (c.preparationBlocker || 'unstable formation'), now);
  }
  function prepareAgain(state: SharedState, c: SharedConvoy, reason: string, now: number): boolean {
    c.readinessStartedAt ??= c.sharedStartedAt || now;
    if (readinessStalled(state, c)) return routeFailed(state, READINESS_STALLED + reason, now);
    c.preparationBlocker = reason;
    holdWalk(state, c, now);
    recordConvoyHistory(state, c, 'departure deferred', now, { reason });
    return true;
  }
  function activeStep(state: SharedState, c: SharedConvoy, now: number): boolean {
    if (c.geometryRepair?.phase === 'waiting') return stepGeometryRepair(state,c,now);
    const problem = health(state, c, now);
    // Rank table: a member whose travel a newer request took has left the walk, so the walk ends
    // replaced and its task asks again; a member on another realm or a stale runtime is a failure of
    // the walk's ladder, which climbs.
    if (problem) return failure(state, problem === "owner-lost" ? ownerLostReason(state, c) : "Convoy " + problem, problem, now);
    const mismatched = geometryMismatch(state,c);
    if (mismatched.length) return repairGeometry(state,c,'Shared route game geometry mismatch: ' + JSON.stringify({
      expected:sharedRoute(c)?.geometry || state.statuses[c.leader]?.movementGeometry,
      actual:Object.fromEntries(mismatched.map(n=>[n,state.statuses[n]?.movementGeometry]))}),now);
    if (c.phase === "shared-hold") return resume(state, c, now);
    return advanceHealthyRoute(state,c,now);
  }
  function advanceHealthyRoute(state: SharedState, c: SharedConvoy, now: number): boolean {
    const failed = members(c).find(n => reportMatches(state, n) && state.statuses[n]!.convoyNavigation?.phase === 'failed');
    if (failed) {
      c.failureDetails=state.statuses[failed]!.convoyNavigation?.failureDetails || c.failureDetails;
      return routeFailed(state, failed + ': ' + (state.statuses[failed]!.convoyNavigation?.failure || 'Character requested route recovery'), now);
    }
    // Design 2.3: a moving boss re-aims the walk in place. The signal carries the new point and each
    // member's journey takes it on a clear straight line; a member whose line is blocked declines,
    // and the walk holds for a new route, as every re-aim did on an earlier build.
    const destination = movingEventDestination(state, c, now);
    if (destination) {
      c.location = destination;
      recordConvoyHistory(state, c, 'event boss moved', now, { destination, bossId: c.eventPursuitBossId });
      return true;
    }
    if (reaimDeclined(state, c)) return prepareMovingEvent(state, c, now);
    if (c.phase === "shared-prepare") return prepare(state, c, now);
    return travel(state, c, now);
  }

  function prepareMovingEvent(state: SharedState, c: SharedConvoy, now: number): boolean {
    c.eventRetargetTravelStartedAt = c.sharedStartedAt;
    c.readinessStartedAt = now;
    holdWalk(state, c, now);
    recordConvoyHistory(state, c, 'event pursuit preparation', now, { destination: c.location });
    return true;
  }
  // T4's barrier rows, moved from scripts/convoy-navigation.cjs: the assembly before and after Town and the
  // Town cast. Each ends on its members' answers, and a row that ends without them climbs the walk's
  // ladder. A death recovery walk gives its barrier command again to a member that lost it while its intent
  // still names the walk.
  function barrier(state: SharedState, c: SharedConvoy, now: number): boolean {
    if (!['assemble', 'town'].includes(c.phase)) return climb(state, c, 'Unsupported convoy phase ' + c.phase, now);
    if (c.purpose === 'death-recovery') {
      for (const name of c.participants) {
        if (!state.commands[name] && c.expected?.[name]?.revision === (Number(state.navigationIntents?.[name]?.revision) || 0) &&
            !state.navigationIntents?.[name]?.cancelled) {
          merchantSlotCommand(state, 'convoy:' + c.id, sharedCommand(state, c, c.phase, name), name);
        }
      }
    }
    // The failure table `owner-lost`: a member whose slot holds another owner's command ends the barrier, as
    // v1.5.0 ended it. A walk command on an older navigation revision is no lost
    // owner here: the barrier's dispatch below binds the current revision.
    if (members(c).some(name => { const command = state.commands[name]; return !!command && command.convoyId !== c.id; }))
      return failure(state, ownerLostReason(state, c), 'owner-lost', now);
    const names = members(c);
    if (c.observedPhase !== c.phase) {
      c.observedPhase = c.phase;
      c.progress = {}; c.blockers = {};
    }
    const blockers: Record<string, BarrierBlocker> = {};
    for (const name of names) {
      const s = state.statuses[name], n = s?.convoyNavigation, command = walkCommandOf(state, name);
      const expectedPhase = c.phase === 'assemble' ? 'assembled' : 'towned';
      const away = s?.map === c.rally.map ? Math.hypot(Number(s.x) - c.rally.x, Number(s.y) - c.rally.y) : Infinity;
      const reason = !s || !fresh(s.seenAt, now) ? 'status-stale' : s.rip ? 'dead' :
        !command || command.convoyId !== c.id ? 'command-lost' : !barrierIdentity(c, command, n) ? 'acknowledgement-missing' :
        n!.phase === 'failed' ? 'runtime-failed' : n!.phase !== expectedPhase ? 'phase-pending' :
        s.moving ? 'moving' : c.phase === 'assemble' && away > RENDEZVOUS_RANGE ? 'outside-rally' :
        c.phase === 'assemble' && !cruisePaced(s.speed, c.slowestSpeed, reportSlowed((s as { conditions?: Parameters<typeof reportSlowed>[0] }).conditions)) ? 'speed-pending' : null;
      if (reason) blockers[name] = { reason, expectedCommandId: c.expected?.[name]?.commandId || command?.id || null,
        reportedCommandId: n?.commandId || null, expectedPhase, reportedPhase: n?.phase || null,
        expectedRevision: command?.navigationRevision ?? null, reportedRevision: n?.navigationRevision ?? null,
        runtimeId: n?.runtimeId || null, map: s?.map, x: s?.x, y: s?.y, speed: s?.speed, moving: s?.moving };
      const previous = c.progress![name];
      const ack = barrierIdentity(c, command, n) ? command!.id + ':' + n!.phase : null;
      if (s && fresh(s.seenAt, now) && (!previous || ack && ack !== previous.ack ||
          c.phase === 'assemble' && away < previous.distance! - 5)) {
        c.progress![name] = { ack, distance: away };
      }
    }
    const diagnosticsChanged = JSON.stringify(c.blockers) !== JSON.stringify(blockers);
    c.blockers = blockers;
    const summary = Object.entries(blockers).map(([name, b]) => name + ': ' + b.reason + ' (' + b.reportedPhase + ' → ' + b.expectedPhase + ')').join(', ');
    if (summary && summary !== c.blockerSummary) {
      c.blockerSummary = summary;
      appendCombatLog(state.combatLogs, c.leader || names[0]!, { at: now, type: 'navigation', message: 'Convoy ' + c.phase + ': ' + summary });
    }
    // And R4: each barrier phase ends on its members' answers. A member's own walk or Town cast is
    // bound by its own try and answers `failed`, which ends the phase at once and climbs the walk's
    // ladder, which walks with Town off after a Town. A member that has not acknowledged the
    // phase's command, or that its holders say is coming, is waited on (`letGo`), with no round of
    // reports.
    const failed = names.find(name => blockers[name]?.reason === 'runtime-failed');
    if (failed) return climb(state, c, failed + ': ' + (state.statuses[failed]!.convoyNavigation!.failure || 'route failed'), now);
    if (c.phase === 'assemble') {
      const assembled = names.length && names.every(name => {
        const s = state.statuses[name], n = s && s.convoyNavigation;
        return s && fresh(s.seenAt, now) && !s.rip && !s.moving &&
          barrierIdentity(c, walkCommandOf(state, name), n) && n!.phase === 'assembled' &&
          cruisePaced(s.speed, c.slowestSpeed, reportSlowed((s as { conditions?: Parameters<typeof reportSlowed>[0] }).conditions)) && s.map === c.rally.map &&
          Math.hypot(Number(s.x) - c.rally.x, Number(s.y) - c.rally.y) <= RENDEZVOUS_RANGE;
      });
      // And R4: one assembled report per member that acknowledges the phase's command
      // (`barrierIdentity`) ends the assembly.
      if (!assembled) return diagnosticsChanged;
      if (c.townFirst && !c.townCompleted) {
        walkPhase(state, c, 'town'); c.runtimes = {};
        for (const name of names) {
          const s = state.statuses[name]!;
          c.runtimes[name] = s.convoyNavigation!.runtimeId;
          merchantSlotCommand(state, 'convoy:' + c.id, sharedCommand(state, c, 'town', name), name);
        }
        return true;
      }
      // The assembled walk begins its shared route at once. A leader still landing from a transport
      // keeps the walk assembling, so the route begins on the tick it stands.
      return begin(state, c, now);
    }
    // c.phase === 'town'
    const towned = names.length && names.every(name => {
      const s = state.statuses[name], n = s && s.convoyNavigation;
      return s && fresh(s.seenAt, now) && !s.rip && !s.moving &&
        barrierIdentity(c, walkCommandOf(state, name), n) && n!.phase === 'towned';
    });
    if (!towned) return diagnosticsChanged;
    // Regroup after the teleport before preparing routes from a shared origin.
    c.townCompleted = true; walkPhase(state, c, 'assemble');
    const leader = state.statuses[c.leader || names[0]!]!;
    c.rally = { map: leader.map, x: Number(leader.x), y: Number(leader.y) };
    for (const name of names) {
      merchantSlotCommand(state, 'convoy:' + c.id, sharedCommand(state, c, 'assemble', name), name);
    }
    return true;
  }
  function bootstrap(state: SharedState, c: SharedConvoy, now: number): boolean {
    if (c.retryExhausted) return failure(state, "The shared route no longer matches the game geometry; select the destination again", "route-failed", now, true);
    prepareContinuousReturn(c);
    if (walkingAssembly(c)) {
      return bootstrapWalking(state,c,now);
    }
    if (c.phase === "assemble" && deferredAssembly(state, c)) {
      issue(state, c, "assemble");
      return true;
    }
    return barrier(state, c, now);
  }
  // The user's decision of 2026-11-17 (decisions.md): a member `letGo` let go as silent comes back on
  // its first report that reads online again from the walk's realm, while its slot holds no other
  // owner's command. A route phase holds the whole walk under a new epoch, so the route `resume`
  // prepares includes it; a barrier phase gives it that phase's command. Any other phase keeps it
  // waiting for one of those.
  function takeBack(state: SharedState, c: SharedConvoy, now: number): boolean {
    const route = ["shared-prepare", "shared-hold", "travel"].includes(c.phase), barrierPhase = ["assemble", "town"].includes(c.phase);
    if (!c.silentLeft?.length || !route && !barrierPhase) return false;
    const back = c.silentLeft.filter(name => {
      const s = state.statuses[name], command = state.commands[name];
      return !!s && !s.rip && !silent(s, now) && !!characterRuntime(s) && s.server === state.statuses[c.leader]?.server &&
        (!command || command.convoyId === c.id);
    });
    if (!back.length) return false;
    known(state, c);
    c.silentLeft = c.silentLeft.filter(name => !back.includes(name));
    for (const name of back) {
      c.participants.push(name);
      if (c.runtimes) c.runtimes[name] = characterRuntime(state.statuses[name])!;
      if (c.lives) c.lives[name] = lifeOf(state, name);
      tell(state, 'walk.member', c, { member: name, change: 'rejoined', by: 'rule:T5' });
    }
    const last = told.get(state);
    if (last?.walk === c) last.participants = [...c.participants];
    if (route) holdWalk(state, c, now);
    else for (const name of back) merchantSlotCommand(state, 'convoy:' + c.id, sharedCommand(state, c, c.phase, name), name);
    return true;
  }
  function bootstrapWalking(state: SharedState, c: SharedConvoy, now: number): boolean {
    c.sharedStartedAt ??= now;
    if (!compatible(state,c,now)) {
      // `letGo` has already let go each member with no runtime or on another server (`strayed`), so
      // the walk waits here only on a report that is not yet fresh by the status window, which the failure table
      // ends. A Hunt walk waits on the same rule.
      return false;
    }
    if(c.returnTownRally)return awaitTownRally(state,c,now);
    return scanAssemblyReady(state,c) && begin(state,c,now);
  }
  function awaitTownRally(state:SharedState,c:SharedConvoy,now:number):boolean {
    const arrived=members(c).every(n=>distance(state.statuses[n]!,c.rally)<=RENDEZVOUS_RANGE);
    if(arrived && begin(state,c,now)){delete c.returnTownRally;return true;}
    return false;
  }
  function step(input: Parameters<ConvoyNavigationPlatform["step"]>[0], now = Date.now()): boolean {
    const state = input as SharedState, c = state.activeConvoy;
    if (!c) return false;
    // A member's base speed that changes (a gear change) re-paces the walk; the commands this step
    // issues and each member's signal carry the new pace, so a walk resumed after a defense pause
    // cruises at the party's pace of now.
    const pace = walkPace(state.statuses, members(c), c.leader);
    if (pace.slowestSpeed > 0) Object.assign(c, pace);
    // To and: in every phase, a member that a holder says is not coming leaves the walk first, so no
    // phase, the communication hold included, waits on a member whose reports stopped.
    const leader = c.leader;
    if (takeBack(state, c, now)) return true;
    if (letGo(state, c, now)) {
      // The route belongs to the leader: each member's command names the leader that publishes it.
      // A walk whose leader left in a route phase holds, and `resume` prepares a new route from the
      // member now leading it.
      if (state.activeConvoy === c && c.leader !== leader && ["shared-prepare", "shared-hold", "travel"].includes(c.phase)) holdWalk(state, c, now);
      return true;
    }
    if(c.walkingActivity==='anniversary-staging'){c.continuousReturn=1;c.navigationExempt=false;}
    const communicationChanged = communication(state, c, now);
    if (communicationChanged !== null) return communicationChanged;
    if (refreshReturnTown(state,c,now))return true;
    // A local attacker can interrupt the stopping acknowledgement. Resolve that
    // defense and loot before waiting for held reports or resuming the route.
    if (merchantDefense(state, c, now)) { clearSharedRoute(c); return true; }
    const interruption = stepMerchantInterruption(state, now, {
      hold: name => sharedCommand(state, c, "shared-hold", name),
      resume: phase => {
        c.epoch++; clearSharedRoute(c);
        if (phase === "failed") {
          walkPhase(state, c, "failed");
          for (const name of members(c)) merchantSlotCommand(state, 'convoy:' + c.id, terminalCommand(state, c, name), name);
          return true;
        }
        // Older interruptions could capture communication-hold as their resume
        // phase. Recovery already acknowledged the hold; prepare fresh movement.
        if (["shared-prepare", "shared-hold", "travel", "communication-hold"].includes(phase)) {
          walkPhase(state, c, "shared-hold"); c.sharedStoppedAt = now;
          return begin(state, c, now);
        }
        walkPhase(state, c, phase); issue(state, c, phase); return true;
      },
      fail: reason => failure(state, reason, 'owner-lost', now),
    });
    if (interruption !== null) return interruption;
    const arrival = stepHuntArrival(state, c, now, sharedCommand);
    if (arrival !== null) return arrival;
    return advanceRoute(state,c,now);
  }
  function merchantDefense(state: SharedState, c: SharedConvoy, now: number): boolean {
    return !!c.merchantInterruption && c.merchantInterruption.phase !== 'collecting' &&
      !c.force && defense(state, now, sharedCommand);
  }
  function advanceRoute(state:SharedState,c:SharedConvoy,now:number):boolean {
    if (c.geometryRepair?.phase === 'waiting') return stepGeometryRepair(state,c,now);
    if (c.phase === "failed") return failedStep(state, c, now);
    if (!c.continuousReturn && inheritHuntBudget(state,c,now)) return true;
    if (!c.force && defense(state, now, sharedCommand)) { clearSharedRoute(c); return true; }

    if (["shared-prepare", "shared-hold", "travel"].includes(c.phase)) return activeStep(state, c, now);
    return bootstrap(state, c, now);
  }
  function inheritHuntBudget(state:SharedState,c:SharedConvoy,now:number):boolean {
    const g=state.statuses[c.leader]?.movementGeometry;
    const entry=inheritedHuntRoute(state.monsterHunt,c,g ? g.version+':'+g.fingerprint : 'unknown');
    if (!entry || c.routeRecovery?.stage==='relocation') return false;
    if (entry.phase==='post-relocation' || entry.phase==='native') {
      c.routeRecovery={key:JSON.stringify([c.location.map,c.location.in ?? c.location.map,c.location.x,c.location.y]),stage:entry.phase};
      c.nativeFallback=entry.phase==='native';
      return false;
    }
    return failure(state,entry.message || 'Hunt route waiting for its one permitted origin relocation: '+entry.firstFailure,'hunt-route-held',now);
  }
  function releaseFailedEntry(state: SharedState, c: SharedConvoy): boolean {
    let changed = false;
    for (const name of members(c)) {
      if (!authorizedHold(state, c, name) || state.commands[name]?.phase === "event-walk-release") continue;
      merchantSlotCommand(state, 'convoy:' + c.id, terminalCommand(state, c, name), name); changed = true;
    }
    return changed;
  }
  function failedStep(state: SharedState, c: SharedConvoy, now: number): boolean {
    if (reconcileReturnArrival(state, c, now)) return true;
    if (recoverUnpreparedReturn(state, c, now)) return true;
    if (eventEntry(c)) return releaseFailedEntry(state, c);
    if (members(c).every(name => authorizedHold(state, c, name)) && defense(state, now, sharedCommand)) return true;
    let changed = false;
    for (const name of members(c)) if (!state.commands[name] && authorizedHold(state, c, name)) {
      merchantSlotCommand(state, 'convoy:' + c.id, terminalCommand(state, c, name), name); changed = true;
    }
    return changed;
  }
  function returnRuntimeReady(state: SharedState, c: SharedConvoy, now: number): boolean {
    return compatible(state, c, now) && !state.statuses[c.leader]?.moving && members(c).every(name => authorizedHold(state, c, name));
  }
  // The rebuild below (recoverUnpreparedReturn) climbs the walk's ladder with no cap and no fixed
  // wait; it waits for every member's report after the failure instead.
  function freshSinceFailure(state: SharedState, c: SharedConvoy): boolean {
    return members(c).every(name => (state.statuses[name]?.seenAt ?? 0) > (c.failedAt || 0));
  }
  function recoverUnpreparedReturn(state: SharedState, c: SharedConvoy, now: number): boolean {
    if (!unpreparedHuntReturn(c) || c.failureCode !== "realm-lost" || c.retryExhausted) return false;
    if (!returnRuntimeReady(state, c, now) || !freshSinceFailure(state, c)) return false;
    if (climbRung(state, c, now).rung === "wait") walkWaited(c, walkRound(walkSafePoint(state, c)), now);
    c.epoch++;
    reassembleReturn(state, c);
    recordConvoyHistory(state, c, "regrouping", now, { reason: "Rebuilding Hunt return without initialized route identity" });
    return true;
  }
  function signal(input: Parameters<ConvoyNavigationPlatform["signal"]>[0], name: string, now = Date.now()): unknown {
    const state = input as SharedState, c = state.activeConvoy;
    const result = barrierSignal(state, name, now);
    if (!result || !c) return result;
    return { ...result, runtimeId: result.runtimeId || assemblyRuntime(state,c,name), navigationRevision: state.commands[name]?.navigationRevision, geometryReload: geometryReloadSignal(state,c,name), returnWalking: returnWalking(c), farmingEngagement: c.farmingEngagement || null, routeVersion: c.routeVersion || 0, routeAvailable: !!sharedRoute(c),
      // A walk that follows a boss names its destination, which a member re-aims to in place (2.3).
      ...(c.eventPursuitBossId ? { destination: c.location } : {}) };
  }
  const engage: ConvoyNavigationPlatform["engage"] = (state, body, options) =>
    ["", "party-travel", "farm-relocation"].includes((state as SharedState).activeConvoy?.purpose || "")
      ? engageFarming(state as SharedState, body, options, { validReport })
      : engageHunt(state, body, options, { engage: engageWalk, validReport });
  return { validReport, step: (state, now) => {
    const changed = step(state, now);
    const checkpoint = checkpointContinuousReturn(state as SharedState, now ?? Date.now());
    propagateHuntTarget(state);
    return changed || checkpoint;
  }, signal, hold, engage };
}

// Health/ownership checks run first. Only fresh, continuously missing handles authorize
// regrouping; completed members and superseding navigation never do. T4 `travel`: a member lost
// its route once its next report still carries no route handle, a Hunt walk's too.
function missingTravelRoute(state: SharedState, c: SharedConvoy, now: number): string | undefined {
  const missing = c.missingRoutes ||= {};
  for (const name of members(c)) {
    const status = state.statuses[name]!;
    if (status.convoyNavigation) { delete missing[name]; continue; }
    const previous = missing[name];
    if (!previous || !fresh(previous.observedAt, status.seenAt))
      missing[name] = { since: now, observedAt: status.seenAt };
    else previous.observedAt = status.seenAt;
    const since = missing[name]!.since;
    if (status.seenAt > since) return name;
  }
  return undefined;
}

function refreshReturnTown(state:SharedState,c:SharedConvoy,now:number):boolean {
  if(c.participants.some(n=>lostOwner(state,c,n)))return false;
  if(!observeReturnTown(state,c,now))return false;
  // A recovered Town opportunity can release only a route failure, never an ownership hold.
  if(c.phase==='failed' && (c.disableTown || !['route-failed','assembly-timeout'].includes(c.failureCode || '')))return false;
  if(c.phase==='failed')c.retryExhausted=false;
  c.epoch++;reassembleReturn(state,c);return true;
}

// The group's safe point for a walk's ladder: the Town landing on Main, where the game puts a character
// after Town (queue A29). A Hunt return that has not yet switched to the continuous return
// (`prepareContinuousReturn`) has none. R5 and P8 `safe.goal`: a walk restarts from the safe point an
// add-on names (its own add-on for an add-on's walk), else from the walk's own (`walkSafePoint`).
function safePointOf(state: SharedState, c: SharedConvoy): WalkPoint | null {
  const named = heard(state)?.movement.safeGoal(c.purpose ?? null, { group: c.group ?? null, walk: c.id });
  return named ?? walkSafePoint(state, c);
}
function walkSafePoint(state: SharedState, c: SharedConvoy): WalkPoint | null {
  if (c.returnRouting && !c.continuousReturn) return null;
  const spawn = (state.statuses[c.leader] as { mainTownSpawn?: { x: number; y: number } } | undefined)?.mainTownSpawn;
  return { map: "main", x: spawn?.x ?? 0, y: spawn?.y ?? 0 };
}

function routeFailureCode(reason: string): string {
  return reason.startsWith(READINESS_STALLED) ? 'assembly-timeout' : 'route-failed';
}

// The failure table, what each failure code does to a walk
// R3.2). The failure table lives in walk.ts beside the walk phase table, the one reader of both (the 2026-11-10 correction of R1.2's
// "all seven live in rules.ts").
// `does` is the row's answer: `recovers` repairs, prepares again or climbs the walk's ladder,
// `replaced` ends the walk so its task asks again, `fails` parks it failed with its members held,
// and `keeps` changes nothing. The other columns override it:
// - `huntRoute` on a walk a Hunt route owns, whose failure the hunting owner's route recovery reads;
// - `recovering` for a failure found while the walk already recovers;
// - `continuousReturn` on a continuous return, whose walk an interrupted Town does not end.
// `exhausts` keeps the failure until the player selects the destination again, and
// `takenOver` lets a failed event walk's members take it over from their new runtime with their
// next request.
type Does = 'recovers' | 'replaced' | 'fails' | 'keeps';
interface FailureRow { does: Does; huntRoute?: Does; recovering?: Does; continuousReturn?: Does; exhausts?: boolean; takenOver?: boolean }
const T5: Readonly<Record<string, FailureRow>> = {
  'route-failed': { does: 'recovers', huntRoute: 'fails', recovering: 'fails' },
  'assembly-timeout': { does: 'recovers', huntRoute: 'fails' },
  // A Town that could not cast climbs like a route failure, and the climb turns Town off.
  'town-unavailable': { does: 'recovers', huntRoute: 'fails' },
  'realm-lost': { does: 'recovers', huntRoute: 'fails' },
  'owner-lost': { does: 'replaced', huntRoute: 'fails', recovering: 'fails' },
  'town-interrupted': { does: 'fails', continuousReturn: 'keeps' },
  'geometry-mismatch': { does: 'fails', exhausts: true },
  'runtime-lost': { does: 'fails', takenOver: true },
  'unavailable': { does: 'fails' },
  'hunt-route-held': { does: 'fails' },
  // A search point the planner answers with no route (`searchPointRefused`).
  'unreachable': { does: 'fails' },
};
// The planners' own answer that no route reaches the goal: the native planner's finished search
// (movement/character/planner.ts), the native plan the game's collision rejects (owner.ts
// `install`, as for a search point inside a wall) and the coordinator's unreachable goal
// (planner-worker.ts).
const PLANNER_REFUSAL = /Native planner found no route|Native route rejected|ALClient found no route(?! with)/;
// An event search's point is one candidate of many, so the planner's refusal ends its walk and the
// search walks to the next point. Every other walk climbs its ladder on the same failure.
function searchPointRefused(c: SharedConvoy, reason: string): boolean {
  return !!sessions.get(c)?.requests.some(r => r.search) && PLANNER_REFUSAL.test(reason);
}
// A code with no row fails the walk.
const FAILS: FailureRow = { does: 'fails' };
// The the failure table answer for `code` on the walk `c`, before the Hunt route column (`failure` applies it).
export function failureDoes(c: Pick<SharedConvoy, 'continuousReturn'>, code: string, recovering = false): Does {
  const row = T5[code] ?? FAILS;
  return c.continuousReturn && row.continuousReturn || recovering && row.recovering || row.does;
}
function failureTakenOver(c: SharedConvoy): boolean {
  return !!T5[c.failureCode ?? '']?.takenOver;
}

type State = Parameters<typeof createPartyConvoys>[0];
type Ports = Parameters<typeof createPartyConvoys>[1];
type Convoys = ReturnType<typeof createPartyConvoys>;

/** Recover ordinary party travel; Hunt and event returns retain their own retry policies. */
export function createConvoyRestartRecovery(
  state: State,
  ports: Ports,
  convoys: Convoys,
  log: (message: string) => void = () => {},
) {
  function message(convoy: PartyConvoy, text: string): void {
    if (convoy.failure === text) return;
    convoy.failure = text;
    log(text);
    ports.persist();
  }
  function superseded(convoy: PartyConvoy): boolean {
    return (
      state.leader !== convoy.leader ||
      convoy.participants.some((name) => {
        const intent = ports.intent(name),
          revision = convoy.restartRevisions?.[name];
        return (
          intent.cancelled ||
          revision === undefined ||
          intent.revision !== revision ||
          (name !== state.leader && !state.followers[name])
        );
      })
    );
  }
  function ready(convoy: PartyConvoy): boolean {
    const leader = state.statuses[convoy.leader];
    return convoy.participants.every((name) => {
      const status = state.statuses[name],
        command = state.commands[name];
      if (!living(status)) return false;
      return (
        fresh(status.seenAt, ports.now()) &&
        !!status.convoyNavigation?.runtimeId &&
        status.server === leader?.server &&
        (!command || command.convoyId === convoy.id)
      );
    });
  }
  function living(
    status: State["statuses"][string],
  ): status is NonNullable<State["statuses"][string]> {
    return !!status && !status.rip && status.hp !== 0;
  }
  function blocked(convoy: PartyConvoy): boolean {
    return !ready(convoy) || (!!state.escape && state.escape.stage !== "released");
  }
  function eligible(convoy: PartyConvoy | null): convoy is PartyConvoy {
    return !!convoy && convoy.phase === "failed" && !!convoy.restartRecovery &&
      [null, undefined, "party-travel", "party-force-travel"].includes(convoy.purpose);
  }
  return function recover(): void {
    const convoy = state.activeConvoy;
    if (!eligible(convoy)) return;
    if (superseded(convoy)) {
      convoys.cancel();
      ports.persist();
      log("Discarded interrupted convoy superseded by current navigation");
      return;
    }
    const attempts = convoy.restartAttempts || 0;
    // A rebuild waits for every member's report after the failure, with no cap and no fixed
    // waits, and the new convoy keeps the walk's ladder.
    if (blocked(convoy) || convoy.participants.some(name => !((state.statuses[name]?.seenAt ?? 0) > (convoy.failedAt || 0)))) {
      message(convoy, "Convoy recovery waiting for fresh compatible party reports and command ownership");
      return;
    }
    convoy.restartAttempts = attempts + 1;
    convoy.failedAt = ports.now();
    if (convoys.start(convoy.location, convoy.label, convoy.participants, convoy.purpose, undefined, convoy.requester?.tier)) {
      // Only coordinator-restored travel is eligible; route failures stay with their normal owner.
      Object.assign(state.activeConvoy!, { restartAttempts: attempts + 1, restartRecovery: false,
        ...(convoy.ladder ? { ladder: convoy.ladder, ladderRung: convoy.ladderRung, ladderTrying: convoy.ladderTrying } : {}) });
      log("Rebuilt interrupted party convoy (attempt " + (attempts + 1) + ")");
    }
    ports.persist();
  };
}

export interface HuntTravelCheckpoint {
  at: number;
  convoyId: string;
  epoch: number;
  routeVersion: number;
  stage?: string;
  destination: { map: string; x: number; y: number };
  revisions: Record<string, number>;
  positions: Record<
    string,
    { map: string; x: number; y: number; server?: string; runtimeId?: string; progress?: unknown }
  >;
  interruption?: { at: number; reason: string };
  completedAt?: number;
}

/** Persist the obligation and observed positions, never ephemeral barrier readiness. */
// The checkpoint writes at most once a second, the base value of v1.5.0 kept: the
// positions change on every walk step, so a write on each change would cost more than the base.
export function checkpointContinuousReturn(state: SharedState, now: number): boolean {
  const c = state.activeConvoy,
    hunt = state.monsterHunt;
  if (!c?.continuousReturn || c.purpose !== "monster-hunt" || !hunt || now - (hunt.travelCheckpoint?.at || 0) < 1000) return false;
  hunt.travelCheckpoint = {
    at: now,
    convoyId: c.id,
    epoch: c.epoch,
    routeVersion: c.routeVersion || 0,
    stage: hunt.stage,
    destination: { ...c.location },
    revisions: Object.fromEntries(
      c.participants.map((n) => [n, state.navigationIntents?.[n]?.revision || 0]),
    ),
    positions: Object.fromEntries(
      c.participants.flatMap((n) => {
        const s = state.statuses[n];
        return s
          ? [
              [
                n,
                {
                  map: s.map,
                  x: s.x,
                  y: s.y,
                  server: s.server,
                  runtimeId: s.convoyNavigation?.runtimeId,
                  progress: s.movement?.progress,
                },
              ],
            ]
          : [];
      }),
    ),
  };
  return true;
}

/** Upgrade only at a stopped assembly boundary; never change an executing route. */
export function prepareContinuousReturn(c: SharedConvoy): void {
  if (!(c.purpose === "monster-hunt" && c.returnRouting || c.walkingActivity === "anniversary-staging") || c.phase !== "assemble") return;
  c.continuousReturn = 1;
  c.townFirst = false;
  c.failure = undefined;
}

/** A historical native acknowledgement remains valid only under fresh exact ownership and position. */
export function terminalSettlementMatches(state:SharedState,c:SharedConvoy,name:string,step:number,destination:RouteWaypoint,now:number):boolean {
  const status=state.statuses[name],route=sharedRoute(c),command=walkCommandOf(state, name);
  if(!status || !route || !command || !stoppedFresh(status,now))return false;
  const movement=requestObject(status.movement),receipt=requestObject(movement.terminalSettlement);
  return completedReceipt(movement,receipt) && terminalStep(route,receipt,step,destination) &&
    observedEndpoint(status,c,receipt,destination) && currentReport(status,c,command.id,command.navigationRevision,receipt) &&
    routeOwner(state,{character:name,...receipt},now);
}
function completedReceipt(movement:Record<string,unknown>,receipt:Record<string,unknown>):boolean {
  return movement.done===true && receipt.acknowledged===true && receipt.journeyId===movement.id && typeof movement.id==='string' && movement.id.length>0;
}
function terminalStep(route:SharedRoute,receipt:Record<string,unknown>,step:number,destination:RouteWaypoint):boolean {
  const geometry=requestObject(receipt.geometry),nativeDestination=requestObject(receipt.destination);
  const transitions=route.plot.filter(p=>p.town || p.transport || p.method==='leave');
  return geometry.version===route.geometry.version && geometry.fingerprint===route.geometry.fingerprint &&
    step===transitions.length-1 && receipt.step===step && sameStep(transitions[step],destination) && sameStep(nativeDestination,destination) && finalEndpoint(route,destination);
}
function observedEndpoint(status:SharedStatus,c:SharedConvoy,receipt:Record<string,unknown>,destination:RouteWaypoint):boolean {
  return typeof status.server==='string' && status.server.length>0 && (c.routeServer===undefined || status.server===c.routeServer) && receipt.server===status.server && samePosition(status,destination);
}
function currentReport(status:SharedStatus,c:SharedConvoy,commandId:number,revision:number,receipt:Record<string,unknown>):boolean {
  const r=status.convoyNavigation;
  return !!r && r.phase==='arrived' && r.routeVersion===c.routeVersion &&
    sameWalkOn({convoyId:c.id,epoch:c.epoch,id:commandId,navigationRevision:revision}, r, receipt.runtimeId as string);
}
function stoppedFresh(s:SharedStatus,now:number):boolean {
  return fresh(s.seenAt,now) && !s.rip && Number(s.hp)>0 && !s.moving && !s.transporting;
}
function instance(a:Record<string,unknown>|RouteWaypoint):string|undefined {
  const value=a.in??a.map;return typeof value==='string' || typeof value==='number' ? String(value) : undefined;
}
function samePosition(a:Record<string,unknown>|RouteWaypoint,b:RouteWaypoint):boolean {
  return a.map===b.map && instance(a)===instance(b) && Number.isFinite(a.x) && Number.isFinite(a.y) &&
    Math.hypot(Number(a.x)-b.x,Number(a.y)-b.y)<=1;
}
function sameStep(a:Record<string,unknown>|RouteWaypoint|undefined,b:RouteWaypoint):boolean {
  return !!a && a.map===b.map && instance(a)===instance(b) && a.x===b.x && a.y===b.y &&
    !!a.town===!!b.town && !!a.transport===!!b.transport && a.s===b.s && a.method===b.method;
}

function finalEndpoint(route:SharedRoute,destination:RouteWaypoint):boolean {
  return sameStep(route.plot.at(-1),destination) && samePosition(route.destination,destination);
}

/** One latest receipt per owned character; replay never mutates navigation. */
export interface CompletionReceipts { convoyCompletionReceipts?: Record<string, string> }

export function completionKey(body: Record<string, unknown>): string {
  return JSON.stringify([body.convoyId, Number(body.epoch), Number(body.commandId),
    body.runtimeId, Number(body.navigationRevision), Number(body.routeVersion)]);
}

export function rememberCompletion(state: CompletionReceipts, name: string, body: Record<string, unknown>): void {
  (state.convoyCompletionReceipts ||= {})[name] = completionKey(body);
}

interface ReadyAcknowledgement { at:number; owner:Record<string,unknown>; position:Pick<SharedStatus,'map'|'in'|'x'|'y'> }
interface Barrier { key: string; ready: Map<string, ReadyAcknowledgement>; completed: Set<string>; releasedAt?: number }
const barriers = new WeakMap<SharedConvoy, Map<string, Barrier>>();
function getBarrier(c: SharedConvoy, key: string): Barrier {
  let store = barriers.get(c); if (!store) { store = new Map(); barriers.set(c, store); }
  let barrier = store.get(key);
  if (!barrier) { barrier = {key, ready: new Map(), completed: new Set()}; store.set(key, barrier); }
  return barrier;
}
function validStep(body: Record<string, unknown>): boolean {
  return Number.isInteger(body.step) && Number(body.step) >= 0 && Number(body.step) <= 1000 && isPoint(body.destination);
}
function liveOwner(state: SharedState, body: Record<string, unknown>, now: number): boolean {
  const c = state.activeConvoy;
  return !!c && routeOwner(state, body, now) && c.phase === 'travel';
}
/** Before/after transition barriers are route-owned and ephemeral, never restored after restart. */
export function movementBarrier(state: SharedState, input: unknown, now: number): { ready?: boolean; error?: string; code?: string; waiting?: string } {
  const body = requestObject(input), c = state.activeConvoy;
  if (!c || !liveOwner(state, body, now)) return unavailable(state,body);
  if (!validStep(body)) return { error: 'Invalid transition identity' };
  const p = body.destination as Point;
  if (!publishedStep(c,body)) return {error:'Transition does not match published itinerary',code:'invalid-step'};
  const key = `${c.epoch}:${c.routeVersion}:${Number(body.step)}:${p.map}:${p.x}:${p.y}`;
  const barrier = getBarrier(c, key);
  const name = String(body.character), members = c.participants.filter(n => !c.completed.includes(n));
  if(townBlocked(state,c,barrier,body,now))return {ready:false,waiting:'fresh party observations without attackers'};
  acknowledge(state,barrier,body,name,now);
  if (body.completed === true) return completedBarrier(state,c,barrier,members,body,now);
  if (!barrier.releasedAt && members.every(n => readyOwner(state,barrier.ready.get(n),now))) barrier.releasedAt = now;
  return { ready: !!barrier.releasedAt };
}
function stopped(status:SharedStatus|undefined):status is SharedStatus {
  return !!status && !status.rip && status.hp!==0 && !status.moving && !status.transporting &&
    typeof status.map==='string' && Number.isFinite(status.x) && Number.isFinite(status.y);
}
function readyOwner(state:SharedState,ack:ReadyAcknowledgement|undefined,now:number):boolean {
  if(!ack)return false;
  const status=state.statuses[String(ack.owner.character)],position=ack.position;
  if(!fresh(ack.at,now,'report',reportClockError(status)) || !routeOwner(state,ack.owner,now))return false;
  // `seenAt` is the coordinator's own receive time, never ahead.
  return stopped(status) && status.map===position.map &&
    String(status.in??status.map)===String(position.in??position.map) &&
    Math.hypot(status.x-position.x,status.y-position.y)<=1;
}
function acknowledge(state:SharedState,barrier: Barrier, body: Record<string,unknown>, name: string, now: number): void {
  if(body.completed===true)barrier.completed.add(name);
  else if(body.ready===true && stopped(state.statuses[name])) {
    const status=state.statuses[name]!;
    // Readiness shares the existing fresh-owner window, and is valid only at
    // the same stopped native position. It never renews a client's walking lease.
    barrier.ready.set(name,{at:now,owner:{...body},position:{map:status.map,in:status.in,x:status.x,y:status.y}});
  }
  else if(!barrier.releasedAt)barrier.ready.delete(name);
}
function unavailable(state: SharedState, body: Record<string,unknown>) {
  const c=state.activeConvoy;
  if(routeIdentityOwned(state,body) && c?.phase==='travel')return {ready:false,waiting:'fresh observations'};
  return {error:'Stale movement barrier owner',code:'superseded'};
}
function publishedStep(c: SharedConvoy, body: Record<string,unknown>): boolean {
  if(!c.continuousReturn)return true;
  const step=sharedRoute(c)?.plot.filter(p=>p.town || p.transport || p.method==='leave')[Number(body.step)];
  const p=body.destination as Point & {town?:boolean;transport?:boolean;s?:number;method?:string};
  return !!step && step.map===p.map && step.x===p.x && step.y===p.y &&
    !!step.town===!!p.town && !!step.transport===!!p.transport && step.s===p.s && step.method===p.method;
}

function townBlocked(state:SharedState,c:SharedConvoy,barrier:Barrier,body:Record<string,unknown>,now:number):boolean {
  return !barrier.releasedAt && !!c.continuousReturn && !!(body.destination as {town?:boolean}).town &&
    classifyTravelDefense(state,c.participants,now).state!=='clear';
}

function completedBarrier(state:SharedState,c:SharedConvoy,barrier:Barrier,members:string[],body:Record<string,unknown>,now:number) {
  if(barrier.releasedAt)for(const peer of members)if(terminalSettlementMatches(state,c,peer,Number(body.step),body.destination as Point,now))barrier.completed.add(peer);
  return {ready:members.every(n=>barrier.completed.has(n))};
}

type Geometry = {version: number; fingerprint: string};
const same = (a: Geometry | undefined, b: Geometry) => a?.version === b.version && a.fingerprint === b.fingerprint;
export function geometryMismatch(state: SharedState, c: SharedConvoy): string[] {
  const expected = sharedRoute(c)?.geometry || state.statuses[c.leader]?.movementGeometry;
  if (!expected) return [];
  return c.participants.filter(n => !c.completed.includes(n) && !!state.statuses[n]?.movementGeometry && !same(state.statuses[n]?.movementGeometry, expected));
}
export function beginGeometryRepair(state: SharedState, c: SharedConvoy, now: number): boolean {
  if (c.geometryRepair) return false;
  // A browser can remain on an older game build after headless workers update.
  // Repair toward the newest reported build, including when the leader is stale.
  const expected = repairIdentity(state,c);
  if (!expected) return false;
  const mismatched = c.participants.filter(n=>!c.completed.includes(n) && !same(state.statuses[n]?.movementGeometry,expected));
  // An import can detect an identity change before its next heartbeat reaches us.
  const names = mismatched.length ? mismatched : c.participants.filter(n => !c.completed.includes(n));
  c.geometryRepair = {id: c.id + ':geometry:' + c.epoch, startedAt: now, expected,
    runtimes: Object.fromEntries(names.map(n => [n, characterRuntime(state.statuses[n]) || ''])), phase: 'waiting'};
  return true;
}
function repairIdentity(state: SharedState, c: SharedConvoy): Geometry | undefined {
  const identities=[sharedRoute(c)?.geometry,state.statuses[c.leader]?.movementGeometry,
    ...c.participants.map(n=>state.statuses[n]?.movementGeometry)].filter((g): g is Geometry=>!!g);
  return identities.sort((a,b)=>b.version-a.version)[0];
}
export function geometryRepairReady(state: SharedState, c: SharedConvoy, now: number): boolean {
  const repair = c.geometryRepair!;
  return c.participants.every(name => {
    if (c.completed.includes(name)) return true;
    const s = state.statuses[name];
    if (!repairStatusReady(s,now)) return false;
    if (s.server !== c.routeServer || !same(s.movementGeometry, repair.expected)) return false;
    return !repair.runtimes[name] || characterRuntime(s) !== repair.runtimes[name];
  });
}
function repairStatusReady(s: SharedState['statuses'][string], now: number): s is NonNullable<SharedState['statuses'][string]> {
  return !!s && fresh(s.seenAt, now) && !s.rip && s.hp!==0 && !s.moving;
}
export function geometryReloadSignal(state: SharedState, c: SharedConvoy, name: string) {
  const repair = c.geometryRepair;
  if (repair?.phase !== 'waiting' || repair.runtimes[name] !== characterRuntime(state.statuses[name])) return null;
  if (!c.participants.filter(n => !c.completed.includes(n)).every(n =>
    characterRuntime(state.statuses[n]) !== repair.runtimes[n] && !!repair.runtimes[n] ||
    reportMatches(state,n) && state.statuses[n]?.convoyNavigation?.phase === 'held')) return null;
  return {id: repair.id, runtimeId: repair.runtimes[name], expected:repair.expected, deadline: repair.startedAt + GEOMETRY_REPAIR_DEADLINE_MS};
}

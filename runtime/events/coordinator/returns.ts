// The event return on the coordinator. Moved from runtime/coordinator/events/ (return-types.ts,
// returns.ts, return-composition.ts, return-guards.ts, return-policy.ts, repair-return-walk.ts,
// walk-ownership.ts, failed-entry.ts, acknowledgements.ts, observation-composition.ts). The return into
// a Hunt is the `into Hunt` row (`createIntoHunt`), which reads the hunting owner's `hunt.view` and no
// field of the Hunt's record (closed).
import { partyHooks } from '../../hooks/index.ts';
import { above, taskTier, tasks } from '../../tasks/api.ts';
import type { HuntConvoy, HuntCommand } from '../../hunting/api.ts';
import { TIERS, type Tier } from '../../protocol/ranks.ts';
import type { StoredCombatLogEntry } from '../../status/api.ts';
import { merchantSlotCommand } from '../../merchant-jobs/coordinator/api.ts';
import { fresh as freshReport } from '../../protocol/reports.ts';
import { eventArea, eventKey, searchExhausted, STALE_MEMBER_GRACE_MS } from '../rules.ts';
import { inMainTown } from './occurrences.ts';
// The return rows for an event read its `return` column: the Goobrawl wait, the Franky exit, the A/B clear.
const returnRow = (event: unknown) => eventKey(event)?.return ?? null;
import { contains } from '../../hunting/api.ts';
import { RETURN_ARRIVAL_RADIUS } from '../../movement/api/coordinator.ts';
import type { AnniversaryCycle } from './anniversary.ts';
import { endHuntEventTrip, createEventObservations, leftOccurrence } from './attendance.ts';
import type { DeferredRecovery, EventAttendance, EventSession, HuntEventTrips } from './attendance.ts';
import { appendCombatLog } from '../../status/coordinator/api.ts';

export interface ReturnLocation {
  in?: string | number;
  map: string;
  x: number;
  y: number;
  label?: string;
  realm?: string;
}
export type Waypoints = Record<string, { revision: number; location: ReturnLocation | null }>;
/** A saved waypoint gains command ownership as its return journey is dispatched. */
export interface ReturnRoute {
  revision: number;
  location: ReturnLocation | null;
  commandId?: number;
  convoyId?: string;
  engagedAt?: number;
}
export interface ReturnOwner {
  participants: string[];
  waypoints?: Waypoints;
  convoyId?: string | null;
  returnDispatchedAt?: number | null;
  returnCompletedAt?: number;
  returnRoutes?: Record<string, ReturnRoute> | null;
}
// A group walk that movement releases when a member engages (movement's walk.ts `engageWalk`) hands
// on the return routes that rode it, in the anniversary cycle, the event return and each event
// session. A route that rode the released walk at the member's current revision leaves the walk. The
// engaging member's route records when it engaged. Each other member's route takes the handoff
// command movement issued it, so the return still owns that command.
interface WalkRelease {
  convoyId: string;
  participants: readonly string[];
  engaged: string;
  at: number;
  revisions: Readonly<Record<string, number | undefined>>;
  handoffs: Readonly<Record<string, number | undefined>>;
}
type RoutesOf = { returnRoutes?: Record<string, ReturnRoute | undefined> | null } | null | undefined;
export function releaseWalkRoutes(state: { anniversary?: { eventCycle?: RoutesOf } | null; eventReturn?: RoutesOf;
  eventSessions?: Record<string, RoutesOf> | null }, release: WalkRelease): void {
  for (const owner of [state.anniversary?.eventCycle, state.eventReturn, ...Object.values(state.eventSessions || {})]) {
    if (!owner?.returnRoutes) continue;
    for (const name of release.participants) {
      const route = owner.returnRoutes[name];
      if (!route || route.convoyId !== release.convoyId || route.revision !== release.revisions[name]) continue;
      delete route.convoyId;
      const handoff = release.handoffs[name];
      if (name === release.engaged) route.engagedAt = release.at;
      else if (handoff !== undefined) route.commandId = handoff;
    }
  }
}
export interface EventRecovery extends ReturnOwner {
  blocker?: string;
  postExitLocation?: ReturnLocation | null;
  phase?: "evacuating" | "handoff" | "checkpoint";
  cycleId: string;
  event: string;
  pending: string[];
  startedAt: number;
  checkpoint: ReturnLocation | null;
  deferred: string[];
  exited?: string[];
  exitSuspended?: boolean;
  exitConvoyId?: string;
  exitTownFallback?: { cycleId: string; participants: string[] };
  anniversaryRound?: string;
  // The live occurrence the return is for (the attendance session's `id`), null when its feed names none.
  occurrence?: string | null;
}
export type AnniversaryReturnCycle = AnniversaryCycle;
export interface EventReturnState {
  current: EventRecovery | null;
  last: { event: string; occurrence?: string | null } | null;
  deferred: Record<string, DeferredRecovery>;
}
export interface ReturnStatus {
  in?: string | number;
  server?: string;
  lastCommandId?: number;
  x?: number;
  y?: number;
  map?: string;
  mapEvent?: string;
  joinedEvent?: string | null;
  seenAt?: number;
  rip?: boolean;
  goobrawlCombat?: boolean;
  serverLiveEvents?: { name: string }[];
  /** Local-wall-clock native spawn deadlines; these are attendance, not liveness. */
  serverStagingEvents?: { name: string; spawnAt: number; spawnId?: number }[];
  slendermanSearchExhausted?: boolean;
  eventFeedConnected?: boolean;
  eventClockStale?: boolean;
  eventRecovery?: { cycleId: string; phase: string };
}
export interface ReturnConvoy {
  retryExhausted?: boolean;
  walkingEvent?: string;
  routeServer?: string;
  failureCode?: string;
  townFirst?: boolean;
  disableTown?: boolean;
  merchantInterruption?: unknown;
  id: string;
  phase: string;
  participants: string[];
  purpose?: string | null;
  walkingActivity?: string;
  nonPreemptible?: boolean;
  walkingParents?: Record<string, { revision: number; parentId?: number; command?: { cycleId?: string } }>;
}
interface CommandView {
  id?: number;
  convoyId?: string;
  type: string;
  cycleId?: string;
}
interface EventReturnPorts {
  huntHandoffPending?(): boolean;
  handoffToHunt?(recovery: EventRecovery): boolean;
  now(): number;
  nextCommandId(): number;
  activeNames(): string[];
  merchant(): string | null;
  enabled(name: string, event?: string): boolean;
  // `left` (attendance.ts `leftOccurrence`): a player's move took the member off the occurrence.
  left?(name: string, event: string, occurrence: string | null): boolean;
  // A Follow change moved the member into another combat group (the tasks owner's scope owner).
  moved?(name: string): boolean;
  statuses(): Readonly<Record<string, ReturnStatus | undefined>>;
  commands(): Readonly<Record<string, CommandView | undefined>>;
  clearCommand(name: string): void;
  town(name: string, recovery: EventRecovery): void;
  checkpoint(): ReturnLocation | null;
  capture(names: string[]): Waypoints;
  clearABStrategy(): void;
  convoy(): ReturnConvoy | null;
  cancelConvoy(): void;
  startExit(names: string[]): boolean;
  townBusy(): boolean;
  anniversary(): AnniversaryReturnCycle | null | undefined;
  anniversaryParticipants(): string[];
  sessions(): readonly { event: string }[];
  dispatch(owner: EventRecovery, names: string[]): boolean;
  reconcile(owner: EventRecovery): boolean;
  finish(owner: AnniversaryReturnCycle, reason: string): void;
  persist(): void;
}

function obsoleteRecoveryWalk(convoy: ReturnConvoy): boolean {
  return convoy.purpose === "shared-walk" &&
    (["farm-recovery", "anniversary-staging"].includes(convoy.walkingActivity || "") ||
      (convoy.walkingActivity === "event" && convoy.phase === "failed"));
}

export function createEventReturns(state: EventReturnState, ports: EventReturnPorts) {
  // Event exit owns movement before its first walking request. In particular,
  // Restored farming walks and failed event entry must not block the exit.
  function releaseObsoleteWalk(recovery: EventRecovery): void {
    const convoy = ports.convoy();
    if (!convoy || recovery.returnDispatchedAt || convoy.nonPreemptible ||
        !obsoleteRecoveryWalk(convoy)) return;
    const current = ports.capture(convoy.participants);
    if (!ownsWorkflowWalk(convoy, recovery, current)) return;
    ports.cancelConvoy();
    ports.persist();
  }
  function clearRecoveryCommands(recovery: EventRecovery): void {
    for (const [name, command] of Object.entries(ports.commands())) {
      if (
        command?.cycleId === recovery.cycleId &&
        ["event-return-town", "event-resume-travel"].includes(command.type)
      )
        ports.clearCommand(name);
    }
  }
  function clearOrphanRecoveryCommands(): void {
    // Commands are shared across profiles; inspect only this service's members.
    const members = new Set(ports.activeNames());
    const deferredCycles = new Set(Object.values(state.deferred).map(recovery => recovery.cycleId));
    let changed = false;
    for (const [name, command] of Object.entries(ports.commands())) {
      if (!members.has(name) || !command ||
          !["event-return-town", "event-resume-travel"].includes(command.type) ||
          typeof command.cycleId !== "string" || !command.cycleId ||
          retainedRecoveryCycle(command.cycleId, deferredCycles)) continue;
      ports.clearCommand(name);
      changed = true;
    }
    if (changed) ports.persist();
  }
  function retainedRecoveryCycle(cycleId: string, deferredCycles: Set<string>): boolean {
    return cycleId === state.current?.cycleId || cycleId === ports.anniversary()?.id || deferredCycles.has(cycleId);
  }
  function cancelPrematureGoobrawlReturn(): boolean {
    const recovery = state.current;
    if (!recovery || returnRow(recovery.event) !== 'goobrawl-wait' || !goobrawlStillFighting(ports)) return false;
    if (recoveryConvoy(recovery, ports.convoy())) ports.cancelConvoy();
    clearRecoveryCommands(recovery);
    for (const [name, deferred] of Object.entries(state.deferred))
      if (deferred.cycleId === recovery.cycleId) delete state.deferred[name];
    state.current = null;
    ports.persist();
    return true;
  }

  // `start`: a finished return keys its occurrence, so that occurrence's return never restarts
  // while no member stands on the event's map; a new occurrence starts its own. A session with no
  // occurrence id (`participate`, or a feed that gives none) names no new occurrence, so it counts
  // as the finished return's.
  function recentReturn(event: string, occurrence: string | null | undefined, forced: boolean): boolean {
    if (forced || state.last?.event !== event) return false;
    if (occurrence != null && state.last.occurrence !== occurrence) return false;
    return !ports
      .activeNames()
      .some((name) => ports.enabled(name) && ports.statuses()[name]?.mapEvent === event);
  }

  function exitParticipants(recovery: EventRecovery): string[] {
    return recovery.pending.filter(
      (name) =>
        !(recovery.exited || []).includes(name) &&
        ports.activeNames().includes(name) &&
        !!ports.statuses()[name] &&
        ports.statuses()[name]?.map !== "main",
    );
  }

  function startFrankyExitConvoy(recovery: EventRecovery): boolean {
    if (!frankyExitOwned(recovery)) return false;
    const existing = ports.convoy();
    if (existing) {
      if (existing.id !== recovery.exitConvoyId || existing.phase !== "failed") return false;
      if (existing.failureCode === 'owner-lost') return false;
      captureFailedExitTown(recovery, existing);
      ports.cancelConvoy();
    }
    const participants = exitParticipants(recovery);
    if (!participants.length || !ports.startExit(participants)) return false;
    const next = ports.convoy();
    applyExitTownFallback(recovery, next, participants);
    recovery.exitConvoyId = next?.id;
    ports.persist();
    return true;
  }
  function frankyExitOwned(recovery: EventRecovery): boolean {
    return state.current === recovery && returnRow(recovery.event) === 'franky-exit' && !recovery.exitSuspended;
  }
  function captureFailedExitTown(recovery: EventRecovery, existing: ReturnConvoy): void {
    if (existing.purpose === 'franky-exit' &&
        ['town-unavailable','town-interrupted'].includes(existing.failureCode || '') &&
        existing.participants.every(name => recovery.pending.includes(name)))
      recovery.exitTownFallback = { cycleId: recovery.cycleId, participants: [...existing.participants] };
  }
  function applyExitTownFallback(recovery: EventRecovery, next: ReturnConvoy | null, participants: string[]): void {
    const fallback = recovery.exitTownFallback;
    if (next?.purpose === 'franky-exit' && fallback?.cycleId === recovery.cycleId &&
        participants.every(name => fallback.participants.includes(name))) {
      next.townFirst = false; next.disableTown = true;
    }
  }

  function issueInitialTown(name: string, recovery: EventRecovery): void {
    if (!ports.activeNames().includes(name)) return;
    const convoy = ports.convoy();
    if (convoy?.id === recovery.exitConvoyId && convoy?.participants.includes(name)) return;
    ports.town(name, recovery);
  }

  // The merchant has its own event return, so it is never a participant of the party's. Convoys
  // never include it, and it travels as it does today: a Town and a walk of its own, through the
  // per-character return the observations already run (events/observations.ts `resumeDeferred`).
  // Its own return holds only itself, and the merchant group's event-return task while it runs.
  function participantsFor(
    event: string,
    captured: string[] | undefined,
    forced: boolean,
    occurrence: string | null,
  ): string[] {
    const merchant = ports.merchant();
    // `members`: a captured list is used as captured, so an orphaned handoff rebuilt after the
    // marker clears still returns its members; with none, the active members. The location filter
    // of goes: its goal, leaving out a member the game refused at its farm, is the attendance
    // record's, since a final join refusal ends the occurrence for every member on the realm
    // and the selection check below then leaves them out. A forced return (`/event-disabled`) skips
    // only the selection check, because the refused priest turns its own selection off.
    // A member a player's move took off the occurrence stays out of every return of it. Its
    // ended record passes the selection check again, and a Town command would undo the player's move.
    const names = Array.isArray(captured) && captured.length ? captured : ports.activeNames();
    const chosen = names.filter((name) => (forced || ports.enabled(name, event)) && !ports.left?.(name, event, occurrence));
    if (merchant && chosen.includes(merchant)) merchantReturn(merchant, event);
    return chosen.filter((name) => name !== merchant);
  }
  // The merchant row: the merchant group has no checkpoint, so the merchant's return ends in
  // Main Town (attendance.ts `resumeDeferred`). A row this occurrence already opened stays; an
  // older occurrence's row is dropped when the new one starts.
  function merchantReturn(name: string, event: string): void {
    const old = state.deferred[name];
    if (old?.phase === "merchant-return" && old.event === event) return;
    const waypoint = ports.capture([name])[name] as { revision?: number } | undefined;
    state.deferred[name] = {
      event, cycleId: "merchant-return-" + ports.now() + "-" + ports.nextCommandId(),
      checkpoint: null, navigationRevision: waypoint?.revision, deferredAt: ports.now(), phase: "merchant-return",
    };
  }

  function newRecovery(
    event: string,
    participants: string[],
    waypoints: Waypoints | undefined,
    occurrence: string | null,
  ): EventRecovery {
    return {
      phase: "evacuating",
      cycleId: "event-return-" + ports.now() + "-" + ports.nextCommandId(),
      event,
      occurrence,
      participants: participants.slice(),
      pending: participants.slice(),
      startedAt: ports.now(),
      checkpoint: ports.checkpoint(),
      waypoints: waypoints || ports.capture(participants),
      deferred: [],
    };
  }

  function waitingForCombat(event: string, forced: boolean): boolean {
    return !forced && returnRow(event) === 'goobrawl-wait' && goobrawlStillFighting(ports);
  }

  function extendForcedReturn(current: EventRecovery, session?: { participants?: string[]; waypoints?: Waypoints } | null): void {
    const joining = participantsFor(current.event, session?.participants, true, current.occurrence ?? null)
      .filter(name => !current.participants.includes(name));
    if (!joining.length) return;
    const captured = session?.waypoints || ports.capture(joining);
    current.waypoints ||= {};
    for (const name of joining) {
      if (captured[name]) current.waypoints[name] = captured[name];
      current.participants.push(name);
      current.pending.push(name);
    }
    // A later heartbeat can exhaust another member after checkpoint travel
    // was dispatched. Their Town exit must precede redispatch.
    current.returnDispatchedAt = null;
    for (const name of joining) issueInitialTown(name, current);
    ports.persist();
  }

  function reuseReturn(current: EventRecovery, event: string,
    session: { participants?: string[]; waypoints?: Waypoints } | null | undefined, forced: boolean): EventRecovery {
    if (forced && current.event === event) extendForcedReturn(current, session);
    return current;
  }

  function begin(
    event: string,
    session?: { id?: string | null; participants?: string[]; waypoints?: Waypoints } | null,
    forced = false,
  ): EventRecovery | null {
    if (waitingForCombat(event, forced)) return null;
    if (state.current) return reuseReturn(state.current, event, session, forced);
    const occurrence = session?.id ?? null;
    if (recentReturn(event, occurrence, forced)) return null;
    const participants = participantsFor(event, session?.participants, forced, occurrence);
    if (!participants.length) return null;
    const recovery = newRecovery(event, participants, session?.waypoints, occurrence);
    state.current = recovery;
    partyHooks().notify('event.returning', { members: participants, event, occurrence: recovery.cycleId, row: returnRow(event) ?? 'town', by: 'core:events' });
    releaseObsoleteWalk(recovery);
    if (returnRow(event) === 'abtesting-clear') ports.clearABStrategy();
    startFrankyExitConvoy(recovery);
    for (const name of participants) issueInitialTown(name, recovery);
    ports.persist();
    return recovery;
  }

  function complete(recovery: EventRecovery): void {
    clearRecoveryCommands(recovery);
    state.last = { event: recovery.event, occurrence: recovery.occurrence ?? null };
    const cycle = ports.anniversary();
    if (cycle && (cycle.combatEvent === recovery.event || recovery.anniversaryRound === cycle.id))
      ports.finish(cycle, "combat-event recovery complete");
    if (state.current === recovery) state.current = null;
    partyHooks().notify('event.returned', { members: recovery.participants, event: recovery.event, occurrence: recovery.cycleId, by: 'core:events' });
  }

  function returnWaiting(recovery: EventRecovery): boolean {
    return !!ports.huntHandoffPending?.() || !!recovery.pending.length || !!recovery.returnDispatchedAt;
  }
  function finishIfReady(): boolean {
    const recovery = state.current;
    if (recovery) applyReturnPolicy(recovery, ports);
    if (finishHuntReturn()) return true;
    if (!recovery || returnWaiting(recovery)) return false;
    if (anniversaryHolding(ports.anniversary(), ports) || ports.convoy() || ports.townBusy())
      return false;
    const names = recovery.participants.filter(
      (name) => !state.deferred[name] && ports.activeNames().includes(name),
    );
    recovery.phase = "checkpoint";
    if (!ports.dispatch(recovery, names)) return false;
    if (recovery.returnCompletedAt) complete(recovery);
    ports.persist();
    return true;
  }

  function finishHuntReturn(): boolean {
    const recovery = state.current;
    if (!recovery || !ports.handoffToHunt?.(recovery)) return false;
    complete(recovery);
    ports.persist();
    return true;
  }

  function suspendForAnniversary(recovery: EventRecovery, cycle: AnniversaryReturnCycle): void {
    recovery.anniversaryRound = cycle.id;
    if (recoveryConvoy(recovery, ports.convoy())) ports.cancelConvoy();
    recovery.exitSuspended = true;
    recovery.convoyId = null;
    recovery.returnDispatchedAt = null;
    recovery.returnRoutes = null;
    recovery.pending = recovery.participants.filter((name) => ports.activeNames().includes(name));
    for (const name of recovery.pending) {
      delete state.deferred[name];
      ports.town(name, recovery);
    }
    ports.persist();
  }

  function reconcileDeferred(name: string, recovery: EventRecovery): void {
    if (!state.deferred[name] || !returnedFromDeferred(name, recovery, ports)) return;
    delete state.deferred[name];
    recovery.pending = recovery.pending.filter((pending) => pending !== name);
    const convoy = ports.convoy();
    if (convoy && convoy.id === recovery.convoyId && !convoy.participants.includes(name)) {
      ports.cancelConvoy();
      recovery.convoyId = null;
    }
    ports.persist();
  }

  function joinedReturn(name: string, recovery: EventRecovery, current: Waypoints): boolean {
    const waypoint = recovery.waypoints?.[name];
    if (!waypoint?.location) return false;
    return !state.deferred[name] && !recovery.returnRoutes?.[name] &&
      current[name]?.revision === waypoint.revision && returnedFromDeferred(name, recovery, ports);
  }

  function refreshReturnParticipants(recovery: EventRecovery): void {
    if (!recovery.returnDispatchedAt || recovery.returnCompletedAt) return;
    const current = ports.capture(ports.activeNames());
    if (!recovery.participants.some(name => joinedReturn(name, recovery, current))) return;
    const convoy = ports.convoy();
    if (convoy && !recoveryConvoy(recovery, convoy)) return;
    if (convoy) ports.cancelConvoy();
    recovery.convoyId = null;
    recovery.returnDispatchedAt = null;
    recovery.returnRoutes = null;
    ports.persist();
  }

  function reconcile(): void {
    clearOrphanRecoveryCommands();
    if (cancelPrematureGoobrawlReturn()) return;
    const cycle = ports.anniversary();
    if (!state.current && lostCombatHandoff(cycle, ports))
      begin(cycle.combatEvent, { waypoints: cycle.waypoints, participants: cycle.participants });
    const recovery = state.current;
    if (!recovery) return;
    applyReturnPolicy(recovery, ports);
    if (finishHuntReturn()) return;
    repairReturnWalk(recovery, ports);
    releaseMovedMembers(recovery);
    if (!recovery.participants.length) { complete(recovery); ports.persist(); return; }
    releaseObsoleteWalk(recovery);
    if (newAnniversaryRound(cycle, recovery, ports)) suspendForAnniversary(recovery, cycle);
    for (const name of recovery.participants) reconcileDeferred(name, recovery);
    refreshReturnParticipants(recovery);
    startFrankyExitConvoy(recovery);
    reissueCommands(recovery);
    advanceReturn(recovery);
  }

  // A member a Follow change moved into another group leaves the return. Its new group's replies name
  // no return of this group, so its exit never takes this return's Town command, and a pending
  // member the return kept would hold the return in `evacuating` for good.
  function releaseMovedMembers(recovery: EventRecovery): void {
    const moved = recovery.participants.filter(name => ports.moved?.(name));
    if (!moved.length) return;
    for (const name of moved) {
      if (ports.commands()[name]?.cycleId === recovery.cycleId) ports.clearCommand(name);
      if (recovery.returnRoutes) delete recovery.returnRoutes[name];
    }
    recovery.participants = recovery.participants.filter(name => !moved.includes(name));
    recovery.pending = recovery.pending.filter(name => !moved.includes(name));
    ports.persist();
  }

  function advanceReturn(recovery: EventRecovery): void {
    if (ports.huntHandoffPending?.()) return;
    if (recovery.returnDispatchedAt) {
      if (ports.reconcile(recovery)) complete(recovery);
      ports.persist();
    } else finishIfReady();
  }

  // Owned commands and re-issue: the return owns the exit command it issued, so a member the
  // return still holds whose command is gone, or whose exit ended idle, gets it again on its next
  // fresh report.
  function reissueCommands(recovery: EventRecovery): void {
    for (const name of recovery.pending) {
      if (!ports.activeNames().includes(name) || !freshReport(ports.statuses()[name]?.seenAt, ports.now(), 'report')) continue;
      if (!ports.commands()[name] || consumedIdleExit(name, recovery)) ports.town(name, recovery);
    }
  }

  function consumedIdleExit(name: string, recovery: EventRecovery): boolean {
    const command = ports.commands()[name], status = ports.statuses()[name];
    if (command?.type !== "event-return-town" || command.cycleId !== recovery.cycleId) return false;
    if (!idleExitConsumed(status, command.id)) return false;
    if (!savedExitRevision(name, recovery)) return false;
    const convoy = ports.convoy();
    return !convoy?.participants.includes(name) || ["complete", "failed"].includes(convoy.phase);
  }

  function savedExitRevision(name: string, recovery: EventRecovery): boolean {
    const saved = recovery.waypoints?.[name];
    return !!saved && ports.capture([name])[name]?.revision === saved.revision;
  }

  function idleExitConsumed(status: ReturnType<EventReturnPorts["statuses"]>[string], commandId: number | undefined): boolean {
    if (!status || status.rip || status.eventRecovery?.phase !== "idle") return false;
    const seen = Number(status.seenAt), last = Number(status.lastCommandId);
    return freshReport(seen, ports.now(), 'report') &&
      Number.isFinite(commandId) && Number.isFinite(last) && last >= Number(commandId);
  }

  return {
    begin,
    complete,
    finishIfReady,
    reconcile,
    startFrankyExitConvoy,
    cancelPrematureGoobrawlReturn,
    goobrawlStillFighting: () => goobrawlStillFighting(ports),
  };
}

interface ComposedReturnCommand extends CommandView {
  id?: number;
  event?: string;
  checkpoint?: ReturnLocation | null;
}
interface CoordinatorReturnState extends HuntReturnState {
  eventReturn: EventReturnState["current"];
  eventReturnLast: EventReturnState["last"];
  deferredEventReturns: EventReturnState["deferred"];
  merchantCharacter: string | null;
  statuses: ReturnType<EventReturnPorts["statuses"]>;
  commands: Record<string, ComposedReturnCommand | undefined>;
  abtestingStrategy: unknown;
  activeConvoy: (NonNullable<ReturnType<EventReturnPorts["convoy"]>> & HuntConvoy & { merchantInterruption?: unknown }) | null;
  townCycle: unknown;
  anniversary: { eventCycle?: ReturnType<EventReturnPorts["anniversary"]> };
  eventSessions: Record<string, Pick<EventSession,'event'> & Partial<EventSession>>;
  eventAttendance?: EventAttendance;
}
interface ReturnCompositionPorts {
  now: () => number;
  // The tasks owner's party command counter (tasks.nextCommand).
  nextCommand: () => number;
  activeNames: () => string[];
  moved?: EventReturnPorts["moved"];
  enabled: EventReturnPorts["enabled"];
  checkpoint: EventReturnPorts["checkpoint"];
  cancelConvoy: () => void;
  startConvoy: (
    destination: ReturnLocation,
    label: string,
    names: string[],
    purpose: string,
  ) => boolean;
  anniversaryParticipants: () => string[];
  persist: () => void;
  // `into Hunt`: the hunting owner's `hunt.view(group)` names a Hunt cycle
  // for the group.
  huntCycle: () => boolean;
  navigation: {
    capture: EventReturnPorts["capture"];
    dispatch: (owner: EventRecovery, purpose: string, names: string[]) => boolean;
    reconcile: (owner: EventRecovery, purpose: string) => boolean;
    finish: EventReturnPorts["finish"];
  };
}

/** Keep recovery state attached to the coordinator while centralizing event-return command and navigation wiring. */
export function createCoordinatorEventReturns(
  state: CoordinatorReturnState,
  ports: ReturnCompositionPorts,
) {
  const intoHunt = createIntoHunt(state, { now: ports.now, capture: ports.navigation.capture, huntCycle: ports.huntCycle });
  const returns = createEventReturns(
    {
      get current() {
        return state.eventReturn;
      },
      set current(value) {
        state.eventReturn = value;
      },
      get last() {
        return state.eventReturnLast;
      },
      set last(value) {
        state.eventReturnLast = value;
      },
      get deferred() {
        return state.deferredEventReturns;
      },
    },
    {
      now: ports.now,
      nextCommandId: ports.nextCommand,
      activeNames: ports.activeNames,
      merchant: () => state.merchantCharacter,
      enabled: (name, event) => ports.enabled(name, event),
      left: (name, event, occurrence) => leftOccurrence(state, name, event, occurrence),
      moved: ports.moved,
      statuses: () => state.statuses,
      commands: () => state.commands,
      clearCommand: (name) => {
        merchantSlotCommand(state, 'event:' + String(state.commands[name]?.cycleId), null, name);
      },
      town: (name, recovery) => {
        if (intoHunt.walksAbove(name)) return;
        merchantSlotCommand(state, 'event:' + recovery.cycleId, {
          id: ports.nextCommand(),
          type: "event-return-town",
          cycleId: recovery.cycleId,
          event: recovery.event,
          checkpoint: recovery.checkpoint,
        }, name);
      },
      huntHandoffPending: intoHunt.pending,
      // The return's own walk ends with it; the resumed Hunt walks on its own.
      handoffToHunt: recovery => {
        if (!intoHunt.complete(recovery)) return false;
        const walk = state.activeConvoy;
        if (walk && (walk.id === recovery.convoyId || isRecoveryWalk(recovery, { ...walk, participants: walk.participants || [] }))) ports.cancelConvoy();
        return true;
      },
      checkpoint: () => ports.checkpoint(),
      capture: (names) => ports.navigation.capture(names),
      clearABStrategy: () => {
        state.abtestingStrategy = null;
      },
      convoy: () => state.activeConvoy,
      cancelConvoy: ports.cancelConvoy,
      startExit: (names) =>
        ports.startConvoy({ map: "main", x: 0, y: 0 }, "Mainland exit", names, "franky-exit"),
      townBusy: () => !!state.townCycle,
      anniversary: () => state.anniversary.eventCycle,
      anniversaryParticipants: ports.anniversaryParticipants,
      sessions: () => Object.values(state.eventSessions),
      dispatch: (owner, names) => ports.navigation.dispatch(owner, "event-return", names),
      reconcile: (owner) => ports.navigation.reconcile(owner, "event-return"),
      finish: (owner, reason) => ports.navigation.finish(owner, reason),
      persist: ports.persist,
    },
  );
  return { ...returns, reconcile() {
    recoverExhaustedEventEntry(state,ports,returns.begin);
    returns.reconcile();
  }};
}

function recoveryConvoy(recovery: EventRecovery, convoy: ReturnConvoy | null): boolean {
  return !!convoy && ([recovery.convoyId, recovery.exitConvoyId].includes(convoy.id) || isRecoveryWalk(recovery, convoy));
}

function goobrawlStillFighting(ports: EventReturnPorts): boolean {
  return Object.values(ports.statuses()).some(
    (status) =>
      !!status &&
      freshReport(Number(status.seenAt), ports.now(), 'presence') &&
      eventArea(status.mapEvent) &&
      status.goobrawlCombat === true &&
      !status.rip,
  );
}

function includesTarget(
  participants: readonly unknown[],
  target: AnniversaryReturnCycle["target"],
): boolean {
  return participants.includes(target);
}

// A round the anniversary still runs: not aborted, handed to combat, finished or superseded, and
// its target is one of the round's participants.
function openRound(
  cycle: AnniversaryReturnCycle | null | undefined,
  ports: EventReturnPorts,
): cycle is AnniversaryReturnCycle {
  return !!cycle && !cycle.abortedAt &&
    !cycle.combatHandoffAt && !cycle.returnCompletedAt && !cycle.supersededAt &&
    includesTarget(ports.anniversaryParticipants(), cycle.target);
}

export function anniversaryHolding(
  cycle: AnniversaryReturnCycle | null | undefined,
  ports: EventReturnPorts,
): boolean {
  return openRound(cycle, ports) && ports.now() < Number(cycle.endsAt);
}

export function newAnniversaryRound(
  cycle: AnniversaryReturnCycle | null | undefined,
  recovery: EventRecovery,
  ports: EventReturnPorts,
): cycle is AnniversaryReturnCycle {
  return openRound(cycle, ports) && Number(cycle.stagedAt) > recovery.startedAt &&
    recovery.anniversaryRound !== cycle.id;
}

function eventStillReported(event: string, ports: EventReturnPorts): boolean {
  if (ports.sessions().some((session) => session.event === event)) return true;
  return Object.values(ports.statuses()).some((status) =>
    status?.serverLiveEvents?.some((live) => live.name === event),
  );
}

export function lostCombatHandoff(
  cycle: AnniversaryReturnCycle | null | undefined,
  ports: EventReturnPorts,
): cycle is AnniversaryReturnCycle & { combatEvent: string } {
  if (!cycle?.combatHandoffAt || cycle.returnDispatchedAt || !cycle.combatEvent) return false;
  if (!(cycle.abortedAt || ports.now() >= Number(cycle.endsAt))) return false;
  return !ports.convoy() && !eventStillReported(cycle.combatEvent, ports);
}

function returnedFromDeferred(
  name: string,
  recovery: EventRecovery,
  ports: EventReturnPorts,
): boolean {
  if (!ports.activeNames().includes(name)) return false;
  const returned = ports.statuses()[name]?.eventRecovery;
  return (
    !!returned &&
    returned.cycleId === recovery.cycleId &&
    ["town-ready", "deferred-town-ready"].includes(returned.phase)
  );
}

/** Explicit policy changes replace only this recovery's checkpoint continuation. */
function applyReturnPolicy(r: EventRecovery, ports: EventReturnPorts): void {
  if (ports.huntHandoffPending?.()) return;
  if (r.postExitLocation === undefined || r.pending.length) return;
  const convoy = ports.convoy(), current = ports.capture(r.participants);
  if (!canReplace(r, ports, current)) return;
  if (convoy) ports.cancelConvoy();
  retargetMembers(r, ports, current);
  r.returnDispatchedAt = null;
  r.returnRoutes = null;
  r.convoyId = null;
  delete r.postExitLocation;
  ports.persist();
}

function retargetMembers(r: EventRecovery, ports: EventReturnPorts, current: ReturnType<EventReturnPorts["capture"]>): void {
  for (const name of r.participants) {
    const saved = r.waypoints?.[name], command = ports.commands()[name];
    if (!saved || saved.revision !== current[name]?.revision) continue;
    saved.location = r.postExitLocation || null;
    if (command?.cycleId === r.cycleId) ports.clearCommand(name);
  }
}

function canReplace(r: EventRecovery, ports: EventReturnPorts, current: ReturnType<EventReturnPorts["capture"]>): boolean {
  const convoy = ports.convoy();
  if (!convoy) return true;
  if (!recoveryConvoy(r, convoy) || convoy.nonPreemptible || convoy.merchantInterruption) return false;
  return convoy.participants.every(n => current[n]?.revision === r.waypoints?.[n]?.revision);
}

export function isRecoveryWalk(recovery: EventRecovery, convoy: ReturnConvoy): boolean {
  if (!convoy.participants.length) return false;
  if (convoy.purpose === "shared-walk" && convoy.walkingActivity === "farm-recovery")
    return convoy.participants.every(name => {
      const parent = convoy.walkingParents?.[name], route = recovery.returnRoutes?.[name];
      return !!route?.commandId && route.commandId === parent?.parentId && route.revision === parent.revision;
    });
  return convoy.purpose === "shared-walk-return" && convoy.walkingActivity === "event-return" &&
    convoy.participants.every(name => convoy.walkingParents?.[name]?.command?.cycleId === recovery.cycleId);
}

/** Exit walking predates checkpoint dispatch and need not have recovery.convoyId. */
export function repairReturnWalk(recovery: EventRecovery, ports: EventReturnPorts): void {
  const c = ports.convoy();
  if (!c || c.phase !== "failed" || c.nonPreemptible || c.merchantInterruption || !isRecoveryWalk(recovery, c)) return;
  const current = ports.capture(c.participants);
  // The re-issue row's merchant exception, read from the tasks owner's rank table: while a
  // participant's live task ranks at the merchant job's tier the repair waits for its end, since
  // cancelling the walk would end it. A participant whose task ranks above the return leaves the
  // return.
  const tier = (name: string) => tasks().assignment(name)?.tier;
  if (c.participants.some(name => tier(name) === taskTier({ kind: 'merchant-job' }))) return;
  const owned = (name: string) => { const held = tier(name); return !held || !above(held, taskTier({ kind: 'event-return' })); };
  const eligible = c.participants.filter(name => {
    const parent = c.walkingParents![name]!;
    return owned(name) && current[name]?.revision === parent.revision &&
      recovery.waypoints?.[name]?.revision === parent.revision;
  });
  if (eligible.some(name => !fresh(ports, name))) return;
  ports.cancelConvoy();
  restoreParticipants(recovery, ports, c, eligible);
  ports.persist();
}
function fresh(ports: EventReturnPorts, name: string): boolean {
  const status = ports.statuses()[name];
  return !!status && freshReport(Number(status.seenAt), ports.now(), 'report') && !status.rip;
}
function restoreParticipants(recovery: EventRecovery, ports: EventReturnPorts, c: ReturnConvoy, eligible: string[]): void {
  const commands = ports.commands();
  for (const name of c.participants) {
    if (commands[name]?.convoyId === c.id) ports.clearCommand(name);
    if (!eligible.includes(name)) {
      recovery.participants = recovery.participants.filter(n => n !== name);
      recovery.pending = recovery.pending.filter(n => n !== name);
      continue;
    }
    // A member who died in the walk respawns on Main outside Town, so it counts as returned only
    // inside the return's Town reading and otherwise gets the Town command (fork).
    if (inMainTown(ports.statuses()[name] ?? {})) {
      recovery.pending = recovery.pending.filter(n => n !== name);
    } else {
      if (!recovery.pending.includes(name)) recovery.pending.push(name);
      ports.town(name, recovery);
    }
  }
}

/** A workflow can retire its walk without superseding newer manual navigation. */
export function ownsWorkflowWalk(convoy: ReturnConvoy, owner: { participants?: string[]; waypoints?: Waypoints }, current: Waypoints): boolean {
  if (convoy.nonPreemptible || convoy.purpose !== "shared-walk") return false;
  return convoy.participants.every(name => {
    const revision = convoy.walkingParents?.[name]?.revision;
    return revision !== undefined && !!owner.participants?.includes(name) &&
      owner.waypoints?.[name]?.revision === revision && current[name]?.revision === revision;
  });
}

interface FailedEntryState {
  activeConvoy: ReturnConvoy | null;
  eventReturn: EventRecovery | null;
  eventAttendance?: EventAttendance;
  eventSessions: Record<string, Pick<EventSession,'event'> & Partial<EventSession>>;
  statuses: Readonly<Record<string, ReturnStatus | undefined>>;
  commands: Readonly<Record<string, CommandView | undefined>>;
}

function exhausted(c: ReturnConvoy | null): c is ReturnConvoy & {walkingEvent:string} {
  return !!c && c.phase==='failed' && c.retryExhausted===true &&
    c.purpose==='shared-walk' && c.walkingActivity==='event' && !!c.walkingEvent &&
    !c.nonPreemptible && !c.merchantInterruption && c.participants.length>0;
}
function freshReturnStatus(s: ReturnStatus | undefined, now:number): s is ReturnStatus {
  return !!s && freshReport(Number(s.seenAt), now, 'report');
}
function occurrenceOwned(state:FailedEntryState,c:ReturnConvoy,event:string,name:string,s:ReturnStatus) {
  const entry=state.eventAttendance?.[name]?.[event], session=state.eventSessions[name];
  if(!entry || entry.ended || entry.realm!==s.server || c.routeServer && c.routeServer!==s.server)return false;
  return participates(session,event,name);
}
function participates(session:FailedEntryState['eventSessions'][string] | undefined,event:string,name:string) {
  return session?.event===event && session.participants?.includes(name)===true;
}
function sameRevision(saved:Waypoints[string] | undefined,current:Waypoints[string] | undefined,revision:number) {
  return saved?.revision===revision && current?.revision===revision;
}
function savedWaypoint(state:FailedEntryState,c:ReturnConvoy,name:string,current:Waypoints):Waypoints[string] | undefined {
  const saved=state.eventSessions[name]?.waypoints?.[name],parent=c.walkingParents?.[name];
  const command=state.commands[name];
  if(!parent || !sameRevision(saved,current[name],parent.revision) ||
    command && command.convoyId!==c.id)return undefined;
  return saved;
}
function captureOwned(state:FailedEntryState,c:ReturnConvoy & {walkingEvent:string},current:Waypoints,names:string[],now:number) {
  const waypoints:Waypoints={};
  for(const name of c.participants){
    const s=state.statuses[name],saved=savedWaypoint(state,c,name,current);
    if(!names.includes(name) || !freshReturnStatus(s,now) || !saved || !occurrenceOwned(state,c,c.walkingEvent,name,s))return null;
    waypoints[name]=saved;
  }
  return waypoints;
}

/** Exhaustion ends this owned occurrence, so it is not readmitted. */
function recoverExhaustedEventEntry(state: FailedEntryState, ports: {
  now(): number; activeNames(): string[]; persist(): void;
  navigation: { capture(names: string[]): Waypoints };
}, begin: (event: string, session: {participants:string[];waypoints:Waypoints}, forced:boolean) => EventRecovery | null): void {
  const c=state.activeConvoy;
  if(state.eventReturn || !exhausted(c))return;
  const event=c.walkingEvent, now=ports.now(), current=ports.navigation.capture(c.participants);
  const waypoints=captureOwned(state,c,current,ports.activeNames(),now);
  if(!waypoints)return;
  // Forced begin preserves the captured checkpoint even though this occurrence
  // will no longer be eligible. Its normal exit owns defense, Town and walking.
  const recovery=begin(event,{participants:[...c.participants],waypoints},true);
  if(!recovery || recovery.event!==event)return;
  for(const name of c.participants) state.eventAttendance![name][event].ignored ||= 'travel failure';
  ports.persist();
}

export interface ReturnCommand {
  id: number;
  type: string;
  cycleId?: string;
  event?: string;
  location?: ReturnLocation;
  navigationRevision?: number;
  label?: string;
  convoyHandoff?: unknown;
}
export interface ReturnIntent {
  revision: number;
  cancelled?: boolean;
}
export interface AcknowledgementState extends HuntEventTrips {
  commands: Record<string, ReturnCommand | undefined>;
  deferredEventReturns: Record<string, DeferredRecovery | undefined>;
}
interface AcknowledgementPorts {
  now(): number;
  intent(name: string): ReturnIntent;
  nextCommand(): number;
}

/** A deferred Town acknowledgement can only resume the still-authorized checkpoint. */
export function createDeferredAcknowledgements(
  state: AcknowledgementState,
  ports: AcknowledgementPorts,
) {
  function town(name: string, deferred: DeferredRecovery): void {
    const intent = ports.intent(name);
    if (intent.cancelled || Number(deferred.navigationRevision || 0) !== intent.revision)
      deferred.checkpoint = null;
    if (!deferred.checkpoint) {
      endHuntEventTrip(state, name, deferred.event, ports.now());
      delete state.deferredEventReturns[name];
      if (state.commands[name]?.cycleId === deferred.cycleId) merchantSlotCommand(state, 'event:' + deferred.cycleId, null, name);
    } else
      merchantSlotCommand(state, 'event:' + deferred.cycleId, {
        id: ports.nextCommand(),
        type: "event-resume-travel",
        cycleId: deferred.cycleId,
        event: deferred.event,
        location: deferred.checkpoint,
        navigationRevision: ports.intent(name).revision,
        label: "the saved pre-event checkpoint",
      }, name);
    deferred.phase = "returning-to-checkpoint";
  }
  function resumed(name: string, command: ReturnCommand): void {
    if (state.deferredEventReturns[name]?.cycleId === command.cycleId)
      endHuntEventTrip(state, name, command.event, ports.now());
    merchantSlotCommand(state, 'event:' + command.cycleId, null, name);
    if (state.deferredEventReturns[name]?.cycleId === command.cycleId)
      delete state.deferredEventReturns[name];
  }
  return { town, resumed };
}

type ObservationState = Parameters<typeof createEventObservations>[0];
type ObservationPorts = Parameters<typeof createEventObservations>[1];
type Observations = ReturnType<typeof createEventObservations>;
type ObservationReport = Parameters<Observations['observe']>[0];
// The return's member rows: a member a live event takes from the return, a pending member whose presence
// lapsed, and a deferred member's resume or end. They read attendance's live and fresh tests (attendance.ts
// createEventObservations) over the same state.
function createReturnMemberRows(state: ObservationState, ports: ObservationPorts,
  k3: Pick<Observations, 'nextLiveEvent' | 'freshDeferredFighter' | 'liveFeedReady'>) {
  function releaseLiveMembers(): void {
    const recovery = state.current;
    if (!recovery) return;
    // A new occurrence of the event the party returns from takes its members too, so a return
    // the party cannot finish yet never keeps them from it.
    const released = recovery.participants.filter(name => k3.nextLiveEvent(name, recovery.event, recovery.startedAt));
    if (!released.length) return;
    for (const name of released) {
      // Retain the checkpoint until normal event authorization adopts it.
      // Merely observing a live boss must not manufacture participation.
      defer(recovery, name, 'awaiting-event-handoff');
      ports.retireDeferredWalk?.(name, recovery.cycleId);
      ports.retireDeferredCommand?.(name, recovery.cycleId);
      if (recovery.returnRoutes) delete recovery.returnRoutes[name];
    }
    recovery.participants = recovery.participants.filter(name => !released.includes(name));
    recovery.pending = recovery.pending.filter(name => !released.includes(name));
    if (!recovery.participants.length) {
      recovery.returnRoutes = null;
      recovery.returnDispatchedAt = null;
    }
    ports.persist();
    ports.finishIfReady();
  }

  // A member leaves the current return with its own deferred row at the return's checkpoint.
  function defer(recovery: EventRecovery, name: string, phase: string): void {
    state.deferred[name] = {
      event: recovery.event,
      cycleId: recovery.cycleId,
      checkpoint: ports.location(recovery, name),
      navigationRevision: ports.intent(name).revision,
      deferredAt: ports.now(),
      phase,
      returnStartedAt: recovery.startedAt,
    };
  }

  // `member`: a pending member whose presence lapsed while the lifecycle owner answers it
  // offline gets its own row. Its walk makes no progress, and the group's walk ends without it
  // (movement's `runtime-lost`, walk.ts `leaves`). A stale report alone holds the member
  // pending.
  function deferStaleMembers(): void {
    const recovery = state.current;
    if (!recovery || ports.now() - Number(recovery.startedAt) < STALE_MEMBER_GRACE_MS) return;
    const stale = recovery.pending.filter(
      (name) =>
        !ports.statuses()[name] || !freshReport(Number(ports.statuses()[name]?.seenAt), ports.now(), 'presence') && !ports.online(name),
    );
    for (const name of stale) {
      defer(recovery, name, "awaiting-reconnect");
      recovery.pending = recovery.pending.filter((pendingName) => pendingName !== name);
    }
    if (stale.length) {
      ports.persist();
      ports.finishIfReady();
    }
  }

  function invalidateCheckpoint(recovery: DeferredRecovery, name: string): number {
    const intent = ports.intent(name);
    if (intent.cancelled || Number(recovery.navigationRevision || 0) !== intent.revision)
      recovery.checkpoint = null;
    return intent.revision;
  }

  function awaitingRetiredSameEvent(name: string, recovery: DeferredRecovery): boolean {
    const report=ports.statuses()[name], intent=ports.intent(name);
    if(state.current || intent.cancelled || recovery.navigationRevision!==intent.revision ||
      !k3.freshDeferredFighter(report) || !k3.liveFeedReady(report) || !recovery.event || !ports.enabled(name,recovery.event))return false;
    return !!report?.serverLiveEvents?.some(entry=>entry.name===recovery.event &&
      !searchExhausted(entry.name, report));
  }
  function awaitEventAdmission(recovery: DeferredRecovery): void {
    if(recovery.phase==="awaiting-event-admission")return;
    recovery.phase="awaiting-event-admission";ports.persist();
  }
  function retireOldDeferredContinuation(name: string, cycleId: string): void {
    // Actual authorization adopts the checkpoint and records participation.
    // These hooks reject unrelated commands, walks and renewed navigation.
    ports.retireDeferredWalk?.(name,cycleId);
    ports.retireDeferredCommand?.(name,cycleId);
  }
  function deferredAtTown(report: ReturnStatus | undefined): boolean {
    return !!report && k3.freshDeferredFighter(report) && !report.mapEvent &&
      (report.in==null || report.in==='main') && inMainTown(report);
  }
  function retireEmptyCheckpoint(body: ObservationReport, recovery: DeferredRecovery): boolean {
    const report=ports.statuses()[body.name];
    if(recovery.phase!=='returning-to-checkpoint' || recovery.checkpoint || body.joinedEvent ||
        !deferredAtTown(report))return false;
    // Hunt policy may remove the old waypoint after its command was issued.
    // That retained command must not keep the retired return owner alive.
    retireOldDeferredContinuation(body.name,recovery.cycleId);
    if(state.deferred[body.name]!==recovery)return true;
    ports.finishDeferred?.(body.name,recovery.cycleId,recovery.event);
    delete state.deferred[body.name];
    ports.persist();return true;
  }
  function skipDeferredResume(body: ObservationReport, recovery: DeferredRecovery): boolean {
    if(awaitingRetiredSameEvent(body.name,recovery)){
      retireOldDeferredContinuation(body.name,recovery.cycleId);
      awaitEventAdmission(recovery);
      return true;
    }
    return !!k3.nextLiveEvent(body.name,recovery.event,recovery.returnStartedAt) || retireEmptyCheckpoint(body,recovery) || ports.hasCommand(body.name);
  }
  // The merchant row: the merchant's return ends on its first fresh report in Main
  // Town, whatever command its job holds.
  function merchantReturned(name: string, recovery: DeferredRecovery): boolean {
    if (recovery.phase !== 'merchant-return' || !deferredAtTown(ports.statuses()[name])) return false;
    ports.finishDeferred?.(name, recovery.cycleId, recovery.event);
    delete state.deferred[name];
    ports.persist();
    return true;
  }
  function resumeDeferred(body: ObservationReport): void {
    const recovery = state.deferred[body.name];
    if (!recovery || merchantReturned(body.name, recovery) || skipDeferredResume(body,recovery)) return;
    const atTown = inMainTown(body);
    const revision = invalidateCheckpoint(recovery, body.name);
    if (atTown && !recovery.checkpoint) delete state.deferred[body.name];
    else
      ports.command(
        body.name,
        atTown
          ? {
              id: ports.nextCommand(),
              type: "event-resume-travel",
              cycleId: recovery.cycleId,
              navigationRevision: revision,
              event: recovery.event,
              location: recovery.checkpoint,
              label: "the saved pre-event checkpoint",
            }
          : {
              id: ports.nextCommand(),
              type: "event-return-town",
              cycleId: recovery.cycleId,
              event: recovery.event,
              checkpoint: recovery.checkpoint,
              deferred: true,
            },
      );
    recovery.phase = atTown ? "returning-to-checkpoint" : "returning-to-town";
    ports.persist();
  }

  return { releaseLiveMembers, deferStaleMembers, resumeDeferred };
}
// The attendance observer with the return's member rows: each report runs attendance, then the rows in the order
// one observer ran them (the release, attendance's ended return, the stale members, the deferred resume).
export function createEventReturnObservations(state: ObservationState, ports: ObservationPorts) {
  const k3 = createEventObservations(state, ports), rows = createReturnMemberRows(state, ports, k3);
  return {
    admit: k3.admit,
    observe(body: ObservationReport): void {
      k3.observe(body);
      rows.releaseLiveMembers();
      k3.beginEndedReturn();
      rows.deferStaleMembers();
      rows.resumeDeferred(body);
    },
  };
}
interface CoordinatorState extends HuntEventTrips {
  activeConvoy?: ReturnConvoy | null;
  eventAttendance?: EventAttendance;
  eventSessions: ObservationState["sessions"];
  eventReturn: ObservationState["current"];
  deferredEventReturns: ObservationState["deferred"];
  anniversary: ObservationState["anniversary"];
  merchantCharacter: string | null;
  statuses: ReturnType<ObservationPorts["statuses"]>;
  commands: Record<string, Record<string, unknown> | undefined>;
}
type CompositionPorts = Pick<
  ObservationPorts,
  | "now"
  | "activeNames"
  | "online"
  | "enabled"
  | "admits"
  | "selected"
  | "checkpoint"
  | "persist"
  | "log"
  | "goobrawlStillFighting"
  | "begin"
  | "finishIfReady"
  | "releaseAnniversary"
  | "nextCommand"
> & {
  cancelConvoy(): void;
  navigation: Pick<ObservationPorts, "capture" | "location" | "intent">;
};

/** Live event reports and deferred reconnections share the coordinator's current command/recovery state. */
export function createCoordinatorEventObservations(
  state: CoordinatorState,
  ports: CompositionPorts,
) {
  return createEventReturnObservations(
    {
      get sessions() {
        return state.eventSessions;
      },
      get current() {
        return state.eventReturn;
      },
      get deferred() {
        return state.deferredEventReturns;
      },
      get anniversary() {
        return state.anniversary;
      },
      // The attendance records, which the add-on refusal, the rejoin slot and a new occurrence's
      // release from a return read.
      get eventAttendance() {
        return state.eventAttendance;
      },
      get huntEventTrips() {
        return state.huntEventTrips;
      },
      set huntEventTrips(trips) {
        state.huntEventTrips = trips;
      },
    },
    {
      ...ports,
      releaseAnniversary: (cycle) => {
        const convoy = state.activeConvoy;
        if (convoy?.walkingActivity === "anniversary-staging" &&
            ownsWorkflowWalk(convoy, cycle, ports.navigation.capture())) {
          ports.cancelConvoy();
          ports.persist();
        }
        ports.releaseAnniversary?.(cycle);
      },
      merchant: () => state.merchantCharacter,
      statuses: () => state.statuses,
      capture: (names) => ports.navigation.capture(names || ports.activeNames()),
      location: (recovery, name) => ports.navigation.location(recovery, name),
      intent: (name) => ports.navigation.intent(name),
      hasCommand: (name) => !!state.commands[name],
      retireDeferredWalk: (name, cycleId) => {
        const convoy = state.activeConvoy;
        if (state.deferredEventReturns[name]?.cycleId !== cycleId) return;
        if (!convoy || !convoy.participants.includes(name) ||
            !(ownsDeferredWalk(convoy, cycleId) || ownsActiveReturn(convoy, cycleId))) return;
        ports.cancelConvoy();
        ports.persist();
      },
      retireDeferredCommand: (name, cycleId) => {
        const command = state.commands[name];
        if (command?.cycleId === cycleId &&
            ['event-return-town', 'event-resume-travel'].includes(String(command.type))) merchantSlotCommand(state, 'event:' + cycleId, null, name);
      },
      finishDeferred: (name,cycleId,event) => {
        if(state.deferredEventReturns[name]?.cycleId===cycleId)
          endHuntEventTrip(state,name,event,ports.now());
      },
      command: (name, command) => {
        merchantSlotCommand(state, 'event:' + String(command.cycleId), command, name);
      },
      nextCommand: ports.nextCommand,
    },
  );

  function ownsDeferredWalk(convoy: ReturnConvoy, cycleId: string): boolean {
    if (convoy.nonPreemptible || convoy.purpose !== "shared-walk-return" ||
        convoy.walkingActivity !== "event-return" || !convoy.participants.length) return false;
    return convoy.participants.every(name => {
      const parent = convoy.walkingParents?.[name], deferred = state.deferredEventReturns[name];
      return !!parent && parent.command?.cycleId === cycleId &&
        (!deferred || deferred.cycleId === cycleId && parent.revision === deferred.navigationRevision) &&
        parent.revision === ports.navigation.intent(name).revision && ports.activeNames().includes(name) &&
        deferredCommandOwned(convoy, name, cycleId);
    });
  }
  function ownsActiveReturn(convoy: ReturnConvoy, cycleId: string): boolean {
    // Checkpoint convoys carry ownership in returnRoutes. A deferred command's
    // shared return walk uses walking parents.
    const recovery = state.eventReturn;
    if (!recovery || recovery.cycleId !== cycleId || convoy.nonPreemptible ||
        convoy.purpose !== 'event-return' || !convoy.participants.length) return false;
    return convoy.participants.every(name => {
      const route = recovery.returnRoutes?.[name];
      return recovery.participants.includes(name) && route?.convoyId === convoy.id &&
        route.revision === ports.navigation.intent(name).revision && ports.activeNames().includes(name) &&
        deferredCommandOwned(convoy, name, cycleId);
    });
  }
  function deferredCommandOwned(convoy: ReturnConvoy, name: string, cycleId: string): boolean {
    const command = state.commands[name];
    return !command || command.convoyId === convoy.id || command.cycleId === cycleId &&
      ['event-return-town', 'event-resume-travel'].includes(String(command.type));
  }
}

// The `into Hunt` row. While the group's Hunt holds a cycle (the hunting owner's `hunt.view`), the
// return walks no checkpoint: it ends `returned` once every participant stands out of the event on a
// fresh living report with no command but the return's own, and 01 resumes the Hunt task, whose own
// mission or Daisy walk takes the party on. A member whose own walk outranks the return (its
// movement holder, `movementLive`) gets no Town command, so a Hunt hand-in walk keeps its members.
// The row reads no field of the Hunt's record.
interface HuntReturnState extends HuntEventTrips {
  commands: Record<string, HuntCommand | undefined>;
  statuses: Record<string, ReturnStatus & { movementLive?: { tier?: string } | null } | undefined>;
  deferredEventReturns: Record<string, DeferredRecovery | undefined>;
  combatLogs?: Record<string, StoredCombatLogEntry[]>;
}
interface IntoHuntPorts {
  now(): number;
  capture(names: string[]): Waypoints;
  // The hunting owner's `hunt.view(group)` names a Hunt cycle for the group.
  huntCycle(): boolean;
}
function createIntoHunt(state: HuntReturnState, ports: IntoHuntPorts) {
  // The member's own walk ranks above the return's (the rank table), so the return leaves it be.
  function walksAbove(name: string): boolean {
    const tier = state.statuses[name]?.movementLive?.tier;
    return !!tier && Object.hasOwn(TIERS, tier) && above(tier as Tier, taskTier({ kind: 'event-return' }));
  }
  function exited(name: string, r: EventRecovery): boolean {
    const s = state.statuses[name];
    return !!s && freshReport(Number(s.seenAt || 0), ports.now(), 'report') && !s.rip && !!s.map && s.mapEvent !== r.event && !s.mapEvent;
  }
  // The member's command is the return's own, none, or its own walk's that ranks above the return,
  // so the exit finishes into that journey.
  function owned(name: string, r: EventRecovery): boolean {
    const command = state.commands[name];
    return !command || command.cycleId === r.cycleId || command.id === r.returnRoutes?.[name]?.commandId || walksAbove(name);
  }
  // The member's navigation is the one the return captured: a newer command took it elsewhere.
  function current(name: string, r: EventRecovery, now: Waypoints): boolean {
    return !!now[name]?.location && now[name]?.revision === r.waypoints?.[name]?.revision;
  }
  function ready(name: string, r: EventRecovery, now: Waypoints): boolean {
    if (state.deferredEventReturns[name]?.cycleId === r.cycleId) return true;
    if (!current(name, r, now)) { r.blocker = "Navigation superseded: " + name; return false; }
    if (!exited(name, r)) { r.blocker = "Waiting for a fresh report out of " + r.event + ": " + name; return false; }
    if (!owned(name, r)) { r.blocker = "Waiting for current navigation owner: " + name; return false; }
    return true;
  }
  function finishMember(name: string, r: EventRecovery): void {
    const deferred = state.deferredEventReturns[name];
    if (deferred?.cycleId === r.cycleId) { deferred.checkpoint = null; return; }
    const command = state.commands[name];
    if (command?.cycleId === r.cycleId || command?.id === r.returnRoutes?.[name]?.commandId) merchantSlotCommand(state, 'event:' + r.cycleId, null, name);
    endHuntEventTrip(state, name, r.event, ports.now());
    appendCombatLog(state.combatLogs, name, { at: ports.now(), type: "navigation",
      message: "Event exit complete after " + r.event + "; the Hunt resumes", details: { eventCycleId: r.cycleId } });
  }
  function complete(r: EventRecovery): boolean {
    if (!ports.huntCycle()) return false;
    delete r.blocker;
    const now = ports.capture(r.participants);
    if (!r.participants.length || !r.participants.every(name => ready(name, r, now))) return false;
    for (const name of r.participants) finishMember(name, r);
    r.pending = [];
    r.phase = "handoff";
    r.returnCompletedAt = ports.now();
    return true;
  }
  return { pending: ports.huntCycle, complete, walksAbove };
}

// The checkpoint the return walks back to (the `checkpoint` row), moved from
// runtime/coordinator/navigation/runtime.ts.
interface CheckpointWaypoint {
  map?: unknown;
  x?: unknown;
  y?: unknown;
  label?: string | null;
}

/** Return a normalized checkpoint only from the leader's current navigation waypoint. */
export function coordinatorEventCheckpoint(
  state: { leader: string | null },
  waypoint: (name: string | null) => CheckpointWaypoint | null | undefined,
) {
  const source = waypoint(state.leader);
  if (
    !source ||
    typeof source.map !== "string" ||
    !Number.isFinite(Number(source.x)) ||
    !Number.isFinite(Number(source.y))
  )
    return null;
  return {
    map: source.map,
    x: Number(source.x),
    y: Number(source.y),
    label: source.label || "the saved party checkpoint",
  };
}

// The return walk back to each member's saved waypoint (the `checkpoint` and `re-issue` rows): its
// deferred-return writes are the return's. The hunting owner's farming intents (hunting/coordinator/farm.ts
// `createFarmingIntents`) keep the destinations and hand them in, and tell `forget` and `retarget` when
// they change.
interface TravelOwner extends Partial<ReturnOwner> {
  id?: string;
  cycleId?: string;
  event?: string | null;
  supersededAt?: number;
  returnReason?: string;
  // The shared destination a session or the event return keeps for the whole party (attendance.ts `checkpoint`).
  destination?: ReturnLocation | null;
  checkpoint?: ReturnLocation | null;
}
interface TravelStatus {
  seenAt?: unknown; rip?: unknown; hp?: unknown; map?: unknown; in?: unknown; x?: unknown; y?: unknown;
  farmReunion?: { phase?: string } | null;
}
type TravelZone = ReturnLocation & Omit<NonNullable<Parameters<typeof contains>[0]>, keyof ReturnLocation>;
interface TravelState {
  leader: string | null;
  eventReturn?: unknown;
  eventSessions?: Record<string, unknown>;
  statuses: Record<string, unknown>;
  commands: Record<string, { id?: number } | undefined>;
  activeConvoy?: { id: string; phase?: string } | null;
  deferredEventReturns: Record<string, DeferredRecovery | undefined>;
  huntEventTrips?: HuntEventTrips['huntEventTrips'];
  anniversary: { eventCycle?: unknown; returnReady?: unknown; returnDestination?: unknown; partyHold?: unknown };
}
interface ReturnTravelHooks {
  now(): number;
  // The tasks owner's party command counter (tasks.nextCommand).
  nextCommand(): number;
  intent(name: string): { revision: number; cancelled?: boolean };
  members(): string[];
  waypoint(name: string): ReturnLocation | null;
  activeNames(): string[];
  cancelConvoy(): unknown;
  startConvoy(destination: ReturnLocation, label: string, participants: string[], purpose?: string | null): boolean;
  persist(): void;
  log(message: string, level: string): void;
}

export function createEventReturnTravel(party: TravelState, hooks: ReturnTravelHooks) {
  const now = hooks.now, intent = hooks.intent;
  function capture(names = hooks.members()): Waypoints {
    return Object.fromEntries(names.map(name => [name, {
      revision: intent(name).revision, location: hooks.waypoint(name) && { ...hooks.waypoint(name)! },
    }]));
  }
  function location(owner: Pick<ReturnOwner, 'waypoints'>, name: string): ReturnLocation | null {
    const saved = owner.waypoints && owner.waypoints[name];
    if (intent(name).cancelled) return null;
    // Legacy cycles may use only the current authorized waypoint, never a
    // historical coordinate whose relationship to navigation intent is lost.
    if (!saved) return owner.waypoints ? null : hooks.waypoint(name);
    return saved.revision === intent(name).revision ? saved.location : null;
  }
  // A member stands at its return's destination: inside its zone, or within the arrival radius the
  // hooks give (movement's landing reading). contains() reads no radius for a shaped zone.
  function at(name: string, destination: TravelZone | null | undefined, radius: number): boolean {
    const status = party.statuses[name] as TravelStatus | undefined;
    return !!(destination && status && freshReport(status.seenAt, now(), 'presence') && !status.rip && status.hp !== 0 &&
      status.map === destination.map && (destination.in == null || String(status.in ?? status.map) === String(destination.in)) &&
      (destination.boundary || destination.polygon || destination.shapes || destination.allOf
        ? contains(destination, { x: Number(status.x), y: Number(status.y) })
        : Math.hypot(Number(status.x) - destination.x, Number(status.y) - destination.y) <= radius));
  }
  // The return's identity on its commands and deferred rows: the event return's cycleId or the
  // anniversary cycle's id. dispatch's two callers pass one of the two.
  function ownerId(owner: TravelOwner): string {
    return String(owner.cycleId || owner.id);
  }
  // An offline member keeps its destination as a deferred row and resumes on reconnect.
  function deferOffline(owner: TravelOwner, name: string, route: ReturnRoute): void {
    party.deferredEventReturns[name] = { cycleId: ownerId(owner), event: owner.event || null,
      checkpoint: route.location && { ...route.location }, navigationRevision: route.revision,
      phase: 'awaiting-reconnect', deferredAt: now() };
  }
  // The pending members whose destination is the leader's, who walk it as one convoy.
  function leaderGroup(routes: Record<string, ReturnRoute>, names: string[]): string[] {
    const leaderRoute = routes[String(party.leader)];
    return leaderRoute ? names.filter(name => {
      const a = routes[name].location!, b = leaderRoute.location!;
      return a.map === b.map && a.x === b.x && a.y === b.y;
    }) : [];
  }
  // A dispatched or finished anniversary return holds the party no longer.
  function releaseAnniversaryHold(owner: TravelOwner): void {
    if (owner !== party.anniversary.eventCycle) return;
    party.anniversary.returnReady = {};
    party.anniversary.returnDestination = null;
    party.anniversary.partyHold = null;
  }
  function releaseReturn(owner: TravelOwner): boolean {
    const routes = Object.values(owner.returnRoutes || {});
    const convoy = party.activeConvoy;
    let changed = false;
    if (convoy && (convoy.id === owner.convoyId || routes.some(route => route.convoyId === convoy.id))) {
      hooks.cancelConvoy();
      changed = true;
    }
    for (const [name, route] of Object.entries(owner.returnRoutes || {})) {
      if (route.commandId && party.commands[name]?.id === route.commandId) {
        merchantSlotCommand(party, 'event:' + ownerId(owner), null, name);
        changed = true;
      }
    }
    return changed;
  }
  function finish(owner: TravelOwner, reason: string): void {
    releaseReturn(owner);
    owner.returnDispatchedAt ||= now();
    owner.returnCompletedAt = now();
    owner.returnReason = reason;
    for (const name of owner.participants || []) {
      if (party.deferredEventReturns[name]?.cycleId === ownerId(owner)) continue;
      const trip = party.huntEventTrips?.[name]?.at(-1);
      if (trip && !trip.endedAt && (trip.event === owner.event || trip.event === 'anniversary' && owner === party.anniversary.eventCycle)) trip.endedAt = now();
    }
    releaseAnniversaryHold(owner);
  }
  function dispatch(owner: TravelOwner, purpose: string, names: string[]): boolean {
    if (owner.returnCompletedAt || owner.supersededAt) return true;
    // Replayed dispatch must preserve command/convoy identities and in-flight paths.
    if (owner.returnDispatchedAt && owner.returnRoutes) { reconcile(owner, purpose); return true; }
    const routes: Record<string, ReturnRoute> = {};
    for (const name of names) {
      const destination = location(owner, name);
      if (!destination) continue;
      const route = { location: { ...destination }, revision: intent(name).revision };
      if (hooks.activeNames().includes(name)) routes[name] = route;
      else deferOffline(owner, name, route);
    }
    owner.returnRoutes = routes;
    if (!Object.keys(routes).length) { finish(owner, 'no active farming waypoint'); hooks.persist(); return true; }
    const pending = Object.keys(routes).filter(name => !at(name, routes[name].location, RETURN_ARRIVAL_RADIUS));
    if (!pending.length) { finish(owner, 'already at return destination'); hooks.persist(); return true; }
    const group = leaderGroup(routes, pending);
    // Convoys require a leader. If the leader is already there, individual
    // return commands avoid making the leader depart for another assembly.
    if (group.includes(String(party.leader))) {
      if (party.activeConvoy || !hooks.startConvoy(routes[String(party.leader)].location!,
        'the saved farming waypoint', group, purpose)) return false;
      owner.convoyId = party.activeConvoy!.id;
      for (const name of group) routes[name].convoyId = owner.convoyId;
    }
    for (const name of pending) {
      if (routes[name].convoyId) continue;
      const command = { id: hooks.nextCommand(), type: 'event-resume-travel',
        cycleId: ownerId(owner), event: owner.event || null,
        purpose, location: routes[name].location, navigationRevision: routes[name].revision,
        label: 'the saved farming waypoint' };
      merchantSlotCommand(party, 'event:' + ownerId(owner), command, name);
      routes[name].commandId = command.id;
    }
    owner.returnDispatchedAt = now();
    releaseAnniversaryHold(owner);
    hooks.persist();
    return true;
  }
  function reconcile(owner: TravelOwner, purpose: string): boolean {
    if (owner.returnCompletedAt || owner.supersededAt) {
      if (releaseReturn(owner)) {
        hooks.log('Released completed event return travel', 'info');
        hooks.persist();
      }
      return true;
    }
    const routes = owner.returnRoutes;
    if (!routes) return false;
    const pending = Object.keys(routes).filter(name => routes[name].revision === intent(name).revision &&
      !intent(name).cancelled && !routes[name].engagedAt && !at(name, routes[name].location, RETURN_ARRIVAL_RADIUS));
    if (!pending.length) { finish(owner, 'return completed'); hooks.persist(); return true; }
    // A failed barrier cannot make progress, even though its identity still matches.
    // Release only this return's convoy; manual revisions are checked above.
    const convoy = party.activeConvoy;
    if (convoy?.phase === 'failed' && pending.some(name => routes[name].convoyId === convoy.id))
      hooks.cancelConvoy();
    // Re-issue (progress rule): the return judges a member on the member's first fresh
    // report after the last dispatch, so each dispatch gets one look, with no backoff or count.
    const reportedSince = (status: TravelStatus | undefined) => freshReport(status?.seenAt, now(), 'presence') &&
      Number(status?.seenAt) > Number(owner.returnDispatchedAt);
    // A command/convoy with a different identity cannot keep this return alive.
    const missing = pending.filter(name => {
      const route = routes[name], command = party.commands[name];
      const status = party.statuses[name] as TravelStatus | undefined;
      // An offline member is missing at once and keeps a deferred waypoint below.
      if (hooks.activeNames().includes(name) && !reportedSince(status)) return false;
      // A member waiting at the farm reunion on its first report since the dispatch (one report
      // round) leaves its command, and the return sends the group walk.
      if (route.commandId === command?.id && reportedSince(status) && status?.farmReunion?.phase === 'waiting-for-party-near-farm')
        return true;
      return !(route.convoyId && party.activeConvoy && party.activeConvoy.id === route.convoyId) &&
        !(route.commandId && command && command.id === route.commandId);
    });
    if (!missing.length || party.activeConvoy) return false;
    // Offline members retain a deferred waypoint, so no retry loop runs.
    for (const name of missing.filter(name => !hooks.activeNames().includes(name))) {
      deferOffline(owner, name, routes[name]);
      delete routes[name];
    }
    const retry = missing.filter(name => hooks.activeNames().includes(name));
    if (retry.length) {
      // When everyone is still in town, individual reunion commands wait for
      // someone already at the farm. Send the leader's group there as a convoy.
      const group = retry.includes(String(party.leader)) ? leaderGroup(routes, retry) : [];
      const grouped = group.length && hooks.startConvoy(routes[String(party.leader)].location!,
        'the saved farming waypoint', group, purpose);
      if (grouped) owner.convoyId = party.activeConvoy!.id;
      for (const name of retry) {
        const route = routes[name];
        if (grouped && group.includes(name)) {
          if (party.commands[name]?.id === route.commandId) merchantSlotCommand(party, 'event:' + ownerId(owner), null, name);
          route.convoyId = owner.convoyId ?? undefined;
          delete route.commandId;
          continue;
        }
        const command = { id: hooks.nextCommand(), type: 'event-resume-travel',
          cycleId: ownerId(owner), purpose, location: route.location,
          navigationRevision: route.revision, label: 'the saved farming waypoint' };
        merchantSlotCommand(party, 'event:' + ownerId(owner), command, name);
        route.commandId = command.id;
        delete route.convoyId;
      }
      hooks.log('Retrying interrupted farming return for ' + retry.join(', '), 'info');
    }
    owner.returnDispatchedAt = now();
    hooks.persist();
    return false;
  }
  function supersede(cycle: TravelOwner | null | undefined): void {
    if (!cycle || cycle.returnCompletedAt) return;
    cycle.supersededAt = now();
    if (party.activeConvoy && party.activeConvoy.id === cycle.convoyId) hooks.cancelConvoy();
    for (const [name, route] of Object.entries(cycle.returnRoutes || {})) {
      if (party.commands[name] && party.commands[name]!.id === route.commandId) merchantSlotCommand(party, 'event:' + ownerId(cycle), null, name);
    }
    finish(cycle, 'superseded by next anniversary round');
    hooks.persist();
  }
  // The event owners whose saved waypoints follow a member's farming destination.
  const owners = () => [party.anniversary.eventCycle, party.eventReturn, ...Object.values(party.eventSessions || {})] as (TravelOwner | null | undefined)[];
  /**
   * The hunting owner's farming intents (hunting/coordinator/farm.ts `createFarmingIntents`) tell
   * 06 when a member's destination changes, and the events owner keeps its own owners' waypoints
   * current (the `checkpoint` row). `forget` follows a cancelled destination: the member's deferred
   * return and every owner's waypoint and return route for it drop, and a shared change drops the
   * owners' destination. `retarget` follows a new one in each owner still returning.
   */
  function forget(names: string[], shared: boolean): void {
    for (const name of names) {
      const deferred = party.deferredEventReturns[name];
      if (deferred) { deferred.checkpoint = null; deferred.navigationRevision = intent(name).revision; }
    }
    for (const owner of owners()) {
      if (!owner) continue;
      owner.waypoints ||= capture(owner.participants || hooks.members());
      for (const name of names) {
        owner.waypoints[name] = { revision: intent(name).revision, location: null };
        if (owner.returnRoutes) delete owner.returnRoutes[name];
      }
      if (shared) { owner.destination = null; owner.checkpoint = null; }
    }
    if (shared) party.anniversary.returnDestination = null;
  }
  function retarget(names: string[], destination: ReturnLocation, shared: boolean): void {
    for (const owner of owners()) {
      if (!owner || owner.returnCompletedAt || owner.supersededAt) continue;
      owner.waypoints ||= capture(owner.participants || hooks.members());
      for (const name of names) owner.waypoints[name] = { revision: intent(name).revision, location: { ...destination } };
      if (shared) { owner.destination = { ...destination }; owner.checkpoint = { ...destination }; }
    }
  }
  // The party's walk restarted without some members: an owner that rode the old walk rides the new.
  function convoyRestarted(from: string, to: string | null): void {
    for (const owner of [party.anniversary.eventCycle, party.eventReturn] as (TravelOwner | null | undefined)[])
      if (owner && owner.convoyId === from) owner.convoyId = to ?? undefined;
  }
  return { capture, location, at, releaseReturn, finish, dispatch, reconcile, supersede, forget, retarget, convoyRestarted };
}

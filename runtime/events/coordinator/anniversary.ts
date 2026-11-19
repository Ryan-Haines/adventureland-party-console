// The anniversary round on the coordinator: round, visits, abort, handoffs, slices, trades and supplies.
// Moved from the 14 files of runtime/coordinator/anniversary/.
import { inventoryCounts } from '../../status/api.ts';
import type { InventoryEntry } from '../../coordinator/contracts/item.ts';
import { requestText, requestObject } from '../../lifecycle/api.ts';
import type { ActivityEntry } from '../../status/api.ts';
import { endHuntEventTrip, type DeferredRecovery } from './attendance.ts';
import type { merchantAnniversaryControl } from '../../merchant-jobs/api.ts';
import { fresh, reportClockError } from '../../protocol/reports.ts';
import { anniversaryDefaults, anniversarySlices } from '../rules.ts';
import { ownsWorkflowWalk } from './returns.ts';
import type { ReturnRoute, Waypoints, ReturnLocation, ReturnConvoy } from './returns.ts';
import { realmLabel } from '../../protocol/realm.ts';

export const anniversaryLabels: Readonly<Record<string, string>> = {
  slice_strawberry: "Strawberry",
  slice_citrus: "Citrus",
  slice_honey: "Honey",
  slice_mint: "Mint",
  slice_blueberry: "Blueberry",
  slice_nightberry: "Nightberry",
};

export interface AnniversarySchedule {
  active?: boolean;
  live?: boolean;
  id?: string;
  round?: string | number;
  target?: string | null;
  expires?: number;
  next?: number;
}
export interface AnniversaryStatus {
  seenAt: number;
  ctype?: string;
  rip?: boolean;
  server?: string;
  map?: string;
  x?: number;
  y?: number;
  joinedEvent?: string;
  eventFeedAt?: number;
  anniversaryServer?: AnniversarySchedule;
  // The member's `anniversary_visit` ticket while it holds one (characters/shared.js heartbeat).
  anniversaryVisit?: unknown;
  items?: (InventoryEntry | null)[];
}
// The featured hold: while a party member is the round's target, the party stays in Main while
// another member's last report still shows its `anniversary_visit` ticket, a visit it has not
// claimed yet, and the lifecycle owner answers that member online: a member whose reports stall
// keeps the hold, and one the lifecycle owner answers offline releases it. Each reader bounds it by
// the round's end.
export function featuredVisitsPending(statuses: Readonly<Record<string, { anniversaryVisit?: unknown } | undefined>>,
  target: unknown, names: readonly string[], online: (name: string) => boolean): boolean {
  return names.some(name => name !== target && !!statuses[name]?.anniversaryVisit && online(name));
}
export interface AnniversaryRound {
  claims?: Record<
    string,
    | {
        at?: number;
        slice?: string | null;
        handedOff?: boolean;
        handedOffAt?: number;
        recovered?: boolean;
      }
    | undefined
  >;
  target?: string | null;
}
export interface AnniversaryCycle {
  id: string;
  abortedAt?: number;
  returnDispatchedAt?: number | null;
  liveRound?: string;
  target?: string | null;
  endsAt: number;
  updatedAt?: number;
  selectionLoggedRound?: string;
  startsAt?: number;
  supersededAt?: number;
  returnCompletedAt?: number;
  combatHandoffAt?: number;
  combatEvent?: string;
  combatHandoffCharacter?: string;
  combatPendingEvent?: string;
  kissOperations?: Record<string, { id: string; expiresAt: number }>;
  participants?: string[];
  waypoints?: Waypoints;
  returnRoutes?: Record<string, ReturnRoute>;
  returnReason?: string;
  abortReason?: string;
  destination?: import("./returns.ts").ReturnLocation | null;
  stagedAt?: number;
}
export interface AnniversaryState {
  nativeSlice: string | null;
  eventCycle?: AnniversaryCycle | null;
  abortedRounds: Record<string, unknown>;
  partyHold?: { target: string | null | undefined; round: string; expires: number | null } | null;
  rounds: Record<string, AnniversaryRound | undefined>;
  attempts: Record<string, Record<string, number>>;
  returnDestination?: import("./returns.ts").ReturnLocation | null;
  returnReady?: Record<string, unknown>;
  chatAdvertisement?: { id: string; message: string; queuedAt: number } | null;
  activity: ActivityEntry[];
  crafted: number;
  advertisedRounds: Record<string, unknown>;
  pendingReturns: Record<string, unknown>;
  reciprocal: Record<string, SliceTrade | undefined>;
}
export interface AnniversarySnapshotPorts {
  now(): number;
  counts(): Record<string, number>;
  statuses(): Readonly<Record<string, AnniversaryStatus | undefined>>;
  leader(): string | null;
  merchant(): string | null;
  follower(name: string): boolean;
  // The lifecycle owner's answer whether a member is online by any client
  // (roster-projection.ts `online`).
  online(name: string): boolean;
  enabled(name: string): boolean;
  owned(name: string): boolean;
  realm(name: string): string | undefined;
  log(message: string, level: string): void;
  persist(): void;
}

export function sliceQuantity(
  entries: (InventoryEntry | null)[] | undefined,
  name: string,
): number {
  return (entries || []).reduce(
    (total, entry) =>
      total + (entry?.item?.name === name ? Math.max(1, Number(entry.item.q) || 1) : 0),
    0,
  );
}

export interface AnniversaryRecoveryState {
  eventCycle?: AnniversaryCycle | null;
  abortedRounds: Record<string, unknown>;
  partyHold?: unknown;
  returnReady?: Record<string, unknown>;
}
export interface AnniversaryRecoveryPorts {
  releaseFarmingWalk?(cycle: AnniversaryCycle): void;
  now(): number;
  merchant(): string | null;
  participants(): string[];
  activeNames(): string[];
  intent(name: string): { cancelled?: boolean; revision: number };
  location(cycle: AnniversaryCycle, name: string): ReturnLocation | null;
  defer(name: string, recovery: DeferredRecovery): void;
  log(message: string, level: string): void;
  persist(): void;
  convoyBusy(): boolean;
  townBusy(): boolean;
  dispatch(cycle: AnniversaryCycle, names: string[]): boolean;
  capture(names: string[] | undefined): Waypoints;
  reconcile(cycle: AnniversaryCycle): unknown;
  // `featuredVisitsPending` over the participants' reports and the lifecycle owner's online answer.
  visitsPending(target: unknown, names: string[]): boolean;
}
export interface AnniversaryFailure {
  character?: string;
  round?: string | number;
  attempt?: number;
  // The character's approaches ended: the last made no progress, or the kiss reply left nothing to try.
  ended?: boolean;
  failureReason?: string;
  target?: string;
  navigationRevision?: number;
}
export interface AnniversaryBuffStatus {
  name?: string;
  conditions?: { id?: string; name?: string }[];
  anniversaryState?: { round?: string | number };
  anniversaryVisit?: unknown;
}
interface SavedAnniversary extends Partial<AnniversaryState> {
  [key: string]: unknown;
}

/** Saved round state overrides defaults; obsolete exclusions are discarded on restore. */
export function initialAnniversaryState(
  saved: SavedAnniversary | null | undefined,
): AnniversaryState {
  const restored = { ...saved };
  // Migration only: old saves must not reintroduce the removed feature.
  delete restored.blacklist;
  return {
    ...anniversaryDefaults(),
    ...restored,
    abortedRounds: Object.fromEntries(Object.entries(saved?.abortedRounds || {}).filter(([, value]) => (value as {reason?:string})?.reason !== "target-blacklisted")),
    attempts: saved?.attempts || {},
  };
}

export function createAnniversaryLive(state: AnniversaryState, ports: AnniversarySnapshotPorts) {
  function schedule(): AnniversarySchedule | null {
    const leader = ports.statuses()[String(ports.leader())];
    return (
      Object.values(ports.statuses())
        .filter(
          (status) =>
            status &&
            status.anniversaryServer &&
            fresh(status.seenAt, ports.now(), 'presence', 0, true) &&
            (!leader?.server || status.server === leader.server),
        )
        .sort((a, b) => Number(b!.eventFeedAt || 0) - Number(a!.eventFeedAt || 0))
        .map((status) => status!.anniversaryServer)
        .find((event) => event?.active) || null
    );
  }

  function roundKey(live: AnniversarySchedule, cycle: AnniversaryCycle): string {
    return String(live.round || live.id || live.target || cycle.id);
  }

  function synchronize(live: AnniversarySchedule | null): void {
    const cycle = state.eventCycle;
    if (
      !live ||
      !cycle ||
      cycle.abortedAt ||
      cycle.returnDispatchedAt ||
      !(Number(live.expires) > ports.now())
    )
      return;
    if (cycle.liveRound === roundKey(live, cycle) && cycle.endsAt === Number(live.expires)) return;
    updateCycle(live, cycle);
  }

  function updateCycle(live: AnniversarySchedule, cycle: AnniversaryCycle): void {
    cycle.liveRound = roundKey(live, cycle);
    cycle.target = live.target || null;
    cycle.endsAt = Number(live.expires);
    cycle.updatedAt = ports.now();
    if (live.target && cycle.selectionLoggedRound !== cycle.liveRound) {
      cycle.selectionLoggedRound = cycle.liveRound;
      ports.log(
        live.target + " was selected for the anniversary kiss",
        ports.owned(live.target) ? "featured" : "info",
      );
    }
    ports.persist();
  }

  function featured(live: AnniversarySchedule | null): boolean {
    if (
      !live ||
      state.abortedRounds[String(live.round)] ||
      !live.target ||
      !ports.enabled(live.target) ||
      live.target === ports.merchant()
    )
      return false;
    return live.target === ports.leader() || ports.follower(live.target);
  }

  function hold(live: AnniversarySchedule | null): void {
    if (!featured(live)) {
      state.partyHold = null;
      return;
    }
    const event = live!;
    const round = String(event.round || event.expires || event.target);
    if (state.partyHold?.round === round) return;
    state.partyHold = { target: event.target, round, expires: event.expires || null };
    ports.persist();
  }

  function observe() {
    const current = schedule();
    const live = current?.live ? current : null;
    synchronize(live);
    hold(live);
    return { schedule: current, live };
  }
  return { observe };
}

export function createAnniversaryAbort(
  state: AnniversaryRecoveryState,
  ports: AnniversaryRecoveryPorts,
  dispatch: () => void,
) {
  function deferAbsent(cycle: AnniversaryCycle): void {
    if (cycle.combatHandoffAt) return;
    for (const member of cycle.participants || []) {
      const location = ports.location(cycle, member);
      if (location && !ports.activeNames().includes(member))
        ports.defer(member, {
          cycleId: cycle.id,
          event: "anniversary",
          checkpoint: location,
          navigationRevision: ports.intent(member).revision,
          deferredAt: ports.now(),
          phase: "awaiting-reconnect",
        });
    }
  }

  function finish(
    cycle: AnniversaryCycle,
    round: string,
    target: string | null | undefined,
    name: string,
    reason: string,
  ) {
    const abort = {
      at: ports.now(),
      round,
      startsAt: cycle.startsAt,
      target,
      reporter: name,
      reason,
    };
    state.abortedRounds ||= {};
    state.abortedRounds[round] = abort;
    cycle.abortedAt = abort.at;
    cycle.abortReason = reason;
    state.partyHold = null;
    deferAbsent(cycle);
    ports.log(
      "Skipping anniversary round for " +
        target +
        ": " +
        reason +
        " reported by " +
        name +
        "; releasing the anniversary hold and returning to saved farming waypoints",
      "info",
    );
    ports.persist();
    dispatch();
    return { aborted: true };
  }

  function staleRound(
    cycle: AnniversaryCycle | null | undefined,
    body: AnniversaryFailure,
    name: string,
    round: string,
  ): boolean {
    return (
      !cycle ||
      !!cycle.supersededAt ||
      ![String(cycle.id), String(cycle.liveRound)].includes(round) ||
      !body.target ||
      body.target !== cycle.target ||
      ports.now() < Number(cycle.startsAt) ||
      Number(body.navigationRevision) !== ports.intent(name).revision ||
      (name !== ports.merchant() && !(cycle.participants || []).includes(name))
    );
  }

  function staleNavigation(cycle: AnniversaryCycle, name: string): boolean {
    if (name === ports.merchant()) return false;
    const intent = ports.intent(name);
    return (
      !!intent.cancelled ||
      !cycle.waypoints?.[name] ||
      cycle.waypoints[name].revision !== intent.revision
    );
  }

  function abort(body: AnniversaryFailure) {
    const cycle = state.eventCycle,
      name = String(body.character || ""),
      round = String(body.round || "");
    if (
      body.ended !== true ||
      !["target-missing", "target-unreachable", "kiss-timeout", "kiss-unconfirmed"].includes(
        body.failureReason || "",
      )
    )
      return { aborted: false };
    if (staleRound(cycle, body, name, round)) return { aborted: false, stale: true };
    if (cycle!.abortedAt) return { aborted: true, duplicate: true };
    if (staleNavigation(cycle!, name)) return { aborted: false, stale: true };
    return finish(cycle!, round, body.target, name, body.failureReason!);
  }

  return { abort, finish };
}

function target(name: string, round: string, slice: string, status: AnniversaryStatus) {
  return {
    name,
    round,
    slice,
    map: status.map,
    x: status.x,
    y: status.y,
    server: status.server,
    event: status.joinedEvent || null,
    seenAt: status.seenAt,
    ctype: status.ctype,
  };
}

function eligibleStatus(name: string, ports: AnniversarySnapshotPorts) {
  const status = ports.statuses()[name];
  if (name === ports.merchant() || !ports.owned(name) || !ports.enabled(name)) return;
  if (!status || status.ctype === "merchant" || status.rip || !fresh(status.seenAt, ports.now(), 'presence')) return;
  return status;
}

export function anniversaryHandoffs(state: AnniversaryState, ports: AnniversarySnapshotPorts) {
  const targets: ReturnType<typeof target>[] = [];
  for (const [round, entry] of Object.entries(state.rounds)) {
    for (const [name, claim] of Object.entries(entry?.claims || {})) {
      if (!claim?.slice || claim.handedOff) continue;
      const status = eligibleStatus(name, ports);
      if (status && sliceQuantity(status.items, claim.slice) > 0) targets.push(target(name, round, claim.slice, status));
    }
  }
  recoverUnreported(targets, state, ports);
  return targets;
}

function alreadyHandedOff(state: AnniversaryState, name: string, slice: string): boolean {
  return Object.values(state.rounds).some((round) => {
    const claim = round?.claims?.[name];
    return claim?.slice === slice && claim.handedOff;
  });
}

/** Inventory is authoritative when a kiss callback was missed during coordinator reload. */
function recoverUnreported(
  targets: ReturnType<typeof target>[],
  state: AnniversaryState,
  ports: AnniversarySnapshotPorts,
): void {
  for (const name of Object.keys(ports.statuses())) {
    const status = eligibleStatus(name, ports);
    if (!status) continue;
    for (const slice of anniversarySlices) {
      if (
        sliceQuantity(status.items, slice) < 1 ||
        targets.some((entry) => entry.name === name && entry.slice === slice) ||
        alreadyHandedOff(state, name, slice)
      )
        continue;
      targets.push(target(name, "recovered", slice, status));
    }
  }
}

interface State {
  targetMode?:string;
  monsterHunt?:{stage:string};
  eventReturn?:unknown;
  townCycle?:unknown;
  activeConvoy?:{id:string;phase:string;communicationHold?:unknown;merchantInterruption?:unknown;participants:string[]};
  statuses:Record<string,{seenAt:number;hp?:number;rip?:boolean;presence?:unknown;anniversaryVisit?:unknown;
    groupedCombat?:{currentAttackersAt?:number;currentAttackers?:unknown[];lootPending?:boolean}}>;
  commands:Record<string,{id?:number;convoyId?:string;cycleId?:string}>;
  deferredEventReturns:Record<string,{cycleId?:string;checkpoint?:unknown}>;
}
interface Ports {
  now():number;
  persist():void;
  navigation:{intent(name:string):{revision:number;cancelled?:boolean};finish?:(cycle:AnniversaryCycle,reason:string)=>void};
}
/**
 * An expired anniversary round yields to the Hunt's Daisy return once no kiss is pending and every
 * round member is the Hunt's, on its checkpoint's navigation revision and not busy, and its return
 * is not dispatched, or its dispatched return's farm walk failed (`failedWalk`, v1.5.0
 * expired-anniversary.ts:5-12 `failedCheckpoint`, which its failed-travel recovery passed). The
 * hunting owner's farming walk asks it, and `supersedeAnniversary` marks the round superseded and
 * ends its members' trips.
 */
export interface AnniversaryYieldState {
  anniversary?: { eventCycle?: Partial<Pick<AnniversaryCycle, 'endsAt' | 'participants' | 'returnDispatchedAt' | 'kissOperations' | 'waypoints' |
    'supersededAt' | 'returnReason'>> | null } | null;
  statuses: Record<string, { anniversaryState?: { busy?: boolean } } | undefined>;
  huntEventTrips?: Parameters<typeof endHuntEventTrip>[0]['huntEventTrips'];
}
export function anniversaryYields(state: AnniversaryYieldState, members: readonly string[], revision: (name: string) => number | undefined,
  now: number, failedWalk = false): boolean {
  const cycle = state.anniversary?.eventCycle;
  if (!cycle || !Number.isFinite(cycle.endsAt) || now < Number(cycle.endsAt)) return false;
  if (!cycle.participants?.length || cycle.returnDispatchedAt && !failedWalk) return false;
  if (Object.values(cycle.kissOperations || {}).some(op => op.expiresAt > now)) return false;
  return cycle.participants.every(name => {
    const at = cycle.waypoints?.[name]?.revision;
    return members.includes(name) && at !== undefined && at === revision(name) && !state.statuses[name]?.anniversaryState?.busy;
  });
}
export function supersedeAnniversary(state: AnniversaryYieldState, members: readonly string[], revision: (name: string) => number | undefined,
  now: number, failedWalk = false): void {
  if (!anniversaryYields(state, members, revision, now, failedWalk)) return;
  const cycle = state.anniversary!.eventCycle!;
  cycle.supersededAt = now;
  cycle.returnReason = 'Expired anniversary farming return superseded by Hunt turn-in';
  for (const name of cycle.participants!) endHuntEventTrip(state, name, 'anniversary', now);
}
/** The round handed this member to combat at its staging and has neither returned nor been superseded. */
export function anniversaryHandedOff(state: { anniversary?: { eventCycle?: Pick<AnniversaryCycle, 'participants' | 'combatHandoffAt' |
  'returnCompletedAt' | 'supersededAt'> | null } | null }, name: string): boolean {
  const cycle = state.anniversary?.eventCycle;
  return !!cycle?.combatHandoffAt && !cycle.returnCompletedAt && !cycle.supersededAt && !!cycle.participants?.includes(name);
}
/**
 * The anniversary cycle holds the party from its staging until its return completes, a next round
 * supersedes it, or the round hands the party to combat. The events owner publishes it as
 * `event.cycle`, which the hunting owner's rare yields to: the staging and the cycle's own return
 * run no 01 task.
 */
export function cycleHolds(cycle: Pick<AnniversaryCycle, 'returnCompletedAt' | 'supersededAt' | 'combatHandoffAt'> | null | undefined): boolean {
  return !!cycle && !cycle.returnCompletedAt && !cycle.supersededAt && !cycle.combatHandoffAt;
}
function pending(s:State,cycle:AnniversaryCycle):boolean {
  return !!s.monsterHunt && s.targetMode==='hunt' && !s.eventReturn && !s.townCycle && cycleHolds(cycle);
}
function convoyReady(s:State,cycle:AnniversaryCycle):boolean {
  const c=s.activeConvoy;
  if(!c)return true;
  if(c.communicationHold || c.merchantInterruption || ['defending','observing'].includes(c.phase))return false;
  return Object.values(cycle.returnRoutes||{}).some(r=>r.convoyId===c.id);
}
function commandOwned(s:State,cycle:AnniversaryCycle,n:string):boolean {
  const command=s.commands[n],route=cycle.returnRoutes?.[n];
  if(!command)return true;
  return command.cycleId===cycle.id || !!route?.commandId && command.id===route.commandId ||
    !!route?.convoyId && command.convoyId===route.convoyId;
}
function observationReady(status:State['statuses'][string]|undefined,now:number):boolean {
  if(!status || !fresh(status.seenAt, now, 'report'))return false;
  if([status.rip,status.hp===0,status.presence,status.anniversaryVisit].some(Boolean))return false;
  return combatClear(status,now);
}
function combatClear(status:State['statuses'][string],now:number):boolean {
  const g=status.groupedCombat;
  if(!g?.currentAttackersAt || !fresh(g.currentAttackersAt, now, 'report', reportClockError(status)))return false;
  return Array.isArray(g.currentAttackers) && !g.currentAttackers.length && !g.lootPending;
}
function memberReady(s:State,cycle:AnniversaryCycle,n:string,ports:Ports):boolean {
  if((s.deferredEventReturns[n]||{}).cycleId===cycle.id)return true;
  const intent=ports.navigation.intent(n), route=(cycle.returnRoutes||{})[n];
  const saved=route || (cycle.waypoints||{})[n];
  if(intent.cancelled || !saved || saved.revision!==intent.revision)return false;
  return commandOwned(s,cycle,n) && observationReady(s.statuses[n],ports.now());
}
// The handoff writes nothing into the Hunt: it resumes from its own record once its task is
// live again.
function resume(s:State,cycle:AnniversaryCycle,ports:Ports):void {
  for(const n of cycle.participants||[])if(s.deferredEventReturns[n]?.cycleId===cycle.id)s.deferredEventReturns[n].checkpoint=null;
  ports.persist();
}
/** A finished anniversary visit hands back to current Hunt policy, not its old farm. */
export function handoffAnniversaryToHunt(input:unknown,cycle:AnniversaryCycle,ports:Ports):boolean {
  const s=input as State;
  if(!pending(s,cycle) || !ports.navigation.finish || !convoyReady(s,cycle))return false;
  const names=cycle.participants||[];
  if(!names.length || !names.every(n=>memberReady(s,cycle,n,ports)))return false;
  ports.navigation.finish(cycle,'Anniversary visit complete; resuming current Hunt');
  resume(s,cycle,ports);
  return true;
}

export function createAnniversaryReturns(
  state: AnniversaryRecoveryState,
  ports: AnniversaryRecoveryPorts,
) {
  // A featured round holds while a participant's visit is pending, up to the round's end; any
  // other round holds to its end.
  function holdEnded(cycle: AnniversaryCycle): boolean {
    const names = cycle.participants || ports.participants();
    if (ports.now() >= Number(cycle.endsAt)) return true;
    return names.includes(cycle.target || "") && !ports.visitsPending(cycle.target, names);
  }

  function unavailable(cycle: AnniversaryCycle | null | undefined): boolean {
    return (
      !cycle ||
      !!cycle.returnDispatchedAt ||
      !!cycle.returnCompletedAt ||
      !!cycle.supersededAt ||
      !!cycle.combatHandoffAt ||
      ports.townBusy()
    );
  }

  function waiting(cycle: AnniversaryCycle, names: string[], force: boolean): boolean {
    if (
      !cycle.abortedAt && (ports.now() < Number(cycle.startsAt) ||
        (names.includes(cycle.target || "") && !holdEnded(cycle)))
    )
      return true;
    const ready = Object.keys(state.returnReady || {});
    return !force && !cycle.abortedAt && !names.every((name) => ready.includes(name));
  }

  function returnReason(
    cycle: AnniversaryCycle,
    featured: boolean,
    force: boolean,
  ): [string, string] {
    if (cycle.abortedAt)
      return ["anniversary target unkissable: " + cycle.abortReason, "Anniversary round skipped"];
    if (featured)
      return ["featured hold complete", "Anniversary featured hold complete: every party visit claimed"];
    if (force) return ["anniversary window ended", "Anniversary window ended"];
    return ["party completed anniversary visits", "Anniversary visits completed"];
  }

  function reportDispatch(cycle: AnniversaryCycle, force: boolean): void {
    const featured =
      !cycle.abortedAt &&
      (cycle.participants || []).includes(cycle.target || "") &&
      holdEnded(cycle);
    if (cycle.returnCompletedAt)
      ports.log("Anniversary return complete: " + cycle.returnReason, "info");
    else {
      const [reason, message] = returnReason(cycle, featured, force);
      cycle.returnReason = reason;
      ports.log(message + "; returning to saved farming waypoints", "info");
    }
    ports.persist();
  }

  function dispatch(force = false): boolean {
    const cycle = state.eventCycle;
    if (unavailable(cycle)) return false;
    const names = (cycle!.participants || ports.participants()).filter((name) =>
      ports.activeNames().includes(name),
    );
    if (waiting(cycle!, names, force)) return false;
    ports.releaseFarmingWalk?.(cycle!);
    if (ports.convoyBusy() || !ports.dispatch(cycle!, names)) return false;
    reportDispatch(cycle!, force);
    return true;
  }

  function hasCurrentBuff(cycle: AnniversaryCycle, status: AnniversaryBuffStatus): boolean {
    const buff =
      Array.isArray(status.conditions) &&
      status.conditions.some(
        (condition) =>
          condition &&
          (condition.id === "anniversary_kiss" || condition.name === "anniversary_kiss"),
      );
    return (
      buff &&
      !status.anniversaryVisit &&
      ports.now() >= Number(cycle.startsAt) &&
      [String(cycle.id), String(cycle.liveRound)].includes(String(status.anniversaryState?.round))
    );
  }

  function reconcileDispatched(cycle: AnniversaryCycle): void {
    if (!cycle.returnRoutes) {
      cycle.waypoints = ports.capture(cycle.participants);
      cycle.returnRoutes = Object.fromEntries(
        Object.entries(cycle.waypoints).filter(([, saved]) => saved.location),
      );
    }
    ports.reconcile(cycle);
  }

  function mayObserve(
    cycle: AnniversaryCycle | null | undefined,
    name: string,
  ): cycle is AnniversaryCycle {
    return (
      !!cycle &&
      !cycle.returnCompletedAt &&
      !cycle.supersededAt &&
      !cycle.combatHandoffAt &&
      name !== ports.merchant() &&
      ports.participants().includes(name)
    );
  }

  function reconcile(name: string, status: AnniversaryBuffStatus): void {
    const cycle = state.eventCycle;
    if (!mayObserve(cycle, name)) return;
    if (cycle.returnDispatchedAt) {
      reconcileDispatched(cycle);
      return;
    }
    if (!hasCurrentBuff(cycle, status)) return;
    state.returnReady ||= {};
    if (state.returnReady[name]) return;
    state.returnReady[name] = {
      at: ports.now(),
      round: status.anniversaryState?.round || cycle.liveRound || cycle.id,
      recoveredFromBuff: true,
    };
    ports.log(name + " anniversary completion recovered from the active kiss buff", "info");
    ports.persist();
    schedule();
  }

  // The dispatch a completed visit asks for: the return's next look (install.ts) makes it while no walk
  // holds the party, so at once with no walk, else on movement's walk end. The ask is one mark, so
  // asks made while a walk holds the party collapse into one dispatch.
  let dispatchAsked = false;
  function schedule(): void { dispatchAsked = true; }
  function settle(): void {
    if (!dispatchAsked || ports.convoyBusy()) return;
    dispatchAsked = false;
    dispatch(false);
  }

  function tick(): void {
    const cycle = state.eventCycle;
    // Deselection removes visitors from status-based observation. Their already
    // dispatched return still needs arrival/ownership reconciliation each tick.
    if (cycle && (cycle.returnDispatchedAt || cycle.returnCompletedAt || cycle.supersededAt)) {
      ports.reconcile(cycle);
      return;
    }
    if (
      !cycle ||
      !Number.isFinite(Number(cycle.endsAt))
    )
      return;
    dispatch(!!cycle.abortedAt || holdEnded(cycle));
  }
  const aborts = createAnniversaryAbort(state, ports, () => {
    dispatch(true);
  });
  return {
    dispatch,
    holdEnded,
    reconcile,
    tick,
    schedule,
    settle,
    abort: aborts.abort,
    finishAbort: aborts.finish,
  };
}

type RecoveryPorts = AnniversaryRecoveryPorts;
interface CoordinatorState {
  anniversary: AnniversaryRecoveryState;
  merchantCharacter: string | null;
  deferredEventReturns: Record<string, Parameters<RecoveryPorts["defer"]>[1]>;
  activeConvoy: ReturnConvoy | null;
  townCycle: unknown;
  statuses: Readonly<Record<string, { seenAt: number; anniversaryVisit?: unknown } | undefined>>;
}
type CompositionPorts = Pick<
  RecoveryPorts,
  "now" | "participants" | "activeNames" | "log" | "persist"
> & {
  cancelConvoy(): void;
  // The lifecycle owner's answer whether a member is online by any client, which the
  // featured hold asks.
  online(name: string): boolean;
  navigation: Pick<RecoveryPorts, "intent" | "location" | "capture"> & {
    dispatch: (
      cycle: Parameters<RecoveryPorts["dispatch"]>[0],
      purpose: string,
      names: string[],
    ) => boolean;
    reconcile: (cycle: Parameters<RecoveryPorts["reconcile"]>[0], purpose: string) => unknown;
    finish?: (cycle: Parameters<RecoveryPorts["dispatch"]>[0], reason: string) => void;
  };
};

/** Preserve anniversary recovery ownership while routing travel through the shared navigation service. */
export function createCoordinatorAnniversaryReturns(
  state: CoordinatorState,
  ports: CompositionPorts,
) {
  return createAnniversaryReturns(state.anniversary, {
    now: () => ports.now(),
    merchant: () => state.merchantCharacter,
    participants: () => ports.participants(),
    activeNames: () => ports.activeNames(),
    intent: (name) => ports.navigation.intent(name),
    location: (cycle, name) => ports.navigation.location(cycle, name),
    defer: (name, recovery) => {
      state.deferredEventReturns[name] = recovery;
    },
    log: (message, level) => ports.log(message, level),
    persist: () => ports.persist(),
    convoyBusy: () => !!state.activeConvoy,
    releaseFarmingWalk: cycle => {
      const convoy = state.activeConvoy;
      if (!convoy || !["farm-recovery", "anniversary-staging"].includes(convoy.walkingActivity || "")) return;
      if (convoy.participants.some(name => ports.navigation.intent(name).cancelled)) return;
      if (!ownsWorkflowWalk(convoy, cycle, ports.navigation.capture(convoy.participants))) return;
      ports.cancelConvoy();
      ports.persist();
    },
    townBusy: () => !!state.townCycle,
    dispatch: (cycle, names) => handoffAnniversaryToHunt(state,cycle,ports) || ports.navigation.dispatch(cycle, "anniversary-return", names),
    capture: (names) => ports.navigation.capture(names),
    reconcile: (cycle) => handoffAnniversaryToHunt(state,cycle,ports) || ports.navigation.reconcile(cycle, "anniversary-return"),
    visitsPending: (target, names) => featuredVisitsPending(state.statuses, target, names, ports.online),
  });
}

export function sliceBalances(counts: Record<string, number>, native: string | null) {
  const completeSets = Math.min(...anniversarySlices.map((name) => counts[name] || 0));
  const tradableNative = native ? Math.max(0, (counts[native] || 0) - completeSets) : 0;
  const totalSlices = anniversarySlices.reduce((total, name) => total + (counts[name] || 0), 0);
  const perFlavorTarget = Math.floor(totalSlices / anniversarySlices.length);
  const nativeCount = native ? counts[native] || 0 : 0;
  const tradeLimits = Object.fromEntries(
    anniversarySlices
      .filter((name) => name !== native)
      .map((name) => [
        name,
        Math.max(
          0,
          Math.min(
            perFlavorTarget - (counts[name] || 0),
            Math.floor((nativeCount - (counts[name] || 0)) / 2),
            tradableNative,
          ),
        ),
      ]),
  );
  return {
    counts,
    completeSets,
    tradableNative,
    totalSlices,
    perFlavorTarget,
    tradeLimits,
    missing: anniversarySlices.filter((name) => (tradeLimits[name] || 0) > 0),
  };
}

export function tradeAdvertisement(
  balance: ReturnType<typeof sliceBalances>,
  native: string | null,
  merchant: string | null,
  server: string | null,
) {
  if (!merchant || !native || !balance.missing.length || balance.tradableNative <= 0)
    return { message: "", chatMessage: "" };
  const nativeLabel = anniversaryLabels[native] || native || "my native slice";
  // An advert names the merchant's realm when its report or worker gives one, and no realm otherwise.
  const realm = server ? "Realm: " + realmLabel(server) + ". " : "";
  const wanted = balance.missing.map((name) => anniversaryLabels[name]).join(", ");
  const code =
    'send_item("' +
    merchant +
    '",character.items.findIndex(i=>i&&i.name==="' +
    balance.missing[0] +
    '"),1);';
  const chatMessage =
    "I trade " +
    nativeLabel +
    " Slice 1:1. Slices needed: " +
    wanted +
    ". Limit 1 per customer. Stand nearby and run: " +
    code +
    " High trust, no GP";
  const message =
    "Anniversary trade — " +
    realm +
    merchant +
    " trades " +
    nativeLabel +
    " Slice 1:1. Slices needed: " +
    wanted +
    ". Limit 1 per customer. Stand beside " +
    merchant +
    ", then run this complete example: " +
    code +
    " If unable to complete the trade, your original slice is returned.";
  return { message, chatMessage };
}

export function createAnniversarySnapshot(
  state: AnniversaryState,
  ports: AnniversarySnapshotPorts,
) {
  const event = createAnniversaryLive(state, ports);
  function roundState(live: AnniversarySchedule | null) {
    const current = live && String(live.round || live.next || live.target || "unknown");
    return {
      round: (current && state.rounds[current]) || null,
      advertised: !!(current && state.advertisedRounds[current]),
    };
  }

  function returnState() {
    return {
      returnDestination: state.returnDestination || null,
      eventCycle: state.eventCycle || null,
      chatAdvertisement: state.chatAdvertisement || null,
      pendingReturns: Object.values(state.pendingReturns || {}),
    };
  }
  function snapshot() {
    const balance = sliceBalances(ports.counts(), state.nativeSlice);
    const { live, schedule } = event.observe();
    const merchant = ports.merchant();
    const server = ports.statuses()[String(merchant)]?.server || ports.realm(String(merchant)) || null;
    const advertisement = tradeAdvertisement(balance, state.nativeSlice, merchant, server);
    return {
      ...balance,
      ...advertisement,
      slices: anniversarySlices,
      labels: anniversaryLabels,
      attempts: state.attempts,
      nativeSlice: state.nativeSlice,
      live,
      schedule,
      ...roundState(live),
      partyFeatured: !!state.partyHold,
      featuredVisitsPending: !!state.partyHold && featuredVisitsPending(ports.statuses(),
        (state.partyHold as { target?: unknown }).target, Object.keys(ports.statuses()), ports.online),
      ...returnState(),
      abortedRounds: state.abortedRounds,
      activity: state.activity.slice(-100),
      crafted: state.crafted,
      // Older character runtimes must also leave cake crafting to the exchange menu.
      craftReady: false,
      handoffTargets: anniversaryHandoffs(state, ports),
      merchant: ports.merchant(),
    };
  }
  return { snapshot };
}

interface SnapshotCoordinatorState {
  anniversary: AnniversaryState;
  statuses: ReturnType<AnniversarySnapshotPorts["statuses"]>;
  leader: string | null;
  merchantCharacter: string | null;
  followers: Record<string, unknown>;
}
type SnapshotCompositionPorts = Pick<
  AnniversarySnapshotPorts,
  "now" | "counts" | "log" | "persist" | "online"
> & {
  enabled: (name: string, event: string) => boolean;
  owned: (name: string) => unknown;
};

/** Build anniversary projections from current roster/status state and the existing anniversary record. */
export function createCoordinatorAnniversarySnapshot(
  state: SnapshotCoordinatorState,
  workers: Record<string, { realm?: string }>,
  ports: SnapshotCompositionPorts,
) {
  return createAnniversarySnapshot(state.anniversary, {
    now: () => ports.now(),
    counts: () => ports.counts(),
    statuses: () => state.statuses,
    leader: () => state.leader,
    merchant: () => state.merchantCharacter,
    follower: (name) => !!state.followers[name],
    enabled: (name) => ports.enabled(name, "anniversary"),
    owned: (name) => !!ports.owned(name),
    realm: (name) => workers[name] && workers[name].realm,
    online: ports.online,
    log: (message, level) => ports.log(message, level),
    persist: () => ports.persist(),
  });
}

type Inventory = NonNullable<Parameters<typeof inventoryCounts>[0]>[number];
interface Trade {
  identity?: string;
  owner?: unknown;
  sender?: unknown;
  state?: string;
}
interface SupplyState {
  statuses: Record<string, Inventory>;
  bankSnapshot: Parameters<typeof inventoryCounts>[1];
  bankbois?: Record<string, Inventory> | null;
  anniversary: { reciprocal?: Record<string, Trade | null | undefined> | null };
}

/** Prefer account identity so reciprocal trades cannot be repeated by another character on that account. */
export function anniversaryTradeIdentity(owner: unknown, sender: unknown): string {
  const ownerKey = owner === null || owner === undefined ? "" : requestText(owner).trim();
  return ownerKey ? "account:" + ownerKey : "character:" + requestText(sender || "").toLowerCase();
}

/** Read current storage snapshots and outstanding trades; completed returns release their identity. */
export function createAnniversarySupplies(state: SupplyState) {
  function counts(): Record<string, number> {
    const totals = inventoryCounts(
      Object.values(state.statuses),
      state.bankSnapshot,
      Object.values(state.bankbois || {}),
    );
    return Object.fromEntries(anniversarySlices.map((name) => [name, totals[name] || 0]));
  }
  function alreadyTraded(identity: string): boolean {
    return Object.values(state.anniversary.reciprocal || {}).some(
      (trade) =>
        trade &&
        (trade.identity || anniversaryTradeIdentity(trade.owner, trade.sender)) === identity &&
        trade.state !== "returned",
    );
  }
  return { counts, alreadyTraded };
}

/** Replace the merchant's stale heartbeat counts with the inventory seen during the trade. */
export function currentTradeCounts(
  counts: Record<string, number>,
  reported: unknown,
  items: (InventoryEntry | null)[] | undefined,
): Record<string, number> {
  const result = { ...counts },
    incoming = requestObject(reported);
  for (const name of anniversarySlices) {
    const quantity = Number(incoming[name]);
    if (Number.isFinite(quantity) && quantity >= 0)
      result[name] = Math.max(
        0,
        (result[name] || 0) - sliceQuantity(items, name) + Math.floor(quantity),
      );
  }
  return result;
}

/** Reserve complete sets before offering a native slice, and keep flavor counts balanced. */
export function canSwapSlice(
  native: string | null,
  incoming: string,
  counts: Record<string, number>,
): boolean {
  if (!native) return false;
  const nativeCount = counts[native] || 0,
    flavorCount = counts[incoming] || 0;
  const total = anniversarySlices.reduce((sum, name) => sum + (counts[name] || 0), 0);
  const target = Math.floor(total / anniversarySlices.length);
  const sets = Math.min(...anniversarySlices.map((name) => counts[name] || 0));
  return nativeCount - sets >= 1 && flavorCount <= target && flavorCount <= nativeCount - 1;
}

export interface SliceTrade {
  key: string;
  identity: string;
  owner: unknown;
  at: number;
  sender: string;
  incoming: string;
  outgoing: string;
  state: string;
  map: unknown;
  x: number;
  y: number;
  server: unknown;
  completedAt?: number;
}

export function tradeCompletionMessage(trade: SliceTrade, merchant: string | null): string {
  if (trade.state === "completed") return "Completed slice swap with " + trade.sender;
  if (trade.state === "returned")
    return "Returned " + trade.sender + "'s slice after an incomplete swap";
  return "Return owed to " + trade.sender + "; " + (merchant || "the merchant") + " will retry";
}

// The merchant's anniversary reservation: the merchant job owner's job rules read the merchant's
// round from its report and the round's claims (`control`, which the install hands in from the
// merchant job owner's door); the events owner answers whether the merchant attends the
// anniversary.
type MerchantStatus = Parameters<typeof merchantAnniversaryControl>[2];
export interface AnniversaryParty {
  merchantCharacter: string | null;
  statuses: Record<string, unknown>;
  anniversary: { abortedRounds: Record<string, unknown>; rounds: Record<string, { claims?: Record<string, unknown> } | undefined>;
    eventCycle?: AnniversaryCycle | null };
}
export function merchantAnniversaryState(party: AnniversaryParty, admitted: (name: string, event: string) => boolean, now: number,
  control: typeof merchantAnniversaryControl) {
  const merchant = String(party.merchantCharacter);
  const status = party.statuses[merchant] as (MerchantStatus & { anniversaryServer?: { round?: unknown } | null }) | undefined;
  const round = String(status?.anniversaryServer?.round);
  return control(party.merchantCharacter, !!party.merchantCharacter && admitted(party.merchantCharacter, 'anniversary'),
    status, party.anniversary.abortedRounds, now, party.anniversary.rounds[round]?.claims?.[merchant] ? round : undefined);
}
// The fighters the anniversary takes from combat: the admitted members but the merchant.
export function anniversaryCombatMembers(names: string[], merchant: string | null, admitted: (name: string, event: string) => boolean): string[] {
  return names.filter(name => name !== merchant && admitted(name, 'anniversary'));
}

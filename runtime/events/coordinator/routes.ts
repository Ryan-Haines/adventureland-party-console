// Every event route of the coordinator. Moved from
// runtime/coordinator/http/ (event-acknowledgements.ts, event-recovery.ts, return-progress.ts and the
// five anniversary-*.ts route files).
import { partyHooks } from '../../hooks/index.ts';
import type { InventoryEntry } from '../../coordinator/contracts/item.ts';
import { requestObject, requestText } from '../../lifecycle/api.ts';
import type { HttpRequest, HttpResponse } from '../../lifecycle/api.ts';
import type { HuntCycle } from '../../hunting/api.ts';
import { anniversaryLabels as labels, currentTradeCounts, canSwapSlice, tradeCompletionMessage } from './anniversary.ts';
import { ANNIVERSARY_WINDOW_MS, anniversarySlices, roundOrder, searchExhausted } from '../rules.ts';
import type { AnniversaryCycle, AnniversaryRound, SliceTrade, AnniversarySchedule } from './anniversary.ts';
import { manualEventOccurrenceSkipped, rejoinOccurrence } from './attendance.ts';
import type { EventAttendance } from './attendance.ts';
import { createDeferredAcknowledgements } from './returns.ts';
import { inMainTown } from './occurrences.ts';
import { fresh } from '../../protocol/reports.ts';
import { bankboiPack } from '../../items/api.ts';
import { searchReach } from '../../hunting/coordinator/api.ts';
import { endTownMembership } from '../../movement/api/coordinator.ts';
import type { AcknowledgementState, ReturnCommand, ReturnIntent, ReturnLocation, ReturnRoute, Waypoints } from './returns.ts';

interface EngagementTarget extends ReturnLocation {
  id: string;
}
interface EngagementOwner {
  returnRoutes?: Record<string, ReturnRoute | undefined> | null;
}
interface AcknowledgementRouteState extends AcknowledgementState, Omit<ReturnProgressState, "deferredEventReturns"> {
  leader: string | null;
  partyFarmingMode: string;
  monsterSearchRadiusByCharacter: Record<string, number | undefined>;
  townCycle: { id: string; pending: string[] } | null;
  eventReturn: (EngagementOwner & { cycleId: string; event: string; pending: string[]; exited?: string[] }) | null;
  anniversary: { eventCycle?: EngagementOwner | null };
  eventSessions: Record<string, EngagementOwner | undefined>;
  statuses: Record<
    string,
    | {
        map?: string;
        x?: number;
        y?: number;
        seenAt: number;
        combatSelection?: { id: string | null; map: string | null; runtimeId?: string };
      }
    | undefined
  >;
}
interface AcknowledgementRoutePorts {
  now(): number;
  owned(name: string): unknown;
  intent(name: string): ReturnIntent;
  nextCommand(): number;
  persist(): void;
  selectedDestination(name: string | null): unknown;
  finishReturn(): void;
  contains(
    location: ReturnLocation,
    target: EngagementTarget,
    margin: number,
    radius: number,
  ): boolean;
}

export function createEventAcknowledgementRoutes(
  state: AcknowledgementRouteState,
  ports: AcknowledgementRoutePorts,
) {
  const deferred = createDeferredAcknowledgements(state, {
    now: () => ports.now(),
    intent: (name) => ports.intent(name),
    nextCommand: () => ports.nextCommand(),
  });
  function townComplete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character);
    if (!ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    const command = state.commands[name];
    if (command?.type !== "town-party" || command.id !== Number(body.commandId) || state.townCycle?.id !== body.cycleId)
      return res.json({ok:true,stale:true});
    if (!atMain(name)) return res.status(409).json({error:"waiting for fresh Main town arrival"});
    endTownMembership(state, name);
    ports.persist();
    return res.json({ ok: true });
  }
  function atMain(name: string): boolean {
    const s=state.statuses[name];
    return !!s && fresh(s.seenAt, ports.now(), 'report') && inMainTown(s);
  }
  function observePosition(name: string, body: Record<string, unknown>): void {
    const status = state.statuses[name];
    if (
      status &&
      typeof body.map === "string" &&
      Number.isFinite(Number(body.x)) &&
      Number.isFinite(Number(body.y))
    ) {
      status.map = body.map;
      status.x = Number(body.x);
      status.y = Number(body.y);
    }
  }
  function acknowledgeReturn(
    name: string,
    body: Record<string, unknown>,
    res: HttpResponse,
  ): unknown {
    const recovery = state.eventReturn,
      pending = state.deferredEventReturns[name];
    if (
      (!recovery || body.cycleId !== recovery.cycleId) &&
      pending &&
      body.cycleId === pending.cycleId
    ) {
      deferred.town(name, pending);
      ports.persist();
      return res.json({ ok: true, deferred: true });
    }
    if (!recovery || body.cycleId !== recovery.cycleId) return res.json({ ok: true, stale: true });
    if (body.mapEvent === recovery.event)
      return res.status(409).json({ error: "character is still inside the ended event" });
    // Town finishes between heartbeats; destination selection must see its acknowledged position.
    observePosition(name, body);
    recovery.pending = recovery.pending.filter((member) => member !== name);
    recordExit(recovery, name);
    delete state.deferredEventReturns[name];
    const routedLeader = recovery.pending.length === 0 && !!ports.selectedDestination(state.leader);
    ports.finishReturn();
    return res.json({
      ok: true,
      pending: state.eventReturn ? state.eventReturn.pending : [],
      routedLeader,
    });
  }
  function returnComplete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character);
    if (!ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    if (!currentExit(name, body)) return res.json({ ok: true, stale: true });
    if (Number(body.navigationRevision || 0) !== ports.intent(name).revision)
      return res.status(409).json({ error: "stale navigation revision" });
    if (!atMain(name) && !mainReport(body))
      return res.status(409).json({error:"waiting for Main town arrival"});
    return acknowledgeReturn(name, body, res);
  }
  function currentExit(name: string, body: Record<string, unknown>): boolean {
    const command = state.commands[name], runtime = state.statuses[name]?.combatSelection?.runtimeId;
    if (body.commandId !== undefined && command?.id !== body.commandId) return false;
    if (runtime && body.runtimeId !== runtime) return false;
    // Legacy clients without runtime identity can only use their still-current exit command.
    return !command || command.type === "event-return-town" && command.cycleId === body.cycleId;
  }
  function mainReport(body: Record<string, unknown>): boolean {
    return typeof body.x === "number" && typeof body.y === "number" && inMainTown(body);
  }
  function currentLeader(name: string, target: EngagementTarget): boolean {
    if (state.partyFarmingMode === "scatter" || name === state.leader) return true;
    const status = state.statuses[String(state.leader)],
      lock = status?.combatSelection;
    return (
      !!lock &&
      lock.id === target.id &&
      lock.map === target.map &&
      fresh(status!.seenAt, ports.now(), 'report')
    );
  }
  function engagement(
    name: string,
    body: Record<string, unknown>,
    command: ReturnCommand,
  ): string | null {
    const target = body.engagedTarget as EngagementTarget;
    if (!currentLeader(name, target)) return "leader target changed or became stale";
    const radius = searchReach(state.monsterSearchRadiusByCharacter, state.leader || name);
    if (
      target.map !== command.location!.map ||
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y) ||
      !ports.contains(command.location!, target, 0, radius)
    )
      return "target outside destination hunt area";
    recordEngagement(name, body, command);
    return null;
  }
  function recordEngagement(
    name: string,
    body: Record<string, unknown>,
    command: ReturnCommand,
  ): void {
    for (const owner of [
      state.anniversary.eventCycle,
      state.eventReturn,
      ...Object.values(state.eventSessions),
    ]) {
      const route = owner?.returnRoutes?.[name];
      if (
        route &&
        route.commandId === command.id &&
        route.revision === Number(body.navigationRevision)
      )
        route.engagedAt = ports.now();
    }
  }
  function currentResume(
    command: ReturnCommand | undefined,
    body: Record<string, unknown>,
    name: string,
  ): command is ReturnCommand {
    return (
      !!command &&
      command.type === "event-resume-travel" &&
      command.id === Number(body.commandId) &&
      Number(body.navigationRevision || 0) === ports.intent(name).revision
    );
  }
  function resumeComplete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character);
    if (!ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    const command = state.commands[name];
    if (!currentResume(command, body, name)) return res.json({ ok: true, stale: true });
    if (command.convoyHandoff && body.engagedTarget) {
      const error = engagement(name, body, command);
      if (error) return res.status(409).json({ error });
    }
    deferred.resumed(name, command);
    ports.persist();
    return res.json({ ok: true });
  }
  return { townComplete, returnComplete, resumeComplete, progress: createReturnProgressRoute(state, ports) };
}

function recordExit(recovery: { exited?: string[] }, name: string): void {
  recovery.exited = [...new Set([...(recovery.exited || []), name])];
}

interface EventSession {
  event?: string;
  participants?: string[];
  waypoints?: Waypoints;
}
interface RecoveryState {
  eventAttendance?: EventAttendance;
  leader: string | null;
  eventReturn: { event: string } | null;
  anniversary: { eventCycle?: AnniversaryCycle | null };
  eventSessions: Record<string, EventSession | undefined>;
  statuses: Record<string, { serverLiveEvents?: { name: string }[]; slendermanSearchExhausted?: boolean } | undefined>;
}
interface RecoveryPorts {
  owned(name: string): unknown;
  enabled(name: string, event?: string): boolean;
  participants(): string[];
  active(): string[];
  abort(
    cycle: AnniversaryCycle,
    round: string,
    target: string | null | undefined,
    name: string,
    reason: string,
  ): void;
  begin(
    event: string,
    session?: EventSession,
    forced?: boolean,
  ): { cycleId: string; pending: string[] } | null;
  snapshot(): unknown;
  persist(): void;
}

export function createEventRecoveryRoutes(state: RecoveryState, ports: RecoveryPorts) {
  function disableAnniversary(name: string): void {
    const cycle = state.anniversary.eventCycle;
    if (
      !cycle ||
      cycle.returnDispatchedAt ||
      cycle.abortedAt ||
      !(cycle.participants || []).includes(name)
    )
      return;
    if (name === state.leader || !ports.participants().length)
      ports.abort(cycle, String(cycle.liveRound || cycle.id), cycle.target, name, "event-disabled");
    else {
      ports.begin("anniversary", { participants: [name], waypoints: cycle.waypoints }, true);
      cycle.participants = cycle.participants!.filter((member) => member !== name);
    }
  }
  function disableCombat(name: string, event: string): void {
    const session = state.eventSessions[name];
    if (!session || session.event !== event) return;
    // Inherited selection changes disable the whole party before individual
    // clients acknowledge them. Capture every actual participant on the first
    // call: later calls cannot replace the already-started recovery.
    const sessions = Object.values(state.eventSessions).filter(entry => entry?.event === event);
    const participants = [...new Set(sessions.flatMap(entry => entry?.participants || []))]
      .filter(member => !manualEventOccurrenceSkipped(state, member, event) && !ports.enabled(member, event) &&
        (!state.eventSessions[member] || state.eventSessions[member]?.event === event));
    if (!participants.length) return;
    const waypoints = disabledWaypoints(participants, event, sessions);
    ports.begin(event, { ...session, participants, waypoints }, true);
    for (const member of participants) delete state.eventSessions[member];
  }
  function disabledWaypoints(participants: string[], event: string, sessions: (EventSession | undefined)[]): Waypoints {
    const waypoints: Waypoints = {};
    for (const member of participants) {
      const own = state.eventSessions[member];
      const fallback = sessions.find(entry => entry?.participants?.includes(member));
      const waypoint = (own?.event === event && own.waypoints?.[member]) || fallback?.waypoints?.[member];
      if (waypoint) waypoints[member] = waypoint;
    }
    return waypoints;
  }
  function disabled(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character),
      event = requestText(body.event);
    if (ports.owned(name) && manualEventOccurrenceSkipped(state, name, event)) {
      if (state.eventSessions[name]?.event === event) delete state.eventSessions[name];
      return res.json({ ok: true, anniversary: ports.snapshot() });
    }
    if (state.eventReturn && state.eventReturn.event !== event)
      return res.status(409).json({ error: "another return is in progress" });
    if (!ports.owned(name) || ports.enabled(name, event))
      return res.status(409).json({ error: "event remains enabled" });
    if (event === "anniversary") disableAnniversary(name);
    else disableCombat(name, event);
    return res.json({ ok: true, anniversary: ports.snapshot() });
  }
  function stillInside(event: string): boolean {
    return ports.active().some((name) => {
      const status = state.statuses[name];
      return (
        ports.enabled(name, event) &&
        !searchExhausted(event, status) &&
        Array.isArray(status?.serverLiveEvents) &&
        status.serverLiveEvents.some((entry) => entry?.name === event)
      );
    });
  }
  function ended(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character),
      event = requestText(body.event);
    if (!ports.owned(name) || !ports.enabled(name))
      return res.status(400).json({ error: "event recovery requires an opted-in character" });
    if (stillInside(event))
      return res.status(409).json({ error: "an opted-in party member is still inside the event" });
    const eventName = requestText(body.event || "event");
    const session = Object.values(state.eventSessions).find((entry) => entry?.event === eventName);
    const recovery = ports.begin(eventName, session);
    return res.json({
      ok: true,
      cycleId: recovery?.cycleId || null,
      pending: recovery ? recovery.pending : [],
    });
  }
  // The rejoin route: the `event-list` slot's rejoin button posts the member and
  // the occurrence's event. Only a manual leave comes back.
  function rejoin(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body), name = requestText(body.character), event = requestText(body.event);
    if (!ports.owned(name)) return res.status(400).json({ error: "event rejoin requires a party character" });
    if (!rejoinOccurrence(state, name, event)) return res.status(409).json({ error: "only an event left by a manual move can be rejoined" });
    ports.persist();
    return res.json({ ok: true });
  }
  return { disabled, ended, rejoin };
}

export interface ReturnProgress {
  kind: string; cycleId: string; revision: number; phase: string;
  exitMap?: string; exitReconnectAttempted?: boolean;
}
export interface ReturnProgressState {
  returnProgress?: Record<string, ReturnProgress>;
  townCycle?: { id: string; pending: string[] } | null;
  eventReturn?: { cycleId: string; pending: string[] } | null;
  deferredEventReturns: Record<string, { cycleId: string } | undefined>;
}
const phases = ["local-town", "exiting-map", "main-town", "complete"];
function sameReturn(prior: ReturnProgress | undefined, next: ReturnProgress): boolean {
  return !!prior && prior.kind === next.kind && prior.cycleId === next.cycleId && prior.revision === next.revision;
}
export function createReturnProgressRoute(state: ReturnProgressState, ports: {
  owned(name: string): unknown; intent(name: string): { revision: number }; persist(): void;
}) {
  function authorized(name: string, kind: string, cycle: string): boolean {
    if (kind === "town") return state.townCycle?.id === cycle && state.townCycle.pending.includes(name);
    if (kind !== "event") return false;
    return (state.eventReturn?.cycleId === cycle && state.eventReturn.pending.includes(name)) ||
      state.deferredEventReturns[name]?.cycleId === cycle;
  }
  return function progress(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body), name = requestText(body.character);
    const kind = requestText(body.kind), cycleId = requestText(body.cycleId);
    const revision = Number(body.navigationRevision), phase = requestText(body.phase);
    if (!ports.owned(name) || ports.intent(name).revision !== revision || !authorized(name, kind, cycleId))
      return res.status(409).json({error:"return workflow superseded"});
    if (!phases.includes(phase)) return res.status(400).json({error:"invalid return phase"});
    const all = state.returnProgress ||= {}, prior = all[name];
    const same = sameReturn(prior,{kind,cycleId,revision,phase});
    if (!same || phases.indexOf(phase) > phases.indexOf(prior.phase)) {
      all[name] = { ...(same ? prior : {}), kind, cycleId, revision, phase }; ports.persist();
    }
    const before = JSON.stringify(all[name]);
    updateExitProgress(all[name]!, body, name);
    if (before !== JSON.stringify(all[name])) ports.persist();
    return res.json({ok:true, progress:all[name]});
  };
}

// The exit's fields (character/exit.ts): the event map it leaves (`exitMap`) and 1.5 row 4b's reconnect (`exitReconnectAttempted`), marked
// before the call budget owner's `realm.reconnect` logs the character in again so the reload it causes resumes past
// the rung. The mark spends the rung for the return cycle; a reconnect 09 could not send now leaves
// it open.
function updateExitProgress(progress: ReturnProgress, body: Record<string, unknown>, name: string): void {
  if (progress.kind !== "event" || typeof body.exitMap !== "string") return;
  if (progress.exitMap && progress.exitMap !== body.exitMap) return;
  progress.exitMap = body.exitMap;
  if (body.exitReconnectAttempted !== true || progress.exitReconnectAttempted) return;
  progress.exitReconnectAttempted = true;
  if (partyHooks().realm.reconnect(name) !== "sent") delete progress.exitReconnectAttempted;
}

type NavigationPorts = Parameters<typeof createAnniversaryNavigationRoutes>[1];
type AnniversaryState = Parameters<typeof createAnniversaryVisitRoutes>[0] &
  Parameters<typeof createAnniversaryNavigationRoutes>[0] &
  Parameters<typeof createAnniversaryCommerceRoutes>[0];
type ActionState = Parameters<typeof createAnniversarySuppliesRoute>[0] & {
  anniversaryAutoChat?: boolean;
  anniversary: AnniversaryState;
  leader: string | null;
  monsterHunt: HuntCycle | null;
  activeConvoy: ReturnType<NavigationPorts["convoy"]>;
  location: ReturnType<NavigationPorts["location"]>;
  statuses: Record<string, { items?: ReturnType<CommercePorts["merchantItems"]> } | undefined>;
};
type ActionPorts = Omit<
  VisitPorts & NavigationPorts & CommercePorts,
  | "merchant"
  | "leader"
  | "revision"
  | "huntOwns"
  | "convoy"
  | "location"
  | "merchantItems"
  | "enabled"
> & {
  enabled: (name: string, event: string) => boolean;
  intent: (name: string) => { revision: number };
  huntOwns: (hunt: HuntCycle | null) => boolean;
  counts: SuppliesPorts["counts"];
  persistBank: SuppliesPorts["persist"];
  merchantLog: SuppliesPorts["log"];
};

/** Share anniversary request dependencies while retaining current party navigation and merchant ownership. */
export function createCoordinatorAnniversaryActions(state: ActionState, ports: ActionPorts) {
  const common = {
    ...ports,
    merchant: () => state.merchantCharacter,
    revision: (name: string) => ports.intent(name).revision,
  };
  const visits = createAnniversaryVisitRoutes(state.anniversary, {
    ...common,
    enabled: (name) => ports.enabled(name, "anniversary"),
  });
  const navigation = createAnniversaryNavigationRoutes(state.anniversary, {
    ...common,
    leader: () => state.leader,
    huntOwns: () => ports.huntOwns(state.monsterHunt),
    convoy: () => state.activeConvoy,
    location: () => state.location,
  });
  const commerce = createAnniversaryCommerceRoutes(state.anniversary, {
    autoChat: () => state.anniversaryAutoChat === true,
    ...common,
    merchantItems: () => state.statuses[String(state.merchantCharacter)]?.items,
  });
  const supplies = createAnniversarySuppliesRoute(state, {
    counts: ports.counts,
    persist: ports.persistBank,
    log: ports.merchantLog,
  });
  return { visits, navigation, commerce, supplies };
}

interface CommerceState {
  nativeSlice: string | null;
  rounds: Record<string, AnniversaryRound | undefined>;
  advertisedRounds: Record<string, unknown>;
  chatAdvertisement?: { id: string; message: string; queuedAt: number } | null;
  reciprocal: Record<string, SliceTrade | undefined>;
  pendingReturns: Record<string, unknown>;
  crafted: number;
}
interface CommercePorts {
  autoChat?(): boolean;
  now(): number;
  nextCommand(): number;
  merchant(): string | null;
  owned(name: string): unknown;
  snapshot(): {
    message: string;
    chatMessage: string;
    tradableNative: number;
    counts: Record<string, number>;
    live?: { round?: unknown } | null;
  };
  merchantItems(): (InventoryEntry | null)[] | undefined;
  identity(owner: unknown, sender: string): string;
  alreadyTraded(identity: string): boolean;
  persist(): void;
  publish(): void;
  log(message: string, level: string): void;
}

export function createAnniversaryCommerceRoutes(state: CommerceState, ports: CommercePorts) {
  function advertise(req: HttpRequest, res: HttpResponse): unknown {
    if (!ports.autoChat?.()) return res.json({ ok: true, skipped: true, message: "" });
    const roundId = requestText(requestObject(req.body).round || "");
    if (!state.rounds[roundId]?.claims?.[String(ports.merchant())])
      return res.status(409).json({ error: "merchant kiss is not confirmed" });
    if (state.advertisedRounds[roundId])
      return res.json({ ok: true, duplicate: true, message: "" });
    const live = ports.snapshot();
    if (!live.message || live.tradableNative < 1)
      return res.json({ ok: true, skipped: true, message: "" });
    // Persist the reservation before exposing a public chat line to the caller.
    state.advertisedRounds[roundId] = { at: ports.now(), message: live.chatMessage };
    ports.log("Published the round's slice trade offer", "info");
    ports.persist();
    ports.publish();
    return res.json({ ok: true, message: live.chatMessage });
  }

  function chat(_req: HttpRequest, res: HttpResponse): unknown {
    const live = ports.snapshot();
    if (!ports.merchant() || !live.chatMessage)
      return res
        .status(409)
        .json({ error: "no anniversary chat advertisement is currently available" });
    if (state.chatAdvertisement) return res.json({ ok: true, queued: true, duplicate: true });
    state.chatAdvertisement = {
      id: "anniversary-chat-" + ports.now() + "-" + ports.nextCommand(),
      message: live.chatMessage,
      queuedAt: ports.now(),
    };
    ports.log("Queued a manual chat advertisement for " + ports.merchant(), "info");
    ports.persist();
    return res.json({ ok: true, queued: true });
  }

  function chatComplete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      pending = state.chatAdvertisement;
    if (!pending || body.id !== pending.id)
      return res.status(409).json({ error: "chat advertisement is no longer pending" });
    state.chatAdvertisement = null;
    ports.log(
      (ports.merchant() || "Merchant") + " sent the manual anniversary chat advertisement",
      "success",
    );
    ports.persist();
    return res.json({ ok: true });
  }

  function reserveTrade(
    body: Record<string, unknown>,
    sender: string,
    incoming: string,
    identity: string,
    key: string,
    native: string,
    res: HttpResponse,
  ): unknown {
    state.reciprocal[key] = {
      key,
      identity,
      owner: body.owner || null,
      at: ports.now(),
      sender,
      incoming,
      outgoing: native,
      state: "reserved",
      map: body.map || null,
      x: Number(body.x) || 0,
      y: Number(body.y) || 0,
      server: body.server || null,
    };
    ports.log(
      "Accepted 1:1 slice trade with " + sender + ": " + (labels[incoming] || incoming),
      "success",
    );
    ports.persist();
    return res.json({ action: "swap", item: native, key });
  }

  function offer(
    body: Record<string, unknown>,
    sender: string,
    incoming: string,
    round: string,
    counts: Record<string, number>,
    res: HttpResponse,
  ): unknown {
    if (ports.owned(sender) || incoming === state.nativeSlice)
      return res.json({ action: "ignore" });
    const identity = ports.identity(body.owner, sender),
      key = round + ":" + identity;
    if (ports.alreadyTraded(identity) || state.reciprocal[key])
      return res.json({ action: "return", item: incoming, reason: "identity limit reached" });
    const current = currentTradeCounts(counts, body.counts, ports.merchantItems());
    if (!canSwapSlice(state.nativeSlice, incoming, current))
      return res.json({ action: "return", item: incoming });
    return reserveTrade(body, sender, incoming, identity, key, state.nativeSlice!, res);
  }

  function trade(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      sender = requestText(body.sender || ""),
      incoming = requestText(body.item || "");
    const live = ports.snapshot(),
      round = requestText(body.round || live.live?.round || "none");
    if (!sender || !anniversarySlices.includes(incoming))
      return res.status(400).json({ error: "invalid anniversary trade" });
    return offer(body, sender, incoming, round, live.counts, res);
  }

  function tradeComplete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      key = requestText(body.key || ""),
      trade = state.reciprocal[key];
    if (!trade) return res.status(404).json({ error: "anniversary trade not found" });
    trade.state =
      body.state === "completed"
        ? "completed"
        : body.state === "returned"
          ? "returned"
          : "return_owed";
    trade.completedAt = ports.now();
    if (trade.state === "return_owed")
      state.pendingReturns[key] = {
        key,
        sender: trade.sender,
        item: trade.incoming,
        map: trade.map,
        x: trade.x,
        y: trade.y,
        server: trade.server,
      };
    else delete state.pendingReturns[key];
    ports.log(tradeCompletionMessage(trade, ports.merchant()), trade.state === "return_owed" ? "error" : "info");
    ports.persist();
    return res.json({ ok: true });
  }

  function cakeComplete(_req: HttpRequest, res: HttpResponse): unknown {
    state.crafted = Math.max(0, Number(state.crafted) || 0) + 1;
    ports.log((ports.merchant() || "The merchant") + " crafted and banked a Sixfold Cake", "success");
    ports.persist();
    return res.json({ ok: true });
  }
  return { advertise, chat, chatComplete, trade, tradeComplete, cakeComplete };
}

interface AnniversaryNavigationState {
  eventCycle?: AnniversaryCycle | null;
  returnReady?: Record<string, unknown>;
  returnDestination?: ReturnLocation | null;
}
interface AnniversaryNavigationPorts {
  now(): number;
  owned(name: string): unknown;
  merchant(): string | null;
  leader(): string | null;
  revision(name: string): number;
  persist(): void;
  scheduleReturn(): void;
  huntOwns(): boolean;
  supersede(cycle: AnniversaryCycle | null | undefined): void;
  convoy(): {
    id: string;
    label?: string;
    purpose?: string | null;
    nonPreemptible?: boolean;
  } | null;
  cancelConvoy(): void;
  log(message: string, level: string): void;
  location(): ReturnLocation | null;
  fallback(candidate: ReturnLocation): ReturnLocation | null;
  participants(): string[];
  capture(names: string[]): Waypoints;
}

// A staging window longer than the round's visit window is malformed, and one already ended is stale.
function invalidDeadline(starts: number, ends: number, now: number): boolean {
  return (
    !Number.isFinite(starts) ||
    !Number.isFinite(ends) ||
    ends <= starts ||
    ends - starts > ANNIVERSARY_WINDOW_MS ||
    ends < now
  );
}

function validLocation(candidate: ReturnLocation): boolean {
  return !!candidate.map && Number.isFinite(candidate.x) && Number.isFinite(candidate.y);
}

// Rounds compare through rules.ts `roundOrder`.
function abortedRound(cycle: AnniversaryCycle | null | undefined, round: unknown): boolean {
  return !!cycle?.abortedAt && roundBefore(round, cycle.id, true);
}
function roundBefore(a: unknown, b: unknown, same = false): boolean {
  const order = roundOrder(a, b);
  return order !== null && (order < 0 || same && order === 0);
}

export function createAnniversaryNavigationRoutes(
  state: AnniversaryNavigationState,
  ports: AnniversaryNavigationPorts,
) {
  function validCharacter(name: string): unknown {
    return ports.owned(name) && name !== ports.merchant();
  }

  function staleReady(
    cycle: AnniversaryCycle | null | undefined,
    name: string,
    body: Record<string, unknown>,
  ): boolean {
    return (
      !cycle ||
      !!cycle.returnCompletedAt ||
      !!cycle.supersededAt ||
      ![String(cycle.id), String(cycle.liveRound)].includes(requestText(body.round)) ||
      Number(body.navigationRevision || 0) !== ports.revision(name)
    );
  }

  function ready(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character || "");
    if (!validCharacter(name)) return res.status(400).json({ error: "invalid anniversary return" });
    if (staleReady(state.eventCycle, name, body)) return res.json({ ok: true, stale: true });
    state.returnReady ||= {};
    state.returnReady[name] = { at: ports.now(), round: body.round || null };
    ports.persist();
    ports.scheduleReturn();
    return res.json({ ok: true });
  }

  function preemptConvoy(res: HttpResponse): unknown {
    const convoy = ports.convoy();
    const interrupted = convoy && { id: convoy.id, label: convoy.label };
    if (convoy && ["anniversary-return", "event-return"].includes(convoy.purpose || ""))
      return res.json({ ok: true, cancelled: false, alreadyReturning: true });
    if (convoy?.nonPreemptible) return res.json({ ok: true, cancelled: false, huntTurnIn: true });
    if (interrupted) {
      ports.cancelConvoy();
      ports.log(
        "Cancelled " +
          (interrupted.label || "farming") +
          " convoy so the party can attend the anniversary round",
        "info",
      );
      ports.persist();
    }
    return res.json({ ok: true, cancelled: !!interrupted });
  }

  function preempt(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character || "");
    if (!validCharacter(name))
      return res.status(400).json({ error: "invalid anniversary navigation preemption" });
    if (Number(body.navigationRevision || 0) !== ports.revision(name))
      return res.status(409).json({ error: "stale navigation revision" });
    if (ports.huntOwns()) return res.json({ ok: true, cancelled: false, huntTurnIn: true });
    const cycle = state.eventCycle;
    if (abortedRound(cycle, body.round))
      return res.json({ ok: true, cancelled: false, skipped: true });
    if (cycle && roundBefore(cycle.id, body.round)) ports.supersede(cycle);
    return preemptConvoy(res);
  }

  function startCycle(
    name: string,
    body: Record<string, unknown>,
    candidate: ReturnLocation,
    startsAt: number,
    endsAt: number,
  ): void {
    ports.supersede(state.eventCycle);
    const destination = ports.fallback(
      name === ports.leader() ? candidate : ports.location() || candidate,
    );
    state.eventCycle = {
      id: requestText(body.round || startsAt),
      startsAt,
      endsAt,
      destination,
      participants: ports.participants(),
      waypoints: ports.capture(ports.participants()),
      stagedAt: ports.now(),
      returnDispatchedAt: null,
    };
    state.returnReady = {};
  }

  function acceptStaging(
    name: string,
    body: Record<string, unknown>,
    candidate: ReturnLocation,
    starts: number,
    ends: number,
    res: HttpResponse,
  ): unknown {
    const existing = state.eventCycle;
    const round = requestText(body.round);
    if (existing && roundBefore(round, existing.id))
      return res.status(409).json({ error: "stale anniversary round" });
    const same = existing && String(existing.id) === round;
    if (same && existing.abortedAt) return res.json({ ok: true, skipped: true, cycle: existing });
    if (!same) startCycle(name, body, candidate, starts, ends);
    else updateLeaderDestination(existing, name, candidate, starts);
    const cycle = state.eventCycle!;
    cycle.participants = [...new Set([...(cycle.participants || []), ...ports.participants()])];
    state.returnDestination = cycle.destination;
    ports.persist();
    return res.json({ ok: true, cycle });
  }

  function updateLeaderDestination(
    cycle: AnniversaryCycle,
    name: string,
    candidate: ReturnLocation,
    starts: number,
  ): void {
    if (name === ports.leader() && ports.now() < starts && !cycle.returnDispatchedAt)
      cycle.destination = ports.fallback(candidate);
  }

  function staging(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character || "");
    if (!validCharacter(name))
      return res.status(400).json({ error: "invalid anniversary staging report" });
    if (Number(body.navigationRevision || 0) !== ports.revision(name))
      return res.status(409).json({ error: "stale navigation revision" });
    const candidate = {
      map: requestText(body.map || ""),
      x: Number(body.x),
      y: Number(body.y),
      label: requestText(body.label || "the pre-event farming location"),
      capturedAt: ports.now(),
    };
    if (!validLocation(candidate))
      return res.status(400).json({ error: "invalid pre-event location" });
    const starts = Number(body.startsAt),
      ends = Number(body.endsAt);
    if (invalidDeadline(starts, ends, ports.now()))
      return res.status(400).json({ error: "invalid anniversary cycle deadline" });
    return acceptStaging(name, body, candidate, starts, ends, res);
  }
  return { ready, preempt, staging };
}

interface Withdrawal extends InventoryEntry {
  pack: string;
}
interface SuppliesState {
  merchantCharacter: string | null;
  withdrawals: Record<string, Withdrawal[] | undefined>;
  bankbois?: Record<string, { name: string; items?: (InventoryEntry | null)[] }>;
}
interface SuppliesPorts {
  counts(): Record<string, number>;
  persist(): void;
  log(message: string, level: string, details: unknown): void;
}

function validRequest(
  body: Record<string, unknown>,
  merchant: string | null,
): body is Record<string, unknown> & { missing: string[] } {
  return (
    !!merchant &&
    body.character === merchant &&
    Array.isArray(body.missing) &&
    body.missing.every((name) => anniversarySlices.includes(name))
  );
}

export function createAnniversarySuppliesRoute(state: SuppliesState, ports: SuppliesPorts) {
  function withdraw(
    name: string,
    counts: Record<string, number>,
    withdrawals: Withdrawal[],
  ): boolean {
    if (withdrawals.some((request) => request.item?.name === name)) return true;
    const worker = Object.values(state.bankbois || {}).find((worker) =>
      (worker.items || []).some((entry) => entry?.item?.name === name),
    );
    const entry = worker?.items?.find((entry) => entry?.item?.name === name);
    if (!entry || !worker || !(counts[name]! > 0)) return false;
    withdrawals.push({ pack: bankboiPack(worker.name), slot: entry.slot, item: { ...entry.item } });
    ports.log("Requested anniversary ingredient from bankboi", "info", {
      item: name,
      bankboi: worker.name,
    });
    return true;
  }

  return function supplies(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      merchant = state.merchantCharacter;
    if (!validRequest(body, merchant))
      return res.status(400).json({ error: "invalid anniversary supply request" });
    const withdrawals = (state.withdrawals[String(merchant)] ||= []),
      counts = ports.counts();
    const pending: string[] = [],
      missing: string[] = [];
    for (const name of new Set(body.missing))
      (withdraw(name, counts, withdrawals) ? pending : missing).push(name);
    ports.persist();
    // Scheduling waits for the craft attempt to release the merchant's busy state.
    return res.json({ ok: true, pending, missing });
  };
}

interface VisitState {
  rounds: Record<string, AnniversaryRound | undefined>;
  abortedRounds: Record<string, unknown>;
  nativeSlice: string | null;
  attempts: Record<string, Record<string, number>>;
}
interface VisitPorts {
  now(): number;
  owned(name: string): unknown;
  enabled(name: string): boolean;
  merchant(): string | null;
  revision(name: string): number;
  snapshot(): { live?: AnniversarySchedule | null };
  abort(body: Record<string, unknown>): Record<string, unknown>;
  log(message: string, level: string, details?: unknown): void;
  persist(): void;
}

function sliceLabel(slice: string | null | undefined): string {
  return requestText(labels[slice || ""] || slice);
}

export function createAnniversaryVisitRoutes(state: VisitState, ports: VisitPorts) {
  function recordClaim(name: string, roundId: string, body: Record<string, unknown>): void {
    const round = state.rounds[roundId] || {
      claims: {},
      target: (body.target || null) as string | null,
    };
    round.claims![name] = { at: ports.now(), slice: (body.slice || null) as string | null };
    state.rounds[roundId] = round;
    if (typeof body.slice === "string" && anniversarySlices.includes(body.slice))
      state.nativeSlice = body.slice;
    ports.log(
      name +
        " kissed " +
        requestText(body.target || "the featured player") +
        (body.slice ? " and received " + sliceLabel(body.slice as string) + " Slice" : ""),
      "success",
    );
    ports.persist();
  }

  function claim(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character || ""),
      roundId = requestText(body.round || "");
    if (!ports.owned(name) || !roundId)
      return res.status(400).json({ error: "invalid anniversary claim" });
    if (state.abortedRounds[roundId]) return res.json({ ok: true, skipped: true });
    recordClaim(name, roundId, body);
    return res.json({ ok: true, anniversary: ports.snapshot() });
  }

  function staleAttempt(name: string, round: string, body: Record<string, unknown>): boolean {
    const live = ports.snapshot().live;
    return (
      !ports.owned(name) ||
      !ports.enabled(name) ||
      !live ||
      String(live.round) !== round ||
      live.target !== body.target ||
      Number(body.navigationRevision) !== ports.revision(name)
    );
  }

  function attempt(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character || ""),
      round = requestText(body.round || "");
    if (staleAttempt(name, round, body))
      return res.status(409).json({ error: "stale anniversary attempt" });
    // The count numbers the approaches for the log; the character ends them on its progress rule.
    const counts = (state.attempts[round] ||= {});
    counts[name] = (counts[name] || 0) + 1;
    ports.persist();
    return res.json({ attempt: counts[name] });
  }

  function failure(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character || "");
    if (!ports.owned(name)) return res.status(400).json({ error: "invalid anniversary character" });
    const message =
      name +
      " anniversary kiss failed for " +
      requestText(body.target || "the featured player") +
      "— " +
      requestText(body.error || "unknown server response");
    ports.log(message, "error", {
      round: body.round || null,
      failureReason: body.failureReason || null,
      responses: Array.isArray(body.responses) ? body.responses.slice(-10) : [],
    });
    const result = ports.abort(body);
    return res.json({ ok: true, ...result, anniversary: ports.snapshot() });
  }

  function handoff(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character || ""),
      roundId = requestText(body.round || "");
    if (!ports.owned(name) || name === ports.merchant())
      return res.status(400).json({ error: "invalid anniversary handoff" });
    const round = state.rounds[roundId] || { claims: {}, target: null };
    const claim = round.claims![name] || {
      at: ports.now(),
      slice: (body.slice || null) as string | null,
      recovered: true,
    };
    round.claims![name] = claim;
    state.rounds[roundId] = round;
    if (claim.handedOff) return res.json({ ok: true, duplicate: true });
    claim.handedOff = true;
    claim.handedOffAt = ports.now();
    ports.log(
      name + " delivered " + sliceLabel(claim.slice) + " Slice to " + ports.merchant(),
      "success",
    );
    ports.persist();
    return res.json({ ok: true });
  }
  return { claim, attempt, failure, handoff };
}

// Movement's HTTP routes and its heartbeat section (R1.1 routes.ts): the walk's acknowledgements and
// engagements, the planner and records routes, the navigation actions, the shared route, the travel
// report, the Town membership commands and the heartbeat's movement fields (heartbeatMovement). Moved
// here whole from http/convoy-acknowledgements.ts, convoy-engagement.ts, movement.ts,
// navigation-actions.ts and shared-convoy-route.ts and status/travel-report.ts; the Town membership
// commands and the movement fields come out of status/response.ts and response-composition.ts.
import { partyFocus, type resolve } from '../../hunting/api.ts';
import { farmTravelPaused, searchReach } from '../../hunting/coordinator/api.ts';
import { recordConvoyHistory } from './records.ts';
import { requestObject, requestText, type HttpHandler, type HttpRequest, type HttpResponse, type HttpRouter } from '../../lifecycle/api.ts';
import { createEventAcknowledgementRoutes } from '../../events/coordinator/api.ts';
import type { ReturnLocation } from '../../events/api.ts';
import type { StoredCombatLogEntry } from '../../status/api.ts';
import { transportTiming } from '../../status/coordinator/api.ts';
import type { createPlannerService } from './planner-service.ts';
import { UnreachableGoalError } from './planner-geometry.ts';
import { SNAPSHOT_TRIGGERS, type MovementRecordsService, type SnapshotTrigger } from './records.ts';
import type { HeartbeatResponsePorts, HeartbeatState } from '../../status/api.ts';
import { CLICK_WAIT_DEFAULT_MS } from '../saved-fields.ts';
import { isPoint, type PlanRequest } from '../geometry/contracts.ts';
import type { MovementIncident, MovementRecord } from '../../protocol/records.ts';
import { fresh, reportClockError } from '../../protocol/reports.ts';
import { recordTownAttempt } from './arrivals.ts';
import { playerMoved } from '../../events/coordinator/api.ts';
import { publishSharedRoute, readRoutePoint, routeOwner, sharedArrivalReady, sharedRoute,
  type NavigationGroup, type NavigationRoutePorts, type NavigationRouteState, type RouteConvoy, type SharedState } from './route-store.ts';
import { completeMembers, completeSharedWalkMember, completionKey, createSharedWalks, failureDoes, movementBarrier, rememberCompletion, walkEnds, type CompletionReceipts, type WalkState } from './walk.ts';
import { merchantSlotCommand } from '../../merchant-jobs/coordinator/api.ts';
import { appendCombatLog, requestCaller } from '../../status/coordinator/api.ts';

function townFailure(active: RouteConvoy, body: Record<string,unknown>, now: number): boolean {
  const attempt=requestObject(body.townAttempt), destination=readRoutePoint(attempt.destination);
  const prefix=String(body.epoch)+':'+String(body.routeVersion)+':';
  if (!active.continuousReturn || !['interrupted','unavailable'].includes(String(attempt.state)) || typeof attempt.map!=='string' ||
      typeof attempt.round!=='string' || !attempt.round.startsWith(prefix) || !destination) return false;
  recordTownAttempt(active,{round:attempt.round,map:attempt.map,state:attempt.state==='unavailable'?'unavailable':'interrupted',destination},now);
  return true;
}

interface ExitReturn {
  exitConvoyId?: string;
  exited?: string[];
  cycleId: string;
  event: string;
  checkpoint: ReturnLocation | null;
}
// The acknowledgement routes read the walk's state, and /convoy-complete asks sharedArrivalReady.
interface ConvoyAcknowledgementState extends SharedState {
  lastConvoyEngagement?: {
    convoyId: string;
    epoch: number;
    reports?: Record<string, { commandId: number; runtimeId?: string } | undefined>;
  } | null;
  eventReturn: ExitReturn | null;
  combatLogs: Record<string, StoredCombatLogEntry[] | undefined>;
}
interface ConvoyAcknowledgementPorts {
  now(): number;
  owned(name: string): unknown;
  valid(body: Record<string, unknown>): boolean;
  nextCommand(): number;
  persist(): void;
  history(): void;
  // The walk's failure at the route's `now`, which stamps its failedAt.
  hold(message: string, code: string, now: number): void;
  error(message: string): void;
  // Design section 7 trigger 3: a failed group walk saves the ring the member attached.
  walkFailed?(name: string, records: unknown, incidents: unknown): void;
}

export function createConvoyAcknowledgementRoutes(
  state: ConvoyAcknowledgementState,
  ports: ConvoyAcknowledgementPorts,
) {
  function superseded(name: string, body: Record<string, unknown>): boolean {
    const handoff = state.lastConvoyEngagement,
      report = handoff?.reports?.[name];
    return (
      !!handoff &&
      handoff.convoyId === body.convoyId &&
      handoff.epoch === Number(body.epoch) &&
      report?.commandId === Number(body.commandId) &&
      !!report.runtimeId &&
      report.runtimeId === body.runtimeId
    );
  }
  function arrived(name: string, active: RouteConvoy): void {
    const continuation = completeSharedWalkMember(active, name);
    const recovery =
      active.purpose === "franky-exit" && state.eventReturn?.exitConvoyId === active.id
        ? state.eventReturn
        : null;
    delete state.commands[name];
    if (continuation) merchantSlotCommand(state, 'convoy:' + active.id, continuation, name);
    if (recovery) {
      recovery.exited = [...new Set((recovery.exited || []).concat(name))];
      merchantSlotCommand(state, 'event:' + recovery.cycleId, {
        id: ports.nextCommand(),
        type: "event-return-town",
        cycleId: recovery.cycleId,
        event: recovery.event,
        checkpoint: recovery.checkpoint,
      }, name);
    }
    completeMembers(state, active, [name]);
    if (active.participants.every((member) => active.completed!.includes(member))) {
      recordHuntArrival(active);
      recordConvoyHistory(state, active, "completed", ports.now());
      walkEnds(state, "arrived");
    }
    ports.persist();
  }
  function recordHuntArrival(active: RouteConvoy): void {
    if (!active.routeRecovery && active.purpose === 'monster-hunt' &&
        state.monsterHunt?.stage === 'mission-travel' && state.monsterHunt.convoyId === active.id)
      state.monsterHunt.originArrivedAt = ports.now();
  }
  function complete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character);
    if (!ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    if (state.convoyCompletionReceipts?.[name] === completionKey(body)) return res.json({ ok: true });
    // A racing completion for the former convoy must not delete its combat replacement command.
    if (superseded(name, body)) return res.json({ ok: true, superseded: true });
    if (
      !ports.valid(body) ||
      state.activeConvoy!.phase !== "travel"
    )
      return res.status(409).json({ error: "stale convoy completion" });
    const c = state.activeConvoy!;
    if (!sharedArrivalReady(state, ports.now())) return res.json({ ok: false, waiting: true });
    rememberCompletion(state, name, body);
    arrived(name, c);
    return res.json({ ok: true });
  }
  function failed(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character || "");
    if (!ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    // routes.ts saves the ring before the generation check, since a stale walk's failure is still
    // a record.
    if (body.movementRecords) ports.walkFailed?.(name, body.movementRecords, body.movementIncidents);
    const active = state.activeConvoy;
    if (!ports.valid({ ...body, character: name }))
      return res.status(409).json({ error: "stale convoy generation" });
    const reason = requestText(body.reason || "navigation stalled");
    const interrupted=townFailure(active!,body,ports.now());
    const code = interrupted ? 'town-interrupted' : ["town-unavailable", "runtime-lost", "owner-lost"].includes(requestText(body.failureCode))
      ? requestText(body.failureCode) : "route-failed";
    // The failure table first: a failure the walk keeps (a continuous return's interrupted Town) records only its
    // Town attempt, so the member's log shows no stop and the walk carries no failure it never had.
    if (failureDoes(active!, code) === 'keeps') { ports.persist(); return res.json({ ok: true }); }
    appendCombatLog(state.combatLogs, name, {
      at: ports.now(),
      type: "navigation",
      message: "!!! CONVOY STOPPED !!! " + reason,
      details: body.details || {},
    });
    active!.failureDetails = body.details || null;
    ports.hold(name + ": " + reason, code, ports.now());
    ports.history();
    ports.persist();
    ports.error("[convoy] " + name + ": " + reason);
    return res.json({ ok: true });
  }
  return { complete, failed };
}

export function createConvoyEngagementRoutes(
  state: NavigationRouteState,
  ports: NavigationRoutePorts,
) {
  function recordEngagement(
    name: string,
    active: RouteConvoy,
    body: Record<string, unknown>,
  ): void {
    const accepted = ports.acceptArrival(active, body, ports.now()),
      status = state.statuses[name];
    appendCombatLog(state.combatLogs, name, {
      at: ports.now(),
      type: "navigation",
      message: active.huntTarget ? "Hunt convoy handed off to a nearby hunt monster" : "Farming route paused to engage a nearby configured monster",
      details: {
        ...requestObject(body.target),
        convoyId: active.id,
        ...arrivalDetails(accepted),
        positionAgeMs: status ? ports.now() - status.seenAt : null,
        reportedMap: status?.map,
      },
    });
    ports.persist();
  }
  function arrivalDetails(accepted: boolean) {
    // The hunting owner's A47 retired the cycle's encounter walk, so every Hunt arrival hands
    // off at the spawn.
    const hunt = state.monsterHunt;
    return { huntArrivalAccepted: accepted, combatHandoffAccepted: accepted,
      handoff: "spawn", retainedDestination: hunt?.missions?.[hunt.currentIndex]?.destination };
  }
  function accept(
    name: string,
    active: RouteConvoy,
    body: Record<string, unknown>,
    res: HttpResponse,
  ): unknown {
    const revisions = Object.fromEntries(
      active.participants.map((name) => [name, ports.intent(name).revision]),
    );
    const group = ports.group();
    if (!active.huntTarget && group && (!group.ready || group.anchor?.map !== requestObject(body.target).map))
      return res
        .status(409)
        .json({ error: "Waiting for grouped arrival: " + group.blockers.join("; ") });
    if (
      !ports.engage(body, {
        revisions,
        radius: searchReach(state.monsterSearchRadiusByCharacter, active.huntTarget ? name : state.leader || name),
        focus: partyFocus(state),
      })
    )
      return res
        .status(409)
        .json({ error: "stale convoy or target outside destination hunt area" });
    recordEngagement(name, active, body);
    return res.json({ ok: true, ...handoffResponse(active) });
  }
  function handoffResponse(active: RouteConvoy) {
    if (!active.huntTarget) return {};
    const hunt = state.monsterHunt;
    return { location: active.location, handoff: "spawn",
      destination: hunt?.missions[hunt.currentIndex]?.destination, serverNow: ports.now() };
  }
  function engage(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character);
    if (!ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    const active = state.activeConvoy,
      intent = ports.intent(name);
    if (!active || intent.cancelled)
      return res.status(409).json({ error: "inactive farming convoy" });
    if (!active.huntTarget && state.partyFarmingMode !== "scatter" && name !== state.leader)
      return res
        .status(409)
        .json({ error: "only the leader may nominate a grouped farming target" });
    return accept(name, active, body, res);
  }
  function groupReady(
    body: Record<string, unknown>,
    group: NavigationGroup | null,
  ): group is NavigationGroup {
    return (
      body.character === state.leader &&
      !!group &&
      group.ready &&
      body.key === group.key &&
      body.selection === group.selection &&
      Number(body.navigationRevision) === ports.intent(requestText(body.character)).revision &&
      !state.activeConvoy &&
      !ports.huntOwns()
    );
  }
  function insideArea(name: string, destination: unknown): destination is ReturnLocation {
    const area = ports.waypoint(name),
      point = requestObject(destination);
    return (
      !!area &&
      point.map === area.map &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      ports.contains(
        area,
        point as unknown as ReturnLocation,
        150,
        searchReach(state.monsterSearchRadiusByCharacter, state.leader ?? null),
      )
    );
  }
  // A member fights while a threat targets the group, or while it targets a member or attacked within
  // the `report` age by its own clock (appendix C convoy-engagement.ts:131 F).
  function fighting(group: NavigationGroup): boolean {
    const members: readonly unknown[] = group.members;
    return group.members.some((name) => {
      const status = state.statuses[name]!;
      return (
        (status.threats || []).some((threat) => members.includes(threat.target)) ||
        (!!status.target &&
          (group.members.includes(status.target.target!) ||
            fresh(status.combat?.lastAttackAt, ports.now(), 'report', reportClockError(status), true)))
      );
    });
  }
  function approach(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      group = ports.group(),
      destination = body.location;
    if (!groupReady(body, group))
      return res.status(409).json({ error: "group is not ready for travel" });
    if (!insideArea(requestText(body.character), destination))
      return res.status(409).json({ error: "approach is outside the farming area" });
    if (fighting(group))
      return res.status(409).json({ error: "finish the current fight before group travel" });
    if (!ports.start(destination, "grouped farming approach", group.members, "grouped-approach"))
      return res.status(409).json({ error: "could not start grouped approach" });
    return res.json({ ok: true });
  }
  return { engage, approach };
}

function validOptions(b: Record<string, unknown>): boolean {
  return typeof b.id === 'string' && b.id.length <= 200 && typeof b.fingerprint === 'string' && b.fingerprint.length <= 100 &&
    typeof b.town === 'boolean' && Number.isFinite(b.speed) && Number(b.speed) > 0 && Number.isInteger(b.version);
}
function planErrorResponse(error: unknown, mode: string) {
  if (error instanceof UnreachableGoalError && error.result) return {...error.result,mode};
  return {error:error instanceof Error ? error.message : String(error),mode};
}
const list = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
// Design section 7 and queue A73: the snapshots the character posts. The live ring is the status
// owner's diagnostics lease (runtime/status/coordinator/routes.ts).
export function installMovementRecordRoutes(router: HttpRouter, records: MovementRecordsService, owned: (name: string) => unknown) {
  router.post('/party-api/movement-snapshot', (req, res) => {
    const b = requestObject(req.body), name = String(b.character);
    if (!owned(name) || !SNAPSHOT_TRIGGERS.includes(b.trigger as SnapshotTrigger)) return res.status(400).json({ error: 'Invalid movement snapshot' });
    const saved = records.save({ character: name, trigger: b.trigger as SnapshotTrigger, runtime: typeof b.runtime === 'string' ? b.runtime : undefined,
      incident: typeof b.incident === 'string' ? b.incident : undefined,
      posted: typeof b.id === 'string' && b.id.length <= 200 ? b.id : undefined,
      records: list<MovementRecord>(b.records), incidents: list<MovementIncident>(b.incidents) });
    return res.json({ ok: true, id: saved.id });
  });
  router.get('/party-api/movement/snapshot', (req, res) => {
    const name = requestText(req.query?.character), id = requestText(req.query?.id);
    if (!owned(name)) return res.status(400).json({ error: 'unknown character' });
    const snapshot = records.snapshot(name, id);
    return snapshot ? res.json(snapshot) : res.status(404).json({ error: 'no such snapshot' });
  });
}
export function installMovementRoutes(router: HttpRouter, planner: ReturnType<typeof createPlannerService>, owned: (name: string) => unknown) {
  router.post('/party-api/movement-plan', async (req, res) => {
    const b = requestObject(req.body);
    if (!owned(String(b.character)) || !isPoint(b.from) || !isPoint(b.to)) return res.status(400).json({ error: 'Invalid movement request' });
    if (!validOptions(b) || (b.avoidLeave !== undefined && typeof b.avoidLeave !== "boolean"))
      return res.status(400).json({ error: 'Invalid movement identity or options' });
    try { return res.json({ ...(await planner.plan(b as unknown as PlanRequest)), mode: planner.mode }); }
    // A completed planner rejection permits native fallback; it is not a transport outage.
    catch (error) { return res.json(planErrorResponse(error,planner.mode)); }
  });
}

type NavigationState = Parameters<typeof createEventAcknowledgementRoutes>[0] &
  Parameters<typeof createConvoyEngagementRoutes>[0] &
  Parameters<typeof createConvoyAcknowledgementRoutes>[0] & { nextCommandId: number };
type AcknowledgementPorts = Parameters<typeof createConvoyAcknowledgementRoutes>[1];
type NavigationPorts = Omit<Parameters<typeof createEventAcknowledgementRoutes>[1], "nextCommand"> &
  Omit<NavigationRoutePorts, "huntOwns" | "engage" | "acceptArrival"> &
  Omit<AcknowledgementPorts, "nextCommand" | "valid" | "hold"> & {
    huntOwns: (hunt: NavigationState["monsterHunt"]) => boolean;
    engage: (
      state: NavigationState,
      ...args: Parameters<NavigationRoutePorts["engage"]>
    ) => boolean;
    acceptArrival: (
      hunt: NavigationState["monsterHunt"],
      ...args: Parameters<NavigationRoutePorts["acceptArrival"]>
    ) => boolean;
    valid: (state: NavigationState, ...args: Parameters<AcknowledgementPorts["valid"]>) => boolean;
    hold: (state: NavigationState, ...args: Parameters<AcknowledgementPorts["hold"]>) => void;
  };

// The party travel and the party Town (from http/party-actions.ts): the dashboard's party actions
// that start a party walk to a location, or a Town cycle that sends each active member a
// `town-party` command bound to its navigation revision. The Cave's exit and release are the hunting
// owner's published ones, the waypoints the hunting owner's `authorize` and `invalidate`, the event
// skips the events owner's and the walk's start the composition's `convoy` port.
type PartyTravelState = Parameters<typeof playerMoved>[0] & {
  navigationIntents?: Record<string, { revision: number } | undefined>;
  location: ReturnLocation | null;
  commands: Record<string, unknown>;
  townCycle: { id: string; pending: string[]; startedAt: number; revisions?: Record<string, number> } | null;
};
export interface PartyTravelPorts {
  now(): number;
  nextCommand(): number;
  release(): void;
  members(): string[];
  active(): string[];
  authorize(names: string[], location: ReturnLocation, shared: boolean): void;
  invalidate(names: string[], reason: string, shared: boolean): void;
  persist(): void;
  // M2: a character on Manual or Pause takes no Town.
  handHeld?(name: string): boolean;
  // The walk's tier and, for an app key's travel, the app (`app:<name>`).
  convoy(location: ReturnLocation, label: string, names: string[], purpose: string, cause?: undefined, tier?: 'manual' | 'app', by?: string): boolean;
  exitDungeon(res: HttpResponse): boolean;
  releaseDungeon(res: HttpResponse): boolean;
}
function travelLocation(body: Record<string, unknown>): ReturnLocation | null {
  const map = body.map,
    x = Number(body.x),
    y = Number(body.y);
  return typeof map === "string" &&
    /^[a-z0-9_]+$/i.test(map) &&
    Number.isFinite(x) &&
    Number.isFinite(y)
    ? { map, x, y }
    : null;
}
export function createPartyTravelRoutes(state: PartyTravelState, ports: PartyTravelPorts) {
  function travel(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      location = travelLocation(body);
    if (!location) return res.status(400).json({ error: "invalid location" });
    if (!ports.releaseDungeon(res)) return;
    ports.release();
    ports.authorize(ports.members(), location, true);
    const names = ports.members().filter(name => ports.active().includes(name));
    // An app key's travel walks at the `app` tier and names the app, as the
    // character commands do (arrivals.ts `appTier`); the player's travel stays `manual`.
    const caller = requestCaller();
    if (!ports.convoy(location, "party location", names, body.force === true ? "party-force-travel" : "party-travel", undefined,
      caller?.tier ?? "manual", caller?.tier === "app" ? caller.by : undefined))
      return res.status(409).json({ error: "an online party leader is required for shared travel" });
    playerMoved(state, names, location, ports.now());
    ports.persist();
    return res.json({ ok: true, partyLocation: state.location });
  }
  function town(_req: HttpRequest, res: HttpResponse): unknown {
    if (ports.exitDungeon(res)) return;
    ports.release();
    const names = ports.members().filter((name) => ports.active().includes(name) && !ports.handHeld?.(name));
    playerMoved(state, names, { map: "main" }, ports.now());
    ports.invalidate(ports.members(), "manual Town", true);
    const cycleId = "town-" + ports.now() + "-" + ports.nextCommand();
    state.townCycle = names.length
      ? { id: cycleId, pending: names.slice(), startedAt: ports.now(),
          revisions: Object.fromEntries(names.map(name => [name, state.navigationIntents?.[name]?.revision || 0])) }
      : null;
    for (const name of names)
      merchantSlotCommand(state, 'town', { id: ports.nextCommand(), type: "town-party", cycleId }, name);
    ports.persist();
    return res.json({ ok: true, queued: names });
  }
  return { travel, town };
}

/** Movement reports share current Hunt ownership and command allocation across event and farming returns. */
export function createCoordinatorNavigationActions(state: NavigationState, ports: NavigationPorts) {
  const shared = { ...ports, nextCommand: () => state.nextCommandId++ };
  const events = createEventAcknowledgementRoutes(state, shared);
  const travel = {
    ...shared,
    huntOwns: () => ports.huntOwns(state.monsterHunt),
    engage: (...args: Parameters<NavigationRoutePorts["engage"]>) => ports.engage(state, ...args),
    acceptArrival: (...args: Parameters<NavigationRoutePorts["acceptArrival"]>) =>
      ports.acceptArrival(state.monsterHunt, ...args),
  };
  const engagement = createConvoyEngagementRoutes(state, travel);
  const acknowledgements = createConvoyAcknowledgementRoutes(state, {
    ...shared,
    valid: (body) => ports.valid(state, body),
    hold: (message, code, now) => ports.hold(state, message, code, now),
  });
  return { events, engagement, acknowledgements };
}

export function installSharedConvoyRoute(router: HttpRouter, state: WalkState,
  owned: (name: string) => unknown, walks?: Parameters<typeof createSharedWalks>[1]): void {
  router.post('/party-api/movement-barrier', (req, res) => {
    const receivedAt = Date.now();
    const result = movementBarrier(state, req.body, receivedAt);
    return res.status(result.error ? 409 : 200).json({...result, transportTiming: transportTiming(receivedAt, Date.now())});
  });
  const publish: HttpHandler = (req, res) => {
    const body = requestObject(req.body);
    if (!owned(String(body.character))) return res.status(400).json({ error: "unknown character" });
    const error = publishSharedRoute(state, body, Date.now());
    return error ? res.status(409).json({ error }) : res.json({ ok: true, routeVersion: state.activeConvoy!.routeVersion });
  };
  const read: HttpHandler = (req, res) => {
    const body = requestObject(req.query);
    if (!owned(String(body.character)) || !routeOwner(state, body, Date.now())) return res.status(409).json({ error: "stale route reader" });
    const route = sharedRoute(state.activeConvoy!);
    res.set("Cache-Control", "no-store");
    return route ? res.json({ ok: true, route }) : res.status(409).json({ error: "route not published" });
  };
  router.post("/party-api/convoy-route", publish);
  router.get("/party-api/convoy-route", read);
  if (walks) {
    const service = createSharedWalks(state, walks);
    router.post("/party-api/shared-travel", (req, res) => {
      const result = service.submit(requestObject(req.body));
      return res.status(result.error ? 409 : 200).json(result);
    });
  }
}

// These fields describe one game sample, not independently mergeable domains.
export const travelReportFields = ['monsterHunt', 'map', 'in', 'server', 'x', 'y', 'hp', 'max_hp', 'rip',
  'lastDeath', 'moving', 'transporting', 'speed', 'baseSpeed', 'convoyNavigation', 'commandHold', 'convoyProtocol',
  'movementGeometry', 'movement', 'combatSelection', 'groupedCombat', 'travelSample'] as const;

export function sequencedTravelReport(body: unknown): boolean {
  const b = requestObject(body), s = requestObject(b.travelSample);
  return typeof s.runtimeId === 'string' && s.runtimeId === requestObject(b.combatSelection).runtimeId &&
    Number.isSafeInteger(s.sequence) && Number(s.sequence) > 0 && typeof s.connected === 'boolean';
}

/** Receipt time establishes freshness; runtime-scoped sequence establishes order.
 * Client clock corrections must neither retire a fresh sample nor revive a replay. */
export function acceptTravelReport<T extends {name: string}>(body: T, previous: T | undefined, now: number): T {
  const b = requestObject(body), old = requestObject(previous);
  const incoming = requestObject(b.travelSample), before = requestObject(old.travelSample);
  if (incoming.runtimeId === before.runtimeId && Number(incoming.sequence) <= Number(before.sequence)) {
    const retained = Object.fromEntries(travelReportFields.map(key => [key, old[key]]));
    return {...body, ...retained, seenAt: old.seenAt};
  }
  const group = requestObject(b.groupedCombat);
  return {...body, seenAt: now,
    travelSample: {...incoming, receivedAt: now, rawObservationAt: group.currentAttackersAt},
    groupedCombat: {...group, currentAttackersAt: incoming.connected && Array.isArray(group.currentAttackers) ? now : 0}};
}

// The heartbeat's Town membership commands: a member whose navigation moved on leaves the
// Town cycle, and a command outside the cycle goes.
type TownState = Pick<HeartbeatState, "townCycle" | "commands" | "nextCommandId">;
type TownPorts = Pick<HeartbeatResponsePorts, "navigationRevision" | "persist">;
function retireTownMembership(state: TownState, ports: TownPorts, name: string): boolean {
  const town = state.townCycle;
  if (!town?.pending.includes(name) || town.revisions?.[name] === ports.navigationRevision(name)) return false;
  endTownMembership(state, name);
  return true;
}
// A member leaves the Town cycle: its Town command of the cycle goes, and the cycle ends with its
// last member. The events owner's Town acknowledgement (events/coordinator/routes.ts
// `townComplete`) ends a member's membership through this one rule too.
export function endTownMembership(state: { townCycle?: { id: string; pending: string[] } | null; commands: Record<string, { type?: string; cycleId?: unknown } | undefined> }, name: string): void {
  const town = state.townCycle;
  if (!town) return;
  town.pending = town.pending.filter(member => member !== name);
  const command = state.commands[name];
  if (command?.type === "town-party" && command.cycleId === town.id) delete state.commands[name];
  if (!town.pending.length) state.townCycle = null;
}
function orphanedTownCommand(state: TownState, name: string): boolean {
  if (state.commands[name]?.type !== "town-party") return false;
  const town = state.townCycle;
  // Town admission writes its cycle and its commands in one step, so a command outside the
  // pending cycle is an orphan, never a newer admission.
  return !town || state.commands[name]?.cycleId !== town.id || !town.pending.includes(name);
}
export function retireTownCommand(state: TownState, ports: TownPorts, name: string): void {
  let changed = retireTownMembership(state, ports, name);
  if (orphanedTownCommand(state, name)) {
    delete state.commands[name];
    changed = true;
  }
  if (changed) ports.persist?.();
}
// A pending member with no command gets its Town command again. Its id comes from the console's one
// command sequence, which the status intake keeps past every `lastCommandId` a client reports, so
// CODE that survived a coordinator restart never drops it as older than the commands it has seen.
export function restoreTownCommand(state: TownState, ports: TownPorts, name: string): void {
  const town = state.townCycle;
  if (town?.pending.includes(name) && !state.commands[name] && town.revisions?.[name] === ports.navigationRevision(name))
    merchantSlotCommand(state, 'town', {id: state.nextCommandId++, type:"town-party", cycleId:town.id}, name);
}

// The heartbeat's movement fields ("Movement's last `--close 02` list" class 3): each member's
// navigation revision and intent, its walk signal, its farming location, whether the Hunt's turn-in
// owns its travel, whether the party Town or a party walk holds it, the Town cycle and its return
// progress and its click wait.
export interface HeartbeatMovementPorts<State> {
  setting: HeartbeatResponsePorts['setting'];
  intent: (name: string) => { revision: number };
  convoySignal: (state: State, name: string) => unknown;
  waypoint: (name: string) => Parameters<typeof resolve>[2];
  resolveArea: typeof resolve;
  huntOwns: (hunt: HeartbeatState["monsterHunt"]) => boolean;
}
export function heartbeatMovement<State extends HeartbeatState>(state: State, ports: HeartbeatMovementPorts<State>) {
  const reads = {
    navigationRevision: (name) => ports.intent(name).revision,
    convoySignal: (name) => ports.convoySignal(state, name),
    partyLocation: (name) =>
      ports.resolveArea(
        state.monsterChoices || [],
        partyFocus(state),
        ports.waypoint(name),
      ),
    navigationIntent: (name) => ports.intent(name),
    huntTurnInOwnsTravel: () => ports.huntOwns(state.monsterHunt),
    // The party Town's cycle holds every fighter; the merchant keeps its own Town.
    partyTownActive: (name) => name !== state.merchantCharacter && !!state.townCycle,
    partyConvoyActive: (name) => !!state.activeConvoy?.participants.includes(name),
    partyTownCycleId: () => state.townCycle?.id || null,
    returnProgress: (name) => state.returnProgress?.[name] || null,
    // The saved click wait per character, or the decided 5 s when it has none.
    clickWaitMs: (name) => (ports.setting({ field: 'movementClickWaitMs', character: name }) as number | undefined) ?? CLICK_WAIT_DEFAULT_MS,
  } satisfies Partial<HeartbeatResponsePorts>;
  return {
    ...reads,
    // Table R's movement section; the merchant walks no farm, and the paused flags are the
    // hunting owner's.
    movementSection: (name: string) => ({
      partyLocation: reads.partyLocation(name),
      farmTravelPaused: name !== state.merchantCharacter && farmTravelPaused(state),
      navigationIntent: reads.navigationIntent(name),
      partyTownActive: reads.partyTownActive(name),
      partyConvoyActive: reads.partyConvoyActive(name),
      movementClickWaitMs: reads.clickWaitMs(name),
    }),
  } satisfies Partial<HeartbeatResponsePorts>;
}

// Arrival checks and the walks' destinations: the Hunt and return arrivals, the Town return, the event
// pursuit, the manual commands and their composition, the restart's saved walk and the convoy composition.
// Moved here whole from coordinator/navigation/hunt-arrival.ts, return-arrival.ts,
// halloween-return-arrival.ts, return-town.ts, event-pursuit.ts, manual-commands.ts, manual-composition.ts,
// initial-commands.ts, recovery-hooks.ts and convoy-composition.ts. `memberBlocked` (from hunt-arrival.ts) is
// The movement owner's function that reads the player's navigation intent; the settings owner's `initialCommandState` is in
// settings/coordinator/initial.ts. The hunting owner's closure `createCoordinatorRecoveryHooks>resumeHunt`,
// which nothing called, went in the hunting owner's H-S1, and the rest of recovery-hooks.ts, the rare's
// ports, is the hunting owner's install (runtime/hunting/coordinator/install.ts `installHunting`). the call budget owner's
// go-home command left for the realm owner in layer 8 and is asked as `home`.
import { contains, partyFocus } from '../../hunting/api.ts';
import { searchReach } from '../../hunting/coordinator/api.ts';
import { requestObject, requestText } from '../../lifecycle/api.ts';
import { recordConvoyHistory } from './records.ts';
import { gameMonsters } from './planner-service.ts';
import { authorizeCoordinatorFarmingRoute } from './runtime.ts';
import { eventBossMoves, type EventAttendance, type ReturnLocation } from '../../events/api.ts';
import { playerMoved } from '../../events/coordinator/api.ts';
import { characterRuntime, distance, heldReturnArrivalReady, reportMatches, samePlace, sameWalkOn, sharedArrivalReady,
  type RoutePoint, type SharedCommand, type SharedConvoy, type SharedState, type SharedStatus, walkCommandOf } from './route-store.ts';
import { capturedCommunicationFailure, classifyTravelDefense, legacyCompletionFailure } from './defense.ts';
import { completeMembers, createConvoyRestartRecovery, createPartyConvoys, rememberCompletion, walkEnds, walkPhase, type PartyConvoy } from './walk.ts';
import { preemptible } from '../rules.ts';
import type { Tier } from '../../protocol/ranks.ts';
import type { RequestCaller } from '../../status/api.ts';
import { fresh, reportClockError } from '../../protocol/reports.ts';
import { merchantSlotCommand } from '../../merchant-jobs/coordinator/api.ts';
import { manualVisitReason, type JobReason } from '../../merchant-jobs/api.ts';

function eligible(state: SharedState, c: SharedConvoy): boolean {
  const h = state.monsterHunt;
  if (!h || interrupted(state, c)) return false;
  return h.convoyId === c.id && ['mission-travel', 'farming'].includes(h.stage) &&
    !!h.target && c.purpose === 'monster-hunt' && !c.continuousReturn && !c.force;
}
function interrupted(state: SharedState, c: SharedConvoy): boolean {
  return c.routeRecovery?.stage === 'relocation' || !!c.merchantInterruption || c.geometryRepair?.phase === 'waiting' ||
    !!state.eventReturn || !!state.escape && state.escape.stage !== 'released';
}
function owned(state: SharedState, c: SharedConvoy): boolean {
  return c.participants.every(name => {
    const s = state.statuses[name], command = walkCommandOf(state, name), intent = state.navigationIntents?.[name];
    const expected = c.expected?.[name];
    if (!expected) return false;
    if (!s || !command || memberBlocked(s, intent)) return false;
    return command.convoyId === c.id && revisionMatches(command.navigationRevision, intent, expected.revision);
  });
}
function inside(state: SharedState, c: SharedConvoy, now: number): boolean {
  const h = state.monsterHunt!, area = h.missions[h.currentIndex]?.destination;
  if (!area || !h.participants.length || h.participants.length !== c.participants.length) return false;
  const server = state.statuses[c.leader]?.server;
  return h.participants.every(name => {
    const s = state.statuses[name];
    if (!s || !freshLiving(s, now)) return false;
    return c.participants.includes(name) && s.server === server && samePlace(s, area) &&
      contains(area, s, 0, searchReach(state.monsterSearchRadiusByCharacter, name));
  });
}
function freshLiving(s: NonNullable<SharedState['statuses'][string]>, now: number): boolean {
  return !s.rip && s.hp !== 0 && !s.transporting && fresh(s.seenAt, now);
}
function stopped(state: SharedState, c: SharedConvoy): boolean {
  return c.participants.every(name => {
    const s = state.statuses[name]!;
    return !s.moving && reportMatches(state, name) && s.convoyNavigation?.phase === 'held' &&
      characterRuntime(s) === c.runtimes?.[name];
  });
}
/**
 * Arrival releases movement ownership; queue nomination never grants attack permission. The walk
 * ends `arrived` and writes nothing of the Hunt record: the hunting owner's Hunt hears `walk.ended` and
 * moves its own stage (hunting/coordinator/hunt.ts `walkArrived`).
 */
export function stepHuntArrival(state: SharedState, c: SharedConvoy, now: number,
  commandFor: (state: SharedState, c: SharedConvoy, phase: string, name: string) => SharedCommand): boolean | null {
  if (!eligible(state, c) || !owned(state, c)) { delete c.huntArrival; return null; }
  reconcileIdentity(state, c);
  // An existing defensive loot barrier must finish through its original owner.
  if (pendingLoot(c)) return null;
  if (!inside(state, c, now)) return awaitArea(state, c, now);
  if (!c.huntArrival) return begin(state, c, now, commandFor);
  if (c.participants.some(n => characterRuntime(state.statuses[n]) !== c.runtimes?.[n])) {
    delete c.huntArrival;
    return stepHuntArrival(state, c, now, commandFor);
  }
  if (!stopped(state, c)) return false;
  state.releasedArrivalCommands = Object.fromEntries(c.participants.map(n =>
    [n, { id: walkCommandOf(state, n)!.id, revision: walkCommandOf(state, n)!.navigationRevision }]));
  for (const name of c.participants) delete state.commands[name];
  recordConvoyHistory(state, c, 'Hunt farming handoff', now);
  walkEnds(state, 'arrived');
  return true;
}

function reconcileIdentity(state: SharedState, c: SharedConvoy): void {
  const h = state.monsterHunt!, prior = c.huntArrival;
  if (prior && (prior.cycleId !== h.cycleId || prior.missionIndex !== h.currentIndex ||
      prior.missionRevision !== (h.missionRevision || 0) || prior.epoch !== c.epoch)) delete c.huntArrival;
}
function begin(state: SharedState, c: SharedConvoy, now: number,
  commandFor: (state: SharedState, c: SharedConvoy, phase: string, name: string) => SharedCommand): boolean {
  const h = state.monsterHunt!;
  c.epoch++; walkPhase(state, c, 'hunt-arrival'); c.departAt = null;
  c.huntArrival = {cycleId: h.cycleId, missionIndex: h.currentIndex, missionRevision: h.missionRevision || 0, epoch: c.epoch};
  c.runtimes = Object.fromEntries(c.participants.map(n => [n, characterRuntime(state.statuses[n]) || '']));
  for (const name of c.participants) merchantSlotCommand(state, 'convoy:' + c.id, commandFor(state, c, 'shared-hold', name), name);
  recordConvoyHistory(state, c, 'Hunt spawn arrival', now);
  return true;
}

function pendingLoot(c: SharedConvoy): boolean { return !!c.loot && !requestObject(c.loot).complete; }

function revisionMatches(command: number, intent: {revision: number} | undefined, expected: number): boolean {
  return command === (intent?.revision || 0) && expected === command;
}

function awaitArea(state: SharedState, c: SharedConvoy, now: number): false | null {
  if (!c.huntArrival) return null;
  // Fresh drift outside the area resumes the existing route from stopped positions.
  if (c.participants.every(n => !!state.statuses[n] && freshLiving(state.statuses[n]!, now)) && stopped(state, c)) {
    delete c.huntArrival; walkPhase(state, c, 'shared-hold'); c.sharedStoppedAt = now;
    return null;
  }
  return false;
}

/** Recover a missing HTTP completion using the same owned arrival reports. */
export function reconcileReturnArrival(state: SharedState, c: SharedConvoy, now: number): boolean {
  const held = failedHuntReturn(state, c);
  if (!held && !recoverableArrival(c)) return false;
  const ready = held ? heldReturnArrivalReady(state, c, now) : sharedArrivalReady(state, now);
  if (!ready) { delete c.arrivalReadySince; return false; }
  // CF4 W return-arrival.ts:14: the normal completion requests settle first, so the walk retires
  // their commands once every member's next report still stands inside the destination.
  const since = c.arrivalReadySince ??= now;
  if (!c.participants.every(name => (state.statuses[name]?.seenAt ?? 0) > since)) return false;
  retireCommands(state, c);
  completeMembers(state, c, c.participants);
  recordConvoyHistory(state, c, 'completed', now, { reason: held
    ? 'Verified party arrival at Daisy released failed return hold'
    : 'Verified Hunt arrival recovered missing completion acknowledgment' });
  walkEnds(state, 'arrived');
  return true;
}

function retireCommands(state: SharedState, c: SharedConvoy): void {
  for (const name of c.participants) {
    if (!c.completed.includes(name)) {
      const command = state.commands[name]!;
      rememberCompletion(state, name, { convoyId: c.id, epoch: c.epoch, commandId: command.id,
        runtimeId: c.runtimes?.[name], navigationRevision: command.navigationRevision, routeVersion: c.routeVersion });
      delete state.commands[name];
    }
  }
}

function failedHuntReturn(state: SharedState, c: SharedConvoy): boolean {
  return c.phase === 'failed' && c.purpose === 'monster-hunt' && !!c.continuousReturn &&
    !!c.returnRouting && c.failureCode === 'route-failed' &&
    state.monsterHunt?.stage === 'returning' && state.monsterHunt.convoyId === c.id;
}

function recoverableArrival(c: SharedConvoy): boolean {
  // Legacy per-leg returns still require their transition barrier. Pickup and
  // outbound shared routes use the same verified final-arrival recovery.
  return c.purpose === 'monster-hunt' && c.phase === 'travel' &&
    (!c.returnRouting || !!c.continuousReturn);
}

export interface ReturnTownPolicy {
  map: string;
  interruptions: number;
  walking: boolean;
  lastRound?: string;
  sawAggro?: boolean;
  blockedReadiness?: string;
}
// A member's Town cast is protocol's wire shape (runtime/protocol/walk.ts).
import type { ReturnTownAttempt } from '../../protocol/walk.ts';
export type { ReturnTownAttempt } from '../../protocol/walk.ts';
export function returnWalking(c: { returnTown?: ReturnTownPolicy }, map?: string): boolean {
  return !!c.returnTown?.walking && (!map || c.returnTown.map === map);
}
/** Called only after the enclosing command/runtime/route identity is validated. */
export function recordTownAttempt(c: Pick<SharedConvoy, 'continuousReturn' | 'returnTown' | 'disableTown' | 'townRetry' | 'townRetryAt'>, attempt: ReturnTownAttempt, now: number): void {
  if (!c.continuousReturn || !['interrupted','unavailable'].includes(attempt.state)) return;
  const policy = c.returnTown ||= { map: attempt.map, interruptions: 0, walking: false };
  if (policy.map !== attempt.map || policy.lastRound === attempt.round) return;
  policy.lastRound = attempt.round;
  if(attempt.state==='interrupted')policy.interruptions++;
  policy.walking = true;
  c.disableTown = policy.walking;
  c.townRetry = true;
  c.townRetryAt = now;
}
export function observeReturnTown(state: SharedState, c: SharedConvoy, now: number): boolean {
  if (!c.continuousReturn || !state.statuses[c.leader]) return false;
  const lead = state.statuses[c.leader]!;
  c.returnTown ||= {map:lead.map,interruptions:0,walking:!!c.disableTown};
  const before = c.returnTown.walking;
  observeAttempts(state,c,now);
  updateTownPolicy(state,c,now);
  c.disableTown = c.returnTown.walking;
  if(before===c.returnTown.walking && !c.townRetry)return false;
  c.returnTown.blockedReadiness ||= readiness(state,c);
  c.townRetry=false;
  recordConvoyHistory(state,c,c.disableTown?'Walking home while defending':'Aggro clear; Town eligible',now);
  return true;
}
function readiness(state:SharedState,c:SharedConvoy):string {
  return c.participants.map(n=>String(state.statuses[n]?.returnTownReady)).join(':');
}
function townUsable(state:SharedState,c:SharedConvoy,name:string):boolean {
  if(state.statuses[name]?.returnTownReady===true)return true;
  return returnReportMatches(state,c,name) && ['casting','complete'].includes(state.statuses[name]?.convoyNavigation?.townAttempt?.state || '');
}
function updateTownPolicy(state:SharedState,c:SharedConvoy,now:number):void {
  const policy=c.returnTown!, lead=state.statuses[c.leader]!;
  // Optional passing attacks must not stop walking, but their aggro still makes Town unsafe.
  const observed=classifyTravelDefense(state,c.participants,now,true);
  if(observed.state==='waiting-for-observations')return;
  const changedMap=newMapReady(state,c,lead.map,lead.server,now);
  if(changedMap){policy.map=lead.map;policy.interruptions=0;}
  if(observed.state==='defending') {
    policy.sawAggro=true;policy.walking=true;
  } else if(!c.participants.every(n=>townUsable(state,c,n))) {
    policy.walking=true;policy.blockedReadiness ||= readiness(state,c);
  } else resumeTown(state,c,changedMap);
}
function resumeTown(state:SharedState,c:SharedConvoy,changedMap:boolean):void {
  const policy=c.returnTown!;
  const changedReady=!!policy.blockedReadiness && policy.blockedReadiness!==readiness(state,c);
  if(!changedMap && !policy.sawAggro && !changedReady)return;
  // Process a failed round before reconsidering its replacement.
  if(c.townRetry)return;
  policy.walking=false;policy.sawAggro=false;
  delete policy.blockedReadiness;
}

function returnReportMatches(state: SharedState,c: SharedConvoy,name: string): boolean {
  if(reportMatches(state,name))return true;
  const n=state.statuses[name]?.convoyNavigation, expected=c.expected?.[name];
  return !!expected && sameWalkOn({convoyId:c.id,epoch:c.epoch,id:expected.commandId,navigationRevision:expected.revision}, n, expected.runtimeId);
}

function observeAttempts(state: SharedState,c: SharedConvoy,now:number): void {
  const before=c.returnTown!.interruptions;
  for(const name of c.participants) {
    if(!freshReturnMember(state,name,now))continue;
    if(!returnReportMatches(state,c,name))continue;
    const attempt=state.statuses[name]?.convoyNavigation?.townAttempt;
    if(attempt)recordTownAttempt(c,attempt,now);

  }
  if(c.townRetry)captureTownRally(state,c);
  if(before!==c.returnTown!.interruptions)recordConvoyHistory(state,c,'Town interrupted',now,{...c.returnTown});
}
function newMapReady(state:SharedState,c:SharedConvoy,map:string,server:string|undefined,now:number):boolean {
  return map!==c.returnTown!.map && c.participants.every(name=>{
    const s=state.statuses[name];
    return s && fresh(s.seenAt,now,'report',0,true) && !s.rip && s.map===map && s.server===server &&
      (c.phase==='assemble' || s.convoyNavigation?.transitionMap===map);
  });
}

function freshReturnMember(state:SharedState,name:string,now:number):boolean {
  const s=state.statuses[name];return !!s && fresh(s.seenAt,now);
}

function captureTownRally(state:SharedState,c:SharedConvoy):void {
  for(const name of c.participants) {
    if(!returnReportMatches(state,c,name))continue;
    const attempt=state.statuses[name]?.convoyNavigation?.townAttempt;
    if(attempt?.destination)c.returnTownRally=attempt.destination;
  }
}

// Queue A26: walks follow every event boss that moves (the events owner's K1, `eventBossMoves`).
export function pursuedBoss(key: string): boolean {
  return eventBossMoves(key, { monsters: gameMonsters() ?? undefined });
}

/** Actual party sightings can update an owned walking leg; schedules cannot. Each fresh sighting
 * 250 or more from the destination answers, with no clock between two (design 2.3: the walk re-aims
 * in place, so a re-aim no longer stops the party). The 250 is the console's own re-aim distance,
 * runtime/coordinator/navigation/event-pursuit.ts:9 at b9b5c91e. */
export function movingEventDestination(state: SharedState, c: SharedConvoy, now: number, moves: (key: string) => boolean = pursuedBoss): RoutePoint | null {
  if (!eventTravel(c, moves)) return null;
  if (!c.participants.every(name => ownsEventWalk(state, c, name, now))) return null;
  const reporter = Object.values(state.statuses).find(s => actualBoss(s, c, now));
  const boss = reporter?.eventCombatSighting;
  if (!boss || distance(boss, c.location) < 250) return null;
  if (c.eventPursuitBossId && c.eventPursuitBossId !== boss.id) return null;
  c.eventPursuitBossId = boss.id;
  // Coordinate changes within the destination do not change cross-map transit.
  // Preserve its owned route until everyone reaches that map/instance, then
  // consume the current fresh sighting before pursuing the old final waypoint.
  if (c.participants.some(name => !samePlace(state.statuses[name]!, boss))) return null;
  return { map: boss.map, in: boss.in, x: boss.x, y: boss.y };
}

function eventTravel(c: SharedConvoy, moves: (key: string) => boolean): boolean {
  return c.phase === 'travel' && c.purpose === 'shared-walk' && c.walkingActivity === 'event' &&
    moves(c.walkingEvent || '') && preemptible(c) && c.readinessStartedAt === undefined;
}
function ownsEventWalk(state: SharedState, c: SharedConvoy, name: string, now: number): boolean {
  const s = state.statuses[name], command = state.commands[name], parent = c.walkingParents?.[name];
  if (!freshStatus(s, now) || !command || !parent || s.joinedEvent !== c.walkingEvent) return false;
  return command.convoyId === c.id && command.navigationRevision === parent.revision &&
    ownsRevision(state, name, parent.revision) && characterRuntime(s) === c.runtimes?.[name];
}
function ownsRevision(state: SharedState, name: string, revision: number): boolean {
  const intent = state.navigationIntents?.[name];
  return !!intent && intent.revision === revision && !intent.cancelled;
}
function actualBoss(s: SharedStatus | undefined, c: SharedConvoy, now: number): boolean {
  if (!freshStatus(s, now) || s.joinedEvent !== c.walkingEvent || s.server !== c.routeServer) return false;
  const boss = s.eventCombatSighting;
  if (!boss?.id || boss.mtype !== c.walkingEvent || !Number.isFinite(boss.observedAt)) return false;
  return freshBossPosition(boss, s, now) && samePlace(boss, s) && samePlace(boss, c.location);
}
// The member stamps the sighting on its own clock, so its measured clock difference bounds it.
function freshBossPosition(boss: NonNullable<SharedStatus['eventCombatSighting']>, s: SharedStatus, now: number): boolean {
  return fresh(boss.observedAt, now, 'report', reportClockError(s)) && Number.isFinite(boss.x) && Number.isFinite(boss.y);
}
export function freshStatus(s: SharedStatus | undefined, now: number): s is SharedStatus {
  return !!s && !s.rip && s.hp !== 0 && fresh(s.seenAt, now);
}

interface Location {
  map: string;
  x: number;
  y: number;
  [field: string]: unknown;
}
interface Command {
  id: number;
  type: string;
  location?: unknown;
  label?: unknown;
  navigationExempt?: boolean;
}
interface Status {
  seenAt: number;
  server?: string;
  map?: string;
  x?: number;
  y?: number;
  joinedEvent?: unknown;
  mapEvent?: unknown;
}
export interface ManualNavigationState {
  eventAttendance?: EventAttendance;
  eventSessions?: Record<string, {event:string; id?:string|null; lastLiveAt?:number; authorizedRealm?:string; authorizedAt?:number; participants:string[]; participationRecorded?:boolean} | undefined>;
  merchantCharacter: string | null;
  leader: string | null;
  activeRealm: string;
  statuses: Record<string, Status | undefined>;
  characterLocations: Record<string, unknown>;
  commands: Record<string, Command | undefined>;
}
export interface ManualNavigationPorts {
  now(): number;
  nextCommand(): number;
  queue(names: string[], reason: JobReason): void;
  releaseEscape(): void;
  authorize(names: string[], location: { map?: string; x: number; y: number }): void;
  authorizeRoute(names: string[], location: unknown, shared: boolean): void;
  members(): string[];
  // The app whose request runs this command, or undefined for the player.
  caller(): RequestCaller | undefined;
  // The party walk at the caller's tier, named for an app key.
  convoy(location: unknown, label: unknown, caller: RequestCaller | undefined): void;
  invalidate(names: string[], reason: string, shared: boolean): void;
  persist(): void;
  // The merchant's go-home command, the realm owner's.
  home(name: string): CommandOutcome;
}
export interface CommandReply {
  status: number;
  body: Record<string, unknown>;
}
/** undefined means another command family owns the request; null means normal acknowledgement. */
export type CommandOutcome = CommandReply | null | undefined;
function error(status: number, message: string): CommandReply {
  return { status, body: { error: message } };
}
function location(value: unknown): Location | null {
  const input = requestObject(value);
  return typeof input.map === "string" &&
    Number.isFinite(Number(input.x)) &&
    Number.isFinite(Number(input.y))
    ? { ...input, map: input.map, x: Number(input.x), y: Number(input.y) }
    : null;
}
export function createManualNavigationCommands(
  state: ManualNavigationState,
  ports: ManualNavigationPorts,
) {
  // An app key's travel reaches the character at tier `app`, so the character's movement
  // owner ranks it below the player's own command (movement rules.ts `app` row).
  function appTier(): { tier?: 'app'; by?: string } {
    const caller = ports.caller();
    return caller?.tier === 'app' ? { tier: 'app', by: caller.by } : {};
  }
  function travel(body: Record<string, unknown>, name: string): CommandOutcome {
    const destination = location(body.location);
    if (!destination) return undefined;
    if (name !== state.merchantCharacter) ports.releaseEscape();
    playerMoved(state, [name], destination, ports.now());
    ports.authorize([name], destination);
    merchantSlotCommand(state, 'travel:character-travel', {
      id: ports.nextCommand(),
      type: "character-travel",
      location: state.characterLocations[name],
      label: body.label || "destination",
      ...appTier(),
    }, name);
    ports.persist();
    return null;
  }
  function partyTravel(body: Record<string, unknown>, name: string): CommandOutcome {
    if (name !== state.leader || !location(body.location)) return undefined;
    const status = state.statuses[String(state.leader)];
    if (!status || !fresh(status.seenAt, ports.now(), 'presence'))
      return error(409, "an online party leader is required");
    if (body.resumeAfterEvent !== true)
      playerMoved(state, ports.members(), location(body.location), ports.now());
    ports.authorizeRoute(ports.members(), body.location, true);
    if (body.resumeAfterEvent === true && ports.members().some(attending))
      return { status: 200, body: { ok: true, deferredUntilEventEnd: true } };
    ports.convoy(body.location, body.label || "selected monster", ports.caller());
    return null;
  }
  function attending(name: string): boolean {
    const status = state.statuses[name];
    return !!status && !!(status.joinedEvent || status.mapEvent);
  }
  function town(name: string): null {
    const shared = name === state.leader;
    playerMoved(state, shared ? ports.members() : [name], { map: "main" }, ports.now());
    ports.invalidate(shared ? ports.members() : [name], "manual Town", shared);
    merchantSlotCommand(state, 'travel:character-travel', {
      id: ports.nextCommand(),
      type: "character-travel",
      location: { map: "main", x: -174, y: 121 },
      label: "town",
      navigationExempt: true,
    }, name);
    return null;
  }
  function leader(name: string): CommandOutcome {
    const status = state.statuses[String(state.leader)];
    if (!state.leader || state.leader === name || !status || !fresh(status.seenAt, ports.now(), 'presence'))
      return error(409, "an online different party leader is required");
    playerMoved(state, [name], { map: status.map }, ports.now());
    ports.authorize([name], { map: status.map, x: Number(status.x), y: Number(status.y) });
    merchantSlotCommand(state, 'travel:return-leader', { id: ports.nextCommand(), type: "return-leader", ...appTier() }, name);
    return null;
  }
  function handle(body: Record<string, unknown>): CommandOutcome {
    const name = requestText(body.character);
    switch (body.type) {
      case "bank":
        ports.queue([name], manualVisitReason(name, state.merchantCharacter));
        return null;
      case "character-travel":
        return travel(body, name);
      case "party-monster-travel":
        return partyTravel(body, name);
      case "town":
        return town(name);
      case "go-home":
        return ports.home(name);
      case "return-leader":
        return leader(name);
      default:
        return undefined;
    }
  }
  return { handle };
}

type FarmingRouteState = Parameters<typeof authorizeCoordinatorFarmingRoute>[0];
type NavigationState = ManualNavigationState & FarmingRouteState & { nextCommandId: number };
type BasePorts = Pick<
  ManualNavigationPorts,
  "now" | "queue" | "persist" | "home"
>;
interface ManualCompositionPorts extends BasePorts {
  // The party convoy start; a dashboard party travel names the `manual` tier (MOV-156b).
  convoy(location: unknown, label: unknown, names: undefined, purpose: undefined, cause: undefined, tier: Tier, by?: string): unknown;
  caller: ManualNavigationPorts['caller'];
  releaseEscape: () => void;
  navigation: {
    authorize: (names: string[], location: ReturnLocation, shared?: boolean) => void;
    members: () => string[];
    invalidate: (names: string[], reason: string, shared: boolean) => void;
  };
}

/** Route manual commands through the same live navigation ownership and recovery reset. */
export function createCoordinatorManualNavigation(state: NavigationState, ports: ManualCompositionPorts) {
  return createManualNavigationCommands(state, {
    now: () => ports.now(),
    nextCommand: () => state.nextCommandId++,
    queue: (names, reason) => ports.queue(names, reason),
    releaseEscape: ports.releaseEscape,
    // The manual commands validate each place before they authorize it (validFarmingLocation).
    authorize: (names, location) => ports.navigation.authorize(names, location as ReturnLocation),
    authorizeRoute: (names, location, shared) =>
      authorizeCoordinatorFarmingRoute(state, names, location, shared, {
        release: ports.releaseEscape,
        authorize: (members, destination, grouped) =>
          ports.navigation.authorize(members, destination as ReturnLocation, grouped),
      }),
    members: () => ports.navigation.members(),
    caller: ports.caller,
    convoy: (location, label, caller) => {
      ports.convoy(location, label, undefined, undefined, undefined, caller?.tier ?? 'manual', caller?.tier === 'app' ? caller.by : undefined);
    },
    invalidate: (names, reason, shared) => ports.navigation.invalidate(names, reason, shared),
    persist: () => ports.persist(),
    home: ports.home,
  });
}

interface SavedConvoy extends Omit<PartyConvoy, "epoch"> {
  geometryRepair?: import('./route-store.ts').SharedConvoy['geometryRepair'];
  [key: string]: unknown;
  epoch?: unknown;
}
export interface SavedCommands {
  convoyCompletionReceipts?: Record<string, string>;
  townCycle?: { id: string; pending: string[]; startedAt: number; revisions?: Record<string, number> } | null;
  returnProgress?: Record<string, import("../../events/api.ts").ReturnProgress>;
  activeConvoy?: SavedConvoy | null;
  navigationEpoch?: unknown;
}

function restartRevisions(convoy: SavedConvoy): Record<string, number> {
  if (convoy.restartRecovery && convoy.restartRevisions) return { ...convoy.restartRevisions };
  return Object.fromEntries(
    Object.entries(convoy.expected || {}).map(([name, expected]) => [name, expected.revision]),
  );
}

function retainedEventFailure(saved: SavedCommands): boolean {
  const c = saved.activeConvoy;
  return retainedHuntFailure(saved) || c?.failureCode === 'geometry-mismatch' || (c?.phase === "failed" && c.purpose === "shared-walk" && c.walkingActivity === "event");
}
function retainedHuntFailure(saved: SavedCommands): boolean {
  const c=saved.activeConvoy;
  if (c?.phase!=='failed' || !['route-failed','hunt-route-held'].includes(c.failureCode || '')) return false;
  return !!c.continuousReturn || c.purpose==='monster-hunt' || c.purpose==='shared-walk' && c.walkingActivity==='farm-recovery';
}
function restoredCommunication(c: SavedConvoy | null | undefined, now: () => number): Pick<PartyConvoy, 'communicationHold' | 'communicationLegacyRecovered'> {
  if (!c) return {};
  if (c.communicationHold) return { communicationHold: c.communicationHold, communicationLegacyRecovered: c.communicationLegacyRecovered };
  if (capturedCommunicationFailure(c)) {
    delete c.returnFirstFailure;
    return {communicationHold: {since: now(), reason:'Recovering captured coordinator communication failure', participants:c.participants, legacy:true}, communicationLegacyRecovered:true};
  }
  if (legacyCompletionFailure(c)) return {
    communicationHold: { since: now(), reason: 'Recovering failed completion acknowledgement', participants: c.participants, legacy: true },
    communicationLegacyRecovered: true,
  };
  if (restorableCommunication(c)) return {
    communicationHold: { since: now(), reason: 'Coordinator restarted; waiting for fresh party reports', participants: c.participants,
      resumeDefense: retainedDefense(c) },
  };
  return {};
}
function retainedDefense(c: SavedConvoy): boolean {
  return c.phase === 'defending' || c.observationPhase === 'defending' || !!c.loot;
}
function restoredPhase(saved: SavedConvoy, hold: PartyConvoy['communicationHold']): string {
  if (hold) return 'communication-hold';
  return saved.geometryRepair?.phase === 'waiting' ? 'shared-hold' : 'failed';
}
export function restoredConvoy(saved: SavedCommands, now: () => number): PartyConvoy | null {
  migrateReturn(saved.activeConvoy);
  const communication = restoredCommunication(saved.activeConvoy, now);
  return saved.activeConvoy
    ? {
        ...saved.activeConvoy,
        ...(saved.activeConvoy.merchantInterruption ? { merchantInterruption: {
          ...(saved.activeConvoy.merchantInterruption as object), phase: "resuming",
        } } : {}),
        epoch: Number(saved.activeConvoy.epoch) || now(),
        ...communication,
        phase: restoredPhase(saved.activeConvoy, communication.communicationHold),
        departAt: null,
        failure: retainedEventFailure(saved) ? saved.activeConvoy.failure : "Coordinator restarted; waiting to recover interrupted travel",
        failureCode: retainedEventFailure(saved) ? saved.activeConvoy.failureCode : "runtime-lost",
        failedAt: retainedEventFailure(saved) ? saved.activeConvoy.failedAt : now(),
        restartRecovery: !retainedHuntFailure(saved) && saved.activeConvoy.failureCode !== 'geometry-mismatch',
        restartRevisions: restartRevisions(saved.activeConvoy),
      }
    : null;
}
function migrateReturn(c:SavedConvoy | null | undefined):void {
  if(!c)return;
  if(c.walkingActivity==='anniversary-staging' || c.purpose==='monster-hunt' && c.returnRouting)c.continuousReturn=1;
}

function restorableCommunication(c: SavedConvoy): boolean {
  // Ordinary travel keeps restart recovery's captured navigation checks and its ladder.
  if ([null, undefined, 'party-travel', 'party-force-travel'].includes(c.purpose)) return false;
  return c.phase !== 'failed' && c.geometryRepair?.phase !== 'waiting';
}

type ConvoyState = Parameters<typeof createPartyConvoys>[0];
type ConvoyPorts = Parameters<typeof createPartyConvoys>[1];
interface SelectionState<CatalogEntry> extends ConvoyState {
  nextCommandId: number;
  monsterChoices?: CatalogEntry[] | null;
  targetMode: string;
  monsterHunt?: { target?: string | null } | null;
  monsterFocus?: string[] | null;
}
type ConvoyCompositionPorts<CatalogEntry> = Pick<
  ConvoyPorts,
  "now" | "activeNames" | "intent" | "persist" | "group" | "live" | "listeners"
> & {
  log: (message: string) => void;
  resolveArea: (
    catalog: CatalogEntry[],
    monsters: string[],
    location: Parameters<ConvoyPorts["resolve"]>[0],
  ) => ReturnType<ConvoyPorts["resolve"]>;
};

/** Resolve each new convoy against current Hunt selection or shared farming focus. */
export function createCoordinatorPartyConvoys<CatalogEntry>(
  state: SelectionState<CatalogEntry>,
  ports: ConvoyCompositionPorts<CatalogEntry>,
) {
  const convoyPorts = {
    now: () => ports.now(),
    nextCommand: () => state.nextCommandId++,
    activeNames: () => ports.activeNames(),
    intent: (name: string) => ports.intent(name),
    persist: () => ports.persist(),
    group: ports.group,
    live: ports.live,
    listeners: ports.listeners,
    resolve: (input: Parameters<ConvoyPorts["resolve"]>[0]) =>
      ports.resolveArea(
        state.monsterChoices || [],
        partyFocus(state),
        input,
      ),
  };
  const convoys = createPartyConvoys(state, convoyPorts);
  return {
    ...convoys,
    // The convoy's progress shows on each member's card, so its recovery lines go to the
    // console's own log, not the merchant activity.
    recoverRestart: createConvoyRestartRecovery(state, convoyPorts, convoys, ports.log),
  };
}

// A member in an event, or whose player cancelled its navigation intent, does not arrive
// with the Hunt walk, as b9b5c91e hunt-arrival.ts:25-27 decided.
function memberBlocked(s: SharedStatus, intent: { cancelled?: boolean } | undefined): boolean {
  return !!s.activeEvent || !!s.joinedEvent || !!intent?.cancelled;
}

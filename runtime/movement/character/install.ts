// The movement owner's install on the character ("Movement's last --close 02 list", part 3). installMovementCharacter
// builds movement's parts on the character in the order shared.js built them: the member's group walk and its
// navigation, the requesters, the movers, the reunion's crossings, the errand walk, the combat steps, the approaches,
// the formation solver and the group movement. Each part reaches another part's functions and the owner's walk state
// (owner.ts `WalkState`) here; shared.js, the character's composition root, hands in only other owners' reads, state
// and the game client (root wiring). A part reads a part built after it only when asked, after the install returns.
import { createWalkClient, createNavigation, type WalkClient } from './walk-client.ts';
import { defendConvoy, installMovementRequesters, nextTownGeneration, showNavigation, type WalkState } from './owner.ts';
import { installMovementMovers, type MoverPorts, type MoverService } from './movers.ts';
import { installReunionCrossings, type ReunionMovement } from './crossings.ts';
import { installErrands } from './errands.ts';
import { createCombatSteps } from './steps.ts';
import { createApproach } from './approach.ts';
import { createFormationSolver, installGroupMovement } from './formation.ts';
import { installWalkCommands, type WalkCommandPorts } from './commands.ts';
import { sendCruise } from './executor.ts';
import { sendBand } from '../rules.ts';
import type { HookRegistry } from '../../hooks/registry.ts';
import { coreRegistrations } from '../../hooks/core.ts';
import { escapeMemberResets } from '../../characters/survival/api.ts';
import { attackReadyAt } from '../../characters/turns/api.ts';

type WalkPorts = Parameters<typeof createWalkClient>[1];
type NavigationPorts = Parameters<typeof createNavigation>[2];
type RequesterPorts = Parameters<typeof installMovementRequesters>[1];
type CrossingsPorts = Parameters<typeof installReunionCrossings>[1];
type ErrandPorts = Parameters<typeof installErrands>[1];
type StepsPorts = Parameters<typeof createCombatSteps>[2];
type ApproachPorts = Parameters<typeof createApproach>[2];
type SolverPorts = Parameters<typeof createFormationSolver>[2];
type GroupPorts = Parameters<typeof installGroupMovement>[2];
type Host = Parameters<typeof createWalkClient>[0] & Parameters<typeof createNavigation>[0] & Parameters<typeof installReunionCrossings>[0]
  & Parameters<typeof installErrands>[0] & Parameters<typeof createCombatSteps>[0] & Parameters<typeof createApproach>[0]
  & Parameters<typeof createFormationSolver>[0] & Parameters<typeof installGroupMovement>[0] & Parameters<typeof installWalkCommands>[0]['host'];
interface Movement extends MoverService { walkState: WalkState; stop(kind: string, ignored: undefined, request?: unknown): Promise<unknown>; cancel(reason: string, detail: Record<string, unknown>): Promise<unknown> }

// The ports each part takes from movement itself, which the install answers.
type Own = 'movement' | 'service' | 'notify' | 'intent' | 'setIntent' | 'clockOffset' | 'setClockOffset' | 'runtimeId' | 'realm' | 'stop' | 'follows' | 'endFollows'
  | 'forceTravel' | 'endFollow' | 'endConvoyActive' | 'endForceTravel' | 'following' | 'forceTraveling' | 'townTraveling' | 'town'
  | 'convoyActive' | 'attackReadyAt' | 'kite' | 'formation' | 'performance' | 'independentApproach' | 'independentApproachOwns' | 'interceptCenter'
  | 'safePoint' | 'townActive' | 'groupWalking' | 'kiting' | 'approachRouted' | 'walk' | 'loneWalkRequest' | 'walkRequest'
  | 'walkIdentity' | 'convoyRequest' | 'xmoveAs' | 'ownerTickUntil' | 'nextPass' | 'handoffSettled' | 'journeyHandle' | 'walkStands' | 'timed'
  | 'sharedMovementOptions' | 'returnPhaseRecord' | 'sharedPartyWalk' | 'nextReport' | 'reportOrSilence' | 'blinkAs' | 'reunionRequest' | 'xmove'
  | 'transport' | 'reportGap' | 'farmApproachRequest' | 'setFormationFrame' | 'formationBody' | 'formationMotion' | 'recoverCorner'
  | 'cancelGroupRoute' | 'combatDistance' | 'combatApproachPoint' | 'safeCombatPoint' | 'resetCombatMovement' | 'desiredCombatRange'
  | 'sendCombatMove' | 'kiteIfNeeded' | 'rangeReference' | 'cancelFarmApproach' | 'covered' | 'recoveryRequest' | 'formationMove'
  | 'holdFormation' | 'logGroupMovement' | 'catchupRequest' | 'endTaskWalk' | 'climbTaskWalk' | 'farmTravel' | 'setDeparture'
  | 'partyLocation' | 'farmTravelPaused' | 'setPartyLocation' | 'movers' | 'defensiveFormationMove';
// What shared.js hands in: every part's ports that read other owners or the game. Four names differ
// by part, so they come in under their own names: the walk client's departure fight test, and the
// movers' joined event name, rare control and farm area test.
export type CharacterPorts = Omit<WalkPorts, Own | 'departurePending'> & Omit<NavigationPorts, Own> & Omit<RequesterPorts, Own>
  & Omit<MoverPorts, Own | 'joinedEvent' | 'rareControl' | 'inFarmArea' | 'departurePending'> & Omit<CrossingsPorts, Own> & Omit<ErrandPorts, Own | 'request'>
  & Omit<StepsPorts, Own> & Omit<ApproachPorts, Own> & Omit<SolverPorts, Own> & Omit<GroupPorts, Own> & WalkCommandPorts & {
    departureCombatPending: WalkPorts['departurePending'];
    joinedEventName: MoverPorts['joinedEvent'];
    moverRareControl: MoverPorts['rareControl'];
    inFarmAreaAt: MoverPorts['inFarmArea'];
    // The tasks owner's farm reunion, which an escape ends.
    dropReunion(): void;
    // The stand-ins' movers the tick runs: S-the hunting owner's rare and farm polls and the survival owner's
    // Cave recovery.
    pollRareHunting(): boolean;
    pollFarmingCombatHandoff(): void;
    caveRecoveryMove(): boolean;
  };
const roleRunner = coreRegistrations.find(r => r.name === 'core:role-runner')!;

export function installMovementCharacter(root: Host, movement: Movement, hooks: Pick<HookRegistry, 'publish' | 'notify'>, ports: CharacterPorts) {
  const state = movement.walkState;
  const stopSmart = (request: unknown) => movement.stop('smart', undefined, request);
  // The service, its stop and the requesters the walk client, the crossings and the errands ask.
  const parts: MovementParts = { movement: () => movement, stop: movement.stop, requesters: () => requesters };
  // The parts built after the one that asks them.
  let requesters!: ReturnType<typeof installMovementRequesters>, navigation!: ReturnType<typeof createNavigation>,
    crossings!: ReturnType<typeof installReunionCrossings>, steps!: ReturnType<typeof createCombatSteps>,
    approach!: ReturnType<typeof createApproach>, formation!: ReturnType<typeof createFormationSolver>,
    group!: ReturnType<typeof installGroupMovement>, commands!: ReturnType<typeof installWalkCommands>;
  // The farming walk's travel token (commands.ts) and the departure (walk state) the parts read.
  const farmTravel = () => commands.farmTravel(), setDeparture = (on: boolean) => { state.departing = on; };
  // The party's farm spot and the farm travel pause (walk state), which the walk client, the
  // approach, the crossings, the formation and the walk commands read or write.
  const spot = { ...farmSpotPorts(state),
    // The walk state's Town generation, convoy defense and navigation detail, each written by its
    // one writer in owner.ts.
    townGeneration: () => state.townGeneration, convoyDefense: () => state.convoyDefense,
    defendConvoy: (convoy: string | null) => defendConvoy(state, convoy), showNavigation: (detail: string | null) => showNavigation(state, detail) };
  const { endFollow, endConvoyActive } = walkEnds(state);
  // A convoy's release ends its cruise, cancels the walk and ends the follow.
  const releaseConvoy = (): void => {
    const travel = walkClient.groupWalk.travel;
    if (travel) { walkClient.releaseConvoyCruise(travel); travel.cancelled = true; }
    state.following = false;
  };
  // The walk reads and writes other owners' installs take; shared.js hands each one as it hands
  // the parts above.
  const walk = {
    // The hunting owner's farm spots: a point a body can stand on (can_move), as
    // shared.js:32 read it.
    walkable(p: { map: string; x: number; y: number }): boolean {
      const base = (ports.character() as { base?: unknown }).base;
      return typeof root.can_move !== 'function' || root.can_move({ map: p.map, x: p.x, y: p.y, going_x: p.x, going_y: p.y, base });
    },
    // The hunting owner's target test: the combat approach point is a straight
    // walk away.
    reachable(target: Parameters<typeof steps.combatApproachPoint>[0]): boolean {
      const at = steps.combatApproachPoint(target);
      return !!(at && typeof root.can_move_to === 'function' && root.can_move_to(at.x, at.y));
    },
    // The events owner's poll: the combat approach's live journey walks to this target.
    approaching(target: { id?: unknown } | null | undefined): boolean { return approach.approachingTarget(target); },
    // The hunting owner's target pick ends the leader follow: the follow path stops and the
    // follow flag drops.
    endFollowForTarget(): void { void stopSmart(requesters.followRequest); state.following = false; },
    // The lifecycle owner's drain walks. The checkpoint return is a forced walk: the forced
    // walk flag holds from its start until it settles.
    lifecycleWalk(goal: unknown, request: unknown, forced: boolean): Promise<unknown> {
      if (forced) state.forceTraveling = true;
      const walking = Promise.resolve(ports.smartMove(goal, undefined, { request }));
      return forced ? walking.finally(() => { state.forceTraveling = false; }) : walking;
    },
    // The events owner's anniversary staging: whether a convoy holds the character, the release that
    // ends it, the preemption of the convoy under the visit's request, and the follow's end before
    // its kiss walk.
    convoying: () => !!(state.convoyActive || walkClient.groupWalk.travel),
    releaseConvoy,
    yieldConvoy: (request: unknown, owns: () => boolean) => yieldConvoy({ release: releaseConvoy,
      stop: (kind, by) => movement.stop(kind, undefined, by), end: endConvoyActive }, request, owns),
    endFollow(request: unknown): Promise<unknown> { endFollow(); return movement.stop('smart', undefined, request); },
    // The hunting owner's Cave run caps its own walk speed through the executor's cruise door,
    // on the job band.
    cruise: (speed?: number) => sendCruise(root, speed, sendBand(undefined)),
    // The status owner's telemetry: the convoy signal, or the walk it started.
    convoyWalk: () => walkClient.groupWalk.signal || walkClient.groupWalk.travel,
  };
  const walkClient = createWalkClient(root, { ...ports, ...spot, farmTravel,
    departurePending: ports.departureCombatPending,
    ...walkClientPorts(state, parts, () => crossings.reunionRealm()),
  });
  requesters = installMovementRequesters(walkClient, { ...ports, ...spot, setDeparture,
    movement: () => movement, sharedMovementOptions: walkClient.sharedMovementOptions,
    returnPhaseRecord: (command, kind) => navigation.returnPhaseRecord(command, kind),
    keepReturnProgress: progress => navigation.keepReturnProgress(progress),
    town: () => ({ active: state.townActive, traveling: state.townTraveling }),
    endFollow,
  });
  const follow = installMovementMovers({ ...ports, ...spot, service: () => movement,
    joinedEvent: ports.joinedEventName, rareControl: ports.moverRareControl, inFarmArea: ports.inFarmAreaAt,
    intent: () => state.intent,
    following: on => { state.following = on; },
    townActive: () => !!state.townActive, convoyActive: () => !!state.convoyActive, groupWalking: () => !!walkClient.groupWalk.travel,
    departurePending: ports.departureCombatPending,
    kiting: () => !!steps.kiteState.targetId,
    approachRouted: () => !!approach.farmApproach.route,
    walk: destination => ports.smartMove(destination, undefined, { request: requesters.followRequest }),
    movers: () => ({ resetCombatMovement: () => character.resetCombatMovement(), kiteIfNeeded: steps.kiteIfNeeded, approachCombatTarget: steps.approachCombatTarget,
      defensiveFormationMove: formation.defensiveFormationMove, formationMove: formation.formationMove, groupedMovement: group.groupedMovement,
      recoverFarmApproach: approach.recoverFarmApproach, addonWalk: requesters.addonWalk, endAddonWalk: requesters.endAddonWalk,
      convoyDefenseTriggers: walkClient.convoyDefenseTriggers, dungeonOwned: ports.dungeonOwned, pollRareHunting: ports.pollRareHunting,
      pollFarmingCombatHandoff: ports.pollFarmingCombatHandoff, caveRecoveryMove: ports.caveRecoveryMove }),
  }, hooks);
  navigation = createNavigation(root, walkClient, { ...ports, ...spot, farmTravel,
    intent: () => state.intent, setIntent: next => { state.intent = next; },
    follows: () => state.following || state.forceTraveling,
    endFollows: () => { state.following = false; state.forceTraveling = false; },
    stop: movement.stop,
  });
  crossings = installReunionCrossings(root, { ...ports, ...spot, ...crossingsPorts(state, parts, walkClient) });
  const errands = installErrands(root, { ...ports, ...spot, ...errandPorts(state, parts, crossings.reunionRealm) });
  steps = createCombatSteps(root, walkClient, { ...ports, ...spot,
    movement: () => movement, intent: () => state.intent,
    following: () => state.following, forceTraveling: () => state.forceTraveling, townTraveling: () => state.townTraveling,
    formation: () => formation.formationState, performance: () => formation.formationPerformance,
    independentApproachOwns: () => approach.independentApproachOwnsJourney(),
    interceptCenter: (target, desired) => approach.combatInterceptCenter(target, desired),
    safePoint: point => formation.formationRecoverySafePoint(point),
  });
  approach = createApproach(root, walkClient, { ...ports, ...spot, notify: hooks.notify.bind(hooks), attackReadyAt,
    movement: () => movement, intent: () => state.intent, clockOffset: () => state.clockOffset,
    convoyActive: () => state.convoyActive, realm: crossings.reunionRealm,
    journeyHandle: requesters.journeyHandle, farmApproachRequest: requesters.farmApproachRequest,
    combatDistance: steps.combatDistance, combatApproachPoint: steps.combatApproachPoint, safeCombatPoint: steps.safeCombatPoint,
    resetCombatMovement: steps.resetCombatMovement,
    setFormationFrame: frame => { formation.setFormationFrame(frame); },
    formationBody: (entity, point) => formation.formationBody(entity, point),
    formationMotion: entity => formation.formationMotion(entity),
    recoverCorner: (reference, priest, selfPriest, members, step) => formation.recoverFormationCorner(reference, priest, selfPriest, members, step),
    cancelGroupRoute: () => group.cancelGroupRoute(),
    nextReport: requesters.nextReport,
  });
  formation = createFormationSolver(root, walkClient, { ...ports, ...spot,
    movement: () => movement, intent: () => state.intent, clockOffset: () => state.clockOffset, realm: crossings.reunionRealm,
    convoyActive: () => state.convoyActive, following: () => state.following, kite: () => steps.kiteState,
    combatDistance: steps.combatDistance, desiredCombatRange: steps.desiredCombatRange, resetCombatMovement: steps.resetCombatMovement,
    sendCombatMove: steps.sendCombatMove, safeCombatPoint: steps.safeCombatPoint, combatApproachPoint: steps.combatApproachPoint,
    kiteIfNeeded: steps.kiteIfNeeded,
    independentApproach: () => approach.independentApproach, independentApproachOwns: approach.independentApproachOwnsJourney,
    interceptCenter: approach.combatInterceptCenter, rangeReference: approach.combatRangeReference,
    cancelFarmApproach: approach.cancelFarmApproach,
    covered: () => group.groupedCovered(), cancelGroupRoute: () => group.cancelGroupRoute(),
    recoveryRequest: () => requesters.terrainRecoveryRequest, stop: stopSmart,
  });
  group = installGroupMovement(root, walkClient, { ...ports, ...spot,
    movement: () => movement, intent: () => state.intent, clockOffset: () => state.clockOffset,
    convoyActive: () => state.convoyActive, kite: () => steps.kiteState, formation: () => formation.formationState,
    realm: crossings.reunionRealm, combatDistance: steps.combatDistance, safeCombatPoint: steps.safeCombatPoint,
    cancelFarmApproach: approach.cancelFarmApproach, formationMove: formation.formationMove, holdFormation: formation.holdFormation,
    defensiveFormationMove: () => formation.defensiveFormationMove(),
    logGroupMovement: walkClient.logGroupMovement,
    catchupRequest: requesters.catchupRequest, endTaskWalk: requesters.endTaskWalk, climbTaskWalk: requesters.climbTaskWalk,
    nextReport: requesters.nextReport,
  });
  commands = installWalkCommands({ host: root, state, groupWalk: walkClient.groupWalk, movement,
    releaseConvoyCruise: walkClient.releaseConvoyCruise, endConvoyWalk: walkClient.endConvoyWalk, convoyRequest: requesters.convoyRequest,
    cancelEnds: walkClient.cancelEnds, claim: requesters.claim, walkRequest: requesters.walkRequest,
    townLanded: requesters.townLanded, prepareReturnExit: requesters.prepareReturnExit, sharedPartyWalk: walkClient.sharedPartyWalk,
    returnWorkflowSuperseded: requesters.returnWorkflowSuperseded, townCast: requesters.townCast, townReady: requesters.townReady, townRequest: requesters.townRequest,
    nextPass: requesters.nextPass, reportOrSilence: requesters.reportOrSilence,
    coordinatedMonsterTravel: walkClient.coordinatedMonsterTravel, cancelFarmApproach: approach.cancelFarmApproach,
    cancelGroupRoute: () => group.cancelGroupRoute(), restoreReunionHandlers: crossings.restoreReunionHandlers,
    farmApproach: approach.farmApproach, manualRequest: requesters.manualRequest, followRequest: requesters.followRequest }, { ...ports, ...spot });
  const reunion = reunionMovement(state, { requesters, crossings, walkClient, kite: steps.kiteState });
  // The escape's moment that ends the character's other travel. The notice runs inside the escape's
  // apply, so the moment is today's; each CODE reload publishes its own closure's listener.
  const published = hooks.publish({ ...roleRunner, hooks: { 'survival.escapeMember': notice => {
    if (notice.character !== ports.character().name || !escapeMemberResets(notice)) return;
    endTravelForEscape({ travel: () => walkClient.groupWalk.travel, endConvoyWalk: walkClient.endConvoyWalk,
      farmTravel, dropReunion: ports.dropReunion, crossing: crossings.reunionCrossing, state });
  } } });
  if (!published.ok) throw Error(`The movement owner's escape listener did not load: ${published.message}`);
  // Table A's `convoy` row. The transport receipt already installed the clock timing and the walking
  // lease; the new convoy barrier installs before Escape releases, since stop() yields and role
  // timers could otherwise begin an independent route in this gap. A merchant takes no party Town.
  const realm = root as unknown as Record<string, unknown>;
  // A newer fast heartbeat can renew the owned journey while full status yields, so both rows
  // read the convoy activity at their own point, as v1.5.0 did.
  function readConvoyActivity(reply: Record<string, any>): void {
    state.convoyActive = walkClient.convoyActivityFromStatus(reply);
    if (!state.convoyActive) defendConvoy(state, null);
  }
  function convoyReply(reply: Record<string, any>): void {
    readConvoyActivity(reply);
    state.townActive = ports.character().ctype !== 'merchant' && !!reply.partyTownActive;
    realm.__partyTownCycleId = reply.partyTownCycleId || null;
    navigation.keepReturnProgress(reply.returnProgress || null);
  }
  // Table A's `party-walks` row: the party's farm spot and the farm travel pause, then the convoy
  // signal's geometry, the end of a walk whose signal failed, the release of a convoy the coordinator
  // no longer runs, and the party Town while it lasts. The row reads the signal and the convoy
  // activity after the awaited rows and before its own awaited stop, so a convoy a newer
  // fast-channel signal renewed keeps walking.
  async function partyWalksReply(reply: Record<string, any>): Promise<void> {
    readConvoyActivity(reply);
    state.partyLocation = reply.partyLocation || null;
    state.farmTravelPaused = !!reply.farmTravelPaused;
    const walk = walkClient.groupWalk as { travel: any; signal: any }, signal = walk.signal;
    walkClient.reloadConvoyGeometry(signal);
    if (walk.travel && signal && signal.id === walk.travel.id && Number(signal.epoch) === walk.travel.epoch && signal.phase === 'failed' && walk.travel.fail)
      walk.travel.fail(signal.reason || 'Convoy held by coordinator');
    if (walk.travel && !state.convoyActive) {
      walkClient.endConvoyWalk(walk.travel);
      try { await movement.stop('smart', undefined, requesters.convoyRequest(walk.travel)); }
      catch (error) { ports.gameLog('Cancelled convoy stop failed: ' + String(error), 'red'); }
      walk.travel = null;
      showNavigation(state, null);
    }
    if (state.townActive) requesters.enforcePartyTownOverride().catch((error: { reason?: unknown; message?: unknown }) => {
      ports.gameLog('Town override retry failed: ' + (error.reason || error.message || error), 'red');
    });
  }
  // Table A's `leader-follow` row: a follow path is an asynchronous smart_move, and turning Follow
  // off leaves the path in progress running, so the row stops it and hands control back.
  async function endLeaderFollow(ended: boolean): Promise<void> {
    if (!(ended && state.following)) return;
    await movement.stop('smart', undefined, requesters.followRequest);
    ports.gameLog('Leader follow stopped; manual movement is available', '#51D2E1');
  }
  const character = { walkClient, ...walkClient, ...navigation, ...requesters, follow, ...crossings, ...errands, ...steps, ...approach,
    ...formation, ...group, ...walk, reunion, commands, setDeparture,
    // The coordinator's time: the character's clock and the walk's measured offset (the status owner's
    // telemetry and queue markers stamp with it).
    coordinatorNow: () => Date.now() + state.clockOffset,
    convoyReply, navigationReply: (reply: { navigationIntent?: Parameters<typeof navigation.applyNavigationIntent>[0] }) => navigation.applyNavigationIntent(reply.navigationIntent),
    endLeaderFollow, partyWalksReply,
    // The role runner's movement tick, which the movers build beside `follow` (movers.ts).
    startMovementTick: follow.startMovementTick };
  // Movement's character door on the frame: the role runner's tick and reset, the queue client's
  // recovery clients and the e2e probes read movement's parts here, each CODE load its own.
  (root as unknown as Record<string, unknown>).partyMovement = character;
  return character;
}

Object.assign(globalThis, { installMovementCharacter });

// The port builders installMovementCharacter hands its parts. Each reads the walk state and the
// parts it names at the call, so a test that builds a part over a sliced context's walk state and
// functions (scripts/tests/helpers) wires it as play does.
type Requesters = ReturnType<typeof installMovementRequesters>;
// The movement service, its stop and the requesters, built after the walk client.
interface MovementParts { movement(): unknown; stop: Movement['stop']; requesters(): Requesters }
// A requester's own request type, which each part's port names in its own terms.
type Held<K extends keyof Requesters> = Parameters<Extract<Requesters[K], (...args: any[]) => unknown>>[0];
// The party's farm spot and the farm travel pause.
export function farmSpotPorts(state: WalkState) {
  return { partyLocation: () => state.partyLocation, farmTravelPaused: () => state.farmTravelPaused,
    setPartyLocation: (location: unknown) => { state.partyLocation = location as typeof state.partyLocation; } };
}
// The walk client's own ends of the follow and of the reported convoy (walk-client.ts).
export function walkEnds(state: WalkState) {
  return { endFollow: () => { state.following = false; }, endConvoyActive: () => { state.convoyActive = false; } };
}
// The walk client's ports that movement answers: the walk flags and clock, the service, the
// reunion's realm and the requesters' identities, holds and passes.
export function walkClientPorts(state: WalkState, parts: MovementParts, realm: () => string): Pick<WalkPorts,
    'movement' | 'stop' | 'forceTravel' | 'endForceTravel' | 'endFollow' | 'endConvoyActive' | 'convoyActive' | 'intent' | 'runtimeId' | 'clockOffset'
    | 'setClockOffset' | 'realm' | 'loneWalkRequest' | 'walkRequest' | 'walkIdentity' | 'convoyRequest' | 'xmoveAs' | 'ownerTickUntil' | 'nextPass'
    | 'handoffSettled' | 'journeyHandle' | 'walkStands' | 'timed' | 'nextReport'> {
  return { ...walkEnds(state),
    movement: () => parts.movement() as ReturnType<WalkPorts['movement']>, stop: (kind: string, ignored: undefined, request: unknown) => parts.stop(kind, ignored, request),
    forceTravel: () => { state.forceTraveling = true; }, endForceTravel: () => { state.forceTraveling = false; },
    convoyActive: () => state.convoyActive,
    intent: () => state.intent, runtimeId: () => state.runtimeId,
    clockOffset: () => state.clockOffset, setClockOffset: offset => { state.clockOffset = offset; },
    realm,
    loneWalkRequest: (activity, key) => parts.requesters().loneWalkRequest(activity, key),
    walkRequest: command => parts.requesters().walkRequest(command),
    walkIdentity: (requester, convoyId, epoch, revision, group) => parts.requesters().walkIdentity(requester, convoyId, epoch, revision, group),
    convoyRequest: convoy => parts.requesters().convoyRequest(convoy),
    xmoveAs: (request, x, y) => parts.requesters().xmoveAs(request, x, y),
    ownerTickUntil: (holder, test) => parts.requesters().ownerTickUntil(holder, test),
    nextPass: holder => parts.requesters().nextPass(holder),
    handoffSettled: convoy => parts.requesters().handoffSettled(convoy),
    journeyHandle: () => parts.requesters().journeyHandle(),
    walkStands: (command, owns) => parts.requesters().walkStands(command, owns),
    timed: (request: Held<'timed'>) => parts.requesters().timed(request),
    nextReport: () => parts.requesters().nextReport(),
  };
}
// The reunion crossings' ports that movement answers: the service and its smart stop, the walk's
// intent and clock, the shared party walk, and the requesters' passes and identities.
export function crossingsPorts(state: WalkState, parts: MovementParts,
    walk: Pick<WalkClient, 'sharedPartyWalk'>): Pick<CrossingsPorts, 'movement' | 'intent' | 'clockOffset' | 'sharedPartyWalk' | 'stop' | 'reportOrSilence'
    | 'nextPass' | 'timed' | 'blinkAs' | 'reunionRequest'> {
  return { movement: () => parts.movement() as ReturnType<CrossingsPorts['movement']>, intent: () => state.intent, clockOffset: () => state.clockOffset,
    sharedPartyWalk: (...args) => walk.sharedPartyWalk(...args), stop: request => parts.stop('smart', undefined, request),
    reportOrSilence: holder => parts.requesters().reportOrSilence(holder), nextPass: holder => parts.requesters().nextPass(holder), timed: (request: Held<'timed'>) => parts.requesters().timed(request),
    blinkAs: (request: Held<'blinkAs'>, x, y) => parts.requesters().blinkAs(request, x, y), reunionRequest: token => parts.requesters().reunionRequest(token) };
}
// The errand walk's ports that movement answers: the service and its stops, the walk's intent and
// clock, the reunion's realm, and the errand identity with its crossings, passes and reports.
export function errandPorts(state: WalkState, parts: MovementParts, realm: () => string): Pick<ErrandPorts,
    'movement' | 'intent' | 'clockOffset' | 'realm' | 'request' | 'xmove' | 'transport' | 'stop' | 'nextReport' | 'nextPass' | 'reportGap'> {
  return { movement: () => parts.movement() as ReturnType<ErrandPorts['movement']>, intent: () => state.intent, clockOffset: () => state.clockOffset, realm,
    request: parts.requesters().errandRequest, xmove: (request: Held<'xmoveAs'>, x, y) => parts.requesters().xmoveAs(request, x, y),
    transport: (request: Held<'transportAs'>, map, spawn) => parts.requesters().transportAs(request, map, spawn),
    stop: (kind, request) => parts.stop(kind, undefined, request),
    nextReport: () => parts.requesters().nextReport(), nextPass: holder => parts.requesters().nextPass(holder), reportGap: () => parts.requesters().reportGap() };
}
// The farm reunion's movement (ReunionMovement): its request and crossings, the shared walk's
// activity, and its start, where the reunion's walk takes over, so the follow ends and the kite
// drops its target.
export function reunionMovement(state: WalkState, parts: { requesters: Pick<Requesters, 'reunionRequest'>;
    crossings: Omit<ReunionMovement, 'reunionRequest' | 'sharedWalkActivity' | 'reunionStarts'>; walkClient: Pick<WalkClient, 'sharedWalkActivity'>;
    kite: { targetId: unknown } }): ReunionMovement {
  const { requesters, crossings, walkClient, kite } = parts;
  return { reunionRequest: token => requesters.reunionRequest(token), reunionRealm: () => crossings.reunionRealm(), reunionCrossing: crossings.reunionCrossing,
    reunionAt: (c, location) => crossings.reunionAt(c, location), reunionArrived: walk => crossings.reunionArrived(walk),
    reunionTravel: (token, walk) => crossings.reunionTravel(token, walk), reunionWait: token => crossings.reunionWait(token),
    reunionEnded: token => crossings.reunionEnded(token), sharedWalkActivity: () => walkClient.sharedWalkActivity(),
    reunionStarts() { state.following = false; kite.targetId = null; } };
}

// A convoy preemption another requester asks (the events owner's anniversary visit): the convoy's
// release, then its smart route's and its direct move's stops under the requester's request. The
// requester's `owns` is read after each stop, and convoyActive ends once both stops land while it
// holds.
export async function yieldConvoy(p: { release(): void; stop(kind: string, request: unknown): Promise<unknown>; end(): void },
    request: unknown, owns: () => boolean): Promise<boolean> {
  p.release();
  try { await p.stop('smart', request); } catch (_) { /* No smart route is active. */ }
  if (!owns()) return false;
  try { await p.stop('move', request); } catch (_) { /* No direct move is active. */ }
  if (!owns()) return false;
  p.end();
  return true;
}

// What an escape the character joins, or a stage change that leaves it walking or holding alone,
// ends of movement's state, as v1.5.0's `applyEscape` did: the group walk's cruise and
// the walk itself, the farm travel token, the reunion and its Magiport offer, the follow and the
// forced walk, and the party Town loop's generation. The escape then stops smart and move under its
// own identity.
export function endTravelForEscape<Walk>(p: { travel(): Walk | null | undefined; endConvoyWalk(travel: Walk): void;
  farmTravel(): { cancelled?: boolean } | null | undefined; dropReunion(): void; crossing: { offer: unknown };
  state: WalkState }): void {
  const travel = p.travel();
  if (travel) p.endConvoyWalk(travel);
  const token = p.farmTravel();
  if (token) token.cancelled = true;
  p.dropReunion(); p.crossing.offer = null;
  p.state.following = false; p.state.forceTraveling = false;
  nextTownGeneration(p.state);
}
// Movement's character parts as targeting's ports hold them.
export type MovementCharacter = ReturnType<typeof installMovementCharacter>;

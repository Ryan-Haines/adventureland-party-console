// The Hunt cycle: whose quest the group hunts, the stages from Daisy to the spawn and back, the
// turn-in, expiry, the death count, the blacklist and its backup farming, the mission route's
// recovery, the farming walk under the Hunt's deadline, the loot barrier and a fight met on the
// way.
import { priority, type LadderPort } from '../../tasks/api.ts';
import { coordinatorHuntParticipants } from '../../tasks/coordinator/api.ts';
import { partyHooks } from '../../hooks/index.ts';
import { classifyTravelDefense, preparationChanged } from '../../movement/api/coordinator.ts';
import { anniversaryYields, supersedeAnniversary } from '../../events/coordinator/api.ts';
import type { ReturnLocation } from '../../events/api.ts';
import type { RouteConvoy, SharedConvoy } from '../../movement/api/coordinator.ts';
import type { ConvoyNavigationPlatform } from '../../movement/api/coordinator.ts';
import type { Tier } from '../../protocol/ranks.ts';
import { requestObject } from '../../lifecycle/api.ts';
import { appendCombatLog } from '../../status/coordinator/api.ts';
import type { HuntFailures, HuntFailureState } from '../saved-fields.ts';
// The blacklist thresholds read through `played`.
import { played } from '../../settings/api.ts';
import { defaultHuntSettings, type HuntSettings, type HuntStage, GAME_CHEST_REACH, GAME_DAISY_REACH, eventDeath, huntLabel, huntLootId, instanceOf, realmOf, searchReach, standsAt } from '../rules.ts';
import { clearSpotRecovery, huntNote, huntStep, labelHunt, writeHunt, writeSpot } from './record.ts';
import { fresh as freshReport, reachLessDrift, reportClockError, speaksWalkProtocol } from '../../protocol/reports.ts';
import { huntSpawnKey } from '../areas.ts';
import { contains, distance, zones, type Catalog, type Zone } from '../zones.ts';
import type { HuntQuest } from '../api.ts';
import type { HuntCommand, HuntConvoy, HuntCycle, HuntExpiryAttempt, HuntRouteRecovery, HuntStatus, HuntTickState, RouteRecoveryCommand } from '../api.ts';
import { writeSlot } from '../../status/api.ts';

interface Quest { id: string; count: number; remainingMs: number }
interface Status { monsterHunt?: Quest | null; seenAt?: number }

/**
 * `events-pending`: after a hand-in completes, the next quest waits while a participant's Hunt
 * waits on an event (the events owner's `event.pending`), and until each participant the lifecycle owner's roster
 * holds online has sent one report stamped after the hand-in, so the characters' rescheduled event
 * polls get their one status round. A silent member holds it while the lifecycle owner answers it
 * online and releases it once the lifecycle owner answers it offline (decisions.md (b)).
 */
export function eventsPending(hunt: { eventReleaseAt?: number | null; participants: string[] },
  statuses: Record<string, { seenAt?: number } | undefined>, pending: (name: string) => boolean,
  online: (name: string) => boolean): boolean {
  const releasedAt = hunt.eventReleaseAt;
  if (!releasedAt) return false;
  return hunt.participants.some(name => {
    const s = statuses[name];
    return !!s && (pending(name) || (Number(s.seenAt) <= releasedAt && online(name)));
  });
}
// The Hunt roster repair: the group's members a Hunt takes in come from the tasks owner
// (`coordinatorHuntParticipants`), and the saved cycle drops the members no longer among them.
export function currentHuntParty(state: HuntTickState, now: number): string[] {
  return coordinatorHuntParticipants(state, () => now, () =>
    Object.keys(state.statuses).filter(name => freshReport(state.statuses[name]?.seenAt, now, 'presence')));
}
// A member left the Hunt that its quest or hand-in was for: the quest choice starts again. The
// roster repair also drops the arrival hand-off, and the tasks owner's Follow move also drops the leaver's loot.
export function huntOwnerLeft(hunt: HuntCycle): void {
  huntNote(hunt, { owner: undefined, turnIn: undefined, target: null, missions: [], currentIndex: -1 });
}
function clearDepartedCommands(hunt: HuntCycle, state: HuntTickState, current: string[]): void {
  for (const name of hunt.participants) {
    const command = state.commands[name];
    if (!current.includes(name) && command?.purpose === "monster-hunt" && command.cycleId === hunt.cycleId)
      delete state.commands[name];
  }
}

// The quests start over once no turn-in holds the cycle; a turn-in whose owner left goes with it.
function resumeCurrentParty(hunt: HuntCycle, ownerLeft: boolean): void {
  if (ownerLeft) huntStep(hunt, 'checking-quests', { owner: undefined, turnIn: undefined, target: null, missions: [], currentIndex: -1,
    arrivalHandoff: undefined });
  else if (!hunt.turnIn) huntStep(hunt, 'checking-quests');
}

/** Repair saved rosters before stale members can own selection, recovery or travel. */
export function reconcileCurrentHuntParty(
  hunt: HuntCycle, state: HuntTickState, now: number, cancelConvoy: () => void,
): boolean {
  // A requested reload temporarily removes heartbeats. Do not turn that gap into
  // a smaller party and discard the repair convoy (or its terminal failure).
  if (geometryOwnsRoster(state) || communicationOwnsRoster(hunt, state, now)) return false;
  const current = currentHuntParty(state, now);
  // A missing leader report is not evidence that the whole party departed.
  if (!current.includes(state.leader!)) return false;
  const retained = hunt.participants.filter(name => current.includes(name));
  const ownerLeft = [hunt.owner, hunt.turnIn?.owner].some(name => !!name && !current.includes(name));
  if (retained.length === hunt.participants.length && !ownerLeft) return false;
  cancelConvoy();
  clearDepartedCommands(hunt, state, current);
  huntNote(hunt, { convoyId: null, participants: retained.includes(state.leader!) ? retained : [state.leader!, ...retained],
    missions: (hunt.missions || []).map(mission => ({ ...mission, owners: mission.owners.filter(name => current.includes(name)) })) });
  resumeCurrentParty(hunt, ownerLeft);
  return true;
}
function geometryOwnsRoster(state: HuntTickState): boolean {
  const convoy=state.activeConvoy;
  return convoy?.geometryRepair?.phase === 'waiting' || convoy?.failureCode === 'geometry-mismatch';
}
function communicationOwnsRoster(hunt: HuntCycle, state: HuntTickState, now: number): boolean {
  const c = state.activeConvoy;
  if (!c || c.id !== hunt.convoyId || c.purpose !== 'monster-hunt') return false;
  if (!hunt.participants.every(n => n === state.leader || state.followers[n])) return false;
  return !!c.communicationHold || hunt.participants.some(n => !state.statuses[n] || !freshReport(state.statuses[n]!.seenAt, now));
}
const eventPending = (name: string) => partyHooks().ask('event.pending', name) === true;
type Statuses = Record<string, Status | undefined>;
interface TurnIn { owner: string; phase: 'returning' | 'claiming' | 'complete' }
export interface Hunt {
  owner?: string;
  selectionLeader?: string;
  policyVersion?: number;
  stage: HuntStage;
  participants: string[];
  turnIn?: TurnIn;
  eventReleaseAt?: number;
  returnDisableTown?: boolean;
  returnNativeFallback?: boolean;
  returnTown?: import('../../movement/api/coordinator.ts').ReturnTownPolicy;
}
type Selected = { owner: string; action: 'pickup' | 'claim' | 'farm'; quest: Quest | null };

// The stages that travel to or farm the mission's spawn.
const onMission = (hunt: Pick<HuntCycle, 'stage'>) => hunt.stage === 'mission-travel' || hunt.stage === 'farming';
// A quest counts while its timer runs; an expired one reports remainingMs <= 0.
const live = (quest: Quest | null | undefined): Quest | null => quest && quest.remainingMs > 0 ? quest : null;

/**
 * The character whose quest the cycle follows. A turn-in in progress names its owner; otherwise the
 * selected owner holds while the leader that selected it still leads, and the leader takes over
 * when the leader changed.
 */
export function owner(hunt: Hunt, leader: string): string {
  if (priority(hunt)) return hunt.turnIn?.owner || hunt.owner || leader;
  return hunt.selectionLeader === leader ? hunt.owner || leader : leader;
}

/** The owner's quest while its timer runs. */
export function quest(hunt: Hunt, leader: string, statuses: Statuses): Quest | null {
  return live(statuses[owner(hunt, leader)]?.monsterHunt);
}

/** The group goes back to Daisy when the owner has no live quest or its count reached 0. */
export function shouldReturn(hunt: Hunt, leader: string, statuses: Statuses): boolean {
  return (quest(hunt, leader, statuses)?.count ?? 0) === 0;
}

/**
 * The next action of the cycle. A live selected quest holds while its timer runs, unless its
 * monster was blacklisted with kills left. Otherwise the first participant, leader first, with no
 * live quest picks one up, with a finished quest claims it, or with a quest not blacklisted farms
 * it. No action is left when every live quest is blacklisted.
 */
export function selection(hunt: Hunt, leader: string, statuses: Statuses, blacklist: Record<string, unknown>): Selected | null {
  const names = [...new Set([leader, ...hunt.participants])];
  const held = hunt.selectionLeader === leader && hunt.owner && names.includes(hunt.owner)
    ? live(statuses[hunt.owner]?.monsterHunt) : null;
  if (held && (held.count === 0 || !blacklist[held.id]))
    return { owner: hunt.owner!, action: held.count === 0 ? 'claim' : 'farm', quest: held };
  for (const name of names) {
    const current = live(statuses[name]?.monsterHunt);
    if (!current) return { owner: name, action: 'pickup', quest: null };
    if (current.count === 0) return { owner: name, action: 'claim', quest: current };
    if (!blacklist[current.id]) return { owner: name, action: 'farm', quest: current };
  }
  return null;
}

/** The cycle's one mission: the selected quest's monster, for its owner, while the action is farm. */
export function missions(hunt: Hunt, leader: string, statuses: Statuses, blacklist: Record<string, unknown>) {
  const selected = selection(hunt, leader, statuses, blacklist);
  return selected?.action === 'farm' && selected.quest
    ? [{ target: selected.quest.id, owners: [selected.owner], skipped: false }] : [];
}

/**
 * The turn-in starts once: the owner walks back to Daisy with the return's Town and native
 * fallbacks reset. A turn-in already in progress keeps its owner and phase.
 */
export function beginTurnIn(hunt: Hunt, leader: string): void {
  if (priority(hunt) && hunt.turnIn) return;
  huntNote(hunt, { turnIn: { owner: hunt.owner || leader, phase: 'returning' }, returnDisableTown: false, returnNativeFallback: undefined,
    returnTown: undefined });
}

/** The hand-in completes once and stamps the time the tasks owner's `events-pending` waits from. */
export function completeTurnIn(hunt: Hunt, now: number): void {
  if (!hunt.turnIn || hunt.turnIn.phase === 'complete') return;
  huntNote(hunt, { turnIn: { ...hunt.turnIn, phase: 'complete' }, eventReleaseAt: now });
}

/** A cycle with no turn-in reselects when another leader selected it. A save before policy 3 converts at load (record.ts). */
export function needsReconcile(hunt: Hunt, leader: string): boolean {
  return !priority(hunt) && (hunt.selectionLeader || hunt.owner) !== leader;
}

// The blacklist counts ----

/** The saved Hunt settings over their declared defaults (rules.ts). */
export function huntSettings(state: HuntFailureState): HuntSettings {
  return { ...defaultHuntSettings, ...state.huntSettings };
}
// The Hunt settings the blacklist plays with: `played` reads them through `played`, so an add-on's
// overlay of the thresholds plays while the route keeps patching the player's own.
const playedHuntSettings = (state: HuntFailureState): HuntSettings => ({ ...defaultHuntSettings, ...played(state, 'huntSettings') });

/**
 * A monster joins the blacklist once its deaths or its expirations reach the threshold whose
 * switch is on. The entry keeps its first time and reason and copies the counts on every pass.
 */
export function applyHuntThresholds(state: HuntFailureState, now: number, group: string | null): void {
  const settings = playedHuntSettings(state);
  for (const [id, counts] of Object.entries(state.huntFailures || {})) {
    const death = settings.blacklistDeaths && counts.deaths >= settings.deathThreshold;
    const expiry = settings.blacklistExpirations && counts.expirations >= settings.expirationThreshold;
    if (!death && !expiry) continue;
    const list = state.huntBlacklist || writeHunt(state, { huntBlacklist: {} }).huntBlacklist;
    if (!list[id]) {
      list[id] = { monsterId: id, at: now, kind: death ? 'deaths' : 'expirations', deaths: 0, expirations: 0,
        reason: death ? 'Hunt death threshold reached' : 'Hunt quest expired before completion' };
      partyHooks().notify('hunt.blacklisted', { group, target: id, reason: list[id]!.reason, by: 'core:hunting' });
    }
    Object.assign(list[id]!, counts);
  }
}

/**
 * Adds to a monster's death or expiration count and answers whether it is now blacklisted. `as`
 * names the count's cause for `hunt.counted`: a too-hard escape counts as a death.
 */
export function recordHuntFailure(state: HuntFailureState, id: string, kind: keyof HuntFailures, amount: number, now: number, group: string | null,
  as: 'death' | 'escape' | 'expiration' = kind === 'deaths' ? 'death' : 'expiration'): boolean {
  const counts = state.huntFailures || writeHunt(state, { huntFailures: {} }).huntFailures;
  const entry = (counts[id] ||= { deaths: 0, expirations: 0 });
  entry[kind] += amount;
  const settings = playedHuntSettings(state);
  partyHooks().notify('hunt.counted', { group, target: id, kind: as, count: entry[kind],
    threshold: kind === 'deaths' ? settings.deathThreshold : settings.expirationThreshold, by: 'core:hunting' });
  applyHuntThresholds(state, now, group);
  return !!state.huntBlacklist?.[id];
}

// ---- Expiry, one writer (B.8) ----

// A report counts for expiry while it is current and carries the quest field.
function questReport(status: HuntStatus | undefined, now: number): status is HuntStatus {
  return !!status && freshReport(status.seenAt, now) && 'monsterHunt' in status;
}

/**
 * Tracks each quest the cycle attempts, from the first fresh report of the farmed mission on, and
 * counts one expiration when a fresh report shows the quest gone or out of time before its count
 * reached 0. Travel and events in between change nothing, because the attempt keeps its deadline.
 */
export function observeHuntExpiry(state: HuntTickState, hunt: HuntCycle, now: number, group: string | null): boolean {
  let changed = false;
  const attempts = hunt.expiryAttempts || huntNote(hunt, { expiryAttempts: {} }).expiryAttempts!;
  const mission = hunt.missions[hunt.currentIndex];
  const farmed = mission && !mission.skipped && onMission(hunt) &&
    !state.huntBlacklist?.[mission.target] ? mission : null;
  if (farmed) for (const owner of farmed.owners) changed = trackAttempt(state, hunt, owner, farmed.target, now) || changed;
  for (const attempt of Object.values(attempts)) {
    const status = state.statuses[attempt.owner];
    if (attempt.done || !questReport(status, now)) continue;
    const quest = status.monsterHunt;
    const result = quest?.id === attempt.target && quest.count === 0 ? 'complete'
      : quest?.id === attempt.target && quest.remainingMs > 0 ? 'waiting'
      : status.seenAt >= attempt.deadline ? 'expired' : 'waiting';
    if (result === 'waiting') continue;
    closeAttempt(state, attempt, result === 'expired', now, group);
    changed = true;
  }
  return changed;
}

// The one place an expiration counts: an attempt closes once, and
// an expired one counts on its target unless the target is already blacklisted.
function closeAttempt(state: HuntTickState, attempt: HuntExpiryAttempt, expired: boolean, now: number, group: string | null): void {
  attempt.done = true;
  if (expired && !state.huntBlacklist?.[attempt.target]) recordHuntFailure(state, attempt.target, 'expirations', 1, now, group);
}

/**
 * A quest the cycle waited out at Daisy: the attempt record counts it once. A quest no attempt of
 * the current mission revision tracked gets a closed, expired attempt for `owner`; a tracked one
 * was counted, or will be, by `observeHuntExpiry`.
 */
export function expireWaitedQuest(state: HuntTickState, hunt: HuntCycle, owner: string, now: number, group: string | null): void {
  const revision = hunt.missionRevision || 0, target = hunt.target!;
  const attempts = hunt.expiryAttempts || huntNote(hunt, { expiryAttempts: {} }).expiryAttempts!;
  if (Object.values(attempts).some(a => a.target === target && a.revision === revision)) return;
  const attempt = attempts[`${revision}:${owner}:${target}`] = { target, owner, revision, deadline: now };
  closeAttempt(state, attempt, true, now, group);
}

// An open attempt of the same owner and target moves to the current mission revision; a new one
// takes its deadline from the report's remaining time.
function trackAttempt(state: HuntTickState, hunt: HuntCycle, owner: string, target: string, now: number): boolean {
  const status = state.statuses[owner], quest = status?.monsterHunt;
  const revision = hunt.missionRevision || 0, key = `${revision}:${owner}:${target}`, attempts = hunt.expiryAttempts!;
  if (!questReport(status, now) || !quest || quest.id !== target || quest.count <= 0 || attempts[key]) return false;
  const open = Object.values(attempts).find(a => !a.done && a.owner === owner && a.target === target);
  if (open) {
    const changed = open.revision !== revision;
    open.revision = revision;
    return changed;
  }
  attempts[key] = { target, owner, revision, deadline: status.seenAt + quest.remainingMs };
  return true;
}

// ---- The mission's spawn and its arrival ----

/**
 * A mission point saved before `destinationVersion` 1 (record.ts `convertHunt` keeps it, since the
 * load has no catalog) stays when it stands in a catalog spawn of the target, as the earlier
 * console's destination repair kept it (runtime/coordinator/hunt/encounter.ts:142-146); any other
 * such point goes, so the mission resolves its spawn again.
 */
function checkSavedPoint(mission: HuntCycle['missions'][number], catalog: Catalog): void {
  const saved = mission.destination;
  if (!saved || mission.destinationVersion === 1) return;
  if (!zones(catalog, [mission.target]).some(spawn => distance(spawn, saved) === 0)) {
    delete mission.destination;
    delete mission.destinationRevisions;
  }
  mission.destinationVersion = 1;
}

/** The current mission's spawn, resolved once and kept on the mission; another target resolves fresh. */
export function missionDestination(hunt: HuntCycle, resolve: (target: string | null) => ReturnLocation | null | undefined) {
  const mission = (hunt.missions || [])[hunt.currentIndex];
  if (mission && mission.target === hunt.target) return mission.destination ||= resolve(hunt.target);
  return resolve(hunt.target);
}

interface ArrivalHandoff {
  at: number; cycleId?: string; missionIndex?: number; target?: string | null; convoyId?: string; epoch?: number;
  character?: unknown; runtimeId?: unknown; revision?: number; destination?: string | null;
}
const spawnKey = (location: { map: string; x: unknown; y: unknown } | null | undefined) => location && huntSpawnKey(location);

/**
 * The walk's arrival report ends Hunt travel. A backup walk becomes backup farming. A mission walk
 * for the cycle's target becomes farming and records the hand-off the
 * leader's next reports confirm (`arrivalProtected`).
 */
export function acceptArrival(hunt: HuntCycle | null, convoy: RouteConvoy, body: Record<string, unknown>, now: number): boolean {
  if (hunt?.backup && hunt.stage === 'backup-travel' && hunt.convoyId === convoy.id && convoy.purpose === 'monster-hunt') {
    huntStep(hunt, 'backup-farming', { convoyId: null });
    return true;
  }
  const target = (body.target as { mtype?: string } | undefined)?.mtype;
  if (!hunt || hunt.stage !== 'mission-travel' || hunt.convoyId !== convoy.id || convoy.purpose !== 'monster-hunt' || hunt.target !== target) return false;
  const handoff: ArrivalHandoff = { cycleId: hunt.cycleId, missionIndex: hunt.currentIndex, target: hunt.target,
    convoyId: convoy.id, epoch: convoy.epoch, character: body.character, runtimeId: body.runtimeId,
    revision: Number(body.navigationRevision), destination: spawnKey(convoy.location), at: now };
  huntStep(hunt, 'farming', { convoyId: null, arrivalHandoff: handoff });
  return true;
}

/**
 * The hand-off protects the arrival for one report round of the leader after it: until the leader's
 * first report stamped after the arrival, while it still names this cycle, mission, target, leader,
 * navigation revision, runtime and spawn and the leader is alive; otherwise it is dropped. That
 * report shows where the leader stands, so the arrival check reads it from then on.
 */
export function arrivalProtected(hunt: HuntCycle, leader: string | null,
  status: (HuntStatus & { combatSelection?: { runtimeId?: unknown }; convoyNavigation?: { runtimeId?: unknown } }) | undefined,
  intent: { revision?: number; cancelled?: boolean }, destination: ReturnLocation | null | undefined, now: number): boolean {
  const h = hunt.arrivalHandoff as ArrivalHandoff | undefined;
  if (!h) return false;
  const runtimeId = status?.combatSelection?.runtimeId || status?.convoyNavigation?.runtimeId;
  const current = h.cycleId === hunt.cycleId && h.missionIndex === hunt.currentIndex && h.target === hunt.target &&
    h.character === leader && h.revision === Number(intent.revision) && !intent.cancelled && !status?.rip &&
    (!runtimeId || runtimeId === h.runtimeId) && h.destination === spawnKey(destination) && !(Number(status?.seenAt) > h.at && freshReport(status!.seenAt, now));
  if (!current) huntNote(hunt, { arrivalHandoff: undefined });
  return current;
}

type FightReport = HuntStatus & {
  target?: { hp: number } | null;
  combat?: { inRange?: boolean; canAttack?: boolean } | null;
  turns?: { fighting?: boolean } | null;
  threats?: { hp: number }[];
};

/**
 * A participant fights while it is present (a report under the presence age) and it is alive with a live target it
 * can reach, hit, or fights, or with a live threat. The turns report's `fighting` keeps a member that kites
 * out of range fighting until it drops or kills the target it hit.
 */
export function partyFighting(hunt: HuntCycle, statuses: Record<string, HuntStatus | undefined>, now: number): boolean {
  return hunt.participants.some(name => {
    const s = statuses[name] as FightReport | undefined;
    if (!s || s.rip || !freshReport(s.seenAt, now, 'presence', 0, true)) return false;
    const target = !!s.target && s.target.hp > 0 &&
      (!s.combat || !!s.combat.inRange || !!s.combat.canAttack || !!s.turns?.fighting);
    return target || (s.threats || []).some(t => t.hp > 0);
  });
}

// ---- The Hunt's walks: what movement and the composition read ----

// The key of a spawn in the cycle's saved `routeRecovery` record.
const routeKey = (p: ReturnLocation) => JSON.stringify([p.map, p.in ?? p.map, p.x, p.y]);

type RouteWalk = Pick<HuntConvoy, 'routeRecovery' | 'purpose' | 'walkingActivity' | 'location'>;

/**
 * The walk carries the running mission's route: it names the spawn's recovery entry, or it is the
 * Hunt's walk or the farm recovery walk to the mission's spawn. Movement asks it so a child walk
 * keeps the spawn's failure budget.
 */
export function ownsHuntRoute(hunt: HuntCycle | null | undefined, c: RouteWalk): boolean {
  const spawn = hunt?.missions?.[hunt.currentIndex]?.destination;
  if (!hunt || !spawn || !onMission(hunt)) return false;
  if (c.routeRecovery) return !!hunt.routeRecovery?.[c.routeRecovery.key];
  const missionWalk = c.purpose === 'monster-hunt' || (c.purpose === 'shared-walk' && c.walkingActivity === 'farm-recovery');
  return missionWalk && !!c.location && routeKey(c.location) === routeKey(spawn);
}

/** The spawn's recovery entry a walk restored after a restart inherits, under the geometry it failed on. */
export function inheritedHuntRoute(hunt: HuntCycle | null | undefined, c: RouteWalk, fingerprint: string): HuntRouteRecovery | undefined {
  if (!ownsHuntRoute(hunt, c) || !c.location) return;
  const entry = hunt?.routeRecovery?.[routeKey(c.location)];
  return entry?.geometry === fingerprint ? entry : undefined;
}

type TargetWalk = { id: string; huntTarget?: string; combatHandoffAllowed?: boolean };
type WalkCommand = { convoyId?: string; huntTarget?: string; combatHandoffAllowed?: boolean; purpose?: string | null };

// A Hunt walk names its target on the walk and on each command it issued, and hands no fight off
// on the way.
function holdTarget(walk: TargetWalk, commands: Record<string, WalkCommand | undefined>, names: string[], target: string): void {
  walk.combatHandoffAllowed = false;
  walk.huntTarget = target;
  for (const name of names) {
    const command = commands[name];
    if (command?.convoyId === walk.id) Object.assign(command, { combatHandoffAllowed: false, huntTarget: target });
  }
}

/** A replacement command the walk issues keeps the Hunt's target, for movement-neutral attacks only. */
export function propagateHuntTarget(input: Parameters<ConvoyNavigationPlatform['step']>[0]): void {
  const state = input as { activeConvoy: SharedConvoy | null; commands: Record<string, WalkCommand | undefined> };
  const walk = state.activeConvoy;
  if (walk?.huntTarget) holdTarget(walk, state.commands, walk.participants, walk.huntTarget);
}

/** A Hunt walk finishes its route: a client's hand-off request engages any other walk only. */
export function engageHunt(input: Parameters<ConvoyNavigationPlatform['engage']>[0], body: Record<string, unknown>,
  options: Parameters<ConvoyNavigationPlatform['engage']>[2], walk: Pick<ConvoyNavigationPlatform, 'engage' | 'validReport'>): boolean {
  const state = input as { activeConvoy?: { purpose?: string | null } | null };
  return state.activeConvoy?.purpose !== 'monster-hunt' && walk.engage(input, body, options);
}

interface HuntWalks {
  activeConvoy?: { id?: string; purpose?: string | null; walkingActivity?: string; participants?: string[] } | null;
  commands: Record<string, WalkCommand | undefined>;
  monsterHunt: { participants?: string[] } | null;
}

// The Hunt's own commands of `names` go; a command another activity issued stays.
function dropHuntCommands(state: HuntWalks, names: string[] | undefined): void {
  for (const name of names || []) if (state.commands[name]?.purpose === 'monster-hunt') delete state.commands[name];
}

/**
 * Ends the Hunt's walk and its commands. `cancel` is movement's cancel of the group's walk, which
 * tells `walk.ended`.
 */
export function cancelCoordinatorHuntConvoy(state: HuntWalks, cancel: () => void): void {
  const walk = state.activeConvoy;
  if (walk?.purpose !== 'monster-hunt') return;
  cancel();
  dropHuntCommands(state, walk.participants);
}

/** Ends the cycle: its farm recovery walk, its own walk, the members' Hunt commands and the record. */
export function clearCoordinatorHunt(state: HuntWalks, cancel: () => void): void {
  const child = state.activeConvoy;
  if (state.monsterHunt && child?.purpose === 'shared-walk' && child.walkingActivity === 'farm-recovery') {
    cancel();
    for (const name of child.participants || []) if (child.id && state.commands[name]?.convoyId === child.id) delete state.commands[name];
  }
  cancelCoordinatorHuntConvoy(state, cancel);
  dropHuntCommands(state, state.monsterHunt?.participants);
  writeHunt(state, { monsterHunt: null });
}

interface SpawnState {
  leader: string | null;
  statuses: Record<string, { map: string; x: number; y: number } | undefined>;
  monsterChoices?: Catalog | null;
  huntSettings?: HuntSettings;
}

/**
 * The spawn of `type` the group walks to: the player's saved spawn for it when asked and offered,
 * else the one nearest the leader on the leader's map, ties in catalog order. `spent` leaves out
 * spawns the route recovery spent.
 */
export function coordinatorHuntDestination(state: SpawnState, type: string | null | undefined, usePreference = true,
  spent?: (spawn: Zone) => boolean): Zone | null | undefined {
  const lead = state.leader ? state.statuses[state.leader] : undefined;
  const choice = (state.monsterChoices || []).find(entry => entry.id === type);
  if (!lead || !type || !choice || !Array.isArray(choice.locations) || !choice.locations.length) return null;
  const spawns = zones(state.monsterChoices!, [type]).filter(spawn => !spent?.(spawn));
  const preferred = usePreference ? state.huntSettings?.preferredSpawns?.[type] : undefined;
  const away = (spawn: Zone) => spawn.map === lead.map ? Math.hypot(spawn.x - lead.x, spawn.y - lead.y) : Number.MAX_SAFE_INTEGER;
  return (preferred && spawns.find(spawn => huntSpawnKey(spawn) === preferred)) || spawns.sort((a, b) => away(a) - away(b))[0];
}

// ---- The cycle ----

export interface HuntState extends HuntTickState {
  nextCommandId: number;
  monsterFocus?: string[];
  townCycle?: unknown;
}

export interface HuntPorts {
  now(): number;
  // The group's members the Hunt takes in (tasks/coordinator/groups.ts `coordinatorHuntParticipants`).
  participants(): string[];
  cancelConvoy(): void;
  persist(): void;
  selectedDestination(name: string): { location: ReturnLocation } | null;
  start(location: ReturnLocation, label: string, names: string[], purpose?: string, cause?: 'farming-conflict', tier?: Tier): boolean;
  navigation: {
    authorize(names: string[], location: ReturnLocation, force: boolean): void;
    intent(name: string): { cancelled?: boolean; revision?: number };
  };
  // The tasks owner's test whether the turn-in owns the group's travel (tasks/api.ts
  // `priority`).
  ownsTravel(hunt: HuntCycle): boolean;
  // The group's task ladder for the Hunt's own tasks. A Hunt built without it takes the last
  // step at once: it skips the mission or restarts the turn-in.
  ladder?: LadderPort;
  // A user hold on the group while a member's navigation is cancelled, or its end with null. The
  // status line puts it first, whatever else holds the Hunt.
  intentHold?(reason: string | null): void;
  // The lifecycle owner's coordinator `lifecycle.drain`: the deploy lease with its participants
  // while a safe console load drains, null with none.
  drain?(): { participants: readonly string[] } | null;
  // An add-on's `hunt.quest` refusal of a live quest (6.1): true when one refuses it.
  questRefused?(owner: string, quest: HuntQuest, candidates: HuntQuest[]): boolean;
  // The combat group's id in the tasks owner's table, which the hunting owner's notices name
  // (null before it has a leader).
  group?(): string | null;
  // The lifecycle owner's answer whether the member is online by any client
  // (lifecycle/roster/roster-projection.ts `online`), which `events-pending` holds a silent
  // participant by.
  online(name: string): boolean;
}

type Mission = HuntCycle['missions'][number];
// The stages a Hunt walk runs in.
type HuntWalkStage = Extract<HuntStage, 'returning' | 'daisy-sync-travel' | 'mission-travel' | 'backup-travel'>;


/**
 * The group's Hunt service: one per combat group, from the same code for the party and each solo
 * group (2.2). The tick runs only while the Hunt's task holds the group (the tasks owner's
 * install), so no stage asks whether an event, a rare, an escape or a death recovery owns the
 * party: the rule table answered before the tick ran (rule 6).
 */
export function createHunt(state: HuntState, ports: HuntPorts) {
  const intent = (name: string) => ports.navigation.intent(name);
  const leader = () => state.leader!;
  const spawnFor = (type: string | null) => coordinatorHuntDestination(state, type);
  const destination = (hunt: HuntCycle) => {
    const mission = hunt.missions?.[hunt.currentIndex];
    if (mission) checkSavedPoint(mission, state.monsterChoices || []);
    return missionDestination(hunt, spawnFor);
  };
  const cancelHuntWalk = () => cancelCoordinatorHuntConvoy(state, ports.cancelConvoy);

  // -- Shared reads --

  const held = (hunt: HuntCycle) => hunt.participants.some(name => intent(name).cancelled);
  const escaping = () => !!state.escape && state.escape.stage !== 'released';
  // A member stands at Daisy inside the game's Daisy reach less drift: the quest, the turn-in
  // and the mission walk's departure read this one reach.
  const daisyAt = (status: HuntStatus | undefined, daisy: ReturnLocation) =>
    !!status && status.map === daisy.map && Math.hypot(status.x - daisy.x, status.y - daisy.y) <=
      reachLessDrift(GAME_DAISY_REACH, status.speed, ports.now() - status.seenAt);
  // Every participant stands alive at Daisy with a current report.
  function allAtDaisy(hunt: HuntCycle, daisy: ReturnLocation | null): boolean {
    return !!daisy && hunt.participants.every(name => {
      const s = state.statuses[name];
      return !!s && !s.rip && freshReport(s.seenAt, ports.now()) && daisyAt(s, daisy);
    });
  }
  const unfinished = (mission: Mission | undefined) => !!mission && mission.owners.some(name => {
    const current = state.statuses[name]?.monsterHunt;
    return !!current && current.id === mission.target && current.count > 0;
  });
  const radius = (name: string) => searchReach(state.monsterSearchRadiusByCharacter, name);

  /** Every participant is present, alive, on the leader's server; the label names the first who is not. */
  function fresh(hunt: HuntCycle): boolean {
    const waiting = hunt.participants.find(name => {
      const s = state.statuses[name];
      return !s || !freshReport(s.seenAt, ports.now(), 'presence') || s.rip || s.server !== state.statuses[String(state.leader)]?.server;
    });
    if (waiting) labelHunt(hunt, 'waitingFresh', { name: waiting });
    return !waiting;
  }

  const down = (s: HuntStatus | undefined) => !s || !!s.rip || s.hp === 0;

  // The participants are the leader and its followers, the leader first when it was missing.
  function keepLeaderGroup(hunt: HuntCycle): void {
    const kept = hunt.participants.filter(name => name === state.leader || state.followers[name]);
    huntNote(hunt, { participants: kept.includes(leader()) ? kept : [leader(), ...kept] });
  }

  // The Hunt's walk ends and the mission's arrival is forgotten.
  function dropWalk(hunt: HuntCycle): void {
    ports.cancelConvoy();
    huntNote(hunt, { convoyId: null, originArrivedAt: undefined });
  }

  // The farm area's pending relocation and its label end when the Hunt takes the mission back to an
  // alternate or restored spawn; the struck areas stay struck, since the Hunt left them.
  function clearFarmPending(): void {
    if (state.farmAreaState) writeSpot(state, { farmAreaState: { ...state.farmAreaState, pending: null, message: null } });
  }

  function logNavigation(message: string, details: Record<string, unknown>): void {
    appendCombatLog(state.combatLogs, leader(), { at: ports.now(), type: 'navigation', message, details });
  }

  // Begin and end --

  // The cycle's saved farm spot while the focus it was saved under is still the focus and holds a
  // monster of that spot; otherwise the leader's selected farm destination.
  function fallbackDestination(hunt: HuntCycle): ReturnLocation | null | undefined {
    const focus = state.monsterFocus || [];
    const monsters = (hunt.returnLocation as (ReturnLocation & { monsterIds?: string[] }) | null)?.monsterIds;
    const compatible = !monsters?.length || monsters.some(id => focus.includes(id));
    return (compatible && hunt.returnFocus === JSON.stringify(focus) && hunt.returnLocation) ||
      ports.selectedDestination(leader())?.location;
  }

  function backupDestination(hunt: HuntCycle): ReturnLocation | null | undefined {
    const spot = fallbackDestination(hunt);
    if (spot && spot !== hunt.returnLocation) {
      huntNote(hunt, { returnLocation: spot, returnFocus: JSON.stringify(state.monsterFocus || []) });
      ports.persist();
    }
    return spot;
  }

  /** Every live quest is blacklisted: the group farms the backup spot until they expire. */
  function endBlacklisted(hunt: HuntCycle): void {
    cancelHuntWalk();
    huntStep(hunt, 'backup-travel', { convoyId: null, target: null, returnLocation: fallbackDestination(hunt) || hunt.returnLocation,
      backup: { startedAt: ports.now(), members: {} }, policyVersion: 3, selectionLeader: leader(), loot: undefined, turnIn: undefined,
      waitForExpiry: false });
    labelHunt(hunt, 'backup-travel', { ready: 0, all: hunt.participants.length });
    ports.persist();
  }

  // A new cycle takes the leader and the group's current Hunt party, and keeps an unfinished loot
  // pass.
  function begin(returnPolicy?: string, location?: ReturnLocation | null): boolean {
    const previous = state.monsterHunt;
    const current = currentHuntParty(state, ports.now());
    const names = [...new Set([state.leader, ...ports.participants(), ...current])]
      .filter((name): name is string => !!name && current.includes(name));
    if (!names.length) return false;
    const pendingLoot = previous?.loot && !previous.loot.complete ? previous.loot : undefined;
    clearCoordinatorHunt(state, ports.cancelConvoy);
    // A Hunt begin ends the farm spot's recovery.
    clearSpotRecovery(state);
    const now = ports.now();
    const { monsterHunt: hunt } = writeHunt(state, { monsterHunt: {
      version: 2, cycleId: 'hunt-' + now + '-' + state.nextCommandId++, stage: 'checking-quests',
      participants: names, missions: [], currentIndex: -1, target: null, startedAt: now,
      returnPolicy: returnPolicy && returnPolicy !== 'hunt' ? returnPolicy : 'farming', returnLocation: location || null,
      returnFocus: JSON.stringify(state.monsterFocus || []), ...pendingLoot ? { loot: pendingLoot } : {},
    } as HuntCycle });
    labelHunt(hunt, hunt.stage);
    if (!pendingLoot) prepare(hunt);
    ports.persist();
    return true;
  }

  // -- The Hunt's walks --

  function holdReason(hunt: HuntCycle, location: ReturnLocation | null | undefined, stage: string): 'protocol' | 'noLocation' | 'lootPending' | null {
    if (stage === 'returning' && hunt.participants.some(name => !speaksWalkProtocol(state.statuses[name]))) return 'protocol';
    if (!location) return 'noLocation';
    if (hunt.loot && !hunt.loot.complete) return 'lootPending';
    return null;
  }

  // The stage's own label: the target with the owner's kills left, the turn-in at Daisy, and
  // the backup's ready count.
  function labelStage(hunt: HuntCycle, text?: string): void {
    const members = Object.values(hunt.backup?.members || {});
    labelHunt(hunt, hunt.stage, { target: hunt.target, left: quest(hunt, leader(), state.statuses)?.count, turnIn: !!priority(hunt),
      ready: members.filter(member => member.ready).length, all: members.length || hunt.participants.length, text });
  }

  // The walk's routing flags, set on the walk and copied to every command it already issued. A
  // return routes continuously and never yields; a mission walk names its target.
  function configure(hunt: HuntCycle, stage: string): void {
    const convoy = state.activeConvoy!;
    const daisy = state.monsterHunterLocation;
    const returning = stage === 'returning', mission = stage === 'mission-travel';
    if (mission && daisy && hunt.participants.every(name => daisyAt(state.statuses[name], daisy)))
      convoy.townFirst = false;
    convoy.combatHandoffAllowed = false;
    convoy.cause = mission ? hunt.travelCause : undefined;
    convoy.huntTarget = mission ? hunt.target || undefined : undefined;
    convoy.nonPreemptible = returning;
    convoy.returnRouting = returning;
    if (returning) convoy.continuousReturn = 1;
    convoy.nativeFallback = returning ? hunt.returnNativeFallback : undefined;
    convoy.returnTown = hunt.returnTown;
    convoy.disableTown = hunt.returnTown ? hunt.returnTown.walking : !!hunt.returnDisableTown;
    if (returning) convoy.townFirst = false;
    for (const name of hunt.participants) {
      const command = state.commands[name];
      if (command?.convoyId !== convoy.id) continue;
      Object.assign(command, { combatHandoffAllowed: convoy.combatHandoffAllowed, huntTarget: convoy.huntTarget,
        nonPreemptible: convoy.nonPreemptible, returnRouting: convoy.returnRouting,
        continuousReturn: convoy.continuousReturn, nativeFallback: convoy.nativeFallback });
    }
  }

  /**
   * Asks the Hunt's walk for a stage. It waits on a hold reason, a live walk, a user hold or an
   * escape, and on travel defense except a mission walk while defending. A return with every
   * member already at Daisy goes straight to the Daisy step.
   */
  function start(hunt: HuntCycle, location: ReturnLocation | null | undefined, label: string, stage: HuntWalkStage): boolean {
    const reason = holdReason(hunt, location, stage);
    if (reason) { labelHunt(hunt, reason); return false; }
    if (state.activeConvoy) return false;
    if (held(hunt)) { labelHunt(hunt, 'held'); return false; }
    if (escaping()) { labelHunt(hunt, 'escape'); return false; }
    const defense = classifyTravelDefense(state, hunt.participants, ports.now());
    if (defense.state !== 'clear' && !(stage === 'mission-travel' && defense.state === 'defending')) {
      huntStep(hunt, stage, { convoyId: null, ...stage === 'mission-travel' ? { originArrivedAt: undefined } : {} });
      labelHunt(hunt, 'defense', { text: defense.message });
      return false;
    }
    if (stage === 'returning' && allAtDaisy(hunt, location!)) {
      huntStep(hunt, 'at-daisy', { convoyId: null });
      process(hunt);
      return true;
    }
    ports.navigation.authorize(hunt.participants, location!, true);
    huntNote(hunt, { arrivalHandoff: undefined });
    if (!ports.start(location!, label, hunt.participants, 'monster-hunt', stage === 'mission-travel' ? hunt.travelCause : undefined)) {
      labelHunt(hunt, 'noLeader');
      return false;
    }
    configure(hunt, stage);
    // ports.start set the walk, which the narrowing above does not see.
    huntStep(hunt, stage, { convoyId: (state as { activeConvoy?: { id?: string } | null }).activeConvoy?.id ?? null,
      ...stage === 'mission-travel' ? { originArrivedAt: undefined } : {} });
    labelStage(hunt);
    return true;
  }

  // Quests at Daisy --

  function issue(name: string, action: string, hunt: HuntCycle): boolean {
    if (!state.statuses[name] || state.commands[name]) return false;
    writeSlot(state.commands, name, { id: state.nextCommandId++, type: 'monster-hunt-interact', purpose: 'monster-hunt',
      cycleId: hunt.cycleId, action, issuedAt: ports.now() });
    return true;
  }

  // The quests the selection skips: the blacklist, and each live quest with kills
  // left that an add-on's `hunt.quest` refuses.
  function skipped(hunt: HuntCycle): Record<string, unknown> {
    const skip: Record<string, unknown> = { ...state.huntBlacklist };
    if (!ports.questRefused) return skip;
    const open = [...new Set([leader(), ...hunt.participants])].flatMap(name => {
      const q = live(state.statuses[name]?.monsterHunt);
      return q && q.count > 0 && !skip[q.id] ? [{ owner: name, quest: { id: q.id, count: q.count, ms: q.remainingMs } }] : [];
    });
    const candidates = open.map(entry => entry.quest);
    for (const entry of open) if (ports.questRefused(entry.owner, entry.quest, candidates)) skip[entry.quest.id] = true;
    return skip;
  }
  const select = (hunt: HuntCycle) => selection(hunt, leader(), state.statuses, skipped(hunt));

  /** A new mission list for the current selection; the last list's loot pass goes. */
  // The list reads the owner this pass holds; the owner then follows the list's selection.
  function build(hunt: HuntCycle): void {
    huntNote(hunt, { missionRevision: (hunt.missionRevision || 0) + 1, loot: undefined, owner: owner(hunt, leader()), policyVersion: 3 });
    huntNote(hunt, { missions: missions(hunt, leader(), state.statuses, skipped(hunt)) });
    huntNote(hunt, { owner: select(hunt)?.owner || leader(), selectionLeader: leader(), currentIndex: -1 });
  }

  function returnToDaisy(hunt: HuntCycle): void {
    if (['returning', 'at-daisy'].includes(hunt.stage)) return;
    beginTurnIn(hunt, leader());
    huntNote(hunt, { target: null, arrivalHandoff: undefined });
    ports.persist();
    cancelHuntWalk();
    start(hunt, state.monsterHunterLocation, 'Monster Hunt turn-in', 'returning');
  }

  // A mission starts when it is not skipped or blacklisted and an owner still has kills left; a
  // mission with no spawn is skipped.
  function startMission(hunt: HuntCycle, index: number): boolean {
    const mission = hunt.missions[index]!;
    if (mission.skipped || state.huntBlacklist?.[mission.target] || !unfinished(mission)) return false;
    checkSavedPoint(mission, state.monsterChoices || []);
    const spawn = (mission.destination ||= spawnFor(mission.target));
    if (spawn) mission.destinationVersion = 1;
    huntNote(hunt, { currentIndex: index, target: mission.target });
    if (spawn) start(hunt, spawn, 'Monster Hunt: ' + mission.target, 'mission-travel');
    else mission.skipped = true;
    return !mission.skipped;
  }

  /** The next startable mission; with none left, the next selection: backup farming, a pickup or the turn-in. */
  function advance(hunt: HuntCycle): void {
    huntNote(hunt, { travelCause: undefined });
    cancelHuntWalk();
    for (let index = Number(hunt.currentIndex) + 1; index < (hunt.missions || []).length; index++)
      if (startMission(hunt, index)) return;
    huntNote(hunt, { target: null });
    const selected = select(hunt);
    if (!selected) endBlacklisted(hunt);
    else if (selected.action === 'pickup') prepare(hunt);
    else returnToDaisy(hunt);
  }

  function adopt(hunt: HuntCycle, selected: NonNullable<ReturnType<typeof select>>): void {
    huntNote(hunt, { owner: selected.owner, selectionLeader: leader(), policyVersion: 3, pickupPending: selected.action === 'pickup' });
  }

  /**
   * Checks the quests and walks for the selection: a backup cycle travels to its spot, a batch
   * pickup walks to Daisy, and otherwise the selection picks up, claims, continues the running
   * mission or builds new missions.
   */
  function prepare(hunt: HuntCycle): void {
    if (reconcileCurrentHuntParty(hunt, state, ports.now(), cancelHuntWalk)) ports.persist();
    if (hunt.backup) { huntStep(hunt, 'backup-travel'); return; }
    if (!fresh(hunt)) return;
    if (hunt.batchPickup) {
      huntNote(hunt, { target: null });
      start(hunt, state.monsterHunterLocation, 'Picking up the next Hunt batch', 'daisy-sync-travel');
      return;
    }
    const selected = select(hunt);
    if (!selected) { endBlacklisted(hunt); return; }
    adopt(hunt, selected);
    if (hunt.pickupPending) {
      huntNote(hunt, { target: null });
      start(hunt, state.monsterHunterLocation, 'Picking up Monster Hunt for ' + selected.owner, 'daisy-sync-travel');
    } else if (selected.action === 'claim') {
      huntNote(hunt, { waitForExpiry: false });
      returnToDaisy(hunt);
    } else if (hunt.target === selected.quest!.id && (hunt.missions || [])[hunt.currentIndex]?.target === hunt.target) {
      start(hunt, destination(hunt), 'Monster Hunt: ' + hunt.target, 'mission-travel');
    } else {
      build(hunt);
      advance(hunt);
    }
    ports.persist();
  }

  /**
   * Clears the cycle's interaction commands the reports confirm: an assign once the quest shows, a
   * claim once it is gone. A batch pickup waits for a report newer than the command. A failed
   * interaction clears through its receipt (completeHuntInteraction), so a command the member is
   * still running stays until one of the two answers.
   */
  function acknowledge(hunt: HuntCycle): void {
    for (const name of hunt.participants) {
      const command = state.commands[name], status = state.statuses[name];
      if (command?.type !== 'monster-hunt-interact' || command.cycleId !== hunt.cycleId) continue;
      if (hunt.batchPickup && command.issuedAt && (!status || status.seenAt <= command.issuedAt)) continue;
      if ((command.action === 'assign' && !!status?.monsterHunt) || (command.action === 'claim' && !status?.monsterHunt)) delete state.commands[name];
    }
  }

  const interacting = (hunt: HuntCycle) => hunt.participants.some(name => state.commands[name]?.type === 'monster-hunt-interact');

  function assign(hunt: HuntCycle): boolean {
    if (hunt.stage !== 'assigning' || priority(hunt)) return false;
    const selected = select(hunt);
    if (!selected) { endBlacklisted(hunt); return true; }
    adopt(hunt, selected);
    if (hunt.pickupPending) {
      labelStage(hunt);
      issue(selected.owner, 'assign', hunt);
      return true;
    }
    if (selected.action === 'claim') return false;
    build(hunt);
    advance(hunt);
    ports.persist();
    return true;
  }

  function claim(hunt: HuntCycle): boolean {
    if (hunt.turnIn && priority(hunt)) huntNote(hunt, { turnIn: { ...hunt.turnIn, phase: 'claiming' } });
    let changed = false;
    for (const name of hunt.participants) {
      const current = state.statuses[name]?.monsterHunt;
      if (current && current.count === 0) changed = issue(name, 'claim', hunt) || changed;
    }
    return changed || interacting(hunt);
  }

  // A quest the cycle waited out, gone from the owner's fresh report, counts through the attempt
  // record (`expireWaitedQuest`).
  function blacklistExpired(hunt: HuntCycle): void {
    if (!hunt.waitForExpiry || !hunt.target || quest(hunt, leader(), state.statuses)) return;
    const name = owner(hunt, leader()), status = state.statuses[name];
    if (!status || !('monsterHunt' in status)) return;
    expireWaitedQuest(state, hunt, name, ports.now(), ports.group?.() ?? null);
    huntNote(hunt, { target: null });
    ports.persist();
  }

  function nextQuest(hunt: HuntCycle): void {
    blacklistExpired(hunt);
    const current = quest(hunt, leader(), state.statuses);
    const open = !!current && current.count > 0;
    if (open && hunt.waitForExpiry) {
      huntStep(hunt, 'waiting-expiry');
      labelStage(hunt);
      return;
    }
    if (!open) huntNote(hunt, { waitForExpiry: false });
    huntStep(hunt, 'assigning');
    labelStage(hunt);
    process(hunt);
  }

  // Every participant within Daisy's reach; a member outside it sends the group back to regroup.
  function regroupedAtDaisy(hunt: HuntCycle): boolean {
    const daisy = state.monsterHunterLocation;
    if (!daisy) { labelHunt(hunt, 'noDaisy'); return false; }
    if (hunt.participants.every(name => daisyAt(state.statuses[name], daisy))) return true;
    start(hunt, daisy, 'Regrouping at Daisy for missing Hunt interactions', 'daisy-sync-travel');
    return false;
  }

  // A batch pickup assigns every participant without a live quest and holds until all have one.
  function assignBatch(hunt: HuntCycle): boolean {
    if (!hunt.batchPickup) return false;
    const missing = hunt.participants.filter(n => !state.statuses[n]?.monsterHunt || state.statuses[n]!.monsterHunt!.remainingMs <= 0);
    for (const name of missing) issue(name, 'assign', hunt);
    if (missing.length || interacting(hunt)) {
      labelHunt(hunt, 'batchPickup', { ready: hunt.participants.length - missing.length, all: hunt.participants.length });
      return true;
    }
    huntStep(hunt, 'assigning', { batchPickup: false });
    ports.persist();
    return false;
  }

  /**
   * The Daisy step: once the group is fresh and regrouped, the batch, the assignment and the claims
   * run until no interaction is pending; then the turn-in completes, pending events go first (the
   * tasks owner's `events-pending`), and the cycle takes the next quest.
   */
  function process(hunt: HuntCycle): void {
    if (!fresh(hunt) || !regroupedAtDaisy(hunt)) return;
    acknowledge(hunt);
    if (assignBatch(hunt)) return;
    if (interacting(hunt) || assign(hunt) || claim(hunt)) return;
    completeTurnIn(hunt, ports.now());
    if (eventsPending(hunt, state.statuses, eventPending, ports.online)) {
      labelHunt(hunt, 'eventsFirst');
      ports.persist();
      return;
    }
    nextQuest(hunt);
  }

  // -- Participants --

  /**
   * The roster pass: confirmed interactions clear, the participants keep the leader and its
   * followers, and late members join.
   */
  function reconcileParticipants(hunt: HuntCycle): boolean {
    acknowledge(hunt);
    const lead = state.statuses[String(state.leader)];
    if (!lead || !freshReport(lead.seenAt, ports.now(), 'presence')) return false;
    const owns = ports.ownsTravel(hunt);
    if (!owns) keepLeaderGroup(hunt);
    // The roster ends no walk: a new walk replaces the group's walk only when its task does
    // (gap 5; runtime/movement/coordinator/walk.ts `start`).
    const late = owns ? [] : ports.participants().filter(name => !hunt.participants.includes(name));
    if (late.length) huntNote(hunt, { participants: [...hunt.participants, ...late] });
    return true;
  }

  // Deaths, the return's label, pauses and the retreat --

  // A cycle selected under another leader starts its quests over.
  function reselect(hunt: HuntCycle): boolean {
    if (!needsReconcile(hunt, leader())) return false;
    cancelHuntWalk();
    huntStep(hunt, 'checking-quests', { convoyId: null, owner: leader(), policyVersion: 3, missions: [], currentIndex: -1, target: null,
      waitForExpiry: false, pickupPending: false });
    prepare(hunt);
    ports.persist();
    return true;
  }

  function preparationMessage(convoy: HuntConvoy): string {
    if (convoy.returnTown?.walking) return '; walking home while defending; Town resumes when aggro clears';
    const count = convoy.returnTown?.interruptions;
    const town = count ? '; Town interrupted ' + count + ' times on ' + convoy.returnTown!.map : '';
    return town + (convoy.phase === 'shared-prepare' && convoy.preparationBlocker ? '; ' + convoy.preparationBlocker : '');
  }

  // The Daisy return's one label: the communication hold, the geometry repair, the failure, or the
  // phase, Town step and blockers.
  function returnMessage(hunt: HuntCycle): void {
    const convoy = state.activeConvoy;
    if (hunt.stage !== 'returning' || !convoy) return;
    if (convoy.communicationHold) labelHunt(hunt, 'communication', { text: convoy.failure || convoy.communicationHold.reason });
    else if (convoy.geometryRepair?.phase === 'waiting') labelHunt(hunt, 'returnGeometry');
    else if (convoy.phase === 'failed') climbReturn(hunt, convoy);
    else if (convoy.returnRouting) {
      const blockers = convoy.blockerSummary && Object.keys(convoy.blockers || {}).length ? '; ' + convoy.blockerSummary : '';
      labelStage(hunt, convoy.phase + preparationMessage(convoy) + blockers);
    }
  }

  // A failed Daisy return climbs the turn-in's task ladder, one step per failed walk. Each step
  // restarts the return from where the members stand once they can walk and no member cancelled
  // its navigation (a user hold). On the `wait` rung the restart waits for the next report that
  // shows a change. Retry stays the player's shortcut to step 0 (coordinator/routes.ts, hunt.ts
  // `retryHuntReturn`).
  function climbReturn(hunt: HuntCycle, convoy: HuntConvoy): void {
    const failed = convoy.id + ':' + (convoy.failedAt ?? convoy.epoch ?? 0);
    if (hunt.returnClimbed !== failed) {
      huntNote(hunt, { returnClimbed: failed });
      ports.ladder?.fail(convoy.failureCode || 'route-failed', { trying: 'the Daisy return from where the party stands' });
      ports.persist();
    }
    labelHunt(hunt, 'returnFailed', { text: convoy.failure });
    if (ports.ladder?.rung() === 'wait' || !fresh(hunt) || held(hunt) ||
        hunt.participants.some(name => state.statuses[name]?.rip) || escaping()) return;
    ports.cancelConvoy();
    huntNote(hunt, { returnNativeFallback: hunt.returnNativeFallback || !!convoy.nativeFallback, convoyId: null });
    start(hunt, state.monsterHunterLocation, 'Restarting the Monster Hunt turn-in', 'returning');
    ports.persist();
  }

  // The cycle's count: survival sends one notice per death and per escape, so the cycle counts each
  // when it arrives and keeps no death record of its own. Rule 2.3.7: a suspended Hunt counts too, so
  // the threshold applies at once; the reaction (cancel, recover or skip the blacklisted mission)
  // waits for the Hunt's task to be live (`deaths`).
  function count(hunt: HuntCycle, names: string[], amount: number, react: boolean): void {
    const blacklisted = !!hunt.target && recordHuntFailure(state, hunt.target, 'deaths', amount, ports.now(), ports.group?.() ?? null, react ? 'death' : 'escape');
    if (blacklisted) Object.assign(state.huntBlacklist![hunt.target!]!, { characters: names, lastDeathAt: ports.now() });
    if (react || blacklisted) {
      const before = hunt.observedDeaths;
      huntNote(hunt, { observedDeaths: { names: [...new Set([...(before?.names ?? []), ...names])], blacklisted: blacklisted || !!before?.blacklisted } });
    }
    ports.persist();
  }

  /** `survival.died`: a participant's death after the cycle started, not on an event trip. */
  function died(notice: { name: string; at: number }): void {
    const hunt = state.monsterHunt, s = state.statuses[notice.name];
    if (!enabled() || !hunt || !hunt.participants.includes(notice.name) || notice.at < (hunt.startedAt ?? 0)) return;
    // A death on an event trip counts nothing unless an add-on's `retry.policy` counts it.
    if (s && eventDeath(s, state.huntEventTrips?.[notice.name] || [], notice.at, true) && !partyHooks().retry.policy({ owner: '07', subject: String(hunt.target ?? ''),
      failure: 'event-death', attempt: 1 }, { wait: 0, giveUp: false, counts: false }).counts) return;
    huntNote(hunt, { arrivalHandoff: undefined });
    count(hunt, [notice.name], 1, true);
  }

  /**
   * `survival.escaped`: a too-hard escape from a fight with the cycle's target counts on it as a
   * death does, toward the same threshold; a bad-luck escape counts nothing. Survival walks the
   * escape, so the cycle reacts only when the count blacklists the target. A participant's death
   * that started the escape's recovery already counted on its own `survival.died`, so that escape
   * adds nothing: one death and its escape count once, as v1.5.0's death count did.
   */
  function escaped(notice: { names: string[]; cause: string; mtypes: string[]; deaths?: string[] }): void {
    const hunt = state.monsterHunt;
    if (!enabled() || !hunt?.target || notice.cause !== 'too hard' || !notice.mtypes.includes(hunt.target)) return;
    if ((notice.deaths ?? []).some(name => hunt.participants.includes(name))) return;
    const names = notice.names.filter(name => hunt.participants.includes(name));
    if (names.length) count(hunt, names, 1, false);
  }

  // The reaction to the counted deaths: the walk ends; below the threshold the group recovers and
  // continues the mission, at the threshold it skips the mission and retreats.
  function deaths(hunt: HuntCycle): void {
    const observed = hunt.observedDeaths;
    huntNote(hunt, { observedDeaths: undefined });
    if (!observed?.names.length) return;
    // A party death ends the farm spot's recovery before the reaction.
    clearSpotRecovery(state);
    if (observed.blacklisted) {
      const mission = hunt.missions[hunt.currentIndex];
      if (mission) mission.skipped = true;
      huntNote(hunt, { skipAfterDeath: true });
    }
    cancelHuntWalk();
    huntNote(hunt, { convoyId: null });
    if (!observed.blacklisted) {
      if (hunt.target) huntStep(hunt, 'farming', { recovering: true });
      else huntNote(hunt, { recovering: true });
      labelHunt(hunt, 'recovering');
    } else {
      if (hunt.target) huntStep(hunt, 'blacklist-retreat', { recovering: false });
      labelHunt(hunt, 'blacklisted', { target: hunt.target });
    }
    ports.persist();
  }

  // The one pause the Hunt keeps is the player's cancelled navigation, a user hold; an event,
  // a return or a farming move holds the Hunt through the rule table. Selecting Hunt also
  // ends the normal-farming walk a Hunt death limit started.
  function pause(hunt: HuntCycle): boolean {
    const convoy = state.activeConvoy;
    const userHold = held(hunt);
    if (state.targetMode === 'hunt' && !userHold && convoy?.purpose === 'hunt-fallback') {
      ports.cancelConvoy();
      huntNote(hunt, { convoyId: null });
    }
    if (!userHold) return false;
    cancelHuntWalk();
    huntNote(hunt, { arrivalHandoff: undefined, convoyId: null });
    labelHunt(hunt, 'held');
    return true;
  }

  // The retreat from a blacklisted target rebuilds the missions once every participant reported
  // within 10 s.
  function retreat(hunt: HuntCycle): boolean {
    if (hunt.stage !== 'blacklist-retreat' && !(hunt.target && state.huntBlacklist?.[hunt.target])) return false;
    const reported = hunt.participants.every(name => {
      const s = state.statuses[name];
      return !!s && freshReport(s.seenAt, ports.now(), 'presence');
    });
    if (reported) { build(hunt); advance(hunt); }
    return true;
  }

  // Travel: Daisy, the mission walk and farming --

  function returnIfDue(hunt: HuntCycle): boolean {
    if (!shouldReturn(hunt, leader(), state.statuses)) return false;
    huntNote(hunt, { waitForExpiry: !!quest(hunt, leader(), state.statuses)?.count });
    returnToDaisy(hunt);
    return true;
  }

  function daisy(hunt: HuntCycle): boolean {
    const stage = hunt.stage === 'daisy-sync-travel' || hunt.stage === 'returning' ? hunt.stage : null;
    if (stage && !state.activeConvoy) {
      huntNote(hunt, { convoyId: null });
      // A `distance` refusal walks the group to Daisy even when its reports stand within the reach.
      if (!allAtDaisy(hunt, state.monsterHunterLocation) || hunt.daisyRegroup) {
        const label = hunt.daisyRegroup ? 'Regrouping at Daisy for missing Hunt interactions'
          : hunt.stage === 'returning' ? 'Monster Hunt turn-in' : 'Monster Hunt synchronization';
        if (start(hunt, state.monsterHunterLocation, label, stage)) huntNote(hunt, { daisyRegroup: undefined });
        return true;
      }
      huntStep(hunt, 'at-daisy', hunt.travelCheckpoint ? { travelCheckpoint: { ...hunt.travelCheckpoint, completedAt: ports.now() } } : {});
      process(hunt);
      return true;
    }
    if (!['at-daisy', 'assigning', 'waiting-expiry'].includes(hunt.stage)) return false;
    process(hunt);
    return true;
  }

  // A live mission walk keeps its target on the walk and its commands; with no walk, the group
  // walks to the spawn until every member stands in it, then farms.
  function mission(hunt: HuntCycle): boolean {
    if (hunt.stage !== 'mission-travel') return false;
    const c = state.activeConvoy;
    if (c) {
      if (c.id !== hunt.convoyId || c.purpose !== 'monster-hunt' || !hunt.target) return false;
      if (c.defenseReason) labelHunt(hunt, 'defense', { text: c.defenseReason });
      else if (c.phase === 'failed') labelHunt(hunt, 'travelHeld', { text: c.failure });
      else if (c.phase === 'hunt-arrival') labelHunt(hunt, 'spawnReached');
      else labelStage(hunt);
      holdTarget(c, state.commands, hunt.participants, hunt.target);
      return false;
    }
    if (!hunt.originArrivedAt && !originReached(hunt)) {
      const spawn = destination(hunt);
      if (spawn) start(hunt, spawn, 'Monster Hunt: ' + hunt.target, 'mission-travel');
      return true;
    }
    huntStep(hunt, 'farming', { convoyId: null, originArrivedAt: ports.now(), travelCause: undefined });
    return false;
  }

  // After a death below the threshold, the group waits until every member is alive, fresh, out of its
  // farm reunion and inside the spawn's catalog area, the area the origin arrival reads.
  function recoveryPending(hunt: HuntCycle, spawn: ReturnLocation | null | undefined): boolean {
    if (!hunt.recovering) return false;
    const away = (name: string, s: HuntStatus | undefined) => !s || s.rip === true || !freshReport(s.seenAt, ports.now(), 'presence') ||
      !!s.farmReunion || !spawn || s.map !== spawn.map || !contains(spawn, s, 0, radius(name));
    if (hunt.participants.some(name => away(name, state.statuses[name]))) return true;
    huntNote(hunt, { recovering: false });
    labelStage(hunt);
    return false;
  }

  // A fresh leader outside the spawn with no hand-off walks the group back, and the combat log
  // records why.
  function recoverArrival(hunt: HuntCycle, spawn: ReturnLocation, lead: HuntStatus): void {
    logNavigation('Hunt arrival recovery: fresh leader status remains outside the destination',
      { cycleId: hunt.cycleId, missionIndex: hunt.currentIndex, map: lead.map, positionAgeMs: ports.now() - lead.seenAt });
    huntNote(hunt, { convoyId: null });
    start(hunt, spawn, 'Monster Hunt: ' + hunt.target, 'mission-travel');
  }

  // An expired quest returns the group to Daisy; a mission whose owners have no kills left advances.
  function advanceIfFinished(hunt: HuntCycle): void {
    if ((quest(hunt, leader(), state.statuses)?.remainingMs || 0) <= 0) {
      huntNote(hunt, { waitForExpiry: false });
      returnToDaisy(hunt);
    } else if (!unfinished(hunt.missions[hunt.currentIndex])) advance(hunt);
  }

  // Farming the target: a cycle marked farming before every member reached the spawn walks there
  // first; the leader's hand-off confirms the arrival; recovery, the return and a live fight hold
  // the step; a leader outside the spawn walks back.
  function farm(hunt: HuntCycle): void {
    if (hunt.stage !== 'farming' || !fresh(hunt)) return;
    if (!hunt.originArrivedAt) {
      if (!originReached(hunt)) {
        const spawn = destination(hunt);
        if (spawn) start(hunt, spawn, 'Monster Hunt: ' + hunt.target, 'mission-travel');
        return;
      }
      huntNote(hunt, { originArrivedAt: ports.now() });
    }
    labelStage(hunt);
    const spawn = destination(hunt), lead = state.statuses[String(state.leader)]!;
    const arrived = !!spawn && !!lead && standsAt(spawn, lead, radius(String(state.leader)));
    const handoff = state.commands[String(state.leader)]?.convoyHandoff;
    const protectedArrival = arrivalProtected(hunt, state.leader, lead, intent(leader()), spawn, ports.now());
    if (recoveryPending(hunt, spawn) || returnIfDue(hunt) || partyFighting(hunt, state.statuses, ports.now())) return;
    if (spawn && !arrived && !handoff && !protectedArrival) { recoverArrival(hunt, spawn, lead); return; }
    advanceIfFinished(hunt);
  }

  // Every participant stands alive inside the spawn, with a report at most 3 s old and stamped
  // ahead by no more than its measured clock difference, on the spawn's map and instance and on the
  // leader's server.
  function originReached(hunt: HuntCycle): boolean {
    const spawn = destination(hunt);
    const leaderServer = state.statuses[String(state.leader)]?.server;
    return !!spawn && hunt.participants.every(name => {
      const s = state.statuses[name];
      return !!s && !s.rip && s.hp !== 0 && freshReport(s.seenAt, ports.now(), 'report', reportClockError(s)) &&
        s.map === spawn.map && String(s.in ?? s.map) === String(spawn.in ?? spawn.map) &&
        s.server === leaderServer && contains(spawn, s, 0, radius(name));
    });
  }

  function travel(hunt: HuntCycle): void {
    if (onMission(hunt) && fresh(hunt) && returnIfDue(hunt)) return;
    if (daisy(hunt) || mission(hunt)) return;
    farm(hunt);
  }

  // The mission walk's arrival, read on every report: with no walk live, the cycle farms once
  // every member stands in the spawn and no member holds its navigation.
  function arrive(hunt: HuntCycle): void {
    if (hunt.stage !== 'mission-travel' || state.activeConvoy || !hunt.target || !originReached(hunt) || held(hunt)) return;
    huntStep(hunt, 'farming', { originArrivedAt: hunt.originArrivedAt || ports.now(), travelCause: undefined });
    labelStage(hunt);
    ports.persist();
  }

  // -- The mission route's recovery --

  // A recorded failure holds only under the leader's movement geometry it failed on.
  const geometry = () => {
    const g = state.statuses[leader()]?.movementGeometry;
    return g ? g.version + ':' + g.fingerprint : 'unknown';
  };
  const routeEntry = (hunt: HuntCycle, spawn: ReturnLocation) => {
    const entry = hunt.routeRecovery?.[routeKey(spawn)];
    return entry?.geometry === geometry() ? entry : undefined;
  };
  // A held entry saved by an older version is a spent spawn like an excluded one.
  const spentEntry = (entry: HuntRouteRecovery | undefined) => entry?.phase === 'excluded' || entry?.phase === 'held';
  const spawnKeys = (target: string) => new Set(zones(state.monsterChoices || [], [target]).map(routeKey));

  // A failed walk adds one attempt to its spawn's entry. A first failure off the native planner
  // earns one native attempt; any later failure spends the spawn.
  function recordRouteFailure(hunt: HuntCycle, spawn: ReturnLocation, c: HuntConvoy): HuntRouteRecovery {
    const previous = routeEntry(hunt, spawn), reason = c.failure || 'Route failed without a reason';
    const entry = previous || { destination: spawn, geometry: geometry(), phase: 'native', firstFailure: reason, message: '', attempts: [] };
    if (!previous) huntNote(hunt, { routeRecovery: { ...hunt.routeRecovery, [routeKey(spawn)]: entry } });
    const id = c.id + ':' + (c.epoch ?? 0);
    if (entry.attempts.some(attempt => attempt.id === id)) return entry;
    entry.attempts.push({ id, at: ports.now(), reason, details: c.failureDetails });
    if (!previous && requestObject(requestObject(c.failureDetails).movement).engine !== 'native') entry.phase = 'native';
    else {
      entry.phase = 'excluded';
      entry.message = 'Route exhausted; trying another spawn';
    }
    return entry;
  }

  // A member's navigation moved on since the walk started, or another activity's command holds it.
  function claimedElsewhere(hunt: HuntCycle): boolean {
    const c = state.activeConvoy;
    return hunt.participants.some(name => {
      const command = state.commands[name], revision = c?.expected?.[name]?.revision;
      return (revision !== undefined && revision !== intent(name).revision) ||
        (!!command && command.convoyId !== c?.id && command.purpose !== 'monster-hunt');
    });
  }

  function routeHeld(hunt: HuntCycle): boolean {
    if (escaping() || claimedElsewhere(hunt)) return true;
    return !fresh(hunt) || held(hunt);
  }

  // The native attempt's walk and each command it issued carry the spawn's recovery entry.
  function markRecovery(hunt: HuntCycle, entry: HuntRouteRecovery): void {
    const c = state.activeConvoy;
    if (!c || c.id !== hunt.convoyId) return;
    const command: RouteRecoveryCommand = { key: routeKey(entry.destination), stage: 'native' };
    writeSpot(state, { location: entry.destination });
    c.routeRecovery = command;
    c.nativeFallback = entry.phase === 'native';
    for (const name of hunt.participants) {
      const own = state.commands[name];
      if (own?.convoyId === c.id) Object.assign(own, { routeRecovery: command, nativeFallback: c.nativeFallback });
    }
  }

  function retryNative(hunt: HuntCycle, entry: HuntRouteRecovery): boolean {
    if (state.activeConvoy) return true;
    if (start(hunt, entry.destination, 'Recovering Hunt route with native planner (one attempt)', 'mission-travel')) {
      markRecovery(hunt, entry);
      ports.persist();
    }
    return true;
  }

  // A spent spawn climbs the Hunt's task ladder. The alternative rung is
  // the target's next unspent spawn. Regroup starts the spawns over from where the party stands,
  // the safe point starts the Hunt over from its quests, and fall-back skips the mission. A walk
  // that reaches its spawn is progress, which returns the ladder to its first rung, so every spawn
  // of the target stays an alternative while each walk gets somewhere.
  function climbSpawn(hunt: HuntCycle): boolean {
    const mission = hunt.missions[hunt.currentIndex]!, target = mission.target;
    const next = coordinatorHuntDestination(state, target, true, spawn => spentEntry(routeEntry(hunt, spawn)));
    const rung = ports.ladder?.fail('no-reachable-spawn', { alternative: !!next, trying: 'the next ' + target + ' spawn' })?.rung ??
      (next ? 'alternative' : 'fall-back');
    dropWalk(hunt);
    if (rung === 'alternative' && next) {
      mission.destination = next;
      mission.destinationVersion = 1;
      delete mission.destinationRevisions;
      clearFarmPending();
      huntStep(hunt, 'mission-travel');
      start(hunt, next, 'Trying alternate ' + target + ' spawn: ' + next.map, 'mission-travel');
    } else if (rung === 'alternative' || rung === 'regroup') {
      forgetSpawns(hunt, target);
      huntStep(hunt, 'mission-travel');
      labelHunt(hunt, 'regroupSpawns', { target });
    } else if (rung === 'safe-point') {
      huntStep(hunt, 'checking-quests', { routeRecovery: undefined, missions: [], currentIndex: -1, target: null });
      labelHunt(hunt, 'questsOver', { target });
      prepare(hunt);
    } else {
      mission.skipped = true;
      mission.skipReason = 'no reachable spawn';
      labelHunt(hunt, 'skipped', { target });
      advance(hunt);
    }
    ports.persist();
    return true;
  }

  // The target's spawn entries go, so every spawn is a way to the target again.
  function forgetSpawns(hunt: HuntCycle, target: string): void {
    const keys = spawnKeys(target);
    huntNote(hunt, { routeRecovery: Object.fromEntries(Object.entries(hunt.routeRecovery || {}).filter(([key]) => !keys.has(key))) });
  }

  // A drift reset counts as one failure of the Hunt's task
  // ladder, so a leader that keeps drifting climbs it. It cancels no walk: a running attempt ends
  // on its own report, and a failure after the reset records against the new geometry.
  function resetDrift(hunt: HuntCycle, spawn: ReturnLocation): boolean {
    const prior = hunt.routeRecovery?.[routeKey(spawn)];
    if (!prior || (prior.geometry === geometry() && !preparationChanged(prior.firstFailure))) return false;
    const drifted = routeKey(spawn);
    huntNote(hunt, { routeRecovery: Object.fromEntries(Object.entries(hunt.routeRecovery!).filter(([key]) => key !== drifted)) });
    ports.ladder?.fail('route-drift', { alternative: true });
    ports.persist();
    return true;
  }

  function observeRouteFailure(hunt: HuntCycle, spawn: ReturnLocation): HuntRouteRecovery | undefined {
    const c = state.activeConvoy;
    if (resetDrift(hunt, spawn)) return;
    if (c?.phase !== 'failed' || c.failureCode !== 'route-failed') return routeEntry(hunt, spawn);
    const recorded = routeEntry(hunt, spawn)?.attempts.some(attempt => attempt.id === c.id + ':' + (c.epoch ?? 0));
    const entry = recordRouteFailure(hunt, spawn, c);
    if (entry.phase === 'native') dropWalk(hunt);
    if (!recorded) ports.persist();
    return entry;
  }

  // A recovery waypoint an older farming retry adopted as the mission's spawn goes back to the
  // spawn its entry recorded, while no other activity's walk runs.
  function restoreSpawn(hunt: HuntCycle): boolean {
    const mission = hunt.missions[hunt.currentIndex], c = state.activeConvoy;
    if (!hunt.routeRecovery || !mission?.destination) return false;
    const keys = spawnKeys(mission.target);
    if (!keys.size || keys.has(routeKey(mission.destination))) return false;
    const original = Object.values(hunt.routeRecovery).find(entry => keys.has(routeKey(entry.destination)));
    if (!original || (c && !(c.purpose === 'monster-hunt' && c.id === hunt.convoyId))) return false;
    mission.destination = original.destination;
    mission.destinationVersion = 1;
    writeSpot(state, { location: original.destination });
    dropWalk(hunt);
    clearFarmPending();
    huntStep(hunt, 'mission-travel');
    labelHunt(hunt, 'spawnRestored');
    ports.persist();
    return true;
  }

  /**
   * A failed mission walk retries once with the native planner, then climbs the ladder. It runs
   * ahead of the farming walk's release, never ahead of the turn-in or another activity's walk, and
   * a spawn's spent budget starts no walk once the arrival released farming.
   */
  function recoverRoute(hunt: HuntCycle): boolean {
    const spawn = hunt.missions[hunt.currentIndex]?.destination;
    if (!spawn || !onMission(hunt) || shouldReturn(hunt, leader(), state.statuses) || routeHeld(hunt)) return false;
    if (restoreSpawn(hunt)) return true;
    const c = state.activeConvoy;
    if (c ? !ownsHuntRoute(hunt, c) : hunt.stage === 'farming' && !!hunt.originArrivedAt) return false;
    const entry = observeRouteFailure(hunt, spawn);
    if (!entry) return false;
    return spentEntry(entry) ? climbSpawn(hunt) : retryNative(hunt, entry);
  }

  // -- The farming walk under the Hunt's deadline, and failed farm travel (3.8) --

  // Whether the anniversary cycle holds the party is the events owner's answer (`event.cycle`).
  const anniversaryActive = () => partyHooks().ask('event.cycle') === true;

  // Whether an expired anniversary round yields to the Hunt's Daisy return, and the supersede, are
  // the events owner's (anniversary.ts `anniversaryYields`, `supersedeAnniversary`).
  const revisionOf = (name: string) => intent(name).revision;

  // Every member of the walk is the Hunt's, on the walk's navigation revision, with no other command.
  function ownsWalk(hunt: HuntCycle, c: HuntConvoy): boolean {
    if (!c.participants?.length || c.nonPreemptible) return false;
    return c.participants.every(name => {
      const revision = c.walkingParents?.[name]?.revision, command = state.commands[name];
      return hunt.participants.includes(name) && revision !== undefined && revision === intent(name).revision &&
        (!command || command.convoyId === c.id);
    });
  }

  function farmWalkReleasable(hunt: HuntCycle, c: HuntConvoy): boolean {
    if (c.geometryRepair?.phase === 'waiting' || c.failureCode === 'geometry-mismatch') return false;
    if (c.purpose !== 'shared-walk' || c.walkingActivity !== 'farm-recovery' || !onMission(hunt)) return false;
    // A failed walk is released under farm.ts's pending retry, so the retry can start.
    if (state.farmAreaState?.pending && c.phase !== 'failed') return false;
    if ((anniversaryActive() && !anniversaryYields(state, hunt.participants, revisionOf, ports.now(), c.phase === 'failed')) || !fresh(hunt) || !ownsWalk(hunt, c)) return false;
    return !hunt.participants.some(name => {
      const command = state.commands[name];
      return down(state.statuses[name]) || intent(name).cancelled || (!!command && command.convoyId !== c.id);
    });
  }

  /**
   * The farming walk is subordinate to the Hunt's deadline: a failed walk is released, and a due
   * turn-in releases the walk for the Daisy return. farm.ts alone recovers a failed farm walk
   * (the one recovery owner): its pending retry to the mission's spawn starts the Hunt's walk
   * through `relocate`.
   */
  function releaseFarmWalk(hunt: HuntCycle): boolean {
    const c = state.activeConvoy;
    if (!c || !farmWalkReleasable(hunt, c)) return false;
    const due = shouldReturn(hunt, leader(), state.statuses);
    if (!due && c.phase !== 'failed') return false;
    ports.cancelConvoy();
    huntNote(hunt, { convoyId: null, resumeStage: undefined });
    logNavigation(due ? 'Hunt return due; released farming walk for Daisy' : 'Released failed Hunt farming walk',
      { cycleId: hunt.cycleId, convoyId: c.id, phase: c.phase });
    if (due) {
      supersedeAnniversary(state, hunt.participants, revisionOf, ports.now(), c.phase === 'failed');
      returnIfDue(hunt);
    }
    ports.persist();
    return due;
  }

  // Backup farming while blacklisted quests expire --

  // A member counts for the backup with a report at most 10 s old, alive, on the leader's server
  // and region; it is ready once it holds no live quest.
  function backupMembers(hunt: HuntCycle): NonNullable<HuntCycle['backup']>['members'] {
    const lead = state.statuses[leader()];
    return Object.fromEntries(hunt.participants.map(name => {
      const s = state.statuses[name], quest = s?.monsterHunt;
      const fresh = !!s && freshReport(s.seenAt, ports.now(), 'presence') && !s.rip && s.server === lead?.server && s.region === lead?.region;
      return [name, { target: quest?.id || null, remainingMs: Math.max(0, quest?.remainingMs || 0), fresh,
        ready: fresh && (!quest || quest.remainingMs <= 0) }];
    }));
  }

  // A live quest no blacklist holds resumes the assignments; with every member ready instead, the
  // group picks up a new batch at Daisy after the loot pass.
  function endBackup(hunt: HuntCycle, eligible: boolean): void {
    cancelHuntWalk();
    if (!eligible) {
      huntStep(hunt, 'batch-loot', { convoyId: null, backup: undefined, batchPickup: true, missionRevision: (hunt.missionRevision || 0) + 1,
        loot: undefined });
    } else {
      huntStep(hunt, 'checking-quests', { convoyId: null, backup: undefined, batchPickup: false });
      prepare(hunt);
    }
    ports.persist();
  }

  const recentCombat = (hunt: HuntCycle) => hunt.participants.some(name => {
    const s = state.statuses[name];
    return !!s && freshReport(s.seenAt, ports.now()) &&
      !!(s.activeCombatTarget || s.groupedCombat?.candidates?.length || s.groupedCombat?.retentions?.some(t => t.eligible));
  });

  // The group walks to the backup spot and farms there once every member stands in it. Crossing the
  // spot's edge while kiting or pursuing starts no new walk.
  function backupTravel(hunt: HuntCycle): void {
    const spot = backupDestination(hunt), c = state.activeConvoy;
    if (!spot) {
      labelHunt(hunt, 'backupNoSpot');
      return;
    }
    if (c && (c.id !== hunt.convoyId || c.phase === 'defending')) return;
    if (hunt.participants.every(name => {
      const s = state.statuses[name]!;
      return standsAt(spot, s, radius(name));
    })) {
      const changed = hunt.stage !== 'backup-farming';
      if (c) cancelHuntWalk();
      huntStep(hunt, 'backup-farming', { convoyId: null });
      if (changed) ports.persist();
      return;
    }
    if (c || (hunt.stage === 'backup-farming' && (partyFighting(hunt, state.statuses, ports.now()) || recentCombat(hunt)))) return;
    // farm.ts's pending relocation moves the group first, so the backup walk does not replace it.
    if (state.farmAreaState?.pending) {
      labelHunt(hunt, 'travelHeld', { text: 'waiting for farming route recovery' });
      return;
    }
    huntNote(hunt, { convoyId: null });
    start(hunt, spot, 'Backup farming while blacklisted Hunts expire', 'backup-travel');
    ports.persist();
  }

  /** Backup farming keeps the Hunt and waits for the whole assignment batch. */
  function backupStep(hunt: HuntCycle): boolean {
    if (!hunt.backup) return false;
    keepLeaderGroup(hunt);
    const members = backupMembers(hunt);
    huntNote(hunt, { backup: { ...hunt.backup, members } });
    const all = Object.values(members), ready = all.filter(member => member.ready).length;
    labelHunt(hunt, hunt.stage === 'backup-farming' ? 'backup-farming' : 'backup-travel', { ready, all: all.length });
    if (held(hunt)) {
      labelHunt(hunt, 'manualHold');
      return true;
    }
    const stale = Object.keys(members).filter(name => !members[name]!.fresh);
    if (stale.length) {
      labelHunt(hunt, 'backupStale', { name: stale.join(', ') });
      return true;
    }
    const eligible = hunt.participants.some(name => {
      const q = state.statuses[name]?.monsterHunt;
      return !!q && q.remainingMs > 0 && (q.count === 0 || !state.huntBlacklist?.[q.id]);
    });
    if (eligible || ready === all.length) endBackup(hunt, eligible);
    else backupTravel(hunt);
    return true;
  }

  // The loot barrier --

  // The leader's report is the chest reach less drift: the server's reach less what it walks in the report's age.
  const nearLoot = (lead: HuntStatus, loot: NonNullable<HuntCycle['loot']>) =>
    Math.hypot(lead.x - loot.x, lead.y - loot.y) <= reachLessDrift(GAME_CHEST_REACH, lead.speed, ports.now() - lead.seenAt);
  // The collector is the leader, current and alive.
  const lootCollector = () => {
    const lead = state.statuses[leader()];
    return lead && freshReport(lead.seenAt, ports.now()) && !lead.rip ? lead : undefined;
  };
  const memberDown = (hunt: HuntCycle) => hunt.participants.some(name =>
    intent(name).cancelled || !!state.statuses[name]?.rip || state.statuses[name]?.hp === 0);

  // The barrier for `id` holds the Hunt's walk until the collector's loot pass, observed at the
  // barrier's place after it was set, reports complete.
  function lootBarrier(hunt: HuntCycle, lead: HuntStatus, id: string): boolean {
    const set = hunt.loot?.id === id ? hunt.loot
      : { id, after: ports.now(), map: lead.map, in: instanceOf(lead), realm: realmOf(lead), x: lead.x, y: lead.y, complete: false };
    const progress = lead.huntLoot;
    const observed = progress?.id === id && progress.observedAt > set.after && progress.realm === set.realm && progress.map === set.map &&
      String(progress.in) === set.in && nearLoot(lead, set);
    const loot = observed ? { ...set, progress, complete: progress.complete } : set;
    if (loot !== hunt.loot) huntNote(hunt, { loot });
    if (loot.complete) return false;
    cancelHuntWalk();
    huntNote(hunt, { convoyId: null });
    labelHunt(hunt, 'lootPending', { text: loot.progress?.error });
    return true;
  }

  // An unfinished barrier holds; it retires once the collector left its place, since the client
  // cannot acknowledge loot from elsewhere.
  function earlierBarrier(hunt: HuntCycle): boolean | null {
    if (!hunt.loot || hunt.loot.complete || memberDown(hunt)) return null;
    const lead = lootCollector();
    if (!lead) {
      labelHunt(hunt, 'lootCollector');
      return true;
    }
    const loot = hunt.loot;
    if (realmOf(lead) !== loot.realm || lead.map !== loot.map || instanceOf(lead) !== loot.in || !nearLoot(lead, loot)) {
      huntNote(hunt, { loot: undefined });
      ports.persist();
      return null;
    }
    return lootBarrier(hunt, lead, loot.id);
  }

  /** The departure barrier: a mission whose owners finished, or a batch pickup, waits for the loot pass. */
  function lootPending(hunt: HuntCycle): boolean {
    const earlier = earlierBarrier(hunt);
    if (earlier !== null) return earlier;
    if (!['farming', 'mission-travel', 'batch-loot'].includes(hunt.stage)) return false;
    const mission = hunt.missions[hunt.currentIndex], lead = lootCollector(), batch = hunt.stage === 'batch-loot';
    if ((!mission && !batch) || !lead || memberDown(hunt)) return false;
    const id = huntLootId(hunt);
    const finished = batch || mission!.owners.every(name => {
      const s = state.statuses[name];
      return !!s && freshReport(s.seenAt, ports.now()) && s.monsterHunt?.id === mission!.target && s.monsterHunt.count === 0;
    });
    if (!finished && !(hunt.loot?.id === id && !hunt.loot.complete)) return false;
    return lootBarrier(hunt, lead, id);
  }

  // -- The tick --

  const enabled = () => state.targetMode === 'hunt';

  // The cancelled navigation intent is a user hold on the group, not a Hunt message that loses to
  // whichever check runs first (rule 2.3.4), so it shows while an event holds the Hunt too.
  function holdIntent(hunt: HuntCycle | null): void {
    ports.intentHold?.(!!hunt && enabled() && held(hunt) ? huntLabel('held') : null);
  }

  // Progress toward the Hunt's goal returns its task ladder to `walk`: a new arrival at the mission's
  // spawn. The Daisy return is one walk with no legs, so its arrival
  // is the turn-in's own progress.
  let arrivedAt: number | undefined;
  function observeProgress(hunt: HuntCycle): void {
    const arrived = !!hunt.originArrivedAt && hunt.originArrivedAt !== arrivedAt;
    if (arrived) ports.ladder?.progress();
    arrivedAt = hunt.originArrivedAt;
  }

  // The stages in order: the backup, the loot barrier (installed before the return can win the
  // race), the batch pickup, the turn-in's ownership and events, the reselection, deaths, the
  // walks' recovery, the user hold, the quests, the retreat, the roster and travel.
  function step(hunt: HuntCycle): void {
    if (backupStep(hunt)) return;
    if (hunt.stage !== 'batch-loot' && shouldReturn(hunt, leader(), state.statuses)) huntNote(hunt, { loot: undefined });
    else if (lootPending(hunt)) return;
    if (hunt.stage === 'batch-loot') {
      if (hunt.loot?.complete && fresh(hunt) && !held(hunt)) prepare(hunt);
      return;
    }
    if (ports.ownsTravel(hunt) && !hunt.turnIn) beginTurnIn(hunt, leader());
    if (!ports.ownsTravel(hunt) && eventsPending(hunt, state.statuses, eventPending, ports.online)) return;
    if (reselect(hunt)) return;
    returnMessage(hunt);
    deaths(hunt);
    if (recoverRoute(hunt) || releaseFarmWalk(hunt)) return;
    if (pause(hunt) || hunt.participants.some(name => state.statuses[name]?.rip)) return;
    if (hunt.stage === 'checking-quests') { prepare(hunt); return; }
    if (retreat(hunt) || !reconcileParticipants(hunt)) return;
    travel(hunt);
  }

  // A walk on a communication hold holds the cycle; deaths still count.
  function communicationPaused(hunt: HuntCycle): boolean {
    if (!state.activeConvoy?.communicationHold || state.activeConvoy.id !== hunt.convoyId) return false;
    deaths(hunt);
    labelHunt(hunt, 'communication', { text: state.activeConvoy?.failure });
    return true;
  }

  /** One pass while the Hunt's task holds the group; with no cycle and no walk, a cycle begins. */
  function tick(): void {
    holdIntent(state.monsterHunt);
    if (!enabled()) return;
    const hunt = state.monsterHunt;
    if (!hunt) {
      if (!state.activeConvoy) begin();
      return;
    }
    observeProgress(hunt);
    keepReturnTown(hunt);
    if (reconcileCurrentHuntParty(hunt, state, ports.now(), cancelHuntWalk)) ports.persist();
    if (communicationPaused(hunt)) return;
    arrive(hunt);
    if (observeHuntExpiry(state, hunt, ports.now(), ports.group?.() ?? null)) ports.persist();
    // While the deploy lease names a participant the cycle takes no step, so the current
    // fight finishes, and it resumes at its saved stage once the lease is gone.
    const drain = ports.drain?.();
    if (drain && hunt.participants.some(name => drain.participants.includes(name))) { labelHunt(hunt, 'consoleLoad'); return; }
    step(hunt);
  }

  // Rule 2.3.7: while its task is suspended the Hunt still tracks quest expiry, so a quest that ran
  // out under a higher task is known when the Hunt resumes (deaths count as their notices arrive).
  // It sends no travel and no commands.
  function observe(): void {
    const hunt = state.monsterHunt;
    holdIntent(hunt);
    if (!enabled() || !hunt) return;
    if (observeHuntExpiry(state, hunt, ports.now(), ports.group?.() ?? null)) ports.persist();
  }

  /** The mission walk movement ended `arrived` at the spawn hands the cycle to farming. */
  function walkArrived(walk: string): void {
    const hunt = state.monsterHunt;
    if (!hunt || hunt.convoyId !== walk || !['mission-travel', 'farming'].includes(hunt.stage)) return;
    huntStep(hunt, 'farming', { convoyId: null, originArrivedAt: ports.now(), travelCause: undefined });
    labelHunt(hunt, 'farming', { target: hunt.target });
    ports.persist();
  }
  // The Hunt's walk home keeps the Town policy its walk learned (Town interrupted, walking while
  // defending), so a replacement walk starts from it.
  function keepReturnTown(hunt: HuntCycle): void {
    const c = state.activeConvoy;
    if (c && c.id === hunt.convoyId && c.purpose === 'monster-hunt' && c.returnTown) huntNote(hunt, { returnTown: c.returnTown });
  }

  /** The mission walk's arrival between ticks, unless a communication hold stops the walk. */
  function reconcileArrival(): void {
    if (enabled() && state.monsterHunt && !state.activeConvoy?.communicationHold) arrive(state.monsterHunt);
  }

  // -- The farm spot's changes to the running mission, which only this module writes --

  /** The farm spot's relocation moves the running mission's spawn and walks the Hunt there. */
  function relocate(destination: ReturnLocation, cause?: 'farming-conflict'): void {
    const hunt = state.monsterHunt;
    if (!hunt?.target) return;
    huntNote(hunt, { travelCause: cause });
    const mission = hunt.missions[hunt.currentIndex];
    if (mission) mission.destination = destination;
    start(hunt, destination, 'Monster Hunt: ' + hunt.target, 'mission-travel');
  }

  /** The catalog's shaped area for the saved point becomes the running mission's spawn. */
  function promote(destination: ReturnLocation): void {
    const mission = state.monsterHunt?.missions?.[state.monsterHunt.currentIndex];
    if (mission) mission.destination = destination;
  }

  /** A mission walk with no farm zone left skips its mission. */
  function skipMission(reason: string): void {
    const hunt = state.monsterHunt;
    if (!hunt) return;
    const mission = hunt.missions[hunt.currentIndex];
    if (mission) Object.assign(mission, { skipped: true, skipReason: reason });
    advance(hunt);
  }

  // 6 part 2: `hunt.stage` and `hunt.questChanged`, once per change, read after each tick, so a
  // change a route or another owner made is heard on the next tick.
  let heard: { cycle?: string; stage?: string; quest: string | null } = { quest: null };
  function notices(): void {
    const hunt = state.monsterHunt, owner = hunt?.owner ?? null;
    const quest = owner ? state.statuses[owner]?.monsterHunt ?? null : null, key = quest ? quest.id : null;
    const group = ports.group?.() ?? null;
    if (hunt && (hunt.cycleId !== heard.cycle || hunt.stage !== heard.stage))
      partyHooks().notify('hunt.stage', { group, cycle: hunt.cycleId, from: hunt.cycleId === heard.cycle ? heard.stage ?? null : null,
        to: hunt.stage, by: 'core:hunting' });
    if (hunt && key !== heard.quest)
      partyHooks().notify('hunt.questChanged', { group, owner, quest: quest ?? heard.quest, change: key ? 'taken' : 'turnedIn', by: 'core:hunting' });
    heard = { cycle: hunt?.cycleId, stage: hunt?.stage, quest: key };
  }

  return { tick: () => { tick(); notices(); }, observe, reconcileArrival, begin, fresh, start, advance, returnToDaisy, died, escaped,
    relocate, promote, skipMission, walkArrived };
}

// ---- The Hunt routes' decisions (coordinator/routes.ts parses each request, asks one of these and
// replies with its answer) ----

type RouteAnswer = { status: number; body: Record<string, unknown> };
interface ReturnRetryState {
  monsterHunt: HuntCycle | null;
  activeConvoy: { id: string; purpose?: string | null; phase: string; nativeFallback?: boolean } | null;
  statuses: Record<string, HuntStatus | undefined>;
  commands: Record<string, HuntCommand | undefined>;
  escape?: { stage: string } | null;
  monsterHunterLocation: ReturnLocation | null;
}
interface ReturnRetryPorts {
  ownsTravel(hunt: HuntCycle | null): boolean;
  fresh(hunt: HuntCycle): boolean;
  cancelled(name: string): boolean;
  cancelConvoy(): void;
  start(hunt: HuntCycle, location: ReturnLocation | null, label: string, stage: 'returning'): unknown;
  persist(): void;
  // The group's task ladder: Retry is the player's shortcut to step 0.
  ladder?: { progress(): void };
}
/**
 * Retry of a failed Daisy return: the turn-in's walk failed or is gone, every participant runs the
 * walk protocol under its current intent and command, and no escape holds the group; the return
 * then starts again from where the party stands.
 */
export function retryHuntReturn(state: ReturnRetryState, ports: ReturnRetryPorts): RouteAnswer {
  const hunt = state.monsterHunt, convoy = state.activeConvoy;
  if (!hunt || hunt.stage !== 'returning' || !ports.ownsTravel(hunt) || convoy && !(convoy.purpose === 'monster-hunt' && convoy.phase === 'failed'))
    return { status: 409, body: { error: 'No failed hunt turn-in to resume' } };
  const blocked = (name: string) => {
    const command = state.commands[name];
    return !speaksWalkProtocol(state.statuses[name]) || ports.cancelled(name) || !!state.statuses[name]?.rip ||
      !!command && command.convoyId !== convoy?.id;
  };
  if (!ports.fresh(hunt) || hunt.participants.some(blocked) || state.escape && state.escape.stage !== 'released')
    return { status: 409, body: { error: 'Waiting for the current party runtimes and navigation ownership' } };
  ports.ladder?.progress();
  ports.cancelConvoy();
  huntNote(hunt, { returnNativeFallback: hunt.returnNativeFallback || !!convoy?.nativeFallback, convoyId: null });
  ports.start(hunt, state.monsterHunterLocation, 'Resuming Monster Hunt turn-in', 'returning');
  ports.persist();
  return { status: 200, body: { ok: true, convoyId: hunt.convoyId } };
}
/** A member's receipt for its current Daisy command: a failure clears the command, so the cycle issues it again. */
export function completeHuntInteraction(state: Pick<ReturnRetryState, 'monsterHunt' | 'commands'>, name: string,
  receipt: { commandId: unknown; cycleId: unknown; success: unknown; error: string }): RouteAnswer {
  const command = state.commands[name];
  if (!command || command.type !== 'monster-hunt-interact' || command.id !== Number(receipt.commandId) || command.cycleId !== receipt.cycleId)
    return { status: 409, body: { error: 'monster hunt command is no longer current' } };
  if (!receipt.success) {
    delete state.commands[name];
    labelHunt(state.monsterHunt, 'retrying', { action: String(command.action), name, text: receipt.error });
    // The game refuses the take or the turn-in past `B.sell_dist` (400; game node/server.js:5483)
    // with `distance`, which a report up to 3 s old can hide, so the cycle walks back to Daisy
    // before it issues the interaction again.
    if (receipt.error === 'distance' && state.monsterHunt) huntStep(state.monsterHunt, 'daisy-sync-travel', { daisyRegroup: true });
  }
  return { status: 200, body: { ok: true } };
}
/**
 * The player's blacklist edit: clear all, remove one with its counts, or add one by hand. A new hand
 * entry sends `hunt.blacklisted` as the threshold path does.
 */
export function editHuntBlacklist(state: HuntFailureState, action: 'add' | 'remove' | 'clear', id: string, now: number, group: string | null): void {
  const { huntBlacklist: list, huntFailures: counts } = action === 'clear' ? writeHunt(state, { huntBlacklist: {}, huntFailures: {} })
    : writeHunt(state, { huntBlacklist: state.huntBlacklist || {}, huntFailures: state.huntFailures || {} });
  if (action === 'remove') { delete list[id]; delete counts[id]; }
  else if (action === 'add' && !list[id]) {
    list[id] = { monsterId: id, at: now, kind: 'manual', deaths: 0, expirations: 0, reason: 'Manually blacklisted' };
    partyHooks().notify('hunt.blacklisted', { group, target: id, reason: list[id].reason, by: 'core:hunting' });
  }
}


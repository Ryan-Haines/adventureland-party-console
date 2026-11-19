// The targeting owner's module on the character (V1.1 install.ts, "The load order"). The class bundle imports this file before
// shared.js (runtime/characters/common.ts), so shared.js builds the module (`create`) after the last door it reads: targeting's state
// and every function of the character half, over the other owners' doors (`targetingPorts()`, V4) and the events owner's facts (api.ts
// `eventFacts()`), each read when a function runs. shared.js binds each name its other owners' code calls to the module's own
// function, with no body, installs the death listeners where v1.5.0 registered its own and publishes the reads
// other owners ask. The role runner's install line (`installTargeting`) registers `core:targeting` with its answers, builds the
// selection pass and the gates over the module, and starts the timers and listeners.
import type { HookRegistry, PublishedReads, Registration, TargetingNotice } from '../../hooks/registry.ts';
import type { CombatState, Target } from '../turns/api.ts';
import { escapeMemberResets } from '../survival/api.ts';
import { createAttackBookings } from './attack-bookings.ts';
import { createDeathActs, installTargetingDeath } from './death.ts';
import { createEvents } from './events.ts';
import { createGates, createAnswers, type createCrabRangeRecovery, type AnswerPorts, type Answers } from './gates.ts';
import { createPassing } from './passing.ts';
import { createPorcupine } from './porcupine.ts';
import { createQueueClient } from './queue-client.ts';
import { createRare } from './rare.ts';
import { createTargetingRing, type TargetingRecord } from './records.ts';
import { reflectLists, type ReflectLists } from './reflect.ts';
import { createOverkillSkip, createRetire, type OverkillSkip, type Retire } from './retire.ts';
import { createRules } from './rules.ts';
import { deliveredPicks, pick, readPicks } from './saved-fields.ts';
import { createSelection, createSelectionPass, type SelectionDeps } from './selection.ts';
import { createThreat } from './threat.ts';
import { createViews, type TargetingView } from './view.ts';
import type { ThreatAnswer } from './api.ts';
import { eventFacts } from '../../events/api.ts';
import type { CharacterHolds, PartyMembership, TaskAssignment } from '../../tasks/api.ts';
import type { MovementCharacter, PartyMovement, WalkState } from '../../movement/api/character.ts';
import type { SurvivalCharacter } from '../survival/api.ts';
import type { HuntingClient } from '../../hunting/api.ts';
import type { Bag } from '../../items/api.ts';
import type { CharacterDrain } from '../../lifecycle/api.ts';
import type { DeathRecord } from '../../status/api.ts';
import type { MerchantGathering } from '../../merchant-jobs/api.ts';

// The reply fields targeting keeps on the character as the reply sent them; the queue has its own
// acceptance.
const REPLY_FIELDS = ['partyThreats', 'partyTargets', 'leaderTarget', 'leaderCombatSelection', 'scatterBreakTarget', 'combatTargetId', 'partyPositions'] as const;

// targeting's state on the character: the selection and its published form, the grouped queue as
// the last reply delivered it, the party's targets, threats and member reports, the monster priorities,
// the last attack, the passing memory and the crab range recovery the role runner adopts. Each starts
// as shared.js started it, from the realm's saved copy where shared.js kept one.
export interface TargetingState {
  leaderTarget: any; leaderCombatSelection: any; groupedCombat: any; fightDeaths: any[]; combatSelection: { id: any; revision: number; map: any; [k: string]: any };
  combatTargetId: any; passingEncounters: Record<string, any>; peerPassingEncounters: any[]; scatterBreakTarget: any;
  partyThreats: any[]; partyTargets: any[]; lastAttackAt: number; lastAttackTarget: any;
  // The party's member reports and this character's monster priorities, as the last reply delivered them.
  partyPositions: any[]; monsterPriorities: Record<string, unknown>;
  targetingChangeTarget: ((target: any) => boolean) | null; targetingCorrectedDistance: ((target: any) => number | null) | null;
  // The two reflect lists, all characters', as the last reply that carried them delivered them.
  reflectLists: { magic?: unknown; physical?: unknown };
  // R2's set-aside list: each unreachable target's id and the time it stays set aside to.
  setAside: Record<string, number>;
  // When this client last received a Hunt travel control, and when it first saw each travel defense
  // target captured, by passing key, both on its own clock.
  huntControlSeenAt: number; captures: Record<string, number>;
  // The killed list: each confirmed dead id and when it died, kept while the client can show it.
  killed: Map<string, number>;
  // The queue client installQueueClient built for this module, and the independent pull's last refresh key.
  queueClient: any; pullRefreshKey: string | null;
  // The open selection pass's view (view.ts), null between passes.
  view: TargetingView | null;
}
// The other owners' doors targeting reads, each typed from its owner's door: the tasks owner's holds,
// assignment and membership with the game party, the movement owner's owner, parts and walk state, the survival owner's survival, the hunting owner's
// client, the items owner's bag, the lifecycle owner's drain and request, the status owner's telemetry and the merchant jobs owner's gathering. shared.js builds the
// module after the last of them, so each door is the owner's object itself. `root` is the game frame,
// whose `__party*` globals each owner types where it writes them.
export interface TargetingPorts {
  root: Record<string, any>;
  tasks: { holds: CharacterHolds; assignment: TaskAssignment; membership: PartyMembership; partyList(): string[] };
  movement: PartyMovement; walks: MovementCharacter; walkState: WalkState;
  survival: SurvivalCharacter;
  hunting: HuntingClient;
  bag: Bag;
  lifecycle: { drain: CharacterDrain; telemetry: { lastDeath(): DeathRecord | null }; request(path: string, options?: { method?: string; body?: unknown }): Promise<any> };
  merchant: { gathering: MerchantGathering };
}
// The module's functions, which each part reads of the others.
export type TargetingMap = Record<string, any>;

export function create(p: TargetingPorts): TargetingMap {
  const root = p.root;
  const s: TargetingState = {
    leaderTarget: null, leaderCombatSelection: null, groupedCombat: root.__partyGroupedCombat || null,
    fightDeaths: root.__partyFightDeaths || [], combatSelection: { id: null, revision: 0, map: null }, combatTargetId: null,
    passingEncounters: (parent as any).__partyPassingEncounters || ((parent as any).__partyPassingEncounters = {}),
    peerPassingEncounters: (parent as any).__partyPeerPassingEncounters || [], scatterBreakTarget: null, partyThreats: [], partyTargets: [],
    partyPositions: [], monsterPriorities: {},
    lastAttackAt: 0, lastAttackTarget: null, targetingChangeTarget: null, targetingCorrectedDistance: null, reflectLists: {}, setAside: {}, huntControlSeenAt: 0, captures: {}, killed: new Map(), queueClient: null, pullRefreshKey: null, view: null,
  };
  const t: TargetingMap = {};
  // The hidden picks this character reads, as its replies deliver them.
  const picks = deliveredPicks();
  readPicks(picks.read);
  Object.assign(t, createViews(t, p, s), createSelection(t, p, s), createRules(t, p, s), createEvents(t, p, s), createThreat(t, p, s), createGates(t, p, s),
    createPorcupine(t, s), createRare(t, p, s), createPassing(t, p, s), createQueueClient(t, p, s), createDeathActs(p));
  // targeting's published state: the queue and the selection read at the call, and the three writes
  // other owners make, each today's bare write. `selection()` also names the leader's selection, the
  // fight deaths and the passing memory, which movement's ports and the status owner's snapshot read (correction 7
  // of "Built (2026-11-11), part 2").
  t.queue = () => s.groupedCombat;
  t.selection = () => ({ targetId: s.combatTargetId, selection: s.combatSelection, leaderTarget: s.leaderTarget, partyTargets: s.partyTargets,
    partyThreats: s.partyThreats, scatterBreakTarget: s.scatterBreakTarget, lastAttack: { target: s.lastAttackTarget, at: s.lastAttackAt },
    leaderSelection: s.leaderCombatSelection, deaths: s.fightDeaths, passingEncounters: s.passingEncounters });
  t.setTargetId = (id: any) => { s.combatTargetId = id; };
  // The hunting owner's focus change (shared.js `focusChanged`): the selection and its published
  // form clear, then the role runner's target resets when the runner is loaded.
  t.focusChanged = () => {
    t.receive({ combatTargetId: null });
    t.publishCombatSelection(null, true);
    if (root.partyRoleRunner && root.partyRoleRunner.invalidateTarget) root.partyRoleRunner.invalidateTarget();
  };
  // The merchant runner's fight fact (shared.js runnerPorts `fighting`): on travel a monster
  // attacking the party, else the monster this character is engaged with.
  t.fightingNow = (travel: boolean) => !!(travel ? t.getNearestPartyAttacker() : t.engagedMonster());
  t.isKnownDead = (id: string) => s.killed.has(id);
  // The party's member reports, which the formation, the reunion, the escape, the event sighting and
  // the luck scan read.
  t.positions = () => s.partyPositions;
  t.noteAttackAt = (target: any, at: number) => { s.lastAttackTarget = target; s.lastAttackAt = at; };
  // The reply's targeting fields, in the order the reply handler names them; the queue goes through
  // the queue client's acceptance, and each other field is kept as the reply sent it.
  t.receive = (fields: Record<string, any>) => {
    for (const field of Object.keys(fields)) {
      if (field === 'groupedCombat') t.acceptQueue(fields.groupedCombat);
      else if ((REPLY_FIELDS as readonly string[]).includes(field)) s[field as typeof REPLY_FIELDS[number]] = fields[field];
    }
  };
  // Table A's 04 rows. `party-targets`: the leader's target, then the role runner's wake, so its next
  // pass reads it. `combat` (also a channel row): the combat control, then the leader's selection
  // and the grouped lock. `party-settings`: the party's threats and targets, and the scatter break
  // target when the reply names one with an id.
  t.leaderTargetReply = (state: Record<string, any>) => {
    t.receive({ leaderTarget: state.leaderTarget || null });
    if (root.partyRoleRunner && root.partyRoleRunner.wake) root.partyRoleRunner.wake();
  };
  t.combatReply = (state: Record<string, any>) => {
    t.acceptCombatControl(state);
    t.receive({ leaderCombatSelection: state.leaderCombatSelection || null, groupedCombat: state.groupedCombat || null });
  };
  // `positions`: the party's member reports. `priorities` (also a channel row, after the hunting
  // owner's farming section): this character's monster priorities, an object or none.
  t.positionsReply = (state: Record<string, any>) => { s.partyPositions = state.partyPositions || []; };
  t.prioritiesReply = (state: Record<string, any>) => {
    s.monsterPriorities = state.monsterPriorities && typeof state.monsterPriorities === 'object' ? state.monsterPriorities : {};
  };
  t.partySettingsReply = (state: Record<string, any>) => {
    t.receive({ partyThreats: state.partyThreats || [], partyTargets: state.partyTargets || [],
      scatterBreakTarget: state.scatterBreakTarget && state.scatterBreakTarget.id ? state.scatterBreakTarget : null });
  };
  // `core:targeting`'s published reads and requests, each named to the module's function.
  t.reads = () => ({
    'targeting.partyAttacker': t.getNearestPartyAttacker, 'targeting.partyTarget': t.getNearestPartyTarget,
    'targeting.engagedMonster': t.engagedMonster, 'targeting.focusedInRadius': t.visibleFocusedMonsterWithinRadius,
    'targeting.dungeonTarget': t.getDungeonTarget, 'targeting.eventTarget': t.nearestEventTarget,
    'targeting.returnDefenseTarget': t.returnDefenseTarget, 'targeting.rareTarget': t.rareTarget,
    'targeting.passingTarget': t.passingTarget, 'targeting.defensiveTarget': t.groupedDefensiveTarget,
    'targeting.activeTarget': t.activeCombatTarget, 'targeting.allowed': t.isAllowedTarget, 'targeting.pullOnly': t.pullOnly,
    'targeting.claimed': t.isExternallyClaimedMonster, 'targeting.attacking': t.isAttackingPartyMember,
    'targeting.priority': t.monsterPriority, 'targeting.lockAllows': t.leaderLockAllows,
    'targeting.partyTargetIs': t.isCurrentPartyTarget, 'targeting.returnAttacker': t.returnAttacker,
    'targeting.groupReady': t.groupedAttackAllowed, 'targeting.rareAllows': t.rareAttackAllowed,
    'targeting.committedEncounter': t.committedHuntEncounter, 'targeting.passingEncounter': t.isPassingEncounter,
    'targeting.levelAllows': t.passiveLevelAllowed, 'targeting.passiveStop': t.passiveStopRequired,
    'targeting.departureEngaged': t.departureTargetEngaged, 'targeting.dungeonAllows': t.dungeonTargetAllowed,
    'targeting.frankyAllows': t.frankyTargetAllowed, 'targeting.drainAllows': t.consoleDrainAllows,
    'targeting.graveyardAreaAllows': t.graveyardAreaAttackAllowed, 'targeting.passingKey': t.passingKey,
    'targeting.returnActive': t.returnCombatActive, 'targeting.unfinished': t.unfinishedFight,
    'targeting.drainCombat': t.consoleDrainCombatActive, 'targeting.departurePending': t.departureCombatPending,
    'targeting.anchorVisible': t.groupedAnchorVisible, 'targeting.report': t.queueReport,
    'targeting.acknowledgement': t.groupedAcknowledgement, 'targeting.entityReport': t.groupedEntityReport,
    'targeting.passingReport': t.passingEncounterReport, 'targeting.publishSelection': t.publishCombatSelection,
    'targeting.beginPassing': t.beginPassingAttack, 'targeting.acceptQueue': t.acceptQueue,
    'targeting.acceptControl': t.acceptCombatControl, 'targeting.cancelReturnTown': t.cancelReturnTownUnderAttack,
    'targeting.queue': t.queue, 'targeting.selection': t.selection, 'targeting.setTargetId': t.setTargetId,
    'targeting.noteAttack': t.noteAttackAt, 'targeting.receive': t.receive,
  });
  // The role runner's install hands the target call and the crab range's corrected distance back
  // here, where the selection's change and the approach read them.
  t.adopt = (module: { changeTarget(target: any): boolean; correctedDistance(target: any): number | null }) => {
    s.targetingChangeTarget = module.changeTarget; s.targetingCorrectedDistance = module.correctedDistance;
  };
  // A target the party could not reach stays set aside for `setAsideMs` and until the
  // queue's next reset; the retire marks it, and A23, A28 and the finders read it.
  t.setAsideFor = (id: string) => (s.setAside[id] = Date.now() + pick('setAsideMs'));
  t.clearSetAside = () => { s.setAside = {}; };
  t.isSetAside = (id: string) => s.setAside[id] > Date.now();
  t.anySetAside = () => { const now = Date.now(); return Object.values(s.setAside).some(until => until > now); };
  // Table A's `reflect-lists` row, which applies targeting's delivered settings: a reply that carries
  // either reflect list replaces both, and each hidden pick it carries replaces the held one.
  t.reflectReply = (state: Record<string, unknown>) => {
    if ('reflectMagicByCharacter' in state || 'reflectPhysicalByCharacter' in state)
      s.reflectLists = { magic: state.reflectMagicByCharacter, physical: state.reflectPhysicalByCharacter };
    picks.take(state);
  };
  // The two reflect lists, and Franky's fight (the events owner's `frankyActive()`), which the role runner's
  // install reads.
  t.reflectSaved = () => s.reflectLists;
  t.franky = () => eventFacts().frankyActive();
  // The role runner's selection pass, built at its install with the runner's reads.
  t.selectionPass = (deps: SelectionDeps) => createSelectionPass(t, p, deps);
  t.state = s;
  return t;
}

type Root = { __partyTargeting?: Targeting; __partyGroupedCombat?: { target?: { id?: unknown; map?: unknown; in?: string | number } | null } | null };
// The grouped queue's lock target as the coordinator's last reply delivered it (shared.js
// `groupedCombat`, the queue's state, the targeting owner's), or null.
function lockTarget(root: Root): { id: string; map: string; in?: string | number } | null {
  const t = root.__partyGroupedCombat?.target;
  return t && t.id != null ? { id: String(t.id), map: String(t.map ?? ''), in: t.in } : null;
}
// core:targeting's seven answers over one install, or the absent answers (no target, no refusal, no
// threat) with none. installTargeting publishes them with its install in hand and its stop publishes
// the absent ones, so no answer reads a global.
function answering(t: Targeting | null): Registration['hooks'] {
  return {
    'targeting.target': () => t?.answers.target(),
    'targeting.allows': (monster, skill) => t?.answers.allows(monster, skill),
    'targeting.threat': () => t?.threat(),
    // The targeting ring for the status owner's diagnostics lease.
    'targeting.records': () => t?.records() ?? [],
    // Movement's notice at its approach's last level and its sight search's end.
    'targeting.unreachable': notice => t?.retire.notice(notice),
    // The basic attack's bookings on the turns owner's notices.
    'skills.sent': notice => t?.bookings.sent(notice),
    'skills.settled': notice => t?.bookings.settled(notice),
  };
}
export const targetingRegistrations: readonly Registration[] = [
  { name: 'core:targeting', folder: 'core', author: 'adventureland-party-console',
    summary: "Picks the monster each character attacks and refuses a hit its attack gates or its reflect lists refuse.",
    hooks: answering(null) },
];

// The published reads, each the module's own function (`reads` above).
export type TargetingReads = Omit<PublishedReads, 'movement.followIfFar'>;
// shared.js publishes the reads at load, before any owner asks one, and each CODE reload publishes
// its own closure's functions in the same registration.
export function publishTargetingReads(reads: TargetingReads, hooks: Pick<HookRegistry, 'publish'>): void {
  // An escape the character joins, or a stage change that leaves it walking or holding alone,
  // clears its combat target, as v1.5.0's `applyEscape` did, inside the escape's
  // apply.
  const escapeMember = (notice: Record<string, unknown>) => {
    if (notice.character === character.name && escapeMemberResets(notice)) reads['targeting.setTargetId'](null, 'core:targeting');
  };
  const result = hooks.publish({ ...targetingRegistrations[0], hooks: { ...targetingRegistrations[0].hooks, ...reads, 'survival.escapeMember': escapeMember } });
  if (!result.ok) throw Error(`The targeting owner's core:targeting did not load: ${result.message}`);
}

interface Hooks {
  publish(registration: Registration): { ok: boolean; message?: string };
  turns: { incoming(target: unknown, attacker?: string): number };
  survival: { fighting(name: string): boolean };
  notify(hook: TargetingNotice, payload: Record<string, unknown>): unknown;
}
// The threat fact (`targeting.threat`), its answer typed in api.ts.
function threat(module: TargetingMap): ThreatAnswer {
  const entities = Object.values((parent as unknown as { entities?: Record<string, Target & { type?: string; visible?: boolean; dead?: boolean }> }).entities ?? {});
  const attacking = entities.some(e => !!e && e.type === 'monster' && !!e.visible && !e.dead && module.isAttackingPartyMember(e));
  return { attacking, partyTarget: !attacking && !!module.getNearestPartyTarget(), passing: 'return-only' };
}
export interface RunnerTargetingPorts extends Omit<AnswerPorts, 'reflect'> {
  hooks: AnswerPorts['hooks'] & Hooks;
  // The module shared.js built at load (install.ts `create`), whose functions and state the answers read.
  module: TargetingMap;
  // The crab range recovery, one per role runner, and the card's combat state, which shows its
  // diagnostic.
  recovery: ReturnType<typeof createCrabRangeRecovery>;
  state(): CombatState;
  // The role runner's selection and its drop for the retire (3.6).
  selected(): string | null;
  drop(id: string): void;
}
export interface Targeting {
  answers: Answers;
  reflect(): ReflectLists;
  // The overkill skip (3.7), read by the role runner's selection checks (selection.ts).
  skip: OverkillSkip;
  // The retire of an unreachable target and the fight-start clear (3.6).
  retire: Retire;
  threat(): ThreatAnswer;
  records(): (TargetingRecord & { seq: number; at: number })[];
  // The basic attack's bookings on `skills.sent` and `skills.settled`.
  bookings: ReturnType<typeof createAttackBookings>;
  stop(): void;
}
export function installTargeting(realm: object, ports: RunnerTargetingPorts): Targeting {
  const root = realm as Root;
  root.__partyTargeting?.stop();
  const module = ports.module;
  const publish = (t: Targeting | null) => {
    const result = ports.hooks.publish({ ...targetingRegistrations[0], hooks: answering(t) });
    if (!result.ok) throw Error(`The targeting owner's core:targeting did not load: ${result.message}`);
  };
  const reflect = () => { const saved = module.reflectSaved(); return reflectLists(saved.magic, saved.physical, character.name); };
  const ring = createTargetingRing((hook, entry) => ports.hooks.notify(hook, { character: character.name, ...entry }));
  const answers = createAnswers({ ...ports, reflect, record: ring.record });
  const skip = createOverkillSkip({ incoming: id => ports.hooks.turns.incoming(id, character.name), record: ring.record,
    live: id => { const entity = get_entity(id); return !!entity && !entity.dead; } });
  const retire = createRetire({ marks: { fail: module.setAsideFor, clear: module.clearSetAside, any: module.anySetAside, marked: module.isSetAside }, selected: ports.selected, drop: ports.drop,
    fighting: () => ports.hooks.survival.fighting(character.name), record: ring.record,
    leader: () => !!module.isLeader(), lock: () => lockTarget(root) });
  module.adopt({ changeTarget: answers.changeTarget,
    correctedDistance: (target: Target) => ports.recovery.distance(module.describeAttackRange(target) ?? null, Date.now()) });
  const bookings = createAttackBookings({ recovery: ports.recovery, state: ports.state, module });
  const targeting: Targeting = { answers, reflect, skip, retire, threat: () => threat(module), records: ring.entries, bookings,
    // The target call stays adopted after a stop, as shared.js keeps running until the loader
    // stops it too.
    stop() { if (root.__partyTargeting === targeting) { delete root.__partyTargeting; publish(null); } } };
  // The tests read records() through this global; no answer reads it.
  root.__partyTargeting = targeting;
  publish(targeting);
  return targeting;
}

Object.assign(globalThis, { partyTargeting: { create, installDeath: installTargetingDeath, publish: publishTargetingReads } });

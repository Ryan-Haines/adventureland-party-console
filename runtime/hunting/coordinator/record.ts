// The group's farming record: its parts
// hunt, spot, scatter, rare and cave, saved under today's field names so a saved state loads
// unchanged. This file loads the record, runs its load migrations once and
// holds each part's writer, which every assignment of a record field goes through.
import type { CaveCommand, CaveObservation, DungeonState, FarmAreaState, HuntCycle, HuntRouteRecovery, HuntTickState, PatrolCheckpoint,
  RareState } from '../api.ts';
import { priority } from '../../tasks/api.ts';
import { pruneFarmEvidence } from './farm.ts';
import { keepRejections, rareRejection } from './rares.ts';
import type { FarmingSelections, SavedFarmingSelections } from '../saved-fields.ts';
import type { ReturnLocation } from '../../events/api.ts';
import type { SettingsWrite, SettingsWriteResult } from '../../settings/api.ts';
import { declared } from '../../settings/coordinator/api.ts';
import { committedPassiveRules, defaultHuntSettings, huntLabel, migratePassiveSettings, type HuntLabelFacts, type HuntSettings,
  type HuntHold, type HuntStage, type PassiveSettings } from '../rules.ts';
import type { HuntBlacklistEntry, HuntFailures, HuntFailureState } from '../saved-fields.ts';

interface SavedFarming extends HuntFailureState {
  farmingProfiles?: import('../../tasks/api.ts').FarmingProfiles;
  monsterHunt?: HuntCycle | null;
  passiveHunting?: PassiveSettings | null;
  passiveRareHunts?: Record<string, boolean> | null;
  phoenixRouteOrder?: string[] | null;
  phoenixPatrolActive?: unknown;
  phoenixPatrolCheckpoint?: PatrolCheckpoint | null;
  rarePursuitProgress?: RareState['rarePursuitProgress'];
  rareRetryEvidence?: RareState['rareRetryEvidence'];
  farmAreaState?: FarmAreaState | null;
  huntBlacklist?: HuntTickState['huntBlacklist'] | null;
  relocateIfCompeting?: boolean;
}

const withoutRelocation = ({ relocateIfCompeting: _moved, ...settings }: HuntSettings): HuntSettings => settings;
// A save from before huntFailures holds its counts in the blacklist entries. Each scope (the party
// and each farming profile) gets its counts once here, so the Hunt's count and threshold rules read
// `huntFailures` as saved.
function huntFailuresOf(scope: HuntFailureState): Record<string, HuntFailures> {
  const counts = (scope.huntFailures ||= {});
  for (const [id, entry] of Object.entries(scope.huntBlacklist || {})) {
    loadBlacklistEntry(entry);
    counts[id] ||= { deaths: entry.deaths, expirations: entry.expirations };
  }
  return counts;
}
// An entry saved before it carried its kind and both counts reads them from its reason, as
// b9b5c91e's label did: an expired entry with no count counts one expiration.
function loadBlacklistEntry(entry: Partial<HuntBlacklistEntry>): void {
  const expired = entry.reason === 'Hunt quest expired before completion';
  entry.kind ??= entry.reason === 'Manually blacklisted' ? 'manual' : expired ? 'expirations' : 'deaths';
  entry.deaths ??= 0;
  entry.expirations ??= expired ? 1 : 0;
}

// A farm area record saved before recovery version 2 starts over with no failures, pending move or
// message. Nothing pauses farming travel any more (a failure climbs the farming task's ladder, 01
// design 4.2), so a pause an older build saved ends here. The hit filter and move time an older
// build saved go (farm.ts `pruneFarmEvidence`).
function loadFarmArea(state: FarmAreaState): void {
  if (state.recoveryVersion !== 2) Object.assign(state, { recoveryVersion: 2, paused: false, failures: {}, pending: null, message: null });
  if (state.paused) state.paused = false;
  pruneFarmEvidence(state);
}

// The Fairy is hunted as a passive rare only, so a focus saved with it loads without it.
const withoutFairy = (focus: string[]) => focus.filter(id => id !== 'tinyp');

// A rejection saved by an older build may carry the whole report it came from; it loads as the
// rare's own fields and the group's place, and the load keeps the record's newest (rares.ts).
function loadRareRejections(saved: RareState['rareRetryEvidence']): void {
  if (!saved) return;
  for (const [id, entry] of Object.entries(saved)) saved[id] = rareRejection(entry.sight, entry.origin);
  const kept = keepRejections(saved);
  for (const id of Object.keys(saved)) if (!kept[id]) delete saved[id];
}

// A focus saved before monsterFocus was a list is a single id; a fresh install's party scope starts
// on goo. An explicit empty list stays empty, and the selections document wins over the settings.
function savedFocus(settings: SavedFarmingSelections, selections: SavedFarmingSelections): string[] {
  if (Array.isArray(selections.monsterFocus)) return selections.monsterFocus;
  if (Array.isArray(settings.monsterFocus)) return settings.monsterFocus;
  return typeof settings.monsterFocus === 'string' ? [settings.monsterFocus] : ['goo'];
}

// The fields an older build saved on a Hunt that no code reads after the load converts them,
// and the stages it wrote that the stage table no longer holds (`ended`, `paused-event`, `failed-return`).
type OldHunt = Omit<HuntCycle, 'stage' | 'resumeStage'> & { stage: string; resumeStage?: string; encounter?: unknown; exitMode?: unknown;
  endReason?: unknown; encounterLootPending?: unknown };

/**
 * A Hunt saved by an older build converts once at load,
 * so the cycle reads none of these fields after it:
 * - a cycle paused for an event (`paused-event`) loads at the stage it paused from, since the task
 *   owner suspends a Hunt now (01 design 2.2);
 * - the met fight (`encounter`), the exit from Daisy (`exitMode`) and the end reason go: no code
 *   writes them, so their fight, exit and end are gone;
 * - a failed return (`failed-return`) checks its quests again;
 * - an ended cycle (`ended`, written by b9b5c91e's death limit and cancelled return) loads as no
 *   cycle: no code ends a Hunt that way now, so its Hunt task asks nothing, the group farms, and the
 *   next Hunt select begins a new cycle, as b9b5c91e's `begin` did for an ended one;
 * - a cycle saved before selection policy 3 or record version 2 with no turn-in running starts its
 *   quests over, as the per-pass reselection did;
 * - a mission saved before `destinationVersion` 1 keeps its point; the mission's start keeps it
 *   only when it stands in a catalog spawn of the target (hunt.ts `startMission`), since the load
 *   has no catalog;
 * - a spawn recovery entry saved mid-relocation (a bank detour included) is spent, as the
 *   recovery's retirement did.
 */
export function convertHunt(hunt: OldHunt | null | undefined): HuntCycle | null {
  if (!hunt || hunt.stage === 'ended') return null;
  if (hunt.stage === 'paused-event') { hunt.stage = hunt.resumeStage || 'checking-quests'; delete hunt.resumeStage; }
  delete hunt.encounter;
  delete hunt.exitMode;
  delete hunt.endReason;
  delete hunt.encounterLootPending;
  if (hunt.stage === 'failed-return') hunt.stage = 'checking-quests';
  if (!priority(hunt) && (hunt.policyVersion !== 3 || hunt.version !== 2))
    Object.assign(hunt, { policyVersion: 3, version: 2, missions: [], currentIndex: -1, target: null, stage: 'checking-quests',
      waitForExpiry: false, pickupPending: false });
  for (const entry of Object.values(hunt.routeRecovery || {}) as (HuntRouteRecovery & { relocation?: unknown })[]) {
    if (!entry.relocation && entry.phase !== 'relocation' && entry.phase !== 'post-relocation') continue;
    delete entry.relocation;
    entry.phase = 'excluded';
  }
  // Each stage the stage table no longer holds was converted above.
  return hunt as HuntCycle;
}

/**
 * The record as loaded (2.3): the durable Hunt, spot and rare intent from the save, and the scatter
 * part rebuilt from fresh character reports. Farming profiles keep their own copy for each scope
 * (runtime/tasks/coordinator/groups.ts), so the rejection load, the failure counts and the farm
 * area load run over each of them too.
 */
export function loadFarmingRecord(settings: SavedFarming & SavedFarmingSelections, selections: SavedFarmingSelections, now: () => number) {
  for (const scope of [settings, ...Object.values(settings.farmingProfiles || {})] as (SavedFarming | undefined)[]) {
    if (!scope) continue;
    loadRareRejections(scope.rareRetryEvidence);
    if (scope.huntBlacklist || scope.huntFailures) huntFailuresOf(scope);
    if (scope.farmAreaState) loadFarmArea(scope.farmAreaState);
  }
  const selected: FarmingSelections = {
    monsterFocus: withoutFairy(savedFocus(settings, selections)),
    monsterFocusByCharacter: Object.fromEntries(Object.entries(
      declared('monsterFocusByCharacter', selections.monsterFocusByCharacter, settings.monsterFocusByCharacter) as Record<string, string[]>)
      .map(([name, focus]) => [name, withoutFairy(focus)])),
    monsterPrioritiesByCharacter:
      declared('monsterPrioritiesByCharacter', selections.monsterPrioritiesByCharacter, settings.monsterPrioritiesByCharacter),
    monsterSearchRadiusByCharacter:
      declared('monsterSearchRadiusByCharacter', selections.monsterSearchRadiusByCharacter, settings.monsterSearchRadiusByCharacter),
    combatMode: declared('combatMode', settings.combatMode),
    targetMode: declared('targetMode', settings.targetMode),
    // The saved single mode stays as it was saved: the slot migration compares it with the
    // pair and maps an unknown one to Farming with Auto (settings/slots.ts).
    ...(typeof settings.farmingPolicy === 'string' ? { farmingPolicy: settings.farmingPolicy } : {}),
  };
  return {
    ...selected,
    farmingProfiles: declared('farmingProfiles', settings.farmingProfiles),
    // The load migration: a save from before the root setting holds the switch in the party's
    // Hunt settings, which then drop it.
    relocateIfCompeting: declared('relocateIfCompeting', settings.relocateIfCompeting ?? settings.huntSettings?.relocateIfCompeting) as boolean,
    huntSettings: withoutRelocation({ ...defaultHuntSettings, ...settings.huntSettings }),
    huntFailures: settings.huntFailures || {},
    monsterHunt: convertHunt(settings.monsterHunt),
    // A save with the old switches only migrates through the writer (`migrateRareRules` below).
    passiveHunting: declared('passiveHunting', settings.passiveHunting) as PassiveSettings,
    passiveRareHunts: declared('passiveRareHunts', settings.passiveRareHunts),
    phoenixRouteOrder: declared('phoenixRouteOrder', settings.phoenixRouteOrder),
    phoenixPatrolActive: !!settings.phoenixPatrolActive,
    phoenixPatrolCheckpoint: declared('phoenixPatrolCheckpoint', settings.phoenixPatrolCheckpoint),
    rareRetryEvidence: settings.rareRetryEvidence,
    rarePursuitProgress: settings.rarePursuitProgress,
    farmAreaState: declared('farmAreaState', settings.farmAreaState),
    huntBlacklist: declared('huntBlacklist', settings.huntBlacklist),
    monsterHunterLocation: null as ReturnLocation | null,
    // The party scope with no leader learns again. A farming profile keeps its saved learned types
    // and roster signature (tasks/coordinator/groups.ts loads the profile whole), and modes.ts
    // clears them on the first report from another roster.
    scatterMonsterTypes: [] as string[],
    scatterEpoch: now(),
    partyFarmingMode: 'default',
    partyFarmingMonsterType: null as string | null,
    scatterBreakTarget: null,
    scatterPartySignature: '',
  };
}

/**
 * The rare part's load migration: a save with only
 * the old passiveRareHunts switches gets its rules, and passiveRareHunts holds the switches the
 * rules commit. One write through the settings writer as `console:hunting`; a refused write is
 * logged, as the events owner's selection migration logs its own.
 */
export function migrateRareRules(
  party: { passiveHunting?: PassiveSettings | null; passiveRareHunts?: Record<string, boolean> | null },
  write: (batch: SettingsWrite) => SettingsWriteResult,
  log: (message: string) => void,
): void {
  const rules = migratePassiveSettings(party.passiveHunting, party.passiveRareHunts || {});
  const committed = committedPassiveRules(rules);
  if (rules === party.passiveHunting && JSON.stringify(committed) === JSON.stringify(party.passiveRareHunts)) return;
  const written = write({ by: 'console:hunting', changes: [
    { field: 'passiveHunting', value: rules },
    { field: 'passiveRareHunts', value: committed },
  ] });
  if (!written.ok) log(`The rare hunting rules were not migrated: ${written.error}`);
}

interface FocusMigrationState {
  leader: string | null;
  monsterFocus: string[];
  monsterFocusByCharacter: Record<string, string[]>;
  followers: Record<string, unknown>;
}

/**
 * A save from before the shared focus holds it as the leader's per-character copy. The load
 * promotes that copy to monsterFocus and removes it and the followers' copies, so the old copy
 * cannot overwrite later shared edits.
 */
export function migrateSharedMonsterFocus(state: FocusMigrationState): void {
  const leader = state.leader;
  if (!leader || !Object.prototype.hasOwnProperty.call(state.monsterFocusByCharacter, leader)) return;
  state.monsterFocus = state.monsterFocusByCharacter[leader]!.slice();
  for (const name of Object.keys(state.followers))
    if (state.followers[name]) delete state.monsterFocusByCharacter[name];
  delete state.monsterFocusByCharacter[leader];
}

/**
 * A save from before the navigation intents held an empty focus to mean "stop farming". With no
 * saved intents, the load cancels the farming of the party (an empty shared focus) and of each
 * solo character with an empty focus of its own.
 */
export function migrateEmptyFocusIntents(
  savedIntents: unknown,
  state: { leader: string | null; monsterFocus: unknown; monsterFocusByCharacter: Record<string, unknown> },
  navigation: { members(): string[]; invalidate(names: string[], reason: string, shared?: boolean): void },
): void {
  if (savedIntents) return;
  if (Array.isArray(state.monsterFocus) && !state.monsterFocus.length)
    navigation.invalidate(navigation.members(), 'empty focus on migration', true);
  for (const [name, focus] of Object.entries(state.monsterFocusByCharacter))
    if (name !== state.leader && Array.isArray(focus) && !focus.length)
      navigation.invalidate([name], 'empty focus on migration');
}

/**
 * The Hunt tick with its persistence on change (HNT-065, the tasks owner's S-07 persistence diff): a solo scope's
 * Hunt saves when its tick changed it, and the party's Hunt when one report's ticks changed it, the tasks owner's
 * task tick among them, so the change persists once.
 */
export function tickHuntSaved(state: { monsterHunt?: object | null }, tick: () => void, persist: () => void): void {
  const before = JSON.stringify(state.monsterHunt);
  tick();
  if (before !== JSON.stringify(state.monsterHunt)) persist();
}

// ---- The record's writers ----
//
// One writer per part of 2.3's table. Each part's file decides the change and hands it here, so
// record.ts holds every assignment of a record field. A writer answers the changes it made,
// so a part that creates a field on first use reads the new value back.
type HuntField = 'monsterHunt' | 'huntSettings' | 'huntBlacklist' | 'huntFailures' | 'monsterHunterLocation';
type SpotField = 'monsterFocus' | 'monsterFocusByCharacter' | 'monsterPrioritiesByCharacter' | 'monsterSearchRadiusByCharacter' |
  'location' | 'farmAreaState';
type ScatterField = 'scatterMonsterTypes' | 'scatterPartySignature' | 'scatterEpoch' | 'scatterBreakTarget' | 'partyFarmingMode' |
  'partyFarmingMonsterType';
type RareField = 'passiveHunting' | 'passiveRareHunts' | 'phoenixRouteOrder' | 'phoenixPatrolActive' | 'phoenixPatrolCheckpoint' |
  'rareRetryEvidence' | 'rarePursuitProgress' | 'rareHuntState';
type Changes<S, F extends string> = Partial<Pick<S, Extract<keyof S, F>>>;
// The fields a writer set, at the state's own types.
type Written<S, C> = { [K in keyof C]-?: K extends keyof S ? NonNullable<S[K]> : never };
function assign<S extends object, C extends object>(state: S, changes: C): Written<S, C> {
  Object.assign(state, changes);
  return changes as unknown as Written<S, C>;
}

/** The `hunt` part's writer (hunt.ts and modes.ts decide). */
export function writeHunt<S extends object, C extends Changes<S, HuntField>>(state: S, changes: C): Written<S, C> {
  return assign(state, changes);
}
/** The `spot` part's writer (farm.ts, and the Hunt's mission spawn through its spot changes). */
export function writeSpot<S extends object, C extends Changes<S, SpotField>>(state: S, changes: C): Written<S, C> {
  return assign(state, changes);
}
/** The `scatter` part's writer (modes.ts decides). */
export function writeScatter<S extends object, C extends Changes<S, ScatterField>>(state: S, changes: C): Written<S, C> {
  return assign(state, changes);
}
/** The `rare` part's writer (rares.ts decides). */
export function writeRare<S extends object, C extends Changes<S, RareField>>(state: S, changes: C): Written<S, C> {
  return assign(state, changes);
}
/** The `cave` part's writer (cave.ts decides). */
export function writeCave<S extends object, C extends Changes<S, 'dailyDungeons'>>(state: S, changes: C): Written<S, C> {
  return assign(state, changes);
}

// ---- The Hunt cycle's transitions ----
//
// The cycle's inner fields change only here: huntStep moves the cycle along one edge of the stage
// table with the fields that edge sets, and huntNote sets the fields that change no stage. A field
// given as undefined leaves the record, so a saved cycle holds no empty key.
type CycleFields = Omit<HuntCycle, 'stage'>;
const HUNT_STAGES = ['daisy-sync-travel', 'returning', 'at-daisy', 'assigning', 'waiting-expiry', 'checking-quests', 'mission-travel',
  'farming', 'blacklist-retreat', 'backup-travel', 'backup-farming', 'batch-loot'] as const satisfies readonly HuntStage[];
/**
 * The stage table's edges, one row per stage the cycle enters: the stages it enters from and the fields the edge
 * sets. A stage the cycle enters again from itself is an edge too, since a walk that restarts sets
 * its stage again. Every stage enters `checking-quests` (a roster change, a reselection, the safe
 * point), and a running Hunt walk's stage can follow a roster pass, a death or the farm spot's
 * relocation from any stage, so those rows list every stage.
 */
export const HUNT_EDGES = {
  'daisy-sync-travel': { from: ['checking-quests', 'at-daisy', 'assigning', 'waiting-expiry', 'batch-loot'], sets: ['convoyId', 'daisyRegroup'] },
  returning: { from: HUNT_STAGES, sets: ['convoyId'] },
  'at-daisy': { from: ['daisy-sync-travel', 'returning'], sets: ['convoyId', 'travelCheckpoint'] },
  assigning: { from: ['at-daisy', 'waiting-expiry', 'daisy-sync-travel', 'returning'], sets: ['batchPickup'] },
  'waiting-expiry': { from: ['at-daisy', 'assigning', 'daisy-sync-travel', 'returning'], sets: [] },
  'checking-quests': { from: HUNT_STAGES, sets: ['convoyId', 'participants', 'owner', 'turnIn', 'target', 'missions', 'currentIndex',
    'arrivalHandoff', 'policyVersion', 'waitForExpiry', 'pickupPending', 'backup', 'batchPickup', 'routeRecovery'] },
  'mission-travel': { from: HUNT_STAGES, sets: ['convoyId', 'originArrivedAt'] },
  farming: { from: HUNT_STAGES, sets: ['convoyId', 'arrivalHandoff', 'originArrivedAt', 'travelCause', 'recovering'] },
  'blacklist-retreat': { from: HUNT_STAGES, sets: ['recovering'] },
  'backup-travel': { from: HUNT_STAGES, sets: ['convoyId', 'target', 'returnLocation', 'backup', 'policyVersion', 'selectionLeader',
    'loot', 'turnIn', 'waitForExpiry'] },
  'backup-farming': { from: ['backup-travel'], sets: ['convoyId'] },
  'batch-loot': { from: ['backup-travel', 'backup-farming'], sets: ['convoyId', 'backup', 'batchPickup', 'missionRevision', 'loot'] },
} as const satisfies Record<HuntStage, { from: readonly HuntStage[]; sets: readonly (keyof CycleFields)[] }>;
type EdgeFields<T extends HuntStage> = Partial<Pick<CycleFields, (typeof HUNT_EDGES)[T]['sets'][number]>>;

function writeFields(record: object, fields: object): void {
  for (const [key, value] of Object.entries(fields))
    if (value === undefined) delete (record as Record<string, unknown>)[key];
    else (record as Record<string, unknown>)[key] = value;
}

/**
 * The cycle enters `to` with the fields its edge sets. An edge missing from the stage table is a bug in
 * the caller: the coordinator's error log names it with its two stages, and the step still lands, so
 * the cycle plays on as it did.
 */
export function huntStep<T extends HuntStage>(hunt: Pick<HuntCycle, 'stage'>, to: T, fields: EdgeFields<T> = {}): void {
  const from = hunt.stage;
  if (from !== to && !(HUNT_EDGES[to].from as readonly string[]).includes(from))
    console.error(`The Hunt stepped ${from} -> ${to}, an edge H2's table does not hold`);
  writeFields(hunt, fields);
  hunt.stage = to;
}

/** The cycle's fields that change no stage (a walk's end, the loot pass, the death count, the roster). */
export function huntNote<H extends Pick<HuntCycle, 'stage'>>(hunt: H, fields: Partial<Omit<H, 'stage'>>): H {
  writeFields(hunt, fields);
  return hunt;
}

// ---- The Cave visit's transitions ----
//
// The visit's inner fields change only here, as the Hunt cycle's do: caveStep moves the visit
// along one edge of its phase table, caveCommand sets or clears one member's command, caveReport
// applies a member's action report, and caveNote sets the fields that change no phase.
type Phase = DungeonState['phase'];
type VisitFields = Omit<DungeonState, 'phase'>;
/**
 * The phase table's edges, one row per phase the visit enters: the phases it enters from and the fields
 * the edge sets. Turning the event protection back on returns an exit not yet dispatched to the
 * phase it interrupted, so `exiting` leads back to every phase an exit leaves.
 */
export const CAVE_EDGES = {
  idle: { from: ['held'], sets: ['visit', 'commands', 'operations', 'pendingEvent', 'interruptedPhase', 'interruptedCommands', 'travel',
    'stairContinuation', 'progress'] },
  gathering: { from: ['idle', 'held', 'exiting'], sets: ['operations', 'participants', 'visit', 'server', 'error', 'run', 'pendingEvent',
    'exitDispatched', 'priestRecovery', 'recoveryDeaths', 'manualRecovery', 'travel', 'stairContinuation', 'progress', 'resuming',
    'interruptedPhase', 'interruptedCommands', 'commands'] },
  entering: { from: ['idle', 'gathering', 'exiting'], sets: ['operations', 'participants', 'visit', 'commands', 'server', 'error'] },
  active: { from: ['entering', 'exiting'], sets: ['run', 'commands', 'error'] },
  exiting: { from: ['gathering', 'entering', 'active', 'held'], sets: ['interruptedPhase', 'interruptedCommands', 'exitDispatched',
    'commands', 'pendingEvent', 'error'] },
  held: { from: ['active', 'exiting'], sets: ['commands', 'run'] },
} as const satisfies Record<Phase, { from: readonly Phase[]; sets: readonly (keyof VisitFields)[] }>;
type PhaseFields<T extends Phase> = Partial<Pick<VisitFields, (typeof CAVE_EDGES)[T]['sets'][number]>>;

/** The visit enters `to` with the fields its edge sets; a missing edge is logged as huntStep's is. */
export function caveStep<T extends Phase>(run: DungeonState, to: T, fields: PhaseFields<T> = {}): void {
  const from = run.phase;
  if (from !== to && !(CAVE_EDGES[to].from as readonly string[]).includes(from))
    console.error(`The Cave visit stepped ${from} -> ${to}, an edge H7's table does not hold`);
  writeFields(run, fields);
  run.phase = to;
}
/** One member's command, or none. */
export function caveCommand(run: DungeonState, name: string, command: CaveCommand | undefined): void {
  if (command) run.commands[name] = command;
  else delete run.commands[name];
}
/**
 * A member's report on its current command: a failed or uncertain action is the visit's error, and
 * an exit the game took (any outcome but failed) marks the exit dispatched.
 */
export function caveReport(run: DungeonState, name: string, report: NonNullable<CaveObservation['action']>): void {
  if (['failed', 'uncertain'].includes(report.status)) run.error = name + ': ' + report.error;
  if (run.commands[name]?.action === 'exit' && report.status !== 'failed') run.exitDispatched = true;
}
/** The visit's fields that change no phase (the roster, the travel, the progress line, the revival). */
export function caveNote(run: DungeonState, fields: Partial<VisitFields>): DungeonState {
  writeFields(run, fields);
  return run;
}

/**
 * The spot's recovery clear: a travel command with a location ends the spot's
 * pending move, its failures and its message (character-command.ts:63 in b9b5c91e).
 */
export function clearSpotRecovery(state: { farmAreaState?: FarmAreaState | null }): void {
  const area = state.farmAreaState || writeSpot(state, { farmAreaState: {} }).farmAreaState;
  Object.assign(area, { paused: false, pending: null, failures: {}, message: null, recoveryVersion: 2 });
}

/**
 * The scatter reset, the one copy: a new focus or a new roster starts the learning over with no
 * learned type, a new epoch, the grouped answer and no break.
 */
export function resetScatter(state: { scatterMonsterTypes: string[]; scatterEpoch: number; partyFarmingMode: string;
  partyFarmingMonsterType?: string | null; scatterBreakTarget?: unknown }): void {
  writeScatter(state, { scatterMonsterTypes: [], scatterEpoch: state.scatterEpoch + 1, partyFarmingMode: 'default',
    partyFarmingMonsterType: null, scatterBreakTarget: null });
}

/**
 * The Hunt's status line: the label rules.ts picks for a stage or a hold. It lives beside the
 * Hunt record, never in it, so a label change saves nothing: install.ts sends it as the
 * `hunt` task's label, which the card line and the dashboard's Hunt panel show, and
 * `hunt.view` answers it.
 */
const huntLabels = new WeakMap<object, string>();
export function labelHunt(hunt: object | null | undefined, key: HuntHold | HuntStage, facts?: HuntLabelFacts): void {
  if (hunt) huntLabels.set(hunt, huntLabel(key, facts));
}
/** The Hunt's last status line, or undefined before its first tick labels it. */
export const huntMessage = (hunt: object | null | undefined): string | undefined => hunt ? huntLabels.get(hunt) : undefined;

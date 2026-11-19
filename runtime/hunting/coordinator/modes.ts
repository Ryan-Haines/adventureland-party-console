// The combat mode entries' answer and scatter learning: the
// party's scatter record from its members' reports, the one-shot types the characters learn, the
// Monster Hunter's location, and the farming part of each character's reply. rules.ts
// `combatModeAnswer` is the one answer; the record and the reply both ask it.
import { fresh } from '../../protocol/reports.ts';
import { requestObject } from '../../lifecycle/api.ts';
import { searchReach, combatModeAnswer, huntFocusTarget, partyFocus, type FocusFacts } from '../rules.ts';
import type { CombatReference, HuntCycle, HuntFailureState, HuntStatus } from '../api.ts';
import type { EventRecovery, HuntEventTrips, ReturnLocation } from '../../events/api.ts';
import { tasks } from '../../tasks/api.ts';
import { partyHooks } from '../../hooks/index.ts';
import { played } from '../../settings/api.ts';
import { clearSpotRecovery, resetScatter, writeHunt, writeScatter, writeSpot } from './record.ts';
import { endRecovery } from '../../coordinator/survival/api.ts';

export interface ScatterStatus {
  name: string;
  farmingMonsterType?: string;
  target?: CombatReference | null;
  combatDeviation?: CombatReference | null;
  threats?: (CombatReference | null)[];
}
export interface ScatterBreak extends CombatReference {
  triggeredBy?: string;
  seenAt: number;
}
export interface ScatterState {
  scatterPartySignature?: string;
  scatterMonsterTypes: string[];
  scatterEpoch: number;
  scatterBreakTarget: ScatterBreak | null;
  partyFarmingMode: string;
  partyFarmingMonsterType: string | null | undefined;
  combatMode: string;
  // survival's party death recovery, which the combat mode answer reads as the `death-recovery`
  // task.
  combatRecovery?: unknown;
}

// ---- Scatter learning ----

// A roster change starts the learning over: a new epoch, no learned type, grouped.
function refreshMembership(state: ScatterState, names: string[]): void {
  const signature = [...names].sort().join('|');
  if (state.scatterPartySignature && state.scatterPartySignature !== signature) resetScatter(state);
  writeScatter(state, { scatterPartySignature: signature });
}

const offType = (reference: CombatReference | null | undefined, type: string) => !!reference?.id && reference.mtype !== type;

// A member's fight with a monster of another type: its deviation, its target, or an attacker.
function deviation(status: ScatterStatus, type: string, now: number): ScatterBreak | null {
  if (offType(status.combatDeviation, type)) return { ...status.combatDeviation, triggeredBy: status.name, seenAt: now };
  if (offType(status.target, type))
    return { id: status.target?.id, mtype: status.target?.mtype, triggeredBy: status.name, at: now, reason: 'party target', seenAt: now };
  const threat = status.threats?.find(entry => offType(entry, type));
  return threat ? { id: threat.id, mtype: threat.mtype, triggeredBy: status.name, at: now, reason: 'off-type attacker', seenAt: now } : null;
}

const reportsTarget = (status: ScatterStatus, id: string | undefined) =>
  status.target?.id === id || status.combatDeviation?.id === id || !!status.threats?.some(threat => threat?.id === id);

// A scattered party breaks on an off-type fight, and the break holds while a member reported that
// monster within the `report` age.
function refreshBreak(state: ScatterState, statuses: ScatterStatus[], now: number): void {
  if (state.partyFarmingMode === 'scatter' && state.partyFarmingMonsterType) {
    const target = statuses.map(status => deviation(status, state.partyFarmingMonsterType!, now)).find(Boolean);
    if (target) writeScatter(state, { scatterBreakTarget: target });
  }
  const current = state.scatterBreakTarget;
  if (!current) return;
  if (statuses.some(status => reportsTarget(status, current.id))) writeScatter(state, { scatterBreakTarget: { ...current, seenAt: now } });
  else if (!fresh(Number(current.seenAt || 0), now)) writeScatter(state, { scatterBreakTarget: null });
}

/**
 * The party's scatter record from a member's report: the roster, the break, the type it farms
 * (the break's type while one holds) and the combat mode answer. `rareOwns` is the rare encounter's hold on
 * the party; the task is the group's live task as the reply reads it (`liveTask`).
 */
export function observeScatter(state: ScatterState, names: string[], statuses: Readonly<Record<string, ScatterStatus | undefined>>,
  authority: ScatterStatus | undefined, learned: string[], now: number, rareOwns = false): void {
  // The notice compares the answer before this report with the answer after it, so `before` is
  // read ahead of the roster's reset.
  const before = state.partyFarmingMode;
  refreshMembership(state, names);
  refreshBreak(state, names.map(name => statuses[name]).filter((status): status is ScatterStatus => !!status), now);
  const monster = authority?.farmingMonsterType || authority?.target?.mtype || learned[0] || null;
  const task = liveTask(state, names.length ? tasks().assignment(names[0]!)?.kind : undefined, rareOwns);
  writeScatter(state, { partyFarmingMonsterType: state.scatterBreakTarget ? state.scatterBreakTarget.mtype : monster,
    partyFarmingMode: combatModeAnswer({ task, combatMode: state.combatMode,
      scatterBreak: !!state.scatterBreakTarget, type: monster, learned: state.scatterMonsterTypes }) });
  // 6 part 2: the answer's change and each type this report taught, named by the members' group.
  const group = names.length ? tasks().groupOf(names[0]!) : null;
  if (state.partyFarmingMode !== before)
    partyHooks().notify('farming.mode', { group, mode: state.partyFarmingMode === 'scatter' ? 'scatter' : 'grouped', by: 'core:hunting' });
  for (const type of learned) partyHooks().notify('scatter.learned', { group, type, by: authority?.name ?? 'core:hunting' });
}

/** What a report's scatter rows read: the reporter's farming scope, the connected members, the clock and the rare's hold. */
export interface ScatterReportPorts {
  farmingState(name: string): ScatterState & { merchantCharacter: string | null; leader: string | null;
    followers?: Record<string, boolean>; statuses: Readonly<Record<string, ScatterStatus | undefined>> };
  activeNames(): string[];
  now(): number;
  rareOwns(name: string): boolean;
}
/** The status owner's intake's one-shots and scatter rows: the one-shot types a report taught its scope's
 * epoch, and the scope's scatter record from the report over its connected leader and followers, less
 * the merchant, with the leader's report as the authority. */
export function createScatterReports(ports: ScatterReportPorts) {
  return {
    // The learned types reach the scope's record through its scatter writer (tasks row 5).
    oneShots(body: Record<string, unknown>): string[] {
      const scope = ports.farmingState(String(body.name)), types = [...scope.scatterMonsterTypes];
      const learned = consumeOneShotReports(body, { types, epoch: scope.scatterEpoch });
      if (learned.length) writeScatter(scope, { scatterMonsterTypes: types });
      return learned;
    },
    scatterReport(body: { name: string }, learned: string[]): void {
      const scope = ports.farmingState(body.name);
      const members = ports.activeNames().filter(name => name !== scope.merchantCharacter && (name === scope.leader || scope.followers?.[name]));
      observeScatter(scope, members, scope.statuses, scope.statuses[String(scope.leader)] || scope.statuses[body.name], learned, ports.now(),
        ports.rareOwns(scope.leader || body.name));
    },
  };
}

/** The one-shot types a report learned for the current epoch, in report order; a stale epoch learns nothing. */
export function consumeOneShotReports(body: Record<string, unknown>, state: { types: string[]; epoch: number }): string[] {
  const reported = Array.isArray(body.oneShotMonsterTypes) && Number(body.oneShotEpoch) === state.epoch
    ? body.oneShotMonsterTypes.filter((value: unknown): value is string => typeof value === 'string' && /^[a-z0-9_]+$/i.test(value))
    : [];
  const learned = reported.filter(value => !state.types.includes(value));
  if (learned.length) state.types.push(...learned);
  delete body.oneShotMonsterTypes;
  delete body.oneShotEpoch;
  return learned;
}

// The Monster Hunter's location (Daisy) a character reports, kept only on the main map.
export function acceptHunterLocation(body: Record<string, unknown>, state: { monsterHunterLocation: { map: string; x: number; y: number } | null }): void {
  const location = requestObject(body.monsterHunterLocation);
  if (location.map !== 'main' || !Number.isFinite(Number(location.x)) || !Number.isFinite(Number(location.y))) return;
  writeHunt(state, { monsterHunterLocation: { map: 'main', x: Number(location.x), y: Number(location.y) } });
}

// ---- The farming part of the reply ----

// The heartbeat's state: the scatter fields reach the reply as the settings table delivers them
// (runtime/status/api.ts `HeartbeatState`), so the reply reads them by their saved shapes.
export interface FarmingReplyState {
  combatMode?: unknown;
  scatterBreakTarget?: unknown;
  partyFarmingMonsterType?: unknown;
  scatterMonsterTypes?: unknown;
  scatterEpoch?: unknown;
  leader: string | null;
  followers: Record<string, boolean>;
  targetMode: string;
  monsterHunt: HuntCycle | null;
  monsterFocus: string[];
  monsterFocusByCharacter: Record<string, string[]>;
  monsterPrioritiesByCharacter: Record<string, Record<string, number>>;
  monsterSearchRadiusByCharacter: Record<string, number>;
  combatRecovery?: unknown;
  addonFarming?: Record<string, Record<string, unknown>>;
}

// The facts a member's focus reads, which the farming reply and the status owner's card line both hand it.
export type MemberFocusState = FocusFacts & Pick<FarmingReplyState, 'leader' | 'followers' | 'monsterFocus' | 'monsterFocusByCharacter'>;
// A character's focus: the Hunt's target while a Hunt runs, the shared focus for the party's
// leader and followers, and otherwise its own focus where it has one.
export function monsterFocus(state: MemberFocusState, name: string): string[] {
  if (huntFocusTarget(state) || (name === state.leader || state.followers[name]) && state.leader) return partyFocus(state);
  return Object.hasOwn(state.monsterFocusByCharacter, name) ? state.monsterFocusByCharacter[name]! : state.monsterFocus;
}

// Whether the farm area's walk or the rare patrol is paused (the hunting owner's two pause records),
// which movement's reply section carries to each fighter as `farmTravelPaused`.
export function farmTravelPaused(state: { farmAreaState?: { paused?: boolean } | null; rareHuntState?: { patrol?: { paused?: boolean } } | null }): boolean {
  return !!state.farmAreaState?.paused || !!state.rareHuntState?.patrol?.paused;
}

// The task the combat mode answer reads for a member: the tasks owner's assignment, with the rare's hold and a death
// recovery that is neither complete nor cancelled read as their tasks, as v1.5.0's
// reply forced both.
function liveTask(state: { combatRecovery?: unknown }, kind: string | undefined, rareOwns: boolean): string | null {
  if (rareOwns) return 'rare';
  const recovery = state.combatRecovery as { phase?: string } | null | undefined;
  if (recovery && !['complete', 'cancelled'].includes(String(recovery.phase))) return 'death-recovery';
  return kind ?? null;
}

/**
 * The farming fields of a character's reply: its focus, the Hunt target it fights, its priorities,
 * the leader's search radius, and the combat mode answer for its task (`task` is its assignment's kind).
 * The add-on stores, a target mode add-on's `deliver` among them, ride the add-on system's
 * `addon-stores` section.
 */
export function farmingReply(state: FarmingReplyState, name: string, task: string | undefined, rareOwns: boolean) {
  return {
    // The target mode entry the character's scope selected, so the character's registry asks an
    // entry's scoped hooks only while that entry is selected.
    slotEntries: { 'target-mode': String(state.targetMode) },
    monsterFocus: monsterFocus(state, name),
    huntCombatTarget: state.targetMode === 'hunt' && state.monsterHunt?.stage === 'farming' ? state.monsterHunt.target : null,
    // The character's saved priorities as they play, an add-on's overlay included.
    monsterPriorities: played(state, 'monsterPrioritiesByCharacter', name)[name] || {},
    monsterSearchRadius: searchReach(state.monsterSearchRadiusByCharacter, state.leader || name),
    // The farm row reads the learning epoch and the party's type with the mode. A combat channel
    // reply carries this section and not `settings` (status/rules.ts TABLE_R), and the farm row
    // reads an absent epoch as 0, which cleared the one-shot types learned at the scope's epoch.
    scatterEpoch: state.scatterEpoch,
    partyFarmingMonsterType: state.partyFarmingMonsterType,
    partyFarmingMode: combatModeAnswer({ task: liveTask(state, task, rareOwns), combatMode: String(state.combatMode),
      scatterBreak: !!state.scatterBreakTarget,
      type: typeof state.partyFarmingMonsterType === 'string' ? state.partyFarmingMonsterType : null,
      learned: Array.isArray(state.scatterMonsterTypes) ? state.scatterMonsterTypes : [] }),
  };
}

// The farming record a report updates ----

/**
 * The farming record of a character: a combat character's own farming scope, which the tasks
 * owner's groups answer (it follows the leader's scope or runs its own), and the party's record
 * for any other character. The status ingestion and the character routes read the record through
 * it.
 */
export function farmingRecordOf<S>(party: S, groups: { isCombat(name: string): boolean; effective(name: string): S }) {
  return (name: string): S => groups.isCombat(name) ? groups.effective(name) : party;
}

// ---- The target mode slot's Hunt entry ----

// The Hunt record of a farming scope and what the Hunt entry asks (2.1 modes.ts). The tasks
// owner's target mode slot reads only the scope's target and leader, and asks the entry the
// Hunt route hands it.
export interface HuntModeState extends HuntEventTrips {
  eventReturn?: EventRecovery | null;
  targetMode: string;
  combatMode: string;
  // The single mode derived from the pair, which the apps read (the status owner's interface)
  farmingPolicy?: string;
  monsterHunt: HuntCycle | null;
  leader: string | null;
  monsterHunterLocation: ReturnLocation | null;
  statuses: Record<string, HuntStatus | undefined>;
  monsterFocus: string[];
  monsterFocusByCharacter: Record<string, string[] | undefined>;
  escape?: { stage: string } | null;
  huntBlacklist?: HuntFailureState['huntBlacklist'];
  huntFailures?: HuntFailureState['huntFailures'];
  farmAreaState?: import('../api.ts').FarmAreaState | null;
  combatRecovery?: unknown;
}
export interface HuntEntryPorts {
  fighting?(): boolean;
  participants(): string[];
  cancelled(name: string): boolean;
  release(): void;
  authorize(names: string[], location: ReturnLocation, shared: boolean): void;
  monsterDestination(id: string | undefined): ReturnLocation | null | undefined;
  clear(): void;
  selectedDestination(name: string | null): { location: ReturnLocation } | null;
  convoy(location: ReturnLocation, label: string, names: string[], purpose?: string): unknown;
  begin(policy: string, location: ReturnLocation | null): void;
}

/**
 * The Hunt entry the tasks owner's target mode slot asks after it wrote the slot fields: `select`
 * begins, restarts or keeps the cycle for a target change, and `release` clears it and walks the
 * group to the leader's farm. Explicit mode changes discard the cycle's execution state; the live
 * quest reports stay authoritative. The blacklist and the failure counts are durable preferences,
 * which only the blacklist's clear action resets.
 */
export function createHuntEntry(state: HuntModeState, ports: HuntEntryPorts) {
  // Leaving Hunt and a restart end the farm spot's recovery.
  function reset(): void {
    ports.clear();
    writeHunt(state, { monsterHunt: null });
    clearSpotRecovery(state);
    endRecovery(state);
  }
  // An event that owns a participant's departure keeps it: the event recovery selects the farming
  // that follows once its trip ends, before the next report shows the new map.
  function release(): void {
    const eventOwnsDeparture = ports.participants().some(name => {
      const trip = state.huntEventTrips?.[name]?.at(-1);
      return !!trip && !trip.endedAt;
    });
    ports.release();
    reset();
    if (eventOwnsDeparture) return;
    const destination = ports.selectedDestination(state.leader);
    // movement's `hunt-fallback` purpose names the walk, so the Hunt's pause ends it by purpose.
    if (destination) ports.convoy(destination.location, "the leader's configured farming focus", ports.participants(), 'hunt-fallback');
  }
  function authorize(location: ReturnLocation | null): void {
    const names = ports.participants();
    const quest = names.map(name => state.statuses[name]?.monsterHunt).find(quest => !!quest && quest.count > 0);
    ports.release();
    // With no place known the walk stays released; farm.ts would save an empty place as the party's.
    const target = location || state.monsterHunterLocation || ports.monsterDestination(quest?.id);
    if (target) ports.authorize(names, target, true);
  }
  const resumeRequested = () => ports.participants().some(name => ports.cancelled(name)) || !!state.escape && state.escape.stage !== 'released';
  /**
   * A target change of the scope, `previous` to `mode`. Hunt takes the backup focus and restarts on
   * a supplied backup, on entry, on a resume or with no cycle; an event return under way keeps the
   * change for after its exit; leaving Hunt releases it.
   */
  function select(previous: string, mode: string, location: ReturnLocation | null, backupFocus: string[] | undefined, backupSupplied: boolean): void {
    // The target mode the scope had before this Hunt, which the cycle records.
    const policy = previous === 'hunt' ? state.monsterHunt?.returnPolicy || 'farming' : previous;
    if (mode === 'hunt' && backupFocus) {
      writeSpot(state, { monsterFocus: [...new Set(backupFocus)] });
      const own = new Set(ports.participants());
      writeSpot(state, { monsterFocusByCharacter: Object.fromEntries(Object.entries(state.monsterFocusByCharacter).filter(([name]) => !own.has(name))) });
    }
    const restart = mode === 'hunt' && (backupSupplied || previous !== 'hunt' || resumeRequested() || !state.monsterHunt);
    const recovery = state.eventReturn;
    if (recovery) {
      if (mode === 'hunt' && restart && resumeRequested()) authorize(null);
      if (previous === 'hunt' || restart) reset();
      recovery.postExitLocation = mode === 'hunt' ? undefined : ports.selectedDestination(state.leader)?.location || location;
      if (mode === 'hunt' && restart) ports.begin(policy, location);
      return;
    }
    if (restart && !ports.fighting?.()) authorize(location);
    if (previous === 'hunt' && mode !== 'hunt') release();
    else if (restart) { reset(); ports.begin(policy, location); }
  }
  return { select, release };
}

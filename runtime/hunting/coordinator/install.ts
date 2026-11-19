// Hunts and farming's install: the party's Cave visit and rare
// service with the rare's travel clock, each combat group's Hunt and farm spot from the same code,
// the three task sources `cave`, `rare` and `hunt`, which describe the task the hunting owner's record
// names and decide nothing, the listener that cancels the farm spot's pending move when a Hunt task
// is suspended, and the listener that counts survival's death and escape notices on each
// group's Hunt. The tasks owner's install publishes the sources in its source order.
import type { Registration } from '../../hooks/registry.ts';
import { partyHooks } from '../../hooks/index.ts';
import { dueYields, GROUPS, priority, tasks, type HuntRecord, type LadderPort, type SourceAnswer, type SourceAsk,
  type SourceView } from '../../tasks/api.ts';
import { createCave, caveOwns } from './cave.ts';
import { createFarm, type FarmPorts } from './farm.ts';
import { createHunt, cancelCoordinatorHuntConvoy, type HuntPorts } from './hunt.ts';
import { huntMessage, tickHuntSaved } from './record.ts';
import { createScatterReports, type ScatterReportPorts } from './modes.ts';
import { createRares, type RarePorts } from './rares.ts';
import { contains, type Area, type Point } from '../zones.ts';
import type { CaveState, FarmingFocus, HuntView, PassiveRuleView } from '../api.ts';
import { caveTravelLabel, defaultPassiveRule, legacyPriorities, type PassiveSettings } from '../rules.ts';

// The `hunt-status` slot's warning while a rare encounter runs.
const RARE_MODE_WARNING = 'Changing the mode now ends the rare fight and its loot';

interface HuntingPorts {
  // The Cave visit's ports (cave.ts): the clock, the save, the merchant job's visit it waits for,
  // and the cancel of the members' walk and commands when a visit begins.
  cave: Parameters<typeof createCave>[1] & {
    // The lifecycle owner's answer whether the member is online by any client, which the Hunt's
    // events-pending hold reads.
    online(name: string): boolean;
  };
  // The rare's ports (rares.ts) less the hand-in hold, which the install asks the tasks owner's
  // door for on the party's walk group (`group`).
  rare: Omit<RarePorts, 'runs'> & { group(): string | null };
  persist(): void;
  // The tasks owner's combat groups now, which the per-report tick steps.
  groups(): string[];
  // A character farming in its own solo group, where no rare runs.
  solo(name: string): boolean;
  // The per-report scatter's reads (modes.ts createScatterReports).
  farmingState: ScatterReportPorts['farmingState'];
  activeNames: ScatterReportPorts['activeNames'];
  now(): number;
}

/** What a combat group's Hunt and farm spot ask of its composition. */
interface HuntingGroupPorts extends Pick<HuntPorts, 'now' | 'participants' | 'cancelConvoy' | 'persist'
  | 'selectedDestination' | 'start' | 'intentHold' | 'drain'> {
  // The tasks owner's answer that the group's live task is farming (farm.ts's empty
  // spawn return).
  farmingLive(): boolean;
  // The combat group's id in the tasks owner's table, which the hunting owner's hooks name as
  // `group`; null before the group has a leader, and 07 keys that group's scope by null.
  group(): string | null;
  navigation: HuntPorts['navigation'] & { members(): string[] };
  // The group's task ladder over the kinds named.
  ladder(kinds: readonly import('../../tasks/api.ts').TaskKind[]): LadderPort;
}

/**
 * The module's install: the party's Cave visit and rare service, and `group`, which builds each
 * combat group's Hunt and farm spot. The rare steps on each member report (`rareTick`, the status owner's
 * table I row) and each walk notice.
 */
export function installHunting(party: Parameters<typeof createCave>[0] & Parameters<typeof createRares>[0] & { monsterHunt?: object | null }, ports: HuntingPorts) {
  const cave = createCave(party, ports.cave);
  const rares = createRares(party, { ...ports.rare, runs: () => tasks().runs(null, 'rare') });
  // The rare acts while the tasks owner's table lets the rare source run (its
  // `runs` column).
  const rareTick = () => { if (tasks().runs(null, 'rare')) rares.tick(); };
  // Each combat group's Hunt and farm spot. An entry holds its group's live id in the tasks owner's
  // table, which follows the party's leader, so a leader change keeps the party's entry.
  const stepped: { group(): string | null; state: Parameters<typeof createHunt>[0]; hunt: ReturnType<typeof createHunt>; farm: ReturnType<typeof createFarm>;
    cancelConvoy(): unknown; shared: boolean }[] = [];
  /**
   * The one tick per member report: each of the tasks owner's combat groups' Hunt and farm spot,
   * each while the tasks owner's table lets its source run (`runs`). A Hunt whose hand-in yields
   * to a due event ends its hand-in walk, which restarts from where the members stand once the
   * event is over (2.2 hunt-turn-in row); a Hunt that may not act observes. The tasks owner's task
   * tick (`taskTick`) runs inside the party Hunt's save window, so a task change that moves the
   * shared Hunt persists once with the Hunt's own tick.
   */
  function reportTick(reporter: string, taskTick: () => void): void {
    tickHuntSaved(party, () => { taskTick(); stepGroups(reporter); }, ports.persist);
  }
  function stepGroups(reporter: string): void {
    // A live group has a leader, so its id is the string the tasks owner's
    // groups list names.
    const live = ports.groups().flatMap(id => {
      const g = stepped.find(e => e.group() === id);
      return g?.state.leader ? [{ id, g }] : [];
    });
    for (const { id, g } of live) {
      const cycle = g.state.monsterHunt;
      if (tasks().huntYields(id)) {
        if (cycle?.convoyId && g.state.activeConvoy?.id === cycle.convoyId) { g.cancelConvoy(); cycle.convoyId = null; ports.persist(); }
        g.hunt.observe();
      } else if (!tasks().runs(id, 'mode')) g.hunt.observe();
      else if (g.shared) g.hunt.tick();
      else tickHuntSaved(g.state, g.hunt.tick, ports.persist);
    }
    for (const { id, g } of live) if (tasks().runs(id, 'farm-area')) g.farm.tick(reporter);
  }
  const { oneShots, scatterReport } = createScatterReports({ ...ports, rareOwns: name => rareOwns(name) });
  // The rare owns a character's farming only in the party's group.
  const rareOwns = (name: string) => !ports.solo(name) && rares.owns();
  // The rare's answers for a group: the party's rare service, and nothing for a group whose task table's
  // `groups` column runs no `rare` source.
  function rareOf(kind: 'party' | 'solo') {
    const rare = GROUPS[kind].rare ? rares : null;
    return {
      owns: () => !!rare?.owns(),
      control: (name: string) => rare ? rare.control(name) : null,
      encounter: () => !!rare?.encounter(),
      blocksPulls: () => !!rare?.blocksPulls(),
      patrolAcquisitionAllowed: () => !!rare?.patrolAcquisitionAllowed(),
      rejected: () => rare?.rejected() ?? [],
    };
  }
  /** A combat group's Hunt and farm spot: the farm spot advances and starts the group's own Hunt. */
  function group(state: Parameters<typeof createHunt>[0] & Parameters<typeof createFarm>[0], kind: 'party' | 'solo',
    workers: Record<string, unknown>, g: HuntingGroupPorts) {
    const rare = rareOf(kind), huntLadder = g.ladder(['hunt-mission', 'hunt-turn-in']);
    const hunt = createHunt(state, { now: g.now, participants: g.participants, cancelConvoy: g.cancelConvoy,
      persist: g.persist, selectedDestination: g.selectedDestination, start: g.start, navigation: g.navigation, ownsTravel: priority,
      ladder: huntLadder, intentHold: g.intentHold, drain: g.drain, group: g.group, online: ports.cave.online,
      questRefused: (owner, quest, candidates) => !!partyHooks().hunting.questRefused({ group: g.group(), owner, quest, candidates }) });
    const farm = createFarm(state, workers, { now: g.now, group: g.group, rareOwns: rare.owns, members: () => g.navigation.members(),
      intent: name => g.navigation.intent(name) as ReturnType<FarmPorts['intent']>, huntOwns: priority, cancelConvoy: g.cancelConvoy,
      spot: ask => partyHooks().hunting.spot({ group: g.group(), ...ask }), farmingLive: g.farmingLive,
      hunt: { relocate: (location, cause) => hunt.relocate(location, cause), promote: location => hunt.promote(location),
        skipMission: reason => hunt.skipMission(reason) },
      authorize: (names, location, force) => g.navigation.authorize(names, location, force),
      startConvoy: (location, label, names, purpose, cause) => { g.start(location, label, names, purpose, cause); },
      persist: g.persist, ladder: g.ladder(['farming']) });
    cycles.add(hunt);
    scopes.push({ group: g.group, state, rare });
    stepped.push({ group: g.group, state, hunt, farm, cancelConvoy: () => cancelCoordinatorHuntConvoy(state, g.cancelConvoy), shared: kind === 'party' });
    return { hunt, farm, huntLadder, rare };
  }
  // Each combat group's record and rare answers, which the published reads answer from.
  const scopes: { group(): string | null; state: ReadScope; rare: ReturnType<typeof rareOf> }[] = [];
  const scopeOf = (group: string | undefined) => group === undefined ? undefined : scopes.find(s => s.group() === group);
  // 6 part 3: the reads an add-on and another owner may ask. Each reads the record and changes nothing.
  const reads: Registration = { name: 'core:hunting-reads', folder: 'core', author: 'adventureland-party-console',
    summary: "Answers a group's farming focus and Hunt cycle, the Cave visit's state and a monster's passive rule.",
    hooks: {
      'farming.focus'(group?: string): FarmingFocus | undefined {
        const scope = scopeOf(group);
        if (!scope) return undefined;
        const s = scope.state, area = s.location ?? null, hunt = s.targetMode === 'hunt' ? s.monsterHunt : null;
        return { focus: s.monsterFocus, priorities: s.monsterPrioritiesByCharacter, radius: s.monsterSearchRadiusByCharacter, area,
          contains: (point: Point & { map?: string }) => !!area && point.map === area.map && contains(area, point),
          huntTarget: hunt?.target ?? null, partyType: s.partyFarmingMonsterType ?? null, mode: s.partyFarmingMode,
          rare: { state: s.rareHuntState ?? null, rejected: scope.rare.rejected(), owns: scope.rare.owns(),
            patrolAcquisition: scope.rare.patrolAcquisitionAllowed() },
          blocksPulls: scope.rare.blocksPulls(), spot: s.farmAreaState?.message ?? null };
      },
      // A member: whether it stands inside a run (its own report), whether the visit owns it,
      // and two further reads, which never retire the visit or start an exit. The party:
      // the visit's phase, its run record and its members.
      'cave.state'(member?: string): CaveState {
        const d = party.dailyDungeons;
        if (member === undefined) return { phase: d?.phase ?? 'idle', run: d?.run ?? null, members: d?.participants ?? [],
          travel: d?.travel?.trying ? caveTravelLabel(d.travel.trying) : null };
        const inside = !!(party.statuses[member] as { dungeon?: { cave?: unknown } | null } | undefined)?.dungeon?.cave;
        return { inside, owned: caveOwns(party, member), eventAllowed: (event?: string) => cave.eventAllows(member, event),
          canRelease: cave.canRelease() };
      },
      'passive.rule'(monster: string): PassiveRuleView {
        const rules = (party as { passiveHunting?: PassiveSettings }).passiveHunting?.rules;
        return { rule: rules?.[monster] ?? defaultPassiveRule(monster), default: defaultPassiveRule(monster),
          corePriority: Object.hasOwn(legacyPriorities, monster) };
      },
      'hunt.view'(group: string): HuntView | undefined {
        // The scope's Hunt record while one exists, in any target mode, as v1.5.0's Hunt
        // panel read it (dashboard/features/party/farming-mode-control.tsx:254-260).
        const scope = scopeOf(group), s = scope?.state, hunt = s?.monsterHunt;
        // A mode change during a rare applies at once and ends the fight and its loot, so the card's
        // mode control shows this warning while an encounter runs.
        const warning = scope?.rare.encounter() ? RARE_MODE_WARNING : null;
        if (!hunt && !warning) return undefined;
        return { stage: hunt?.stage ?? null, mission: hunt?.missions?.[hunt.currentIndex ?? -1] ?? null, target: hunt?.target ?? null,
          owner: hunt?.owner ?? null, counts: hunt?.target ? s!.huntFailures?.[hunt.target] ?? null : null, label: huntMessage(hunt) ?? null, warning };
      },
    } };
  const readsPublished = partyHooks().publish(reads);
  if (!readsPublished.ok) throw Error(`07's ${reads.name} did not load: ${readsPublished.message}`);
  // Each combat group's Hunt, which hears survival's death and escape notices.: the party's
  // rare abandons its encounter when the party death recovery escapes (S-07s8); a Hunt under the
  // recovery resumes when 01 resumes its task after the recovery's `recovered` end (S-07s9).
  const cycles = new Set<ReturnType<typeof createHunt>>();
  // The Hunts of the tasks owner's live combat groups, which count deaths and escapes. A solo group
  // composed while its character followed no leader stays composed after that character leads the
  // party, and its scope then reads the leader's profile, the party's own Hunt record; it is in no
  // live group, so the death counts once, on the party's Hunt.
  const counting = () => { const live = new Set(ports.groups()); return stepped.filter(g => live.has(g.group() ?? '')).map(g => g.hunt); };
  const counts: Registration = { name: 'core:hunt-count', folder: 'core', author: 'adventureland-party-console',
    summary: "Counts a Hunt participant's death and too-hard escape on the cycle's target, ends the rare encounter when the party death recovery escapes, hands a Hunt to farming when its mission walk arrives, steps the rare on each walk notice, and ends a pending farming-conflict move when relocation turns off.",
    hooks: {
      'survival.recoveryPhase'(notice) { if (notice.to === 'escaping') rares.abandon(); },
      // A mission walk that ended `arrived` hands its cycle to farming.
      'walk.ended'(notice) { if (notice.code === 'arrived') for (const hunt of cycles) hunt.walkArrived(String(notice.walk)); rareTick(); },
      // The rare steps on each member report (the status owner's ingestion stage `rareTick`) and
      // each walk notice, the moments its walk or its members' places change.
      'walk.formed'() { rareTick(); },
      'walk.phase'() { rareTick(); },
      'walk.member'() { rareTick(); },
      // The rare's task ended and farming took the group back; its farm walks back to the spot.
      'task.ended'(notice) {
        if (notice.kind === 'rare' && notice.next === 'farming')
          for (const g of stepped) if (g.group() === (notice.group ?? null)) g.farm.rareEnded();
      },
      'survival.died'(notice) { for (const hunt of counting()) hunt.died(notice as { name: string; at: number }); },
      'survival.escaped'(notice) { for (const hunt of counting()) hunt.escaped(notice as { names: string[]; cause: string; mtypes: string[]; deaths?: string[] }); },
      // The root relocation switch turned off ends each group's pending farming-conflict move.
      'settings.changed'(notice) {
        if (notice.field === 'relocateIfCompeting' && partyHooks().read({ field: 'relocateIfCompeting' }) === false)
          for (const group of stepped) group.farm.relocationOff();
      },
    } };
  const published = partyHooks().publish(counts);
  if (!published.ok) throw Error(`07's ${counts.name} did not load: ${published.message}`);
  // `rareTick` is the rare's step, which the status owner's intake runs on every full and combat-only
  // report.
  return {
    cave, rares, group, reportTick, rareTick, oneShots, scatterReport, rareOwns,
  };
}

interface Visit { owner: string; members: string[]; phase: string; label: string }
// The record fields the published reads answer from (2.3).
interface ReadScope {
  targetMode?: unknown;
  location?: (Area & { map: string }) | null;
  monsterFocus?: string[];
  monsterPrioritiesByCharacter?: unknown;
  monsterSearchRadiusByCharacter?: unknown;
  partyFarmingMonsterType?: string | null;
  partyFarmingMode?: string;
  rareHuntState?: unknown;
  huntFailures?: Record<string, unknown>;
  monsterHunt?: { stage: string; target?: string | null; owner?: string | null; currentIndex?: number; missions?: unknown[] } | null;
  farmAreaState?: { message?: string | null } | null;
}
export interface HuntScope {
  targetMode?: unknown;
  leader?: string | null;
  monsterHunt?: HuntRecord & { cycleId?: string } | null;
  farmAreaState?: { pending?: unknown } | null;
}
const source = (name: string, summary: string, answer: (g: SourceView) => SourceAnswer[]): Registration =>
  ({ name, folder: 'core', author: 'adventureland-party-console', summary, hooks: { 'task.request': view => answer(view as SourceView) } });

/**
 * The Hunt's task kind for its scope (its `hunt` row): the hand-in while it holds travel and does not
 * yield to a due event (`dueYields`), backup farming while Hunts expire, the mission otherwise;
 * null with no Hunt record in the scope.
 */
export function huntKind(state: HuntScope, due: boolean) {
  const hunt = state.targetMode === 'hunt' ? state.monsterHunt : null;
  if (!hunt) return null;
  return priority(hunt) && !(due && dueYields('hunt-turn-in')) ? 'hunt-turn-in' : String(hunt.stage).startsWith('backup') ? 'farming' : 'hunt-mission';
}

interface HuntingSourcePorts {
  // The Cave visit's task (cave.ts `task`) and the rare encounter's (rares.ts `task`).
  visit(): Visit | null;
  rare(): Omit<SourceAsk, 'kind'> | null;
  // The scope of a combat group whose scope has a leader; other groups ask nothing.
  scope(group: SourceView): HuntScope | null;
  due(state: HuntScope): boolean;
}

/** The three sources and the suspend listener, in the order the tasks owner asks them. */
export function createHuntingSources(ports: HuntingSourcePorts) {
  // The scope each group's Hunt source described last, which the suspend listener edits.
  const scopes = new Map<string, HuntScope>();
  // The Cave visit: the party's, and a solo group's while it holds a participant still inside (01
  // 2.4 gap 1), so its own Hunt and farming wait by the table.
  const cave = source('core:cave', 'Asks for the Cave of Many Dreams visit while a run holds its members.', g => {
    if (g.groupKind === 'merchant') return [];
    const v = ports.visit(), ours = g.groupKind === 'party' ? !!v : !!v && v.members.includes(g.members[0]!);
    return [{ slot: 'visit', end: 'visit-ended', ask: v && ours ? { kind: 'cave', ...v, members: g.groupKind === 'party' ? v.members : [...g.members] } : null }];
  });
  // The rare encounter, the party's only.
  const rare = source('core:rare', 'Asks for a rare monster hunt while its encounter runs.', g => {
    if (g.groupKind !== 'party') return [];
    const task = ports.rare();
    return [{ slot: 'rare', end: 'rare-ended', ask: task ? { kind: 'rare', ...task } : null }];
  });
  // The Hunt, combat groups only: the merchant's group never holds a Hunt task, so its event travel
  // is never held by one.
  const hunt = source('core:hunt', 'Asks for the Monster Hunt: its mission, its hand-in, or backup farming.', g => {
    if (g.groupKind === 'merchant') return [];
    const state = ports.scope(g);
    if (!state) return [];
    scopes.set(g.group, state);
    const kind = huntKind(state, ports.due(state)), cycle = state.monsterHunt!;
    return [{ slot: 'hunt', end: state.targetMode === 'hunt' ? 'hunt-ended' : 'replaced:farming', ask: kind ? { kind, owner: `hunt:${cycle.cycleId}:${kind}`,
      members: [...(cycle.participants ?? [])], phase: String(cycle.stage), label: huntMessage(cycle) || 'Monster Hunt' } : null }];
  });
  // A suspended Hunt task cancels the farm spot's pending move; the
  // farming task keeps it and resumes with a walk back to the saved spot.
  const suspended: Registration = { name: 'core:hunting', folder: 'core', author: 'adventureland-party-console',
    summary: "Cancels a group's pending farm spot move when its Hunt task is suspended.",
    hooks: { 'task.suspended'(notice) {
      const state = scopes.get(String(notice.group ?? ''));
      if ((notice.kind === 'hunt-mission' || notice.kind === 'hunt-turn-in') && state?.farmAreaState?.pending) state.farmAreaState.pending = null;
    } } };
  return { cave, rare, hunt, suspended };
}

// The survival owner's install on the coordinator: the one death counter, the verdict and the escape's cause, the
// party escape and the party death recovery with what they ask of other owners, the one coordinator log, and the
// `core:survival` answers. application.ts calls it once, and the install's registration runs its step on each
// member report and each escape stage change. Other owners are asked through their hooks: the tasks owner's
// `death-recovery` question, the movement owner's `walks.end` and the recovery walks, the targeting owner's `targeting.fight` and its listener on
// the recovery's and the escape's notices.
import type { HookRegistry, MemberHold, MemberHoldAsk } from '../../hooks/registry.ts';
import { ARRIVAL_TOLERANCE } from '../../movement/api/character.ts';
import { gameMonsters, homeGoal, isSafeAt } from '../../movement/api/coordinator.ts';
import { fresh } from '../../protocol/reports.ts';
import { tasks } from '../../tasks/api.ts';
import { linesOf } from '../../characters/survival/lines.ts';
import { createDied, type SurvivalPublish } from './died.ts';
import { createEscaped, type EscapeOdds, type EscapeRecord } from './escaped.ts';
import { createPartyEscape, type EscapeState, type SafeHome } from './escape.ts';
import { createPartyRecovery, type FightRead, type RecoveryState } from './recovery.ts';
import { registerCoordinatorSurvival } from './registrations.ts';
import { createVerdicts, type VerdictFoe, type VerdictMember } from './verdict.ts';
import type { FightMonster } from '../../protocol/hold-check.ts';
import { contains, eventDeath, type Area, type EventTripSpan } from '../../hunting/api.ts';
import { searchReach } from '../../hunting/coordinator/api.ts';
import { appendCombatLog } from '../../status/coordinator/api.ts';

// The party record the module reads and writes: its own records (`escape`, `combatRecovery`,
// `combatDeathSeen`, `survivalEscapes`) and the members' reports, the group's walk and the log.
export type SurvivalParty = EscapeState & RecoveryState & {
  statuses: Record<string, (EscapeState['statuses'][string] & RecoveryState['statuses'][string] & {
    recovery?: { stage?: string } | null; hpPotionBelow?: unknown; commandHold?: { owner: string; reason: string } | null }) | undefined>;
  commands: Record<string, unknown>;
  // Survival only appends to the log (`survivalLog`), so it declares no shape for the entries it reads.
  combatLogs: Record<string, unknown[]>;
  survivalEscapes?: EscapeRecord;
  hpPotionBelow?: Record<string, number>;
  huntEventTrips?: Record<string, EventTripSpan[]>;
  monsterSearchRadiusByCharacter?: Record<string, number | undefined>;
};
export interface CoordinatorSurvivalPorts {
  hooks: Pick<HookRegistry, 'publish' | 'notify' | 'walks' | 'targeting' | 'survival'>;
  party: SurvivalParty;
  now(): number;
  persist(): void;
  // The party group's walk key (the tasks owner's `groupKey(groupId('party',
  // leader))`).
  group(): string;
  members(): string[];
  intent(name: string): { revision: number; cancelled?: boolean };
  // Movement's walk start at the asker's tier for the escape's regroup and the farm return.
  convoy(location: unknown, label: string, names: string[], purpose: string): unknown;
  // The hunting owner's `cave.state` answer: a member inside a Cave run.
  inCave(name: string): boolean;
  // The lifecycle owner's answer whether a member is online by any client, which the escape asks
  // before it drops a member whose reports are late.
  online(name: string): boolean;
}

// Survival's log line: the party leader's log, or the named member's while the party has none.
export function survivalLog(party: Pick<SurvivalParty, 'combatLogs' | 'leader'>, entry: { at: number; type: string; message: string; details?: Record<string, unknown> }, member?: string): void {
  appendCombatLog(party.combatLogs, party.leader || member || '', entry);
}

// The walks that are survival's own: the escape's regroup and the death recovery's farm return.
const OWN_WALKS = ['escape-recovery', 'death-recovery'];
// `member.holder` for survival: a dead member, one whose own death recovery runs after its respawn
// (`reviving`) and one the party escape owns, each not coming, so the walk lets it go and the party
// goes on. The answer reads the member's report and the escape's record. On survival's own walks an
// escaping member is coming: its escape is the walk's own errand, not a hold, so only a death lets a
// member go there. Off them, a member whose own report names 05 as what holds it from the walk
// (`commandHold`) and that no row above answers is coming once that request ends, which its next
// report shows, as 01 and 08 answer their own.
export function survivalHolds(party: Pick<SurvivalParty, 'statuses' | 'activeConvoy'>, ask: MemberHoldAsk, group: string, owns: (name: string) => boolean): MemberHold[] {
  const s = party.statuses[ask.member];
  if (!s) return [];
  if (s.rip) return [{ owner: '05', reason: 'dead', coming: false, endsOn: 'survival.memberRecovery' }];
  const own = ask.group === group && OWN_WALKS.includes(String(party.activeConvoy?.purpose));
  if (owns(ask.member)) return [{ owner: '05', reason: 'escaping', coming: own, endsOn: 'survival.escapeEnded' }];
  if (own) return [];
  const stage = s.recovery?.stage;
  if (stage && !['recovery-complete', 'recovery-cancelled'].includes(stage)) return [{ owner: '05', reason: 'reviving', coming: false, endsOn: 'survival.memberRecovery' }];
  return s.commandHold?.owner === '05' ? [{ owner: '05', reason: s.commandHold.reason, coming: true, endsOn: 'report' }] : [];
}

/**
 * The death recovery's reads of survival's own health rule and of the tasks owner's and the hunting owner's answers, which the install
 * Composes and the disengagement fixture runs too.
 * - `low`: survival's one health rule on the coordinator, a member below its "HP potion below" line (survival's
 *   setting, with the class defaults of lines.ts), the line its potion table drinks below. The
 *   death recovery's `safe` and `survival.low` both read it.
 * - `allows`: the tasks owner's table, whether the member's task lets the death recovery take it.
 * - `eventDeath`: the hunting owner's event death test (s1): an event's death starts no party death recovery.
 * - `inFarm`: the hunting owner's farm area test with the leader's search reach, the farm return's arrival.
 */
export function recoveryReads(party: Pick<SurvivalParty, 'statuses' | 'hpPotionBelow' | 'huntEventTrips' | 'leader' | 'monsterSearchRadiusByCharacter'>) {
  return {
    low(name: string): boolean {
      const s = party.statuses[name];
      return !!s && Number(s.max_hp) > 0 && Number(s.hp) / Number(s.max_hp) < linesOf(String(s.ctype ?? ''), { hp: party.hpPotionBelow?.[name] }).hp / 100;
    },
    allows: (name: string) => tasks().allows('death-recovery', name),
    eventDeath: (name: string, s: Parameters<typeof eventDeath>[0], at: number, reported: boolean) =>
      eventDeath(s, party.huntEventTrips?.[name] || [], at, reported),
    inFarm: (location: unknown, point: { map?: string; x?: number; y?: number }) =>
      contains(location as Area | null, point as { map?: string; x: number; y: number }, 0, searchReach(party.monsterSearchRadiusByCharacter, party.leader)),
  };
}

export function installCoordinatorSurvival(ports: CoordinatorSurvivalPorts) {
  const { party, hooks } = ports;
  const log = (message: string) => survivalLog(party, { at: ports.now(), type: 'disengagement', message });
  const publish: SurvivalPublish = { notify: (hook, payload) => hooks.notify(hook, payload), log: (entry, member) => survivalLog(party, entry, member) };
  const verdicts = createVerdicts({ now: ports.now, monsters: () => gameMonsters() as Readonly<Record<string, FightMonster | undefined>> | null });
  const died = createDied({ now: ports.now, status: name => party.statuses[name], seen: () => (party.combatDeathSeen ||= {}) as Record<string, { at: number; dead: boolean }>, publish });
  const escaped = createEscaped({ now: ports.now, record: () => (party.survivalEscapes ||= {}), publish });
  const status = (name: string): VerdictMember | undefined => party.statuses[name] ? { ...party.statuses[name], name } as VerdictMember : undefined;
  const reads = recoveryReads(party), low = reads.low;
  const atHome = (s: { map?: string; in?: string | number; x?: number; y?: number }, home: SafeHome) =>
    isSafeAt(home, s as Parameters<typeof isSafeAt>[1]);
  const home = (map: string | undefined) => homeGoal(map) as SafeHome | null;
  const escape = createPartyEscape(party, { now: ports.now, persist: ports.persist, home, atHome, arrival: ARRIVAL_TOLERANCE, group: ports.group, online: ports.online,
    endWalk: () => { hooks.walks.end(ports.group(), 'escape'); },
    convoy: (names, goal) => ports.convoy({ map: goal.map, x: goal.x, y: goal.y }, 'escape recovery', names, 'escape-recovery'),
    notify: (hook, payload) => hooks.notify(hook, payload) });
  const recovery = createPartyRecovery(party, { now: ports.now, persist: ports.persist, log, group: ports.group,
    notify: (hook, payload) => hooks.notify(hook, payload),
    died: (names, rules) => died.scan(names, rules),
    verdict: (key, survivors, foes, at) => verdicts.decide('recovery:' + key, survivors, foes, at),
    endVerdict: key => verdicts.end('recovery:' + key),
    escaped: (names, survivors, mtypes, j, by, deaths) => escaped.escaped(names, survivors as EscapeOdds[], mtypes, j, by, deaths),
    won: kills => escaped.won(kills),
    refuses: ask => hooks.survival.refuses(ask),
    fight: () => hooks.targeting.fight(ports.group()) as FightRead | undefined,
    ...reads,
    home, atHome, members: ports.members, intent: ports.intent, inCave: ports.inCave,
    escape: names => escape.start(names), releaseEscape: () => escape.release('core:survival'),
    endWalk: () => { hooks.walks.end(ports.group(), 'death-recovery'); },
    returnToFarm: (location, names) => ports.convoy(location, 'Returning after party death', names, 'death-recovery') });
  const own = (group: string) => group === ports.group();
  registerCoordinatorSurvival(hooks, { verdicts, status,
    // A group's fight: its living members with fresh reports, and the foes they report on the party.
    fight: group => {
      const names = group.startsWith('solo:') ? [group.slice(5)] : ports.members();
      // The report age with no bound on a report stamped ahead of this clock, as this read had.
      const survivors = names.map(status).filter((s): s is VerdictMember => !!s && fresh(party.statuses[s.name]?.seenAt, ports.now(), 'report', Infinity) && !s.rip && Number(s.hp) > 0);
      const foes = new Map<string, VerdictFoe>();
      for (const s of survivors) for (const t of (party.statuses[s.name]?.groupedCombat?.threats ?? []) as VerdictFoe[]) {
        const prior = foes.get(String(t.id));
        foes.set(String(t.id), { id: String(t.id), mtype: t.mtype, hp: Math.min(Number(prior?.hp ?? Infinity), Number(t.hp)) });
      }
      return { survivors, foes: [...foes.values()] };
    },
    refuses: ask => hooks.survival.refuses(ask),
    escaping: name => escape.escaping(name),
    recovery: group => own(group) ? recovery.view() : undefined,
    // targeting's grouped snapshot runs the recovery's step on the current reports before it
    // reads the fight rule, the moment `tickDisengagement` ran it.
    recoveryStep: group => { if (!own(group)) return undefined; recovery.tick(); return recovery.view(); },
    life: name => died.life(name),
    low,
    holds: ask => survivalHolds(party, ask, ports.group(), name => escape.owns(name)),
    tasks: { death: () => recovery.task(), escape: () => escape.task() },
    step: () => survival.step() });
  // A stage change inside a step asks for one more step, which runs after the current one ends.
  let stepping = false, again = false;
  const survival = {
    // The coordinator's survival step: the escape's stage, then the recovery's phase, outside a Cave
    // run during and after it. Both read only the members' reports and their own
    // records, so a step runs when a report arrives or the escape's stage changes.
    step(): void {
      if (stepping) { again = true; return; }
      stepping = true;
      try { do { again = false; escape.step(); recovery.tick(); } while (again); } finally { stepping = false; }
    },
    start: (names: string[], by?: string) => escape.start(names, by),
    release: () => escape.release(),
    owns: (name: string) => escape.owns(name),
  };
  // The registration calls `step` on the returned module, so a step a test puts in its place
  // (coordinator-travel-runtime.test.cjs) is the one that runs.
  return survival;
}

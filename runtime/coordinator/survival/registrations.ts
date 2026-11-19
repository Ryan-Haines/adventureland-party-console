// The survival owner's registration on the coordinator:
// `core:survival` answers `survival.verdict` for a
// group's fight (the tasks owner's wind-down "finish") and for a walk through a fight (the movement owner's defended walk,
// and the tasks owner's left-out member); the party half of `survival.escaping`; `survival.recovery`,
// `survival.recoveryStep`, `survival.life` and `survival.low`; and `member.holder` for the members its death
// recovery and escape hold. The character's realm answers its own fight and the tank's
// hold (runtime/characters/survival/registrations.ts). install.ts registers it with the module in
// hand, so no core answer exists before the module and each answer closes over it.
import type { EscapeHold, MemberHold, MemberHoldAsk, RecoveryView, Refusal, Registration, SurvivalQuestion, SurvivalRefusalAsk, SurvivalVerdict } from '../../hooks/registry.ts';
import type { Verdicts, VerdictFoe, VerdictMember } from './verdict.ts';

type SurvivalTask = { owner: string; members: string[]; phase: string; label: string } | null;
export interface CoordinatorSurvival {
  verdicts: Verdicts;
  // The group's living members with fresh reports and the foes they report on it.
  fight(group: string): { survivors: VerdictMember[]; foes: VerdictFoe[] } | null;
  status(name: string): VerdictMember | undefined;
  refuses(ask: SurvivalRefusalAsk): Refusal | undefined;
  escaping(name: string): EscapeHold | undefined;
  recovery(group: string): RecoveryView | undefined;
  recoveryStep(group: string): RecoveryView | undefined;
  life(name: string): number;
  // Whether the member reads below its "HP potion below" line (install.ts `low`).
  low(name: string): boolean;
  holds(ask: MemberHoldAsk): MemberHold[];
  // The records the `death-recovery` and `escape` sources describe.
  tasks: { death(): SurvivalTask; escape(): SurvivalTask };
  // The escape's stage and the recovery's phase (install.ts `step`).
  step(): void;
}
// The `death-recovery` and `escape` sources: each
// describes the party's task from its own record (recovery.ts and escape.ts `task`), and the groups
// and tasks owner ranks it. `registerCoordinatorSurvival` publishes it with the records it reads;
// 01 asks it in its declared place (tasks/rules.ts SOURCE_ORDER).
let records: CoordinatorSurvival['tasks'] | undefined;
export const survivalTaskSources: Registration = { name: 'core:survival-tasks', folder: 'core', author: 'adventureland-party-console',
  summary: "Asks for the party's death recovery and escape while their records run.",
  hooks: { 'task.request': view => {
    if ((view as { groupKind?: string }).groupKind !== 'party' || !records) return [];
    const death = records.death(), escape = records.escape();
    return [{ slot: 'death', end: 'recovered', ask: death && { kind: 'death-recovery', ...death } },
      { slot: 'escape', end: 'escaped', ask: escape && { kind: 'escape', ...escape } }];
  } } };
interface Hooks { publish(registration: Registration): { ok: boolean; message?: string } }
// `survival.verdict` on the coordinator: a group's fight (the tasks owner's wind-down) and a walk through a fight.
function verdictOf(s: CoordinatorSurvival, question: SurvivalQuestion): SurvivalVerdict | undefined {
  if ('group' in question) {
    const fight = s.fight(question.group);
    return fight ? s.verdicts.decide('group:' + question.group, fight.survivors, fight.foes, Math.max(0, ...fight.survivors.map(m => Number(m.seenAt) || 0))).verdict : undefined;
  }
  if ('walk' in question) {
    const members = question.members.map(name => ({ name, ...s.status(name) }));
    const verdict = s.verdicts.walk(members, question.attackers as { mtype?: string; hp?: number; target?: string }[]);
    // A `fight` asks the add-ons once, and a refusal turns it into `leave`.
    return verdict === 'fight' && s.refuses({ question: 'walk', survivors: members, foes: question.attackers, verdict }) ? 'leave' : verdict;
  }
  return undefined;
}
// Publishes `core:survival` over the installed module; a second install puts its own closures in the
// one registration (the registry's `publish`).
export function registerCoordinatorSurvival(hooks: Hooks, survival: CoordinatorSurvival): CoordinatorSurvival {
  const result = hooks.publish({
    name: 'core:survival', folder: 'core', author: 'adventureland-party-console', holder: '05',
    summary: 'Judges whether the party finishes a fight or leaves it, and whether a walk stays for a fight it can win; names the escape and death recovery that hold a member.',
    hooks: {
      'survival.verdict': question => verdictOf(survival, question),
      'survival.escaping': name => survival.escaping(name),
      'survival.recovery': group => survival.recovery(group),
      'survival.recoveryStep': group => survival.recoveryStep(group),
      'survival.life': name => survival.life(name),
      'survival.low': name => survival.low(name),
      'member.holder': ask => survival.holds(ask),
      // A member's report and an escape's start or stage change are what the step reads.
      'status.received': () => survival.step(),
      'survival.escapeStarted': () => survival.step(),
      'survival.escapeStage': () => survival.step(),
    },
  });
  if (!result.ok) throw Error(`The survival owner's core:survival did not load: ${result.message}`);
  records = survival.tasks;
  const sources = hooks.publish(survivalTaskSources);
  if (!sources.ok) throw Error(`The survival owner's core:survival-tasks did not load: ${sources.message}`);
  return survival;
}

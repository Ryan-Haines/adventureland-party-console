// Owner 04's rows of the hook table: targeting. Only 04's build writes this file;
// runtime/hooks/registry.ts composes every owner's file into one `HOOKS` and one `SLOTS`.
import type { DecisionRow, PlainKind } from './row.ts';
import type { ActionRow, ReadRow } from '../registry.ts';
import type { AggroParty, CandidatesView, DispatchContext, GroupFightView, GroupView, HookRow, PassingCause, SlotRow, TargetingRuleAsk, TurnsTargetAnswer } from '../registry.ts';
import type { WalkView } from '../../protocol/records.ts';
import { rowsFor } from './row.ts';

// The targeting owner's published reads and requests: every name
// another owner's code asks of targeting, one core row each in its own shape. `core:targeting`
// answers each with the targeting module's own function (the targeting owner's V-S1a, install.ts `reads`). A row's
// fixture is its row of the unit table that checks the read reaches that function.
const READS_TABLE = 'scripts/tests/targeting-selection.test.cjs';
// `mayAsk` is the rows' `addonMayAsk`: true for a read that changes nothing, false for a row that
// writes the targeting owner's state. The character's targeting install answers every one of them.
function targetingReads<M extends boolean, T extends Record<string, readonly [fixture: string, receives: string, returns: string]>>(mayAsk: M, table: T) {
  const { read } = rowsFor('targeting (04), a published read', `${READS_TABLE}#`);
  return Object.fromEntries(Object.entries(table).map(([hook, [fixture, receives, returns]]) => [hook, read(`${hook}: ${fixture}`, receives, returns, mayAsk, 'character')])) as
    { [K in keyof T]: ReturnType<typeof read<M, 'character'>> };
}

export const HOOKS = {
  // The targeting owner's decision hooks, each answered by add-ons. `targeting.candidates` narrows
  // the eligibility check's candidates, one monster per ask; `prefers` orders the candidates of the
  // top M priority before distance; `aggroOwner` names the member that owns Taunt, Absorb and
  // Agitate, the leader when none answers; `refuses` adds a refusal to `targeting.allows` and cannot
  // allow one. The grouped queue asks `candidates` and `prefers` too (G4, rules.ts `queueNominees`),
  // once per reconcile over its planned pulls, so it never nominates a target every member refuses.
  'targeting.candidates': { kind: 'request', side: 'both', part: 'targeting (04)', answers: 'many', addonMayAsk: false, bound: 'refusal only',
    fixture: "e2e/live-targeting-hooks.spec.ts#targeting.candidates: the add-on narrows the goos to the ones it names, reading the view's party",
    receives: "the character's target candidates, the character, the entities in view, the party and the leader's nomination; on the grouped queue its planned pulls, the leader's report as the character and no entities", returns: 'the candidates it allows, or nothing' },
  'targeting.prefers': { kind: 'request', side: 'both', part: 'targeting (04)', answers: 'many', addonMayAsk: false, bound: 'an order inside one M priority',
    fixture: 'e2e/live-targeting-hooks.spec.ts#targeting.prefers: the add-on prefers the farther goo and the warrior takes it',
    receives: "the candidates of the top M priority, the character, the entities in view and the party; on the grouped queue each priority's planned pulls, the leader's report as the character and no entities", returns: 'the candidates in the order it prefers, or nothing for distance' },
  'targeting.aggroOwner': { kind: 'request', side: 'character', part: 'targeting (04)', answers: 'one', addonMayAsk: false, bound: 'a member of the party only',
    fixture: "e2e/live-targeting-hooks.spec.ts#targeting.aggroOwner: the add-on names the priest as aggro owner and the warrior's Taunt waits",
    receives: "the party's leader and members", returns: 'the member that owns Taunt, Absorb and Agitate, or nothing for the leader' },
  'targeting.refuses': { kind: 'request', side: 'character', part: 'targeting (04)', answers: 'many', addonMayAsk: false, bound: 'refusal only',
    fixture: "e2e/live-targeting-hooks.spec.ts#targeting.refuses: the add-on refuses the warrior's attack on the planted goo",
    receives: 'a monster and the skill that would go to it', returns: 'a refusal in plain words, or nothing; it cannot allow' },
  // P4: an add-on lifts a liftable table A row or the passing column's low HP share, or sets a
  // priority row's value. Table A's other rows, the Cave, the drain and the exclusive owners, are
  // never asked.
  'targeting.rule': { kind: 'request', side: 'character', part: 'targeting (04), tables A and M', answers: 'many', addonMayAsk: false,
    bound: "admit only for A1, A9, A14, A17, A20 (an external claim) and the passing low HP share; a priority from 0 to 100 for P2, P3 and P5, never above a party attacker (A25 still admits); a passing attack still needs T1's passing column",
    fixture: 'scripts/tests/hook-registry.test.cjs#P4: the add-on lifts the Graveyard exclusion and raises tinyp; the drain row still refuses',
    receives: "the row, the monster (none for the passing column), the character and core's reason or priority",
    returns: '{admit: true} for an A row or the passing column, a priority for a P row, or nothing' },
  // A published selection (E04-g, G04-1's payload): the role loop runs a pass on it.
  'targeting.changed': { kind: 'notice', side: 'character', part: 'targeting (04)', answers: 'many', 
    fixture: 'e2e/live-turns-hooks.spec.ts#targeting.changed: a new target runs a pass before the next report',
    receives: 'character, from, to, by', returns: 'nothing' },
  // The targeting owner's core questions. `core:targeting`
  // answers the target and the attack-time permission on the character, which the turns owner
  // asks, the threat fact survival's fight test asks, and the passing column the
  // coordinator's travel asks. Movement sends the retire notice.
  'targeting.target': { kind: 'request', side: 'character', part: 'targeting (04)', answers: 'one', core: true, addonMayAsk: true,
    fixture: "e2e/live-targeting-hooks.spec.ts#targeting.target: the add-on reads the warrior's target, its due flag and the threat",
    receives: "the character's turns view", returns: 'the target, whether it is passing, and whether support casts may go on it, or nothing' },
  'targeting.allows': { kind: 'request', side: 'character', part: 'targeting (04)', answers: 'one', core: true, addonMayAsk: true,
    fixture: "e2e/live-targeting-hooks.spec.ts#targeting.allows: the add-on asks whether the planted goo is allowed and reads the refusal",
    receives: 'a monster and the skill that would go to it', returns: 'nothing when allowed, or the refusal in plain words' },
  'targeting.threat': { kind: 'request', side: 'character', part: 'targeting (04)', answers: 'one', core: true, addonMayAsk: true,
    fixture: "e2e/live-targeting-hooks.spec.ts#targeting.target: the add-on reads the warrior's target, its due flag and the threat",
    receives: "the character's view", returns: "whether a monster in view targets a party member, whether a party member's target is alive in view, and the policy the fact counts" },
  'targeting.records': { kind: 'request', side: 'character', part: 'targeting (04), the targeting ring', answers: 'one', core: true, addonMayAsk: false,
    fixture: "e2e/live-status-hooks.spec.ts#table G: each leased ring posts after the report",
    receives: 'nothing', returns: "the targeting ring's records, oldest first" },
  'targeting.passing': { kind: 'request', side: 'coordinator', part: 'targeting (04), the passing column', answers: 'one', core: true, addonMayAsk: true,
    fixture: 'e2e/live-targeting-hooks.spec.ts#targeting.passing: the add-on asks whether a passing goo may interrupt a farm walk',
    receives: "a walk (its task's tier and, for a Hunt walk, its target) and the cause, passive or rare", returns: 'whether a passing monster may interrupt the walk' },
  // The grouped fight a party death recovery reads: its target's start,
  // fights and deaths, today's fields, on the coordinator.
  'targeting.fight': { kind: 'request', side: 'coordinator', part: 'targeting (04), a published read', answers: 'one', core: true, addonMayAsk: true,
    fixture: "scripts/tests/combat-disengagement.test.cjs#targeting.fight: the read names the grouped fight's start, fights and typed deaths",
    receives: 'a group', returns: "the grouped fight's target start, fights and death tombstones with their monster type, or nothing" },
  'targeting.unreachable': { kind: 'notice', side: 'character', part: 'targeting (04)', answers: 'many', 
    fixture: "e2e/live-targeting-hooks.spec.ts#targeting.unreachable: movement's notice reaches the add-on",
    receives: 'character, target, why', returns: 'nothing' },
  // The targeting owner's notices: each ring record on the character,
  // and the queue's nominations, fight states and successor grants on the coordinator.
  'targeting.refused': { kind: 'notice', side: 'character', part: 'targeting (04)', answers: 'many', 
    fixture: 'e2e/live-targeting-hooks.spec.ts#targeting.refused: the planted refusal sends one refused notice',
    receives: "character, target, skill, row (the G check, with A's row when A refused), why; by the refusing add-on or 'core:targeting'", returns: 'nothing' },
  'targeting.skipped': { kind: 'notice', side: 'character', part: 'targeting (04)', answers: 'many', 
    fixture: "e2e/live-targeting-hooks.spec.ts#targeting.skipped: the priest's covered goo is skipped once",
    receives: 'character, target, damage in flight, HP, why', returns: 'nothing' },
  'targeting.retired': { kind: 'notice', side: 'character', part: 'targeting (04)', answers: 'many', 
    fixture: 'e2e/live-targeting-hooks.spec.ts#targeting.retired: the walled goo is retired once',
    receives: "character, target, why; by 'core:targeting'", returns: 'nothing' },
  'targeting.cleared': { kind: 'notice', side: 'character', part: 'targeting (04)', answers: 'many', 
    fixture: "e2e/live-targeting-hooks.spec.ts#targeting.cleared: the next fight's start clears the walled goo's mark",
    receives: "character, why; the set-aside list cleared at a fight's start", returns: 'nothing' },
  'targeting.nominated': { kind: 'notice', side: 'coordinator', part: 'targeting (04)', answers: 'many', 
    fixture: 'e2e/live-targeting-hooks.spec.ts#targeting.nominated: each group nomination of the window has one notice',
    receives: 'group, target, revision; by the nominating member', returns: 'nothing' },
  'targeting.fightState': { kind: 'notice', side: 'coordinator', part: 'targeting (04)', answers: 'many', 
    fixture: "e2e/live-targeting-hooks.spec.ts#targeting.fightState: the killed goo's fight goes engaged then retired",
    receives: 'group, target, from, to (planned, engaged, retired, lost or reset), reason', returns: 'nothing' },
  'targeting.granted': { kind: 'notice', side: 'coordinator', part: 'targeting (04)', answers: 'many', 
    fixture: 'scripts/tests/successor-handoff.test.cjs#targeting.granted, targeting.revoked: the grant is issued, then revoked when the budget runs out',
    receives: 'group, predecessor, successor, reason', returns: 'nothing' },
  'targeting.revoked': { kind: 'notice', side: 'coordinator', part: 'targeting (04)', answers: 'many', 
    fixture: 'scripts/tests/successor-handoff.test.cjs#targeting.granted, targeting.revoked: the grant is issued, then revoked when the budget runs out',
    receives: 'group, predecessor, successor, reason', returns: 'nothing' },
  // Every selection pass's end, the change or not: movement's follow
  // listens for one with no target.
  'targeting.passed': { kind: 'notice', side: 'character', part: 'targeting (04)', answers: 'many', 
    fixture: 'e2e/live-targeting-hooks.spec.ts#targeting.passed: each selection pass of the window sends one passed notice, with none while no goo is in view',
    receives: "character, target or none, S's row", returns: 'nothing' },
  // The published reads and the follow.
  ...targetingReads(true, {
    'targeting.partyAttacker': ['answers as getNearestPartyAttacker did', 'nothing', 'the nearest monster attacking a party member, or null'],
    'targeting.partyTarget': ['answers as getNearestPartyTarget did', 'nothing', "the nearest party member's live target, or null"],
    'targeting.engagedMonster': ['answers as engagedMonster did', 'nothing', 'the monster this character is engaged with, or null'],
    'targeting.focusedInRadius': ['answers as visibleFocusedMonsterWithinRadius did', 'nothing', 'a visible focus monster inside the search radius, or null'],
    'targeting.dungeonTarget': ['answers as getDungeonTarget did', 'nothing', "the Cave's target, or null"],
    'targeting.eventTarget': ['answers as nearestEventTarget did', 'nothing', 'the nearest event target, or null'],
    'targeting.returnDefenseTarget': ['answers as returnDefenseTarget did', 'nothing', "the event return's defense target, or null"],
    'targeting.rareTarget': ['answers as rareTarget did', 'nothing', 'the rare this character fights, or null'],
    'targeting.passingTarget': ['answers as passingTarget did', 'nothing', 'the passing monster travel stops for, or null'],
    'targeting.defensiveTarget': ['answers as groupedDefensiveTarget did', 'nothing', "the grouped queue's defensive target, or null"],
    'targeting.activeTarget': ['answers as activeCombatTarget did', 'nothing', "the grouped queue's active target, or null"],
    'targeting.allowed': ['answers as isAllowedTarget did', 'a target, whether travel meets it, and a diagnostic label', 'whether the target may be fought'],
    'targeting.pullOnly': ['answers as rules.ts pullOnly does (TRN-Q-DPS)', 'a target and the asking skill', 'whether table A refuses it only at A28 or A29, the rows that decide a new pull, while it targets nobody'],
    'targeting.claimed': ['answers as isExternallyClaimedMonster did', 'a target', "whether another party's queue claims it"],
    'targeting.attacking': ['answers as isAttackingPartyMember did', 'a target', 'whether it attacks a party member'],
    'targeting.priority': ['answers as monsterPriority did', 'a target', 'its priority'],
    'targeting.lockAllows': ['answers as leaderLockAllows did', 'a target', "whether the leader's lock allows it"],
    'targeting.partyTargetIs': ['answers as isCurrentPartyTarget did', 'a target', "whether it is the party's current target"],
    'targeting.returnAttacker': ['answers as returnAttacker did', 'a target', 'whether it attacks the event return'],
    'targeting.groupReady': ['answers as groupedAttackAllowed did', 'a target', 'whether the group is ready to attack it'],
    'targeting.rareAllows': ['answers as rareAttackAllowed did', 'a target and a skill', 'whether the rare rules allow the skill on it'],
    'targeting.committedEncounter': ['answers as committedHuntEncounter did', 'a target', 'whether it is the committed Hunt encounter'],
    'targeting.passingEncounter': ['answers as isPassingEncounter did', 'a target', 'whether it is a passing encounter'],
    'targeting.levelAllows': ['answers as passiveLevelAllowed did', 'a target', 'whether its level allows a passing fight'],
    'targeting.passiveStop': ['answers as passiveStopRequired did', 'a target', 'whether travel stops for it'],
    'targeting.departureEngaged': ['answers as departureTargetEngaged did', 'a target', 'whether the departure fight holds it'],
    'targeting.dungeonAllows': ['answers as dungeonTargetAllowed did', 'a target', 'whether the Cave allows it'],
    'targeting.frankyAllows': ['answers as frankyTargetAllowed did', 'a target', "whether Franky's fight allows it"],
    'targeting.drainAllows': ['answers as consoleDrainAllows did', 'a target', "whether the console's drain allows it"],
    'targeting.graveyardAreaAllows': ['answers as graveyardAreaAttackAllowed did', 'a range', 'whether the Graveyard area allows a hit at that range'],
    'targeting.passingKey': ['answers as passingKey did', 'a target and a realm', 'its passing key'],
    'targeting.returnActive': ['answers as returnCombatActive did', 'nothing', "whether the event return's fight is active"],
    'targeting.unfinished': ['answers as unfinishedFight did', 'nothing', 'whether a fight is unfinished'],
    'targeting.drainCombat': ['answers as consoleDrainCombatActive did', 'nothing', "whether the console's drain fight is active"],
    'targeting.departurePending': ['answers as departureCombatPending did', 'nothing', 'whether a departure fight is pending'],
    'targeting.anchorVisible': ['answers as groupedAnchorVisible did', 'nothing', 'whether the grouped anchor is in view'],
    'targeting.report': ['answers as queueReport did', 'nothing', "the grouped queue's report"],
    'targeting.acknowledgement': ['answers as groupedAcknowledgement did', 'nothing', "the grouped queue's acknowledgement"],
    'targeting.entityReport': ['answers as groupedEntityReport did', 'an entity', "the entity's report for the queue"],
    'targeting.passingReport': ['answers as passingEncounterReport did', 'nothing', "the passing encounter's report"],
  }),
  ...targetingReads(false, {
    'targeting.publishSelection': ['answers as publishCombatSelection did', 'a target and whether to clear', 'nothing; it publishes the selection'],
    'targeting.beginPassing': ['answers as beginPassingAttack did', 'a target, its admission and whether it only reserves', 'whether the passing attack began'],
    'targeting.acceptQueue': ['answers as acceptQueue did', 'the next grouped queue', 'nothing; it takes the queue'],
    'targeting.acceptControl': ['answers as acceptCombatControl did', 'the combat control state', 'nothing; it takes the control'],
    'targeting.cancelReturnTown': ['answers as cancelReturnTownUnderAttack did', 'nothing', "nothing; it cancels the event return's Town under attack"],
  }),
  ...targetingReads(true, {
    'targeting.queue': ["answers today's groupedCombat, the same object", 'nothing', 'the grouped queue state as the last reply delivered it, read at the call'],
    'targeting.selection': ["answers today's selection variables, read at the call", 'nothing',
      'targetId, selection, leaderTarget, partyTargets, partyThreats, scatterBreakTarget and lastAttack {target, at}'],
  }),
  ...targetingReads(false, {
    'targeting.setTargetId': ["writes combatTargetId as today's bare write", 'an id and who sets it', 'nothing'],
    'targeting.noteAttack': ['writes lastAttackTarget and lastAttackAt', 'a target, the time and who notes it', 'nothing'],
    'targeting.receive': ["writes the reply's fields it carries, the queue through acceptQueue", "the reply's targeting fields", 'nothing'],
  }),
  // The coordinator's view of a group's queue (row 33's `lost`), for
  // 07's rare client: read from the group's queue ledger (runtime/coordinator/targeting/install.ts).
  'targeting.groupView': { kind: 'request', side: 'coordinator', part: 'targeting (04), a published read', answers: 'one', core: true, addonMayAsk: true,
    fixture: 'scripts/tests/combat-queue.test.cjs#targeting.groupView: the read names the queue ledger facts and its lost targets',
    receives: 'a group', returns: "the queue's selected, queued, locked, engaged, killed and claimed targets, its revision, the members that acknowledged it, its lost targets with when and why, and when it was evaluated" },
} as const satisfies Record<string, HookRow>;

export const SLOTS = {} as const satisfies Record<string, SlotRow>;

// The registry's dispatch of the targeting owner's rows.
// P4's rows: the table A rows an add-on may lift, the passing column, and the priority rows it may set.
const LIFTABLE = new Set(['A1', 'A9', 'A14', 'A17', 'A20', 'passing']);
const PRIORITY_ROWS = new Set(['P2', 'P3', 'P5']);
export function dispatch(ctx: DispatchContext) {
  return {
    // The questions with one core answer (section 6). With no answer, `allows` refuses nothing, as
    // the console behaves with no targeting owner; `core:targeting` answers both on a character
    //.
    turns: {
      target: (view: unknown): TurnsTargetAnswer | undefined => ctx.answering('targeting.target')[0]?.hooks['targeting.target']!(view),
      allows: (monster: unknown, skill: string): string | undefined => ctx.answering('targeting.allows')[0]?.hooks['targeting.allows']!(monster, skill),
    },
    // The targeting owner's add-on hooks. With none registered,
    // the candidates come back unchanged, the leader owns aggro, and no refusal is added.
    targeting: {
      // True while an enabled add-on answers `targeting.candidates`. Table A builds the ask's view
      // only then, since it asks once per monster a finder weighs.
      narrows: (): boolean => ctx.answering('targeting.candidates').length > 0,
      // Each enabled answer once per ask. shared.js `isAllowedTarget` asks once per monster in every
      // eligibility check, so an answer runs for each monster a finder weighs. A list
      // keeps only the candidates it names, and an answer of nothing keeps them all. An answer that
      // throws keeps them all, and the registry keeps its error.
      candidates<T>(view: CandidatesView<T>): readonly T[] {
        let kept = view.candidates;
        for (const r of ctx.answering('targeting.candidates')) {
          const answer = ctx.call(r, 'targeting.candidates', () => r.hooks['targeting.candidates']!(kept === view.candidates ? view : { ...view, candidates: kept }, ctx.settings(r.name)));
          if (Array.isArray(answer)) kept = kept.filter(c => answer.includes(c));
        }
        return kept;
      },
      // The candidates of one M priority in the order the add-ons prefer, the first
      // registration's order ranking first. A candidate an answer leaves out keeps its place after the
      // ones it names. With none registered the order is the one handed in.
      prefers<T>(view: CandidatesView<T>): readonly T[] {
        let ordered = view.candidates;
        for (const r of [...ctx.answering('targeting.prefers')].reverse()) {
          const answer = ctx.call(r, 'targeting.prefers', () => r.hooks['targeting.prefers']!({ ...view, candidates: ordered }, ctx.settings(r.name)));
          if (!Array.isArray(answer)) continue;
          const named = answer as unknown[];
          const rank = (c: T) => { const i = named.indexOf(c); return i < 0 ? named.length : i; };
          ordered = [...ordered].sort((a, b) => rank(a) - rank(b));
        }
        return ordered;
      },
      // True while an enabled add-on answers `targeting.prefers`; the finder builds the view only then.
      orders: (): boolean => ctx.answering('targeting.prefers').length > 0,
      // The grouped fight read, answered by `core:targeting` on the coordinator; with no
      // grouped fight there is none.
      fight: (group: string): GroupFightView | undefined => ctx.answering('targeting.fight')[0]?.hooks['targeting.fight']!(group),
      // The group's queue ledger, answered by `core:targeting` on the coordinator;
      // with no grouped fight there is none.
      groupView: (ask: { group: string }): GroupView | undefined => ctx.answering('targeting.groupView')[0]?.hooks['targeting.groupView']!(ask),
      // The passing column. A missing answer would change which travel a passing
      // monster interrupts, so the ask fails without one.
      passing(walk: WalkView, cause: PassingCause): boolean {
        return ctx.one('targeting.passing').hooks['targeting.passing']!(walk, cause) === true;
      },
      // A name outside the party counts as no answer, so the leader keeps aggro.
      aggroOwner(party: AggroParty): string | undefined {
        const r = ctx.answering('targeting.aggroOwner')[0];
        const owner = r && ctx.call(r, 'targeting.aggroOwner', () => r.hooks['targeting.aggroOwner']!(party, ctx.settings(r.name)));
        return typeof owner === 'string' && party.members.some(m => m.name === owner) ? owner : undefined;
      },
      // P4: true while an enabled add-on answers `targeting.rule`; table A and M ask only then.
      rules: (): boolean => ctx.answering('targeting.rule').length > 0,
      // A liftable row is lifted when any enabled add-on admits it.
      admits(ask: TargetingRuleAsk): boolean {
        if (!LIFTABLE.has(ask.row)) return false;
        return ctx.answers('targeting.rule', r => r.hooks['targeting.rule']!(ask, ctx.settings(r.name)))
          .some(({ answer }) => typeof answer === 'object' && answer?.admit === true);
      },
      // The first add-on priority in load order for P2, P3 or P5, held to 0 to 100; else core's.
      priority(ask: TargetingRuleAsk & { core: number }): number {
        if (!PRIORITY_ROWS.has(ask.row)) return ask.core;
        const answer = ctx.answers('targeting.rule', r => r.hooks['targeting.rule']!(ask, ctx.settings(r.name)))
          .map(({ answer }) => answer).find((a): a is number => typeof a === 'number' && Number.isFinite(a));
        return answer === undefined ? ask.core : Math.min(100, Math.max(0, answer));
      },
      // The first refusal, named by its add-on. An answer that throws refuses nothing.
      refuses(monster: unknown, skill: string): string | undefined {
        return ctx.refusal('targeting.refuses', r => r.hooks['targeting.refuses']!(monster, skill, ctx.settings(r.name)));
      },
    },
  };
}

// The hook coverage (addon:check rule 8):
// each decision of the files below with its hook or core-only reason, and each other export's plain kind.
export const RULE_FILES = ['runtime/characters/targeting/rules.ts'] as const;
export const DECISIONS = {
  'allow rows A1 to A20': { at: 'runtime/characters/targeting/rules.ts#createRules', hook: 'targeting.rule' },
  'an add-on refuses a target (A21)': { at: 'runtime/characters/targeting/rules.ts#createRules', hook: 'targeting.candidates' },
  'an add-on refuses a character\'s attack': { at: 'runtime/characters/targeting/rules.ts#createRules', hook: 'targeting.refuses' },
  'membership rows M1 to M10': { at: 'runtime/characters/targeting/rules.ts#createRules', hook: 'targeting.candidates' },
  'priority values P1 to P5': { at: 'runtime/characters/targeting/rules.ts#createRules', hook: 'targeting.rule' },
  'the saved priorities P1 and P4': { site: 'runtime/hunting/coordinator/modes.ts:206', hook: 'settings.overlay' },
  'order inside one priority': { site: 'runtime/characters/targeting/selection.ts:124', hook: 'targeting.prefers' },
  'target source order S1 to S9': { at: 'runtime/characters/targeting/rules.ts#createRules', core: 'tier-table', cite: 'runtime/protocol/ranks.ts:12; add-on targets come through target.mode' },
  'the grouped queue\'s nominees': { at: 'runtime/characters/targeting/rules.ts#queueNominees', hook: 'targeting.candidates' },
  'the grouped queue\'s order inside one priority': { at: 'runtime/characters/targeting/rules.ts#queueNominees', hook: 'targeting.prefers' },
  'who owns Taunt, Absorb and Agitate': { site: 'runtime/hooks/rows/04-targeting.ts:226', hook: 'targeting.aggroOwner' },
  'passing attack (low HP share)': { site: 'runtime/characters/targeting/passing.ts:139', hook: 'targeting.rule' },
} satisfies Record<string, DecisionRow>;
export const PLAIN = {
  targetIdentity: 'read', nearerFirst: 'read',
} satisfies Record<string, PlainKind>;

// C1's game actions (addon-capabilities.md "The table by owner"): the targeting owner's selection sends the target,
// and an add-on picks through `targeting.prefers` and `target.mode`; the entity refresh costs 12
// calls, and C3's reads give its copy.
export const ACTIONS = {
  target: { events: ['target'], functions: ['change_target'], closed: 'FW', cite: "runtime/characters/targeting/selection.ts: 04's selection; an add-on picks through targeting.prefers and target.mode" },
  sendUpdates: { events: ['send_updates'], functions: [], closed: 'CL', cite: 'runtime/characters/call-budget.ts: send_updates costs 12 calls; 04 keeps the entity view fresh' },
} as const satisfies Record<string, ActionRow>;

// C3's reads (addon-capabilities.md "The completeness rule"): each export of targeting's two doors
// and each PLAIN read, with the side that holds it.
const CHARACTER_DOOR = 'runtime/characters/targeting/api.ts', COORDINATOR_DOOR = 'runtime/coordinator/targeting/api.ts';
export const READS = {
  'members.view': { side: 'both', type: 'MemberView', door: 'runtime/protocol/reports.ts#memberView' },
  'targeting.passiveStopRequired': { side: 'both', type: 'boolean', door: `${CHARACTER_DOOR}#passiveStopRequired` },
  'targeting.huntSwitchAllows': { side: 'both', type: 'boolean', door: `${CHARACTER_DOOR}#huntSwitchAllows` },
  'targeting.passingIdentity': { side: 'both', type: 'string', door: `${CHARACTER_DOOR}#passingIdentity` },
  'targeting.collectPassing': { side: 'both', type: 'PassingEncounter[]', door: `${CHARACTER_DOOR}#collectPassing` },
  'targeting.monsterPriority': { side: 'both', type: 'the saved priority table', door: `${CHARACTER_DOOR}#MONSTER_PRIORITY` },
  'targeting.validPriorities': { side: 'both', type: 'boolean', door: `${CHARACTER_DOOR}#validMonsterPriorities` },
  'targeting.attackDamageType': { side: 'character', type: 'DamageType | undefined', door: `${CHARACTER_DOOR}#effectiveAttackDamageType` },
  'targeting.passingStatus': { side: 'coordinator', type: "the passing encounters' status", door: `${COORDINATOR_DOOR}#createPassingStatus` },
  'targeting.uniqueReferences': { side: 'coordinator', type: 'Target[]', door: `${COORDINATOR_DOOR}#uniqueReferences` },
  'targeting.targetIdentity': { side: 'both', type: 'string', door: `${COORDINATOR_DOOR}#targetIdentity` },
  'targeting.nearerFirst': { side: 'both', type: 'number', door: 'runtime/characters/targeting/rules.ts#nearerFirst' },
} as const satisfies Record<string, ReadRow>;
// The door exports that are no read: the installs, the grouped queue's steps and the composition
// root's ports.
export const DOOR_ONLY = {
  'runtime/characters/targeting/api.ts#installPorcupineEquipment': { kind: 'port', cite: "the role runner's install" },
  'runtime/characters/targeting/api.ts#installTargeting': { kind: 'port', cite: "the role runner's install" },
  'runtime/characters/targeting/api.ts#installQueueClient': { kind: 'port', cite: "the role runner's install" },
  'runtime/characters/targeting/api.ts#createCrabRangeRecovery': { kind: 'port', cite: "the role runner's install" },
  'runtime/coordinator/targeting/api.ts#updateHuntTravel': { kind: 'command', cite: "reconciles one walk's Hunt travel encounter" },
  'runtime/coordinator/targeting/api.ts#evaluateGroup': { kind: 'command', cite: "evaluates a group's queue; 13's start loads it" },
  'runtime/coordinator/targeting/api.ts#coordinatorGroupedSnapshot': { kind: 'command', cite: "steps the scope's grouped queue" },
  'runtime/coordinator/targeting/api.ts#installEventBoundary': { kind: 'port', cite: "13's composition root" },
  'runtime/coordinator/targeting/api.ts#installCoordinatorTargeting': { kind: 'port', cite: "13's composition root" },
} as const satisfies Record<string, { kind: 'write' | 'port' | 'command'; cite: string }>;

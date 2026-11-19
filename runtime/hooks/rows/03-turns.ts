// Owner 03's rows of the hook table: turns and cooldowns. Only 03's build writes this file;
// runtime/hooks/registry.ts composes every owner's file into one `HOOKS` and one `SLOTS`.
import type { DecisionRow, PlainKind } from './row.ts';
import type { ActionRow, ReadRow } from '../registry.ts';
import type { DispatchContext, HookRow, RoutineView, SkillsAllowsAsk, SkillsHold, SlotRow, SpendAsk } from '../registry.ts';

export const HOOKS = {
  // The turns owner's surface. Each requester of `skills.request` declares the highest spend rank it
  // asks at, and an add-on's is at most `ADDON_SPEND_CAP`; the turns owner asks every registration
  // once per pass and sends each cooldown family's highest request. The core-only points
  // each cite a reason of the add-on owner's 0.4 list. The send is a game call. The spend table's Pause and Manual rows are the
  // player's own commands. Survival's hold and the `survival` rank decide survival. The rows that read
  // events, items, lifecycle, the Cave and the Hunt are decided by owners 06, 10, 13 and 07. The MP table's MP
  // rule, the family table and the edge are fixed by game data.
  'skills.request': { kind: 'request', side: 'character', part: 'turns and cooldowns (03)', answers: 'many', addonMayAsk: false,
    bound: "rank: its requester's rank, at most task for an add-on",
    fixture: 'e2e/live-turns-hooks.spec.ts#skills.request: the add-on asks Charge at task when its target is out of range',
    receives: "the character's turns view on each pass: the character and its target", returns: 'a spend request at a rank, or nothing' },
  // P13: the combat routine slot's question. The character's picked entry answers in place of the
  // built-in attack, offense and buffs; the spend table's holds, survival's heals, potions and Absorb stay core and
  // ask first, and each ask still meets the executor's whole refusal, the cooldowns, the call band
  // and the lost-reply margin.
  'turns.routine': { kind: 'request', side: 'character', part: 'turns and cooldowns (03), the combat routine slot', answers: 'one', addonMayAsk: false,
    bound: "rank at most task; each ask passes the executor's refusal (Combat off, the unlock, 04's target rules, skills.refuses, the server-refused hold, the MP rule), then the family's rank, its cooldown, the call band and the lost-reply margin; an entry that lists the character's class lifts H9 and H10 for it; an answer that throws or breaks the shape runs the built-in routine",
    fixture: 'scripts/tests/hook-registry.test.cjs#P13: the warrior on the fixture routine casts its Charge then attacks; the priest beside it heals on the built-in',
    receives: "the picked entry, the character's class, the pass's turns view and each skill's readiness",
    returns: 'a list of spend asks {skill, targets, argument, rank, category, reason, belowReserve?}, or an empty list to spend nothing this pass' },
  // The spend table's add-on step: refusal only, asked once per request below `survival` after the core rows.
  'skills.refuses': { kind: 'request', side: 'character', part: 'turns and cooldowns (03)', answers: 'many', addonMayAsk: false, bound: 'refusal only, below survival',
    fixture: "e2e/live-turns-hooks.spec.ts#skills.refuses: the add-on refuses the warrior's damage casts while it holds a pull",
    receives: 'the request: skill, family, rank, category and targets', returns: 'a refusal in plain words, or nothing; it cannot allow' },
  'skills.ready': { kind: 'request', side: 'character', part: 'turns and cooldowns (03)', answers: 'one', core: true, addonMayAsk: true,
    fixture: "e2e/live-turns-hooks.spec.ts#skills.ready: the add-on reads the potion family's readiness and cost",
    receives: 'a skill and the member it would go to', returns: 'whether its family is ready, a spend in flight with its target, its cost, the reserve and the lost-reply margin' },
  // The turns owner's damage in flight: the projectile tracker's sum on a target, the
  // attacker's own hits only when it names one. Targeting's overkill skip asks it.
  'skills.incoming': { kind: 'request', side: 'character', part: 'turns and cooldowns (03)', answers: 'one', core: true, addonMayAsk: true,
    fixture: "e2e/live-turns-hooks.spec.ts#skills.incoming: the add-on reads the priest's own damage in flight on its target",
    receives: 'a target and the attacker', returns: "the attacker's damage in flight on the target" },
  // The spend table, who may spend now: one copy, which the pass and every other reader ask.
  'skills.allows': { kind: 'request', side: 'character', part: 'turns and cooldowns (03), T1', answers: 'one', core: true, addonMayAsk: true,
    fixture: 'e2e/live-turns-hooks.spec.ts#skills.allows: on Manual with Combat off the add-on reads the H4 row',
    receives: 'a rank, the passing flag, and `occupied` to read only the occupied rows', returns: "nothing when allowed, or T1's row and its source" },
  'skills.pullSafe': { kind: 'request', side: 'character', part: 'turns and cooldowns (03), the danger model', answers: 'one', core: true, addonMayAsk: true,
    fixture: "scripts/tests/hook-registry.test.cjs#skills.pullSafe: the pull check answers as the skill runtime's pullSafe did",
    receives: 'a character and a target', returns: 'true, or the danger it names' },
  // TRN-Q-DPS DPS-3, DPS-4: what the character's status report carries for the other members'
  // rankings. 12's report asks it; the party reply hands it to every member.
  'skills.report': { kind: 'request', side: 'character', part: 'turns and cooldowns (03), the ranking', answers: 'one', core: true, addonMayAsk: true,
    fixture: "scripts/tests/class-skills.test.cjs#TRN-Q-DPS ranking: a coming Energize: the ally's report of an Energize set on the character lets Mana Burst go",
    receives: 'nothing', returns: "the ranking's damage per MP and each speed support cast's ready time, target and MP" },
  'skills.records': { kind: 'request', side: 'character', part: 'turns and cooldowns (03), the turns ring', answers: 'one', core: true, addonMayAsk: false,
    fixture: "e2e/live-status-hooks.spec.ts#table G: each leased ring posts after the report",
    receives: 'nothing', returns: "the turns ring's records, oldest first" },
  'skills.sent': { kind: 'notice', side: 'character', part: 'turns and cooldowns (03)', answers: 'many', 
    fixture: 'e2e/live-turns-hooks.spec.ts#skills.sent: every accepted attack of the window has one sent notice',
    receives: "character, skill, family, targets, rank, edge, by; the basic attack's context", returns: 'nothing' },
  'skills.settled': { kind: 'notice', side: 'character', part: 'turns and cooldowns (03)', answers: 'many', 
    fixture: 'e2e/live-turns-hooks.spec.ts#skills.settled: the dropped reply settles lost after its cooldown and the margin',
    receives: "character, skill, family, outcome ('accepted', 'rejected', 'lost' or 'stale'), reason, ms, roundTrip, by; the basic attack's context, sentAt and reply", returns: 'nothing' },
  'skills.dropped': { kind: 'notice', side: 'character', part: 'turns and cooldowns (03)', answers: 'many', 
    fixture: "e2e/live-turns-hooks.spec.ts#skills.dropped: at the plant the priest's attack is dropped, outranked by the heal",
    receives: "character, skill, family, rank, reason, by; on each change of reason per requester and family; the attack source's skip names its selection", returns: 'nothing' },
  'skills.waiting': { kind: 'notice', side: 'character', part: 'turns and cooldowns (03)', answers: 'many', 
    fixture: 'e2e/live-turns-hooks.spec.ts#skills.waiting: an attack waits on the planted call figure, then goes',
    receives: 'character, family, skill, since, by', returns: 'nothing' },
  'skills.readied': { kind: 'notice', side: 'character', part: 'turns and cooldowns (03)', answers: 'many', 
    fixture: 'e2e/live-turns-hooks.spec.ts#skills.readied: the potion family readies after its 2000 ms',
    receives: "character, family, by 'core:turns'", returns: 'nothing' },
  'skills.held': { kind: 'notice', side: 'character', part: 'turns and cooldowns (03), T1', answers: 'many', 
    fixture: 'scripts/tests/turns-executor.test.cjs#skills.held: the A/B pending row holds and releases',
    receives: "character, row, source, by (the row's owner)", returns: 'nothing' },
  'skills.released': { kind: 'notice', side: 'character', part: 'turns and cooldowns (03), T1', answers: 'many', 
    fixture: "e2e/live-turns-hooks.spec.ts#skills.released: Manual's Combat off holds every family but the potion, then releases",
    receives: "character, row, source, by (the row's owner)", returns: 'nothing' },
  'skills.shot': { kind: 'notice', side: 'character', part: 'turns and cooldowns (03), the projectile tracker', answers: 'many', 
    fixture: 'e2e/live-turns-hooks.spec.ts#skills.shot: each own hit the server records is shot and lands once',
    receives: "character, projectile, target, damage, by 'core:turns'", returns: 'nothing' },
  'skills.landed': { kind: 'notice', side: 'character', part: 'turns and cooldowns (03), the projectile tracker', answers: 'many', 
    fixture: 'e2e/live-turns-hooks.spec.ts#skills.landed: each own hit the server records lands once',
    receives: "character, projectile, target, damage, attacker, kill, miss, by 'core:turns'", returns: 'nothing' },
  'skills.passed': { kind: 'notice', side: 'character', part: 'turns and cooldowns (03), the role loop', answers: 'many', 
    fixture: "e2e/live-turns-hooks.spec.ts#skills.passed: the fixture add-on's listener runs once per role loop pass",
    receives: "character, kind, by 'core:turns'", returns: 'nothing' },
} as const satisfies Record<string, HookRow>;

export const SLOTS = {
  'combat-routine': { owner: '03', data: "{entry, label, classes} on the turns.routine registration; the character's pick is saved in `routines` under its character and slot", section: false,
    fixture: 'scripts/tests/hook-registry.test.cjs#P13: the warrior on the fixture routine casts its Charge then attacks; the priest beside it heals on the built-in',
    bound: 'the built-in entry is listed first and never hidden; the picker shows only when an enabled add-on adds an entry for the class' },
} as const satisfies Record<string, SlotRow>;

// The registry's dispatch of the turns owner's rows: the turns owner's published reads, each with its rule
// for a missing answer.
export function dispatch(ctx: DispatchContext) {
  // P13: the enabled add-on that fills the picked combat routine entry for this class, or nothing.
  function serving(entry: unknown, ctype: string) {
    const holder = typeof entry === 'string' ? ctx.slotHolder('combat-routine:' + entry) : undefined;
    const r = holder && ctx.registration(holder.name);
    if (!r || r.folder !== 'addons' || !ctx.enabled(r.name) || !r.hooks['turns.routine']) return undefined;
    const classes = r.slots?.find(m => m.slot === 'combat-routine' && m.mode === entry)?.classes;
    return !classes || classes.includes(ctype) ? r : undefined;
  }
  return {
    turns: {
      ready: (skill: string, member?: string): unknown => ctx.answering('skills.ready')[0]?.hooks['skills.ready']!(skill, member),
      // The damage in flight on a target; with no answer nothing is in flight.
      // P13: the asks of the character's picked combat routine entry, or nothing for the built-in
      // routine. An entry no enabled add-on fills, or one that does not list the class, runs the
      // built-in; so does an answer that throws or breaks the shape, whose error is recorded. An
      // answer of nothing spends nothing this pass.
      routine(ask: RoutineView): readonly SpendAsk[] | undefined {
        const r = serving(ask.entry, ask.ctype);
        if (!r) return undefined;
        let threw = false;
        const answer = ctx.call(r, 'turns.routine', () => { try { return r.hooks['turns.routine']!(ask, ctx.settings(r.name)); } catch (error) { threw = true; throw error; } });
        if (threw) return undefined;
        if (answer === undefined) return [];
        const shaped = Array.isArray(answer) && answer.every(a => typeof a === 'object' && a !== null && typeof a.skill === 'string' && typeof a.rank === 'string' &&
          typeof a.reason === 'string' && ['survival', 'maintenance', 'damage'].includes(a.category));
        if (!shaped) { ctx.record(r.name, 'turns.routine', 'an answer that is not a list of spend asks'); return undefined; }
        return answer;
      },
      // True when the picked entry is an enabled add-on's that serves the class: the spend table's H9 and H10 lift.
      routineServes: (entry: unknown, ctype: string): boolean => !!serving(entry, ctype),
      incoming: (target: unknown, attacker?: string): number => ctx.answering('skills.incoming')[0]?.hooks['skills.incoming']!(target, attacker) ?? 0,
    },
    // The turns owner's published reads. `core:turns` answers each on a
    // character; the pull check fails with no answer, and an add-on's refusal adds to the spend table's rows,
    // never allows. Before the role runner installs the turns owner, which shared.js's first status
    // report precedes, the spend table's H1 holds: the role runner is not running, so nothing spends, and no
    // occupied row is read.
    skills: {
      allows(ask: SkillsAllowsAsk): SkillsHold | undefined {
        const r = ctx.answering('skills.allows')[0];
        if (!r) return ask.occupied ? undefined : { row: 'H1', source: '03, the role runner is not installed' };
        return r.hooks['skills.allows']!(ask);
      },
      pullSafe(character: string, target: unknown): true | string {
        return ctx.one('skills.pullSafe').hooks['skills.pullSafe']!(character, target);
      },
      // The character's turns report for 12's status report (TRN-Q-DPS). The first report comes
      // before the role runner installs `core:turns`, so it carries none.
      report(): unknown {
        return ctx.answering('skills.report')[0]?.hooks['skills.report']!();
      },
      refuses(ask: SpendAsk & { family: string }): string | undefined {
        return ctx.refusal('skills.refuses', r => r.hooks['skills.refuses']!(ask, ctx.settings(r.name)));
      },
    },
  };
}

// The hook coverage (addon:check rule 8):
// each decision of the files below with its hook or core-only reason, and each other export's plain kind.
export const RULE_FILES = ['runtime/characters/turns/rules.ts'] as const;
export const DECISIONS = {
  'which spends a character asks': { site: 'runtime/hooks/rows/03-turns.ts:13', hook: 'skills.request' },
  'an occupied character refuses a spend': { at: 'runtime/characters/turns/rules.ts#refuses', hook: 'skills.refuses' },
  'the occupied rows': { at: 'runtime/characters/turns/rules.ts#occupiedRows', core: 'game', cite: 'runtime/characters/turns/rules.ts:19' },
  'a character\'s hold on spends': { at: 'runtime/characters/turns/rules.ts#hold', hook: 'turns.routine' },
  'MP reserve refusal': { at: 'runtime/characters/turns/rules.ts#mpRefusal', hook: 'turns.routine' },
  'the combat routine a character runs': { site: 'runtime/characters/turns/sources.ts:30', hook: 'turns.routine' },
  'whether the priest attacks': { at: 'runtime/characters/turns/rules.ts#priestAttacks', hook: 'skills.request' },
  'the priest\'s attack refused by an add-on': { at: 'runtime/characters/turns/rules.ts#priestAttacks', hook: 'skills.refuses' },
  'an add-on\'s spend action passes T1': { at: 'runtime/characters/turns/rules.ts#actionHold', core: 'safety', cite: 'runtime/characters/turns/rules.ts:135, H1, H2, H4, H6 to H8 and the occupied rows still hold' },
  'an emote needs an emote skill and its unlocked look': { at: 'runtime/characters/turns/rules.ts#emoteRefusal', core: 'game', cite: "runtime/characters/turns/rules.ts:142, G.skills' emote field and character.acx" },
} satisfies Record<string, DecisionRow>;
export const PLAIN = {
  forecast: 'read',
  replyRow: 'format',
} satisfies Record<string, PlainKind>;

// C1's game actions (addon-capabilities.md "The table by owner"): an add-on's spend goes through the
// turns owner's door (runtime/characters/turns/install.ts `spend`), at most ADDON_SPEND_CAP, with
// the spend table's H9 and H10 lifted for that one spend and the executor's whole refusal after. The
// game has no emote event at pin 16881a27: an emote is a G.skills row with an `emote` field, cast
// through `use_skill`, so the emote action is a spend of that skill.
export const ACTIONS = {
  spend: { events: ['attack', 'heal', 'skill'], functions: ['attack', 'heal', 'use_skill'], door: 'spend',
    args: '{skill, targets?: ids, argument?, rank?: at most task, category?}', bound: "rank at most task; T1 with H9 and H10 lifted, then the executor's refusal, the cooldown and the call band" },
  emote: { events: [], functions: [], door: 'emote', args: '{name: a G.skills row with an emote field}',
    bound: "a look in character.acx, at the maintenance rank, so survival's spends go first; then the spend's T1 and refusal" },
} as const satisfies Record<string, ActionRow>;

// C3's reads (addon-capabilities.md "The completeness rule"): each export of the turns door and
// each PLAIN read, all on the character.
const DOOR = 'runtime/characters/turns/api.ts';
export const READS = {
  'turns.health': { side: 'character', type: "a combatant's HP share", door: `${DOOR}#health` },
  'turns.hitsAroundCaster': { side: 'character', type: 'the monsters an area cast would hit', door: `${DOOR}#hitsAroundCaster` },
  'turns.healFirstBelow': { side: 'character', type: 'number', door: `${DOOR}#healFirstBelowOf` },
  'turns.attackSource': { side: 'character', type: 'string', door: `${DOOR}#ATTACK_SOURCE` },
  'turns.attackReadyAt': { side: 'character', type: 'number', door: `${DOOR}#attackReadyAt` },
  'turns.errorReason': { side: 'character', type: 'string', door: `${DOOR}#errorReason` },
  'turns.familyOf': { side: 'character', type: 'string', door: `${DOOR}#familyOf` },
  'turns.readyKey': { side: 'character', type: 'string', door: `${DOOR}#readyKey` },
  'turns.familyTable': { side: 'character', type: 'Record<string, string[]>', door: `${DOOR}#familyTable` },
  'turns.cooldownOf': { side: 'character', type: 'number', door: `${DOOR}#cooldownOf` },
  'turns.forecast': { side: 'character', type: 'number', door: 'runtime/characters/turns/rules.ts#forecast' },
} as const satisfies Record<string, ReadRow>;
// The door exports that are no read: the install and the class roles the role runner composes.
export const DOOR_ONLY = {
  'runtime/characters/turns/api.ts#installTurns': { kind: 'port', cite: "the role runner's install" },
  'runtime/characters/turns/api.ts#defaultRole': { kind: 'port', cite: "the role runner's class role" }, 'runtime/characters/turns/api.ts#mage': { kind: 'port', cite: "the role runner's class role" },
  'runtime/characters/turns/api.ts#merchant': { kind: 'port', cite: "the role runner's class role" }, 'runtime/characters/turns/api.ts#paladin': { kind: 'port', cite: "the role runner's class role" },
  'runtime/characters/turns/api.ts#priest': { kind: 'port', cite: "the role runner's class role" }, 'runtime/characters/turns/api.ts#ranger': { kind: 'port', cite: "the role runner's class role" },
  'runtime/characters/turns/api.ts#rogue': { kind: 'port', cite: "the role runner's class role" }, 'runtime/characters/turns/api.ts#warrior': { kind: 'port', cite: "the role runner's class role" },
} as const satisfies Record<string, { kind: 'write' | 'port' | 'command'; cite: string }>;

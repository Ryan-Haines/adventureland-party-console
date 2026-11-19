// Owner 05's rows of the hook table: survival. Only 05's build writes this file;
// runtime/hooks/registry.ts composes every owner's file into one `HOOKS` and one `SLOTS`.
import type { DecisionRow, PlainKind } from './row.ts';
import type { ActionRow, ReadRow } from '../registry.ts';
import type { DispatchContext, EscapeHold, HookRow, RecoveryView, RespawnAnswer, SlotRow, Refusal, SurvivalChoiceAsk, SurvivalQuestion, SurvivalRefusalAsk, SurvivalVerdict } from '../registry.ts';

export const HOOKS = {
  // The Cave revival's tick at today's place in the role loop (E05-a):
  // survival's registration runs it, and the loop awaits it after the pass.
  'survival.revival': { kind: 'request', side: 'character', part: 'survival (05)', answers: 'one', core: true, addonMayAsk: false,
    fixture: 'scripts/tests/role-loop-order.test.cjs#TC46: on the pass where the Cave revival holds the priest no attack and no class decision goes',
    receives: 'the character', returns: 'whether the revival acted or holds the priest' },
  // The survival owner's surface. The verdict answers four questions: a group's fight after a death
  // (01's wind-down), a walk through a fight (02's defended walk and 01's left-out member), an
  // add-on's hold with its tank, and a character's own fight. The core-only points each cite a reason
  // of 14's 0.4 list. The verdict, the potion table, the heal choice, regeneration, the Stomp and
  // Scare decide survival. An add-on casts through `skills.request` at its own tier. The respawn and
  // the Cave revival send game calls. The escape's stages and landing decide survival. An add-on
  // moves the home through `safe.goal`. Owner 01's task decides the member's next activity after a
  // respawn, and an add-on joins it through `task.request`.
  'survival.verdict': { kind: 'request', side: 'both', part: 'survival (05)', answers: 'one', core: true, addonMayAsk: true,
    fixture: "e2e/live-survival-hooks.spec.ts#L: the add-on asks its own fight's verdict",
    receives: 'a group, a walk with its members and attackers, a hold with its tank, attackers and supply, or a character',
    returns: 'fight, finish or leave; for a hold, hold or step' },
  // An add-on refuses a fight the verdict would finish. Refusal only: a reason turns `finish`
  // or `fight` into `leave`, it never turns a `leave` into a fight, and the tank's `hold` question
  // does not ask it.
  // P2: an add-on picks among the options core accepts for one survival question; the answer goes
  // at core's rank (a spend at survival, an escape at tier 100, a death recovery at 95).
  'survival.choice': { kind: 'request', side: 'both', part: 'survival (05), its choices', answers: 'one', addonMayAsk: false,
    bound: "one of the offered options, else core's pick; a spend core picks is never skipped; ports is an order of core's own members; danger only raises, transfer only refuses, respawn only waits longer",
    fixture: "scripts/tests/hook-registry.test.cjs#P2: the add-on picks the larger potion and the priest's heal target; an answer outside the options keeps core's",
    receives: "the question (potion, regen, heal, stomp, scare, ports, landing, escapeSpend, danger, transfer, respawn, recovery, farmReturn or revival), the member, the options and core's pick",
    returns: "one of the options, or nothing for core's pick" },
  'survival.refuses': { kind: 'request', side: 'coordinator', part: 'survival (05)', answers: 'many', addonMayAsk: false, bound: 'refusal only',
    fixture: 'scripts/tests/combat-disengagement.test.cjs#SV53: an add-on refusal turns a finish into an escape, and a leave stays a leave',
    receives: "the question (a group's recovery or a walk) with the survivors, the foes and the verdict", returns: 'a reason, or nothing' },
  'survival.fighting': { kind: 'request', side: 'character', part: 'survival (05)', answers: 'one', core: true, addonMayAsk: true,
    fixture: "e2e/live-survival-hooks.spec.ts#L: the add-on asks its own fight's verdict",
    receives: 'a character', returns: 'whether its party is in a fight' },
  'survival.escaping': { kind: 'request', side: 'both', part: 'survival (05)', answers: 'one', core: true, addonMayAsk: true,
    fixture: "e2e/live-survival-hooks.spec.ts#L: the add-on reads the escape's stage",
    receives: 'a character name', returns: 'the escape that owns it: its id, its stage and the one command purpose it admits; or nothing' },
  'survival.recovery': { kind: 'request', side: 'both', part: 'survival (05)', answers: 'one', core: true, addonMayAsk: true,
    fixture: "e2e/live-survival-hooks.spec.ts#L: the add-on reads the recovery's phase",
    receives: 'a group', returns: "the party death recovery's last computed phase, names, fight rule and finishing list; or nothing" },
  // The step that acts runs from two core callers only, the coordinator's survival clock and 04's
  // grouped snapshot (CF-S7), so no add-on answers or asks it.
  'survival.recoveryStep': { kind: 'request', side: 'coordinator', part: 'survival (05)', answers: 'one', core: true, addonMayAsk: false,
    fixture: "scripts/tests/combat-disengagement.test.cjs#the grouped snapshot's step runs the recovery once on the current reports",
    receives: 'a group', returns: "the party death recovery's view after one step on the current reports" },
  'survival.life': { kind: 'request', side: 'coordinator', part: 'survival (05)', answers: 'one', core: true, addonMayAsk: true,
    fixture: 'scripts/tests/combat-disengagement.test.cjs#SV59: the life changes once per death',
    receives: 'a character name', returns: "the time of the member's last death the coordinator read, or 0" },
  'survival.low': { kind: 'request', side: 'coordinator', part: 'survival (05)', answers: 'one', core: true, addonMayAsk: true,
    fixture: 'scripts/tests/combat-disengagement.test.cjs#confirmed completion escapes then resumes only after everyone safely returns above the HP potion line',
    receives: 'a character name', returns: 'whether the member reads below its "HP potion below" line' },
  'survival.healthy': { kind: 'request', side: 'character', part: 'survival (05)', answers: 'one', core: true, addonMayAsk: true,
    fixture: 'scripts/tests/survival-needs.test.cjs#priest Curse waits while a member is below the share',
    receives: 'a share of max HP', returns: 'whether every party member in view stands at or above it' },
  // TRN-Q-DPS: 03's ranking counts an MP potion only within 05's potion policy.
  'survival.mpPotion': { kind: 'request', side: 'character', part: 'survival (05)', answers: 'one', core: true, addonMayAsk: true,
    fixture: 'scripts/tests/survival-needs.test.cjs#the MP potion the ranking counts follows the potion table',
    receives: "the character's MP after a cast", returns: "the MP the bag's MP potion gives when the potion table drinks MP at that MP and the potion cooldown is ready, else 0" },
  'survival.respawn': { kind: 'request', side: 'character', part: 'survival (05)', answers: 'one', core: true, addonMayAsk: false,
    fixture: "e2e/live-survival-hooks.spec.ts#L: the dead member's respawn is sent and accepted",
    receives: 'who asks (by)', returns: 'sent, not-now, or refused with the reason (the console Pause)' },
  'survival.died': { kind: 'notice', side: 'both', part: 'survival (05)', answers: 'many', 
    fixture: 'e2e/live-survival-hooks.spec.ts#L: the death is noticed once',
    receives: "name, at, cause, map, x, y, event, by 'core:survival'", returns: 'nothing' },
  // An escape the party's verdict decided, with its cause (decided 2026-11-06): bad luck or too
  // hard. The Hunt cycle reads it for its blacklist (runtime/hunting/coordinator/install.ts).
  'survival.escaped': { kind: 'notice', side: 'coordinator', part: 'survival (05)', answers: 'many', 
    fixture: "e2e/live-survival-hooks.spec.ts#L: the escape's cause is noticed",
    receives: 'names, at, cause (bad luck or too hard), mtypes, repeat, deaths, model, trend, by', returns: 'nothing' },
  'survival.recoveryStarted': { kind: 'notice', side: 'coordinator', part: 'survival (05)', answers: 'many', 
    fixture: 'e2e/live-survival-hooks.spec.ts#L: the recovery starts on the death',
    receives: "group, id, names, deaths, home, by 'core:survival'", returns: 'nothing' },
  'survival.recoveryPhase': { kind: 'notice', side: 'coordinator', part: 'survival (05)', answers: 'many', 
    fixture: 'e2e/live-survival-hooks.spec.ts#L: the recovery goes finishing to escaping',
    receives: 'group, id, from, to, reason, resetsFight, names, by', returns: 'nothing' },
  'survival.recovered': { kind: 'notice', side: 'coordinator', part: 'survival (05)', answers: 'many', 
    fixture: 'e2e/live-survival-hooks.spec.ts#L: the recovery ends complete',
    receives: 'group, id, code (complete, cancelled or arrived-at-farm), by', returns: 'nothing' },
  'survival.escapeStarted': { kind: 'notice', side: 'coordinator', part: 'survival (05)', answers: 'many', 
    fixture: 'e2e/live-survival-hooks.spec.ts#L: the escape starts',
    receives: 'group, id, leader, participants, walk, home, resetsFight, by', returns: 'nothing' },
  'survival.escapeStage': { kind: 'notice', side: 'coordinator', part: 'survival (05)', answers: 'many', 
    fixture: 'e2e/live-survival-hooks.spec.ts#L: the escape goes recovering to recovery-convoy to home',
    receives: 'group, id, from, to, member, reason, by', returns: 'nothing' },
  'survival.escapeEnded': { kind: 'notice', side: 'coordinator', part: 'survival (05)', answers: 'many', 
    fixture: "e2e/live-survival-hooks.spec.ts#L: the player's release ends the escape",
    receives: 'group, id, the stage at the end (home, complete, failed-hold or released), by (player for a release)', returns: 'nothing' },
  'survival.escapeMember': { kind: 'notice', side: 'character', part: 'survival (05)', answers: 'many', 
    fixture: 'e2e/live-survival-hooks.spec.ts#L: each member joins and leaves the escape',
    receives: "character, id, stage, change (joined, stage or left), landed, ported, blinkFailed, portFailed, by 'core:survival'", returns: 'nothing' },
  'survival.judged': { kind: 'notice', side: 'coordinator', part: 'survival (05)', answers: 'many', 
    fixture: "e2e/live-survival-hooks.spec.ts#L: the verdict's first judgement is noticed",
    receives: "key, verdict, model, restart, foeRate, toKill, by 'core:survival'", returns: 'nothing' },
  'survival.respawning': { kind: 'notice', side: 'character', part: 'survival (05)', answers: 'many', 
    fixture: "e2e/live-survival-hooks.spec.ts#L: the dead member's respawn is sent and accepted",
    receives: 'character, by (the asker), outcome (sent, not-now, refused, accepted, or cant_respawn with ms)', returns: 'nothing' },
  'survival.memberRecovery': { kind: 'notice', side: 'character', part: 'survival (05)', answers: 'many', 
    fixture: "e2e/live-survival-hooks.spec.ts#L: the respawned member's recovery completes",
    receives: "character, stage, phase, trying, label (the card words while it runs, or null), by 'core:survival'", returns: 'nothing' },
  // The Cave revival's phase change, told by the `survival.revival` answer, so the revival's code
  // keeps its decisions.
  'survival.reviving': { kind: 'notice', side: 'character', part: 'survival (05)', answers: 'many', 
    fixture: "scripts/tests/cave-priest-recovery.test.cjs#the revival's phase change is noticed",
    receives: "character, target, phase, reason, by 'core:survival/cave-revival'", returns: 'nothing' },
} as const satisfies Record<string, HookRow>;

export const SLOTS = {} as const satisfies Record<string, SlotRow>;

// The registry's dispatch of the survival owner's rows: the survival owner's requests and reads (W5), asked by its
// callers in each realm. With no answer a verdict, an escape and a recovery are undefined, a life is 0 and nobody
// is in a fight. A respawn with no answer fails naming the row, since a realm with no survival install makes no
// respawn.
export function dispatch(ctx: DispatchContext) {
  return {
    skills: {
      // The Cave revival's tick, answered by survival on a character; false with no answer.
      revival(character: string): Promise<boolean> { return ctx.answering('survival.revival')[0]?.hooks['survival.revival']!(character) ?? Promise.resolve(false); },
    },
    survival: {
      // P2: the enabled add-on's pick when it is one of the options and keeps the question's bound,
      // else core's. `ports` takes an order of core's own members, `respawn` a time no earlier than
      // core's. With no add-on nothing is asked.
      choice<T>(ask: SurvivalChoiceAsk<T>): T {
        const r = ctx.answering('survival.choice')[0];
        if (!r) return ask.core;
        const answer = ctx.call(r, 'survival.choice', () => r.hooks['survival.choice']!(ask, ctx.settings(r.name)));
        if (answer === undefined) return ask.core;
        // A game entity can hold cycles, so a copy that cannot be written compares by identity only.
        const same = (a: unknown, b: unknown) => { if (a === b) return true; try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } };
        if (ask.question === 'respawn') return typeof answer === 'number' && answer >= Number(ask.core) ? answer as T : ask.core;
        if (ask.question === 'ports') {
          const core: readonly unknown[] = Array.isArray(ask.core) ? ask.core : [];
          return Array.isArray(answer) && answer.length === core.length && [...answer].sort().join(',') === [...core].sort().join(',') ? answer as T : ask.core;
        }
        const option = ask.options.find(o => same(o, answer));
        if (option === undefined) ctx.record(r.name, 'survival.choice', `${ask.question}: an answer outside the options`);
        return option === undefined ? ask.core : option;
      },
      verdict(question: SurvivalQuestion): SurvivalVerdict | undefined { return ctx.answering('survival.verdict')[0]?.hooks['survival.verdict']!(question); },
      respawn(ask: { by: string }): RespawnAnswer {
        return ctx.one('survival.respawn').hooks['survival.respawn']!(ask);
      },
      // The fight fact for targeting's fight-start clear.
      fighting(name: string): boolean { return ctx.answering('survival.fighting')[0]?.hooks['survival.fighting']!(name) === true; },
      escaping(name: string): EscapeHold | undefined { return ctx.answering('survival.escaping')[0]?.hooks['survival.escaping']!(name); },
      recovery(group: string): RecoveryView | undefined { return ctx.answering('survival.recovery')[0]?.hooks['survival.recovery']!(group); },
      recoveryStep(group: string): RecoveryView | undefined { return ctx.answering('survival.recoveryStep')[0]?.hooks['survival.recoveryStep']!(group); },
      life(name: string): number { return ctx.answering('survival.life')[0]?.hooks['survival.life']!(name) ?? 0; },
      // With no answer no member reads low.
      low(name: string): boolean { return ctx.answering('survival.low')[0]?.hooks['survival.low']!(name) === true; },
      healthy(share: number): boolean { return ctx.answering('survival.healthy')[0]?.hooks['survival.healthy']!(share) === true; },
      mpPotion(mpAfter: number): number { return Number(ctx.answering('survival.mpPotion')[0]?.hooks['survival.mpPotion']!(mpAfter)) || 0; },
      // The first refusal and the add-on that gave it. An answer that throws refuses nothing.
      refuses(ask: SurvivalRefusalAsk): Refusal | undefined {
        return ctx.refuser('survival.refuses', r => r.hooks['survival.refuses']!(ask, ctx.settings(r.name)));
      },
    },
  };
}

// The hook coverage (addon:check rule 8):
// each decision of the files below with its hook or core-only reason, and each other export's plain kind.
export const RULE_FILES = ['runtime/coordinator/survival/verdict.ts', 'runtime/coordinator/survival/recovery.ts', 'runtime/coordinator/survival/install.ts', 'runtime/coordinator/survival/escape.ts', 'runtime/characters/survival/escape.ts', 'runtime/characters/survival/needs.ts', 'runtime/characters/survival/death.ts'] as const;
export const DECISIONS = {
  'the fight verdict, finish or leave': { at: 'runtime/coordinator/survival/verdict.ts#createVerdicts', hook: 'survival.refuses' },
  'a walk\'s escape verdict': { at: 'runtime/coordinator/survival/install.ts#installCoordinatorSurvival', hook: 'survival.refuses' },
  'survival\'s holds on a member': { at: 'runtime/coordinator/survival/install.ts#survivalHolds', core: 'safety', cite: 'runtime/coordinator/survival/install.ts:74, escape tier 100' },
  'escape port order': { at: 'runtime/coordinator/survival/escape.ts#createPartyEscape', hook: 'survival.choice' },
  'escape landing and forward point': { at: 'runtime/characters/survival/escape.ts#createEscape', hook: 'survival.choice' },
  'an escape admits a request': { at: 'runtime/characters/survival/escape.ts#escapeAdmits', core: 'safety', cite: 'runtime/characters/survival/escape.ts:29, escape tier 100' },
  'an escape\'s spends': { at: 'runtime/characters/survival/escape.ts#createEscapeSpends', core: 'safety', cite: 'runtime/characters/survival/escape.ts:183' },
  'potion choice': { at: 'runtime/characters/survival/needs.ts#potionChoice', hook: 'survival.choice' },
  'regeneration order': { at: 'runtime/characters/survival/needs.ts#regenerationOrder', hook: 'survival.choice' },
  'heal choice, stomp and scare': { at: 'runtime/characters/survival/needs.ts#createNeeds', hook: 'survival.choice' },
  'a member is in danger': { at: 'runtime/characters/survival/needs.ts#endangered', hook: 'survival.choice' },
  'a transfer is safe': { at: 'runtime/characters/survival/needs.ts#safeTransfer', hook: 'survival.choice' },
  'a pulse holds': { at: 'runtime/characters/survival/needs.ts#pulseHeld', core: 'safety', cite: 'runtime/characters/survival/needs.ts:391' },
  'respawn timing': { at: 'runtime/characters/survival/death.ts#createDeath', hook: 'survival.choice' },
  'party death recovery start': { at: 'runtime/coordinator/survival/recovery.ts#createPartyRecovery', hook: 'survival.choice' },
  'farm return arrival': { at: 'runtime/coordinator/survival/recovery.ts#createPartyRecovery', hook: 'survival.choice' },
  'Cave revival order': { site: 'runtime/hunting/coordinator/cave.ts:816', hook: 'survival.choice' },
} satisfies Record<string, DecisionRow>;
export const PLAIN = {
  // Facts the game fixes, which the console reads; an add-on's answer cannot change them.
  escapeCost: 'read',
  survivalLog: 'format',
  recoveryReads: 'read', chosen: 'read', incomingDps: 'read', partyUnderAttack: 'read', atFarm: 'read',
} satisfies Record<string, PlainKind>;

// C1's game actions (addon-capabilities.md "The table by owner"): the respawn and the regeneration
// and escape uses run at survival's own ranks (escape tier 100, the death rows); an add-on picks among
// core's options through `survival.choice`. The escape's Town cast is 02's `town` event.
export const ACTIONS = {
  respawn: { events: ['respawn'], functions: ['respawn'], closed: 'FW', cite: "runtime/characters/survival/death.ts: the death rows; survival.choice's respawn question only waits longer" },
  use: { events: ['use'], functions: ['use', 'escapeUse'], closed: 'FW', cite: "runtime/characters/survival/needs.ts: regeneration and the escape's uses; survival.choice picks among core's options" },
} as const satisfies Record<string, ActionRow>;

// C3's reads (addon-capabilities.md "The completeness rule"): each export of survival's two doors
// and each PLAIN read, with the side that holds it.
const CHARACTER_DOOR = 'runtime/characters/survival/api.ts', COORDINATOR_DOOR = 'runtime/coordinator/survival/api.ts';
export const READS = {
  'survival.endangered': { side: 'character', type: 'boolean', door: `${CHARACTER_DOOR}#endangered` },
  'survival.incomingDps': { side: 'character', type: 'number', door: `${CHARACTER_DOOR}#incomingDps` },
  'survival.safeTransfer': { side: 'character', type: 'boolean', door: `${CHARACTER_DOOR}#safeTransfer` },
  'survival.healthyShare': { side: 'character', type: 'number', door: `${CHARACTER_DOOR}#HEALTHY_SHARE` },
  'survival.escapeMemberResets': { side: 'character', type: 'boolean', door: `${CHARACTER_DOOR}#escapeMemberResets` },
  'survival.occupies': { side: 'character', type: 'boolean', door: `${CHARACTER_DOOR}#survivalOccupies` },
  'survival.deadLabel': { side: 'coordinator', type: 'string', door: `${COORDINATOR_DOOR}#DEAD_LABEL` },
  'survival.escapeTaskLabel': { side: 'coordinator', type: 'string', door: `${COORDINATOR_DOOR}#ESCAPE_TASK_LABEL` },
  'survival.escapeHolds': { side: 'coordinator', type: 'boolean', door: `${COORDINATOR_DOOR}#escapeHolds` },
  'survival.escapeReply': { side: 'coordinator', type: "the reply's escape section", door: `${COORDINATOR_DOOR}#escapeReply` },
  'survival.partyDeathLabel': { side: 'coordinator', type: 'string | null', door: `${COORDINATOR_DOOR}#partyDeathLabel` },
  'survival.recoveryReply': { side: 'coordinator', type: "the reply's recovery section", door: `${COORDINATOR_DOOR}#recoveryReply` },
  'survival.recoveryRuns': { side: 'coordinator', type: 'boolean', door: `${COORDINATOR_DOOR}#recoveryRuns` },
  'survival.escapeCost': { side: 'character', type: 'number', door: 'runtime/characters/survival/escape.ts#escapeCost' },
  'survival.recoveryReads': { side: 'coordinator', type: "the party death recovery's reads", door: 'runtime/coordinator/survival/install.ts#recoveryReads' },
  'survival.chosen': { side: 'character', type: "the add-on's pick among the options, or core's", door: 'runtime/characters/survival/needs.ts#chosen' },
  'survival.partyUnderAttack': { side: 'character', type: 'boolean', door: 'runtime/characters/survival/needs.ts#partyUnderAttack' },
  'survival.atFarm': { side: 'character', type: 'boolean', door: 'runtime/characters/survival/needs.ts#atFarm' },
} as const satisfies Record<string, ReadRow>;
// The door exports that are no read: the recovery's end and the installs.
export const DOOR_ONLY = {
  'runtime/coordinator/survival/api.ts#endRecovery': { kind: 'write', cite: "ends the party death recovery; 07's Hunt reset calls it" },
  'runtime/characters/survival/api.ts#installSurvival': { kind: 'port', cite: "the role runner's install" },
  'runtime/coordinator/survival/api.ts#createSurvivalRoutes': { kind: 'port', cite: "13's composition root" },
  'runtime/coordinator/survival/api.ts#installCoordinatorSurvival': { kind: 'port', cite: "13's composition root" },
} as const satisfies Record<string, { kind: 'write' | 'port' | 'command'; cite: string }>;

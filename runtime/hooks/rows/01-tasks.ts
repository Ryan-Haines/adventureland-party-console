// Owner 01's rows of the hook table: groups and tasks. Only 01's build writes this file;
// runtime/hooks/registry.ts composes every owner's file into one `HOOKS` and one `SLOTS`.
import { doorOnly, readsOf, type DecisionRow, type PlainKind } from './row.ts';
import type { ActionRow, AddonTaskAsk, DispatchContext, HookRow, ReadRow, SlotRow } from '../registry.ts';
import { GROUP_KINDS, SOURCE_ORDER } from '../../tasks/api.ts';

export const HOOKS = {
  // The target mode slot's tick (user decision M1): what the party
  // fights for. The coordinator asks the registration that fills the scope's chosen entry, once
  // per status report, as it ticks core Hunt.
  'target.mode': { kind: 'request', side: 'coordinator', part: 'groups and tasks (01), the target mode slot', answers: 'slot', addonMayAsk: false,
    fixture: 'e2e/live-tasks-hooks.spec.ts#L: the Achievements-like entry farms its target, and lets go once on a Hunt switch',
    receives: "the scope's farming view and its ports", returns: 'the state each character of the scope reads, or nothing' },
  // The combat mode slot (section 1.5): how the party fights. Its core entries Auto, Default and
  // Scatter answer inline in the grouped queue. The groups and tasks owner asks an add-on entry
  // the scope selected and hands its answer to targeting (04) and movement with the heartbeat
  // reply (01 design 2.6).
  'combat.mode': { kind: 'request', side: 'coordinator', part: 'groups and tasks (01), the combat mode slot', answers: 'slot', addonMayAsk: false,
    fixture: 'e2e/live-tasks-hooks.spec.ts#L: an add-on combat mode reaches the members on the next reply',
    receives: "the group's members and their reports", returns: 'grouped (one nominated target) or scatter (each fighter its own)' },
  // The groups and tasks owner's hooks. Every task source asks through `task.request`: a core
  // source names its slots, an add-on one task at the one tier `addon-task`; an add-on that
  // declares another tier is refused at load.
  'task.request': { kind: 'request', side: 'coordinator', part: 'groups and tasks (01)', answers: 'many', addonMayAsk: false,
    fixture: "e2e/live-tasks-hooks.spec.ts#L: the add-on's task takes the farming group, and ranks below the event",
    receives: "the group, its kind, its members, its live task and the tick", returns: "one request of kind addon:<name> at tier addon-task (with its interrupted, windDown, visit and reunion, and the group kinds it runs in), or nothing",
    bound: 'P7: the group kinds name only kinds the composition builds (party, solo, merchant), or the answer is dropped and recorded; the core rows keep their own kinds' },
  // The groups and tasks owner's decision hooks of an add-on's own task (01 O5 and CF5, the contract
  // section's part 1). The owner asks only the add-on whose task the group runs or the member is
  // assigned, so each add-on answers for its own task and two add-ons never conflict at load.
  'task.alternative': { kind: 'request', side: 'coordinator', part: 'groups and tasks (01), the task ladder (T5)', answers: 'many', addonMayAsk: false,
    fixture: "e2e/live-tasks-hooks.spec.ts#L: the add-on's task fails once and walks to its named alternative",
    receives: 'group, taskId, code', returns: "its task's next goal, or nothing for the ladder's regroup" },
  'task.safePoint': { kind: 'request', side: 'coordinator', part: 'groups and tasks (01), the task ladder (T5)', answers: 'many', addonMayAsk: false,
    fixture: "e2e/live-tasks-hooks.spec.ts#L: the add-on's task reaches the safe-point rung at its own point",
    receives: 'group, taskId', returns: 'the point {map, x, y} its task restarts from, or nothing' },
  'group.questions': { kind: 'request', side: 'coordinator', part: 'groups and tasks (01), the questions (T3)', answers: 'many', addonMayAsk: false,
    fixture: "e2e/live-tasks-hooks.spec.ts#L: a merchant visit to a member under the add-on's task is refused by its answer",
    receives: 'question (merchant-visit, event-attendance, rare, preempt), group, kind, on rare the monster type as rare, on preempt the incoming core kind and its tier', returns: 'false to refuse, or nothing; it never allows what the table refuses',
    bound: "P6: preempt is asked only for a core task ranked from hunt-mission (62) to event-attendance (72), never for the player's commands or a task at town (85) or above; a refused core task waits" },
  'group.hold': { kind: 'request', side: 'coordinator', part: 'groups and tasks (01), the holds (T4)', answers: 'many', addonMayAsk: false,
    fixture: "e2e/live-tasks-hooks.spec.ts#L: the add-on holds its group, and the hold ends with its task",
    receives: 'group, members, live', returns: '{target, reason} for its group or one of its members, or nothing to end its hold' },
  'member.apart': { kind: 'request', side: 'coordinator', part: 'groups and tasks (01), the left-out member (GT2)', answers: 'many', addonMayAsk: false,
    fixture: "e2e/live-tasks-hooks.spec.ts#L: a member left out of the add-on's walk waits at the point it names",
    receives: 'group, member, taskId', returns: '{wait: {map, x, y}} or {farm: true}, or nothing for the member\'s own setting' },
  // The groups and tasks owner's notices (01 O5 and the contract section): one per state change,
  // each naming its subject and `by`, the identity whose request, hold or end made it.
  'task.started': { kind: 'notice', side: 'coordinator', part: 'groups and tasks (01)', answers: 'many', 
    fixture: "e2e/live-tasks-hooks.spec.ts#L: the event takes the group: one started, one suspended",
    receives: 'group, taskId, kind, owner, rank, members, resumed, by', returns: 'nothing' },
  'task.suspended': { kind: 'notice', side: 'coordinator', part: 'groups and tasks (01)', answers: 'many', 
    fixture: "e2e/live-tasks-hooks.spec.ts#L: the event takes the group: one started, one suspended",
    receives: 'group, taskId, kind, owner, by', returns: 'nothing' },
  'task.resumed': { kind: 'notice', side: 'coordinator', part: 'groups and tasks (01)', answers: 'many', 
    fixture: "e2e/live-tasks-hooks.spec.ts#L: the event ends and farming resumes",
    receives: 'group, taskId, kind, owner, by', returns: 'nothing' },
  'task.ended': { kind: 'notice', side: 'coordinator', part: 'groups and tasks (01)', answers: 'many', 
    fixture: "e2e/live-tasks-hooks.spec.ts#L: the event ends and farming resumes",
    receives: 'group, taskId, kind, owner, code, next, by', returns: 'nothing' },
  'task.waiting': { kind: 'notice', side: 'coordinator', part: 'groups and tasks (01)', answers: 'many', 
    fixture: "e2e/live-tasks-hooks.spec.ts#L: the add-on's task waits behind the event",
    receives: 'group, taskId, by', returns: 'nothing' },
  'task.refused': { kind: 'notice', side: 'coordinator', part: 'groups and tasks (01)', answers: 'many', 
    fixture: "scripts/tests/hook-registry.test.cjs#U: a rare against a live Hunt is refused",
    receives: 'group, kind, row, by', returns: 'nothing' },
  'task.phase': { kind: 'notice', side: 'coordinator', part: 'groups and tasks (01)', answers: 'many', 
    fixture: "e2e/live-tasks-hooks.spec.ts#L: the event task's walk phase changes",
    receives: 'group, taskId, phase, label, by', returns: 'nothing' },
  'task.ladder': { kind: 'notice', side: 'coordinator', part: 'groups and tasks (01)', answers: 'many', 
    fixture: "e2e/live-tasks-hooks.spec.ts#L: the add-on's task fails once and walks to its named alternative",
    receives: 'group, taskId, rung, by', returns: 'nothing' },
  'task.invariant': { kind: 'notice', side: 'coordinator', part: 'groups and tasks (01)', answers: 'many', 
    fixture: "scripts/tests/hook-registry.test.cjs#U: a planted live task with no deadline, walk or step",
    receives: 'group, invariant, detail, by', returns: 'nothing' },
  'task.due': { kind: 'notice', side: 'coordinator', part: 'groups and tasks (01)', answers: 'many', 
    fixture: "e2e/live-tasks-hooks.spec.ts#L: the event becomes due during a Hunt hand-in",
    receives: 'group, due, by', returns: 'nothing' },
  'group.changed': { kind: 'notice', side: 'coordinator', part: 'groups and tasks (01)', answers: 'many', 
    fixture: "e2e/live-tasks-hooks.spec.ts#L: a Follow change moves the priest",
    receives: 'group, members, leader, by', returns: 'nothing' },
  'group.held': { kind: 'notice', side: 'coordinator', part: 'groups and tasks (01)', answers: 'many', 
    fixture: "e2e/live-tasks-hooks.spec.ts#L: Manual on the priest, then off",
    receives: 'group, member, hold, by', returns: 'nothing' },
  'group.released': { kind: 'notice', side: 'both', part: 'groups and tasks (01)', answers: 'many', 
    fixture: "e2e/live-tasks-hooks.spec.ts#L: Manual on the priest, then off",
    receives: 'group, member, hold, by', returns: 'nothing' },
  'member.assigned': { kind: 'notice', side: 'coordinator', part: 'groups and tasks (01)', answers: 'many', 
    fixture: "e2e/live-tasks-hooks.spec.ts#L: a Follow change moves the priest",
    receives: 'group, member, assignment, by', returns: 'nothing' },
  'status.changed': { kind: 'notice', side: 'coordinator', part: 'groups and tasks (01)', answers: 'many', 
    fixture: "e2e/live-tasks-hooks.spec.ts#L: Manual on the priest, then off",
    receives: 'group, status, by', returns: 'nothing' },
  'slot.changed': { kind: 'notice', side: 'coordinator', part: 'groups and tasks (01)', answers: 'many', 
    fixture: "e2e/live-tasks-hooks.spec.ts#L: the Achievements-like entry farms its target, and lets go once on a Hunt switch",
    receives: 'group, slot, entry, by', returns: 'nothing' },
} as const satisfies Record<string, HookRow>;

// The add-on capability tables: each game call the tasks owner's code makes, offered
// through its door or closed with a code, and each state an add-on may read with the door export
// that answers it.
export const ACTIONS = {
  // 01's roster and party membership decide who is in the party; an add-on groups members through
  // `task.request` and the group hooks.
  party: { events: ['party'], functions: ['send_party_invite', 'accept_party_invite', 'send_party_request', 'accept_party_request', 'leave_party', 'kick_party_member'],
    closed: 'FW', cite: "runtime/tasks/api.ts:45, the party and its groups are 01's" },
} as const satisfies Record<string, ActionRow>;
// C3's tables (addon-capabilities.md "The completeness rule"): each export of the tasks owner's doors is a
// read an add-on may ask, or a write, a port or a command only core calls.
const TASKS = 'runtime/tasks/api.ts', TASKS_COORDINATOR = 'runtime/tasks/coordinator/api.ts';
export const READS = {
  // 01's party: leader, members, followers and scopes, by group.
  'party.view': { side: 'both', type: 'GroupStatus', door: `${TASKS}#tasks` },
  ...readsOf('tasks', 'both', TASKS, { GROUPS: "the group kinds in order", priority: "number", dueYields: "boolean", above: "boolean", taskTier: "number", GROUP_KINDS: "string[]", SOURCE_ORDER: "string[]", scopeGroups: "the scope's groups", scopeOwner: "string", HAND_CONTROL_DEFAULT: "HandControl", savedManual: "boolean" }),
  ...readsOf('tasks', 'coordinator', TASKS_COORDINATOR, { coordinatorHuntParticipants: "string[]", activeOf: "a member's active group", groupId: "string", groupKey: "string", leaderReply: "the reply's leader section", partyReply: "the reply's party section" }),
  ...readsOf('tasks', 'both', 'runtime/tasks/rules.ts', { reportChanged: "boolean" }),
} as const satisfies Record<string, ReadRow>;
export const DOOR_ONLY = {
  ...doorOnly(TASKS, 'port', ['publishTasks']),
  ...doorOnly(TASKS_COORDINATOR, 'port', ['createHuntMode', 'ladderPort', 'installTasks', 'createCombatGroups', 'createFarmingScopes', 'createScopedRoutes', 'installTaskRoutes']),
  ...doorOnly(TASKS_COORDINATOR, 'write', ['reconcileFarmingMembership']),
};

// The two slots of user decision M1 (01 contract part 4), drawn by
// the add-on system's mode row.
export const SLOTS = {
  'target-mode': { owner: '01', data: "{entry, label, reads: settings names, returnsTo, scoped: hook names}, riding on the target.mode registration's slot entry", section: true,
    bound: "an entry's ports write only the settings it reads, when it lists them; leave writes its returnsTo (Farming when unset); its scoped hooks are asked only for a character whose scope selected it; " +
      "the target inside the entry's focus is still core's pick, the class role (S9, characters/targeting/rules.ts), since the entry names what to fight and core picks which one",
    fixture: 'e2e/live-tasks-hooks.spec.ts#L: the Achievements-like entry farms its target, and lets go once on a Hunt switch' },
  'combat-mode': { owner: '01', data: '{entry, label} on the combat.mode registration', section: false,
    fixture: 'e2e/live-tasks-hooks.spec.ts#L: an add-on combat mode reaches the members on the next reply' },
} as const satisfies Record<string, SlotRow>;

// The registry's dispatch of the tasks owner's rows: the task sources' requests and an add-on combat
// mode's answer, each read through the registry's own state.
export function dispatch(ctx: DispatchContext) {
  return {
    // Every source's description of one group, once per task tick. A core source
    // answers its slots; an add-on asks for one task of its kind `addon:<name>` at `addon-task` in a
    // slot of its own name. An add-on answer of another kind is dropped and recorded. The core sources
    // ask first, in 01's declared order (rules.ts SOURCE_ORDER), then the add-ons in load order.
    taskRequests(view: unknown): { name: string; answers: { slot: string; ask: AddonTaskAsk | null; end: string }[] }[] {
      const list = ctx.answering('task.request'), rank = (name: string) => (SOURCE_ORDER as readonly string[]).indexOf(name);
      const core = list.filter(r => r.folder === 'core').sort((a, b) => rank(a.name) - rank(b.name));
      return [...core, ...list.filter(r => r.folder !== 'core')].map(r => {
        const answer: unknown = ctx.call(r, 'task.request', () => r.hooks['task.request']!(view, ctx.settings(r.name))) ?? null;
        if (r.folder === 'core') return { name: r.name, answers: (answer ?? []) as { slot: string; ask: AddonTaskAsk | null; end: string }[] };
        let ask = answer as (AddonTaskAsk & { groups?: unknown }) | null;
        if (ask && ask.kind !== `addon:${r.name}`) { ctx.record(r.name, 'task.request', `asked for the kind ${ask.kind}; its kind is addon:${r.name}`); ask = null; }
        // `groups` names group kinds the composition builds, or the answer is dropped.
        if (ask && ask.groups !== undefined && !(Array.isArray(ask.groups) && ask.groups.every(k => (GROUP_KINDS as readonly unknown[]).includes(k)))) {
          ctx.record(r.name, 'task.request', `named the groups ${JSON.stringify(ask.groups)}; a task runs in ${GROUP_KINDS.join(', ')}`); ask = null;
        }
        return { name: r.name, answers: [{ slot: r.name, ask: ask && { ...ask, tier: 'addon-task' as const }, end: 'released' }] };
      });
    },
    // The combat mode entry `mode` when an enabled add-on fills it: its answer for the group's
    // members, grouped or scatter. A core entry answers inline in the grouped queue, so null.
    combatMode(mode: string, members: unknown): 'grouped' | 'scatter' | null {
      const holder = ctx.slotHolder('combat-mode:' + mode), r = holder && ctx.registration(holder.name);
      const answer = r && r.folder === 'addons' && ctx.enabled(r.name) ? r.hooks['combat.mode'] : undefined;
      if (!r || !answer) return null;
      // An answer that throws counts as none, so the entry fights grouped, as an answer of nothing does.
      return ctx.call(r, 'combat.mode', () => answer(members, ctx.settings(r.name))) === 'scatter' ? 'scatter' : 'grouped';
    },
  };
}

// The hook coverage (addon:check rule 8):
// each decision of the files below with its hook or core-only reason, and each other export's plain kind.
export const RULE_FILES = ['runtime/tasks/rules.ts'] as const;
export const DECISIONS = {
  'which task holds a group': { at: 'runtime/tasks/rules.ts#judge', hook: 'task.request' },
  'the tier a task ranks at': { at: 'runtime/tasks/rules.ts#taskTier', core: 'tier-table', cite: 'runtime/protocol/ranks.ts:12' },
  'a group kind offers a task kind': { at: 'runtime/tasks/rules.ts#offers', hook: 'task.request' },
  'an add-on task keeps its group from a core task in the preempt band': { at: 'runtime/tasks/rules.ts#preemptAsked', hook: 'group.questions' },
  'a merchant visit or event attendance under a live task': { at: 'runtime/tasks/rules.ts#allows', hook: 'group.questions' },
  'a rare takes a group whose add-on task is live': { at: 'runtime/tasks/rules.ts#rareRefused', hook: 'group.questions' },
  'no party death recovery while a member is at an event': { at: 'runtime/tasks/rules.ts#deathRecoveryAllows', core: 'safety', cite: 'runtime/tasks/rules.ts:181' },
  'a target mode entry waits while another walk runs': { at: 'runtime/tasks/rules.ts#busy', core: 'tier-table', cite: 'runtime/protocol/ranks.ts:12' },
  'a walk waits during the Hunt hand-in': { at: 'runtime/tasks/rules.ts#walkAllowed', core: 'tier-table', cite: 'runtime/protocol/ranks.ts:12, hunt-turn-in 70 above addon-task 60' },
  'the Hunt\'s hand-in holds its group': { at: 'runtime/tasks/rules.ts#priority', core: 'tier-table', cite: 'runtime/protocol/ranks.ts:12' },
  'a player\'s or an escape\'s hold stops the console acting': { at: 'runtime/tasks/rules.ts#stopsActing', core: 'safety', cite: 'runtime/tasks/rules.ts:213' },
  'holds on a group or member': { site: 'runtime/tasks/coordinator/holds.ts:93', hook: 'group.hold' },
  'the task ladder\'s next rung': { at: 'runtime/tasks/rules.ts#nextRung', hook: 'task.alternative' },
  'the task ladder\'s safe point': { at: 'runtime/tasks/rules.ts#nextRung', hook: 'task.safePoint' },
  'where a left-out member waits': { site: 'runtime/tasks/coordinator/assignment.ts:58', hook: 'member.apart' },
  'an add-on task\'s interrupted, windDown, visit and reunion columns': { at: 'runtime/tasks/rules.ts#column', hook: 'task.request' },
  'a follower farms in its leader\'s scope': { at: 'runtime/tasks/rules.ts#scopeOwner', hook: 'settings.overlay' },
  'the groups a farming scope runs': { at: 'runtime/tasks/rules.ts#scopeGroups', hook: 'settings.overlay' },
  'grouped or scatter for an add-on combat mode': { site: 'runtime/hooks/rows/01-tasks.ts:126', hook: 'combat.mode' },
  'what the party fights for': { site: 'runtime/hooks/rows/01-tasks.ts:10', hook: 'target.mode' },
} satisfies Record<string, DecisionRow>;
export const PLAIN = {
  above: 'read', dueYields: 'read', reportChanged: 'read',
  validHandControl: 'validator', savedManual: 'validator',
} satisfies Record<string, PlainKind>;

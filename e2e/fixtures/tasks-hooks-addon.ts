// The groups and tasks owner's fixture add-on: one add-on
// that registers every 01 hook an add-on answers and hears every 01 notice, so
// e2e/live-tasks-hooks.spec.ts proves each `HOOKS` and `SLOTS` row is asked at its decision point or
// told at its change. Each answer stays unset until a row sets it through the route's `answers` op,
// so registering it changes no play. e2e/live-coordinator.cjs `/party-api/e2e-tasks-hooks` joins it to
// the live coordinator's registry, as the movement fixture does.
import type { AddonTaskAsk, Registration, TargetModeView } from '../../runtime/hooks/addon-api.ts';
import { keepCapped } from './hooks-fixture-kit.ts';

export const TASKS_HOOKS_ADDON = 'tasks-hooks-fixture';
export const TASK_KIND = `addon:${TASKS_HOOKS_ADDON}`;
// The two slot entries (01 contract part 4): an Achievements-like target mode entry and a combat mode.
export const TARGET_ENTRY = 'tasks-fixture', COMBAT_ENTRY = 'tasks-scatter';
export const NOTICES = ['task.started', 'task.suspended', 'task.resumed', 'task.ended', 'task.waiting', 'task.refused', 'task.phase', 'task.ladder',
  'task.invariant', 'task.due', 'group.changed', 'group.held', 'group.released', 'member.assigned', 'member.presence', 'status.changed', 'slot.changed'] as const;
type Point = { map: string; x: number; y: number };
// What a row sets: the add-on's task for a group, its alternative's goal, its safe point, a hold, a
// left-out member's wait point, a refused merchant visit, and the combat mode's answer.
export interface Answers { task?: { group: string; members: string[] }; alternative?: Point; safePoint?: Point; hold?: string;
  apart?: Point; refuseVisit?: boolean; combat?: 'grouped' | 'scatter' }
// One hook the add-on was asked or told, with what it was handed.
export interface Heard { hook: string; at: number; payload: Record<string, unknown> }
export interface FixtureState { heard: Heard[]; answers: Answers }

export function coordinatorRegistration(state: FixtureState): Registration {
  const hear = keepCapped(state.heard, 4000);
  const keep = (hook: string, payload: unknown) => hear({ hook, at: Date.now(), payload: (payload ?? {}) as Record<string, unknown> });
  const notices = Object.fromEntries(NOTICES.map(hook => [hook, (payload: unknown) => keep(hook, payload)]));
  return {
    name: TASKS_HOOKS_ADDON, folder: 'addons', author: 'e2e', taskTier: 'addon-task',
    summary: 'Answers every groups and tasks hook an add-on may answer, and hears every task notice.',
    slots: [
      { slot: 'target-mode', mode: TARGET_ENTRY, fills: 'choice', button: { label: 'Fixture', description: 'Farms goo through the add-on tick', color: 'slate' },
        status: { title: 'Tasks fixture', field: 'tasksFixtureMessage', idle: 'Idle' } },
      { slot: 'combat-mode', mode: COMBAT_ENTRY, fills: 'choice', button: { label: 'Fixture scatter', description: 'Answers the fixture combat mode', color: 'slate' } },
    ],
    hooks: {
      ...notices,
      'target.mode'(v: TargetModeView) {
        keep('target.mode', { owner: v.owner, targetMode: v.scope.targetMode });
        if (v.scope.targetMode !== TARGET_ENTRY) return undefined;
        // The selection takes the spawn the destination port names, as a target mode entry's tick does.
        const at = v.ports.destination('goo');
        if (v.store.tasksFixtureTarget !== 'goo' && at && v.ports.select('goo', at)) { v.store.tasksFixtureTarget = 'goo'; v.store.tasksFixtureMessage = 'Farming goo'; }
        return { target: 'goo' };
      },
      'target.settings'(v: TargetModeView) {
        const body = (v.body ?? {}) as { value?: unknown };
        keep('target.settings', { owner: v.owner, body });
        v.store.tasksFixtureValue = body.value;
        return { ok: true, reply: { tasksFixtureValue: v.store.tasksFixtureValue } };
      },
      'combat.mode'(members) { keep('combat.mode', { members }); return state.answers.combat ?? 'scatter'; },
      'task.request'(view) {
        const v = view as { group: string; members: string[]; live?: { kind?: string } };
        const task = state.answers.task;
        if (!task || task.group !== v.group) return undefined;
        keep('task.request', { group: v.group, live: v.live?.kind });
        // The owner keeps a live task's members (rule 2.3.1), so the owner names the member set and a
        // row that leaves a member out asks a new task.
        const ask: AddonTaskAsk = { kind: TASK_KIND, owner: `${TASK_KIND}:${task.members.join('+')}`, members: task.members, phase: 'walk', label: 'Fixture task',
          goal: state.answers.alternative ? undefined : { map: 'main', x: 0, y: 0 }, interrupted: 'suspend', windDown: 'none', visit: true, reunion: 'alone' };
        return ask;
      },
      'task.alternative'(view) { keep('task.alternative', view); return state.answers.alternative; },
      'task.safePoint'(view) { keep('task.safePoint', view); return state.answers.safePoint; },
      'group.questions'(view) {
        const v = view as { question: string };
        keep('group.questions', view);
        return state.answers.refuseVisit && v.question === 'merchant-visit' ? false : undefined;
      },
      'group.hold'(view) {
        const v = view as { group: string };
        keep('group.hold', view);
        return state.answers.hold === v.group ? { target: v.group, reason: 'the fixture holds its group' } : undefined;
      },
      'member.apart'(view) { keep('member.apart', view); return state.answers.apart ? { wait: state.answers.apart } : undefined; },
    },
  };
}

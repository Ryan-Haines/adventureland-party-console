// Dashboard and status's fixture add-on: one add-on that answers `status.line` and `status.report`, hears every 12
// notice and asks the three status reads, so e2e/live-status-hooks.spec.ts proves each `HOOKS` and
// `SLOTS` row of runtime/hooks/rows/12-status.ts at its decision point or its change. Its coordinator
// half (registered by e2e/live-coordinator.cjs's `/party-api/e2e-status-hooks`) keeps what it heard in
// memory; its character half answers `status.report` with one field under its own name and reads its
// own ring, `trail` (the `diagnostics-ring` slot). With nothing set, its line answers nothing, and its
// ring travels only while a diagnostics view leases it, so registering it changes no play.
import type { AddonTaskAsk, Registration } from '../../runtime/hooks/addon-api.ts';
import { keepCapped, switches } from './hooks-fixture-kit.ts';

export const STATUS_HOOKS_ADDON = 'status-hooks-fixture';
export const STATUS_NOTICES = ['status.lineChanged', 'status.received', 'status.replied', 'dashboard.command', 'dashboard.opened',
  'dashboard.closed', 'diagnostics.leased', 'diagnostics.released', 'app.keyIssued', 'app.keyRevoked', 'app.used'] as const;
export const STATUS_LINE = 'fixture line';
export const REPORT_FIELD = 'fixtureSeen';
// The label of the add-on task the table runs: the warrior's card line names it.
export const STATUS_TASK_LABEL = 'Status fixture task';
export const FIXTURE_RING = { key: 'trail', ring: 'status-hooks-fixture.trail', label: 'Fixture trail' } as const;
export interface Heard { hook: string; at: number; payload: Record<string, unknown> }
export interface StatusHooksState { heard: Heard[]; line: string | null; task: boolean }

// The coordinator half: every notice is one heard entry, `status.line` answers the line the table
// sets for its character, and while the table sets `task` it asks one add-on task for the group, so
// table L's own line changes to the task's label.
export function coordinatorRegistration(state: StatusHooksState): Registration {
  const hear = keepCapped(state.heard, 2_000);
  return {
    name: STATUS_HOOKS_ADDON, folder: 'addons', author: 'e2e', taskTier: 'addon-task',
    summary: 'Hears every dashboard and status notice, adds one card line and runs one task when asked.',
    rings: { [FIXTURE_RING.key]: { label: FIXTURE_RING.label } },
    hooks: {
      ...Object.fromEntries(STATUS_NOTICES.map(hook => [hook, (payload: unknown) => hear({ hook, at: Date.now(), payload: (payload ?? {}) as Record<string, unknown> })])),
      'status.line': (ask: { character: string; line: string }) => state.line ? { label: `${state.line} (${ask.character})` } : undefined,
      'task.request'(view) {
        const v = view as { members: string[] };
        if (!state.task) return undefined;
        const ask: AddonTaskAsk = { kind: `addon:${STATUS_HOOKS_ADDON}`, owner: `addon:${STATUS_HOOKS_ADDON}:1`, members: v.members, phase: 'walk',
          label: STATUS_TASK_LABEL, goal: { map: 'main', x: 0, y: 0 }, interrupted: 'suspend', windDown: 'none', visit: true, reunion: 'alone' };
        return ask;
      },
    },
  };
}

// Page source: the character half answers `status.report` with one field under its own name, and its
// ring's read answers the time of each read.
export const registerCharacterHalf = `(()=>{const hooks=globalThis.__partyHooks,name=${JSON.stringify(STATUS_HOOKS_ADDON)};
  if(hooks.registrations().some(r=>r.name===name))return {ok:true};
  return hooks.register({name,folder:'addons',author:'e2e',summary:'Reports one field under its own name.',
    rings:{${FIXTURE_RING.key}:{label:${JSON.stringify(FIXTURE_RING.label)},read:()=>({records:[{readAt:Date.now()}]})}},
    hooks:{'status.report':()=>({${REPORT_FIELD}:Date.now()})}});})()`;
// The saved add-on switches with this add-on on or off, from the character's own registry.
export const statusHooksSwitches = (enabled: boolean) => switches(STATUS_HOOKS_ADDON, enabled);

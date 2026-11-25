// The settings owner's fixture add-on: an add-on with one `character`, one
// `per-character` and one `number` setting, the kinds the removed fork add-ons held, one target mode
// entry, `kinds`, whose settings call accepts every body, so the slot rows have an add-on entry that
// names no real add-on, and a listener for every
// settings notice, so e2e/live-settings-hooks.spec.ts reads what each change told.
// e2e/coordinator.cjs registers it on the coordinator's registry when the scenario sets
// `fixtureAddon`, so the add-on route's checks of each kind and its audit line run with no
// add-on folder installed in runtime/addons/, and its route `/party-api/e2e-settings-hooks` hands
// the table what the add-on heard and the answers of its asks.
import type { SettingsChange } from '../../runtime/hooks/addon-api.ts';

export const SETTINGS_KINDS_ADDON = 'settings-kinds-fixture';
export const SETTINGS_KINDS_MODE = 'kinds';
// The settings notices, each kept in the coordinator's process with its payload.
export const SETTINGS_NOTICES = ['settings.changed', 'settings.refused', 'settings.imported', 'settings.saved'] as const;
export interface Heard { hook: string; at: number; payload: Record<string, unknown> & { by?: string; field?: string } }
// What the table asks the add-on to write: its own setting, or a core one as `console:<name>`.
export type FixtureWrite = { changes: SettingsChange[]; by: string };

const heard = (): Heard[] => ((globalThis as { __settingsHooksFixture?: { heard: Heard[] } }).__settingsHooksFixture ||= { heard: [] }).heard;
const keep = (hook: string) => (payload: Heard['payload']) => {
  const list = heard();
  list.push({ hook, at: Date.now(), payload });
  if (list.length > 2000) list.shift();
};

export const settingsKindsAddon = {
  name: SETTINGS_KINDS_ADDON, folder: 'addons' as const, author: 'e2e',
  summary: 'Holds a character, a per-character and a number setting, and hears every settings notice.',
  settings: {
    member: { label: 'Member', kind: 'character' as const, default: null },
    roles: { label: 'Roles', kind: 'per-character' as const, choices: ['near', 'far'], default: {} },
    limit: { label: 'Limit', kind: 'number' as const, min: 0, max: 100, default: 3 },
  },
  slots: [{ slot: 'target-mode' as const, mode: SETTINGS_KINDS_MODE, fills: 'choice' as const,
    button: { label: 'Kinds', description: 'The settings rows\' fixture entry', color: 'slate' as const },
    status: { title: 'Kinds fixture', field: 'kindsMessage', idle: 'Idle' } }],
  hooks: {
    'target.mode': () => undefined,
    'target.settings': () => ({ ok: true as const, reply: {} }),
    ...Object.fromEntries(SETTINGS_NOTICES.map(hook => [hook, keep(hook)])),
  },
};

// The route's answers (e2e/coordinator.cjs): what the add-on heard from `since` on.
export const heardSince = (since: number): Heard[] => heard().filter(h => h.at >= since);

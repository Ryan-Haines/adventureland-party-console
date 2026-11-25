// The saved fields of dashboard and status, its declarations for the settings owner, which
// builds its table from them at load.
// They moved from the held block runtime/settings/held/12-dashboard.ts with no change to a
// field.
import { text, boolean, listOf, type Declarations } from '../settings/api.ts';

export const statusSavedFields = {
  name: 'core:status',
  settings: {
    // Each refusal is b9b5c91e's preferences route wording (http/dashboard-import.ts:90, :92).
    bankboiPrefix: { label: 'BankBoi name prefix', kind: 'text', default: '', importable: true, check: v => text(v) && (v === "" || /^[A-Za-z0-9_]{3,11}$/.test(v as string)),
      refusal: 'Use 3–11 letters, numbers, or underscores', deliver: ['dashboard'] },
    anniversaryAutoChat: { label: 'Anniversary auto chat', kind: 'boolean', default: false, importable: true, check: boolean, refusal: 'Invalid chat setting', deliver: ['dashboard'] },
    // The settings the player locked against apps. The settings owner's writer refuses an app key's write to a
    // listed field, and to this list itself, so only the player changes who may change what.
    appLocks: { label: 'Settings locked against apps', kind: 'value', default: [] as string[], check: listOf(text), deliver: ['dashboard'] },
  },
  records: {
    // Table K's app keys (coordinator/apps.ts): each key's name, scopes, switch, last use and
    // revoke, and its SHA-256, never the key. Nothing delivers it; the key screen reads its route.
    appKeys: { default: [] },
    characterSnapshots: { default: {}, document: 'roster', deliver: ['dashboard'] },
    characterAppearances: { default: {}, document: 'roster', deliver: ['dashboard'] },
    steamSwitch: { default: null, document: 'roster' },
    // The history document (persistence/snapshots.ts `historySnapshot`), newest 500 each.
    merchantActivity: { default: [], document: 'history', deliver: ['dashboard-core'] },
    combatLogs: { default: {}, document: 'history', deliver: ['dashboard-core'] },
  },
} satisfies Declarations;

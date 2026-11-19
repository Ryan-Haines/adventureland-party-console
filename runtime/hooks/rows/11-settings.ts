// Owner 11's rows of the hook table: settings. Only 11's build writes this file;
// runtime/hooks/registry.ts composes every owner's file into one `HOOKS` and one `SLOTS`.
import { doorOnly, readsOf, type DecisionRow, type PlainKind } from './row.ts';
import type { DispatchContext, HookRow, ReadRow, SlotRow } from '../registry.ts';
import type { SettingsRead, SettingsWrite, SettingsWriteResult } from '../../settings/api.ts';

export const HOOKS = {
  // A target mode entry's own settings, kept in the scope's add-on store: the player's change,
  // or whether the entry can start now (`action: 'available'`).
  'target.settings': { kind: 'request', side: 'coordinator', part: 'settings (11), a target mode add-on', answers: 'slot', addonMayAsk: false,
    fixture: "e2e/live-tasks-hooks.spec.ts#L: the entry's settings route writes its scope store",
    receives: "the scope's add-on store, the scope and the player's change", returns: 'the reply, or an error in plain words' },
  // The settings owner's hooks. The coordinator's settings install answers the two requests with
  // the one writer; a character's install refuses every write
  // (runtime/settings/character/install.ts).
  'settings.write': { kind: 'request', side: 'both', part: 'settings (11), the one writer', answers: 'one', core: true, addonMayAsk: false,
    fixture: 'e2e/live-settings-hooks.spec.ts#L: the add-on writes its own setting, then a core one as console:<name>',
    receives: 'a batch of changes, its source and an optional basis', returns: 'ok with the changed fields, or the refused field and why' },
  'settings.read': { kind: 'request', side: 'both', part: 'settings (11)', answers: 'one', core: true, addonMayAsk: true,
    fixture: 'e2e/live-settings-hooks.spec.ts#L: the add-on reads its own setting and a core one',
    receives: 'a field, with a character for a per-character or scoped field', returns: 'the value' },
  'settings.changed': { kind: 'notice', side: 'coordinator', part: 'settings (11)', answers: 'many', 
    fixture: 'e2e/live-settings-hooks.spec.ts#L: a route write, then the same write again: one notice, then none',
    receives: 'field, character, addon and key for an add-on setting, old, new (none for a secret), by', returns: 'nothing' },
  // Every declared field in one pass: the lifecycle owner's start reads the defaults from it. An add-on reads
  // values through `settings.read`.
  'settings.declared': { kind: 'request', side: 'coordinator', part: 'settings (11), the declaration table', answers: 'one', core: true, addonMayAsk: false,
    fixture: 'scripts/tests/hook-registry.test.cjs#X1: the start reads every declared default in one pass',
    receives: 'nothing', returns: 'each declared field with its owner, a fresh copy of its default, its range, its scope and whether it is hidden' },
  // P1: an enabled add-on's value for one
  // read of a player's setting it lists in `overlays`. Decisions on the coordinator read through
  // settings/api.ts `played`, and the characters' delivered copy carries the same value.
  'settings.overlay': { kind: 'request', side: 'both', part: "settings (11), the player's values", answers: 'many', addonMayAsk: false,
    fixture: "scripts/tests/hook-registry.test.cjs#P1: an add-on overlays the event order for play while the saved value stays the player's",
    receives: "the field, the character a per-character read is for, and the player's saved value", returns: "a value for this read, or nothing for the player's",
    bound: "one add-on per field (a second is refused at load); the value passes the field's own check, or the player's value plays and the error is recorded; " +
      "it is never saved, so switching the add-on off plays the player's value on the next read; a record, a credential, the hand controls and the add-on switches take none, " +
      "and an add-on that names one is refused at load; the setting's control keeps the player's value with the line 'Overlaid by <add-on> while it is on' beside it" },
  // P1's check, which core:settings answers on the coordinator with the declaration table.
  'settings.accepts': { kind: 'request', side: 'both', part: "settings (11), the one writer's check", answers: 'one', core: true, addonMayAsk: false,
    fixture: "scripts/tests/hook-registry.test.cjs#P1: an add-on overlays the event order for play while the saved value stays the player's",
    receives: "a field and an add-on's value", returns: 'why the field refuses it, or nothing' },
  // A write the writer refused, with the field and why.
  'settings.refused': { kind: 'notice', side: 'coordinator', part: 'settings (11)', answers: 'many', 
    fixture: 'e2e/live-settings-hooks.spec.ts#L: a value out of range is refused, naming the field',
    receives: 'field, character, error, reason, by', returns: 'nothing' },
  // An import's applied settings and records, which the records' changes send no other notice for.
  'settings.imported': { kind: 'notice', side: 'coordinator', part: 'settings (11)', answers: 'many', 
    fixture: 'e2e/live-settings-hooks.spec.ts#L: an import applies its settings and records',
    receives: "the fields, the characters and the skipped characters; by 'import'", returns: 'nothing' },
  // A saved document's write to the journal, a record's included.
  'settings.saved': { kind: 'notice', side: 'coordinator', part: 'settings (11)', answers: 'many', 
    fixture: 'e2e/live-settings-hooks.spec.ts#L: a write reaches the disk and survives a restart',
    receives: "the document; by 'persistence'", returns: 'nothing' },
} as const satisfies Record<string, HookRow>;

// C3's tables (addon-capabilities.md "The completeness rule"): each export of the settings owner's doors is a
// read an add-on may ask, or a write, a port or a command only core calls.
const SETTINGS = 'runtime/settings/api.ts', SETTINGS_COORDINATOR = 'runtime/settings/coordinator/api.ts';
export const READS = {
  ...readsOf('settings', 'both', SETTINGS, { ADDON_KINDS: "string[]", SETTING_KINDS: "string[]", SETTING_SCOPES: "string[]", SETTING_DOCUMENTS: "string[]", DELIVERIES: "string[]", object: "boolean", addonSettingProblem: "string | undefined", valueProblem: "string | undefined", list: "boolean", text: "boolean", number: "boolean", boolean: "boolean", mapOf: "a value check", listOf: "a value check", item: "boolean", mark: "boolean", positive: "boolean", wholeFrom: "a value check", settingsDraft: "the dashboard's settings draft", addonValues: "the add-on's values for a scope", played: "the field's value as played", playedIn: "the record's value as played" }),
  ...readsOf('settings', 'coordinator', SETTINGS_COORDINATOR, { coordinatorSettings: "the settings table", hiddenValue: "boolean", modeSlot: "the mode slot's entry", snapshotSaveDue: "boolean", selectSnapshot: "the snapshot to restore", initialMerchantRuntime: "the merchant's initial state", initialGatheringState: "gathering's initial state", initialEventState: "the events' initial state", initialCommandState: "the commands' initial state", initialRecoveryState: "recovery's initial state", createInitialCoordinatorState: "the coordinator's initial state", initialMerchantSales: "the merchant sales' initial state" }),
  // `settings.declared` is the hook name, so the read of the export behind it takes its own.
  'settings.declaredTable': { side: 'coordinator', type: 'the declared settings', door: `${SETTINGS_COORDINATOR}#declared` },
  ...readsOf('settings', 'both', 'runtime/settings/rules.ts', { rangeOf: "the setting's range" }),
} as const satisfies Record<string, ReadRow>;
export const DOOR_ONLY = {
  ...doorOnly(SETTINGS, 'port', ['readOverlaysWith']),
  ...doorOnly('runtime/settings/character/api.ts', 'port', ['installCharacterSettings']),
  ...doorOnly(SETTINGS_COORDINATOR, 'port', ['CoordinatorJsonlStore', 'createSettingsRoutes', 'installCoordinatorSettings', 'readLegacyStorage', 'createFormationRoute', 'createCoordinatorDashboardImport', 'createThresholdRoute']),
  ...doorOnly(SETTINGS_COORDINATOR, 'write', ['migrateCoordinatorLegacyStorage', 'synchronizeStorage', 'initializeCoordinatorState']),
};

export const SLOTS = {} as const satisfies Record<string, SlotRow>;

// The registry's dispatch of the settings owner's rows.
export function dispatch(ctx: DispatchContext) {
  return {
    // The settings owner's two requests. core:settings answers both in each
    // realm, so neither has a fallback.
    write(batch: SettingsWrite): SettingsWriteResult {
      return ctx.one('settings.write').hooks['settings.write']!(batch);
    },
    read(query: SettingsRead): unknown { return ctx.one('settings.read').hooks['settings.read']!(query); },
    // P1: the value one read of `field` plays with. With no enabled add-on listing the field, or an
    // answer of nothing, it is the player's value. A value core:settings refuses, or a realm with no
    // core:settings to check it, plays the player's value and records the refusal.
    overlay(field: string, value: unknown, character?: string): unknown {
      const r = ctx.answering('settings.overlay').find(o => o.overlays?.includes(field));
      if (!r) return value;
      const answer = ctx.call(r, 'settings.overlay', () => r.hooks['settings.overlay']!({ field, ...(character ? { character } : {}), value }, ctx.settings(r.name)));
      if (answer === undefined) return value;
      const check = ctx.answering('settings.accepts')[0];
      const problem = check ? check.hooks['settings.accepts']!(field, answer) : 'no settings owner checks it here';
      if (problem) { ctx.record(r.name, 'settings.overlay', `${field}: ${problem}`); return value; }
      return answer;
    },
    // Each overlaid field and the enabled add-on that answers it, for the dashboard's line.
    overlays(): Record<string, string> {
      return Object.fromEntries(ctx.answering('settings.overlay').flatMap(r => (r.overlays ?? []).map(field => [field, r.name])));
    },
  };
}

// The hook coverage (addon:check rule 8):
// each decision of the files below with its hook or core-only reason, and each other export's plain kind.
export const RULE_FILES = ['runtime/settings/rules.ts'] as const;
export const DECISIONS = {
  'a write is accepted': { at: 'runtime/settings/rules.ts#accepts', core: 'integrity', cite: 'runtime/settings/rules.ts:69; an add-on field brings its own check' },
  'declaration problems at load': { at: 'runtime/settings/rules.ts#declarationProblem', core: 'integrity', cite: 'runtime/settings/rules.ts:43' },
  'an add-on\'s setting declarations': { at: 'runtime/settings/rules.ts#addonSettingProblem', core: 'integrity', cite: 'runtime/settings/rules.ts:88' },
  'the settings table': { at: 'runtime/settings/rules.ts#buildSettingsTable', core: 'integrity', cite: 'runtime/settings/rules.ts:119' },
  'an imported item collection threshold past the bag reads as the bag': { site: 'runtime/items/saved-fields.ts:72', core: 'game', cite: 'runtime/items/rules.ts:124, BASE_INVENTORY_SIZE 42' },
  'an add-on setting\'s import fit': { site: 'runtime/settings/coordinator/persistence/dashboard-import.ts:119', core: 'integrity', cite: 'runtime/settings/rules.ts:38, the add-on declares its own fit, and the writer still checks the kind and its check' },
  "an add-on value for a player's setting is accepted": { at: 'runtime/settings/rules.ts#overlayProblem', core: 'integrity', cite: "runtime/settings/rules.ts:109, the field's own check, as a write runs it" },
  'a field an add-on may overlay': { at: 'runtime/settings/rules.ts#overlayFieldProblem', core: 'integrity', cite: 'runtime/settings/rules.ts:117, the add-on load rule: no hand control, switch, credential or record' },
  'a target mode entry\'s settings reply': { site: 'runtime/hooks/rows/11-settings.ts:9', hook: 'target.settings' },
} satisfies Record<string, DecisionRow>;
export const PLAIN = {
  object: 'read', rangeOf: 'read',
} satisfies Record<string, PlainKind>;

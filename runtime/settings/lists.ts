// The lists the coordinator builds from the declaration table. Each replaces a hand-kept list of
// saved fields, so a new saved field is one declaration. The lists keep the table's order: the
// declarers' order, then each declarer's own.
import { accepts, rangeOf, type SettingsTable } from './rules.ts';
import type { DELIVERIES, DeclaredSetting } from './api.ts';

type Delivery = (typeof DELIVERIES)[number];

export type DocumentName = 'settings' | 'selections' | 'roster' | 'bank' | 'history';

export function settingsLists(table: SettingsTable) {
  const all = [...table.fields.values()];
  // A profile-only field is saved inside each farming profile, never at the top of a document.
  const inDocument = (name: DocumentName) => all.filter(d => (d.setting.document ?? 'settings') === name && !d.setting.profileOnly).map(d => d.field);
  const scoped = all.filter(d => d.setting.scope === 'scope');
  // A derived record has no value of its own to start from: its scope computes it.
  const derived = scoped.flatMap(d => d.record && d.setting.derive ? [{ field: d.field, derive: d.setting.derive }] : []);
  const delivered = (to: Delivery) => all.filter(d => d.setting.deliver?.includes(to));
  return {
    settingsFields: inDocument('settings'),
    selectionFields: inDocument('selections'),
    rosterFields: inDocument('roster'),
    bankFields: inDocument('bank'),
    // Records whose frequent changes are timestamps (persistence/writer.ts, the hidden setting settingsLivenessMs).
    livenessFields: new Set(all.filter(d => d.record && d.setting.liveness).map(d => d.field)),
    // The fields each farming scope keeps its own copy of (runtime/tasks/coordinator/groups.ts).
    scopedFields: scoped.map(d => d.field),
    // A new or incomplete farming profile's values: a fresh copy of each scoped default, so no
    // profile shares an object with another or with its declaration.
    scopeDefaults: (): Record<string, unknown> => Object.fromEntries(scoped.filter(d => !(d.record && d.setting.derive))
      .map(d => [d.field, structuredClone(d.setting.default)])),
    // The records each farming scope derives from its own fields (runtime/tasks/coordinator/groups.ts).
    derivedFields: derived,
    // The saved fields each character's heartbeat reply carries raw, with the reply's name for each.
    characterFields: delivered('characters').map(d => ({ field: d.field, reply: d.setting.reply ?? d.field })),
    // The saved fields of the dashboard's `config` section and of its live `core` section.
    dashboardFields: delivered('dashboard').map(d => d.field),
    dashboardCoreFields: delivered('dashboard-core').map(d => d.field),
  };
}

// Every declared field in one pass, for the lifecycle owner's start: each entry is what
// `savedOrDefault` gives a field with no saved copy, with the declaration's range, scope and
// `hidden`.
export function declaredSettings(table: SettingsTable): DeclaredSetting[] {
  return [...table.fields.values()].map(({ field, owner, record, setting }) => {
    const range = record ? {} : { ...rangeOf(setting), hidden: setting.hidden };
    return { field, owner, record, default: structuredClone(setting.default), scope: setting.scope, ...range };
  });
}
// A value's shape, for the load's reset below: null, a list, or its JavaScript type.
const shapeOf = (value: unknown) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
// The saved value of a declared field, or a fresh copy of its default when the save has none.
// `saved` lists the field's saved copies, newest layout first: a selection-document field's own
// document, then the settings document a layout before the selections document held it in. An
// absent or null copy counts as none. So does a copy of another shape than a non-null default,
// and a setting's copy that its kind refuses: v1.5.0's load reset each wrong type to
// its default (initial-state.ts `autoStandBuys === true`, merchant/initial-settings.ts
// `Array.isArray(settings.npcSaleMarks)`). The load runs no declared value check, since the
// v1.5.0's load read every value of the right type as saved (the load keeps every value
// v1.5.0 loaded).
export function savedOrDefault(table: SettingsTable, field: string, saved: readonly unknown[]): unknown {
  const declared = table.fields.get(field);
  if (!declared) throw Error(`${field} is not a declared saved field`);
  const { setting } = declared, shape = setting.default === null || setting.default === undefined ? undefined : shapeOf(setting.default);
  const takes = (value: unknown) => (shape === undefined || shapeOf(value) === shape) &&
    (declared.record || accepts({ ...declared.setting, check: undefined }, declared.setting, value));
  for (const value of saved) if (value !== undefined && value !== null && takes(value)) return value;
  return structuredClone(setting.default);
}

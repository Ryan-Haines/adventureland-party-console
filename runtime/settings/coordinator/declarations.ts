// The settings owner's own saved fields: the add-on
// switches and settings, which the player chooses; the add-on stores, which the add-ons write
// from play; and the writer's own records, the time of each setting's last change and the audit
// lines. `settingsDeclarations` is every declarer the coordinator has: the settings owner's own fields,
// and each owner's saved fields from its own registration (`settings.declare` is load data, 1.4).
// Every owner is built, so 11 holds no block for another (6.2).
import { mapOf, object, text, wholeFrom, type Declarations } from '../api.ts';
import type { SettingsLine } from './writer.ts';
import { tasksSavedFields } from '../../tasks/coordinator/saved-fields.ts';
import { merchantJobsSavedFields } from '../../merchant-jobs/coordinator/saved-fields.ts';
import { eventsSavedFields } from '../../events/saved-fields.ts';
import { huntingSavedFields } from '../../hunting/saved-fields.ts';
import { itemsSavedFields } from '../../items/saved-fields.ts';
import { lifecycleSavedFields } from '../../lifecycle/fields.ts';
import { statusSavedFields } from '../../status/fields.ts';
import { merchantRealmSavedFields } from '../../merchant-realm/coordinator/saved-fields.ts';
import { movementSavedFields } from '../../movement/saved-fields.ts';
import { turnsSavedFields } from '../../characters/turns/saved-fields.ts';
import { survivalSavedFields } from '../../characters/survival/saved-fields.ts';
import { targetingSavedFields } from '../../characters/targeting/saved-fields.ts';
import { farmingPolicyOf } from './slots.ts';

// A whole number from `min` up.
const whole = (min: number) => ({ kind: 'value' as const, check: wholeFrom(min, Infinity) });

const settingsOwn = {
  name: 'core:settings',
  settings: {
    addons: { label: 'Add-ons', kind: 'value', default: {}, deliver: ['characters'], noOverlay: true,
      check: value => object(value) && Object.values(value).every(state => object(state) &&
        (state.enabled === undefined || typeof state.enabled === 'boolean') && (state.settings === undefined || object(state.settings))) },
    // Each character's pick in the routine slots, by character and slot, as
    // `{W: {formation: 'my-addon-entry'}}`. A character with no pick, or a pick no enabled add-on
    // fills, runs the built-in routine; the pick stays saved while its add-on is off.
    routines: { label: 'Routine picks', kind: 'value', default: {} as Record<string, Record<string, string>>, scope: 'character', noOverlay: true,
      check: mapOf(mapOf(text)), deliver: ['characters'] },
    // An add-on's settings placed per farming scope, by add-on and key, in each farming
    // profile; it moves with the profile on a leader change. The writer checks each value by its
    // add-on's declared kind (addressed changes, writer.ts).
    addonSettings: { label: 'Add-on settings per farming scope', kind: 'value', default: {}, noOverlay: true, scope: 'scope', profileOnly: true, importable: true,
      check: value => object(value) && Object.values(value).every(object) },
    // The persistence windows: picks kept at
    // b9b5c91e's values, since no game fact or progress rule sets a save cadence. The persistence
    // reads each through table.ts `hiddenValue` when its window starts.
    // History lines arrive several a second and each save rewrites the history document, so this
    // trades the crash window against write volume.
    historySaveMs: { label: 'History save window (ms)', ...whole(1), default: 5000, hidden: true },
    // A settings save whose only changes are liveness timestamps waits this long after the last.
    settingsLivenessMs: { label: 'Liveness save window (ms)', ...whole(1), default: 30000, hidden: true },
    // A refreshed character snapshot with no inventory change saves at most this often; an
    // inventory change saves at once.
    rosterSnapshotSaveMs: { label: 'Roster snapshot save window (ms)', ...whole(1), default: 300_000, hidden: true },
    // The newest entries each history list keeps, for its readers: merchant activity, the
    // combat logs and the settings audit lines.
    historyKept: { label: 'History entries kept', ...whole(1), default: 500, hidden: true },
    // Settings changes coalesce into one save this long after the first. A save after each request
    // wrote 1.185 MB/s against b9b5c91e's 0.724 in the production benchmark, so the window
    // stays.
    settingsSaveDelayMs: { label: 'Settings save delay (ms)', ...whole(1), default: 1000, hidden: true },
  },
  records: {
    // The add-on stores by store key (runtime/hooks/store.ts): each character's own and the party's,
    // each key with its revision. A scope store's values are `addonFarming` below.
    addonStores: { default: {} },
    // Each add-on's scope store per farming scope (runtime/hooks/store.ts `scope:<owner>`), which the
    // target mode routes and `addon.command` write.
    addonFarming: { default: {}, scope: 'scope', profileOnly: true },
    // When each setting last changed, by field and by field and character, for a write's basis.
    settingsChangedAt: { default: {} as Record<string, number> },
    // The single farming mode each scope's pair derives (slots.ts): every save carries it for a
    // v1.4.0 build, which reads only it, and the dashboard's one mode selector shows it
    // for the apps (the status owner's interface v1). The start's migration reads the saved copy.
    farmingPolicy: { default: 'auto', scope: 'scope', derive: farmingPolicyOf, deliver: ['dashboard'] },
    // The audit lines, the newest `historyKept`, read through the full state route until 12 shows them.
    settingsChanges: { default: [] as SettingsLine[], document: 'history', deliver: ['dashboard-core'] },
  },
} satisfies Declarations;

export const settingsDeclarations = [settingsOwn, tasksSavedFields, movementSavedFields, turnsSavedFields, survivalSavedFields, targetingSavedFields, merchantJobsSavedFields, merchantRealmSavedFields, eventsSavedFields, huntingSavedFields, itemsSavedFields, lifecycleSavedFields, statusSavedFields] as const;

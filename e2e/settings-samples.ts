// A valid value other than the default for every declared setting, for the rows that save each setting and read it back.
// Each value is one its field's declared check accepts and its owner's load keeps as it is, so a
// value that comes back different was lost or rewritten on the way. A setting declared later with
// no value here fails `settingSamples`, so the rows cover it with no other change.
import { coordinatorSettings } from '../runtime/settings/coordinator/table';
import { SETTINGS_KINDS_ADDON } from './fixtures/settings-hooks-addon';

const item = (name: string) => ({ name });
const fixed: Record<string, unknown> = {
  addons: { [SETTINGS_KINDS_ADDON]: { enabled: false, settings: {} } },
  leader: 'W',
  // A pick names a slot and the add-on entry that fills it; a pick no enabled add-on fills stays saved.
  routines: { W: { formation: 'settings-kinds-fixture' } },
  followers: { P: false },
  handControlByCharacter: { W: { on: false, usePotions: true, combat: true, party: 'carries-on' } },
  monsterPrioritiesByCharacter: { W: { goo: 2 } },
  eventsByCharacter: { W: false },
  // The selection migration (characters/migrate-selections.ts) gives P its saved default.
  eventSelectionsByCharacter: { W: ['goobrawl'], P: ['anniversary'] },
  eventPrioritiesByCharacter: { W: ['goobrawl', 'crabxx'] },
  eventLimitsByCharacter: { W: { goobrawl: { deathLimit: 2, timeLimitMinutes: 15 } } },
  combatMode: 'scatter',
  targetMode: 'hunt',
  // passiveRareHunts is the switches passiveHunting commits (runtime/hunting/saved-fields.ts
  // committedPassiveRules), so the two samples agree.
  passiveHunting: { version: 1, useFieldGenerators: false, rules: { phoenix: { enabled: true, keepMoving: false, priority: 100, maxLevel: -1 } } },
  passiveRareHunts: { phoenix: true },
  phoenixRouteOrder: ['main', 'halloween'],
  monsterSearchRadiusByCharacter: { W: 300 },
  merchantCharacter: 'P',
  merchantForceStand: true,
  merchantHomeReportMs: 16000,
  merchantStandLocation: { map: 'main', x: -120, y: 40 },
  gatheringModes: ['fishing'],
  goldTargets: { W: 5 },
  threshold: 250000,
  itemCollectionThreshold: 5,
  buyUpgradeBatchSize: 3,
  upgradeOfferingRules: [{ id: 'planted-rule', name: 'wbook0', floor: 0, ceiling: 3, offering: 'offering', required: false }],
  merchantRules: { version: 1, owner: 'M', members: ['W'], backup: null, conflicts: [] },
  autoDeconstruction: { W: { wbook0: { item: item('wbook0') } } },
  autoNpcSales: { hpbelt: { item: item('hpbelt'), keep: 1 } },
  autoStandMarks: { ringsj: { item: item('ringsj'), price: 5000 } },
  autoExchanges: { candy0: item('candy0') },
  autoItemMarks: { W: { hpamulet: 'bank' } },
  autoStandBuys: true,
  relocateIfCompeting: false,
  autoBlacklistMerchants: false,
  marketIgnoredItems: [{ name: 'wbook0', level: 2 }],
  restockPolicies: { W: { hp: { item: 'hpot0', min: 10, max: 50 }, mp: { item: 'mpot0', min: 10, max: 50 } } },
  merchantWeapon: { item: { name: 'dartgun', level: 3 }, slot: 'mainhand' },
  bankSortMode: 'request',
  aldataKey: 'planted-aldata-key',
  movementStuckNoticeMs: 7000,
  movementClickWaitMs: { W: 2500 },
  // Movement's settings: two the player sees, the rest hidden.
  reportFreshMs: 3500, movementPlanningMs: 40000, reportPresenceMs: 11000, reportRecentMs: 6000, errandTargetReportMs: 16000,
  movementAlclientPlanMs: 2500, movementPlannerPrepareMs: 11000,
  // The settings owner's persistence windows, hidden: the save and read
  // back go through the party's copy; the persistence reads the declarations.
  historySaveMs: 5500, settingsLivenessMs: 31000, rosterSnapshotSaveMs: 301000, historyKept: 501, settingsSaveDelayMs: 1100,
  // The turns owner's "Heal first below", per character.
  healFirstBelow: { W: 70 },
  // The survival owner's two potion lines, per character.
  hpPotionBelow: { W: 40 },
  mpPotionBelow: { W: 30 },
  // The targeting owner's two reflect lists, per character.
  reflectMagicByCharacter: { P: ['slenderman', 'sparkbot'] },
  reflectPhysicalByCharacter: { W: ['porcupine', 'armadillo'] },
  escapeResumeLockoutMs: 6000,
  consoleResumeWaitMs: 150000,
  bankboiPrefix: 'Planted',
  anniversaryAutoChat: true,
  // An add-on's settings per farming scope, by add-on and key (runtime/settings/coordinator/declarations.ts).
  addonSettings: { [SETTINGS_KINDS_ADDON]: { limit: 4 } },
  merchantRealmBlacklist: ['SR_EUI'],
  mailCheckSeconds: 45,
  protectedFreeSlots: 4,
  goldReserve: 25000,
  appLocks: ['goldReserve'],
};
// Settings whose value is a whole map of defaults: the sample is the default with one entry changed.
const changed: Record<string, (value: Record<string, unknown>) => Record<string, unknown>> = {
  huntSettings: value => ({ ...value, blacklistDeaths: !value.blacklistDeaths }),
  merchantRoutinePriorities: value => ({ ...value, fishing: 25 }),
  merchantAutomations: value => ({ ...value, deliveries: false }),
};

// A hidden whole number, an owner's window, bound or limit with no player meaning, takes its default
// plus one: the declared checks give these a lower bound only.
const hiddenNumber = (setting: { hidden?: boolean; default?: unknown }) =>
  setting.hidden && typeof setting.default === 'number' ? setting.default + 1 : undefined;

// The route that reads back each secret setting, which the settings route lists with no value,
// and the reply key that carries it.
export const secretReads: Record<string, { route: string; key: string }> = {
  aldataKey: { route: 'aldata/key', key: 'key' },
};

// Every declared setting with its sample, its document and its declared check.
export function settingSamples() {
  const rows = [];
  for (const d of coordinatorSettings().table.fields.values()) {
    if (d.record) continue;
    const value = d.field in changed ? changed[d.field]!(structuredClone(d.setting.default) as Record<string, unknown>) : fixed[d.field] ?? hiddenNumber(d.setting);
    if (value === undefined) throw Error(`The declared setting ${d.field} has no sample in e2e/settings-samples.ts`);
    rows.push({ field: d.field, value, document: d.setting.document ?? 'settings', setting: d.setting });
  }
  return rows;
}

// The declarations themselves, read apart from the lists the coordinator builds from them
// (runtime/settings/lists.ts), so a row that compares a save or a reply with these catches a
// list that drops or adds a field.
const declarations = () => [...coordinatorSettings().table.fields.values()];
export const declaredInDocument = (name: string) =>
  declarations().filter(d => (d.setting.document ?? 'settings') === name && !d.setting.profileOnly).map(d => d.field);
export const declaredFor = (to: 'characters' | 'dashboard' | 'dashboard-core') =>
  declarations().filter(d => d.setting.deliver?.includes(to)).map(d => ({ field: d.field, reply: d.setting.reply ?? d.field }));
export const unsetByDefault = () => declarations().filter(d => d.setting.default === undefined).map(d => d.field);
export const declaredImportable = () => declarations().filter(d => d.setting.importable).map(d => d.field);
export const declaredSettings = () => declarations().filter(d => !d.record).map(d => d.field);
// Settings left out of the player's list, which the coordinator still saves.
export const declaredHidden = () => declarations().filter(d => !d.record && d.setting.hidden).map(d => d.field);

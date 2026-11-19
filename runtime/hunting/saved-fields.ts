// The saved fields of hunts and farming (07), its declarations for the settings owner (11), which
// builds its table from them at load.
// They moved from the held block runtime/settings/held/07-hunts-and-farming.ts with no change
// to a field. The rules they declare (the passive rules, the Hunt settings' shape and the ranges)
// live in rules.ts, the browser-safe file api.ts publishes; this file holds the declarations and
// their checks, which the settings owner loads on the coordinator.
import { object, text, boolean, mapOf, listOf, type Declarations } from '../settings/api.ts';
import type { ReturnLocation } from '../events/api.ts';
import { zones, type Catalog } from './zones.ts';
import { DEFAULT_COMBAT_MODE, DEFAULT_TARGET_MODE, SEARCH_RADIUS_RANGE, NO_LEVEL_CAP, PASSIVE_PRIORITY_RANGE, committedPassiveRules,
  defaultHuntSettings, defaultPassiveRule, legacyPriorities, migratePassiveSettings, validHuntSettings, type HuntSettings,
  type PassiveRule, type PassiveSettings } from './rules.ts';
// hunt-settings-control.tsx imports the Hunt settings' shape from this file until the status owner's pass
// reads it from the door (api.ts); this line goes then.
export { defaultHuntSettings, validHuntSettings, type HuntSettings } from './rules.ts';

/**
 * A patrol order names every Phoenix region exactly once. The regions are the Phoenix spawn's
 * boundaries in game data (G.maps, through the spawn catalog), so the count follows the game
 *: five today. The order's declaration and the patrol's resume read it.
 */
export function validPhoenixOrder(catalog: Catalog | null | undefined, order: unknown): order is string[] {
  const all = zones(catalog || [], ['phoenix']);
  return all.length > 0 && Array.isArray(order) && order.length === all.length && new Set(order).size === all.length &&
    order.every(id => all.some(a => a.id === id));
}

// The farming selections the coordinator's record holds (coordinator/record.ts loadFarmingRecord): the
// focus, the per-character focus, priorities and search radius, and the two slot fields with the
// single mode a save before them held, which the start's migration reads (runtime/settings/coordinator/slots.ts).
export interface FarmingSelections {
  monsterFocus: string[];
  monsterFocusByCharacter: Record<string, string[]>;
  monsterPrioritiesByCharacter: Record<string, Record<string, number>>;
  monsterSearchRadiusByCharacter: Record<string, number>;
  combatMode: string;
  targetMode: string;
  farmingPolicy?: string;
}
// The same fields as a save holds them: a focus saved before it was a list is one id.
export interface SavedFarmingSelections {
  monsterFocus?: string[] | string | null;
  monsterFocusByCharacter?: FarmingSelections["monsterFocusByCharacter"] | null;
  monsterPrioritiesByCharacter?: FarmingSelections["monsterPrioritiesByCharacter"] | null;
  monsterSearchRadiusByCharacter?: FarmingSelections["monsterSearchRadiusByCharacter"] | null;
  combatMode?: string;
  targetMode?: string;
  farmingPolicy?: string;
  // The party's farming location, which the settings owner's start reads (initial.ts initialPartySelection).
  location?: ReturnLocation | null;
}
export interface HuntFailures {
  deaths: number;
  expirations: number;
}
export interface HuntFailureState {
  huntSettings?: HuntSettings;
  huntFailures?: Record<string, HuntFailures>;
  huntBlacklist?: Record<string, HuntBlacklistEntry> | null;
}
// A blacklist entry: why it joined (the death or expiration threshold, or the player's hand) and the
// counts it carries, which the dashboard's label reads. record.ts's load gives an older entry both.
// A death that blacklists names the characters and the time (coordinator/hunt.ts).
export interface HuntBlacklistEntry {
  monsterId: string; at: number; kind: 'deaths' | 'expirations' | 'manual'; deaths: number; expirations: number; reason?: string;
  characters?: string[]; lastDeathAt?: number;
}
const BOOLEAN_RULE_KEYS = ['enabled', 'keepMoving', 'interruptsHunt'];
function validRule(value: unknown): boolean {
  return object(value) && Object.entries(value).every(([key, v]) => {
    if (BOOLEAN_RULE_KEYS.includes(key)) return typeof v === 'boolean';
    if (key === 'maxLevel') return Number.isSafeInteger(v) && (v === NO_LEVEL_CAP || Number(v) > 0);
    return key === 'priority' && Number.isInteger(v) && Number(v) >= PASSIVE_PRIORITY_RANGE.min && Number(v) <= PASSIVE_PRIORITY_RANGE.max;
  });
}
// The rare hunting route's patch and the stored rules pass one check (`validPassive`): a
// rule per monster id (the field generator is no rare), the field generator switch, and the old
// switches by their rare's name.
export function validPassivePatch(value: unknown): boolean {
  return object(value) && Object.entries(value).every(([key, v]) => {
    if (key === 'useFieldGenerators') return typeof v === 'boolean';
    if (key === 'rules') return object(v) && Object.entries(v).every(([id, rule]) => /^[a-z0-9_]+$/i.test(id) && id !== 'fieldgen0' && validRule(rule));
    return Object.hasOwn(legacyPriorities, key) && typeof v === 'boolean';
  });
}
// The rules a patch leaves: an old switch sets its rare's `enabled`, a rule merges over the saved
// one, and the field generator switch replaces the saved one.
export function applyPassivePatch(settings: PassiveSettings, patch: Record<string, unknown>): PassiveSettings {
  const rules = { ...settings.rules };
  for (const [id, value] of Object.entries(patch))
    if (typeof value === 'boolean' && Object.hasOwn(legacyPriorities, id)) rules[id] = { ...defaultPassiveRule(id), ...rules[id], enabled: value };
  for (const [id, value] of Object.entries(object(patch.rules) ? patch.rules : {}))
    rules[id] = { ...defaultPassiveRule(id), ...rules[id], ...value as Partial<PassiveRule> };
  const useFieldGenerators = typeof patch.useFieldGenerators === 'boolean' ? patch.useFieldGenerators : settings.useFieldGenerators;
  return { ...settings, rules, useFieldGenerators };
}

// The search radius check over rules.ts SEARCH_RADIUS_RANGE, for a request and a stored value.
export function validSearchRadius(value: unknown): boolean {
  return Number.isFinite(Number(value)) && Number(value) >= SEARCH_RADIUS_RANGE.min && Number(value) <= SEARCH_RADIUS_RANGE.max;
}


const passive = migratePassiveSettings(undefined, {});
// The Hunt preferences a farming profile carries in the settings export, each with the check of
// its own declaration below (settings' persistence/dashboard-import.ts exports only these from a
// profile).
const huntBlacklist = mapOf(object);
const huntFailures = mapOf(v => object(v) && [v.deaths, v.expirations].every(n => Number.isSafeInteger(n) && Number(n) >= 0));
export const profilePreferenceChecks: Readonly<Record<string, (value: unknown) => boolean>> = { huntBlacklist, huntFailures, huntSettings: validHuntSettings };
const validProfile = (value: unknown) => object(value) && Object.entries(value).every(([key, entry]) => Object.hasOwn(profilePreferenceChecks, key) && profilePreferenceChecks[key]!(entry));
// The settings file carries a farming profile's Hunt preferences only, never its execution state.
function profilePreferences(value: unknown): unknown {
  if (!object(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([name, profile]) => [name,
    object(profile) ? Object.fromEntries(Object.keys(profilePreferenceChecks).filter(key => key in profile).map(key => [key, profile[key]])) : profile]));
}
// An imported profile merges into the saved one and keeps its property descriptors, so its derived
// `farmingPolicy` (runtime/tasks/coordinator/groups.ts) still follows the profile's own pair.
function importedProfiles(file: Readonly<Record<string, unknown>>, state: Readonly<Record<string, unknown>>) {
  const previous = object(state.farmingProfiles) ? state.farmingProfiles : {};
  return { farmingProfiles: { ...previous, ...Object.fromEntries(Object.entries(file.farmingProfiles as Record<string, object>).map(([name, profile]) =>
    [name, Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(object(previous[name]) ? previous[name] : {}),
      ...Object.getOwnPropertyDescriptors(profile) })])) } };
}
// An import of either passive field derives the pair: the rules from the file's rules or its
// switches, then the switches the rules commit (coordinator/rares.ts `setSettings` writes the same).
function importedPassive(file: Readonly<Record<string, unknown>>, state: Readonly<Record<string, unknown>>) {
  const passiveHunting = migratePassiveSettings(file.passiveHunting as PassiveSettings, (file.passiveRareHunts ?? state.passiveRareHunts) as Record<string, boolean>);
  return { passiveHunting, passiveRareHunts: committedPassiveRules(passiveHunting) };
}

export const huntingSavedFields = {
  name: 'core:hunting',
  settings: {
    // The two slot fields: their choices are the slots'
    // entries, so a write names only an entry that is registered and switched on, and any
    // pair is valid. The characters fight in the combat mode, and their Hunt loot pass
    // reads the target mode (runtime/hunting/character/loot.ts `accept`). The single mode they
    // replace is the derived record `farmingPolicy` (runtime/settings/coordinator/declarations.ts).
    combatMode: { label: 'Combat mode', kind: 'choice', default: DEFAULT_COMBAT_MODE satisfies SavedFarmingSelections['combatMode'],
      slot: 'combat-mode', scope: 'scope', deliver: ['characters', 'dashboard'] },
    targetMode: { label: 'Target mode', kind: 'choice', default: DEFAULT_TARGET_MODE satisfies SavedFarmingSelections['targetMode'],
      slot: 'target-mode', scope: 'scope', deliver: ['characters', 'dashboard'] },
    // One switch for the party, read in every target mode (farm.ts
    // `competitionHold`), shown in the Farming settings dialog.
    relocateIfCompeting: { label: 'Relocate to different spawn if competing', kind: 'boolean', default: true, importable: true,
      deliver: ['dashboard'] },
    huntSettings: { label: 'Monster Hunt settings', kind: 'value', default: { ...defaultHuntSettings }, scope: 'scope',
      importable: true, check: validHuntSettings, deliver: ['dashboard'] },
    passiveHunting: { label: 'Rare monsters to hunt', kind: 'value', default: passive, importable: true, check: value => object(value) && value.version === 1 && validPassivePatch({rules:value.rules,useFieldGenerators:value.useFieldGenerators}),
      imported: importedPassive, deliver: ['characters', 'dashboard'] },
    // The switches passiveHunting commits, written beside it (coordinator/rares.ts `setSettings`).
    passiveRareHunts: { label: 'Rare monsters hunted', kind: 'value', default: committedPassiveRules(passive), importable: true, check: mapOf(boolean),
      imported: importedPassive, deliver: ['characters', 'dashboard'] },
    // The navigate route saves the order the player starts the patrol with. The writer holds a saved
    // order to the spawn catalog, and an import with no catalog passes on the shape. The empty
    // default names no patrol, so it passes with a catalog too: an import carries it back unchanged,
    // and the patrol start refuses it (rares.ts).
    phoenixRouteOrder: { label: 'Phoenix patrol order', kind: 'value', default: [], importable: true,
      check: (value, _own, game) => listOf(text)(value) && (!game?.spawns || !(value as string[]).length || validPhoenixOrder(game.spawns as Catalog, value)),
      refusal: 'Choose every Phoenix region exactly once', deliver: ['dashboard'] },
    monsterSearchRadiusByCharacter: { label: 'Monster search radius', kind: 'value',
      default: {} satisfies SavedFarmingSelections['monsterSearchRadiusByCharacter'], scope: 'character', document: 'selections',
      importable: true, check: mapOf(validSearchRadius), deliver: ['dashboard'] },
  },
  records: {
    farmingProfiles: { default: {}, scope: 'character', liveness: true, importable: true, check: mapOf(validProfile),
      fit: profilePreferences, imported: importedProfiles, deliver: ['dashboard'] },
    // The Cave visit's record; its two player's choices are members, so `settings.overlay` can
    // answer them (cave.ts reads both through `playedIn`).
    dailyDungeons: { default: undefined, members: {
      afterRun: { label: 'Cave: after a run', kind: 'choice', choices: ['go-back', 'stay'], default: 'go-back' },
      protectFromEvents: { label: "Cave: don't leave for other events", kind: 'boolean', default: true } } },
    // A farming profile's focus when it has none saved. A fresh install's party scope starts on
    // goo, which the focus migration (coordinator/record.ts `savedFocus`) loads.
    monsterFocus: { default: [] satisfies SavedFarmingSelections['monsterFocus'], scope: 'scope', document: 'selections',
      importable: true, check: listOf(text), deliver: ['dashboard'] },
    monsterFocusByCharacter: { default: {} satisfies SavedFarmingSelections['monsterFocusByCharacter'], scope: 'character',
      document: 'selections', importable: true, check: mapOf(listOf(text)), deliver: ['dashboard'] },
    location: { default: null satisfies SavedFarmingSelections['location'], scope: 'scope' },
    monsterHunt: { default: null, scope: 'scope', deliver: ['characters', 'dashboard-core'] },
    farmAreaState: { default: {}, scope: 'scope', liveness: true, deliver: ['characters', 'dashboard-core'] },
    huntBlacklist: { default: {}, scope: 'scope', importable: true, check: huntBlacklist, deliver: ['dashboard'] },
    huntFailures: { default: {}, scope: 'scope', importable: true, check: huntFailures, deliver: ['dashboard-core'] },
    rareRetryEvidence: { default: {}, scope: 'scope' },
    rarePursuitProgress: { default: {}, scope: 'scope' },
    phoenixPatrolActive: { default: false, scope: 'scope' },
    phoenixPatrolCheckpoint: { default: null, scope: 'scope' },
    partyFarmingMode: { default: 'default', scope: 'scope', profileOnly: true, deliver: ['dashboard-core'] },
    scatterMonsterTypes: { default: [], scope: 'scope', profileOnly: true, deliver: ['characters', 'dashboard'] },
    scatterEpoch: { default: 0, scope: 'scope', profileOnly: true, deliver: ['characters'] },
    partyFarmingMonsterType: { default: null, scope: 'scope', profileOnly: true, deliver: ['characters', 'dashboard-core'] },
    scatterBreakTarget: { default: null, scope: 'scope', profileOnly: true, deliver: ['characters'] },
    scatterPartySignature: { default: '', scope: 'scope', profileOnly: true },
    rareHuntState: { default: null, scope: 'scope', profileOnly: true, deliver: ['dashboard-core'] },
  },
} satisfies Declarations;

// The core features' registrations. The
// movement owner's tick (runtime/movement/character/movers.ts `createMovementTick`) runs the core
// movers in the mover table's order (runtime/movement/rules.ts `MOVERS`), the current console's chain; the
// registry places add-on answers between them by tier. The target modes and the combat modes each fill their own slot.
import type { AddonState, HookRegistry, Registration } from './registry.ts';
import { fresh, setReadings } from '../protocol/reports.ts';
import { confirmIndependentApproach, independentApproach, independentReadiness, MOVERS } from '../movement/api/character.ts';

export const coreRegistrations: readonly Registration[] = [
  { name: 'core:role-runner', folder: 'core', author: 'adventureland-party-console',
    summary: 'Moves each character in combat: event returns, Franky, rares, the group formation, farm approach, the Cave and kiting.',
    // The core movers in the mover table's order (runtime/movement/rules.ts `MOVERS`).
    // The character's movement owner publishes its own `survival.died` and `addon.off` listeners
    // into this registration (runtime/movement/character/owner.ts), so the coordinator's realm,
    // which has no movement owner, hears neither.
    hooks: { 'movement.request': MOVERS,
    // A changed report age reaches the one freshness rule (runtime/protocol/reports.ts), which ignores
    // every other field.
    'settings.changed'(notice) { setReadings({ [String(notice.field)]: notice.new }); },
    // The one freshness rule itself answers `reports.fresh` in every realm.
    'reports.fresh': fresh,
    // Movement's coordinator decisions that targeting's group record asks. They read only their
    // arguments, so every realm answers them.
    'movement.independentApproach': independentApproach,
    'movement.independentReadiness': independentReadiness, 'movement.confirmIndependentApproach': confirmIndependentApproach } },
  // The two slots: what the party fights for and how it fights. Farming farms the monster or spot
  // the player picked. Each entry declares the button the dashboard and the apps draw, with the
  // labels, descriptions and colours of the one mode row they replace; Farming, which had no
  // button, takes sky.
  { name: 'core:target-modes', folder: 'core', author: 'adventureland-party-console',
    summary: 'What the party fights for: Farming (the monster or spot you picked) or Monster Hunt.',
    hooks: {},
    slots: [
      { slot: 'target-mode', mode: 'farming', fills: 'choice', button: { label: 'Farming', description: 'Farm the monster or spot you picked', color: 'sky' } },
      { slot: 'target-mode', mode: 'hunt', fills: 'choice',
        button: { label: 'Hunt', description: 'One quest at a time: leader first, then the next member if its monster is blacklisted', color: 'amber' } },
    ] },
  { name: 'core:combat-modes', folder: 'core', author: 'adventureland-party-console',
    summary: 'How the party fights: Auto, Default (one target together) or Scatter (each fighter its own).',
    hooks: {},
    slots: [
      { slot: 'combat-mode', mode: 'auto', fills: 'choice', button: { label: 'Auto', description: 'Default, switching to scatter when learned conditions allow it', color: 'cyan' } },
      { slot: 'combat-mode', mode: 'default', fills: 'choice', button: { label: 'Default', description: 'Force the normal party formation', color: 'emerald' } },
      { slot: 'combat-mode', mode: 'scatter', fills: 'choice', button: { label: 'Scatter', description: 'Force one-shot scatter farming', color: 'violet' } },
    ] },
  // P13: the combat routine slot's built-in entry, the turns owner's own attack, offense and buffs.
  // A character's picker shows only when an enabled add-on adds an entry for its class.
  { name: 'core:combat-routines', folder: 'core', author: 'adventureland-party-console',
    summary: "How each character spends its skills: the console's built-in routine, or an add-on's.",
    hooks: {},
    slots: [{ slot: 'combat-routine', mode: 'built-in', fills: 'choice', button: { label: 'Built-in', description: "The console's own attack, offense and buffs", color: 'slate' } }] },
  // The formation routine slot (02): where each fighter stands in a grouped fight. The built-in
  // solver is the first entry and every character's default; an add-on's entry follows it.
  { name: 'core:formations', folder: 'core', author: 'adventureland-party-console',
    summary: "Where each fighter stands in a grouped fight: the console's own formation solver.",
    hooks: {},
    slots: [
      { slot: 'formation', mode: 'built-in', fills: 'choice', button: { label: 'Built-in formation', description: "The console's own formation solver", color: 'slate' } },
    ] },
  // P14: the merchant routine slot's built-in entry, J2's own pick of the next job. The merchant's
  // card draws the picker only when an enabled add-on adds an entry.
  { name: 'core:merchant-routines', folder: 'core', author: 'adventureland-party-console',
    summary: "Which job the merchant runs next: the console's own job order, or an add-on's.",
    hooks: {},
    slots: [{ slot: 'merchant-routine', mode: 'built-in', fills: 'choice', classes: ['merchant'],
      button: { label: 'Console jobs', description: "The console's own job order", color: 'slate' } }] },
];
// The add-on system's switches: the
// switch is a setting the settings owner checks and saves, and the registry that holds the enabled
// set hears its change as any reader does, so `addon.off` follows the switch's notice in the
// batch's order. `partyHooks` registers it with its own registry.
export const addonSwitches = (registry: HookRegistry): Registration => ({
  name: 'core:addons', folder: 'core', author: 'adventureland-party-console',
  summary: 'Turns each add-on on or off as its switch changes, with no restart.',
  hooks: {
    'settings.changed'(notice) {
      if (notice.field === 'addons') adoptSavedSwitches(registry);
    },
  } });
// The console's registrations in load order: the core, the add-on switches, then each add-on folder
// the build found. index.ts and the add-on commands (cli/load.mts) both load this list.
export function registerConsole(registry: HookRegistry, installed: readonly { folder: string; registration: Registration }[]): void {
  for (const registration of coreRegistrations) registry.register(registration);
  registry.register(addonSwitches(registry));
  for (const { folder, registration } of installed) registry.register(registration, folder);
}
// The saved switches and settings, read at the coordinator's start once the settings install
// answers, and after each change of them.
export function adoptSavedSwitches(registry: HookRegistry): void {
  registry.configure(registry.read({ field: 'addons' }) as Record<string, AddonState> | undefined);
}

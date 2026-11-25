// The settings owner's install on the coordinator:
// it builds the persistence and the one writer, registers `core:settings` with the
// writer's two answers, and returns the writer's functions and the persistence's save functions
// to the composition, which binds its save names to them. The slot migration runs through
// `migrateSlots` once the roster is known.
import type { HookRegistry } from '../../hooks/registry.ts';
import type { KeyValueStorage } from './persistence/json-store.ts';
import { createCoordinatorPersistence } from './persistence/writer.ts';
import { createSettingsWriter, type SettingsWriterPorts, type SettingsWriterState } from './writer.ts';
import { migrateSlots, type SlotScope } from './slots.ts';
import { coordinatorSettings, holdHiddenSettings, type HiddenSettings } from './table.ts';
import { declaredSettings } from '../lists.ts';
import { overlayFieldProblem, overlayProblem } from '../rules.ts';
import { readOverlaysWith } from '../api.ts';

interface SettingsInstallPorts extends Pick<SettingsWriterPorts, 'owned' | 'scope' | 'now' | 'spawns' | 'app'> {
  // The game's monster table, or null before the game data loads; the writer checks a monsters
  // setting against its names.
  monsters(): Record<string, unknown> | null | undefined;
  // The game's item table, or null before the game data loads; the writer checks an items setting
  // against its names.
  items(): Readonly<Record<string, unknown>> | null | undefined;
  hooks: Pick<HookRegistry, 'publish' | 'notify' | 'entries' | 'registrations' | 'overlay' | 'guardOverlays'>;
  storage: KeyValueStorage;
  // The settings owner's run scope handle (application.ts `scopes.act11`), which the save timers go through.
  timers: Parameters<typeof createCoordinatorPersistence>[2];
  log(message: string): void;
}
type InstallState = Parameters<typeof createCoordinatorPersistence>[0] & SettingsWriterState & HiddenSettings &
  { statuses: Record<string, { ctype?: string } | null | undefined> };
export function installCoordinatorSettings(state: InstallState, ports: SettingsInstallPorts) {
  const { hooks } = ports;
  holdHiddenSettings(state);
  // An add-on's character settings name the party's fighters, every reporting character but
  // the merchant.
  const fighters = () => Object.entries(state.statuses).filter(([, s]) => s && s.ctype !== 'merchant').map(([name]) => name).sort();
  const persistence = createCoordinatorPersistence(state, ports.storage, ports.timers, document => hooks.notify('settings.saved', { document, by: 'persistence' }));
  const writer = createSettingsWriter(state, { hooks, owned: ports.owned, fighters, monsters: () => { const known = ports.monsters(); return known ? new Set(Object.keys(known)) : null; },
    items: () => { const known = ports.items(); return known ? new Set(Object.keys(known)) : null; }, spawns: ports.spawns,
    scope: ports.scope, now: ports.now, app: ports.app,
    persist: document => document === 'roster' ? persistence.roster() : document === 'bank' ? persistence.bank()
      : document === 'aldata' ? persistence.aldata() : persistence.scheduleSettings(),
    history: persistence.history });
  // The realm's registry outlives a coordinator start in the same process (a reload), so the
  // registry's `publish` registers core:settings at the first start and puts each later start's
  // writer in it; 11 holds no global.
  const registered = hooks.publish({ name: 'core:settings', folder: 'core', author: 'adventureland-party-console',
    summary: 'Writes every setting through one check, logs each change and tells the owners that read it.',
    hooks: { 'settings.write': writer.write, 'settings.read': writer.read, 'settings.declared': () => declaredSettings(coordinatorSettings().table),
      'settings.accepts': (field, value) => overlayProblem(coordinatorSettings().table, field, value, { spawns: ports.spawns() }) } });
  if (!registered.ok) throw Error(`The settings owner's core:settings did not load: ${registered.message}`);
  // An add-on that overlays a field no add-on may answer is refused now, at the coordinator's load.
  hooks.guardOverlays(field => overlayFieldProblem(coordinatorSettings().table, field));
  // The coordinator's decisions read a player's setting through `played`, which asks the overlay.
  readOverlaysWith((field, value, character) => hooks.overlay(field, value, character));
  return {
    write: writer.write, read: writer.read, persistence,
    // The fighters the writer checks an add-on's character settings against, for the add-ons route's list.
    fighters,
    persistSettings: persistence.scheduleSettings, persistHistory: persistence.history, persistHistoryNow: persistence.historyNow,
    persistALData: persistence.aldata, persistRosterState: persistence.roster,
    // Each farming scope whose saved single mode differs from what its saved pair
    // derives loads as its pair, before any tick reads the two fields.
    migrateSlots: (scopes: readonly SlotScope[]) => migrateSlots(scopes, { write: writer.write, persist: persistence.scheduleSettings, log: ports.log,
      combatModes: () => hooks.entries('combat-mode').map(m => m.mode), targetModes: () => hooks.entries('target-mode').map(m => m.mode) }),
  };
}

// The two slot fields and the one field they replace.
// Each
// farming scope saves `combatMode` (Auto, Default, Scatter or an add-on's entry) and `targetMode`
// (Farming, Hunt or an add-on's entry); any pair is valid. `farmingPolicy`, the field a
// v1.4.0 build and the apps read (the status owner's interface v1), is derived from the pair.
import type { SettingsWrite, SettingsWriteResult } from '../api.ts';

export interface Slots { combatMode: string; targetMode: string }

// The single mode a pair shows as: target Hunt gives `hunt`, Farming gives the combat mode, and
// an add-on's target entry gives its name.
export function farmingPolicyOf(scope: Readonly<Record<string, unknown>>): string {
  const target = typeof scope.targetMode === 'string' ? scope.targetMode : 'farming';
  return target === 'farming' ? (typeof scope.combatMode === 'string' ? scope.combatMode : 'auto') : target;
}

// The slot a single mode name belongs to, against the registry's entries: a combat mode entry,
// a target entry other than Farming (Hunt or an add-on's), or neither. The start's migration and the
// mode request (hunting/coordinator/routes.ts) both read it.
export function modeSlot(mode: unknown, combatModes: readonly string[], targetModes: readonly string[]): 'combat' | 'target' | null {
  if (typeof mode !== 'string') return null;
  if (combatModes.includes(mode)) return 'combat';
  return mode !== 'farming' && targetModes.includes(mode) ? 'target' : null;
}

// The pair an old single mode loads as. A combat mode entry is that combat mode with target
// Farming; Hunt or an add-on's target entry is that target with combat Auto; anything else is
// Farming with Auto, as an unknown saved mode loaded as Auto before the split.
export function slotsOf(policy: unknown, combatModes: readonly string[], targetModes: readonly string[]): Slots {
  const slot = modeSlot(policy, combatModes, targetModes);
  if (slot === 'combat') return { combatMode: String(policy), targetMode: 'farming' };
  if (slot === 'target') return { combatMode: 'auto', targetMode: String(policy) };
  return { combatMode: 'auto', targetMode: 'farming' };
}

export interface SlotScope { character?: string; scope: Readonly<Record<string, unknown>>; saved: unknown }
export interface SlotMigrationPorts {
  write(batch: SettingsWrite): SettingsWriteResult;
  combatModes(): readonly string[];
  targetModes(): readonly string[];
  persist(): void;
  log(message: string): void;
}

// 2.2 "When it runs": a scope migrates when its saved `farmingPolicy` differs from what its saved
// pair derives. A run of this build saves the two together, so a second start migrates nothing.
// A rolled-back v1.4.0 build writes only `farmingPolicy`, so after it the saved copy holds the
// newer choice and wins. Each scope's migration is one write, `migration:slots`, which writes one
// audit line per field it changes. A scope with no saved copy is new and keeps its pair.
export function migrateSlots(scopes: readonly SlotScope[], ports: SlotMigrationPorts): number {
  let migrated = 0;
  for (const { character, scope, saved } of scopes) {
    if (saved === undefined || saved === farmingPolicyOf(scope)) continue;
    const next = slotsOf(saved, ports.combatModes(), ports.targetModes());
    const written = ports.write({ by: 'migration:slots', changes: [
      { field: 'combatMode', value: next.combatMode, ...(character !== undefined ? { character } : {}) },
      { field: 'targetMode', value: next.targetMode, ...(character !== undefined ? { character } : {}) }] });
    if (!written.ok) { ports.log(`The saved farming mode ${JSON.stringify(saved)} of ${character ?? 'the party scope'} was not migrated: ${written.error}`); continue; }
    migrated++;
  }
  // The saved copy is rewritten from the pair even when the pair did not change, such as an
  // unknown saved mode, which loads as Farming with Auto.
  if (migrated) ports.persist();
  return migrated;
}

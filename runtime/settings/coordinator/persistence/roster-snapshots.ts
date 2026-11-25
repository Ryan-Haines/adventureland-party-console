// The roster document's copy of each character's offline snapshot: when a
// snapshot is due a save, and the copy each save carries. The status owner's intake refreshes the snapshot at each
// due save (status/coordinator/intake.ts `rememberCharacterSnapshot`).
import type { AppearanceState } from "../../../status/api.ts";
import { hiddenValue } from "../table.ts";

const snapshotSavedAt = new WeakMap<AppearanceState, Map<string, number>>();
const savedSnapshots = new WeakMap<object, Map<string, unknown>>();
// A snapshot without an inventory change is saved rosterSnapshotSaveMs after the last saved one.
// The roster key holds every character's items and slots, so a 30 s save per character rewrote it
// several times a minute (docs/efficiency.md, Persistence: Offline character snapshots). `refresh`
// takes the snapshot when the save is due.
export function snapshotSaveDue(state: AppearanceState, name: string, inventoryChanged: boolean, now: number, refresh: () => void): boolean {
  let saved = snapshotSavedAt.get(state);
  if (!saved) snapshotSavedAt.set(state, (saved = new Map()));
  if (!inventoryChanged && now - (saved.get(name) ?? -Infinity) < hiddenValue("rosterSnapshotSaveMs")) return false;
  refresh();
  saved.set(name, now);
  let versions = savedSnapshots.get(state);
  if (!versions) savedSnapshots.set(state, (versions = new Map()));
  versions.set(name, state.characterSnapshots?.[name]);
  return true;
}
/**
 * The roster key's copy of the snapshots. nativeOwnership saves the roster on
 * every native report, so the roster carries each character's snapshot from
 * its last due save. A character without a refresh since load keeps its
 * loaded snapshot.
 */
export function rosterSnapshots(state: object, current: unknown): unknown {
  const versions = savedSnapshots.get(state);
  if (!versions?.size || !current || typeof current !== "object") return current;
  return Object.fromEntries(Object.entries(current).map(([name, snapshot]) =>
    [name, versions.has(name) ? versions.get(name) : snapshot]));
}

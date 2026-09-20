import type { ItemMark } from "../contracts/item.ts";
import type { ObservedCharacterStatus } from "../status/observed-status.ts";
import type { reconcileCollectionMarks } from "./collection-marks.ts";
import type { reconcileUpgradeMarks } from "./upgrade-marks.ts";

interface SavedCollection {
  threshold?: number;
  itemCollectionThreshold?: number;
  marked?: Record<string, ItemMark[]> | null;
  merchantMarked?: Record<string, ItemMark[]> | null;
  autoItemMarks?: Record<string, Parameters<typeof reconcileCollectionMarks>[2]> | null;
  autoUpgradeMarks?: Record<string, Parameters<typeof reconcileUpgradeMarks>[1]> | null;
}
function initialMarks(settings: SavedCollection, selections: SavedCollection) {
  return {
    marked: selections.marked || settings.marked || {},
    merchantMarked: selections.merchantMarked || settings.merchantMarked || {},
    autoItemMarks: selections.autoItemMarks || settings.autoItemMarks || {},
    autoUpgradeMarks: selections.autoUpgradeMarks || settings.autoUpgradeMarks || {},
  };
}

/** Selection documents override legacy settings, including explicit empty mark maps. */
export function initialCollectionState(settings: SavedCollection, selections: SavedCollection) {
  return {
    threshold: Number.isSafeInteger(settings.threshold) ? settings.threshold! : 100000,
    itemCollectionThreshold: Number.isSafeInteger(settings.itemCollectionThreshold)
      ? Math.max(1, Math.min(42, settings.itemCollectionThreshold!))
      : 1,
    statuses: {} as Record<string, ObservedCharacterStatus>,
    ...initialMarks(settings, selections),
  };
}

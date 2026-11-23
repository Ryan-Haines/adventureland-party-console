import type { InventoryEntry } from "../contracts/item.ts";
import type { BankboiInventory, StorageReference } from "../inventory/bankboi-completion.ts";
import type { CompoundRule } from "./automatic-improvements.ts";

type Entries = readonly (InventoryEntry | null | undefined)[];

function matches(entry: InventoryEntry | null | undefined, name: string, level: number): boolean {
  return !!entry?.item && !entry.item.l && !entry.item.b && entry.item.name === name &&
    (Number(entry.item.level) || 0) === level;
}

/** Stage only the missing ingredients for the highest available triple of the next rule. */
export function planCompoundStorage(
  rules: readonly CompoundRule[],
  local: Entries,
  workers: readonly BankboiInventory[],
  carried: Entries,
  free: number,
): StorageReference[] | null {
  let remoteBatch: StorageReference[] | null = null;
  for (const rule of rules) {
    if (Number(rule.quantity) === 0) continue;
    for (let level = Math.max(1, Number(rule.targetTier) || 1) - 1; level >= 0; level--) {
      const missing = 3 - carried.filter(entry => matches(entry, rule.name, level)).length;
      if (missing > 0 && missing + 1 > free) continue; // Leave room for the scroll.
      const owned = local.filter((entry) => matches(entry, rule.name, level)).length;
      if (owned >= 3) return [];
      const available = workers.flatMap((worker) => (worker.items || [])
        .filter((entry) => Number.isSafeInteger(entry?.slot) && matches(entry, rule.name, level))
        .map((entry) => ({ pack: "bankboi:" + worker.name, slot: entry!.slot, item: entry!.item })));
      if (owned + available.length >= 3 && (!remoteBatch || 3 - owned < remoteBatch.length))
        remoteBatch = available.slice(0, 3 - owned);
    }
  }
  return remoteBatch;
}

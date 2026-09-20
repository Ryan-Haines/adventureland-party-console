import type { InventoryEntry } from './coordinator/contracts/item.ts';
import type { CompoundRule } from './coordinator/merchant/automatic-improvements.ts';
type Entries = readonly (InventoryEntry | null | undefined)[];
/** Stock must already exclude locked/reserved/conflicting items. Keep complete batches local. */
export function compoundStorageLeftovers(rules: readonly CompoundRule[], inventory: Entries, stock: Entries): InventoryEntry[] {
  const eligible = (entry: InventoryEntry | null | undefined, rule: CompoundRule) =>
    !!entry?.item && !entry.item.l && entry.item.name === rule.name && Number(entry.item.level || 0) < Number(rule.targetTier || 1);
  const retained = new Set<InventoryEntry>(), pending = new Set<InventoryEntry>();
  for (const rule of rules.filter(value => Number(value.quantity) !== 0)) {
    for (let level = 0; level < Number(rule.targetTier || 1); level++) {
      const matches = (entry: InventoryEntry | null | undefined): entry is InventoryEntry => eligible(entry, rule) && Number(entry!.item!.level || 0) === level;
      const local = inventory.filter(matches), complete = Math.floor(stock.filter(matches).length / 3) * 3;
      local.forEach(entry => pending.add(entry));
      local.slice(0, complete).forEach(entry => retained.add(entry));
    }
  }
  return [...pending].filter(entry => !retained.has(entry));
}

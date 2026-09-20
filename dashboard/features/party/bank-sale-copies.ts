import type { BankSnapshot } from "./bank-snapshot";
import type { Bankboi } from "./bankboi";
import type { InventoryEntry } from "./inventory-entry";
import { same } from "./same";

export function bankSaleCopies(bank: BankSnapshot | null | undefined, workers: Bankboi[], selected: InventoryEntry) {
  const packs = [...Object.entries(bank?.packs || {}),
    ...workers.map((worker) => [`bankboi:${worker.name}`, worker.items] as const)];
  return packs.flatMap(([pack, entries]) => (entries || []).flatMap((entry) =>
    entry && !entry.item.l && same(entry.item, selected.item) && same(selected.item, entry.item)
      ? [{ pack, entry }] : []));
}

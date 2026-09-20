import type { InventoryEntry, Item } from "../contracts/item.ts";
import { sameMarkedItem } from "./item-identity.ts";

interface CompoundMark { slot: number; item: Item }
interface CompoundState {
  compounds: Record<string, { items: CompoundMark[] }[] | undefined>;
}
function same(first: Item, second: Item): boolean {
  return sameMarkedItem(first, second) && sameMarkedItem(second, first);
}

/** Relocate a complete reservation set, never assigning two copies to one slot. */
export function reconcileCoordinatorCompoundMarks(
  state: CompoundState,
  name: string,
  status?: { items?: unknown } | null,
): boolean {
  if (!Array.isArray(status?.items)) return false;
  const items = (status.items as (InventoryEntry | null)[]).filter(
    (entry): entry is InventoryEntry & { slot: number; item: Item } =>
      !!entry?.item && Number.isSafeInteger(entry.slot),
  );
  const marks = (state.compounds[name] || []).flatMap(group => group.items);
  const assigned = new Map<CompoundMark, number>();
  const used = new Set<number>();
  function assign(mark: CompoundMark, entry: typeof items[number] | undefined) {
    if (!entry) return;
    assigned.set(mark, entry.slot);
    used.add(entry.slot);
  }
  // Reserve unchanged slots first so relocated copies cannot steal them.
  for (const mark of marks)
    assign(mark, items.find(entry => entry.slot === mark.slot && !used.has(entry.slot) && same(entry.item, mark.item)));
  for (const mark of marks) {
    if (assigned.has(mark)) continue;
    assign(mark, items.find(entry => !used.has(entry.slot) && same(entry.item, mark.item)));
  }
  // Consumption and partial reports are handled by completion receipts; retain intent meanwhile.
  if (assigned.size !== marks.length) return false;
  let changed = false;
  for (const [mark, slot] of assigned) {
    if (mark.slot !== slot) { mark.slot = slot; changed = true; }
  }
  return changed;
}

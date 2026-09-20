import type { HttpRequest, HttpResponse } from "./contracts.ts";
import type { Item, InventoryEntry, ItemMark } from "../contracts/item.ts";
import type { createTransferCommands } from "../inventory/transfer-commands.ts";

interface StaleOrderState {
  merchantCharacter: string | null;
  statuses: Record<string, { items?: (InventoryEntry | null)[] } | undefined>;
  merchantDeliveries: Parameters<typeof createTransferCommands>[0]["merchantDeliveries"];
  marked: Record<string, ItemMark[] | undefined>;
}

/** Matching ignores stack size but retains every other property supplied by the order. */
function matches(entry: InventoryEntry, wanted: Item | null | undefined): boolean {
  const item = entry.item;
  return (
    !!item &&
    !!wanted &&
    Object.keys(wanted)
      .filter((key) => key !== "q")
      .every((key) => JSON.stringify(item[key]) === JSON.stringify(wanted[key]))
  );
}

export function createStaleOrderRoute(state: StaleOrderState, persist: () => void) {
  function bankMarks(merchant: string | null, inventory: InventoryEntry[]): number {
    let removed = 0;
    state.marked[String(merchant)] = (state.marked[String(merchant)] || []).filter((mark) => {
      if (inventory.some((entry) => matches(entry, mark.item || mark))) return true;
      removed++;
      return false;
    });
    return removed;
  }
  return function clear(_req: HttpRequest, res: HttpResponse): unknown {
    const merchant = state.merchantCharacter,
      status = state.statuses[String(merchant)];
    if (!merchant || !status) return res.status(409).json({ error: "merchant status unavailable" });
    const inventory = (status.items || []).filter((entry): entry is InventoryEntry => !!entry);
    // Missing inventory is not a delivery receipt. Durable delivery intent survives cleanup.
    const deliveriesRemoved = 0,
      bankMarksRemoved = bankMarks(merchant, inventory);
    persist();
    return res.json({ ok: true, deliveriesRemoved, bankMarksRemoved });
  };
}

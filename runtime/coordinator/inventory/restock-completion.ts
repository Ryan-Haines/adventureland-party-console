import type { InventoryEntry } from "../contracts/item.ts";
interface Supply {
  item?: string;
  max?: unknown;
}
interface RestockPolicy {
  hp?: Supply | null;
  mp?: Supply | null;
}

function quantity(items: (InventoryEntry | null)[], name: string | undefined): number {
  return items.reduce(
    (total, entry) =>
      total + (entry?.item && entry.item.name === name ? Number(entry.item.q) || 1 : 0),
    0,
  );
}

/** Completion uses target maxima; missing inventory must never count as a completed restock. */
export function restockInventorySatisfied(items: unknown, policy: () => RestockPolicy): boolean {
  if (!Array.isArray(items)) return false;
  const targets = policy();
  return [targets.hp, targets.mp].every(
    (supply) =>
      !supply || Number(supply.max) <= 0 || quantity(items, supply.item) >= Number(supply.max),
  );
}

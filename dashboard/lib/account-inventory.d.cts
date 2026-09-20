type Entry = { item: { name: string; level?: number; q?: number } } | null;
type Inventory = { name: string; items?: Entry[] };
export function inventoryCounts(
  characters?: Inventory[],
  bank?: { packs?: Record<string, Entry[]> } | null,
  bankbois?: Inventory[],
  byLevel?: boolean,
): Record<string, number>;

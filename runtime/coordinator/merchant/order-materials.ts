import type {
  Allocation,
  StorageAllocation,
  CraftMaterial,
  MaterialEntry,
  OrderChoice,
  OrderLine,
} from "./order-types.ts";

function requirementsFor(crafts: OrderLine[], choices: OrderChoice[]): Map<string, CraftMaterial> {
  const requirements = new Map<string, CraftMaterial>();
  for (const line of crafts) {
    const recipe = choices.find((entry) => entry.id === line.id)!;
    for (const material of recipe.materials || []) {
      const key = material.id + "@" + (material.level || 0);
      requirements.set(key, {
        id: material.id,
        level: material.level || 0,
        quantity: (requirements.get(key)?.quantity || 0) + material.quantity * line.quantity,
      });
    }
  }
  return requirements;
}

/** Allocates merchant inventory first, then normal bank, BankBoi, and online party inventory. */
export function allocateOrderMaterials(
  crafts: OrderLine[],
  choices: OrderChoice[],
  merchant: string | null,
) {
  const requirements = requirementsFor(crafts, choices),
    totals = [...requirements.values()].map((entry) => ({ ...entry }));
  const sources: Record<string, Allocation[]> = {},
    inventory: Allocation[] = [],
    bank: (Allocation & { pack: string })[] = [],
    storage: StorageAllocation[] = [];
  function takeEntry(entry: MaterialEntry | null, owner: string | null, pack: string | null): void {
    if (!entry) return;
    const item = entry.item || entry,
      need = requirements.get(item.name + "@" + (item.level || 0));
    if (!need || need.quantity <= 0) return;
    const amount = Math.min(need.quantity, item.q || 1);
    need.quantity -= amount;
    const allocation = { slot: entry.slot, item, quantity: amount };
    record(allocation, owner, pack);
  }
  function record(allocation: Allocation, owner: string | null, pack: string | null): void {
    if (pack?.startsWith("bankboi:"))
      storage.push({ ...allocation, pack, allocationId: String(storage.length) });
    else if (pack) bank.push({ ...allocation, pack });
    else if (owner !== merchant) (sources[owner!] ||= []).push(allocation);
    else inventory.push(allocation);
  }
  function take(
    entries: (MaterialEntry | null)[] | undefined,
    owner: string | null,
    pack: string | null,
  ): void {
    for (const entry of entries || []) takeEntry(entry, owner, pack);
  }
  return {
    take,
    sources,
    inventory,
    storage,
    bank,
    totals,
    missing: () => [...requirements.values()].filter((entry) => entry.quantity > 0),
  };
}

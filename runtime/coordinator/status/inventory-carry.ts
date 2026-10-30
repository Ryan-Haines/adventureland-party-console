import { requestObject } from "../http/contracts.ts";

const inventoryFields = ["items", "slots", "bank"] as const;
type InventoryField = (typeof inventoryFields)[number];

interface CarriedInventory {
  revision: string;
  fields: Partial<Record<InventoryField, unknown>>;
}

/**
 * Character scripts omit items, slots and bank while they match the revision
 * this coordinator acknowledged (docs/efficiency.md, Inventory deltas).
 * complete() puts the carried fields back on the raw report before any
 * heartbeat consumer reads it, so every consumer and the stored status see a
 * full report. The revision stays out of the report: it describes this
 * coordinator process, not the character.
 */
export function createInventoryCarry() {
  const carried = new Map<string, CarriedInventory>();

  /** Returns false when the report omits inventory this coordinator does not hold. */
  function complete(name: string, raw: Record<string, unknown>): boolean {
    const revision = typeof raw.inventoryRevision === "string" ? raw.inventoryRevision : undefined;
    delete raw.inventoryRevision;
    if (Array.isArray(raw.items)) {
      if (revision === undefined) carried.delete(name);
      else carried.set(name, { revision, fields: Object.fromEntries(
        inventoryFields.filter(field => Object.hasOwn(raw, field)).map(field => [field, raw[field]])) });
      return true;
    }
    // A report with neither items nor a revision keeps its earlier meaning.
    if (revision === undefined) return true;
    const held = carried.get(name);
    if (held?.revision !== revision) return false;
    for (const field of inventoryFields)
      if (Object.hasOwn(held.fields, field) && !Object.hasOwn(raw, field)) raw[field] = held.fields[field];
    return true;
  }

  /** The status response names the revision held for the character, if any. */
  function acknowledge(name: string, response: unknown): unknown {
    const revision = carried.get(name)?.revision;
    return revision === undefined ? response : { ...requestObject(response), inventoryRevision: revision };
  }

  return { complete, acknowledge };
}

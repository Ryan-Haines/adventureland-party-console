import type { GItem } from "typed-adventureland";

/**
 * Reports carry per-copy item meta (properties, a per-copy sprite) once the
 * coordinator holds merchantCatalog; the catalog carries the per-type meta
 * (definition, world, usage, scaling and the rest). Readers join the two here.
 */
/**
 * G.items[id] as safeItemDefinition in characters/shared.js sends it: scalar
 * and array fields only, and any of them can be absent on the wire. The named
 * fields are the ones coordinator readers use; the index signature keeps the
 * rest of the definition for scripts that read it untyped.
 */
export type ItemDefinitionFields = Partial<Pick<GItem, "type" | "wtype" | "grades" | "s">> & {
  [field: string]: unknown;
};
export interface ItemMetaRecord {
  [field: string]: unknown;
  definition?: ItemDefinitionFields;
  upgradeable?: boolean;
  maxLevel?: number;
}
interface CatalogEntry {
  id?: unknown;
  meta?: ItemMetaRecord | null;
}

// Each accepted catalog is a new object, so one index per object is one index
// per catalog revision. Reports never rebuild it.
const indexes = new WeakMap<object, Map<string, ItemMetaRecord>>();
// Every report brings new meta objects, so joinItemMeta computes one join per
// report per item and every reader of that report reuses it.
const joins = new WeakMap<object, { known: ItemMetaRecord; joined: ItemMetaRecord }>();

function catalogIndex(catalog: unknown): Map<string, ItemMetaRecord> | null {
  if (!catalog || typeof catalog !== "object") return null;
  const cached = indexes.get(catalog);
  if (cached) return cached;
  const index = new Map<string, ItemMetaRecord>();
  const items = (catalog as { allItems?: unknown }).allItems;
  for (const raw of Array.isArray(items) ? items : []) {
    const entry = raw as CatalogEntry | null;
    if (entry && typeof entry.id === "string" && entry.meta && typeof entry.meta === "object")
      index.set(entry.id, entry.meta);
  }
  indexes.set(catalog, index);
  return index;
}

/** Per-type meta for one item id, or undefined before the catalog arrives. */
export function catalogItemMeta(catalog: unknown, name: unknown): ItemMetaRecord | undefined {
  return typeof name === "string" ? catalogIndex(catalog)?.get(name) : undefined;
}

/**
 * Catalog meta with the report's per-copy fields on top. Reports from clients
 * that still send full meta keep their own values. Readers share the result,
 * so callers must not modify it.
 */
export function joinItemMeta(catalog: unknown, name: unknown, live: unknown): ItemMetaRecord | null {
  const known = catalogItemMeta(catalog, name);
  const own = live && typeof live === "object" ? (live as ItemMetaRecord) : null;
  if (!known) return own;
  if (!own) return known;
  const cached = joins.get(own);
  if (cached?.known === known) return cached.joined;
  const joined = { ...known, ...own };
  joins.set(own, { known, joined });
  return joined;
}

/** Shorthand for the `{ item, meta }` entries in items, slots, bank packs and stand listings. */
export function entryMeta(
  catalog: unknown,
  entry: { item?: { name?: unknown } | null; meta?: unknown } | null | undefined,
): ItemMetaRecord | null {
  return entry ? joinItemMeta(catalog, entry.item?.name, entry.meta) : null;
}

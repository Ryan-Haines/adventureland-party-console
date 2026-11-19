// The item meta join every reader of a report uses, on the coordinator and in the dashboard. Reports
// carry per-copy meta once the coordinator holds merchantCatalog; the catalog's allItems carries the
// per-type meta. It imports nothing, so the dashboard bundle loads it through items/api.ts.
import type { GItem } from 'typed-adventureland';

/** G.items[id] as shared.js's safeItemDefinition sends it: any field can be absent on the wire. */
type ItemDefinitionFields = Partial<Pick<GItem, 'type' | 'wtype' | 'grades' | 's'>> & { [field: string]: unknown };
export interface ItemMetaRecord { [field: string]: unknown; definition?: ItemDefinitionFields; upgradeable?: boolean; maxLevel?: number }
// Each accepted catalog is a new object, so one index per object is one index per catalog revision;
// each report brings new meta objects, so one join per report per item serves every reader of it,
// and React Query's structural sharing sees the same object until the report or catalog changes.
const metaIndexes = new WeakMap<object, Map<string, object>>();
const metaJoins = new WeakMap<object, { known: object; joined: object }>();
function catalogIndex(catalog: unknown): Map<string, object> | null {
  if (!catalog || typeof catalog !== 'object') return null;
  let index = metaIndexes.get(catalog);
  if (index) return index;
  index = new Map();
  const items = (catalog as { allItems?: unknown }).allItems;
  for (const raw of Array.isArray(items) ? items : []) {
    const entry = raw as { id?: unknown; meta?: object | null } | null;
    if (entry && typeof entry.id === 'string' && entry.meta && typeof entry.meta === 'object') index.set(entry.id, entry.meta);
  }
  metaIndexes.set(catalog, index);
  return index;
}
/** Per-type meta for one item id, or undefined before the catalog arrives. */
export function catalogItemMeta<M extends object = ItemMetaRecord>(catalog: unknown, name: unknown): M | undefined {
  return typeof name === 'string' ? catalogIndex(catalog)?.get(name) as M | undefined : undefined;
}
/** Catalog meta under the report's per-copy fields, as b9b5c91e's coordinator joined them
 * (runtime/coordinator/inventory/catalog-meta.ts:60-70). Readers share the result and never change it. */
export function joinItemMeta<M extends object = ItemMetaRecord>(catalog: unknown, name: unknown, live: unknown): M | null {
  const known = catalogItemMeta<M>(catalog, name), own = live && typeof live === 'object' ? live as M : null;
  if (!known || !own) return own || known || null;
  const cached = metaJoins.get(own);
  if (cached?.known === known) return cached.joined as M;
  const joined = { ...known, ...own };
  metaJoins.set(own, { known, joined });
  return joined;
}
/** The join for one `{ item, meta }` entry of items, slots, bank packs or stand listings. */
export function entryMeta(catalog: unknown, entry: { item?: { name?: unknown } | null; meta?: unknown } | null | undefined): ItemMetaRecord | null {
  return entry ? joinItemMeta<ItemMetaRecord>(catalog, entry.item?.name, entry.meta) : null;
}

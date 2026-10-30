import type { ItemMeta } from './item-meta';
import type { MerchantCatalog } from './merchant-catalog';
import type { BankSnapshot } from './bank-snapshot';
import type { EquippedEntry } from './equipped-entry';
import type { Item } from './item';

/**
 * Status reports carry per-copy item meta (properties, a per-copy sprite);
 * merchantCatalog.allItems carries the per-type meta (definition, world,
 * usage and the rest). Readers see the two joined through this module.
 */
type Entry = { item?: Pick<Item, 'name'> | null; meta?: EquippedEntry['meta'] };

// One index per catalog object, and the catalog query replaces that object
// only on a new referenceRevision.
const indexes = new WeakMap<object, Map<string, ItemMeta>>();
// This module caches joins per live object, so React Query structural sharing
// and memoized tiles see the same object until the report or catalog changes.
const metaJoins = new WeakMap<object, { known: ItemMeta; joined: ItemMeta }>();
const entryJoins = new WeakMap<object, { known: ItemMeta | undefined; joined: Entry }>();
const bankJoins = new WeakMap<object, { catalog: unknown; joined: BankSnapshot }>();

function catalogIndex(catalog: MerchantCatalog | null | undefined): Map<string, ItemMeta> | undefined {
  if (!catalog) return undefined;
  let index = indexes.get(catalog);
  if (!index) {
    index = new Map();
    for (const entry of catalog.allItems || []) if (entry.meta) index.set(entry.id, entry.meta);
    indexes.set(catalog, index);
  }
  return index;
}

/** Per-type meta for one item id. */
export function catalogItemMeta(catalog: MerchantCatalog | null | undefined, name: string | undefined) {
  return name ? catalogIndex(catalog)?.get(name) : undefined;
}

/** Catalog meta with live per-copy fields on top; full live meta from older clients wins. */
export function joinItemMeta(
  catalog: MerchantCatalog | null | undefined,
  name: string | undefined,
  live: ItemMeta | null | undefined,
): ItemMeta | null | undefined {
  const known = catalogItemMeta(catalog, name);
  if (!known) return live;
  if (!live) return known;
  const cached = metaJoins.get(live);
  if (cached?.known === known) return cached.joined;
  const joined = { ...known, ...live, world: live.world || known.world };
  metaJoins.set(live, { known, joined });
  return joined;
}

/** The same entry with joined meta, or the entry itself when nothing joins. */
export function withCatalogMeta<T extends Entry | null | undefined>(catalog: MerchantCatalog | null | undefined, entry: T): T {
  if (!entry) return entry;
  const known = catalogItemMeta(catalog, entry.item?.name || undefined);
  if (!known) return entry;
  const cached = entryJoins.get(entry);
  if (cached && cached.known === known) return cached.joined as T;
  const joined = { ...entry, meta: joinItemMeta(catalog, entry.item?.name || undefined, entry.meta) };
  entryJoins.set(entry, { known, joined });
  return joined;
}

/** Bank packs with joined meta, recomputed only when the snapshot or catalog changes. */
export function bankWithCatalogMeta(catalog: MerchantCatalog | null | undefined, bank: BankSnapshot | null | undefined) {
  if (!bank || !catalog) return bank;
  const cached = bankJoins.get(bank);
  if (cached?.catalog === catalog) return cached.joined;
  const joined = { ...bank, packs: Object.fromEntries(Object.entries(bank.packs || {}).map(([pack, entries]) =>
    [pack, Array.isArray(entries) ? entries.map(entry => withCatalogMeta(catalog, entry)) : entries])) };
  bankJoins.set(bank, { catalog, joined });
  return joined;
}

type Inventory = { items?: (Entry | null)[]; slots?: Record<string, Entry | null> };
const inventoryJoins = new WeakMap<object, { catalog: unknown; joined: Inventory }>();
/** A character's items and slots with joined meta, recomputed only when either input changes. */
export function inventoryWithCatalogMeta<T extends Inventory>(catalog: MerchantCatalog | null | undefined, inventory: T | undefined): T | undefined {
  if (!inventory || !catalog || (!inventory.items && !inventory.slots)) return inventory;
  const cached = inventoryJoins.get(inventory);
  if (cached?.catalog === catalog) return cached.joined as T;
  const joined = { ...inventory,
    ...(Array.isArray(inventory.items) ? { items: inventory.items.map(entry => withCatalogMeta(catalog, entry)) } : {}),
    ...(inventory.slots ? { slots: Object.fromEntries(Object.entries(inventory.slots)
      .map(([slot, entry]) => [slot, withCatalogMeta(catalog, entry)])) } : {}) };
  inventoryJoins.set(inventory, { catalog, joined });
  return joined;
}

import type { ItemInfo } from 'typed-adventureland';

/** Item payloads are extensible: matching preserves all server-provided properties. */
export interface Item extends Pick<ItemInfo, 'level' | 'q'> {
  [property: string]: unknown;
  // Observations and saved marks may be partial and contain IDs/modifiers newer than the package.
  name?: string;
  p?: string;
  stat_type?: string;
  // The player's lock and the bound flag, which rules.ts `usableCopy` reads.
  l?: unknown;
  b?: unknown;
}

export interface InventoryEntry {
  [property: string]: unknown;
  slot?: number;
  item?: Item | null;
  // Per-copy meta once the coordinator holds merchantCatalog; read the
  // per-type fields through runtime/items/catalog-meta.ts entryMeta().
  meta?: import('../../items/coordinator/api.ts').ItemMetaRecord | null;
}

export interface ItemMark extends Item {
  slot?: number;
  item?: Item;
  auto?: boolean;
}

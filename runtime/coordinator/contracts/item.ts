import type { ItemInfo } from 'typed-adventureland';

/** Item payloads are extensible: matching preserves all server-provided properties. */
export interface Item extends Pick<ItemInfo, 'level' | 'q'> {
  [property: string]: unknown;
  // Observations and saved marks may be partial and contain IDs/modifiers newer than the package.
  name?: string;
  p?: string;
  stat_type?: string;
}

export interface InventoryEntry {
  [property: string]: unknown;
  slot?: number;
  item?: Item | null;
  meta?: { upgradeable?: boolean; definition?: { type?: string; wtype?: string } };
}

export interface ItemMark extends Item {
  slot?: number;
  item?: Item;
  auto?: boolean;
}

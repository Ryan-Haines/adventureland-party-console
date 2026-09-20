import { sameMarkedItem } from "../inventory/item-identity.ts";
import type { InventoryEntry, Item } from "../contracts/item.ts";

interface Listing { id?: string; item?: Item | null; state?: string; bankPack?: unknown; tradeSlot?: unknown; price?: number; quantity?: number }

/** Crafting, healing, and unrelated bag changes must not retrigger blocked stand work. */
export function standSyncSignature(merchant: string | null, listings: (Listing | null)[], inventory: (InventoryEntry | null)[]) {
  return JSON.stringify([merchant, listings.map(listing => {
    if (!listing) return null;
    const owned = inventory.filter(entry => sameMarkedItem(entry?.item, listing.item))
      .reduce((total, entry) => total + (Number(entry?.item?.q) || 1), 0);
    return [listing.id, listing.item, listing.state, listing.bankPack, listing.tradeSlot, listing.price, listing.quantity, owned];
  })]);
}

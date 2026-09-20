import type { Item, InventoryEntry } from "../contracts/item.ts";

export interface ReconciledListing {
  id: string;
  item?: Item | null;
  state: string;
  slot?: number;
  tradeSlot?: unknown;
  bankPack?: string;
  bankSlot?: number;
}
export interface StandReconciliationState {
  merchantCharacter: string | null;
  standListings: ReconciledListing[];
  withdrawals: Record<
    string,
    { pack?: string; slot?: number; item?: Item | null; standListingId?: string }[] | undefined
  >;
}
interface ReconciliationPorts {
  sameItem(first: Item, second: Item | null | undefined): boolean;
  log(message: string, level: string, details: unknown): void;
}

/** Reconciles physical stand/bag ownership before scheduling missing bank withdrawals. */
export function createStandReconciliation(
  state: StandReconciliationState,
  ports: ReconciliationPorts,
) {
  function reconcile(live: Map<string, unknown>, inventory: (InventoryEntry | null)[]): void {
    const claimed = new Set<number>(),
      missing: ReconciledListing[] = [];
    state.standListings = state.standListings.filter((listing) => {
      if (listing.state === "paused") return true;
      if (live.has(listing.id)) {
        listing.state = "live";
        listing.tradeSlot = live.get(listing.id);
        return true;
      }
      const index = inventory.findIndex(
        (entry, position) =>
          !claimed.has(position) && !!entry?.item && ports.sameItem(entry.item, listing.item),
      );
      if (index >= 0) {
        claimed.add(index);
        listing.state = "waiting";
        listing.slot = inventory[index]!.slot;
        delete listing.tradeSlot;
        return true;
      }
      if (listing.bankPack) {
        listing.state = "waiting";
        delete listing.tradeSlot;
        return true;
      }
      missing.push(listing);
      return false;
    });
    if (missing.length)
      ports.log(
        "Removed " +
          missing.length +
          " stand listing" +
          (missing.length === 1 ? "" : "s") +
          " with no matching live or inventory item",
        "info",
        { items: missing.map((listing) => listing.item && listing.item.name) },
      );
  }
  function withdrawals(): boolean {
    const pending = (state.withdrawals[String(state.merchantCharacter)] ||= []);
    let added = false;
    for (const listing of state.standListings) {
      if (
        listing.state !== "waiting" ||
        !listing.bankPack ||
        pending.some((entry) => entry.standListingId === listing.id)
      )
        continue;
      pending.push({
        pack: listing.bankPack,
        slot: listing.bankSlot,
        item: listing.item,
        standListingId: listing.id,
      });
      added = true;
    }
    return added;
  }
  return { reconcile, withdrawals };
}

export function activeStandSales<T extends { state?: string }>(listings: T[]): T[] {
  return listings.some(listing => listing.state === "paused") ? listings.filter(listing => listing.state !== "paused") : listings;
}

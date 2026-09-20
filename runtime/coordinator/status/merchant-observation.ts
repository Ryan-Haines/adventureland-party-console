import type { Item } from "../contracts/item.ts";
import { sameMarkedItem } from "../inventory/item-identity.ts";

interface MerchantObservation {
  map?: string;
  x?: number;
  y?: number;
  gold?: number;
  rip?: boolean;
  standOpen?: boolean;
  slots?: Record<string, { item?: Item | null } | null>;
  lastDeath?: { message?: string; details?: unknown } | null;
  anniversaryState?: { craftResult?: { at?: number; success?: boolean; error?: unknown } };
}
interface Listing {
  item: Item;
  tradeSlot?: string;
  quantity?: number;
  [field: string]: unknown;
}
interface ObservationPorts {
  log(message: string, level: "info" | "success" | "error", details?: unknown): void;
  persist(): void;
  publish(): void;
}

function inBank(map: string | undefined): boolean {
  return /^bank(?:$|_[a-z0-9]+$)/i.test(String(map || ""));
}

function craftResult(status: MerchantObservation | undefined) {
  return status?.anniversaryState?.craftResult;
}

function logBank(
  current: MerchantObservation,
  previous: MerchantObservation | undefined,
  ports: ObservationPorts,
): void {
  if (inBank(current.map) && (!previous || !inBank(previous.map)))
    ports.log(previous ? "Entered bank" : "Merchant online in bank", "info", {
      map: current.map,
      x: current.x,
      y: current.y,
    });
}

function logCraft(
  current: MerchantObservation,
  previous: MerchantObservation | undefined,
  ports: ObservationPorts,
): void {
  const result = craftResult(current);
  if (result?.at && result.at !== craftResult(previous)?.at)
    ports.log(
      result.success ? "Sixfold Cake crafted and banked" : "Anniversary cake deferred",
      result.success ? "success" : "info",
      result.error || null,
    );
}

function logDeath(
  current: MerchantObservation,
  previous: MerchantObservation | undefined,
  ports: ObservationPorts,
): void {
  if (!current.rip || previous?.rip) return;
  ports.log(
    current.lastDeath?.message || "Killed by unknown monster",
    "error",
    current.lastDeath && current.lastDeath.details,
  );
}

function logStand(
  current: MerchantObservation,
  previous: MerchantObservation | undefined,
  ports: ObservationPorts,
): void {
  if (!current.standOpen || previous?.standOpen) return;
  const atMarket =
    current.map === "main" && Math.hypot(Number(current.x) + 63, Number(current.y) - 100) <= 35;
  ports.log(
    atMarket ? "At stand" : "Stand opened away from market",
    atMarket ? "success" : "info",
    { map: current.map, x: current.x, y: current.y },
  );
}

function soldQuantity(before: Item, after: Item | null | undefined): number {
  const beforeQuantity = Number(before.q) || 1,
    afterQuantity = after ? Number(after.q) || 1 : 0;
  return !after || after.name !== before.name
    ? beforeQuantity
    : Math.max(0, beforeQuantity - afterQuantity);
}

/** Reconciles stand sales from observations, never from a movement or sale promise. */
export function createMerchantObservation(state: { listings: Listing[] }, ports: ObservationPorts) {
  function updateListing(index: number, before: Item, after: Item | null | undefined): void {
    if (index < 0) return;
    const quantity = after ? Number(after.q) || 1 : 0;
    if (!after || after.name !== before.name || quantity <= 0) state.listings.splice(index, 1);
    else {
      const listing = state.listings[index];
      listing.quantity = quantity;
      listing.item = { ...listing.item, q: quantity };
    }
  }

  function sale(slot: string, before: Item, current: MerchantObservation): string | null {
    const after = current.slots?.[slot]?.item,
      quantity = soldQuantity(before, after);
    if (!quantity) return null;
    const index = state.listings.findIndex(
      (listing) => listing.tradeSlot === slot && sameMarkedItem(before, listing.item),
    );
    const listing = index >= 0 ? state.listings[index] : null;
    const description =
      (listing?.item.name || before.name) + (quantity > 1 ? " × " + quantity : "");
    updateListing(index, before, after);
    return description;
  }

  function standSales(current: MerchantObservation, previous: MerchantObservation): void {
    const sold: string[] = [];
    for (const [slot, entry] of Object.entries(previous.slots || {})) {
      if (!slot.startsWith("trade") || !entry?.item) continue;
      const description = sale(slot, entry.item, current);
      if (description) sold.push(description);
    }
    if (!sold.length) return;
    ports.log(
      "Sold " +
        sold.join(", ") +
        " at stand (+" +
        (Number(current.gold) - Number(previous.gold)).toLocaleString() +
        " gold)",
      "success",
    );
    ports.persist();
    ports.publish();
  }

  function observe(current: MerchantObservation, previous: MerchantObservation | undefined): void {
    logBank(current, previous, ports);
    logCraft(current, previous, ports);
    logDeath(current, previous, ports);
    logStand(current, previous, ports);
    if (current.standOpen && previous?.standOpen && Number(current.gold) > Number(previous.gold))
      standSales(current, previous);
  }

  return { observe };
}

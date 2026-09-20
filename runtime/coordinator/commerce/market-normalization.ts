import { requestObject, requestText } from "../http/contracts.ts";
import type { PublicListing, NormalizedPublicListing } from "./market-types.ts";

export function marketListingKey(listing: Partial<PublicListing>): string {
  return [
    listing.seller,
    listing.serverRegion,
    listing.serverIdentifier,
    listing.slot,
    listing.item?.name,
    Number(listing.item?.level) || 0,
    Number(listing.price) || 0,
  ].join(":");
}

function itemPayload(item: Record<string, unknown>) {
  return {
    name: requestText(item.name),
    level: Number(item.level) || 0,
    ...(item.p ? { p: requestText(item.p) } : {}),
  };
}

function listing(
  merchant: Record<string, unknown>,
  slot: string,
  item: Record<string, unknown>,
  buying: boolean,
): NormalizedPublicListing {
  const identity = merchant.id as string | undefined;
  const value: NormalizedPublicListing = {
    source: "aldata",
    ...(buying ? { buyer: identity } : { seller: identity }),
    slot,
    serverRegion: merchant.serverRegion as string | undefined,
    serverIdentifier: merchant.serverIdentifier as string | undefined,
    map: merchant.map,
    x: Number(merchant.x) || 0,
    y: Number(merchant.y) || 0,
    lastSeen: merchant.lastSeen,
    seenAt: Date.parse(requestText(merchant.lastSeen)) || 0,
    price: Number(item.price),
    quantity: Math.max(1, Number(item.q) || 1),
    item: itemPayload(item),
  };
  value.key = marketListingKey({ ...value, seller: identity });
  return value;
}

function validItem(item: Record<string, unknown>, buying: boolean): boolean {
  return (
    !!item.b === buying &&
    !!item.name &&
    Number.isFinite(Number(item.price)) &&
    Number(item.price) >= 1
  );
}

function normalize(merchants: unknown, buying: boolean): NormalizedPublicListing[] {
  const entries: NormalizedPublicListing[] = [];
  for (const raw of Array.isArray(merchants) ? merchants : []) {
    const merchant = requestObject(raw);
    for (const [slot, rawItem] of Object.entries(requestObject(merchant.slots))) {
      const item = requestObject(rawItem);
      if (validItem(item, buying)) entries.push(listing(merchant, slot, item, buying));
    }
  }
  return entries.sort(
    (a, b) => (buying ? b.price - a.price : a.price - b.price) || b.seenAt - a.seenAt,
  );
}

export function normalizeMarketSales(merchants: unknown): NormalizedPublicListing[] {
  return normalize(merchants, false);
}
export function normalizeMarketBids(merchants: unknown): NormalizedPublicListing[] {
  return normalize(merchants, true);
}

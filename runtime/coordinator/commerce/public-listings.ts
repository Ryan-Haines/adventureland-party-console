import type { Item } from "../contracts/item.ts";
import type { StandBid } from "./bids.ts";

interface PublishedListing {
  name: string;
  level?: number;
  p?: string;
  note: string;
  wtb?: {
    price?: number;
    quantity?: number;
    trades?: { item: { name: string }; give: number; receive: number }[];
  };
  wts?: { price: number; quantity: number };
}
interface ConfiguredSale {
  item?: Item | null;
  price?: number;
  quantity?: number;
  state?: string;
}
interface AnniversaryBarter {
  nativeSlice: string | null;
  tradableNative: number;
  missing: string[];
}

function configuredSale(listing: ConfiguredSale): PublishedListing {
  const item = listing.item!,
    level = Number(item.level) || 0;
  return {
    name: item.name!,
    ...(level ? { level } : {}),
    ...(item.p ? { p: item.p } : {}),
    note:
      listing.state === "live" ? "Live on merchant stand" : "Configured listing; contact seller",
    wts: { price: Number(listing.price), quantity: Math.max(1, Number(listing.quantity) || 1) },
  };
}

function publishedBid(name: string, bid: StandBid): PublishedListing {
  const level = Math.max(0, Number(bid.minimumQuality) || 0);
  return {
    name,
    ...(level ? { level } : {}),
    note: bid.acceptHigherLevels === false ? "Exact +" + level + " only" : level
      ? "Minimum +" + level + "; higher levels accepted"
      : "Adventure Console standing bid",
    wtb: { price: Number(bid.price), quantity: Number(bid.quantity) },
  };
}

function barterListings(anniversary: AnniversaryBarter): PublishedListing[] {
  const listings: PublishedListing[] = [];
  if (anniversary.nativeSlice && anniversary.tradableNative > 0)
    for (const wanted of anniversary.missing)
      listings.push({
        name: wanted,
        note:
          "Anniversary slice barter: offering 1 " + anniversary.nativeSlice + " for 1 " + wanted,
        wtb: { trades: [{ item: { name: anniversary.nativeSlice }, give: 1, receive: 1 }] },
      });
  return listings;
}

export function publishedMarketListings(
  anniversary: AnniversaryBarter,
  bids: Record<string, StandBid>,
  sales: (ConfiguredSale | null)[],
): PublishedListing[] {
  const listings = barterListings(anniversary);
  for (const [name, bid] of Object.entries(bids || {})) listings.push(publishedBid(name, bid));
  for (const sale of sales || []) if (sale?.item?.name && sale.state !== "paused") listings.push(configuredSale(sale));
  return listings;
}

import { requestObject, requestText } from "../http/contracts.ts";
import type { PriceHistory, PublicListing } from "./market-types.ts";

function historicalPrice(
  old: PriceHistory,
  listing: PublicListing,
): Pick<PriceHistory, "lowest" | "lowestLevel"> {
  const price = Number(listing.price),
    level = Number(listing.item.level) || 0;
  const lowest = !old.lowest || price < Number(old.lowest);
  const identifiesLowest = old.lowestLevel == null && price === Number(old.lowest);
  return {
    lowest: lowest ? price : Number(old.lowest),
    lowestLevel: lowest || identifiesLowest ? level : old.lowestLevel,
  };
}

function recordListing(
  history: Record<string, PriceHistory>,
  newest: Map<string, PublicListing>,
  listing: PublicListing,
  emptyMarket: boolean,
): void {
  const id = listing.item.name,
    old = history[id] || {},
    previous = newest.get(id);
  const recent = previous && previous.seenAt > listing.seenAt ? previous : listing;
  history[id] = {
    ...old,
    ...historicalPrice(old, listing),
    ...initialMarketLow(listing, emptyMarket),
    recent: recent.price,
    recentLevel: Number(recent.item.level) || 0,
    seenAt: Math.max(Number(old.seenAt) || 0, listing.seenAt),
  };
  if (!previous || previous.seenAt < listing.seenAt) newest.set(id, listing);
}

function initialMarketLow(listing: PublicListing, empty: boolean) {
  return {
    marketLow: empty ? Number(listing.price) : undefined,
    marketLowLevel: empty ? Number(listing.item.level) || 0 : undefined,
  };
}

function currentLows(listings: PublicListing[], now: number): Map<string, PublicListing> {
  const lows = new Map<string, PublicListing>();
  for (const listing of listings.filter((entry) => entry.seenAt >= now - 120000)) {
    const previous = lows.get(listing.item.name);
    if (!previous || listing.price < previous.price) lows.set(listing.item.name, listing);
  }
  return lows;
}

export function observeMarketPrices(
  history: Record<string, PriceHistory>,
  listings: PublicListing[],
  emptyMarket: boolean,
  now: number,
): void {
  const newest = new Map<string, PublicListing>();
  for (const listing of listings) recordListing(history, newest, listing, emptyMarket);
  const lows = currentLows(listings, now);
  for (const [id, entry] of Object.entries(history)) {
    const low = lows.get(id),
      recent = newest.get(id);
    if (low) {
      entry.marketLow = low.price;
      entry.marketLowLevel = Number(low.item.level) || 0;
    } else {
      delete entry.marketLow;
      delete entry.marketLowLevel;
    }
    if (recent) {
      entry.recent = recent.price;
      entry.recentLevel = Number(recent.item.level) || 0;
      entry.seenAt = recent.seenAt;
    }
  }
}

function recordBid(highest: Map<string, { price: number; level: number }>, raw: unknown): void {
  const listing = requestObject(raw),
    price = Number(requestObject(listing.wtb).price);
  if (!listing.name || !Number.isFinite(price) || price < 1) return;
  const name = requestText(listing.name),
    previous = highest.get(name);
  if (!previous || price > previous.price)
    highest.set(name, { price, level: Number(listing.level) || 0 });
}

function highestBids(trades: unknown): Map<string, { price: number; level: number }> {
  const highest = new Map<string, { price: number; level: number }>();
  for (const raw of Array.isArray(trades) ? trades : []) {
    const owner = requestObject(raw);
    for (const rawListing of Array.isArray(owner.listings) ? owner.listings : [])
      recordBid(highest, rawListing);
  }
  return highest;
}

export function observeMarketTrades(history: Record<string, PriceHistory>, trades: unknown): void {
  const highest = highestBids(trades);
  for (const [id, entry] of Object.entries(history)) {
    const bid = highest.get(id);
    if (bid) {
      entry.highestPublicWTB = bid.price;
      entry.highestPublicWTBLevel = bid.level;
    } else {
      delete entry.highestPublicWTB;
      delete entry.highestPublicWTBLevel;
    }
  }
}

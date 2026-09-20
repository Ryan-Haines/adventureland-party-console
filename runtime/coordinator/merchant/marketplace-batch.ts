import { routineFor } from './routines.ts';
import type { MarketListing, MerchantWork } from "./work.ts";

function sellerKey(listing: MarketListing): string {
  return [listing.seller, listing.serverRegion, listing.serverIdentifier].join("|");
}

function tagged(listings: readonly MarketListing[], job: MerchantWork): MarketListing[] {
  return listings.map((listing) => ({
    ...listing,
    bidItemId: listing.bidItemId || job.bidItemId || null,
  }));
}

/** Batch only sellers already on the selected itinerary, preserving unrelated queue entries. */
export function batchMarketplaceVisits(job: MerchantWork, queue: readonly MerchantWork[]) {
  if (job.reason !== "ALData marketplace purchases" || !job.listings?.length) return null;
  const sellers = new Set(job.listings.map(sellerKey));
  const listings = tagged(job.listings, job),
    retained: MerchantWork[] = [];
  let batchedOrders = 0;
  for (const queued of queue) {
    if (queued.reason !== "ALData marketplace purchases" || routineFor(queued) !== routineFor(job) || !Array.isArray(queued.listings)) {
      retained.push(queued);
      continue;
    }
    const matching = queued.listings.filter((listing) => sellers.has(sellerKey(listing)));
    const remaining = queued.listings.filter((listing) => !sellers.has(sellerKey(listing)));
    listings.push(...tagged(matching, queued));
    if (matching.length) batchedOrders++;
    if (remaining.length) retained.push({ ...queued, listings: remaining });
  }
  job.listings = [...new Map(listings.map((listing) => [listing.key, listing])).values()].sort(
    (a, b) => sellerKey(a).localeCompare(sellerKey(b)) || Number(a.price) - Number(b.price),
  );
  return {
    queue: retained,
    batchedOrders,
    sellers: [...sellers],
    listingCount: job.listings.length,
  };
}

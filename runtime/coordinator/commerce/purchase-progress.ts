import type { Item } from "../contracts/item.ts";
import type { MarketListing, MerchantWork } from "../merchant/work.ts";
import type { MerchantBlock, MerchantIdentity } from "./market-types.ts";

export interface PurchaseListing extends MarketListing {
  key: string;
  item: Item & { name: string };
  quantity: number;
}
export interface PurchaseProgressJob extends MerchantWork {
  listings?: PurchaseListing[];
}
export interface PurchaseProgressState {
  merchantCharacter: string | null;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
  commands: Record<
    string,
    { completedListingKeys?: string[]; listings?: MarketListing[] } | undefined
  >;
  standBids: Record<string, { quantity: number } | undefined>;
}
export interface PurchaseProgressPorts {
  blacklistingEnabled?(): boolean;
  now(): number;
  fulfill(item: Item, quantity: number): void;
  log(message: string, level: string, details?: unknown): void;
  dismiss(key: string): void;
  persist(): void;
  blacklist(listing: PurchaseListing, reason: string): MerchantBlock;
}
function sellerKey(entry: PurchaseListing): string {
  return [entry.seller, entry.serverRegion, entry.serverIdentifier].join("|");
}
function sameSeller(a: PurchaseListing, b: PurchaseListing): boolean {
  return (
    a.seller === b.seller &&
    a.serverRegion === b.serverRegion &&
    a.serverIdentifier === b.serverIdentifier
  );
}

export type PurchaseReason = "ALData marketplace purchases" | "Ponty purchases";
/** The job producer owns listing shape; dispatch uses the retained reason tag. */
export function isPurchaseJob(
  job: MerchantWork | null,
  reason: PurchaseReason,
): job is PurchaseProgressJob {
  return !!job && job.reason === reason;
}
function queuedPurchase(
  job: MerchantWork,
): job is PurchaseProgressJob & { listings: PurchaseListing[] } {
  return isPurchaseJob(job, "ALData marketplace purchases") && Array.isArray(job.listings);
}

export function createPurchaseProgress(state: PurchaseProgressState, ports: PurchaseProgressPorts) {
  function syncCompleted(job: PurchaseProgressJob): void {
    const command = state.commands[String(state.merchantCharacter)];
    if (command) command.completedListingKeys = job.completedListingKeys!.slice();
  }
  function complete(job: PurchaseProgressJob, key: string): void {
    job.completedListingKeys = [...new Set((job.completedListingKeys || []).concat(key))];
    syncCompleted(job);
    job.heartbeatAt = job.progressAt = ports.now();
  }
  function cancelQueued(listing: PurchaseListing): number {
    let count = 0;
    state.merchantQueue = state.merchantQueue.flatMap((job) => {
      if (!queuedPurchase(job)) return [job];
      const remaining = job.listings.filter((entry) => !sameSeller(entry, listing));
      count += job.listings.length - remaining.length;
      return remaining.length ? [{ ...job, listings: remaining }] : [];
    });
    return count;
  }
  function cancelSeller(
    job: PurchaseProgressJob,
    listing: PurchaseListing,
    reason: string,
  ): MerchantIdentity {
    const identity = {
      seller: listing.seller,
      serverRegion: listing.serverRegion,
      serverIdentifier: listing.serverIdentifier,
    };
    const blacklist =
      ports.blacklistingEnabled?.() === false ? null : ports.blacklist(listing, reason);
    const cancelled = (job.listings || []).filter(
      (entry) => sameSeller(entry, listing) && !job.completedListingKeys!.includes(entry.key),
    );
    job.completedListingKeys = [
      ...new Set(job.completedListingKeys!.concat(cancelled.map((entry) => entry.key))),
    ];
    syncCompleted(job);
    const queued = cancelQueued(listing);
    ports.log(
      (blacklist ? "!!!BLACKLISTED!!! - " : "Skipped unavailable merchant - ") + listing.seller,
      "warning",
      {
        current: cancelled.length,
        queued,
        server: listing.serverRegion + " " + listing.serverIdentifier,
        reason,
        failures: blacklist?.failures,
        cooldownMinutes: blacklist?.cooldownMinutes,
        until: blacklist?.until,
      },
    );
    return identity;
  }
  function collectAdditional(listing: PurchaseListing): PurchaseListing[] {
    const additional: PurchaseListing[] = [],
      retained: MerchantWork[] = [],
      seller = sellerKey(listing);
    for (const queued of state.merchantQueue) {
      if (!queuedPurchase(queued)) {
        retained.push(queued);
        continue;
      }
      const matching = queued.listings.filter((entry) => sellerKey(entry) === seller),
        remaining = queued.listings.filter((entry) => sellerKey(entry) !== seller);
      additional.push(
        ...matching.map((entry) => ({
          ...entry,
          bidItemId: entry.bidItemId || queued.bidItemId || null,
        })),
      );
      if (remaining.length) retained.push({ ...queued, listings: remaining });
    }
    state.merchantQueue = retained;
    return additional;
  }
  function additional(job: PurchaseProgressJob, listing: PurchaseListing): PurchaseListing[] {
    const entries = collectAdditional(listing);
    if (!entries.length) return entries;
    const keys = new Set((job.listings || []).map((entry) => entry.key));
    for (const entry of entries)
      if (!keys.has(entry.key)) {
        job.listings!.push(entry);
        keys.add(entry.key);
      }
    const command = state.commands[String(state.merchantCharacter)];
    if (command) command.listings = job.listings!.slice();
    ports.log(
      "Added " +
        entries.length +
        " queued listing" +
        (entries.length === 1 ? "" : "s") +
        " for " +
        listing.seller +
        " to the current visit",
      "info",
    );
    return entries;
  }
  return { complete, cancelSeller, additional };
}

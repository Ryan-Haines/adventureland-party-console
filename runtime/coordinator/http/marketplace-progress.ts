import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import {
  createPurchaseProgress,
  isPurchaseJob,
  type PurchaseReason,
  type PurchaseProgressState,
  type PurchaseProgressPorts,
  type PurchaseProgressJob,
  type PurchaseListing,
} from "../commerce/purchase-progress.ts";

const failures: Readonly<Record<string, string>> = {
  stand_not_open: "Seller found, but stand was not open",
  seller_not_visible: "Seller was not visible at the advertised location",
  listing_not_available: "Seller's stand was open, but the listing was unavailable",
  destination_unreachable: "Could not reach the seller's advertised location",
};

export function createMarketplaceProgressRoutes(
  state: PurchaseProgressState,
  ports: PurchaseProgressPorts,
) {
  const progress = createPurchaseProgress(state, ports);
  function remaining(listing: PurchaseListing): number {
    return state.standBids[listing.item?.name]?.quantity || 0;
  }
  function current(
    body: Record<string, unknown>,
    reason: PurchaseReason,
  ): PurchaseProgressJob | null {
    const job = state.merchantCurrent;
    return job && job.id === body.jobId && isPurchaseJob(job, reason) ? job : null;
  }
  function ponty(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      job = current(body, "Ponty purchases");
    if (!job) return res.status(409).json({ error: "Ponty job is no longer current" });
    const listing = job.listings!.find((entry) => entry.key === body.listingKey);
    if (!listing) return res.status(400).json({ error: "unknown Ponty listing" });
    if (!(job.completedListingKeys || []).includes(listing.key)) pontyComplete(job, listing, body);
    return res.json({ ok: true });
  }
  function pontyComplete(
    job: PurchaseProgressJob,
    listing: PurchaseListing,
    body: Record<string, unknown>,
  ): void {
    job.completedListingKeys = (job.completedListingKeys || []).concat(listing.key);
    if (body.success && !job.acknowledgedPurchaseKeys?.includes(listing.key)) ports.fulfill(listing.item, listing.quantity);
    ports.log(
      body.success
        ? "Bought " + listing.quantity + " × " + listing.item.name + " from Ponty"
        : "Skipped unavailable Ponty listing: " + listing.item.name,
      body.success ? "success" : "error",
      body.error || listing.key,
    );
    ports.dismiss(listing.key);
    const command = state.commands[String(state.merchantCharacter)];
    if (command) command.completedListingKeys = job.completedListingKeys;
    job.heartbeatAt = job.progressAt = ports.now();
    ports.persist();
  }
  function reportPurchase(listing: PurchaseListing, body: Record<string, unknown>, acknowledged: boolean): void {
    if (body.success) {
      const amount = Math.max(0, Number(body.quantity) || 0);
      if (!acknowledged) ports.fulfill(listing.item, amount);
      ports.log(
        "Bought " +
          amount +
          " × " +
          listing.item.name +
          " from " +
          listing.seller +
          " on " +
          listing.serverRegion +
          " " +
          listing.serverIdentifier,
        "success",
        { price: listing.price, listingKey: body.listingKey },
      );
    } else {
      const reason = failures[requestText(body.failureCode)] || "ALData purchase failed";
      ports.log(
        reason + ": " + listing.seller + " / " + listing.item.name,
        "error",
        body.error || null,
      );
    }
  }
  function aldata(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      job = current(body, "ALData marketplace purchases");
    if (!job) return res.status(409).json({ error: "ALData marketplace job is no longer current" });
    const listing = (job.listings || []).find((entry) => entry.key === body.listingKey);
    if (!listing) return res.status(400).json({ error: "unknown ALData listing" });
    if ((job.completedListingKeys || []).includes(listing.key))
      return res.json({
        ok: true,
        alreadyCompleted: true,
        remaining: remaining(listing),
        additionalListings: [],
        cancelSeller: null,
      });
    progress.complete(job, listing.key);
    reportPurchase(listing, body, !!job.acknowledgedPurchaseKeys?.includes(listing.key));
    const failure = requestText(body.failureCode);
    const cancelSeller =
      !body.success && ["seller_not_visible", "stand_not_open"].includes(failure)
        ? progress.cancelSeller(job, listing, failure)
        : null;
    const additionalListings = body.success ? progress.additional(job, listing) : [];
    ports.persist();
    return res.json({ ok: true, remaining: remaining(listing), additionalListings, cancelSeller });
  }
  return { ponty, aldata };
}

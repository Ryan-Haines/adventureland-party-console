import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { Item } from "../contracts/item.ts";
import type { MerchantWork, MarketListing } from "../merchant/work.ts";

interface LocatedListing extends MarketListing {
  item: Item & { name: string };
  map: unknown;
  x: number;
  y: number;
  price: number;
  buyer?: string;
}
interface LocationJob extends MerchantWork {
  buyOrder?: LocatedListing;
  listings?: LocatedListing[];
  locationRefreshes?: Record<string, boolean>;
}
interface LocationState {
  merchantCurrent: MerchantWork | null;
}
function locationJob(job: MerchantWork): job is LocationJob {
  return job.reason === "ALData marketplace sales" || job.reason === "ALData marketplace purchases";
}
function selectedListing(job: LocationJob, key: unknown): LocatedListing | undefined {
  return job.reason === "ALData marketplace sales"
    ? job.buyOrder
    : (job.listings || []).find((entry) => entry.key === key);
}
interface LocationPorts {
  fetch(): Promise<unknown>;
  normalize(records: Record<string, unknown>[], sale: boolean): LocatedListing[];
  persist(): void;
  log(message: string, level: string, details: unknown): void;
}
function usableLocation(
  record: Record<string, unknown> | undefined,
): record is Record<string, unknown> {
  return (
    !!record &&
    typeof record.map === "string" &&
    !!record.map &&
    record.x != null &&
    record.y != null &&
    Number.isFinite(Number(record.x)) &&
    Number.isFinite(Number(record.y))
  );
}
function matchingOffer(entry: LocatedListing, listing: LocatedListing, sale: boolean): boolean {
  return (
    entry.item.name === listing.item.name &&
    entry.item.level === (Number(listing.item.level) || 0) &&
    (entry.item.p || null) === (listing.item.p || null) &&
    (sale ? entry.price >= listing.price : entry.price <= listing.price)
  );
}

export function createMarketplaceLocationRoute(state: LocationState, ports: LocationPorts) {
  function find(
    records: unknown,
    name: string | undefined,
    listing: LocatedListing,
    sale: boolean,
  ): LocatedListing | null {
    const record = (Array.isArray(records) ? records : [])
      .map(requestObject)
      .find(
        (entry) =>
          entry.id === name &&
          entry.serverRegion === listing.serverRegion &&
          entry.serverIdentifier === listing.serverIdentifier,
      );
    const offers = usableLocation(record) ? ports.normalize([record], sale) : [];
    const offer = offers.find((entry) => matchingOffer(entry, listing, sale));
    return offer &&
      (offer.map !== listing.map || Math.hypot(offer.x - listing.x, offer.y - listing.y) > 25)
      ? offer
      : null;
  }
  async function refresh(
    current: LocationJob,
    listing: LocatedListing,
    sale: boolean,
    name: string | undefined,
    res: HttpResponse,
  ): Promise<unknown> {
    try {
      const records = await ports.fetch();
      if (state.merchantCurrent !== current)
        return res.status(409).json({ error: "marketplace job was cancelled" });
      const moved = find(records, name, listing, sale),
        location = moved ? { map: moved.map, x: moved.x, y: moved.y } : null;
      ports.log(
        moved
          ? "Re-found " + name + "; following once to refreshed location"
          : "Stopped looking for " + name + "; refreshed listing is missing or has no new location",
        moved ? "info" : "warning",
        location,
      );
      return res.json({ location });
    } catch (error) {
      return res.status(502).json({ error: requestText(requestObject(error).message || error) });
    }
  }
  return async function refreshLocation(req: HttpRequest, res: HttpResponse): Promise<unknown> {
    const body = requestObject(req.body),
      current = state.merchantCurrent;
    if (!current || current.id !== body.jobId)
      return res.status(409).json({ error: "marketplace job is no longer current" });
    if (!locationJob(current))
      return res.status(400).json({ error: "unknown marketplace listing" });
    const sale = current.reason === "ALData marketplace sales";
    const listing = selectedListing(current, body.listingKey);
    if (!listing) return res.status(400).json({ error: "unknown marketplace listing" });
    const name = sale ? listing.buyer : listing.seller,
      key = [name, listing.serverRegion, listing.serverIdentifier].join("|");
    current.locationRefreshes ||= {};
    if (current.locationRefreshes[key])
      return res.json({ location: null, reason: "location retry already used" });
    current.locationRefreshes[key] = true;
    ports.persist();
    return refresh(current, listing, sale, name, res);
  };
}

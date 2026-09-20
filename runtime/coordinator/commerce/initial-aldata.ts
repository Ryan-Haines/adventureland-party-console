import type { PublicListing } from "./market-types.ts";

interface SavedAuthentication {
  key?: unknown;
  auth?: string | null;
  authCheckedAt?: unknown;
  publishedAt?: unknown;
}
interface SavedMarket {
  aldataTrades?: unknown;
  aldataMarketListings?: PublicListing[] | null;
  aldataMarketBuyOrders?: PublicListing[] | null;
  aldataMerchantsUpdatedAt?: unknown;
  aldataTradesUpdatedAt?: unknown;
}

/** Restore market history and authentication while resetting request handles and transient status. */
export function initialALDataState(saved: SavedAuthentication, settings: SavedMarket) {
  return {
    key: typeof saved.key === "string" ? saved.key : "",
    auth: saved.auth || "NO",
    authCheckedAt: Number(saved.authCheckedAt) || 0,
    merchants: [],
    trades: settings.aldataTrades || [],
    marketListings: settings.aldataMarketListings || [],
    marketBuyOrders: settings.aldataMarketBuyOrders || [],
    merchantsUpdatedAt: Number(settings.aldataMerchantsUpdatedAt) || 0,
    tradesUpdatedAt: Number(settings.aldataTradesUpdatedAt) || 0,
    publishStatus: "idle",
    publishedAt: Number(saved.publishedAt) || 0,
    error: null as string | null,
    requestTimes: [] as number[],
    publishTimer: null as ReturnType<typeof setTimeout> | null,
  };
}

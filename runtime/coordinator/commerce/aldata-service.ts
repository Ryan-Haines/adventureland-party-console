import type { ALDataRequest } from "./aldata-client.ts";
import { requestObject, requestText } from "../http/contracts.ts";
import type { PublicListing } from "./market-types.ts";
import { normalizeMarketBids, normalizeMarketSales } from "./market-normalization.ts";

interface ALDataState {
  key?: string;
  auth?: string;
  authCheckedAt?: number;
  merchantsUpdatedAt?: number;
  tradesUpdatedAt?: number;
  publishStatus?: string;
  publishedAt?: number;
  error?: string | null;
  refreshing?: boolean;
  merchants?: unknown;
  marketListings: PublicListing[];
  marketBuyOrders: PublicListing[];
  trades: unknown;
}
interface ALDataServicePorts {
  request(path: string, options?: ALDataRequest): Promise<unknown>;
  now(): number;
  observePrices(listings: PublicListing[]): void;
  observeTrades(trades: unknown): void;
  queueMatches(): void;
  persistSettings(): void;
  persistAuthentication(): void;
  owner(): string | null;
  merchant(): string | null;
  publishedListings(): unknown[];
}

export function createALDataService(state: ALDataState, ports: ALDataServicePorts) {
  function snapshot() {
    return {
      marketRefreshRevision: "live-market-10s-v2",
      hasKey: !!state.key,
      auth: state.auth,
      authCheckedAt: state.authCheckedAt,
      merchantsUpdatedAt: state.merchantsUpdatedAt,
      tradesUpdatedAt: state.tradesUpdatedAt,
      publishStatus: state.publishStatus,
      publishedAt: state.publishedAt,
      error: state.error,
      listings: state.marketListings,
      buyOrders: state.marketBuyOrders,
      trades: state.trades,
    };
  }

  async function fetchMerchants() {
    const merchants = (await ports.request("/merchants")) || [];
    return {
      merchants,
      listings: normalizeMarketSales(merchants),
      buyOrders: normalizeMarketBids(merchants),
    };
  }

  async function refreshMerchants(): Promise<void> {
    let result = await fetchMerchants();
    // A snapshot with bids but no sales is unmistakably partial; try once before retaining prior sales.
    if (!result.listings.length && result.buyOrders.length) {
      const retry = await fetchMerchants();
      if (retry.listings.length) result = retry;
    }
    state.merchants = result.merchants;
    if (result.listings.length || !state.marketListings.length)
      state.marketListings = result.listings;
    if (result.buyOrders.length || !state.marketBuyOrders.length)
      state.marketBuyOrders = result.buyOrders;
    state.merchantsUpdatedAt = ports.now();
    ports.observePrices(state.marketListings);
    ports.queueMatches();
  }

  async function refreshTrades(): Promise<void> {
    state.trades = (await ports.request("/trades")) || [];
    state.tradesUpdatedAt = ports.now();
    ports.observeTrades(state.trades);
  }

  async function refresh(kind = "all") {
    if (state.refreshing) return snapshot();
    state.refreshing = true;
    try {
      if (kind === "all" || kind === "merchants") await refreshMerchants();
      if (kind === "all" || kind === "trades") await refreshTrades();
      state.error = null;
      ports.persistSettings();
    } catch (error) {
      state.error = requestText(requestObject(error).message || error);
    } finally {
      state.refreshing = false;
    }
    return snapshot();
  }

  async function publish(): Promise<boolean> {
    const owner = ports.owner();
    if (!owner || !state.key || state.auth !== "CORRECT") return false;
    state.publishStatus = "publishing";
    try {
      await ports.request(
        "/trades/" + encodeURIComponent(owner) + "/" + encodeURIComponent(state.key),
        {
          method: "PUT",
          body: JSON.stringify({
            displayName: ports.merchant(),
            listings: ports.publishedListings(),
          }),
        },
      );
      state.publishStatus = "published";
      state.publishedAt = ports.now();
      state.error = null;
      ports.persistAuthentication();
      return true;
    } catch (error) {
      state.publishStatus = "failed";
      state.error = requestText(requestObject(error).message || error);
      return false;
    }
  }
  return { snapshot, refresh, publish };
}

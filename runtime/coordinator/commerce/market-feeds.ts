import { createALDataClient } from "./aldata-client.ts";
import type { ALDataClientPorts } from "./aldata-client.ts";
import { createALDataService } from "./aldata-service.ts";
import { createPontyMarket } from "./ponty.ts";
import { observeMarketPrices, observeMarketTrades } from "./price-history.ts";
import { publishedMarketListings } from "./public-listings.ts";

type PontyPorts = Parameters<typeof createPontyMarket>[1];
interface MarketFeedState {
  aldata: Parameters<typeof createALDataService>[0];
  ponty: Parameters<typeof createPontyMarket>[0];
  merchantCharacter: string | null;
  statuses: Record<string, { owner?: string | number | null } | undefined>;
  merchantCatalog: ReturnType<PontyPorts["catalog"]>;
  standPriceHistory: Parameters<typeof observeMarketPrices>[0];
  standBids: Parameters<typeof publishedMarketListings>[1];
  standListings: Parameters<typeof publishedMarketListings>[2];
}
interface MarketFeedPorts extends ALDataClientPorts {
  baseUrl?: string;
  queueMarket: () => void;
  queuePonty: () => void;
  persistSettings: () => void;
  persistAuthentication: () => void;
  anniversary: () => Parameters<typeof publishedMarketListings>[0];
  normalizePonty: (
    ...args: Parameters<PontyPorts["normalize"]>
  ) => ReturnType<PontyPorts["normalize"]>;
  realmExists: (realm: string) => boolean;
  every: (callback: () => unknown, milliseconds: number) => unknown;
}

/** Share one ALData request budget across price feeds, Ponty and listing publication. */
export function createCoordinatorMarketFeeds(state: MarketFeedState, ports: MarketFeedPorts) {
  const now = () => ports.now();
  const client = createALDataClient(ports.baseUrl || "https://aldata.earthiverse.ca", ports);
  const prices = (listings: Parameters<typeof observeMarketPrices>[1]) =>
    observeMarketPrices(
      state.standPriceHistory,
      listings,
      !state.aldata.marketListings.length,
      now(),
    );
  const trades = (entries: unknown) => observeMarketTrades(state.standPriceHistory, entries);
  const listings = () =>
    publishedMarketListings(ports.anniversary(), state.standBids, state.standListings);
  const owner = () => {
    const merchant = state.statuses[String(state.merchantCharacter)];
    return merchant && merchant.owner != null ? String(merchant.owner) : null;
  };
  const aldata = createALDataService(state.aldata, {
    request: client.request,
    now,
    observePrices: prices,
    observeTrades: trades,
    queueMatches: ports.queueMarket,
    persistSettings: ports.persistSettings,
    persistAuthentication: ports.persistAuthentication,
    owner,
    merchant: () => state.merchantCharacter,
    publishedListings: listings,
  });
  const ponty = createPontyMarket(state.ponty, {
    now,
    catalog: () => state.merchantCatalog,
    request: () => client.request("/npcs/Ponty"),
    normalize: ports.normalizePonty,
    realmExists: ports.realmExists,
    queueMatches: ports.queuePonty,
  });
  function start(): void {
    ports.every(() => ponty.refresh(), 60000);
    void aldata.refresh("all");
    ports.every(() => aldata.refresh("merchants"), 10000);
    ports.every(() => aldata.refresh("trades"), 300000);
  }
  return { client, aldata, ponty, prices, trades, listings, owner, start };
}

// The items owner's market: the market feeds
// and their freshness, purchase sources, the seller blacklist, Ponty, stand
// slots and WTB offers, sales and deconstruction, with the merchant item
// commands.
import type { InventoryEntry, Item, ItemMark } from "../../coordinator/contracts/item.ts";
import { requestObject, requestText } from "../../lifecycle/api.ts";
import { availableCraftStock, bidAcceptsLevel, deconstructable, type DeconstructionCatalog } from "../rules.ts";
import { craftProtection, type CraftReservationState } from "./production.ts";
import { type AutomaticActionState, bankCollectionReason, keptNpcSaleCopies, keptNpcSaleRule, npcSaleSpare, type PlayerSaleState, reconcilePlayerSales, replaceAutomaticAction, playerSaleReserved, reservePlayerSale, releasePlayerSale, type NpcSaleRule } from "./fates.ts";
import { type ConflictState, itemRuleConflicts, ruleOwner, sharedMember, npcSaleRuleKey, type SharedScope } from "../rules.ts";
import { entryMeta } from "../catalog-meta.ts";
import { type GoldState, protectedMerchantStorageStock, spendableGold, standFunding } from "./needs.ts";
import { partyHooks } from "../../hooks/index.ts";
import { recordItems } from "./records.ts";
import { hiddenValue } from "../../settings/coordinator/api.ts";
import { boundFired } from "../../status/coordinator/api.ts";
import type { ItemsAnswer } from "./routes/answer.ts";
import type { MarketIgnoredItem } from "../rules.ts";
import type { WithdrawalRequest } from "./storage.ts";
import { bankboiName, bankboiPack, commerceRuleKey, exchangeKey, isBankboiPack, listingKey, markKey, marketItemKey, markMatches, pontyGroupKey, pontyKey, sellerKey, stackQuantity, storagePack } from "../identity.ts";
import { pontyPrice, type ItemValueMeta, DISMANTLE_FREE_SLOTS, freeSlots, luckySlotOf, type LuckySlots, merchantStandSlots, protectedSlotsOf, standSlotsUsed, ALDATA_RATE_WINDOW_MS, STACK_SIZE_MAX, TRADE_PRICE_MAX, UPGRADE_LEVEL_MAX, WISHLIST_QUANTITY_MAX } from "../rules.ts";
import { AT_STAND, coordinatorMerchantPriority, ROUTINE_PRIORITY, legacyStandLocation, merchantKind, type EnqueueAnswer, type EnqueueAsk, type MarketListing, type MerchantWork, type PickupState, routineFor, routineEnabled, type JobReason } from "../../merchant-jobs/api.ts";
import { exchangePickup, reviseQueuedJobs } from "../../merchant-jobs/coordinator/api.ts";
import type { CommandOutcome } from "../../movement/api/coordinator.ts";
import { fresh } from "../../protocol/reports.ts";
import { played, settingsDraft, type SettingsDraft, type SettingsWrite, type SettingsWriteResult } from "../../settings/api.ts";
import { bareRealm, gameRealm, realmParts } from '../../protocol/realm.ts';

// ---------------------------------------------------------------------------------------------
// The listing types the market rows read.

export interface PublicListing extends MarketListing {
  item: Item & { name: string };
  price: number;
  quantity: number;
  seenAt: number;
  buyer?: string;
  slot?: string;
}

/** Feed normalization coerces coordinates but preserves the raw map metadata. */
export interface NormalizedPublicListing extends PublicListing {
  map: unknown;
  x: number;
  y: number;
}

export interface PriceHistory {
  [field: string]: unknown;
  lowest?: number;
  lowestLevel?: number;
  marketLow?: number;
  marketLowLevel?: number;
  recent?: number;
  recentLevel?: number;
  seenAt?: number;
  highestPublicWTB?: number;
  highestPublicWTBLevel?: number;
}

export interface MerchantIdentity {
  seller?: string;
  name?: string;
  serverRegion?: string;
  serverIdentifier?: string;
}
export interface MerchantBlock extends MerchantIdentity {
  until?: number;
  failures?: number;
  reason?: string;
  cooldownMinutes?: number;
  updatedAt?: number;
}

// ---------------------------------------------------------------------------------------------
// A feed's raw listings in one shape.

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
  value.key = listingKey({ ...value, seller: identity });
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

/** One merchant's sightings in the `/merchants` feed, as the feed measures them. */
export interface Sighting {
  lastSeen: number;
  advanced: boolean;
  gap?: number;
}

/**
 * A source's gap is the time between two advances of its ALData timestamp that a feed saw in a
 * row, so a source that comes back after an absence measures no gap until ALData sees it again.
 */
function observeSighting(sightings: Map<string, Sighting>, key: string, at: number): void {
  const before = sightings.get(key);
  const advanced = !!before && at > before.lastSeen;
  if (!before) sightings.set(key, { lastSeen: at, advanced: false });
  else if (advanced)
    sightings.set(key, { lastSeen: at, advanced: true, gap: before.advanced ? at - before.lastSeen : undefined });
}

/**
 * ALData's `/merchants` reply lists
 * every merchant it saw in the past week and carries no online field; `lastSeen` is its one
 * mark of a current merchant. A merchant with a measured gap counts while the snapshot's newest
 * sighting, which reads ALData's own clock, is within its gap of its `lastSeen`. An unmeasured one
 * counts, so the first fetch after a start shows every listed seller, as b9b5c91e's did.
 */
export function currentMerchants(sightings: Map<string, Sighting>, merchants: unknown): unknown[] {
  const entries = (Array.isArray(merchants) ? merchants : []).map((raw) => {
    const merchant = requestObject(raw);
    return { raw, key: sellerKey({ seller: merchant.id, ...merchant }), lastSeen: Date.parse(requestText(merchant.lastSeen)) || 0 };
  });
  const newest = Math.max(0, ...entries.map((entry) => entry.lastSeen));
  const listed = new Set(entries.map((entry) => entry.key));
  for (const key of sightings.keys()) if (!listed.has(key)) sightings.delete(key);
  return entries
    .filter((entry) => {
      observeSighting(sightings, entry.key, entry.lastSeen);
      const gap = sightings.get(entry.key)!.gap;
      return gap == null || newest - entry.lastSeen <= gap;
    })
    .map((entry) => entry.raw);
}

// A feed refreshes on an ask only while a reader needs its data (createCoordinatorMarketFeeds
// `wanted`), and at most once per ALData's rate window since its last attempt, a failed one
// included, the provider's own limit (rules.ts ALDATA_RATE_WINDOW_MS). The first ask that needs a
// feed refreshes it at once.
export function createFeedCadence(now: () => number, intervalMs: number) {
  let attemptedAt: number | undefined;
  return {
    due(): boolean {
      return attemptedAt === undefined || now() - attemptedAt >= intervalMs;
    },
    async run(refresh: () => Promise<void>): Promise<void> {
      attemptedAt = now();
      await refresh();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// ALData's client and the one wait after a 429 its operations share.

export interface ALDataClientPorts {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
  fetch(url: string, options: RequestInit): Promise<Response>;
}

export type ALDataRequest = Omit<RequestInit, "headers"> & { headers?: Record<string, string> };

// ALData's rate limit is its own 429 answer. After one, every request
// waits the reply's `retry-after`, given in seconds or as an HTTP date (RFC 9110 10.2.3); `null`
// when the reply carries none it can read.
function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/**
 * One client holds the wait every ALData operation shares after a 429. A request ends on ALData's
 * reply, on the fetch's own failure, or at the kept bound `aldataRequestBoundMs` when ALData never
 * answers; a firing tells the status owner's bound record and the request fails as on any failed fetch.
 */
export function createALDataClient(baseUrl: string, ports: ALDataClientPorts) {
  let resumeAt = 0;

  async function request(route: string, options: ALDataRequest = {}): Promise<unknown> {
    if (resumeAt > ports.now()) await ports.sleep(resumeAt - ports.now());
    const signal = AbortSignal.timeout(hiddenValue("aldataRequestBoundMs"));
    let response: Response;
    try {
      response = await ports.fetch(baseUrl + route, {
        ...options,
        headers: { "Content-Type": "application/json", ...options.headers },
        signal,
      });
    } catch (error) {
      if (signal.aborted) boundFired({ bound: "aldataRequestBoundMs", owner: "10", subject: route, state: { route } });
      throw error;
    }
    if (response.status === 429) {
      const wait = retryAfterMs(response.headers.get("retry-after"), ports.now());
      if (wait === null) boundFired({ bound: "ALDATA_RATE_WINDOW_MS", owner: "10", subject: route, state: { route } });
      resumeAt = ports.now() + (wait ?? ALDATA_RATE_WINDOW_MS);
      throw new Error("ALData rate limit reached");
    }
    if (!response.ok) throw new Error("ALData returned HTTP " + response.status);
    if (response.status === 204 || response.headers.get("content-length") === "0") return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  return { request };
}

// ---------------------------------------------------------------------------------------------
// The ALData feed's refresh and the snapshot it keeps.

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
  const merchantFeed = createFeedCadence(ports.now, ALDATA_RATE_WINDOW_MS),
    tradeFeed = createFeedCadence(ports.now, ALDATA_RATE_WINDOW_MS),
    merchantSightings = new Map<string, Sighting>();
  function snapshot() {
    return {
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

  async function refreshMerchants(): Promise<void> {
    readerAsks.delete('merchants');
    let snapshot = await ports.request("/merchants");
    // A snapshot with bids but no sales is unmistakably partial; try once before retaining prior sales.
    if (!normalizeMarketSales(snapshot).length && normalizeMarketBids(snapshot).length) {
      const retry = await ports.request("/merchants");
      if (normalizeMarketSales(retry).length) snapshot = retry;
    }
    // The refresh measures the sightings once, on the snapshot the refresh keeps.
    const merchants = currentMerchants(merchantSightings, snapshot),
      listings = normalizeMarketSales(merchants), buyOrders = normalizeMarketBids(merchants);
    state.merchants = merchants;
    if (listings.length || !state.marketListings.length)
      state.marketListings = listings;
    if (buyOrders.length || !state.marketBuyOrders.length)
      state.marketBuyOrders = buyOrders;
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
      if (kind === "all" || kind === "merchants") await merchantFeed.run(refreshMerchants);
      if (kind === "all" || kind === "trades") await tradeFeed.run(refreshTrades);
      state.error = null;
      ports.persistSettings();
    } catch (error) {
      state.error = requestText(requestObject(error).message || error);
    } finally {
      state.refreshing = false;
    }
    return snapshot();
  }

  /** A reader's ask: each feed a reader needs refreshes once its rate window has passed. */
  function ask(wanted: { merchants: boolean; trades: boolean }): void {
    if (state.refreshing) return;
    const merchants = wanted.merchants && merchantFeed.due(),
      trades = wanted.trades && tradeFeed.due();
    if (merchants || trades) void refresh(merchants && trades ? "all" : merchants ? "merchants" : "trades");
  }

  /** The body ALData holds for this account: the merchant's name and its configured listings. */
  function body() {
    return { displayName: ports.merchant(), listings: ports.publishedListings() };
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
          body: JSON.stringify(body()),
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
  return { snapshot, refresh, ask, body, publish };
}

// ---------------------------------------------------------------------------------------------
// ALData's saved authentication at start.

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
  };
}

// ---------------------------------------------------------------------------------------------
// Price history, the lowest price of each item across the snapshots.

/** The one lowest-price rule the feeds and the local market share: a lower price takes the lowest and its level. */
function historicalPrice(old: PriceHistory | undefined, price: number, level: number): Pick<PriceHistory, "lowest" | "lowestLevel"> {
  const lowest = !old?.lowest || price < Number(old.lowest);
  const identifiesLowest = old?.lowestLevel == null && price === Number(old?.lowest);
  return {
    lowest: lowest ? price : Number(old!.lowest),
    lowestLevel: lowest || identifiesLowest ? level : old!.lowestLevel,
  };
}
/** The one fill of a bid's quantity from listings in order, each bought up to its own quantity. */
function fill(listings: readonly PublicListing[], quantity: number): PublicListing[] {
  let remaining = quantity;
  const selected: PublicListing[] = [];
  for (const listing of listings) {
    if (remaining < 1) break;
    const buyQuantity = Math.min(remaining, Number(listing.quantity) || 1);
    selected.push({ ...listing, buyQuantity });
    remaining -= buyQuantity;
  }
  return selected;
}

function recordListing(
  history: Record<string, PriceHistory>,
  newest: Map<string, PublicListing>,
  listing: PublicListing,
): void {
  const id = listing.item.name,
    old = history[id] || {},
    previous = newest.get(id);
  const recent = previous && previous.seenAt > listing.seenAt ? previous : listing;
  history[id] = {
    ...old,
    ...historicalPrice(old, Number(listing.price), Number(listing.item.level) || 0),
    recent: recent.price,
    recentLevel: Number(recent.item.level) || 0,
    seenAt: Math.max(Number(old.seenAt) || 0, listing.seenAt),
  };
  if (!previous || previous.seenAt < listing.seenAt) newest.set(id, listing);
}


function currentLows(listings: PublicListing[]): Map<string, PublicListing> {
  const lows = new Map<string, PublicListing>();
  for (const listing of listings) {
    const previous = lows.get(listing.item.name);
    if (!previous || listing.price < previous.price) lows.set(listing.item.name, listing);
  }
  return lows;
}

export function observeMarketPrices(
  history: Record<string, PriceHistory>,
  listings: PublicListing[],
): void {
  const newest = new Map<string, PublicListing>();
  for (const listing of listings) recordListing(history, newest, listing);
  const lows = currentLows(listings);
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

// ---------------------------------------------------------------------------------------------
// The listings the console publishes.

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

// ---------------------------------------------------------------------------------------------
// The feed snapshots a listing is fresh in.

interface MarketFeedState {
  aldata: Parameters<typeof createALDataService>[0];
  ponty: Parameters<typeof createPontyMarket>[0];
  merchantCharacter: string | null;
  statuses: Record<string, { owner?: string | number | null } | undefined>;
  merchantCatalog: ReturnType<PontyPorts["catalog"]>;
  standPriceHistory: Parameters<typeof observeMarketPrices>[0];
  standBids: Parameters<typeof publishedMarketListings>[1];
  standListings: Parameters<typeof publishedMarketListings>[2];
  merchantAutomations?: Record<string, boolean | undefined>;
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
  /** The status owner's market watch: a dashboard viewer has the market or stand panel open. */
  watched(): boolean;
}

// A job's reads of the feeds since their last refresh: an add-on's `market.ponty` or
// `market.listings` read (coordinator/api.ts) names the feed it needs, and that need holds until the
// feed refreshes. The coordinator runs one set of feeds.
const readerAsks = new Set<'merchants' | 'ponty'>();
export function feedRead(feed: 'merchants' | 'ponty'): void { readerAsks.add(feed); }

/** Share one ALData client and its 429 wait across price feeds, Ponty and listing publication. */
export function createCoordinatorMarketFeeds(state: MarketFeedState, ports: MarketFeedPorts) {
  const now = () => ports.now();
  const client = createALDataClient(ports.baseUrl || "https://aldata.earthiverse.ca", ports);
  const prices = (listings: Parameters<typeof observeMarketPrices>[1]) =>
    observeMarketPrices(state.standPriceHistory, listings);
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
  // A feed is needed while a dashboard viewer has the market open (the status owner's market watch), while the
  // stand bid purchases buy from the feed's listings, or once a job read it since its last refresh.
  // The trades snapshot is needed while the account publishes, since the publication check reads it.
  const bidding = () => Object.values(state.standBids || {}).some((bid) => Number(bid?.quantity) >= 1) &&
    routineEnabled({ reason: "stand bid purchases" }, played(state, 'merchantAutomations') ?? {});
  function wanted(feed: 'merchants' | 'trades' | 'ponty'): boolean {
    if (ports.watched()) return true;
    if (feed === 'trades') return state.aldata.auth === "CORRECT" && !!owner();
    return bidding() || readerAsks.has(feed);
  }
  /**
   * The merchant's report and the dashboard's read of
   * the market ask the feeds; each refreshes when it is wanted and its rate window has passed.
   */
  function ask(): void {
    aldata.ask({ merchants: wanted('merchants'), trades: wanted('trades') });
    ponty.ask(wanted('ponty'));
  }

  // The key mail's check: the merchant's mail marks the account `YES` (merchant-jobs endings.ts), and
  // ALData confirms the key once its mail is read. The check runs on the next publication ask, the
  // one that needs a confirmed key, once ALData's rate window has passed since the mail, and once per
  // mail: a check that does not confirm the key leaves it to the player's Check button.
  let checkedAt: number | null = null;
  async function confirmAuth(): Promise<void> {
    const sentAt = Number(state.aldata.authCheckedAt) || 0, merchant = state.merchantCharacter;
    if (state.aldata.auth !== "YES" || !state.aldata.key || !merchant || checkedAt === sentAt || now() - sentAt < ALDATA_RATE_WINDOW_MS) return;
    checkedAt = sentAt;
    try {
      const result = requestObject(await client.request("/auth/" + encodeURIComponent(merchant) + "/" + encodeURIComponent(state.aldata.key)));
      state.aldata.auth = typeof result.auth === "string" && result.auth ? result.auth : "YES";
      state.aldata.authCheckedAt = checkedAt = now();
      ports.persistAuthentication();
    } catch (error) {
      state.aldata.error = requestText(requestObject(error).message || error);
    }
  }

  /**
   * The listings publish when their body changes or when ALData's trades
   * snapshot, read after the last publish, no longer holds the account. One check runs per
   * merchant report, so a report's changes go in one publish; a change made while a publish runs
   * is checked when it ends.
   */
  let published: string | null = null,
    publishing = false;
  function held(): boolean {
    const account = owner();
    if (!account || !(Number(state.aldata.tradesUpdatedAt) > Number(state.aldata.publishedAt))) return true;
    const trades: unknown[] = Array.isArray(state.aldata.trades) ? state.aldata.trades : [];
    return trades.some((entry) => String(requestObject(entry).owner) === account);
  }
  async function publish(): Promise<void> {
    if (state.aldata.auth === "YES") await confirmAuth();
    if (publishing || state.aldata.auth !== "CORRECT") return;
    const body = JSON.stringify(aldata.body());
    if (body === published && held()) return;
    publishing = true;
    let sent = false;
    try {
      sent = await aldata.publish();
    } finally {
      publishing = false;
    }
    if (!sent) return;
    published = body;
    if (JSON.stringify(aldata.body()) !== published) void publish();
  }
  return { client, aldata, ponty, prices, trades, listings, owner, ask, publish, wanted };
}

// ---------------------------------------------------------------------------------------------
// Ponty's feed.

interface PontyEntry extends MarketListing {
  seenAt?: number;
}
interface PontyState {
  listings: PontyEntry[];
  updatedAt?: number;
  error?: string | null;
}
interface PontyPorts {
  now(): number;
  catalog(): { allItems: unknown } | null;
  request(): Promise<unknown>;
  normalize(records: unknown, items: unknown): PontyEntry[];
  realmExists(realm: string): boolean;
  queueMatches(): void;
}

const realmOf = (entry: PontyEntry) => entry.serverRegion + ":" + entry.serverIdentifier;
/**
 * A local report newer than the remote feed's snapshot supersedes it for its whole
 * realm, an empty stand included. A dismissed lot stays hidden until the next Ponty read of
 * its realm, local or remote.
 */
export function createPontyMarket(state: PontyState, ports: PontyPorts) {
  let remote: PontyEntry[] = [],
    local: PontyEntry[] = [],
    remoteAt = 0,
    busy = false;
  let localReport: { realm: string; seenAt: number } | null = null;
  const dismissed = new Map<string | undefined, string>();
  const feed = createFeedCadence(ports.now, ALDATA_RATE_WINDOW_MS);

  function rebuild(): void {
    const freshLocal = local.filter((entry) => Number(entry.seenAt) > remoteAt);
    const realms = new Set(freshLocal.map(realmOf));
    if (localReport && localReport.seenAt > remoteAt) realms.add(localReport.realm);
    state.listings = freshLocal
      .concat(
        remote.filter((entry) => !realms.has(entry.serverRegion + ":" + entry.serverIdentifier)),
      )
      .filter((entry) => !dismissed.has(entry.key));
    state.updatedAt = ports.now();
  }

  function observe(observation: {
    report?: { realm: string; seenAt: number };
    listings: PontyEntry[];
  }): void {
    if (observation.report) localReport = observation.report;
    local = observation.listings;
    const read = new Set(local.map(realmOf).concat(localReport ? [localReport.realm] : []));
    for (const [key, realm] of dismissed) if (read.has(realm)) dismissed.delete(key);
    rebuild();
    ports.queueMatches();
  }

  function dismiss(key: string | undefined): void {
    const lot = remote.concat(local).find((entry) => entry.key === key);
    remote = remote.filter((entry) => entry.key !== key);
    if (lot) dismissed.set(key, realmOf(lot));
    local = local.filter((entry) => entry.key !== key);
    rebuild();
  }

  async function refresh(): Promise<void> {
    if (busy || !ports.catalog()) return;
    busy = true;
    try {
      await feed.run(async () => {
        readerAsks.delete('ponty');
        const records = await ports.request();
        remote = ports
          .normalize(records, ports.catalog()!.allItems)
          .filter((entry) => ports.realmExists(gameRealm(entry.serverRegion, entry.serverIdentifier)));
        remoteAt = ports.now();
      });
      dismissed.clear();
      state.error = null;
      rebuild();
      ports.queueMatches();
    } catch (error) {
      state.error = requestText(requestObject(error).message || error);
    } finally {
      busy = false;
    }
  }

  function ask(wanted: boolean): void {
    if (wanted && feed.due()) void refresh();
  }
  return { rebuild, observe, dismiss, refresh, ask };
}

// ---------------------------------------------------------------------------------------------
// A character's local Ponty report.

interface PontyReportListing extends MarketListing {
  rid?: string;
  item?: Item;
}
interface PontyReport {
  listings?: (PontyReportListing | null)[];
  error?: unknown;
  updatedAt?: number;
}
interface StatusReport {
  name: string;
  server?: string;
  ponty?: PontyReport;
}
type ValidListing = PontyReportListing & { rid: string; item: Item & { name: string } };

function validListing(entry: PontyReportListing | null): entry is ValidListing {
  return (
    !!entry?.rid &&
    !!entry.item?.name &&
    Number.isFinite(Number(entry.price)) &&
    Number(entry.price) > 0
  );
}

function listings(
  report: PontyReport,
  server: string,
): MarketListing[] {
  const reported = Array.isArray(report.listings) ? report.listings : [];
  return reported.filter(validListing).map((entry) => {
    const serverRegion = entry.serverRegion || realmParts(server)?.region;
    const serverIdentifier = entry.serverIdentifier || realmParts(server)?.identifier || server;
    return {
      ...entry,
      groupKey: pontyGroupKey(entry.item),
      seenAt: Number(report.updatedAt) || 0,
      serverRegion,
      serverIdentifier,
      key: pontyKey(serverRegion, serverIdentifier, entry.rid),
    };
  });
}

/** Local Ponty observations remain authoritative for their reported realm and timestamp. */
export function consumePontyReport(
  body: StatusReport,
  merchant: string | null,
) {
  const report = body.ponty;
  delete body.ponty;
  if (body.name !== merchant || !report || typeof report !== "object") return null;
  const server = String(body.server || ""), parts = realmParts(server);
  return {
    report: report.error
      ? undefined
      : { realm: parts ? parts.region + ":" + parts.identifier : server, seenAt: Number(report.updatedAt) || 0 },
    listings: listings(report, server),
  };
}

// ---------------------------------------------------------------------------------------------
// A failing seller backs off by its strikes.

export function merchantBlocked(
  records: Readonly<Record<string, MerchantBlock>>,
  entry: MerchantIdentity | null | undefined,
  now: number,
  automatic = true,
): boolean {
  const exact = records[sellerKey(entry)];
  const wildcard = records[sellerKey({ seller: entry && (entry.seller || entry.name) })];
  return [exact, wildcard].some(
    (record) =>
      !!record &&
      (automatic || record.reason === "manual") &&
      (Number(record.until) === -1 || Number(record.until) > now),
  );
}

/**
 * A failing seller backs off by today's strikes and minutes, 2^(strikes - 1) minutes, which
 * the previous release also used. Strikes outlive the cooldown; only explicit clearing resets them.
 */
export function recordMerchantFailure(
  records: Record<string, MerchantBlock>,
  listing: MerchantIdentity,
  reason: string,
  now: number,
): MerchantBlock {
  const key = sellerKey(listing),
    previous = records[key] || {};
  const failures = Math.max(0, Number(previous.failures) || 0) + 1;
  const cooldownMinutes = Math.pow(2, failures - 1);
  return (records[key] = {
    seller: listing.seller,
    serverRegion: listing.serverRegion,
    serverIdentifier: listing.serverIdentifier,
    reason,
    failures,
    until: now + cooldownMinutes * 60000,
    cooldownMinutes,
    updatedAt: now,
  });
}

// ---------------------------------------------------------------------------------------------
// Stand bids and their purchase sources.

export interface StandBid {
  price: number;
  quantity: number;
  minimumQuality?: number;
  priorityOverride?: number;
  useStandSlot?: boolean;
  acceptHigherLevels?: boolean;
  revision?: number;
  standSuppressed?: boolean;
}
interface PontyListing extends PublicListing {
  unitPrice: number;
}
interface BidState {
  standBids: Record<string, StandBid | undefined>;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
  merchantCharacter: string | null;
  merchantAutomations: Record<string, boolean | undefined>;
  ponty: { listings?: PontyListing[] };
  aldata: { marketListings: PublicListing[] };
  activeRealm: string;
}
interface BidPorts {
  publish(): void;
  log(message: string, level: string, details?: unknown): void;
  prioritized(reason: string): [string, StandBid | null][];
  planPonty(candidates: PontyListing[], quantity: number): PublicListing[];
  enqueue(ask: EnqueueAsk): EnqueueAnswer;
  persist(): void;
  dispatch(): void;
  blacklisted(listing: PublicListing): boolean;
}
// A bid purchase is a job whose job kind buys for a bid (the merchant jobs owner's `purchase: 'bid'`).
function bidPurchase(job: MerchantWork | null, itemId: string): boolean {
  return !!job && merchantKind(job.reason).purchase === 'bid' && job.bidItemId === itemId;
}

export function createBidPurchases(state: BidState, ports: BidPorts) {
  function pending(itemId: string): boolean {
    return [state.merchantCurrent, ...state.merchantQueue].some((job) => bidPurchase(job, itemId));
  }

  function removeQueued(itemId: string): number {
    return reviseQueuedJobs(state, (job) => bidPurchase(job, itemId) ? null : job);
  }

  function matchingBid(item: Item | null | undefined): StandBid | undefined {
    const bid = item?.name ? state.standBids[item.name] : undefined;
    return bid && bidAcceptsLevel(bid, item) ? bid : undefined;
  }

  function fulfill(item: Item | null | undefined, quantity: number): number {
    const amount = Math.max(0, Number(quantity) || 0),
      bid = matchingBid(item);
    if (!bid || !amount) return 0;
    const itemId = item!.name!;
    bid.quantity = Math.max(0, Number(bid.quantity) - amount);
    const remaining = Number(bid.quantity) || 0;
    if (!remaining) delete state.standBids[itemId];
    const cancelled = removeQueued(itemId);
    ports.publish();
    ports.log(
      "WTB filled for " +
        amount +
        " × " +
        itemId +
        (remaining ? "; " + remaining + " remaining" : "; order complete"),
      "success",
      cancelled ? { cancelledDuplicateJobs: cancelled } : null,
    );
    return amount;
  }

  function eligible(bid: StandBid | null, itemId: string): bid is StandBid {
    return !!bid && !(Number(bid.quantity) < 1) && !pending(itemId);
  }

  function pontyCandidates(itemId: string, bid: StandBid): PontyListing[] {
    return (state.ponty.listings || []).filter(
      (listing) =>
        listing.item &&
        listing.item.name === itemId &&
        Number(listing.unitPrice) <= Number(bid.price) &&
        bidAcceptsLevel(bid, listing.item) &&
        listing.serverIdentifier !== "PVP",
    );
  }

  // The work a bid purchase carries into `jobs.enqueue`.
  function work(itemId: string, listings: PublicListing[]): Partial<MerchantWork> {
    return { bidItemId: itemId, listings, completedListingKeys: [], homeRealm: state.activeRealm };
  }

  function queued(itemId: string, source: string, selected: PublicListing[]): void {
    ports.log(
      source +
        " matched " +
        selected.length +
        " listing" +
        (selected.length === 1 ? "" : "s") +
        " for " +
        itemId,
      "success",
    );
    ports.persist();
    ports.dispatch();
  }

  function queuePonty(): boolean {
    if (
      !routineEnabled({ reason: "stand bid purchases" }, played(state, 'merchantAutomations')) ||
      !state.merchantCharacter
    )
      return false;
    for (const [itemId, bid] of ports.prioritized("Ponty purchases")) {
      if (!eligible(bid, itemId)) continue;
      const candidates = pontyCandidates(itemId, bid),
        selected = ports.planPonty(candidates, Number(bid.quantity));
      if (!selected.length) continue;
      ports.enqueue({ reason: "Ponty purchases", target: state.merchantCharacter, fields: {
        ...work(itemId, selected), pontyCandidates: candidates, pontyQuantity: Number(bid.quantity) } });
      queued(itemId, "Ponty", selected);
      return true;
    }
    return false;
  }

  // A listing the bid may buy: its item and level, a seller other than the merchant and off the
  // blacklist, no PVP realm, and a price within the bid.
  const acceptable = (listing: PublicListing, itemId: string, bid: StandBid) =>
    listing.item?.name === itemId &&
    listing.seller !== state.merchantCharacter &&
    !ports.blacklisted(listing) &&
    listing.serverIdentifier !== "PVP" &&
    Number(listing.price) <= Number(bid.price) &&
    bidAcceptsLevel(bid, listing.item);
  function marketCandidates(itemId: string, bid: StandBid): PublicListing[] {
    return state.aldata.marketListings
      .filter((listing) => acceptable(listing, itemId, bid))
      .sort((a, b) => a.price - b.price || b.seenAt - a.seenAt);
  }
  // An add-on's `items.source` listings come after the core sources, held to the same rules,
  // and its ALData buy reaches them.
  function addonCandidates(itemId: string, bid: StandBid): PublicListing[] {
    if (!partyHooks().itemRules.sourcing()) return [];
    return partyHooks().itemRules.sources({ item: itemId, price: Number(bid.price), quantity: Number(bid.quantity) })
      .map(({ answer }) => answer as PublicListing)
      .filter((listing) => !!listing && typeof listing.seller === "string" && acceptable(listing, itemId, bid))
      .sort((a, b) => a.price - b.price);
  }


  function queueMarket(): false | undefined {
    if (!routineEnabled({ reason: "stand bid purchases" }, played(state, 'merchantAutomations'))) return false;
    if (
      !state.merchantCharacter ||
      [state.merchantCurrent, ...state.merchantQueue].some(
        (job) => !!job && merchantKind(job.reason).command === "merchant-aldata-buy",
      )
    )
      return;
    for (const [itemId, bid] of ports.prioritized("ALData marketplace purchases")) {
      if (!eligible(bid, itemId)) continue;
      const selected = fill([...marketCandidates(itemId, bid), ...addonCandidates(itemId, bid)], Number(bid.quantity));
      if (!selected.length) continue;
      ports.enqueue({ reason: "ALData marketplace purchases", target: state.merchantCharacter, fields: work(itemId, selected) });
      queued(itemId, "ALData", selected);
      break;
    }
  }
  return { pending, removeQueued, fulfill, queuePonty, queueMarket };
}

// ---------------------------------------------------------------------------------------------
// The local stands as a purchase source.

interface LocalMarketState {
  standPriceHistory: Record<string, PriceHistory>;
  standBids: Record<string, StandBid | undefined>;
  merchantAutomations: Record<string, boolean | undefined>;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
  merchantCharacter: string | null;
}
interface LocalMarketPorts {
  now(): number;
  enqueue(ask: EnqueueAsk): EnqueueAnswer;
  pending(itemId: string): boolean;
  priority(itemId: string): number;
  log(message: string, level: string): void;
}

// Each item keeps its first listing at the lowest price, which supplies the level in history().
function lowestListings(listings: (PublicListing | null)[]): Map<string, { price: number; listing: PublicListing }> {
  const current = new Map<string, { price: number; listing: PublicListing }>();
  for (const listing of listings) {
    const id = listing?.item?.name,
      price = Number(listing?.price);
    if (!id || !Number.isFinite(price) || price < 1) continue;
    if (!current.has(id) || price < current.get(id)!.price) current.set(id, { price, listing: listing! });
  }
  return current;
}

function nextPrice(
  old: PriceHistory | undefined,
  price: number,
  level: number,
  now: number,
): PriceHistory {
  return {
    ...old,
    ...historicalPrice(old, price, level),
    recent: price,
    recentLevel: level,
    seenAt: now,
  };
}

export function createLocalMarket(state: LocalMarketState, ports: LocalMarketPorts) {
  function history(listings: (PublicListing | null)[]): boolean {
    let changed = false;
    for (const [id, { price, listing }] of lowestListings(listings)) {
      const old = state.standPriceHistory[id];
      const next = nextPrice(old, price, Number(listing.item?.level) || 0, ports.now());
      if (!old || old.lowest !== next.lowest || old.recent !== next.recent) {
        state.standPriceHistory[id] = next;
        changed = true;
      }
    }
    return changed;
  }

  function eligible(listing: PublicListing | null): listing is PublicListing {
    const bid = listing?.item?.name ? state.standBids[listing.item.name] : undefined;
    return (
      !!bid &&
      bid.quantity > 0 &&
      !ports.pending(listing!.item.name) &&
      Number(listing!.price) <= Number(bid.price) &&
      bidAcceptsLevel(bid, listing!.item)
    );
  }


  function observe(listings: unknown): boolean {
    if (!Array.isArray(listings)) return false;
    const reports = listings as (PublicListing | null)[];
    const changed = history(reports);
    if (!routineEnabled({ reason: "stand bid purchases" }, played(state, 'merchantAutomations')) || state.merchantCurrent)
      return changed;
    const matches = reports
      .filter(eligible)
      .sort(
        (a, b) => ports.priority(b.item.name) - ports.priority(a.item.name) || a.price - b.price,
      );
    if (!matches.length) return changed;
    const id = matches[0]!.item.name,
      selected = fill(matches.filter((entry) => entry.item.name === id), state.standBids[id]!.quantity);
    if (!selected.length) return changed;
    ports.enqueue({ reason: "stand bid purchases", target: state.merchantCharacter, fields: { bidItemId: id, listings: selected } });
    ports.log(
      "Bid matched for " + id + " at " + selected[0]!.price.toLocaleString() + " gold",
      "success",
    );
    return true;
  }
  return { observe };
}

// ---------------------------------------------------------------------------------------------
// Manual market orders.

export interface OrderListing extends PublicListing {
  rid?: unknown;
  buyQuantity?: number;
}
export interface PontyOrderListing extends OrderListing {
  key: string;
  serverRegion: string;
  serverIdentifier: string;
  unitPrice: number;
  groupKey: string;
}
export interface ManualOrderState {
  merchantCharacter: string | null;
  activeRealm: string;
  merchantQueue: MerchantWork[];
  merchantCurrent: MerchantWork | null;
  statuses: Record<string, { server?: string; nearbyStandListings?: OrderListing[] } | undefined>;
  standListingCache?: OrderListing[];
  aldata: { marketListings: OrderListing[]; marketBuyOrders: OrderListing[] };
  ponty: { listings: PontyOrderListing[] };
}
export interface ManualOrderPorts {
  now(): number;
  nextCommand(): number;
  enqueue(ask: EnqueueAsk): EnqueueAnswer;
  log(message: string, level: string, details?: unknown): void;
  persist(): void;
  dispatch(): void;
  plan(
    candidates: PontyOrderListing[],
    quantity: number,
    server?: string,
  ): PontyOrderListing[] | null;
}
export function createManualOrders(state: ManualOrderState, ports: ManualOrderPorts) {
  function job(reason: JobReason, fields: Omit<Partial<MerchantWork>, "reason">): MerchantWork & { reason: JobReason } {
    return {
      id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
      target: state.merchantCharacter,
      reason,
      manual: true,
      ...fields,
      queuedAt: ports.now(),
    };
  }
  // Each order is its own job, asked of `jobs.enqueue` with the work it carries.
  function queue(work: MerchantWork & { reason: JobReason }): void {
    ports.enqueue({ reason: work.reason, target: work.target, fields: work });
  }
  function finish(message: string, details?: unknown): void {
    ports.log(message, "info", details);
    ports.persist();
    ports.dispatch();
  }
  function stand(listings: OrderListing[]): MerchantWork {
    const work = job("stand purchases", { listings });
    queue(work);
    finish(
      "Queued " + listings.length + " player-stand purchase" + (listings.length === 1 ? "" : "s"),
    );
    return work;
  }
  function aldata(listing: OrderListing, quantity: number, sale: boolean): MerchantWork {
    const amount = Math.min(quantity, Number(listing.quantity) || 1);
    const fields = sale
      ? { buyOrder: listing, sellQuantity: amount }
      : { listings: [{ ...listing, buyQuantity: amount }], completedListingKeys: [] };
    const work = job(sale ? "ALData marketplace sales" : "ALData marketplace purchases", {
      ...fields,
      homeRealm: state.activeRealm,
    });
    queue(work);
    if (sale)
      finish("Manual ALData marketplace sale queued", {
        buyer: listing.buyer,
        item: listing.item.name,
        quantity: amount,
      });
    else
      finish("Manual ALData marketplace purchase queued", {
        seller: listing.seller,
        item: listing.item.name,
      });
    return work;
  }
  function candidates(keys: Set<unknown>, maxPrice: number): PontyOrderListing[] {
    const reserved = new Set(
      [state.merchantCurrent, ...state.merchantQueue]
        .filter((work) => work?.reason === "Ponty purchases")
        .flatMap((work) => (work!.listings || []).map((entry) => entry.key)),
    );
    return state.ponty.listings
      .filter((entry) => eligible(entry, keys, reserved, maxPrice))
      .sort(
        (a, b) =>
          a.unitPrice - b.unitPrice ||
          (a.serverRegion + a.serverIdentifier).localeCompare(b.serverRegion + b.serverIdentifier),
      );
  }
  function eligible(
    entry: PontyOrderListing,
    keys: Set<unknown>,
    reserved: Set<string | undefined>,
    price: number,
  ): boolean {
    return (
      keys.has(entry.key) &&
      !reserved.has(entry.key) &&
      entry.serverIdentifier !== "PVP" &&
      entry.unitPrice <= price
    );
  }
  function ponty(selected: PontyOrderListing[], quantity: number): MerchantWork[] {
    const realms = new Map<string, PontyOrderListing[]>();
    for (const listing of selected) {
      const realm = gameRealm(listing.serverRegion, listing.serverIdentifier);
      if (!realms.has(realm)) realms.set(realm, []);
      realms.get(realm)!.push(listing);
    }
    const jobs = [...realms].map(([realm, listings]) =>
      job("Ponty purchases", {
        listings,
        manual: true,
        realm,
        pontyPlanned: true,
        homeRealm: state.activeRealm,
        completedListingKeys: [],
      }),
    );
    jobs.forEach(queue);
    finish("Manual Ponty purchase queued", {
      item: selected[0]!.item.name,
      quantity,
      price: selected.reduce((sum, entry) => sum + entry.price, 0),
    });
    return jobs;
  }
  return { stand, aldata, candidates, ponty };
}

// ---------------------------------------------------------------------------------------------
// A purchase job's progress.

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
    if (!job.completedListingKeys?.includes(key))
      recordItems({ decision: "bought", subject: String(state.merchantCharacter), by: job.manual ? "player" : "M2", listing: key, source: job.reason });
    job.completedListingKeys = [...new Set((job.completedListingKeys || []).concat(key))];
    syncCompleted(job);
    job.heartbeatAt = ports.now();
  }
  function cancelQueued(listing: PurchaseListing): number {
    let count = 0;
    reviseQueuedJobs(state, (job) => {
      if (!queuedPurchase(job)) return job;
      const remaining = job.listings.filter((entry) => sellerKey(entry) !== sellerKey(listing));
      count += job.listings.length - remaining.length;
      return remaining.length ? { ...job, listings: remaining } : null;
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
      (entry) => sellerKey(entry) === sellerKey(listing) && !job.completedListingKeys!.includes(entry.key),
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
      seller = sellerKey(listing);
    reviseQueuedJobs(state, (queued) => {
      if (!queuedPurchase(queued)) return queued;
      const matching = queued.listings.filter((entry) => sellerKey(entry) === seller),
        remaining = queued.listings.filter((entry) => sellerKey(entry) !== seller);
      additional.push(...matching.map((entry) => ({ ...entry, bidItemId: entry.bidItemId || queued.bidItemId || null })));
      return remaining.length ? { ...queued, listings: remaining } : null;
    });
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

// ---------------------------------------------------------------------------------------------
// The purchase sources in order.

type PurchaseState = Parameters<typeof createLocalMarket>[0] &
  Parameters<typeof createBidPurchases>[0] & {
    statuses: Record<string, { server?: string } | undefined>;
  };
type BidPurchasePorts = Parameters<typeof createBidPurchases>[1];
type PurchasePorts = Omit<BidPurchasePorts, "planPonty"> & Pick<LocalMarketPorts, "now"> & {
  priority: (job: { reason: string; bidItemId: string }) => number;
  planPonty: (
    ...args: [...Parameters<BidPurchasePorts["planPonty"]>, string | undefined, true]
  ) => ReturnType<BidPurchasePorts["planPonty"]>;
};

/** Local and remote offers share pending-bid detection, `jobs.enqueue` and the merchant's current realm. */
export function createCoordinatorPurchases(state: PurchaseState, ports: PurchasePorts) {
  const local = createLocalMarket(state, {
    ...ports,
    pending: (itemId) => bids.pending(itemId),
    priority: (itemId) => ports.priority({ reason: "stand bid purchases", bidItemId: itemId }),
  });
  const bids = createBidPurchases(state, {
    ...ports,
    planPonty: (candidates, quantity) =>
      ports.planPonty(
        candidates,
        quantity,
        state.statuses[String(state.merchantCharacter)]?.server,
        true,
      ),
  });
  return { local, bids };
}

// ---------------------------------------------------------------------------------------------
// Marketplace visits batched into one job.

function tagged(listings: readonly MarketListing[], job: MerchantWork): MarketListing[] {
  return listings.map((listing) => ({
    ...listing,
    bidItemId: listing.bidItemId || job.bidItemId || null,
  }));
}

/** Batch only sellers already on the selected itinerary, preserving unrelated queue entries. */
export function batchMarketplaceVisits(job: MerchantWork, queue: readonly MerchantWork[]) {
  if (merchantKind(job.reason).command !== "merchant-aldata-buy" || !job.listings?.length) return null;
  const sellers = new Set(job.listings.map(sellerKey));
  const listings = tagged(job.listings, job),
    retained: MerchantWork[] = [];
  let batchedOrders = 0;
  for (const queued of queue) {
    if (merchantKind(queued.reason).command !== "merchant-aldata-buy" || routineFor(queued) !== routineFor(job) || !Array.isArray(queued.listings)) {
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

// ---------------------------------------------------------------------------------------------
// The native stand's WTB offers.

export interface NativeOffer {
  token: string;
  itemId: string;
  slot: string;
  revision: number;
  level: number;
  price: number;
  quantity: number;
  acknowledged: number;
  rid?: string;
  auto: boolean;
  phase: "placing" | "live" | "removing" | "blocked";
  problem?: string;
  // The copies of the item the merchant held in bag and bank when the offer was placed.
  heldAtStart?: number;
  exact?: boolean;
}
export interface NativeStandLedger {
  sequence: number;
  purchases?: Record<string, { item: Item; quantity: number; jobId: string }>;
  offers: Record<string, NativeOffer>;
  problems: Record<string, string>;
}
/** The stand plan's state; the spendable gold reads it whole. */
export interface NativeStandState extends GoldState {
  standBids: Record<string, StandBid | undefined>;
  standListings?: { id: string; state?: string; item?: Item | null; price?: number; quantity?: number }[];
  nativeStand?: NativeStandLedger;
  autoStandBuys?: boolean;
  bankSnapshot?: { gold?: number; packs?: Record<string, unknown> } | null;
  merchantRoutinePriorities?: Record<string, number>;
}
export function nativeLedger(state: NativeStandState): NativeStandLedger {
  return state.nativeStand ||= { sequence: 0, offers: {}, problems: {} };
}
export function nativeAllocation(state: NativeStandState): { itemId: string; auto: boolean }[] {
  const entries = Object.entries(state.standBids).filter((entry): entry is [string, StandBid] => !!entry[1] && entry[1].quantity > 0);
  // A buy order's priority is the merchant jobs owner's priority of its purchase job, so the stand and the queue
  // order the same bids alike.
  const priority = (itemId: string) => coordinatorMerchantPriority(state as unknown as Parameters<typeof coordinatorMerchantPriority>[0],
    { reason: "stand bid purchases", bidItemId: itemId });
  entries.sort(([a], [b]) => priority(b) - priority(a) || a.localeCompare(b));
  const explicit = entries.filter(([, bid]) => bid.useStandSlot).map(([itemId]) => ({ itemId, auto: false }));
  const sales = (state.standListings || []).filter(sale => sale.state !== "paused").length;
  const slots = merchantStandSlots(state), spare = Math.max(0, slots - sales - explicit.length);
  const automatic = state.autoStandBuys ? entries.filter(([, bid]) => !bid.useStandSlot && !bid.standSuppressed)
    .slice(0, spare).map(([itemId]) => ({ itemId, auto: true })) : [];
  return explicit.concat(automatic).slice(0, slots);
}
export function nativeOccupants(state: NativeStandState, except: string) {
  return [
    ...(state.standListings || []).filter(sale => sale.state !== "paused").map(sale => ({ id: "sale:" + sale.id, itemId: sale.item?.name, kind: "sale", price: sale.price, quantity: sale.quantity })),
    ...Object.entries(state.standBids).filter(([id, bid]) => id !== except && bid?.useStandSlot)
      .map(([id, bid]) => ({ id: "buy:" + id, itemId: id, kind: "buy", price: bid!.price, quantity: bid!.quantity })),
  ];
}
export function displaceNativeOccupant(state: NativeStandState, id: string): void {
  if (id.startsWith("sale:")) {
    const sale = state.standListings?.find(entry => entry.id === id.slice(5));
    if (sale) sale.state = "paused";
  } else {
    const bid = state.standBids[id.slice(4)];
    if (bid) { bid.useStandSlot = false; bid.standSuppressed = true; }
  }
}
export interface NativeObservation {
  slots: Record<string, Item | null | undefined>;
  open: boolean;
  receipts?: Record<string, number>;
  removed?: string;
  failed?: string;
  gold?: number;
  space?: boolean;
}
function offerMatches(offer: NativeOffer, item: Item | null | undefined): boolean {
  return !!item?.b && item.name === offer.itemId && Number(item.level || 0) === offer.level && Number(item.price) === offer.price;
}
function block(offer: NativeOffer, problem: string): void {
  offer.phase = "blocked"; offer.problem = problem;
}
/** The copies of an offer's item the merchant holds in its reported bag and the bank snapshot. */
function heldCopies(state: NativeStandState, offer: Pick<NativeOffer, "itemId" | "level" | "exact">): number {
  const bag = requestItems(requestObject(state.statuses?.[String(state.merchantCharacter)]).items);
  const bank = Object.values(state.bankSnapshot?.packs || {}).flatMap(requestItems);
  return bag.concat(bank).filter(item => item.name === offer.itemId &&
    (offer.exact ? Number(item.level || 0) === offer.level : Number(item.level || 0) >= offer.level))
    .reduce((sum, item) => sum + (Number(item.q) || 1), 0);
}
function requestItems(value: unknown): Item[] {
  return Array.isArray(value) ? value.filter((item): item is Item => !!item && typeof item === "object") : [];
}
function fillEvidence(offer: NativeOffer, observation: NativeObservation): number {
  const item = observation.slots[offer.slot];
  const receipt = Number(observation.receipts?.[offer.token]) || 0;
  const slotFill = offerMatches(offer, item) && String(item!.rid) === offer.rid ? offer.quantity - Number(item!.q || 1) : 0;
  return Math.max(offer.acknowledged, Math.min(offer.quantity, receipt), slotFill);
}
/** Each offer owns a bounded batch. Only matching offer quantities or trade receipts are fill evidence. */
export function createNativeStand(state: NativeStandState, fulfill: (item: Item, quantity: number) => unknown) {
  // Each offer placed or removed, and each buy order paused short of gold, is one record and notice.
  const record = (decision: "listed" | "unlisted" | "orderPaused", details: Record<string, unknown>) =>
    recordItems({ decision, subject: String(state.merchantCharacter), by: "native stand", ...details });
  function acknowledge(offer: NativeOffer, observation: NativeObservation): number {
    const filled = fillEvidence(offer, observation), delta = filled - offer.acknowledged;
    if (delta <= 0) return filled;
    offer.acknowledged = filled;
    recordItems({ decision: "bought", subject: String(state.merchantCharacter), by: "N3", source: "native stand", item: offer.itemId, level: offer.level, quantity: delta });
    const bid = state.standBids[offer.itemId];
    if (bid && Number(bid.revision || 0) === offer.revision) fulfill({ name: offer.itemId, level: offer.level }, delta);
    return filled;
  }
  function adopt(offer: NativeOffer, item: Item | null | undefined): void {
    if (offer.rid || !offerMatches(offer, item) || Number(item!.q || 1) > offer.quantity) return;
    offer.rid = String(item!.rid); offer.phase = "live";
    record("listed", { item: offer.itemId, level: offer.level, slot: offer.slot, kind: "offer", quantity: offer.quantity });
  }
  function removed(offer: NativeOffer, observation: NativeObservation): boolean {
    return observation.removed === offer.token && offer.phase === "removing" && !observation.slots[offer.slot];
  }
  function recoverConfirmed(offer: NativeOffer, item: Item | null | undefined): void {
    if (!offerMatches(offer, item) || String(item!.rid) !== offer.rid || offer.phase !== "blocked") return;
    offer.phase = "live"; delete offer.problem;
  }
  function reconcileIdentity(offer: NativeOffer, observation: NativeObservation): boolean {
    // Reopening can move trade slots. Follow the native identity before comparing slots.
    const relocated = Object.entries(observation.slots).find(([, item]) => offerMatches(offer, item) && (offer.rid ? String(item!.rid) === offer.rid : Number(item!.q || 1) <= offer.quantity));
    if (relocated) offer.slot = relocated[0];
    const item = observation.slots[offer.slot];
    adopt(offer, item);
    recoverConfirmed(offer, item);
    if (item && (!offerMatches(offer, item) || String(item.rid) !== offer.rid)) {
      // Receipts remain valid evidence; a different native identity is not a fill.
      acknowledge(offer, observation);
      if (offerMatches(offer, item)) {
        offer.rid = String(item.rid);
        offer.quantity = offer.acknowledged + Number(item.q || 1);
        offer.phase = "live"; delete offer.problem;
      } else delete nativeLedger(state).offers[offer.token];
      return true;
    }
    return false;
  }
  // A placement the stand report shows empty, with no native identity, is not an
  // advertisement; its receipts apply and the reservation goes, so planning places it again.
  function retryUnconfirmed(offer: NativeOffer, observation: NativeObservation): boolean {
    if (observation.slots[offer.slot] || offer.rid || offer.phase === "removing" || observation.failed === offer.token) return false;
    acknowledge(offer, observation);
    delete nativeLedger(state).offers[offer.token];
    return true;
  }
  // emptied() counts a live offer whose slot empties without a receipt from the copies
  // the merchant received since it was placed, books them as filled and drops the offer; plan()
  // places a new offer for the rest.
  function emptied(offer: NativeOffer, observation: NativeObservation): void {
    const received = Math.max(0, heldCopies(state, offer) - Number(offer.heldAtStart));
    const before = offer.acknowledged;
    acknowledge(offer, { ...observation, receipts: { ...observation.receipts, [offer.token]: Math.min(offer.quantity, received) } });
    delete nativeLedger(state).offers[offer.token];
    record("unlisted", { item: offer.itemId, level: offer.level, slot: offer.slot, kind: "offer", by: "N4",
      received: offer.acknowledged - before, filled: offer.acknowledged, quantity: offer.quantity });
  }
  function observeOffer(offer: NativeOffer, observation: NativeObservation): void {
    // A ledger saved by v1.5.0 has no start count (commerce/native-stand.ts NativeOffer); the first
    // report after start records it, so the offer counts only the copies received after it.
    offer.heldAtStart ??= heldCopies(state, offer);
    if (!observation.open) { acknowledge(offer, observation); return; }
    if (reconcileIdentity(offer, observation)) return;
    const item = observation.slots[offer.slot];
    if (retryUnconfirmed(offer, observation)) return;
    const filled = acknowledge(offer, observation);
    if (filled === offer.quantity || removed(offer, observation)) {
      delete nativeLedger(state).offers[offer.token];
      record("unlisted", { item: offer.itemId, level: offer.level, slot: offer.slot, kind: "offer", filled });
      return;
    }
    if (observation.failed === offer.token) block(offer, "Native offer operation was not confirmed");
    else if (!item) emptied(offer, observation);
  }
  function observe(observation: NativeObservation): void {
    for (const offer of Object.values(nativeLedger(state).offers)) observeOffer(offer, observation);
  }
  function wanted(offer: NativeOffer, allocation: ReturnType<typeof nativeAllocation>): boolean {
    const bid = state.standBids[offer.itemId];
    return !!bid && allocation.some(entry => entry.itemId === offer.itemId) &&
      Number(bid.revision || 0) === offer.revision && bid.price === offer.price &&
      Number(bid.minimumQuality || 0) === offer.level && bid.quantity >= offer.quantity - offer.acknowledged;
  }
  function reserve(entry: { itemId: string; auto: boolean }, slot: string): NativeOffer {
    const ledger = nativeLedger(state), bid = state.standBids[entry.itemId]!;
    const quantity = Math.min(bid.quantity, WISHLIST_QUANTITY_MAX);
    const token = "native-" + ++ledger.sequence;
    const level = Number(bid.minimumQuality || 0), exact = bid.acceptHigherLevels === false;
    return ledger.offers[token] = { token, ...entry, slot, revision: Number(bid.revision || 0), level,
      price: bid.price, quantity, acknowledged: 0, phase: "placing", exact,
      heldAtStart: heldCopies(state, { itemId: entry.itemId, level, exact }) };
  }
  function placementProblem(itemId: string, observation: NativeObservation): string | null {
    const bid = state.standBids[itemId]!;
    if (Number(bid.minimumQuality || 0) > UPGRADE_LEVEL_MAX || bid.price > TRADE_PRICE_MAX) return "Native stand terms exceed the game's level or price limit";
    if (observation.space === false) return "Insufficient inventory space";
    if (Number(observation.gold) < bid.price) return "Waiting for merchant to withdraw bank gold";
    return null;
  }
  function freeSlot(observation: NativeObservation): string | undefined {
    return Array.from({ length: merchantStandSlots(state) }, (_, i) => "trade" + (i + 1)).find(key => !observation.slots[key] && !Object.values(nativeLedger(state).offers).some(offer => offer.slot === key));
  }
  function creation(allocation: ReturnType<typeof nativeAllocation>, observation: NativeObservation): NativeOffer[] {
    const ledger = nativeLedger(state);
    for (const entry of allocation) {
      const problem = placementProblem(entry.itemId, observation);
      if (problem) ledger.problems[entry.itemId] = problem;
      if (Object.values(ledger.offers).some(offer => offer.itemId === entry.itemId)) continue;
      const slot = freeSlot(observation);
      if (problem || !slot) { ledger.problems[entry.itemId] = problem || "Waiting for a stand slot"; continue; }
      return [reserve(entry, slot)];
    }
    return [];
  }
  // goldPaused holds a buy order whose price exceeds the carried and banked gold above
  // the reserve; plan() places no offer for it, or removes its offer at this reconcile, until gold
  // arrives.
  function goldPaused(itemId: string, observation: NativeObservation): boolean {
    return state.standBids[itemId]!.price > spendableGold(state, Number(observation.gold) || 0);
  }
  function plan(observation: NativeObservation, suspended: boolean) {
    const ledger = nativeLedger(state), pending = Object.values(ledger.purchases || {});
    const unpaused = suspended ? [] : nativeAllocation(state).filter(entry => !pending.some(purchase => purchase.item.name === entry.itemId));
    const paused = unpaused.filter(entry => goldPaused(entry.itemId, observation));
    for (const entry of paused) if (ledger.problems[entry.itemId] !== "paused: gold") record("orderPaused", { item: entry.itemId });
    const allocation = unpaused.filter(entry => !paused.includes(entry));
    const remove: NativeOffer[] = [];
    for (const offer of Object.values(ledger.offers)) {
      if (wanted(offer, allocation)) continue;
      offer.phase = "removing"; remove.push(offer);
    }
    ledger.problems = Object.fromEntries([...pending.map(purchase => [String(purchase.item.name), "Purchase outcome unconfirmed; reconciliation required"]),
      ...paused.map(entry => [entry.itemId, "paused: gold"])]);
    const create = !observation.open || remove.length ? [] : creation(allocation, observation);
    return { remove, create };
  }
  return { observe, plan };
}

// ---------------------------------------------------------------------------------------------
// NPC sale marks and player NPC sales.

export interface NpcSale {
  id: string;
  source: string;
  character?: string;
  receivedAt?: number;
  slot: number;
  item: Item;
  quantity: number;
  state?: string;
  error?: string | null;
  // The failure code of the block; `error` is its message.
  code?: string | null;
  retryCount?: number;
  retryAt?: number;
  blockedInventory?: string;
  auto?: boolean;
  autoRuleKey?: string;
  queuedAt?: number;
}
type Inventory = readonly ({ slot: number; item: Item } | null)[];
const sameIgnoringLock = (a: Item, b: Item) =>
  markMatches({ ...a, l: undefined }, { ...b, l: undefined });
// A sale blocked on a missing or locked copy lifts when the merchant's bag changes.
export function inventorySignature(inventory: readonly ({ slot?: number; item?: Item | null } | null)[]): string {
  return JSON.stringify(inventory.map((entry) => entry && [entry.slot, entry.item]));
}
// A failed sale waits v1.5.0's backoff, 5 s after its first failure up to 60 s from its
// fourth, whatever its source.
const NPC_SALE_RETRY_MS = [5000, 15000, 30000, 60000] as const; // b9b5c91e:runtime/coordinator/merchant/npc-sales.ts:132
export const readyNpcSales = (marks: NpcSale[], now: number) =>
  marks.filter((mark) => mark.source !== "character" && mark.state !== "blocked" && (mark.retryAt || 0) <= now);

// One record and notice when a sale blocks and when it lifts; its subject is the character that
// handed the copy over, else the merchant.
function saleBlocked(mark: NpcSale, phase: "blocked" | "lifted", by: string): void {
  recordItems({ decision: "saleBlocked", subject: mark.character || "merchant", by, phase, item: mark.item.name, slot: mark.slot,
    ...(phase === "blocked" ? { code: mark.code ?? undefined, error: mark.error ?? undefined } : {}) });
}
function clearBlocked(mark: NpcSale): void {
  if (mark.state !== "blocked") return;
  saleBlocked(mark, "lifted", "S1");
  mark.error = null;
  mark.code = null;
  delete mark.blockedInventory;
}

// A locked copy has no failure code.
function blockInventory(mark: NpcSale, locked: boolean, signature: string): void {
  const error = locked ? 'Item is locked' : 'Marked item is not in merchant inventory', changed = mark.state !== 'blocked' || mark.error !== error;
  mark.state = 'blocked';
  mark.error = error;
  mark.code = locked ? null : 'marked_missing';
  mark.blockedInventory = signature;
  if (changed) saleBlocked(mark, "blocked", "S1");
}

// An automatic sale whose copy stayed missing across a bag change goes; the automatic marking
// marks the copy again if it comes back.
function missingAgain(original: NpcSale): boolean {
  return !!original.auto && original.state === 'blocked' && original.code === 'marked_missing';
}

function reconcileInventory(
  mark: NpcSale,
  inventory: Inventory,
  used: Map<number, number>,
  signature: string,
): "duplicate" | "blocked" | "ready" {
  const matches = inventory.filter(
    (entry): entry is NonNullable<Inventory[number]> => !!entry && sameIgnoringLock(entry.item, mark.item),
  );
  const available = (entry: NonNullable<Inventory[number]>) => !used.has(entry.slot) ||
    (!!mark.character && (used.get(entry.slot) || 0) < (Number(entry.item.q) || 1));
  const entry =
    matches.find((entry) => entry.slot === mark.slot && available(entry)) || matches.find(available);
  if (!entry && matches.length && !mark.character) return "duplicate";
  if (!entry || entry.item.l) {
    blockInventory(mark, !!entry, signature);
    return "blocked";
  }
  used.set(entry.slot, (used.get(entry.slot) || 0) + mark.quantity);
  mark.slot = entry.slot;
  clearBlocked(mark);
  return "ready";
}

function reconcileMark(
  original: NpcSale,
  inventory: Inventory,
  used: Map<number, number>,
  signature: string,
  running: boolean,
  now: number,
): NpcSale | null {
  const mark = { ...original };
  if (mark.source === "character") return mark;
  if (running) {
    mark.state = "running";
    return mark;
  }
  if (mark.state === "blocked" && mark.blockedInventory === signature) return mark;
  if (mark.source === "merchant") {
    const result = reconcileInventory(mark, inventory, used, signature);
    if (result === "duplicate") return null;
    if (result === "blocked") return mark.code === 'marked_missing' && missingAgain(original) ? null : mark;
  } else clearBlocked(mark);
  mark.state = (mark.retryAt || 0) > now ? "retrying" : "queued";
  return mark;
}

/** Rebuild runnable work from durable intent; a missing job must not strand a mark. */
export function reconcileNpcSales(
  marks: NpcSale[],
  inventory: Inventory,
  running: boolean,
  now: number,
) {
  const signature = inventorySignature(inventory);
  const used = new Map<number, number>(),
    retained: NpcSale[] = [];
  for (const original of marks) {
    const mark = reconcileMark(original, inventory, used, signature, running, now);
    if (mark) retained.push(mark);
  }
  return {
    marks: retained,
    changed: JSON.stringify(marks) !== JSON.stringify(retained),
    runnable: readyNpcSales(retained, now).length > 0,
  };
}

/** A failed sale retries after NPC_SALE_RETRY_MS; `retryCount` picks the step. */
export function failNpcSales(marks: NpcSale[], ids: readonly string[], error: string, now: number, code?: unknown) {
  return marks.map((mark) => {
    if (!ids.includes(mark.id)) return mark;
    const retryCount = (mark.retryCount || 0) + 1;
    return { ...mark, state: "retrying", error, code: typeof code === 'string' ? code : null, retryCount,
      retryAt: now + NPC_SALE_RETRY_MS[Math.min(NPC_SALE_RETRY_MS.length, retryCount) - 1]! };
  });
}

/** The sales the merchant reports blocked wait, with the game's text and code, until the bag they
 * were blocked on changes (the same signature reconcileMark compares). */
export function blockNpcSales(marks: NpcSale[], blocked: readonly { id: string; error?: unknown; code?: unknown }[],
  inventory: readonly ({ slot?: number; item?: Item | null } | null)[]): void {
  const signature = inventorySignature(inventory);
  for (const report of blocked) {
    const mark = marks.find(entry => entry.id === report.id);
    if (!mark) continue;
    const error = requestText(report.error || "Item unavailable"), changed = mark.state !== "blocked" || mark.error !== error;
    mark.state = "blocked";
    mark.error = error;
    mark.code = typeof report.code === "string" ? report.code : null;
    mark.blockedInventory = signature;
    if (changed) saleBlocked(mark, "blocked", "S1");
  }
}

/** The sales the merchant reports done leave the list, one `items.sold` record each. */
export function resolveNpcSales(marks: NpcSale[], ids: readonly string[]): NpcSale[] {
  return marks.filter((mark) => {
    if (!ids.includes(mark.id)) return true;
    recordItems({ decision: "sold", subject: mark.character || "merchant", by: mark.auto ? "S1" : "player", source: "npc",
      item: mark.item.name, quantity: mark.quantity });
    return false;
  });
}

// ---------------------------------------------------------------------------------------------
// Stand marks, counted against the stand slots.

export interface StandMark extends InventoryEntry {
  id: string;
  price: number;
  quantity: number;
  state: string;
  queuedAt: number;
  bankPack?: string;
  bankSlot?: number;
  tradeSlot?: string;
}
export interface StandMarkState {
  standBids?: Record<string, { useStandSlot?: boolean } | undefined>;
  standListings: StandMark[];
  merchantCharacter: string | null;
  withdrawals: Record<string, { pack: string; slot?: number; item?: Item | null }[] | undefined>;
  statuses: Record<string, { items?: (InventoryEntry | null)[] } | undefined>;
  bankSnapshot: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
}
interface StandSource extends InventoryEntry {
  bankPack?: string;
}
interface StandMarkPorts {
  now(): number;
  nextCommand(): number;
}
function sourceKey(source: StandSource): string {
  return source.bankPack
    ? "bank:" + source.bankPack + ":" + source.slot
    : "merchant:" + source.slot;
}

export function createStandMarks(state: StandMarkState, ports: StandMarkPorts) {
  function ensureWithdrawal(listing: StandMark): void {
    if (!listing.bankPack || !state.merchantCharacter) return;
    const withdrawals = (state.withdrawals[String(state.merchantCharacter)] ||= []);
    const request = { pack: listing.bankPack, slot: listing.bankSlot, item: listing.item };
    if (!withdrawals.some((entry) => JSON.stringify(entry) === JSON.stringify(request)))
      withdrawals.push(request);
  }
  function make(source: StandSource, price: number, existingId?: string): StandMark {
    return {
      id: existingId || "stand-" + ports.now() + "-" + ports.nextCommand(),
      slot: source.slot,
      item: source.item,
      price,
      quantity: Math.max(1, Math.min(STACK_SIZE_MAX, Number(source.item?.q) || 1)),
      state: "configured",
      queuedAt: ports.now(),
      bankPack: source.bankPack || undefined,
      bankSlot: source.bankPack ? source.slot : undefined,
    };
  }
  function matchingSources(wanted: string): StandSource[] {
    const sources: StandSource[] = [];
    collectSources(sources, state.statuses[String(state.merchantCharacter)]?.items, wanted);
    for (const [pack, entries] of Object.entries(state.bankSnapshot?.packs || {}))
      collectSources(sources, entries, wanted, pack);
    return sources;
  }
  function collectSources(
    sources: StandSource[],
    entries: (InventoryEntry | null)[] | undefined,
    wanted: string,
    pack?: string,
  ): void {
    for (const entry of entries || [])
      if (entry?.item && markKey(entry.item) === wanted)
        sources.push(
          pack
            ? { slot: entry.slot, item: entry.item, bankPack: pack }
            : { slot: entry.slot, item: entry.item },
        );
  }
  function reprice(wanted: string, price: number): Set<string> {
    const covered = new Set<string>();
    state.standListings.forEach((existing, index) => {
      if (markKey(existing.item) !== wanted) return;
      const source = {
        slot: existing.bankPack ? existing.bankSlot : existing.slot,
        item: existing.item,
        bankPack: existing.bankPack,
      };
      const updated = make(source, price, existing.id);
      state.standListings[index] = updated;
      if (existing.state !== "live" && !existing.tradeSlot) covered.add(sourceKey(source));
      ensureWithdrawal(updated);
    });
    return covered;
  }
  function markAll(item: Item, price: number): void {
    const wanted = markKey(item),
      covered = reprice(wanted, price);
    for (const source of matchingSources(wanted)) {
      if (standSlotsUsed(state) >= merchantStandSlots(state) || covered.has(sourceKey(source))) continue;
      const listing = make(source, price);
      state.standListings.push(listing);
      covered.add(sourceKey(source));
      ensureWithdrawal(listing);
    }
  }
  function find(
    requestedId: string | null,
    bankPack: string | null,
    slot: number,
    item: Item,
  ): number {
    if (requestedId) return state.standListings.findIndex((entry) => entry.id === requestedId);
    return state.standListings.findIndex(
      (entry) =>
        (bankPack
          ? entry.bankPack === bankPack && entry.bankSlot === slot
          : entry.state !== "live" && !entry.tradeSlot && entry.slot === slot && !entry.bankPack) &&
        JSON.stringify(entry.item) === JSON.stringify(item),
    );
  }
  function remove(index: number, pack: string | null, slot: number, item: Item): void {
    if (index >= 0) state.standListings.splice(index, 1);
    if (pack && state.merchantCharacter)
      state.withdrawals[String(state.merchantCharacter)] = (
        state.withdrawals[String(state.merchantCharacter)] || []
      ).filter(
        (entry) =>
          !(
            entry.pack === pack &&
            entry.slot === slot &&
            JSON.stringify(entry.item) === JSON.stringify(item)
          ),
      );
  }
  function single(
    index: number,
    id: string | null,
    pack: string | null,
    slot: number,
    item: Item,
    price: number,
    quantity: number,
  ): boolean {
    if ((index < 0 || state.standListings[index].state === "paused") && standSlotsUsed(state) >= merchantStandSlots(state)) return false;
    const listing = make({ slot, item, bankPack: pack || undefined }, price, id || undefined);
    listing.quantity = quantity;
    if (index >= 0) state.standListings[index] = listing;
    else state.standListings.push(listing);
    ensureWithdrawal(listing);
    return true;
  }
  return { find, remove, markAll, single };
}

// ---------------------------------------------------------------------------------------------
// A stand's listings reconciled to the reported count.

export interface ReconciledListing {
  id: string;
  item?: Item | null;
  state: string;
  slot?: number;
  tradeSlot?: unknown;
  bankPack?: string;
  bankSlot?: number;
}
export interface StandReconciliationState {
  merchantCharacter: string | null;
  standListings: ReconciledListing[];
  withdrawals: Record<
    string,
    { pack?: string; slot?: number; item?: Item | null; standListingId?: string }[] | undefined
  >;
}
interface ReconciliationPorts {
  sameItem(first: Item, second: Item | null | undefined): boolean;
  log(message: string, level: string, details: unknown): void;
}

/** Reconciles physical stand/bag ownership before scheduling missing bank withdrawals. */
export function createStandReconciliation(
  state: StandReconciliationState,
  ports: ReconciliationPorts,
) {
  function reconcile(live: Map<string, unknown>, inventory: (InventoryEntry | null)[]): void {
    const claimed = new Set<number>(),
      missing: ReconciledListing[] = [];
    state.standListings = state.standListings.filter((listing) => {
      if (listing.state === "paused") return true;
      if (live.has(listing.id)) {
        listing.state = "live";
        listing.tradeSlot = live.get(listing.id);
        return true;
      }
      const index = inventory.findIndex(
        (entry, position) =>
          !claimed.has(position) && !!entry?.item && ports.sameItem(entry.item, listing.item),
      );
      if (index >= 0) {
        claimed.add(index);
        listing.state = "waiting";
        listing.slot = inventory[index]!.slot;
        delete listing.tradeSlot;
        return true;
      }
      if (listing.bankPack) {
        listing.state = "waiting";
        delete listing.tradeSlot;
        return true;
      }
      missing.push(listing);
      return false;
    });
    if (missing.length)
      ports.log(
        "Removed " +
          missing.length +
          " stand listing" +
          (missing.length === 1 ? "" : "s") +
          " with no matching live or inventory item",
        "info",
        { items: missing.map((listing) => listing.item && listing.item.name) },
      );
  }
  function withdrawals(): boolean {
    const pending = (state.withdrawals[String(state.merchantCharacter)] ||= []);
    let added = false;
    for (const listing of state.standListings) {
      if (
        listing.state !== "waiting" ||
        !listing.bankPack ||
        pending.some((entry) => entry.standListingId === listing.id)
      )
        continue;
      pending.push({
        pack: listing.bankPack,
        slot: listing.bankSlot,
        item: listing.item,
        standListingId: listing.id,
      });
      added = true;
    }
    return added;
  }
  return { reconcile, withdrawals };
}

export function activeStandSales<T extends { state?: string }>(listings: T[]): T[] {
  return listings.some(listing => listing.state === "paused") ? listings.filter(listing => listing.state !== "paused") : listings;
}

// ---------------------------------------------------------------------------------------------
// Automatic stand and bank sales.

interface AutomaticStandMark extends StandMark {
  auto?: boolean;
  autoRuleKey?: string;
}
interface SaleEntry {
  slot: number;
  item: Item;
}
interface SalesState extends PlayerSaleState, CraftReservationState, LuckySlots {
  itemCollectionThreshold: number;
  bankSnapshot?: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
  withdrawals?: Record<string, { pack?: string; slot?: number; item?: Item | null; standListingId?: string; autoNpcRuleKey?: string }[] | undefined>;
  standBids?: Record<string, { useStandSlot?: boolean } | undefined>;
  deconstructionMarks?: DeconstructionMark[];
  merchantAutomations?: Record<string, boolean | undefined>;
  merchantCharacter: string | null;
  statuses?: Record<string, unknown>;
  autoStandMarks: Record<string, { price: unknown } | undefined>;
  npcSaleMarks: NpcSale[];
  standListings: AutomaticStandMark[];
  merchantCurrent?: NonNullable<CraftReservationState["merchantCurrent"]> & { reason?: string } | null;
  merchantQueue: (NonNullable<CraftReservationState["merchantQueue"]>[number] & { reason?: string; target?: string | null })[];
  bankbois?: Record<string, { name: string; items?: (InventoryEntry | null)[] } | undefined>;
}
interface SalesPorts {
  now(): number;
  nextCommand(): number;
  queue(names: (string | null)[], reason: JobReason): void;
  publish(): void;
  syncStand(): boolean;
  idle(): void;
  persist(): void;
}

/** Materialize automatic sale intent, then recover runnable work from durable marks. */
export function createAutomaticMerchantSales(state: SalesState, ports: SalesPorts) {
  // The merchant jobs owner's job kind: a running job whose command is the NPC sale.
  const npcSaleRunning = () => !!state.merchantCurrent && merchantKind(String(state.merchantCurrent.reason)).command === "merchant-npc-sale";
  /** #116: a rule with `keep` sells only its spare stock. One allowance serves a whole marking pass. */
  function saleAllowance(): (key: string, quantity: number) => number {
    const kept = Object.keys(state.autoNpcSales).flatMap(key => { const rule = keptNpcSaleRule(state, key); return rule ? [[key, rule.keep] as const] : []; });
    if (!kept.length) return (_key, quantity) => quantity;
    const stock = protectedMerchantStorageStock(state);
    const spare = new Map(kept.map(([key, keep]) => [key, npcSaleSpare(state, key, keep, stock)] as const));
    return (key, quantity) => {
      const available = spare.get(key);
      if (available === undefined) return quantity;
      const allowed = Math.max(0, Math.min(quantity, available));
      spare.set(key, available - allowed);
      return allowed;
    };
  }
  function npcSalePending(entry: SaleEntry): boolean {
    return state.npcSaleMarks.some(
      (mark) =>
        mark.source === "merchant" &&
        mark.slot === entry.slot &&
        markMatches(entry.item, mark.item),
    );
  }
  function markNpcSale(entry: SaleEntry, key: string, quantity = Math.max(1, Number(entry.item.q) || 1)): boolean {
    if (npcSalePending(entry)) return false;
    state.npcSaleMarks.push({
      id: "auto-npc-sale-" + ports.now() + "-" + ports.nextCommand(),
      source: "merchant",
      slot: entry.slot,
      item: entry.item,
      quantity,
      state: "queued",
      auto: true,
      autoRuleKey: key,
      queuedAt: ports.now(),
    });
    return true;
  }

  function standReserved(item: Item): boolean {
    if (state.standListings.some(listing => listing.state === "paused" && markMatches(item, listing.item))) return true;
    return standSlotsUsed(state) >= merchantStandSlots(state);
  }
  function markStandSale(entry: SaleEntry, key: string, pack?: string): boolean {
    const rule = state.autoStandMarks[key];
    if (!rule || !Number.isSafeInteger(Number(rule.price)) || Number(rule.price) < 1) return false;
    const existing = state.standListings.find(
      (listing) =>
        listing.state !== "live" &&
        !listing.tradeSlot &&
        (pack ? listing.bankPack === pack && listing.bankSlot === entry.slot
          : !!listing.bankPack || listing.slot === entry.slot) &&
        markMatches(entry.item, listing.item),
    );
    if (existing || standReserved(entry.item)) return false;
    state.standListings.push({
      id: "auto-stand-" + ports.now() + "-" + ports.nextCommand(),
      slot: entry.slot,
      item: entry.item,
      price: Number(rule.price),
      quantity: Math.max(1, Number(entry.item.q) || 1),
      state: "configured",
      queuedAt: ports.now(),
      auto: true,
      autoRuleKey: key,
      ...(pack ? { bankPack: pack, bankSlot: entry.slot } : {}),
    });
    return true;
  }

  type BankEntry = InventoryEntry & SaleEntry & {craftLocation:string};
  function bankEntry(entry: (InventoryEntry & {craftLocation:string}) | null): entry is BankEntry {
    return !!entry?.item && !entry.item.l && Number.isSafeInteger(entry.slot);
  }
  function bankNpcEligible(entry: BankEntry, key: string): boolean {
    return !!state.autoNpcSales[key] && !state.autoStandMarks[key] && !saleConflict(entry.item) &&
      routineEnabled({ reason: 'auto npc sales' }, played(state, 'merchantAutomations') ?? {});
  }
  function markBankNpc(entry: BankEntry, allow: ReturnType<typeof saleAllowance>): boolean {
    const key = commerceRuleKey(entry.item);
    if (!bankNpcEligible(entry, key)) return false;
    const pending = ((state.withdrawals ||= {})[state.merchantCharacter!] ||= []);
    if (pending.some(mark => mark.pack === entry.craftLocation && mark.slot === entry.slot && markMatches(mark.item, entry.item))) return false;
    // Withdrawals move whole stacks; the carried sale then sells only the spare part of one.
    if (!allow(key, Math.max(1, Number(entry.item.q) || 1))) return false;
    pending.push({pack: entry.craftLocation, slot: entry.slot, item: entry.item, autoNpcRuleKey:key});
    return true;
  }
  function bankNpcStacks():number {
    return (state.withdrawals?.[String(state.merchantCharacter)] || []).filter(mark=>mark.autoNpcRuleKey).length;
  }
  // markBankStock marks bank NPC sale stock while the merchant's bag has a free cell
  // past the lucky hold and the protected free slots for each marked stack.
  function bankNpcLimit(items: readonly unknown[]): number {
    const merchant = String(state.merchantCharacter);
    return freeSlots(items, luckySlotOf(state, merchant), protectedSlotsOf(state, merchant));
  }
  function bankStandPending():boolean {
    return !!state.withdrawals?.[String(state.merchantCharacter)]?.some(mark=>mark.standListingId);
  }
  function markBankStock(items: readonly unknown[]): boolean {
    if (!bankStockReady()) return false;
    let changed = false, npcStacks = bankNpcStacks();
    const allow = saleAllowance(), limit = bankNpcLimit(items);
    for (const entry of availableBankStock()) {
      if (!bankEntry(entry)) continue;
      if (npcStacks < limit && markBankNpc(entry, allow)) {
        npcStacks++; changed = true;
        continue;
      }
      if (!bankStandEntry(entry)) continue;
      const key = commerceRuleKey(entry.item);
      if (!markStandSale(entry, key, entry.craftLocation)) continue;
      const listing = state.standListings[state.standListings.length - 1];
      const pending = ((state.withdrawals ||= {})[state.merchantCharacter!] ||= []);
      pending.push({ pack: listing.bankPack, slot: listing.bankSlot, item: listing.item, standListingId: listing.id });
      changed = true;
    }
    return changed;
  }
  // A bank report from the merchant's own visit marks its sale stock at once,
  // so a running job holds back only the stand marks (bankStandEntry).
  function bankStockReady(): boolean {
    return !!state.merchantCharacter;
  }
  // The BankBoi bags count as bank stock for NPC sales (the BankBoi storage read).
  function availableBankStock() {
    const pending = state.withdrawals?.[String(state.merchantCharacter)] || [];
    const packs = [...Object.entries(state.bankSnapshot?.packs || {}),
      ...Object.values(state.bankbois || {}).flatMap(worker => worker ? [[bankboiPack(worker.name), worker.items] as const] : [])];
    const stock = packs.flatMap(([pack, entries]) =>
      (entries || []).map(entry => entry && !pending.some(mark => mark.pack === pack && mark.slot === entry.slot && markMatches(mark.item,entry.item)) ? { ...entry, craftLocation: pack } : null));
    // Withdrawals move whole stacks; leave partially reserved stacks untouched.
    return availableCraftStock(stock, craftProtection(state)).map((entry, index) =>
      entry?.item?.q === stock[index]?.item?.q ? entry : null);
  }
  function bankStandEntry(entry: (InventoryEntry & { craftLocation: string }) | null): entry is InventoryEntry & SaleEntry & { craftLocation: string } {
    if (!entry?.item || entry.item.l || !Number.isSafeInteger(entry.slot) || state.merchantCurrent || isBankboiPack(entry.craftLocation)) return false;
    return !state.autoNpcSales[commerceRuleKey(entry.item)] && !saleConflict(entry.item);
  }

  function deconstructionReserved(item: Item) {
    return state.deconstructionMarks?.some(mark => mark.owner === state.merchantCharacter &&
      mark.state !== "complete" && markMatches(item, mark.item));
  }
  function resumeDisplacedSales(items: readonly (SaleEntry | null)[]): boolean {
    let available = merchantStandSlots(state) - standSlotsUsed(state);
    const claimed = new Set(state.standListings.filter(listing => listing.state !== "paused" && listing.state !== "live" && !listing.bankPack).map(listing => listing.slot));
    let changed = false;
    for (const listing of state.standListings.filter(entry => entry.state === "paused")) {
      if (available <= 0) break;
      const entry = items.find(candidate => resumableSale(candidate, listing, claimed));
      if (!entry) continue;
      listing.state = "configured";
      listing.slot = entry.slot;
      delete listing.tradeSlot;
      delete listing.bankPack;
      delete listing.bankSlot;
      claimed.add(entry.slot);
      available--;
      changed = true;
    }
    return changed;
  }
  function resumableSale(entry: SaleEntry | null, listing: AutomaticStandMark, claimed: Set<number | undefined>): entry is SaleEntry {
    return !!entry?.item && !entry.item.l && !claimed.has(entry.slot) &&
      markMatches(entry.item, listing.item) && !saleConflict(entry.item);
  }
  function markAutomaticNpc(entry: SaleEntry, key: string, allow: ReturnType<typeof saleAllowance>) {
    if (!routineEnabled({ reason: 'auto npc sales' }, played(state, 'merchantAutomations') ?? {}) || npcSalePending(entry)) return false;
    const quantity = allow(key, Math.max(1, Number(entry.item.q) || 1));
    return quantity > 0 && markNpcSale(entry, key, quantity);
  }
  function saleConflict(item: Item) { return deconstructionReserved(item) || itemRuleConflicts(state,item).length > 0; }
  function markInventory(items: readonly (SaleEntry | null)[]) {
    // Resume displaced sales before admitting new automatic listings.
    let changed = resumeDisplacedSales(items),
      standChanged = changed;
    const allow = saleAllowance();
    for (const entry of items) {
      if (!entry?.item || !Number.isSafeInteger(entry.slot) || entry.item.l) continue;
      if (saleConflict(entry.item)) continue;
      const key = commerceRuleKey(entry.item);
      if (state.autoNpcSales[key]) {
        if (markAutomaticNpc(entry, key, allow)) changed = true;
      } else if (markStandSale(entry, key)) standChanged = changed = true;
    }
    return { changed, standChanged };
  }

  function queueSales(marks: NpcSale[], running: boolean) {
    for (const auto of [false, true]) {
      const reason = auto ? 'auto npc sales' : 'npc sales';
      if (auto && !routineEnabled({ reason }, played(state, 'merchantAutomations') ?? {})) continue;
      const queued = state.merchantQueue.some(job => job.reason === reason && job.target === state.merchantCharacter);
      const runnable = readyNpcSales(marks, ports.now()).some(mark => Boolean(mark.auto) === auto);
      if (runnable && !running && !queued) ports.queue([state.merchantCharacter], reason);
    }
  }
  function reconcileSales(items: readonly (SaleEntry | null)[]): boolean {
    const running = npcSaleRunning();
    const sales = reconcileNpcSales(state.npcSaleMarks, items, running, ports.now());
    for (const mark of sales.marks) if (mark.auto && itemRuleConflicts(state,mark.item).length) {
      mark.state = "blocked"; mark.error = "Conflicting automatic rules; choose an action in merchant settings"; sales.changed = true;
    }
    if (sales.changed) state.npcSaleMarks = sales.marks;
    queueSales(sales.marks, running);
    return sales.changed;
  }

  // #116: carried kept copies hold bank marks; a bank trip deposits them. After a trip for them,
  // the next one waits until the bank snapshot changes: a full bank changes no snapshot.
  let keptBank: unknown = undefined;
  function keptCopiesCarried(items: readonly (SaleEntry | null)[]): boolean {
    if (state.merchantCurrent || state.merchantQueue.some(job => job.target === state.merchantCharacter) ||
        (keptBank !== undefined && state.bankSnapshot === keptBank)) return false;
    const kept = keptNpcSaleCopies(state);
    if (!items.some(entry => entry?.item && Number.isSafeInteger(entry.slot) && kept(entry))) return false;
    keptBank = state.bankSnapshot;
    return true;
  }
  // The bank's NPC sale stock gets its own job at once, whether or not ordinary
  // withdrawals are on; bankCollectionReason names the job.
  function queueBankTrip(items: readonly (SaleEntry | null)[]): void {
    const collection = bankCollectionReason(state);
    if (collection) ports.queue([state.merchantCharacter], collection);
    else if (keptCopiesCarried(items)) ports.queue([state.merchantCharacter], "manual bank exchange");
  }
  function reconcileMerchant(items: readonly (SaleEntry | null)[]): boolean {
    // Shared party rules can deliver a whole stack with an existing sale mark.
    // Clamp that intent too; new-mark allowances alone cannot protect the reserve.
    let resized = false;
    if (Object.keys(state.autoNpcSales).some(key => keptNpcSaleRule(state, key)) &&
        !npcSaleRunning()) {
      const stock = protectedMerchantStorageStock(state), remaining = new Map<string, number>();
      state.npcSaleMarks = state.npcSaleMarks.filter(mark => {
        if (!mark.auto || mark.source !== 'merchant') return true;
        const key = commerceRuleKey(mark.item), rule = keptNpcSaleRule(state, key);
        if (!rule) return true;
        if (!remaining.has(key)) {
          const held = stock.filter(entry => entry.item && commerceRuleKey(entry.item) === key)
            .reduce((sum, entry) => sum + (Number(entry.item?.q) || 1), 0);
          const manual = state.npcSaleMarks.filter(other => !other.auto && other.source === 'merchant' &&
            commerceRuleKey(other.item) === key).reduce((sum, other) => sum + other.quantity, 0);
          remaining.set(key, Math.max(0, held - rule.keep - manual));
        }
        const quantity = Math.min(mark.quantity, remaining.get(key)!);
        remaining.set(key, remaining.get(key)! - quantity);
        resized ||= quantity !== mark.quantity;
        mark.quantity = quantity;
        return quantity > 0;
      });
    }
    // Banked sales also reserve capacity against opportunistic buys.
    const marks = markInventory(items), bankChanged = markBankStock(items);
    const changed = reconcileSales(items) || marks.changed || bankChanged || resized;
    queueBankTrip(items);
    if (bankChanged && bankStandPending())
      ports.queue([state.merchantCharacter], "manual bank exchange");
    if (marks.standChanged || bankChanged) {
      ports.publish();
      if (!ports.syncStand()) ports.idle();
    }
    if (changed) ports.persist();
    return changed;
  }

  function reconcile(
    status: { name?: string; seenAt?: number; items?: (SaleEntry | null)[] } | null | undefined,
  ): boolean {
    if (!status?.name || !Array.isArray(status.items))
      return false;
    if (status.name !== state.merchantCharacter) {
      const changed = reconcilePlayerSales(state, { name: status.name, seenAt: status.seenAt, items: status.items }, ports);
      if (changed) ports.persist();
      return changed;
    }
    // Sales displaced by explicit buy orders wait for capacity, not forever.
    // Automatic buys are opportunistic and do not reserve capacity against sales.
    return reconcileMerchant(status.items);
  }
  return { reconcile };
}

// ---------------------------------------------------------------------------------------------
// Bank copies marked for deconstruction.

export interface BankDeconstructionState {
  merchantCharacter: string | null;
  deconstructionMarks: DeconstructionMark[];
  deconstructionCatalog: DeconstructionCatalog;
  bankSnapshot?: { packs?: Record<string, (InventoryEntry | null)[] | undefined>; seenAt?: number } | null;
  bankbois?: Record<string, { items?: (InventoryEntry | null)[] } | undefined>;
  withdrawals?: Record<string, WithdrawalRequest[] | undefined>;
}
interface BankDeconstructionPorts {
  now(): number; next(): number; persist(): void;
  queue(names: string[], reason: JobReason): void;
  bankService?(): unknown;
  persistBank?(): void;
}
function sources(state: BankDeconstructionState) {
  return [...Object.entries(state.bankSnapshot?.packs || {}),
    ...Object.entries(state.bankbois || {}).map(([name, worker]) => [bankboiPack(name), worker?.items] as const)];
}
export function markBankDeconstruction(state: BankDeconstructionState, ports: BankDeconstructionPorts, body: Record<string, unknown>): ItemsAnswer {
  const item = requestObject(body.item) as Item, slot = Number(body.slot), pack = String(body.pack);
  const packs = sources(state);
  const selected = packs.find(([name]) => name === pack)?.[1]?.find((entry, index) => (entry?.slot ?? index) === slot)?.item;
  if (!state.merchantCharacter || !selected || markKey(selected) !== markKey(item))
    return { status: 409, body: { error: "Bank item changed; refresh and try again" } };
  if (!deconstructable(selected, state.deconstructionCatalog))
    return { status: 400, body: { error: "Item cannot be deconstructed" } };
  const targets = matchingTargets(state, item, pack, slot, body.all === true);
  const added = enqueue(state, ports, targets);
  ports.persistBank?.();
  ports.persist();
  if (added) schedule(state, ports);
  return { body: { ok: true, added } };
}
function matchingTargets(state: BankDeconstructionState, item: Item, pack: string, slot: number, all: boolean) {
  return sources(state).flatMap(([source, entries]) => (entries || []).flatMap((entry, index) => {
    const position = entry?.slot ?? index;
    if (!entry?.item || markKey(entry.item) !== markKey(item) || !deconstructable(entry.item, state.deconstructionCatalog)) return [];
    return all || source === pack && position === slot ? [{ pack: source, slot: position, item: entry.item }] : [];
  }));
}
export function enqueueAutomaticBankDeconstruction(state: BankDeconstructionState, ports: BankDeconstructionPorts, matchesRule: (item: Item) => boolean): void {
  const targets = sources(state).flatMap(([pack, entries]) => (entries || []).flatMap((entry, index) => {
    if (!entry?.item || !matchesRule(entry.item) || !deconstructable(entry.item, state.deconstructionCatalog)) return [];
    const slot = entry.slot ?? index;
    // enqueueAutomaticBankDeconstruction reads a cell a mark changed again once the bank
    // snapshot changed after it.
    if (state.deconstructionMarks.some(mark => mark.storage?.pack === pack && mark.storage.slot === slot &&
      Number(state.bankSnapshot?.seenAt || 0) <= mark.updatedAt)) return [];
    return [{ pack, slot, item: entry.item }];
  }));
  if (enqueue(state, ports, targets, true)) { ports.persistBank?.(); schedule(state, ports); }
}
function enqueue(state: BankDeconstructionState, ports: BankDeconstructionPorts, targets: { pack: string; slot: number; item: Item }[], auto = false) {
  const pending = (state.withdrawals ||= {});
  const merchant = state.merchantCharacter!;
  const withdrawals = (pending[merchant] ||= []);
  let added = 0;
  for (const target of targets) {
    if (state.deconstructionMarks.some(mark => mark.state !== "complete" && mark.storage?.pack === target.pack && mark.storage.slot === target.slot)) continue;
    if (Object.values(pending).some(requests => requests?.some(request => request.pack === target.pack && request.slot === target.slot))) continue;
    const id = "deconstruct-" + ports.next();
    state.deconstructionMarks.push({ id, origin: merchant, owner: merchant,
      slot: -1, storage: { pack: target.pack, slot: target.slot }, item: { ...target.item },
      quantity: Number(target.item.q) || 1, state: "withdrawing", auto, updatedAt: ports.now() });
    withdrawals.push({ ...target, deconstructionId: id }); added++;
  }
  return added;
}
function schedule(state: BankDeconstructionState, ports: BankDeconstructionPorts) {
    const withdrawals = state.withdrawals![state.merchantCharacter!]!;
    if (withdrawals.some(request => isBankboiPack(request.pack))) ports.bankService?.();
    if (withdrawals.some(request => !isBankboiPack(request.pack))) ports.queue([state.merchantCharacter!], "manual bank exchange");
}
export function receiveBankDeconstruction(state: { deconstructionMarks?: DeconstructionMark[]; merchantCharacter: string | null; withdrawals?: Record<string, unknown[] | undefined> }, name: string | null, receipts: unknown, now: number) {
  if (name !== state.merchantCharacter || !Array.isArray(receipts)) return;
  for (const receipt of receipts) {
    const mark = state.deconstructionMarks?.find(mark => mark.id === receipt?.deconstructionId && mark.state === "withdrawing");
    if (!mark) continue;
    if (receipt.deconstructionMissing) {
      mark.state = "blocked"; mark.error = "Bank item is missing; refresh storage and mark it again";
      if (state.withdrawals) state.withdrawals[String(name)] = (state.withdrawals[String(name)] || []).filter(request => requestObject(request).deconstructionId !== mark.id);
      continue;
    }
    mark.storageReceived = true;
    mark.state = "ready"; mark.slot = -1; mark.updatedAt = now;
  }
}

// ---------------------------------------------------------------------------------------------
// Deconstruction marks and their job.

// The dashboard reads the mark with its own view of the game item, so the item type is a parameter.
export interface DeconstructionMark<MarkItem = Item> {
  id: string;
  origin: string;
  owner: string;
  slot: number;
  item: MarkItem;
  quantity: number;
  state: "collecting" | "withdrawing" | "ready" | "running" | "blocked" | "complete";
  storage?: { pack: string; slot: number };
  storageReceived?: boolean;
  auto?: boolean;
  error?: string;
  attempt?: string;
  jobId?: string;
  updatedAt: number;
}
export type DeconstructionRules = Record<string, Record<string, { item: Item }>>;
export type DeconstructionState = ConflictState & BankDeconstructionState & AutomaticActionState & {
  deconstructionMarks: DeconstructionMark[];
  autoDeconstruction: DeconstructionRules;
  deconstructionCatalog: DeconstructionCatalog;
  merchantCharacter: string | null;
  merchantMarked: Record<string, ItemMark[] | undefined>;
  statuses: Record<string, { seenAt: number; items?: (InventoryEntry | null)[] } | undefined>;
  merchantCurrent: { id: string; reason: string } | null;
}
interface DeconstructionPorts {
  write(batch: SettingsWrite): SettingsWriteResult;
  now(): number;
  next(): number;
  persist(): void;
  owned(name: string): unknown;
  queue(names: string[], reason: JobReason): void;
  reserved(name: string, slot: number, item: Item): boolean;
  log(message: string, level: string): void;
  bankService?(): unknown;
  persistBank?(): void;
}
export function buildDeconstructionCatalog(data: {
  dismantle?: Record<string, { cost: number; items?: [number, string][] }>;
  items?: Record<string, { compound?: unknown; type?: string }>;
}): DeconstructionCatalog {
  const catalog: DeconstructionCatalog = {};
  for (const [name, recipe] of Object.entries(data.dismantle || {}))
    catalog[name] = { compound: false, cost: recipe.cost, rewards: recipe.items?.map(([amount, name]) => ({
      name, quantity: Math.max(1, amount), chance: Math.min(1, amount),
    })) };
  for (const [name, definition] of Object.entries(data.items || {}))
    if (definition.compound && definition.type !== "booster" && !catalog[name])
      catalog[name] = { compound: true };
  return catalog;
}
export function receiveDeconstruction(
  state: Pick<DeconstructionState, "deconstructionMarks" | "merchantCharacter"> & { merchantMarked?: DeconstructionState["merchantMarked"] },
  owner: string,
  kept: unknown,
  now: number,
): void {
  if (!Array.isArray(kept) || !state.merchantCharacter) return;
  for (const raw of kept) {
    const entry = requestObject(raw);
    const mark = state.deconstructionMarks?.find(
      (m) => m.id === entry.deconstructionId && m.owner === owner && m.state === "collecting",
    );
    if (!mark) continue;
    const quantity = Number(entry.quantity);
    if (Number.isSafeInteger(quantity) && quantity > 0) mark.quantity = Math.min(mark.quantity, quantity);
    if (state.merchantMarked) state.merchantMarked[owner] = (state.merchantMarked[owner] || [])
      .filter(reservation => reservation.deconstructionId !== mark.id);
    mark.owner = state.merchantCharacter;
    mark.slot = -1;
    mark.state = "ready";
    mark.updatedAt = now;
  }
}
export function createDeconstruction(state: DeconstructionState, ports: DeconstructionPorts) {
  // A lost acknowledgement must never replay a destructive operation.
  for (const mark of state.deconstructionMarks)
    if (mark.state === "running") {
      mark.state = "blocked";
      mark.error = "Interrupted action: verify inventory before retrying";
    }
  function pending(mark: DeconstructionMark) {
    return mark.state !== "complete";
  }
  function release(mark: DeconstructionMark) {
    if (state.withdrawals) for (const name of Object.keys(state.withdrawals))
      state.withdrawals[name] = state.withdrawals[name]?.filter(request => request.deconstructionId !== mark.id);
    if (mark.storage) ports.persistBank?.();
    state.merchantMarked[mark.origin] = (state.merchantMarked[mark.origin] || []).filter(
      (entry) => entry.deconstructionId !== mark.id,
    );
  }
  function add(name: string, slot: number, item: Item, auto: boolean) {
    const existing = state.deconstructionMarks.find(
      (m) => m.owner === name && m.slot === slot && pending(m) && markMatches(item, m.item),
    );
    if (existing) return existing;
    const mark: DeconstructionMark = {
      id: "deconstruct-" + ports.next(),
      origin: name,
      owner: name,
      slot,
      item: { ...item },
      quantity: Math.max(1, Number(item.q) || 1),
      auto,
      updatedAt: ports.now(),
      state: name === state.merchantCharacter ? "ready" : "collecting",
    };
    state.deconstructionMarks.push(mark);
    return mark;
  }
  function reserve(mark: DeconstructionMark) {
    if (mark.state !== "collecting") return;
    const marks = (state.merchantMarked[mark.owner] ||= []);
    const existing = marks.find((m) => m.deconstructionId === mark.id);
    if (existing) existing.slot = mark.slot;
    else
      marks.push({
        slot: mark.slot,
        item: mark.item,
        quantity: mark.quantity,
        deconstructionId: mark.id,
      });
  }
  function automaticRule(name: string, item: Item) {
    return !itemRuleConflicts(state,item).length && !!state.autoDeconstruction[ruleOwner(state,name)]?.[commerceRuleKey(item)];
  }
  function automaticBank(name: string): void {
    if (name === state.merchantCharacter) enqueueAutomaticBankDeconstruction(state, ports, item => automaticRule(name, item));
  }
  // reportedSince keeps a changed mark until its owner reports after the change.
  function reportedSince(name: string, at: number): boolean {
    return Number(state.statuses[name]?.seenAt || 0) > at;
  }
  function automatic(name: string, items: (InventoryEntry | null)[]) {
    if (!sharedMember(state,name)) return;
    automaticBank(name);
    for (const entry of items) {
      if (!entry?.item || !Number.isInteger(entry.slot)) continue;
      if (!automaticRule(name,entry.item)) continue;
      if (
        !deconstructable(entry.item, state.deconstructionCatalog) ||
        ports.reserved(name, entry.slot!, entry.item)
      )
        continue;
      const recent = state.deconstructionMarks.some(
        (m) =>
          (m.owner === name || m.origin === name) &&
          markMatches(entry.item, m.item) &&
          !reportedSince(name, m.updatedAt),
      );
      if (!recent) add(name, entry.slot!, entry.item, true);
    }
  }
  function held(mark: DeconstructionMark) {
    if (mark.state === "running" && state.merchantCurrent?.id !== mark.jobId) {
      mark.state = "blocked";
      mark.error = "Job interrupted: verify inventory before retrying";
    }
    return mark.state === "running" || mark.state === "blocked" || mark.state === "withdrawing";
  }
  function waitingForInventory(mark: DeconstructionMark, items: (InventoryEntry | null)[], used: Set<number>) {
    return !reportedSince(mark.owner, mark.updatedAt) || items.some(e => e?.item && used.has(e.slot!) && markMatches(e.item, mark.item));
  }
  function conflictingAutomatic(mark: DeconstructionMark) { return mark.auto && itemRuleConflicts(state,mark.item).length > 0; }
  function reconcileMark(
    mark: DeconstructionMark,
    items: (InventoryEntry | null)[],
    used: Set<number>,
  ) {
    recoverMissingAutomatic(mark, items, used);
    if (held(mark)) return;
    if (conflictingAutomatic(mark)) {
      mark.state="blocked"; mark.error="Conflicting automatic rules"; release(mark); return;
    }
    const matches = (entry: InventoryEntry | null) =>
      !!entry?.item && !used.has(entry.slot!) && markMatches(entry.item, mark.item);
    const entry = items.find((e) => e?.slot === mark.slot && matches(e)) || items.find(matches);
    // Several withdrawn stacks may merge into one bag slot. Keep later marks
    // pending while the earlier mark consumes its own quantity from that stack.
    if (!entry && waitingForInventory(mark, items, used)) return;
    if (!entry) {
      mark.state = "blocked";
      mark.error = "Marked item is missing; refresh inventory before retrying";
      release(mark);
      return;
    }
    used.add(entry.slot!);
    mark.slot = entry.slot!;
    if (
      !deconstructable(entry.item!, state.deconstructionCatalog) ||
      ports.reserved(mark.owner, entry.slot!, entry.item!)
    ) {
      mark.state = "blocked";
      mark.error = "Item is protected or cannot be deconstructed";
      release(mark);
      return;
    }
    reserve(mark);
    // The game dismantles only with two free bag cells, so a full bag holds the mark until
    // a report shows the room.
    if (mark.state !== "collecting" && freeSlots(items, null, 0) < DISMANTLE_FREE_SLOTS) return;
    ports.queue(
      [mark.owner],
      mark.state === "collecting" ? "marked items" : "deconstruction",
    );
  }
  function recoverMissingAutomatic(mark: DeconstructionMark, items: (InventoryEntry | null)[], used: Set<number>) {
    if (!mark.auto || mark.state !== 'blocked' || mark.storage || mark.attempt ||
        mark.error !== 'Marked item is missing; refresh inventory before retrying') return;
    if (!automaticRule(mark.owner, mark.item)) return;
    const entry = items.find(e => e?.item && !used.has(e.slot!) && markMatches(e.item, mark.item));
    if (!entry) return;
    mark.state = mark.owner === state.merchantCharacter ? 'ready' : 'collecting';
    delete mark.error;
  }
  function reconcile(name: string) {
    const status = state.statuses[name];
    if (!status || !fresh(status.seenAt, ports.now(), 'presence')) return false;
    const before = JSON.stringify([state.deconstructionMarks, state.merchantMarked[name]]);
    const items = status.items || [];
    state.deconstructionMarks = state.deconstructionMarks.filter(
      (mark) => mark.state !== "complete" || !reportedSince(mark.owner, mark.updatedAt),
    );
    automatic(name, items);
    const used = new Set<number>();
    for (const mark of state.deconstructionMarks.filter((m) => m.owner === name && pending(m)))
      reconcileMark(mark, items, used);
    const changed =
      before !== JSON.stringify([state.deconstructionMarks, state.merchantMarked[name]]);
    if (changed) ports.persist();
    return changed;
  }
  function markAnswer(body: Record<string, unknown>): ItemsAnswer {
    const name = requestText(body.character || "");
    if (body.pack) return markBankDeconstruction(state, ports, body);
    if (!ports.owned(name) || !state.merchantCharacter)
      return { status: 400, body: { error: "Select an owned character and merchant" } };
    const existing = state.deconstructionMarks.find(
      (m) => m.id === body.id && (m.owner === name || m.origin === name),
    );
    if (existing && (body.remove || body.retry)) return updateMark(existing, body);
    return createMark(name, body);
  }
  function updateMark(existing: DeconstructionMark, body: Record<string, unknown>): ItemsAnswer {
    if (body.retry && existing.storage && !existing.storageReceived)
      return { status: 409, body: { error: "Remove this mark and mark the current bank item again" } };
    if (existing.state === "running")
      return { status: 409, body: { error: "Deconstruction is already in progress" } };
    if (body.remove) {
      release(existing);
      state.deconstructionMarks = state.deconstructionMarks.filter((m) => m !== existing);
    } else {
      existing.state = existing.owner === state.merchantCharacter ? "ready" : "collecting";
      delete existing.error;
    }
    ports.persist();
    reconcile(existing.owner);
    return { body: { ok: true } };
  }
  function liveMatches(live: Item | null | undefined, item: Item): live is Item {
    return !!live && !!item.name && markMatches(live, item);
  }
  function createMark(name: string, body: Record<string, unknown>): ItemsAnswer {
    const status = state.statuses[name],
      slot = Number(body.slot),
      item = requestObject(body.item) as Item;
    const live = status?.items?.find((e) => e?.slot === slot)?.item;
    if (!status || !fresh(status.seenAt, ports.now(), 'presence') || !liveMatches(live, item))
      return { status: 409, body: { error: "Item changed; refresh and try again" } };
    if (!deconstructable(live, state.deconstructionCatalog))
      return { status: 400, body: { error: "Item cannot be deconstructed" } };
    if (ports.reserved(name, slot, live))
      return { status: 409, body: { error: "Remove the item's other work marks first" } };
    add(name, slot, live, false);
    ports.persist();
    reconcile(name);
    return { body: { ok: true } };
  }
  function automaticAnswer(body: Record<string, unknown>): ItemsAnswer {
    const name = requestText(body.character || ""),
      item = requestObject(body.item) as Item;
    if (!ports.owned(name) || !item.name)
      return { status: 400, body: { error: "Unknown character or item" } };
    // The automatic deconstruction rules, and the rules this choice replaces, are settings that
    // change in the request's draft and go out through the settings writer; the marks it releases
    // are the items owner's records, released only once the writer accepts the draft.
    const draft = settingsDraft(state),
      rules = (draft.edit<DeconstructionRules>("autoDeconstruction")[ruleOwner(state, name)] ||= {}),
      key = commerceRuleKey(item);
    if (body.remove) delete rules[key];
    else {
      if (!deconstructable(item, state.deconstructionCatalog))
        return { status: 400, body: { error: "Item cannot be deconstructed" } };
      replaceAutomaticAction(state, name, item, 'deconstruction', draft);
      rules[key] = { item };
    }
    const written = ports.write({ by: "dashboard:deconstruction-auto", changes: draft.changes() });
    if (!written.ok) return { status: 400, body: { error: written.error } };
    if (body.remove) for (const mark of state.deconstructionMarks.filter(
      (m) => m.origin === name && m.auto && m.state !== "running" && commerceRuleKey(m.item) === key)) {
      release(mark);
      state.deconstructionMarks = state.deconstructionMarks.filter((m) => m !== mark);
    }
    ports.persist();
    reconcile(name);
    return { body: { ok: true } };
  }
  function receipt(mark: DeconstructionMark, body: Record<string, unknown>): ItemsAnswer {
    if (body.attempt !== mark.attempt || mark.state !== "running")
      return { status: 409, body: { error: "Stale deconstruction receipt" } };
    if (body.success === true) {
      mark.quantity--;
      mark.state = mark.quantity > 0 ? "ready" : "complete";
      ports.log("Deconstructed " + mark.item.name, "success");
      recordItems({ decision: "dismantled", subject: mark.owner, by: mark.auto ? "S2" : "player", item: mark.item.name, level: mark.item.level });
    } else if (body.code === "deconstruct_space") {
      // A bag that filled after the report holds the mark until a report shows two free cells,
      // as a full bag before the send does.
      mark.state = "ready";
      mark.error = requestText(body.error);
    } else {
      mark.state = "blocked";
      mark.error = requestText(body.error || "Deconstruction failed");
    }
    mark.updatedAt = ports.now();
    ports.persist();
    return { body: { ok: true, mark } };
  }
  function stepAnswer(body: Record<string, unknown>): ItemsAnswer {
    const job = state.merchantCurrent;
    if (!job || job.id !== body.jobId || job.reason !== "deconstruction")
      return { status: 409, body: { error: "Deconstruction job is no longer current" } };
    const mark = state.deconstructionMarks.find(
      (m) => m.id === body.id && m.owner === state.merchantCharacter,
    );
    if (!mark) return { status: 409, body: { error: "Deconstruction mark was removed" } };
    if (body.action === "claim") {
      if (mark.state !== "ready")
        return { status: 409, body: { error: "Deconstruction mark is not ready" } };
      if (ports.reserved(mark.owner, mark.slot, mark.item))
        return { status: 409, body: { error: "Item now has competing work" } };
      mark.state = "running";
      mark.jobId = job.id;
      mark.attempt = String(ports.next());
      mark.updatedAt = ports.now();
    } else {
      return receipt(mark, body);
    }
    ports.persist();
    return { body: { ok: true, mark } };
  }
  return { reconcile, mark: markAnswer, automatic: automaticAnswer, step: stepAnswer };
}

// ---------------------------------------------------------------------------------------------
// The merchant's item commands and its weapon types.

interface Entry extends InventoryEntry {
  slot: number;
  item: Item;
}
interface Status {
  items?: (Entry | null)[];
}
interface MerchantItemState extends PickupState {
  merchantCharacter: string | null;
  merchantWeapon: { item: Item } | null;
  merchantWeaponTypes?: readonly string[];
  statuses: Record<string, Status | undefined>;
  merchantCatalog?: NonNullable<PickupState['merchantCatalog']> & { exchangeable?: { id: string; level?: number; reward?: unknown; required?: number }[] } | null;
  autoExchanges: Record<string, { name: string; level: number }>;
  merchantQueue: MerchantWork[];
  purchases: Record<string, { name: string }[] | undefined>;
}
interface ItemCommandPorts {
  selectAction?(item: Item, name: string, draft: SettingsDraft): void;
  persist(): void;
  enqueue(ask: EnqueueAsk): EnqueueAnswer;
  write(batch: SettingsWrite): SettingsWriteResult;
  scheduleExchange(status: Status | undefined): void;
}
// The merchant's weapons are the weapon types its class wields (G.classes.merchant `mainhand` and
// `doublehand`), less the gathering tools its skills equip (G.skills fishing `wtype` rod, mining
// pickaxe), which the gathering jobs swap in and out.
export function merchantWeaponTypes(data: {
  classes?: Record<string, { mainhand?: Record<string, unknown>; doublehand?: Record<string, unknown> }>;
  skills?: Record<string, { class?: string[]; wtype?: string | string[] }>;
}): string[] {
  const merchant = data.classes?.merchant;
  const tools = new Set(Object.values(data.skills || {}).filter(skill => skill.class?.includes("merchant"))
    .flatMap(skill => skill.wtype === undefined ? [] : ([] as string[]).concat(skill.wtype)));
  return [...Object.keys(merchant?.mainhand || {}), ...Object.keys(merchant?.doublehand || {})].filter(type => !tools.has(type));
}
export function merchantWeaponCompatible(definition: {type?: string; wtype?: string}, types: readonly string[]): boolean {
  return definition.type === 'weapon' && types.includes(definition.wtype || '');
}
type Request = Record<string, unknown>;
function failure(message: string, status = 400): CommandOutcome {
  return { status, body: { error: message } };
}
function exchangeChoice(state: MerchantItemState, item: Item) {
  const level = Number(item.level) || 0;
  return state.merchantCatalog?.exchangeable?.find(line => !line.reward && line.id === item.name && (Number(line.level) || 0) === level);
}
function exchangeCount(choice: ReturnType<typeof exchangeChoice>, item: Item): number {
  return Math.floor(stackQuantity(item) / Math.max(1, Number(choice?.required) || 1));
}
function collectionIntent(state: MerchantItemState, name: string, slot: number): boolean {
  return [...(state.marked?.[name] || []), ...(state.merchantMarked?.[name] || [])].some(raw => requestObject(raw).slot === slot);
}
function validSelection(state: MerchantItemState, body: Request): boolean {
  if (!state.merchantCharacter || !sharedMember(state, String(body.character))) return false;
  if (!Number.isSafeInteger(body.slot)) return false;
  return body.type !== 'merchant-weapon' || body.character === state.merchantCharacter;
}
function prospectiveExchange(state: MerchantItemState, body: Request): boolean {
  return body.type === 'auto-exchange' && body.character === state.merchantCharacter && body.slot === -1;
}
export function createMerchantItemCommands(state: MerchantItemState, ports: ItemCommandPorts) {
  function weapon(body: Request, entry: Entry): CommandOutcome {
    const definition = entryMeta(state.merchantCatalog, entry)?.definition || {};
    if (!merchantWeaponCompatible(definition, state.merchantWeaponTypes || []))
      return failure("select a normal merchant-compatible weapon");
    // The merchant's weapon is a setting, written through the settings writer.
    const written = ports.write({ by: "dashboard:command", changes: [{ field: "merchantWeapon", value: body.remove === true ? null : { item: requestObject(body.item) } }] });
    return written.ok ? null : failure(written.error);
  }
  function exchange(item: Item & { name: string }, status: Status | undefined): CommandOutcome {
    const level = Number(item.level) || 0;
    if (!exchangeChoice(state, item)) return failure("this item cannot be exchanged");
    // The automatic exchanges, and the rules this choice replaces, change in the request's draft,
    // which goes out through the settings writer before the exchange is scheduled.
    const key = exchangeKey(item.name, level), draft = settingsDraft(state), rules = draft.edit<MerchantItemState["autoExchanges"]>("autoExchanges");
    if (rules[key]) delete rules[key];
    else {
      ports.selectAction?.(item, String(state.merchantCharacter), draft);
      rules[key] = { name: item.name, level };
    }
    const written = ports.write({ by: "dashboard:command", changes: draft.changes() });
    if (!written.ok) return failure(written.error);
    ports.scheduleExchange(status);
    return null;
  }
  function once(body: Request, entry: Entry): CommandOutcome {
    const item = entry.item, level = Number(item.level) || 0, name = String(body.character);
    const choice = exchangeChoice(state, item), quantity = exchangeCount(choice, item);
    if (!choice || !quantity) return failure("not enough stock for this exchange");
    const pickup = exchangePickup(state, name, entry);
    if (!pickup) return failure("this item is protected or reserved", 409);
    if (collectionIntent(state, name, entry.slot)) return failure("this item already has a collection intent", 409);
    const id = 'exchange-' + globalThis.crypto.randomUUID(), queuedAt = Date.now();
    const job: MerchantWork & { reason: JobReason } = {id, target: state.merchantCharacter, reason: 'exchange', routine: 'manual exchange', manual: true, queuedAt,
      exchanges: [{id: String(item.name), level, quantity}]};
    if (name !== state.merchantCharacter) queuePickup(name, item, pickup, job);
    ports.enqueue({ reason: job.reason, target: job.target, fields: job });
    ports.persist();
    return null;
  }
  function queuePickup(name: string, item: Item, pickup: ItemMark, job: MerchantWork): void {
    const id = job.id, queuedAt = job.queuedAt;
    const mark = {...pickup, exchangeJobId: id};
    (state.merchantMarked ||= {})[name] ||= [];
    state.merchantMarked[name].push(mark);
    job.exchangePickupItem = item;
    job.exchangePickupQuantity = stackQuantity(item);
    job.exchangePickupId = id + '-pickup';
    ports.enqueue({reason: 'exchange pickup', target: name, fields: {id: job.exchangePickupId, routine: 'manual exchange', manual: true, queuedAt, exchangeDeliveryId: id}});
  }
  function selected(body: Request, item: Item & { name: string }): CommandOutcome {
    if (!validSelection(state, body))
      return undefined;
    const status = state.statuses[String(state.merchantCharacter)],
      entry = state.statuses[String(body.character)]?.items?.find((candidate) => candidate?.slot === body.slot);
    if (prospectiveExchange(state, body)) return exchange(item, status);
    if (!entry || JSON.stringify(entry.item) !== JSON.stringify(item))
      return failure("merchant inventory item changed; refresh and try again", 409);
    if (body.type === "exchange") return once(body, entry);
    return body.type === "merchant-weapon" ? weapon(body, entry) : exchange(item, status);
  }
  function handle(body: Request): CommandOutcome {
    const item = requestObject(body.item);
    if (typeof item.name !== "string") return undefined;
    if (body.type === "buy-copy") {
      (state.purchases[requestText(body.character)] ||= []).push({ name: item.name });
      ports.persist();
      return null;
    }
    if (body.type !== "merchant-weapon" && body.type !== "auto-exchange" && body.type !== "exchange") return undefined;
    return selected(body, item as Item & { name: string });
  }
  return { handle };
}

// ---------------------------------------------------------------------------------------------
// The market routes' decisions: each route parses its request and asks one
// of these, which reads the market rules and answers with an ItemsAnswer.

export interface ALDataRouteState {
  aldata: {
    key: string;
    auth: unknown;
    authCheckedAt: number;
    publishStatus: string;
    error: string | null;
  };
  merchantCharacter: string | null;
  statuses: Record<string, unknown>;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
}
export interface ALDataRoutePorts {
  now(): number;
  key(): string;
  nextCommand(): number;
  snapshot(): unknown;
  fetch(path: string): Promise<unknown>;
  refresh(): Promise<unknown>;
  persistMarket(): void;
  publish(): void;
  enqueue(ask: EnqueueAsk): EnqueueAnswer;
  log(message: string, level: string): void;
  persist(): void;
  dispatch(): void;
  write(batch: SettingsWrite): SettingsWriteResult;
}

export function createALDataActions(state: ALDataRouteState, ports: ALDataRoutePorts) {
  function key(): ItemsAnswer {
    return { body: { key: state.aldata.key || "" } };
  }
  function market(): ItemsAnswer {
    return { body: ports.snapshot() };
  }
  // The key is a secret setting: it goes through
  // the settings writer, whose audit line names it with no values, into the credentials document.
  // Its authentication is the items owner's record, reset beside the write.
  function generateKey(): ItemsAnswer {
    const written = ports.write({ by: "dashboard:aldata-key", changes: [{ field: "aldataKey", value: ports.key() }] });
    if (!written.ok) return { status: 400, body: { error: written.error } };
    state.aldata.auth = "NO";
    state.aldata.authCheckedAt = 0;
    state.aldata.publishStatus = "idle";
    ports.persistMarket();
    return { body: { key: state.aldata.key } };
  }
  async function auth(): Promise<ItemsAnswer> {
    const character = state.merchantCharacter || Object.keys(state.statuses)[0];
    if (!character) return { status: 409, body: { error: "no online character is available" } };
    try {
      const status = requestObject(
        await ports.fetch(
          "/auth/" +
            encodeURIComponent(character) +
            (state.aldata.key ? "/" + encodeURIComponent(state.aldata.key) : ""),
        ),
      );
      state.aldata.auth = status.auth || "NO";
      state.aldata.authCheckedAt = ports.now();
      state.aldata.error = null;
      ports.persistMarket();
      if (state.aldata.auth === "CORRECT") ports.publish();
      return { body: { ...status, checkedAt: state.aldata.authCheckedAt } };
    } catch (error) {
      state.aldata.error = error instanceof Error ? error.message : String(error);
      return { status: 502, body: { error: state.aldata.error } };
    }
  }
  function sendAuth(): ItemsAnswer {
    const merchant = state.merchantCharacter;
    if (!merchant || !state.statuses[merchant])
      return { status: 409, body: { error: "merchant is not online" } };
    if (!state.aldata.key) return { status: 409, body: { error: "generate an ALData key first" } };
    if (
      [state.merchantCurrent, ...state.merchantQueue].some(
        (job) => job?.reason === "ALData authentication",
      )
    )
      return { body: { ok: true, duplicate: true } };
    const id = "merchant-" + ports.now() + "-" + ports.nextCommand();
    ports.enqueue({ reason: "ALData authentication", target: merchant, fields: { id } });
    ports.log("ALData authentication mail queued", "info");
    ports.persist();
    ports.dispatch();
    return { body: { ok: true, jobId: id } };
  }
  async function refresh(): Promise<ItemsAnswer> {
    return { body: await ports.refresh() };
  }
  return { key, market, generateKey, auth, sendAuth, refresh };
}

// The ignored market items are a setting: the route builds the next list from the request and
// writes it through the settings writer.
export function createIgnoredItemsWrite(state:{marketIgnoredItems:MarketIgnoredItem[]},write:(batch:SettingsWrite)=>SettingsWriteResult){
  return (body:Record<string, unknown>):ItemsAnswer=>{
    let items:MarketIgnoredItem[];
    if(body.action==='clear')items=[];
    else if(body.action==='add'||body.action==='remove'){
      // The settings writer checks the entry by the declaration.
      const item={name:body.name,level:body.level??0} as MarketIgnoredItem;
      const key=marketItemKey(item);
      items=state.marketIgnoredItems.filter(entry=>marketItemKey(entry)!==key);
      // One entry per item key: an add replaces the entry it matches.
      if(body.action==='add')items.push(item);
    }else return { status: 400, body: {error:'Choose add, remove, or clear'} };
    const written=write({by:'dashboard:market-ignored-items',changes:[{field:'marketIgnoredItems',value:items}]});
    if(!written.ok)return { status: 400, body: {error:written.error} };
    return { body: {ok:true,items:state.marketIgnoredItems} };
  };
}

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
  // The spot each seller was last followed to. A b9b5c91e job saved `true`, which names no spot, so
  // its next refresh compares against the advertised one.
  locationRefreshes?: Record<string, Spot | boolean>;
}
interface Spot { map: unknown; x: number; y: number }
export interface LocationState {
  merchantCurrent: MerchantWork | null;
}
// ALData's market kinds (the merchant jobs owner's `market` kinds that run an ALData command) carry a located listing.
function locationJob(job: MerchantWork): job is LocationJob {
  const kind = merchantKind(job.reason);
  return !!kind.market && /^merchant-aldata-/.test(kind.command ?? "");
}
function selectedListing(job: LocationJob, key: unknown): LocatedListing | undefined {
  return !merchantKind(job.reason).purchase
    ? job.buyOrder
    : (job.listings || []).find((entry) => entry.key === key);
}
export interface LocationPorts {
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

export function createListingRelocation(state: LocationState, ports: LocationPorts) {
  function find(
    records: unknown,
    name: string | undefined,
    listing: LocatedListing,
    sale: boolean,
    from: Spot,
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
    // The merchant found no seller at the spot it last looked, so a refreshed spot that differs at
    // all is a new spot to follow.
    return offer && (offer.map !== from.map || offer.x !== from.x || offer.y !== from.y) ? offer : null;
  }
  async function refresh(
    current: LocationJob,
    listing: LocatedListing,
    sale: boolean,
    name: string | undefined,
    key: string,
  ): Promise<ItemsAnswer> {
    try {
      const records = await ports.fetch();
      if (state.merchantCurrent !== current)
        return { status: 409, body: { error: "marketplace job was cancelled" } };
      const followed = current.locationRefreshes?.[key], from = typeof followed === "object" ? followed : listing;
      const moved = find(records, name, listing, sale, from),
        location = moved ? { map: moved.map, x: moved.x, y: moved.y } : null;
      if (location) {
        (current.locationRefreshes ||= {})[key] = location;
        ports.persist();
      }
      ports.log(
        moved
          ? "Re-found " + name + "; following to refreshed location"
          : "Stopped looking for " + name + "; refreshed listing is missing or has no new location",
        moved ? "info" : "warning",
        location,
      );
      return { body: { location } };
    } catch (error) {
      return { status: 502, body: { error: requestText(requestObject(error).message || error) } };
    }
  }
  return async function refreshLocation(body: Record<string, unknown>): Promise<ItemsAnswer> {
    const current = state.merchantCurrent;
    if (!current || current.id !== body.jobId)
      return { status: 409, body: { error: "marketplace job is no longer current" } };
    if (!locationJob(current))
      return { status: 400, body: { error: "unknown marketplace listing" } };
    const sale = current.reason === "ALData marketplace sales";
    const listing = selectedListing(current, body.listingKey);
    if (!listing) return { status: 400, body: { error: "unknown marketplace listing" } };
    const name = sale ? listing.buyer : listing.seller,
      key = sellerKey({ seller: name, serverRegion: listing.serverRegion, serverIdentifier: listing.serverIdentifier });
    return refresh(current, listing, sale, name, key);
  };
}

const failures: Readonly<Record<string, string>> = {
  stand_not_open: "Seller found, but stand was not open",
  seller_not_visible: "Seller was not visible at the advertised location",
  listing_not_available: "Seller's stand was open, but the listing was unavailable",
  destination_unreachable: "Could not reach the seller's advertised location",
};

export function createMarketplaceProgress(
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
  function ponty(body: Record<string, unknown>): ItemsAnswer {
    const job = current(body, "Ponty purchases");
    if (!job) return { status: 409, body: { error: "Ponty job is no longer current" } };
    const listing = job.listings!.find((entry) => entry.key === body.listingKey);
    if (!listing) return { status: 400, body: { error: "unknown Ponty listing" } };
    if (!(job.completedListingKeys || []).includes(listing.key)) pontyComplete(job, listing, body);
    return { body: { ok: true } };
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
    job.heartbeatAt = ports.now();
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
  function aldata(body: Record<string, unknown>): ItemsAnswer {
    const job = current(body, "ALData marketplace purchases");
    if (!job) return { status: 409, body: { error: "ALData marketplace job is no longer current" } };
    const listing = (job.listings || []).find((entry) => entry.key === body.listingKey);
    if (!listing) return { status: 400, body: { error: "unknown ALData listing" } };
    if ((job.completedListingKeys || []).includes(listing.key))
      return { body: {
        ok: true,
        alreadyCompleted: true,
        remaining: remaining(listing),
        additionalListings: [],
        cancelSeller: null,
      } };
    progress.complete(job, listing.key);
    reportPurchase(listing, body, !!job.acknowledgedPurchaseKeys?.includes(listing.key));
    const failure = requestText(body.failureCode);
    const cancelSeller =
      !body.success && ["seller_not_visible", "stand_not_open"].includes(failure)
        ? progress.cancelSeller(job, listing, failure)
        : null;
    const additionalListings = body.success ? progress.additional(job, listing) : [];
    ports.persist();
    return { body: { ok: true, remaining: remaining(listing), additionalListings, cancelSeller } };
  }
  return { ponty, aldata };
}

/** The one range check of a request's whole number: a safe integer from min to max. */
function whole(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
function matches(entry: OrderListing, line: Record<string, unknown>): boolean {
  return (
    entry.seller === line.seller &&
    entry.slot === line.slot &&
    entry.rid === line.rid &&
    entry.item.name === line.itemName &&
    entry.price === Number(line.price)
  );
}
export function createManualOrderRequests(state: ManualOrderState, ports: ManualOrderPorts) {
  const orders = createManualOrders(state, ports);
  function stand(body: Record<string, unknown>): ItemsAnswer {
    const requested = body.listings;
    if (!state.merchantCharacter)
      return { status: 409, body: { error: "configure a merchant first" } };
    if (!Array.isArray(requested) || !requested.length)
      return { status: 400, body: { error: "select at least one valid stand listing" } };
    const listings = normalizeStand(requested);
    if (!listings)
      return { status: 409, body: { error: "a selected listing is stale or has an invalid quantity" } };
    return { body: { ok: true, jobId: orders.stand(listings).id } };
  }
  function normalizeStand(requested: unknown[]): OrderListing[] | null {
    const available = (
        state.statuses[String(state.merchantCharacter)]?.nearbyStandListings || []
      ).concat(state.standListingCache || []),
      normalized: OrderListing[] = [];
    for (const raw of requested) {
      const line = requestObject(raw),
        buyQuantity = Number(line.buyQuantity),
        listing = available.find((entry) => matches(entry, line));
      if (!listing || !whole(buyQuantity, 1, Number.MAX_SAFE_INTEGER) || buyQuantity > listing.quantity) return null;
      normalized.push({ ...listing, buyQuantity });
    }
    return normalized;
  }
  function freshness(listing: OrderListing): string | null {
    return listing.serverIdentifier === "PVP" ? "automatic PVP realm travel is disabled" : null;
  }
  function aldata(sale: boolean) {
    return function submit(body: Record<string, unknown>): ItemsAnswer {
      const requested = requestObject(sale ? body.order : body.listing),
        quantity = Number(sale ? body.sellQuantity : body.buyQuantity);
      if (!state.merchantCharacter || typeof requested.key !== "string" || !whole(quantity, 1, Number.MAX_SAFE_INTEGER))
        return { status: 400, body: {
            error: sale
              ? "select a valid ALData buy order and quantity"
              : "select a valid ALData listing and quantity",
          } };
      return submitALData(requested.key, quantity, sale);
    };
  }
  function submitALData(key: string, quantity: number, sale: boolean): ItemsAnswer {
    const listing = (sale ? state.aldata.marketBuyOrders : state.aldata.marketListings).find(
      (entry) => entry.key === key,
    );
    if (!listing)
      return { status: 409, body: {
          error: sale
            ? "ALData buy order is no longer in the market snapshot"
            : "ALData listing is no longer in the market snapshot",
        } };
    const error = freshness(listing);
    if (error) return { status: 409, body: { error } };
    return { body: { ok: true, jobId: orders.aldata(listing, quantity, sale).id } };
  }
  function ponty(body: Record<string, unknown>): ItemsAnswer {
    const keys = new Set(Array.isArray(body.keys) ? body.keys : []);
    if (!state.merchantCharacter || !keys.size)
      return { status: 400, body: { error: "select a valid Ponty listing" } };
    const candidates = orders.candidates(keys, Number(body.unitPrice));
    if (!candidates.length || new Set(candidates.map((entry) => entry.groupKey)).size !== 1)
      return { status: 409, body: { error: "Ponty listings changed or are stale; refresh your selection" } };
    const selected = ports.plan(
      candidates,
      Number(body.quantity),
      state.statuses[String(state.merchantCharacter)]?.server,
    );
    if (!selected)
      return { status: 409, body: {
          error: "That quantity is unavailable as whole Ponty stacks; choose a different quantity",
        } };
    const jobs = orders.ponty(selected, Number(body.quantity));
    return { body: { ok: true, jobId: jobs[0]!.id, jobIds: jobs.map((job) => job.id) } };
  }
  return { stand, purchase: aldata(false), sale: aldata(true), ponty };
}

interface Bid {
  useStandSlot: boolean;
  acceptHigherLevels: boolean;
  price: number;
  quantity: number;
  minimumQuality: number;
  priorityOverride?: number;
}
interface BidItem {
  id: string;
  upgradeable?: boolean;
  compoundable?: boolean;
}
export interface BidWriteState extends NativeStandState {
  merchantCharacter: string | null;
  merchantCatalog?: { allItems?: BidItem[] } | null;
  standBids: Record<string, StandBid | undefined>;
  statuses: Record<string, { nearbyStandListings?: unknown[]; gold?: unknown; items?: unknown } | undefined>;
}
export interface BidWritePorts {
  removeQueued(id: string): void;
  log(message: string, level: string): void;
  observe(listings: unknown[]): void;
  persist(): void;
  publish(): void;
  ponty(): boolean;
  aldata(): unknown;
  dispatch(): void;
}
function priority(value: unknown, previous: number | undefined): number | undefined {
  if (value === undefined) return previous;
  return value === null || value === "" ? undefined : Number(value);
}
function preferences(body: Record<string, unknown>, previous: StandBid | undefined) {
  return {
    useStandSlot: body.useStandSlot === undefined ? previous?.useStandSlot === true : body.useStandSlot === true,
    acceptHigherLevels: body.acceptHigherLevels === undefined ? previous?.acceptHigherLevels !== false : body.acceptHigherLevels !== false,
  };
}
function parseEdit(body: Record<string, unknown>, previous: StandBid | undefined): Bid | string {
  if (body.editField !== undefined) {
    if (!previous) return "This WTB order has already completed or was cancelled";
    if (typeof body.editField !== "string" || !["price", "quantity", "priorityOverride"].includes(body.editField)) return "invalid WTB edit field";
    if (body.value === undefined) return "missing WTB edit value";
    return validate({ ...previous, [body.editField]: body.value }, previous);
  }
  if (body.preferencesOnly !== true) return validate(body, previous);
  if (!previous) return "This WTB order has already completed or was cancelled";
  return validate({ ...body, price: previous.price, quantity: previous.quantity, minimumQuality: previous.minimumQuality, priorityOverride: previous.priorityOverride }, previous);
}
function staleFieldEdit(body: Record<string, unknown>, previous: StandBid | undefined): boolean {
  if (body.editField === undefined) return false;
  return !previous || body.bidRevision !== Number(previous.revision || 0);
}
function validate(body: Record<string, unknown>, previous: StandBid | undefined): Bid | string {
  const price = Number(body.price),
    quantity = Number(body.quantity),
    minimumQuality = Number(body.minimumQuality || 0);
  // A bid stays inside the game's wishlist price and the upgrade levels the game reaches; each
  // refused field answers with its own bound. The quantity refusal is v1.5.0's active WTB field
  // words (active-wtb-fields.tsx:28), which that field and the bid dialog both show from here.
  if (!whole(price, 1, TRADE_PRICE_MAX)) return "enter a whole-number bid from 1 to " + TRADE_PRICE_MAX.toLocaleString("en-US") + " gold";
  if (!whole(quantity, 1, Number.MAX_SAFE_INTEGER)) return "Quantity must be a positive whole number.";
  if (!whole(minimumQuality, 0, UPGRADE_LEVEL_MAX)) return "enter a minimum level from +0 to +" + UPGRADE_LEVEL_MAX;
  const priorityOverride = priority(body.priorityOverride, previous?.priorityOverride);
  if (priorityOverride !== undefined && !whole(priorityOverride, ROUTINE_PRIORITY.min, ROUTINE_PRIORITY.max))
    return "Priority must be " + ROUTINE_PRIORITY.min + "–" + ROUTINE_PRIORITY.max + " or blank.";
  return {
    price,
    quantity,
    ...preferences(body, previous),
    ...(priorityOverride === undefined ? {} : { priorityOverride }),
    minimumQuality,
  };
}
export function createBidWrite(state: BidWriteState, ports: BidWritePorts) {
  function set(item: BidItem, bid: Bid): void {
    ports.removeQueued(item.id);
    state.standBids[item.id] = {
      ...bid,
      revision: state.standBids[item.id] ? Number(state.standBids[item.id]!.revision || 0) : ++nativeLedger(state).sequence,
      standSuppressed: bid.useStandSlot ? false : state.standBids[item.id]?.standSuppressed,
      minimumQuality: item.upgradeable || item.compoundable ? bid.minimumQuality : 0,
    };
    ports.log(
      "Bid set for " +
        bid.quantity +
        " × " +
        item.id +
        " at up to " +
        bid.price.toLocaleString() +
        " gold",
      "info",
    );
    ports.observe(state.statuses[String(state.merchantCharacter)]?.nearbyStandListings || []);
  }
  function purchasePending(id: string): boolean {
    return Object.values(nativeLedger(state).purchases || {}).some(entry => entry.item.name === id);
  }
  function conflict(id: string, body: Record<string, unknown>): string | null {
    if (staleFieldEdit(body, state.standBids[id]))
      return "This WTB order completed, was cancelled, or was replaced; refresh before editing";
    return purchasePending(id) ? "A purchase is awaiting confirmation; retry the edit after it completes" : null;
  }
  function replace(id: string, parsed: Bid, selection: unknown) {
    const occupants = nativeOccupants(state, id);
    // The stand holds the merchant's reported trade slots, so a bid asks for room only when they are full.
    if (!parsed.useStandSlot || state.standBids[id]?.useStandSlot || occupants.length < merchantStandSlots(state)) return null;
    const selected = occupants.find(entry => entry.id === selection);
    if (!selected) return { error: "All stand slots are full. Which item would you like to remove to make room for the buy order?", occupants };
    displaceNativeOccupant(state, selected.id);
    return null;
  }
  return function bid(body: Record<string, unknown>): ItemsAnswer {
    const item = (state.merchantCatalog?.allItems || []).find((entry) => entry.id === body.itemId);
    if (typeof body.itemId !== "string" || !item)
      return { status: 400, body: { error: "select a valid item" } };
    const id = requestText(body.itemId);
    const editConflict = conflict(id, body);
    if (editConflict) return { status: 409, body: { error: editConflict } };
    if (body.clear === true) {
      ports.removeQueued(id);
      delete state.standBids[id];
      ports.log("Cleared bid for " + id, "info");
    } else {
      const parsed = parseEdit(body, state.standBids[id]);
      if (typeof parsed === "string") return { status: 400, body: { error: parsed } };
      const replacementError = replace(id, parsed, body.replaceStandEntry);
      if (replacementError) return { status: 409, body: replacementError };
      set(item, parsed);
    }
    ports.persist();
    ports.publish();
    if (!ports.ponty()) ports.aldata();
    ports.dispatch();
    return { body: { ok: true, standBids: state.standBids } };
  };
}

export interface BlacklistPorts {
  now(): number;
  key(entry: MerchantIdentity): string;
  log(message: string, level: string, details: unknown): void;
  persist(): void;
  write(batch: SettingsWrite): SettingsWriteResult;
}
export function createBlacklistWrite(
  state: { merchantBlacklist: Record<string, MerchantBlock>; autoBlacklistMerchants?: boolean },
  ports: BlacklistPorts,
) {
  function add(body: Record<string, unknown>): ItemsAnswer | null {
    const seller = requestText(body.seller || "").trim();
    if (!seller) return { status: 400, body: { error: "enter a merchant name" } };
    const minutes = Number(body.minutes);
    if (!Number.isFinite(minutes) || (minutes !== -1 && minutes < 1))
      return { status: 400, body: { error: "duration must be minutes or -1 for forever" } };
    const entry = {
        seller,
        serverRegion: requestText(body.serverRegion || ""),
        serverIdentifier: requestText(body.serverIdentifier || ""),
      },
      key = ports.key(entry);
    state.merchantBlacklist[key] = {
      ...entry,
      reason: "manual",
      failures: 0,
      until: minutes === -1 ? -1 : ports.now() + minutes * 60000,
      updatedAt: ports.now(),
    };
    ports.log("!!!BLACKLISTED!!! - " + seller, "warning", {
      reason: "manual",
      until: state.merchantBlacklist[key].until,
    });
    return null;
  }
  return function blacklist(body: Record<string, unknown>): ItemsAnswer {
    const action = requestText(body.action || "add");
    if (action === "configure") {
      if (typeof body.enabled !== "boolean")
        return { status: 400, body: { error: "invalid blacklist setting" } };
      // The automatic blacklist switch is a setting; the blacklist itself is the items owner's record.
      const written = ports.write({ by: "dashboard:merchant-blacklist", changes: [{ field: "autoBlacklistMerchants", value: body.enabled }] });
      if (!written.ok) return { status: 400, body: { error: written.error } };
    } else if (action === "clear") {
      const key = requestText(body.key || "");
      if (key) delete state.merchantBlacklist[key];
      else state.merchantBlacklist = {};
    } else {
      const refused = add(body);
      if (refused) return refused;
    }
    ports.persist();
    return { body: { ok: true, blacklist: state.merchantBlacklist } };
  };
}

export interface NativeAnswerState extends NativeStandState { merchantCharacter: string | null; merchantCurrent: MerchantWork | null; merchantQueue: MerchantWork[]; nextCommandId: number;
  goldReserve?: number }
export interface NativeAnswerPorts { fulfill(item: Item, quantity: number): unknown; persist(): void; dispatch(): void; enqueue(ask: EnqueueAsk): EnqueueAnswer;
  write(batch: SettingsWrite): SettingsWriteResult }
export function createNativeStandAnswers(state: NativeAnswerState, ports: NativeAnswerPorts) {
  const service = createNativeStand(state, (item, quantity) => ports.fulfill(item, quantity));
  function purchased(jobId: string, key: string): ItemsAnswer {
    const pending = nativeLedger(state).purchases ||= {}, id = jobId + ":" + key;
    const reservation = pending[id];
    if (!reservation) return { body: { ok: true, alreadyCompleted: true } };
    ports.fulfill(reservation.item, reservation.quantity);
    delete pending[id];
    const job = state.merchantCurrent;
    if (job?.id === jobId) job.acknowledgedPurchaseKeys = [...new Set([...(job.acknowledgedPurchaseKeys || []), key])];
    ports.persist(); return { body: { ok: true } };
  }
  function prepare(job: MerchantWork, key: string, body: Record<string, unknown>): ItemsAnswer {
    const pending = nativeLedger(state).purchases ||= {}, item = requestObject(body.item) as Item;
    const requested = Number(body.quantity), price = Number(body.price);
    if (!validTerms(item, requested, price)) return { status: 400, body: { error: "invalid purchase terms" } };
    if (Object.values(pending).some(entry => entry.item.name === item.name))
      return { status: 409, body: { error: "A previous purchase outcome is unconfirmed; reconciliation required" } };
    const automatic = !!job.bidItemId || body.automatic === true;
    let quantity = automatic || state.standBids[String(item.name)] ? nativePurchaseLimit(state, item, price, requested) : requested;
    if (body.wholeStack === true && quantity < requested) quantity = 0;
    if (quantity) pending[job.id + ":" + key] = { item, quantity, jobId: job.id };
    ports.persist(); return { body: { ok: true, quantity } };
  }
  function alreadyPurchased(job: MerchantWork, key: string): boolean {
    return !!(job.completedListingKeys?.includes(key) || job.acknowledgedPurchaseKeys?.includes(key));
  }
  function purchase(body: Record<string, unknown>): ItemsAnswer {
    const job = state.merchantCurrent, key = String(body.key);
    if (!job || job.id !== body.jobId) return { status: 409, body: { error: "purchase is no longer current" } };

    if (alreadyPurchased(job, key)) return { body: { ok: true, quantity: 0 } };
    return prepare(job, key, body);
  }
  function suspend(body: Record<string, unknown>): boolean {
    return !!merchantKind(state.merchantCurrent?.reason || "").purchase || body.suspend === true;
  }
  /**
   * A purchase whose job ended without the merchant's `purchased` report blocks its item's
   * WTB until someone decides the outcome: bought counts the reserved quantity as filled,
   * not bought releases it. A purchase whose job is still current or queued keeps
   * its normal confirmation path.
   */
  function resolvePurchase(body: Record<string, unknown>): ItemsAnswer {
    const pending = nativeLedger(state).purchases ||= {}, id = String(body.id), reservation = pending[id];
    if (!reservation || typeof body.bought !== "boolean") return { status: 409, body: { error: "That purchase is no longer pending" } };
    if ([state.merchantCurrent, ...state.merchantQueue].some(job => job?.id === reservation.jobId))
      return { status: 409, body: { error: "That purchase is still in progress" } };
    if (body.bought) ports.fulfill(reservation.item, reservation.quantity);
    delete pending[id];
    delete nativeLedger(state).problems[String(reservation.item.name)];
    ports.persist(); ports.dispatch();
    return { body: { ok: true } };
  }
  function configure(body: Record<string, unknown>): ItemsAnswer {
    if (typeof body.enabled !== "boolean") return { status: 400, body: { error: "invalid automatic fill setting" } };
    // The automatic fill switch is a setting, written through the settings writer.
    const written = ports.write({ by: "dashboard:native-stand", changes: [{ field: "autoStandBuys", value: body.enabled }] });
    return written.ok ? { body: { ok: true } } : { status: 400, body: { error: written.error } };
  }
  function fundStand(observation: NativeObservation, suspended: boolean): void {
    if (suspended || !observation.open || observation.space === false) return;
    // The stand's funding from the carried and banked gold above the reserve.
    const carried = Number(observation.gold) || 0;
    const target = standFunding(state, carried);
    if (target <= carried) return;
    if ([state.merchantCurrent, ...state.merchantQueue].some(job => job?.reason === "native stand funding")) return;
    ports.enqueue({ reason: "native stand funding", target: state.merchantCharacter,
      fields: { id: "native-funding-" + state.nextCommandId++, goldTarget: target } });
    ports.persist(); ports.dispatch();
  }
  return (body: Record<string, unknown>): ItemsAnswer => {
    if (body.action === "configure") return configure(body);
    if (body.action === "resolve-purchase") return resolvePurchase(body);
    if (body.character !== state.merchantCharacter) return { status: 409, body: { error: "merchant is no longer configured" } };
    if (body.action === "purchased") return purchased(String(body.jobId), String(body.key));
    if (body.jobId && body.jobId !== state.merchantCurrent?.id) return { status: 409, body: { error: "purchase is no longer current" } };
    if (body.action === "purchase" || body.action === "purchased") return purchase(body);
    const observation = nativeObservation(body);
    service.observe(observation);
    const actions = service.plan(observation, suspend(body));
    fundStand(observation, suspend(body));
    ports.persist();
    const ledger = nativeLedger(state);
    return { body: { ok: true, ...actions, offers: ledger.offers, bids: state.standBids } };
  };
}

/** Revalidate the shared remainder immediately before the game purchase API. */
export function nativePurchaseLimit(state: NativeStandState, item: Item, price: number, requested: number): number {
  const bid = state.standBids[String(item.name)];
  if (!bid || !bidAcceptsLevel(bid, item) || price > bid.price) return 0;
  // A live offer keeps only its
  // outstanding copies from the purchase, so the two never buy the same copies.
  const outstanding = Object.values(nativeLedger(state).offers).filter(offer => offer.itemId === item.name)
    .reduce((sum, offer) => sum + offer.quantity - offer.acknowledged, 0);
  return Math.max(0, Math.min(requested, bid.quantity - outstanding));
}

function validTerms(item: Item, quantity: number, price: number): boolean {
  return !!item.name && Number.isSafeInteger(quantity) && quantity > 0 && Number.isFinite(price) && price > 0;
}
function nativeObservation(body: Record<string, unknown>): NativeObservation {
  return { slots: requestObject(body.slots) as NativeObservation["slots"], open: body.open === true,
    receipts: requestObject(body.receipts) as Record<string, number>, removed: typeof body.removed === "string" ? body.removed : undefined,
    failed: typeof body.failed === "string" ? body.failed : undefined, gold: Number(body.gold), space: body.space !== false };
}

interface NpcSaleEntry extends InventoryEntry {
  [field: string]: unknown;
}
interface SaleRequest {
  source: "merchant" | "bank" | "character";
  character?: string;
  pack: string | null;
  slot: number;
  quantity: number;
  item: Item & { name: string };
}
interface SaleMark extends Omit<SaleRequest, "pack"> {
  id: string;
  pack?: string;
  queuedAt: number;
  state: string;
}
export interface SaleState extends PlayerSaleState {
  merchantCharacter: string | null;
  statuses: Record<string, { items?: (NpcSaleEntry | null)[] } | undefined>;
  bankbois: Record<string, { items?: (NpcSaleEntry | null)[] } | undefined>;
  bankSnapshot: { packs?: Record<string, (NpcSaleEntry | null)[] | undefined> } | null;
  npcSaleMarks: SaleMark[];
  withdrawals: Record<string, WithdrawalRequest[] | undefined>;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
}
export interface SalePorts {
  now(): number;
  nextCommand(): number;
  persistBank(): void;
  bankService(): unknown;
  enqueue(ask: EnqueueAsk): EnqueueAnswer;
  queue(names: (string | null)[], reason: JobReason): void;
  log(message: string, level: string): void;
  persist(): void;
}

function saleRequest(body: Record<string, unknown>, merchant: string | null): SaleRequest | null {
  const source = saleSource(body.source),
    pack = storagePack(body.pack),
    slot = Number(body.slot),
    item = requestObject(body.item);
  if (
    !merchant ||
    (source === "bank" && !pack) ||
    !Number.isSafeInteger(slot) ||
    slot < 0 ||
    typeof item.name !== "string"
  )
    return null;
  return {
    source,
    character: typeof body.character === "string" ? body.character : undefined,
    pack,
    slot,
    item: item as Item & { name: string },
    quantity: Number(body.quantity || 1),
  };
}
function saleSource(source: unknown): SaleRequest["source"] {
  return source === "character" || source === "merchant" ? source : "bank";
}
function modified(item: Item): boolean {
  return Number(item.level) > 0 || !!item.stat_type || !!item.p;
}
function saleWarning(request: SaleRequest, live: NpcSaleEntry, acknowledged: unknown): string | null {
  const available = Number(live.item?.q) || 1,
    { item, quantity } = request,
    current = live.item || item;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > available)
    return "invalid NPC sale quantity";
  if (modified(current) && acknowledged !== true)
    return "confirm the modified-item warning before selling";
  return current.l ? "locked items cannot be sold" : null;
}

export function createNpcSaleRequest(state: SaleState, ports: SalePorts) {
  function bankboi(pack: string | null) {
    const worker = bankboiName(pack);
    return worker !== null ? state.bankbois[worker] : null;
  }
  function liveItem(request: SaleRequest): NpcSaleEntry | null | undefined {
    if (request.source !== "bank")
      return state.statuses[String(request.source === "character" ? request.character : state.merchantCharacter)]?.items?.find(
        (entry) => entry?.slot === request.slot,
      );
    const worker = bankboi(request.pack);
    return worker
      ? (worker.items || [])[request.slot]
      : state.bankSnapshot?.packs?.[request.pack!]?.[request.slot];
  }
  function schedule(request: SaleRequest): void {
    const merchant = state.merchantCharacter;
    if (request.source === "character") {
      ports.queue([request.character!], "npc sale pickup");
      return;
    }
    if (bankboi(request.pack)) {
      (state.withdrawals[String(merchant)] ||= []).push({
        pack: request.pack!,
        slot: request.slot,
        item: request.item,
      });
      ports.persistBank();
      ports.bankService();
    } else if (
      state.merchantCurrent?.reason === "npc sales" &&
      !state.merchantQueue.some((job) => job.reason === "npc sales")
    )
      // The sale behind the running one: an ask with fields is its own job, so it does not merge
      // into the running sale as a marked ask would.
      ports.enqueue({ reason: "npc sales", target: merchant, fields: {} });
    else ports.queue([merchant], "npc sales");
  }
  function remove(body: Record<string, unknown>) {
      // A merchant or bank mark names no character, and the apps send the viewing one, so only a
      // character mark's owner is checked.
      const mark = state.npcSaleMarks.find(mark => mark.id === body.id && (mark.source !== "character" || mark.character === body.character));
      if (!mark || mark.state === "running" || state.merchantCurrent?.reason === "npc sales")
        return { status: 409, body: { error: "Sale is missing or already in progress" } };
      releasePlayerSale(state, mark);
      state.npcSaleMarks = state.npcSaleMarks.filter(entry => entry !== mark);
      ports.persist(); return { body: { ok: true } };
  }
  function validate(request: SaleRequest, body: Record<string, unknown>): ItemsAnswer | null {
    if (request.source === "character" && (!request.character || request.character === state.merchantCharacter ||
      !state.statuses[request.character])) return { status: 400, body: { error: "Unknown player character" } };
    const live = liveItem(request);
    if (!markMatches(live?.item || live, request.item))
      return { status: 409, body: { error: "the item moved; refresh and try again" } };
    const warning = saleWarning(request, live!, body.acknowledged);
    if (warning) return { status: 400, body: { error: warning } };
    return validatePlayer(request, live!);
  }
  function validatePlayer(request: SaleRequest, live: NpcSaleEntry): ItemsAnswer | null {
    if (request.source !== "character") return null;
    if (live.item?.b || playerSaleReserved(state, request.character!, request.slot, live.item!))
      return { status: 409, body: { error: "Remove the item's other work marks first" } };
    return null;
  }
  return function npcSale(body: Record<string, unknown>): ItemsAnswer {
    if (body.remove === true) return remove(body);
    const request = saleRequest(body, state.merchantCharacter);
    if (!request) return { status: 400, body: { error: "invalid NPC sale item" } };
    const refused = validate(request, body);
    if (refused) return refused;
    const existing = state.npcSaleMarks.find(mark => mark.source === request.source && mark.character === request.character &&
      mark.pack === (request.pack || undefined) && mark.slot === request.slot && markMatches(mark.item, request.item));
    if (existing) return { body: { ok: true, mark: existing } };
    const mark: SaleMark = {
      id: "npc-sale-" + ports.now() + "-" + ports.nextCommand(),
      source: request.source,
      character: request.character,
      pack: request.pack || undefined,
      slot: request.slot,
      item: request.item,
      quantity: request.quantity,
      queuedAt: ports.now(),
      state: request.source === "character" ? "collecting" : "queued",
    };
    state.npcSaleMarks.push(mark);
    if (request.source === "character") reservePlayerSale(state, mark);
    schedule(request);
    ports.log("Queued NPC sale for " + request.quantity + " × " + request.item.name, "info");
    ports.persist();
    return { body: { ok: true, mark } };
  };
}

interface AutomaticSaleMark {
  id?: string;
  character?: string;
  state?: string;
  auto?: boolean;
  autoRuleKey?: string;
}
export interface AutomaticSaleState extends SharedScope {
  autoNpcSales: Record<string, NpcSaleRule>;
  merchantMarked?: Record<string, ItemMark[] | undefined>;
  statuses?: Record<string, unknown>;
  autoStandMarks: Record<string, { item: Item; price: number; createdAt: number }>;
  npcSaleMarks: AutomaticSaleMark[];
  standListings: AutomaticSaleMark[];
  withdrawals?: Record<string, { standListingId?: string; autoNpcRuleKey?: string }[] | undefined>;
  merchantCurrent?: { reason?: string } | null;
}
export interface AutomaticSalePorts {
  selectAction?(item: Item, name: string, action: 'npc' | 'stand', draft: SettingsDraft): void;
  write(batch: SettingsWrite): SettingsWriteResult;
  now(): number;
  key(item: Item): string;
  reconcile(): void;
  persist(): void;
  publish(): void;
  syncStand(): boolean;
  idle(): void;
}

// The automatic NPC and stand sale rules are settings:
// a request edits them, and the rules its choice replaces, in its draft and writes the draft
// through the settings writer before the sale marks reconcile. The marks, listings and withdrawals
// it discards are the items owner's records; `discards` holds them until the writer accepts the draft, so a
// refused write leaves the rules and their records as they were.
// The two rule settings are the request's draft copies, which it writes as one batch.
type SaleRules = Pick<AutomaticSaleState, "autoNpcSales" | "autoStandMarks">;
const saleRules = (draft: SettingsDraft): SaleRules => ({ autoNpcSales: draft.edit("autoNpcSales"), autoStandMarks: draft.edit("autoStandMarks") });
export function createAutomaticSaleWrites(state: AutomaticSaleState, ports: AutomaticSalePorts) {
  let discards: (() => void)[] = [];
  function discardStand(predicate: (mark: AutomaticSaleMark) => boolean): void {
    discards.push(() => {
      const removed = new Set(state.standListings.filter(predicate).map(mark => mark.id));
      state.standListings = state.standListings.filter(mark => !predicate(mark));
      for (const [name, entries] of Object.entries(state.withdrawals || {}))
        state.withdrawals![name] = entries?.filter(entry => !entry.standListingId || !removed.has(entry.standListingId));
    });
  }
  function discardNpc(predicate: (mark: AutomaticSaleMark) => boolean) {
    discards.push(() => {
      state.npcSaleMarks = state.npcSaleMarks.filter(mark => {
        if (!predicate(mark)) return true;
        if (mark.id) releasePlayerSale(state, mark as NpcSale);
        return false;
      });
    });
  }
  // The draft goes out first; the records its rules discard change only on an accepted write.
  function write(by: string, draft: SettingsDraft): SettingsWriteResult {
    const written = ports.write({ by, changes: draft.changes() }), accepted = discards;
    discards = [];
    if (written.ok) for (const discard of accepted) discard();
    return written;
  }
  function updateNpc(rules: SaleRules, draft: SettingsDraft, item: Item, action: string, character?: string, keep?: number): void {
    const key = character ? npcSaleRuleKey(item, character) : ports.key(item);
    if (action === "remove") {
      delete rules.autoNpcSales[key];
      discardNpc(mark => mark.autoRuleKey === key);
    } else {
      if (!character && (rules.autoNpcSales[key]?.keep ?? 0) !== (keep ?? 0)) {
        // Unsent quantities were computed under the old reserve. Reconcile them
        // from current stock after replacing the rule, including whole-stack trips.
        discardNpc(mark => !!mark.auto && mark.autoRuleKey === key);
        discards.push(() => {
          for (const [name, entries] of Object.entries(state.withdrawals || {}))
            state.withdrawals![name] = entries?.filter(entry => entry.autoNpcRuleKey !== key);
        });
      }
      ports.selectAction?.(item, character || String(state.merchantCharacter), 'npc', draft);
      rules.autoNpcSales[key] = { item, createdAt: ports.now(), ...(character ? { character } : {}), ...(!character ? { keep: keep ?? 0 } : {}) };
      if (character || state.merchantRules) return;
      delete rules.autoStandMarks[key];
      discardStand(listing => !!listing.auto && listing.autoRuleKey === key);
    }
  }
  function save(syncStand = false): void {
    ports.reconcile();
    ports.persist();
    ports.publish();
    if (syncStand) ports.syncStand();
  }
  function clearNpc(rules: SaleRules, character?: string): void {
    const keys = new Set(Object.keys(rules.autoNpcSales).filter(key => rules.autoNpcSales[key].character === character));
    for (const key of keys) delete rules.autoNpcSales[key];
    discardNpc(mark => !!mark.auto && keys.has(mark.autoRuleKey!));
  }
  /** #116: a merchant-wide rule may keep some copies; blank sells every copy. Null is invalid. */
  function requestedKeep(value: unknown, character?: string): number | undefined | null {
    if (value === undefined || value === "") return undefined;
    if (value === null || !["number", "string"].includes(typeof value)) return null;
    const keep = Number(value);
    return character || !Number.isSafeInteger(keep) || keep < 0 ? null : keep;
  }
  function npcRuleError(item: Record<string, unknown>, keep: unknown, character?: string): string | null {
    if (typeof item.name !== "string") return "invalid automatic NPC sale item";
    return requestedKeep(keep, character) === null ? "enter a whole number of copies to keep, or leave it blank" : null;
  }
  function npc(body: Record<string, unknown>): ItemsAnswer {
    const item = requestObject(body.item),
      action = requestText(body.action || "set");
    const character = state.merchantRules ? undefined : typeof body.character === "string" ? body.character : undefined;
    if (character && !state.statuses?.[character]) return { status: 400, body: { error: "Unknown character" } };
    const draft = settingsDraft(state), rules = saleRules(draft);
    if (action === "clear-all") clearNpc(rules, character);
    else {
      const error = npcRuleError(item, body.keep, character);
      if (error) return { status: 400, body: { error } };
      const key = character ? npcSaleRuleKey(item, character) : ports.key(item);
      if (action !== 'remove' && !character &&
          (state.autoNpcSales[key]?.keep ?? 0) !== (requestedKeep(body.keep, character) ?? 0) &&
          merchantKind(state.merchantCurrent?.reason || '').command === 'merchant-npc-sale' &&
          state.npcSaleMarks.some(mark => mark.autoRuleKey === key))
        return { status: 409, body: { error: 'Wait for the current NPC sale to finish before changing its reserve' } };
      updateNpc(rules, draft, item, action, character, requestedKeep(body.keep, character)!);
    }
    const written = write("dashboard:auto-npc-sale", draft);
    if (!written.ok) return { status: 400, body: { error: written.error } };
    save(!character);
    return { body: { ok: true, autoNpcSales: state.autoNpcSales } };
  }
  function updateStand(rules: SaleRules, draft: SettingsDraft, item: Item, action: string, price: number): string | null {
    const key = ports.key(item);
    if (action === "remove") {
      delete rules.autoStandMarks[key];
      discardStand(listing => listing.autoRuleKey === key);
    } else {
      if (!Number.isSafeInteger(price) || price < 1) return "enter a valid fixed stand price";
      ports.selectAction?.(item, String(state.merchantCharacter), 'stand', draft);
      rules.autoStandMarks[key] = { item, price, createdAt: ports.now() };
      if (state.merchantRules) return null;
      delete rules.autoNpcSales[key];
      discards.push(() => { state.npcSaleMarks = state.npcSaleMarks.filter((mark) => mark.autoRuleKey !== key); });
    }
    return null;
  }
  function stand(body: Record<string, unknown>): ItemsAnswer {
    const item = requestObject(body.item),
      action = requestText(body.action || "set");
    const draft = settingsDraft(state), rules = saleRules(draft);
    if (action === "clear-all") {
      draft.set("autoStandMarks", {});
      discardStand(listing => !!listing.auto);
    } else {
      if (typeof item.name !== "string")
        return { status: 400, body: { error: "invalid automatic stand item" } };
      const error = updateStand(rules, draft, item, action, Number(body.price));
      if (error) return { status: 400, body: { error } };
    }
    const written = write("dashboard:auto-stand", draft);
    if (!written.ok) return { status: 400, body: { error: written.error } };
    save();
    if (!ports.syncStand()) ports.idle();
    return { body: {
      ok: true,
      autoStandMarks: state.autoStandMarks,
      standListings: state.standListings,
    } };
  }
  return { npc, stand };
}

export interface StandPorts {
  now(): number;
  nextCommand(): number;
  persist(): void;
  publish(): void;
  bankService(): Promise<unknown>;
  log(message: string, level: string, details: unknown): void;
  queue(names: (string | null)[], reason: JobReason): void;
  syncStand(): boolean;
  idle(): void;
}

export function createStandMarkWrite(state: StandMarkState, ports: StandPorts) {
  const marks = createStandMarks(state, {
    now: () => ports.now(),
    nextCommand: () => ports.nextCommand(),
  });
  function needsWithdrawal(pack: string | null, body: Record<string, unknown>): boolean {
    return (
      !!(pack || body.markAll === true) &&
      body.remove !== true &&
      !!state.merchantCharacter &&
      !!(state.withdrawals[String(state.merchantCharacter)] || []).length
    );
  }
  function schedule(pack: string | null, body: Record<string, unknown>): void {
    if (isBankboiPack(pack) && body.remove !== true)
      ports
        .bankService()
        .catch((error) =>
          ports.log("Could not schedule bankboi retrieval", "error", {
            error: requestObject(error).message,
          }),
        );
    else if (needsWithdrawal(pack, body))
      ports.queue([state.merchantCharacter], "manual bank exchange");
    else if (!ports.syncStand()) ports.idle();
  }
  function update(
    body: Record<string, unknown>,
    item: Item,
    slot: number,
    pack: string | null,
  ): ItemsAnswer | null {
    const id = typeof body.id === "string" ? body.id : null,
      index = marks.find(id, pack, slot, item);
    if (body.remove === true) {
      marks.remove(index, pack, slot, item);
      return null;
    }
    const price = Number(body.price),
      quantity = Number(body.quantity || 1);
    if (!whole(price, 1, TRADE_PRICE_MAX) || !whole(quantity, 1, STACK_SIZE_MAX)) return { status: 400, body: { error: "invalid stand price or quantity" } };
    if (body.markAll === true) marks.markAll(item, price);
    else if (!marks.single(index, id, pack, slot, item, price, quantity)) {
      // The status follows the refusal's code, never its text.
      const slots = merchantStandSlots(state);
      return { status: 409, body: { error: `merchant stand is full (${slots}/${slots})`, code: "stand_full" } };
    }
    return null;
  }
  return function stand(body: Record<string, unknown>): ItemsAnswer {
    const slot = Number(body.slot),
      pack = storagePack(body.bankPack),
      item = requestObject(body.item);
    if (typeof item.name !== "string" || !Number.isSafeInteger(slot) || slot < 0)
      return { status: 400, body: { error: "invalid stand item" } };
    const refused = update(body, item, slot, pack);
    if (refused) return refused;
    ports.persist();
    ports.publish();
    schedule(pack, body);
    return { body: { ok: true, standListings: state.standListings } };
  };
}

// ---------------------------------------------------------------------------------------------
// The merchant's report log and stand sales (3.1 market.ts, merchant-observation.ts's functions):
// a changed report logs the bank, the anniversary craft, a death and the stand opening, and a gold
// rise on an open stand reads the sold copies from the trade slots, sending `items.sold`.

// The merchant's report as the status owner's intake hands it over.
interface MerchantReportView {
  name?: string;
  map?: string;
  x?: number;
  y?: number;
  gold?: number;
  rip?: boolean;
  standOpen?: boolean;
  slots?: Record<string, { item?: Item | null } | null>;
  lastDeath?: { message?: string; details?: unknown } | null;
  anniversaryState?: { craftResult?: { at?: number; success?: boolean; error?: unknown } };
}
interface ObservedListing {
  item: Item;
  tradeSlot?: string;
  quantity?: number;
  [field: string]: unknown;
}
interface MerchantObservationPorts {
  log(message: string, level: "info" | "success" | "error", details?: unknown): void;
  persist(): void;
  publish(): void;
}

function inBank(map: string | undefined): boolean {
  return /^bank(?:$|_[a-z0-9]+$)/i.test(String(map || ""));
}

function craftResult(status: MerchantReportView | undefined) {
  return status?.anniversaryState?.craftResult;
}

function logBank(
  current: MerchantReportView,
  previous: MerchantReportView | undefined,
  ports: MerchantObservationPorts,
): void {
  if (inBank(current.map) && (!previous || !inBank(previous.map)))
    ports.log(previous ? "Entered bank" : "Merchant online in bank", "info", {
      map: current.map,
      x: current.x,
      y: current.y,
    });
}

function logCraft(
  current: MerchantReportView,
  previous: MerchantReportView | undefined,
  ports: MerchantObservationPorts,
): void {
  const result = craftResult(current);
  if (result?.at && result.at !== craftResult(previous)?.at)
    ports.log(
      result.success ? "Sixfold Cake crafted and banked" : "Anniversary cake deferred",
      result.success ? "success" : "info",
      result.error || null,
    );
}

function logDeath(
  current: MerchantReportView,
  previous: MerchantReportView | undefined,
  ports: MerchantObservationPorts,
): void {
  if (!current.rip || previous?.rip) return;
  ports.log(
    current.lastDeath?.message || "Killed by unknown monster",
    "error",
    current.lastDeath && current.lastDeath.details,
  );
}

// The stand log tests the configured stand location, the point the stand return walks to, and the merchant jobs owner's
// legacy market point only when none is set. A stand opened
// within the merchant jobs owner's stand reach of that point is at the stand.
function logStand(
  current: MerchantReportView,
  previous: MerchantReportView | undefined,
  stand: StandPoint | null | undefined,
  ports: MerchantObservationPorts,
): void {
  if (!current.standOpen || previous?.standOpen) return;
  const point = stand ?? legacyStandLocation;
  const atMarket =
    current.map === point.map && Math.hypot(Number(current.x) - point.x, Number(current.y) - point.y) <= AT_STAND;
  ports.log(
    atMarket ? "At stand" : "Stand opened away from market",
    atMarket ? "success" : "info",
    { map: current.map, x: current.x, y: current.y },
  );
}

function soldQuantity(before: Item, after: Item | null | undefined): number {
  const beforeQuantity = Number(before.q) || 1,
    afterQuantity = after ? Number(after.q) || 1 : 0;
  return !after || after.name !== before.name
    ? beforeQuantity
    : Math.max(0, beforeQuantity - afterQuantity);
}

interface StandPoint { map: string; x: number; y: number }
/** Reconciles stand sales from observations, never from a movement or sale promise. */
export function createMerchantObservation(state: { standListings: ObservedListing[]; merchantCharacter: string | null; merchantStandLocation?: StandPoint | null }, ports: MerchantObservationPorts) {
  function updateListing(index: number, before: Item, after: Item | null | undefined): void {
    if (index < 0) return;
    const quantity = after ? Number(after.q) || 1 : 0;
    if (!after || after.name !== before.name || quantity <= 0) state.standListings.splice(index, 1);
    else {
      const listing = state.standListings[index];
      listing.quantity = quantity;
      listing.item = { ...listing.item, q: quantity };
    }
  }

  function sale(slot: string, before: Item, current: MerchantReportView): string | null {
    const after = current.slots?.[slot]?.item,
      quantity = soldQuantity(before, after);
    if (!quantity) return null;
    const index = state.standListings.findIndex(
      (listing) => listing.tradeSlot === slot && markMatches(before, listing.item),
    );
    const listing = index >= 0 ? state.standListings[index] : null;
    recordItems({ decision: "sold", subject: String(state.merchantCharacter), by: listing?.auto ? "S1" : "player", source: "stand",
      item: before.name, slot, quantity });
    const description =
      (listing?.item.name || before.name) + (quantity > 1 ? " × " + quantity : "");
    updateListing(index, before, after);
    return description;
  }

  function standSales(current: MerchantReportView, previous: MerchantReportView): void {
    const sold: string[] = [];
    for (const [slot, entry] of Object.entries(previous.slots || {})) {
      if (!slot.startsWith("trade") || !entry?.item) continue;
      const description = sale(slot, entry.item, current);
      if (description) sold.push(description);
    }
    if (!sold.length) return;
    ports.log(
      "Sold " +
        sold.join(", ") +
        " at stand (+" +
        (Number(current.gold) - Number(previous.gold)).toLocaleString() +
        " gold)",
      "success",
    );
    ports.persist();
    ports.publish();
  }

  function observe(current: MerchantReportView, previous: MerchantReportView | undefined): void {
    logBank(current, previous, ports);
    logCraft(current, previous, ports);
    logDeath(current, previous, ports);
    logStand(current, previous, state.merchantStandLocation, ports);
    if (current.standOpen && previous?.standOpen && Number(current.gold) > Number(previous.gold))
      standSales(current, previous);
  }

  return { observe };
}

// ---------------------------------------------------------------------------------------------
// Ponty's lots (from scripts/ponty-market.cjs), each priced by rules.ts `pontyPrice`.
interface PontyItem { name: string; level?: number; q?: number; rid?: unknown; expires?: unknown; gift?: unknown; [field: string]: unknown }
interface PontyRecord { serverRegion?: string; serverIdentifier?: string; lastSeen?: string; items?: PontyItem[] }
/** ALData's Ponty records as lots, each priced as the game prices it. */
export function normalizePontyListings(records: unknown, catalog: unknown): PontyEntry[] {
  const entries = (Array.isArray(catalog) ? catalog : []) as { id: string; meta?: ItemValueMeta }[];
  const definitions = new Map(entries.map(entry => [entry.id, entry.meta]));
  const scrollPrices = Object.fromEntries(entries.filter(entry => /^c?scroll[012]$/.test(entry.id))
    .map(entry => [entry.id, Number(entry.meta?.definition?.g)] as const).filter(([, value]) => Number.isFinite(value)));
  return ((Array.isArray(records) ? records : []) as PontyRecord[]).flatMap(record => {
    const { serverRegion, serverIdentifier } = record;
    const seenAt = Date.parse(String(record.lastSeen));
    if (!serverRegion || !serverIdentifier || !Number.isFinite(seenAt)) return [];
    return (record.items || []).flatMap(item => {
      const unitPrice = pontyPrice(item, definitions.get(item.name), scrollPrices);
      if (!item.rid || !unitPrice) return [];
      const quantity = Math.max(1, Number(item.q) || 1);
      return [{ key: pontyKey(serverRegion, serverIdentifier, item.rid), rid: String(item.rid),
        item, groupKey: pontyGroupKey(item), quantity, unitPrice, price: unitPrice * quantity,
        serverRegion, serverIdentifier, seenAt, source: 'aldata' } as unknown as PontyEntry];
    });
  });
}
interface PontyLot { quantity: number; unitPrice?: unknown; serverRegion?: string; serverIdentifier?: string }
/**
 * Whole lots that sum to the quantity, or null. A quantity past the lots' total has no answer, so
 * the sums stay inside what the lots hold.
 */
export function selectPontyLots<T extends PontyLot>(listings: readonly T[], quantity: number): T[] | null {
  const total = listings.reduce((sum, listing) => sum + listing.quantity, 0);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > total) return null;
  const sums = new Map<number, T[]>([[0, []]]);
  for (const listing of listings) {
    for (const [sum, chosen] of [...sums]) {
      const next = sum + listing.quantity;
      if (next <= quantity && !sums.has(next)) sums.set(next, chosen.concat(listing));
    }
    if (sums.has(quantity)) return sums.get(quantity)!;
  }
  return null;
}
/** The current realm first, then the realms holding the most, then the smallest and cheapest lots. */
export function prioritizePontyRealms<T extends PontyLot>(listings: readonly T[], currentRealm?: string): T[] {
  const realm = (listing: T) => String(listing.serverRegion || '') + String(listing.serverIdentifier || '');
  const current = bareRealm(currentRealm);
  const totals = new Map<string, number>();
  for (const listing of listings) totals.set(realm(listing), (totals.get(realm(listing)) || 0) + listing.quantity);
  return listings.slice().sort((a, b) => {
    const ar = realm(a), br = realm(b);
    return Number(br === current) - Number(ar === current) ||
      (totals.get(br)! - totals.get(ar)!) || ar.localeCompare(br) ||
      a.quantity - b.quantity || Number(a.unitPrice) - Number(b.unitPrice);
  });
}
export function planPontyPurchase<T extends PontyLot>(listings: readonly T[], quantity: number, currentRealm: string | undefined, allowPartial: true): T[];
export function planPontyPurchase<T extends PontyLot>(listings: readonly T[], quantity: number, currentRealm?: string, allowPartial?: boolean): T[] | null;
export function planPontyPurchase<T extends PontyLot>(listings: readonly T[], quantity: number, currentRealm?: string, allowPartial = false): T[] | null {
  const ordered = prioritizePontyRealms(listings, currentRealm);
  const exact = selectPontyLots(ordered, quantity);
  if (exact || !allowPartial) return exact;
  const selected: T[] = [];
  let remaining = quantity;
  for (const listing of ordered) if (listing.quantity <= remaining) {
    selected.push(listing);
    remaining -= listing.quantity;
  }
  return selected;
}

// The root's game file reader the item data loader takes as its port.
interface GameFileReader {
  read(path: string): string;
  evaluate(source: string, context: object, filename?: string): unknown;
  warn(details: { error: unknown }, message: string): void;
}
/**
 * The item facts 10 reads from the game data: the deconstruction catalog and the merchant's weapon
 * types. A failed read leaves both empty, so deconstruction and the merchant weapon are refused. The
 * reader is the root's one game file reader.
 */
export function loadCoordinatorItemData(version: string | number, ports: GameFileReader) {
  try {
    const context: { G?: Parameters<typeof buildDeconstructionCatalog>[0] & Parameters<typeof merchantWeaponTypes>[0] } = {};
    ports.evaluate(ports.read("./game_files/" + version + "/data.js"), context);
    return { deconstructionCatalog: buildDeconstructionCatalog(context.G || {}), merchantWeaponTypes: merchantWeaponTypes(context.G || {}) };
  } catch (error) {
    ports.warn({ error }, "Item game data unavailable; deconstruction and the merchant weapon disabled");
    return { deconstructionCatalog: {}, merchantWeaponTypes: [] };
  }
}

// The saved stand bids at start: a bid saved before `useStandSlot` and `acceptHigherLevels` existed
// reads them as off and on (from coordinator/initial-state.ts).
export function initialStandBids<Bid extends object>(settings: { standBids?: Record<string, Bid> | null }) {
  return Object.fromEntries(Object.entries(settings.standBids || {}).map(([id,bid]) =>
    [id,{useStandSlot:false,acceptHigherLevels:true,...bid}]));
}

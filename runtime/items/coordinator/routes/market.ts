// The market routes (3.1 `routes/`): ALData, the marketplace jobs' progress and location, manual
// orders, bids, the blacklist, the native stand, NPC and automatic sales, and stand marks. Each
// parses its request and asks market.ts once.
import type { HttpRouter } from '../../../lifecycle/api.ts';
import type { MarketIgnoredItem } from '../../rules.ts';
import { createALDataActions, createDeconstruction, createIgnoredItemsWrite, createListingRelocation, createMarketplaceProgress, createManualOrderRequests,
  createBidWrite, createBlacklistWrite, createNativeStandAnswers, createNpcSaleRequest, createAutomaticSaleWrites, createStandMarkWrite,
  type ALDataRouteState, type ALDataRoutePorts, type LocationState, type LocationPorts, type PurchaseProgressState,
  type PurchaseProgressPorts, type ManualOrderState, type ManualOrderPorts, type BidWriteState, type BidWritePorts, type BlacklistPorts,
  type MerchantBlock, type NativeAnswerState, type NativeAnswerPorts, type SaleState, type SalePorts, type AutomaticSaleState,
  type AutomaticSalePorts, type StandMarkState, type StandPorts } from '../market.ts';
import { mailPostageAnswer } from '../needs.ts';
import { route, asyncRoute } from './answer.ts';

export function createALDataRoutes(state: ALDataRouteState, ports: ALDataRoutePorts) {
  const aldata = createALDataActions(state, ports);
  return { key: route(aldata.key), market: route(aldata.market), generateKey: route(aldata.generateKey), auth: asyncRoute(aldata.auth),
    sendAuth: route(aldata.sendAuth), refresh: asyncRoute(aldata.refresh) };
}

type MarketState = Parameters<typeof createALDataRoutes>[0] & { nextCommandId: number };
type MarketPorts = Omit<
  Parameters<typeof createALDataRoutes>[1],
  "key" | "nextCommand" | "refresh"
> & {
  randomBytes: (size: number) => { toString: (encoding: "hex") => string };
  refresh: (kind: "all") => Promise<unknown>;
};

/** Account controls share command allocation; the postage is `MAIL_POSTAGE`'s, the one a mail job holds gold for. */
export function createCoordinatorMarketAccountActions(
  state: MarketState,
  ports: MarketPorts,
) {
  const market = createALDataRoutes(state, {
    ...ports,
    key: () => ports.randomBytes(32).toString("hex"),
    nextCommand: () => state.nextCommandId++,
    refresh: () => ports.refresh("all"),
  });
  return { market, postage: route(mailPostageAnswer) };
}

// The ignored market items and the native stand's answers, which the root mounts on its maps router
// through this install as it does installCaveRoutes.
export function installMarketRoutes(router: HttpRouter, state: { marketIgnoredItems: MarketIgnoredItem[] } & NativeAnswerState,
  ports: NativeAnswerPorts): void {
  router.post('/party-api/market/ignored-items', route(createIgnoredItemsWrite(state, ports.write)));
  router.post('/party-api/merchant/native-stand', createNativeStandRoute(state, ports));
}
export function createMarketplaceLocationRoute(state: LocationState, ports: LocationPorts) {
  return asyncRoute(createListingRelocation(state, ports));
}
export function createMarketplaceProgressRoutes(state: PurchaseProgressState, ports: PurchaseProgressPorts) {
  const progress = createMarketplaceProgress(state, ports);
  return { ponty: route(progress.ponty), aldata: route(progress.aldata) };
}
export function createManualMarketOrderRoutes(state: ManualOrderState, ports: ManualOrderPorts) {
  const orders = createManualOrderRequests(state, ports);
  return { stand: route(orders.stand), purchase: route(orders.purchase), sale: route(orders.sale), ponty: route(orders.ponty) };
}
export function createMerchantBidRoute(state: BidWriteState, ports: BidWritePorts) {
  return route(createBidWrite(state, ports));
}
export function createMerchantBlacklistRoute(
  state: { merchantBlacklist: Record<string, MerchantBlock>; autoBlacklistMerchants?: boolean },
  ports: BlacklistPorts,
) {
  return route(createBlacklistWrite(state, ports));
}
export function createNativeStandRoute(state: NativeAnswerState, ports: NativeAnswerPorts) {
  return route(createNativeStandAnswers(state, ports));
}
export function createNpcSaleRoute(state: SaleState, ports: SalePorts) {
  return route(createNpcSaleRequest(state, ports));
}
export function createAutomaticSaleRoutes(state: AutomaticSaleState, ports: AutomaticSalePorts) {
  const sales = createAutomaticSaleWrites(state, ports);
  return { npc: route(sales.npc), stand: route(sales.stand) };
}
export function createStandMarkRoute(state: StandMarkState, ports: StandPorts) {
  return route(createStandMarkWrite(state, ports));
}
// The deconstruction mark, automatic rule and job step routes; reconcile is the area's own call.
export function createDeconstructionRoutes(...[state, ports]: Parameters<typeof createDeconstruction>) {
  const deconstruction = createDeconstruction(state, ports);
  return { reconcile: deconstruction.reconcile, mark: route(deconstruction.mark), automatic: route(deconstruction.automatic),
    step: route(deconstruction.step) };
}

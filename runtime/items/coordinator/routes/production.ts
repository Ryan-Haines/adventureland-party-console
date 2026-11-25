// The production routes (3.1 `routes/`): the merchant's commerce orders and exchanges, its
// production report and the upgrade previews.
import type { HttpRouter } from '../../../lifecycle/api.ts';
import { createCommerceOrders, createExchangeRequests, createUpgradePreviewAnswers, productionReport, type MerchantOrderState,
  type MerchantOrderPorts, type ExchangeState, type ExchangePorts } from '../production.ts';
import { route, asyncRoute } from './answer.ts';

export function createMerchantOrderRoute(state: MerchantOrderState, ports: MerchantOrderPorts) {
  const orders = createCommerceOrders(state, ports);
  return { handle: asyncRoute(orders.handle), restockSupply: orders.restockSupply, restockPending: orders.restockPending };
}
export function createMerchantExchangeRoutes(state: ExchangeState, ports: ExchangePorts) {
  const exchanges = createExchangeRequests(state, ports);
  return { progress: route(exchanges.progress), supply: route(exchanges.supply), order: route(exchanges.order),
    offeringSupply: route(exchanges.offeringSupply) };
}
// The root mounts these on its router.
export function installProductionRoutes(router: HttpRouter, ...report: Parameters<typeof productionReport>): void {
  router.post('/party-api/merchant/production', route(productionReport(...report)));
}
export function createUpgradePreviews(...previews: Parameters<typeof createUpgradePreviewAnswers>) {
  const answers = createUpgradePreviewAnswers(...previews);
  return { install(router: HttpRouter): void {
    router.post('/party-api/upgrade-preview', route(answers.request));
    router.post('/party-api/upgrade-preview/result', route(answers.response));
  } };
}

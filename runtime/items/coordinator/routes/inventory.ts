// The inventory routes: the
// inventory actions, the receipts, the stack merge permission, the stale order clear and the rule
// conflict choice.
import { createAutomaticSaleRoutes, createNpcSaleRoute, createStandMarkRoute, createMerchantBidRoute } from './market.ts';
import { createMerchantHandoffRoutes, createMerchantIdleRoute } from '../../../merchant-jobs/coordinator/api.ts';
import type { ObservedCharacterStatus } from '../../../status/api.ts';
import { createProductionReceipts, type ProductionReceiptState, type ProductionReceiptPorts } from '../production.ts';
import { createBankReceipt, createMergePermission, type BankReceiptState, type BankReceiptPorts, type MergePermissionState,
  type MergePermissionPorts, type MergeStatus } from '../storage.ts';
import { chooseRuleConflict, createStaleMarkClear, replaceAutomaticAction, type AutomaticActionState, type StaleMarkState } from '../fates.ts';
import { route } from './answer.ts';

type InventoryState = AutomaticActionState & Parameters<typeof createAutomaticSaleRoutes>[0] &
  Parameters<typeof createNpcSaleRoute>[0] &
  Parameters<typeof createStandMarkRoute>[0] &
  Parameters<typeof createMerchantHandoffRoutes>[0] &
  Parameters<typeof createInventoryReceiptRoutes>[0] &
  Parameters<typeof createMerchantIdleRoute>[0] &
  Parameters<typeof createMerchantBidRoute>[0] &
  Parameters<typeof createStackMergeRoute>[0] & {
    nextCommandId: number;
    statuses: Record<string, ObservedCharacterStatus | undefined>;
  };
type MergePorts = Parameters<typeof createStackMergeRoute>[1];
type InventoryPorts = Omit<Parameters<typeof createAutomaticSaleRoutes>[1], "reconcile"> &
  Omit<Parameters<typeof createNpcSaleRoute>[1], "nextCommand"> &
  Omit<Parameters<typeof createStandMarkRoute>[1], "nextCommand"> &
  Omit<Parameters<typeof createMerchantHandoffRoutes>[1], "nextCommand"> &
  Parameters<typeof createInventoryReceiptRoutes>[1] &
  Parameters<typeof createMerchantIdleRoute>[1] &
  Parameters<typeof createMerchantBidRoute>[1] &
  Omit<MergePorts, "plan"> & {
    reconcile: (status: InventoryState["statuses"][string]) => void;
    plan: (state: InventoryState, status: MergeStatus) => ReturnType<MergePorts["plan"]>;
  };

/** Inventory requests and receipts share command allocation and always inspect the current merchant report. */
export function createCoordinatorInventoryActions(state: InventoryState, ports: InventoryPorts) {
  const shared = { ...ports, nextCommand: () => state.nextCommandId++ };
  const automatic = createAutomaticSaleRoutes(state, {
    selectAction: (item, name, action, draft) => replaceAutomaticAction(state, name, item, action, draft),
    ...shared,
    reconcile: () => { for (const status of Object.values(state.statuses)) ports.reconcile(status); },
  });
  const npc = createNpcSaleRoute(state, shared);
  const stand = createStandMarkRoute(state, shared);
  const handoff = createMerchantHandoffRoutes(state, shared);
  const receipts = createInventoryReceiptRoutes(state, shared);
  const idle = createMerchantIdleRoute(state, shared);
  const bid = createMerchantBidRoute(state, shared);
  const merge = createStackMergeRoute(state, {
    ...shared,
    plan: items => ports.plan(state, { ...state.statuses[String(state.merchantCharacter)], items }),
  });
  return { automatic, npc, stand, handoff, receipts, idle, bid, merge };
}

export function createInventoryReceiptRoutes(state: ProductionReceiptState & BankReceiptState, ports: ProductionReceiptPorts & BankReceiptPorts) {
  const production = createProductionReceipts(state, ports);
  return { statScrolls: route(production.statScrolls), equipment: route(production.equipment), bank: route(createBankReceipt(state, ports)) };
}
export function createStackMergeRoute(state: MergePermissionState, ports: MergePermissionPorts) {
  return route(createMergePermission(state, ports));
}
export function createStaleOrderRoute(state: StaleMarkState, persist: () => void) {
  return route(createStaleMarkClear(state, persist));
}
export function createRuleConflictRoute(...args: Parameters<typeof chooseRuleConflict>) {
  return route(chooseRuleConflict(...args));
}

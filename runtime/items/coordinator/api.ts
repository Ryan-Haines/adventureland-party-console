// Inventory, bank and commerce's coordinator door:
// the answers other coordinator owners ask of 10.
export { bankCollectionReason, receivePlayerSales, recordClaimBanked } from './fates.ts';
export { entryMeta } from '../catalog-meta.ts';
export type { ItemMetaRecord } from '../catalog-meta.ts';
export type { BankCollectionState, PlayerSaleState, ClaimBanked } from './fates.ts';
export { goldTarget, workingGold, visitWithdrawals, itemNeeds } from './needs.ts';
export type { NeedsState, ItemNeeds } from './needs.ts';
export { bankVisitStalled, createBankSortRoutes, initialBankSort, recordBankReceipts } from './storage.ts';
export type { BankboiInventory, BankSortState } from './storage.ts';
export { loadCoordinatorBankVaults } from './storage.ts';
export { compoundRunnable, craftProtection, createImprovementScheduler, localBankUpgrades, offeringCollectionReady, offeringStock, offeringSupplyReady,
  pendingOfferingCollection, receiveBankUpgrades, sharedCompoundRules, upgradeOfferingReady, upgradeRecoverySignature,
  writeIntents } from './production.ts';
export type { BankImprovementState, BankUpgradeRule, CompoundRule, CraftReservationState, createStatScrollCommands, ExchangeLine,
  OfferingRulesState, ProductionState, StoredUpgradePreview, UpgradeMark } from './production.ts';
// The merchant's NPC sales the job owner reads, blocks and resolves at a completion.
export { readyNpcSales, resolveNpcSales, type NpcSale } from './market.ts';
// The market answers the merchant jobs owner's job owner and the settings owner's saved state read: the marketplace batch, stand sales,
// deconstruction receipts, the automatic sale planner, the stand reconcile and the saved shapes.
export { batchMarketplaceVisits, activeStandSales, receiveBankDeconstruction, receiveDeconstruction, createAutomaticMerchantSales,
  createStandReconciliation, createMerchantItemCommands, createMerchantObservation, initialALDataState, initialStandBids,
  loadCoordinatorItemData } from './market.ts';
export type { DeconstructionCatalog } from '../rules.ts';
export type { DeconstructionMark, DeconstructionState, DeconstructionRules, NativeStandState, NativeStandLedger,
  StandReconciliationState, StandMark, StandBid, PriceHistory, MerchantBlock } from './market.ts';
// 3.1: the saved records' load (saved-fields.ts) and the player's transfer commands (fates.ts).
export { initialBankState, initialCollectionState, initialItemIntents, type ItemIntents } from '../saved-fields.ts';
export { createTransferCommands } from './fates.ts';
// The routes the merchant jobs owner's job owner composes (the manual orders and the marketplace jobs' progress and
// location) and the route shapes the settings owner's saved state reads.
export { createManualMarketOrderRoutes, createMarketplaceProgressRoutes, createMarketplaceLocationRoute } from './routes/market.ts';
export type { createAutomaticSaleRoutes } from './routes/market.ts';
export type { createRestockRoute } from './routes/storage.ts';
// The acting answers the merchant jobs owner's job owner asks of the items owner's installed owner. Each acts in
// the game or ends a job's work, so none has a HOOKS row.
export type RecoverCommand = { id: number; type: 'merchant-production-recover' };
export interface ItemsAnswers {
  startStorage(): Promise<void>;
  recover(): RecoverCommand | null;
  failNpcSales(ids: readonly string[], error: string, code?: unknown): void;
  blockNpcSales(blocked: readonly { id: string; error?: unknown; code?: unknown }[]): void;
}
type Root = { __partyItemsAnswers?: ItemsAnswers };
export function items(): ItemsAnswers {
  const answers = (globalThis as Root).__partyItemsAnswers;
  if (!answers) throw Error('The items owner is not installed in this realm');
  return answers;
}
export function publishItems(answers: ItemsAnswers): void { (globalThis as Root).__partyItemsAnswers = answers; }
export { createInventoryCarry } from './storage.ts';

// What the lifecycle owner's composition root (runtime/coordinator/application.ts) and its contract check
// (initialization.contract-check.ts) compose of this owner.
export { createMailInboxRoutes } from './routes/mail.ts';
export { inventoryMergePlan, createCoordinatorStorageService, createBankboiStorage, createReservedBankboiCargo, queueExchangeStorage, type WithdrawalRequest, type StoredBankboi } from './storage.ts';
export { createUpgradePreviews, installProductionRoutes, createMerchantExchangeRoutes, createMerchantOrderRoute } from './routes/production.ts';
export { installMarketRoutes, createDeconstructionRoutes, createCoordinatorMarketAccountActions, createMerchantBlacklistRoute, createNpcSaleRoute } from './routes/market.ts';
export { planPontyPurchase, normalizeMarketSales, normalizeMarketBids, createCoordinatorMarketFeeds, normalizePontyListings, createCoordinatorPurchases, createManualOrders, type PublicListing } from './market.ts';
export { createCoordinatorAccountCharacterActions, createCoordinatorCharacterCommands } from './routes/characters.ts';
export { createCoordinatorBankActions } from './routes/storage.ts';
export { createStaleOrderRoute, createRuleConflictRoute, createCoordinatorInventoryActions } from './routes/inventory.ts';
export { storageKey, sellerKey } from '../identity.ts';
export { createInventoryReservations, migrateSharedRules } from './fates.ts';
export { restockPolicyOf, restockInventorySatisfied } from './needs.ts';
export { clearCoordinatorResolvedUpgrades, reconcileCoordinatorUpgradeMarks } from './production.ts';
export { createMailJobs } from './mail.ts';

// The coordinator's install with the items owner's add-on reads: `items.data` from the
// merchant catalog, `market.ponty` and `market.listings` from the feeds the Market tabs draw, and the
// facts an item action carries to the character's door: working gold, held cells, Ponty's prices.
import { installItems as installOwner } from './owner.ts';
import { workingGold } from './needs.ts';
import { publishItemData, catalogItemMeta, type ItemDoorFacts } from '../api.ts';
import { partyHooks } from '../../hooks/index.ts';
import { feedRead, type PublicListing } from './market.ts';
type ReadState = { merchantCatalog?: unknown; ponty?: { listings?: readonly PublicListing[] }; aldata?: { marketListings?: readonly PublicListing[] } };
type ReadRoot = { __partyMarketReads?: { ponty(): readonly PublicListing[]; listings(): readonly PublicListing[]; facts(character: string, addon: string): ItemDoorFacts } };
export function installItems(...args: Parameters<typeof installOwner>): ReturnType<typeof installOwner> {
  const owner = installOwner(...args), state = args[0], reads = state as typeof state & ReadState;
  publishItemData(name => catalogItemMeta<{ definition?: object }>(reads.merchantCatalog, name)?.definition);
  (globalThis as ReadRoot).__partyMarketReads = {
    // A job's read needs its feed refreshed (market.ts `feedRead`).
    ponty: () => { feedRead('ponty'); return reads.ponty?.listings ?? []; },
    listings: () => { feedRead('merchants'); return reads.aldata?.marketListings ?? []; },
    // A copy is the add-on's when no fate row above F6 holds it: F7's default, or its own F6 action.
    facts(character, addon) {
      const items = state.statuses[character]?.items;
      const held = (Array.isArray(items) ? items : []).flatMap((raw, index) => {
        const entry = raw as { slot?: number; item?: unknown } | null;
        if (!entry?.item) return [];
        const slot = entry.slot ?? index, fate = partyHooks().ask('items.fate', character, slot);
        return fate && fate.row !== 'F7' && !(fate.row === 'F6' && fate.by === 'addon:' + addon) ? [slot] : [];
      });
      const ponty = Object.fromEntries((reads.ponty?.listings ?? []).flatMap(listing => {
        const rid = (listing.item as { rid?: unknown }).rid;
        return typeof rid === 'string' ? [[rid, listing.price]] : [];
      }));
      return { floor: workingGold(state), held, ponty };
    },
  };
  return owner;
}
function marketReads(): NonNullable<ReadRoot['__partyMarketReads']> {
  const reads = (globalThis as ReadRoot).__partyMarketReads;
  if (!reads) throw Error('The items owner is not installed in this realm');
  return reads;
}
/** `market.ponty`: Ponty's listings as the Ponty tab draws them. */
export const marketPonty = (): readonly PublicListing[] => marketReads().ponty();
/** `market.listings`: the ALData feed's sell offers (`wts`, a seller) or buy orders (`wtb`, a buyer). */
export function marketListings(tab: 'wts' | 'wtb'): readonly PublicListing[] {
  return marketReads().listings().filter(listing => tab === 'wtb' ? listing.buyer !== undefined : listing.buyer === undefined);
}
/** The coordinator's facts for an add-on's item action, which the dispatcher sends beside the
 * ask: the items owner's working gold, the bag slots another fate holds and Ponty's prices by listing id. */
export const itemAskFacts = (character: string, addon: string): ItemDoorFacts => marketReads().facts(character, addon);

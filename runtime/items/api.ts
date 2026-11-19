// Inventory, bank and commerce's door on every runtime: the fate rules both runtimes and the
// dashboard read. It imports no coordinator code, so a character bundle may load it; the
// coordinator's answers are in runtime/items/coordinator/api.ts.
export { ruleOwner, sharedMember, itemRuleConflicts, hasMarkedWithdrawals, automaticNpcRetrieval, freeSlots, bankStagingReserved, stagingCell, luckySlotOf, luckySlotAnswer, type LuckySlotAnswer,
  protectedSlotsOf, fateReachesMerchant } from './rules.ts';
export type { ConflictState, Fate, LuckySlots, SharedRules } from './rules.ts';
export { incompatibleRuleRows } from './rules.ts';
// The bank deconstruction mark the public state carries, which the bank sheet and its banner draw.
export type { DeconstructionMark } from './coordinator/market.ts';
// The failure codes and the merchant-job class each one reaches.
export { failureClass, itemFailure, tripLabel } from './rules.ts';
// The stand count and the listings that use it, which the status owner's core section carries.
export { standSlotUse } from './rules.ts';
// The character's loot pass over the chests a departure may take (character/market.ts `smartLoot`),
// which the hunting owner's loot passes ask. The items owner's character entry installs
// `partyItems` before shared.js and its passes load.
type LootRoot = { partyItems?: { loot: { pass(): Promise<boolean> } } };
export function loot(): Promise<boolean> {
  const items = (globalThis as LootRoot).partyItems;
  if (!items) throw Error('The items owner is not installed on this character');
  return items.loot.pass();
}
// The mark identity the merchant job owner's job owner matches a report's copy against,
// the copy identity targeting's bow swap holds its weapons by, and the bag key its no-bow
// wait ends on.
export { markedItem, markMatches, fingerprint, copyKey, bagKey } from './identity.ts';
// What the dashboard reads of the items owner's rules (the 2.3 and game formula rows): the
// upgrade odds and estimate, the offerings, the lucky slot search, the catalog level, the market
// identity and the listing freshness, so the dashboard keeps no copy.
export { UPGRADE_CHANCES, highestUpgradeLevel, estimateUpgradeBatch, upgradeOfferings, resolveUpgradeOffering, offeringProblem,
  previewOptions, luckySlotSearch, emptyRolls, aggregateSlotTracking, maximumItemLevel, UPGRADE_LEVEL_MAX, ESTIMATE_QUANTILE } from './rules.ts';
export type { UpgradeChoice, UpgradeEstimate, UpgradeOffering, UpgradeOfferingRule, UpgradePreviewResult, LuckySlotTracking,
  LuckySlotHistory, MarketIgnoredItem, MarketItemIdentity, RestockPolicy } from './rules.ts';
export { marketItemKey, ownedStockKey } from './identity.ts';
export { ACQUISITION, marketListingFresh, TRACKER_ITEMS } from './rules.ts';
// The item meta join the coordinator and the dashboard both read a copy's meta through.
export { catalogItemMeta, joinItemMeta } from './catalog-meta.ts';
// The rule keys the dashboard's item tiles look rules up by, and the dismantle rule and its
// result for the deconstruction confirmation, so the dashboard keeps no copy of either.
export { commerceRuleKey, exchangeKey, ruleKey, ruleMode } from './identity.ts';
// The storage pack names and the rule key's parse, so the other owners and the dashboard build and read
// `bankboi:<name>`, `inventory:<name>` and `name@+level` through one copy.
export { bankboiPack, bankboiName, inventoryPack, isBankboiPack, isInventoryPack, ruleKeyParts } from './identity.ts';
export { npcSaleRuleKey, deconstructable, deconstructionRewards, type DeconstructionCatalog } from './rules.ts';
// The exchange result kinds that are item copies, which the dashboard's reward tiles read.
export { exchangeResultIsItem } from './rules.ts';
// The active rules of an item, which the exchange reward and bank banners draw.
export { activeRules, type ActiveRule } from './rules.ts';
// The item value and grade, which the dashboard's NPC, Ponty and scroll prices read.
export { itemValue, pontyPrice, itemGrade, statScrollsNeeded } from './rules.ts';
// The donation XP rate, which the donate dialog's preview reads before a merchant report.
export { donationXpPerGold } from './rules.ts';
// The bid level rule, which the Ponty sheet's "Matches WTB" mark reads.
export { bidAcceptsLevel } from './rules.ts';
// The saved mailbox load, which the status owner's record declaration and the settings owner's
// initial state read.
export { initialMailbox, type SentMailRecord } from './saved-fields.ts';
export { availableCraftStock } from './rules.ts';
// The browser-safe game limits and defaults other owners read from the items owner in place of their own copies.
export { ALDATA_AUTH_MAIL, BASE_INVENTORY_SIZE, COMPOUND_TARGET_MAX, LUCKY_CONFIDENCE, LUCKY_EVIDENCE_ROLLS, MAIL_MESSAGE_MAX, MAIL_SUBJECT_MAX, STACK_SIZE_MAX,
  bagSize, defaultStandPrice, validLuckySlot, vaultAccess, keyHeld, STAGING_FIRST, BANK_PACK_CELLS } from './rules.ts';
export { stackQuantity } from './identity.ts';
export { RESTOCK_DEFAULT, RESTOCK_ELIXIR_DEFAULT } from './saved-fields.ts';
export type { CraftProtection, ElixirPolicy } from './rules.ts';
// The character bag, which targeting's ports hold.
export type { Bag } from './character/owner.ts';

// The items owner's add-on action doors (rows/10-items.ts `ACTIONS`).
// The character's calls.ts installs them; the dispatcher calls one with the add-on's args, the
// band and the coordinator's facts for the ask (`itemAskFacts`), which `itemDoorFacts` reads field
// by field.
import type { ItemDoorFacts } from './character/calls.ts';
import type { Door } from '../hooks/registry.ts';
import { itemGrade as gradeAt } from './rules.ts';
export type { DoorAnswer, DoorBand, ItemDoorFacts, RonListed } from './character/calls.ts';
type DoorRoot = { __partyItemDoors?: typeof import('./character/calls.ts').itemDoors };
function itemDoors() {
  const doors = (globalThis as DoorRoot).__partyItemDoors;
  if (!doors) throw Error('The items owner is not installed on this character');
  return doors;
}
// The facts as the reply carries them, field by field. A field of another shape is left out, so its
// door refuses as it does with no facts.
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
function itemDoorFacts(facts: Readonly<Record<string, unknown>> = {}): ItemDoorFacts {
  const { floor, held, ponty } = facts;
  return { ...finite(floor) ? { floor } : {}, ...Array.isArray(held) && held.every(finite) ? { held } : {},
    ...ponty && typeof ponty === 'object' ? { ponty: Object.fromEntries(Object.entries(ponty).filter(([, price]) => finite(price))) } : {} };
}
const door = (name: import('./character/calls.ts').ItemDoor): Door => (args, ask) => itemDoors().door(name, args, ask.band, itemDoorFacts(ask.facts));
export const wearLook: Door = door('wearLook');
export const donate: Door = door('donate');
export const sendGold: Door = door('sendGold');
export const sendItem: Door = door('sendItem');
export const sendMail: Door = door('sendMail');
export const takeMail: Door = door('takeMail');
export const buy: Door = door('buy');
export const sell: Door = door('sell');
export const exchange: Door = door('exchange');
export const exchangeBuy: Door = door('exchangeBuy');
export const split: Door = door('split');
export const move: Door = door('move');
export const equip: Door = door('equip');
export const unequip: Door = door('unequip');
export const consume: Door = door('consume');
export const dismantle: Door = door('dismantle');
export const destroy: Door = door('destroy');
export const boost: Door = door('boost');
export const upgrade: Door = door('upgrade');
export const compound: Door = door('compound');
export const craft: Door = door('craft');
export const locksmith: Door = door('locksmith');
export const destat: Door = door('destat');
export const list: Door = door('list');
export const wishlist: Door = door('wishlist');
export const tradeBuy: Door = door('tradeBuy');
export const tradeSell: Door = door('tradeSell');
export const tradeSwap: Door = door('tradeSwap');
export const tradeHistory: Door = door('tradeHistory');
export const buySecondhand: Door = door('buySecondhand');
export const lostAndFoundInfo: Door = door('lostAndFoundInfo');
export const lostAndFound: Door = door('lostAndFound');
export const buyLostAndFound: Door = door('buyLostAndFound');
export const openChest: Door = door('openChest');
export const bankRetrieve: Door = door('bankRetrieve');
export const bankStore: Door = door('bankStore');
export const bankSwap: Door = door('bankSwap');
export const bankDeposit: Door = door('bankDeposit');
export const bankWithdraw: Door = door('bankWithdraw');

// The items owner's add-on reads (rows/10-items.ts `READS`). The
// character reads the game's `G`; the coordinator reads what its install publishes
// (coordinator/api.ts `installItems`).
type GameData = { items?: Record<string, object | undefined>; npcs?: Record<string, { items?: readonly (string | null)[] } | undefined> };
type ItemReadRoot = { G?: GameData; __partyItemData?: (name: string) => object | undefined };
/** `items.data`: the game's item definition (`G.items[name]`), or undefined for an unknown name. */
export function itemData(name: string): Readonly<Record<string, unknown>> | undefined {
  const root = globalThis as ItemReadRoot;
  const definition = root.G?.items ? root.G.items[name] : root.__partyItemData?.(name);
  return definition as Readonly<Record<string, unknown>> | undefined;
}
/** `items.grade`: the item's grade at `level` (`itemGrade`), or null for an unknown name. */
export function itemGradeOf(name: string, level: number): number | null {
  const definition = itemData(name);
  return definition ? gradeAt(definition, Number(level) || 0) : null;
}
/** `npc.stock`: the item names the NPC sells (`G.npcs[npc].items`); an empty list for an NPC that sells none. */
export function npcStock(npc: string): readonly string[] {
  // Ron (`lostandfound`) sells what the game last listed after a donation (item.lostAndFound).
  if (npc === 'lostandfound') return lostAndFoundList().map(lot => lot.name);
  const items = (globalThis as ItemReadRoot).G?.npcs?.[npc]?.items;
  return (items ?? []).filter((name): name is string => typeof name === 'string');
}
/** `npc.lostAndFoundList`: Ron's lots from the merchant's last list, each with its rid, level and the
 *  price `npc.lostAndFoundBuy` spends; empty before a donation's list arrives. */
export function lostAndFoundList(): readonly import('./character/calls.ts').RonListed[] {
  return (globalThis as DoorRoot).__partyItemDoors?.lostAndFound() ?? [];
}
/** The coordinator's `items.data` source, from the merchant catalog's per-type meta. */
export function publishItemData(source: (name: string) => object | undefined): void {
  (globalThis as ItemReadRoot).__partyItemData = source;
}
// The rest of the items owner's PLAIN reads (rows/10-items.ts `PLAIN`), so each is a door export an
// add-on reads.
export { deleteWaitMs, standSlots, merchantStandSlots, standSlotsUsed, ruleMembers, processingPending, usableCopy, receiptList, consumeReceipts,
  stackProtected, stackLocations, sameStack, compoundStorageLeftovers, withoutDeliveryStock, mergeSlotStream, slotLogEvidence, isUpgradeOffering,
  offeringRule } from './rules.ts';

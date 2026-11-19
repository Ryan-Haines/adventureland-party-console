// Owner 10's rows of the hook table: items. Only 10's build writes this file;
// runtime/hooks/registry.ts composes every owner's file into one `HOOKS` and one `SLOTS`.
//
// Core-only points (14 0.4's closed list), one per line, with its reason's number where the design names one:
// - I1 F1 runs an operation already decided.
// - I1 F2 is the hands owner's.
// - I1 F3 is the player's own mark.
// - I2 sends gold or items for each need.
// - I3 the spend table to the MP table are the console's record of the game's bank.
// - I3 the reply table to the mover table send game calls.
// - I3 T8 acts on the account.
// - I4 spends paid scrolls and items.
// - I5 M1 is a measured fact.
// - I5 M3 is the seller backoff that protects the merchant's calls.
// - I5 M4 is the call budget's background band.
// - I5 N1 to N4 are game rules and A61.
// - I5 S1 and S2 spend items.
// - I6 sends mail.
// - I7 is the retry contract with 08.
// - I8 reads game data and its picks.
import type { DecisionRow, PlainKind } from './row.ts';
import type { ActionRow, BankLayoutView, DispatchContext, HookRow, ReadRow, ItemActionAnswer, ItemActionAsk, ItemSourceAsk, ItemClaimAsk, ItemClaimView, DispatchRegistration, SlotRow } from '../registry.ts';
import { doorOnly, rowsFor } from './row.ts';

const SPEC = 'e2e/live-items-hooks.spec.ts', UNIT = 'scripts/tests/hook-registry.test.cjs';
const PART = 'items (10)';
const { notice, read } = rowsFor(PART, '');

export const HOOKS = {
  // Part 1: the decision hooks.
  'items.claim': { side: 'coordinator', kind: 'request', part: 'items (10), I1 F4', answers: 'many', addonMayAsk: false,
    bound: 'after every core claim; refused at load when it cannot fit its place',
    fixture: `${SPEC}#items.claim: an add-on claim of 2 stacks of hpot1 keeps them through a bank visit`,
    receives: 'the item view: bag, bank, the place', returns: '{item, quantity, place, reason}' },
  'items.action': { side: 'coordinator', kind: 'request', part: 'items (10), I1 F6', answers: 'many', addonMayAsk: false,
    bound: "only copies with no player mark or claim, so a copy another fate holds stays held; an action naming one of F5's core actions (CF-S10); " +
      "over a core rule's action only when its order places it before that action (P11)",
    fixture: `${SPEC}#items.action: an add-on action takes an unclaimed copy; a claimed copy is not offered`,
    receives: "the copy, its owner and the core rule's action when one holds it", returns: "{action, order?: {before | after: a core action}} or nothing" },
  'items.source': { side: 'coordinator', kind: 'request', part: 'items (10), I5 M2', answers: 'many', addonMayAsk: false,
    bound: 'after the core sources; the gold reserve and the PVP refusal bind it',
    fixture: `${SPEC}#items.source: an add-on source's listing is bought after the core sources`,
    receives: 'the bid', returns: 'listings {key, realm, price, quantity}' },
  'items.bankLayout': { side: 'coordinator', kind: 'request', part: 'items (10), I3 T7', answers: 'one', addonMayAsk: false,
    bound: 'refusal only of a slot outside the floor',
    fixture: `${UNIT}#items.bankLayout: an add-on layout orders a floor; an out-of-floor slot is refused`,
    receives: "the floor's items", returns: 'the slot order' },

  // Part 2: one notice at each change, with its subject and `by` (the player, a core rule's name or
  // `addon:<name>`). coordinator/records.ts sends them.
  'items.fateChanged': notice(`${SPEC}#items.fateChanged: the exchange reward's fate is the merchant's restock claim`, 'subject (the owner), slot, fate, by', 'coordinator'),
  'items.claimShort': notice(`${SPEC}#items.claimShort: a claim larger than the bag holds names its shortfall`, 'subject, item, short, by', 'coordinator'),
  'items.banked': notice(`${SPEC}#items.banked, .withdrawn: a bank visit banks the unclaimed rest`, 'subject, item, quantity, by', 'coordinator'),
  'items.withdrawn': notice(`${SPEC}#items.banked, .withdrawn: a bank visit banks the unclaimed rest`, 'subject, item, quantity, by', 'coordinator'),
  'items.bought': notice(`${SPEC}#items.bought, .sold: a stand purchase and an NPC sale`, 'subject, item, quantity, source, by', 'coordinator'),
  'items.sold': notice(`${SPEC}#items.bought, .sold: a stand purchase and an NPC sale`, 'subject, item, quantity, source, by', 'coordinator'),
  'items.listed': notice(`${SPEC}#items.listed, .unlisted: an offer replaced after its slot empties`, 'subject, item, kind (sale or offer), by', 'coordinator'),
  'items.unlisted': notice(`${SPEC}#items.listed, .unlisted: an offer replaced after its slot empties`, 'subject, item, kind, by', 'coordinator'),
  'items.produced': notice(`${UNIT}#items.produced: an upgrade result is reported once`, 'subject, item, kind, result, by', 'coordinator'),
  'items.exchanged': notice(`${UNIT}#items.exchanged: each reward once across checkpoints`, 'subject, item, by', 'coordinator'),
  'items.dismantled': notice(`scripts/tests/deconstruction.test.cjs#items.dismantled: each result once`, 'subject, item, by', 'coordinator'),
  'items.mailed': notice(`${SPEC}#items.mailed: a mail sent with postage`, 'subject, action (sent, collected or deleted), by', 'coordinator'),
  'items.storage': notice(`scripts/tests/bankboi-recovery.test.cjs#items.storage: a transaction's start and end`, 'subject (the BankBoi), phase (started or ended), by', 'coordinator'),
  'items.bankChanged': notice(`${SPEC}#items.bankChanged: the snapshot changes once per changed report`, 'subject (the bank), by', 'coordinator'),
  'items.orderPaused': notice(`scripts/tests/native-stand.test.cjs#a buy order short of gold is paused once and placed again when gold arrives`, 'subject (the merchant), item, by', 'coordinator'),
  'items.claimRefused': notice(`${UNIT}#items.claimRefused: a claim that cannot fit its place is refused at load`, 'subject (the add-on), item, place, by', 'coordinator'),
  'items.sortLease': notice(`${UNIT}#items.sortLease: a sort lease taken, retried and settled`, 'subject, phase (taken, retry or settled), code on a retry, by', 'coordinator'),
  'items.bankboi': notice(`scripts/tests/coordinator-bankboi-routes.test.cjs#items.bankboi: a BankBoi created and deleted`, 'subject (the BankBoi), phase (created or deleted), by', 'coordinator'),
  'items.saleBlocked': notice(`${UNIT}#items.saleBlocked: a failed sale blocks and lifts at the bag change`, 'subject, item, phase (blocked or lifted), code, by', 'coordinator'),
  'items.intent': notice(`${UNIT}#items.intent: an intent written and ended once each`, 'subject, slot, phase (written or ended), by', 'coordinator'),

  // Part 3: the published reads, `addonMayAsk` by X-C8.
  'items.stock': read(`${SPEC}#items.stock: the stock read leaves out claimed copies`, 'character, item', 'the copies it may use, claims kept (C50)', true, 'coordinator'),
  'items.claimPending': read(`${UNIT}#items.claimPending: a stored copy an all claim names is fetched`, 'character, claimer', "the stored copies 10 still fetches for the claimer's claims at the character (G01)", true, 'coordinator'),
  'items.needs': read(`${SPEC}#items.needs: a job's needs name gold and withdrawals`, 'the job', '{gold, withdrawals, slots, postage, blockedBy?} (C59)', true, 'coordinator'),
  'items.fate': read(`${SPEC}#items.fate: the fate read names its row and by`, 'character, slot or mark', "the copy's fate, its I1 row and by", true, 'coordinator'),
  'items.freeSlots': read(`${SPEC}#items.freeSlots: the lucky slot's hold is counted`, 'character', "free bag cells past the lucky slot's hold and the protected free slots", true, 'coordinator'),
  'items.luckySlot': read(`${UNIT}#items.luckySlot: lock, resume, verified, tracker`, 'character', 'the lucky slot (P8), or null', true, 'coordinator'),
  'items.fetch': read(`${UNIT}#items.fetch: a missing item withdrawn or not found`, 'character, item', 'withdrawn or not found (C83)', false, 'character'),
  'items.bank': read(`${SPEC}#items.bank: the snapshot read`, 'nothing', 'the bank snapshot', true, 'coordinator'),
  'items.storagePending': read(`${UNIT}#items.storagePending: a pending BankBoi transfer is named`, 'character', 'whether storage work waits for it', true, 'coordinator'),
  'items.productionPending': read(`${UNIT}#items.productionPending: a pending intent is named`, 'character', 'whether production work waits for it', true, 'coordinator'),
  'items.bag': read(`${UNIT}#items.bag: the bag facts of the holder record`, 'character', "the bag holder's facts (3.4)", true, 'character'),
  'items.standSlots': read(`${UNIT}#items.standSlots: the stand's cells and the listings that use them`, 'merchant', '{slots, used, free} from the one count (E10-12, A79)', true, 'coordinator'),
} as const satisfies Record<string, HookRow>;

// C1 (addon-capabilities.md "The table by owner"): the game actions 10 offers an add-on, one per
// game function, each through its door in runtime/items/api.ts, and the calls it closes. An event
// that several functions send sits on the first of their rows. The coordinator's facts
// (items/coordinator/api.ts `itemAskFacts`) ride beside each ask; a door that names a filled bag
// cell or spends gold refuses an ask without them.
export const ACTIONS = {
  'item.wearLook': { events: ['cx'], functions: ['equip_cx'], door: 'wearLook', args: '{slot, name?}',
    bound: "a look in character.acx (server.js:5331 cx_not_found); an empty name takes the slot's look off" },
  'gold.donate': { events: ['donate'], functions: ['donate_gold'], door: 'donate', args: '{gold}',
    bound: "gold above 10's working gold" },
  'gold.send': { events: ['send'], functions: ['send_gold'], door: 'sendGold', args: '{to, gold}',
    bound: "gold above 10's working gold; any recipient (decisions.md: the player's choice)" },
  'item.send': { events: [], functions: ['send_item'], door: 'sendItem', args: '{to, slot, quantity?}',
    bound: "10's fates (items/rules.ts fateOf): a bag copy no fate row above F6 holds; any recipient" },
  'mail.send': { events: ['mail'], functions: ['send_mail'], door: 'sendMail', args: '{to, subject, message?, item?}',
    bound: "the postage (MAIL_POSTAGE) above 10's working gold; an attached first bag cell passes 10's fates; any recipient" },
  'mail.take': { events: ['mail_take_item'], functions: [], door: 'takeMail', args: '{id}',
    bound: "the game's own refusals (a full bag, a taken item)" },
  'item.buyFromNpc': { events: ['buy'], functions: ['buy'], door: 'buy', args: '{name, quantity?}',
    bound: "the NPC price (G.items[name].g) above 10's working gold" },
  'item.sell': { events: ['sell'], functions: ['sell'], door: 'sell', args: '{slot, quantity?}',
    bound: "10's fates (items/rules.ts fateOf): a bag copy no fate row above F6 holds" },
  'item.exchange': { events: ['exchange'], functions: ['exchange'], door: 'exchange', args: '{slot}',
    bound: "10's fates (items/rules.ts fateOf): a bag copy no fate row above F6 holds" },
  'item.exchangeBuy': { events: ['exchange_buy'], functions: [], door: 'exchangeBuy', args: '{slot, name, quantity?}',
    bound: "10's fates (items/rules.ts fateOf): a bag copy no fate row above F6 holds" },
  'item.split': { events: ['split'], functions: ['split'], door: 'split', args: '{slot, quantity}',
    bound: "10's fates (items/rules.ts fateOf): a bag copy no fate row above F6 holds" },
  'item.move': { events: ['imove'], functions: ['swap'], door: 'move', args: '{from, to}',
    bound: "10's fates (items/rules.ts fateOf): a bag copy no fate row above F6 holds, for both cells" },
  // 09 owns the game's equip and unequip (rows/09-calls.ts ACTIONS hands); these doors send through it.
  'item.equip': { events: ['equip', 'equip_batch'], functions: [], door: 'equip', args: '{slot, slotName?}',
    bound: "10's fates (items/rules.ts fateOf): a bag copy no fate row above F6 holds" },
  'item.unequip': { events: ['unequip'], functions: [], door: 'unequip', args: '{slot}',
    bound: "the game's own refusals (a full bag)" },
  'item.consume': { events: [], functions: ['consume'], door: 'consume', args: '{slot}',
    bound: "10's fates (items/rules.ts fateOf): a bag copy no fate row above F6 holds" },
  'item.dismantle': { events: ['dismantle'], functions: ['dismantle'], door: 'dismantle', args: '{slot}',
    bound: "10's fates (items/rules.ts fateOf): a bag copy no fate row above F6 holds" },
  'item.destroy': { events: ['destroy'], functions: [], door: 'destroy', args: '{slot, quantity?}',
    bound: "10's fates (items/rules.ts fateOf): a bag copy no fate row above F6 holds" },
  // Mass Production, cast before an upgrade or compound (production.ts `massProduction`).
  'skill.massProduction': { events: [], functions: ['use_skill:massproduction', 'use_skill:massproductionpp'], closed: 'FW',
    cite: "runtime/items/character/production.ts: 10's production casts it for its own next operation" },
  'item.boost': { events: ['booster'], functions: ['activate'], door: 'boost', args: '{slot}',
    bound: "10's fates (items/rules.ts fateOf): a bag copy no fate row above F6 holds" },
  'item.upgrade': { events: ['upgrade'], functions: ['upgrade'], door: 'upgrade', args: '{slot, scroll, offering?}',
    bound: "10's fates (items/rules.ts fateOf): a bag copy no fate row above F6 holds, for the item, the scroll and the offering" },
  'item.compound': { events: ['compound'], functions: ['compound'], door: 'compound', args: '{slots: [a, b, c], scroll, offering?}',
    bound: "10's fates (items/rules.ts fateOf): a bag copy no fate row above F6 holds, for every copy" },
  'item.craft': { events: ['craft'], functions: ['auto_craft'], door: 'craft', args: '{name}',
    bound: "no ingredient a fate holds (auto_craft picks the copies); the recipe's cost above 10's working gold" },
  'item.locksmith': { events: ['locksmith'], functions: [], door: 'locksmith', args: '{slot, operation: lock | seal | unlock}',
    bound: "10's fates (items/rules.ts fateOf): a bag copy no fate row above F6 holds; the 250,000 fee (server.js:6735) above 10's working gold" },
  'item.destat': { events: ['destat'], functions: [], door: 'destat', args: '{slot}',
    bound: "10's fates (items/rules.ts fateOf): a bag copy no fate row above F6 holds; the scrollsmith fee (server.js:6712) above 10's working gold" },
  'item.list': { events: ['trade'], functions: ['trade'], door: 'list', args: '{slot, tradeSlot, price, quantity?}',
    bound: "10's fates (items/rules.ts fateOf): a bag copy no fate row above F6 holds" },
  'item.wishlist': { events: ['trade_wishlist'], functions: ['wishlist'], door: 'wishlist', args: '{tradeSlot, name, price, level?, quantity?}',
    bound: "price times quantity above 10's working gold" },
  'item.buyFromPlayer': { events: ['trade_buy'], functions: ['trade_buy'], door: 'tradeBuy', args: '{seller, slot, quantity?}',
    bound: "a nearby seller's listing; its price above 10's working gold" },
  'item.sellToPlayer': { events: ['trade_sell'], functions: ['trade_sell'], door: 'tradeSell', args: '{buyer, slot, quantity?}',
    bound: 'a nearby buy order; no held copy carries its name (the game picks the copy)' },
  'item.swapToPlayer': { events: ['trade_swap'], functions: [], door: 'tradeSwap', args: '{buyer, slot, num}',
    bound: "a nearby buy order; 10's fates (items/rules.ts fateOf): a bag copy no fate row above F6 holds" },
  'market.tradeHistory': { events: ['trade_history'], functions: [], door: 'tradeHistory', args: '{}',
    bound: "the call budget's background band" },
  'market.pontyBuy': { events: ['sbuy'], functions: ['buy_secondhand'], door: 'buySecondhand', args: '{rid}',
    bound: "a Ponty listing the coordinator's feed prices; that price above 10's working gold" },
  'npc.lostAndFoundInfo': { events: [], functions: [], door: 'lostAndFoundInfo', args: '{}',
    bound: "the call budget's background band" },
  'npc.lostAndFound': { events: ['lostandfound'], functions: [], door: 'lostAndFound', args: '{}',
    bound: "the game's donation check (server.js lostandfound_donate); npc.lostAndFoundList reads the list" },
  // The game's `sbuy` with `f: true`; its event sits on market.pontyBuy's row.
  'npc.lostAndFoundBuy': { events: [], functions: ['buy_lost_and_found'], door: 'buyLostAndFound', args: '{rid}',
    bound: "a lot on Ron's last list (npc.lostAndFoundList); the price that list shows above 10's working gold" },
  'item.openChest': { events: ['open_chest'], functions: ['loot'], door: 'openChest', args: '{chest}',
    bound: "the game's own refusals (G56 LOOT_REASONS)" },
  'bank.retrieve': { events: ['bank'], functions: ['bank_retrieve'], door: 'bankRetrieve', args: '{pack, slot, to?}',
    bound: "the game's own refusals (in the bank, a free cell)" },
  'bank.store': { events: [], functions: ['bank_store'], door: 'bankStore', args: '{slot, pack, to?}',
    bound: "10's fates (items/rules.ts fateOf): a bag copy no fate row above F6 holds" },
  'bank.swap': { events: [], functions: ['bank_swap'], door: 'bankSwap', args: '{pack, from, to}',
    bound: "the game's own refusals" },
  'bank.deposit': { events: [], functions: ['bank_deposit'], door: 'bankDeposit', args: '{gold}',
    bound: "gold above 10's working gold" },
  'bank.withdraw': { events: [], functions: ['bank_withdraw'], door: 'bankWithdraw', args: '{gold}',
    bound: "the game's own refusals" },
  'market.pontyList': { events: ['secondhands'], functions: ['get_secondhands'], closed: 'CL',
    cite: 'call-budget.ts:244 prices it at 16 calls; market.ponty reads the cached list' },
  'bank.unlock': { events: ['unlock'], functions: ['open_bank_pack'], closed: 'FW',
    cite: "slot-coverage.md D13: a bank floor unlock is a confirmation step; the game's open_bank_pack buys one with gold" },
  // 10's stand call (items/character/calls.ts `openStand`, `closeStand`) sends the stand; 08's stand
  // holder decides when, so an add-on opens or closes it through 08's stand.open and stand.close.
  'stand.call': { events: ['merchant'], functions: ['open_stand', 'close_stand'], closed: 'FW',
    cite: "rows/08-merchant.ts ACTIONS stand.open and stand.close, 08's stand holder" },
} as const satisfies Record<string, ActionRow>;

// C3: the items owner's add-on reads beside its hook reads. The character reads the game's G; the coordinator
// reads the merchant catalog and the market feeds its install publishes.
export const READS = {
  'items.grade': { side: 'both', type: 'number | null', door: 'runtime/items/api.ts#itemGradeOf' },
  'items.data': { side: 'both', type: 'Readonly<Record<string, unknown>> | undefined', door: 'runtime/items/api.ts#itemData' },
  'npc.stock': { side: 'character', type: 'readonly string[]', door: 'runtime/items/api.ts#npcStock' },
  'npc.lostAndFoundList': { side: 'character', type: 'readonly RonListed[]', door: 'runtime/items/api.ts#lostAndFoundList' },
  'market.ponty': { side: 'coordinator', type: 'readonly PublicListing[]', door: 'runtime/items/coordinator/api.ts#marketPonty' },
  'market.listings': { side: 'coordinator', type: 'readonly PublicListing[]', door: 'runtime/items/coordinator/api.ts#marketListings' },
  // C3's completeness rule: every other door export that reads, by the export's own type. The
  // table is made from the door exports by kind (a function of state or rules, a constant).
  'door.items.ruleOwner': { side: 'both', type: 'typeof ruleOwner', door: 'runtime/items/api.ts#ruleOwner' },
  'door.items.sharedMember': { side: 'both', type: 'typeof sharedMember', door: 'runtime/items/api.ts#sharedMember' },
  'door.items.itemRuleConflicts': { side: 'both', type: 'typeof itemRuleConflicts', door: 'runtime/items/api.ts#itemRuleConflicts' },
  'door.items.hasMarkedWithdrawals': { side: 'both', type: 'typeof hasMarkedWithdrawals', door: 'runtime/items/api.ts#hasMarkedWithdrawals' },
  'door.items.automaticNpcRetrieval': { side: 'both', type: 'typeof automaticNpcRetrieval', door: 'runtime/items/api.ts#automaticNpcRetrieval' },
  'door.items.freeSlots': { side: 'both', type: 'typeof freeSlots', door: 'runtime/items/api.ts#freeSlots' },
  'door.items.bankStagingReserved': { side: 'both', type: 'typeof bankStagingReserved', door: 'runtime/items/api.ts#bankStagingReserved' },
  'door.items.stagingCell': { side: 'both', type: 'typeof stagingCell', door: 'runtime/items/api.ts#stagingCell' },
  'door.items.luckySlotOf': { side: 'both', type: 'typeof luckySlotOf', door: 'runtime/items/api.ts#luckySlotOf' },
  'door.items.luckySlotAnswer': { side: 'both', type: 'typeof luckySlotAnswer', door: 'runtime/items/api.ts#luckySlotAnswer' },
  'door.items.protectedSlotsOf': { side: 'both', type: 'typeof protectedSlotsOf', door: 'runtime/items/api.ts#protectedSlotsOf' },
  'door.items.fateReachesMerchant': { side: 'both', type: 'typeof fateReachesMerchant', door: 'runtime/items/api.ts#fateReachesMerchant' },
  'door.items.incompatibleRuleRows': { side: 'both', type: 'typeof incompatibleRuleRows', door: 'runtime/items/api.ts#incompatibleRuleRows' },
  'door.items.failureClass': { side: 'both', type: 'typeof failureClass', door: 'runtime/items/api.ts#failureClass' },
  'door.items.itemFailure': { side: 'both', type: 'typeof itemFailure', door: 'runtime/items/api.ts#itemFailure' },
  'door.items.tripLabel': { side: 'both', type: 'typeof tripLabel', door: 'runtime/items/api.ts#tripLabel' },
  'door.items.standSlotUse': { side: 'both', type: 'typeof standSlotUse', door: 'runtime/items/api.ts#standSlotUse' },
  'door.items.markedItem': { side: 'both', type: 'typeof markedItem', door: 'runtime/items/api.ts#markedItem' },
  'door.items.markMatches': { side: 'both', type: 'typeof markMatches', door: 'runtime/items/api.ts#markMatches' },
  'door.items.fingerprint': { side: 'both', type: 'typeof fingerprint', door: 'runtime/items/api.ts#fingerprint' },
  'door.items.copyKey': { side: 'both', type: 'typeof copyKey', door: 'runtime/items/api.ts#copyKey' },
  'door.items.bagKey': { side: 'both', type: 'typeof bagKey', door: 'runtime/items/api.ts#bagKey' },
  'door.items.UPGRADE_CHANCES': { side: 'both', type: 'typeof UPGRADE_CHANCES', door: 'runtime/items/api.ts#UPGRADE_CHANCES' },
  'door.items.highestUpgradeLevel': { side: 'both', type: 'typeof highestUpgradeLevel', door: 'runtime/items/api.ts#highestUpgradeLevel' },
  'door.items.estimateUpgradeBatch': { side: 'both', type: 'typeof estimateUpgradeBatch', door: 'runtime/items/api.ts#estimateUpgradeBatch' },
  'door.items.upgradeOfferings': { side: 'both', type: 'typeof upgradeOfferings', door: 'runtime/items/api.ts#upgradeOfferings' },
  'door.items.resolveUpgradeOffering': { side: 'both', type: 'typeof resolveUpgradeOffering', door: 'runtime/items/api.ts#resolveUpgradeOffering' },
  'door.items.offeringProblem': { side: 'both', type: 'typeof offeringProblem', door: 'runtime/items/api.ts#offeringProblem' },
  'door.items.previewOptions': { side: 'both', type: 'typeof previewOptions', door: 'runtime/items/api.ts#previewOptions' },
  'door.items.luckySlotSearch': { side: 'both', type: 'typeof luckySlotSearch', door: 'runtime/items/api.ts#luckySlotSearch' },
  'door.items.emptyRolls': { side: 'both', type: 'typeof emptyRolls', door: 'runtime/items/api.ts#emptyRolls' },
  'door.items.aggregateSlotTracking': { side: 'both', type: 'typeof aggregateSlotTracking', door: 'runtime/items/api.ts#aggregateSlotTracking' },
  'door.items.maximumItemLevel': { side: 'both', type: 'typeof maximumItemLevel', door: 'runtime/items/api.ts#maximumItemLevel' },
  'door.items.UPGRADE_LEVEL_MAX': { side: 'both', type: 'typeof UPGRADE_LEVEL_MAX', door: 'runtime/items/api.ts#UPGRADE_LEVEL_MAX' },
  'door.items.ESTIMATE_QUANTILE': { side: 'both', type: 'typeof ESTIMATE_QUANTILE', door: 'runtime/items/api.ts#ESTIMATE_QUANTILE' },
  'door.items.marketItemKey': { side: 'both', type: 'typeof marketItemKey', door: 'runtime/items/api.ts#marketItemKey' },
  'door.items.ownedStockKey': { side: 'both', type: 'typeof ownedStockKey', door: 'runtime/items/api.ts#ownedStockKey' },
  'door.items.ACQUISITION': { side: 'both', type: 'typeof ACQUISITION', door: 'runtime/items/api.ts#ACQUISITION' },
  'door.items.marketListingFresh': { side: 'both', type: 'typeof marketListingFresh', door: 'runtime/items/api.ts#marketListingFresh' },
  'door.items.TRACKER_ITEMS': { side: 'both', type: 'typeof TRACKER_ITEMS', door: 'runtime/items/api.ts#TRACKER_ITEMS' },
  'door.items.catalogItemMeta': { side: 'both', type: 'typeof catalogItemMeta', door: 'runtime/items/api.ts#catalogItemMeta' },
  'door.items.joinItemMeta': { side: 'both', type: 'typeof joinItemMeta', door: 'runtime/items/api.ts#joinItemMeta' },
  'door.items.commerceRuleKey': { side: 'both', type: 'typeof commerceRuleKey', door: 'runtime/items/api.ts#commerceRuleKey' },
  'door.items.exchangeKey': { side: 'both', type: 'typeof exchangeKey', door: 'runtime/items/api.ts#exchangeKey' },
  'door.items.ruleKey': { side: 'both', type: 'typeof ruleKey', door: 'runtime/items/api.ts#ruleKey' },
  'door.items.ruleMode': { side: 'both', type: 'typeof ruleMode', door: 'runtime/items/api.ts#ruleMode' },
  'door.items.bankboiPack': { side: 'both', type: 'typeof bankboiPack', door: 'runtime/items/api.ts#bankboiPack' },
  'door.items.bankboiName': { side: 'both', type: 'typeof bankboiName', door: 'runtime/items/api.ts#bankboiName' },
  'door.items.inventoryPack': { side: 'both', type: 'typeof inventoryPack', door: 'runtime/items/api.ts#inventoryPack' },
  'door.items.isBankboiPack': { side: 'both', type: 'typeof isBankboiPack', door: 'runtime/items/api.ts#isBankboiPack' },
  'door.items.isInventoryPack': { side: 'both', type: 'typeof isInventoryPack', door: 'runtime/items/api.ts#isInventoryPack' },
  'door.items.ruleKeyParts': { side: 'both', type: 'typeof ruleKeyParts', door: 'runtime/items/api.ts#ruleKeyParts' },
  'door.items.npcSaleRuleKey': { side: 'both', type: 'typeof npcSaleRuleKey', door: 'runtime/items/api.ts#npcSaleRuleKey' },
  'door.items.deconstructable': { side: 'both', type: 'typeof deconstructable', door: 'runtime/items/api.ts#deconstructable' },
  'door.items.deconstructionRewards': { side: 'both', type: 'typeof deconstructionRewards', door: 'runtime/items/api.ts#deconstructionRewards' },
  'door.items.exchangeResultIsItem': { side: 'both', type: 'typeof exchangeResultIsItem', door: 'runtime/items/api.ts#exchangeResultIsItem' },
  'door.items.activeRules': { side: 'both', type: 'typeof activeRules', door: 'runtime/items/api.ts#activeRules' },
  'door.items.itemValue': { side: 'both', type: 'typeof itemValue', door: 'runtime/items/api.ts#itemValue' },
  'door.items.pontyPrice': { side: 'both', type: 'typeof pontyPrice', door: 'runtime/items/api.ts#pontyPrice' },
  'door.items.itemGrade': { side: 'both', type: 'typeof itemGrade', door: 'runtime/items/api.ts#itemGrade' },
  'door.items.statScrollsNeeded': { side: 'both', type: 'typeof statScrollsNeeded', door: 'runtime/items/api.ts#statScrollsNeeded' },
  'door.items.donationXpPerGold': { side: 'both', type: 'typeof donationXpPerGold', door: 'runtime/items/api.ts#donationXpPerGold' },
  'door.items.bidAcceptsLevel': { side: 'both', type: 'typeof bidAcceptsLevel', door: 'runtime/items/api.ts#bidAcceptsLevel' },
  'door.items.availableCraftStock': { side: 'both', type: 'typeof availableCraftStock', door: 'runtime/items/api.ts#availableCraftStock' },
  'door.items.ALDATA_AUTH_MAIL': { side: 'both', type: 'typeof ALDATA_AUTH_MAIL', door: 'runtime/items/api.ts#ALDATA_AUTH_MAIL' },
  'door.items.BASE_INVENTORY_SIZE': { side: 'both', type: 'typeof BASE_INVENTORY_SIZE', door: 'runtime/items/api.ts#BASE_INVENTORY_SIZE' },
  'door.items.COMPOUND_TARGET_MAX': { side: 'both', type: 'typeof COMPOUND_TARGET_MAX', door: 'runtime/items/api.ts#COMPOUND_TARGET_MAX' },
  'door.items.LUCKY_CONFIDENCE': { side: 'both', type: 'typeof LUCKY_CONFIDENCE', door: 'runtime/items/api.ts#LUCKY_CONFIDENCE' },
  'door.items.LUCKY_EVIDENCE_ROLLS': { side: 'both', type: 'typeof LUCKY_EVIDENCE_ROLLS', door: 'runtime/items/api.ts#LUCKY_EVIDENCE_ROLLS' },
  'door.items.MAIL_MESSAGE_MAX': { side: 'both', type: 'typeof MAIL_MESSAGE_MAX', door: 'runtime/items/api.ts#MAIL_MESSAGE_MAX' },
  'door.items.MAIL_SUBJECT_MAX': { side: 'both', type: 'typeof MAIL_SUBJECT_MAX', door: 'runtime/items/api.ts#MAIL_SUBJECT_MAX' },
  'door.items.STACK_SIZE_MAX': { side: 'both', type: 'typeof STACK_SIZE_MAX', door: 'runtime/items/api.ts#STACK_SIZE_MAX' },
  'door.items.bagSize': { side: 'both', type: 'typeof bagSize', door: 'runtime/items/api.ts#bagSize' },
  'door.items.defaultStandPrice': { side: 'both', type: 'typeof defaultStandPrice', door: 'runtime/items/api.ts#defaultStandPrice' },
  'door.items.validLuckySlot': { side: 'both', type: 'typeof validLuckySlot', door: 'runtime/items/api.ts#validLuckySlot' },
  'door.items.vaultAccess': { side: 'both', type: 'typeof vaultAccess', door: 'runtime/items/api.ts#vaultAccess' },
  'door.items.keyHeld': { side: 'both', type: 'typeof keyHeld', door: 'runtime/items/api.ts#keyHeld' },
  'door.items.STAGING_FIRST': { side: 'both', type: 'typeof STAGING_FIRST', door: 'runtime/items/api.ts#STAGING_FIRST' },
  'door.items.BANK_PACK_CELLS': { side: 'both', type: 'typeof BANK_PACK_CELLS', door: 'runtime/items/api.ts#BANK_PACK_CELLS' },
  'door.items.stackQuantity': { side: 'both', type: 'typeof stackQuantity', door: 'runtime/items/api.ts#stackQuantity' },
  'door.items.RESTOCK_DEFAULT': { side: 'both', type: 'typeof RESTOCK_DEFAULT', door: 'runtime/items/api.ts#RESTOCK_DEFAULT' },
  'door.items.RESTOCK_ELIXIR_DEFAULT': { side: 'both', type: 'typeof RESTOCK_ELIXIR_DEFAULT', door: 'runtime/items/api.ts#RESTOCK_ELIXIR_DEFAULT' },
  'door.items.deleteWaitMs': { side: 'both', type: 'typeof deleteWaitMs', door: 'runtime/items/api.ts#deleteWaitMs' },
  'door.items.standSlots': { side: 'both', type: 'typeof standSlots', door: 'runtime/items/api.ts#standSlots' },
  'door.items.merchantStandSlots': { side: 'both', type: 'typeof merchantStandSlots', door: 'runtime/items/api.ts#merchantStandSlots' },
  'door.items.standSlotsUsed': { side: 'both', type: 'typeof standSlotsUsed', door: 'runtime/items/api.ts#standSlotsUsed' },
  'door.items.ruleMembers': { side: 'both', type: 'typeof ruleMembers', door: 'runtime/items/api.ts#ruleMembers' },
  'door.items.processingPending': { side: 'both', type: 'typeof processingPending', door: 'runtime/items/api.ts#processingPending' },
  'door.items.usableCopy': { side: 'both', type: 'typeof usableCopy', door: 'runtime/items/api.ts#usableCopy' },
  'door.items.receiptList': { side: 'both', type: 'typeof receiptList', door: 'runtime/items/api.ts#receiptList' },
  'door.items.consumeReceipts': { side: 'both', type: 'typeof consumeReceipts', door: 'runtime/items/api.ts#consumeReceipts' },
  'door.items.stackProtected': { side: 'both', type: 'typeof stackProtected', door: 'runtime/items/api.ts#stackProtected' },
  'door.items.stackLocations': { side: 'both', type: 'typeof stackLocations', door: 'runtime/items/api.ts#stackLocations' },
  'door.items.sameStack': { side: 'both', type: 'typeof sameStack', door: 'runtime/items/api.ts#sameStack' },
  'door.items.compoundStorageLeftovers': { side: 'both', type: 'typeof compoundStorageLeftovers', door: 'runtime/items/api.ts#compoundStorageLeftovers' },
  'door.items.withoutDeliveryStock': { side: 'both', type: 'typeof withoutDeliveryStock', door: 'runtime/items/api.ts#withoutDeliveryStock' },
  'door.items.mergeSlotStream': { side: 'both', type: 'typeof mergeSlotStream', door: 'runtime/items/api.ts#mergeSlotStream' },
  'door.items.slotLogEvidence': { side: 'both', type: 'typeof slotLogEvidence', door: 'runtime/items/api.ts#slotLogEvidence' },
  'door.items.isUpgradeOffering': { side: 'both', type: 'typeof isUpgradeOffering', door: 'runtime/items/api.ts#isUpgradeOffering' },
  'door.items.offeringRule': { side: 'both', type: 'typeof offeringRule', door: 'runtime/items/api.ts#offeringRule' },
  'door.items.bankCollectionReason': { side: 'coordinator', type: 'typeof bankCollectionReason', door: 'runtime/items/coordinator/api.ts#bankCollectionReason' },
  'door.items.entryMeta': { side: 'coordinator', type: 'typeof entryMeta', door: 'runtime/items/coordinator/api.ts#entryMeta' },
  'door.items.goldTarget': { side: 'coordinator', type: 'typeof goldTarget', door: 'runtime/items/coordinator/api.ts#goldTarget' },
  'door.items.workingGold': { side: 'coordinator', type: 'typeof workingGold', door: 'runtime/items/coordinator/api.ts#workingGold' },
  'door.items.visitWithdrawals': { side: 'coordinator', type: 'typeof visitWithdrawals', door: 'runtime/items/coordinator/api.ts#visitWithdrawals' },
  'door.items.itemNeeds': { side: 'coordinator', type: 'typeof itemNeeds', door: 'runtime/items/coordinator/api.ts#itemNeeds' },
  'door.items.bankVisitStalled': { side: 'coordinator', type: 'typeof bankVisitStalled', door: 'runtime/items/coordinator/api.ts#bankVisitStalled' },
  'door.items.compoundRunnable': { side: 'coordinator', type: 'typeof compoundRunnable', door: 'runtime/items/coordinator/api.ts#compoundRunnable' },
  'door.items.craftProtection': { side: 'coordinator', type: 'typeof craftProtection', door: 'runtime/items/coordinator/api.ts#craftProtection' },
  'door.items.localBankUpgrades': { side: 'coordinator', type: 'typeof localBankUpgrades', door: 'runtime/items/coordinator/api.ts#localBankUpgrades' },
  'door.items.offeringCollectionReady': { side: 'coordinator', type: 'typeof offeringCollectionReady', door: 'runtime/items/coordinator/api.ts#offeringCollectionReady' },
  'door.items.offeringStock': { side: 'coordinator', type: 'typeof offeringStock', door: 'runtime/items/coordinator/api.ts#offeringStock' },
  'door.items.offeringSupplyReady': { side: 'coordinator', type: 'typeof offeringSupplyReady', door: 'runtime/items/coordinator/api.ts#offeringSupplyReady' },
  'door.items.pendingOfferingCollection': { side: 'coordinator', type: 'typeof pendingOfferingCollection', door: 'runtime/items/coordinator/api.ts#pendingOfferingCollection' },
  'door.items.sharedCompoundRules': { side: 'coordinator', type: 'typeof sharedCompoundRules', door: 'runtime/items/coordinator/api.ts#sharedCompoundRules' },
  'door.items.upgradeOfferingReady': { side: 'coordinator', type: 'typeof upgradeOfferingReady', door: 'runtime/items/coordinator/api.ts#upgradeOfferingReady' },
  'door.items.upgradeRecoverySignature': { side: 'coordinator', type: 'typeof upgradeRecoverySignature', door: 'runtime/items/coordinator/api.ts#upgradeRecoverySignature' },
  'door.items.readyNpcSales': { side: 'coordinator', type: 'typeof readyNpcSales', door: 'runtime/items/coordinator/api.ts#readyNpcSales' },
  'door.items.resolveNpcSales': { side: 'coordinator', type: 'typeof resolveNpcSales', door: 'runtime/items/coordinator/api.ts#resolveNpcSales' },
  'door.items.batchMarketplaceVisits': { side: 'coordinator', type: 'typeof batchMarketplaceVisits', door: 'runtime/items/coordinator/api.ts#batchMarketplaceVisits' },
  'door.items.activeStandSales': { side: 'coordinator', type: 'typeof activeStandSales', door: 'runtime/items/coordinator/api.ts#activeStandSales' },
  'door.items.inventoryMergePlan': { side: 'coordinator', type: 'typeof inventoryMergePlan', door: 'runtime/items/coordinator/api.ts#inventoryMergePlan' },
  'door.items.planPontyPurchase': { side: 'coordinator', type: 'typeof planPontyPurchase', door: 'runtime/items/coordinator/api.ts#planPontyPurchase' },
  'door.items.normalizeMarketSales': { side: 'coordinator', type: 'typeof normalizeMarketSales', door: 'runtime/items/coordinator/api.ts#normalizeMarketSales' },
  'door.items.normalizeMarketBids': { side: 'coordinator', type: 'typeof normalizeMarketBids', door: 'runtime/items/coordinator/api.ts#normalizeMarketBids' },
  'door.items.normalizePontyListings': { side: 'coordinator', type: 'typeof normalizePontyListings', door: 'runtime/items/coordinator/api.ts#normalizePontyListings' },
  'door.items.storageKey': { side: 'coordinator', type: 'typeof storageKey', door: 'runtime/items/coordinator/api.ts#storageKey' },
  'door.items.sellerKey': { side: 'coordinator', type: 'typeof sellerKey', door: 'runtime/items/coordinator/api.ts#sellerKey' },
  'door.items.restockPolicyOf': { side: 'coordinator', type: 'typeof restockPolicyOf', door: 'runtime/items/coordinator/api.ts#restockPolicyOf' },
  'door.items.restockInventorySatisfied': { side: 'coordinator', type: 'typeof restockInventorySatisfied', door: 'runtime/items/coordinator/api.ts#restockInventorySatisfied' },
} as const satisfies Record<string, ReadRow>;
// C3's completeness rule: the door exports that are no read, each a write (it changes owner state), a
// port (an install, a factory or a published answer the composition wires) or a command (it builds
// or sends work to a character). A door named by an ACTIONS or READS row is no entry here.
export const DOOR_ONLY = {
  ...doorOnly('runtime/items/coordinator/api.ts', 'write', ['receivePlayerSales', 'recordClaimBanked', 'recordBankReceipts', 'receiveBankUpgrades', 'writeIntents', 'receiveBankDeconstruction', 'receiveDeconstruction', 'queueExchangeStorage', 'migrateSharedRules', 'clearCoordinatorResolvedUpgrades', 'reconcileCoordinatorUpgradeMarks']),
  ...doorOnly('runtime/items/api.ts', 'port', ['publishItemData', 'initialMailbox']),
  ...doorOnly('runtime/items/coordinator/api.ts', 'port', ['items', 'publishItems', 'installItems', 'createBankSortRoutes', 'initialBankSort', 'loadCoordinatorBankVaults', 'createImprovementScheduler', 'createAutomaticMerchantSales', 'createStandReconciliation', 'createMerchantObservation', 'initialALDataState', 'initialStandBids', 'loadCoordinatorItemData', 'initialBankState', 'initialCollectionState', 'initialItemIntents', 'createManualMarketOrderRoutes', 'createMarketplaceProgressRoutes', 'createMarketplaceLocationRoute', 'createInventoryCarry', 'createMailInboxRoutes', 'createCoordinatorStorageService', 'createBankboiStorage', 'createReservedBankboiCargo', 'createUpgradePreviews', 'installProductionRoutes', 'createMerchantExchangeRoutes', 'createMerchantOrderRoute', 'installMarketRoutes', 'createDeconstructionRoutes', 'createCoordinatorMarketAccountActions', 'createMerchantBlacklistRoute', 'createNpcSaleRoute', 'createCoordinatorMarketFeeds', 'createCoordinatorPurchases', 'createManualOrders', 'createCoordinatorAccountCharacterActions', 'createCoordinatorBankActions', 'createStaleOrderRoute', 'createRuleConflictRoute', 'createCoordinatorInventoryActions', 'createInventoryReservations', 'itemAskFacts']),
  ...doorOnly('runtime/items/api.ts', 'command', ['loot']),
  ...doorOnly('runtime/items/coordinator/api.ts', 'command', ['createMerchantItemCommands', 'createTransferCommands', 'createCoordinatorCharacterCommands', 'createMailJobs']),
};

// Part 4: an add-on's claims and actions on an item, which 12 draws in the item's options list.
export const SLOTS = {
  'item-rules': { owner: '10', data: "{part: inventory-menu, bank-menu or item-details, item, character: the holder or bank pack, fate: the add-on claim or action holding a bag copy (the party state's addonItemFates), settings}; the add-on's piece draws its claim", section: true, 
    bound: "adds one entry per add-on after the item menu's or the item details' core content; the core actions stay as they are, in their order",
    fixture: "scripts/tests/dashboard-addon-slots.test.cjs#item-rules: the add-on's claim shows in the item's details, with the item and its holder" },
} as const satisfies Record<string, SlotRow>;

// The registry's dispatch of 10's add-on hooks (part 1): each enabled add-on's answers, named by
// the add-on, in load order. An answer that throws gives nothing and is kept with the notices' errors.
// coordinator/fates.ts decides what each answer does.
export function dispatch(ctx: DispatchContext) {
  // An answer may name one ask or a list of them; each ask is its own entry, named by its add-on.
  function answers<T>(hook: 'items.claim' | 'items.action' | 'items.source', ask: (r: DispatchRegistration) => T | readonly T[] | undefined) {
    return ctx.answers(hook, ask).flatMap(({ addon, answer }) => (Array.isArray(answer) ? answer : [answer]).map(one => ({ addon, answer: one as T })));
  }
  return {
    itemRules: {
      // Whether any enabled add-on answers, so 10 builds the views only then.
      claiming: () => ctx.answering('items.claim').length > 0,
      acting: () => ctx.answering('items.action').length > 0,
      sourcing: () => ctx.answering('items.source').length > 0,
      claims: (view: ItemClaimView, only?: string) => answers<ItemClaimAsk>('items.claim', r =>
        only && r.name !== only ? undefined : r.hooks['items.claim']!(view, ctx.settings(r.name))),
      actions: (ask: ItemActionAsk) => answers<ItemActionAnswer>('items.action', r => r.hooks['items.action']!(ask, ctx.settings(r.name))),
      sources: (ask: ItemSourceAsk) => answers<unknown>('items.source', r => r.hooks['items.source']!(ask, ctx.settings(r.name))),
      // `items.bankLayout` answers `one`: the first enabled add-on that answers names the order.
      layout(view: BankLayoutView): { addon: string; answer: readonly { pack: string; slot: number }[] } | null {
        for (const r of ctx.answering('items.bankLayout')) {
          const answer = ctx.call(r, 'items.bankLayout', () => r.hooks['items.bankLayout']!(view, ctx.settings(r.name)));
          if (answer !== undefined) return { addon: r.name, answer };
        }
        return null;
      },
      // A refused answer is kept with the add-on's errors, as a throw is.
      refused: (addon: string, hook: 'items.bankLayout', reason: string) => ctx.record(addon, hook, reason),
    },
  };
}

// The hook coverage (addon:check rule 8):
// each decision of the files below with its hook or core-only reason, and each other export's plain kind.
export const RULE_FILES = ['runtime/items/rules.ts'] as const;
export const DECISIONS = {
  'an item\'s fate, by claim': { at: 'runtime/items/rules.ts#fateOf', hook: 'items.claim' },
  'an item\'s fate, by action': { at: 'runtime/items/rules.ts#fateOf', hook: 'items.action' },
  'a claim\'s place': { at: 'runtime/items/rules.ts#placeHolds', hook: 'items.claim' },
  'a claim\'s fate': { at: 'runtime/items/rules.ts#claimFate', hook: 'items.claim' },
  'the copies a claim takes': { at: 'runtime/items/rules.ts#claimCopies', hook: 'items.claim' },
  'the player\'s rule action': { at: 'runtime/items/rules.ts#ruleAction', hook: 'settings.overlay' },
  'automatic action order': { at: 'runtime/items/rules.ts#processingAction', hook: 'items.action' },
  'an add-on action\'s place in the order': { at: 'runtime/items/rules.ts#addonAhead', hook: 'items.action' },
  'bank layout, deposits': { at: 'runtime/items/rules.ts#stackDepositPlan', hook: 'items.bankLayout' },
  'bank layout, merges': { at: 'runtime/items/rules.ts#nextStackMerge', hook: 'items.bankLayout' },
  'market sources': { site: 'runtime/hooks/rows/10-items.ts:38', hook: 'items.source' },
  'protected free slots': { at: 'runtime/items/rules.ts#protectedSlotsOf', hook: 'settings.overlay' },
  'lucky slot': { at: 'runtime/items/rules.ts#luckySlotSearch', core: 'game', cite: 'runtime/items/rules.ts:819, roll statistics' },
  'upgrade offering': { at: 'runtime/items/rules.ts#resolveUpgradeOffering', hook: 'settings.overlay' },
  'automatic NPC retrieval': { at: 'runtime/items/rules.ts#automaticNpcRetrieval', hook: 'settings.overlay' },
} satisfies Record<string, DecisionRow>;
export const PLAIN = {
  // Facts the game fixes, which the console reads; an add-on's answer cannot change them.
  deconstructable: 'read', deleteWaitMs: 'read',
  itemFailure: 'read', bidAcceptsLevel: 'read', failureClass: 'read', deconstructionRewards: 'read', exchangeResultIsItem: 'read',
  donationXpPerGold: 'read', maximumItemLevel: 'read', standSlots: 'read', merchantStandSlots: 'read',
  standSlotUse: 'read', standSlotsUsed: 'read', bagSize: 'read', defaultStandPrice: 'read', itemValue: 'read',
  pontyPrice: 'read', luckySlotOf: 'read', itemGrade: 'read', statScrollsNeeded: 'read', ruleOwner: 'read',
  sharedMember: 'read', ruleMembers: 'read', activeRules: 'read', fateReachesMerchant: 'read',
  processingPending: 'read', hasMarkedWithdrawals: 'read', vaultAccess: 'read', keyHeld: 'read', stagingCell: 'read',
  bankStagingReserved: 'read', usableCopy: 'read', freeSlots: 'read', receiptList: 'read', consumeReceipts: 'read',
  stackProtected: 'read', stackLocations: 'read', sameStack: 'read', compoundStorageLeftovers: 'read',
  availableCraftStock: 'read', withoutDeliveryStock: 'read', mergeSlotStream: 'read', emptyRolls: 'read',
  aggregateSlotTracking: 'read', slotLogEvidence: 'read', marketListingFresh: 'read', highestUpgradeLevel: 'read',
  estimateUpgradeBatch: 'read', isUpgradeOffering: 'read', offeringRule: 'read',
  validLuckySlot: 'validator', itemRuleConflicts: 'validator', incompatibleRuleRows: 'validator',
  validSlotStatistics: 'validator', offeringOverlap: 'validator', offeringProblem: 'validator',
  validOfferingRule: 'validator', validOfferingRules: 'validator',
  luckySlotAnswer: 'format', npcSaleRuleKey: 'format', upgradeEstimateKey: 'format', unavailablePreview: 'format',
  normalizeSlotTracking: 'migration', fitOfferingRules: 'migration',
  tripLabel: 'label',
} satisfies Record<string, PlainKind>;

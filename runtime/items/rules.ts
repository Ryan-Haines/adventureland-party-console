// Inventory, bank and commerce's rules: the tables that both runtimes read. A number here
// is game data with its source line, a rule, or a model parameter of the lucky slot search or the
// upgrade estimate kept at the previous release's value with its reason; the picks with no source
// are hidden settings in saved-fields.ts.

import type { InventoryEntry, Item } from '../coordinator/contracts/item.ts';
import type { GameResponseDataUpgradeChance, ItemInfo } from 'typed-adventureland';
// A decision reads the player's setting through `played`, so an add-on's overlay plays.
import { played } from '../settings/api.ts';
import type { CompoundRule } from './coordinator/production.ts';
import type { ActionOrder } from '../hooks/registry.ts';
import { commerceRuleKey, exchangeKey, isBankboiPack, isVaultPack, markMatches, ruleKey, ruleMode, stackKey, stackQuantity } from './identity.ts';

// Every failure an items operation reports carries one of these codes, and
// its text rides beside it as the human message. Each code names the class the merchant job
// owner gives its text one to one: `storage` is the BankBoi yield, `space` and `gold`
// are the resource block, `interrupted` is the interrupted production retry and a BankBoi
// run's resume, `ambiguous` is the upgrade recovery block, `uncertain` is an error-level end, and
// `failed` ends with no retry. `movement_plan` passes like every interruption.
export const ITEM_FAILURES = {
  bankboi_pending: 'storage',
  bank_full: 'space', inventory_full: 'space',
  short_gold: 'gold',
  upgrade_ambiguous: 'ambiguous', upgrade_uncertain: 'uncertain',
  lucky_unavailable: 'interrupted', lucky_swap_unconfirmed: 'space', lucky_interrupted: 'space', lucky_busy: 'space',
  lucky_source_changed: 'space', lucky_scroll_changed: 'space',
  item_missing: 'failed', marked_missing: 'failed', deconstruct_space: 'failed', not_confirmed: 'failed',
  interrupted: 'interrupted', movement_plan: 'interrupted',
} as const;
export type ItemFailure = keyof typeof ITEM_FAILURES;
export type FailureClass = (typeof ITEM_FAILURES)[ItemFailure];
/** A character-side failure with its failure code: `reason` keeps the text the activity shows, `code` is what the merchant job owner reads. */
export function itemFailure(code: ItemFailure, message: string = code): Error & { reason: string; code: ItemFailure } {
  return Object.assign(new Error(message), { reason: message, code });
}
/** The merchant-job class of a reported failure's code, or null for a success or a failure with no failure code. */
export function failureClass(code: unknown): FailureClass | null {
  return typeof code === 'string' && Object.hasOwn(ITEM_FAILURES, code) ? ITEM_FAILURES[code as ItemFailure] : null;
}

// Game data. The game's upgrade tables stop at +12 (G design/upgrades.js; node/server.js
// 7143-7148), so an automatic upgrade rule ends at +12 and never schedules an attempt the server
// refuses.
export const UPGRADE_LEVEL_MAX = 12;
// An upgrade target to +13 stays accepted, because an older dashboard offered it; the
// scheduler caps the run at UPGRADE_LEVEL_MAX.
export const UPGRADE_TARGET_ACCEPTED = UPGRADE_LEVEL_MAX + 1;
// The game's wishlist refuses a price above 99,999,999,999 gold or a level above 12 (G
// js/html.js:5751), so a stand bid outside them is never funded.
export const TRADE_PRICE_MAX = 99_999_999_999;
// The game caps a wishlist offer's quantity at 9,999 copies (G node/server.js `trade_wishlist`,
// `data.q = min(9999...)`), for every item kind.
export const WISHLIST_QUANTITY_MAX = 9999;
/** A WTB bid takes a copy at its minimum level and above, or at exactly that level when it
 * refuses higher ones; a bid saved before the choice existed takes higher levels. */
export function bidAcceptsLevel(bid: { minimumQuality?: number; acceptHigherLevels?: boolean }, item: { level?: unknown } | null | undefined): boolean {
  const level = Number(item?.level) || 0, requested = Number(bid.minimumQuality) || 0;
  return bid.acceptHigherLevels === false ? level === requested : level >= requested;
}
// The game dismantles an item only while the bag has two free cells (G node/server.js "dismantle":
// `if (player.esize < 2)`), so a dismantle mark waits for them.
export const DISMANTLE_FREE_SLOTS = 2;
// The dismantle catalog (market.ts `buildDeconstructionCatalog`): a recipe of G.dismantle, or a
// compound item, which dismantles above +0.
export type DeconstructionCatalog = Record<string, { compound: boolean; cost?: number; rewards?: { name: string; quantity: number; chance: number }[] }>;
/** The game dismantles an unlocked, unbound copy that has a recipe, or a compound item above +0. */
export function deconstructable(item: { name?: unknown; level?: unknown; l?: unknown; b?: unknown }, catalog: DeconstructionCatalog): boolean {
  const definition = catalog[String(item.name)];
  return !!definition && !item.l && !item.b && (!definition.compound || Number(item.level) > 0);
}
/** The result as the game's dismantle handler gives it: each recipe part rolls on its own, and a
 * compound copy returns three copies one level lower. */
export function deconstructionRewards(item: { name?: unknown; level?: unknown }, catalog: DeconstructionCatalog) {
  const definition = catalog[String(item.name)];
  if (!definition) return null;
  if (definition.compound && Number(item.level) > 0)
    return [{ name: String(item.name), level: Number(item.level) - 1, quantity: 3, chance: 1 }];
  return definition.rewards?.map(reward => ({ ...reward, level: 0 })) || null;
}
// The game's largest item stack is 9,999 copies (G.items `s`, e.g. hpot0), so a sale, an
// exchange or an order line of one item names at most that many.
export const STACK_SIZE_MAX = 9999;
// A row of the game's exchange tables (G.drops) names an item, or one of these non-item kinds: no
// reward, gold, shells, a cosmetic or a cosmetic bundle, or `open`, which rolls another table.
const EXCHANGE_NON_ITEMS = new Set(['empty', 'gold', 'shells', 'cx', 'cxbundle', 'open']);
/** An exchange result that is an item copy, which takes an item's marks and catalog details. */
export const exchangeResultIsItem = (kind: unknown): boolean => !!kind && !EXCHANGE_NON_ITEMS.has(String(kind));
// The game cuts a mail's subject at 74 characters and its message at 1,000 (G node/logic/mail.js
// `send_mail`: `substring`, `substring`), so a send asks no more.
export const MAIL_SUBJECT_MAX = 74;
export const MAIL_MESSAGE_MAX = 1000;
// ALData authenticates a key mailed to its game account with this subject. The merchant
// sends it, and the dashboard drafts and recognises it.
export const ALDATA_AUTH_MAIL = { recipient: 'earthiverse', subject: 'aldata_auth' } as const;
// The game's postage (G node/logic/mail.js:143): 48,000 gold for a letter, 360,000 with an item.
// The ALData authentication is a letter.
export const MAIL_POSTAGE = { letter: 48_000, item: 360_000 } as const;
// The XP frog gives 4.8 XP per gold while the server holds under 500M donated gold, 4 at or
// below 1,000M, else 3.2 (G node/server.js:8636-8639 reads `<=` at the second boundary).
export function donationXpPerGold(serverGold: number): number {
  return serverGold < 500_000_000 ? 4.8 : serverGold <= 1_000_000_000 ? 4 : 3.2;
}
// Ponty answers `distance` beyond 500 and charges the call either way (G node/server.js:
// 7948-7951), so the merchant reads Ponty only within it.
export const PONTY_RANGE = 500;
// A chest farther than 400 from the looter loots dry (G node/server.js:11329-11331), so the
// loot pass opens only the chests within it.
export const LOOT_RADIUS = 400;
// The game's compound tables reach +10, and the console offers compound targets to +7 only
// (the odds make +8 to +10 unreachable).
export const COMPOUND_TARGET_MAX = 7;
// The highest level the console offers and attempts, +12 for an upgradeable item and +7 for a
// compoundable one. The bag's catalog and the coordinator's saved-profile inspection report it as
// `maxLevel`, and the dashboard's pickers read it.
export function maximumItemLevel(definition: { compound?: unknown; upgrade?: unknown } | null | undefined): number {
  return definition?.compound ? COMPOUND_TARGET_MAX : definition?.upgrade ? UPGRADE_LEVEL_MAX : 0;
}
// The game's compound combines three copies of one level (G node/server.js `compound` handler:
// `data.items[0]` to `data.items[2]`), so a compound rule runs on a triplet.
export const COMPOUND_INPUTS = 3;
// A character's bag holds `isize` cells, which its report carries as `inventorySize`. The game
// starts every character at 42 (G node/server.js:1483 `player.isize = 42`), and bagSize reads that
// base when a report names no size.
export const BASE_INVENTORY_SIZE = 42;
// A stand opens with the game's get_trade_slots count (G node/server_functions.js:
// 4365-4376): 30 for a merchant at level 80, 24 at level 70 or on a `cstand`, else 16. The merchant
// reports it as `standSlots`; merchantStandSlots reads the base 16 when a report names none.
// Planners plan to the latest report, so a count that grew between two reports is read at the next one.
export const BASE_STAND_SLOTS = 16;
// The Tracktrix and its upgrade (G items `tracker`, `supercomputer`): the bag pins either in its
// last cell, a cleanout never sends one, and its holder's card shows the Tracktrix bonuses.
export const TRACKER_ITEMS: readonly string[] = ['tracker', 'supercomputer'];
// The steps a drop's acquisition path names before its item: a world table (G `drops.maps.global`
// scales by the monster's HP), and a monster's chest (`open <table>`), each a step of the same
// drop. The bag's catalog and the report's bestiary write them; the dashboard's drop rate reads them.
export const ACQUISITION = { worldDrop: 'World drop', scaledWorldDrop: 'HP-scaled world drop', open: 'open ' } as const;
// The game refuses a character delete within 180 minutes of the account's last delete (G
// api.js:916, `owner.info.last_delete`, set at api.js:873 and :947) and names the wait it has left
// as `wait_<minutes>_minutes`. servers_and_characters (api.js:573-594) carries no last-delete time,
// so the delete route reads the game's own refusal, not a count from the BankBoi's creation.
export function deleteWaitMs(reason: string): number | null {
  const minutes = /^wait_(\d+)_minutes$/.exec(reason)?.[1];
  return minutes === undefined ? null : Number(minutes) * 60_000;
}
// A creation uses only the account's included character slots, so it never spends Shells: past
// get_character_slots the game charges 200 Shells per creation (G api.js:14-21:683-686). An
// account with a Steam id (`pid`) includes 8 (G adventure_functions.js:173-177), as does a Steam,
// Electron or Tauri signup (G api.js:201); a web signup includes 5. servers_and_characters carries
// no slot count, so the console counts the Steam account's 8.
export const FREE_CHARACTER_SLOTS = 8;
export function standSlots(merchant: { ctype?: string; level?: number; stand?: string }): number {
  const level = Number(merchant.level) || 0;
  if (merchant.ctype === 'merchant' && level >= 80) return 30;
  if (merchant.ctype === 'merchant' && (level >= 70 || merchant.stand === 'cstand')) return 24;
  return BASE_STAND_SLOTS;
}
export function merchantStandSlots(state: { merchantCharacter?: string | null; statuses?: Record<string, unknown> }): number {
  const slots = Number((state.statuses?.[String(state.merchantCharacter)] as { standSlots?: unknown } | undefined)?.standSlots);
  return Number.isSafeInteger(slots) && slots > 0 ? slots : BASE_STAND_SLOTS;
}
// The merchant's stand cells from the one stand count, and the cells in use, as the previous
// release's header counted them (dashboard/features/party/stand-inspection.ts:9-21). A cell is in
// use when the merchant's report holds an item in it; the report keeps every slot (report.ts
// `slots`), so a buy order placed in game counts. While the stand is not reported open, the live or
// removing native offers and the live listings that hold a cell count too, once per cell. A cell is
// any `trade<N>`, so a 24 or 30 cell stand counts past trade16. `free` is what a new order may take:
// the stand less the count (`standSlotsUsed`), the one the coordinator refuses an order by, so the
// dashboard offers no listing the coordinator refuses judged full by the same count, and its
// header showed the cells.
type StandUseState = {
  merchantCharacter?: string | null; statuses?: Record<string, unknown>;
  standListings?: { tradeSlot?: unknown; state?: string }[];
  standBids?: unknown;
  nativeStand?: unknown;
};
const STAND_CELL = /^trade[1-9]\d*$/;
export function standSlotUse(state: StandUseState) {
  const report = state.statuses?.[String(state.merchantCharacter)] as { slots?: Record<string, unknown>; standOpen?: unknown } | undefined;
  const listings = state.standListings || [];
  const cells = new Set(Object.entries(report?.slots || {}).filter(([slot, entry]) => STAND_CELL.test(slot) && !!entry).map(([slot]) => slot));
  if (report?.standOpen !== true) {
    const offers = (state.nativeStand as { offers?: Record<string, { slot?: unknown; phase?: string }> } | undefined)?.offers;
    for (const offer of Object.values(offers || {}))
      if (typeof offer.slot === "string" && STAND_CELL.test(offer.slot) && (offer.phase === "live" || offer.phase === "removing")) cells.add(offer.slot);
    for (const listing of listings)
      if (typeof listing.tradeSlot === "string" && STAND_CELL.test(listing.tradeSlot) && listing.state === "live") cells.add(listing.tradeSlot);
  }
  const slots = merchantStandSlots(state);
  return { slots, used: Math.min(slots, cells.size), free: Math.max(0, slots - standSlotsUsed({ standListings: listings,
    standBids: state.standBids as Record<string, { useStandSlot?: boolean } | undefined> | undefined })) };
}
// The stand cells in use, the unpaused sales and the buy orders that hold a cell; the stand
// marks and the automatic sales read this one count against merchantStandSlots.
export function standSlotsUsed(state: { standListings: readonly { state?: string }[]; standBids?: Record<string, { useStandSlot?: boolean } | undefined> }): number {
  return state.standListings.filter(listing => listing.state !== "paused").length + Object.values(state.standBids || {}).filter(bid => bid?.useStandSlot).length;
}
export function bagSize(report: unknown): number {
  const size = Number((report as { inventorySize?: unknown } | null | undefined)?.inventorySize);
  return Number.isSafeInteger(size) && size > 0 ? size : BASE_INVENTORY_SIZE;
}
// A lucky slot is a cell of the base bag.
export function validLuckySlot(slot: unknown): slot is number {
  return Number.isInteger(slot) && Number(slot) >= 0 && Number(slot) < BASE_INVENTORY_SIZE;
}
// A stand mark starts at the item's game value (`G.items[name].g`), at least 1 gold.
export function defaultStandPrice(definition: { g?: unknown } | null | undefined): number {
  return Math.max(1, Number(definition?.g) || 1);
}
// The kept bounds against a server or player outside the console.
// Each keeps the previous release's value. A 429 with no
// readable `retry-after` is a network failure. The ALData client then waits ALData's rate window,
// the window the previous release's 12-request budget counted. Each market feed refreshes at most
// once per window (coordinator/market.ts `createFeedCadence`).
export const ALDATA_RATE_WINDOW_MS = 60_000; // runtime/coordinator/commerce/aldata-client.ts:8
// (a): a bank sort pass's bound, three swaps per cell. With every swap confirmed the plan ends
// within two per cell; the bound fires when the game's bank answers a layout the plan did not
// expect (bankSortBound).
export const SORT_SWAPS_PER_CELL = 3;
// A merchant's send waits this long for the player to come within reach, against a player that
// never comes; a firing reports through `boundFired` (character/market.ts `send`).
export const SEND_MEET_MS = 10_000; // characters/shared.js:5505 `waitForPlayer(name, 10000)`

// The free cells every bag keeps for a visit's logistics, the player's "Protected free slots"
// (saved-fields.ts). Its default is the previous release's
// 3, so play is unchanged until the player sets it. A value past the bag the report gives keeps the
// whole bag. The character reads its own count from its reply (owner.ts `reply`).
export const PROTECTED_FREE_SLOTS_DEFAULT = 3;
export function protectedSlotsOf(state: { protectedFreeSlots?: unknown; statuses?: Record<string, unknown> }, name: string): number {
  const value = played(state, 'protectedFreeSlots', name);
  const slots = Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : PROTECTED_FREE_SLOTS_DEFAULT;
  return Math.min(slots, bagSize(state.statuses?.[name]));
}

// The game's item value (calculate_item_value, G js/old_common_functions.js:808-846), the one copy
// Ponty's prices and an add-on read. A missing scroll price falls back to G.items' scroll prices
// (scroll0 to scroll2 1,000, 40,000, 1,600,000; cscroll0 to cscroll2 6,400, 240,000, 9,200,000).
interface ItemValueDefinition { g?: unknown; cash?: unknown; markup?: unknown; grades?: unknown; compound?: unknown; upgrade?: unknown; type?: unknown }
export interface ItemValueMeta { definition?: ItemValueDefinition; compoundable?: unknown; upgradeable?: unknown }
const SCROLL_PRICES = [1000, 40000, 1600000], COMPOUND_SCROLL_PRICES = [6400, 240000, 9200000];
export function itemValue(item: { level?: unknown; expires?: unknown; gift?: unknown }, meta: ItemValueMeta | undefined,
  scrollPrices: Record<string, number> = {}): number | null {
  const d = meta?.definition || {};
  if (!Number.isFinite(Number(d.g))) return null;
  let value = Number(d.g) * (d.cash ? 1 : .6);
  if (d.markup) value /= Number(d.markup);
  const grades = Array.isArray(d.grades) ? d.grades as number[] : [11, 12], level = Number(item.level) || 0;
  if (d.compound || meta?.compoundable) for (let tier = 1; tier <= level; tier++) {
    const grade = tier > grades[1]! ? 2 : tier > grades[0]! ? 1 : 0;
    value *= d.cash ? 1.5 : 3.2;
    if (d.type !== 'booster') value += (scrollPrices['cscroll' + grade] ?? COMPOUND_SCROLL_PRICES[grade]!) / 2.4;
    else value *= .75;
  }
  if (d.upgrade || meta?.upgradeable) {
    let scroll = 0;
    for (let tier = 1; tier <= level; tier++) {
      const grade = tier > grades[1]! ? 2 : tier > grades[0]! ? 1 : 0;
      scroll += (scrollPrices['scroll' + grade] ?? SCROLL_PRICES[grade]!) / 2;
      if (tier >= 7) { value *= 3; scroll *= 1.32; }
      else if (tier === 6) value *= 2.4;
      else if (tier >= 4) value *= 2;
      if (tier === 9) { value *= 2.64; value += 400000; }
      if (tier === 10) value *= 5;
      if (tier === 12) value *= .8;
    }
    value += scroll;
  }
  if (item.expires) value /= 8;
  if (item.gift) value = 1;
  return value;
}
// A Ponty lot's price is the game's item value times Ponty's multiplier, 2, or 3 for a cash
// item (G node/server.js:8346-8350).
export function pontyPrice(item: { level?: unknown; expires?: unknown; gift?: unknown }, meta: ItemValueMeta | undefined,
  scrollPrices: Record<string, number> = {}): number | null {
  const value = itemValue(item, meta, scrollPrices);
  return value === null ? null : Math.max(1, Math.round(value) * (meta?.definition?.cash ? 3 : 2));
}

// The character's lucky slot, today's order in one copy: the player's lock, else the
// slot a resumed search returns to, else the verified slot. With none, the character takes its
// tracker's pick.
export interface LuckySlots {
  luckySlotLocks?: Record<string, number | null>;
  luckySlotResume?: Record<string, { slot: number } | undefined>;
  luckyUpgradeSlots?: Record<string, number | null>;
}
export function luckySlotOf(state: LuckySlots, name: string): number | null {
  return luckySlotAnswer(state, name).slot;
}
// The lucky slot's whole answer for the inventory card and the lucky slot dialog: the slot that order
// picks, the locked slot, whether an unlocked slot is resuming, and the verified slot.
export interface LuckySlotAnswer { slot: number | null; locked: number | null; resuming: boolean; verified: number | null }
export function luckySlotAnswer(state: LuckySlots, name: string): LuckySlotAnswer {
  const locked = state.luckySlotLocks?.[name] ?? null, resume = state.luckySlotResume?.[name]?.slot ?? null;
  const verified = state.luckyUpgradeSlots?.[name] ?? null;
  return { slot: locked ?? resume ?? verified, locked, resuming: locked == null && state.luckySlotResume?.[name] != null, verified };
}

// An item's grade, the game's `calculate_item_grade` (G js/old_common_functions.js:798-806): the
// highest of its four `grades` thresholds the item's level has reached, tested from grades[3] down,
// so 4 to 1, and 0 below grades[0] or for an item with no upgrade or compound table. A booster's
// thresholds are out of order ([0, 10, 6, 7]), so at +7 it is grade 4 where a count says 3.
export function itemGrade(definition: { upgrade?: unknown; compound?: unknown; grades?: unknown }, level: number): number {
  if (!definition.upgrade && !definition.compound) return 0;
  const grades = Array.isArray(definition.grades) ? definition.grades as number[] : [9, 10, 11, 12];
  for (let grade = 4; grade >= 1; grade -= 1) if (level >= grades[grade - 1]) return grade;
  return 0;
}
// A stat scroll needs this many scrolls at each grade (G node/server.js:7465-7468), so a
// grade 4 item asks 9,999 where the console asked 1,000 and the server refused the run.
export const STAT_SCROLLS_BY_GRADE = [1, 10, 100, 1000, 9999] as const;
export function statScrollsNeeded(definition: { upgrade?: unknown; compound?: unknown; grades?: unknown }, level: number): number {
  return STAT_SCROLLS_BY_GRADE[itemGrade(definition, level)];
}

// The fate table: an item's automatic action; `bank` and `merchant` are the collection
// rules, the rest are F5's processing and sale rules.
export type AutomaticAction = 'bank' | 'merchant' | 'upgrade' | 'compound' | 'npc' | 'stand' | 'exchange' | 'deconstruction';
// F5's order among an item's rules, today's first-active order: an exchange reward takes the first
// active rule, and with none F7 banks it.
export const AUTOMATIC_ORDER = ['exchange', 'npc', 'stand', 'upgrade', 'compound', 'deconstruction'] as const satisfies readonly Exclude<AutomaticAction, 'bank' | 'merchant'>[];

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
// An add-on's action names its place among F5's actions, before or after one of them. F5 reads
// the processing actions in AUTOMATIC_ORDER, then the collection rules.
const ACTION_PLACES: readonly string[] = [...AUTOMATIC_ORDER, 'bank', 'merchant'];
export function addonAhead(order: ActionOrder | undefined, core: string): boolean {
  const named = order && ('before' in order ? order.before : order.after), at = ACTION_PLACES.indexOf(String(named));
  if (!order || at < 0) return false;
  return ('before' in order ? at - 0.5 : at + 0.5) < ACTION_PLACES.indexOf(core);
}

// The rule owner and its members. With shared rules the merchant owns every member's
// rules. A member is every reporting character that is not a BankBoi, read when asked, so a
// character added after the migration shares the rules; the migration keeps only the rule merge.

export type RuleFamily = 'item' | 'upgrade' | 'compound' | 'deconstruction' | 'npc' | 'stand' | 'exchange';
export interface RuleChoice { owner: string; value: unknown }
export interface RuleConflict { id: string; family: RuleFamily; key: string; choices: RuleChoice[] }
export interface SharedRules { version: 1; owner: string; backup: unknown; conflicts: RuleConflict[] }
export interface SharedScope {
  merchantCharacter?: string | null;
  merchantRules?: SharedRules | null;
  statuses?: Record<string, unknown>;
  bankbois?: Record<string, unknown>;
}
export function ruleOwner(state: SharedScope, name: string): string {
  return state.merchantRules?.version === 1 ? String(state.merchantCharacter) : name;
}
export function sharedMember(state: SharedScope, name: string): boolean {
  return !state.merchantRules || name === state.merchantCharacter || !state.bankbois?.[name];
}
/** The characters whose marks a rule of `name`'s rule owner reaches. */
export function ruleMembers(state: SharedScope, name: string): string[] {
  if (!state.merchantRules) return [name];
  const reporting = Object.keys(state.statuses || {}).filter(member => sharedMember(state, member));
  return [...new Set([String(state.merchantCharacter), ...reporting])];
}

// F5, the automatic rules. One predicate per action answers whether the item's rule of the
// merchant's rule owner is active; the reward fate, the conflicts and the processing check read it
// (one copy of each rule).

export interface RuleState extends SharedScope {
  autoItemMarks?: Record<string, Record<string, unknown> | undefined>;
  autoUpgradeMarks?: Record<string, Record<string, unknown> | undefined>;
  autoCompounds?: Record<string, { name: string; quantity?: number; targetTier?: number }[] | undefined>;
  autoNpcSales?: Record<string, { item: Item; character?: string; keep?: number } | undefined>;
  autoStandMarks?: Record<string, unknown>;
  autoExchanges?: Record<string, unknown>;
  autoDeconstruction?: Record<string, Record<string, unknown> | undefined>;
  upgrades?: Record<string, unknown[] | undefined>;
}
function upgradeRuleActive(value: unknown): boolean {
  return !!value && (typeof value !== 'object' || Number((value as { quantity?: number }).quantity) !== 0);
}
/** An NPC sale rule's key: the item's commerce key, or with a character the member's own rule. */
export const npcSaleRuleKey = (item: Item, character?: string) => character ? JSON.stringify([character, commerceRuleKey(item)]) : commerceRuleKey(item);
// `owner` is the rule owner whose rules apply; the merchant's own by default, as an exchange reward
// reads them. A member's NPC sale rule is its own key while the rules are not shared; a stand rule is
// the merchant's.
function ruleActive(state: RuleState, action: Exclude<AutomaticAction, 'bank' | 'merchant'>, item: Item,
  owner = ruleOwner(state, String(state.merchantCharacter))): boolean {
  const commerce = commerceRuleKey(item), merchant = owner === ruleOwner(state, String(state.merchantCharacter));
  switch (action) {
    case 'exchange': return !!state.autoExchanges?.[exchangeKey(item.name, item.level)];
    case 'npc': return !!state.autoNpcSales?.[merchant ? commerce : npcSaleRuleKey(item, owner)];
    case 'stand': return merchant && !!state.autoStandMarks?.[commerce];
    case 'upgrade': return upgradeRuleActive(state.autoUpgradeMarks?.[owner]?.[ruleKey(item)]);
    case 'compound': return !!state.autoCompounds?.[owner]?.some(rule => rule.name === item.name &&
      Number(rule.quantity) !== 0 && (Number(item.level) || 0) < Number(rule.targetTier || 1));
    case 'deconstruction': return !!state.autoDeconstruction?.[owner]?.[commerce];
  }
}
/** F5's processing and sale step: the first active rule of the rule owner in AUTOMATIC_ORDER. An
 * exchange reward reads only this step, then F7 banks it. */
export function processingAction(state: RuleState, item: Item, owner: string) {
  return AUTOMATIC_ORDER.find(action => ruleActive(state, action, item, owner));
}
/** F5's active rules for an item, in AUTOMATIC_ORDER, across `owners` (the merchant's rule owner
 * by default), with what a banner names: an upgrade's tiers and a compound's target tier, the
 * highest of the owners'. The dashboard's exchange reward and bank banners draw this answer. */
export interface ActiveRule { action: typeof AUTOMATIC_ORDER[number]; tiers?: number; targetTier?: number }
export function activeRules(state: RuleState, item: Item, owners = [ruleOwner(state, String(state.merchantCharacter))]): ActiveRule[] {
  const level = Number(item.level) || 0;
  return AUTOMATIC_ORDER.flatMap<ActiveRule>(action => {
    const holding = owners.filter(owner => ruleActive(state, action, item, owner));
    if (!holding.length) return [];
    if (action === 'upgrade') return [{ action, tiers: Math.max(...holding.map(owner => {
      const rule = state.autoUpgradeMarks?.[owner]?.[ruleKey(item)];
      return Number(rule && typeof rule === 'object' ? (rule as { tiers?: unknown }).tiers : rule) || 0;
    })) }];
    if (action === 'compound') return [{ action, targetTier: Math.max(...holding.flatMap(owner => (state.autoCompounds?.[owner] || [])
      .filter(rule => rule.name === item.name && Number(rule.quantity) !== 0 && level < Number(rule.targetTier || 1))
      .map(rule => Number(rule.targetTier || 1)))) }];
    return [{ action }];
  });
}
/** F5 for a member's copy: its rule owner's processing step, then its bank or merchant rule. */
export function ruleAction(state: RuleState, item: Item, name: string): AutomaticAction | null {
  const owner = ruleOwner(state, name), processing = processingAction(state, item, owner);
  if (processing) return processing;
  const mode = ruleMode(played(state, 'autoItemMarks', name)?.[owner] || {}, item);
  return mode === 'bank' || mode === 'merchant' ? mode : null;
}

// The fate rows F1 to F7, read top down for each copy: the first row that holds decides. `fate` is the
// action the copy takes (`keep` stays where it is, `held` waits for its operation) and `by` names who
// decided: the operation, the hands, the player, the claim, the rule owner, the add-on or the default.
export type FateRow = 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7';
export interface Fate { fate: string; row: FateRow; by: string }
export interface FateRows {
  held(): string | null;
  equipped(): string | null;
  mark(): string | null;
  claim(): { fate: string; by: string } | null;
  rule(): { fate: string; by: string } | null;
  // `core` is F5's action for the copy; an answer placed ahead of it says `ahead`.
  addon(core?: string): { fate: string; by: string; ahead?: boolean } | null;
  /** F7: an exchange reward on the merchant banks; every other copy stays. */
  reward(): boolean;
}
export function fateOf(rows: FateRows): Fate {
  const held = rows.held();
  if (held) return { fate: 'held', row: 'F1', by: held };
  const hands = rows.equipped();
  if (hands) return { fate: 'keep', row: 'F2', by: hands };
  const mark = rows.mark();
  if (mark) return { fate: mark, row: 'F3', by: 'player' };
  // Each row is asked only when every row above it is empty, so an add-on's action sees no
  // claimed copy. An add-on action placed ahead of F5's action takes the copy.
  const claim = rows.claim();
  if (claim) return { ...claim, row: 'F4' };
  const rule = rows.rule(), addon = rows.addon(rule?.fate);
  if (rule && !addon?.ahead) return { ...rule, row: 'F5' };
  if (addon) return { fate: addon.fate, by: addon.by, row: 'F6' };
  return { fate: rows.reward() ? 'bank' : 'keep', row: 'F7', by: 'default' };
}
/** A fate whose action needs the copy at the merchant, so a handoff sends it. */
export function fateReachesMerchant(fate: Fate | null | undefined): boolean {
  return !!fate && !['keep', 'held', 'bank'].includes(fate.fate);
}

// 3.3, the claims. A claim keeps copies of one item at its place: `carried:<character>`, `merchant` or
// `bank`. Its quantity is a count of copies, a number of stacks (`G.items[name].s` copies each), a
// restock range, whose place is refilled below `min` and keeps copies up to `max`, or `all`, every copy
// the party stores, which a merchant claim fetches from the bank and the BankBois.
export type ClaimQuantity = { count: number } | { stacks: number } | { min: number; max: number } | { all: true };
export interface Claim { item: { name: string; level?: number }; quantity: ClaimQuantity; place: string; reason: string; by: string }
/** The copies a claim keeps; `stack` is the item's stack size (1 for an item that does not stack). */
export function claimCopies(claim: Pick<Claim, 'quantity'>, stack: number): number {
  const q = claim.quantity as { count?: number; stacks?: number; max?: number; all?: true };
  if (q.all) return Number.POSITIVE_INFINITY;
  return Math.max(0, Number(q.count ?? (q.stacks !== undefined ? q.stacks * stack : q.max)) || 0);
}
/** What a place holds of one item: its cells times the stack size (`bankCells` for the bank, the bag's for a carrier). */
export function placeHolds(place: string, stack: number, bagCells: number, bankCells: number): number {
  return (place === 'bank' ? bankCells : bagCells) * stack;
}
/** F4's fate of a claimed copy: kept at its place, which for the merchant or the bank is where it goes. */
export function claimFate(place: string, onMerchant: boolean): string {
  return place === 'bank' ? 'bank' : place === 'merchant' && !onMerchant ? 'merchant' : 'keep';
}
function offeringUpgradePending(state: RuleState, item: Item): boolean {
  return Object.values(state.upgrades || {}).flatMap(marks => marks || []).some(raw => {
    const mark = record(raw), waiting = record(mark.waitingOffering), original = record(mark.item);
    if (!mark.auto || original.name !== item.name) return false;
    if (waiting.level === (Number(item.level) || 0)) return true;
    const start = Number(original.level) || 0, level = Number(item.level) || 0;
    return !!mark.passId && level >= start && level < start + Number(mark.tiers) && markMatches({ ...item, level: start }, { ...original, level: start });
  });
}
/** Processing needs the copy at the merchant: an upgrade or compound rule, or an upgrade waiting on its offering. */
export function processingPending(state: RuleState, item: Item): boolean {
  return offeringUpgradePending(state, item) || ruleActive(state, 'upgrade', item) || ruleActive(state, 'compound', item);
}
/** With shared rules, an item with more than one of processing, NPC sale, stand and deconstruction rules is a conflict. */
export function itemRuleConflicts(state: RuleState, item: Item): string[] {
  if (!state.merchantRules) return [];
  const actions = ([['Processing', processingPending(state, item)], ['NPC sale', ruleActive(state, 'npc', item)],
    ['Stand sale', ruleActive(state, 'stand', item)], ['Deconstruction', ruleActive(state, 'deconstruction', item)]] as const)
    .filter(([, active]) => active).map(([label]) => label);
  return actions.length > 1 ? actions : [];
}
export type ConflictState = RuleState;
// The public state's incompatible-rule rows, which the dashboard's "Automatic rules awaiting a
// choice" draws: each item of an automatic NPC sale, stand mark or the merchant's deconstruction
// rule, once per item and level, with the actions itemRuleConflicts finds active together.
export function incompatibleRuleRows(state: RuleState): { item: Item; actions: string[] }[] {
  const merchant = String(state.merchantCharacter);
  const rules = [...Object.values(state.autoNpcSales || {}), ...Object.values(state.autoStandMarks || {}),
    ...Object.values(state.autoDeconstruction?.[merchant] || {})] as ({ item?: Item } | undefined)[];
  const items = new Map<string, Item>();
  for (const rule of rules) if (rule?.item) items.set(`${rule.item.name}:${rule.item.level || 0}`, rule.item);
  return [...items.values()].map(item => ({ item, actions: itemRuleConflicts(state, item) })).filter(row => row.actions.length);
}

// F3: a plain bank withdrawal mark is a bank cell the player marked; production, stand, dismantle,
// craft, mail and BankBoi withdrawals belong to their own jobs.
export function hasMarkedWithdrawals(requests: readonly unknown[] = []): boolean {
  return requests.some(value => {
    const request = record(value);
    return typeof request.pack === 'string' && !isBankboiPack(request.pack) &&
      !['improvement', 'standListingId', 'deconstructionId', 'craftJobId', 'mailJobId'].some(key => request[key]);
  });
}
// The merchant carries a plain withdrawal an automatic NPC sale marked, with Auto NPC sales on.
// The items owner's bank collection reason and the merchant jobs owner's job priority read it.
export function automaticNpcRetrieval(state: { merchantCharacter: string | null; merchantAutomations?: Record<string, boolean | undefined>;
  withdrawals?: Record<string, readonly unknown[] | undefined> }): boolean {
  return played(state, 'merchantAutomations')?.['auto npc sales'] !== false && (state.withdrawals?.[String(state.merchantCharacter)] || [])
    .some(value => record(value).autoNpcRuleKey && hasMarkedWithdrawals([value]));
}

// Game data: a bank pack holds 42 cells, shown in rows of 7 (G html.js `render_items`:
// `columns = args.columns || 7`, `args.bank ? 42`). The staging row is a pack's last row.
export const BANK_PACK_CELLS = 42;
export const BANK_ROW_CELLS = 7;
export const STAGING_PACK = 'items1';
export const STAGING_FIRST = BANK_PACK_CELLS - BANK_ROW_CELLS;
// The bank sheet and storage.ts's vault unlock read the bank snapshot's access the same way: the
// main floor is always open, and another floor opens once one of its vaults is paid and unlocked
// (gold 0, its pack in the snapshot). keyHeld counts a key's copies in the merchant's bag and the
// bank, which the unlock needs above 0 and the sheet shows.
export function vaultAccess(vaults: readonly { floor: string; gold: number; pack: string }[], packs: Readonly<Record<string, unknown>>, floor: string): boolean {
  return floor === 'bank' || vaults.some(vault => vault.floor === floor && vault.gold === 0 && Object.hasOwn(packs, vault.pack));
}
export function keyHeld(bag: readonly ({ item?: Item | null } | null | undefined)[] | undefined, packs: Readonly<Record<string, readonly ({ item?: Item | null } | null | undefined)[] | undefined>>, key: string): number {
  return [bag, ...Object.values(packs)].flatMap(entries => entries || [])
    .reduce((sum, entry) => sum + (entry?.item?.name === key ? Number(entry.item.q || 1) : 0), 0);
}
/** A cell of the staging row: the last row of `items1`, the second free vault (storage.ts's staging row). */
export const stagingCell = (pack: unknown, slot: unknown): boolean => pack === STAGING_PACK && Number(slot) >= STAGING_FIRST;

// The staging row is held for BankBoi cargo while the account has a BankBoi. The coordinator keeps
// the BankBoi records by name; the dashboard's bank sheet holds them as a list.
export function bankStagingReserved(state: { bankbois?: Record<string, unknown> | readonly unknown[] | null }): boolean {
  return Object.keys(state.bankbois || {}).length > 0;
}

// A copy the player locked (`l`) or a bound copy (`b`) stays where it is, so no offering,
// compound, restock or elixir supply takes it from storage.
export function usableCopy(item: { l?: unknown; b?: unknown } | null | undefined): boolean {
  return !!item && !item.l && !item.b;
}

// The merchant's free bag slots a job may fill. The lucky slot's lock holds its cell while the
// lucky copy is out of it, and the protected free slots (`protectedSlots`) stay free for a visit's
// logistics.
export function freeSlots(items: readonly unknown[] | undefined, luckyLock: number | null | undefined, reserve: number): number {
  if (!Array.isArray(items)) return 0;
  const held = typeof luckyLock === 'number' && !items[luckyLock] ? 1 : 0;
  return Math.max(0, items.filter(entry => !entry).length - held - reserve);
}

// A member's report carries the receipts of the requests it served (upgrades, purchases,
// compounds, withdrawals). Each receipt consumes one matching request, so identical pending
// requests remain distinct.
/** A receipt list, or none. */
export function receiptList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export function consumeReceipts(pending: unknown[] | undefined, receipts: unknown[]): void {
  for (const receipt of receipts) {
    const encoded = JSON.stringify(receipt);
    const index = (pending || []).findIndex((entry) => JSON.stringify(entry) === encoded);
    if (index >= 0) pending!.splice(index, 1);
  }
}

// ---------------------------------------------------------------------------------------------
// The stack plan both runtimes read: a bank cell a deposit may top up, and the next merge. (from runtime/bank-stacks.ts)
/** Partial server observations can contain newer IDs and properties than upstream. */
export interface StackItem extends Pick<ItemInfo, 'q' | 'level'> {
  name?: string;
  [key: string]: unknown;
}
export interface StackLocation { pack: string; slot: number; item?: StackItem | null }
export interface StackProtection {
  staging?: boolean;
  locations: { pack?: string; slot?: number }[];
  items: { name: string; level?: number }[];
  error?: string;
}
export function stackProtected(location: StackLocation, protection: StackProtection): boolean {
  return !!protection.error || (protection.staging !== false && stagingCell(location.pack, location.slot)) ||
    !!location.item?.b || !!location.item?.l || location.item?.name === 'placeholder' ||
    protection.locations.some(mark => mark.pack === location.pack && (mark.slot === undefined || mark.slot === location.slot)) ||
    protection.items.some(item => item.name === location.item?.name && (item.level || 0) === (location.item?.level || 0));
}
export function stackLocations(bank: Record<string, unknown>, protection: StackProtection): StackLocation[] {
  return Object.keys(bank).filter(pack => isVaultPack(pack) && Array.isArray(bank[pack]))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
    .flatMap(pack => Array.from({ length: BANK_PACK_CELLS }, (_, slot) => ({ pack, slot, item: (bank[pack] as (StackItem | null)[])[slot] })))
    .filter(location => !stackProtected(location, protection));
}
// Two piles merge by the game's `can_stack` (the pinned client's old_common_functions.js:
// 407-419); a plan without the game's call reads sameStack, the pile key with the account-bound
// (`acl`) flag and the past titles (`ps`) agreeing. A locked pile is protected above, as the
// game stacks none.
export type StackCompatible = (target: StackItem, source: StackItem) => boolean;
export const sameStack: StackCompatible = (a, b) => stackKey(a) === stackKey(b) && !!a.acl === !!b.acl &&
  JSON.stringify(a.ps || []) === JSON.stringify(b.ps || []);
/** Capacity is allocated over all partial stacks before considering empty slots. */
export function stackDepositPlan(item: StackItem, limit: number, locations: StackLocation[], compatible: StackCompatible = sameStack) {
  let remaining = stackQuantity(item);
  const moves: (StackLocation & { quantity: number })[] = [];
  const partials = locations.filter(location => location.item && limit > 1 &&
    compatible(location.item, item) && stackQuantity(location.item) < limit);
  for (const location of [...partials, ...locations.filter(location => !location.item)]) {
    const quantity = Math.min(remaining, Math.max(0, limit - stackQuantity(location.item)));
    if (quantity) moves.push({ ...location, quantity });
    remaining -= quantity;
    if (!remaining) break;
  }
  return { moves, remaining };
}
export function nextStackMerge(locations: StackLocation[], limitOf: (item: StackItem) => number, compatible: StackCompatible = sameStack) {
  for (let a = 0; a < locations.length; a++) {
    const target = locations[a], limit = target.item ? limitOf(target.item) : 1;
    if (!target.item || limit <= stackQuantity(target.item)) continue;
    for (let b = locations.length - 1; b > a; b--) {
      const source = locations[b];
      if (source.item && compatible(target.item, source.item))
        return { source, target, quantity: Math.min(stackQuantity(source.item), limit - stackQuantity(target.item)) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The copies a compound rule leaves for storage once its triplets are held. (from runtime/compound-storage.ts)
type Entries = readonly (InventoryEntry | null | undefined)[];
/** Stock must already exclude locked/reserved/conflicting items. Keep complete batches local. */
export function compoundStorageLeftovers(rules: readonly CompoundRule[], inventory: Entries, stock: Entries): InventoryEntry[] {
  const eligible = (entry: InventoryEntry | null | undefined, rule: CompoundRule) =>
    !!entry?.item && !entry.item.l && entry.item.name === rule.name && Number(entry.item.level || 0) < Number(rule.targetTier || 1);
  const retained = new Set<InventoryEntry>(), pending = new Set<InventoryEntry>();
  for (const rule of rules.filter(value => Number(value.quantity) !== 0)) {
    for (let level = 0; level < Number(rule.targetTier || 1); level++) {
      const matches = (entry: InventoryEntry | null | undefined): entry is InventoryEntry => eligible(entry, rule) && Number(entry!.item!.level || 0) === level;
      const local = inventory.filter(matches), complete = Math.floor(stock.filter(matches).length / COMPOUND_INPUTS) * COMPOUND_INPUTS;
      local.forEach(entry => pending.add(entry));
      local.slice(0, complete).forEach(entry => retained.add(entry));
    }
  }
  return [...pending].filter(entry => !retained.has(entry));
}

// ---------------------------------------------------------------------------------------------
// The craft and delivery claims: the stock a craft or delivery has not reserved. (from runtime/craft-reservations.ts)
export interface CraftNeed { id: string; level?: number; quantity: number }
export interface DeliveryReservation { location: string; slot?: number; item: Item }
export interface CraftProtection { deliveries?: DeliveryReservation[]; requirements: CraftNeed[]; allocations?: (CraftNeed & {location: string})[]; error?: string }
interface Entry { item?: Item | null; craftLocation?: string; [key: string]: unknown }
/** Apply quantity reservations in source preference order; copies are consumed only once. */
export function availableCraftStock<T extends Entry>(entries: readonly (T | null | undefined)[], protection: CraftProtection): (T | null)[] {
  if (protection.error) return entries.map(() => null);
  entries = withoutDeliveryStock(entries, protection.deliveries || []);
  const remaining = new Map<string, number>();
  for (const need of protection.requirements) {
    const key = exchangeKey(need.id, need.level);
    remaining.set(key, (remaining.get(key) || 0) + need.quantity);
  }
  const amounts = entries.map(entry => entry?.item ? Number(entry.item.q) || 1 : 0);
  function reserve(index: number, requested: number): number {
    const item = entries[index]?.item;
    if (!item) return 0;
    const key = exchangeKey(item.name, item.level);
    const reserved = Math.min(remaining.get(key) || 0, amounts[index], requested);
    remaining.set(key, (remaining.get(key) || 0) - reserved);
    amounts[index] -= reserved;
    return reserved;
  }
  // Preserve the allocated source before considering relocation. Otherwise an
  // auto-compound withdrawal could become newly reserved on arrival in the bag.
  for (const allocation of protection.allocations || []) {
    let needed = allocation.quantity;
    entries.forEach((entry, index) => {
      if (entry?.craftLocation === allocation.location && entry.item?.name === allocation.id &&
          (entry.item.level || 0) === (allocation.level || 0)) needed -= reserve(index, needed);
    });
  }
  entries.forEach((_entry, index) => reserve(index, Infinity));
  return entries.map((entry, index) => {
    if (!entry?.item) return entry || null;
    const item = entry.item, quantity = amounts[index];
    const reserved = (Number(item.q) || 1) - quantity;
    if (!reserved) return entry;
    return quantity ? {...entry, item: {...item, q: quantity}} : null;
  });
}

/** Reserve exact slots first, then relocate distinct matching copies within their owner. */
export function withoutDeliveryStock<T extends Entry>(entries: readonly (T | null | undefined)[], marks: DeliveryReservation[]): (T | null)[] {
  const used = new Set<number>(), assigned = new Set<DeliveryReservation>();
  const matches = (entry: T | null | undefined, mark: DeliveryReservation) =>
    entry?.craftLocation === mark.location && markMatches(entry.item, mark.item);
  function reserve(mark: DeliveryReservation, exact: boolean) {
    const index = entries.findIndex((entry, i) => !used.has(i) && matches(entry,mark) && (!exact || entry?.slot === mark.slot));
    if (index >= 0) { used.add(index); assigned.add(mark); }
  }
  for (const mark of marks) if (mark.slot !== undefined) reserve(mark,true);
  for (const mark of marks) if (!assigned.has(mark)) reserve(mark,false);
  return entries.map((entry,index) => used.has(index) ? null : entry || null);
}

// The lucky slot evidence: each character's roll streams and the search over them. (from runtime/lucky-slot-tracking.ts)
// A lucky slot is a cell of the base bag, so the search runs over BASE_INVENTORY_SIZE cells. The search names a slot, or rules one
// out, at this posterior confidence, and only once the slot holds this many rolls, so one high roll never decides it. Both are the
// earlier console's model parameters (runtime/lucky-slot-tracking.ts).
export const LUCKY_CONFIDENCE = 0.999;
export const LUCKY_EVIDENCE_ROLLS = 100;
export interface SlotRollStatistics {
  totalRolls: number;
  sumRolls: number;
  rollsAbove96_3: number;
  perfectRolls: number;
}
/** Observations are evidence for comparison, never a verified private server slot. */
export interface LuckySlotTracking {
  version: 1;
  streamId?: string;
  cursor?: { slot: number; at: number; rolls: number };
  slots: Record<string, SlotRollStatistics>;
}
export type LuckySlotStreams = Record<string, LuckySlotTracking>;
export type LuckySlotHistory = Record<string, LuckySlotStreams>;
export function mergeSlotStream(previous: LuckySlotTracking, incoming: LuckySlotTracking): boolean {
  let changed = false;
  for (const [slot, stats] of Object.entries(incoming.slots)) {
    const old = previous.slots[slot];
    if (old && (stats.totalRolls <= old.totalRolls ||
      !(['sumRolls', 'rollsAbove96_3', 'perfectRolls'] as const).every(key => stats[key] >= old[key]))) continue;
    previous.slots[slot] = {...stats};
    changed = true;
  }
  if (incoming.cursor && (!previous.cursor || incoming.cursor.rolls > previous.cursor.rolls)) {
    previous.cursor = {...incoming.cursor};
    changed = true;
  }
  return changed;
}
export const emptyRolls = (): SlotRollStatistics => ({totalRolls: 0, sumRolls: 0, rollsAbove96_3: 0, perfectRolls: 0});
export function validSlotStatistics(value: unknown): value is SlotRollStatistics {
  if (!value || typeof value !== 'object') return false;
  const stats = value as SlotRollStatistics;
  return Number.isSafeInteger(stats.totalRolls) && stats.totalRolls > 0 &&
    Number.isFinite(stats.sumRolls) && stats.sumRolls >= 0 && stats.sumRolls < stats.totalRolls &&
    [stats.rollsAbove96_3, stats.perfectRolls].every(n => Number.isSafeInteger(n) && n >= 0 && n <= stats.totalRolls) &&
    stats.rollsAbove96_3 + stats.perfectRolls <= stats.totalRolls;
}
export function normalizeSlotTracking(raw: unknown): LuckySlotTracking {
  const result: LuckySlotTracking = {version: 1, slots: {}};
  if (!raw || typeof raw !== 'object' || !('slots' in raw) || !raw.slots || typeof raw.slots !== 'object') return result;
  result.streamId = readStreamId(raw);
  for (const [slot, stats] of Object.entries(raw.slots)) {
    if (/^(?:0|[1-9]\d*)$/.test(slot) && Number(slot) < BASE_INVENTORY_SIZE && validSlotStatistics(stats)) result.slots[slot] = {...stats};
  }
  restoreCursor(result, raw);
  return result;
}
function restoreCursor(result: LuckySlotTracking, raw: object): void {
  if ('cursor' in raw && validCursor(raw.cursor, result)) result.cursor = {...raw.cursor};
}
function validCursor(value: unknown, tracking: LuckySlotTracking): value is NonNullable<LuckySlotTracking['cursor']> {
  if (!value || typeof value !== 'object') return false;
  const cursor = value as NonNullable<LuckySlotTracking['cursor']>;
  const rolls = Object.values(tracking.slots).reduce((sum, stats) => sum + stats.totalRolls, 0);
  return Number.isInteger(cursor.slot) && cursor.slot >= 0 && cursor.slot < BASE_INVENTORY_SIZE &&
    Number.isFinite(cursor.at) && cursor.at >= 0 && Number.isSafeInteger(cursor.rolls) && cursor.rolls > 0 && cursor.rolls <= rolls;
}
function readStreamId(raw: object): string | undefined {
  return 'streamId' in raw && typeof raw.streamId === 'string' && /^[a-z0-9]{1,30}-[a-z0-9-]{1,60}$/.test(raw.streamId) ? raw.streamId : undefined;
}
/** Independent durable client streams prevent replays and native/headless moves
 * from either double-counting old rolls or dropping another client's evidence. */
export function aggregateSlotTracking(streams: LuckySlotStreams = {}, local?: LuckySlotTracking): LuckySlotTracking {
  const combined = {...streams};
  if (local?.streamId) {
    const merged = normalizeSlotTracking(combined[local.streamId]);
    mergeSlotStream(merged, local);
    combined[local.streamId] = merged;
  }
  const slots: LuckySlotTracking['slots'] = {};
  for (const stream of Object.values(combined)) for (const [slot, stats] of Object.entries(stream.slots)) {
    const total = slots[slot] ??= emptyRolls();
    for (const key of ['totalRolls', 'sumRolls', 'rollsAbove96_3', 'perfectRolls'] as const) total[key] += stats[key];
  }
  const cursor = Object.values(combined).flatMap(stream => stream.cursor ? [stream.cursor] : [])
    .sort((a, b) => b.at - a.at || b.rolls - a.rolls || a.slot - b.slot)[0];
  return {version: 1, slots, ...(cursor ? {cursor: {...cursor}} : {})};
}
// Source: kaansoral/adventureland_mongodb node/server.js, upgrade handler. 60% of a lucky slot's
// rolls take max(U/10000, 0.975*R - 0.012), the rest a uniform R. q_data exposes floor(R*10000) as
// LUCKY_ROLL_DIGITS digits.
export const LUCKY_ROLL_DIGITS = 4;
const LUCKY_SCALE = 0.975, LUCKY_SHIFT = 0.012;
// The top of the lucky line 0.975*R - 0.012 as R nears 1. The bucket above it starts at 0.9631,
// which a lucky slot reaches only through its uniform rolls.
export const LUCKY_HIGH_ROLL = LUCKY_SCALE - LUCKY_SHIFT;
const normal = [0.0001, 0.0369, LUCKY_HIGH_ROLL];
const luckyZero = 0.4 * 0.0001 + 0.6 * (0.0121 / 0.975);
const luckyHigh = 0.4 * 0.0369;
const lucky = [luckyZero, luckyHigh, 1 - luckyZero - luckyHigh];
export function slotLogEvidence(stats?: SlotRollStatistics): number {
  if (!stats) return 0;
  const counts = [stats.perfectRolls, stats.rollsAbove96_3, stats.totalRolls - stats.perfectRolls - stats.rollsAbove96_3];
  return counts.reduce((sum, count, index) => sum + count * Math.log(lucky[index]! / normal[index]!), 0);
}
function slotPosterior(tracking: LuckySlotTracking) {
  const ranked = Array.from({length: BASE_INVENTORY_SIZE}, (_, slot) => ({slot, score: slotLogEvidence(tracking.slots[slot]), samples: tracking.slots[slot]?.totalRolls || 0}))
    .sort((a, b) => b.score - a.score || a.samples - b.samples || a.slot - b.slot);
  const best = ranked[0]!;
  const denominator = ranked.reduce((sum, entry) => sum + Math.exp(entry.score - best.score), 0);
  return ranked.map(entry => {
    const probability = Math.exp(entry.score - best.score) / denominator;
    const eliminationConfidence = 1 - probability;
    return {...entry, probability, eliminationConfidence,
      ruledOut: entry.samples >= LUCKY_EVIDENCE_ROLLS && eliminationConfidence >= LUCKY_CONFIDENCE};
  });
}
export function luckySlotSearch(tracking: LuckySlotTracking) {
  const ranked = slotPosterior(tracking);
  const best = ranked[0]!;
  const confidence = best.probability;
  const total = ranked.reduce((sum, entry) => sum + entry.samples, 0);
  const inferred = confidence >= LUCKY_CONFIDENCE && best.samples >= LUCKY_EVIDENCE_ROLLS;
  let nextSlot = tracking.cursor?.slot ?? 0;
  if (inferred) nextSlot = best.slot;
  else {
    const ruledOut = new Set(ranked.filter(entry => entry.ruledOut).map(entry => entry.slot));
    // Keep the persisted cursor intact so new evidence can restore candidates.
    // Bound the scan even if a future model rules out every square.
    for (let offset = 0; offset < BASE_INVENTORY_SIZE; offset++) {
      const candidate = ((tracking.cursor?.slot ?? 0) + offset) % BASE_INVENTORY_SIZE;
      if (!ruledOut.has(candidate)) { nextSlot = candidate; break; }
    }
  }
  return {slot: total ? best.slot : null, confidence, samples: best.samples, total,
    inferred, nextSlot, slots: Object.fromEntries(ranked.map(entry => [entry.slot, entry])),
    ruledOutCount: ranked.filter(entry => entry.ruledOut).length};
}

// ---------------------------------------------------------------------------------------------
// The ignored market items and the listing freshness the dashboard filters by. (from runtime/market-preferences.ts)
/** A market item's name and level. ALData can list names absent from the installed catalog
 * . */
export type MarketItemIdentity = Pick<ItemInfo,'level'> & {name:string};
/** Saved display preference: an omitted native level is normalized to +0. */
export type MarketIgnoredItem = Required<MarketItemIdentity>;
// The stand sheet hides an ALData listing last seen longer ago than this, the earlier
// console's window (runtime/market-preferences.ts:8-10; answer A keeps it).
export const MARKET_LISTING_FRESH_MS = 120_000;
export function marketListingFresh(seenAt:number|undefined,now:number){
  return typeof seenAt==='number'&&Number.isFinite(seenAt)&&seenAt>=now-MARKET_LISTING_FRESH_MS;
}

// ---------------------------------------------------------------------------------------------
// The upgrade estimate: the game's upgrade chances over a batch, for orders and the dashboard. (from runtime/upgrade-estimate.ts)
// caracAL executes this module behind a contextified global proxy. Resolve
// unchanged Math intrinsics once, so no random roll crosses it.
const {max: mathMax, min: mathMin, floor: mathFloor, imul: mathImul, ceil: mathCeil} = Math;
/** Catalog subset; unobservable server/player-wide grace is deliberately omitted. */
export interface UpgradeChoice {
  id: string;
  cost: number;
  upgradeable?: boolean;
  upgradeGrade?: number;
  upgradeChances?: number[];
  grades?: number[];
  scrollCosts?: number[];
}
export type UpgradeEstimate =
  | {
      status: "available";
      attempts: number;
      gold: number;
      scrolls: number[];
      completed: number;
      rolls: number;
    }
  | { status: "unavailable"; completed: number; rolls: number };
// The game's base upgrade odds per item grade, D.upgrades from design/upgrades.js at the pinned
// game commit (tools/sim/pins.json). The server keeps D apart from G (node/server.js:556-562), so
// no client reads it; index 0 is the +0 an item starts at. The catalog and the estimate read it.
export const UPGRADE_CHANCES = [
  [1, 0.9999999, 0.98, 0.95, 0.7, 0.6, 0.4, 0.25, 0.15, 0.07, 0.024, 0.14, 0.11],
  [1, 0.99998, 0.97, 0.94, 0.68, 0.58, 0.38, 0.24, 0.14, 0.066, 0.018, 0.13, 0.1],
  [1, 0.97, 0.94, 0.92, 0.64, 0.52, 0.32, 0.232, 0.13, 0.062, 0.015, 0.12, 0.09],
];
export function highestUpgradeLevel(choice: UpgradeChoice) {
  if (!choice.upgradeable) return 0;
  const chances =
    choice.upgradeChances ||
    UPGRADE_CHANCES[mathMax(0, mathMin(2, mathFloor(choice.upgradeGrade || 0)))]!;
  let level = 0;
  while (level + 1 < chances.length && Number(chances[level + 1]) > 0) level++;
  return level;
}
export function upgradeEstimateKey(choice: UpgradeChoice, quantity: number, target: number) {
  return JSON.stringify([
    choice.id,
    choice.cost,
    choice.upgradeable,
    choice.upgradeGrade,
    choice.upgradeChances,
    choice.grades,
    choice.scrollCosts,
    quantity,
    target,
  ]);
}
export interface EstimateLine {
  choice: UpgradeChoice;
  quantity: number;
  target: number;
}
// The estimate's model parameters, the previous release's (runtime/upgrade-estimate.ts). Each
// estimate runs ESTIMATE_RUNS seeded simulations and quotes the ESTIMATE_QUANTILE cost among
// them; with fewer than ESTIMATE_RUNS_MIN finished runs it answers "unavailable". One batch
// spends at most ESTIMATE_ROLL_BUDGET rolls and yields to the renderer or the coordinator's I/O
// every ESTIMATE_YIELD_ROLLS rolls, and the last ESTIMATE_CACHE_BATCHES finished batches are
// cached. Each of the three caps reaching its limit is normal operation: the caller passes its
// runtime's `capReached` as `cut`, and a finished batch counts its yields, a budget that ran out and
// an evicted batch once each.
const ESTIMATE_RUNS = 3000;
const ESTIMATE_RUNS_MIN = 30;
export const ESTIMATE_QUANTILE = 0.9;
const ESTIMATE_ROLL_BUDGET = 60_000_000;
const ESTIMATE_YIELD_ROLLS = 32768;
const ESTIMATE_CACHE_BATCHES = 256;
export type EstimateCap = 'ESTIMATE_ROLL_BUDGET' | 'ESTIMATE_YIELD_ROLLS' | 'ESTIMATE_CACHE_BATCHES';
interface EstimateBudget { remaining: number; signal?: AbortSignal; yieldToIO(): Promise<void>; yields: number }
const cache = new Map<string, UpgradeEstimate[]>();
let scheduler: Promise<unknown> = Promise.resolve();
/** Canonical ordering makes dashboard/server estimates independent of cart order.
 * Cache only complete batches; cancelled edits cannot poison later estimates. */
export function estimateUpgradeBatch(
  lines: EstimateLine[],
  signal: AbortSignal | undefined,
  // Each runtime yields to its own I/O: the coordinator through its run scope, the dashboard
  // through the browser's timer, so rules.ts names no timer of either.
  yieldToIO: () => Promise<void>,
  cut?: (cap: EstimateCap, owner: '10', count: number) => void,
): Promise<UpgradeEstimate[]> {
  const sorted = lines
    .map((line, index) => ({
      line,
      index,
      key: upgradeEstimateKey(line.choice, line.quantity, line.target),
    }))
    .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const key = JSON.stringify(sorted.map((entry) => entry.key));
  const task = scheduler.then(async () => {
    signal?.throwIfAborted();
    let results = cache.get(key);
    if (!results) {
      const budget: EstimateBudget = { remaining: ESTIMATE_ROLL_BUDGET, signal, yieldToIO, yields: 0 };
      results = [];
      for (const entry of sorted) {
        signal?.throwIfAborted();
        results.push(
          await simulate(entry.line.choice, entry.line.quantity, entry.line.target, budget),
        );
      }
      if (budget.yields) cut?.('ESTIMATE_YIELD_ROLLS', '10', budget.yields);
      if (!budget.remaining) cut?.('ESTIMATE_ROLL_BUDGET', '10', 1);
      if (cache.size >= ESTIMATE_CACHE_BATCHES) {
        cache.delete(cache.keys().next().value!);
        cut?.('ESTIMATE_CACHE_BATCHES', '10', 1);
      }
      cache.set(key, results);
    }
    const output: UpgradeEstimate[] = [];
    sorted.forEach((entry, index) => {
      output[entry.index] = results![index]!;
    });
    return output;
  });
  scheduler = task.catch(() => {});
  return task;
}
/** One deterministic batch of ESTIMATE_RUNS runs inside the batch's roll budget. A run the budget
 * cuts off is discarded. */
async function simulate(
  choice: UpgradeChoice,
  quantity: number,
  target: number,
  budget: EstimateBudget,
): Promise<UpgradeEstimate> {
  if (!target || !choice.upgradeable)
    return {
      status: "available",
      attempts: quantity,
      gold: choice.cost * quantity,
      scrolls: [],
      completed: ESTIMATE_RUNS,
      rolls: 0,
    };
  if (target > highestUpgradeLevel(choice))
    return { status: "unavailable", completed: 0, rolls: 0 };
  const policy = simulationPolicy(choice, target);
  let seed = 2166136261;
  for (const char of `${choice.id}:${quantity}:${target}`)
    seed = mathImul(seed ^ char.charCodeAt(0), 16777619);
  function random() {
    seed += 0x6d2b79f5;
    let value = seed;
    value = mathImul(value ^ (value >>> 15), value | 1);
    value ^= value + mathImul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
  const runs: { attempts: number; gold: number; scrolls: number[] }[] = [];
  const startBudget = budget.remaining;
  simulation: for (let run = 0; run < ESTIMATE_RUNS; run++) {
    const grace = Array<number>(20).fill(0),
      scrolls = [0, 0, 0, 0];
    let attempts = 0,
      successes = 0;
    while (successes < quantity) {
      attempts++;
      const attempt = upgradeOne(policy, grace, scrolls, random, budget);
      const survived = attempt === null || typeof attempt === 'boolean' ? attempt : await attempt;
      if (survived === null) break simulation;
      if (survived) successes++;
    }
    runs.push({
      attempts,
      gold:
        attempts * choice.cost +
        scrolls.reduce((sum, count, grade) => sum + count * (policy.costs[grade] || 0), 0),
      scrolls,
    });
  }
  const rolls = startBudget - budget.remaining;
  if (runs.length < ESTIMATE_RUNS_MIN) return { status: "unavailable", completed: runs.length, rolls };
  runs.sort((a, b) => a.gold - b.gold);
  return {
    status: "available",
    ...runs[mathCeil(runs.length * ESTIMATE_QUANTILE) - 1]!,
    completed: runs.length,
    rolls,
  };
}
function simulationPolicy(choice: UpgradeChoice, target: number) {
  const grade = mathMax(0, mathMin(2, mathFloor(choice.upgradeGrade || 0)));
  // The item's grace by grade, the server's own (node/server_functions.js:46-52 sets `igrace`).
  const igrace = [1, -1, -2][grade]!, chances = choice.upgradeChances || UPGRADE_CHANCES[grade]!;
  return {
    target,
    // Grace changes only in integer steps and its chance bonus saturates at 14.
    // Evaluate the original formula once for each reachable input, exactly.
    rollChances: Array.from({length:target+1}, (_, level) => level === 0 ? [] :
      Array.from({length:15}, (_, grace) => rollChance(chances[level] || 0, level, grace, igrace))),
    grades: choice.grades || [9, 10, 11, 12],
    costs: choice.scrollCosts || [1000, 40000, 1600000, 64000000],
  };
}
function scrollGrade(level: number, grades: number[]) {
  if (level >= (grades[2] ?? 11)) return 3;
  if (level >= (grades[1] ?? 10)) return 2;
  return level >= (grades[0] ?? 9) ? 1 : 0;
}
function rollChance(base: number, level: number, grace: number, igrace: number) {
  const count = mathMax(0, mathMin(level + 1, mathMin(3, grace / 4.5) + igrace));
  let bonus = (base * count) / level + count / 1000;
  bonus = mathMax(0, bonus / 4.8 - 0.4 / (level - 0.999) ** 2);
  return mathMin(base + bonus, mathMin(base + 0.24, base * 2));
}
function failedGrace(grace: number[], level: number) {
  grace[level - 1]!++;
  grace[level]!++;
  if (level >= 8 && level <= 15) {
    grace[level - 1]!++;
    grace[level - 2]! += 2;
    grace[level - 3]! += 2;
  }
}
function upgradeOne(
  policy: ReturnType<typeof simulationPolicy>,
  grace: number[],
  scrolls: number[],
  random: () => number,
  budget: EstimateBudget,
  level = 1,
  resumed = false,
): boolean | null | Promise<boolean | null> {
  for (; level <= policy.target; level++) {
    if (!budget.remaining) return null;
    if (!resumed && budget.remaining % ESTIMATE_YIELD_ROLLS === 0) {
      budget.yields++;
      return budget.yieldToIO().then(() => {
        budget.signal?.throwIfAborted();
        return upgradeOne(policy, grace, scrolls, random, budget, level, true);
      });
    }
    resumed = false;
    budget.remaining--;
    scrolls[scrollGrade(level - 1, policy.grades)]!++;
    const graceCount = grace[level]!;
    if (random() <= policy.rollChances[level]![graceCount >= 14 ? 14 : graceCount]!)
      grace[level] = 0;
    else {
      failedGrace(grace, level);
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// The offering rules: which offering an upgrade uses at a level, inside the offered levels. (from runtime/upgrade-offerings.ts)
/** Offering rules are application policy, independent of an item's starting upgrade mark. */
export const upgradeOfferings = {
  offeringp: 'Primling', offering: 'Primordial Essence', offeringx: 'Primordial X',
} as const;
export type UpgradeOffering = keyof typeof upgradeOfferings;
export interface UpgradeOfferingRule {
  id: string;
  name: string;
  floor: number;
  ceiling: number;
  offering: UpgradeOffering;
  required: boolean;
}
export function isUpgradeOffering(value: unknown): value is UpgradeOffering {
  return typeof value === 'string' && Object.hasOwn(upgradeOfferings, value);
}
export function offeringRule(rules: readonly UpgradeOfferingRule[], name: string, level: number) {
  return rules.find(rule => rule.name === name && rule.floor <= level && level < rule.ceiling);
}
/** Explicit selections override policy for their single attempt. */
export function resolveUpgradeOffering(rules: readonly UpgradeOfferingRule[], name: string, level: number, explicit?: UpgradeOffering) {
  return explicit ? {offering: explicit, required: true} : offeringRule(rules, name, level);
}
export function offeringOverlap(rules: readonly UpgradeOfferingRule[], next: UpgradeOfferingRule) {
  return rules.find(rule => rule.id !== next.id && rule.name === next.name && rule.floor < next.ceiling && next.floor < rule.ceiling);
}
// The offering dialog and the items owner's rule write judge a new rule here, in the dialog's words: an overlap
// with another rule of the item first, then a range that does not climb or passes `maximum`, the
// item's top level the caller reads. `conflict` marks the overlap, which the write answers 409.
export function offeringProblem(rules: readonly UpgradeOfferingRule[], rule: UpgradeOfferingRule, maximum: number): { error: string; conflict: boolean } | null {
  const overlap = offeringOverlap(rules, rule);
  if (overlap) return { error: `There is already a rule that covers +${overlap.floor} to +${overlap.ceiling}.`, conflict: true };
  return rule.floor >= rule.ceiling || rule.ceiling > maximum ? { error: 'Choose a higher destination level.', conflict: false } : null;
}

export function validOfferingRule(value: unknown): value is UpgradeOfferingRule {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Partial<UpgradeOfferingRule>;
  return typeof rule.id === 'string' && !!rule.id && typeof rule.name === 'string' && !!rule.name &&
    isUpgradeOffering(rule.offering) && typeof rule.required === 'boolean' && validOfferingRange(rule);
}
// A rule covers the upgrades from `floor` up to the destination `ceiling`, and the highest
// destination an offering reaches is the game's top upgrade level, UPGRADE_LEVEL_MAX. The server
// refuses a scroll upgrade whose new level has no row in its upgrade table, which ends at +12
// (G node/server.js `upgrade` handler, `D.upgrades[igrade][new_level]`; design/upgrades.js), and
// takes an offering alone only on a +0 item. The dashboard's rule dialog reads the same level
// (maximumItemLevel).
function validOfferingRange(rule: Partial<UpgradeOfferingRule>): boolean {
  return Number.isSafeInteger(rule.floor) && Number.isSafeInteger(rule.ceiling) &&
    Number(rule.floor) >= 0 && Number(rule.floor) < Number(rule.ceiling) && Number(rule.ceiling) <= UPGRADE_LEVEL_MAX;
}
// An older console saved and exported ceilings up to +13. A ceiling past the top level reads as the
// top level, since no offering upgrade starts at +12, and a rule that then covers no upgrade leaves.
// The offering command fits the saved list before it writes, and the import fits the file's list
// (saved-fields.ts `fit`).
export function fitOfferingRules(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.flatMap(rule => {
    if (!rule || typeof rule !== 'object' || !Number.isSafeInteger(rule.ceiling) || rule.ceiling <= UPGRADE_LEVEL_MAX) return [rule];
    const fitted = { ...rule, ceiling: UPGRADE_LEVEL_MAX };
    return Number(fitted.floor) < UPGRADE_LEVEL_MAX ? [fitted] : [];
  });
}
export function validOfferingRules(value: unknown): value is UpgradeOfferingRule[] {
  if (!Array.isArray(value) || !value.every(validOfferingRule)) return false;
  return new Set(value.map(rule => rule.id)).size === value.length && !value.some(rule => offeringOverlap(value,rule));
}

// ---------------------------------------------------------------------------------------------
// The upgrade preview shapes: the game's chance reply and the preview options. (from runtime/upgrade-preview.ts)
/** Official previews omit offering without an offering, and include calculate.
 * Item/scroll IDs may be newer than typed-adventureland 0.0.57. */
export type UpgradeServerPreview = Omit<GameResponseDataUpgradeChance, 'item' | 'scroll' | 'offering' | 'response'> & {
  calculate: true;
  response?: 'upgrade_chance';
  item: Item;
  scroll: string;
  offering?: string;
};
export const previewOptions = ['none', 'offeringp', 'offering', 'offeringx'] as const;
export type PreviewOption = 'none' | UpgradeOffering;
export interface UpgradePreviewRequest {
  id: string;
  executor: string;
  session: string;
  slot: number;
  item: Item;
}
export type PreviewResult = { preview: UpgradeServerPreview; observedAt: number } | { reason: string };
export interface UpgradePreviewResult {
  executor: string;
  item: Item;
  options: Record<PreviewOption, PreviewResult>;
}
export function unavailablePreview(executor: string, item: Item, reason: string): UpgradePreviewResult {
  return { executor, item, options: Object.fromEntries(previewOptions.map(option => [option, { reason }])) as UpgradePreviewResult['options'] };
}

// ---------------------------------------------------------------------------------------------
// 3.3's restock claim: a character's hp, mp and elixir supply ranges. (from runtime/restock-policy.ts, 1.22)
/** Saved restock settings and client protocol, independent of native game objects. */
export interface SupplyPolicy { item: string; min: number; max: number }
export interface ElixirPolicy extends SupplyPolicy { autoConsume: boolean; autoAcquire: boolean }
export interface RestockPolicy { hp: SupplyPolicy; mp: SupplyPolicy; elixir?: ElixirPolicy }

// The card line's words for the items owner's trips, unchanged: at the bank the trip reads "Banking"
// or "Stocking up", elsewhere "Travelling to bank".
export function tripLabel(stocking: boolean, atBank: boolean): string {
  return atBank ? (stocking ? 'Stocking up' : 'Banking') : 'Travelling to bank';
}

// The bag errand each reader waits out: a reader's errand is any of its row's bag facts. A
// reader's facts from other owners (movement's walk, the survival owner's escape, the merchant jobs owner's runner) stay in that
// reader's own rule. Each row keeps the subset its reader read in shared.js at an earlier build.
export type ErrandFact = 'banking' | 'bankQueued' | 'stocking' | 'upgrading' | 'previewing' | 'tidying' | 'lucky' | 'inventoryCommand';
export const ERRAND_ROWS = {
  // The hunting client's busy, the farm walk's bagBusy and the event attendance's errand.
  hunt: ['banking', 'bankQueued', 'stocking', 'upgrading'],
  // The anniversary's merchant errand and the October event's merchantBusy.
  merchantEvent: ['banking', 'upgrading'],
  // The event merchant's errand.
  eventMerchant: ['tidying', 'banking', 'stocking', 'upgrading', 'previewing', 'lucky'],
  // bank.ts bagStill: the stock-up, the elixir and the merchant's tidy.
  bankStill: ['banking', 'bankQueued', 'stocking', 'upgrading', 'tidying', 'lucky'],
  // bank.ts keepTracktrixLast: the Tracktrix pin.
  trackerPin: ['inventoryCommand', 'bankQueued', 'tidying', 'lucky'],
  // Movement's formation spread step (formation.ts separateFromParty).
  formation: ['banking', 'bankQueued', 'stocking'],
} as const satisfies Record<string, readonly ErrandFact[]>;
export type ErrandReader = keyof typeof ERRAND_ROWS;

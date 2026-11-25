// The saved fields of inventory, bank and commerce (10), its declarations for the settings owner
// (11), which builds its table from them at load. They moved from the held block
// runtime/settings/held/10-items.ts with no change to a field. Marks and listings are records: play
// consumes and reconciles them.
import { object, text, number, boolean, mapOf, listOf, item, mark, positive, wholeFrom, type Declarations } from '../settings/api.ts';
import type { declared } from '../settings/coordinator/api.ts';
import type { NativeStandLedger, StandBid, PriceHistory, MerchantBlock, createTransferCommands } from './coordinator/api.ts';
import type { SavedBankState } from './coordinator/storage.ts';
import { fitOfferingRules, validOfferingRules, PROTECTED_FREE_SLOTS_DEFAULT, BASE_INVENTORY_SIZE } from './rules.ts';
import type { ItemMark } from '../coordinator/contracts/item.ts';
import type { ObservedCharacterStatus } from '../status/api.ts';
import type { reconcileUpgradeMarks, createCompoundCommands, createStatScrollCommands, createUpgradeCommands } from './coordinator/production.ts';
import type { createMerchantItemCommands } from './coordinator/market.ts';
import type { MarketIgnoredItem } from './rules.ts';
import type { RestockPolicy, SupplyPolicy } from './rules.ts';

// The restock policy of a character with none saved (the previous release's default): hpot1
// refilled below 5 up to 20, and no mpot1. The restock route fills a missing hp or mp field from
// it, and an elixir's missing range from `elixir`.
export const RESTOCK_DEFAULT: RestockPolicy = { hp: { item: 'hpot1', min: 5, max: 20 }, mp: { item: 'mpot1', min: 0, max: 0 } };
export const RESTOCK_ELIXIR_DEFAULT: Pick<SupplyPolicy, 'min' | 'max'> = { min: 1, max: 2 };

// An ignored market item names an item of 1 to 80 letters, digits or underscores and a whole level
// from 0 to 100: the declaration's check, so the route, a stored value and an import meet one rule.
// The check reads the shape only, as did: ALData lists names the installed catalog lacks (its:3),
// and the player can hide those too (answer A).
function validMarketIgnoredItem(value: unknown): value is MarketIgnoredItem {
  if (!object(value)) return false;
  return typeof value.name === 'string' && /^[a-z0-9_]{1,80}$/i.test(value.name) &&
    typeof value.level === 'number' && Number.isSafeInteger(value.level) && value.level >= 0 && value.level <= 100;
}


const upgrade = (value: unknown) => object(value) && item(value.item) && positive(value.tiers);
const upgradeRule = (value: unknown) => positive(Number(value)) || (object(value) && positive(value.tiers));
const compound = (value: unknown) => object(value) && text(value.id) && listOf(mark)(value.items);
const autoCompound = (value: unknown) => item(value) && object(value) && positive(value.targetTier);

export const itemsSavedFields = {
  name: 'core:items',
  settings: {
    // How often the inbox is read: the game sends no unread mail count in play, so the player sets
    // the period; 30 s is the previous release's. A send or a collect also reads it when it ends.
    mailCheckSeconds: { label: 'Check mail every (seconds)', kind: 'number', min: 1, default: 30, importable: true },
    // Kept safety bounds (the numbers rule, 2026-11-13; bigcheck/bounds.md). Each guards against a
    // server outside the console that never answers, ends the wait and tells the status owner's bound
    // record. None has game data or a measurement, so each keeps the previous release's value.
    // An ALData request that never answers.
    aldataRequestBoundMs: { label: 'ALData request bound (ms)', kind: 'number', min: 1, default: 20_000, hidden: true, check: wholeFrom(1, Infinity) },
    // A game mail API request that never answers.
    mailRequestBoundMs: { label: 'Mail request bound (ms)', kind: 'number', min: 1, default: 20_000, hidden: true, check: wholeFrom(1, Infinity) },
    // A BankBoi whose worker never reports working: the game never logs it in, or its realm stays
    // unresolved (the transaction's 600 s).
    bankboiStartBoundMs: { label: 'BankBoi start bound (ms)', kind: 'number', min: 1, default: 600_000, hidden: true, check: wholeFrom(1, Infinity) },
    // The free cells every bag keeps for a visit's logistics (the player asked for a setting
    // for the number of protected free slots; one party-wide value). A whole
    // number from 0; rules.ts `protectedSlotsOf` bounds it by the bag the character's report gives, and each
    // character reads its own count from its reply.
    protectedFreeSlots: { label: 'Protected free slots', kind: 'number', min: 0, default: PROTECTED_FREE_SLOTS_DEFAULT, importable: true,
      check: wholeFrom(0, Number.MAX_SAFE_INTEGER), refusal: 'enter a whole number of free slots from 0 up to the bag size' },
    // An automatic purchase spends only the merchant's and the bank's gold above it.
    goldReserve: { label: 'Gold reserve', kind: 'number', min: 0, default: 0, importable: true },
    threshold: { label: 'Gold collection threshold', kind: 'number', default: 100000, importable: true, check: wholeFrom(0, 1_000_000_000_000),
      refusal: 'invalid threshold', deliver: ['characters', 'dashboard'] },
    // A count of bag copies, so the game's base bag bounds it (G node/server.js:1483). An imported
    // count past the bag reads as the bag, as initialCollectionState's load holds a saved one (the
    // earlier console's import took any positive count); the route still refuses it.
    itemCollectionThreshold: { label: 'Item collection threshold', kind: 'value', default: 1, importable: true, check: wholeFrom(1, BASE_INVENTORY_SIZE),
      fit: value => Number.isSafeInteger(value) && Number(value) > BASE_INVENTORY_SIZE ? BASE_INVENTORY_SIZE : value,
      refusal: 'invalid item collection threshold', deliver: ['dashboard'] },
    buyUpgradeBatchSize: { label: 'Buy and upgrade batch size', kind: 'value', default: 1, importable: true, check: wholeFrom(1, BASE_INVENTORY_SIZE),
      refusal: `invalid upgrade batch size (1–${BASE_INVENTORY_SIZE})`, deliver: ['dashboard'] },
    upgradeOfferingRules: { label: 'Upgrade offering rules', kind: 'value', default: [], importable: true, check: validOfferingRules, fit: fitOfferingRules },
    // The shared rules before the per-character rules; coordinator/fates.ts migrates them at load.
    merchantRules: { label: 'Shared item rules (older layout)', kind: 'value', default: null, check: value => value === null || object(value),
      deliver: ['dashboard'] },
    autoDeconstruction: { label: 'Automatic deconstruction', kind: 'value', default: {}, scope: 'character', importable: true, check: mapOf(mapOf((value) => object(value) && item(value.item))), deliver: ['dashboard'] },
    autoNpcSales: { label: 'Automatic NPC sales', kind: 'value', default: {}, importable: true, check: mapOf((value) => object(value) && item(value.item)), characterKey: 'character', deliver: ['dashboard'] },
    autoStandMarks: { label: 'Automatic stand listings', kind: 'value', default: {}, importable: true, check: mapOf((value) => object(value) && item(value.item) && positive(value.price)), deliver: ['dashboard'] },
    autoExchanges: { label: 'Automatic exchanges', kind: 'value', default: {}, importable: true, check: mapOf(item), deliver: ['dashboard'] },
    autoItemMarks: { label: 'Automatic item marks', kind: 'value', default: {}, scope: 'character', document: 'selections',
      importable: true, check: mapOf(mapOf((value) => value === "bank" || value === "merchant")), deliver: ['dashboard'] },
    autoStandBuys: { label: 'Buy from stands automatically', kind: 'boolean', default: false, deliver: ['dashboard'] },
    autoBlacklistMerchants: { label: 'Block failed merchants automatically', kind: 'boolean',
      default: true, deliver: ['dashboard'] },
    marketIgnoredItems: { label: 'Ignored market items', kind: 'value', default: [] as MarketIgnoredItem[],
      importable: true, check: listOf(validMarketIgnoredItem), refusal: 'Provide an item name and nonnegative whole item level', deliver: ['dashboard'] },
    restockPolicies: { label: 'Restock', kind: 'value', default: {} as Record<string, RestockPolicy>, scope: 'character',
      importable: true, check: mapOf( (value) => object(value) && (!value.elixir || object(value.elixir) && text(value.elixir.item) && number(value.elixir.min) && number(value.elixir.max) && boolean(value.elixir.autoConsume) && boolean(value.elixir.autoAcquire)) && [value.hp, value.mp].every( (p) => object(p) && number(p.min) && number(p.max) && text(p.item), ), ), deliver: ['characters', 'dashboard'] },
    // The weapon the merchant equips between jobs, saved when the player equips one by hand.
    merchantWeapon: { label: 'Merchant weapon', kind: 'value', default: null, check: value => value === null || object(value) && object(value.item),
      deliver: ['characters', 'dashboard'] },
    // The ALData key, a credential in `party.aldata` that the credentials document saves with its
    // authentication (`secret`). An empty key means none was generated yet.
    aldataKey: { label: 'ALData key', kind: 'text', default: '', secret: true, document: 'aldata', path: ['aldata', 'key'] },
    bankSortMode: { label: 'Bank sorting', kind: 'choice', choices: ['automatic', 'request'], default: 'automatic',
      importable: true, check: value => value === "automatic" || value === "request", deliver: ['dashboard-core'] },
  },
  records: {
    // A record: each production receipt consumes a rule's quantity (production.ts
    // `consumeQuotas`), and the player's commands edit it through the items owner's code.
    autoUpgradeMarks: { default: {}, scope: 'character', document: 'selections',
      importable: true, check: mapOf(mapOf(upgradeRule)), deliver: ['dashboard'] },
    production: { default: { attempts: {} } },
    // The stored upgrade previews ride in the dashboard's core read, so an open preview panel reads
    // the preview again when a result lands (upgrade-preview-panel.tsx).
    upgradePreviewResults: { default: {}, deliver: ['dashboard-core'] },
    // The mail inbox and sent list; the items owner holds the inbox (coordinator/mail.ts), so it
    // declares the record. The declaration sat in the status owner's fields.ts, whose import of
    // initialMailbox through items/api.ts closed a bundle cycle that left statusSavedFields
    // undefined.
    mailbox: { default: initialMailbox(undefined) },
    merchantDeliveries: { default: {} as Parameters<typeof createTransferCommands>[0]['merchantDeliveries'], deliver: ['dashboard'] },
    standListings: { default: [], importable: true, check: listOf((value) => object(value) && item(value.item) && positive(value.price)), deliver: ['characters', 'dashboard'] },
    npcSaleMarks: { default: [], importable: true, check: listOf((value) => object(value) && item(value.item) && text(value.id)), characterKey: 'character', deliver: ['dashboard'] },
    deconstructionMarks: { default: [], importable: true, check: listOf((value) => object(value) && item(value.item) && text(value.id) && text(value.owner) && text(value.origin) && number(value.quantity)), characterKey: 'owner', deliver: ['dashboard'] },
    // Part 4: the bag copies an add-on's claim or action holds, by character and slot, which the
    // item-rules slot reads (coordinator/fates.ts `publishAddonFates`).
    addonItemFates: { default: {} as Record<string, Record<number, import('./rules.ts').Fate>>, deliver: ['dashboard'] },
    standBids: { default: {} as Record<string, StandBid>, importable: true, check: mapOf((value) => object(value) && positive(value.price) && positive(value.quantity)), deliver: ['dashboard'] },
    nativeStand: { default: { sequence: 0, offers: {}, problems: {} } as NativeStandLedger, deliver: ['dashboard-core'] },
    standPriceHistory: { default: {} as Record<string, PriceHistory>, liveness: true, deliver: ['dashboard-core'] },
    merchantBlacklist: { default: {} as Record<string, MerchantBlock>, importable: true, check: mapOf(object), deliver: ['dashboard'] },
    upgrades: { default: {}, scope: 'character', importable: true, check: mapOf(listOf(upgrade)), deliver: ['dashboard'] },
    compounds: { default: {}, scope: 'character', importable: true, check: mapOf(listOf(compound)), deliver: ['dashboard'] },
    autoCompounds: { default: {}, scope: 'character', importable: true, check: mapOf(listOf(autoCompound)), deliver: ['dashboard'] },
    luckyUpgradeSlots: { default: {}, deliver: ['characters', 'dashboard-core'] },
    luckySlotResume: { default: {}, deliver: ['characters', 'dashboard-core'] },
    luckySlotTracking: { default: {}, deliver: ['characters', 'dashboard-core'] },
    luckySlotCharacterIds: { default: {}, deliver: ['characters'] },
    bankSortRequest: { default: null, deliver: ['dashboard-core'] },
    marked: { default: {}, scope: 'character', document: 'selections', importable: true, check: mapOf(listOf(mark)), deliver: ['dashboard'] },
    merchantMarked: { default: {}, scope: 'character', document: 'selections', importable: true, check: mapOf(listOf(mark)), deliver: ['dashboard'] },
    bankSnapshot: { default: null satisfies SavedBankState['bankSnapshot'], document: 'bank' },
    withdrawals: { default: {} satisfies SavedBankState['withdrawals'], document: 'bank', deliver: ['dashboard-core'] },
    // The copies the player banked by hand while a merchant claim of their item lived; the claim
    // leaves them in the bank across a restart.
    claimBanked: { default: {} satisfies SavedBankState['claimBanked'], document: 'bank' },
    bankbois: { default: {} satisfies SavedBankState['bankbois'], document: 'bank' },
    bankboiQueue: { default: [] satisfies SavedBankState['bankboiQueue'], document: 'bank' },
    bankboiTransaction: { default: null satisfies SavedBankState['bankboiTransaction'], document: 'bank' },
    bankboiReservedMigrated: { default: false satisfies SavedBankState['bankboiReservedMigrated'], document: 'bank' },
  },
} satisfies Declarations;

// The load of the items owner's saved records (from inventory/initial-collection.ts,
// initial-intents.ts and initial-bank.ts). The
// settings owner's loader (settings/coordinator/initial.ts) passes its `declared` read, so each
// record's saved value or default is the declaration's above, and the items owner reads no settings
// internals.
export interface SavedReads { declared: typeof declared }
interface SavedCollection {
  threshold?: number;
  itemCollectionThreshold?: number;
  buyUpgradeBatchSize?: number;
  marked?: Record<string, ItemMark[]> | null;
  merchantMarked?: Record<string, ItemMark[]> | null;
  autoItemMarks?: Record<string, Record<string, unknown> | undefined> | null;
  autoUpgradeMarks?: Record<string, Parameters<typeof reconcileUpgradeMarks>[1]> | null;
}
// A saved count past the bag's cells is held to the game's base bag (G node/server.js:1483), the
// declarations' bound; a value that is no whole number reads the declaration's default.
const bagCount = (value: number | undefined, fallback: number) =>
  Number.isSafeInteger(value) ? Math.max(1, Math.min(BASE_INVENTORY_SIZE, value!)) : fallback;
/** Selection documents override legacy settings, including explicit empty mark maps. */
export function initialCollectionState(settings: SavedCollection, selections: SavedCollection, read: SavedReads) {
  return {
    threshold: Number.isSafeInteger(settings.threshold) ? settings.threshold! : read.declared<'threshold', number>('threshold'),
    itemCollectionThreshold: bagCount(settings.itemCollectionThreshold, read.declared('itemCollectionThreshold')),
    buyUpgradeBatchSize: bagCount(settings.buyUpgradeBatchSize, read.declared('buyUpgradeBatchSize')),
    statuses: {} as Record<string, ObservedCharacterStatus>,
    marked: read.declared('marked', selections.marked, settings.marked),
    merchantMarked: read.declared('merchantMarked', selections.merchantMarked, settings.merchantMarked),
    autoItemMarks: read.declared('autoItemMarks', selections.autoItemMarks, settings.autoItemMarks),
    autoUpgradeMarks: read.declared('autoUpgradeMarks', selections.autoUpgradeMarks, settings.autoUpgradeMarks),
  };
}

/** Durable intent uses the same records that the item command handlers update. */
export interface ItemIntents {
  upgradeOfferingRules: import('./rules.ts').UpgradeOfferingRule[];
  upgrades: Parameters<typeof createUpgradeCommands>[0]['upgrades'];
  statScrolls: Parameters<typeof createStatScrollCommands>[0]['statScrolls'];
  purchases: Parameters<typeof createMerchantItemCommands>[0]['purchases'];
  compounds: Parameters<typeof createCompoundCommands>[0]['compounds'];
  autoCompounds: Parameters<typeof createCompoundCommands>[0]['autoCompounds'];
  autoExchanges: Parameters<typeof createMerchantItemCommands>[0]['autoExchanges'];
  goldTargets: Parameters<typeof createUpgradeCommands>[0]['goldTargets'];
}
type SavedItemIntents = { [Key in keyof ItemIntents]?: ItemIntents[Key] | null };
/** Keep durable improvement and purchase intent; processing services reconcile it with live inventory. */
// The id comes from the Web Crypto global, since this file is also bundled for the character.
export function initialItemIntents(saved: SavedItemIntents, read: SavedReads): ItemIntents {
  return {
    upgrades: Object.fromEntries(Object.entries(saved.upgrades || {}).map(([owner, marks]) =>
      [owner, marks?.map(mark => mark.auto || mark.requestId ? mark : { ...mark, requestId: mark.passId || globalThis.crypto.randomUUID() })])),
    upgradeOfferingRules: read.declared('upgradeOfferingRules', saved.upgradeOfferingRules),
    statScrolls: read.declared('statScrolls', saved.statScrolls),
    purchases: read.declared('purchases', saved.purchases),
    compounds: read.declared('compounds', saved.compounds),
    autoCompounds: read.declared('autoCompounds', saved.autoCompounds),
    autoExchanges: read.declared('autoExchanges', saved.autoExchanges),
    goldTargets: read.declared('goldTargets', saved.goldTargets),
  };
}

// The previous release's retryable worker errors (runtime/coordinator/inventory/storage-retry.ts
// `retryableStorageError`): its scheduler retried a worker whose error text matched one of these,
// and saved no failure code. A movement plan request that timed out or lost its network is one.
const B9_RETRYABLE_ERRORS = [/^(bank_unavailable|not_in_bank|interrupted)$/, /^bank data did not load:/,
  /Cannot read properties of undefined \(reading 'items1'\)/,
  /^(GET|POST) \/(movement-plan|merchant\/bank-sort\/checkpoint|bankboi\/(checkpoint|complete)) · (network|timeout)(:.*)?$/];
// A worker saved by in a retryable error has no code, and storage.ts resumes an error only by its
// failure class, so the load gives it the `interrupted` code once. Any other code-less error keeps
// waiting for the player, as the previous release's review did.
function loadBankbois<Bankbois extends Record<string, { state?: string; error?: unknown; code?: unknown }>>(bankbois: Bankbois): Bankbois {
  for (const entry of Object.values(bankbois))
    if (entry?.state === 'error' && entry.code === undefined && B9_RETRYABLE_ERRORS.some(rule => rule.test(String(entry.error ?? ''))))
      entry.code = 'interrupted';
  return bankbois;
}

/** Restore durable storage work while refreshing the current bank observer and vault catalog. */
export function initialBankState<Vaults>(saved: SavedBankState, vaults: () => Vaults, read: SavedReads) {
  return {
    bankSnapshot: read.declared('bankSnapshot', saved.bankSnapshot),
    bankbois: loadBankbois(read.declared('bankbois', saved.bankbois)),
    bankboiQueue: Array.isArray(saved.bankboiQueue) ? saved.bankboiQueue : [],
    bankboiTransaction: read.declared('bankboiTransaction', saved.bankboiTransaction),
    bankboiReservedMigrated: saved.bankboiReservedMigrated === true,
    bankVaults: vaults(),
    withdrawals: read.declared('withdrawals', saved.withdrawals),
    claimBanked: read.declared('claimBanked', saved.claimBanked),
    bankObserver: null as string | null,
  };
}

// The saved mailbox (coordinator/mail.ts), loaded here so the status owner's `core:status`
// record declaration (runtime/status/fields.ts) reads its default without the coordinator's mail
// code.
export interface SentMailRecord { id: string; recipient: string; subject: string; message: string; sent: string; item?: unknown; quantity?: number }
export interface MailboxState { settings: { autoCollect: boolean; autoDelete: boolean }; seenIds: string[]; outbox: SentMailRecord[] }
export function initialMailbox(value: unknown): MailboxState {
  const saved: Record<string, unknown> = object(value) ? value : {}, settings: Record<string, unknown> = object(saved.settings) ? saved.settings : {};
  return {
    settings: { autoCollect: settings.autoCollect === true, autoDelete: settings.autoDelete === true },
    seenIds: Array.isArray(saved.seenIds) ? saved.seenIds.filter((id): id is string => typeof id === 'string') : [],
    outbox: Array.isArray(saved.outbox) ? saved.outbox.flatMap(raw => {
      const m: Record<string, unknown> = object(raw) ? raw : {};
      return typeof m.id === 'string' && typeof m.recipient === 'string' && typeof m.subject === 'string' && typeof m.message === 'string' && typeof m.sent === 'string'
        ? [{ id: m.id, recipient: m.recipient, subject: m.subject, message: m.message, sent: m.sent, ...(m.item ? { item: m.item } : {}), ...(typeof m.quantity === 'number' ? { quantity: m.quantity } : {}) }]
        : [];
    }) : [],
  };
}

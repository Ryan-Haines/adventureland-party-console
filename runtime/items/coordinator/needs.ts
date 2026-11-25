// The needs table: what a merchant job
// and a bank visit need from storage and gold: the merchant's working gold, the gold reserve,
// a stand buy order paused short of gold, postage, free slots (rules.ts `freeSlots`),
// the bank visit's withdrawals, and the realm stay after a market job. It also holds the
// restock claim and the merchant's storage stock.
import type { InventoryEntry } from '../../coordinator/contracts/item.ts';
import { requestObject, requestText } from '../../lifecycle/api.ts';
import { availableCraftStock } from '../rules.ts';
import { craftProtection } from './production.ts';
import { nativeAllocation, type NativeStandState } from './market.ts';
import { partyHooks } from '../../hooks/index.ts';
import { merchantKind, routineFor, type ReadyJob } from '../../merchant-jobs/api.ts';
import { normalizedRealm, type RealmAnswer } from '../../merchant-realm/api.ts';
import { freeSlots, hasMarkedWithdrawals, luckySlotOf, protectedSlotsOf, type LuckySlots, MAIL_POSTAGE, STACK_SIZE_MAX, TRADE_PRICE_MAX, UPGRADE_LEVEL_MAX } from '../rules.ts';
import { bankboiPack, inventoryPack, isBankboiPack, stackQuantity } from '../identity.ts';
import { RESTOCK_DEFAULT, RESTOCK_ELIXIR_DEFAULT } from '../saved-fields.ts';
import type { RestockPolicy, SupplyPolicy } from '../rules.ts';
import type { SettingsWrite, SettingsWriteResult } from '../../settings/api.ts';
import type { ItemsAnswer } from './routes/answer.ts';

// ---------------------------------------------------------------------------------------------
// The reserve. An automatic purchase spends only the merchant's and the bank's gold above
// `goldReserve`; a manual order, which the player gives, does not read it.

export interface GoldState {
  merchantCharacter: string | null;
  statuses: Record<string, { gold?: unknown; items?: unknown; server?: string } | undefined>;
  bankSnapshot?: { gold?: unknown } | null;
  goldReserve?: number;
}
function merchantGold(state: GoldState): number {
  return Number(state.statuses[String(state.merchantCharacter)]?.gold) || 0;
}
export function spendableGold(state: GoldState, carried = merchantGold(state)): number {
  return Math.max(0, carried + (Number(state.bankSnapshot?.gold) || 0) - (Number(state.goldReserve) || 0));
}

// ---------------------------------------------------------------------------------------------
// Working gold: the merchant keeps the largest of your gold target, the stand's
// funding and the gold its ready jobs on this realm need; the bank errand deposits only above it.

/** The highest covered stand bid the spendable gold can pay, inside the game's wishlist limits. */
function fundingTarget(state: NativeStandState, available: number): number {
  return Math.max(0, ...nativeAllocation(state).map(entry => state.standBids[entry.itemId]!)
    .filter(bid => bid.price <= available && bid.price <= TRADE_PRICE_MAX && Number(bid.minimumQuality || 0) <= UPGRADE_LEVEL_MAX)
    .map(bid => bid.price));
}
interface QueuedJob { id: string; reason: string; target?: string | null; item?: unknown;
  listings?: { price?: number; unitPrice?: number; key?: string }[]; completedListingKeys?: string[]; bidItemId?: string | null; manual?: boolean }
export interface WorkingGoldState extends NativeStandState {
  goldTargets: Record<string, number | undefined>;
  merchantQueue: QueuedJob[];
}
/** The stand's funding from the gold above the reserve (working gold with the reserve). */
export function standFunding(state: NativeStandState, carried = merchantGold(state)): number {
  return fundingTarget(state, spendableGold(state, carried));
}
/**
 * `jobs.ready`, asked of the job owner, which publishes it on every coordinator start
 * (merchant-jobs/coordinator/registrations.ts). The ask throws while no owner answers it, so a start
 * that never published it fails here, so it never reads as no ready jobs. No merchant has none.
 */
function readyJobs(merchant: string | null): readonly ReadyJob[] {
  return merchant ? partyHooks().ask('jobs.ready', merchant) : [];
}
function queuedReady(state: WorkingGoldState, except?: string): QueuedJob[] {
  const merchant = state.merchantCharacter, realm = normalizedRealm(state.statuses[String(merchant)]?.server);
  return readyJobs(merchant).filter(ready => ready.realm === realm && ready.id !== except)
    .map(ready => state.merchantQueue.find(job => String(job.id) === ready.id)).filter((job): job is QueuedJob => !!job);
}
/** A character's saved gold target, `null` while it has none. */
export function goldTarget(targets: Record<string, unknown>, name: unknown): number | null {
  const target = targets[String(name)];
  return Number.isSafeInteger(target) ? Number(target) : null;
}
export function workingGold(state: WorkingGoldState): number {
  return Math.max(goldTarget(state.goldTargets, state.merchantCharacter) ?? 0, standFunding(state),
    queuedReady(state).reduce((sum, job) => sum + jobGold(job), 0));
}

// ---------------------------------------------------------------------------------------------
// Postage: a mail job needs the game's postage, and the ALData authentication is a letter.

function postage(job: { item?: unknown }): number {
  return job.item ? MAIL_POSTAGE.item : MAIL_POSTAGE.letter;
}
/** The postage the mail dialog shows: `gold` is a letter's (the amount the official client
 * advertises, html.js `load_mail`) and `withItem` is a letter's with an item, so the dialog names
 * the price that applies to what is being sent. */
export function mailPostageAnswer(): ItemsAnswer {
  return { body: { gold: MAIL_POSTAGE.letter, withItem: MAIL_POSTAGE.item } };
}
function automaticPurchase(job: QueuedJob): boolean {
  return merchantKind(job.reason).purchase === 'bid' && !!job.bidItemId && job.manual !== true;
}
// The gold a job needs: postage for a mail kind, and for an automatic bid purchase the cheapest
// listing it still has to buy.
function jobGold(job: QueuedJob): number {
  if (merchantKind(job.reason).needs?.gold === 'postage') return postage(job);
  if (!automaticPurchase(job)) return 0;
  const prices = (job.listings || []).filter(listing => !job.completedListingKeys?.includes(String(listing.key)))
    .map(listing => Number(listing.unitPrice ?? listing.price)).filter(price => price > 0);
  return prices.length ? Math.min(...prices) : 0;
}

// ---------------------------------------------------------------------------------------------
// `items.needs(job)`: what one job needs, read from its `needs` record (an add-on's kind brings
// its own through `merchant.jobKind`), and what blocks it now. A mail short of its postage and an
// automatic purchase short of the gold above the reserve answer `short_gold`, and the merchant jobs owner keeps them
// queued until gold arrives.

// The slots a job needs are the merchant jobs owner's capacity fact (`coordinatorMerchantTransferBlocked`), which reads
// `freeSlots`, so `blockedBy` names gold only.
export interface ItemNeeds { gold: number; withdrawals: unknown[]; slots: number; postage: number; blockedBy?: 'short_gold' }
export interface NeedsState extends WorkingGoldState, LuckySlots {
  protectedFreeSlots?: unknown;
  withdrawals?: Record<string, readonly unknown[] | undefined>;
  merchantCurrent?: QueuedJob | null;
}
// A job's withdrawals are the merchant's requests made for it (`requestFor`).
export function itemNeeds(state: NeedsState, asked: Readonly<Record<string, unknown>>): ItemNeeds {
  // The ask carries the merchant jobs owner's job as a record (hooks/registry.ts `items.needs`); the record names its id and reason.
  const job: QueuedJob = { ...asked, id: requestText(asked.id), reason: requestText(asked.reason) };
  const kind = merchantKind(job.reason);
  const mail = kind.needs?.gold === 'postage' ? postage(job) : 0, gold = jobGold(job);
  const withdrawals = ((state.withdrawals?.[String(state.merchantCharacter)] || []) as WithdrawalRequest[]).filter(request => requestFor(request, job));
  const slots = (kind.needs?.slots || 0) + withdrawals.length;
  const available = automaticPurchase(job) ? spendableGold(state) : merchantGold(state) + (Number(state.bankSnapshot?.gold) || 0);
  return { gold, withdrawals, slots, postage: mail, ...(gold > available ? { blockedBy: 'short_gold' as const } : {}) };
}

// ---------------------------------------------------------------------------------------------
// One bank visit. A visit's withdrawals are the job's own, then the next ready
// jobs' on the merchant's realm in the merchant jobs owner's order, then the player's marked withdrawals, then the rest,
// while the merchant's free slots past its lucky slot and protected cells hold them; a withdrawal that does not fit waits for the next
// visit.

interface WithdrawalRequest { pack?: string; slot?: number; improvement?: string; craftJobId?: string; mailJobId?: string;
  standListingId?: string; deconstructionId?: string; autoNpcRuleKey?: string; [field: string]: unknown }
// Whether a withdrawal request was made for this job, as the request names it.
function requestFor(request: WithdrawalRequest, job: QueuedJob): boolean {
  if (request.craftJobId || request.mailJobId) return request.craftJobId === job.id || request.mailJobId === job.id;
  if (request.standListingId) return job.reason === 'stand maintenance';
  if (request.deconstructionId) return job.reason === 'deconstruction';
  // An automatic NPC sale's withdrawal is its job's own stock, as v1.5's job sent only these marks
  // (aac30d45 runtime/coordinator/merchant/commands.ts:121-123).
  if (request.autoNpcRuleKey) return job.reason === 'auto npc withdrawals';
  return !!request.improvement && routineFor(job) === routineFor({ reason: request.improvement });
}
export function visitWithdrawals(state: NeedsState, job: QueuedJob): unknown[] {
  const merchant = String(state.merchantCharacter), requests = (state.withdrawals?.[merchant] || []) as WithdrawalRequest[];
  const next = queuedReady(state, job.id);
  const rank = (request: WithdrawalRequest): number => {
    if (requestFor(request, job)) return 0;
    const at = next.findIndex(queued => requestFor(request, queued));
    if (at >= 0) return 1 + at;
    return hasMarkedWithdrawals([request]) ? 1 + next.length : 2 + next.length;
  };
  const ordered = requests.map((request, index) => ({ request, index, rank: rank(request) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index).map(entry => entry.request);
  const items = state.statuses[merchant]?.items;
  if (!Array.isArray(items)) return ordered;
  const cells = new Set<string>(), room = freeSlots(items, luckySlotOf(state, merchant), protectedSlotsOf(state, merchant));
  return ordered.filter(request => {
    const cell = `${String(request.pack)}:${String(request.slot)}`;
    if (cells.has(cell)) return true;
    if (cells.size >= room) return false;
    cells.add(cell);
    return true;
  });
}
/** The player's marked withdrawals ride a planned own visit; fates.ts bankCollectionReason queues their own job only when none is planned. */
// It reads only each job's target and reason, so every owner's view of the queue passes.
type PlannedJob = { target?: string | null; reason?: string };
export function visitPlanned(state: { merchantCharacter: string | null; merchantCurrent?: PlannedJob | null;
  merchantQueue?: readonly (PlannedJob | null | undefined)[] }): boolean {
  return [state.merchantCurrent, ...(state.merchantQueue || [])].some(job => !!job && job.target === state.merchantCharacter &&
    merchantKind(job.reason ?? '').realm === 'home' && merchantKind(job.reason ?? '').mergeGroup !== 'bank');
}

// ---------------------------------------------------------------------------------------------
// The realm stay. After a market job ends on a realm that is not home, 10 holds
// `realm.want('items:stay', realm)` while a ready job on that realm is at least as urgent as the
// best ready home job, and releases it otherwise. the merchant jobs owner's job notices ask it, so it runs once per
// change of the ready jobs, not per tick.

export interface StayPorts {
  merchant(): string | null;
  home(): string | null;
  here(): string | null;
  want(owner: 'items:stay', realm: string): RealmAnswer;
  release(owner: 'items:stay'): void;
}
export function createRealmStay(ports: StayPorts) {
  let stay: string | null = null;
  function changed(): void {
    if (!stay) return;
    const ready = readyJobs(ports.merchant());
    const best = (realm: string | null) => Math.max(-Infinity, ...ready.filter(job => job.realm === realm).map(job => job.priority));
    const here = best(stay), home = best(ports.home());
    // On a tie the stay holds while the merchant jobs owner's pick runs this realm's job first.
    if (here > home || here > -Infinity && here === home && ready.find(job => job.priority === here)?.realm === stay) {
      ports.want('items:stay', stay);
      return;
    }
    ports.release('items:stay');
    stay = null;
  }
  function ended(reason: string): void {
    const realm = ports.here();
    if (merchantKind(reason).realm === 'listing' && realm && realm !== ports.home()) stay = realm;
    changed();
  }
  return { ended, changed };
}

// ---------------------------------------------------------------------------------------------
// The restock claim (3.3, `restockPolicies`, a `range` claim of each carried supply): a character
// with no saved policy has the setting's default, and a restock visit is complete once the bag
// carries each supply's `max`. A report with no bag never counts as complete.

export function restockPolicyOf(policies: Record<string, RestockPolicy | undefined>, name: string | null): RestockPolicy {
  return policies[String(name)] || RESTOCK_DEFAULT;
}
function carriedCount(items: readonly unknown[], name: string): number {
  return items.reduce<number>((total, entry) => {
    const item = (entry as InventoryEntry | null)?.item;
    return total + (item?.name === name ? stackQuantity(item) : 0);
  }, 0);
}
export function restockInventorySatisfied(items: unknown, policy: () => Partial<RestockPolicy>): boolean {
  if (!Array.isArray(items)) return false;
  const supplies = policy();
  return [supplies.hp, supplies.mp, supplies.elixir].every(supply =>
    !supply || Number(supply.max) <= 0 || carriedCount(items, supply.item) >= Number(supply.max));
}

// ---------------------------------------------------------------------------------------------
// The merchant's storage stock: its bag, the bank snapshot's vaults and the BankBoi bags, less the
// copies a queued craft or a delivery holds (rules.ts `availableCraftStock`). The stock
// offers a BankBoi stack only whole, since a BankBoi transaction moves whole stacks. The state comes
// from the coordinator or from a dashboard request, so protectedMerchantStorageStock reads every
// field as untrusted.

interface StorageStockEntry extends InventoryEntry { craftLocation: string; storageQuantity: number }
function stockEntries(value: unknown, craftLocation: string): StorageStockEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index) => {
    if (!raw) return [];
    const entry = requestObject(raw), item = requestObject(entry.item);
    return [{ ...entry, slot: Number.isSafeInteger(entry.slot) ? Number(entry.slot) : index, storageQuantity: stackQuantity(item), craftLocation }];
  });
}
export function protectedMerchantStorageStock(value: unknown): StorageStockEntry[] {
  const state = requestObject(value), merchant = String(state.merchantCharacter);
  const report = requestObject(requestObject(state.statuses)[merchant]);
  const packs = requestObject(requestObject(state.bankSnapshot).packs);
  const workers = Array.isArray(state.bankbois) ? state.bankbois : Object.values(requestObject(state.bankbois));
  const entries = [...stockEntries(report.items, inventoryPack(merchant)),
    ...Object.entries(packs).flatMap(([pack, items]) => stockEntries(items, pack)),
    ...workers.flatMap(raw => stockEntries(requestObject(raw).items, bankboiPack(requestObject(raw).name)))];
  const deliveries = Object.fromEntries(Object.entries(requestObject(state.merchantDeliveries))
    .map(([key, items]) => [key, Array.isArray(items) ? items : []]));
  const protection = craftProtection({ merchantCharacter: merchant, merchantQueue: Array.isArray(state.merchantQueue) ? state.merchantQueue : [],
    merchantCurrent: requestObject(state.merchantCurrent), merchantDeliveries: deliveries, merchantCatalog: requestObject(state.merchantCatalog) });
  return availableCraftStock(entries, protection).filter((entry): entry is StorageStockEntry =>
    !!entry && (!isBankboiPack(entry.craftLocation) || stackQuantity(entry.item) === entry.storageQuantity));
}

// ---------------------------------------------------------------------------------------------
// The restock claim's policy (3.3): a character's hp and mp supply and its elixir, each a range
// inside the game's stack size; the policy is a setting written through the settings owner's writer.

function nonnegative(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}
function supply(value: unknown, item: string, { min, max }: Pick<SupplyPolicy, 'min' | 'max'>): SupplyPolicy {
  // Preserve null/false/zero coercion in existing saved-policy requests.
  const object = requestObject(value);
  return {
    item,
    min: nonnegative(Number(value && object.min), min),
    max: nonnegative(Number(value && object.max), max),
  };
}
export interface RestockWriteState {
  restockPolicies: Record<string, RestockPolicy>;
  merchantCatalog?: { allItems?: { id: string; meta?: { definition?: { type?: string } } | null }[] } | null;
}
export interface RestockWritePorts { owned(name: unknown): unknown; write(batch: SettingsWrite): SettingsWriteResult }
export function createRestockWrite(state: RestockWriteState, ports: RestockWritePorts) {
  return function restock(name: unknown, hp: unknown, mp: unknown, elixirInput: unknown): ItemsAnswer {
    if (!ports.owned(name)) return { status: 400, body: { error: "unknown character" } };
    const policy: RestockPolicy = { hp: supply(hp, RESTOCK_DEFAULT.hp.item, RESTOCK_DEFAULT.hp),
      mp: supply(mp, RESTOCK_DEFAULT.mp.item, RESTOCK_DEFAULT.mp) };
    const elixir = requestObject(elixirInput);
    if (elixir.item) {
      if (typeof elixir.item !== 'string' || !state.merchantCatalog?.allItems?.some(entry => entry.id === elixir.item && entry.meta?.definition?.type === 'elixir'))
        return { status: 400, body: { error: 'Select a valid elixir' } };
      if (![elixir.min ?? RESTOCK_ELIXIR_DEFAULT.min, elixir.max ?? RESTOCK_ELIXIR_DEFAULT.max].every(value => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= STACK_SIZE_MAX) ||
          (elixir.autoConsume !== undefined && typeof elixir.autoConsume !== 'boolean') || (elixir.autoAcquire !== undefined && typeof elixir.autoAcquire !== 'boolean'))
        return { status: 400, body: { error: 'Invalid elixir restock settings' } };
      policy.elixir = {...supply(elixir, elixir.item, RESTOCK_ELIXIR_DEFAULT), autoConsume:elixir.autoConsume !== false, autoAcquire:elixir.autoAcquire === true};
      if (policy.elixir.min > policy.elixir.max) return { status: 400, body: { error: 'minimum cannot exceed maximum' } };
    }
    if (policy.hp.min > policy.hp.max || policy.mp.min > policy.mp.max)
      return { status: 400, body: { error: "minimum cannot exceed maximum" } };
    // The character's restock policy is a setting.
    const written = ports.write({ by: "dashboard:restock", changes: [{ field: "restockPolicies", character: requestText(name), value: policy }] });
    if (!written.ok) return { status: 400, body: { error: written.error } };
    return { body: { ok: true, policy } };
  };
}

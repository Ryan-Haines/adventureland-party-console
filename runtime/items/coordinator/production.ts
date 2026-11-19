// Production: the upgrade intents and
// their one writer, the offerings, the journal, compounds and exchanges, stat scrolls,
// orders and their craft reservations, the upgrade preview's results and the lucky slot
// record (the slot's order is rules.ts `luckySlotOf`).
import type { InventoryEntry, Item } from '../../coordinator/contracts/item.ts';
import type { CommandOutcome } from '../../movement/api/coordinator.ts';
import { requestObject, requestText } from '../../lifecycle/api.ts';
import { played, settingsDraft, type SettingsDraft, type SettingsWrite, type SettingsWriteResult } from '../../settings/api.ts';
import { merchantKind, type EnqueueAsk, type EnqueueAnswer, type JobReason, type MerchantWork } from '../../merchant-jobs/api.ts';
import { collectionPickups, reviseQueuedJobs } from '../../merchant-jobs/coordinator/api.ts';
import { bankboiName, bankboiPack, copyKey, exchangeKey, inventoryPack, isBankboiPack, isVaultPack, markKey, markMatches, ruleKey, ruleKeyParts } from '../identity.ts';
import { finishMerchantInterruption } from '../../movement/api/coordinator.ts';
import type { DeliveryRequest } from '../../merchant-jobs/api.ts';
import type { ItemsAnswer } from './routes/answer.ts';
import { bagSize, freeSlots, itemRuleConflicts, ruleMembers, ruleOwner, sharedMember, statScrollsNeeded, usableCopy, COMPOUND_INPUTS, COMPOUND_TARGET_MAX,
  STACK_SIZE_MAX, UPGRADE_LEVEL_MAX, UPGRADE_TARGET_ACCEPTED, type ConflictState, type RuleState, type SharedScope } from '../rules.ts';
import { entryMeta } from '../catalog-meta.ts';
import { protectedMerchantStorageStock } from './needs.ts';
import { exchangeRewardFates, type AutomaticActionState } from './fates.ts';
import type { BankboiInventory, StorageReference, queueExchangeStorage } from './storage.ts';
import { fitOfferingRules, isUpgradeOffering, maximumItemLevel, offeringProblem, offeringRule, resolveUpgradeOffering, validOfferingRule, type UpgradeOffering,
  type UpgradeOfferingRule } from '../rules.ts';
import { compoundStorageLeftovers, consumeReceipts, protectedSlotsOf, receiptList, type ItemFailure } from '../rules.ts';
import { availableCraftStock, type CraftNeed, type CraftProtection } from '../rules.ts';
import { estimateUpgradeBatch as estimateBatch, highestUpgradeLevel, type EstimateLine, type UpgradeChoice } from '../rules.ts';
import { previewOptions, type UpgradePreviewResult } from '../rules.ts';
import { aggregateSlotTracking, mergeSlotStream, normalizeSlotTracking, type LuckySlotHistory } from '../rules.ts';
import { recordItems } from './records.ts';

type Request = Record<string, unknown>;
type Inventory = readonly (InventoryEntry | null)[];
function failure(error: string, status = 400): CommandOutcome {
  return { status, body: { error } };
}

// ---------------------------------------------------------------------------------------------
// The intents. An upgrade intent is a mark on one copy: its starting item, its tiers and, for a
// manual request, its request id.

export interface UpgradeMark {
  passId?: string;
  liveSlot?: number;
  liveItem?: Item;
  slot?: number | string;
  item: Item;
  tiers: number;
  auto?: boolean;
  offering?: UpgradeOffering;
  requestId?: string;
  waitingOffering?: { offering: string; level: number; signature: string; reason?: string };
  equipped?: boolean;
  storage?: { pack: string; slot: number };
  storageReceived?: boolean;
}
/** A saved automatic upgrade rule: its tiers, or its tiers and its remaining quota. */
export type UpgradeRule = number | string | { tiers: number; quantity?: number };
type UpgradeRules = Readonly<Record<string, UpgradeRule | undefined>>;
type EquippedSlots = Record<string, { item: Item } | null | undefined>;
function ruleTiers(rule: unknown): number {
  return Number(rule && typeof rule === 'object' ? (rule as { tiers?: unknown }).tiers : rule);
}
/** A rule's remaining quota; -1 is a rule with no quota. */
function ruleQuota(rule: unknown): number {
  const quantity = rule && typeof rule === 'object' ? Number((rule as { quantity?: unknown }).quantity) : NaN;
  return Number.isSafeInteger(quantity) ? quantity : -1;
}

/**
 * The one writer of a character's upgrade intents. Every command, reconcile, receipt and
 * completion that adds, moves or ends an intent passes its change through here, and each write leaves
 * the character's list in place, empty when no intent is left, as the reconcile always wrote it.
 */
export function writeIntents<T>(state: { upgrades?: Record<string, T[] | undefined> }, name: string, change: (marks: T[]) => T[],
  endCode?: (mark: T) => ItemFailure | undefined): void {
  const upgrades = state.upgrades ||= {}, current = upgrades[name] || [];
  const next = change(current);
  upgrades[name] = next;
  // One record and notice per intent written or ended. Intents on identical copies with one target
  // share a key (manual requests stay apart by request id), so each key's intents are counted: a
  // key's count that rises records that many written, one that falls that many ended.
  const view = (mark: T) => mark as Partial<UpgradeMark>;
  const key = (mark: T) => view(mark).item ? copyKey(view(mark).item!) + '+' + view(mark).tiers : JSON.stringify(mark);
  const count = (marks: T[]) => marks.reduce((counts, mark) => counts.set(key(mark), (counts.get(key(mark)) || 0) + 1), new Map<string, number>());
  // An ended intent's record carries its failure code when the change names one (`item_missing`).
  const record = (mark: T, phase: 'written' | 'ended') => {
    const code = phase === 'ended' ? endCode?.(mark) : undefined;
    recordItems({ decision: 'intent', subject: name, by: 'P1', phase, item: view(mark).item?.name, tiers: view(mark).tiers, ...(code ? { code } : {}) });
  };
  // The intents both lists hold take their key's count first, so a key's surplus is recorded on an
  // intent the change added or dropped and an ended record names the dropped one.
  const surplus = (marks: T[], other: T[], phase: 'written' | 'ended') => {
    const left = count(other), kept = new Set(other);
    for (const mark of [...marks.filter(mark => kept.has(mark)), ...marks.filter(mark => !kept.has(mark))]) {
      const n = left.get(key(mark)) || 0;
      if (n > 0) left.set(key(mark), n - 1);
      else record(mark, phase);
    }
  };
  surplus(next, current, 'written');
  surplus(current, next, 'ended');
}

interface Reconciliation {
  marks: UpgradeMark[];
  changed: boolean;
  // The intents that ended because their copy left the bag (`item_missing`).
  missing: Set<UpgradeMark>;
}
const startLevel = (mark: UpgradeMark): number => Number(mark.item.level) || 0;
// An intent holds its copy by identity at its starting level (identity.ts `copyKey`),
// so a copy another intent holds, a locked copy or a differing copy is never its copy.
function sameCopy(mark: UpgradeMark, item: Item | null | undefined): boolean {
  return !!item && copyKey({ ...item, level: mark.item.level }) === copyKey(mark.item);
}
function copyLevel(mark: UpgradeMark, item: Item | null | undefined, inclusive: boolean): boolean {
  const level = Number(item?.level) || 0, target = startLevel(mark) + Number(mark.tiers);
  return sameCopy(mark, item) && level >= startLevel(mark) && (inclusive ? level <= target : level < target);
}
const reached = (mark: UpgradeMark, item: Item | null | undefined): boolean =>
  (Number(item?.level) || 0) >= startLevel(mark) + Number(mark.tiers);
const slotItem = (mark: UpgradeMark, items: Inventory): Item | null | undefined =>
  items.find(entry => entry?.slot === (mark.liveSlot ?? mark.slot))?.item;

function quantitySatisfied(item: Item, quantity: number, marks: UpgradeMark[]): boolean {
  if (quantity === -1) return false;
  return marks.filter(mark => mark.auto && ruleKey(mark.item) === ruleKey(item)).length >= quantity;
}
function addUpgrade(entry: InventoryEntry & { item: Item }, tiers: number, state: Reconciliation): void {
  const existing = state.marks.findIndex(mark => !mark.equipped && mark.slot === entry.slot);
  const next: UpgradeMark = { slot: entry.slot, item: entry.item, tiers, auto: true };
  if (existing < 0) {
    state.marks.push(next);
    state.changed = true;
    return;
  }
  const old = state.marks[existing];
  if (old.auto && markMatches(old.item, entry.item) && old.tiers !== next.tiers) {
    state.marks[existing] = next;
    state.changed = true;
  }
}
function considerUpgrade(entry: InventoryEntry | null, rules: UpgradeRules, state: Reconciliation): void {
  if (!entry?.item || !Number.isSafeInteger(entry.slot)) return;
  const rule = rules[ruleKey(entry.item)], tiers = ruleTiers(rule);
  if (!Number.isSafeInteger(tiers) || tiers < 1 || !entry.meta?.upgradeable || !usableCopy(entry.item)) return;
  if (!quantitySatisfied(entry.item, ruleQuota(rule), state.marks)) addUpgrade({ ...entry, item: entry.item }, tiers, state);
}
function activeRule(rule: UpgradeRule | undefined, tiers: number): boolean {
  return ruleQuota(rule) !== 0 && ruleTiers(rule) === Number(tiers);
}
/** A bank-sourced intent becomes a bag intent once its withdrawal's copy is in the bag. */
function received(mark: UpgradeMark, items: Inventory, claimed: Set<unknown>): UpgradeMark {
  if (!mark.storage || !mark.storageReceived) return mark;
  const entry = items.find(entry => entry?.item && !claimed.has(entry.slot) && markKey(entry.item) === markKey(mark.item));
  if (!entry) return mark;
  claimed.add(entry.slot);
  const { storage: _storage, storageReceived: _received, ...ready } = mark;
  return { ...ready, slot: entry.slot };
}
/** An equipped intent reads its equipment slot; with no equipment read it stays. */
function equippedKept(mark: UpgradeMark, equipped: EquippedSlots | undefined): boolean {
  if (!equipped) return true;
  const live = equipped[String(mark.slot)]?.item;
  return copyLevel(mark, live, true) && (mark.auto || !reached(mark, live));
}

/**
 * The per-report pass over a character's intents. A copy still in its slot keeps
 * it first, so a moved copy never takes another intent's copy. A moved copy is followed to the first
 * unfinished copy of its identity that no other intent holds. A manual request ends when its copy
 * reaches its target; an intent whose copy left the bag ends (`item_missing`). An admitted
 * automatic pass (its passId set) keeps its target through a read that shows no copy: only its native
 * receipt ends it (v1.5.0 upgrade-marks.ts reconcileUpgradeMarks). An automatic intent
 * also ends when its rule is gone or spent. Each unclaimed copy a rule covers then gets an intent.
 */
export function reconcileUpgradeMarks(marks: UpgradeMark[], rules: UpgradeRules, items: Inventory, equipped?: EquippedSlots): Reconciliation {
  const before = JSON.stringify(marks);
  const claimed = new Set<unknown>(marks.filter(mark => !mark.storage).map(mark => mark.slot));
  const ready = marks.map(mark => received(mark, items, claimed));
  claimed.clear();
  const inPlace = new Set(ready.filter(mark => !mark.storage && !mark.equipped && copyLevel(mark, slotItem(mark, items), true)));
  const missing = new Set<UpgradeMark>();
  for (const mark of inPlace) claimed.add(mark.liveSlot ?? mark.slot);
  const retained = ready.flatMap(mark => {
    if (mark.storage) return [mark];
    if (mark.auto && !activeRule(rules[ruleKey(mark.item)], mark.tiers)) return [];
    if (mark.equipped) return equippedKept(mark, equipped) ? [mark] : [];
    if (inPlace.has(mark)) return mark.auto || !reached(mark, slotItem(mark, items)) ? [mark] : [];
    const moved = items.find((entry): entry is InventoryEntry & { item: Item; slot: number } =>
      !!entry?.item && Number.isSafeInteger(entry.slot) && !claimed.has(entry.slot) && copyLevel(mark, entry.item, false));
    if (!moved && mark.auto && mark.passId) return [mark];
    if (!moved) { missing.add(marks[ready.indexOf(mark)]); return []; }
    claimed.add(moved.slot);
    // The moved copy is the mark's live copy, its cell and its fingerprint (aac30d45 upgrade-marks.ts:152).
    return [{ ...mark, slot: moved.slot, liveSlot: moved.slot, liveItem: moved.item }];
  });
  const state = { marks: retained, changed: JSON.stringify(retained) !== before, missing };
  for (const entry of items) considerUpgrade(entry, rules, state);
  return state;
}

export function clearResolvedUpgradeMarks(marks: UpgradeMark[], resolved: readonly UpgradeMark[]): UpgradeMark[] {
  const completed = new Set(resolved.map(mark => mark.requestId || mark.passId || JSON.stringify(mark)));
  const legacy = new Set(resolved.map(({ passId: _id, ...mark }) => JSON.stringify(mark)));
  return marks.filter(mark => !completed.has(mark.requestId || mark.passId || JSON.stringify(mark)) &&
    (mark.requestId || mark.passId || !legacy.has(JSON.stringify(mark))));
}

interface InventoryStatus { upgradeInventoryBusy?: boolean; items?: unknown; slots?: EquippedSlots }
interface UpgradeState extends RuleState, CraftReservationState {
  upgrades: Record<string, UpgradeMark[] | undefined>;
  autoUpgradeMarks: Record<string, UpgradeRules | undefined>;
}
/** The per-report pass for upgrade marks. A lucky swap or a recovery hides a copy from its slot without ending its mark. */
export function reconcileCoordinatorUpgradeMarks(state: UpgradeState, name: string, status?: InventoryStatus | null): boolean {
  if (!Array.isArray(status?.items) || status.upgradeInventoryBusy) return false;
  const reported = status.items as Inventory;
  const stock = availableCraftStock(reported.map(entry => entry && { ...entry, craftLocation: inventoryPack(name),
    meta: entryMeta(state.merchantCatalog, entry) }), craftProtection(state));
  let changed = false, missing = new Set<UpgradeMark>();
  writeIntents(state, name, marks => {
    const result = reconcileUpgradeMarks(marks, state.autoUpgradeMarks[ruleOwner(state, name)] || {},
      stock.map(entry => entry?.item && itemRuleConflicts(state, entry.item).length ? null : entry), status.slots);
    changed = result.changed;
    missing = result.missing;
    return result.marks;
  }, mark => missing.has(mark) ? 'item_missing' : undefined);
  return changed;
}
/** Removes only the resolved pass; newer or unrelated upgrade requests stay. The member keeps the
 *  cleared list even when it had none, as b9b5c91e's clear wrote it (application.ts:1521). */
export function clearCoordinatorResolvedUpgrades(state: Pick<UpgradeState, 'upgrades'>, name: string, resolved: readonly UpgradeMark[]): void {
  writeIntents(state, name, marks => clearResolvedUpgradeMarks(marks, resolved));
  state.upgrades![name] ||= [];
}

// The continuation: an admitted pass saves its starting copy and the copy it took before
// production, so a pass sourced from the bank keeps its target through a restart.
interface ContinuationState {
  merchantCharacter: string | null;
  upgrades?: Record<string, unknown[] | undefined>;
  autoUpgradeMarks: Record<string, Record<string, unknown> | undefined>;
}
export function rememberUpgradeContinuation(state: ContinuationState, body: Record<string, unknown>): void {
  const automatic = requestObject(body.automatic), mark = requestObject(automatic.mark);
  if (body.kind !== 'upgrade' || !automatic.mark) return;
  if (automatic.family === 'manual-upgrade') rememberManualContinuation(state, body, mark);
  else if (automatic.family === 'upgrade') rememberAutomaticContinuation(state, body, automatic, mark);
}
function rememberAutomaticContinuation(state: ContinuationState, body: Record<string, unknown>, automatic: Record<string, unknown>, mark: Record<string, unknown>): void {
  const item = requestObject(mark.item), live = requestObject(body.item), owner = String(state.merchantCharacter);
  validateContinuation(mark, item, live, automatic.key, ruleTiers(state.autoUpgradeMarks[owner]?.[String(automatic.key)]));
  writeIntents(state, owner, list => {
    const existing = list.findIndex(raw => {
      const entry = requestObject(raw);
      return entry.passId === mark.passId || entry.slot === mark.slot && entry.auto === true && markMatches(requestObject(entry.item), item);
    });
    // The command's slot is the roll's input; its liveSlot can be the previous checkpoint's.
    const saved = { ...mark, auto: true, liveSlot: mark.slot, liveItem: live };
    if (existing < 0) list.push(saved);
    else list[existing] = saved;
    return list;
  });
}
function rememberManualContinuation(state: ContinuationState, body: Record<string, unknown>, mark: Record<string, unknown>): void {
  // A bank withdrawal's intent saved its id as passId; an admitted command keeps it once it reads requestId.
  const identity = mark.requestId || mark.passId;
  const owner = Object.keys(state.upgrades || {}).find(name => (state.upgrades![name] || []).some(raw => manualIntentOf(raw, mark, identity)));
  if (!owner) throw Error('Manual upgrade continuation changed');
  writeIntents(state, owner, list => {
    const saved = requestObject(list.find(raw => manualIntentOf(raw, mark, identity)));
    const start = requestObject(saved.item), live = requestObject(body.item);
    validateItem(start, live, Number(saved.tiers));
    if (Number(saved.tiers) !== Number(mark.tiers) || !markMatches(requestObject(mark.item), start)) throw Error('Manual upgrade target changed');
    saved.liveSlot = mark.slot; saved.liveItem = live;
    return list;
  });
}
function manualIntentOf(raw: unknown, mark: Record<string, unknown>, identity: unknown): boolean {
  const entry = requestObject(raw);
  return typeof identity === 'string' && entry.auto !== true && (entry.requestId === identity || !mark.requestId && entry.passId === identity);
}
function validateContinuation(mark: Record<string, unknown>, item: Record<string, unknown>, live: Record<string, unknown>, key: unknown, tiers: number): void {
  if (typeof mark.passId !== 'string' || !Number.isInteger(mark.slot) ||
      mark.auto !== true || ruleKey(item) !== key || tiers !== mark.tiers)
    throw Error('Automatic upgrade continuation changed');
  validateItem(item, live, tiers);
}
function validateItem(item: Record<string, unknown>, live: Record<string, unknown>, tiers: number): void {
  const start = Number(item.level) || 0, level = Number(live.level) || 0;
  if (level < start || level >= start + tiers || !markMatches({ ...live, level: start }, { ...item, level: start }))
    throw Error('Automatic upgrade continuation item changed');
}

/** Only a completed native journal advances or retires an original upgrade pass. */
function settleUpgradeContinuation(state: ContinuationState, value: unknown): void {
  const journal = requestObject(value), request = requestObject(journal.request), automatic = requestObject(request.automatic);
  if (journal.phase !== 'complete' || request.kind !== 'upgrade' || !['upgrade', 'manual-upgrade'].includes(String(automatic.family))) return;
  const intent = requestObject(automatic.mark);
  for (const owner of Object.keys(state.upgrades || {}))
    writeIntents(state, owner, list => list.filter(raw => settleUpgradeMark(requestObject(raw), intent, journal)));
}
function settleUpgradeMark(mark: Record<string, unknown>, intent: Record<string, unknown>, journal: Record<string, unknown>): boolean {
  if (!matchesUpgradeIntent(mark, intent)) return true;
  if (journal.destroyed === true) return false;
  const result = requestObject(journal.outcomeItem), start = requestObject(mark.item);
  if (!sameUpgradeOutcome(result, start)) return true;
  if (Number(result.level || 0) >= Number(start.level || 0) + Number(mark.tiers)) return false;
  const slots = Array.isArray(journal.slots) ? journal.slots : [];
  mark.liveSlot = slots[0]; mark.liveItem = result;
  return true;
}
function matchesUpgradeIntent(mark: Record<string, unknown>, intent: Record<string, unknown>): boolean {
  if (intent.requestId) return mark.requestId === intent.requestId;
  return typeof intent.passId === 'string' && mark.passId === intent.passId;
}
function sameUpgradeOutcome(result: Record<string, unknown>, start: Record<string, unknown>): boolean {
  const level = Number(start.level) || 0;
  return result.name === start.name && markMatches({ ...result, level }, { ...start, level });
}

/** A bank pass becomes eligible only after the native withdrawal confirms its source. */
export function receiveBankUpgrades(state: { upgrades: Record<string, unknown[] | undefined>; merchantCharacter?: string | null }, name: string | null, receipts: unknown): void {
  if (!name || name !== state.merchantCharacter || !Array.isArray(receipts)) return;
  writeIntents(state, name, list => list.map(raw => {
    const mark = requestObject(raw), storage = requestObject(mark.storage), item = requestObject(mark.item);
    if (!mark.storage) return raw;
    const confirmed = receipts.some(value => {
      const receipt = requestObject(value), copy = requestObject(receipt.item);
      return receipt.pack === storage.pack && receipt.slot === storage.slot && markKey(item) === markKey(copy);
    });
    return confirmed ? { ...mark, storageReceived: true } : raw;
  }));
}

// A bank copy the withdrawal command marks for an upgrade.
interface BankUpgradeState {
  merchantCharacter: string | null;
  upgrades: Record<string, UpgradeMark[] | undefined>;
  bankSnapshot?: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
  bankbois: Record<string, { name: string; items?: (InventoryEntry | null)[] }>;
  merchantCatalog?: unknown;
}
type BankCell = Request & { pack: string; slot: number };
function bankEntry(state: BankUpgradeState, body: BankCell) {
  const worker = bankboiName(body.pack), entries = worker !== null ? state.bankbois[worker]?.items : state.bankSnapshot?.packs?.[body.pack];
  return entries?.find(entry => entry?.slot === body.slot);
}
function validBankUpgrade(state: BankUpgradeState, entry: InventoryEntry | null | undefined, item: Item, tiers: number): boolean {
  if (!entry?.item || !markMatches(entry.item, item)) return false;
  if (!Number.isSafeInteger(tiers) || tiers < 1 || tiers + (Number(item.level) || 0) > UPGRADE_TARGET_ACCEPTED) return false;
  return !!entryMeta(state.merchantCatalog, entry)?.upgradeable && usableCopy(item);
}
/** The withdrawal command's upgrade target is the merchant's, for an upgradeable bank copy. */
export function bankUpgradeRefusal(state: BankUpgradeState, body: BankCell, name: string, item: Item): CommandOutcome {
  if (body.upgradeTiers === undefined) return null;
  if (name === state.merchantCharacter && validBankUpgrade(state, bankEntry(state, body), item, Number(body.upgradeTiers))) return null;
  return failure('Bank item is unavailable or cannot be upgraded');
}
export function putBankUpgrade(state: BankUpgradeState, body: BankCell, name: string, item: Item): void {
  if (body.upgradeTiers === undefined) return;
  writeIntents(state, name, marks => {
    const old = marks.find(mark => mark.storage?.pack === body.pack && mark.storage?.slot === body.slot);
    if (old) {
      old.tiers = Number(body.upgradeTiers);
      old.requestId ||= old.passId || globalThis.crypto.randomUUID();
    } else marks.push({ requestId: globalThis.crypto.randomUUID(), slot: -1, item: { ...item }, tiers: Number(body.upgradeTiers), storage: { pack: body.pack, slot: body.slot } });
    return marks;
  });
}

// ---------------------------------------------------------------------------------------------
// Offerings.

/** The offerings in the merchant's bag, bank and BankBoi storage that a run may use. */
export function offeringStock(value: unknown): Record<UpgradeOffering, number> {
  const result = { offeringp: 0, offering: 0, offeringx: 0 };
  for (const entry of protectedMerchantStorageStock(value)) {
    const item = entry?.item;
    if (item && usableCopy(item) && isUpgradeOffering(item.name)) result[item.name] += Number(item.q) || 1;
  }
  return result;
}
/** The usable copies of one offering the merchant carries. */
function carriedOfferings(state: unknown, offering: unknown): number {
  const merchant = requestObject(state).merchantCharacter;
  return protectedMerchantStorageStock(state).filter(entry => entry.craftLocation === inventoryPack(merchant) && entry.item?.name === offering && usableCopy(entry.item))
    .reduce((sum, entry) => sum + (Number(entry.item?.q) || 1), 0);
}
function offeringRules(state: unknown): UpgradeOfferingRule[] {
  const rules = played(requestObject(state), 'upgradeOfferingRules');
  return Array.isArray(rules) ? rules.filter(validOfferingRule) : [];
}
const explicitOffering = (mark: Request): UpgradeOffering | undefined => isUpgradeOffering(mark.offering) ? mark.offering : undefined;
/** The copy is an unfinished step of the intent: the intent's copy, from its start to below its target. */
function unfinished(mark: Request, item: Request): boolean {
  const start = requestObject(mark.item), level = Number(item.level) || 0, origin = Number(start.level) || 0;
  return level >= origin && level < origin + Number(mark.tiers) && markMatches({ ...item, level: origin }, { ...start, level: origin });
}
/** The steps from `level` to the intent's target that the offering rules give this offering. */
function offeringSteps(rules: UpgradeOfferingRule[], mark: Request, level: number, offering: unknown): number {
  const start = requestObject(mark.item), target = (Number(start.level) || 0) + Number(mark.tiers || 1);
  let demand = 0;
  for (let step = level; step < target; step++) {
    if (resolveUpgradeOffering(rules, String(start.name), step, explicitOffering(mark))?.offering === offering) demand++;
    if (mark.offering) break;
  }
  return demand;
}

function offeringSignature(value: unknown): string {
  const state = requestObject(value);
  return JSON.stringify([played(state, 'upgradeOfferingRules') || [], offeringStock(state), Object.values(requestObject(state.bankbois)).map(raw => {
    const worker = requestObject(raw);
    return [worker.name, worker.state, worker.error, worker.items];
  }), state.activeSlots, requestObject(state.bankSnapshot).packs, Object.values(requestObject(state.statuses)).map(raw => requestObject(raw).items)]);
}
/** An intent waiting on an offering is ready again once the offerings, rules or storage it waited on changed. */
export function upgradeOfferingReady(state: unknown, raw: unknown): boolean {
  const mark = requestObject(raw), waiting = requestObject(mark.waitingOffering);
  if (mark.storage) return false;
  return !waiting.signature || waiting.signature !== offeringSignature(state);
}
interface WaitState {
  merchantCharacter?: string | null;
  upgrades?: Record<string, unknown[] | undefined>;
  upgradeOfferingRules?: UpgradeOfferingRule[];
}
export function recordOfferingWait(state: WaitState, body: Request): void {
  const owner = String(body.owner), mark = requestObject(body.mark), item = requestObject(mark.item);
  if (typeof item.name !== 'string' || !isUpgradeOffering(body.offering) || !Number.isInteger(body.level)) throw Error('Invalid offering wait');
  const rule = offeringRule(played(state, 'upgradeOfferingRules') || [], requestText(item.name), Number(body.level));
  writeIntents(state, owner, list => {
    const existing = list.find(raw => sameRequest(mark, requestObject(raw)));
    // Bank-sourced automatic work has no saved mark until it must wait.
    const entry = waitingMark(existing, mark);
    if (mark.auto && rule?.offering !== body.offering) return list;
    if (owner === state.merchantCharacter && !entry.equipped && Number.isInteger(body.liveSlot) && Number(body.liveSlot) >= 0) entry.slot = entry.liveSlot = body.liveSlot;
    entry.waitingOffering = { offering: body.offering, level: Number(body.level), reason: body.reason || 'No usable offering stock', signature: offeringSignature(state) };
    return existing ? list : [...list, entry];
  });
}
function waitingMark(existing: unknown, mark: Request): Request {
  if (existing) return requestObject(existing);
  if (!mark.auto) throw Error('Manual upgrade request no longer exists');
  return { ...mark };
}
function sameRequest(mark: Request, entry: Request): boolean {
  return mark.requestId ? entry.requestId === mark.requestId : entry.slot === mark.slot && !!entry.equipped === !!mark.equipped;
}

/** A deposited stack still belongs to collection until its withdrawal receipt. */
export function offeringSupplyReady(value: unknown, raw: unknown): boolean {
  const state = requestObject(value), job = requestObject(raw), supply = requestObject(job.offeringSupply);
  if (!supply.offering) return true;
  if (supply.rulesSignature !== JSON.stringify(played(state, 'upgradeOfferingRules') || [])) return true;
  if (Array.isArray(supply.intents)) {
    supply.outstanding = remainingSupplyDemand(state, job, supply);
    if (!supply.outstanding) { supply.state = 'delivered'; supply.blockingReason = null; return true; }
  }
  const requests = requestObject(state.withdrawals)[String(state.merchantCharacter)];
  const pending = Array.isArray(requests) ? requests.map(requestObject).filter(request => requestObject(request.item).name === supply.offering) : [];
  if (!pending.length) return true;
  supply.blockingReason = supplyReason(state, pending);
  job.pauseReason = supply.blockingReason;
  return false;
}
function supplyReason(state: Request, pending: Request[]): string {
  const remote = pending.find(request => isBankboiPack(request.pack));
  if (!remote) return 'Waiting for confirmed merchant collection';
  const workers = Array.isArray(state.bankbois) ? state.bankbois : Object.values(requestObject(state.bankbois));
  const worker = workers.map(requestObject).find(worker => bankboiPack(worker.name) === remote.pack);
  if (worker?.error) return typeof worker.error === 'string' ? worker.error : JSON.stringify(worker.error);
  return 'Waiting for BankBoi service and native deposit';
}
function remainingSupplyDemand(state: Request, job: Request, supply: Request): number {
  const saved = requestObject(state.upgrades)[String(job.target || state.merchantCharacter)];
  const marks = Array.isArray(saved) ? saved.map(requestObject) : [];
  const report = requestObject(requestObject(state.statuses)[String(state.merchantCharacter)]);
  const items = Array.isArray(report.items) ? report.items.map(raw => requestObject(requestObject(raw).item)) : [], used = new Set<number>();
  const intents = Array.isArray(supply.intents) ? supply.intents.map(requestObject) : [];
  const demand = intents.filter(intent => marks.some(mark => sameSupplyIntent(intent, mark))).reduce((sum, mark) => {
    const index = items.findIndex((item, index) => !used.has(index) && unfinished(mark, item));
    if (index < 0) return sum;
    used.add(index);
    return sum + offeringSteps(offeringRules(state), mark, Number(items[index].level) || 0, supply.offering);
  }, 0);
  return Math.max(0, demand - carriedOfferings(state, supply.offering));
}
function sameSupplyIntent(intent: Request, mark: Request): boolean {
  if (intent.requestId) return intent.requestId === mark.requestId;
  if (intent.passId) return intent.passId === mark.passId;
  return intent.slot === mark.slot && Number(intent.tiers) === Number(mark.tiers) && markMatches(requestObject(mark.item), requestObject(intent.item));
}

// An offering collection fills merchant cells, so it waits for a free slot past the lucky
// slot's hold and the protected free slots.
export function pendingOfferingCollection(value: unknown, raw: unknown): boolean {
  const state = requestObject(value), job = requestObject(raw);
  // The merchant jobs owner's job kind: a self-bank visit that releases the staging row collects the offering's bank copies.
  const kind = merchantKind(String(job.reason));
  if (job.target !== state.merchantCharacter || kind.command !== 'merchant-self-bank' || !kind.releasesStaging) return false;
  const jobs = Array.isArray(state.merchantQueue) ? state.merchantQueue.map(requestObject) : [];
  const requests = requestObject(state.withdrawals)[String(state.merchantCharacter)];
  if (!Array.isArray(requests)) return false;
  return jobs.some(job => {
    const supply = requestObject(job.offeringSupply);
    return !!supply.offering && requests.map(requestObject).some(request => !isBankboiPack(request.pack) && requestObject(request.item).name === supply.offering);
  });
}
export function offeringCollectionReady(value: unknown, raw: unknown): boolean {
  if (!pendingOfferingCollection(value, raw)) return true;
  const state = requestObject(value), job = requestObject(raw), merchant = String(state.merchantCharacter);
  const report = requestObject(requestObject(state.statuses)[merchant]), lock = requestObject(state.luckySlotLocks)[merchant];
  const reserve = protectedSlotsOf(state, merchant);
  if (!Array.isArray(report.items) || freeSlots(report.items, typeof lock === 'number' ? lock : null, reserve) > 0) return true;
  job.pauseReason = `Offering collection needs a free merchant inventory slot past the ${reserve} protected free slots and the lucky slot's hold`;
  return false;
}

interface SupplyState extends SharedScope {
  merchantCharacter: string | null;
  merchantCurrent: MerchantWork | null;
  upgradeOfferingRules?: UpgradeOfferingRule[];
  upgrades?: Record<string, unknown[] | undefined>;
  statuses?: Record<string, { items?: (InventoryEntry | null)[] } | undefined>;
  commands?: Record<string, unknown>;
  autoUpgradeMarks?: Record<string, Record<string, unknown> | undefined>;
}
/** createOfferingSupply queues the slot handoff; the merchant yields its job before storage runs. */
function createOfferingSupply(state: SupplyState, queue: (offering: UpgradeOffering, quantity: number) => boolean, persist: () => void = () => {}) {
  return (body: Record<string, unknown>): ItemsAnswer => {
    const job = state.merchantCurrent;
    if (!job || job.id !== body.jobId || job.commandId !== body.commandId)
      return { status: 409, body: { error: 'upgrade job is no longer current' } };
    if (!isUpgradeOffering(body.offering) || !authorized(state, job, body))
      return { status: 409, body: { error: 'upgrade offering intent changed' } };
    admitBankContinuations(state, job, body);
    const outstanding = authorizedOfferingDemand(state, job, body.offering);
    const pending = outstanding > 0 && queue(body.offering, outstanding);
    const dependency = { ...supplyStatus(state, body.offering, outstanding, pending), intents: structuredClone(requestObject(state.commands?.[String(state.merchantCharacter)]).upgrades) };
    if (pending) job.offeringSupply = dependency;
    else delete job.offeringSupply;
    persist();
    return { body: { ...dependency, pending } };
  };
}
function authorized(state: SupplyState, job: MerchantWork, body: Request): boolean {
  const item = requestObject(body.item), mark = requestObject(body.mark);
  if (!liveItem(state, item) || typeof item.name !== 'string') return false;
  const command = requestObject(state.commands?.[String(state.merchantCharacter)]);
  if (command.id !== job.commandId) return false;
  if (!admittedMark(command, mark) && !(mark.auto === true && authorizedBankRule(state, job, item, mark))) return false;
  const marks = state.upgrades?.[String(job.target || state.merchantCharacter)] || [];
  if (mark.auto !== true) return manualIntent(marks, mark, item, body.offering, state);
  return automaticOfferingIntent(state, job, body, marks);
}
function automaticOfferingIntent(state: SupplyState, job: MerchantWork, body: Request, marks: unknown[]): boolean {
  const item = requestObject(body.item), mark = requestObject(body.mark);
  return resolveUpgradeOffering(played(state, 'upgradeOfferingRules') || [], String(item.name), Number(item.level) || 0)?.offering === body.offering &&
    currentUpgradeRule(state, item, mark) && unfinished(mark, item) && (automaticIntent(marks, item, mark) || authorizedBankRule(state, job, item, mark));
}
function admittedMark(command: Request, mark: Request): boolean {
  return Array.isArray(command.upgrades) && command.upgrades.some(raw => {
    const saved = requestObject(raw);
    return Number(saved.tiers) === Number(mark.tiers) && saved.auto === mark.auto &&
      markMatches(requestObject(saved.item), requestObject(mark.item)) &&
      (saved.requestId ? saved.requestId === mark.requestId : saved.slot === mark.slot);
  });
}
function currentUpgradeRule(state: SupplyState, item: Request, mark: Request): boolean {
  const key = ruleKey({ name: String(item.name), level: requestObject(mark.item).level as number | undefined });
  const owners = state.merchantRules ? [state.autoUpgradeMarks?.[String(state.merchantCharacter)]] : Object.values(state.autoUpgradeMarks || {});
  return owners.some(rules => {
    const saved = rules?.[key];
    return ruleTiers(saved) === Number(mark.tiers) && requestObject(saved).quantity !== 0;
  });
}
function liveItem(state: SupplyState, item: Request): boolean {
  return state.statuses?.[String(state.merchantCharacter)]?.items?.some(entry => entry?.item &&
    Object.keys(item).every(key => JSON.stringify(entry.item![key]) === JSON.stringify(item[key]))) === true;
}
function automaticIntent(marks: unknown[], item: Request, mark: Request): boolean {
  return marks.some(raw => {
    const saved = requestObject(raw), start = requestObject(saved.item);
    return saved.auto === true && start.name === item.name && start.level === requestObject(mark.item).level;
  });
}
function manualIntent(marks: unknown[], mark: Request, item: Request, offering: unknown, state: SupplyState): boolean {
  return marks.map(requestObject).some(saved => originalManual(saved, mark) && unfinished(saved, item) &&
    resolveUpgradeOffering(played(state, 'upgradeOfferingRules') || [], String(item.name), Number(item.level) || 0, explicitOffering(saved))?.offering === offering);
}
function originalManual(saved: Request, mark: Request): boolean {
  const identity = typeof saved.requestId === 'string' ? saved.requestId === mark.requestId : saved.slot === mark.slot && !!saved.equipped === !!mark.equipped;
  return identity && saved.auto !== true && markMatches(requestObject(saved.item), requestObject(mark.item)) && Number(saved.tiers) === Number(mark.tiers);
}
/** Count only admitted, authorized unfinished steps, assigning each live copy once. */
function authorizedOfferingDemand(state: SupplyState, job: MerchantWork, offering: UpgradeOffering): number {
  const command = requestObject(state.commands?.[String(state.merchantCharacter)]);
  if (command.id !== job.commandId || !Array.isArray(command.upgrades)) return 0;
  const live = state.statuses?.[String(state.merchantCharacter)]?.items || [], used = new Set<number>();
  let demand = 0;
  for (const raw of command.upgrades) {
    const mark = requestObject(raw), index = liveMarkIndex(live, mark, used);
    if (index < 0) continue;
    const item = live[index]!.item!;
    const selected = resolveUpgradeOffering(played(state, 'upgradeOfferingRules') || [], String(item.name), Number(item.level) || 0, explicitOffering(mark));
    if (!authorized(state, job, { item, mark, offering: selected?.offering })) continue;
    used.add(index);
    demand += offeringSteps(offeringRules(state), mark, Number(item.level) || 0, offering);
  }
  return Math.max(0, demand - carriedOfferings(state, offering));
}
function liveMarkIndex(live: (InventoryEntry | null)[], mark: Request, used: Set<number>): number {
  const matches = (entry: InventoryEntry | null, index: number) => !used.has(index) && !!entry?.item && unfinished(mark, entry.item);
  const index = live.findIndex((entry, index) => entry?.slot === (mark.liveSlot ?? mark.slot) && matches(entry, index));
  return index >= 0 ? index : live.findIndex(matches);
}
function supplyStatus(state: SupplyState, offering: UpgradeOffering, outstanding: number, pending: boolean) {
  const status = pending ? 'pending' : outstanding ? 'unavailable' : 'delivered';
  const blockingReason = pending ? 'Waiting for confirmed merchant collection' : outstanding ? 'No usable offering stock' : null;
  return { offering, outstanding, state: status, blockingReason, rulesSignature: JSON.stringify(played(state, 'upgradeOfferingRules') || []) };
}
/** Bank input admission marks the bag copies each bank rule still has room for (ruleRoom). */
function admitBankContinuations(state: SupplyState, job: MerchantWork, body: Request): void {
  const command = requestObject(state.commands?.[String(state.merchantCharacter)]);
  if (!Array.isArray(command.bankUpgradeRules)) return;
  const marks = Array.isArray(command.upgrades) ? command.upgrades : [];
  const additions = bankContinuations(state, job, command, marks);
  for (const mark of additions) if (mark.slot === requestObject(body.mark).slot) Object.assign(mark, requestObject(body.mark));
  if (additions.length) writeIntents(state, String(job.target || state.merchantCharacter), saved => saved.concat(additions));
  command.upgrades = marks.concat(additions);
}
function bankContinuations(state: SupplyState, job: MerchantWork, command: Request, marks: unknown[]): Request[] {
  const candidates = state.statuses?.[String(state.merchantCharacter)]?.items || [];
  const rules = Array.isArray(command.bankUpgradeRules) ? command.bankUpgradeRules.map(requestObject) : [];
  const additions: Request[] = [];
  for (const entry of candidates) additions.push(...bankContinuation(state, job, entry, marks.concat(additions), rules));
  return additions;
}
// A rule's copies left to mark: its quantity less the marks that already reach its target, or
// every copy for quantity -1. The character's withdrawals stop at the bag's free cells past its
// protected free slots (shared.js prepareBankUpgrades), so the copies admitted here already sit in
// the bag and need no cell count.
function ruleRoom(rule: Request, marks: unknown[]): number {
  if (Number(rule.quantity) === -1) return Infinity;
  const target = Number(rule.level || 0) + Number(rule.tiers);
  const planned = marks.map(requestObject).filter(mark => requestObject(mark.item).name === rule.name &&
    Number(requestObject(mark.item).level || 0) + Number(mark.tiers) >= target).length;
  return Math.max(0, Number(rule.quantity) - planned);
}
function bankContinuation(state: SupplyState, job: MerchantWork, entry: InventoryEntry | null, marks: unknown[], rules: Request[]): Request[] {
  if (!entry?.item || marks.some(raw => requestObject(raw).slot === entry.slot)) return [];
  const item = entry.item, rule = rules.find(rule => rule.name === item.name && Number(rule.level || 0) === Number(item.level || 0));
  if (!rule || !(ruleRoom(rule, marks) > 0)) return [];
  const mark = { slot: entry.slot, item, tiers: rule.tiers, auto: true };
  return currentUpgradeRule(state, item, mark) && authorizedBankRule(state, job, item, mark) ? [mark] : [];
}
function authorizedBankRule(state: SupplyState, job: MerchantWork, item: Request, mark: Request): boolean {
  const command = requestObject(state.commands?.[String(state.merchantCharacter)]);
  if (command.id !== job.commandId || !Array.isArray(command.bankUpgradeRules)) return false;
  const start = requestObject(mark.item), level = Number(item.level) || 0;
  return command.bankUpgradeRules.some(raw => {
    const rule = requestObject(raw), sourceLevel = Number(rule.level) || 0, tiers = Number(rule.tiers);
    return rule.name === item.name && sourceLevel === Number(start.level || 0) &&
      Number(mark.tiers) === tiers && level >= sourceLevel && level < sourceLevel + tiers;
  });
}

export interface OfferingRulesState { upgradeOfferingRules?: UpgradeOfferingRule[] }
interface CatalogEntry { id: string; upgradeable?: boolean; meta?: { upgradeable?: boolean } | null }
interface OfferingCatalogState extends OfferingRulesState { merchantCatalog?: { allItems?: CatalogEntry[] } | null }
// An offering rule's highest destination is the item's top level, the one the dashboard's rule dialog
// offers (rules.ts `maximumItemLevel`, `validOfferingRange`).
function offeringMaximum(state: OfferingCatalogState, name: string): number {
  const entry = state.merchantCatalog?.allItems?.find(item => item.id === name);
  return maximumItemLevel({ upgrade: entry?.upgradeable || entry?.meta?.upgradeable });
}
// The offering rules are a setting: each request builds the next list and writes it through the
// settings writer.
export function createOfferingCommands(state: OfferingCatalogState, write: (batch: SettingsWrite) => SettingsWriteResult) {
  const save = (rules: UpgradeOfferingRule[]): CommandOutcome => {
    const written = write({ by: 'dashboard:command', changes: [{ field: 'upgradeOfferingRules', value: rules }] });
    return written.ok ? null : { status: 400, body: { error: written.error } };
  };
  return (body: Record<string, unknown>): CommandOutcome => {
    if (body.type !== 'upgrade-offering-rule') return undefined;
    const rules = fitOfferingRules([...(state.upgradeOfferingRules || [])]) as UpgradeOfferingRule[];
    const input = requestObject(body.rule), id = ruleId(input);
    const index = rules.findIndex(rule => rule.id === id);
    if (id && index < 0) return {status:404, body:{error:'Upgrade rule no longer exists'}};
    if (body.remove === true) {
      if (index < 0) return {status:400, body:{error:'Select a rule to remove'}};
      rules.splice(index, 1); return save(rules);
    }
    const max = offeringMaximum(state, String(input.name));
    const error = validate(input, max);
    if (error) return {status:400, body:{error}};
    const next: UpgradeOfferingRule = {id:newRuleId(id), name:String(input.name), floor:Number(input.floor),
      ceiling:Number(input.ceiling), offering:input.offering as UpgradeOfferingRule['offering'], required:input.required === true};
    const problem = offeringProblem(rules, next, max);
    if (problem) return {status:problem.conflict ? 409 : 400, body:{error:problem.error}};
    if (index < 0) rules.push(next); else rules[index] = next;
    return save(rules);
  };
}
// The request's own shape; offeringProblem judges the range and the overlap.
function validate(rule: Record<string, unknown>, max: number): string | null {
  if (!isUpgradeOffering(rule.offering) || typeof rule.required !== 'boolean') return 'Choose an offering and availability mode';
  if (!max || !Number.isSafeInteger(rule.floor) || !Number.isSafeInteger(rule.ceiling) || Number(rule.floor) < 0) return 'Choose valid upgrade levels';
  return null;
}

function ruleId(input: Record<string, unknown>): string { return typeof input.id === 'string' ? input.id : ''; }
function newRuleId(id: string): string { return id || globalThis.crypto.randomUUID(); }

// ---------------------------------------------------------------------------------------------
// The upgrade commands.

interface UpgradeCommandState extends SharedScope {
  upgrades: Record<string, UpgradeMark[] | undefined>;
  autoUpgradeMarks: Record<string, Record<string, UpgradeRule | undefined> | undefined>;
  goldTargets: Record<string, number>;
  statuses: Record<string, { items?: unknown } | undefined>;
}
interface UpgradePorts {
  selectAction?(item: Item, name: string, draft: SettingsDraft): void;
  key(item: Item): string;
  persist(): void;
  write(batch: SettingsWrite): SettingsWriteResult;
  queue(names: string[], reason: JobReason): void;
  reconcile(name: string, status: UpgradeCommandState["statuses"][string]): void;
}
interface MarkRequest extends Request {
  item: Item & { name: string };
  slot: string | number;
}
function markRequest(body: Request): body is MarkRequest {
  return (
    typeof requestObject(body.item).name === "string" &&
    (Number.isSafeInteger(body.slot) ||
      (body.equipped === true && typeof body.slot === "string" && /^[a-z0-9_]+$/i.test(body.slot)))
  );
}
function validTiers(value: unknown, level: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= UPGRADE_TARGET_ACCEPTED - level;
}

/** Upgrade intents retain their starting item; a retry must not reinterpret the target level. */
export function createUpgradeCommands(state: UpgradeCommandState, ports: UpgradePorts) {
  function mark(body: MarkRequest, auto: boolean): CommandOutcome {
    const name = requestText(body.character);
    if (auto) return automatic(body, name);
    const invalidOffering = validateManualOffering(state, body);
    if (invalidOffering) return invalidOffering;
    const tiers = body.tiers;
    if (body.remove !== true && !validTiers(tiers, Number(body.item.level) || 0)) return failure("invalid upgrade tiers");
    writeIntents(state, name, list => {
      const index = list.findIndex(entry => entry.slot === body.slot && !!entry.equipped === (body.equipped === true));
      if (body.remove !== true) put(list, index, body, tiers as number, false);
      else if (index >= 0) list.splice(index, 1);
      return list;
    });
    saveAndQueue(name, body);
    return null;
  }
  function put(list: UpgradeMark[], index: number, body: MarkRequest, tiers: number, auto: boolean): void {
    const entry: UpgradeMark = {
      slot: body.slot,
      item: body.item,
      ...(body.equipped === true ? { equipped: true } : {}),
      tiers,
      ...(auto ? { auto: true } : {}),
      ...(!auto ? {requestId:globalThis.crypto.randomUUID()} : {}),
      ...(!auto && isUpgradeOffering(body.offering) ? {offering:body.offering} : {}),
    };
    if (index >= 0) list[index] = entry;
    else list.push(entry);
  }
  function removeAutomatic(name: string, key: string): void {
    writeIntents(state, name, list => list.filter(entry => !(entry.auto && ports.key(entry.item) === key)));
  }
  function saveAndQueue(name: string, body: Request, auto = false): void {
    ports.persist();
    if (body.remove !== true) ports.queue([name], auto ? "auto upgrade" : "manual upgrades");
  }
  function reconcileMembers(name: string) {
    for (const member of ruleMembers(state, name)) ports.reconcile(member, state.statuses[member]);
  }
  function automatic(body: MarkRequest, name: string): CommandOutcome {
    const key = ports.key(body.item),
      rules = (state.autoUpgradeMarks[ruleOwner(state, name)] ||= {}),
      current = rules[key];
    const tiers = ruleTiers(current);
    if (body.remove === true) {
      delete rules[key];
      removeAutomatic(name, key);
    } else if (validTiers(body.tiers, Math.max(0, Number(body.item.level) || 0))) {
      // The rules this choice replaces that are settings go out through the settings writer; the
      // automatic upgrade rule itself is the items owner's record.
      const draft = settingsDraft(state);
      ports.selectAction?.(body.item, name, draft);
      const written = ports.write({ by: "dashboard:command", changes: draft.changes() });
      if (!written.ok) return failure(written.error);
      rules[key] = { tiers: body.tiers, quantity: automaticQuantity(current, tiers === body.tiers) };
      putAutomatic(name, body, body.tiers);
    } else return failure("invalid automatic upgrade tiers");
    saveAndQueue(name, body, true);
    reconcileMembers(name);
    return null;
  }
  function putAutomatic(name: string, body: MarkRequest, tiers: number): void {
    if (body.slot === -1) return;
    writeIntents(state, name, list => {
      put(list, list.findIndex(entry => entry.slot === body.slot && !!entry.equipped === (body.equipped === true)), body, tiers, true);
      return list;
    });
  }
  function automaticQuantity(current: UpgradeRule | undefined, sameTiers: boolean): number {
    return sameTiers && typeof current === 'object' ? current.quantity ?? -1 : -1;
  }
  function updatedRule(
    body: Request,
    current: UpgradeRule | undefined,
    key: string,
  ): { tiers: number; quantity: number } | null {
    const existing =
      current && typeof current === "object" ? current : { tiers: Number(current), quantity: -1 };
    const tiers = body.tiers === undefined ? Number(existing.tiers) : Number(body.tiers);
    const quantity =
      body.quantity === undefined ? Number(existing.quantity) : Number(body.quantity);
    const level = ruleKeyParts(key)?.level ?? 0;
    if (
      !validTiers(tiers, level) ||
      !Number.isSafeInteger(quantity) ||
      (quantity !== -1 && quantity < 1)
    )
      return null;
    return { tiers, quantity };
  }
  function update(body: Request, key: string): CommandOutcome {
    const name = requestText(body.character),
      rules = (state.autoUpgradeMarks[ruleOwner(state, name)] ||= {});
    if (!Object.hasOwn(rules, key)) return failure("automatic upgrade rule not found", 404);
    const rule = updatedRule(body, rules[key], key);
    if (body.remove === true) delete rules[key];
    else if (rule) rules[key] = rule;
    else return failure("invalid automatic upgrade target");
    if (body.remove === true) removeAutomatic(name, key);
    else writeIntents(state, name, list => list.map(entry => entry.auto && ports.key(entry.item) === key ? { ...entry, tiers: rule!.tiers } : entry));
    ports.persist();
    reconcileMembers(name);
    return null;
  }
  function gold(body: Request): CommandOutcome {
    if (
      typeof body.amount !== "number" ||
      !Number.isSafeInteger(body.amount) ||
      body.amount < 0
    )
      return undefined;
    const written = ports.write({ by: "dashboard:command", changes: [{ field: "goldTargets", character: requestText(body.character), value: body.amount }] });
    return written.ok ? null : failure(written.error);
  }
  function handle(body: Request): CommandOutcome {
    switch (body.type) {
      case "gold-target":
        return gold(body);
      case "upgrade-mark":
        return markRequest(body) ? mark(body, false) : undefined;
      case "auto-upgrade-mark":
        return markRequest(body) ? mark(body, true) : undefined;
      case "update-auto-upgrade-rule":
        return typeof body.ruleKey === "string" ? update(body, body.ruleKey) : undefined;
      default:
        return undefined;
    }
  }
  return { handle };
}

function validateManualOffering(state: UpgradeCommandState, body: Request): CommandOutcome {
  if (body.offering === undefined || body.remove === true) return null;
  if (!isUpgradeOffering(body.offering) || body.tiers !== 1) return failure("Invalid manual offering attempt");
  if (!offeringStock(state)[body.offering]) return failure("Offering no longer available in merchant inventory, bank or BankBoi storage", 409);
  return null;
}

// ---------------------------------------------------------------------------------------------
// The journal.

interface ReceiptRule { family: 'upgrade' | 'compound'; key: string; signature: string }
// Recovery is a client journal protocol, not a complete game item or operation.
export interface ProductionJournal { id: string; item: {name: string; level?: number}; slots: number[]; phase: 'prepared' | 'running' | 'complete'; [key: string]: unknown }
export interface ProductionAttempt { name: string; level: number; kind: 'upgrade' | 'compound'; rules: ReceiptRule[]; journal?: ProductionJournal; automaticCompoundTarget?: number; completed?: boolean; completedAt?: number; success?: boolean; requestId?: string; offering?: string; resolution?: { outcome: 'unknown'; reason: string; at: number; resumeMissing?: true } }
export interface ProductionState { attempts: Record<string, ProductionAttempt> }
export function pendingProduction(production: ProductionState, includeJournal = false) {
  return Object.entries(production.attempts).filter(([, attempt]) => !attempt.completed)
    .map(([id, attempt]) => ({id, name:attempt.name, level:attempt.level, kind:attempt.kind, ...(includeJournal && attempt.journal ? {journal:attempt.journal} : {})}));
}
interface JournalState extends ConflictState {
  merchantCurrent?: MerchantWork | null;
  merchantQueue?: MerchantWork[];
  upgrades?: Record<string, {requestId?: string}[] | undefined>;
  upgradeOfferingRules?: UpgradeOfferingRule[];
  merchantCharacter: string | null;
  production: ProductionState;
  autoUpgradeMarks: Record<string, Record<string, UpgradeRule | undefined> | undefined>;
  autoCompounds: Record<string, CompoundRule[] | undefined>;
}
function rule(state: JournalState, family: string, key: string) {
  const owner = String(state.merchantCharacter);
  return family === 'upgrade' ? state.autoUpgradeMarks[owner]?.[key] : state.autoCompounds[owner]?.find(value => value.name === key);
}
function upgradeTargets(state: JournalState, name: string, level: number): ReceiptRule[] {
  const result: ReceiptRule[] = [];
  for (const [key, value] of Object.entries(state.autoUpgradeMarks[String(state.merchantCharacter)] || {})) {
    const rule = ruleKeyParts(key);
    if (rule?.name === name && rule.level + ruleTiers(value) === level && ruleQuota(value) > 0)
      result.push({family:'upgrade',key,signature:JSON.stringify(value)});
  }
  return result;
}
function targets(state: JournalState, name: string, level: number, kind: string): ReceiptRule[] {
  if (kind === 'upgrade') return upgradeTargets(state,name,level);
  return (state.autoCompounds[String(state.merchantCharacter)] || [])
    .filter(value => value.name === name && Number(value.targetTier || 1) === level && ruleQuota(value) > 0)
    .map(value => ({family:'compound',key:name,signature:JSON.stringify(value)}));
}
function automaticGuard(state: JournalState, automatic: Record<string,unknown>): void {
  if (!automatic.key) return;
  const value = rule(state,requestText(automatic.family),requestText(automatic.key));
  if (!value) throw Error('Automatic production rule removed');
  if (ruleQuota(value) === 0) throw Error('Production quota completed');
}
function attemptInput(body: Record<string,unknown>) {
  const id = requestText(body.id), item = requestObject(body.item), level = Number(item.level ?? 0) + 1;
  if (!id || typeof item.name !== 'string' || !Number.isSafeInteger(level) || level < 1 || level > UPGRADE_TARGET_ACCEPTED)
    throw Error('Invalid production attempt');
  const kind = requestText(body.kind);
  if (kind !== 'upgrade' && kind !== 'compound') throw Error('Invalid production kind');
  return {id,name:item.name,level,kind:kind as ProductionAttempt["kind"]};
}
// The journal keeps every unfinished attempt and each item's newest finished
// attempt, the one a resent receipt names; an older finished attempt goes. finishProduction passes
// the attempt it finished: that one is its item's newest even when another attempt of the item
// finished in the same millisecond.
function pruneProductionReceipts(production: ProductionState, finished?: string): void {
  const newest = new Map<string, string>();
  const justFinished = finished === undefined ? undefined : production.attempts[finished];
  if (justFinished) newest.set(justFinished.name, finished!);
  for (const [id, attempt] of Object.entries(production.attempts)) {
    if (!attempt.completed || attempt.name === justFinished?.name) continue;
    const kept = newest.get(attempt.name);
    if (!kept || (attempt.completedAt ?? 0) > (production.attempts[kept]!.completedAt ?? 0)) newest.set(attempt.name, id);
  }
  for (const [id, attempt] of Object.entries(production.attempts))
    if (attempt.completed && newest.get(attempt.name) !== id) delete production.attempts[id];
}
export function beginProduction(state: JournalState, body: Record<string, unknown>) {
  pruneProductionReceipts(state.production);
  const input = attemptInput(body), {id,name,level,kind} = input;
  const previous = state.production.attempts[id];
  if (previous) {
    validateReceipt(previous, input);
    checkpointProduction(state, body);
    return previous;
  }
  if (Object.values(state.production.attempts).some(attempt => !attempt.completed)) throw Error('Production recovery pending');
  automaticGuard(state,requestObject(body.automatic));
  offeringGuard(state, body, name, level - 1);
  if (body.automatic && requestObject(body.automatic).family !== 'manual-upgrade' && itemRuleConflicts(state,requestObject(body.item)).length) throw Error("Conflicting automatic rules");
  rememberUpgradeContinuation(state, body);
  const attempt: ProductionAttempt = {name,level,kind,rules:targets(state,name,level,kind)};
  if (typeof body.requestId === "string") attempt.requestId = body.requestId;
  if (isUpgradeOffering(body.offering)) attempt.offering = body.offering;
  attempt.automaticCompoundTarget = compoundTarget(state, body, name, kind);
  state.production.attempts[id] = attempt;
  try { checkpointProduction(state, body); }
  catch (error) { delete state.production.attempts[id]; throw error; }
  return attempt;
}

export function checkpointProduction(state: JournalState, body: Record<string, unknown>): void {
  if (body.journal === undefined) return;
  const id = requestText(body.id), attempt = state.production.attempts[id], journal = requestObject(body.journal);
  const size = bagSize(requestObject(state.statuses)[String(state.merchantCharacter)]);
  if (!attempt || !validJournal(journal, id, attempt, size))
    throw Error('Invalid production recovery journal');
  if (attempt.completed) return;
  const phases = ['prepared', 'running', 'complete'];
  if (attempt.journal && phases.indexOf(requestText(journal.phase)) < phases.indexOf(attempt.journal.phase)) return;
  attempt.journal = structuredClone(journal) as ProductionJournal;
}
// A journal names the merchant's bag cells, so each slot sits inside the merchant's reported bag.
function validJournal(journal: Record<string, unknown>, id: string, attempt: ProductionAttempt, size: number): boolean {
  const item = requestObject(journal.item);
  return journal.id === id && item.name === attempt.name && Number(item.level || 0) + 1 === attempt.level &&
    ['prepared', 'running', 'complete'].includes(requestText(journal.phase)) && validJournalSlots(journal.slots, size);
}
function validJournalSlots(slots: unknown, size: number): boolean {
  return Array.isArray(slots) && slots.length > 0 && slots.every(slot => Number.isInteger(slot) && Number(slot) >= 0 && Number(slot) < size);
}
type ProductionLog = (message: string, level: 'success', details: {name: string; level: number; attemptId: string}) => void;
function retainCompletedCommerceJournal(attempt: ProductionAttempt): boolean {
  return attempt.journal?.phase === 'complete' && Boolean(attempt.journal.commerce);
}
export function finishProduction(state: JournalState, id: string, success: boolean, log?: ProductionLog): void {
  const attempt = state.production.attempts[id];
  if (!attempt) throw Error('Unknown production attempt');
  if (attempt.completed) return;
  if (success) consumeQuotas(state, attempt);
  attempt.completed = true; attempt.completedAt = Date.now(); attempt.success = success;
  recordItems({ decision: 'produced', subject: 'merchant', by: attempt.offering ? 'player' : 'P1',
    item: attempt.name, level: attempt.level, kind: attempt.kind, result: success ? 'success' : 'failure', id });
  // Keep bounded completed commerce evidence until its paid progress can replay
  // the exact outcome. Receipt pruning bounds these journals with the receipts.
  settleUpgradeContinuation(state,attempt.journal);
  if (!retainCompletedCommerceJournal(attempt)) delete attempt.journal;
  finishManualOffering(state, attempt);
  if (success && attempt.kind === 'compound' && attempt.level === attempt.automaticCompoundTarget)
    log?.('merchant completed auto compound', 'success', {name:attempt.name,level:attempt.level,attemptId:id});
  pruneProductionReceipts(state.production, id);
}
// The merchant's production report (POST /party-api/merchant/production): one answer per action.
export function productionReport(state: JournalState, persist: () => void, log?: ProductionLog) {
  return (body: Record<string, unknown>): ItemsAnswer => {
    if (body.character !== state.merchantCharacter) return { status: 400, body: {error:'Only the merchant performs production'} };
    try {
      if (body.action === 'pending') return { body: {ok:true,pending:pendingProduction(state.production, true),completedCommerce:completedCommerceReceipts(state)} };
      if (body.action === 'inspect') return { body: {ok:true,...inspectProduction(state, body)} };
      if (body.action === 'resolve-unknown') {
        resolveUnknownProduction(state, body);
        persist();
        return { body: {ok:true,attempt:state.production.attempts[String(body.id)]} };
      }
      if (body.action === 'wait-offering') { recordOfferingWait(state, body); persist(); return { body: {ok:true} }; }
      if (body.action === 'abort-manual') { abortManualProduction(state, requestText(body.id)); persist(); return { body: {ok:true} }; }
      if (body.action === 'checkpoint') checkpointProduction(state, body);
      else if (body.action === 'complete') finishProduction(state,String(body.id),body.success === true,log);
      else beginProduction(state,body);
      persist();
      const attempt = state.production.attempts[String(body.id)];
      return { body: {ok:true,attempt,reviewedCommerce:reviewedCommerceProgress(state,attempt)} };
    } catch(error) { return { status: 409, body: {error:String(error)} }; }
  };
}

/** Read-only reconciliation must never admit a prepared journal during recovery. */
export function inspectProduction(state: JournalState, body: Record<string, unknown>) {
  const input = attemptInput(body), attempt = state.production.attempts[input.id];
  if (attempt) validateReceipt(attempt, input);
  const pending = pendingProduction(state.production);
  return {attempt:attempt || null, pending,reviewedCommerce:reviewedCommerceProgress(state,attempt)};
}

function completedCommerceReceipts(state: JournalState) {
  const keys = new Set([state.merchantCurrent,...(state.merchantQueue || [])]
    .filter(Boolean).map(job => 'party-commerce:' + requestText(job?.commerceOrderId || job?.id)));
  return Object.entries(state.production.attempts).filter(([,attempt]) =>
    attempt.completed && attempt.journal?.phase === 'complete' &&
    keys.has(requestText(requestObject(attempt.journal.commerce).key)))
    .map(([id,attempt]) => ({id,completed:attempt.completed,success:attempt.success,journal:attempt.journal}));
}

function reviewedCommerceProgress(state: JournalState, attempt: ProductionAttempt | undefined) {
  if (!attempt?.resolution?.resumeMissing) return;
  const commerce = requestObject(attempt.journal?.commerce);
  const job = [state.merchantCurrent,...(state.merchantQueue || [])].find(entry =>
    entry && commerce.key === 'party-commerce:' + (typeof entry.commerceOrderId === 'string' ? entry.commerceOrderId : entry.id));
  const progress = requestObject(job?.resumeState), pending = requestObject(progress.pendingUpgrade);
  const outcome = requestObject(pending.outcome), resolution = requestObject(outcome.resolution);
  if (outcome.reviewedMissing !== true || resolution.at !== attempt.resolution.at) return;
  return {key:commerce.key,state:structuredClone(progress)};
}

/** Explicit operator resolution only; automatic recovery never guesses an orphan's outcome. */
export function resolveUnknownProduction(state: JournalState, body: Record<string, unknown>, now = Date.now()): void {
  const input = attemptInput(body), attempt = state.production.attempts[input.id];
  if (!attempt) throw Error('Unknown production attempt');
  validateReceipt(attempt, input);
  if (attempt.completed) return;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) throw Error('Production resolution requires a review reason');
  if (body.resumeMissing === true) reviewMissingCommerce(state, attempt, reason, now);
  attempt.resolution = {outcome:'unknown', reason, at:now, ...(body.resumeMissing === true ? {resumeMissing:true as const} : {})};
  attempt.completed = true;
  attempt.completedAt = now;
  pruneProductionReceipts(state.production);
  delete attempt.success;
  // Retire one-shot manual ownership without inventing a success or spending quotas.
  finishManualOffering(state, attempt);
}

/** Explicit reviewed disposition preserves paid progress without asserting destruction. */
function reviewMissingCommerce(state: JournalState, attempt: ProductionAttempt, reason: string, now: number): void {
  const commerce = requestObject(attempt.journal?.commerce);
  if (typeof commerce.key !== 'string') throw Error('Missing commerce recovery ownership');
  const job = [state.merchantCurrent, ...(state.merchantQueue || [])].find(entry =>
    entry && commerce.key === 'party-commerce:' + (typeof entry.commerceOrderId === 'string' ? entry.commerceOrderId : entry.id));
  if (!job) throw Error('Reviewed commerce order is no longer queued');
  const progress = requestObject(job.resumeState), pending = requestObject(progress.pendingUpgrade);
  const active = requestObject(progress.activeItem);
  if (progress.sequence !== commerce.sequence || !Object.keys(pending).length || active.name !== attempt.name || Number(active.level || 0) + 1 !== attempt.level)
    throw Error('Reviewed receipt no longer owns the active commerce cycle');
  pending.outcome = {reviewedMissing:true,resolution:{outcome:'unknown',reason,at:now}};
  progress.pendingUpgrade = pending;
  progress.sequence = Number(progress.sequence) + 1;
  job.resumeState = progress;
}

function validateReceipt(previous: ProductionAttempt, input: ReturnType<typeof attemptInput>): void {
  if (previous.name !== input.name || previous.level !== input.level || previous.kind !== input.kind)
    throw Error('Production receipt identity changed');
}
function compoundTarget(state: JournalState, body: Record<string, unknown>, name: string, kind: string): number | undefined {
  const automatic = requestObject(body.automatic);
  if (kind !== 'compound' || automatic.family !== 'compound' || automatic.key !== name) return;
  const compound = state.autoCompounds[String(state.merchantCharacter)]?.find(value => value.name === name);
  return compound ? Number(compound.targetTier || 1) : undefined;
}
function consumeQuotas(state: JournalState, attempt: ProductionAttempt): void {
  for (const target of attempt.rules) {
    const current = rule(state,target.family,target.key);
    if (JSON.stringify(current) !== target.signature || !current || typeof current !== 'object') continue;
    current.quantity = Math.max(0, ruleQuota(current) - 1);
  }
}

function finishManualOffering(state: JournalState, attempt: ProductionAttempt): void {
  if (!attempt.requestId) return;
  for (const owner of Object.keys(state.upgrades || {}))
    writeIntents(state, owner, marks => marks.filter(mark => mark.requestId !== attempt.requestId));
}
function manualOfferingGuard(state: JournalState, body: Record<string, unknown>, name: string, level: number): void {
  if (!body.requestId) return;
  const mark = Object.values(state.upgrades || {}).flatMap(marks => marks || []).find(mark => mark.requestId === body.requestId);
  const request = requestObject(mark), item = requestObject(request.item);
  if (!mark || request.offering !== body.offering || item.name !== name || Number(item.level || 0) !== level)
    throw Error('Manual upgrade request no longer exists or item changed');
}
function automaticOfferingGuard(state: JournalState, body: Record<string, unknown>, name: string, level: number): void {
  const automatic = requestObject(body.automatic);
  if (!['upgrade','manual-upgrade'].includes(String(automatic.family))) return;
  if (body.requestId) return; // Explicit one-attempt requests use their own guard.
  const selected = resolveUpgradeOffering(played(state, 'upgradeOfferingRules') || [], name, level);
  if (selected?.required && body.offering !== selected.offering) throw Error('Required upgrade offering missing');
  if (body.offering && selected?.offering !== body.offering) throw Error('Upgrade offering rule changed');
}
function offeringGuard(state: JournalState, body: Record<string, unknown>, name: string, level: number): void {
  if (body.kind !== 'upgrade') return;
  if (body.offering !== undefined && !isUpgradeOffering(body.offering)) throw Error('Invalid upgrade offering');
  manualOfferingGuard(state, body, name, level);
  automaticOfferingGuard(state, body, name, level);
}

/** The merchant journals whether it sent the game call before it sends it. */
export function abortManualProduction(state: JournalState, id: string): void {
  const attempt = state.production.attempts[id];
  if (!attempt || attempt.completed) return;
  if (!attempt.requestId) throw Error('Only an unissued manual offering attempt may be abandoned');
  delete state.production.attempts[id];
}

// ---------------------------------------------------------------------------------------------
// Compounds and exchanges.

export interface CompoundRule {
  name: string;
  targetTier?: number;
  quantity?: number;
}
export interface ExchangeRule {
  name: string;
  level?: number;
}
export interface ExchangeChoice {
  id: string;
  level?: number;
  reward?: unknown;
  required?: number;
}
export interface ExchangeLine {
  id: string;
  level: number;
  quantity: number;
  reward?: string;
}
type Entries = readonly (InventoryEntry | null | undefined)[];

function itemLevel(entry: InventoryEntry): number {
  return Number(entry.item?.level) || 0;
}

function hasCompoundTriplet(entries: readonly InventoryEntry[], target: number): boolean {
  const counts = new Map<number, number>();
  for (const entry of entries) {
    const level = itemLevel(entry);
    if (entry.item?.l || level >= target) continue;
    counts.set(level, (counts.get(level) || 0) + 1);
  }
  return [...counts.values()].some(count => count >= COMPOUND_INPUTS);
}

/**
 * A rule is runnable while one level below its target has a triplet on hand, counting
 * copies, not stack quantity; a spent rule (quota 0) is not. The character's per-pass count in
 * `merchantImprove` is where auto compound stops, so nothing here counts completions.
 */
export function compoundRunnable(rules: readonly CompoundRule[], entries: Entries): boolean {
  return rules.some(rule => ruleQuota(rule) !== 0 && hasCompoundTriplet(
    entries.filter((entry): entry is InventoryEntry => !!entry?.item && entry.item.name === rule.name), Math.max(1, Number(rule.targetTier) || 1)));
}

function exchangeQuantity(entries: Entries, rule: ExchangeRule, level: number): number {
  return entries.reduce((sum, entry) => {
    if (entry?.item?.name !== rule.name || itemLevel(entry) !== level || entry.item.l) return sum;
    return sum + (Number(entry.item.q) || 1);
  }, 0);
}

/** Plans only available complete exchanges; queue ownership stays with the scheduler. */
export function planAutoExchanges(
  rules: Readonly<Record<string, ExchangeRule>>,
  catalog: readonly ExchangeChoice[],
  entries: Entries,
) {
  const lines: ExchangeLine[] = [],
    keys: string[] = [];
  for (const [key, rule] of Object.entries(rules)) {
    const level = Number(rule.level) || 0;
    const choice = catalog.find(
      (entry) => !entry.reward && entry.id === rule.name && (Number(entry.level) || 0) === level,
    );
    if (!choice) continue;
    const quantity = Math.floor(
      exchangeQuantity(entries, rule, level) / Math.max(1, Number(choice.required) || 1),
    );
    if (quantity <= 0) continue;
    lines.push({ id: rule.name, level, quantity });
    keys.push(key);
  }
  return { lines, keys };
}

function compoundInput(entry: InventoryEntry | null | undefined, name: string, level: number): boolean {
  return !!entry?.item && !entry.item.l && entry.item.name === name &&
    (Number(entry.item.level) || 0) === level;
}

/** Stage only the missing ingredients for the highest available triple of the next rule. */
function planCompoundStorage(
  rules: readonly CompoundRule[],
  local: Entries,
  workers: readonly BankboiInventory[],
): StorageReference[] {
  for (const rule of rules) {
    if (Number(rule.quantity) === 0) continue;
    for (let level = Math.max(1, Number(rule.targetTier) || 1) - 1; level >= 0; level--) {
      const owned = local.filter((entry) => compoundInput(entry, rule.name, level)).length;
      if (owned >= COMPOUND_INPUTS) return [];
      const available = workers.flatMap((worker) => (worker.items || [])
        .filter((entry) => Number.isSafeInteger(entry?.slot) && compoundInput(entry, rule.name, level))
        .map((entry) => ({ pack: bankboiPack(worker.name), slot: entry!.slot, item: entry!.item })));
      if (owned + available.length >= COMPOUND_INPUTS) return available.slice(0, COMPOUND_INPUTS - owned);
    }
  }
  return [];
}

interface CompoundMark { slot: number; item: Item }
interface CompoundMarkState {
  compounds: Record<string, { items: CompoundMark[] }[] | undefined>;
}
function sameCompoundCopy(first: Item, second: Item): boolean {
  return markKey(first) === markKey(second);
}

/** Relocate a complete reservation set, never assigning two copies to one slot. */
export function reconcileCoordinatorCompoundMarks(
  state: CompoundMarkState,
  name: string,
  status?: { items?: unknown } | null,
): boolean {
  if (!Array.isArray(status?.items)) return false;
  const items = (status.items as (InventoryEntry | null)[]).filter(
    (entry): entry is InventoryEntry & { slot: number; item: Item } =>
      !!entry?.item && Number.isSafeInteger(entry.slot),
  );
  const marks = (state.compounds[name] || []).flatMap(group => group.items);
  const assigned = new Map<CompoundMark, number>();
  const used = new Set<number>();
  function assign(mark: CompoundMark, entry: typeof items[number] | undefined) {
    if (!entry) return;
    assigned.set(mark, entry.slot);
    used.add(entry.slot);
  }
  // Reserve unchanged slots first so relocated copies cannot steal them.
  for (const mark of marks)
    assign(mark, items.find(entry => entry.slot === mark.slot && !used.has(entry.slot) && sameCompoundCopy(entry.item, mark.item)));
  for (const mark of marks) {
    if (assigned.has(mark)) continue;
    assign(mark, items.find(entry => !used.has(entry.slot) && sameCompoundCopy(entry.item, mark.item)));
  }
  // reconcileCoordinatorCompoundMarks keeps the marks until a completion receipt consumes them.
  if (assigned.size !== marks.length) return false;
  let changed = false;
  for (const [mark, slot] of assigned) {
    if (mark.slot !== slot) { mark.slot = slot; changed = true; }
  }
  return changed;
}

interface Entry extends InventoryEntry {
  slot: number;
  item: Item;
  storage?: {pack:string;slot:number};
}
interface Group {
  id: string;
  name?: string;
  items: Entry[];
}
interface CompoundCommandState extends SharedScope {
  merchantCharacter: string | null;
  compounds: Record<string, Group[] | undefined>;
  autoCompounds: Record<string, CompoundRule[] | undefined>;
  autoUpgradeMarks: Record<string, unknown>;
  upgrades: Record<string, { auto?: boolean }[] | undefined>;
  statuses: Record<string, { items?: (Entry | null)[] } | undefined>;
  merchantQueue: { reason: string }[];
  merchantCurrent: { reason: string } | null;
  /** Bank entries carry per-copy meta; compoundable comes from this catalog. */
  merchantCatalog?: unknown;
  withdrawals?: Record<string, unknown[] | undefined>;
}
interface CompoundPorts {
  selectAction?(item: Item, name: string, draft: SettingsDraft): void;
  queue?: (names:string[],reason:JobReason) => void;
  persist(): void;
  write(batch: SettingsWrite): SettingsWriteResult;
  schedule(name: string, status: CompoundCommandState["statuses"][string]): void;
  log(message: string, level: string, details?: unknown): void;
}
function reply(body: Record<string, unknown>, status = 200): CommandOutcome {
  return { status, body };
}
function sameSelection(entry: Entry, slot: number, item: Item): boolean {
  return entry.slot === slot && JSON.stringify(entry.item) === JSON.stringify(item);
}
function nextGroup(groups: Group[]): number {
  return (
    groups.reduce((highest, entry) => {
      const match = /^group-(\d+)$/.exec(entry.id);
      return Math.max(highest, match ? Number(match[1]) : 0);
    }, 0) + 1
  );
}
function quantityFor(body: Request, previous: CompoundRule | undefined): number {
  if (body.quantity !== undefined) return Number(body.quantity);
  return previous && Number.isSafeInteger(Number(previous.quantity))
    ? Number(previous.quantity)
    : -1;
}
function validTier(tier: unknown): tier is number {
  return typeof tier === "number" && Number.isSafeInteger(tier) && tier >= 1 && tier <= COMPOUND_TARGET_MAX;
}
/** A manual compound's storage source is a bank vault or a BankBoi's bag. */
function storagePack(pack: unknown): pack is string {
  return isVaultPack(pack) || isBankboiPack(pack);
}
export function createCompoundCommands(state: CompoundCommandState, ports: CompoundPorts) {
  function remove(groups: Group[], slot: number, item: Item): CommandOutcome {
    const group = groups.find((entry) => entry.items.some((mark) => sameSelection(mark, slot, item)));
    if (group) {
      group.items = group.items.filter((mark) => !sameSelection(mark, slot, item));
      if (!group.items.length) groups.splice(groups.indexOf(group), 1);
      ports.persist();
    }
    return reply({ ok: true, compounds: groups });
  }
  function matching(name: string, groups: Group[], item: Item): Entry[] {
    const unavailable = new Set(groups.flatMap((group) => group.items.map((entry) => entry.slot)));
    return (state.statuses[name]?.items || []).filter(
      (entry): entry is Entry =>
        !!entry &&
        !unavailable.has(entry.slot) &&
        entry.item.name === item.name &&
        (entry.item.level || 0) === (item.level || 0),
    );
  }
  function bankManual(body: Request, item: Item): CommandOutcome {
    const name = state.merchantCharacter;
    if (!name || body.character !== name || !storagePack(body.pack) || !Number.isSafeInteger(body.slot))
      return reply({error:'invalid native bank compound selection'},400);
    const groups = state.compounds[name] ||= [];
    if (groups.some(group=>group.items.some(mark=>mark.storage && mark.storage.pack===body.pack && mark.storage.slot===body.slot && JSON.stringify(mark.item)===JSON.stringify(item)))) return null;
    // A cell another group or a pending withdrawal holds is not stock (aac30d45 compound-commands.ts:91-96).
    const reserved = new Set([...groups.flatMap(group=>group.items.map(mark=>mark.storage ? mark.storage.pack+':'+mark.storage.slot : 'inventory:'+mark.slot)),
      ...(state.withdrawals?.[name] || []).map(mark=>{const cell=requestObject(mark);return String(cell.pack)+':'+String(cell.slot);})]);
    const matches = protectedMerchantStorageStock(state).filter(entry=>storagePack(entry.craftLocation) && entry.item && !entry.item.l && !entry.item.b && entry.item.name===item.name && (entry.item.level||0)===(item.level||0) && !reserved.has(entry.craftLocation+':'+entry.slot));
    const selected = matches.find(entry=>entry.craftLocation===body.pack && entry.slot===body.slot && JSON.stringify(entry.item)===JSON.stringify(item));
    if (!selected || matches.length < COMPOUND_INPUTS || entryMeta(state.merchantCatalog, selected)?.compoundable !== true)
      return reply({error:'Need three available matching compoundable bank items'},409);
    const triplet=[selected,...matches.filter(entry=>entry!==selected).slice(0,COMPOUND_INPUTS-1)];
    const next=nextGroup(groups);
    groups.push({id:'group-'+next,name:'Group '+next,items:triplet.map((entry,index)=>({slot:-1-index,item:entry.item!,storage:{pack:entry.craftLocation,slot:entry.slot!}}))});
    // A BankBoi copy becomes a reserved withdrawal, so the BankBoi transaction returns it to a vault and the
    // deposit moves the mark's storage there (storage.ts `deposited`).
    const withdrawals = ((state.withdrawals ||= {})[name] ||= []);
    for (const entry of triplet) if (isBankboiPack(entry.craftLocation))
      withdrawals.push({ pack: entry.craftLocation, slot: entry.slot, item: entry.item, improvement: 'manual compounds' });
    ports.persist();ports.queue?.([name],'manual compounds');return null;
  }
  function manual(body: Request, item: Item): CommandOutcome {
    if (body.pack !== undefined) return bankManual(body,item);
    if (!Number.isSafeInteger(body.slot)) return undefined;
    const name = requestText(body.character),
      slot = body.slot as number,
      groups = (state.compounds[name] ||= []);
    if (body.remove === true) return remove(groups, slot, item);
    const matches = matching(name, groups, item),
      selected = matches.find((entry) => entry.slot === slot);
    if (!selected || matches.length < COMPOUND_INPUTS)
      return reply({ error: "couldn't make compounding group" }, 409);
    const next = nextGroup(groups),
      triplet = [selected, ...matches.filter((entry) => entry.slot !== slot).slice(0, COMPOUND_INPUTS - 1)];
    groups.push({
      id: "group-" + next,
      name: "Group " + next,
      items: triplet.map((entry) => ({ slot: entry.slot, item: entry.item })),
    });
    ports.persist();
    ports.queue?.([name], "manual compounds");
    return null;
  }
  function automatic(body: Request, item: Item & { name: string }): CommandOutcome {
    if (!validTier(body.targetTier)) return undefined;
    const name = ruleOwner(state, requestText(body.character)),
      list = (state.autoCompounds[name] ||= []),
      index = list.findIndex((entry) => entry.name === item.name);
    if (body.remove === true) {
      if (index >= 0) list.splice(index, 1);
    } else {
      const quantity = quantityFor(body, list[index]);
      if (!Number.isSafeInteger(quantity) || (quantity !== -1 && quantity < 1))
        return reply({ error: "invalid automatic compound quantity" }, 400);
      const mark = { name: item.name, targetTier: body.targetTier, quantity };
      // The rules this choice replaces that are settings go out through the settings writer; the
      // automatic compound rule itself is the items owner's record.
      const draft = settingsDraft(state);
      ports.selectAction?.(item, name, draft);
      const written = ports.write({ by: "dashboard:command", changes: draft.changes() });
      if (!written.ok) return reply({ error: written.error }, 400);
      if (index >= 0) list[index] = mark;
      else list.push(mark);
    }
    ports.persist();
    ports.schedule(name, state.statuses[name]);
    return null;
  }
  function clear(body: Request, upgrades: boolean): CommandOutcome {
    const kind = upgrades ? "upgrades" : "compounds";
    if (body.character !== state.merchantCharacter)
      return reply({ error: "only the configured merchant can clear automatic " + kind }, 409);
    if (upgrades) {
      for (const name of Object.keys(state.autoUpgradeMarks)) state.autoUpgradeMarks[name] = {};
      for (const name of Object.keys(state.upgrades))
        writeIntents(state, name, marks => marks.filter(entry => !entry.auto));
      ports.persist();
      ports.log("Cleared all automatic upgrade rules", "info");
      return reply({ ok: true, autoUpgradeMarks: state.autoUpgradeMarks });
    }
    for (const name of Object.keys(state.autoCompounds)) state.autoCompounds[name] = [];
    const removed = reviseQueuedJobs(state, (job) => job.reason === "auto compound" ? null : job);
    ports.log("Cleared all automatic compound rules", "info", {
      queuedJobsRemoved: removed,
      activeJobFinishing: state.merchantCurrent?.reason === "auto compound",
    });
    ports.persist();
    return reply({ ok: true, autoCompounds: state.autoCompounds });
  }
  function handle(body: Request): CommandOutcome {
    if (body.type === "clear-auto-upgrades") return clear(body, true);
    if (body.type === "clear-auto-compounds") return clear(body, false);
    const item = requestObject(body.item);
    if (typeof item.name !== "string") return undefined;
    if (body.type === "compound-mark") return manual(body, item);
    if (body.type === "auto-compound-mark") return automatic(body, item as Item & { name: string });
    return undefined;
  }
  return { handle };
}

export interface BankUpgradeRule { name: string; level: number; tiers: number; quantity: number; existingTargetQuantity?: number }
export interface BankImprovementState extends ConflictState, CraftReservationState {
  merchantCharacter: string | null;
  upgrades?: Record<string, unknown[] | undefined>;
  autoUpgradeMarks?: Record<string, Record<string, UpgradeRule | undefined> | undefined>;
  autoCompounds: Record<string, CompoundRule[] | undefined>;
  statuses?: Record<string, { items?: (InventoryEntry | null)[] } | undefined>;
  bankSnapshot?: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
  bankbois?: Record<string, BankboiInventory>;
}
function bankQuota(value: unknown): number { return Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : -1; }
function mergedQuantity(a: number, b: number): number { return a === -1 || b === -1 ? -1 : Math.max(a, b); }

/** Bank stock is shared, so sharedUpgradeRules admits one pass for duplicate rules and one withdrawal. */
export function sharedCompoundRules(state: Pick<BankImprovementState, 'merchantCharacter' | 'merchantRules' | 'autoCompounds'>): CompoundRule[] {
  const rules = new Map<string, CompoundRule>();
  for (const rule of (state.merchantRules ? [state.autoCompounds[String(state.merchantCharacter)]] : Object.values(state.autoCompounds)).flatMap(value => value || [])) {
    const key = rule.name + "@" + (rule.targetTier || 1), old = rules.get(key);
    rules.set(key, { name: rule.name, targetTier: rule.targetTier || 1,
      quantity: old ? mergedQuantity(bankQuota(old.quantity), bankQuota(rule.quantity)) : bankQuota(rule.quantity) });
  }
  return [...rules.values()].sort((a, b) => Number(b.targetTier) - Number(a.targetTier));
}
function parseUpgrade(key: string, value: UpgradeRule | undefined): BankUpgradeRule | null {
  const parts = ruleKeyParts(key), tiers = ruleTiers(value);
  if (!parts || !Number.isSafeInteger(tiers) || tiers < 1 || tiers + parts.level > UPGRADE_TARGET_ACCEPTED) return null;
  // A rule saved to UPGRADE_TARGET_ACCEPTED runs to UPGRADE_LEVEL_MAX.
  const reach = Math.min(tiers, UPGRADE_LEVEL_MAX - parts.level);
  if (reach < 1) return null;
  return { name: parts.name, level: parts.level, tiers: reach, quantity: bankQuota(typeof value === "object" ? value?.quantity : -1) };
}
export function sharedUpgradeRules(state: BankImprovementState): BankUpgradeRule[] {
  const rules = new Map<string, BankUpgradeRule>();
  for (const entries of (state.merchantRules ? [state.autoUpgradeMarks?.[String(state.merchantCharacter)]] : Object.values(state.autoUpgradeMarks || {}))) for (const [key, value] of Object.entries(entries || {})) {
    const rule = parseUpgrade(key, value);
    if (!rule) continue;
    const goal = key + "@" + rule.tiers, old = rules.get(goal);
    rules.set(goal, old ? { ...rule, quantity: mergedQuantity(old.quantity, rule.quantity) } : rule);
  }
  return [...rules.values()].sort((a, b) => (b.level + b.tiers) - (a.level + a.tiers));
}
function matchesUpgrade(rule: BankUpgradeRule, entry: InventoryEntry | null | undefined): boolean {
  return !!entry?.item && !entry.item.l && entry.item.name === rule.name && (Number(entry.item.level) || 0) === rule.level;
}
export function runnableBankUpgrades(state: BankImprovementState): BankUpgradeRule[] {
  const available = availableUpgradeStock(state);
  return sharedUpgradeRules(state).filter(rule => !hasWaitingUpgrade(state, rule) && (rule.quantity === -1 || rule.quantity > 0) && !itemRuleConflicts(state,{name:rule.name,level:rule.level}).length && available.some(entry => matchesUpgrade(rule, entry)));
}
/** Remote stock needs a storage handoff before it can admit an upgrade visit. */
export function localBankUpgrades(state: BankImprovementState, rules = runnableBankUpgrades(state)): BankUpgradeRule[] {
  const local = availableUpgradeStock(state).filter(entry => !isBankboiPack(entry?.craftLocation));
  return rules.filter(rule => local.some(entry => matchesUpgrade(rule, entry)));
}
function workerUpgrade(state: BankImprovementState, rule: BankUpgradeRule): StorageReference[] {
  const entry = availableUpgradeStock(state).find(entry => isBankboiPack(entry?.craftLocation) && matchesUpgrade(rule,entry));
  if (entry && Number.isSafeInteger(entry.slot)) return [{pack:entry.craftLocation!,slot:entry.slot,item:entry.item,improvement:'auto upgrade'}];
  return [];
}
export function planUpgradeStorage(state: BankImprovementState, rules: BankUpgradeRule[]): StorageReference[] {
  const local = availableUpgradeStock(state).filter(entry => !isBankboiPack(entry?.craftLocation));
  for (const rule of rules) {
    if (local.some(entry => matchesUpgrade(rule, entry))) continue;
    const requests = workerUpgrade(state, rule);
    if (requests.length) return requests;
  }
  return [];
}

function availableUpgradeStock(state: BankImprovementState) {
  return protectedMerchantStorageStock(state);
}

function hasWaitingUpgrade(state: BankImprovementState, rule: BankUpgradeRule): boolean {
  return Object.values(state.upgrades || {}).flatMap(marks => marks || []).some(raw => {
    const mark = raw as {item?: {name?: string; level?: number}};
    return mark.item?.name === rule.name && (mark.item.level || 0) === rule.level && !upgradeOfferingReady(state, mark);
  });
}

interface SchedulerState extends BankImprovementState {
  production: ProductionState;
  bankbois?: Record<string, BankboiInventory>;
  bankboiTransaction?: unknown;
  withdrawals?: Record<string, StorageReference[] | undefined>;
  merchantCharacter: string | null;
  merchantAutomations: Record<string, boolean | undefined>;
  bankSnapshot?: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
  autoCompounds: Record<string, CompoundRule[] | undefined>;
  autoExchanges?: Record<string, ExchangeRule>;
  merchantCatalog?: { exchangeable?: ExchangeChoice[]; craftable?: OrderChoice[] } | null;
  luckySlotLocks?: Record<string, number | null>;
  merchantCurrent?: { reason?: string; order?: unknown; resumeState?: unknown; id?: string } | null;
  merchantQueue: { reason?: string; target?: string | null; order?: unknown; resumeState?: unknown; id?: string }[];
}
interface SchedulerPorts {
  now(): number;
  enqueue(ask: EnqueueAsk): EnqueueAnswer;
  queue(names: string[], reason: JobReason): void;
  persist(): void;
  log(message: string, level: string, details?: unknown): void;
}
interface SchedulerStatus {
  name?: string;
  items?: (InventoryEntry | null)[];
}


/** Translate inventory evaluations into durable rules and serialized merchant work. */
export function createImprovementScheduler(state: SchedulerState, ports: SchedulerPorts) {
  let reservationError = "";
  function reportReservationError(): void {
    const error = craftProtection(state).error || "";
    if (error && error !== reservationError) ports.log(error, "error");
    reservationError = error;
  }
  // Compound inputs fill merchant cells, so they come only while a slot is free past the lucky
  // slot's hold and the protected free slots.
  function canReceiveCompoundInputs(status: SchedulerStatus): boolean {
    const merchant = String(state.merchantCharacter);
    return freeSlots(status.items, state.luckySlotLocks?.[merchant], protectedSlotsOf(state, merchant)) > 0;
  }
  function stageCompound(name: string, rules: CompoundRule[],
    local: (InventoryEntry | null | undefined)[], workers: BankboiInventory[]): void {
    // Wait for current work and its storage handoff to settle before planning another batch.
    if (!canStage(name)) return;
    const requests = planCompoundStorage(rules, local, workers).map(request => ({ ...request, improvement: "auto compound" }));
    if (!requests.length) return;
    (state.withdrawals ||= {})[name] = requests;
    ports.persist();
  }
  function exchangeInventory(items: (InventoryEntry | null)[]) {
    const bank = Object.values(state.bankSnapshot?.packs || {}).flatMap((pack) => pack || []);
    return planAutoExchanges(
      state.autoExchanges || {},
      state.merchantCatalog?.exchangeable || [],
      items.concat(bank),
    );
  }
  function canStage(name: string): boolean {
    return !state.merchantCurrent && !state.bankboiTransaction && !state.withdrawals?.[name]?.length;
  }
  function bankUpgrades(name: string): void {
    if (name !== state.merchantCharacter || played(state, 'merchantAutomations')["auto upgrade"] === false) return;
    const rules = runnableBankUpgrades(state);
    if (!rules.length) return;
    if (canStage(name)) {
      const requests = planUpgradeStorage(state, rules);
      if (requests.length) { (state.withdrawals ||= {})[name] = requests; ports.persist(); }
    }
    if (localBankUpgrades(state, rules).length) ports.queue([name], "auto upgrade");
  }
  function sharedCompounds(name: string, status: SchedulerStatus): boolean {
    const inventory = (status.items || []).filter(entry => !entry?.item || !itemRuleConflicts(state,entry.item).length).map(entry => entry && {...entry, craftLocation: inventoryPack(name)});
    const stock = inventory.concat(Object.entries(state.bankSnapshot?.packs || {}).flatMap(([pack, entries]) =>
      (entries || []).map(entry => entry && {...entry, craftLocation: pack})));
    const allWorkers = Object.values(state.bankbois || {});
    const available = availableCraftStock(stock.concat(allWorkers.flatMap(worker => (worker.items || []).map(entry =>
      entry && {...entry, craftLocation: bankboiPack(worker.name)}))).map(entry =>
        entry?.item && itemRuleConflicts(state,entry.item).length ? null : entry), craftProtection(state));
    const local = available.slice(0, stock.length);
    let offset = stock.length;
    const workers = allWorkers.map(worker => {
      const items = available.slice(offset, offset + (worker.items || []).length);
      offset += (worker.items || []).length;
      return {...worker, items};
    });
    const rules = sharedCompoundRules(state);
    const carried = local.slice(0, inventory.length);
    const receivesInputs = canReceiveCompoundInputs(status);
    if (receivesInputs) stageCompound(name, rules, local, workers);
    return compoundRunnable(rules, carried) || (receivesInputs && compoundRunnable(rules, local)) || compoundStorageLeftovers(rules, carried,
      local.concat(workers.flatMap(worker => worker.items || []))).length > 0;
  }
  function compound(name: string, status: SchedulerStatus | null | undefined): boolean {
    if (pendingProduction(state.production).length) return false;
    return evaluateCompound(name, status);
  }
  function evaluateCompound(name: string, status: SchedulerStatus | null | undefined): boolean {
    if (!sharedMember(state,name)) return false;
    reportReservationError();
    bankUpgrades(name);
    if (played(state, 'merchantAutomations')["auto compound"] === false || !Array.isArray(status?.items))
      return false;
    const runnable = name === state.merchantCharacter ? sharedCompounds(name, status)
      : collectionPickups({...state, statuses: {...state.statuses, [name]: status}}, name).keep.some(mark => mark.automaticPickup);
    if (runnable) ports.queue([name], name === state.merchantCharacter ? "auto compound" : "marked items");
    else pruneCompound(name);
    return runnable;
  }
  function pruneCompound(name: string): void {
    if (name !== state.merchantCharacter) return;
    if (reviseQueuedJobs(state, job => job.reason === "auto compound" && job.target === name ? null : job)) ports.persist();
  }

  function exchange(status: SchedulerStatus | null | undefined): boolean {
    if (pendingProduction(state.production).length) return false;
    if (played(state, 'merchantAutomations')['automatic exchange'] === false) return false;
    const merchant = state.merchantCharacter;
    if (!merchant || status?.name !== merchant || !Array.isArray(status.items)) return false;
    const { lines, keys } = exchangeInventory(status.items);
    if (
      !lines.length ||
      [state.merchantCurrent, ...state.merchantQueue].some((job) => job?.reason === "exchange")
    )
      return false;
    ports.enqueue({ reason: "exchange", target: merchant, fields: { routine: 'automatic exchange', exchanges: lines, autoExchangeKeys: keys } });
    ports.log("Automatic exchange queued", "info", { exchanges: lines });
    ports.persist();
    return true;
  }
  return { compound, exchange };
}

// ---------------------------------------------------------------------------------------------
// Stat scrolls.

interface Definition {
  stat?: unknown;
  upgrade?: unknown;
  compound?: unknown;
  grades?: number[];
}
interface StatEquipment {
  item: Item;
  meta?: InventoryEntry['meta'];
}
interface StatStatus {
  items?: ((InventoryEntry & StatEquipment) | null)[];
  slots?: Record<string, StatEquipment | undefined>;
  primaryStat?: string;
}
interface StatScrollMark {
  slot: string | number;
  item: Item;
  equipped?: boolean;
  statType: string;
  scroll: string;
}
interface StatState {
  merchantCharacter: string | null;
  statuses: Record<string, StatStatus | undefined>;
  statScrolls: Record<string, StatScrollMark[] | undefined>;
  bankSnapshot?: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
  merchantCatalog?: unknown;
}
interface StatScrollPorts {
  persist(): void;
  queue(names: string[], reason: JobReason): void;
}
const primary = new Set(["str", "int", "dex", "vit"]);
const supported = new Set([
  ...primary,
  "for",
  "evasion",
  "reflection",
  "gold",
  "luck",
  "xp",
  "armor",
  "resistance",
  "speed",
  "lifesteal",
  "manasteal",
  "rpiercing",
  "apiercing",
  "crit",
  "dreturn",
  "frequency",
  "mp_cost",
  "output",
]);
function scrollName(stat: string): string {
  return stat === "mp_cost" ? "mpcostscroll" : stat + "scroll";
}
function validSlot(body: Request, merchant: string | null): boolean {
  return (
    (typeof body.slot === "string" && /^[a-z0-9_]+$/i.test(body.slot)) ||
    (body.character === merchant && Number.isSafeInteger(body.slot))
  );
}
function count(entries: (InventoryEntry | null)[] | undefined, scroll: string): number {
  let owned = 0;
  for (const entry of entries || [])
    if (entry?.item?.name === scroll) owned += Math.max(1, Number(entry.item.q) || 1);
  return owned;
}
export function createStatScrollCommands(state: StatState, ports: StatScrollPorts) {
  function available(scroll: string): number {
    const inventories = [
      state.statuses[String(state.merchantCharacter)]?.items,
      ...Object.values(state.bankSnapshot?.packs || {}),
    ];
    return inventories.reduce((owned, entries) => owned + count(entries, scroll), 0);
  }
  function supplies(
    body: Request,
    item: Item,
    definition: Definition,
    stat: string,
  ): CommandOutcome {
    if (body.remove === true || primary.has(stat)) return null;
    const required = statScrollsNeeded(definition, Math.max(0, Number(item.level) || 0)),
      scroll = scrollName(stat);
    return available(scroll) < required
      ? failure("need " + required + " × " + scroll + " in merchant or bank inventory", 409)
      : null;
  }
  function save(body: Request, name: string, item: Item, inventory: boolean, stat: string): void {
    const list = (state.statScrolls[name] ||= []),
      index = list.findIndex(
        (entry) => entry.slot === body.slot && !!entry.equipped === !inventory,
      );
    if (body.remove === true) {
      if (index >= 0) list.splice(index, 1);
    } else {
      const mark: StatScrollMark = {
        slot: body.slot as string | number,
        item,
        ...(!inventory ? { equipped: true } : {}),
        statType: stat,
        scroll: scrollName(stat),
      };
      if (index >= 0) list[index] = mark;
      else list.push(mark);
    }
    ports.persist();
    if (inventory && body.remove !== true) ports.queue([name], "stat scrolls");
  }
  function validate(body: Request, equipped: StatEquipment, stat: string): CommandOutcome {
    const definition = entryMeta(state.merchantCatalog, equipped)?.definition;
    if (!definition || !Number(definition.stat))
      return failure("this equipment does not accept stat scrolls");
    if (!supported.has(stat)) return failure("unsupported stat scroll");
    const shortage = supplies(body, requestObject(body.item), definition, stat);
    if (shortage) return shortage;
    if (body.remove !== true && equipped.item.stat_type === stat)
      return failure("this equipment already has that stat scroll applied", 409);
    return null;
  }
  function selected(
    status: StatStatus | undefined,
    body: Request,
    inventory: boolean,
  ): StatEquipment | undefined | null {
    return inventory
      ? status?.items?.find((entry) => entry?.slot === body.slot)
      : status?.slots?.[requestText(body.slot)];
  }
  function process(body: Request, item: Item, name: string, inventory: boolean): CommandOutcome {
    const status = state.statuses[name];
    const equipped = selected(status, body, inventory);
    if (!equipped || JSON.stringify(equipped.item) !== JSON.stringify(item))
      return failure(
        (inventory ? "inventory" : "equipped") + " item changed; refresh and try again",
        409,
      );
    const stat = requestText(inventory ? body.statType : status?.primaryStat || "").toLowerCase();
    const error = validate(body, equipped, stat);
    if (error) return error;
    save(body, name, item, inventory, stat);
    return null;
  }
  function handle(body: Request): CommandOutcome {
    const item = requestObject(body.item);
    if (
      body.type !== "stat-scroll-mark" ||
      typeof item.name !== "string" ||
      !validSlot(body, state.merchantCharacter)
    )
      return undefined;
    const name = requestText(body.character),
      inventory = name === state.merchantCharacter && Number.isSafeInteger(body.slot);
    return process(body, item, name, inventory);
  }
  return { handle };
}

// ---------------------------------------------------------------------------------------------
// Orders and craft reservations.

export interface CraftMaterial {
  id: string;
  quantity: number;
  level?: number;
}
export interface OrderChoice extends UpgradeChoice {
  compoundable?: boolean;
  materials?: CraftMaterial[];
}
export interface OrderLine {
  id: string;
  quantity: number;
  level?: number;
  attempts?: number;
  budget?: number;
  scrolls?: number[];
  goldCap?: number;
  estimateUnavailable?: boolean;
  acknowledgeUnavailable?: boolean;
}
export interface Allocation {
  slot?: number;
  item: Item;
  quantity: number;
}
export interface StorageAllocation extends Allocation {
  allocationId: string;
  pack: string;
  resolved?: boolean;
}
export interface MaterialOrder {
  craftMaterials?: CraftMaterial[][];
  inventory?: Allocation[];
  buys: OrderLine[];
  crafts: OrderLine[];
  sources: Record<string, Allocation[]>;
  bank: (Allocation & { pack: string })[];
  storage?: StorageAllocation[];
  requirements: CraftMaterial[];
  materialBuys: CraftMaterial[];
}
export type MaterialEntry = InventoryEntry & Item;

function requirementsFor(crafts: OrderLine[], choices: OrderChoice[]): Map<string, CraftMaterial> {
  const requirements = new Map<string, CraftMaterial>();
  for (const line of crafts) {
    const recipe = choices.find((entry) => entry.id === line.id)!;
    for (const material of recipe.materials || []) {
      const key = exchangeKey(material.id, material.level);
      requirements.set(key, {
        id: material.id,
        level: material.level || 0,
        quantity: (requirements.get(key)?.quantity || 0) + material.quantity * line.quantity,
      });
    }
  }
  return requirements;
}

/** Allocates merchant inventory first, then normal bank, BankBoi, and online party inventory. */
function allocateOrderMaterials(
  crafts: OrderLine[],
  choices: OrderChoice[],
  merchant: string | null,
) {
  const requirements = requirementsFor(crafts, choices),
    totals = [...requirements.values()].map((entry) => ({ ...entry }));
  const sources: Record<string, Allocation[]> = {},
    inventory: Allocation[] = [],
    bank: (Allocation & { pack: string })[] = [],
    storage: StorageAllocation[] = [];
  function takeEntry(entry: MaterialEntry | null, owner: string | null, pack: string | null): void {
    if (!entry) return;
    const item = entry.item || entry,
      need = requirements.get(exchangeKey(item.name, item.level));
    if (!need || need.quantity <= 0) return;
    const amount = Math.min(need.quantity, item.q || 1);
    need.quantity -= amount;
    const allocation = { slot: entry.slot, item, quantity: amount };
    record(allocation, owner, pack);
  }
  function record(allocation: Allocation, owner: string | null, pack: string | null): void {
    if (isBankboiPack(pack))
      storage.push({ ...allocation, pack, allocationId: String(storage.length) });
    else if (pack) bank.push({ ...allocation, pack });
    else if (owner !== merchant) (sources[owner!] ||= []).push(allocation);
    else inventory.push(allocation);
  }
  function take(
    entries: (MaterialEntry | null)[] | undefined,
    owner: string | null,
    pack: string | null,
  ): void {
    for (const entry of entries || []) takeEntry(entry, owner, pack);
  }
  return {
    take,
    sources,
    inventory,
    storage,
    bank,
    totals,
    missing: () => [...requirements.values()].filter((entry) => entry.quantity > 0),
  };
}

function validLevel(choice: OrderChoice, level: number): boolean {
  const max = highestUpgradeLevel(choice);
  return (
    Number.isSafeInteger(level) && level >= 0 && level <= max && !(level > 0 && !choice.upgradeable)
  );
}
function validQuantity(quantity: number): boolean {
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= STACK_SIZE_MAX;
}
function validCap(cap: unknown): cap is number | undefined {
  return cap === undefined || (typeof cap === "number" && Number.isSafeInteger(cap) && cap > 0);
}
function levelFields(line: Record<string, unknown>, level: number): Partial<OrderLine> {
  const fields: Partial<OrderLine> = {};
  if (level) fields.level = level;
  if (typeof line.goldCap === "number") fields.goldCap = line.goldCap;
  if (line.acknowledgeUnavailable === true) fields.acknowledgeUnavailable = true;
  return fields;
}

function normalizeLine(
  raw: unknown,
  choices: OrderChoice[],
  allowLevel: boolean,
): OrderLine | null {
  const line = requestObject(raw),
    quantity = Number(line.quantity);
  const choice = choices.find((entry) => entry.id === line.id);
  if (typeof line.id !== "string" || !choice || !validQuantity(quantity)) return null;
  const level = Number(line.level) || 0;
  if (allowLevel && !validLevel(choice, level)) return null;
  const cap = line.goldCap;
  if (!validCap(cap)) return null;
  return {
    id: line.id,
    quantity,
    ...(allowLevel ? levelFields(line, level) : {}),
  };
}

function normalizeOrderLines(
  lines: unknown,
  choices: OrderChoice[],
  allowLevel: boolean,
): OrderLine[] | null {
  if (!Array.isArray(lines)) return null;
  const result: OrderLine[] = [];
  for (const raw of lines) {
    const line = normalizeLine(raw, choices, allowLevel);
    if (!line) return null;
    result.push(line);
  }
  return result;
}

interface Job { id?: string; reason?: string; target?: string | null; order?: unknown; resumeState?: unknown; queuedAt?: number; exchanges?: { id: string; level?: number }[] }
interface Progress {phase?: string; craftIndex?: number; crafted?: number}
export interface CraftReservationState {
  merchantDeliveries?: Record<string, unknown[] | undefined>;
  merchantCharacter?: string | null;
  merchantCurrent?: Job | null;
  merchantQueue?: Job[];
  merchantCatalog?: { craftable?: OrderChoice[] } | null;
}
function allocations(job: Job, merchant: string | null | undefined, requirements: CraftNeed[]): NonNullable<CraftProtection["allocations"]> {
  const order = job.order as MaterialOrder | undefined;
  if (!order?.crafts?.length) return [];
  const phase = (job.resumeState as Progress | undefined)?.phase;
  if (["leveling", "crafting"].includes(String(phase)))
    return requirements.map(need => ({...need, location: inventoryPack(merchant)}));
  const sources = [
    ...(order.inventory || []).map(mark => ({...mark, location: inventoryPack(merchant)})),
    ...Object.entries(order.sources || {}).flatMap(([name, marks]) => marks.map(mark => ({...mark, location: inventoryPack(name)}))),
    ...(order.bank || []).map(mark => ({...mark, location: mark.pack})),
    ...(order.storage || []).filter(mark => !mark.resolved).map(mark => ({...mark, location: mark.pack})),
  ];
  return sources.map(mark => ({id: String(mark.item.name), level: Number(mark.item.level) || 0, quantity: mark.quantity, location: mark.location}));
}
function remainingCount(quantity: number, index: number, progress?: Progress): number {
  if (progress?.phase !== "crafting") return quantity;
  const current = Number(progress.craftIndex) || 0;
  if (index < current) return 0;
  return Math.max(0, quantity - (index === current ? Number(progress.crafted) || 0 : 0));
}
function needs(job: Job, choices: OrderChoice[]): CraftNeed[] {
  const order = job.order as MaterialOrder | undefined;
  if (!order?.crafts?.length) return [];
  const progress = job.resumeState as Progress | undefined;
  if (progress?.phase !== "crafting" && order.requirements?.length) return order.requirements;
  return order.crafts.flatMap((line, index) => {
    const count = remainingCount(line.quantity, index, progress);
    if (!count) return [];
    const recipe = order.craftMaterials?.[index] || choices.find(choice => choice.id === line.id)?.materials;
    if (!recipe) throw Error("Cannot protect crafting ingredients: recipe missing for " + line.id);
    return recipe.map(material => ({...material, quantity: material.quantity * count}));
  });
}
/** Derived from durable jobs, so pauses, cancellation, and restarts share one reservation lifetime. */
export function craftProtection(state: CraftReservationState): CraftProtection {
  const jobs = [state.merchantCurrent, ...(state.merchantQueue || [])].filter((job): job is Job => !!job);
  const seen = new Set<string>();
  const requirements: CraftNeed[] = [];
  const reserved: NonNullable<CraftProtection["allocations"]> = [];
  try {
    for (const job of jobs.sort((a,b) => (a.queuedAt || 0) - (b.queuedAt || 0))) {
      if (job.id && seen.has(job.id)) continue;
      if (job.id) seen.add(job.id);
      const remaining = needs(job, state.merchantCatalog?.craftable || []);
      requirements.push(...remaining);
      reserved.push(...allocations(job, state.merchantCharacter, remaining));
      const pending = pendingCommerceStock(job);
      requirements.push(...pending);
      reserved.push(...pending.map(need => ({...need, location: inventoryPack(state.merchantCharacter)})));
    }
    return protectDeliveries(state, {requirements, allocations: reserved});
  } catch (error) { return {requirements, error: String(error instanceof Error ? error.message : error)}; }
}

function deliveryProtection(state: CraftReservationState): NonNullable<CraftProtection['deliveries']> {
  return Object.entries(state.merchantDeliveries || {}).flatMap(([recipient,marks]) => (marks || []).flatMap(raw => {
    const mark = raw as {item?: Item; slot?: number; awaitingEquip?: boolean};
    return mark.item ? [{item:mark.item, slot:mark.awaitingEquip ? undefined : mark.slot,
      location: inventoryPack(mark.awaitingEquip ? recipient : state.merchantCharacter)}] : []; }));
}

function protectDeliveries(state: CraftReservationState, protection: CraftProtection): CraftProtection {
  const deliveries = deliveryProtection(state).concat(commerceProtection(state));
  return deliveries.length ? {...protection, deliveries} : protection;
}

function commerceProtection(state: CraftReservationState): NonNullable<CraftProtection['deliveries']> {
  return [state.merchantCurrent, ...(state.merchantQueue || [])]
    .filter((job): job is Job => !!job).flatMap(job => {
    const progress = job.resumeState as {results?: {slot?: number; item: Item}[];
      batchItems?: {slot: number; item: Item}[];
      activeSlot?: number; activeItem?: Item;
      pendingUpgrade?: {level: number}; pendingPurchase?: {base?: boolean; name: string}} | undefined;
    if (!progress) return [];
    const owned = [...(progress.results || []), ...(progress.batchItems || [])];
    if (progress.activeItem) {
      owned.push({slot: progress.activeSlot, item: progress.activeItem});
      if (progress.pendingUpgrade) owned.push({slot: progress.activeSlot,
        item: {...progress.activeItem, level: progress.pendingUpgrade.level}});
    }
    if (progress.pendingPurchase?.base) owned.push({item: {name: progress.pendingPurchase.name as Item['name'], level: 0}});
    return owned.map(mark => ({...mark, location: inventoryPack(state.merchantCharacter)}));
  });
}

function pendingCommerceStock(job: Job): CraftNeed[] {
  const progress = job.resumeState as {pendingPurchase?: {name: string; quantity: number; before: number}} | undefined;
  const pending = progress?.pendingPurchase;
  return pending ? [{id: pending.name, quantity: pending.before + pending.quantity}] : [];
}


// ---------------------------------------------------------------------------------------------
// The upgrade preview.

interface PreviewStatus { seenAt?: number; upgradePreviewSession?: string; upgradePreviewRevision?: string; items?: (InventoryEntry | null)[] }
export interface StoredUpgradePreview {result:UpgradePreviewResult;at:number;revision:string}
interface PreviewState {
  upgradePreviewResults?: Record<string,StoredUpgradePreview>;
  merchantCharacter?: string | null; statuses: Record<string, PreviewStatus | undefined>;
  merchantCurrent: MerchantWork | null; merchantQueue: MerchantWork[];
}
interface PreviewPorts { persist(): void; dispatch(): void; enqueue(ask: EnqueueAsk): EnqueueAnswer }

/** Jobs persist with merchant work; persisted results are read without scheduling more work. */
export function createUpgradePreviewAnswers(state: PreviewState, ports: PreviewPorts, now = Date.now) {
  const results = state.upgradePreviewResults ||= {};
  function request(body: Record<string, unknown>): ItemsAnswer {
    const item = requestObject(body.item), executor = state.merchantCharacter || '';
    if (!validPreviewItem(body, item, bagSize(state.statuses[executor])))
      return { status: 400, body: { error: 'Invalid preview item' } };
    if (!merchantInventory(body, executor))
      return { status: 400, body: {error:'Item must be in merchant inventory'} };
    const key = JSON.stringify([executor,body.slot,item]);
    const stored = results[key];
    const revision=state.statuses[executor]?.upgradePreviewRevision;
    const cached=currentResult(stored, revision);
    const existing = existingPreview(key);
    if (existing) return { body: jobResponse(existing, cached, existing===state.merchantCurrent) };
    if (body.refresh !== true) return { body: {status:cachedStatus(cached, stored),result:cached?.result} };
    if (!itemUnchanged(executor, body, item))
      return { status: 409, body: {error:'Item changed; reopen the menu'} };
    const job = {id:'preview-'+globalThis.crypto.randomUUID(),target:executor,reason:'upgrade preview',manual:true,
      queuedAt:now(),previewKey:key,upgradePreview:{slot:body.slot,item}} satisfies Record<string, unknown> & { reason: JobReason };
    ports.enqueue({reason:job.reason,target:executor,fields:job});ports.persist();ports.dispatch();
    return { body: jobResponse(job, cached, running(job)) };
  }
  function running(job: MerchantWork): boolean {
    return state.merchantCurrent?.id===job.id;
  }
  function existingPreview(key: string) {
    return [state.merchantCurrent,...state.merchantQueue].find(job=>job?.reason==='upgrade preview' && job.previewKey===key);
  }
  function itemUnchanged(executor: string, body: RequestBody, item: RequestBody): boolean {
    const live = state.statuses[executor]?.items?.find(entry=>entry?.slot===body.slot)?.item;
    return !!live && Object.entries(item).every(([key,value])=>JSON.stringify(live[key])===JSON.stringify(value));
  }
  function response(body: Record<string, unknown>): ItemsAnswer {
    const job=state.merchantCurrent,executor=state.merchantCharacter || '';
    if (!job || !matchesJob(body, job) || !matchesExecutor(body, executor) || !validResult(body, job, executor))
      return { status: 409, body: {error:'Preview expired or changed'} };
    // The record keeps the results of the merchant's current preview
    // revision; a result of an earlier revision answers no request, so it goes.
    for (const key of Object.keys(results)) if (results[key]!.revision !== body.revision) delete results[key];
    results[String(job.previewKey)]={result:body.result as UpgradePreviewResult,at:now(),revision:body.revision as string};
    ports.persist();
    return { body: {ok:true} };
  }
  function matchesExecutor(body: RequestBody, executor: string): boolean {
    return typeof body.revision==='string' && body.character===executor &&
      body.session===state.statuses[executor]?.upgradePreviewSession;
  }
  return { request, response };
}

type RequestBody = ReturnType<typeof requestObject>;
function jobResponse(job: MerchantWork, cached: StoredUpgradePreview | undefined, running: boolean) {
  return {status:running?'running':'queued',jobId:job.id,result:cached?.result};
}
function validPreviewItem(body: RequestBody, item: RequestBody, size: number): boolean {
  return typeof item.name === 'string' && Number.isInteger(body.slot) && Number(body.slot) >= 0 && Number(body.slot) < size;
}
function merchantInventory(body: RequestBody, executor: string): boolean {
  return !!executor && body.character === executor && !body.equipped;
}
function currentResult(stored: StoredUpgradePreview | undefined, revision: string | undefined) {
  return stored && revision!==undefined && stored.revision===revision ? stored : undefined;
}
function cachedStatus(cached: StoredUpgradePreview | undefined, stored: StoredUpgradePreview | undefined): string {
  return cached ? previewStatus(cached.result) : stored ? 'invalidated' : 'idle';
}
function matchesJob(body: RequestBody, job: MerchantWork): boolean {
  return job.reason==='upgrade preview' && body.id===job.id && body.commandId===job.commandId;
}
function validResult(body: RequestBody, job: MerchantWork, executor: string): boolean {
  const wanted=requestObject(job.upgradePreview),result=requestObject(body.result),options=requestObject(result.options);
  return result.executor===executor && JSON.stringify(result.item)===JSON.stringify(wanted.item) &&
    previewOptions.every(option=>validOption(options[option]));
}
function validOption(option: unknown): boolean {
  const value=requestObject(option),preview=requestObject(value.preview);
  return typeof value.reason==='string' || preview.calculate===true && typeof preview.chance==='number' &&
    Number.isFinite(preview.chance) && preview.chance>=0 && typeof value.observedAt==='number';
}

function previewStatus(result: UpgradePreviewResult): string {
  const count = previewOptions.filter(option => 'preview' in result.options[option]).length;
  return count === 0 ? 'unavailable' : count === previewOptions.length ? 'complete' : 'partial';
}

/** Only the requested gear and intent can resolve survivor ambiguity; potions cannot. */
export function upgradeRecoverySignature(marks:unknown[],items:(InventoryEntry|null)[]):string {
  const names=new Set(marks.map(mark=>requestObject(requestObject(mark).item).name));
  return JSON.stringify([marks,items.filter(entry=>entry?.item && names.has(entry.item.name))
    .map(entry=>({slot:entry!.slot,item:entry!.item}))]);
}

// ---------------------------------------------------------------------------------------------
// The lucky slot record.

export interface LuckySlotState {
  luckySlotCharacterIds?: Record<string, string>;
  luckySlotTracking?: LuckySlotHistory;
  luckyUpgradeSlots?: Record<string, number | null>;
  luckySlotLocks?: Record<string, number | null>;
  luckySlotResume?: Record<string, {slot: number; rolls: number}>;
}
// A renamed character's entry moves to its new name.
function rekey<T>(map: Record<string, T> | undefined, name: string, previous: string): void {
  if (!map) return;
  if (map[previous] !== undefined) map[name] = map[previous];
  delete map[previous];
}
/** Bind legacy evidence once; subsequent account-ID changes retire all positions. */
function bindIdentity(state: LuckySlotState, name: string, id: string): boolean {
  const identities = state.luckySlotCharacterIds ??= {};
  if (identities[name] === id) return false;
  if (identities[name]) {
    delete state.luckySlotTracking?.[name];
    delete state.luckyUpgradeSlots?.[name];
    delete state.luckySlotLocks?.[name];
    delete state.luckySlotResume?.[name];
  }
  const previous = Object.keys(identities).find(key => key !== name && identities[key] === id);
  if (previous) {
    rekey(state.luckySlotTracking, name, previous);
    rekey(state.luckyUpgradeSlots, name, previous);
    rekey(state.luckySlotLocks, name, previous);
    rekey(state.luckySlotResume, name, previous);
    delete identities[previous];
  }
  identities[name] = id;
  return true;
}
function mergeTracking(state: LuckySlotState, name: string, raw: unknown): boolean {
  const incoming = normalizeSlotTracking(raw);
  if (!incoming.streamId || !Object.keys(incoming.slots).length) return false;
  const history = state.luckySlotTracking ??= {};
  const streams = history[name] ??= {};
  const previous = streams[incoming.streamId] ??= {version: 1, streamId: incoming.streamId, slots: {}};
  const changed = mergeSlotStream(previous, incoming);
  return releaseResume(state, name, streams) || changed;
}
function releaseResume(state: LuckySlotState, name: string, streams: LuckySlotHistory[string]): boolean {
  const resume = state.luckySlotResume?.[name];
  if (resume && (aggregateSlotTracking(streams).slots[resume.slot]?.totalRolls ?? 0) > resume.rolls) {
    delete state.luckySlotResume![name];
    return true;
  }
  return false;
}
export function receiveLuckySlotTracking(state: LuckySlotState, name: string, raw: unknown, characterId?: string, reportedId?: unknown): boolean {
  const identityChanged = characterId ? bindIdentity(state, name, characterId) : false;
  if (characterId && reportedId !== characterId) return identityChanged;
  return mergeTracking(state, name, raw) || identityChanged;
}

// ---------------------------------------------------------------------------------------------
// The character's production receipts: a stat scroll receipt consumes its resolved requests, and
// an equip receipt confirms the delivered copies it equipped.

export interface ProductionReceiptState {
  merchantDeliveries?: Record<string, DeliveryRequest[] | undefined>;
  commands: Record<string, { id?: unknown; type: string } | undefined>;
  statScrolls: Record<string, unknown[] | undefined>;
  merchantCatalog?: { allItems?: { id: string; name?: string }[] } | null;
}
export interface ProductionReceiptPorts {
  owned(name: string): unknown;
  log(message: string, level: string, details?: unknown): void;
  persist(): void;
}
export function createProductionReceipts(state: ProductionReceiptState, ports: ProductionReceiptPorts) {
  function equipmentLog(raw: unknown, name: string): void {
    const result = requestObject(raw),
      item = requestObject(result.item);
    const itemName = requestText(item.name || "delivered item");
    const displayName =
      state.merchantCatalog?.allItems?.find((entry) => entry.id === itemName)?.name || itemName;
    ports.log(
      (result.success ? "Equipped delivered " : "Could not equip delivered ") +
        displayName +
        " on " +
        name,
      result.success ? "success" : "error",
      result.error,
    );
  }
  function confirmDeliveryEquip(name: string, raw: unknown): void {
    const result = requestObject(raw);
    const marks = state.merchantDeliveries?.[name] || [];
    const index = marks.findIndex(mark => mark.awaitingEquip &&
      (result.deliveryId ? mark.id === result.deliveryId : !mark.id) && JSON.stringify(mark.item) === JSON.stringify(result.item));
    if (index < 0) return;
    if (result.success === true) marks.splice(index,1);
    else marks[index].equipFailedAt = Date.now();
  }
  function statScrolls(body: Record<string, unknown>): ItemsAnswer {
    const name = requestText(body.character);
    if (!ports.owned(name)) return { status: 400, body: { error: "unknown character" } };
    const pending = state.statScrolls[name] || [];
    consumeReceipts(pending, receiptList(body.resolved));
    for (const raw of receiptList(body.activity)) {
      const entry = requestObject(raw);
      ports.log(
        requestText(entry.message || raw),
        requestText(entry.level || "info"),
        entry.details,
      );
    }
    for (const result of receiptList(body.equipResults)) { equipmentLog(result,name); confirmDeliveryEquip(name,result); }
    if (state.commands[name]?.type === "apply-stat-scrolls") delete state.commands[name];
    ports.persist();
    return { body: { ok: true, remaining: pending.length } };
  }
  function equipment(body: Record<string, unknown>): ItemsAnswer {
    const name = requestText(body.character);
    if (!ports.owned(name)) return { status: 400, body: { error: "unknown character" } };
    const command = state.commands[name];
    if (!command || command.type !== "equip-deliveries" || command.id !== body.commandId)
      return { status: 409, body: { error: "equip-delivery command is no longer current" } };
    for (const result of receiptList(body.results)) { equipmentLog(result, name); confirmDeliveryEquip(name,result); }
    finishMerchantInterruption(state, name, command.id);
    delete state.commands[name];
    ports.persist();
    return { body: { ok: true } };
  }
  return { statScrolls, equipment };
}

// ---------------------------------------------------------------------------------------------
// The production routes' decisions: the merchant's commerce orders with the
// automatic restock supply, and the exchanges.

export interface CommerceJob extends MerchantWork {
  order?: MaterialOrder;
}
export interface MerchantOrderState {
  merchantCharacter: string | null;
  merchantCatalog: { buyable: OrderChoice[]; craftable: OrderChoice[] } | null;
  statuses: Record<string, { seenAt?:number; items?: (MaterialEntry | null)[] } | undefined>;
  bankSnapshot: { packs?: Record<string, (MaterialEntry | null)[] | undefined> } | null;
  bankbois?: Record<string, { items?: (MaterialEntry | null)[] } | undefined>;
  withdrawals?: Record<string, StorageReference[] | undefined>;
  merchantCurrent: CommerceJob | null;
  merchantQueue: CommerceJob[];
}
export interface MerchantOrderPorts {
  /** The estimate's yield to I/O, on the run scope the root hands 10. */
  yieldToIO(): Promise<void>;
  now(): number;
  nextCommand(): number;
  enqueue(ask: EnqueueAsk): EnqueueAnswer;
  activeNames(): string[];
  log(message: string, level: string, details: unknown): void;
  persist(): void;
  dispatch(): void;
  persistBank?(): void;
  bankboi?(): Promise<unknown>;
}

export function createCommerceOrders(state: MerchantOrderState, ports: MerchantOrderPorts) {
  function catalog() {
    return state.merchantCatalog || { buyable: [], craftable: [] };
  }
  function changed(merchant: string | null, snapshot: string) {
    return state.merchantCharacter !== merchant || JSON.stringify(catalog()) !== snapshot;
  }
  async function estimate(buys: OrderLine[], choices: OrderChoice[]): Promise<string | null> {
    const results = await estimateBatch(
      buys.map((line) => ({
        choice: choices.find((entry) => entry.id === line.id)!,
        quantity: line.quantity,
        target: line.level || 0,
      })),
      undefined,
      ports.yieldToIO,
    );
    for (const [index, line] of buys.entries()) {
      const result = results[index]!;
      if (result.status === "unavailable") {
        if (!line.acknowledgeUnavailable || !line.goldCap)
          return "unavailable estimate requires explicit confirmation and a positive gold cap";
        line.estimateUnavailable = true;
        line.budget = line.goldCap;
      } else if (line.level) {
        line.attempts = result.attempts;
        line.budget = result.gold;
        line.scrolls = result.scrolls;
        delete line.goldCap;
      }
      delete line.acknowledgeUnavailable;
    }
    return null;
  }

  function materialSources() {
    const merchant = state.merchantCharacter;
    const sources: {
      entries: (MaterialEntry | null)[];
      owner: string | null;
      pack: string | null;
    }[] = [];
    sources.push({
      entries: state.statuses[String(merchant)]?.items || [],
      owner: merchant,
      pack: null,
    });
    for (const [pack, entries] of Object.entries(state.bankSnapshot?.packs || {}))
      sources.push({ entries: entries || [], owner: null, pack });
    sources.push(...workerSources());
    for (const name of ports
      .activeNames()
      .filter((member) => member !== merchant && !Object.hasOwn(state.bankbois || {}, member)))
      sources.push({ entries: state.statuses[name]?.items || [], owner: name, pack: null });
    return sources;
  }
  function workerSources() {
    return Object.entries(state.bankbois || {}).map(([name, worker]) => ({
      entries: worker?.items || [],
      owner: null,
      pack: bankboiPack(name),
    }));
  }
  function materials(crafts: OrderLine[], choices: OrderChoice[]) {
    const allocation = allocateOrderMaterials(crafts, choices, state.merchantCharacter);
    const sources = materialSources();
    const available = availableCraftStock(
      sources.flatMap((source) =>
        source.entries.map(
          (entry) =>
            entry && {
              ...entry,
              item: entry.item || entry,
              craftLocation: source.pack || inventoryPack(source.owner),
            },
        ),
      ),
      craftProtection(state),
    );
    let offset = 0;
    for (const source of sources) {
      allocation.take(
        available.slice(offset, offset + source.entries.length) as (MaterialEntry | null)[],
        source.owner,
        source.pack,
      );
      offset += source.entries.length;
    }
    return allocation;
  }

  function duplicate(order: MaterialOrder): CommerceJob | undefined {
    if (order.buys.length && order.crafts.length) {
      const direct = duplicate({ ...order, crafts: [] });
      const crafting = duplicate({ ...order, buys: [] });
      if (direct && crafting) return crafting;
    }
    const signature = JSON.stringify({ buys: order.buys, crafts: order.crafts });
    return [state.merchantCurrent, ...state.merchantQueue].find(
      (candidate): candidate is CommerceJob =>
        !!candidate &&
        candidate.reason === "merchant commerce" &&
        !!candidate.order &&
        JSON.stringify({
          buys: candidate.order.buys || [],
          crafts: candidate.order.crafts || [],
        }) === signature,
    );
  }

  function splitDirectBuys(job: CommerceJob & { reason: JobReason }, order: MaterialOrder) {
    if (order.buys.length && order.crafts.length) {
      const directOrder = {
        ...order,
        crafts: [],
        sources: {},
        bank: [],
        storage: [],
        requirements: [],
        materialBuys: [],
      };
      const direct = duplicate(directOrder);
      if (!direct)
        ports.enqueue({ reason: job.reason, target: job.target, fields: {
          ...job,
          id: job.id + "-buy",
          routine: "manual buying",
          order: directOrder,
          blockedOnBankboi: false,
        } });
      job.order = { ...order, buys: [] };
    }
  }
  function enqueue(order: MaterialOrder) {
    const previous = duplicate(order);
    if (previous) return { ok: true, jobId: previous.id, duplicate: true };
    const job = {
      id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
      target: state.merchantCharacter,
      reason: "merchant commerce",
      queuedAt: ports.now(),
      order,
      blockedOnBankboi: !!order.storage?.length,
    } satisfies Record<string, unknown> & { reason: JobReason };
    splitDirectBuys(job, order);
    ports.enqueue({ reason: job.reason, target: job.target, fields: job });
    ports.log("Merchant commerce queued", "info", { buys: order.buys, crafts: order.crafts });
    ports.persist();
    if (job.blockedOnBankboi) {
      const requests = ((state.withdrawals ||= {})[String(state.merchantCharacter)] ||= []);
      for (const allocation of order.storage || [])
        requests.push({
          pack: allocation.pack,
          slot: allocation.slot,
          item: allocation.item,
          craftJobId: job.id,
          allocationId: allocation.allocationId,
        });
      ports.persistBank?.();
      void ports
        .bankboi?.()
        .catch((error: unknown) =>
          ports.log("Could not stage crafting materials", "error", String(error)),
        );
    }
    ports.dispatch();
    return { ok: true, jobId: job.id };
  }

  function orderLines(body: Record<string, unknown>, choices: ReturnType<typeof catalog>) {
    return {
      buys: normalizeOrderLines(body.buys || [], choices.buyable, true),
      crafts: normalizeOrderLines(body.crafts || [], choices.craftable, false),
    };
  }

  async function handle(body: Record<string, unknown>): Promise<ItemsAnswer> {
    const choices = catalog();
    if (!state.merchantCharacter)
      return { status: 409, body: { error: "configure a merchant first" } };
    const { buys, crafts } = orderLines(body, choices);
    if (!buys || !crafts || (!buys.length && !crafts.length))
      return { status: 400, body: { error: "invalid empty order" } };
    const merchant = state.merchantCharacter,
      catalogSnapshot = JSON.stringify(choices);
    const estimateError = await estimate(buys, choices.buyable);
    if (changed(merchant, catalogSnapshot))
      return { status: 409, body: {
        error: "merchant or catalog changed while estimating; review and retry the order",
      } };
    if (estimateError) return { status: 400, body: { error: estimateError } };
    return finalize(buys, crafts, choices);
  }
  function finalize(
    buys: OrderLine[],
    crafts: OrderLine[],
    choices: ReturnType<typeof catalog>
  ): ItemsAnswer {
    const existing = duplicate({
      buys,
      crafts,
      sources: {},
      bank: [],
      requirements: [],
      materialBuys: [],
    });
    if (existing) return { body: { ok: true, jobId: existing.id, duplicate: true } };
    const protection = craftProtection(state);
    if (protection.error) return { status: 409, body: { error: protection.error } };
    const { order, unavailable } = materialOrder(buys, crafts, choices);
    if (unavailable.length)
      return { status: 409, body: {
        error: "crafting materials are no longer available",
        missing: unavailable.map((entry) => {
          const required = order.requirements.find(
            (total) => total.id === entry.id && total.level === entry.level,
          )!.quantity;
          return { ...entry, required, available: required - entry.quantity };
        }),
      } };
    return { body: enqueue(order) };
  }
  // The one build of a commerce order from its lines: the materials' allocation, the crafts' recipes
  // and the missing materials to buy at +0. A missing material above +0 or not on sale is
  // `unavailable`, and the order is not placed.
  function materialOrder(buys: OrderLine[], crafts: OrderLine[], choices: ReturnType<typeof catalog>) {
    const allocation = materials(crafts, choices.craftable), missing = allocation.missing();
    const buyable = new Set(choices.buyable.map((entry) => entry.id));
    const order: MaterialOrder = { buys, crafts, sources: allocation.sources, inventory: allocation.inventory, bank: allocation.bank,
      storage: allocation.storage, requirements: allocation.totals,
      craftMaterials: crafts.map((line) => choices.craftable.find((choice) => choice.id === line.id)!.materials || []),
      materialBuys: missing.map((entry) => ({ id: entry.id, level: 0, quantity: entry.quantity })) };
    return { order, unavailable: missing.filter((entry) => entry.level !== 0 || !buyable.has(entry.id)) };
  }
  const supplyPublications=new Map<string,{jobId:string;after?:number}>();
  function restockPending(item:string):boolean {
    const active=[state.merchantCurrent,...state.merchantQueue].find(job=>job?.reason==='merchant commerce' &&
      [...(job.order?.buys || []),...(job.order?.crafts || [])].some(line=>line.id===item));
    if (active) { supplyPublications.set(item,{jobId:active.id}); return true; }
    const publication=supplyPublications.get(item);
    if (!publication) return false;
    // A completion receipt precedes the next ordinary inventory publication.
    // Neither preempt production with its own output nor buy against that old snapshot.
    publication.after ??= ports.now();
    if ((state.statuses[String(state.merchantCharacter)]?.seenAt || 0) <= publication.after) return true;
    supplyPublications.delete(item);
    return false;
  }
  /** Automatic supply orders use the same durable material allocation and execution. */
  function restockSupply(item: string, quantity: number): boolean {
    if (!state.merchantCharacter || !Number.isSafeInteger(quantity) || quantity < 1) return false;
    if (restockPending(item)) return true;
    const choices=catalog(), buy=choices.buyable.some(choice=>choice.id===item), craft=choices.craftable.find(choice=>choice.id===item);
    if (!buy && !craft || craftProtection(state).error) return false;
    const buys:OrderLine[]=buy?[{id:item,quantity,level:0}]:[], crafts:OrderLine[]=buy?[]:[{id:item,quantity,level:0}];
    const { order, unavailable } = materialOrder(buys, crafts, choices);
    if (unavailable.length) return false;
    const queued=enqueue(order);
    supplyPublications.set(item,{jobId:queued.jobId});
    return true;
  }
  return { handle, restockSupply, restockPending };
}

export interface ExchangeState extends AutomaticActionState {
  merchantCharacter: string | null;
  // The offering supply counts the bags (SupplyState).
  statuses?: Record<string, { items?: (InventoryEntry | null)[] } | undefined>;
  merchantCatalog: { exchangeable?: ExchangeChoice[] } | null;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
}
export interface ExchangePorts {
  now(): number;
  nextCommand(): number;
  enqueue(ask: EnqueueAsk): EnqueueAnswer;
  log(message: string, level: string, details: unknown): void;
  persist(): void;
  dispatch(): void;
  queueStorage(job: MerchantWork, shortages: Parameters<typeof queueExchangeStorage>[1]): boolean;
  collectOfferings?():void;
  queueOffering(offering:UpgradeOffering,quantity:number):boolean;
  write(batch: SettingsWrite): SettingsWriteResult;
}

function normalizeExchange(raw: unknown, choices: ExchangeChoice[]): ExchangeLine | null {
  const line = requestObject(raw),
    level = Number(line.level) || 0;
  const choice = choices.find(
    (entry) =>
      entry.id === line.id && entry.reward === line.reward && (Number(entry.level) || 0) === level,
  );
  const quantity = Number(line.quantity);
  if (!choice || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > STACK_SIZE_MAX) return null;
  return {
    id: choice.id,
    level: Number(choice.level) || 0,
    quantity,
    ...(typeof choice.reward === 'string' && choice.reward ? { reward: choice.reward } : {}),
  };
}

export function createExchangeRequests(state: ExchangeState, ports: ExchangePorts) {
  function current(body: Record<string, unknown>): MerchantWork | null {
    const job = state.merchantCurrent;
    return job && job.id === body.jobId && job.reason === "exchange" ? job : null;
  }

  function progress(body: Record<string, unknown>): ItemsAnswer {
    const job = current(body);
    if (!job) return { status: 409, body: { error: "exchange job is no longer current" } };
    if (!Array.isArray(body.remaining) || !Array.isArray(body.rewards))
      return { status: 400, body: { error: "invalid exchange checkpoint" } };
    // The checkpoint's reward list is the whole run's, so only the rewards past the last
    // checkpoint's are new results.
    for (const reward of body.rewards.slice(Array.isArray(job.exchangeRewards) ? job.exchangeRewards.length : 0)) {
      // The character posts each reward as the item copy itself, as exchangeRewardFates reads it.
      recordItems({ decision: 'exchanged', subject: String(state.merchantCharacter), by: 'job:' + String(job.id),
        item: requestObject(reward).name });
    }
    job.exchanges = body.remaining;
    job.exchangeRewards = body.rewards;
    job.exchangeResume = true;
    ports.persist();
    const { fates, written } = exchangeRewardFates(state, body.rewards, ports.write);
    return written.ok ? { body: { ok: true, rewardActions: fates } } : { status: 400, body: { error: written.error } };
  }

  function supply(body: Record<string, unknown>): ItemsAnswer {
    const job = current(body);
    if (!job) return { status: 409, body: { error: "exchange job is no longer current" } };
    // Slot ownership transfers only after the merchant yields its current job.
    return { body: {
      pending: ports.queueStorage(job, Array.isArray(body.shortages) ? body.shortages : []),
    } };
  }

  function enqueue(exchanges: ExchangeLine[]): ItemsAnswer {
    const id = "merchant-" + ports.now() + "-" + ports.nextCommand();
    ports.enqueue({ reason: "exchange", target: state.merchantCharacter, fields: { id, routine: 'manual exchange', exchanges } });
    ports.log("Merchant exchange queued", "info", { exchanges });
    ports.persist();
    ports.dispatch();
    return { body: { ok: true, jobId: id } };
  }

  function order(body: Record<string, unknown>): ItemsAnswer {
    const choices = state.merchantCatalog?.exchangeable || [];
    if (!state.merchantCharacter)
      return { status: 409, body: { error: "configure a merchant first" } };
    if (!Array.isArray(body.exchanges) || !body.exchanges.length)
      return { status: 400, body: { error: "select at least one exchange" } };
    const exchanges: ExchangeLine[] = [];
    for (const raw of body.exchanges) {
      const line = normalizeExchange(raw, choices);
      if (!line) return { status: 400, body: { error: "invalid exchange quantity" } };
      exchanges.push(line);
    }
    return enqueue(exchanges);
  }
  return { progress, supply, order, offeringSupply:createOfferingSupply(state,(offering,quantity)=>{const pending=ports.queueOffering(offering,quantity);if(pending)ports.collectOfferings?.();return pending;},()=>ports.persist()) };
}

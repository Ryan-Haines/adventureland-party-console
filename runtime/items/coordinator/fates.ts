// The fate table: each copy's fate, read top down. F1 an operation's hold, F2 equipped, F3 the
// player's mark, F4 a claim, F5 the item's automatic rule, F7 the default. The rules both runtimes
// read (the rule owner, its members, F5's predicates) are in rules.ts; this module holds the marks,
// the one remover, the shared rules' migration and the player sale reservations.
import type { Item, ItemMark, InventoryEntry } from '../../coordinator/contracts/item.ts';
import type { CommandOutcome } from '../../movement/api/coordinator.ts';
import { requestObject, requestText } from '../../lifecycle/api.ts';
import { partyHooks } from '../../hooks/index.ts';
import { gameItems } from '../../movement/api/coordinator.ts';
import { played, settingsDraft, type SettingsDraft, type SettingsWrite, type SettingsWriteResult } from '../../settings/api.ts';
import { reviseQueuedJobs } from '../../merchant-jobs/coordinator/api.ts';
import { entryMeta } from '../catalog-meta.ts';
import { bankboiName, bankboiPack, commerceRuleKey, exchangeKey, inventoryPack, isBankboiPack, isInventoryPack, markedItem, markMatches, ruleKey, ruleKeyParts, ruleMode, storagePack } from '../identity.ts';
import { addonAhead, ruleOwner, ruleMembers, sharedMember, hasMarkedWithdrawals, automaticNpcRetrieval, processingAction, processingPending, itemRuleConflicts, npcSaleRuleKey,
  ruleAction, fateOf, claimCopies, claimFate, placeHolds, bagSize, availableCraftStock, compoundStorageLeftovers, isUpgradeOffering,
  usableCopy, freeSlots, luckySlotOf, protectedSlotsOf, AUTOMATIC_ORDER, BANK_PACK_CELLS, type Fate, type Claim, type RestockPolicy,
  type AutomaticAction, type RuleState, type SharedRules, type RuleFamily, type RuleChoice } from '../rules.ts';
import { craftProtection, sharedCompoundRules, writeIntents, type CraftReservationState } from './production.ts';
import { protectedMerchantStorageStock, restockPolicyOf, visitPlanned } from './needs.ts';
import { merchantWeaponCompatible, type NpcSale } from './market.ts';
import type { DeliveryRequest } from '../../merchant-jobs/api.ts';
import { routineEnabled, type JobReason, type MerchantCommand } from '../../merchant-jobs/api.ts';
import { merchantSlotCommand } from '../../merchant-jobs/coordinator/api.ts';
import { bankUpgradeRefusal, putBankUpgrade, type UpgradeMark } from './production.ts';
import { fresh, SEND_REACH } from '../../protocol/reports.ts';
import { recordItems } from './records.ts';
import type { ItemsAnswer } from './routes/answer.ts';

type Inventory = readonly (InventoryEntry | null)[];
type Rules = Record<string, Record<string, unknown> | undefined>;

// ---------------------------------------------------------------------------------------------
// F5 for exchange rewards.

/**
 * A reward the rules bank records the saved `bank` rule for the merchant's rule owner through the
 * settings writer, so the routing survives a restart. It answers each reward's action and the
 * writer's result, so the route reports a refused write and never a rule that was not saved.
 */
export function exchangeRewardFates(state: RuleState, rewards: unknown[], write: (batch: SettingsWrite) => SettingsWriteResult) {
  const draft = settingsDraft(state), owner = ruleOwner(state, String(state.merchantCharacter));
  const fates = rewards.map(raw => {
    const item = requestObject(raw) as Item, action = processingAction(state, item, owner) || 'bank';
    if (action === 'bank' && typeof item.name === 'string' && item.name)
      (draft.edit<Rules>('autoItemMarks')[owner] ||= {})[ruleKey(item)] = 'bank';
    return { item, action };
  });
  const changes = draft.changes();
  const written: SettingsWriteResult = changes.length ? write({ by: 'items:exchange-reward', changes }) : { ok: true, changed: [] };
  return { fates, written };
}

// The one remover. A rule's write removes the item's other rules and the marks and
// reservations they made, so an item has at most one rule; the clear removes every rule and the
// selected copy's own marks. The removers edit the rule maps that are settings in the request's
// draft, which the request writes as one batch through `settings.write`.

const RULE_SETTINGS = ['autoItemMarks', 'autoExchanges', 'merchantWeapon', 'autoNpcSales', 'autoStandMarks', 'autoDeconstruction'] as const;
interface Reservation { id?: string; auto?: boolean; autoRuleKey?: string; item?: Item; owner?: string; character?: string; source?: string;
  slot?: number | string; bankPack?: string; bankSlot?: number; pack?: string; storage?: { pack: string; slot: number }; state?: string; equipped?: boolean; tiers?: number }
export interface AutomaticActionState extends RuleState {
  marked?: Record<string, ItemMark[] | undefined>;
  merchantMarked?: Record<string, (ItemMark & { npcSaleId?: string; deconstructionId?: string })[] | undefined>;
  upgrades?: Record<string, { auto?: boolean; item?: Item; slot?: number | string; equipped?: boolean; tiers?: number }[] | undefined>;
  statScrolls?: Record<string, { auto?: boolean; item?: Item; slot?: number | string; equipped?: boolean }[] | undefined>;
  compounds?: Record<string, { items: { slot?: number | string; item?: Item; equipped?: boolean }[] }[] | undefined>;
  npcSaleMarks?: Reservation[];
  standListings?: Reservation[];
  deconstructionMarks?: Reservation[];
  withdrawals?: Record<string, { pack?: string; slot?: number; item?: Item | null; standListingId?: string; deconstructionId?: string }[] | undefined>;
  merchantWeapon?: { item: Item } | null;
  merchantQueue: { reason: string; autoExchangeKeys?: string[]; exchanges?: { id: string; level?: number }[] }[];
  merchantCurrent?: { reason: string; itemMarksCleared?: boolean } | null;
}
type RuleEdits = Pick<AutomaticActionState, (typeof RULE_SETTINGS)[number]>;
interface Removal { state: AutomaticActionState; draft: SettingsDraft; owner: string; members: string[]; item: Item; removed: Set<string> }
// An item's rule sits under its rule key, and a +0 copy's rule from before levels under its bare
// name. forgetRule deletes both, or with `only`, each one whose value is `only`.
function forgetRule(rules: Record<string, unknown> | undefined, item: Item, only?: unknown): void {
  if (!rules) return;
  for (const key of Number(item.level) ? [ruleKey(item)] : [ruleKey(item), String(item.name)])
    if (only === undefined || rules[key] === only) delete rules[key];
}
const dropAuto = <T extends { auto?: boolean; item?: Item }>(marks: T[] | undefined, key: string) =>
  marks?.filter(mark => !(mark.auto && ruleKey(mark.item) === key));
function dropMarks(list: Reservation[] | undefined, removal: Removal, drop: (mark: Reservation) => boolean): Reservation[] | undefined {
  return list?.filter(mark => {
    if (!drop(mark)) return true;
    if (mark.id) removal.removed.add(mark.id);
    return false;
  });
}
const removers: Record<Exclude<AutomaticAction, 'merchant'>, (removal: Removal) => void> = {
  bank({ state, draft, owner, members, item }) {
    const key = ruleKey(item);
    forgetRule(draft.edit<RuleEdits['autoItemMarks']>('autoItemMarks')?.[owner], item);
    for (const member of members) {
      if (state.marked?.[member]) state.marked[member] = dropAuto(state.marked[member], key);
      if (state.merchantMarked?.[member]) state.merchantMarked[member] = dropAuto(state.merchantMarked[member], key);
    }
  },
  upgrade({ state, owner, members, item }) {
    const key = ruleKey(item);
    forgetRule(state.autoUpgradeMarks?.[owner], item);
    for (const member of members) if (state.upgrades?.[member]) writeIntents(state, member, marks => dropAuto(marks, key)!);
  },
  compound({ state, owner, item }) {
    if (state.autoCompounds?.[owner]) state.autoCompounds[owner] = state.autoCompounds[owner]!.filter(rule => rule.name !== item.name);
  },
  npc(removal) {
    const { state, owner, item } = removal, commerce = commerceRuleKey(item), sales = removal.draft.edit<RuleEdits['autoNpcSales']>('autoNpcSales') || {};
    for (const [id, rule] of Object.entries(sales)) {
      if (!rule || (rule.character || state.merchantCharacter) !== owner || commerceRuleKey(rule.item) !== commerce) continue;
      delete sales[id];
      removal.removed.add(id);
    }
    // The merchant's own rule key also names its marks after the rule itself is gone.
    if (owner === state.merchantCharacter) removal.removed.add(commerce);
    state.npcSaleMarks = dropMarks(state.npcSaleMarks, removal, mark => !!mark.auto && removal.removed.has(mark.autoRuleKey || ''));
  },
  stand(removal) {
    const { state, draft, owner, item } = removal, commerce = commerceRuleKey(item);
    if (owner !== state.merchantCharacter) return;
    delete draft.edit<RuleEdits['autoStandMarks']>('autoStandMarks')?.[commerce];
    state.standListings = dropMarks(state.standListings, removal, mark => !!mark.auto && mark.autoRuleKey === commerce);
  },
  exchange({ state, draft, owner, item }) {
    if (owner !== state.merchantCharacter) return;
    const key = exchangeKey(item.name, item.level);
    delete draft.edit<RuleEdits['autoExchanges']>('autoExchanges')?.[key];
    reviseQueuedJobs(state, job => {
      if (job.reason !== 'exchange' || !job.autoExchangeKeys?.includes(key)) return job;
      const keys = job.autoExchangeKeys.filter(id => id !== key);
      return keys.length ? { ...job, autoExchangeKeys: keys, exchanges: job.exchanges?.filter(line => exchangeKey(line.id, line.level) !== key) } : null;
    });
  },
  deconstruction(removal) {
    const { state, draft, owner, members, item } = removal, commerce = commerceRuleKey(item);
    delete draft.edit<RuleEdits['autoDeconstruction']>('autoDeconstruction')?.[owner]?.[commerce];
    state.deconstructionMarks = dropMarks(state.deconstructionMarks, removal, mark =>
      !!mark.auto && members.includes(mark.owner || '') && commerceRuleKey(mark.item) === commerce);
  },
};
/** A removed sale, listing or dismantle releases the merchant cells and withdrawals it reserved. */
function releaseRemoved(removal: Removal): void {
  const { state, removed } = removal;
  if (!removed.size) return;
  for (const [member, marks] of Object.entries(state.merchantMarked || {}))
    state.merchantMarked![member] = marks?.filter(mark => ![mark.npcSaleId, mark.deconstructionId].some(id => typeof id === 'string' && removed.has(id)));
  for (const [member, entries] of Object.entries(state.withdrawals || {}))
    state.withdrawals![member] = entries?.filter(entry => !removed.has(entry.standListingId || '') && !removed.has(entry.deconstructionId || ''));
}
function remove(state: AutomaticActionState, draft: SettingsDraft, name: string, item: Item, keep: AutomaticAction | null): Removal {
  const removal: Removal = { state, draft, owner: ruleOwner(state, name), members: ruleMembers(state, name), item, removed: new Set() };
  for (const [action, remover] of Object.entries(removers))
    if (action !== keep && !(action === 'bank' && keep === 'merchant')) remover(removal);
  return removal;
}
// A current job that reads marks finishes its server operation, then refreshes its work. A
// mark change refreshes the current job's work and is one `items.fateChanged` record.
function marksChanged(state: AutomaticActionState, name: string, item: Item, fate: AutomaticAction | 'none'): void {
  if (state.merchantCurrent) state.merchantCurrent.itemMarksCleared = true;
  recordItems({ decision: 'fateChanged', subject: name, by: 'player', item: item.name, level: item.level, fate });
}
// The records a removal changes on the state, and the rule settings in the request's draft.
const markSnapshot = (state: AutomaticActionState, draft: SettingsDraft) => JSON.stringify([state.marked, state.merchantMarked, state.upgrades,
  state.statScrolls, state.compounds, state.autoUpgradeMarks, state.autoCompounds, state.npcSaleMarks, state.standListings,
  state.deconstructionMarks, state.withdrawals, draft.changes()]);

/**
 * Select one automatic action; the rule settings it removes go out of `draft`, which the request
 * writes. `added` is true when the caller's own rule gives the item this action for the first
 * time, so its fate changes even when the selection removes nothing.
 */
export function replaceAutomaticAction(state: AutomaticActionState, name: string, item: Item, keep: AutomaticAction, draft: SettingsDraft, added = false): void {
  const before = markSnapshot(state, draft);
  releaseRemoved(remove(state, draft, name, item, keep));
  if (added || before !== markSnapshot(state, draft)) marksChanged(state, name, item, keep);
}

interface Selection { name: string; slot: string | number; item: Item; equipped: boolean }
// A request that writes settings changes its records once the write is accepted. stageRecords hands
// the request a view whose record fields are copies (a field the request replaces, such as the
// merchant job owner's merchantQueue, lands on the view itself); commit() puts every field the view
// holds on the state, and a refused write drops the view.
const RECORD_FIELDS = ['marked', 'merchantMarked', 'upgrades', 'statScrolls', 'compounds', 'autoUpgradeMarks', 'autoCompounds',
  'npcSaleMarks', 'standListings', 'deconstructionMarks', 'withdrawals'] as const;
function stageRecords<S extends object>(state: S): { staged: S; commit(): void } {
  const staged = Object.create(state) as S, view = staged as Record<string, unknown>, live = state as Record<string, unknown>;
  for (const field of RECORD_FIELDS) if (field in state) view[field] = structuredClone(live[field]);
  return { staged, commit: () => { for (const field of Object.keys(staged)) live[field] = view[field]; } };
}
interface ClearState extends AutomaticActionState {
  bankSnapshot?: { packs?: Record<string, Inventory | undefined> } | null;
  statuses: Record<string, { items?: Inventory; slots?: Record<string, { item: Item } | null | undefined> } | undefined>;
}
const sameCopy = (mark: { slot?: number | string; equipped?: boolean; item?: Item }, selected: Selection) =>
  mark.slot === selected.slot && !!mark.equipped === selected.equipped && markMatches(selected.item, mark.item);
// An upgrade mark covers its copy from its starting level through its target.
function upgradeCovers(mark: { slot?: number | string; equipped?: boolean; item?: Item; tiers?: number }, selected: Selection): boolean {
  if (mark.slot !== selected.slot || !!mark.equipped !== selected.equipped || !mark.item) return false;
  const start = Number(mark.item.level) || 0, level = Number(selected.item.level) || 0;
  return level >= start && level <= start + Number(mark.tiers || 0) && markMatches({ ...selected.item, level: mark.item.level }, mark.item);
}
function bankSourceMatches(mark: Reservation, body: Record<string, unknown>, item: Item): boolean {
  return markMatches(item, mark.item) && (mark.storage?.pack === body.pack && mark.storage?.slot === body.slot ||
    mark.bankPack === body.pack && mark.bankSlot === body.slot || mark.pack === body.pack && mark.slot === body.slot);
}
function selectedEntry(state: ClearState, body: Record<string, unknown>) {
  if (typeof body.pack === 'string') {
    if (body.character !== state.merchantCharacter) return null;
    const pack = body.pack, bankboi = bankboiName(pack), entries = bankboi !== null
      ? (state.bankbois?.[bankboi] as { items?: Inventory } | undefined)?.items : state.bankSnapshot?.packs?.[pack];
    return entries?.find(entry => entry?.slot === body.slot);
  }
  const status = state.statuses[requestText(body.character)];
  return body.equipped === true ? status?.slots?.[String(body.slot)] : status?.items?.find(entry => entry?.slot === body.slot);
}
// The selected copy's own marks: its manual marks, the upgrade marks that cover it (and their
// rules), its compound groups, its bank sources and the sales, listings and dismantles it holds.
function clearCopy(state: ClearState, selected: Selection, body: Record<string, unknown>, removal: Removal): void {
  const { name, item } = selected, owner = ruleOwner(state, name), { draft } = removal;
  const upgradeKeys = new Set((state.upgrades?.[name] || []).filter(mark => mark.auto && upgradeCovers(mark, selected)).map(mark => ruleKey(mark.item)));
  for (const key of upgradeKeys) {
    delete state.autoUpgradeMarks?.[owner]?.[key];
    for (const member of removal.members) if (state.upgrades?.[member]) writeIntents(state, member, marks => dropAuto(marks, key)!);
  }
  if (state.upgrades) writeIntents(state, name, marks => marks.filter(mark => !upgradeCovers(mark, selected)));
  for (const field of [state.marked, state.merchantMarked, state.statScrolls] as Record<string, { slot?: number | string; equipped?: boolean; auto?: boolean; item?: Item }[] | undefined>[])
    if (field) field[name] = (field[name] || []).filter(mark => !sameCopy(mark, selected) && !(mark.auto && ruleKey(mark.item) === ruleKey(item)));
  if (state.compounds) state.compounds[name] = (state.compounds[name] || []).filter(group => !group.items.some(mark => sameCopy(mark, selected)));
  if (owner === state.merchantCharacter && markMatches(item, draft.edit<RuleEdits['merchantWeapon']>('merchantWeapon')?.item)) draft.set('merchantWeapon', null);
  if (typeof body.pack === 'string') {
    if (state.upgrades) writeIntents(state, name, marks => marks.filter(mark => !bankSourceMatches(mark as Reservation, body, item)));
    if (state.withdrawals) state.withdrawals[name] = state.withdrawals[name]?.filter(request => !bankSourceMatches(request as Reservation, body, item));
  }
  const held = (mark: Reservation) => !mark.bankPack && mark.source !== 'bank' &&
    (mark.owner || mark.character || state.merchantCharacter) === name && sameCopy(mark, selected);
  for (const field of ['npcSaleMarks', 'standListings', 'deconstructionMarks'] as const)
    state[field] = dropMarks(state[field], removal, mark => held(mark) || typeof body.pack === 'string' && bankSourceMatches(mark, body, item));
}
/** One validated request removes every rule of the item and the copy's marks before the marks reconcile. */
export function createClearItemMarks(state: ClearState, ports: { persist(): void; persistBank?(): void; changed(): void; write(batch: SettingsWrite): SettingsWriteResult }) {
  return function clear(body: Record<string, unknown>): CommandOutcome {
    if (body.type !== 'clear-item-marks') return undefined;
    const item = requestObject(body.item) as Item, entry = selectedEntry(state, body);
    if (!entry?.item || JSON.stringify(entry.item) !== JSON.stringify(item))
      return { status: 409, body: { error: 'Item changed; refresh and try again' } };
    const selected = { name: requestText(body.character), item, slot: typeof body.pack === 'string' ? '__bank__' : body.slot as string | number, equipped: body.equipped === true };
    const draft = settingsDraft(state), before = markSnapshot(state, draft), { staged, commit } = stageRecords(state);
    const removal = remove(staged, draft, selected.name, item, null);
    clearCopy(staged, selected, body, removal);
    releaseRemoved(removal);
    const changed = before !== markSnapshot(staged, draft);
    const written = ports.write({ by: 'dashboard:command', changes: draft.changes() });
    if (!written.ok) return { status: 400, body: { error: written.error } };
    commit();
    if (changed) marksChanged(state, selected.name, item, 'none');
    ports.persist();
    if (typeof body.pack === 'string') ports.persistBank?.();
    ports.changed();
    return null;
  };
}

// ---------------------------------------------------------------------------------------------
// F3, the bank and merchant marks. A manual mark is one copy's destination; a rule's mark follows
// the copy in its slot. A manual mark wins over the rule for its copy.

type CollectionMode = 'bank' | 'merchant';
interface MarkLists { bank: ItemMark[]; merchant: ItemMark[]; changed: boolean }
/** A copy's automatic mark: the bank or the merchant when the fate table sends it there, else none. */
type MarkMode = (entry: InventoryEntry) => CollectionMode | undefined;
function keepMark(mark: ItemMark, mode: CollectionMode, items: Inventory, modeOf: MarkMode, lists: MarkLists): boolean {
  const live = Number.isSafeInteger(mark.slot) ? items.find(entry => entry?.slot === mark.slot) : null;
  if (mark.auto) return !!live && markMatches(live.item, mark.item) && modeOf(live) === mode;
  if (!Number.isSafeInteger(mark.slot)) return items.some(entry => !!entry && markMatches(entry.item, markedItem(mark)));
  if (live && markMatches(live.item, mark.item)) return true;
  // A sort moves a manual mark with its copy.
  const moved = items.find(entry => !!entry && markMatches(entry.item, mark.item));
  if (!moved) return false;
  mark.slot = moved.slot;
  lists.changed = true;
  return true;
}
function ruleMark(entry: InventoryEntry, mode: CollectionMode, lists: MarkLists): void {
  const manual = (mark: ItemMark) => !mark.auto && !!entry.item && markNames(mark, { slot: entry.slot!, item: entry.item });
  if (lists.bank.some(manual) || lists.merchant.some(manual)) return;
  const list = lists[mode], other: CollectionMode = mode === 'bank' ? 'merchant' : 'bank';
  const index = list.findIndex(mark => mark.slot === entry.slot), next: ItemMark = { slot: entry.slot, item: entry.item || undefined, auto: true };
  if (index < 0) { list.push(next); lists.changed = true; }
  else if (list[index].auto && JSON.stringify(list[index].item) !== JSON.stringify(entry.item)) { list[index] = next; lists.changed = true; }
  const before = lists[other].length;
  lists[other] = lists[other].filter(mark => mark.slot !== entry.slot);
  lists.changed ||= lists[other].length !== before;
}
export function reconcileCollectionMarks(bank: ItemMark[], merchant: ItemMark[], items: Inventory, modeOf: MarkMode): MarkLists {
  const lists: MarkLists = { bank, merchant, changed: false };
  for (const mode of ['bank', 'merchant'] as const) {
    const before = lists[mode].length;
    lists[mode] = lists[mode].filter(mark => keepMark(mark, mode, items, modeOf, lists));
    lists.changed ||= lists[mode].length !== before;
  }
  for (const entry of items) {
    if (!entry?.item || !Number.isSafeInteger(entry.slot)) continue;
    const mode = modeOf(entry);
    if (mode) ruleMark(entry, mode, lists);
  }
  return lists;
}

interface InventoryStatus { upgradeInventoryBusy?: boolean; items?: unknown; slots?: Record<string, { item: Item } | null | undefined> }
const reported = (status: InventoryStatus | null | undefined): Inventory => Array.isArray(status?.items) ? status.items : [];
const MARK_ROWS = new Set(['F4', 'F6']);
/**
 * The per-report pass for a member's bank and merchant marks. A rule's mark follows the fate table: a copy
 * gets one only when F4 (the NPC sale keep), F5 or F6 sends it to the bank or the merchant, so the
 * errand that banks the marks never banks a copy an operation holds or a claim keeps. Processing at
 * the merchant holds a copy from the bank.
 */
export function reconcileCoordinatorCollectionMarks(state: FateState, name: string, status?: InventoryStatus | null,
  refused?: ReadonlySet<string>): boolean {
  if (!sharedMember(state, name)) return false;
  let taken: Map<number, Taken> | undefined;
  const claimed = () => taken ||= bagClaims(state, name, refused).taken;
  const rules = state.autoItemMarks?.[ruleOwner(state, name)] || {};
  const modeOf: MarkMode = entry => {
    const fate = copyFate(state, name, entry as Entry, claimed);
    // F5 marks by the item's bank or merchant rule even when a processing rule ranks first, as
    // the previous release collected those copies for the processing.
    const mode = fate.row === 'F5' ? ruleMode(rules, entry.item) : MARK_ROWS.has(fate.row) ? fate.fate : undefined;
    return mode === 'bank' || mode === 'merchant' ? mode : undefined;
  };
  const result = reconcileCollectionMarks(state.marked[name] || [], state.merchantMarked[name] || [], reported(status), modeOf);
  if (state.merchantRules) {
    const allowed = (mark: ItemMark) => !mark.auto || !mark.item || !itemRuleConflicts(state, mark.item).length;
    const bank = result.bank.filter(mark => allowed(mark) && (!mark.auto || !mark.item || !processingPending(state, mark.item)));
    const merchant = result.merchant.filter(allowed);
    result.changed ||= bank.length !== result.bank.length || merchant.length !== result.merchant.length;
    result.bank = bank; result.merchant = merchant;
  }
  state.marked[name] = result.bank;
  state.merchantMarked[name] = result.merchant;
  return result.changed;
}
interface MarkState extends RuleState {
  marked: Record<string, ItemMark[] | undefined>;
  merchantMarked: Record<string, ItemMark[] | undefined>;
  autoItemMarks: Rules;
  statuses: Record<string, { items?: unknown } | undefined>;
}
interface MarkPorts {
  selectAction?(item: Item, name: string, action: 'bank' | 'merchant', draft: SettingsDraft, added: boolean): void;
  reconcile(name: string, status: MarkState['statuses'][string]): void;
  persist(): void;
  write(batch: SettingsWrite): SettingsWriteResult;
}
/** The player's bank and merchant marks and the item's bank or merchant rule, written through the settings writer. */
export function createMarkCommands(state: MarkState, ports: MarkPorts) {
  function setRule(draft: SettingsDraft, rules: Record<string, unknown>, item: Item & { name: string }, mode: CollectionMode, name: string, toggle: boolean): void {
    const had = ruleMode(rules, item), same = toggle && had === mode;
    if (!same) ports.selectAction?.(item, name, mode, draft, had !== mode);
    forgetRule(rules, item);
    if (!same) rules[ruleKey(item)] = mode;
  }
  function automatic(body: Record<string, unknown>, name: string, mode: CollectionMode): CommandOutcome {
    const item = requestObject(body.item);
    if (body.type === 'auto-item-mark' && typeof item.name !== 'string') return undefined;
    if (body.type === 'remove-auto-item-mark' && typeof body.ruleKey !== 'string') return undefined;
    const draft = settingsDraft(state), rules = (draft.edit<Rules>('autoItemMarks')[ruleOwner(state, name)] ||= {});
    // Painting a rule (`action: 'set'`) is idempotent; a click toggles it.
    if (body.type === 'auto-item-mark') setRule(draft, rules, item as Item & { name: string }, mode, name, body.action !== 'set');
    else if (body.type === 'clear-auto-item-marks') { for (const key of Object.keys(rules)) if (rules[key] === mode) delete rules[key]; }
    else if (rules[body.ruleKey as string] === mode) delete rules[body.ruleKey as string];
    const written = ports.write({ by: 'dashboard:command', changes: draft.changes() });
    if (!written.ok) return { status: 400, body: { error: written.error } };
    for (const member of ruleMembers(state, name)) ports.reconcile(member, state.statuses[member]);
    ports.persist();
    return null;
  }
  // A manual mark toggles; marking a copy for one destination takes it off the other.
  function mark(name: string, slot: number, item: Item, mode: CollectionMode): null {
    const own = mode === 'bank' ? state.marked : state.merchantMarked, other = mode === 'bank' ? state.merchantMarked : state.marked;
    const list = (own[name] ||= []);
    const index = list.findIndex(entry => mode === 'merchant' || Number.isSafeInteger(entry?.slot)
      ? entry.slot === slot : JSON.stringify(entry) === JSON.stringify(item));
    if (index >= 0) list.splice(index, 1);
    else { list.push({ slot, item }); other[name] = (other[name] || []).filter(entry => !(Number.isSafeInteger(entry?.slot) && entry.slot === slot)); }
    ports.persist();
    return null;
  }
  return {
    handle(body: Record<string, unknown>): CommandOutcome {
      const name = requestText(body.character);
      if (['auto-item-mark', 'clear-auto-item-marks', 'remove-auto-item-mark'].includes(requestText(body.type)))
        return body.mode === 'bank' || body.mode === 'merchant' ? automatic(body, name, body.mode) : undefined;
      const item = requestObject(body.item);
      if (typeof item.name !== 'string' || !Number.isSafeInteger(body.slot)) return undefined;
      if (body.type === 'mark') return mark(name, body.slot as number, item, 'bank');
      if (body.type === 'merchant-mark') return mark(name, body.slot as number, item, 'merchant');
      return undefined;
    },
  };
}

/**
 * A withdrawal of a copy the recipient's rule banks asks first, then removes the bank rule through
 * the settings writer so the copy stays out.
 */
function guardBankWithdrawal(state: RuleState & { marked?: Record<string, ItemMark[] | undefined> }, name: string, item: Item, confirmed: boolean,
  ports: { persist(): void; write(batch: SettingsWrite): SettingsWriteResult }): CommandOutcome {
  const owner = ruleOwner(state, name);
  if (!state.autoItemMarks?.[owner] || ruleMode(state.autoItemMarks[owner]!, item) !== 'bank') return null;
  if (!confirmed) return { status: 409, body: { code: 'auto_bank_confirmation_required',
    error: 'This item is automatically marked for bank. Allow withdrawal and remove mark?' } };
  const draft = settingsDraft(state), key = ruleKey(item);
  forgetRule(draft.edit<Rules>('autoItemMarks')[owner], item, 'bank');
  const written = ports.write({ by: 'dashboard:command', changes: draft.changes() });
  if (!written.ok) return { status: 400, body: { error: written.error } };
  if (state.marked?.[name]) state.marked[name] = dropAuto(state.marked[name], key);
  ports.persist();
  return null;
}

// ---------------------------------------------------------------------------------------------
// F1, operation holds on a member's bag: the cells a sale, an upgrade, a stat scroll, a compound
// or a dismantle holds, released when the copy leaves.

interface ReservationState {
  marked: Record<string, ItemMark[] | undefined>;
  merchantMarked: Record<string, { slot?: number | string; equipped?: unknown }[] | undefined>;
  upgrades: Record<string, { slot?: number | string; equipped?: unknown }[] | undefined>;
  compounds: Record<string, { items: { slot?: number; item?: Item }[] }[] | undefined>;
}
export function createInventoryReservations(state: ReservationState) {
  function pruneCompounds(name: string, keep: (entry: { slot?: number; item?: Item }) => boolean): void {
    for (const group of state.compounds[name] || []) group.items = group.items.filter(keep);
    state.compounds[name] = (state.compounds[name] || []).filter(group => group.items.length);
  }
  return {
    /** An outgoing copy releases its cell; an equipped upgrade's mark stays. */
    remove(name: string, slot: number, item: Item): void {
      state.marked[name] = (state.marked[name] || []).filter(entry => Number.isSafeInteger(entry?.slot)
        ? entry.slot !== slot : JSON.stringify(markedItem(entry)) !== JSON.stringify(item));
      state.merchantMarked[name] = (state.merchantMarked[name] || []).filter(entry => entry.slot !== slot);
      writeIntents(state, name, marks => marks.filter(entry => entry.equipped || entry.slot !== slot));
      pruneCompounds(name, entry => entry.slot !== slot);
    },
    /** An incoming compound copy matches on the whole item, stack quantity included. */
    clearIncoming(name: string, item: Item): void {
      pruneCompounds(name, entry => JSON.stringify(entry.item) !== JSON.stringify(item));
    },
  };
}

export interface NpcSaleRule { item: Item; createdAt: number; character?: string; /** #116: copies kept across the merchant's bag, bank and BankBois. */ keep?: number }
export interface PlayerSaleState extends RuleState {
  merchantAutomations?: Record<string, boolean | undefined>;
  merchantCharacter: string | null;
  npcSaleMarks: NpcSale[];
  merchantMarked?: Record<string, ItemMark[] | undefined>;
  autoNpcSales: Record<string, NpcSaleRule>;
  marked?: Record<string, ItemMark[] | undefined>;
  upgrades?: Record<string, { slot?: string | number; npcSaleId?: unknown }[] | undefined>;
  statScrolls?: Record<string, { slot?: string | number; npcSaleId?: unknown }[] | undefined>;
  compounds?: Record<string, { items: { slot?: number }[] }[] | undefined>;
  deconstructionMarks?: { owner: string; slot: number; state: string; item: Item }[];
}
/** F1: another operation holds the member's cell, so a sale cannot take it. */
export function playerSaleReserved(state: PlayerSaleState, name: string, slot: number, item: Item): boolean {
  return [state.marked?.[name], state.upgrades?.[name], state.statScrolls?.[name], state.merchantMarked?.[name]]
    .some(marks => marks?.some(mark => mark.slot === slot && !(mark as { npcSaleId?: unknown }).npcSaleId)) ||
    !!state.compounds?.[name]?.some(group => group.items.some(entry => entry.slot === slot)) ||
    !!state.deconstructionMarks?.some(mark => mark.owner === name && mark.slot === slot && mark.state !== 'complete' && markMatches(mark.item, item));
}
export function reservePlayerSale(state: Pick<PlayerSaleState, 'merchantMarked'>, mark: NpcSale): void {
  const marks = ((state.merchantMarked ||= {})[mark.character!] ||= []);
  const reservation = { slot: mark.slot, item: mark.item, quantity: mark.quantity, npcSaleId: mark.id };
  const existing = marks.find(entry => (entry as { npcSaleId?: string }).npcSaleId === mark.id);
  if (existing) Object.assign(existing, reservation); else marks.push(reservation);
}
export function releasePlayerSale(state: Pick<PlayerSaleState, 'merchantMarked'>, mark: NpcSale): void {
  if (state.merchantMarked && mark.character)
    state.merchantMarked[mark.character] = (state.merchantMarked[mark.character] || []).filter(entry => (entry as { npcSaleId?: string }).npcSaleId !== mark.id);
}
/** A member's handoff receipt moves its sale to the merchant's stock. */
export function receivePlayerSales(state: Pick<PlayerSaleState, 'npcSaleMarks' | 'merchantMarked'>, character: string, kept: unknown, now: number): void {
  if (!Array.isArray(kept)) return;
  for (const receipt of kept) {
    const mark = state.npcSaleMarks.find(mark => mark.id === receipt?.npcSaleId && mark.source === 'character' && mark.character === character);
    if (!mark || !Number.isSafeInteger(receipt.quantity) || receipt.quantity < 1) continue;
    releasePlayerSale(state, mark);
    Object.assign(mark, { source: 'merchant', quantity: Math.min(mark.quantity, receipt.quantity), slot: -1, state: 'queued', receivedAt: now });
  }
}
type PlayerStatus = { name: string; seenAt?: number; items: readonly ({ slot: number; item: Item } | null)[] };
type PlayerPorts = { now(): number; nextCommand(): number; queue(names: (string | null)[], reason: JobReason): void };
function saleIntentExists(state: PlayerSaleState, status: PlayerStatus, entry: { slot: number; item: Item }): boolean {
  return state.npcSaleMarks.some(mark => {
    if (mark.character !== status.name || !markMatches(entry.item, mark.item)) return false;
    // A received pickup stays the merchant's until the recipient's first report newer than the
    // receipt shows the bag without it.
    if (mark.receivedAt && !(Number(status.seenAt) > mark.receivedAt)) return true;
    return mark.source === 'character' && (mark.slot === entry.slot ||
      !status.items.some(live => live?.slot === mark.slot && markMatches(live.item, mark.item)));
  });
}
const saleBlocked = (state: PlayerSaleState, name: string, entry: { slot: number; item: Item }) =>
  !!entry.item.l || !!entry.item.b || playerSaleReserved(state, name, entry.slot, entry.item);
/** F5 npc for a member's bag: each unheld copy under an active rule gets a sale mark, collected by the merchant. */
export function reconcilePlayerSales(state: PlayerSaleState, status: PlayerStatus, ports: PlayerPorts): boolean {
  const name = status.name, before = JSON.stringify([state.npcSaleMarks, state.merchantMarked?.[name]]);
  if (!state.merchantCharacter) return false;
  const enabled = routineEnabled({ reason: 'auto npc sales' }, played(state, 'merchantAutomations') ?? {});
  if (enabled && sharedMember(state, name)) for (const entry of status.items) {
    if (!entry?.item || saleBlocked(state, name, entry)) continue;
    const key = npcSaleRuleKey(entry.item, state.merchantRules ? undefined : name);
    if (!state.autoNpcSales[key] || itemRuleConflicts(state, entry.item).length || saleIntentExists(state, status, entry)) continue;
    state.npcSaleMarks.push({ id: 'auto-npc-sale-' + ports.nextCommand(), source: 'character', character: name, slot: entry.slot,
      item: { ...entry.item }, quantity: Math.max(1, Number(entry.item.q) || 1), auto: true, autoRuleKey: key, state: 'collecting', queuedAt: ports.now() });
  }
  const used = new Set<number>(), collect = new Set<JobReason>();
  for (const mark of state.npcSaleMarks.filter(mark => mark.source === 'character' && mark.character === name && (!mark.auto || enabled))) {
    const fits = (entry: PlayerStatus['items'][number]): entry is { slot: number; item: Item } => !!entry && !used.has(entry.slot) && markMatches(entry.item, mark.item);
    const entry = status.items.find(entry => entry?.slot === mark.slot && fits(entry)) || status.items.find(fits);
    if (!entry || (mark.auto && itemRuleConflicts(state, mark.item).length > 0) || saleBlocked(state, name, entry)) {
      mark.state = 'blocked';
      mark.error = 'Item is missing, protected, or reserved for other work';
      releasePlayerSale(state, mark);
      continue;
    }
    used.add(entry.slot);
    Object.assign(mark, { slot: entry.slot, state: 'collecting', error: null });
    reservePlayerSale(state, mark);
    collect.add(mark.auto ? 'marked items' : 'npc sale pickup');
  }
  for (const reason of collect) ports.queue([name], reason);
  return before !== JSON.stringify([state.npcSaleMarks, state.merchantMarked?.[name]]);
}

// ---------------------------------------------------------------------------------------------
// F4, the keep claim of a merchant-wide NPC sale rule: the rule keeps `keep` copies across the
// merchant's bag, bank and BankBois outside craft reservations, and sells only the rest.

interface NpcSaleKeepState {
  merchantCharacter?: string | null;
  autoNpcSales?: Record<string, { item: Item; character?: string; keep?: number } | undefined>;
  npcSaleMarks?: readonly { source?: string; slot?: number; item?: Item; quantity?: number; autoRuleKey?: string }[];
  withdrawals?: Record<string, readonly { pack?: string; item?: Item | null; autoNpcRuleKey?: string }[] | undefined>;
}
export function keptNpcSaleRule(state: NpcSaleKeepState, key: string): { keep: number } | undefined {
  const rule = state.autoNpcSales?.[key];
  return rule && !rule.character && Number.isSafeInteger(rule.keep) && Number(rule.keep) > 0 ? { keep: rule.keep! } : undefined;
}
/** Copies a keep rule may still sell: stock less the keep, the copies marked and the copies being withdrawn for sale. */
export function npcSaleSpare(state: NpcSaleKeepState, key: string, keep: number,
  stock: ReturnType<typeof protectedMerchantStorageStock> = protectedMerchantStorageStock(state)): number {
  const count = <T>(list: readonly T[], match: (entry: T) => boolean, size: (entry: T) => number) =>
    list.filter(match).reduce((sum, entry) => sum + size(entry), 0);
  const held = count(stock, entry => !!entry.item && commerceRuleKey(entry.item) === key, entry => Number(entry.item?.q) || 1);
  const marked = count(state.npcSaleMarks || [], mark => mark.source === 'merchant' && !!mark.item && commerceRuleKey(mark.item) === key, mark => Number(mark.quantity) || 1);
  const withdrawing = count(state.withdrawals?.[String(state.merchantCharacter)] || [], mark => mark.autoNpcRuleKey === key, mark => Number(mark.item?.q) || 1);
  return held - keep - marked - withdrawing;
}
/** A carried kept copy banks once nothing is left to sell and no sale holds its slot. One predicate serves a whole pass. */
export function keptNpcSaleCopies(state: NpcSaleKeepState): (entry: Pick<InventoryEntry, 'slot' | 'item'>) => boolean {
  let stock: ReturnType<typeof protectedMerchantStorageStock> | undefined;
  const spare = new Map<string, number>();
  return entry => {
    if (!entry.item) return false;
    const key = commerceRuleKey(entry.item), rule = keptNpcSaleRule(state, key);
    if (!rule || state.npcSaleMarks?.some(mark => mark.source === 'merchant' && mark.slot === entry.slot && markMatches(entry.item, mark.item))) return false;
    if (!spare.has(key)) spare.set(key, npcSaleSpare(state, key, rule.keep, stock ||= protectedMerchantStorageStock(state)));
    return spare.get(key)! <= 0;
  };
}

// ---------------------------------------------------------------------------------------------
// F3 withdrawal marks: the marked bank cells a collection visit takes (rules.ts hasMarkedWithdrawals).

export interface BankCollectionState {
  merchantCharacter: string | null;
  withdrawals?: Record<string, readonly unknown[] | undefined>;
  merchantAutomations?: Record<string, boolean | undefined>;
  itemCollectionThreshold: number;
}
/** Marked bank cells, counted once each. */
function markedBankSlots(state: BankCollectionState): number {
  const slots = new Set<string>();
  for (const value of state.withdrawals?.[String(state.merchantCharacter)] || []) {
    const request = requestObject(value);
    if (!hasMarkedWithdrawals([value]) || request.autoNpcRuleKey && !routineEnabled({ reason: 'auto npc sales' }, played(state, 'merchantAutomations') ?? {})) continue;
    slots.add(`${String(request.pack)}:${String(request.slot)}`);
  }
  return slots.size;
}
// The merchant's queue comes in beside the state, as visitPlanned reads it, so each owner's state type passes.
export function bankCollectionReason(state: BankCollectionState & Parameters<typeof visitPlanned>[0]):
  JobReason & ('withdrawals' | 'bank collection' | 'auto npc withdrawals') | null {
  const count = markedBankSlots(state);
  if (!count) return null;
  // Marked withdrawals ride the next planned own visit, so their own job waits for none.
  if (routineEnabled({ reason: 'withdrawals' }, played(state, 'merchantAutomations') ?? {})) return visitPlanned(state) ? null : 'withdrawals';
  // An automatic NPC sale fetches its own bank stock while the player's withdrawals are off, as
  // the previous release did. The sale producer queues this answer and the merchant jobs owner's readiness reads it, so the
  // job it queues is the one that runs. Its job is queued at once, during a planned own visit too, as
  // queued it (decisions.md answer 4).
  if (automaticNpcRetrieval(state)) return 'auto npc withdrawals';
  return routineEnabled({ reason: 'bank collection' }, played(state, 'merchantAutomations') ?? {}) && count >= state.itemCollectionThreshold ? 'bank collection' : null;
}

// The shared rules' load migration: it merges every member's rules into the merchant's, keeps
// each conflicting choice and the original documents, and writes the result through the
// settings writer by `migration:items`. The compound rules are the items owner's record and
// change in place.

interface MigrationState extends RuleState {
  npcSaleMarks?: { item: Item; auto?: boolean; character?: string; autoRuleKey?: string }[];
  autoItemMarks: Rules;
  autoUpgradeMarks: Rules;
  autoCompounds: Record<string, { name: string }[] | undefined>;
  autoDeconstruction: Record<string, Record<string, unknown> | undefined>;
  autoNpcSales: Record<string, { item: Item; character?: string }>;
  autoStandMarks: Record<string, unknown>;
  autoExchanges: Record<string, unknown>;
}
const MIGRATED_SETTINGS = ['merchantRules', 'autoItemMarks', 'autoDeconstruction', 'autoNpcSales'] as const;
function ruleSignature(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'createdAt').sort(([a], [b]) => a.localeCompare(b))));
}
// A rule from before levels counts as +0; an upgrade rule's bare tier count gains `quantity: -1`.
function migrationEntries(family: RuleFamily, entries: Record<string, unknown>): [string, unknown][] {
  const levelled = (key: string) => Number(ruleKeyParts(key) !== null);
  const sorted = Object.entries(entries).sort(([a], [b]) => levelled(a) - levelled(b));
  return Object.entries(Object.fromEntries(sorted.map(([key, value]): [string, unknown] => {
    if (family === 'item') return [ruleKeyParts(key) ? key : ruleKey({ name: key }), value];
    if (family !== 'upgrade') return [key, value];
    const rule = value && typeof value === 'object' ? value as { tiers?: number; quantity?: number } : { tiers: Number(value) };
    return [key, { tiers: Number(rule.tiers), quantity: rule.quantity ?? -1 }];
  })));
}
// The merchant's choice wins; identical choices merge; any other disagreement is a conflict the player picks.
function mergeRules(family: RuleFamily, records: Rules, members: string[], rules: SharedRules): Record<string, unknown> {
  const grouped = new Map<string, RuleChoice[]>();
  for (const owner of members) for (const [key, value] of migrationEntries(family, records[owner] || {}))
    grouped.set(key, [...grouped.get(key) || [], { owner, value }]);
  const result: Record<string, unknown> = {};
  for (const [key, choices] of grouped) {
    const merchant = choices.find(choice => choice.owner === rules.owner);
    if (merchant) result[key] = merchant.value;
    else if (choices.every(choice => ruleSignature(choice.value) === ruleSignature(choices[0].value))) result[key] = choices[0].value;
    else rules.conflicts.push({ id: `${family}:${key}`, family, key, choices });
  }
  for (const owner of members) delete records[owner];
  records[rules.owner] = result;
  return result;
}
/** The one-time move of the members' rules to the merchant; null when there is nothing to move. A
 *  refused write changes no record, and the next start migrates again from the same rules. */
export function migrateSharedRules(live: MigrationState, managed: string[], write: (batch: SettingsWrite) => SettingsWriteResult): SettingsWriteResult | null {
  if (live.merchantRules || !live.merchantCharacter) return null;
  const { staged: state, commit } = stageRecords(live), owner = live.merchantCharacter, members = [...new Set([owner, ...managed])];
  const draft = settingsDraft(state), edit = <K extends (typeof MIGRATED_SETTINGS)[number]>(field: K) => draft.edit<MigrationState[K]>(field);
  const rules: SharedRules = { version: 1, owner, conflicts: [], backup: structuredClone({ autoItemMarks: state.autoItemMarks,
    autoUpgradeMarks: state.autoUpgradeMarks, autoCompounds: state.autoCompounds, autoDeconstruction: state.autoDeconstruction, autoNpcSales: state.autoNpcSales }) };
  mergeRules('item', edit('autoItemMarks'), members, rules);
  mergeRules('upgrade', state.autoUpgradeMarks, members, rules);
  mergeRules('deconstruction', edit('autoDeconstruction'), members, rules);
  const compoundRecords = Object.fromEntries(Object.entries(state.autoCompounds).map(([member, list]) =>
    [member, Object.fromEntries((list || []).map(rule => [rule.name, rule]))]));
  const compounds = mergeRules('compound', compoundRecords, members, rules);
  for (const member of members) delete state.autoCompounds[member];
  state.autoCompounds[owner] = Object.values(compounds) as { name: string }[];
  const npcRecords: Record<string, Record<string, unknown>> = {};
  const sales = edit('autoNpcSales');
  for (const rule of Object.values(sales)) {
    const { character, ...value } = rule;
    (npcRecords[character || owner] ||= {})[commerceRuleKey(rule.item)] = value;
  }
  const npc = mergeRules('npc', npcRecords, members, rules);
  for (const [key, rule] of Object.entries(sales))
    if (!rule.character || members.includes(rule.character)) delete sales[key];
  Object.assign(sales, npc);
  for (const mark of state.npcSaleMarks || [])
    if (mark.auto && (!mark.character || members.includes(mark.character))) mark.autoRuleKey = commerceRuleKey(mark.item);
  draft.set('merchantRules', rules);
  const written = write({ by: 'migration:items', changes: draft.changes() });
  if (written.ok) commit();
  return written;
}
/**
 * The player's choice for one conflict sets the chosen rule for the merchant and retires the
 * conflict. The rule settings change in `draft`, which the route writes; the upgrade and compound
 * rules are records and change on the state.
 */
export function resolveRuleConflict(state: MigrationState, draft: SettingsDraft, id: string, owner: string): boolean {
  const shared = draft.edit<MigrationState['merchantRules']>('merchantRules');
  const conflict = shared?.conflicts.find(value => value.id === id), choice = conflict?.choices.find(value => value.owner === owner);
  if (!shared || !conflict || !choice) return false;
  const merchant = String(state.merchantCharacter), key = conflict.key;
  if (conflict.family === 'compound') {
    state.autoCompounds[merchant] = [...(state.autoCompounds[merchant] || []).filter(rule => rule.name !== key), choice.value as { name: string }];
  } else {
    const perOwner = (field: 'autoItemMarks' | 'autoDeconstruction') => draft.edit<Rules>(field)[merchant] ||= {};
    const maps: Record<Exclude<RuleFamily, 'compound'>, () => Record<string, unknown>> = { item: () => perOwner('autoItemMarks'),
      upgrade: () => state.autoUpgradeMarks[merchant] ||= {}, deconstruction: () => perOwner('autoDeconstruction'),
      npc: () => draft.edit('autoNpcSales'), stand: () => draft.edit('autoStandMarks'), exchange: () => draft.edit('autoExchanges') };
    maps[conflict.family]()[key] = choice.value;
  }
  shared.conflicts = shared.conflicts.filter(value => value !== conflict);
  return true;
}
// The rule conflict route's answer (POST /party-api/merchant/rule-conflict, routes/inventory.ts): the
// player's choice writes its settings through the settings writer, then the staged records.
export function chooseRuleConflict(state: MigrationState, persist: () => void, write: (batch: SettingsWrite) => SettingsWriteResult) {
  return (body: Record<string, unknown>): ItemsAnswer => {
    const draft = settingsDraft(state), { staged, commit } = stageRecords(state);
    if (!resolveRuleConflict(staged, draft, String(body.id), String(body.owner))) return { status: 404, body: { error: 'Rule choice no longer available' } };
    const written = write({ by: 'dashboard:rule-conflict', changes: draft.changes() });
    if (!written.ok) return { status: 400, body: { error: written.error } };
    commit();
    persist();
    return { body: { ok: true } };
  };
}

// The stale mark clear: the merchant's bank marks keep only the copies its bag still holds. A
// missing copy is not a delivery receipt, so delivery marks stay.
export interface StaleMarkState {
  merchantCharacter: string | null;
  statuses: Record<string, { items?: (InventoryEntry | null)[] } | undefined>;
  marked: Record<string, ItemMark[] | undefined>;
}
export function createStaleMarkClear(state: StaleMarkState, persist: () => void) {
  function bankMarks(merchant: string | null, inventory: InventoryEntry[]): number {
    let removed = 0;
    state.marked[String(merchant)] = (state.marked[String(merchant)] || []).filter((mark) => {
      // A mark keeps its copy while the bag holds one with the mark's lasting fields.
      if (inventory.some((entry) => markMatches(entry.item, markedItem(mark)))) return true;
      removed++;
      return false;
    });
    return removed;
  }
  return function clear(): ItemsAnswer {
    const merchant = state.merchantCharacter,
      status = state.statuses[String(merchant)];
    if (!merchant || !status) return { status: 409, body: { error: "merchant status unavailable" } };
    const inventory = (status.items || []).filter((entry): entry is InventoryEntry => !!entry);
    const deliveriesRemoved = 0,
      bankMarksRemoved = bankMarks(merchant, inventory);
    persist();
    return { body: { ok: true, deliveriesRemoved, bankMarksRemoved } };
  };
}

// F4, the claims, and the fate read. Copies of a bag go to claims in rank order, so two claims
// never take one copy: the restock ranges (each character's `restockPolicies`, the merchant's own
// among them), then on the merchant the offerings an upgrade offering rule names, the craft
// reservations of queued orders, a compound rule's held triplets and the #116 keep of a sale rule,
// then each `items.claim` answer in registration order: the events owner's Cipher claim, then
// the add-ons'.

export interface FateState extends CraftReservationState, NpcSaleKeepState, RuleState {
  statuses: Record<string, { items?: unknown; slots?: Record<string, unknown>; inventorySize?: unknown } | undefined>;
  marked: Record<string, ItemMark[] | undefined>;
  merchantMarked: Record<string, (ItemMark & { npcSaleId?: string; deconstructionId?: string; exchangeJobId?: unknown; automaticPickup?: boolean })[] | undefined>;
  upgrades: Record<string, { auto?: boolean; slot?: number | string; item?: Item; passId?: unknown }[] | undefined>;
  compounds: Record<string, { items: { slot?: number | string; item?: Item }[] }[] | undefined>;
  statScrolls: Record<string, { slot?: number | string; item?: Item }[] | undefined>;
  merchantDeliveries?: Record<string, { slot?: number; item?: Item | null }[] | undefined>;
  standListings?: { slot?: number; item?: Item; bankPack?: string; source?: string }[];
  deconstructionMarks?: { slot?: number; item?: Item; owner?: string; bankPack?: string }[];
  merchantWeapon?: { item: Item } | null;
  restockPolicies?: Record<string, RestockPolicy | undefined>;
  upgradeOfferingRules?: { offering?: string }[];
  bankSnapshot?: { packs?: Record<string, unknown[] | undefined> } | null;
  autoCompounds: Record<string, { name: string; quantity?: number; targetTier?: number }[] | undefined>;
}
type Entry = InventoryEntry & { slot: number; item: Item };
interface Taken { fate: string; by: string }
interface ClaimShort { claim: Claim; short: number }
function bagEntries(state: FateState, name: string): Entry[] {
  const items = state.statuses[name]?.items;
  return (Array.isArray(items) ? items : []).map((raw, index) => {
    const entry = raw as InventoryEntry | null;
    return entry?.item ? { ...entry, slot: entry.slot ?? index, item: entry.item } as Entry : null;
  }).filter((entry): entry is Entry => !!entry);
}
/** The game's stack size of an item (G.items[name].s), 1 for an item that does not stack. */
function stackSize(name: string): number {
  return Number((gameItems()?.[name] as { s?: number } | undefined)?.s) || 1;
}
/** The cells of the bank snapshot's packs (bank place). */
function bankCells(state: FateState): number {
  return Object.values(state.bankSnapshot?.packs || {}).reduce((sum, pack) => sum + (Array.isArray(pack) ? pack.length : BANK_PACK_CELLS), 0);
}
function restockClaims(state: FateState, name: string): Claim[] {
  const policy = restockPolicyOf(state.restockPolicies || {}, name);
  return [policy.hp, policy.mp, policy.elixir].filter(supply => !!supply && Number(supply.max) > 0).map(supply => ({
    item: { name: supply!.item }, quantity: { min: Number(supply!.min), max: Number(supply!.max) }, place: `carried:${name}`,
    reason: 'restock', by: 'core:restock' }));
}
export const claimId = (claim: Pick<Claim, 'item' | 'place' | 'by'>) => `${claim.by}|${claim.item.name}@${claim.item.level ?? ''}|${claim.place}`;
/**
 * The `items.claim` answers of one character's view (`only` asks one add-on); a claim refused at load
 * takes no copy. A core owner's claim is named by its registration, an add-on's `addon:<name>`.
 */
function addonClaims(state: Pick<FateState, 'statuses' | 'bankSnapshot'>, name: string, refused: ReadonlySet<string>, only?: string): Claim[] {
  const hooks = partyHooks();
  if (!hooks.itemRules.claiming()) return [];
  return hooks.itemRules.claims({ character: name, bag: (state.statuses[name]?.items as unknown[]) || [], bank: state.bankSnapshot ?? null }, only)
    .filter(({ answer }) => answer && typeof answer.item?.name === 'string' && typeof answer.place === 'string')
    .map(({ addon, answer }) => ({ ...answer, by: addon.startsWith('core:') ? addon : `addon:${addon}` }))
    .filter(claim => !refused.has(claimId(claim)));
}
const claimHere = (claim: Claim, name: string, merchant: boolean) => claim.place === `carried:${name}` || merchant && claim.place === 'merchant';

/** One bag's claims: the slots each claim keeps, and each count or stack claim left short. */
export function bagClaims(state: FateState, name: string, refused: ReadonlySet<string> = new Set()): { taken: Map<number, Taken>; short: ClaimShort[] } {
  const merchant = name === state.merchantCharacter, bag = bagEntries(state, name), taken = new Map<number, Taken>(), short: ClaimShort[] = [];
  const keep = (entry: Entry, by: string, fate = 'keep') => { if (!taken.has(entry.slot)) taken.set(entry.slot, { fate, by }); };
  // A range claim keeps copies up to its max and is refilled by its min, so only a count or stack claim is short.
  const take = (claim: Claim) => {
    const wanted = claimCopies(claim, stackSize(claim.item.name));
    let got = 0;
    for (const entry of bag) {
      if (got >= wanted || taken.has(entry.slot) || entry.item.name !== claim.item.name || !usableCopy(entry.item)) continue;
      if (claim.item.level !== undefined && (Number(entry.item.level) || 0) !== claim.item.level) continue;
      keep(entry, claim.by, claimFate(claim.place, merchant));
      got += Number(entry.item.q) || 1;
    }
    // An `all` claim at the merchant is short by the copies the bank and the BankBois still hold.
    if ('all' in claim.quantity) {
      const stored = merchant && claim.place === 'merchant' ? storedCopies(state, claim).reduce((sum, entry) => sum + (Number(entry.item.q) || 1), 0) : 0;
      if (stored > 0) short.push({ claim, short: stored });
    } else if (got < wanted && !('max' in claim.quantity)) short.push({ claim, short: wanted - got });
  };
  for (const claim of restockClaims(state, name)) take(claim);
  if (merchant) {
    const offerings = new Set((played(state, 'upgradeOfferingRules') || []).map(rule => rule.offering).filter(isUpgradeOffering));
    for (const entry of bag) if (offerings.has(entry.item.name as never) && usableCopy(entry.item)) keep(entry, 'core:offering');
  }
  const craft = availableCraftStock(bag.map(entry => ({ ...entry, craftLocation: inventoryPack(name) })), craftProtection(state));
  bag.forEach((entry, index) => {
    const free = craft[index]?.item ? Number(craft[index]!.item!.q) || 1 : 0;
    if (free < (Number(entry.item.q) || 1)) keep(entry, 'core:craft');
  });
  if (merchant) {
    const rules = sharedCompoundRules(state as Parameters<typeof sharedCompoundRules>[0]);
    const leftovers = new Set(compoundStorageLeftovers(rules, bag, protectedMerchantStorageStock(state)).map(entry => entry.slot));
    for (const entry of bag)
      if (!leftovers.has(entry.slot) && rules.some(rule => Number(rule.quantity) !== 0 && rule.name === entry.item.name &&
        Number(entry.item.level || 0) < Number(rule.targetTier || 1))) keep(entry, 'core:compound');
    const kept = keptNpcSaleCopies(state);
    for (const entry of bag) if (kept(entry)) keep(entry, 'core:npc-keep', 'bank');
  }
  for (const claim of addonClaims(state, name, refused)) if (claimHere(claim, name, merchant)) take(claim);
  return { taken, short };
}

/**
 * At an add-on's load each of its claims is summed per item and place with the claims ranked before it
 * (the restock ranges and the earlier add-ons) and refused when the sum passes what the place holds:
 * the bag's cells for a carrier, the snapshot's cells for the bank, times the stack size. It answers
 * each refused claim with the claim it overran.
 */
export function refusedClaims(state: FateState, addon: string, refused: ReadonlySet<string>): { claim: Claim; over: Claim | null }[] {
  const out: { claim: Claim; over: Claim | null }[] = [];
  for (const name of Object.keys(state.statuses)) {
    const earlier = [...restockClaims(state, name), ...addonClaims(state, name, refused).filter(claim => claim.by !== `addon:${addon}`)];
    for (const claim of addonClaims(state, name, refused, addon)) {
      // An `all` claim takes only what is there and fetches only into free cells, so it always fits.
      if ('all' in claim.quantity) continue;
      const stack = stackSize(claim.item.name), same = earlier.filter(other => other.item.name === claim.item.name && other.place === claim.place);
      const sum = [...same, claim].reduce((total, one) => total + claimCopies(one, stack), 0);
      if (sum > placeHolds(claim.place, stack, bagSize(state.statuses[name]), bankCells(state))) out.push({ claim, over: same.at(-1) ?? null });
      else earlier.push(claim);
    }
  }
  return out;
}

/**
 * The items the player banked by hand per live merchant `all` claim, as exchange keys. The
 * player's mark beats the claim, so that claim fetches none of those stored copies back
 * while it lives.
 */
export type ClaimBanked = Record<string, string[] | undefined>;
type ClaimBankedState = Pick<FateState, 'statuses' | 'bankSnapshot'> & { claimBanked: ClaimBanked };
const merchantAllClaims = (state: Pick<FateState, 'statuses' | 'bankSnapshot'>, name: string, refused: ReadonlySet<string>) =>
  addonClaims(state, name, refused).filter(claim => 'all' in claim.quantity && claim.place === 'merchant');
/** The merchant job owner's job completion hands the merchant's bank receipts; each manual one a live claim asks for is kept. */
export function recordClaimBanked(state: ClaimBankedState, name: string, banked: readonly unknown[] | undefined): void {
  const manual = (banked || []).map(requestObject).filter(mark => mark.auto !== true).map(mark => requestObject(mark.item ?? mark))
    .filter(item => typeof item.name === 'string');
  if (!manual.length) return;
  for (const claim of merchantAllClaims(state, name, new Set())) for (const item of manual) {
    const level = Number(item.level) || 0;
    if (item.name !== claim.item.name || claim.item.level !== undefined && level !== claim.item.level) continue;
    const keys = state.claimBanked[claimId(claim)] ||= [], key = exchangeKey(String(item.name), level);
    if (!keys.includes(key)) keys.push(key);
  }
}
/** The usable copies of a claim's item in the bank's vaults and the BankBois' bags (the merchant's storage stock). */
function storedCopies(state: FateState & { claimBanked?: ClaimBanked }, claim: Claim): { craftLocation: string; slot: number; item: Item }[] {
  const banked = state.claimBanked?.[claimId(claim)] || [];
  return protectedMerchantStorageStock(state).flatMap(entry => entry.item && !isInventoryPack(entry.craftLocation) &&
    entry.item.name === claim.item.name && usableCopy(entry.item) && !banked.includes(exchangeKey(entry.item.name, Number(entry.item.level) || 0)) &&
    (claim.item.level === undefined || (Number(entry.item.level) || 0) === claim.item.level) && Number.isSafeInteger(entry.slot)
    ? [{ craftLocation: entry.craftLocation, slot: Number(entry.slot), item: entry.item as Item }] : []);
}

interface ClaimFetchState extends FateState {
  claimBanked?: ClaimBanked;
  merchantAutomations?: Record<string, boolean | undefined>;
  luckySlotLocks?: Record<string, number | null>;
  protectedFreeSlots?: unknown;
}
interface ClaimRequest { pack?: string; slot?: number; item?: Item; claim?: string }
/**
 * The merchant's `all` claims fetch their stored copies the way compound inputs come:
 * one withdrawal request per cell, tagged with the claim, while a cell past the lucky slot's hold and
 * the protected free slots is free. The requests are marked withdrawals, so they ride the next planned
 * visit or queue the `withdrawals` job (`bankCollectionReason`); a BankBoi cell reaches a vault first
 *. A request whose claim no longer asks goes. With the player's `withdrawals` automation off,
 * nothing is staged. Answers whether the requests changed.
 */
export function stageClaimWithdrawals(state: ClaimFetchState, name: string, refused?: ReadonlySet<string>): boolean {
  if (name !== state.merchantCharacter) return false;
  const all = (state.withdrawals ||= {}) as Record<string, ClaimRequest[] | undefined>, requests = all[name] ||= [];
  const short = bagClaims(state, name, refused).short.filter(({ claim }) => 'all' in claim.quantity && claim.place === 'merchant');
  const wanted = new Set(short.map(({ claim }) => claimId(claim)));
  const banked = (request: ClaimRequest) => !!state.claimBanked?.[request.claim!]?.includes(exchangeKey(String(request.item?.name), Number(request.item?.level) || 0));
  const kept = all[name] = requests.filter(request => !request.claim || wanted.has(request.claim) && !banked(request));
  let changed = kept.length !== requests.length;
  // A player's bank record lapses with its claim.
  const live = new Set(merchantAllClaims(state, name, refused || new Set()).map(claimId));
  for (const id of Object.keys(state.claimBanked || {})) if (!live.has(id)) { delete state.claimBanked![id]; changed = true; }
  if (!routineEnabled({ reason: 'withdrawals' }, played(state, 'merchantAutomations') ?? {})) return changed;
  const cells = new Set(kept.map(request => `${String(request.pack)}:${String(request.slot)}`));
  let room = freeSlots(state.statuses[name]?.items as unknown[] | undefined, luckySlotOf(state, name), protectedSlotsOf(state, name)) -
    kept.filter(request => request.claim).length;
  for (const { claim } of short) for (const entry of storedCopies(state, claim)) {
    const cell = `${entry.craftLocation}:${entry.slot}`;
    if (room <= 0) return changed;
    if (cells.has(cell)) continue;
    kept.push({ pack: entry.craftLocation, slot: entry.slot, item: entry.item, claim: claimId(claim) });
    cells.add(cell);
    room--;
    changed = true;
  }
  return changed;
}
/** `items.claimPending`: the stored copies 10 still fetches for one claimer's claims at the character. */
export function claimPending(state: FateState, name: string, by: string): number {
  const requests = ((state.withdrawals as Record<string, ClaimRequest[] | undefined> | undefined)?.[name] || []);
  return requests.filter(request => request.claim?.startsWith(by + '|')).reduce((sum, request) => sum + (Number(request.item?.q) || 1), 0);
}

/** `items.stock`: the copies of an item in a character's bag that no claim keeps. */
export function itemStock(state: FateState, name: string, item: string, refused?: ReadonlySet<string>): number {
  const { taken } = bagClaims(state, name, refused);
  return bagEntries(state, name).filter(entry => entry.item.name === item && !taken.has(entry.slot))
    .reduce((sum, entry) => sum + (Number(entry.item.q) || 1), 0);
}

/**
 * The items owner's identity rule: the bag copy a mark names. A slotted mark names the copy at its
 * slot when that copy matches the mark's item. A mark with no slot, saved before marks had one, is
 * the item itself and names each matching copy (markedItem).
 */
function markNames(mark: { slot?: number | string; item?: Item | null }, entry: Pick<Entry, 'slot' | 'item'>): boolean {
  if (mark.slot === undefined) return markMatches(entry.item, mark);
  return mark.slot === entry.slot && (!mark.item || markMatches(entry.item, mark.item));
}
const markAt = <T extends { slot?: number | string; item?: Item | null }>(list: readonly T[] | undefined, entry: Entry) =>
  (list || []).find(mark => markNames(mark, entry));
// F6: an add-on's action names one of F5's core actions, which the items owner's executors
// run.
const CORE_ACTIONS = new Set<string>([...AUTOMATIC_ORDER, 'bank', 'merchant', 'keep']);
/** An add-on's action for a copy no mark or claim holds, or null. With `core`, F5's action for the
 * copy, only an answer whose order places it ahead of that action counts. */
export function addonAction(name: string, owner: string, entry: Entry, core?: string): { fate: string; by: string; ahead?: boolean } | null {
  const hooks = partyHooks();
  if (!hooks.itemRules.acting()) return null;
  const found = hooks.itemRules.actions({ character: name, slot: entry.slot, item: entry.item, owner, ...(core ? { core } : {}) })
    .find(({ answer }) => CORE_ACTIONS.has(String(answer?.action)) && (!core || addonAhead(answer.order, core)));
  return found ? { fate: found.answer.action, by: `addon:${found.addon}`, ...(core ? { ahead: true } : {}) } : null;
}

/**
 * `items.fate(character, slot)`: the fate table read top down for one copy of a member's bag, or for an equipped
 * copy when `slot` names an equipment slot. A slot with no copy has no fate. A bag copy is never a
 * fresh exchange reward, so F7 keeps it; `exchangeRewardFates` answers the rewards.
 */
export function itemFate(state: FateState, name: string, slot: number | string | ItemMark, refused?: ReadonlySet<string>): Fate | null {
  if (typeof slot === 'string') return state.statuses[name]?.slots?.[slot] ? { fate: 'keep', row: 'F2', by: 'equipped' } : null;
  let taken: Map<number, Taken> | undefined;
  const claimed = () => taken ||= bagClaims(state, name, refused).taken;
  if (typeof slot === 'number') {
    const entry = bagEntries(state, name).find(one => one.slot === slot);
    return entry ? copyFate(state, name, entry, claimed) : null;
  }
  // A mark's fate is its named copies' (markNames): the first copy the fate table banks, else the first copy's.
  const fates = bagEntries(state, name).filter(entry => markNames(slot, entry)).map(entry => copyFate(state, name, entry, claimed));
  return fates.find(one => one.fate === 'bank') ?? fates[0] ?? null;
}
/** Part 4: the copies of a character's bag an add-on's claim or action holds, by slot, for
 * the dashboard's item-rules slot; whether the record changed. A character with none has no entry. */
export function publishAddonFates(state: FateState & { addonItemFates?: Record<string, Record<number, Fate>> }, name: string,
  refused?: ReadonlySet<string>): boolean {
  const hooks = partyHooks(), asked = hooks.itemRules.claiming() || hooks.itemRules.acting();
  const fates = asked ? Object.fromEntries(bagEntries(state, name).flatMap(entry => {
    const fate = itemFate(state, name, entry.slot, refused);
    return fate?.by.startsWith('addon:') ? [[entry.slot, fate]] : [];
  })) : {};
  const all = state.addonItemFates ||= {}, before = JSON.stringify(all[name] ?? {});
  if (JSON.stringify(fates) === before) return false;
  if (Object.keys(fates).length) all[name] = fates; else delete all[name];
  return true;
}
/** The items a current or queued job withdraws or uses: its exchange lines and its order's requirements. */
function jobInputs(state: FateState): Set<string> {
  return new Set([state.merchantCurrent, ...(state.merchantQueue || [])].flatMap(job => [...job?.exchanges || [],
    ...(job?.order as { requirements?: { id: string; level?: number }[] } | undefined)?.requirements || []])
    .map(line => exchangeKey(line.id, Number(line.level) || 0)));
}
/** The fate table for one bag copy; `claimed` answers the bag's F4 claims, so a pass over the whole bag runs bagClaims once. */
function copyFate(state: FateState, name: string, entry: Entry, claimed: () => Map<number, Taken>): Fate {
  const merchant = name === state.merchantCharacter, owner = ruleOwner(state, name);
  return fateOf({
    held() {
      if (markAt(state.merchantDeliveries?.[name], entry)) return 'delivery';
      if (craftProtection(state).deliveries?.some(one => one.location === inventoryPack(name) && one.slot === entry.slot)) return 'delivery';
      if (markAt(state.merchantMarked[name], entry)?.exchangeJobId) return 'exchange';
      // A job holds every copy of an item it withdraws or uses, so its own errand never banks one (the previous release
      // shared.js:7731, 8264).
      if (merchant && jobInputs(state).has(exchangeKey(entry.item.name, Number(entry.item.level) || 0))) return 'job input';
      if (markAt(state.upgrades[name], entry)?.passId) return 'production';
      if (merchant && markAt((state.standListings || []).filter(one => !one.bankPack && one.source !== 'bank'), entry)) return 'stand listing';
      if (markAt((state.deconstructionMarks || []).filter(one => !one.bankPack && (one.owner || state.merchantCharacter) === name), entry)) return 'dismantle';
      return null;
    },
    equipped: () => merchant && markMatches(entry.item, state.merchantWeapon?.item) ? 'merchant weapon' : null,
    mark() {
      // The player's own lock (`l`) or a bound copy (`b`) stays where it is.
      if (!usableCopy(entry.item)) return 'keep';
      const bank = markAt(state.marked[name], entry), kept = markAt(state.merchantMarked[name], entry);
      if (bank && !bank.auto) return 'bank';
      if (kept && !kept.auto && !kept.automaticPickup) return kept.npcSaleId ? 'npc' : kept.deconstructionId ? 'deconstruction' : 'merchant';
      if (markAt(state.upgrades[name]?.filter(mark => !mark.auto), entry)) return 'upgrade';
      if ((state.compounds[name] || []).some(group => markAt(group.items, entry))) return 'compound';
      return markAt(state.statScrolls[name], entry) ? 'stat scroll' : null;
    },
    claim: () => claimed().get(entry.slot) ?? null,
    rule() { const action = ruleAction(state, entry.item, name); return action ? { fate: action, by: `rule:${owner}` } : null; },
    addon: core => addonAction(name, owner, entry, core),
    reward: () => false,
  });
}

// ---------------------------------------------------------------------------------------------
// The player's transfer commands on a character's items (3.1): equip, give, withdraw and the bank
// upgrade. Each one refuses a copy the marks and withdrawals above hold.
interface Delivery extends DeliveryRequest {
  slot: number;
  item: Item;
  equipOnDelivery?: boolean;
  awaitingEquip?: boolean;
}
interface Withdrawal {
  pack: string;
  slot?: number;
  item?: Item | null;
}
type TransferState = Parameters<typeof guardBankWithdrawal>[0] & {
  statuses?: Record<string, (import("../../coordinator/contracts/position.ts").ObservedPosition & {items?: (InventoryEntry | null)[]}) | undefined>;
  merchantCharacter: string | null;
  merchantWeapon: { item?: Item } | null;
  merchantWeaponTypes?: readonly string[];
  merchantDeliveries: Record<string, Delivery[] | undefined>;
  withdrawals: Record<string, Withdrawal[] | undefined>;
  bankSnapshot?: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
  bankbois: Record<string, { name: string; items?: (InventoryEntry | null)[] }>;
  commands: Record<string, MerchantCommand | undefined>;
  upgrades: Record<string, UpgradeMark[] | undefined>;
  merchantCatalog?: unknown;
}
interface TransferPorts {
  managed(name: unknown): boolean;
  nextCommand(): number;
  removeReservations(name: string, slot: number, item: Item): void;
  clearIncoming(name: string, item: Item): void;
  sameItem(first: Item, second: Item): boolean;
  identity(item: Item | null | undefined): string;
  persist(): void;
  persistBank(): void;
  bankboi(): Promise<unknown>;
  log(message: string, level: string, details: unknown): void;
  write(batch: SettingsWrite): SettingsWriteResult;
}
type Request = Record<string, unknown>;
function same(entry: Delivery, slot: number, item: Item): boolean {
  return entry.slot === slot && JSON.stringify(entry.item) === JSON.stringify(item);
}
function removingWithdrawal(body: Request, pending: Withdrawal[], item: Item): boolean {
  return body.markAll !== true && pending.some(entry =>
    JSON.stringify(entry) === JSON.stringify({ pack: body.pack, slot: body.slot, item }));
}
export function createTransferCommands(state: TransferState, ports: TransferPorts) {
  // The merchant's weapon is a setting: equipping or unequipping it from the dashboard writes it
  // through the settings writer, and a refusal leaves the equip unsent.
  function rememberManualWeapon(body: Request, name: string, item: Item): SettingsWriteResult | null {
    if (name !== state.merchantCharacter) return null;
    // Dashboard Equip sends an item fingerprint; native equip resolves its live
    // inventory position. An explicit slot, when supplied, still must match.
    const entry = state.statuses?.[name]?.items?.find(candidate => candidate?.item &&
      (body.slot === undefined || candidate.slot === body.slot) && ports.sameItem(candidate.item, item));
    const definition = entryMeta(state.merchantCatalog, entry)?.definition;
    if (!entry || !definition || typeof entry.slot !== 'number' || !merchantWeaponCompatible(definition, state.merchantWeaponTypes || [])) return null;
    const written = ports.write({ by: "dashboard:command", changes: [{ field: "merchantWeapon", value: { item } }] });
    if (written.ok) ports.removeReservations(name, entry.slot, item);
    return written;
  }
  function equip(body: Request, name: string, item: Item): CommandOutcome {
    if (body.type === "equip") {
      const remembered = rememberManualWeapon(body, name, item);
      if (remembered && !remembered.ok) return { status: 400, body: { error: remembered.error } };
      return manual(name, { id: ports.nextCommand(), type: "equip", item });
    }
    if (typeof body.slot !== "string" || !/^[a-z0-9_]+$/i.test(body.slot)) return undefined;
    if (
      name === state.merchantCharacter &&
      body.slot === "mainhand" &&
      state.merchantWeapon?.item &&
      ports.sameItem(state.merchantWeapon.item, item)
    ) {
      const written = ports.write({ by: "dashboard:command", changes: [{ field: "merchantWeapon", value: null }] });
      if (!written.ok) return { status: 400, body: { error: written.error } };
    }
    return manual(name, { id: ports.nextCommand(), type: "unequip", slot: body.slot, item });
  }
  // The equip, unequip and use-item commands reach the slot through the merchant job owner's one
  // writer (edit row): during a merchant job the command waits for the job's next stop, and the
  // answer says so. One manual command waits at a time: the merchant job owner's writer refuses a
  // second one while the first is held, and the answer names the one waiting.
  function manual(name: string, command: MerchantCommand): CommandOutcome {
    const answer = merchantSlotCommand(state, 'manual:' + command.type, command, name);
    if (answer === 'held') return { status: 202, body: { ok: true, waiting: "waiting for the job's next stop" } };
    if (answer === 'refused') return { status: 409, body: { error: "Another manual command is waiting for the job's next stop" } };
    return null;
  }
  function delivery(target: string, slot: number, item: Item, equipOnDelivery: boolean): void {
    const existing = (state.merchantDeliveries[target] || []).some(
      (entry) => same(entry, slot, item) && !!entry.equipOnDelivery === equipOnDelivery,
    );
    for (const name of Object.keys(state.merchantDeliveries))
      state.merchantDeliveries[name] = (state.merchantDeliveries[name] || []).filter(
        (entry) => !same(entry, slot, item),
      );
    if (!existing) (state.merchantDeliveries[target] ||= []).push({ id: globalThis.crypto.randomUUID(), slot, item, equipOnDelivery });
  }
  function give(body: Request, name: string, item: Item): CommandOutcome {
    if (
      !Number.isSafeInteger(body.slot) ||
      !ports.managed(body.target) ||
      body.target === body.character
    )
      return undefined;
    const slot = body.slot as number,
      target = requestText(body.target);
    if (name !== state.merchantCharacter && !deliveryInRange(state.statuses?.[name], state.statuses?.[target]))
      return {status:409,body:{error:"Delivery target is out of range; item and marks retained"}};
    if (name === state.merchantCharacter) ports.removeReservations(name, slot, item);
    if (name === state.merchantCharacter)
      delivery(target, slot, item, body.equipOnDelivery === true);
    else {
      ports.clearIncoming(target, item);
      merchantSlotCommand(state, 'transfer', { id: ports.nextCommand(), type: "give", item, slot, target }, name);
    }
    ports.persist();
    return null;
  }
  function addMatching(
    pending: Withdrawal[],
    entries: (InventoryEntry | null)[] | undefined,
    pack: string,
    identity: string,
  ): void {
    for (const entry of entries || []) {
      if (!entry || ports.identity(entry.item) !== identity) continue;
      const request = { pack, slot: entry.slot, item: entry.item },
        encoded = JSON.stringify(request);
      if (!pending.some((value) => JSON.stringify(value) === encoded)) pending.push(request);
    }
  }
  function all(pending: Withdrawal[], item: Item): void {
    const identity = ports.identity(item);
    for (const [pack, entries] of Object.entries(state.bankSnapshot?.packs || {}))
      addMatching(pending, entries, pack, identity);
    for (const bankboi of Object.values(state.bankbois))
      addMatching(pending, bankboi.items, bankboiPack(bankboi.name), identity);
  }
  function validWithdrawal(body: Request): body is Request & { pack: string; slot: number } {
    return storagePack(body.pack) !== null && Number.isSafeInteger(body.slot);
  }
  function updateWithdrawal(pending: Withdrawal[], body: Request & { pack: string; slot: number }, item: Item): void {
    const request = { pack: body.pack, slot: body.slot, item }, encoded = JSON.stringify(request);
    const index = pending.findIndex(entry => JSON.stringify(entry) === encoded);
    if (index < 0) pending.push(request);
    else if (body.upgradeTiers === undefined) pending.splice(index, 1);
  }
  function withdraw(body: Request, name: string, item: Item): CommandOutcome {
    if (!validWithdrawal(body)) return undefined;
    const invalid = bankUpgradeRefusal(state, body, name, item);
    if (invalid) return invalid;
    const pending = state.withdrawals[name] || [];
    const upgrade = body.upgradeTiers !== undefined;
    if (upgrade || !removingWithdrawal(body, pending, item)) {
      const blocked = guardBankWithdrawal(state, name, item, body.removeAutoBankMark === true, ports);
      if (blocked) return blocked;
    }
    state.withdrawals[name] = pending;
    if (body.markAll === true) all(pending, item);
    else updateWithdrawal(pending, body, item);
    putBankUpgrade(state, body, name, item);
    if (upgrade) ports.persist();
    ports.persistBank();
    if (pending.some((request) => isBankboiPack(request.pack)))
      void ports
        .bankboi()
        .catch((error: unknown) =>
          ports.log("Could not schedule bankboi retrieval", "error", {
            error: requestObject(error).message,
          }),
        );
    return null;
  }
  function handle(body: Request): CommandOutcome {
    const item = requestObject(body.item),
      name = requestText(body.character);
    if (typeof item.name !== "string") return undefined;
    switch (body.type) {
      case "use-item":
        if (!Number.isSafeInteger(body.slot) || Number(body.slot) < 0) return undefined;
        return manual(name, {id: ports.nextCommand(), type: "use-item", item, slot: Number(body.slot)});
      case "equip":
      case "unequip":
        return equip(body, name, item);
      case "give":
        return give(body, name, item);
      case "withdraw":
        return withdraw(body, name, item);
      default:
        return undefined;
    }
  }
  return { handle };
}

function deliveryInRange(source: import('../../coordinator/contracts/position.ts').ObservedPosition | undefined, target: import('../../coordinator/contracts/position.ts').ObservedPosition | undefined): boolean {
  if (!source || !target || source.map !== target.map || source.in !== target.in || source.server !== target.server) return false;
  if (!fresh(source.seenAt, Date.now(), 'presence') || !fresh(target.seenAt, Date.now(), 'presence')) return false;
  // The game's send reach less the reported position's step (protocol/reports.ts SEND_REACH), as
  // the character's send reads it.
  return Math.hypot(Number(source.x) - Number(target.x), Number(source.y) - Number(target.y)) <= SEND_REACH;
}

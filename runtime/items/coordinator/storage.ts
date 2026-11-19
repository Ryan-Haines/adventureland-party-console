// Storage: the bank snapshot and its one writer, the vaults, the bank queue, the
// BankBoi transactions and their completion, the staging row's cargo, the stack plan, the
// sort lease and the BankBoi character names. A count here is game data from rules.ts or
// a measured state.
import type { InventoryEntry, Item } from '../../coordinator/contracts/item.ts';
import { requestObject, requestText, type HttpRequest, type HttpResponse } from '../../lifecycle/api.ts';
import { craftProtection, writeIntents, type CraftReservationState, type MaterialOrder, type StorageAllocation } from './production.ts';
import { consumeReceipts, nextStackMerge, receiptList, sameStack, stackDepositPlan, type StackItem } from '../rules.ts';
import type { SettingsWrite, SettingsWriteResult } from '../../settings/api.ts';
import type { EnqueueAsk, EnqueueAnswer, MerchantWork, JobReason } from '../../merchant-jobs/api.ts';
import type { ItemsAnswer } from './routes/answer.ts';
import { type MerchantCommand, type MerchantEventState } from '../../merchant-jobs/api.ts';
import { gatheringCastActive, merchantEventReserved, merchantSlotCommand } from '../../merchant-jobs/coordinator/api.ts';
import { fresh } from '../../protocol/reports.ts';
import { writeSlot } from '../../status/api.ts';
import { bankboiPack, isBankboiPack, isInventoryPack, isVaultPack, stackKey, stackQuantity, storageKey } from '../identity.ts';
import { BASE_INVENTORY_SIZE, BANK_PACK_CELLS, BANK_ROW_CELLS, STAGING_FIRST, STAGING_PACK, stagingCell, bankStagingReserved, deleteWaitMs, failureClass, usableCopy, keyHeld, vaultAccess } from '../rules.ts';
import { entryMeta } from '../catalog-meta.ts';
import { goldTarget, protectedMerchantStorageStock } from './needs.ts';
import { receiveBankDeconstruction, type DeconstructionMark } from './market.ts';
import { receiveBankUpgrades } from './production.ts';
import type { UpgradeOffering } from '../rules.ts';
import { recordItems } from './records.ts';
import { partyHooks } from '../../hooks/index.ts';
import type { createRosterProjection } from '../../lifecycle/api.ts';
import { characterNameAllowed, CHARACTER_NAME_REFUSAL } from '../../lifecycle/api.ts';
import { hiddenValue } from '../../settings/coordinator/api.ts';
import { boundFired } from '../../status/coordinator/api.ts';

// ---------------------------------------------------------------------------------------------
// The saved storage records.

export interface BankSnapshot {
  [field: string]: unknown;
  seenAt?: number;
  gold?: number;
  packs?: Record<string, (InventoryEntry | null)[] | undefined>;
}
export interface BankboiInventory {
  name: string;
  items?: (InventoryEntry | null)[];
  slots?: Record<string, unknown>;
  gold?: number;
  state?: string;
  error?: unknown;
  // The failure code of the worker's last failure; `error` is its message.
  code?: unknown;
  seenAt?: number;
  createdAt?: number;
  unloadBlockedSignature?: unknown;
  // The worker's last settled completion receipt, `<worker>:<commandId>`. It is saved with
  // the worker and outlives the transaction, so a completion resent after the run ended or after a
  // restart counts once.
  receipt?: string;
}
/** A saved BankBoi bag may hold empty cells, as a character report does. */
export interface StoredBankboi extends BankboiInventory { [field: string]: unknown }
export interface WithdrawalRequest {
  [field: string]: unknown;
  pack: string;
  slot?: number;
  item?: Item | null;
}
export interface StorageReference extends InventoryEntry {
  pack?: string;
  bankPack?: string;
  bankSlot?: number;
  mailJobId?: string;
  craftJobId?: string;
  allocationId?: string;
  // A BankBoi's relocation names the bag cell it emptied (items/character/bank.ts:977).
  sourceSlot?: number;
  improvement?: string;
}
export interface StorageDeposit extends InventoryEntry { pack: string; slot: number; request: StorageReference }
export interface CargoRequest {
  id: string;
  pack: string;
  slot: number;
  item: Item;
  mode?: string;
  state?: string;
  bootstrap?: boolean;
  queuedAt?: number;
}
export interface StoredBankRequest extends CargoRequest { bankboi?: string; [field: string]: unknown }
export interface StorageTransaction<R> {
  id: string;
  bankboi: string;
  mode: 'provision' | 'retrieve' | 'store';
  phase: 'switching' | 'waiting-for-bankboi' | 'processing';
  slot: number;
  requestIds: string[];
  retrievals: R[];
  startedAt: number;
  commandId?: number;
  // The lifecycle owner's roster showed the worker starting or online for this
  // transaction.
  workerSeen?: boolean;
}
export interface SavedBankState {
  bankSnapshot?: BankSnapshot | null;
  bankbois?: Record<string, StoredBankboi> | null;
  bankboiQueue?: StoredBankRequest[] | null;
  bankboiTransaction?: StorageTransaction<WithdrawalRequest> | null;
  bankboiReservedMigrated?: unknown;
  withdrawals?: Record<string, WithdrawalRequest[]> | null;
  claimBanked?: import('./fates.ts').ClaimBanked | null;
}

// ---------------------------------------------------------------------------------------------
// The staging row. While a BankBoi exists, the last row of the second free vault (G bank_packs:
// `items0` and `items1` cost no gold) carries cargo between the merchant and its BankBois, so a
// BankBoi run moves at most one row of stacks.

const STAGING_CELLS = Array.from({ length: BANK_ROW_CELLS }, (_, index) => STAGING_FIRST + index);

// ---------------------------------------------------------------------------------------------
// One bank snapshot writer: a character's report and a BankBoi checkpoint replace the snapshot
// only when its content or its observer changes, then adopt the staging row's cargo and persist.

interface SnapshotState { bankSnapshot: BankSnapshot | null; bankObserver: string | null }
interface SnapshotPorts { now(): number; adoptReservedCargo(): void; persist(): void }
export function writeBankSnapshot(state: SnapshotState, observer: string, bank: Record<string, unknown>, ports: SnapshotPorts): boolean {
  const next = { ...bank, character: observer };
  const previous = state.bankSnapshot && { ...state.bankSnapshot };
  if (previous) delete previous.seenAt;
  const changed = state.bankObserver !== observer || JSON.stringify(previous) !== JSON.stringify(next);
  if (changed) {
    state.bankSnapshot = { ...next, seenAt: ports.now() };
    ports.adoptReservedCargo();
    ports.persist();
    recordItems({ decision: 'bankChanged', subject: 'bank', by: observer });
  }
  state.bankObserver = observer;
  return changed;
}

// A report that omits an unchanged bank gets the carried object back (`createInventoryCarry`); while
// that object wrote the current snapshot, the report changes nothing.
const consumed = new WeakMap<SnapshotState, { source: object; snapshot: BankSnapshot | null }>();
export interface BankReport { name: string; bank?: Record<string, unknown> | null }
export function consumeBankReport(body: BankReport, state: SnapshotState, ports: SnapshotPorts): void {
  if (!body.bank) {
    if (state.bankObserver === body.name) state.bankObserver = null;
    return;
  }
  const last = consumed.get(state);
  if (!(last && last.source === body.bank && last.snapshot === state.bankSnapshot && state.bankObserver === body.name)) {
    writeBankSnapshot(state, body.name, body.bank, ports);
    consumed.set(state, { source: body.bank, snapshot: state.bankSnapshot });
  }
  delete body.bank;
}

// Character scripts omit `items`, `slots` and `bank` while they match the revision this coordinator
// acknowledged (docs/efficiency.md, Inventory deltas). `complete` puts the carried fields back on the
// raw report before any reader sees it; the revision describes this coordinator process, so it
// stays out of the report.
const CARRIED_FIELDS = ['items', 'slots', 'bank'] as const;
export function createInventoryCarry() {
  const carried = new Map<string, { revision: string; fields: Partial<Record<(typeof CARRIED_FIELDS)[number], unknown>> }>();
  /** False when the report omits inventory this coordinator does not hold. */
  function complete(name: string, raw: Record<string, unknown>): boolean {
    const revision = typeof raw.inventoryRevision === 'string' ? raw.inventoryRevision : undefined;
    delete raw.inventoryRevision;
    if (Array.isArray(raw.items)) {
      if (revision === undefined) carried.delete(name);
      else carried.set(name, { revision, fields: Object.fromEntries(CARRIED_FIELDS.filter(field => Object.hasOwn(raw, field)).map(field => [field, raw[field]])) });
      return true;
    }
    if (revision === undefined) return true;
    const held = carried.get(name);
    if (held?.revision !== revision) return false;
    for (const field of CARRIED_FIELDS)
      if (Object.hasOwn(held.fields, field) && !Object.hasOwn(raw, field)) raw[field] = held.fields[field];
    return true;
  }
  /** The status response names the revision held for the character, if any. */
  function acknowledge(name: string, response: unknown): unknown {
    const revision = carried.get(name)?.revision;
    return revision === undefined ? response : { ...requestObject(response), inventoryRevision: revision };
  }
  return { complete, acknowledge };
}

// The vaults: read from the game's `bank_packs` at start and on a game data update; a report
// carrying `bankVaults` replaces them (owner.ts). The saved records load through saved-fields.ts
// `initialBankState` over the settings owner's `declared` read. A vault on the `bank_b` or `bank_u`
// floor needs that floor's key (G.items `bkey`, `ukey`).

interface DataPorts {
  read(path: string): string;
  evaluate(source: string, context: object, filename?: string): unknown;
  warn(details: { error: unknown }, message: string): void;
}
const FLOOR_KEYS: Record<string, { id: string; name: string } | undefined> = {
  bank_b: { id: 'bkey', name: 'The Bank Key' },
  bank_u: { id: 'ukey', name: 'The Bank Key' },
};
export function loadCoordinatorBankVaults(version: string | number, ports: DataPorts) {
  try {
    const source = ports.read('./game_files/' + version + '/old_common_functions.js');
    const match = source.match(/var bank_packs=(\{[\s\S]*?\});\s*var character_slots=/);
    if (!match) throw new Error('bank_packs definition was not found');
    const definitions = ports.evaluate('(' + match[1] + ')', Object.create(null)) as Record<string, [string, unknown, unknown]>;
    return Object.entries(definitions)
      .map(([pack, [floor, gold, shells]]) => ({ pack, floor, gold: Number(gold) || 0, shells: Number(shells) || 0, key: FLOOR_KEYS[floor] || null }))
      .sort((a, b) => Number(a.pack.replace(/\D/g, '')) - Number(b.pack.replace(/\D/g, '')));
  } catch (error) {
    ports.warn({ error }, 'Could not load bank-vault definitions');
    return [];
  }
}

// ---------------------------------------------------------------------------------------------
// The bank queue: a character's bank visit waits for the one before it. The command carries the
// character's marks and withdrawals as they stand at dispatch; an `upgrade` visit carries its
// upgrades, purchases and compounds instead. The merchant's visit is its job (08).

interface BankJob { name: string; type: string }
interface BankQueueState {
  bankCurrent: BankJob | null;
  bankQueue: BankJob[];
  bankStartedAt: number;
  location: unknown;
  commands: Record<string, unknown>;
  upgrades: Record<string, unknown>;
  purchases: Record<string, unknown>;
  compounds: Record<string, unknown>;
  marked: Record<string, unknown>;
  withdrawals: Record<string, unknown>;
  goldTargets: Record<string, unknown>;
}
export function createBankQueue(state: BankQueueState, ports: { now(): number; nextCommand(): number }) {
  // The next visit takes the slot through the status owner's table C writer. A refused write
  // leaves the job at the queue's head, and the next report's dispatch asks again once the
  // outranking command ends.
  function dispatch(): void {
    if (state.bankCurrent || !state.bankQueue.length) return;
    const job = state.bankQueue[0]!, name = job.name;
    const command = job.type === 'upgrade'
      ? { id: ports.nextCommand(), type: 'upgrade', items: state.upgrades[name] || [], purchases: state.purchases[name] || [],
        compounds: state.compounds[name] || [], returnLocation: state.location }
      : { id: ports.nextCommand(), type: 'bank', marked: state.marked[name] || [], withdrawals: state.withdrawals[name] || [],
        goldTarget: goldTarget(state.goldTargets, name), returnLocation: state.location };
    if (writeSlot(state.commands, name, command) === 'refused') return;
    state.bankQueue.shift();
    state.bankCurrent = job;
    state.bankStartedAt = ports.now();
  }
  function queue(names: string[], type = 'bank'): void {
    for (const name of names) {
      const matches = (job: BankJob | null) => job?.name === name && job.type === type;
      if (!matches(state.bankCurrent) && !state.bankQueue.some(matches)) state.bankQueue.push({ name, type });
    }
    dispatch();
  }
  return { queue, dispatch };
}

// ---------------------------------------------------------------------------------------------
// The staging row's cargo: while a BankBoi exists, a stack the merchant leaves in the staging row
// becomes a `store` request for a BankBoi, unless a job or a withdrawal takes that cell back out.
// A request whose cell no longer holds its stack, or that the merchant reserved, goes.

interface CargoState {
  bankbois?: Record<string, unknown> | null;
  merchantQueue?: { id: string; order?: { bank?: { pack: string; slot?: number }[] } }[];
  merchantCurrent?: { id: string; order?: { bank?: { pack: string; slot?: number }[] } } | null;
  bankSnapshot?: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
  bankboiQueue: CargoRequest[];
  bankboiReservedMigrated: boolean;
  withdrawals: Record<string, { pack: string; slot?: number }[] | undefined>;
}
/**
 * A bank visit holds the bank slot while its holder's reports show it present and
 * alive and its command slot still holds the visit's command. The command stays in every reply
 * until its receipt frees the slot, so a present holder with it is still running it. A holder that
 * died or went offline frees the slot. So does a command of a higher rank written over the visit:
 * the holder never runs the visit, and the visit returns to the queue's head.
 */
export type BankStall = 'holder-gone' | 'slot-taken' | null;
export function bankVisitStalled(state: { bankCurrent: { name: string; type: string } | null; statuses: Record<string, unknown>;
  commands?: Record<string, unknown> }, now: number): BankStall {
  const visit = state.bankCurrent;
  if (!visit) return null;
  const holder = state.statuses[visit.name] as { seenAt?: number; rip?: unknown } | undefined;
  if (!holder || !!holder.rip || !fresh(holder.seenAt, now, 'presence')) return 'holder-gone';
  return (state.commands?.[visit.name] as { type?: unknown } | undefined)?.type === visit.type ? null : 'slot-taken';
}

export function createReservedBankboiCargo(state: CargoState, ports: { now(): number; persist(): void }) {
  function reservedForRetrieval(slot: number): boolean {
    const cell = (entry: { pack: string; slot?: number }) => entry.pack === STAGING_PACK && entry.slot === slot;
    return [state.merchantCurrent, ...(state.merchantQueue || [])].some(job => job?.order?.bank?.some(cell)) ||
      Object.values(state.withdrawals).some(requests => (requests || []).some(cell));
  }
  function retain(request: CargoRequest, slots: (InventoryEntry | null)[]): boolean {
    if (!stagingCell(request.pack, request.slot)) return true;
    if (!bankStagingReserved(state) || reservedForRetrieval(request.slot)) return false;
    const item = slots[request.slot]?.item;
    return !!item && stackKey(item) === stackKey(request.item);
  }
  function adopt(slot: number, item: Item): boolean {
    const existing = state.bankboiQueue.find(request => request.pack === STAGING_PACK && request.slot === slot && stackKey(request.item) === stackKey(item));
    if (existing) {
      if (JSON.stringify(existing.item) === JSON.stringify(item)) return false;
      existing.item = item;
      return true;
    }
    const id = STAGING_PACK + ':' + slot + ':' + stackKey(item);
    if (state.bankboiQueue.some(request => request.id === id)) return false;
    state.bankboiQueue.push({ id, mode: 'store', pack: STAGING_PACK, slot, item, state: 'staged',
      bootstrap: !state.bankboiReservedMigrated, queuedAt: ports.now() });
    return true;
  }
  function reconcile(): boolean {
    const slots = state.bankSnapshot?.packs?.[STAGING_PACK], reserved = bankStagingReserved(state);
    if (reserved && !Array.isArray(slots)) return false;
    const previous = JSON.stringify(state.bankboiQueue);
    state.bankboiQueue = state.bankboiQueue.filter(request => retain(request, slots || []));
    let changed = previous !== JSON.stringify(state.bankboiQueue);
    if (reserved && Array.isArray(slots))
      for (const slot of STAGING_CELLS) {
        const item = slots[slot]?.item;
        if (item && !reservedForRetrieval(slot) && adopt(slot, item)) changed = true;
      }
    if (reserved && !state.bankboiReservedMigrated) {
      state.bankboiReservedMigrated = true;
      changed = true;
    }
    if (changed) ports.persist();
    return changed;
  }
  return { reconcile };
}

// ---------------------------------------------------------------------------------------------
// An exchange's shortages held by BankBois: whole-stack retrievals in storage order; a request
// already queued still counts as pending supply.

interface ExchangeLine { id: string; level?: number }
interface Shortage extends ExchangeLine { quantity: number }
export function queueExchangeStorage(exchanges: readonly ExchangeLine[], shortages: readonly Shortage[],
  workers: readonly { name: string; items?: readonly (InventoryEntry | null)[] }[], requests: WithdrawalRequest[]): boolean {
  const level = (line: { level?: unknown }) => Number(line.level) || 0;
  let pending = false;
  for (const shortage of shortages) {
    if (!exchanges.some(line => line.id === shortage.id && level(line) === level(shortage))) continue;
    let missing = Math.max(0, Number(shortage.quantity) || 0);
    for (const worker of workers) for (const entry of worker.items || []) {
      if (missing <= 0) break;
      if (!entry?.item || entry.item.name !== shortage.id || level(entry.item) !== level(shortage)) continue;
      const pack = bankboiPack(worker.name);
      if (!requests.some(request => request.pack === pack && request.slot === entry.slot)) requests.push({ pack, slot: entry.slot, item: entry.item });
      missing -= stackQuantity(entry.item);
      pending = true;
    }
  }
  return pending;
}

// ---------------------------------------------------------------------------------------------
// The visit's storage requests: an exchange's shortages and an offering's copies become withdrawal
// requests of the merchant's next visit. An offering takes vault copies before BankBoi
// stacks, and a cell already requested keeps its request across repeated asks and restarts.

type ExchangeArguments = Parameters<typeof queueExchangeStorage>;
interface StorageState {
  merchantCharacter: string | null;
  withdrawals: Record<string, ExchangeArguments[3]>;
  bankbois?: Record<string, ExchangeArguments[2][number]> | null;
}
export function createCoordinatorStorageService(state: StorageState, persist: () => void) {
  const requests = () => state.withdrawals[String(state.merchantCharacter)] ||= [];
  return {
    queueExchange(job: { exchanges?: ExchangeArguments[0] | null }, shortages?: ExchangeArguments[1] | null): boolean {
      const pending = queueExchangeStorage(job.exchanges || [], shortages || [], Object.values(state.bankbois || {}), requests());
      if (pending) persist();
      return pending;
    },
    queueOffering(offering: UpgradeOffering, quantity = 1): boolean {
      const queued = requests();
      let remaining = quantity, pending = false;
      const stock = protectedMerchantStorageStock(state)
        .filter(entry => entry.item?.name === offering && usableCopy(entry.item) && !isInventoryPack(entry.craftLocation))
        .sort((a, b) => Number(isBankboiPack(a.craftLocation)) - Number(isBankboiPack(b.craftLocation)));
      for (const entry of stock) {
        if (remaining <= 0) break;
        if (!queued.some(request => request.pack === entry.craftLocation && request.slot === entry.slot))
          queued.push({ pack: entry.craftLocation, slot: entry.slot, item: entry.item });
        remaining -= stackQuantity(entry.item);
        pending = true;
      }
      if (pending) persist();
      return pending;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The completion: a BankBoi run moves stacks between vaults and BankBoi bags, and the saved
// references (stand listings, NPC sale marks, upgrade marks, craft allocations, mail sources and
// withdrawal requests) follow their copy, matched by its storage key.

interface MailStorageJob { id: string; mail?: { source?: StorageReference }; order?: MaterialOrder; blockedOnBankboi?: boolean }
export interface StorageCompletionState {
  standListings: StorageReference[];
  npcSaleMarks: StorageReference[];
  merchantQueue: MailStorageJob[];
  withdrawals: Record<string, StorageReference[] | undefined>;
  merchantCharacter: string | null;
  upgrades?: Record<string, unknown[] | undefined>;
  compounds?: Record<string, { items?: { item?: Item; storage?: { pack: string; slot: number } }[] }[] | undefined>;
}
type PackKey = 'pack' | 'bankPack';
const slotKeyOf = (key: PackKey) => key === 'bankPack' ? 'bankSlot' as const : 'slot' as const;
export function createStorageReferenceUpdates(state: StorageCompletionState) {
  function relocated(character: string, moves: StorageReference[]): void {
    for (const move of moves) {
      for (const reference of [...state.standListings, ...state.npcSaleMarks]) {
        const packKey: PackKey = Object.hasOwn(reference, 'bankPack') ? 'bankPack' : 'pack';
        if (reference[packKey] === bankboiPack(character) && storageKey(reference.item) === storageKey(move.item)) {
          reference[packKey] = move.pack;
          reference[slotKeyOf(packKey)] = move.slot;
        }
      }
      // A manual compound selection made after the worker planned its unload follows the cell it
      // emptied, with its `manual compounds` withdrawal (relocateManual).
      if (typeof move.pack !== 'string' || !Number.isInteger(move.slot) || !Number.isInteger(move.sourceSlot)) continue;
      const from = { pack: bankboiPack(character), slot: move.sourceSlot, item: move.item }, to = { pack: move.pack, slot: move.slot! };
      followCompounds(from, to);
      for (const request of state.withdrawals[String(state.merchantCharacter)] || [])
        if (request.improvement === 'manual compounds' && sameCell(request, from)) Object.assign(request, to);
    }
  }
  type Cell = { pack?: unknown; slot?: unknown; item?: unknown };
  const sameCell = (reference: Cell, cell: Cell): boolean =>
    reference.pack === cell.pack && reference.slot === cell.slot && storageKey(reference.item) === storageKey(cell.item);
  // A manual compound's BankBoi copy follows the cell its copy moved to.
  function followCompounds(from: Cell, to: { pack: string; slot: number }): void {
    for (const group of state.compounds?.[String(state.merchantCharacter)] || []) for (const mark of group.items || [])
      if (mark.storage && sameCell({ ...mark.storage, item: mark.item }, from)) mark.storage = { ...to };
  }
  function removeRequest(withdrawals: StorageReference[], matches: (request: StorageReference) => boolean): void {
    const index = withdrawals.findIndex(matches);
    if (index >= 0) withdrawals.splice(index, 1);
  }
  function craftDeposit(deposit: StorageDeposit, withdrawals: StorageReference[]): void {
    const request = deposit.request;
    const job = state.merchantQueue.find(candidate => candidate.id === request.craftJobId);
    const allocation: StorageAllocation | undefined = job?.order?.storage?.find(entry => entry.allocationId === request.allocationId);
    if (allocation && !allocation.resolved) {
      if (!isVaultPack(deposit.pack) || !Number.isInteger(deposit.slot) || storageKey(allocation.item) !== storageKey(deposit.item) ||
        stackQuantity(deposit.item) < allocation.quantity) return;
      job!.order!.bank.push({ pack: deposit.pack, slot: deposit.slot, item: deposit.item!, quantity: allocation.quantity });
      allocation.resolved = true;
      job!.blockedOnBankboi = job!.order!.storage!.some(entry => !entry.resolved);
    }
    removeRequest(withdrawals, entry => entry.craftJobId === request.craftJobId && entry.allocationId === request.allocationId);
  }
  function mailDeposit(deposit: StorageDeposit, withdrawals: StorageReference[]): void {
    const job = state.merchantQueue.find(candidate => candidate.id === deposit.request.mailJobId);
    if (job?.mail) {
      job.mail.source = { pack: deposit.pack, slot: deposit.slot, item: deposit.item };
      job.blockedOnBankboi = false;
    }
    removeRequest(withdrawals, request => request.mailJobId === deposit.request.mailJobId);
  }
  function normalDeposit(deposit: StorageDeposit, withdrawals: StorageReference[]): void {
    const from = { pack: deposit.request.pack, slot: deposit.request.slot, item: deposit.item };
    const encoded = JSON.stringify(deposit.request), index = withdrawals.findIndex(request => JSON.stringify(request) === encoded);
    if (index >= 0) withdrawals[index] = { ...withdrawals[index], pack: deposit.pack, slot: deposit.slot, item: deposit.item };
    for (const [references, packKey] of [[state.standListings, 'bankPack'], [state.npcSaleMarks, 'pack']] as const)
      for (const reference of references) if (sameCell({ pack: reference[packKey], slot: reference[slotKeyOf(packKey)], item: reference.item }, from)) {
        reference[packKey] = deposit.pack;
        reference[slotKeyOf(packKey)] = deposit.slot;
      }
    writeIntents(state, String(state.merchantCharacter), marks => marks.map(raw => {
      const mark = requestObject(raw), storage = requestObject(mark.storage);
      return mark.storage && sameCell({ ...storage, item: mark.item }, from)
        ? { ...mark, storage: { ...storage, pack: deposit.pack, slot: deposit.slot } } : raw;
    }));
    // The group's job survives the deposit.
    followCompounds(from, { pack: deposit.pack, slot: deposit.slot });
  }
  function deposited(deposits: StorageDeposit[]): void {
    const withdrawals = state.withdrawals[String(state.merchantCharacter)] || [];
    for (const deposit of deposits) {
      if (deposit.request?.craftJobId) craftDeposit(deposit, withdrawals);
      else if (deposit.request?.mailJobId) mailDeposit(deposit, withdrawals);
      else normalDeposit(deposit, withdrawals);
    }
  }
  return { relocated, deposited };
}

// ---------------------------------------------------------------------------------------------
// The stack plan, from the bank snapshot and the BankBoi bags. A stack's limit is the item's
// `G.items[name].s` from the catalog. A partial stack is a home for more copies of its pile
// (`stackKey`); the vaults come first, then the BankBois by name, and the staging row is no home.

// A withdrawal request as the plan reads it: a vault cell or a BankBoi's bag, and its copy.
interface PlannedRequest { pack?: unknown; slot?: unknown; item?: Item | null }
interface PlanState {
  merchantCharacter: string | null;
  merchantCatalog?: unknown;
  bankSnapshot?: BankSnapshot | null;
  bankbois: Record<string, BankboiInventory>;
  withdrawals: Record<string, readonly PlannedRequest[] | undefined>;
  bankboiQueue?: { id: string; pack?: string; slot?: number; item?: Item | null; state?: string }[];
}
export interface StackHome { owner: string; item: Item; limit: number; room: number }
const stackLimit = (entry: InventoryEntry | null | undefined, catalog: unknown): number =>
  Number(entryMeta(catalog, entry as Parameters<typeof entryMeta>[1])?.definition?.s) || 1;
export function homes(bank: BankSnapshot | null | undefined, workers: Record<string, BankboiInventory> | null | undefined, catalog?: unknown): Record<string, StackHome> {
  const result: Record<string, StackHome> = {}, staging = bankStagingReserved({ bankbois: workers });
  const add = (entry: InventoryEntry | null | undefined, owner: string) => {
    const limit = stackLimit(entry, catalog);
    if (!entry?.item || limit <= 1 || stackQuantity(entry.item) >= limit) return;
    result[stackKey(entry.item)] ||= { owner, item: entry.item, limit, room: limit - stackQuantity(entry.item) };
  };
  Object.entries(bank?.packs || {}).sort(([a], [b]) => a.localeCompare(b))
    .forEach(([pack, entries]) => (entries || []).forEach((entry, slot) => { if (!staging || !stagingCell(pack, slot)) add(entry, 'bank'); }));
  Object.values(workers || {}).sort((a, b) => a.name.localeCompare(b.name)).forEach(worker => (worker.items || []).forEach(entry => add(entry, worker.name)));
  return result;
}
// A stack the merchant asked a BankBoi for stays where it is.
function requested(worker: BankboiInventory, item: Item, withdrawals: readonly PlannedRequest[]): boolean {
  return withdrawals.some(request => request.pack === bankboiPack(worker.name) && stackKey(request.item) === stackKey(item));
}
/** A BankBoi holds a stack whose pile has a home with room elsewhere. */
export function needsReconcile(worker: BankboiInventory, routes: Record<string, StackHome>, withdrawals: readonly PlannedRequest[]): boolean {
  return (worker.items || []).some(entry => {
    if (!entry?.item || requested(worker, entry.item, withdrawals)) return false;
    const home = routes[stackKey(entry.item)];
    return !!home && home.owner !== worker.name && home.room >= stackQuantity(entry.item);
  });
}
/** A BankBoi takes a stack whose pile it is home to, or any stack while its bag holds fewer copies
 *  than the game's base bag size, as v1.5.0 read it. A worker saved with no bag report has room. */
export function accepts(worker: BankboiInventory, request: { item?: Item | null }, routes: Record<string, StackHome>): boolean {
  const home = routes[stackKey(request.item)];
  if (home && home.owner !== 'bank' && home.room >= stackQuantity(request.item)) return home.owner === worker.name;
  return (worker.items || []).filter(Boolean).length < BASE_INVENTORY_SIZE;
}
export function storageSignature(state: { bankSnapshot?: unknown; withdrawals: unknown }, worker: BankboiInventory): string {
  return JSON.stringify(['normal-bank-unload-v1', (state.bankSnapshot as BankSnapshot | null)?.packs, worker.items, state.withdrawals]);
}
/** The moves that return a BankBoi's stacks to the vaults' free and partial cells. */
export function unloadPlan(state: PlanState, worker: BankboiInventory) {
  const withdrawals = Object.values(state.withdrawals || {}).flatMap(requests => requests || []);
  const staging = bankStagingReserved(state);
  const slots = Object.entries(state.bankSnapshot?.packs || {}).filter(([, entries]) => Array.isArray(entries))
    .flatMap(([pack, entries]) => Array.from({ length: BANK_PACK_CELLS }, (_, slot) => ({ pack, slot, item: entries![slot]?.item })))
    .filter(cell => !(staging && stagingCell(cell.pack, cell.slot)) && !withdrawals.some(request => request.pack === cell.pack && request.slot === cell.slot));
  const moves: { slot: number; item: Item; pack: string; bankSlot: number }[] = [];
  (worker.items || []).forEach((entry, slot) => {
    if (!entry?.item || requested(worker, entry.item, withdrawals)) return;
    const item = entry.item, plan = stackDepositPlan(item, stackLimit(entry, state.merchantCatalog), slots);
    if (plan.remaining || !plan.moves.length) return;
    // One source entry, with the room of every destination reserved so another source cannot spend it.
    moves.push({ slot, item, pack: plan.moves[0].pack, bankSlot: plan.moves[0].slot });
    for (const move of plan.moves) {
      const destination = slots.find(target => target.pack === move.pack && target.slot === move.slot)!;
      destination.item = { ...item, q: (destination.item ? stackQuantity(destination.item) : 0) + move.quantity };
    }
  });
  return moves;
}
/** The BankBoi run to start now: which worker, the staged stacks it takes and the stacks it returns. */
export function servicePlan(state: PlanState) {
  const withdrawals = state.withdrawals[String(state.merchantCharacter)] || [];
  const routes = homes(state.bankSnapshot, state.bankbois, state.merchantCatalog);
  const workers = Object.values(state.bankbois).sort((a, b) => Number(a.seenAt || 0) - Number(b.seenAt || 0));
  // An interrupted worker runs again at its next report, which renews its `seenAt`. A
  // worker whose run was interrupted resumes through the bank journal at its next report;
  // another failure waits for the player.
  const available = (entry: BankboiInventory) => entry.state === 'ready' || entry.state === 'error' && failureClass(entry.code) === 'interrupted';
  const reserved = (slot: number) => Object.values(state.withdrawals || {}).some(requests =>
    (requests || []).some(request => request.pack === STAGING_PACK && request.slot === slot));
  const staged = (state.bankboiQueue || []).filter(request => request.state === 'staged' && !reserved(Number(request.slot)));
  const row = state.bankSnapshot?.packs?.[STAGING_PACK];
  const freeCells = STAGING_CELLS.filter(slot => !row?.[slot]).length;
  // The merchant finishes its outbound handoff before a worker borrows its slot.
  if (STAGING_CELLS.some(slot => row?.[slot] && reserved(slot))) return null;
  // Staging drains first: retrievals need the same row.
  const candidate = workers.find(entry => entry.state === 'provisioning') ||
    workers.find(entry => available(entry) && staged.some(request => accepts(entry, request, routes))) ||
    workers.find(entry => available(entry) && freeCells > 0 && withdrawals.some(request => request.pack === bankboiPack(entry.name))) ||
    workers.find(entry => available(entry) && needsReconcile(entry, routes, withdrawals)) ||
    workers.find(entry => available(entry) && entry.unloadBlockedSignature !== storageSignature(state, entry) && unloadPlan(state, entry).length);
  if (!candidate) return null;
  return { candidate, routes,
    requests: staged.filter(request => accepts(candidate, request, routes)).slice(0, STAGING_CELLS.length),
    retrievals: withdrawals.filter(request => request.pack === bankboiPack(candidate.name)).slice(0, STAGING_CELLS.length) };
}

// The merchant's bag merge: the next merge of two partial stacks of a pile, never of a copy any
// record names, a locked or bound copy, or PvP-marked loot with unmarked loot (the game checks the
// marker's presence). The current job's copies are reserved like the queue's, so a job's own merge
// moves only the copies no operation names. A merge that fills the target without emptying the
// source needs a free cell for the split. The plan is made again from each bag it reads.
interface MergeState {
  merchantCharacter: string | null;
  merchantCatalog?: unknown;
  merchantCurrent?: unknown;
  bankboiTransaction?: unknown;
  // The records whose copies a merge leaves in place.
  marked?: unknown; merchantMarked?: unknown; upgrades?: unknown; compounds?: unknown; statScrolls?: unknown; withdrawals?: unknown;
  standListings?: unknown; npcSaleMarks?: unknown; deconstructionMarks?: unknown; merchantDeliveries?: unknown; merchantCargo?: unknown;
  merchantQueue?: unknown;
}
export interface MergeStatus {
  name?: string;
  items?: (InventoryEntry | null)[];
  upgradeInventoryBusy?: unknown;
  banking?: unknown;
  gatheringActive?: unknown;
  anniversaryState?: { busy?: unknown };
  rip?: unknown;
}
export interface Merge { from: number; to: number; source: Item; target: Item; quantity: number }
export function inventoryMergePlan(state: MergeState, status: MergeStatus | null | undefined): Merge | null {
  const merchant = String(state.merchantCharacter);
  // An upgrade, the tidy or a held lucky slot owns cells while the merchant reports
  // `upgradeInventoryBusy` (status/character/report.ts), so no merge is planned.
  if (!status || status.name !== merchant || state.bankboiTransaction || status.upgradeInventoryBusy || status.banking ||
    status.gatheringActive || status.anniversaryState?.busy || status.rip) return null;
  const reserved = new Set<string>();
  const reserve = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (typeof (value as { name?: unknown }).name === 'string') reserved.add((value as { name: string }).name);
    Object.values(value).forEach(reserve);
  };
  const field = (key: keyof MergeState) => requestObject(state[key]);
  [field('marked')[merchant], field('merchantMarked')[merchant], field('upgrades')[merchant], field('compounds')[merchant],
    field('statScrolls')[merchant], field('withdrawals')[merchant], state.standListings, state.npcSaleMarks,
    (Array.isArray(state.deconstructionMarks) ? state.deconstructionMarks : []).filter(mark => requestObject(mark).state !== 'complete'),
    state.merchantDeliveries, state.merchantCargo].forEach(reserve);
  // An exchange's rewards are counts it received, not copies a later step takes, so they reserve no
  // name and the rewards' partial stacks merge at each exchange step (reserveJob).
  [...(Array.isArray(state.merchantQueue) ? state.merchantQueue : []), state.merchantCurrent].forEach(job => {
    const { exchangeRewards: _rewards, ...work } = requestObject(job);
    reserve(work);
  });
  const entries = status.items || [], free = entries.filter(entry => !entry).length;
  // The stack size reads each copy's own definition first and the catalog second (entryMeta).
  const limits = new Map(entries.flatMap(entry => entry?.item ? [[entry.item, stackLimit(entry, state.merchantCatalog)] as const] : []));
  const limitOf = (item: Item) => limits.get(item)!;
  const partial = entries.filter((entry): entry is InventoryEntry & { item: Item } => {
    const item = entry?.item;
    return !!item && Number.isSafeInteger(entry!.slot) && usableCopy(item) && !reserved.has(String(item.name)) &&
      Number.isSafeInteger(item.q) && Number(item.q) > 0 && Number(item.q) < limitOf(item);
  });
  // Piles merge by sameStack (PvP, account-bound and past-title piles apart). A partial fill splits
  // into a free cell, so a bag with none plans only a whole merge and goes on past a pair it cannot
  // fill.
  const fits = (target: StackItem, source: StackItem) => sameStack(target, source) &&
    (free > 0 || stackQuantity(target) + stackQuantity(source) <= limitOf(target as Item));
  const next = nextStackMerge(partial.map(entry => ({ pack: 'inventory', slot: Number(entry.slot), item: entry.item as StackItem })),
    item => limitOf(item as Item), fits);
  return next && { to: next.target.slot, from: next.source.slot, target: next.target.item as Item, source: next.source.item as Item, quantity: next.quantity };
}

// BankBoi storage: one transaction at a time. The merchant's slot goes to the BankBoi, the
// BankBoi runs the plan, and the merchant gets its slot back at the completion receipt, by id
// (persisted). A transaction ends on its worker's own answer: its completion or failure at the
// completion route, or the lifecycle owner's roster reporting it failed or offline, or its reports
// going stale.

interface BankboiState<R> extends MerchantEventState {
  bankboiTransaction: StorageTransaction<R> | null;
  merchantCharacter: string | null;
  statuses: Record<string, ({ seenAt: number; gatheringPhase?: string; anniversaryState?: { busy?: boolean } } & { banking?: boolean }) | undefined>;
  merchantCurrent: { id: string; reason?: string } | null;
  bankbois: Record<string, BankboiInventory>;
  // The lifecycle owner's lifecycle record (runtime/lifecycle/api.ts
  // `Lifecycle`).
  lifecycle?: Record<string, string | undefined>;
  commands: Record<string, MerchantCommand | undefined>;
  merchantQueue?: { id: string }[];
  headlessSlots: (string | null)[];
  withdrawals: Record<string, WithdrawalRequest[]>;
  bankboiQueue: { id: string; [field: string]: unknown }[];
  nextCommandId: number;
  bankSnapshot: BankSnapshot | null;
  merchantCatalog?: unknown;
}
interface BankboiPorts<Block> {
  now(): number;
  stop(block: Block): Promise<unknown>;
  persistRoster(): void;
  persistBank(): void;
  collect(names: (string | null)[], reason: JobReason): unknown;
  log(message: string, level: 'info' | 'error' | 'success', details?: unknown): void;
  // The lifecycle owner's table D `merchant` row: while an update or the console Pause holds the
  // merchant, no BankBoi transaction starts.
  merchantHeld(): boolean;
}
export function createBankboiStorage<R extends WithdrawalRequest, Block extends { enabled?: boolean }>(
  state: BankboiState<R>, workers: Record<string, Block>, ports: BankboiPorts<Block>) {
  let switching = false, steamRelease = false;
  let starting: Promise<void> | null = null, restoring: Promise<void> | null = null;
  const merchantSlot = () => state.headlessSlots.indexOf(state.merchantCharacter);
  async function stop(name: string): Promise<void> {
    const block = workers[name];
    if (!block) return;
    block.enabled = false;
    await ports.stop(block);
  }
  function clearCommand(name: string): void {
    if (state.commands[name]?.type === 'bankboi-service') delete state.commands[name];
  }
  function interrupted(name: string): void {
    const worker = state.bankbois[name];
    if (worker) { worker.state = 'error'; worker.error = 'interrupted'; worker.code = 'interrupted'; }
  }
  // The merchant's slot is free to lend: its report is current, it holds no job, gather cast,
  // event reservation or anniversary errand.
  function ready(): boolean {
    const status = state.statuses[String(state.merchantCharacter)];
    return !!status && !gatheringCastActive(status, ports.now()) && fresh(status.seenAt, ports.now(), 'presence') &&
      !state.merchantCurrent && !merchantEventReserved(state, ports.now()) && !status.anniversaryState?.busy;
  }
  // A craft's BankBoi withdrawal goes with its job.
  function dropOrphanCraftRequests(): void {
    for (const [name, requests] of Object.entries(state.withdrawals)) {
      const retained = requests.filter(request => !request.craftJobId || state.merchantQueue?.some(job => job.id === request.craftJobId));
      if (retained.length === requests.length) continue;
      state.withdrawals[name] = retained;
      ports.persistBank();
    }
  }
  async function begin(): Promise<void> {
    if (switching || state.bankboiTransaction) return;
    dropOrphanCraftRequests();
    const plan = servicePlan(state);
    const merchant = state.merchantCharacter, index = merchantSlot();
    if (!plan || !ready() || !merchant || index < 0) return;
    switching = true;
    const active: StorageTransaction<R> = { id: 'bankboi-' + ports.now(), bankboi: plan.candidate.name,
      mode: plan.candidate.state === 'provisioning' ? 'provision' : plan.retrievals.length ? 'retrieve' : 'store',
      phase: 'switching', slot: index + 1, requestIds: plan.requests.map(request => request.id),
      retrievals: plan.retrievals as R[], startedAt: ports.now() };
    state.bankboiTransaction = active;
    ports.persistBank();
    recordItems({ decision: 'storage', subject: active.bankboi, by: 'T4', phase: 'started', mode: active.mode, id: active.id });
    try {
      state.headlessSlots[index] = null;
      ports.persistRoster();
      await stop(merchant);
      partyHooks().roster.assign(index + 1, plan.candidate.name);
      active.phase = 'waiting-for-bankboi';
      ports.persistBank();
      ports.log('Switched merchant slot to ' + plan.candidate.name + ' for overflow storage', 'info');
    } catch (error) {
      switching = false;
      state.bankboiTransaction = null;
      ports.persistBank();
      recordItems({ decision: 'storage', subject: active.bankboi, by: 'T4', phase: 'ended', code: 'start_failed', id: active.id });
      if (!state.headlessSlots[index]) partyHooks().roster.assign(index + 1, merchant);
      ports.log('Could not start bankboi storage cycle', 'error', error instanceof Error ? error.message : String(error));
    }
  }
  async function finish(active: StorageTransaction<R>): Promise<void> {
    if (state.bankboiTransaction !== active) return;
    await stop(active.bankboi);
    if (state.bankboiTransaction !== active || steamRelease) return;
    state.headlessSlots[active.slot - 1] = null;
    const merchant = state.merchantCharacter;
    if (merchant) partyHooks().roster.assign(active.slot, merchant);
    clearCommand(active.bankboi);
    state.bankboiTransaction = null;
    ports.persistBank();
    recordItems({ decision: 'storage', subject: active.bankboi, by: 'T4', phase: 'ended', code: 'complete', id: active.id });
    ports.log(merchant ? 'Bankboi storage cycle completed; merchant restored, stand return pending'
      : 'Bankboi storage cycle completed; slot released, no merchant selected', 'success', { bankboi: active.bankboi });
    switching = false;
    if ((state.withdrawals[String(merchant)] || []).some(request => !isBankboiPack(request.pack)))
      ports.collect([merchant], 'manual bank exchange');
  }
  function restore(active: StorageTransaction<R>): Promise<void> {
    if (steamRelease) return Promise.resolve();
    return restoring ||= finish(active).finally(() => { restoring = null; });
  }
  // Before the worker reports working, the lifecycle owner's roster decides: the transaction waits while the roster
  // shows the worker starting, and ends when the roster reports it failed, or offline once it was
  // seen starting or online. The kept bound `bankboiStartBoundMs` ends a start the game never
  // completes (a login that never answers, a realm that stays unresolved) and tells the status
  // owner's bound record.
  function abandoned(active: StorageTransaction<R>): boolean {
    const life = state.lifecycle?.[active.bankboi];
    if (active.phase !== 'processing') {
      if (life && life !== 'offline' && life !== 'failed') active.workerSeen = true;
      if (life === 'failed' || (life === 'offline' && !!active.workerSeen)) return true;
      const waited = ports.now() - active.startedAt;
      if (waited < hiddenValue('bankboiStartBoundMs')) return false;
      boundFired({ bound: 'bankboiStartBoundMs', owner: '10', subject: active.bankboi,
        state: { id: active.id, phase: active.phase, lifecycle: life ?? null, waited } });
      return true;
    }
    // A working BankBoi sorts vault cells and waits for bank packs without changing its bag, gold or
    // place, so only its completion, its roster state or its stale reports end the run.
    const status = state.statuses[active.bankboi];
    return life === 'failed' || life === 'offline' || !status || !fresh(status.seenAt, ports.now(), 'presence');
  }
  async function start(): Promise<void> {
    if (steamRelease || starting || restoring) return;
    const active = state.bankboiTransaction;
    if (active && abandoned(active)) {
      interrupted(active.bankboi);
      ports.log('Recovering abandoned BankBoi transaction', 'error', { bankboi: active.bankboi });
      recordItems({ decision: 'storage', subject: active.bankboi, by: 'T4', phase: 'ended', code: 'abandoned', id: active.id });
      await restore(active);
      return;
    }
    if (ports.merchantHeld()) return;
    await (starting = begin().finally(() => { starting = null; }));
  }
  // The roster's offline read and slot assignment are the lifecycle owner's.
  async function releaseForSteam(): Promise<void> {
    steamRelease = true;
    try {
      if (starting) await starting;
      if (restoring) await restoring;
      const active = state.bankboiTransaction;
      if (!active) return;
      await stop(active.bankboi);
      if (!await partyHooks().roster.offline(active.bankboi)) throw new Error('BankBoi is still stopping; its slot remains reserved');
      if (state.bankboiTransaction !== active) return;
      interrupted(active.bankboi);
      clearCommand(active.bankboi);
      if (state.headlessSlots[active.slot - 1] === active.bankboi) state.headlessSlots[active.slot - 1] = null;
      state.bankboiTransaction = null;
      switching = false;
      ports.persistRoster();
      ports.persistBank();
      recordItems({ decision: 'storage', subject: active.bankboi, by: 'T4', phase: 'ended', code: 'steam_login', id: active.id });
      ports.log('BankBoi storage paused for Steam login; pending items retained', 'info', { bankboi: active.bankboi });
    } finally { steamRelease = false; }
  }

  // The BankBoi's report: its bag, then its command once it first reports while the transaction
  // waits for it.
  function observe(report: { name: string; items?: (InventoryEntry | null)[]; slots?: unknown; gold?: number }): void {
    const worker = state.bankbois[report.name], active = state.bankboiTransaction;
    if (!worker) return;
    worker.items = Array.isArray(report.items) ? report.items : worker.items || [];
    worker.slots = requestObject(report.slots);
    worker.gold = Number(report.gold) || 0;
    worker.seenAt = ports.now();
    if (!active || active.bankboi !== report.name || active.phase !== 'waiting-for-bankboi' || state.commands[report.name]) return;
    const withdrawals = Object.values(state.withdrawals).flat();
    active.commandId = state.nextCommandId++;
    worker.state = 'working';
    worker.error = null;
    worker.code = null;
    merchantSlotCommand(state, 'storage', { id: active.commandId, type: 'bankboi-service', provision: active.mode === 'provision',
      requests: state.bankboiQueue.filter(request => active.requestIds.includes(request.id)), retrievals: active.retrievals || [],
      unload: true, protectedItems: withdrawals.filter(request => request.pack === bankboiPack(report.name)).map(request => request.item),
      reservedLocations: withdrawals.filter(request => !isBankboiPack(request.pack)),
      stackHomes: homes(state.bankSnapshot, state.bankbois, state.merchantCatalog) }, report.name);
    active.phase = 'processing';
    ports.persistBank();
  }
  return { start, restore, releaseForSteam, observe, busy: () => switching || steamRelease || !!restoring };
}

// The BankBoi routes: the merchant's checkpoint writes its bank through the one snapshot writer, and the worker's
// completion records its bag, the moved references and the receipt, then hands the slot back.
interface CompletionBody {
  character: string;
  error?: unknown;
  code?: unknown;
  items?: (InventoryEntry | null)[];
  slots?: Record<string, unknown>;
  gold?: unknown;
  bank?: Record<string, unknown>;
  relocated?: StorageReference[];
  completed?: string[];
  deposited?: StorageDeposit[];
}
interface StorageRouteState<Transaction> extends StorageCompletionState, SnapshotState {
  merchantCatalog?: unknown;
  bankbois: Record<string, BankboiInventory>;
  bankboiTransaction: Transaction | null;
  bankboiQueue: { id: string; bankboi?: string }[];
  commands: Record<string, unknown>;
}
interface StorageRoutePorts<Transaction> extends Omit<SnapshotPorts, 'adoptReservedCargo'> {
  log(message: string, level: string, details?: unknown): void;
  adopt(): void;
  persistJobs?(): void;
  restore(transaction: Transaction): Promise<void>;
}
export function createBankboiStorageRoutes<Transaction extends { bankboi: string; commandId?: number }>(
  state: StorageRouteState<Transaction>, ports: StorageRoutePorts<Transaction>) {
  const references = createStorageReferenceUpdates(state);
  const snapshotPorts: SnapshotPorts = { now: ports.now, adoptReservedCargo: ports.adopt, persist: ports.persist };
  const observeBank = (body: CompletionBody): boolean => !!body.bank?.packs && (writeBankSnapshot(state, body.character, body.bank, snapshotPorts), true);
  function checkpoint(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body);
    if (body.character !== state.merchantCharacter || !requestObject(body.bank).packs)
      return res.status(400).json({ error: 'merchant bank snapshot required' });
    observeBank(body as unknown as CompletionBody);
    return res.json({ ok: true, pending: !!servicePlan(state) });
  }
  function recordWorker(body: CompletionBody, entry: BankboiInventory): void {
    entry.items = Array.isArray(body.items) ? body.items : entry.items || [];
    entry.slots = body.slots || entry.slots || {};
    if (body.gold !== undefined) entry.gold = Number(body.gold) || 0;
    entry.seenAt = ports.now();
    if (!body.error) { entry.error = null; entry.code = null; entry.state = 'ready'; }
    references.relocated(body.character, body.relocated || []);
    if (body.relocated?.length)
      ports.log('Returned ' + body.relocated.length + ' BankBoi inventory stacks to normal bank storage', 'success', { bankboi: body.character });
    entry.unloadBlockedSignature = !Array.isArray(body.relocated) || body.relocated.length || body.error ? null : storageSignature(state, entry);
    const completed = new Set(body.completed || []);
    state.bankboiQueue = state.bankboiQueue.filter(request => !completed.has(request.id));
    references.deposited(body.deposited || []);
    // A relocation or a craft or manual compound deposit changes the saved jobs
    // (persistCraftDeposits).
    if (body.relocated?.length || (body.deposited || []).some(deposit => deposit.request?.craftJobId || deposit.request?.improvement === 'manual compounds'))
      ports.persistJobs?.();
  }
  function complete(req: HttpRequest, res: HttpResponse): unknown {
    const raw = requestObject(req.body), transaction = state.bankboiTransaction;
    const receipt = raw.commandId === undefined ? '' : requestText(raw.character) + ':' + requestText(raw.commandId);
    if (receipt && state.bankbois[requestText(raw.character)]?.receipt === receipt) return res.json({ ok: true, duplicate: true });
    if (!transaction || transaction.bankboi !== raw.character || (transaction.commandId !== undefined && raw.commandId !== transaction.commandId))
      return res.status(409).json({ error: 'bankboi does not own the storage transaction' });
    const body = raw as unknown as CompletionBody, entry = state.bankbois[body.character]!;
    if (body.error) {
      entry.state = 'error';
      entry.error = body.error;
      entry.code = body.code;
      ports.log('Bankboi storage failed', 'error', { bankboi: body.character, error: body.error, code: body.code });
    }
    if (receipt) entry.receipt = receipt;
    // The worker's bank goes through the one snapshot writer first, so its blocked unload signature reads the bank the run left.
    observeBank(body);
    recordWorker(body, entry);
    delete state.commands[body.character];
    ports.persist();
    const response = res.json({ ok: true });
    ports.restore(transaction).catch(error =>
      ports.log('Merchant restoration after bankboi failed', 'error', requestText(requestObject(error).message || error)));
    return response;
  }
  return { checkpoint, complete };
}

// ---------------------------------------------------------------------------------------------
// The sort: in `request` mode a sort request is a lease one merchant visit settles; a lease
// belongs to one runtime and visit and moves to no other runner. In `automatic` mode every visit
// sorts. The packed layout is the character half's.

export interface BankSortRequest {
  id: string;
  requestedAt: number;
  status: 'queued' | 'sorting' | 'retry';
  runtime?: string;
  visit?: string;
  message?: string;
}
export interface BankSortState {
  bankbois?: Record<string, unknown> | null;
  bankSortMode?: 'automatic' | 'request';
  bankSortRequest?: BankSortRequest | null;
  merchantCharacter: string | null;
}
interface SortPorts {
  persist(): void;
  runtime?(name: string): string | undefined;
  write(batch: SettingsWrite): SettingsWriteResult;
}
/** A lease saved while sorting becomes a retry at start, since its runtime is gone. */
export function initialBankSort(saved: BankSortState | Partial<BankSortState>) {
  const bankSortMode = saved.bankSortMode === 'request' ? 'request' : 'automatic';
  const pending = bankSortMode === 'request' ? saved.bankSortRequest : null;
  return { bankSortMode: bankSortMode as 'request' | 'automatic',
    bankSortRequest: pending ? { ...pending, status: pending.status === 'sorting' ? 'retry' as const : pending.status, runtime: undefined, visit: undefined } : null };
}
function claim(pending: BankSortRequest, body: Record<string, unknown>): boolean {
  if (body.action !== 'claim' || typeof body.visit !== 'string' || typeof body.runtime !== 'string' || !Number.isFinite(body.enteredAt)) return false;
  if (Number(body.enteredAt) <= pending.requestedAt && pending.status !== 'retry') return false;
  Object.assign(pending, { runtime: body.runtime, visit: body.visit, status: 'sorting', message: undefined });
  recordItems({ decision: 'sortLease', subject: 'bank', by: 'T7', phase: 'taken', id: pending.id });
  return true;
}
function updatePending(state: BankSortState, body: Record<string, unknown>): boolean {
  const pending = state.bankSortRequest;
  if (!pending) return false;
  let changed = false;
  if (pending.runtime && pending.runtime !== body.runtime) {
    Object.assign(pending, { status: 'retry', runtime: undefined, visit: undefined, message: 'Merchant restarted; retry pending' });
    changed = true;
  }
  if (claim(pending, body)) return true;
  if (pending.id !== body.id || pending.runtime !== body.runtime || pending.visit !== body.visit) return changed;
  if (body.action === 'complete') {
    state.bankSortRequest = null;
    recordItems({ decision: 'sortLease', subject: 'bank', by: 'T7', phase: 'settled', id: pending.id });
    return true;
  }
  if (body.action === 'retry') {
    pending.status = 'retry';
    pending.message = typeof body.message === 'string' ? body.message.slice(0, 300) : 'Interrupted; retry on next visit';
    // A pass that ended on a swap the game did not confirm names it in the ring.
    recordItems({ decision: 'sortLease', subject: 'bank', by: 'T7', phase: 'retry', id: pending.id,
      ...(typeof body.code === 'string' ? { code: body.code } : {}) });
    return true;
  }
  return changed;
}
/**
 * A sorting lease whose merchant runtime changed becomes a retry. owner.ts runs it on each merchant
 * report, which carries the runtime, so the lease settles on the report that shows the change.
 */
export function settleSortLease(state: BankSortState, runtime: string | undefined): boolean {
  const pending = state.bankSortRequest;
  if (!pending || pending.status !== 'sorting' || pending.runtime === runtime) return false;
  pending.status = 'retry';
  pending.message = 'Merchant interrupted; retry on next visit';
  return true;
}
// An add-on's `items.bankLayout` orders the floor's cells, and the sort
// fills them in that order with the packed layout's copies. The answer must name every cell the
// merchant sent once and no other; any other answer is refused (kept with the add-on's errors) and
// the sort fills the cells in their own order, today's packed layout.
export function bankLayout(floor: string, cells: readonly unknown[]): { pack: string; slot: number }[] | null {
  const view = cells.map(cell => requestObject(cell)).filter(cell => typeof cell.pack === 'string' && Number.isSafeInteger(cell.slot))
    .map(cell => ({ pack: String(cell.pack), slot: Number(cell.slot), item: cell.item ?? null }));
  const asked = partyHooks().itemRules.layout({ floor, items: view });
  if (!asked) return null;
  const key = (cell: { pack?: unknown; slot?: unknown }) => String(cell?.pack) + ':' + String(cell?.slot);
  const floorCells = new Set(view.map(key)), order = Array.isArray(asked.answer) ? asked.answer : [];
  if (order.length !== view.length || new Set(order.map(key)).size !== view.length || !order.every(cell => floorCells.has(key(cell)))) {
    partyHooks().itemRules.refused(asked.addon, 'items.bankLayout', 'the layout names a slot outside the floor ' + floor + ' or misses one');
    return null;
  }
  return order.map(cell => ({ pack: cell.pack, slot: cell.slot }));
}

export function createBankSortRoutes(state: BankSortState & CraftReservationState & { withdrawals?: Record<string, { pack?: string; slot?: number }[]> }, ports: SortPorts) {
  function configure(req: HttpRequest, res: HttpResponse) {
    const body = requestObject(req.body);
    if (!(body.mode === undefined || body.mode === 'automatic' || body.mode === 'request') || !(body.enabled === undefined || typeof body.enabled === 'boolean'))
      return res.status(400).json({ error: 'invalid bank sort setting' });
    // The mode is a setting, written through the settings writer; the pending request is the items
    // owner's record.
    if (body.mode === 'request' || body.mode === 'automatic') {
      const written = ports.write({ by: 'dashboard:bank-sort', changes: [{ field: 'bankSortMode', value: body.mode }] });
      if (!written.ok) return res.status(400).json({ error: written.error });
    }
    if (state.bankSortMode !== 'request' || body.enabled === false) state.bankSortRequest = null;
    else if (body.enabled === true && !state.bankSortRequest) state.bankSortRequest = { id: globalThis.crypto.randomUUID(), requestedAt: Date.now(), status: 'queued' };
    ports.persist();
    return res.json({ ok: true });
  }
  function checkpoint(req: HttpRequest, res: HttpResponse) {
    const body = requestObject(req.body);
    if (typeof body.character !== 'string' || typeof body.runtime !== 'string' || body.runtime !== ports.runtime?.(body.character))
      return res.status(409).json({ error: 'merchant runtime is no longer current' });
    if (body.action === 'stack') {
      const protection = craftProtection(state);
      return res.json({ protection: { staging: bankStagingReserved(state),
        locations: Object.values(state.withdrawals || {}).flat().map(({ pack, slot }) => ({ pack, slot })),
        items: protection.requirements.map(need => ({ name: need.id, level: need.level })),
        ...(protection.error ? { error: protection.error } : {}) } });
    }
    if (body.character !== state.merchantCharacter) return res.json({ mode: state.bankSortMode || 'automatic', pending: null });
    if (body.action === 'layout') return res.json({ layout: bankLayout(requestText(body.floor), Array.isArray(body.cells) ? body.cells : []) });
    if (updatePending(state, body)) ports.persist();
    return res.json({ mode: state.bankSortMode || 'automatic', pending: state.bankSortRequest || null });
  }
  return { configure, checkpoint };
}

// The BankBoi characters (moved from characters/creation.ts): a creation is confirmed before
// another name or worker is tried.
type AccountSnapshot = Record<string, unknown> & ReturnType<Parameters<typeof createRosterProjection>[1]>;
interface CreationReply {
  ok: boolean;
  statusText: string;
  payload: unknown;
}
export interface CharacterCreationPorts {
  request(name: string, characterClass: string, look: number): Promise<CreationReply>;
  adopt(snapshot: AccountSnapshot): void;
  owned(name: string): unknown;
  refresh(): Promise<unknown>;
}

function messages(payload: unknown): Record<string, unknown>[] {
  const entries = Array.isArray(payload) ? payload : requestObject(payload).infs;
  return Array.isArray(entries) ? entries.map(requestObject) : [];
}

function failedResult(payload: unknown): Record<string, unknown> | null {
  if (Array.isArray(payload)) return null;
  const body = requestObject(payload),
    result = requestObject(body.result || body.response || body);
  return result.failed || result.success === false || result.reason ? result : null;
}

function preferredMessage(details: Record<string, unknown> | null | undefined, preferReason: boolean): unknown {
  return preferReason ? details?.reason || details?.message : details?.message || details?.reason;
}

function failureReason(reply: CreationReply, entries: Record<string, unknown>[], preferReason: boolean): unknown {
  const failure = entries.find(entry => entry.type === 'ui_error' || entry.type === 'error' || entry.reason);
  const result = failedResult(reply.payload);
  if (reply.ok && !failure && !result) return null;
  const details = failure || result;
  const message = preferredMessage(details, preferReason);
  return message || reply.statusText || 'creation failed';
}

/** Confirm an accepted creation before another name or worker can be attempted. */
export function createCharacterCreation(ports: CharacterCreationPorts) {
  async function confirm(name: string, entries: Record<string, unknown>[]): Promise<unknown> {
    const snapshot = entries.find(
      (entry): entry is AccountSnapshot =>
        entry.type === 'servers_and_characters' && Array.isArray(entry.characters),
    );
    if (snapshot) ports.adopt(snapshot);
    // The creation ends at the API's answer or when the roster shows the name. A reply without
    // the roster asks the account once, and that answer decides.
    if (!ports.owned(name)) await ports.refresh();
    return ports.owned(name);
  }
  async function create(name: string, characterClass: string, look: number, preferReason = false) {
    const reply = await ports.request(name, characterClass, look),
      entries = messages(reply.payload);
    const failure = failureReason(reply, entries, preferReason);
    if (failure) return { accepted: false, confirmed: false, error: failure };
    return { accepted: true, confirmed: await confirm(name, entries), error: null };
  }
  // The search walks the names the game allows, at most 12 characters (characterNameAllowed),
  // and goes past a name only on the game's own "name taken" answer.
  async function bankboi(prefix: string): Promise<string> {
    let lastReason = 'no available Bankboi name';
    for (let number = 0; number < 10 ** (12 - prefix.length); number++) {
      const name = prefix + number;
      if (ports.owned(name)) continue;
      const result = await create(name, 'merchant', 0, true);
      if (!result.accepted) {
        lastReason = requestText(result.error);
        if (/name|used|exist/i.test(lastReason)) continue;
        throw new Error(lastReason);
      }
      if (!result.confirmed)
        throw new Error(
          'Adventure Land accepted the request, but the account roster did not confirm ' +
            name +
            '. No additional name was attempted.',
        );
      return name;
    }
    throw new Error(lastReason);
  }
  return { create, bankboi };
}

// ---------------------------------------------------------------------------------------------
// A vault unlock: a gold vault opens on an accessible floor, a floor opens with a key the
// merchant or the bank holds, and one unlock job runs at a time.

export interface Vault {
  pack: string;
  floor: string;
  gold: number;
  key?: { id: string } | null;
}
export interface UnlockState {
  merchantCharacter: string | null;
  bankVaults?: Vault[];
  bankSnapshot?: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
  statuses: Record<string, { items?: (InventoryEntry | null)[] } | undefined>;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
}
export interface UnlockPorts {
  now(): number;
  nextCommand(): number;
  enqueue(ask: EnqueueAsk): EnqueueAnswer;
  publicJob(job: MerchantWork): unknown;
  log(message: string, level: string, details: unknown): void;
  persist(): void;
  dispatch(): void;
}
export function createVaultUnlock(state: UnlockState, ports: UnlockPorts) {
  function access(vault: Vault, kind: unknown): ItemsAnswer | null {
    const packs = state.bankSnapshot?.packs || {};
    const accessible = vaultAccess(state.bankVaults || [], packs, vault.floor);
    const key = vault.key && vault.key.id;
    if (!accessible && kind !== 'key')
      return { status: 409, body: { error: 'unlock the bank floor first', key } };
    if (kind === 'key') {
      if (!key) return { status: 400, body: { error: 'this floor has no access key' } };
      if (!keyHeld(state.statuses[String(state.merchantCharacter)]?.items, packs, key)) return { status: 409, body: { error: 'required bank key is not owned', key } };
    } else if (!vault.gold) return { status: 409, body: { error: 'this vault opens with floor access' } };
    return null;
  }
  // The answer is the merchant job owner's queued job, with its priority; the
  // merchant job owner's refusal refuses the route.
  function queue(vault: Vault, kind: unknown): ItemsAnswer {
    const job: MerchantWork & { reason: JobReason } = {
      id: 'merchant-' + ports.now() + '-' + ports.nextCommand(),
      target: state.merchantCharacter,
      reason: 'bank unlock',
      pack: vault.pack,
      floor: vault.floor,
      gold: kind === 'key' ? 0 : vault.gold,
      key: kind === 'key' ? vault.key?.id : null,
      queuedAt: ports.now(),
    };
    const answer = ports.enqueue({ reason: job.reason, target: job.target, fields: job });
    if (answer.startsWith('refused:')) return { status: 409, body: { error: answer.slice('refused:'.length) } };
    const id = answer.startsWith('merged:') ? answer.slice('merged:'.length) : job.id;
    ports.log(kind === 'key' ? 'Bank floor unlock queued' : 'Bank vault unlock queued', 'info', {
      floor: vault.floor,
      pack: vault.pack,
      key: job.key,
      gold: job.gold,
    });
    ports.persist();
    ports.dispatch();
    // The merchant job owner's answer names a job in its queue or its current
    // slot.
    const queued = [state.merchantCurrent, ...state.merchantQueue].find(entry => entry?.id === id)!;
    return { body: { ok: true, job: ports.publicJob(queued) } };
  }
  return function unlock(pack: unknown, kind: unknown): ItemsAnswer {
    if (!state.merchantCharacter) return { status: 409, body: { error: 'no merchant is configured' } };
    const vault = (state.bankVaults || []).find(entry => entry.pack === pack);
    if (!vault) return { status: 400, body: { error: 'unknown bank vault' } };
    if (Object.hasOwn(state.bankSnapshot?.packs || {}, vault.pack)) return { status: 409, body: { error: 'bank vault is already unlocked' } };
    const failure = access(vault, kind);
    if (failure) return failure;
    if ([state.merchantCurrent, ...state.merchantQueue].some(job => job?.reason === 'bank unlock'))
      return { status: 409, body: { error: 'a bank unlock is already queued' } };
    return queue(vault, kind);
  };
}

// A bank visit's receipts become the `items.banked` and `items.withdrawn` notices, one per copy
// the visit moved, where the receipt lands: the bank queue's for a fighter's bank slot, the merchant jobs owner's job completion
// for the merchant's errands.
export function recordBankReceipts(subject: string, by: string, receipts: { banked?: unknown; withdrawn?: unknown }): void {
  for (const [decision, list] of [['banked', receipts.banked], ['withdrawn', receipts.withdrawn]] as const)
    for (const raw of Array.isArray(list) ? list : []) {
      const receipt = requestObject(raw), item = requestObject(receipt.item ?? raw);
      recordItems({ decision, subject, by, item: item.name, quantity: Number(item.q) || 1 });
    }
}

// ---------------------------------------------------------------------------------------------
// A bank visit's receipt: the bank slot's holder reports what it withdrew, upgraded, bought
// and compounded, which consumes the matching requests and frees the bank slot.

export interface BankReceiptState {
  merchantCharacter?: string | null;
  deconstructionMarks?: DeconstructionMark[];
  commands: Record<string, { id?: unknown; type: string } | undefined>;
  withdrawals: Record<string, unknown[] | undefined>;
  upgrades: Record<string, unknown[] | undefined>;
  purchases: Record<string, unknown[] | undefined>;
  compounds: Record<string, { id: unknown }[] | undefined>;
  bankCurrent: { name: string } | null;
  bankStartedAt: number;
}
export interface BankReceiptPorts {
  persist(): void;
  persistBank(): void;
  dispatchBank(): void;
}
export function createBankReceipt(state: BankReceiptState, ports: BankReceiptPorts) {
  function improvements(name: string, body: Record<string, unknown>): void {
    const upgraded = receiptList(body.upgraded),
      purchased = receiptList(body.purchased),
      compounded = receiptList(body.compounded);
    consumeReceipts(state.upgrades[name], upgraded);
    consumeReceipts(state.purchases[name], purchased);
    const compounds = state.compounds[name] || [];
    for (const id of compounded) {
      const index = compounds.findIndex(group => group.id === id);
      if (index >= 0) compounds.splice(index, 1);
    }
    if (upgraded.length || purchased.length || compounded.length) ports.persist();
  }
  return function bank(body: Record<string, unknown>): ItemsAnswer {
    if (!state.bankCurrent || body.character !== state.bankCurrent.name)
      return { status: 409, body: { error: 'character does not own the bank slot' } };
    const name = state.bankCurrent.name,
      withdrawn = receiptList(body.withdrawn);
    receiveBankDeconstruction({ ...state, merchantCharacter: state.merchantCharacter || null }, name, withdrawn, Date.now());
    receiveBankUpgrades(state, name, withdrawn);
    if (state.deconstructionMarks?.length) ports.persist();
    consumeReceipts(state.withdrawals[name], withdrawn);
    recordBankReceipts(name, 'T3', { banked: body.banked, withdrawn });
    if (withdrawn.length) ports.persistBank();
    improvements(name, body);
    if (['bank', 'upgrade'].includes(state.commands[name]?.type || '')) delete state.commands[name];
    state.bankCurrent = null;
    state.bankStartedAt = 0;
    ports.dispatchBank();
    return { body: { ok: true } };
  };
}

// The merchant's stack merge: the merchant's bag merge asks for each next merge with its live
// bag. The answer is the plan for that bag, or none while the merchant's report is stale or the
// anniversary or a BankBoi transaction holds its bag.
export interface MergePermissionState {
  merchantCharacter: string | null;
  statuses: Record<string, { seenAt?: number } | undefined>;
}
export interface MergePermissionPorts {
  now(): number;
  anniversary(): { reserved?: unknown; busy?: unknown };
  bankboiBusy(): boolean;
  // The next merge of the bag the merchant sent (`inventoryMergePlan`).
  plan(items: (InventoryEntry | null)[]): Merge | null;
}
// The merchant's bag as items/character/bank.ts:1173 sends it: each cell empty or a copy at its slot.
function bagEntry(cell: unknown): cell is InventoryEntry | null {
  if (cell === null) return true;
  const entry = requestObject(cell);
  return Number.isSafeInteger(entry.slot) && !!entry.item && typeof entry.item === 'object';
}
export function createMergePermission(state: MergePermissionState, ports: MergePermissionPorts) {
  function permitted(body: Record<string, unknown>): boolean {
    const merchant = state.merchantCharacter,
      status = state.statuses[String(merchant)],
      anniversary = ports.anniversary();
    return (
      body.character === merchant &&
      fresh(status?.seenAt, ports.now(), 'presence') &&
      !anniversary.reserved &&
      !anniversary.busy &&
      !ports.bankboiBusy()
    );
  }
  return function merge(body: Record<string, unknown>): ItemsAnswer {
    const items = Array.isArray(body.items) && body.items.every(bagEntry) ? body.items : null;
    return { body: { merge: permitted(body) && items ? ports.plan(items) : null } };
  };
}

// The BankBoi characters' routes' decisions: a delete runs on an empty, idle
// BankBoi the account roster still holds; a creation stays inside the included slots.

export interface AccountResponse { ok: boolean; statusText: string; json(): Promise<unknown> }
export type AccountFetch = (url: string, options: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<AccountResponse>;
export interface AccountRequestPorts { session: string | undefined; loadFetch(): Promise<AccountFetch> }
/**
 * The one authenticated request to the game's account API (`/api/<method>`) that the items owner's
 * character creation, BankBoi deletion and mail send. A request ends on its reply, on the fetch's
 * own failure, or at the kept bound `mailRequestBoundMs` when the game never answers; a firing tells
 * the status owner's bound record and the request fails as on any fetch failure.
 */
export async function accountRequest(ports: AccountRequestPorts, method: string, body: unknown): Promise<AccountResponse> {
  const signal = AbortSignal.timeout(hiddenValue('mailRequestBoundMs'));
  try {
    return await (await ports.loadFetch())('https://adventure.land/api/' + method, {
      method: 'POST', headers: { Cookie: 'auth=' + ports.session, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body), signal,
    });
  } catch (error) {
    if (signal.aborted) boundFired({ bound: 'mailRequestBoundMs', owner: '10', subject: method, state: { method } });
    throw error;
  }
}

/** The account roster's refresh (caracal's `updateInfo`), which sends its request with no bound of
 *  its own, held to the account API's kept bound like `accountRequest`: a reply that never comes
 * tells the status owner's bound record and fails the refresh, so no creation or deletion waits on it forever. */
export function accountRefresh(update: () => Promise<unknown>, later: (action: () => void, ms: number) => unknown): Promise<unknown> {
  const ms = hiddenValue('mailRequestBoundMs');
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (end: () => void) => { if (!settled) { settled = true; end(); } };
    later(() => settle(() => {
      boundFired({ bound: 'mailRequestBoundMs', owner: '10', subject: 'servers_and_characters', state: { method: 'servers_and_characters', ms } });
      reject(Error('The account roster did not answer within ' + ms + ' ms'));
    }), ms);
    update().then(value => settle(() => resolve(value)), error => settle(() => reject(error)));
  });
}

export interface DeletionState {
  bankbois: Record<string, BankboiInventory | undefined>;
  bankboiQueue: { bankboi?: string }[];
  bankboiTransaction: { bankboi: string } | null;
}
export interface DeletionPorts {
  now(): number;
  request(name: string): Promise<{ ok: boolean; statusText: string; payload: unknown }>;
  refresh(): Promise<unknown>;
  owned(name: string): unknown;
  persist(): void;
}

function occupied(entry: BankboiInventory): boolean {
  return !!(entry.items || []).some(Boolean) || !!Object.keys(entry.slots || {}).length || !!Number(entry.gold);
}
function pending(state: DeletionState, name: string): boolean {
  return state.bankboiQueue.some(request => request.bankboi === name) || state.bankboiTransaction?.bankboi === name;
}
function failureMessage(messages: unknown): Record<string, unknown> | undefined {
  return Array.isArray(messages)
    ? messages
        .map(requestObject)
        .find(message => message.type === 'ui_error' || message.type === 'error' || message.reason)
    : undefined;
}
function deletionFailure(payload: unknown, ok: boolean, statusText: string): string | null {
  const body = requestObject(payload),
    messages = Array.isArray(payload) ? payload : body.infs;
  const failure = failureMessage(messages);
  if (ok && !failure && !body.failed) return null;
  return requestText(failure?.reason || failure?.message || body.reason || statusText);
}

export function createBankboiDeletion(state: DeletionState, ports: DeletionPorts) {
  async function remove(name: string): Promise<ItemsAnswer> {
    try {
      const reply = await ports.request(name),
        failure = deletionFailure(reply.payload, reply.ok, reply.statusText);
      const wait = failure === null ? null : deleteWaitMs(failure);
      if (wait !== null)
        return { status: 409, body: {
          error: `bankboi deletion unlocks ${Math.ceil(wait / 60_000)} minutes after the account's last delete`,
          deletionAvailableAt: ports.now() + wait,
        } };
      if (failure !== null) throw new Error(failure);
      await ports.refresh();
      if (ports.owned(name)) throw new Error('deletion was not confirmed by the account roster');
      delete state.bankbois[name];
      recordItems({ decision: 'bankboi', subject: name, phase: 'deleted', by: 'player' });
      ports.persist();
      return { body: { ok: true } };
    } catch (error) {
      return { status: 502, body: { error: requestText(requestObject(error).message || error) } };
    }
  }
  return async function deleteBankboi(name: string): Promise<ItemsAnswer> {
    const entry = state.bankbois[name];
    if (!entry) return { status: 404, body: { error: 'unknown bankboi' } };
    try {
      await ports.refresh();
      if (!ports.owned(name)) {
        delete state.bankbois[name];
        recordItems({ decision: 'bankboi', subject: name, phase: 'deleted', by: 'player' });
        ports.persist();
        return { body: { ok: true, alreadyDeleted: true } };
      }
    } catch (error) {
      return { status: 502, body: { error: requestText(requestObject(error).message || error) } };
    }
    if (occupied(entry) || pending(state, name))
      return { status: 409, body: { error: 'bankboi must have no inventory, equipment, gold, or pending work' } };
    return remove(name);
  };
}

export interface CreationState {
  bankboiPrefix?: string;
  appearanceChoices?: Record<string, unknown> | null;
  headlessSlots: (string | null)[];
  bankbois: Record<string, unknown>;
}
export interface CreationRoutePorts extends CharacterCreationPorts {
  now(): number;
  classes: readonly string[];
  includedSlots: number;
  characterCount(): number;
  assign(slot: number, name: string): void;
  persistBank(): void;
  serviceBank(): void;
  log(message: string, level: string, details?: unknown): void;
}

function appearance(body: Record<string, unknown>, available: unknown): number {
  return typeof body.look === 'number' &&
    Number.isInteger(body.look) &&
    body.look >= 0 &&
    (!Array.isArray(available) || body.look < available.length)
    ? body.look
    : 0;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createCharacterCreationAnswers(state: CreationState, ports: CreationRoutePorts) {
  const creation = createCharacterCreation(ports);
  let bankboiBusy = false;

  async function createOwned(name: string, characterClass: string, body: Record<string, unknown>): Promise<ItemsAnswer> {
    try {
      const result = await creation.create(name, characterClass, appearance(body, state.appearanceChoices?.[characterClass]));
      if (!result.accepted) return { status: 502, body: { error: result.error } };
      if (!result.confirmed)
        return { status: 502, body: { error: 'character was not returned by the account after creation' } };
      const empty = state.headlessSlots.findIndex(entry => !entry);
      if (empty >= 0) ports.assign(empty + 1, name);
      return { body: { ok: true, character: name, slot: empty >= 0 ? empty + 1 : null } };
    } catch (error) {
      return { status: 502, body: { error: errorMessage(error) } };
    }
  }

  async function roster(body: Record<string, unknown>): Promise<ItemsAnswer> {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const characterClass = typeof body.class === 'string' ? body.class : '';
    if (!characterNameAllowed(name))
      return { status: 400, body: { error: CHARACTER_NAME_REFUSAL } };
    if (!ports.classes.includes(characterClass))
      return { status: 400, body: { error: 'invalid class' } };
    if (ports.owned(name)) return { status: 409, body: { error: 'character already exists' } };
    // Never let this endpoint cross into paid character slots.
    if (ports.characterCount() >= ports.includedSlots)
      return { status: 409, body: { error: 'included character slots are full; no Shells were spent' } };
    return createOwned(name, characterClass, body);
  }

  async function bankboi(): Promise<ItemsAnswer> {
    if (!state.bankboiPrefix || !/^[A-Za-z0-9_]{3,11}$/.test(state.bankboiPrefix))
      return { status: 400, body: { error: 'Set bankboi name in settings first' } };
    if (bankboiBusy)
      return { status: 409, body: { error: 'bankboi creation is already in progress' } };
    if (ports.characterCount() >= ports.includedSlots)
      return { status: 409, body: { error: `all ${ports.includedSlots} free character slots are occupied; no Shells were spent` } };
    bankboiBusy = true;
    ports.log('Creating the next available bankboi', 'info');
    try {
      const name = await creation.bankboi(state.bankboiPrefix);
      state.bankbois[name] = { name, state: 'provisioning', items: [], slots: {}, gold: 0, createdAt: ports.now()};
      ports.persistBank();
      recordItems({ decision: 'bankboi', subject: name, phase: 'created', by: 'player' });
      ports.log('Created ' + name + '; waiting to provision overflow storage', 'success');
      ports.serviceBank();
      return { body: { ok: true, bankboi: state.bankbois[name] } };
    } catch (error) {
      ports.log('Bankboi creation failed', 'error', errorMessage(error));
      return { status: 502, body: { error: errorMessage(error) } };
    } finally {
      bankboiBusy = false;
    }
  }
  return { roster, bankboi };
}

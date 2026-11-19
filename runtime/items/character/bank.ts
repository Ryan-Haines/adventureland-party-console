// The character's bank (3.1 `character/bank.ts`): finding a copy in the bank and the staging row, the
// confirmed withdrawal and deposit, storing a bag cell whole, the stack service, the sort and the walk
// that ends a bank visit, the merchant's visit and errands, a fighter's bank run and potion stock-up,
// a BankBoi's run and the hands' bank look `fetch`. shared.js builds it once at load over `BankPorts`
// and binds its names.
import { inventoryPack, isBankboiPack, isVaultPack, sameItem, stackKey, stackQuantity, type ItemCopy } from '../identity.ts';
import { compoundStorageLeftovers, BANK_PACK_CELLS, STAGING_FIRST, STAGING_PACK, availableCraftStock, itemFailure, nextStackMerge, SORT_SWAPS_PER_CELL, stackDepositPlan, stackLocations, stackProtected,
  stagingCell, type RestockPolicy, type StackItem, type StackLocation, type StackProtection } from '../rules.ts';
import { RESTOCK_DEFAULT } from '../saved-fields.ts';
import type { InventoryEntry } from '../../coordinator/contracts/item.ts';
import type { CompoundRule } from '../coordinator/production.ts';
import { settles, type BagAnswers, type BagPorts } from './bag.ts';
import type { createBag } from './owner.ts';
import { boundFired } from '../../status/api.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- the game's character and G objects are read as the client gives them */
type Cell = { pack: string; slot: number };
export interface BankPorts extends Pick<BagPorts, 'character' | 'G' | 'bankPacks' | 'margin' | 'sleep' | 'now'> {
  reads: BagAnswers;
  // The game's bank calls; each asks the call budget's `job` band before it goes (calls.ts).
  bankRetrieve(pack: string, slot: number, inv?: number): Promise<unknown>;
  bankStore(inv: number, pack: string, slot?: number): Promise<unknown>;
  swap(from: number, to: number): Promise<unknown>;
  bankSwap(pack: string, from: number, to: number): Promise<unknown>;
  split(slot: number, quantity: number): Promise<unknown>;
  // The lifecycle owner's console Pause boundary (shared.js `consoleAtomicBoundary`): a
  // transfer runs whole.
  atomic<T>(run: () => Promise<T>): Promise<T>;
  // The coordinator's last reply: whether the staging row is held and the stack homes on
  // other characters.
  staging(): boolean;
  stackHomes(): Record<string, { owner?: string; room?: number }>;
  request(path: string, options: { method: string; body: unknown }): Promise<any>;
  // The walk to the bank for a fetch, and whether this runtime is still the current one.
  walkToBank(): Promise<unknown>;
  current(): boolean;
  // Movement's walk (the sort's moves ask movement as they do) with the errand request.
  move(destination: unknown, callback?: unknown, options?: unknown): Promise<unknown>;
  errand(): unknown;
  // This runtime's id and the coordinator clock's offset, which name a bank visit.
  runtimeId(): string;
  clockOffset(): number;
  // A journal this character keeps across reloads (the stack and sort buffers), by key.
  saved(key: string): any;
  save(key: string, value: unknown): void;
  // The merchant's status line, and a status report so the dashboard sees the new layout.
  status(message: string, level: string, details?: unknown): void;
  publish(): Promise<unknown>;
  bag: ReturnType<typeof createBag>;
  // The game's gold and NPC calls, and the potion seller.
  bankDeposit(amount: number): Promise<unknown>;
  bankWithdraw(amount: number): Promise<unknown>;
  buy(name: string, quantity: number): Promise<unknown>;
  findNpc(name: string): unknown;
  log(message: string, color: string): void;
  // The coordinator's last reply: the player's protected free slots, the merchant's gold
  // target and this character's restock policy (3.3).
  protectedSlots(): number;
  merchantCashTarget(): number;
  restockPolicy(): RestockPolicy | null;
  // The party's place a fighter returns to, and the other owners' states that hold its stock-up and
  // its elixir: movement's pending departure and the survival owner's escape.
  partyLocation(): unknown;
  departing(): boolean;
  escaping(): boolean;
  // 3.3's elixir: the game's use of a bag cell, and the merchant jobs owner's walk back to the stand, which the merchant's
  // idle command waits out before it drinks.
  consume(slot: number): Promise<unknown>;
  standReturning(): boolean;
  // The merchant job owner's runner: the job's stage and the walk off the
  // stand.
  operationStage(command: MerchantCommand, stage: string): Promise<unknown>;
  leaveStand(): Promise<unknown>;
  // The game's unequip and NPC sale, for a BankBoi's provision.
  unequip(slot: string): Promise<unknown>;
  sell(slot: number, quantity: number): Promise<unknown>;
  // The game's key use and vault purchase.
  activate(slot: number): Promise<unknown>;
  openBankPack(pack: string): Promise<any>;
  // The Tracktrix copy (the merchant job owner's `isPersonalTracker`), and the merchant's work
  // outside 10 that holds the bag still: the merchant job owner's runner, the events owner's anniversary and its
  // reservation, and gathering.
  isTracker(item: unknown): boolean;
  othersBusy(): boolean;
  // The game's `can_stack`, whether a move of the second copy onto the first merges them.
  canStack(target: unknown, source: unknown): boolean;
}
// The command to a BankBoi (storage.ts `servicePlan`).
type BankboiCommand = {
  id?: unknown; provision?: boolean; unload?: boolean; protectedItems?: ItemCopy[]; reservedLocations?: Cell[];
  retrievals?: { item: ItemCopy; craftJobId?: unknown }[]; requests?: { id: unknown; pack: string; slot: number; item: ItemCopy }[];
  stackHomes?: Record<string, { owner?: string; room?: number }>;
};
type Withdrawal = { item: ItemCopy; pack?: string; slot?: number; deconstructionId?: unknown; improvement?: boolean };
type Work = { item: ItemCopy; tiers?: number };
// The merchant job's command fields the bank visit reads and the completion fields it writes.
type MerchantCommand = {
  id?: unknown; commandId?: unknown; jobId?: unknown; type?: string; operationStage?: string; craftProtection?: any;
  merchantGoldTarget?: number; goldTarget?: number; merchantWithdrawals?: Withdrawal[]; merchantBankMarked?: (ItemCopy | { slot?: number; item: ItemCopy })[];
  npcSales?: { id: unknown; item: ItemCopy; pack?: string; slot?: number; source?: string }[];
  upgrades?: Work[]; compounds?: { items?: Work[] }[]; autoCompounds?: { name: string; targetTier: number }[];
  bankUpgradeRules?: { name: string; level: number; tiers: number }[];
  _merchantBankErrandsChecked?: boolean; _merchantWithdrawalsCompleted?: unknown[];
  _merchantWithdrawalsLanded?: { pack?: string; slot?: number; inventorySlot: number }[]; _merchantBankedCompleted?: unknown[];
  _npcSalesRetrieved?: unknown[]; _capacityDeferredWithdrawals?: Withdrawal[];
};
type Activity = { level: string; message: string; details?: unknown }[];
interface Origin { pack: string; slot: number; floor: string }
interface Buffer { slot: number; identity: string; origin?: Origin; source?: number }
interface Expected { inventory?: number; bank?: Origin; item: StackItem | null }
interface StackJournal { buffers: Buffer[]; pending?: Expected[]; supersededBuffers?: Buffer[]; failedAt?: string }
interface SortEntry { slot: number; floor: string; identities: string[]; pending?: { pack: string; slot: number; inventory: string; bank: string } }
const STACK_JOURNAL = 'party-bank-stack-buffer', SORT_JOURNAL = 'party-bank-sort-buffer';
// The bank floors' maps (G maps `bank`, `bank_b`, `bank_u`).
const bankMap = (map: unknown) => /^bank(?:_|$)/.test(String(map));
// The sort's order of item types; a type not named sorts last.
const SORT_TYPES = ['helmet', 'chest', 'pants', 'gloves', 'shoes', 'cape', 'ring', 'earring', 'amulet', 'belt', 'orb', 'weapon',
  'shield', 'offhand', 'elixir', 'pot', 'scroll', 'material', 'exchange', ''];

export function createBank(p: BankPorts) {
  const me = () => p.character();
  const bank = (): Record<string, any> => me().bank || {};
  const definitions = () => p.bankPacks() || {};
  const stackLimit = (item: ItemCopy) => Number(p.G().items[item.name!]?.s) || 1;
  // The staging row's cells, the BankBoi's transfer pane.
  const stagingCells = Array.from({ length: BANK_PACK_CELLS - STAGING_FIRST }, (_, index) => STAGING_FIRST + index);

  // The staging row is held for BankBoi cargo while the coordinator says so.
  const bankStagingSlot = (pack: string, slot: number) => p.staging() && stagingCell(pack, slot);
  // A copy in the bank: the named cell first, then the first match. `normalizeLevel` reads a copy
  // with no level as +0, as a wanted copy names it.
  function findBankItem(wanted: ItemCopy, preferredPack?: string, preferredSlot?: number, normalizeLevel?: boolean): Cell | null {
    const matches = (item: ItemCopy | null | undefined) =>
      sameItem(normalizeLevel && item ? { ...item, level: Number(item.level) || 0 } : item, wanted);
    if (preferredPack && matches(bank()[preferredPack]?.[preferredSlot!])) return { pack: preferredPack, slot: preferredSlot! };
    for (const pack of Object.keys(bank())) {
      if (!Array.isArray(bank()[pack])) continue;
      const slot = bank()[pack].findIndex((item: ItemCopy | null) => matches(item));
      if (slot >= 0) return { pack, slot };
    }
    return null;
  }
  // The game sends a vault's cells when the character enters its floor; the settle window ends the wait. A
  // vault that did not load is the bank_unavailable case, which folds into `interrupted`, so the run
  // resumes as the previous release's retryableStorageError did (scripts/bank-stack-routing.cjs:67-71).
  async function waitForBankPack(pack: string) {
    if (await settles(p, () => Array.isArray(bank()[pack]))) return bank()[pack];
    throw itemFailure('interrupted', 'bank data did not load: ' + pack);
  }
  // One call per stack, confirmed by the bank cell emptying and the bag gaining its count.
  function bankRetrieveConfirmed(pack: string, slot: number) {
    return p.atomic(async () => {
      const item = bank()[pack]?.[slot];
      if (!item) throw Error('Bank withdrawal source is missing');
      const identity = stackKey(item), quantity = stackQuantity(item);
      const carried = () => (me().items || []).reduce((total: number, entry: ItemCopy | null) =>
        total + (entry && stackKey(entry) === identity ? stackQuantity(entry) : 0), 0);
      const before = carried();
      await p.bankRetrieve(pack, slot);
      if (!await settles(p, () => !bank()[pack][slot] && carried() >= before + quantity))
        throw itemFailure('not_confirmed', 'Bank withdrawal was not confirmed: ' + item.name);
    });
  }
  // A deposit into one named empty cell, confirmed by the bag cell emptying and the bank cell
  // holding the whole stack.
  function bankStageConfirmed(inventorySlot: number, pack: string, slot: number) {
    return p.atomic(async () => {
      const item = me().items[inventorySlot];
      if (!item || bank()[pack][slot]) throw Error('Bank transfer slots changed before deposit');
      const identity = stackKey(item), quantity = stackQuantity(item);
      await p.bankStore(inventorySlot, pack, slot);
      if (!await settles(p, () => {
        const staged = bank()[pack][slot];
        return !me().items[inventorySlot] && !!staged && stackKey(staged) === identity && stackQuantity(staged) === quantity;
      })) throw itemFailure('not_confirmed', 'Bank transfer deposit was not confirmed: ' + item.name);
    });
  }
  // A quantity across several stacks takes the next stack while the bank holds more; each call
  // is confirmed, so every pass moved the count.
  async function retrieveFromBankUntil(name: string, requiredOnPlayer: number) {
    let availability = p.reads.itemAvailability(name);
    while (availability.onPlayer < requiredOnPlayer && availability.inBank > 0) {
      const found = findBankItem({ name });
      if (!found) break;
      await bankRetrieveConfirmed(found.pack, found.slot);
      availability = p.reads.itemAvailability(name);
    }
    return availability;
  }
  // A partial stack of the item outside the staging row that can take more.
  function normalBankStackFits(item: ItemCopy): string | undefined {
    const limit = stackLimit(item);
    return limit > 1 ? Object.keys(bank()).find(pack => Array.isArray(bank()[pack]) && bank()[pack].some((entry: ItemCopy | null, slot: number) =>
      !bankStagingSlot(pack, slot) && entry && stackKey(entry) === stackKey(item) && stackQuantity(entry) < limit)) : undefined;
  }
  async function mergeIntoNormalBank(slot: number): Promise<boolean> {
    const before = stackQuantity(me().items[slot]);
    await stacks.fill(slot);
    return before > 0 && !me().items[slot];
  }
  // The merchant's bank checkpoint: the coordinator saves the snapshot and answers whether a
  // BankBoi swap waits for this job to end.
  async function bankboiCheckpoint() {
    if (me().ctype !== 'merchant') return;
    const result = await p.request('/bankboi/checkpoint', { method: 'POST', body: { character: me().name, bank: p.reads.bankSnapshot() } });
    if (result?.pending) throw itemFailure('bankboi_pending');
  }
  // The first bag cell inside the bag's size that is free, for a copy the game left past it.
  function recoveryCell(size: number): number {
    for (let slot = 0; slot < size; slot += 1) if (!me().items[slot]) return slot;
    return -1;
  }
  // The bank cell a deposit goes to: a stack of the same pile with room, then an empty cell of a
  // vault on this floor that the compaction rules allow, then the staging row while it is held; none is bank_full.
  function depositCell(source: ItemCopy, allowed: Cell[]): { merge: boolean; cell: Cell } | null {
    const limit = stackLimit(source), fits = (entry: ItemCopy | null | undefined) =>
      !!entry && limit > 1 && stackKey(entry) === stackKey(source) && stackQuantity(entry) + stackQuantity(source) <= limit;
    const packs = packsOnFloor();
    const permitted = (pack: string, slot: number) => allowed.some(location => location.pack === pack && location.slot === slot);
    const cells = (pack: string) => Array.from({ length: BANK_PACK_CELLS }, (_, slot) => slot).filter(slot => permitted(pack, slot));
    for (const pack of packs) for (const slot of cells(pack)) if (fits(bank()[pack][slot])) return { merge: true, cell: { pack, slot } };
    // The staging row is a transfer pane, so a deposit merges with the pile there too.
    const staging = p.staging() && Array.isArray(bank()[STAGING_PACK]) ? stagingCells : [];
    for (const slot of staging) if (fits(bank()[STAGING_PACK][slot])) return { merge: true, cell: { pack: STAGING_PACK, slot } };
    // A pile whose home is another character with room takes no empty vault cell; the staging row
    // carries it there.
    const home = limit > 1 ? p.stackHomes()[stackKey(source)] : undefined;
    const elsewhere = !!home && home.owner !== 'bank' && home.owner !== me().name && Number(home.room) >= stackQuantity(source);
    if (!elsewhere) for (const pack of packs) for (const slot of cells(pack)) if (!bank()[pack][slot]) return { merge: false, cell: { pack, slot } };
    for (const slot of staging) if (!bank()[STAGING_PACK][slot]) return { merge: false, cell: { pack: STAGING_PACK, slot } };
    return null;
  }
  // Stores a bag cell whole. Each call is confirmed by the cell's change, so every pass makes
  // progress; a pass the bank does not take ends the store.
  async function bankStoreFully(slot: number) {
    while (me().items[slot]) {
      const size = Number(me().isize) || me().items.length;
      if (slot >= size) {
        const recovered = recoveryCell(size);
        if (recovered < 0) throw Error('Inventory overflow item has no valid recovery slot');
        await p.swap(slot, recovered);
        if (!await settles(p, () => !!me().items[recovered])) throw itemFailure('not_confirmed', 'Could not recover inventory overflow item');
        slot = recovered;
      }
      await stacks.fill(slot);
      if (!me().items[slot]) { await bankboiCheckpoint(); return; }
      const source = me().items[slot], before = JSON.stringify(p.reads.fingerprint(source));
      const target = depositCell(source, await stacks.locations());
      if (!target) {
        await bankboiCheckpoint();
        throw itemFailure('bank_full');
      }
      // A merge lets the server pick the pile in this pack: an explicit occupied cell would swap,
      // and a withdrawal first could merge bank stock into an unmarked bag stack.
      if (target.merge) await p.bankStore(slot, target.cell.pack);
      else await p.bankStore(slot, target.cell.pack, target.cell.slot);
      const after = () => me().items[slot] ? JSON.stringify(p.reads.fingerprint(me().items[slot])) : null;
      await settles(p, () => after() !== before);
      if (!me().items[slot]) { await bankboiCheckpoint(); return; }
      if (after() === before) throw itemFailure('not_confirmed', 'Bank did not accept ' + me().items[slot].name);
    }
  }
  // Fills and compacts partial stacks across the floors. Each transfer is journaled before it
  // runs and confirmed by the game's change, so a reload undoes a half-done one.
  function createStacks() {
    const at = (o: Origin) => (bank()[o.pack] as (StackItem | null)[] | undefined)?.[o.slot] || null;
    const floor = (pack: string) => (definitions()[pack] || [me().map])[0];
    const origin = (l: StackLocation): Origin => ({ pack: l.pack, slot: l.slot, floor: floor(l.pack) });
    const bagSize = () => Number(me().isize) || me().items.length;
    const empty = () => Array.from({ length: bagSize() }, (_, i) => i).filter(i => !me().items[i]);
    const copy = (item: StackItem | null | undefined) => item ? { ...item } : null;
    const equal = (a: StackItem | null | undefined, b: StackItem | null | undefined) =>
      stackKey(a) === stackKey(b) && stackQuantity(a) === stackQuantity(b);
    // The bank's piles merge by the game's `can_stack`, asked for one unit so only the rule and
    // not the counts answers (the previous release's shared.js:4065-4070); the plans add the counts.
    const stackable = (target: StackItem, source: StackItem) => p.canStack({ ...target, q: 1 }, { ...source, q: 1 });
    const read = (): StackJournal | null => p.saved(STACK_JOURNAL);
    const write = (journal: StackJournal | null) => p.save(STACK_JOURNAL, journal);
    function active() { if (!p.current()) throw Error('Bank stack runtime replaced'); }
    // The transfer lands within two measured round trips past its reply. A recovery that finds
    // another pile in a cell after that ends there; the cell was reused.
    async function settle(expected: Expected[], recovering = false) {
      const cell = (e: Expected) => e.bank ? at(e.bank) : me().items[e.inventory!];
      active();
      if (await settles(p, () => { active(); return expected.every(e => equal(cell(e), e.item)); })) return;
      if (recovering && expected.some(e => stackKey(cell(e)) !== stackKey(e.item))) return;
      throw itemFailure('not_confirmed', 'Bank stack transfer not confirmed; recovery pending');
    }
    async function operation(run: () => Promise<unknown>, expected: Expected[]) {
      active();
      const journal = read() || { buffers: [] };
      write({ ...journal, pending: expected });
      await run();
      await settle(expected);
      write({ ...journal, pending: undefined });
    }
    async function travel(target: string) {
      active();
      if (me().map !== target) await p.move(target, undefined, { request: p.errand() });
      if (me().map !== target) throw Error('Bank floor not reached');
    }
    async function protection(): Promise<StackProtection> {
      const state = await checkpoint('stack');
      if (!state?.protection) throw Error('Bank stack protection unavailable; coordinator update required');
      return state.protection;
    }
    async function locations() {
      const current = await protection();
      if (current.error) throw Error(current.error);
      const floors = accessibleFloors();
      return stackLocations(bank(), current).filter(l => floors.includes(floor(l.pack)))
        .map(location => ({ ...location, item: copy(location.item) }));
    }
    async function permitted(location: StackLocation) {
      if (stackProtected({ ...location, item: at(origin(location)) }, await protection())) throw Error('Bank stack location is reserved');
    }
    async function returnBuffer(buffer: Buffer) {
      const item = me().items[buffer.slot];
      if (!item || stackKey(item) !== buffer.identity) return;
      if (buffer.source !== undefined) {
        const source = me().items[buffer.source];
        // A split whose source changed since keeps the current stock; it can no longer be undone.
        if (!source || stackKey(source) !== buffer.identity || stackQuantity(source) + stackQuantity(item) > stackLimit(item)) return;
        await operation(() => p.swap(buffer.source!, buffer.slot), [
          { inventory: buffer.source, item: { ...source, q: stackQuantity(source) + stackQuantity(item) } },
          { inventory: buffer.slot, item: null }]);
      } else if (buffer.origin) {
        await travel(buffer.origin.floor);
        // A reused bank cell is never overwritten.
        if (at(buffer.origin)) return;
        await operation(() => p.bankStore(buffer.slot, buffer.origin!.pack, buffer.origin!.slot), [
          { inventory: buffer.slot, item: null }, { bank: buffer.origin, item: copy(item) }]);
      }
    }
    async function recoverOnce(journal: StackJournal) {
      // An uncertain transfer is never repeated: the recovery waits for its recorded result.
      if (journal.pending) { await settle(journal.pending, true); write({ ...journal, pending: undefined }); }
      // A journal from before the one-writer runtime can hold a slot twice: the later reservation
      // wins, and a slot now holding another pile is no buffer.
      let buffers = [...new Map(journal.buffers.map(buffer => [buffer.slot, buffer])).values()];
      if (!journal.pending && buffers.length !== journal.buffers.length) {
        buffers = buffers.filter(buffer => stackKey(me().items[buffer.slot]) === buffer.identity);
        write({ buffers, supersededBuffers: journal.buffers });
      }
      for (const buffer of buffers.sort((a, b) => Number(b.source !== undefined) - Number(a.source !== undefined)))
        await returnBuffer(buffer);
      write(null);
    }
    // A progress rule: a failed recovery runs again only after the bag or the bank changed. With no
    // change since its failed pass the journal retires without moving anything, and the next
    // deposit or compact plans from the current stock.
    const seen = () => JSON.stringify([me().items, bank()]);
    // The previous release's journal keyed a buffer by its stackIdentity, nine fields
    // (characters/party-member.js:1251-1253 at an earlier build), which stackKey never equals, so
    // recoverOnce would drop every buffer of an upgraded console's journal. The load keys a buffer
    // whose slot still holds that pile by the pile's stackKey, once; a slot holding another pile
    // keeps its old key and is no buffer.
    const legacyIdentity = (item: StackItem | null | undefined) => JSON.stringify(['name', 'level', 'p', 'stat_type', 'data', 'rid', 'b', 'm', 'l']
      .map(key => key === 'level' ? Number(item?.level) || 0 : (item as Record<string, unknown> | null | undefined)?.[key] ?? null));
    function load(): StackJournal | null {
      const journal = read();
      if (!journal?.buffers.some(buffer => JSON.parse(buffer.identity).length === 9)) return journal;
      const buffers = journal.buffers.map(buffer => {
        const item = me().items[buffer.slot];
        return item && legacyIdentity(item) === buffer.identity ? { ...buffer, identity: stackKey(item) } : buffer;
      });
      write({ ...journal, buffers });
      return read();
    }
    async function recover() {
      const journal = load();
      if (!journal) return;
      if (journal.failedAt === seen()) { write(null); return; }
      try { await recoverOnce(journal); }
      catch (error) {
        if (p.current() && read()) write({ ...read()!, failedAt: seen() });
        throw error;
      }
    }
    function remember(buffers: Buffer[]) {
      write({ buffers: [...(read()?.buffers || []), ...buffers] });
    }
    async function retrieve(location: StackLocation, inv: number) {
      const o = origin(location), item = copy(at(o));
      await travel(o.floor);
      await permitted(location);
      if (!equal(at(o), location.item) || me().items[inv]) throw Error('Bank stack source changed');
      remember([{ slot: inv, identity: stackKey(item), origin: o }]);
      await operation(() => p.bankRetrieve(o.pack, o.slot, inv), [{ inventory: inv, item }, { bank: o, item: null }]);
    }
    async function transfer(slot: number, target: StackLocation, quantity: number) {
      const source = copy(me().items[slot]), targetItem = copy(target.item);
      if (!source || !targetItem) throw Error('Bank stack transfer source missing');
      const buffers = empty(), partial = quantity < stackQuantity(source);
      if (buffers.length < (partial ? 2 : 1)) throw Error('Bank stacking needs free inventory buffers');
      await retrieve(target, buffers[0]!);
      let chunk = slot;
      if (partial) {
        // The game's split puts the part in the first empty bag cell.
        chunk = empty()[0]!;
        remember([{ slot: chunk, identity: stackKey(source), source: slot }]);
        await operation(() => p.split(slot, quantity), [
          { inventory: slot, item: { ...source, q: stackQuantity(source) - quantity } },
          { inventory: chunk, item: { ...source, q: quantity } }]);
      }
      const combined = { ...targetItem, q: stackQuantity(targetItem) + quantity };
      await operation(() => p.swap(buffers[0]!, chunk), [{ inventory: buffers[0], item: combined }, { inventory: chunk, item: null }]);
      const o = origin(target);
      if (at(o)) throw Error('Bank stack destination changed');
      await operation(() => p.bankStore(buffers[0]!, o.pack, o.slot), [{ inventory: buffers[0], item: null }, { bank: o, item: combined }]);
    }
    async function fill(slot: number) {
      await recover();
      const initialFloor = me().map;
      while (me().items[slot]) {
        const item = copy(me().items[slot])!;
        const available = await locations();
        const target = stackDepositPlan(item, stackLimit(item), available, stackable).moves.find(move => move.item);
        if (!target) break;
        await travel(floor(target.pack));
        if (!equal(at(origin(target)), target.item) || !equal(me().items[slot], item))
          throw Error('Bank stack changed during travel; retry deposit');
        // A whole-stack store lets the server pick the pile, so it runs only where no reserved or
        // staging pile of the item shares the pack.
        const pack = bank()[target.pack] as (StackItem | null)[];
        const safe = pack.every((entry, index) => !entry || !stackable(entry, item) ||
          available.some(l => l.pack === target.pack && l.slot === index));
        if (target.quantity === stackQuantity(item) && safe) {
          await permitted(target);
          await operation(() => p.bankStore(slot, target.pack), [{ inventory: slot, item: null },
            { bank: origin(target), item: { ...target.item, q: stackQuantity(target.item) + stackQuantity(item) } }]);
        } else await transfer(slot, target, target.quantity);
        await recover();
      }
      await travel(initialFloor);
    }
    async function compact() {
      await recover();
      const initialFloor = me().map;
      let moved = 0, deferred = false;
      // Each pass fills a target or empties a source.
      for (;;) {
        const plan = nextStackMerge(await locations(), stackLimit, stackable);
        if (!plan) break;
        const { source, target, quantity } = plan;
        if (source.pack === target.pack && quantity === stackQuantity(source.item)) {
          await travel(floor(source.pack));
          await permitted(source); await permitted(target);
          await operation(() => p.bankSwap(source.pack, source.slot, target.slot), [
            { bank: origin(source), item: null }, { bank: origin(target), item: { ...target.item, q: stackQuantity(target.item) + quantity } }]);
          write(null);
        } else {
          const buffers = empty();
          if (buffers.length < (quantity < stackQuantity(source.item) ? 3 : 2)) { deferred = true; break; }
          await retrieve(source, buffers[0]!);
          await transfer(buffers[0]!, target, quantity);
          await recover();
        }
        moved++;
      }
      await travel(initialFloor);
      return { moved, deferred };
    }
    let flight: Promise<unknown> = Promise.resolve();
    function serial<T>(run: () => Promise<T>): Promise<T> {
      const next = flight.then(run, run);
      flight = next.catch(() => {});
      return next;
    }
    return { fill: (slot: number) => serial(() => fill(slot)), compact: () => serial(compact),
      recover: () => serial(recover), locations, pending: () => !!read() };
  }
  const stacks = createStacks();
  // One compaction per visit and layout: the signature names the staging hold, the visit and the bank.
  let stackSignature: string | null = null;
  const visitSignature = () => JSON.stringify([p.staging(), visit?.id, me().bank]);
  async function finishBankStacks(activity: Activity) {
    if (stackSignature === visitSignature()) return;
    const result = await stacks.compact();
    if (!result.deferred) stackSignature = visitSignature();
    if (result.moved) {
      activity.push({ level: 'info', message: 'Combined ' + result.moved + ' bank stacks' });
      await p.publish();
    }
    if (result.deferred) activity.push({ level: 'info', message: 'Bank stack cleanup deferred: inventory buffers unavailable' });
  }

  // A sort request is a lease that one visit settles. A visit spans every bank floor and is
  // named before any banking work starts.
  let visit: { id: string; enteredAt: number; floors: Record<string, string>; attempted: boolean } | null = null;
  let sortPass: string | null = null, sortFlight: Promise<unknown> | null = null, observed = false, recovered = false;
  let recoveryFlight: Promise<unknown> | null = null;
  function observeVisit() {
    if (!bankMap(me().map)) { visit = null; observed = true; return; }
    if (!visit) visit = { id: p.runtimeId() + ':' + p.now(), enteredAt: observed ? p.now() + p.clockOffset() : 0, floors: {}, attempted: false };
    observed = true;
  }
  async function checkpoint(action: string, id?: string, message?: string, code?: string) {
    if (!p.current()) throw Error('Bank sort runtime replaced');
    observeVisit();
    return p.request('/merchant/bank-sort/checkpoint', { method: 'POST', body: {
      character: me().name, runtime: p.runtimeId(), visit: visit?.id, enteredAt: visit?.enteredAt, action, id, message, code } });
  }
  async function authorized() {
    const state = await checkpoint('read');
    if (state.mode === 'automatic') return !sortPass;
    return !!(sortPass && state.pending && state.pending.id === sortPass && state.pending.runtime === p.runtimeId() && state.pending.visit === visit?.id);
  }
  async function guard() { if (!await authorized()) throw Error('Bank sorting cancelled'); }
  // The vaults on the character's floor, in pack order.
  function packsOnFloor(): string[] {
    return Object.keys(bank()).filter(pack => pack !== 'gold' && Array.isArray(bank()[pack]) &&
      (!definitions()[pack] || definitions()[pack]![0] === me().map))
      .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
  }
  const sortSignature = () => JSON.stringify([p.staging(), packsOnFloor().map(pack => [pack, bank()[pack]])]);
  // The floors this character can reach from here through the maps' doors: a keyed door needs its
  // bank key in the bag (G items `bank_key` `unlocks`), and a floor counts when it holds a vault.
  function accessibleFloors(): string[] {
    const G = p.G(), floors = [me().map], keys: Record<string, string> = {};
    for (const name of Object.keys(G.items)) if (G.items[name].type === 'bank_key') keys[G.items[name].unlocks] = name;
    for (let i = 0; i < floors.length; i += 1) {
      for (const door of (G.maps[floors[i]!] || {}).doors || []) {
        const map = door[4];
        if (!bankMap(map) || floors.includes(map) || door[8] === 'complicated') continue;
        if (door[7] === 'key' && !me().items.some((item: ItemCopy | null) => item && item.name === keys[map])) continue;
        floors.push(map);
      }
    }
    return floors.filter(map => Object.keys(bank()).some(pack => Array.isArray(bank()[pack]) && definitions()[pack]?.[0] === map));
  }
  // A requested sort's pass ends confirmed, not landed or unconfirmed. Each ending reports to the
  // lease, and none leaves an entry that holds the merchant at the bank.
  async function finishRequestedSort() {
    observeVisit();
    if (!visit || visit.attempted) return;
    const state = await checkpoint('claim'), pending = state.pending;
    if (state.mode !== 'request' || !pending || pending.runtime !== p.runtimeId() || pending.visit !== visit.id) return;
    visit.attempted = true;
    sortPass = pending.id;
    const activity: Activity = [], start = { map: me().map, x: me().x, y: me().y };
    try {
      const floors = accessibleFloors();
      if (!floors.length) throw Error('Bank floor data unavailable');
      for (const target of floors) {
        await guard();
        if (me().map !== target) await p.move(target, undefined, { request: p.errand() });
        await sortCurrentBankFloor(activity);
      }
      await guard();
      await checkpoint('complete', sortPass!);
    } catch (error: any) {
      await checkpoint('retry', sortPass!, String(error?.message || error), error?.code)
        .catch((problem: any) => p.log('Bank sort retry checkpoint failed: ' + failure(problem), 'red'));
      activity.push({ level: 'error', message: 'Bank sorting needs retry', details: String(error?.message || error) });
    } finally {
      sortPass = null;
      if (p.current() && bankMap(me().map) && me().map !== start.map) await p.move(start, undefined, { request: p.errand() });
      for (const entry of activity) p.status(entry.message, entry.level, entry.details);
    }
  }
  const sortEntries = (): SortEntry[] => p.saved(SORT_JOURNAL) || [];
  // The sort journals each swap before it runs, with both sides it expects.
  const saveSort = (entries: SortEntry[]) => p.save(SORT_JOURNAL, entries);
  // A copy's sort state is its pile and count. The native store drops the merchant's luck mark `m`
  // and `v` from the copy it puts in the bank (G server.js:9438-9441), so the expected bank copy has
  // neither, and a saved journal entry reads the same way.
  const sortState = (item: ItemCopy | null | undefined) => item ? JSON.stringify([stackKey(item), stackQuantity(item)]) : 'null';
  const stored = (item: ItemCopy | null | undefined) => item ? { ...item, m: undefined, v: undefined } : null;
  // One swap between the bag buffer and a bank cell, under the bag holder (the visit's own, or
  // `banking` taken for the swap). It ends confirmed (both cells as planned), not landed (a refusal,
  // or no change, with both sides as before) or unconfirmed (anything else).
  async function sortSwap(buffer: number, pack: string, slot: number): Promise<'confirmed' | 'not_landed' | 'unconfirmed'> {
    const took = p.bag.take('banking') === 'taken';
    try {
      const carried = me().items[buffer], current = bank()[pack][slot];
      const entry: SortEntry = { slot: buffer, floor: me().map, identities: [carried, current].filter(Boolean).map(stackKey),
        pending: { pack, slot, inventory: sortState(current), bank: sortState(stored(carried)) } };
      const before = [sortState(carried), sortState(current)].join();
      const intact = () => [sortState(me().items[buffer]), sortState(bank()[pack]?.[slot])].join() === before;
      saveSort([entry]);
      recovered = true;
      let refused = false;
      try {
        if (carried) await p.bankStore(buffer, pack, slot);
        else await p.bankRetrieve(pack, slot, buffer);
      } catch { refused = true; }
      if (!(refused && intact()) && await settles(p, () => me().map === entry.floor && Array.isArray(bank()[pack]) &&
        sortState(me().items[buffer]) === entry.pending!.inventory && sortState(bank()[pack][slot]) === entry.pending!.bank)) {
        saveSort([{ ...entry, pending: undefined }]);
        return 'confirmed';
      }
      // The entry stays without its pending side, so the cleanup puts a carried copy back.
      saveSort([{ ...entry, pending: undefined }]);
      return intact() ? 'not_landed' : 'unconfirmed';
    } finally {
      if (took) p.bag.release('banking');
    }
  }
  // A buffer the last pass left in the bag goes back to the bank when its pile is still there. A
  // store the bank refuses ends the entry with a status line; nothing holds the merchant for it.
  async function cleanupSortBuffers() {
    for (const entry of sortEntries()) {
      const item = me().items[entry.slot];
      if (!item || !entry.identities.includes(stackKey(item))) continue;
      try {
        if (me().map !== entry.floor) await p.move(entry.floor, undefined, { request: p.errand() });
        await bankStoreFully(entry.slot);
      } catch (error: any) {
        p.status('Bank sort buffer left in the bag', 'error', String(error?.message || error));
      }
    }
    saveSort([]);
  }
  async function recoverBeforeWork() {
    await stacks.recover();
    if (recovered || !bankMap(me().map)) return;
    if (!recoveryFlight) recoveryFlight = cleanupSortBuffers().then(() => { recovered = true; }).finally(() => { recoveryFlight = null; });
    await recoveryFlight;
  }
  // Every walk of the character's code goes through here. A merchant leaving the bank first
  // settles the stacks, the sort buffers and a requested sort; then movement walks. A caller's
  // own callback and options reach movement unchanged, so a group walk keeps its request and its
  // gate. The items owner's own walks pass no options and walk as the items owner's errand.
  async function bankSortMove(destination: any, callback?: unknown, options?: unknown) {
    observeVisit();
    const map = typeof destination === 'string' ? destination : destination && (destination.map || destination.to) || me().map;
    if (me().ctype === 'merchant' && visit && !bankMap(map)) {
      await stacks.recover();
      await cleanupSortBuffers();
      const activity: Activity = [];
      try { await finishBankStacks(activity); }
      catch (error: any) {
        if (stacks.pending()) throw error;
        activity.push({ level: 'error', message: 'Bank stack cleanup deferred', details: String(error?.message || error) });
      }
      for (const entry of activity) p.status(entry.message, entry.level, entry.details);
      if (!sortFlight) sortFlight = finishRequestedSort().finally(() => { sortFlight = null; });
      await sortFlight;
    }
    const result = await p.move(destination, callback, options ?? { request: p.errand() });
    observeVisit();
    await recoverBeforeWork();
    return result;
  }
  function sortCategory(item: ItemCopy | null): number {
    if (!item) return SORT_TYPES.length;
    const definition = p.G().items[item.name!] || {};
    const index = SORT_TYPES.findIndex(type => !type || definition.type === type ||
      (type === 'offhand' && ['source', 'quiver', 'misc_offhand'].includes(definition.type)) ||
      (type === 'scroll' && ['cscroll', 'uscroll', 'pscroll', 'offering'].includes(definition.type)) ||
      (type === 'exchange' && definition.e));
    return index;
  }
  // The packed layout: by type, then the game's value, then name, then the higher level first.
  function compareBankItems(first: ItemCopy | null, second: ItemCopy | null): number {
    if (!first && !second) return 0;
    if (!first) return 1;
    if (!second) return -1;
    const category = sortCategory(first) - sortCategory(second);
    if (category) return category;
    const value = (item: ItemCopy) => { const d = p.G().items[item.name!] || {}; return Number(d.gold_value) || Number(d.g) || 0; };
    const worth = value(first) - value(second);
    if (worth) return worth;
    if (first.name !== second.name) return first.name! < second.name! ? -1 : 1;
    return (Number(second.level) || 0) - (Number(first.level) || 0);
  }
  // Sorts this floor's vaults outside the staging row through one bag buffer. Every swap is
  // confirmed and either picks up a misplaced copy or puts the carried one where the layout wants
  // it; a swap that is not confirmed ends the pass, and SORT_SWAPS_PER_CELL bounds the pass.
  async function sortCurrentBankFloor(activity: Activity) {
    if (!me().bank) {
      if (sortPass) throw Error('Bank data unavailable during requested sort');
      return;
    }
    // The sort's buffer cell and its cleanup move bag copies, so the sort runs only inside the
    // visit's own `banking` hold or a free bag. A requested pass under another holder is retried at
    // the next visit; an automatic one waits for it.
    const holder = p.bag.facts().holder;
    if (holder && holder !== 'banking') {
      if (sortPass) throw Error('Bank sorting waits for the ' + holder + ' operation');
      return;
    }
    await finishBankStacks(activity);
    if (!await authorized()) return;
    await cleanupSortBuffers();
    const signature = sortSignature();
    if (visit!.floors[me().map] === signature) return;
    const packs = packsOnFloor();
    if (!packs.length) throw Error('Bank floor data unavailable during sorting');
    // The buffer is a bag cell inside the bag's size (`isize`); the server refuses a swap into
    // an empty cell past it.
    const size = Number(me().isize) || me().items.length;
    const buffer = Array.from({ length: size }, (_, slot) => slot).find(slot => !me().items[slot]);
    if (buffer === undefined) throw itemFailure('inventory_full', 'Bank sorting needs a free merchant inventory slot');
    const items: (ItemCopy | null)[] = [], usable: Cell[] = [];
    for (const pack of packs) for (let slot = 0; slot < BANK_PACK_CELLS; slot += 1) {
      if (bankStagingSlot(pack, slot)) continue;
      usable.push({ pack, slot });
      items.push(bank()[pack][slot] || null);
    }
    // An add-on's `items.bankLayout`, asked on the coordinator, may order the floor's cells; the
    // packed layout's copies fill them in that order, else in cell order.
    const layout: Cell[] | null = (await p.request('/merchant/bank-sort/checkpoint', { method: 'POST', body: {
      character: me().name, runtime: p.runtimeId(), visit: visit?.id, action: 'layout', floor: me().map,
      cells: usable.map((cell, index) => ({ ...cell, item: items[index] })) } }))?.layout || null;
    items.sort(compareBankItems);
    const desired: Record<string, (ItemCopy | null)[]> = {};
    for (const pack of packs) desired[pack] = Array(BANK_PACK_CELLS).fill(null);
    (layout || usable).forEach((cell, index) => { desired[cell.pack]![cell.slot] = items[index] || null; });
    let operations = 0;
    try {
      for (;;) {
        await guard();
        if (operations >= SORT_SWAPS_PER_CELL * usable.length) {
          boundFired({ bound: 'bankSortBound', owner: '10', state: { floor: me().map, cells: usable.length, swaps: operations } });
          throw Error('Bank sorting exceeded ' + SORT_SWAPS_PER_CELL + ' swaps per cell');
        }
        const carried = me().items[buffer], next = usable.find(({ pack, slot }) => {
          const current = bank()[pack][slot] || null, wanted = desired[pack]![slot] || null;
          return carried ? !compareBankItems(carried, wanted) && !!compareBankItems(current, wanted) : !!current && !!compareBankItems(current, wanted);
        });
        if (!next) break;
        const ending = await sortSwap(buffer, next.pack, next.slot);
        if (ending === 'not_landed') throw itemFailure('not_confirmed', 'Bank sort swap did not land; the next visit plans again');
        if (ending === 'unconfirmed') {
          await p.publish().catch((problem: any) => p.log('Bank layout report failed: ' + failure(problem), 'red'));
          throw itemFailure('not_confirmed', 'Bank sort swap unconfirmed; the next report is read as the bank');
        }
        operations += 1;
      }
    } finally {
      // The carried copy goes back to the bank whatever ended the pass.
      await cleanupSortBuffers();
    }
    if (packs.some(pack => desired[pack]!.some((wanted, slot) => !bankStagingSlot(pack, slot) && compareBankItems(bank()[pack][slot] || null, wanted || null))))
      throw Error('Bank sorting stopped before every item was placed');
    visit!.floors[me().map] = sortSignature();
    if (operations) {
      activity.push({ level: 'success', message: 'Sorted ' + packs.length + ' bank pack' + (packs.length === 1 ? '' : 's') });
      // The dashboard sees the new layout before a short job leaves the bank; the next status
      // report sends it otherwise.
      await p.publish().catch((problem: any) => p.log('Bank layout report failed: ' + failure(problem), 'red'));
    }
  }
  // A character's own potion stock-up when it carries none of its restock policy's HP supply
  // (3.3's restock claim, the policy the merchant's restock fills): it buys up to the policy's
  // `max` from the potion seller.
  const hpSupply = () => (p.restockPolicy() || RESTOCK_DEFAULT).hp;
  // A progress rule: an attempt that ended short runs again only after the bag or the gold changed.
  let stockFailed: string | null = null;
  const stockSeen = () => JSON.stringify([me().gold, me().items]);
  const stockDue = () => p.reads.inventoryQuantity(hpSupply().item) === 0 && stockFailed !== stockSeen();
  // The bag stays still while a holder holds it or another owner's work holds the merchant there; the
  // stock-up, the elixir and the merchant's tidy all ask this one read (12 table A's acting rows).
  // A BankBoi's storage holds it too.
  function bagStill(): boolean {
    return p.bag.bankboiStorage() || p.bag.errandFor('bankStill') || p.departing() || p.escaping() || p.othersBusy();
  }
  // 3.3's elixir: the character drinks its policy's elixir while its elixir slot is empty, between
  // jobs: with no command, or with the merchant's idle command once the merchant job owner's stand
  // walk ends. A failed use is logged and the next reply tries again.
  async function useElixir(command: { type?: string } | null): Promise<void> {
    const elixir = p.restockPolicy()?.elixir;
    if (!elixir || elixir.autoConsume === false || !elixir.item || me().slots.elixir || me().rip || bagStill()) return;
    if (command && !(command.type === 'merchant-idle' && !p.standReturning())) return;
    const slot = me().items.findIndex((item: any) => item && !item.l && !item.b && item.name === elixir.item &&
      p.G().items[item.name]?.type === 'elixir');
    if (slot >= 0) await p.consume(slot).catch((error: any) => p.log('Elixir use failed: ' + failure(error), 'red'));
  }
  // The status owner's table A acting row: a due stock-up starts on the reply and runs on; its
  // failure is logged.
  function stockUpOnReply(): void {
    if (stockDue()) stockUp().catch((error: any) => p.log('Potion stock-up failed: ' + (error?.reason || error?.message || error), 'red'));
  }
  async function stockUp(): Promise<boolean> {
    const supply = hpSupply();
    let carried = p.reads.inventoryQuantity(supply.item);
    if (bagStill() || me().rip || carried > 0) return false;
    const potion = p.G().items[supply.item];
    if (!potion || me().gold < potion.g * (supply.max - carried)) { stockFailed = stockSeen(); return false; }
    if (p.bag.take('stocking') !== 'taken') return false;
    const start = { map: me().map, x: me().x, y: me().y };
    try {
      const vendor = p.findNpc('fancypots');
      if (!vendor) throw Error('fancypots vendor not found');
      await bankSortMove(vendor);
      carried = p.reads.inventoryQuantity(supply.item);
      const needed = Math.max(0, supply.max - carried);
      if (needed && me().gold >= potion.g * needed) {
        await p.buy(supply.item, needed);
        p.log('Stocked ' + needed + ' ' + (potion.name || supply.item), '#51D2E1');
      }
      const stocked = p.reads.inventoryQuantity(supply.item) >= supply.max;
      stockFailed = stocked ? null : stockSeen();
      return stocked;
    } catch (error) {
      stockFailed = stockSeen();
      throw error;
    } finally {
      try { await bankSortMove(p.partyLocation() || start); }
      catch (error: any) { p.log('Return from potion vendor failed: ' + (error?.reason || error?.message || error), 'red'); }
      p.bag.release('stocking');
    }
  }
  // A fighter's bank run (its walks carry the bag holder's `items:banking:<id>`). Withdrawals
  // stop at the player's protected free slots, and each one is confirmed.
  async function goBank(marked: ItemCopy[], withdrawals: Withdrawal[], goldTarget: unknown, returnLocation?: unknown) {
    if (!await p.bag.acquire('banking')) return;
    const start = { map: me().map, x: me().x, y: me().y }, withdrawn: Withdrawal[] = [];
    // The marked copies the run stored, for the bank slot's receipt (`items.banked`).
    const banked: { item: { name: string; q: number; level?: number } }[] = [];
    try {
      await bankSortMove('bank');
      for (const wanted of marked) {
        const slot = p.reads.findItem(wanted);
        if (slot < 0) continue;
        const copy = me().items[slot];
        await bankStoreFully(slot);
        if (copy) banked.push({ item: { name: copy.name, q: Number(copy.q) || 1, ...(copy.level !== undefined ? { level: copy.level } : {}) } });
      }
      for (const withdrawal of withdrawals) {
        if (p.reads.freeInventorySlots() <= p.protectedSlots()) break;
        if (isBankboiPack(withdrawal.pack)) continue;
        const found = findBankItem(withdrawal.item, withdrawal.pack, withdrawal.slot);
        if (!found) continue;
        await bankRetrieveConfirmed(found.pack, found.slot);
        withdrawn.push(withdrawal);
      }
      const target = Number.isInteger(goldTarget) && (goldTarget as number) >= 0 ? goldTarget as number : 0;
      if (me().gold > target) await p.bankDeposit(me().gold - target);
      else if (me().gold < target) {
        const desired = target - me().gold, amount = Math.min(desired, Number(bank().gold) || 0);
        if (amount > 0) await p.bankWithdraw(amount);
        if (amount < desired) p.log('Bank has insufficient gold for the ' + target + ' target', 'red');
      }
      p.log('Bank run complete', '#51D2E1');
    } catch (error: any) {
      p.log('Bank run failed: ' + (error?.reason || error?.message || error), 'red');
    } finally {
      try { await bankSortMove(returnLocation || p.partyLocation() || start); }
      catch (error: any) { p.log('Return from bank failed: ' + (error?.reason || error?.message || error), 'red'); }
      p.bag.release('banking');
      try { await p.request('/bank-complete', { method: 'POST', body: { character: me().name, withdrawn, banked } }); }
      catch (error: any) { p.log('Bank queue release failed: ' + (error?.message || error), 'red'); }
    }
  }

  // The merchant's gold withdrawal: the shortfall, or up to the job's or the merchant's gold
  // target.
  async function withdrawMerchantCash(shortfall: unknown, command?: MerchantCommand) {
    const configured = command && Number.isInteger(command.merchantGoldTarget) ? Math.max(0, command.merchantGoldTarget!)
      : me().ctype === 'merchant' ? p.merchantCashTarget() : 0;
    const amount = Math.min(Math.max(0, Number(bank().gold) || 0), Math.max(Math.max(0, Number(shortfall) || 0), configured - (Number(me().gold) || 0)));
    if (amount > 0) await p.bankWithdraw(amount);
    return amount;
  }
  // A bag copy some craft or delivery holds stays in the bag; a partly held stack stays whole and
  // its surplus banks after the craft.
  async function reservedForCrafting(command: MerchantCommand, slot: number) {
    let protection = command.craftProtection;
    if (command.jobId) {
      const result = await p.request('/merchant/checkpoint', { method: 'POST', body: { jobId: command.jobId, commandId: command.id || command.commandId, protectionOnly: true } });
      protection = result?.craftProtection;
      if (!protection) throw Error('Craft reservations unavailable; bank deposit deferred');
    }
    if (!protection) return false;
    if (protection.error) return true;
    const entries = me().items.map((item: ItemCopy | null, index: number) => item ? { item, slot: index, craftLocation: inventoryPack(me().name) } : null);
    const available = availableCraftStock(entries, protection);
    return !available[slot] || stackQuantity(available[slot]!.item) < stackQuantity(me().items[slot]);
  }
  // A bank mark an improvement of this job works on stays in the bag for the job.
  function improvementReserved(command: MerchantCommand, item: ItemCopy) {
    const level = Number(item.level) || 0;
    return (command.type === 'merchant-self-improve' || command.type === 'merchant-service') && (
      (command.upgrades || []).some(work => work.item && work.item.name === item.name &&
        level >= (Number(work.item.level) || 0) && level <= (Number(work.item.level) || 0) + Number(work.tiers || 1)) ||
      (command.compounds || []).some(group => (group.items || []).some(work => sameItem(item, work.item))) ||
      (command.autoCompounds || []).some(rule => item.name === rule.name && level < rule.targetTier) ||
      (command.bankUpgradeRules || []).some(rule => item.name === rule.name && level >= rule.level && level <= rule.level + rule.tiers)) ||
      (command.merchantWithdrawals || []).some(work => work.improvement && sameItem(item, work.item));
  }
  // The visit's errands, once per job: the gold above the target banks, the job's withdrawals ride
  // the visit while a cell past the protected free slots stays, the bank marks store, and
  // the NPC sale copies come out. Each withdrawal is confirmed.
  async function merchantBankErrands(command: MerchantCommand, activity: Activity) {
    if (command._merchantBankErrandsChecked) return;
    command._merchantBankErrandsChecked = true;
    command._merchantWithdrawalsCompleted = [];
    command._merchantBankedCompleted = [];
    command._npcSalesRetrieved = [];
    const goldTarget = Number.isInteger(command.merchantGoldTarget) ? Math.max(0, command.merchantGoldTarget!)
      : Number.isInteger(command.goldTarget) ? Math.max(0, command.goldTarget!) : 0;
    if (me().gold > goldTarget) {
      const deposit = me().gold - goldTarget;
      await p.bankDeposit(deposit);
      activity.push({ level: 'success', message: 'Deposited ' + deposit.toLocaleString() + ' merchant gold' });
    }
    const withdrawals = command.merchantWithdrawals || [];
    for (let i = 0; i < withdrawals.length; i += 1) {
      if (p.reads.freeInventorySlots() <= p.protectedSlots()) {
        if (command.type === 'merchant-self-improve') command._capacityDeferredWithdrawals = withdrawals.slice(i).filter(entry => !isBankboiPack(entry.pack));
        activity.push({ level: 'info', message: 'Deferred withdrawals; the protected free slots are reached' });
        break;
      }
      const withdrawal = withdrawals[i]!;
      if (isBankboiPack(withdrawal.pack)) continue;
      const found = findBankItem(withdrawal.item, withdrawal.pack, withdrawal.slot);
      if (!found) {
        // Inside the bank the whole bank is in view, so a missing copy's reservation is stale.
        command._merchantWithdrawalsCompleted.push(withdrawal.deconstructionId ? { ...withdrawal, deconstructionMissing: true } : withdrawal);
        activity.push({ level: 'info', message: 'Removed stale merchant withdrawal: ' + withdrawal.item.name });
        continue;
      }
      const filled = me().items.map((item: ItemCopy | null) => !!item);
      await bankRetrieveConfirmed(found.pack, found.slot);
      // The bag cell the copy landed in: a compound mark reserved on the withdrawn bank cell takes
      // the copy there (production.ts `prepareBankCompounds`).
      const landed = me().items.findIndex((item: ItemCopy | null, index: number) => !filled[index] && sameItem(item, withdrawal.item));
      if (landed >= 0) (command._merchantWithdrawalsLanded ||= []).push({ pack: withdrawal.pack, slot: withdrawal.slot, inventorySlot: landed });
      command._merchantWithdrawalsCompleted.push(withdrawal);
      activity.push({ level: 'success', message: 'Withdrew ' + withdrawal.item.name + ' for merchant' });
    }
    for (const mark of command.merchantBankMarked || []) {
      const item = (mark as { item?: ItemCopy }).item || mark as ItemCopy;
      if (improvementReserved(command, item)) continue;
      const slot = p.reads.findMarkedItem(mark as { slot?: number; item: ItemCopy });
      if (slot < 0) {
        // The saved rule stays; this slot's mark is stale once the copy left the bag.
        command._merchantBankedCompleted.push(mark);
        activity.push({ level: 'info', message: 'Removed stale merchant bank mark: ' + item.name });
        continue;
      }
      try {
        if (await reservedForCrafting(command, slot)) {
          activity.push({ level: 'info', message: 'Kept ' + item.name + ' reserved for crafting or delivery' });
          continue;
        }
        await bankStoreFully(slot);
      } catch (error: any) {
        if (error?.code !== 'bank_full') throw error;
        // A full bank keeps the mark for the next visit; the job goes on with the bag it has.
        activity.push({ level: 'info', message: 'Bank full; deferred deposit of ' + item.name + '; continuing merchant work' });
        continue;
      }
      command._merchantBankedCompleted.push(mark);
      activity.push({ level: 'success', message: 'Banked ' + item.name + ' from merchant inventory' });
    }
    for (const sale of command.npcSales || []) {
      if (p.reads.findItem(sale.item) >= 0 || sale.source === 'merchant') continue;
      if (p.reads.freeInventorySlots() <= p.protectedSlots()) {
        activity.push({ level: 'info', message: 'Deferred NPC-sale withdrawal; the protected free slots are reached' });
        break;
      }
      const found = findBankItem(sale.item, sale.pack, sale.slot);
      if (!found) continue;
      await bankRetrieveConfirmed(found.pack, found.slot);
      command._npcSalesRetrieved.push(sale.id);
      activity.push({ level: 'success', message: 'Withdrew ' + sale.item.name + ' for NPC sale' });
    }
  }
  // The merchant's bank visit: the job's stage, the walk from the stand, the errands between
  // two BankBoi checkpoints and the floor's sort, which runs on every visit.
  async function merchantVisitBank(command: MerchantCommand, activity: Activity) {
    await p.operationStage(command, command.operationStage === 'storing' ? 'storing' : 'retrieving');
    await p.leaveStand();
    await bankSortMove('bank');
    await waitForBankPack('items0');
    await bankboiCheckpoint();
    await merchantBankErrands(command, activity);
    await bankboiCheckpoint();
    try { await sortCurrentBankFloor(activity); }
    catch (error: any) { activity.push({ level: 'error', message: 'Bank sorting failed', details: String(error?.reason || error?.message || error) }); }
    // A requested sort settles inside the visit: a merchant with no stand gets no stand return and
    // stays in the bank after its job, so the walk out may never come. The walk out then finds this
    // visit's sort already attempted.
    try {
      if (!sortFlight) sortFlight = finishRequestedSort().finally(() => { sortFlight = null; });
      await sortFlight;
    } catch (error: any) { activity.push({ level: 'error', message: 'Bank sorting needs retry', details: String(error?.message || error) }); }
  }
  // A BankBoi's run (the transaction on the worker): provision, unload into the normal bank,
  // carry piles to their homes, stage the requests, deposit the retrievals into the staging row,
  // sort, then report. Every store and bag move is confirmed by the game's change.
  async function runBankboiService(command: BankboiCommand) {
    if (!await p.bag.acquire('banking')) throw itemFailure('interrupted', 'BankBoi visit already running');
    const activity: Activity = [], completed: unknown[] = [], deposited: unknown[] = [], relocated: unknown[] = [];
    const walk = (destination: unknown) => bankSortMove(destination);
    const kept = (item: ItemCopy) => (command.protectedItems || []).some(wanted => stackKey(wanted) === stackKey(item));
    const reserved = (pack: string, slot: number) => (command.reservedLocations || []).some(cell => cell.pack === pack && cell.slot === slot);
    // The first empty cell of the staging row, the BankBoi's transfer pane.
    const stagingFree = () => stagingCells.find(slot => !bank()[STAGING_PACK][slot]);
    async function unloadNormalBank() {
      if (!command.unload) return;
      for (let slot = 0; slot < me().items.length; slot += 1) {
        let item = me().items[slot];
        if (!item || kept(item) || (command.retrievals || []).some(r => stackKey(r.item) === stackKey(item))) continue;
        await stacks.fill(slot);
        if (!me().items[slot]) { relocated.push({ sourceSlot: slot, item: p.reads.fingerprint(item) }); continue; }
        item = me().items[slot];
        const allowed = await stacks.locations(), limit = stackLimit(item);
        let empty: Cell | null = null, merge: Cell | null = null;
        for (const pack of Object.keys(bank()).sort()) {
          if (!Array.isArray(bank()[pack])) continue;
          for (let target = 0; target < BANK_PACK_CELLS; target += 1) {
            if (!allowed.some(cell => cell.pack === pack && cell.slot === target) || reserved(pack, target)) continue;
            const existing = bank()[pack][target];
            if (!existing && !empty) empty = { pack, slot: target };
            if (existing && !merge && limit > 1 && stackKey(existing) === stackKey(item) && stackQuantity(existing) + stackQuantity(item) <= limit)
              merge = { pack, slot: target };
          }
        }
        const destination = merge || empty;
        if (!destination) continue;
        const floor = definitions()[destination.pack]?.[0];
        if (floor && me().map !== floor) await walk(floor);
        await waitForBankPack(destination.pack);
        const current = bank()[destination.pack][destination.slot];
        if (merge ? !current || stackKey(current) !== stackKey(item) || stackQuantity(current) + stackQuantity(item) > limit : !!current) continue;
        await p.bankStore(slot, destination.pack, merge ? undefined : destination.slot);
        if (!await settles(p, () => !me().items[slot])) throw itemFailure('not_confirmed', 'Bank did not accept ' + item.name);
        relocated.push({ sourceSlot: slot, item: p.reads.fingerprint(item), pack: destination.pack, slot: destination.slot });
      }
      if (me().map && me().map !== 'bank') await walk('bank');
    }
    // A craft retrieval's deposit goes to the first free vault cell outside the staging row.
    function craftDepositLocation(): Cell | null {
      for (const pack of Object.keys(bank()).filter(isVaultPack)) {
        if (!Array.isArray(bank()[pack])) continue;
        for (let slot = 0; slot < BANK_PACK_CELLS; slot += 1) if (!bankStagingSlot(pack, slot) && !bank()[pack][slot]) return { pack, slot };
      }
      return null;
    }
    const report = () => ({ character: me().name, commandId: command.id, activity, completed, deposited, relocated, bank: p.reads.bankSnapshot(),
      items: me().items.map((item: ItemCopy | null, slot: number) => item ? { slot, item: p.reads.fingerprint(item), meta: p.reads.itemDefinition(item) } : null) });
    try {
      if (command.provision) {
        await walk('potions');
        for (const slot of Object.keys(me().slots || {})) if (me().slots[slot]) await p.unequip(slot);
        for (let slot = 0; slot < me().items.length; slot += 1) if (me().items[slot]) await p.sell(slot, stackQuantity(me().items[slot]));
      }
      await walk('bank');
      // The walk can end on the map change before the game sends the vaults, so the staging row
      // is read only once its pack is there.
      await waitForBankPack(STAGING_PACK);
      if (command.provision && me().gold > 0) await p.bankDeposit(me().gold);
      await unloadNormalBank();
      for (let slot = 0; slot < me().items.length; slot += 1) {
        const item = me().items[slot];
        if (!item || (command.retrievals || []).some(r => sameItem(item, r.item)) || kept(item)) continue;
        const home = command.stackHomes?.[stackKey(item)];
        if (!home || home.owner === me().name || Number(home.room) < stackQuantity(item)) continue;
        if (home.owner === 'bank') {
          if (!await mergeIntoNormalBank(slot)) continue;
        } else {
          const staging = stagingFree();
          if (staging === undefined) break;
          await bankStageConfirmed(slot, STAGING_PACK, staging);
        }
        home.room = Number(home.room) - stackQuantity(item);
      }
      for (const wanted of command.requests || []) {
        const staged = bank()[wanted.pack]?.[wanted.slot];
        // The named cell only: a search could take the normal bank's pile after the staged copy
        // moved or was used.
        if (!staged || stackKey(staged) !== stackKey(wanted.item)) { completed.push(wanted.id); continue; }
        const limit = stackLimit(staged);
        const mergeFits = limit > 1 && me().items.some((item: ItemCopy | null) => item && stackKey(item) === stackKey(staged) && stackQuantity(item) + stackQuantity(staged) <= limit);
        if (p.reads.freeInventorySlots() <= 0 && !mergeFits) break;
        const home = normalBankStackFits(staged);
        const before = me().items.map((item: ItemCopy | null) => item && JSON.stringify(item));
        await bankRetrieveConfirmed(wanted.pack, wanted.slot);
        if (home) {
          const received = me().items.findIndex((item: ItemCopy | null, slot: number) => item && stackKey(item) === stackKey(staged) && JSON.stringify(item) !== before[slot]);
          if (received >= 0) await mergeIntoNormalBank(received);
        }
        completed.push(wanted.id);
      }
      await unloadNormalBank();
      for (const retrieval of command.retrievals || []) {
        const slot = p.reads.findItem(retrieval.item), staging = stagingFree();
        const destination = (retrieval.craftJobId ? craftDepositLocation() : null) || (staging !== undefined ? { pack: STAGING_PACK, slot: staging } : null);
        if (slot < 0 || !destination) break;
        const floor = definitions()[destination.pack]?.[0];
        if (floor && me().map !== floor) await walk(floor);
        await waitForBankPack(destination.pack);
        const item = p.reads.fingerprint(me().items[slot]);
        await bankStageConfirmed(slot, destination.pack, destination.slot);
        deposited.push({ request: retrieval, pack: destination.pack, slot: destination.slot, item });
        if (floor && floor !== 'bank') await walk('bank');
      }
      try { if (!relocated.length && !deposited.length) await sortCurrentBankFloor(activity); }
      catch (error: any) { activity.push({ level: 'error', message: 'Bankboi bank sorting failed', details: String(error?.reason || error?.message || error) }); }
      // The BankBoi's own bag in the packed layout; each move is confirmed by the cell's change, and
      // an unconfirmed one ends the sort with the bag the report then carries.
      const order = me().items.filter(Boolean).sort(compareBankItems).map((item: ItemCopy) => p.reads.fingerprint(item));
      for (let target = 0; target < order.length; target += 1) {
        const wanted = order[target];
        if (sameItem(me().items[target], wanted)) continue;
        const source = me().items.findIndex((item: ItemCopy | null, slot: number) => slot >= target && sameItem(item, wanted));
        if (source < 0) continue;
        await p.swap(source, target);
        if (!await settles(p, () => sameItem(me().items[target], wanted))) {
          activity.push({ level: 'error', message: 'BankBoi bag sort stopped: a swap was not confirmed' });
          break;
        }
      }
      await p.request('/bankboi/complete', { method: 'POST', body: { ...report(),
        slots: Object.keys(me().slots || {}).reduce((out: Record<string, unknown>, key) => {
          if (me().slots[key]) out[key] = { item: p.reads.fingerprint(me().slots[key]), meta: p.reads.itemDefinition(me().slots[key]) };
          return out;
        }, {}), gold: me().gold } });
    } catch (error: any) {
      // Failures with no failure code: the run's failures resume as interruptions.
      await p.request('/bankboi/complete', { method: 'POST', body: { ...report(),
        error: String(error?.reason || error?.message || error), code: error?.code || 'interrupted' } });
    } finally {
      p.bag.release('banking');
    }
  }
  const complete = (command: MerchantCommand, body: Record<string, unknown>) =>
    p.request('/merchant/complete', { method: 'POST', body: { jobId: command.jobId, ...body } });
  const failure = (error: any) => String(error?.reason || error?.message || error);
  // The merchant's gold set to the job's target, depositing the surplus or taking the shortfall
  // the bank holds.
  async function merchantSelfBank(command: MerchantCommand) {
    const activity: Activity = [], target = Number.isInteger(command.goldTarget) ? Math.max(0, command.goldTarget!) : 0;
    const delivered = () => ({ merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [], merchantBanked: command._merchantBankedCompleted || [] });
    try {
      await merchantVisitBank(command, activity);
      if (me().gold > target) await p.bankDeposit(me().gold - target);
      else if (me().gold < target) await withdrawMerchantCash(Math.min(target - me().gold, Number(bank().gold) || 0), command);
      activity.push({ level: 'success', message: 'Merchant bank balance set to ' + target.toLocaleString() + ' gold' });
      await complete(command, { success: true, ...delivered(), activity });
    } catch (error: any) {
      try { await complete(command, { success: false, error: failure(error), code: error?.code, ...delivered(),
        activity: [{ level: 'error', message: 'Merchant bank exchange failed', details: failure(error) }] }); }
      catch (report: any) { p.log('Merchant bank exchange failure report failed: ' + failure(report), 'red'); }
      throw error;
    }
  }
  // A floor's access by its key, or a vault bought with gold. Entering the floor at once puts its
  // free base pack in the next bank snapshot, so the dashboard offers that floor's vaults without
  // another visit.
  async function merchantBankUnlock(command: MerchantCommand & { key?: string; pack: string; floor?: string; gold?: number }) {
    const activity: Activity = [];
    try {
      if (command.key) {
        let keySlot = p.reads.findInventoryItemByName(command.key);
        if (keySlot < 0) {
          await merchantVisitBank(command, activity);
          await retrieveFromBankUntil(command.key, 1);
          keySlot = p.reads.findInventoryItemByName(command.key);
        }
        if (keySlot < 0) throw Error('Required bank key is no longer owned: ' + command.key);
        await p.activate(keySlot);
        await p.move(p.findNpc(command.pack), undefined, { request: p.errand() });
        activity.push({ level: 'success', message: 'Unlocked access with ' + command.key, details: command.floor });
      } else {
        await p.move(p.findNpc(command.pack), undefined, { request: p.errand() });
        if (!me().bank) throw Error('Could not reach ' + command.floor);
        if (me().bank[command.pack]) throw Error(command.pack + ' is already unlocked');
        const cost = Math.max(0, Number(command.gold) || 0);
        if (me().gold < cost) {
          const shortfall = cost - me().gold;
          if ((Number(me().bank.gold) || 0) < shortfall)
            throw itemFailure('short_gold', 'Insufficient bank gold: need ' + cost.toLocaleString() + ' gold to unlock ' + command.pack);
          await withdrawMerchantCash(shortfall, command);
        }
        const result = await p.openBankPack(command.pack);
        if (result?.failed) throw Error(result.reason || 'bank vault unlock failed');
        activity.push({ level: 'success', message: 'Unlocked bank vault ' + command.pack, details: cost.toLocaleString() + ' gold' });
      }
      await complete(command, { success: true, activity });
    } catch (error: any) {
      try { await complete(command, { success: false, error: failure(error), code: error?.code,
        activity: activity.concat([{ level: 'error', message: 'Bank unlock failed', details: failure(error) }]) }); }
      catch (report: any) { p.log('Bank unlock failure report failed: ' + failure(report), 'red'); }
      throw error;
    }
  }
  // The Tracktrix copy kept in the bag's last cell, as the bag holder's `pinning` operation. The
  // game's imove swaps two different copies, an occupied last cell too; the pin ends once the bag
  // shows the copy there, or two measured round trips after.
  async function keepTracktrixLast() {
    if (!p.current() || me().rip || p.bag.errandFor('trackerPin') || p.othersBusy()) return;
    const last = (Number(me().isize) || me().items.length) - 1;
    if (last < 0 || p.isTracker(me().items[last])) return;
    const source = me().items.findIndex((item: unknown) => p.isTracker(item));
    if (source < 0 || p.bag.take('pinning') !== 'taken') return;
    try {
      await p.swap(source, last);
      await settles(p, () => !p.current() || p.isTracker(me().items[last]));
    } finally {
      p.bag.release('pinning');
    }
  }
  //: the hands' look for an item in the bank: the walk, then one withdrawal. True when the
  // bank was reached and read in this runtime.
  async function fetch(name: string): Promise<boolean> {
    await p.walkToBank();
    if (!p.current()) return false;
    if (!me().bank) throw Error('Bank inventory unavailable while looking for ' + name);
    await retrieveFromBankUntil(name, 1);
    return p.current();
  }

  //: the merchant's bag merge, the bag holder's `merging` operation, so it waits for
  // production and a bank visit that hold the bag. The coordinator plans each merge from the bag this
  // character sends, since its records name the copies a merge must leave; the game's `can_stack`
  // answers whether the planned count merges. A partial fill splits that count into a free cell first.
  // The merge goes on while each move reaches its planned counts and another merge is planned, and
  // ends when none is or a move changes nothing. A merge that failed is tried again once the bag
  // changes (v1.5.0 shared.js:9486:9553-9558). The merchant job
  // owner's job asks the merge inside its own command (lifecycle intake's band), so the merge skips
  // while another inventory command runs and the next job start merges again; an unconfirmed move or a
  // call's error ends the merge, and `stackError` keeps its reason until a merge lands.
  let mergeFailed: string | null = null, stackError: string | null = null;
  const bagState = () => JSON.stringify(me().items);
  async function mergeBag(): Promise<number> {
    if (me().ctype !== 'merchant' || !p.current() || mergeFailed === bagState() || p.bag.facts().inventoryCommands > 1) return 0;
    // A merge already running answers for this ask: two merges never plan over one bag.
    if (!await p.bag.acquire('merging')) return 0;
    let merged = 0;
    const unconfirmed = () => { mergeFailed = bagState(); stackError = 'Inventory stack merge was not confirmed'; };
    try {
      while (p.current()) {
        const items = me().items.map((item: ItemCopy | null, slot: number) => item ? { slot, item } : null);
        // A failed permission request says nothing about the bag, so it ends the merge without
        // marking the bag failed and the next ask plans the same bag again.
        let plan;
        try {
          plan = (await p.request('/merchant/stack-merge-permission', { method: 'POST', body: { character: me().name, items } }))?.merge;
        } catch (error: any) {
          stackError = String(error?.reason || error?.message || error);
          break;
        }
        if (!plan) break;
        const target = me().items[plan.to], source = me().items[plan.from];
        const unchanged = (item: ItemCopy | null, planned: ItemCopy) => !!item && sameItem(item, planned) && stackQuantity(item) === stackQuantity(planned);
        if (!unchanged(target, plan.target) || !unchanged(source, plan.source) || target.l || source.l ||
          !p.canStack(target, { ...source, q: plan.quantity })) { mergeFailed = bagState(); break; }
        const total = stackQuantity(target) + plan.quantity;
        let from = plan.from;
        if (plan.quantity < stackQuantity(source)) {
          // The game's split puts the part in the first empty bag cell.
          const part = () => me().items.findIndex((item: ItemCopy | null, slot: number) => !items[slot] && !!item &&
            stackKey(item) === stackKey(source) && stackQuantity(item) === plan.quantity);
          await p.split(plan.from, plan.quantity);
          if (part() < 0 && !await settles(p, () => part() >= 0)) { unconfirmed(); break; }
          from = part();
        }
        await p.swap(plan.to, from);
        const reached = () => !me().items[from] && stackQuantity(me().items[plan.to]) === total;
        if (!reached() && !await settles(p, reached)) { unconfirmed(); break; }
        mergeFailed = null;
        stackError = null;
        merged += 1;
      }
    } catch (error: any) {
      mergeFailed = bagState();
      stackError = String(error?.reason || error?.message || error);
    } finally { p.bag.release('merging'); }
    return merged;
  }
  return { stackKey, packsOnFloor, findBankItem, waitForBankPack, bankRetrieveConfirmed, bankStageConfirmed, retrieveFromBankUntil,
    bankStoreFully, fetch, observeVisit, accessibleFloors, bankSortMove, sortCurrentBankFloor, stockUp, stockUpOnReply, bagStill, useElixir, goBank,
    withdrawMerchantCash, merchantVisitBank, runBankboiService, merchantSelfBank, merchantBankUnlock, keepTracktrixLast, mergeBag,
    stackError: () => stackError };
}
export type BankAnswers = ReturnType<typeof createBank>;

// The copies an automatic compound rule
// leaves once its triplets are held go to the bank, one confirmed deposit at a time, each pass
// planned again from the stock it reads; a bag's cells bound the passes.
export interface LeftoverPorts {
  refresh(): Promise<void>;
  rules(): CompoundRule[];
  stock(): (InventoryEntry | null | undefined)[];
  inventorySize(): number;
  visitBank(): Promise<void>;
  deposit(slot: number): Promise<void>;
  log(message: string): void;
}
export async function storeCompoundLeftovers(ports: LeftoverPorts): Promise<void> {
  const leftovers = () => {
    const stock = ports.stock();
    return compoundStorageLeftovers(ports.rules(), stock.slice(0, ports.inventorySize()), stock);
  };
  await ports.refresh();
  if (!leftovers().length) return;
  await ports.visitBank();
  for (let remaining = ports.inventorySize(); remaining > 0; remaining--) {
    await ports.refresh();
    const entry = leftovers().find(value => Number.isSafeInteger(value.slot));
    if (!entry) break;
    await ports.deposit(entry.slot!);
    ports.log('Banked ' + entry.item!.name + ' while waiting for an auto compound group');
  }
}

// Inventory, bank and commerce's character half:
// the install of `partyItems` and the bag holder. shared.js reaches it through
// `globalThis.partyItems`, as it reaches 08 through `partyMerchant`, and connects the bag's reads once.
import { ERRAND_ROWS, itemFailure, PROTECTED_FREE_SLOTS_DEFAULT, tripLabel, type ErrandFact, type ErrandReader } from '../rules.ts';
import { createBagReads, type BagPorts } from './bag.ts';
import { createBank, storeCompoundLeftovers, type BankAnswers, type BankPorts } from './bank.ts';
import { createProduction, type ProductionPorts } from './production.ts';
import { createMarket, exchangeRewards, type MarketAnswers, type MarketPorts } from './market.ts';
import { bankGame, marketGame, productionGame, sendGold } from './calls.ts';
import { partyHooks } from '../../hooks/index.ts';
import type { Registration } from '../../hooks/registry.ts';

// The operations that hold the bag one at a time (3.4). A preview counts as upgrading for the readers
// of today's `upgrading` flag, which the preview set. `producing` is a merchant's production attempt
// or its recovery, which today's `__partyProductionWorking` and `__partyProductionRecovery` held.
// `purchasing` is a commerce order, whose bought copies nothing else moves while it runs.
// `pinning` is the Tracktrix pin, `tidying` the merchant's tidy and `merging` the bag
// merge.
export type BagOperation = 'banking' | 'stocking' | 'upgrading' | 'previewing' | 'producing' | 'purchasing' | 'pinning' | 'tidying' | 'merging';
// The character reads the facts carry that no holder record gives: the bag's free cells, the lucky
// slot service, whose half-done swap stays pending across a reload, the character's map for the card
// label, its name for the reply's per-character fields, and whether the character is a merchant.
export interface BagReads { freeCells(): number; lucky(): boolean; map(): string; merchant(): boolean; name(): string }
// The items owner's reply fields (coordinator/owner.ts `reply`) and the per-character merchant settings, as the
// last reply delivered them. A coordinator without `bankStaging` keeps its reservation.
interface ItemReply {
  bankQueued?: unknown; bankboiStorage?: unknown; bankStaging?: unknown; bankStackHomes?: Record<string, unknown> | null;
  merchantGoldTarget?: unknown; protectedSlots?: unknown; merchantWeapon?: { item?: unknown } | null;
  restockPolicies?: Record<string, unknown> | null; pontyWanted?: unknown;
}
export interface BagFacts {
  banking: boolean; bankQueued: boolean; stocking: boolean; upgrading: boolean; previewing: boolean;
  tidying: boolean; lucky: boolean; holder: BagOperation | null; freeCells: number; inventoryCommand: boolean; inventoryCommands: number;
  // The bank and potion trips' card label for the status owner's line table, today's words
  // (runtime/status/coordinator/line.ts), or null.
  label: string | null;
}

export function createBag() {
  let holder: BagOperation | null = null, commands = 0, reads: BagReads | null = null, taken = 0;
  let waiters: (() => void)[] = [];
  let bankQueued = false, bankboiStorage = false, staging = true, stackHomes: Record<string, unknown> = {}, cashTarget = 0;
  // The reserve holds from the first tick: the setting's default stands until the coordinator's
  // item-settings reply, which always carries the player's value (coordinator/owner.ts).
  let protectedSlots = PROTECTED_FREE_SLOTS_DEFAULT, weapon: { item?: unknown } | null = null, restockPolicy: unknown = null;
  // Whether the coordinator's readers need Ponty's listings, from the last reply.
  let pontyWanted = false;
  // shared.js connects the reads at its install, before any bag reader runs. A read before that is
  // an order bug at the caller, and it throws.
  function connected(): BagReads {
    if (!reads) throw Error("The bag's reads are read before shared.js connects them");
    return reads;
  }
  // `held:<holder>` while another operation holds the bag.
  function take(name: BagOperation): 'taken' | `held:${BagOperation}` {
    if (holder) return `held:${holder}`;
    holder = name;
    taken += 1;
    return 'taken';
  }
  // Each holder releases in its `finally`; the release wakes the operations that wait for it.
  function release(name: BagOperation): void {
    if (holder !== name) return;
    holder = null;
    const woken = waiters;
    waiters = [];
    for (const wake of woken) wake();
  }
  // Takes the bag once its holder releases it. An operation that already holds it answers false,
  // as today's `if (banking) return`, so a second visit never runs inside the first.
  async function acquire(name: BagOperation): Promise<boolean> {
    while (holder) {
      if (holder === name) return false;
      await new Promise<void>(wake => waiters.push(wake));
    }
    holder = name;
    taken += 1;
    return true;
  }
  // Waits until `name` no longer holds the bag; a command that runs after the tidy waits on it.
  async function after(name: BagOperation): Promise<void> {
    while (holder === name) await new Promise<void>(wake => waiters.push(wake));
  }
  // An inventory command runs beside the holder, as today; the count is its fact.
  async function command<T>(run: () => Promise<T>): Promise<T> {
    commands += 1;
    try { return await run(); } finally { commands -= 1; }
  }
  function label(): string | null {
    return holder === 'banking' || holder === 'stocking' ? tripLabel(holder === 'stocking', connected().map() === 'bank') : null;
  }
  // Each fact is computed from the holder record when read. The flags scan no bag cell, so an
  // errand read costs no free-cell count or label.
  function flags(): Record<ErrandFact, boolean> {
    return {
      banking: holder === 'banking', bankQueued, stocking: holder === 'stocking',
      upgrading: holder === 'upgrading' || holder === 'previewing', previewing: holder === 'previewing',
      tidying: holder === 'tidying', lucky: connected().lucky(), inventoryCommand: commands > 0,
    };
  }
  function facts(): BagFacts {
    return { ...flags(), holder, freeCells: connected().freeCells(), inventoryCommands: commands, label: label() };
  }
  return {
    take, release, acquire, after, command, facts,
    // Every reply command runs in the command band, a convoy walk among them, so busy() reads the
    // holder alone and a running command holds no drain or Steam restore.
    busy: () => !!holder,
    // The bag runs a bank, potion or upgrade errand (turns' O-row `errands`, the hunting owner's busy read).
    errands: (): boolean => holder === 'banking' || holder === 'stocking' || holder === 'upgrading' || holder === 'previewing',
    // A merchant's tidy or lucky swap holds its bag (turns' O-row `merchantTidy`).
    merchantTidy: (): boolean => connected().merchant() && (holder === 'tidying' || connected().lucky()),
    // A bank visit runs or waits in the queue (the routine's `isBanking`).
    bankBound: (): boolean => holder === 'banking' || bankQueued,
    // The fighter half: the errand identity `items:<op>:<id>` of the holder's walks, so a newer
    // errand replaces an older one and movement's records name the bag operation.
    errand: (): string | null => holder ? `items:${holder}:${taken}` : null,
    // One bag fact, read from the holder record with no bag scan.
    fact: (name: ErrandFact): boolean => flags()[name],
    // The reader's row of rules.ts ERRAND_ROWS: whether the bag runs an errand that reader waits out.
    errandFor(reader: ErrandReader): boolean {
      const now = flags();
      return ERRAND_ROWS[reader].some(fact => now[fact]);
    },
    connect(next: BagReads): void { reads = next; },
    /** Table A's `bank-queue` row: the reply says this character's bank visit is queued. */
    queueReply(state: ItemReply): void { bankQueued = !!state.bankQueued; },
    /** Table A's `item-settings` row: the items owner's other reply fields and this character's merchant weapon and
     *  restock policy. */
    settingsReply(state: ItemReply): void {
      bankboiStorage = state.bankboiStorage === true;
      staging = state.bankStaging !== false;
      weapon = state.merchantWeapon || null;
      cashTarget = Math.max(0, Number(state.merchantGoldTarget) || 0);
      restockPolicy = state.restockPolicies && state.restockPolicies[connected().name()] || null;
      if (typeof state.protectedSlots === 'number') protectedSlots = state.protectedSlots;
      stackHomes = state.bankStackHomes || {};
      pontyWanted = state.pontyWanted === true;
    },
    bankboiStorage: () => bankboiStorage, staging: () => staging, stackHomes: () => stackHomes, cashTarget: () => cashTarget,
    protectedSlots: () => protectedSlots, restockPolicy: () => restockPolicy, pontyWanted: () => pontyWanted,
    /** The merchant weapon the hands keep. */
    weaponItem: () => weapon && weapon.item || null,
  };
}

// The install: one bag per character runtime, its reads (bag.ts) over shared.js's ports with the
// call budget's margin, and the failure with its failure code.
const bag = createBag();
const margin = () => partyHooks().calls.margin();
const bagReads = (ports: Omit<BagPorts, 'margin' | 'exchangeRewards'>) => createBagReads({ ...ports, margin, exchangeRewards });
// The journals the bank and production keep across a reload, one store. A journal is saved
// under `<key>:<character>`. caracAL's storage is an IPC-backed cache whose delayed echoes of older
// writes can replace its value, so this runtime's own writes, kept on the window, win over the stored
// copy. Production's commerce progress is stored under its own key, which names its character.
type JournalPorts = 'saved' | 'save' | 'stored' | 'store';
type JournalWindow = { localStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; __partyItemJournals?: Record<string, unknown> };
function journals(character: () => { name: string }): Pick<ProductionPorts, JournalPorts> {
  const root = globalThis as JournalWindow, own = () => root.__partyItemJournals ||= {};
  return {
    saved(key) {
      if (Object.hasOwn(own(), key)) return own()[key];
      return root.localStorage ? JSON.parse(root.localStorage.getItem(key + ':' + character().name) || 'null') : null;
    },
    save(key, value) {
      own()[key] = value;
      if (!root.localStorage) return;
      if (value === null) root.localStorage.removeItem(key + ':' + character().name);
      else root.localStorage.setItem(key + ':' + character().name, JSON.stringify(value));
    },
    stored: key => JSON.parse(root.localStorage?.getItem(key) || 'null'),
    store(key, value) {
      if (value == null) root.localStorage?.removeItem(key); else root.localStorage?.setItem(key, JSON.stringify(value));
    },
  };
}
// The bank (bank.ts), built once by shared.js over its reads and the module's own game calls
// (calls.ts). Its build publishes `items.fetch`, the hands' look for a missing item in
// this character's bank; shared.js reads the bag merge from the bank it built.
function bankOf(ports: Omit<BankPorts, 'margin' | 'saved' | 'save' | keyof typeof bankGame>): BankAnswers {
  const bank = createBank({ ...ports, ...journals(ports.character), ...bankGame, margin });
  publish({ name: 'core:items-bank', folder: 'core', author: 'adventureland-party-console',
    summary: "Answers the bank look for a missing item in this character's bank.",
    hooks: { 'items.fetch': (_character: string, item: string) => bank.fetch(item) } });
  return bank;
}
// The production (production.ts), built once by shared.js over the bank it built, with the bank's and
// its own game calls.
type ProductionGame = keyof typeof productionGame | 'swap' | 'buy' | 'unequip' | 'bankRetrieve' | 'split';
const productionOf = (ports: Omit<ProductionPorts, 'margin' | 'storeCompoundLeftovers' | ProductionGame | JournalPorts>) =>
  createProduction({ ...ports, ...journals(ports.character), ...bankGame, ...productionGame, margin, storeCompoundLeftovers });
// The market (market.ts), built once by shared.js, which reads the stand and the send from the
// market it built. Its build puts the loot timer and the departure's loot pass on
// partyItems, for the role runner and the hunting owner's loot passes.
function marketOf(ports: Omit<MarketPorts, 'margin' | 'game'>): MarketAnswers {
  const market = createMarket({ ...ports, game: marketGame, margin });
  partyItems.loot = market.loot;
  return market;
}
const partyItems: { loot?: MarketAnswers['loot'] } & Record<string, unknown> = { bag, bagReads, bank: bankOf,
  production: productionOf, market: marketOf, failure: itemFailure,
  // The game calls other owners' ports take from the items owner (calls.ts): the merchant jobs owner's visit unequips, equips, deposits
  // and sends gold, the merchant jobs owner's gathering splits a catch; the hunting owner's rare deploys its item.
  game: { unequip: bankGame.unequip, equip: productionGame.equip, bankDeposit: bankGame.bankDeposit, sendGold, split: bankGame.split } };
Object.assign(globalThis, { partyItems });
function publish(registration: Registration): void {
  const published = partyHooks().publish(registration);
  if (!published.ok) throw Error(`The items owner's character half did not load: ${published.message}`);
}
// Section 6 part 3's character read: `items.bag`, this character's holder facts (3.4).
publish({ name: 'core:items-bag', folder: 'core', author: 'adventureland-party-console',
  summary: "Answers the character's bag holder facts.",
  hooks: { 'items.bag': () => bag.facts(),
    // The bag holder holds a deploy's drain while an operation holds
    // the bag. A lucky swap left pending across a reload holds no bag, so it does not hold the drain;
    // The lifecycle owner decides whether it must.
    'lifecycle.ready': () => bag.busy() ? { ready: false, reason: bag.facts().label || 'the bag is held' } : { ready: true } } });
// The bag door targeting's ports read.
export type Bag = ReturnType<typeof createBag>;

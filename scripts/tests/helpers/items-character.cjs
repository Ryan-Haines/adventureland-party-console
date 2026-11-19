// The character half's harness
// (runtime/items/character/): builds production.ts and bank.ts over planted ports, with no game or shared.js
// context. The clock advances on each sleep and `tick` runs after it, so a row plants the game's
// change at the time it lands. Every port a row does not plant answers undefined.
const { createBag } = require('../../../runtime/items/character/owner.ts');
const { createBagReads } = require('../../../runtime/items/character/bag.ts');
const { createProduction } = require('../../../runtime/items/character/production.ts');
const { createBank } = require('../../../runtime/items/character/bank.ts');
const { createMarket } = require('../../../runtime/items/character/market.ts');
const { gameRealm } = require('../../../runtime/protocol/realm.ts');
const assert = require('node:assert/strict');

function planted(base) {
  return new Proxy(base, { get: (target, key) => key in target ? target[key] : key === 'then' ? undefined : async () => undefined });
}

// The ports production.ts, bank.ts and market.ts share, over one planted character and one clock.
// The bag reads are bag.ts's own (`createBagReads`) over the same character and G; a row's `reads`
// replace single answers. `saved` and `stored` are one map, as the character's storage is.
function basePorts({ character, G = { items: {}, skills: {} }, reads = {}, tick = () => {} }) {
  const clock = { now: 0 }, calls = [], stored = {};
  const base = {
    character: () => character, G: () => G, bankPacks: () => ({}), margin: () => 100, now: () => clock.now,
    sleep: async ms => { clock.now += Number(ms) || 0; tick(clock.now, character); },
    atomic: run => run(), call: (method, run) => { calls.push(method); return run(); }, log: () => {},
    saved: key => stored[key] ?? null, save: (key, value) => { stored[key] = value; },
    stored: key => stored[key] ?? null, store: (key, value) => { stored[key] = value; },
    protectedSlots: () => 0, partyLocation: () => null, findNpc: () => ({ map: 'main' }), clockOffset: () => 0, current: () => true,
    bag: createBag(), getPlayer: () => null, calculateItemProperties: null, itemProperties: () => null,
  };
  base.reads = planted({ ...createBagReads(planted({ ...base })), ...reads });
  // shared.js connects the bag's reads at its install, before any holder takes it.
  base.bag.connect({ freeCells: () => base.reads.freeInventorySlots(), lucky: () => false, map: () => character.map,
    merchant: () => character.ctype === 'merchant', name: () => character.name });
  return { base, clock, calls, stored };
}

function productionHarness({ character, G, ports = {}, reads = {}, bank = {}, tick } = {}) {
  const { base, clock, calls, stored } = basePorts({ character, G, reads, tick });
  const p = planted({
    ...base, skillReady: () => false, grade: () => 0, job: () => null, leaderLocation: () => null, equipDelivered: async () => [],
    bank: planted(bank), ...ports,
  });
  return { production: createProduction(p), p, bag: p.bag, clock, calls, stored };
}

// bank.ts over the same base ports.
function bankHarness({ character, G, ports = {}, reads = {}, tick } = {}) {
  const { base, clock, calls, stored } = basePorts({ character, G, reads, tick });
  const p = planted({
    ...base, status: () => {}, staging: () => false, stackHomes: () => ({}), errand: () => null, runtimeId: () => 'r1',
    merchantCashTarget: () => 0, restockPolicy: () => null, departing: () => false, escaping: () => false, othersBusy: () => false,
    ...ports,
  });
  return { bank: createBank(p), p, bag: p.bag, clock, calls, saved: stored };
}

// market.ts over the same base ports. `game` plants the game's calls and `merchant` the merchant jobs owner's and the calls owner's
// merchant answers; the merchant's live realm is the planted `realm` port's. The chests are `chests`, and
// the loot pass's progress lands on globalThis (market.ts `root`).
function marketHarness({ character, G, ports = {}, reads = {}, game = {}, merchant = {}, chests = {}, tick } = {}) {
  const { base, clock, calls, stored } = basePorts({ character, G, reads, tick });
  const listeners = {};
  const realm = { region: 'US', identifier: 'I' };
  const p = planted({
    ...base, game: planted(game), chests: () => chests, entities: () => ({}), cave: () => null, abtesting: () => undefined,
    realm: () => realm, on: (event, listener) => { listeners[event] = listener; }, off: event => { delete listeners[event]; },
    merchant: planted({ liveRealm: () => gameRealm(p.realm().region, p.realm().identifier), job: () => null, ...merchant }),
    production: planted({}), bank: planted({}),
    ...ports,
  });
  return { market: createMarket(p), p, bag: p.bag, clock, calls, stored, listeners, chests };
}

// The coordinator's protection checkpoint with no craft claim and no offering rule (production.ts
// `protectionCheckpoint`), which a manual upgrade reads before each attempt.
async function emptyCheckpoint(route, { body }) {
  assert.equal(route, '/merchant/checkpoint'); assert.equal(body.protectionOnly, true);
  return { craftProtection: { requirements: [] }, upgradeOfferingRules: [], upgradeOfferingStock: {} };
}

// The vault a production row withdraws from: `bank` plants bank.ts's lookup and confirmed
// withdrawal, `bankRetrieve` the game's call. Each withdrawal moves the copy into the bag's first empty
// cell, or the cell named, and logs its vault slot in `withdrawals`.
function vault(character) {
  const withdrawals = [];
  const bankRetrieve = async (pack, slot, to = character.items.indexOf(null)) => {
    withdrawals.push(slot);
    character.items[to] = character.bank[pack][slot];
    character.bank[pack][slot] = null;
  };
  const findBankItem = wanted => {
    for (const [pack, items] of Object.entries(character.bank)) {
      const slot = Array.isArray(items) ? items.findIndex(item => item && item.name === wanted.name && (item.level || 0) === (wanted.level || 0)) : -1;
      if (slot >= 0) return { pack, slot };
    }
    return null;
  };
  return { bank: { findBankItem, bankRetrieveConfirmed: bankRetrieve }, bankRetrieve, withdrawals };
}

// A merchant standing on the bank floor with one vault (bank-stacks.cjs `bankRuntime`), sorting under
// the automatic mode: the checkpoint answers `automatic` with no protected copy, so no lease holds the
// pass. `store` and `retrieve` plant the game's answer to each sort swap; by default each swaps the bag
// cell and the bank cell, and `swaps` logs each in the order the sort sent it.
function bankSortFloor({ vault, items = Array(6).fill(null), isize, G = {}, store, retrieve } = {}) {
  const { bankRuntime } = require('./bank-stacks.cjs');
  const swaps = [];
  // The floor's piles merge first (bank.ts `compact`) by the game's `can_stack`, within the G item `s`.
  const limits = Object.fromEntries(Object.entries(G.items || {}).filter(([, item]) => item.s).map(([name, item]) => [name, item.s]));
  const runtime = bankRuntime({ items7: vault }, items, limits, { G, character: { isize: isize ?? items.length }, ports: {
    request: async path => path === '/merchant/bank-sort/checkpoint' ? { mode: 'automatic', protection: { locations: [], items: [] } } : {},
    bankStore: async (inv, pack, slot) => { swaps.push(['store', inv, pack, slot]); return runtime.game.bank_store(inv, pack, slot); },
    bankRetrieve: async (pack, slot, inv) => { swaps.push(['retrieve', inv, pack, slot]); return runtime.game.bank_retrieve(pack, slot, inv); },
    publish: async () => { swaps.push(['publish']); },
  } });
  const { character } = runtime;
  if (store) runtime.game.bank_store = (inv, pack, slot) => store(inv, pack, slot, character);
  if (retrieve) runtime.game.bank_retrieve = (pack, slot, inv) => retrieve(pack, slot, inv, character);
  runtime.bank.observeVisit();
  return { ...runtime, swaps };
}

// The merchant's bag merge (bank.ts `mergeBag`). The permission answers storage.ts's
// `inventoryMergePlan` over the bag it is sent, with nothing reserved and a 9999 stack limit on
// every copy; `swap` plants the game's answer, by default the merge of the source into the target;
// `canStack` the game's `can_stack`.
function bagMerge({ items, swap, canStack: stacks, request } = {}) {
  const { inventoryMergePlan } = require('../../../runtime/items/coordinator/storage.ts');
  const { stackKey } = require('../../../runtime/items/identity.ts');
  // The game's `can_stack` for a planted 9999 limit: the same pile, and room for the count.
  const canStack = stacks || ((target, source) => stackKey(target) === stackKey(source) && target.q + source.q <= 9999);
  const character = { name: 'Merchant', ctype: 'merchant', map: 'main', items };
  const merged = (to, from) => { character.items[to] = { ...character.items[to], q: character.items[to].q + character.items[from].q }; character.items[from] = null; };
  const swaps = [], asks = [];
  const harness = bankHarness({ character, ports: {
    canStack,
    request: async (path, { body }) => {
      asks.push(path);
      if (request) await request(path);
      const bag = body.items.map(entry => entry && { ...entry, meta: { definition: { s: 9999 } } });
      return { merge: inventoryMergePlan({ merchantCharacter: 'Merchant' }, { name: 'Merchant', items: bag }) };
    },
    swap: async (to, from) => { swaps.push([to, from]); return (swap || merged)(to, from, character); },
  } });
  return { ...harness, character, swaps, asks };
}

module.exports = { planted, productionHarness, bankHarness, marketHarness, emptyCheckpoint, vault, bankSortFloor, bagMerge };

// The exchange rows run the items owner's merchantExchange (runtime/items/character/market.ts) on the items
const {scenarioTable}=require('./fixtures/scenarios.cjs');
// harness: the bank visit, withdrawals and merge are planted bank ports, and the exchange and
// exchange_buy are planted game calls.
const { createMovementContext } = require('./fixtures/movement-owner-callers.cjs');
const { marketHarness, planted } = require('./helpers/items-character.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function runtime(bank) {
  const calls = [];
  const character = { name: 'M', bank, items: Array(42).fill(null), level: 1 };
  const G = { items: { leather: { e: 40, name: 'Leather' } }, skills: {} };
  const ports = { request: async (url, options) => { calls.push({ url, body: options.body }); return {}; } };
  const vault = {
    merchantVisitBank: async () => calls.push('bank'), mergeBag: async () => 0,
    bankRetrieveConfirmed: async (pack, slot) => {
      calls.push(['retrieve', pack, slot]);
      character.items[0] = character.bank[pack][slot];
      character.bank[pack][slot] = null;
    },
  };
  const game = {
    exchange: async slot => { calls.push(['exchange', character.items[slot].q]); character.items[slot] = null; },
    exchangeBuy: async (num, name, q) => {
      calls.push({ event: 'exchange_buy', data: { num, name, q } });
      const item = character.items[num];
      assert.equal(q, item.q);
      item.q -= Math.max(1, G.tokens.funtoken[name]);
      if (!item.q) character.items[num] = null;
    },
  };
  const h = marketHarness({ character, G, game, ports: { findNpc: id => id, walk: async npc => calls.push(npc), bank: planted(vault),
    request: (...args) => ports.request(...args) } });
  return { r: { merchantExchange: h.market.merchantExchange, G, character }, calls, ports };
}

scenarioTable('a merchant exchange runs over the character runtime and the bank it is given',null,[
 ['token catalog includes every currency, bundles, and cosmetic reward identifiers',() => {
  const r = createMovementContext({});
  vm.runInContext(require('./helpers/downloaded-game.cjs').downloadedGameSource('data.js'), r);
  const { createBagReads } = require('../../runtime/items/character/bag.ts');
  const reads = createBagReads(planted({ character: () => ({ items: [] }), G: () => r.G, now: () => 0, bankPacks: () => ({}),
    sprite: id => ({ id }), exchangeRewards: require('../../runtime/items/character/market.ts').exchangeRewards }));
  const tokens = reads.merchantCatalog().exchangeable.filter(item => item.reward);
  assert.deepEqual([...new Set(tokens.map(item => item.id))].sort(), Object.keys(r.G.tokens).sort());
  const confetti = tokens.find(item => item.reward === 'confetti');
  assert.equal(confetti.required, 1); assert.equal(confetti.rewardQuantity, 100);
  assert.ok(tokens.some(item => item.reward === 'cxjar-xgravestone2'));
  assert.equal(tokens.find(item => item.id === 'monstertoken').npc, 'monsterhunter');
}],
 ['different rewards share a currency budget before travel',async () => {
  const {r, calls} = tokenRuntime(2);
  await assert.rejects(r.merchantExchange({exchanges:[
    {id:'funtoken',reward:'partyhat',quantity:1}, {id:'funtoken',reward:'confetti',quantity:1}
  ]}), /Not enough Fun Token/);
  assert.equal(calls.some(call => call.event === 'exchange_buy'), false);
}],
 ['token purchases preserve selected rewards through checkpoints and charge bundle cost',async () => {
  const {r, calls} = tokenRuntime(3);
  await r.merchantExchange({exchanges:[
    {id:'funtoken',reward:'confetti',quantity:1}, {id:'funtoken',reward:'partyhat',quantity:1}
  ]});
  assert.deepEqual(calls.filter(call => call.event).map(call => [call.data.name, call.data.q]),
    [['confetti',3],['partyhat',2]]);
  const progress = calls.filter(call => call.url === '/merchant/exchange-progress');
  assert.equal(progress[0].body.remaining[0].reward, 'partyhat');
  assert.equal(progress[1].body.remaining.length, 0);
  assert.equal(calls.at(-1).body.success, true);
}],
 ['unknown token reward is rejected without spending currency',async () => {
  const {r, calls} = tokenRuntime(3);
  await assert.rejects(r.merchantExchange({exchanges:[{id:'funtoken',reward:'invalid',quantity:1}]}), /no longer available/);
  assert.equal(calls.some(call => call.event), false);
}],
 ['40 level-less leather is withdrawn and delivered for one exchange',async () => {
  const { r, calls } = runtime({ items1: [null, { name: 'leather', q: 40 }] });
  await r.merchantExchange({ jobId: 'test', exchanges: [{ id: 'leather', level: 0, quantity: 1 }] });
  assert.deepEqual(calls.slice(0, 4), ['bank', ['retrieve', 'items1', 1], 'exchange', ['exchange', 40]]);
  assert.equal(calls.at(-1).body.success, true);
}],
 ['exchange lookup preserves requested levels',async () => {
  const bank = () => ({ items0: [{ name: 'leather', level: 1, q: 40 }, { name: 'leather', q: 40 }] });
  for (const [level, slot] of [[0, 1], [1, 0]]) {
    const { r, calls } = runtime(bank());
    await r.merchantExchange({ jobId: 'test', exchanges: [{ id: 'leather', level, quantity: 1 }] });
    assert.deepEqual(calls.find(Array.isArray), ['retrieve', 'items0', slot], 'level ' + level);
  }
  const { r, calls } = runtime(bank());
  await assert.rejects(r.merchantExchange({ exchanges: [{ id: 'leather', level: 2, quantity: 1 }] }), /Not enough Leather/);
  assert.equal(calls.some(Array.isArray), false);
}],
 ['insufficient leather reports failure without visiting exchange NPC',async () => {
  const { r, calls } = runtime({ items1: [] });
  await assert.rejects(r.merchantExchange({ exchanges: [{ id: 'leather', quantity: 1 }] }), /Not enough Leather/);
  assert.equal(calls.includes('exchange'), false);
  assert.equal(calls.at(-1).body.success, false);
}],
 ['BankBoi shortage yields the exchange before NPC travel',async () => {
  const { r, calls, ports } = runtime({ items1: [] });
  ports.request = async (url, options) => { calls.push({ url, body: options.body }); return url.endsWith('exchange-supply') ? { pending: true } : {}; };
  await assert.rejects(r.merchantExchange({ jobId: 'test', exchanges: [{ id: 'leather', quantity: 1 }] }), /bankboi_pending/);
  assert.equal(calls.includes('exchange'), false);
  assert.equal(calls.at(-1).body.error, 'bankboi_pending');
}],
 ['duplicate lines require their combined quantity before NPC travel',async () => {
  const { r, calls } = runtime({ items1: [{ name: 'leather', q: 40 }] });
  await assert.rejects(r.merchantExchange({ exchanges: [{ id: 'leather', quantity: 1 }, { id: 'leather', quantity: 1 }] }), /Not enough Leather/);
  assert.equal(calls.includes('exchange'), false);
}],
 ['confirmed exchanges checkpoint remaining work before returning to bank',async () => {
  const { r, calls } = runtime({ items1: [{ name: 'leather', q: 40 }] });
  await r.merchantExchange({ jobId: 'test', exchanges: [{ id: 'leather', quantity: 1 }] });
  const checkpoint = calls.findIndex(call => call.url === '/merchant/exchange-progress');
  assert.ok(checkpoint > 0);
  assert.equal(calls[checkpoint].body.remaining.length, 0);
  assert.equal(calls[checkpoint + 1], 'bank');
}],
 ['completed exchange resumes reward banking without repeating NPC exchange',async () => {
  const { r, calls } = runtime({ items1: [] });
  await r.merchantExchange({ jobId: 'retry', exchanges: [], exchangeResume: true });
  assert.equal(calls.includes('exchange'), false);
  assert.equal(calls.at(-1).body.success, true);
}],
]);

function tokenRuntime(quantity) {
  const setup = runtime({ items1: [{name:'funtoken', q:quantity}] });
  setup.r.G.items.funtoken = {name:'Fun Token', npc:'funtokens'};
  setup.r.G.tokens = {funtoken:{partyhat:2, confetti:0.01}};
  return setup;
}

// An exchange table at a level past +13 used to drop from the catalog, which looked levels up to a
// fixed top. The levels now come from G.drops itself.
test('exchange catalog lists every level table the game data holds, and only the base for an unleveled item', () => {
  const { createBagReads } = require('../../runtime/items/character/bag.ts');
  const G = { items: { ring: { e: 1, upgrade: {} }, gem: { e: 1 }, gem2: { e: 1 } }, skills: {},
    drops: { ring: [[1, 'gold', 1]], ring5: [[1, 'gold', 5]], ring14: [[1, 'gold', 14]], ring07: [[1, 'gold', 7]], ringx: [[1, 'gold', 1]],
      gem: [[1, 'gold', 1]], gem2: [[1, 'gold', 2]] } };
  const reads = createBagReads(planted({ character: () => ({ items: [] }), G: () => G, now: () => 0, bankPacks: () => ({}),
    sprite: id => ({ id }), exchangeRewards: require('../../runtime/items/character/market.ts').exchangeRewards }));
  const levels = id => reads.merchantCatalog().exchangeable.filter(item => item.id === id).map(item => item.level).sort((a, b) => a - b);
  assert.deepEqual(levels('ring'), [0, 5, 14]);
  assert.deepEqual(levels('gem'), [0]);
});

test('bankbois cannot be queued for merchant services; normal characters still can', () => {
  const party = { bankbois: { bankboi0: {} }, merchantCharacter: 'M', merchantQueue: [], merchantJobBlocks: {} };
  const r = createMovementContext({ party, stampMerchantJob: job => job, persistSettings() {}, dispatchMerchant() {} });
  require('./helpers/coordinator-merchant.cjs').merchantQueueRuntime(r);
  r.queueMerchant(['bankboi0', 'Warrior'], 'restock');
  assert.equal(party.merchantQueue.length, 1);
  assert.equal(party.merchantQueue[0].target, 'Warrior');
});

test('dispatch removes persisted bankboi jobs even while merchant is busy', () => {
  const party = { bankbois: { bankboi0: {} }, merchantCurrent: {},
    merchantQueue: [{ target: 'bankboi0', reason: 'restock' }, { target: 'Warrior', reason: 'restock' }] };
  const r = require('./helpers/coordinator-dispatch.cjs').dispatchRuntime(party);
  r.dispatchMerchant();
  assert.equal(r.party.merchantQueue.length, 1);
  assert.equal(r.party.merchantQueue[0].target, 'Warrior');
});

test('storage queues matching worker inventory once and honors item level', () => {
  const party = { merchantCharacter: 'M', withdrawals: {}, bankbois: { B: { name: 'B', items: [
    { slot: 2, item: { name: 'leather', level: 1, q: 99 } }, { slot: 3, item: { name: 'leather', q: 74 } }
  ] } } };
  const { queueExchangeStorage } = require('../../runtime/items/coordinator/storage.ts');
  party.withdrawals.M = [];
  const job = { exchanges: [{ id: 'leather', level: 0, quantity: 1 }] };
  assert.equal(queueExchangeStorage(job.exchanges, [{ id: 'leather', level: 0, quantity: 40 }], Object.values(party.bankbois), party.withdrawals.M), true);
  queueExchangeStorage(job.exchanges, [{ id: 'leather', level: 0, quantity: 40 }], Object.values(party.bankbois), party.withdrawals.M);
  assert.equal(party.withdrawals.M.length, 1);
  assert.equal(party.withdrawals.M[0].slot, 3);
  assert.equal(party.withdrawals.M[0].pack, 'bankboi:B');
});


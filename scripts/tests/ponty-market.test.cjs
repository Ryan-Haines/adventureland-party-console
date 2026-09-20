const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const market = require('../ponty-market.cjs');
test('identical items group across realms and quantities but not stats', () => {
  assert.equal(market.itemKey({ name: 'amulet', level: 0, q: 1, rid: 'a', p: null }),
    market.itemKey({ rid: 'b', name: 'amulet', q: 2 }));
  assert.notEqual(market.itemKey({ name: 'amulet', stat_type: 'int' }), market.itemKey({ name: 'amulet', stat_type: 'dex' }));
  assert.notEqual(market.itemKey({ name: 'amulet', p: 'shiny' }), market.itemKey({ name: 'amulet' }));
});
test('normalization preserves realm, age, full properties and realm-qualified rid', () => {
  const records = ['I', 'II'].map(serverIdentifier => ({ serverRegion: 'US', serverIdentifier,
    lastSeen: '2026-09-09T00:00:00Z', items: [{ name: 'coat', level: 0, rid: 'same', stat_type: 'int' }] }));
  const listings = market.normalize(records, [{ id: 'coat', meta: { definition: { g: 100 } } }]);
  assert.equal(listings.length, 2);
  assert.notEqual(listings[0].key, listings[1].key);
  assert.equal(listings[0].groupKey, listings[1].groupKey);
  assert.equal(listings[0].unitPrice, 120);
  assert.equal(listings[0].seenAt, Date.parse(records[0].lastSeen));
});
test('quantity selection never splits or overbuys stacks', () => {
  const lots = [3, 2, 2].map((quantity, key) => ({ quantity, key }));
  assert.equal(market.selectLots(lots, 4).reduce((sum, row) => sum + row.quantity, 0), 4);
  assert.equal(market.selectLots(lots, 1), null);
  assert.equal(market.selectLots(lots, -1), null);
});
test('compound valuation uses compound scroll prices, not upgrade scroll prices', () => {
  assert.equal(market.price({ name: 'amulet', level: 1 }, { definition: { g: 100, compound: {} } }, { cscroll0: 6400 }),
    Math.round(60 * 3.2 + 6400 / 2.4) * 2);
});
test('itinerary buys current-realm stock then the largest other realm', () => {
  const stock = [['US', 'I', 1], ['US', 'II', 2], ['US', 'III', 3], ['EU', 'I', 5]]
    .flatMap(([serverRegion, serverIdentifier, count]) => Array.from({ length: count }, (_, index) => ({
      serverRegion, serverIdentifier, quantity: 1, unitPrice: 100, key: serverRegion + serverIdentifier + index,
    })));
  const planned = market.planPurchase(stock, 5, 'USII');
  assert.deepEqual(planned.map(row => row.serverRegion + row.serverIdentifier), ['USII', 'USII', 'EUI', 'EUI', 'EUI']);
  const moved = market.planPurchase(stock, 5, 'SR_USIII');
  assert.deepEqual(moved.map(row => row.serverRegion + row.serverIdentifier), ['USIII', 'USIII', 'USIII', 'EUI', 'EUI']);
  assert.equal(market.planPurchase(stock, 2, 'USII').every(row => row.serverIdentifier === 'II'), true);
  assert.equal(market.planPurchase(stock, 3, 'ASIAI').every(row => row.serverRegion === 'EU'), true);
});
test('planning preserves retained objects and distinguishes partial from exact results', () => {
  const incomplete = {key: 'retained-without-quantity'};
  const available = {key: 'available', quantity: 2, unitPrice: 100};
  const listings = [incomplete, available];
  assert.equal(market.planPurchase(listings, 3), null);
  const partial = market.planPurchase(listings, 3, undefined, true);
  assert.deepEqual(partial, [available]);
  assert.equal(partial[0], available);
  assert.deepEqual(listings, [incomplete, available]);
  assert.deepEqual(market.planPurchase([incomplete], 1, undefined, true), []);
  assert.equal(market.planPurchase([incomplete], 1), null);
});

test('purchase revalidates exact properties and continues past stale listings', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../characters/shared.js'), 'utf8');
  const buys = [], progress = [], hops = [];
  const listings = ['wrong', 'valid'].map(rid => ({ key: 'US:II:' + rid, rid,
    item: { name: 'coat', level: 1, stat_type: 'int' }, quantity: 1, unitPrice: 120, price: 120,
    serverRegion: 'US', serverIdentifier: 'II' }));
  const r = vm.createContext({ character: { gold: 1000, items: Array(42).fill(null) }, parent: { server_region: 'US', server_identifier: 'II' },
    G: { items: { coat: {} } }, calculate_item_value: () => 60,
    smart_move: async () => {}, find_npc: () => 'ponty', refreshPontyListings: async () => {},
    get_secondhands: async () => listings.map(row => ({ ...row.item, rid: row.rid, stat_type: row.rid === 'wrong' ? 'dex' : 'int' })),
    buy_secondhand: async rid => buys.push(rid),
    guardedMarketPurchase: async (_command,_listing,_item,_price,q,purchase)=>{await purchase(q);return q},
    request: async (url, args) => { if (url.includes('progress')) progress.push(args.body); if (url.includes('realm-switch')) hops.push(args.body); return {}; },
  });
  vm.runInContext(source.slice(source.indexOf('  async function merchantPontyBuy('), source.indexOf('  async function merchantALDataAuth(')), r);
  vm.runInContext(source.slice(source.indexOf('  function freeInventorySlots('), source.indexOf('  async function requestMerchantCleanout(')), r);
  await r.merchantPontyBuy({ jobId: 'job', listings });
  assert.deepEqual(buys, ['valid']);
  assert.deepEqual(progress.map(row => row.success), [false, true]);
  assert.equal(hops.length, 0);
  buys.length = 0;
  await r.merchantPontyBuy({ jobId: 'job', listings, completedListingKeys: listings.map(row => row.key) });
  assert.equal(buys.length, 0, 'completed purchases survive realm-switch replay');
});

const test = require('node:test'), assert = require('node:assert/strict');
const {createCoordinatorMarketFeeds} = require('../../runtime/coordinator/commerce/market-feeds.ts');

function fixture(baseUrl) {
  const state = {aldata: {marketListings: [], marketBuyOrders: [], trades: [], key: 'test-key', auth: 'CORRECT'},
    ponty: {listings: []}, merchantCharacter: 'A', statuses: {A: {owner: 10}},
    merchantCatalog: {allItems: {}}, standPriceHistory: {}, standBids: {}, standListings: []};
  const requests = [], timers = [], calls = [], normalized = [];
  const service = createCoordinatorMarketFeeds(state, {
    baseUrl,
    now: () => 100000, sleep: async () => assert.fail('fixture is within request budget'),
    fetch: async (url, options) => {requests.push([url, options]); return new Response('[]');},
    timeout: milliseconds => {assert.equal(milliseconds, 20000); return new AbortController().signal;},
    queueMarket: () => calls.push('market'), queuePonty: () => calls.push('ponty'),
    persistSettings: () => calls.push('settings'), persistAuthentication: () => calls.push('authentication'),
    anniversary: () => ({nativeSlice: null, tradableNative: 0, missing: []}),
    normalizePonty: (records, items) => {normalized.push([records, items]); return [];},
    realmExists: () => true, every: (callback, ms) => timers.push({callback, ms}),
  });
  return {state, service, requests, timers, calls, normalized};
}

test('market feeds prime ALData and retain separate Ponty, merchant and trade cadences', async () => {
  const t = fixture(); assert.deepEqual(t.requests, []); assert.deepEqual(t.timers, []);
  t.service.start(); await new Promise(setImmediate);
  assert.deepEqual(t.timers.map(timer => timer.ms), [60000, 10000, 300000]);
  assert.deepEqual(t.requests.map(([url]) => url), ['https://aldata.earthiverse.ca/merchants', 'https://aldata.earthiverse.ca/trades']);
  assert.deepEqual(t.calls, ['market', 'settings']);
  const items = {leather: {s: 9999}}; t.state.merchantCatalog = {allItems: items};
  await t.timers[0].callback(); assert.equal(t.requests.at(-1)[0], 'https://aldata.earthiverse.ca/npcs/Ponty');
  assert.equal(t.normalized[0][1], items); assert.equal(t.calls.at(-1), 'ponty');
  await t.timers[1].callback(); assert.equal(t.requests.at(-1)[0], 'https://aldata.earthiverse.ca/merchants');
  await t.timers[2].callback(); assert.equal(t.requests.at(-1)[0], 'https://aldata.earthiverse.ca/trades');
});

test('market publication uses current merchant identity and current configured listings', async () => {
  const t = fixture(); assert.equal(t.service.owner(), '10');
  t.state.statuses = {B: {owner: 'owner/name'}}; t.state.merchantCharacter = 'B';
  t.state.standBids = {helmet: {minimumQuality: 8, price: 500, quantity: 2}};
  assert.equal(await t.service.aldata.publish(), true);
  const [url, options] = t.requests[0];
  assert.equal(url, 'https://aldata.earthiverse.ca/trades/owner%2Fname/test-key');
  assert.equal(options.method, 'PUT');
  const payload = JSON.parse(options.body);
  assert.equal(payload.displayName, 'B'); assert.equal(payload.listings[0].level, 8);
  assert.deepEqual(payload.listings[0].wtb, {price: 500, quantity: 2});
  assert.equal(t.state.aldata.publishStatus, 'published'); assert.deepEqual(t.calls, ['authentication']);
  t.state.statuses.B.owner = null;
  assert.equal(await t.service.aldata.publish(), false); assert.equal(t.requests.length, 1);
});

test('configured ALData endpoint is shared by feeds and publication, with legacy empty fallback', async () => {
  const t = fixture('http://aldata.internal:8080');
  await t.service.aldata.refresh('all');
  await t.service.ponty.refresh();
  await t.service.aldata.publish();
  assert.deepEqual(t.requests.map(([url]) => url), [
    'http://aldata.internal:8080/merchants', 'http://aldata.internal:8080/trades',
    'http://aldata.internal:8080/npcs/Ponty', 'http://aldata.internal:8080/trades/10/test-key',
  ]);
  const fallback = fixture('');
  await fallback.service.aldata.refresh('merchants');
  assert.equal(fallback.requests[0][0], 'https://aldata.earthiverse.ca/merchants');
});

test('market history observers update the current history collection after replacement', () => {
  const t = fixture(), previous = t.state.standPriceHistory;
  t.state.standPriceHistory = {};
  t.service.prices([{item: {name: 'helmet', level: 7}, price: 125, seenAt: 100000}]);
  assert.deepEqual(previous, {});
  assert.equal(t.state.standPriceHistory.helmet.lowest, 125);
  assert.equal(t.state.standPriceHistory.helmet.marketLowLevel, 7);
});

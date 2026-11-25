const test = require('node:test'), assert = require('node:assert/strict');
const {createCoordinatorMarketFeeds} = require('../../runtime/items/coordinator/market.ts');

function fixture(baseUrl, clock = {now: 100000}, watch = {watched: false}) {
  const state = {aldata: {marketListings: [], marketBuyOrders: [], trades: [], key: 'test-key', auth: 'CORRECT'},
    ponty: {listings: []}, merchantCharacter: 'A', statuses: {A: {owner: 10}},
    merchantCatalog: {allItems: {}}, standPriceHistory: {}, standBids: {}, standListings: []};
  const requests = [], timers = [], calls = [], normalized = [];
  const service = createCoordinatorMarketFeeds(state, {
    baseUrl,
    now: () => clock.now, sleep: async () => assert.fail('fixture is within request budget'),
    fetch: async (url, options) => {requests.push([url, options]); return new Response('[]');},
    queueMarket: () => calls.push('market'), queuePonty: () => calls.push('ponty'),
    persistSettings: () => calls.push('settings'), persistAuthentication: () => calls.push('authentication'),
    anniversary: () => ({nativeSlice: null, tradableNative: 0, missing: []}),
    normalizePonty: (records, items) => {normalized.push([records, items]); return [];},
    realmExists: () => true,
    watched: () => watch.watched,
  });
  return {state, service, requests, timers, calls, normalized};
}

// A feed refreshes only while a reader needs it: a viewer with the market open (the status owner's market watch),
// the stand bid purchases with an open bid, a job's read of the feed, or for trades a publishing
// account. A wanted feed refreshes at most once per ALData rate window. Before, every feed refreshed
// at its own fixed interval on every ask, whether anyone read the data or not.
const askAt = async (t, clock, at) => { clock.now = at; t.requests.length = 0; t.service.ask();
  await new Promise(setImmediate); await new Promise(setImmediate);
  return t.requests.map(([url]) => url.replace('https://aldata.earthiverse.ca', '')).sort(); };
test('an ask refreshes only the feeds a reader needs, once per rate window (G48)', async () => {
  const {ALDATA_RATE_WINDOW_MS: WINDOW} = require('../../runtime/items/rules.ts');
  const clock = {now: 100000}, watch = {watched: false}, t = fixture(undefined, clock, watch), start = clock.now;
  t.state.aldata.auth = 'NO';
  assert.deepEqual(await askAt(t, clock, start), [], 'no reader, no request');
  watch.watched = true;
  assert.deepEqual(await askAt(t, clock, start + 1), ['/merchants', '/npcs/Ponty', '/trades']);
  assert.deepEqual(await askAt(t, clock, start + WINDOW), [], 'inside the rate window');
  assert.deepEqual(await askAt(t, clock, start + 1 + WINDOW), ['/merchants', '/npcs/Ponty', '/trades']);
  watch.watched = false;
  assert.deepEqual(await askAt(t, clock, start + 1 + 3 * WINDOW), [], 'the viewer left');
  // A job's read of Ponty needs the feed until it refreshes once.
  require('../../runtime/items/coordinator/market.ts').feedRead('ponty');
  assert.deepEqual(await askAt(t, clock, start + 1 + 4 * WINDOW), ['/npcs/Ponty']);
  assert.deepEqual(await askAt(t, clock, start + 1 + 6 * WINDOW), []);
  // An open stand bid needs the listings it buys from; a publishing account needs the trades.
  t.state.standBids = {helmet: {price: 500, quantity: 1}};
  t.state.aldata.auth = 'CORRECT';
  assert.deepEqual(await askAt(t, clock, start + 1 + 7 * WINDOW), ['/merchants', '/npcs/Ponty', '/trades']);
});

// The key mail marks the account YES and ALData confirms it once the mail is read. The check runs
// on the next publication ask once ALData's rate window passed since the mail, once per mail, with the
// merchant and key encoded. Before, a 65 s timer checked whatever the merchant and key were then.
test('the key check runs on the first publication ask a rate window after the mail', async () => {
  const {ALDATA_RATE_WINDOW_MS: WINDOW} = require('../../runtime/items/rules.ts');
  const clock = {now: 100000}, t = fixture(undefined, clock), auth = () => t.requests.filter(([url]) => url.includes('/auth/')).map(([url]) => url);
  t.fetchAnswer = null;
  t.state.merchantCharacter = 'M /'; t.state.statuses = {'M /': {owner: 10}};
  Object.assign(t.state.aldata, {auth: 'YES', authCheckedAt: clock.now, key: 'key/?#'});
  await t.service.publish();
  assert.deepEqual(auth(), [], 'inside the window ALData has not read the mail');
  clock.now += WINDOW; await t.service.publish();
  assert.deepEqual(auth(), ['https://aldata.earthiverse.ca/auth/M%20%2F/key%2F%3F%23']);
  clock.now += 2 * WINDOW; await t.service.publish();
  assert.equal(auth().length, 1, 'one check per mail');
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

// The listings publish again only when their body changes or a trades snapshot read after the last
// publish no longer holds the account.
test('a publish repeats only on a changed body or a trades snapshot that dropped the account (G47)', async () => {
  const t = fixture(), puts = () => t.requests.filter(([, options]) => options?.method === 'PUT').length;
  await t.service.publish(); assert.equal(puts(), 1);
  await t.service.publish(); assert.equal(puts(), 1, 'an unchanged body the trades still hold');
  t.state.aldata.trades = [{owner: '10'}]; t.state.aldata.tradesUpdatedAt = t.state.aldata.publishedAt + 1;
  await t.service.publish(); assert.equal(puts(), 1, 'the newer snapshot holds the account');
  t.state.aldata.trades = []; await t.service.publish(); assert.equal(puts(), 2, 'the newer snapshot dropped the account');
  t.state.standBids = {helmet: {price: 500, quantity: 2}}; await t.service.publish(); assert.equal(puts(), 3, 'the body changed');
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

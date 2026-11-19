// Ponty's lots: the coordinator's planning (items/coordinator/market.ts) and the merchant's purchase
// and reads (items/character/market.ts) over items-character.cjs marketHarness.
const test = require('node:test');
const assert = require('node:assert/strict');
const { marketHarness } = require('./helpers/items-character.cjs');
const { pontyPrice } = require('../../runtime/items/rules.ts');
const { normalizePontyListings, selectPontyLots, prioritizePontyRealms, planPontyPurchase } = require('../../runtime/items/coordinator/market.ts');
const {pontyGroupKey} = require('../../runtime/items/identity.ts');
test('identical items group across realms and quantities but not stats', () => {
  assert.equal(pontyGroupKey({ name: 'amulet', level: 0, q: 1, rid: 'a', p: null }),
    pontyGroupKey({ rid: 'b', name: 'amulet', q: 2 }));
  assert.notEqual(pontyGroupKey({ name: 'amulet', stat_type: 'int' }), pontyGroupKey({ name: 'amulet', stat_type: 'dex' }));
  assert.notEqual(pontyGroupKey({ name: 'amulet', p: 'shiny' }), pontyGroupKey({ name: 'amulet' }));
});
test('normalization preserves realm, age, full properties and realm-qualified rid', () => {
  const records = ['I', 'II'].map(serverIdentifier => ({ serverRegion: 'US', serverIdentifier,
    lastSeen: '2026-09-09T00:00:00Z', items: [{ name: 'coat', level: 0, rid: 'same', stat_type: 'int' }] }));
  const listings = normalizePontyListings(records, [{ id: 'coat', meta: { definition: { g: 100 } } }]);
  assert.equal(listings.length, 2);
  assert.notEqual(listings[0].key, listings[1].key);
  assert.equal(listings[0].groupKey, listings[1].groupKey);
  assert.equal(listings[0].unitPrice, 120);
  assert.equal(listings[0].seenAt, Date.parse(records[0].lastSeen));
});
test('quantity selection never splits or overbuys stacks', () => {
  const lots = [3, 2, 2].map((quantity, key) => ({ quantity, key }));
  assert.equal(selectPontyLots(lots, 4).reduce((sum, row) => sum + row.quantity, 0), 4);
  assert.equal(selectPontyLots(lots, 1), null);
  assert.equal(selectPontyLots(lots, -1), null);
});
// The merchant's live Ponty read prices each lot by rules.ts pontyPrice over the game's scroll
// prices, so the price row runs that read: a compound item takes the compound scroll.
test('compound valuation uses compound scroll prices, not upgrade scroll prices', async () => {
  const { createMarket } = require('../../runtime/items/character/market.ts');
  const scrolls = { scroll0: 1000, scroll1: 40000, scroll2: 1600000, cscroll0: 6400, cscroll1: 240000, cscroll2: 9200000 };
  const items = { amulet: { g: 100, compound: {} }, ...Object.fromEntries(Object.entries(scrolls).map(([name, g]) => [name, { g }])) };
  const market = createMarket({ character: () => ({ ctype: 'merchant', map: 'main', x: 0, y: 0, items: [] }), G: () => ({ items }),
    margin: () => 1, realm: () => ({ region: 'US', identifier: 'I' }), findNpc: () => ({ map: 'main', x: 0, y: 0 }), now: () => 0,
    reads: {}, bag: { pontyWanted: () => false }, game: { backgroundSecondhands: (_ms, reply) => { reply(Promise.resolve([{ name: 'amulet', level: 1, rid: 'a' }])); return true; } } });
  await market.refreshPontyListings();
  const [lot] = market.ponty().listings;
  assert.equal(lot.unitPrice, Math.round(60 * 3.2 + 6400 / 2.4) * 2);
  assert.equal(lot.unitPrice, pontyPrice({ name: 'amulet', level: 1 }, { definition: items.amulet }, scrolls));
});
test('itinerary buys current-realm stock then the largest other realm', () => {
  const stock = [['US', 'I', 1], ['US', 'II', 2], ['US', 'III', 3], ['EU', 'I', 5]]
    .flatMap(([serverRegion, serverIdentifier, count]) => Array.from({ length: count }, (_, index) => ({
      serverRegion, serverIdentifier, quantity: 1, unitPrice: 100, key: serverRegion + serverIdentifier + index,
    })));
  const planned = planPontyPurchase(stock, 5, 'USII');
  assert.deepEqual(planned.map(row => row.serverRegion + row.serverIdentifier), ['USII', 'USII', 'EUI', 'EUI', 'EUI']);
  const moved = planPontyPurchase(stock, 5, 'SR_USIII');
  assert.deepEqual(moved.map(row => row.serverRegion + row.serverIdentifier), ['USIII', 'USIII', 'USIII', 'EUI', 'EUI']);
  assert.equal(planPontyPurchase(stock, 2, 'USII').every(row => row.serverIdentifier === 'II'), true);
  assert.equal(planPontyPurchase(stock, 3, 'ASIAI').every(row => row.serverRegion === 'EU'), true);
});
test('planning preserves retained objects and distinguishes partial from exact results', () => {
  const incomplete = {key: 'retained-without-quantity'};
  const available = {key: 'available', quantity: 2, unitPrice: 100};
  const listings = [incomplete, available];
  assert.equal(planPontyPurchase(listings, 3), null);
  const partial = planPontyPurchase(listings, 3, undefined, true);
  assert.deepEqual(partial, [available]);
  assert.equal(partial[0], available);
  assert.deepEqual(listings, [incomplete, available]);
  assert.deepEqual(planPontyPurchase([incomplete], 1, undefined, true), []);
  assert.equal(planPontyPurchase([incomplete], 1), null);
});

test('purchase revalidates exact properties and continues past stale listings', async () => {
  const buys = [], progress = [], hops = [];
  const listings = ['wrong', 'valid'].map(rid => ({ key: 'US:II:' + rid, rid,
    item: { name: 'coat', level: 1, stat_type: 'int' }, quantity: 1, unitPrice: 120, price: 120,
    serverRegion: 'US', serverIdentifier: 'II' }));
  const { market } = marketHarness({ character: { name: 'Merchant', ctype: 'merchant', gold: 1000, items: Array(42).fill(null) },
    // lotPrice reads the six scroll prices beside the coat's own value.
    G: { items: { coat: { g: 20 }, ...Object.fromEntries(['scroll0', 'scroll1', 'scroll2', 'cscroll0', 'cscroll1', 'cscroll2'].map(name => [name, { g: 10 }])) }, skills: {} },
    game: { getSecondhands: async () => listings.map(row => ({ ...row.item, rid: row.rid, stat_type: row.rid === 'wrong' ? 'dex' : 'int' })),
      buySecondhand: async rid => buys.push(rid) },
    merchant: { jobHop: async (_command, realm) => { hops.push(realm); return 'yielded'; } },
    ports: { realm: () => ({ region: 'US', identifier: 'II' }), request: async (url, args) => {
      if (url.includes('progress')) progress.push(args.body);
      return url === '/merchant/native-stand' ? { quantity: args.body.quantity } : {};
    } } });
  await market.merchantPontyBuy({ jobId: 'job', listings });
  assert.deepEqual(buys, ['valid']);
  assert.deepEqual(progress.map(row => row.success), [false, true]);
  assert.equal(hops.length, 0);
  buys.length = 0;
  await market.merchantPontyBuy({ jobId: 'job', listings, completedListingKeys: listings.map(row => row.key) });
  assert.equal(buys.length, 0, 'completed purchases survive realm-switch replay');
});
// The merchant reads Ponty only within PONTY_RANGE of Ponty and only when the call
// budget's background band sends. Red on an earlier build: it read from anywhere every 30 s.
test('Ponty is read within range and only when the background band sends',async()=>{
 const {PONTY_RANGE}=require('../../runtime/items/rules.ts');
 const character={name:'Merchant',ctype:'merchant',map:'main',x:0,y:0,items:[]};
 let band='send';const reads=[];
 // calls.ts sends the background read only when its band sends.
 const {market}=marketHarness({character,ports:{findNpc:()=>({map:'main',x:0,y:0})},
  game:{backgroundSecondhands:(_ms,reply)=>{if(band!=='send')return false;reads.push(character.x);reply(Promise.resolve([]));return true;}}});
 character.x=PONTY_RANGE+1;await market.refreshPontyListings();
 character.x=PONTY_RANGE;band='not now';await market.refreshPontyListings();
 band='send';await market.refreshPontyListings();
 assert.deepEqual(reads,[PONTY_RANGE]);
});

// The game_response listener and Ponty's background read, with a margin of 1 ms.
function characterMarket() {
  const reads = { count: 0 };
  const h = marketHarness({ character: { name: 'Merchant', ctype: 'merchant', map: 'main', x: 0, y: 0, items: [] },
    ports: { margin: () => 1, findNpc: () => ({ map: 'main', x: 0, y: 0 }) },
    game: { backgroundSecondhands: (_ms, reply) => { reads.count += 1; reply(Promise.resolve([])); return true; } } });
  h.market.start();
  const clock = { get now() { return h.clock.now; }, set now(value) { h.clock.now = value; }, get reads() { return reads.count; } };
  return { market: h.market, listeners: h.listeners, clock, bag: h.bag };
}
// The game's donation rate at exactly 1,000M server gold is 4 XP per gold. Red on an earlier
// build, whose estimate read 3.2 there.
test('the donation estimate at exactly 1,000M server gold is the game\'s 4', () => {
  const { market, listeners } = characterMarket();
  listeners.game_response({ response: 'lostandfound_info', gold: 1_000_000_000 });
  assert.equal(market.donationRate(), 4);
});
// A status report starts a Ponty read only while the coordinator's reply says a reader
// needs the listings, at most once per ALData rate window. Before, the merchant read Ponty every 10 s
// in range whether or not anyone read the result; an earlier build read on every report.
test('a status report reads Ponty only while the reply wants it, once per rate window', async () => {
  const { ALDATA_RATE_WINDOW_MS } = require('../../runtime/items/rules.ts');
  const { market, clock, bag } = characterMarket();
  const report = async () => { market.ponty(); await new Promise(resolve => setImmediate(resolve)); };
  await report();
  assert.equal(clock.reads, 0, 'no reader needs Ponty');
  bag.settingsReply({ pontyWanted: true });
  await report(); await report();
  assert.equal(clock.reads, 1);
  clock.now = ALDATA_RATE_WINDOW_MS - 1; await report();
  assert.equal(clock.reads, 1);
  clock.now = ALDATA_RATE_WINDOW_MS; await report();
  assert.equal(clock.reads, 2);
  bag.settingsReply({ pontyWanted: false });
  clock.now = 3 * ALDATA_RATE_WINDOW_MS; await report();
  assert.equal(clock.reads, 2, 'the reader left');
});

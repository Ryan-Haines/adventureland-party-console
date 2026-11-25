const {withDoor}=require('./helpers/coordinator-merchant.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { pontyPrice: price } = require('../../runtime/items/rules.ts');
const { normalizePontyListings: normalize, selectPontyLots: selectLots, prioritizePontyRealms: prioritizeRealms,
  planPontyPurchase: planPurchase } = require('../../runtime/items/coordinator/market.ts');
const market = { price, normalize, selectLots, prioritizeRealms, planPurchase };
function setup(listings, reserved = []) {
  const party = { merchantCharacter: 'GoldMajesty', merchantQueue: reserved, ponty: { listings },
    statuses: { GoldMajesty: { server: 'USII' } }, nextCommandId: 1 };
  const {createManualMarketOrderRoutes}=require('../../runtime/items/coordinator/routes/market.ts');
  const handler=createManualMarketOrderRoutes(party,withDoor(party,{now:()=>Date.now(),nextCommand:()=>party.nextCommandId++,
    stamp:job=>job,persist(){},dispatch(){},log(){},plan:market.planPurchase})).ponty;
  return { party, order(quantity) {
    const result = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    handler({ body: { keys: listings.map(row => row.key), quantity, unitPrice: 19680 } }, result);
    return result;
  } };
}
const stock = () => ['II', 'I', 'III'].flatMap((serverIdentifier, realmIndex) =>
  Array.from({ length: 4 }, (_, index) => ({ key: `${serverIdentifier}:${index}`, serverRegion: 'US', serverIdentifier,
    item: { name: 'mushroomstaff', level: 0 }, groupKey: 'mushroomstaff', quantity: 1,
    unitPrice: 19680, price: 19680, seenAt: Date.now() })));
test('manual 12-staff confirmation queues distinct fixed realm jobs totaling the confirmed amount', () => {
  const { party, order } = setup(stock());
  const result = order(12);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.jobIds.length, 3);
  assert.equal(new Set(result.body.jobIds).size, 3);
  assert.equal(party.merchantQueue[0].realm, 'SR_USII');
  assert.equal(party.merchantQueue.flatMap(job => job.listings).reduce((sum, row) => sum + row.price, 0), 236160);
  for (const job of party.merchantQueue) {
    assert.equal(job.listings.length, 4);
    assert.equal(new Set(job.listings.map(row => row.serverIdentifier)).size, 1);
    assert.equal(job.pontyPlanned, true, 'dispatch must not reselect lots assigned to other realm jobs');
    assert.equal(job.manual, true);
    assert.equal(job.bidItemId, undefined, 'WTB updates must not cancel later manually requested realm jobs');
  }
  assert.equal(order(12).statusCode, 409, 'repeat confirmation cannot reserve the same listings');
});
// A lot is stale once the latest Ponty snapshot no longer holds it.
test('stale stock rejects atomically without creating partial purchase jobs', () => {
  const listings = stock();
  const { party, order } = setup(listings);
  party.ponty.listings = listings.slice(1);
  assert.equal(order(12).statusCode, 409);
  assert.equal(party.merchantQueue.length, 0);
});
test('a smaller selection on the current realm needs only one job', () => {
  const { party, order } = setup(stock());
  assert.equal(order(2).body.jobIds.length, 1);
  assert.equal(party.merchantQueue[0].listings.length, 2);
  assert.equal(party.merchantQueue[0].realm, 'SR_USII');
});

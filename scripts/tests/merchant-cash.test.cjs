const test = require('node:test');
const assert = require('node:assert/strict');
const {bankHarness, marketHarness} = require('./helpers/items-character.cjs');
// bank.ts's withdrawMerchantCash on a merchant whose carried cash target is 1,000,000.
function runtime(gold, bankGold) {
  const withdrawals = [];
  const character = { name: 'Merchant', ctype: 'merchant', gold, items: [], bank: { gold: bankGold } };
  const { bank } = bankHarness({ character, ports: { merchantCashTarget: () => 1000000,
    bankWithdraw: async amount => { assert.ok(amount > 0 && amount <= character.bank.gold); withdrawals.push(amount); character.bank.gold -= amount; character.gold += amount; } } });
  return { bank, withdrawals, character };
}
test('small purchases refill the configured carried cash target', async () => {
  const r = runtime(100, 46000000);
  await r.bank.withdrawMerchantCash(1900, { merchantGoldTarget: 1000000 });
  assert.deepEqual(r.withdrawals, [999900]);
  assert.equal(r.character.gold, 1000000);
});
test('large purchases can exceed the reserve and low bank balance allows a partial refill', async () => {
  const r = runtime(100, 2000000);
  await r.bank.withdrawMerchantCash(1499900, { merchantGoldTarget: 1000000 });
  assert.equal(r.character.gold, 1500000);
  const low = runtime(0, 50000);
  await low.bank.withdrawMerchantCash(2000, { merchantGoldTarget: 1000000 });
  assert.equal(low.character.gold, 50000);
});
test('zero targets, missing command targets and empty banks are supported', async () => {
  const zero = runtime(0, 2000000);
  await zero.bank.withdrawMerchantCash(2000, { merchantGoldTarget: 0 });
  assert.deepEqual(zero.withdrawals, [2000]);
  const fallback = runtime(0, 2000000);
  await fallback.bank.withdrawMerchantCash(2000);
  assert.deepEqual(fallback.withdrawals, [1000000]);
  const empty = runtime(0, 0);
  await empty.bank.withdrawMerchantCash(0);
  assert.deepEqual(empty.withdrawals, []);
});
test('Ponty cash shortage fails the job without marking the listing unavailable', async () => {
  const reports = [];
  const { market } = marketHarness({ character: { name: 'Merchant', ctype: 'merchant', gold: 0, items: Array(42).fill(null), bank: { gold: 0 } },
    ports: { realm: () => ({ region: 'US', identifier: 'II' }), request: async (url, args) => { reports.push({ url, body: args.body }); return {}; } } });
  await assert.rejects(market.merchantPontyBuy({ jobId: 'job', listings: [{ key: 'wcap', price: 2000,
    serverRegion: 'US', serverIdentifier: 'II', item: { name: 'wcap' } }] }), /Insufficient bank gold/);
  assert.equal(reports.some(report => report.url.includes('ponty-progress')), false);
  assert.equal(reports.find(report => report.url.includes('complete')).body.success, false);
});

// The working gold is the largest of the
// player's minimum, the stand's funding and the ready jobs' gold on the merchant's realm.
// The auth half: the ALData authentication needs one letter's postage and nothing more.
const {workingGold, itemNeeds} = require('../../runtime/items/coordinator/needs.ts');
const {jobsReady} = require('./helpers/test-registry.cjs');
function goldState(queue) {
  return { merchantCharacter: 'M', goldTargets: { M: 1000 }, merchantQueue: queue, statuses: { M: { server: 'EUI', gold: 0, items: [] } },
    bankSnapshot: { gold: 0, packs: {} }, autoStandMarks: {}, standListings: [], standBids: {}, merchantAutomations: {} };
}
test('the working gold is the largest of the minimum, the stand funding and the ready jobs\' gold', t => {
  const ready = jobsReady(t);
  const mail = { id: 'm', target: 'M', reason: 'send mail', item: { name: 'ring' } };
  ready.set([{ id: 'm', target: 'M', reason: 'send mail', priority: 50, realm: 'SR_EUI' }]);
  assert.equal(workingGold(goldState([mail])), 360000, 'the ready mail\'s postage');
  ready.set([{ id: 'm', target: 'M', reason: 'send mail', priority: 50, realm: 'SR_USI' }]);
  assert.equal(workingGold(goldState([mail])), 1000, 'a job on another realm adds no gold; the minimum holds');
  ready.set([]);
  assert.equal(workingGold(goldState([])), 1000);
});
test('the ALData authentication needs one letter\'s postage', () => {
  const needs = itemNeeds(goldState([]), { id: 'a', target: 'M', reason: 'ALData authentication' });
  assert.equal(needs.gold, 48000); assert.equal(needs.postage, 48000);
});

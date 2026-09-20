const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../characters/shared.js'), 'utf8');
const helper = source.slice(source.indexOf('  async function withdrawMerchantCash('), source.indexOf('  async function merchantBankErrands('));
function runtime(gold, bankGold) {
  const withdrawals = [];
  const character = { ctype: 'merchant', gold, bank: { gold: bankGold } };
  const context = vm.createContext({ character, merchantCashTarget: 1000000,
    bank_withdraw: async amount => { assert.ok(amount > 0 && amount <= character.bank.gold); withdrawals.push(amount); character.bank.gold -= amount; character.gold += amount; } });
  vm.runInContext(helper, context);
  return { context, withdrawals, character };
}
test('small purchases refill the configured carried cash target', async () => {
  const r = runtime(100, 46000000);
  await r.context.withdrawMerchantCash(1900, { merchantGoldTarget: 1000000 });
  assert.deepEqual(r.withdrawals, [999900]);
  assert.equal(r.character.gold, 1000000);
});
test('large purchases can exceed the reserve and low bank balance allows a partial refill', async () => {
  const r = runtime(100, 2000000);
  await r.context.withdrawMerchantCash(1499900, { merchantGoldTarget: 1000000 });
  assert.equal(r.character.gold, 1500000);
  const low = runtime(0, 50000);
  await low.context.withdrawMerchantCash(2000, { merchantGoldTarget: 1000000 });
  assert.equal(low.character.gold, 50000);
});
test('zero targets, missing command targets and empty banks are supported', async () => {
  const zero = runtime(0, 2000000);
  await zero.context.withdrawMerchantCash(2000, { merchantGoldTarget: 0 });
  assert.deepEqual(zero.withdrawals, [2000]);
  const fallback = runtime(0, 2000000);
  await fallback.context.withdrawMerchantCash(2000);
  assert.deepEqual(fallback.withdrawals, [1000000]);
  const empty = runtime(0, 0);
  await empty.context.withdrawMerchantCash(0);
  assert.deepEqual(empty.withdrawals, []);
});
test('Ponty cash shortage fails the job without marking the listing unavailable', async () => {
  const reports = [];
  const r = runtime(0, 0);
  Object.assign(r.context, { parent: { server_region: 'US', server_identifier: 'II' },
    merchantVisitBank: async () => {}, refreshPontyListings: async () => {},
    request: async (url, args) => { reports.push({ url, body: args.body }); return {}; } });
  vm.runInContext(source.slice(source.indexOf('  async function merchantPontyBuy('), source.indexOf('  async function merchantALDataAuth(')), r.context);
  await assert.rejects(r.context.merchantPontyBuy({ jobId: 'job', listings: [{ key: 'wcap', price: 2000,
    serverRegion: 'US', serverIdentifier: 'II', item: { name: 'wcap' } }] }), /Insufficient bank gold/);
  assert.equal(reports.some(report => report.url.includes('ponty-progress')), false);
  assert.equal(reports.find(report => report.url.includes('complete')).body.success, false);
});

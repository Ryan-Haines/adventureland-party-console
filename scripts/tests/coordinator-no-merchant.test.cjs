const test = require('node:test');
const assert = require('node:assert/strict');
const { createMerchantHomeRecovery } = require('../../runtime/coordinator/merchant/home-recovery.ts');
const { createMerchantRealmRoutes } = require('../../runtime/coordinator/http/merchant-realms.ts');

test('a stalled sale cannot restart a worker after merchant selection is cleared', () => {
  const job = { id: 'sale', reason: 'ALData marketplace sales', startedAt: 1 };
  const state = { merchantCharacter: null, merchantCurrent: job, activeRealm: 'SR_USII', statuses: {}, commands: {} };
  const unexpected = () => assert.fail('must not mutate or restart without a merchant');
  const recovery = createMerchantHomeRecovery(state, {
    now: () => 200000, block: unexpected, realmLabel: unexpected,
    log: unexpected, persist: unexpected, restart: unexpected,
  });
  assert.equal(recovery.recoverStalledSale(), false);
  assert.equal(state.merchantCurrent, job);
});

test('null character cannot authorize a retained marketplace realm switch', () => {
  const job = { id: 'sale', reason: 'ALData marketplace sales' };
  const state = { merchantCharacter: null, merchantCurrent: job, activeRealm: 'SR_USII' };
  const unexpected = () => assert.fail('must reject before touching workers');
  const routes = createMerchantRealmRoutes(state, {
    now: unexpected, resolve: unexpected, block: unexpected, log: unexpected,
    persist: unexpected, restart: unexpected, label: unexpected,
  });
  const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  routes.switchRealm({ body: { character: null, jobId: 'sale', realm: 'SR_EUI' } }, response);
  assert.equal(response.code, 409);
  assert.equal(state.merchantCurrent, job);
});

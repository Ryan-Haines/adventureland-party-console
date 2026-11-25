const test = require('node:test'), assert = require('node:assert/strict');
const { createCoordinatorStorageService } = require('../../runtime/items/coordinator/storage.ts');
const { storageKey } = require('../../runtime/items/identity.ts');

test('exchange storage initializes the current merchant queue and persists pending existing supply', () => {
  const item = { name: 'leather', q: 10 }, state = { merchantCharacter: 'M', withdrawals: {},
    bankbois: { V: { name: 'V', items: [{ slot: 2, item }] } } };
  let writes = 0; const service = createCoordinatorStorageService(state, () => writes++);
  assert.equal(service.queueExchange({}), false); assert.deepEqual(state.withdrawals.M, []); assert.equal(writes, 0);
  const job = { exchanges: [{ id: 'leather' }] }, shortages = [{ id: 'leather', quantity: 5 }];
  assert.equal(service.queueExchange(job, shortages), true);
  assert.equal(service.queueExchange(job, shortages), true);
  assert.equal(writes, 2); assert.equal(state.withdrawals.M.length, 1);
  assert.equal(state.withdrawals.M[0].item, item);
  state.merchantCharacter = 'N'; service.queueExchange(job, shortages);
  assert.equal(state.withdrawals.N.length, 1);
});

test('storage identity preserves coercion and only distinguishes name, level and stat', () => {
  assert.equal(storageKey(null), '["",0,null]');
  assert.equal(storageKey({ name: 'ring', level: '2', stat_type: 'int', q: 9 }), '["ring",2,"int"]');
  assert.equal(storageKey({ name: 'ring', level: 'invalid', stat_type: '' }), '["ring",0,null]');
});

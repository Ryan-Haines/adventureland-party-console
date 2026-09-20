const test = require('node:test'), assert = require('node:assert/strict');
const { createCoordinatorStorageService, coordinatorStorageIdentity, coordinatorRestockPolicy } = require('../../runtime/coordinator/inventory/storage-service.ts');

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
  assert.equal(coordinatorStorageIdentity(null), '["",0,null]');
  assert.equal(coordinatorStorageIdentity({ name: 'ring', level: '2', stat_type: 'int', q: 9 }), '["ring",2,"int"]');
  assert.equal(coordinatorStorageIdentity({ name: 'ring', level: 'invalid', stat_type: '' }), '["ring",0,null]');
});
test('storage identity retains raw request coercion and property access order', () => {
  for (const value of [undefined, null, false, 0, '', NaN, true, 4, 'leather', Symbol('item'), 2n])
    assert.equal(coordinatorStorageIdentity(value), '["",0,null]');
  const reads = [], item = Object.create({
    get name() { reads.push('name'); return 'ring'; },
    get level() { reads.push('level'); return '3'; },
    get stat_type() { reads.push('stat'); return 'dex'; },
  });
  assert.equal(coordinatorStorageIdentity(item), '["ring",3,"dex"]');
  assert.deepEqual(reads, ['name', 'level', 'stat']);
  function token() {}
  assert.equal(coordinatorStorageIdentity(token), '["token",0,null]');
});

test('configured restock policies retain identity and defaults are fresh for each request', () => {
  const configured = { hp: { max: 7 } };
  assert.equal(coordinatorRestockPolicy({ M: configured }, 'M'), configured);
  const first = coordinatorRestockPolicy({}, 'M'); first.hp.max = 99;
  assert.deepEqual(coordinatorRestockPolicy({}, 'M'), { hp: { min: 5, max: 20, item: 'hpot1' }, mp: { min: 0, max: 0, item: 'mpot1' } });
});

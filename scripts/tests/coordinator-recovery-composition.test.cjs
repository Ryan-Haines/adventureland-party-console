const test = require('node:test'), assert = require('node:assert/strict');
const { createCoordinatorMerchantRecovery } = require('../../runtime/coordinator/merchant/recovery-composition.ts');
test('merchant recovery preserves an unrelated command while replacing stranded work with a sequenced ID', () => {
  const state = { merchantCurrent: { id: 'old', target: 'A', reason: 'service', phase: 'checkpointed', checkpointAt: 1 }, merchantQueue: [], nextCommandId: 7 };
  const commands = { M: { jobId: 'newer-command' } }, calls = [];
  const service = createCoordinatorMerchantRecovery(state, { now: () => 20000,
    clearOwnedCommand: (name, matches) => { if (matches(commands[name])) delete commands[name]; },
    restockSatisfied: () => false, stamp: job => job, log() {}, persist: () => calls.push('persist'), dispatch() {}, recoverSale: () => calls.push('sale') });
  service.observe('M');
  assert.equal(commands.M.jobId, 'newer-command'); assert.equal(state.merchantCurrent, null);
  assert.equal(state.merchantQueue[0].id, 'merchant-20000-7'); assert.equal(state.merchantQueue[0].resumedFrom, 'old');
  assert.equal(state.merchantQueue[0].checkpointAt, undefined); assert.equal(state.nextCommandId, 8);
  assert.deepEqual(calls, ['sale','persist']);
});
test('completed restock clears only matching ownership and persists before dispatch', () => {
  const state = { merchantCurrent: { id: 'job', target: 'M', reason: 'restock' }, merchantQueue: [], nextCommandId: 7 };
  const commands = { M: { jobId: 'job' } }, calls = [];
  const service = createCoordinatorMerchantRecovery(state, { now: () => 100,
    clearOwnedCommand: (name, matches) => { if (matches(commands[name])) delete commands[name]; },
    restockSatisfied: () => true, stamp: job => job, log() {}, persist: () => calls.push('persist'),
    dispatch: () => { assert.equal(state.merchantCurrent, null); calls.push('dispatch'); }, recoverSale() {} });
  service.observe('M', []); assert.equal(commands.M, undefined); assert.deepEqual(calls, ['persist','dispatch']);
});

test('stocked merchant heartbeats cannot complete a party member restock or clear its assignment', () => {
  const job = { id: 'party-restock', target: 'SneakyDeeky', reason: 'restock', phase: 'assigned', startedAt: 1000, commandId: 7 };
  const state = { merchantCurrent: job, merchantQueue: [], nextCommandId: 8 };
  const commands = { GoldMajesty: { id: 7, jobId: job.id, type: 'merchant-service', target: job.target } };
  const calls = [];
  const service = createCoordinatorMerchantRecovery(state, { now: () => 2000,
    clearOwnedCommand: (name, matches) => { if (matches(commands[name])) delete commands[name]; },
    restockSatisfied: () => { calls.push('checked merchant stock'); return true; }, stamp: job => job,
    log: message => calls.push(message), persist() {}, dispatch: () => calls.push('dispatch'), recoverSale() {} });
  for (let i = 0; i < 3; i++) service.observe('GoldMajesty', [{ slot: 0, item: { name: 'hpot1', q: 999 } }]);
  assert.equal(state.merchantCurrent, job); assert.equal(commands.GoldMajesty.jobId, job.id);
  assert.deepEqual(state.merchantQueue, []); assert.deepEqual(calls, []);
  service.observe('GoldMajesty', [], { jobId: job.id, commandId: 7, state: 'accepted', at: 2000 });
  assert.equal(state.merchantCurrent.commandReport.state, 'accepted');
});

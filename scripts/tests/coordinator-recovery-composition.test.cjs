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

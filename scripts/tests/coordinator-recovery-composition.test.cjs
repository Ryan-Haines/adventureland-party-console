const test = require('node:test'), assert = require('node:assert/strict');
const {createCoordinatorMerchantRecovery} = require('../../runtime/merchant-jobs/coordinator/recovery.ts'),{merchantSlotCommand} = require('../../runtime/merchant-jobs/coordinator/owner.ts');
const { merchantRecords } = require('../../runtime/merchant-jobs/coordinator/records.ts');
test('merchant recovery preserves an unrelated command while replacing stranded work with a sequenced ID', () => {
  const state = { merchantCharacter: 'M', commands: { M: { jobId: 'newer-command' } }, merchantCurrent: { id: 'old', target: 'A', reason: 'service', phase: 'processing', startedAt: 1, heartbeatAt: 1 }, merchantQueue: [], nextCommandId: 7 };
  const calls = [];
  const service = createCoordinatorMerchantRecovery(state, { now: () => 30000,
    restockSatisfied: () => false, stamp: job => job, log() {}, persist: () => calls.push('persist'), dispatch() {}, recoverSale: () => calls.push('sale') });
  service.observe('M');
  assert.equal(state.commands.M.jobId, 'newer-command'); assert.equal(state.merchantCurrent, null);
  assert.equal(state.merchantQueue[0].id, 'merchant-30000-7'); assert.equal(state.merchantQueue[0].resumedFrom, 'old');
  assert.equal(state.merchantQueue[0].heartbeatAt, undefined); assert.equal(state.nextCommandId, 8);
  assert.deepEqual(calls, ['persist']);
});
// A satisfied restock ends through the one end: the slot clears through its writer, the ring says
// `ended`, the ladder books progress, and a manual command held for the job's next stop reaches the
// slot.
test('completed restock clears only matching ownership and persists before dispatch', () => {
  const state = { merchantCharacter: 'RestockM', merchantCurrent: { id: 'job', target: 'RestockM', reason: 'restock' }, merchantQueue: [], nextCommandId: 7,
    commands: { RestockM: { jobId: 'job' } } };
  const calls = [], equip = { id: 9, type: 'equip' };
  assert.equal(merchantSlotCommand(state, 'manual:equip', equip), 'held');
  const service = createCoordinatorMerchantRecovery(state, { now: () => 100, ladder: { progress: () => calls.push('progress') },
    restockSatisfied: () => true, stamp: job => job, log() {}, persist: () => calls.push('persist'),
    dispatch: () => { assert.equal(state.merchantCurrent, null); calls.push('dispatch'); }, recoverSale() {} });
  service.observe('RestockM', []); assert.equal(state.commands.RestockM, equip); assert.deepEqual(calls, ['progress', 'persist', 'dispatch']);
  assert.deepEqual(merchantRecords('RestockM').map(entry => entry.decision), ['slot-held', 'slot-cleared', 'slot-written', 'ended']);
});

test('stocked merchant heartbeats cannot complete a party member restock or clear its assignment', () => {
  const job = { id: 'party-restock', target: 'SneakyDeeky', reason: 'restock', phase: 'assigned', startedAt: 1000, commandId: 7 };
  const commands = { GoldMajesty: { id: 7, jobId: job.id, type: 'merchant-service', target: job.target } };
  const state = { merchantCharacter: 'GoldMajesty', commands, merchantCurrent: job, merchantQueue: [], nextCommandId: 8 };
  const calls = [];
  const service = createCoordinatorMerchantRecovery(state, { now: () => 2000,
    restockSatisfied: () => { calls.push('checked merchant stock'); return true; }, stamp: job => job,
    log: message => calls.push(message), persist() {}, dispatch: () => calls.push('dispatch'), recoverSale() {} });
  for (let i = 0; i < 3; i++) service.observe('GoldMajesty', [{ slot: 0, item: { name: 'hpot1', q: 999 } }]);
  assert.equal(state.merchantCurrent, job); assert.equal(commands.GoldMajesty.jobId, job.id);
  assert.deepEqual(state.merchantQueue, []); assert.deepEqual(calls, []);
  service.observe('GoldMajesty', [], { jobId: job.id, commandId: 7, state: 'accepted', at: 2000 });
  assert.equal(state.merchantCurrent.commandReport.state, 'accepted');
});

const test = require('node:test'), assert = require('node:assert/strict');
const { createCoordinatorBankboiObservation } = require('../../runtime/coordinator/status/bankboi-composition.ts');
test('BankBoi observation composition respects existing commands and preserves ordered withdrawal references', () => {
  const first = { pack: 'items0', slot: 3 }, second = { pack: 'items1', slot: 2 }, item = { name: 'leather', q: 10 };
  const state = { bankbois: { V: {} }, bankboiTransaction: { bankboi: 'V', phase: 'waiting-for-bankboi', mode: 'retrieve', requestIds: ['wanted'], retrievals: [] },
    bankboiQueue: [{ id: 'other' }, { id: 'wanted' }], nextCommandId: 7, commands: { V: { id: 1, type: 'manual' } },
    withdrawals: { A: [first, { pack: 'bankboi:V', item }], B: [second] } };
  const homes = { leather: 'bankboi:V' }; let writes = 0;
  const service = createCoordinatorBankboiObservation(state, { now: () => 100, stackHomes: () => homes, persist: () => writes++ });
  service.observe({ name: 'V', gold: 5 }); assert.equal(state.commands.V.type, 'manual'); assert.equal(writes, 0);
  state.commands = {}; const items = [{ slot: 1, item }]; service.observe({ name: 'V', items, gold: 6 });
  const command = state.commands.V;
  assert.equal(command.id, 7); assert.equal(state.nextCommandId, 8); assert.equal(command.type, 'bankboi-service');
  assert.deepEqual(command.requests, [state.bankboiQueue[1]]); assert.deepEqual(command.reservedLocations, [first, second]);
  assert.equal(command.protectedItems[0], item); assert.equal(command.stackHomes, homes); assert.equal(state.bankbois.V.items, items);
  assert.equal(state.bankboiTransaction.phase, 'processing'); assert.equal(writes, 1);
  service.observe({ name: 'V' }); assert.equal(writes, 1);
});

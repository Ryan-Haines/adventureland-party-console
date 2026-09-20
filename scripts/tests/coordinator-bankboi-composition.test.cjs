const test = require('node:test'), assert = require('node:assert/strict');
const { createCoordinatorBankboiService } = require('../../runtime/coordinator/inventory/bankboi-composition.ts');
function fixture() {
  const state = { bankboiTransaction: null, merchantCharacter: 'M', statuses: { M: { seenAt: 100 } },
    merchantCurrent: null, headlessSlots: ['M'], withdrawals: {} };
  const workers = { M: { enabled: true }, V: { enabled: true } }, calls = [];
  const ports = { now: () => 100, plan: () => ({ candidate: { name: 'V' }, retrievals: [], requests: [] }),
    assignSlot: (slot, name) => { calls.push(['assign', slot, name]); state.headlessSlots[slot - 1] = name; },
    stop: async block => calls.push(['stop', block.enabled, state.headlessSlots[0]]),
    persistRoster: () => calls.push('roster'), persistBank: () => calls.push('bank'),
    collect: (...args) => calls.push(['collect', ...args]), log() {} };
  return { state, workers, calls, service: createCoordinatorBankboiService(state, workers, ports) };
}
test('BankBoi composition disables the merchant after clearing its slot and writes through transaction phases', async () => {
  const f = fixture(); await f.service.start();
  assert.deepEqual(f.calls, ['bank', 'roster', ['stop', false, null], ['assign', 1, 'V'], 'bank']);
  assert.equal(f.state.bankboiTransaction.phase, 'waiting-for-bankboi');
  assert.equal(f.state.headlessSlots[0], 'V'); assert.equal(f.workers.M.enabled, false);
});

test('an empty slot is not a merchant when no merchant is selected', async () => {
  const f = fixture();
  f.state.merchantCharacter = null;
  f.state.headlessSlots = [null];
  f.state.statuses.null = { seenAt: 100 };
  await f.service.start();
  assert.equal(f.state.bankboiTransaction, null);
  assert.deepEqual(f.state.headlessSlots, [null]);
  assert.deepEqual(f.calls, []);
});

test('clearing merchant selection during storage releases the slot without inventing a character', async () => {
  const f = fixture();
  await f.service.start();
  const active = f.state.bankboiTransaction;
  f.state.merchantCharacter = null;
  f.state.withdrawals.null = [{ pack: 'items0' }];
  f.calls.length = 0;
  await f.service.restore(active);
  assert.equal(f.state.bankboiTransaction, null);
  assert.deepEqual(f.state.headlessSlots, [null]);
  assert.equal(f.workers.V.enabled, false);
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'assign'), false);
  // Queue adapters must preserve null so the real queue can discard it.
  assert.deepEqual(f.calls.find(call => Array.isArray(call) && call[0] === 'collect'),
    ['collect', [null], 'manual bank exchange']);
});
test('restoration uses the current merchant and collects only normal withdrawal requests', async () => {
  for (const pack of ['bankboi:V', 'items0', undefined]) {
    const f = fixture(); await f.service.start(); const active = f.state.bankboiTransaction;
    f.state.merchantCharacter = 'N'; f.state.withdrawals.N = [{ pack }];
    await f.service.restore(active);
    assert.equal(f.state.bankboiTransaction, null); assert.equal(f.state.headlessSlots[0], 'N');
    assert.equal(f.workers.V.enabled, false);
    const collect = f.calls.find(call => Array.isArray(call) && call[0] === 'collect');
    if (pack === 'bankboi:V') assert.equal(collect, undefined);
    else assert.deepEqual(collect, ['collect', ['N'], 'manual bank exchange']);
  }
});

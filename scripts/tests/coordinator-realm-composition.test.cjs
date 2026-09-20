const test = require('node:test'), assert = require('node:assert/strict');
const { createCoordinatorRealmSwitch } = require('../../runtime/coordinator/characters/realm-composition.ts');
function fixture(setHome = false) {
  const state = { commands: { A: { type: 'old' }, B: { type: 'old' } }, steamMembers: ['A'], nextCommandId: 7,
    statuses: { A: { seenAt: 100, server: 'USII', ctype: 'warrior' }, B: { seenAt: 100, server: 'USII', ctype: 'priest' } },
    activeRealm: 'SR_USI', leader: 'B' };
  const calls = [], blocks = { B: { enabled: true } };
  const operation = { id: 'switch', realm: 'SR_USII', participants: ['A','B'], startedAt: 100, phase: 'depart', characters: [], setHome };
  const service = createCoordinatorRealmSwitch(state, { now: () => 100, sleep: async () => {}, pauseMerchant: () => calls.push('pause'),
    native: () => 'A', block: name => blocks[name], stop: async block => calls.push(['stop', block.realm, Object.keys(state.commands)]),
    persist: () => calls.push('persist'), label: realm => realm.slice(3), dispatchMerchant: () => calls.push('dispatch') });
  return { state, calls, operation, service };
}
test('realm composition clears prior commands before stopping headless workers and routes Steam through the primary', async () => {
  const f = fixture(); await f.service.run(f.operation);
  assert.deepEqual(f.calls, ['pause', ['stop', 'SR_USII', []], 'persist', 'persist', 'dispatch']);
  assert.deepEqual(f.state.commands.A, { id: 7, type: 'native-realm-switch', realm: 'SR_USII', operationId: 'switch' });
  assert.equal(f.state.commands.B, undefined); assert.equal(f.state.activeRealm, 'SR_USII');
  assert.equal(f.operation.phase, 'complete'); assert.equal(f.state.nextCommandId, 8);
});
test('set-home follows the current leader and shares the command sequence', async () => {
  const f = fixture(true); await f.service.run(f.operation);
  assert.equal(f.operation.phase, 'setting-home'); assert.equal(f.operation.homeExecutor, 'B');
  assert.deepEqual(f.state.commands.B, { id: 8, type: 'realm-set-home', operationId: 'switch', realm: 'SR_USII' });
  assert.equal(f.calls.includes('dispatch'), false); assert.equal(f.state.nextCommandId, 9);
});

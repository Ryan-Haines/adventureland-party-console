const test = require('node:test'), assert = require('node:assert/strict');
const { createCoordinatorMerchantScheduling } = require('../../runtime/coordinator/status/scheduling-composition.ts');
test('scheduling composition preserves non-bank commands, reports storage failures and reads current gold', async () => {
  const state = { merchantCharacter: 'M', merchantCurrent: null, merchantQueue: [], merchantAutomations: {}, gatheringModes: [], gatheringCooldowns: {},
    merchantCapacityBlocked: false, transferSignatures: {}, itemCollectionThreshold: 5, upgrades: {}, compounds: {}, statScrolls: {}, marked: {}, merchantMarked: {},
    statuses: { P: { name: 'P', gold: 1001 } }, bankCurrent: { name: 'P' }, bankStartedAt: 0, threshold: 1000, thresholdRunActive: false, bankCycleMembers: {} };
  const command = { type: 'manual' }, calls = [];
  const no = () => {};
  const service = createCoordinatorMerchantScheduling(state, { reconcileItems: () => false, reconcileUpgrades: () => false, reconcileSales: () => false,
    luck: no, recovery: no, standMarket: () => false, giveaways: no, compounds: no, exchanges: no, policy: no,
    queue: (names, reason) => calls.push(['queue', names, reason]), markedItem: no, sameItem: () => false,
    collectionSlots: () => 0, standSync: no, dispatch: no, idle: no, startStorage: async () => { throw Error('storage failed'); },
    logStorageError: (...args) => calls.push(['error', ...args]), clearOwnedCommand: (_, matches) => calls.push(['matches', matches(command)]),
    dispatchBank: () => calls.push('bank'), activeNames: () => ['P'], persist: no, now: () => 200000 });
  service.observe({ name: 'P' }, false); await Promise.resolve();
  assert.equal(state.bankCurrent, null); assert.deepEqual(calls[0], ['matches', false]);
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'queue' && call[2] === 'gold threshold'));
  assert.deepEqual(calls.at(-1), ['error', 'Bankboi scheduler failed', 'error', 'storage failed']);
  state.statuses = { P: { name: 'P', gold: 0 } }; service.observe({ name: 'P' }, false); await Promise.resolve();
  assert.equal(state.thresholdRunActive, false); assert.deepEqual(state.bankCycleMembers, {});
});

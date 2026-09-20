const test = require('node:test'), assert = require('node:assert/strict');
const { createCoordinatorMerchantIdle } = require('../../runtime/coordinator/merchant/idle-composition.ts');
function fixture() {
  const state = { bankboiTransaction: null, merchantCharacter: 'M', statuses: { M: { seenAt: 100, map: 'bank' } },
    merchantCurrent: null, merchantForceStand: false, merchantQueue: [], gatheringModes: [], gatheringCooldowns: {},
    standListings: [], commands: {}, nextCommandId: 7, activeRealm: 'SR_USII' };
  const ports = { now: () => 100, anniversary: () => ({}), ensureHome: () => true, inventoryMerge: () => null,
    storageBusy: () => false, storagePlan: () => null, capacityBlocked: () => false, collectionReady: () => true };
  return { state, ports, service: createCoordinatorMerchantIdle(state, ports) };
}
test('only runnable queued work blocks idle, including capacity and marked collection eligibility', () => {
  for (const setup of [f => { f.state.merchantQueue[0].retryAt = 101; },
    f => { f.state.merchantQueue[0].blockedOnBankboi = true; },
    f => { f.ports.capacityBlocked = () => true; }, f => { f.ports.collectionReady = () => false; }]) {
    const f = fixture(); f.state.merchantQueue = [{ id: 'job', target: 'A', reason: 'service' }];
    f.service.idle(); assert.equal(f.state.commands.M, undefined);
    setup(f); f.service.idle(); assert.equal(f.state.commands.M.type, 'merchant-idle');
  }
});
test('idle command retains current listings, realm and sequence, and storage prevents issuance', () => {
  const f = fixture(), listings = [{ state: 'pending' }]; f.state.standListings = listings;
  f.state.bankboiTransaction = {}; f.service.idle(); assert.equal(f.state.nextCommandId, 7);
  f.state.bankboiTransaction = null; f.state.activeRealm = 'SR_EUI'; f.service.idle();
  assert.deepEqual(f.state.commands.M, { id: 7, type: 'merchant-idle', listings, homeRealm: 'SR_EUI', inventoryMerge: null });
  assert.equal(f.state.commands.M.listings, listings); assert.equal(f.state.nextCommandId, 8);
  f.service.idle(); assert.equal(f.state.nextCommandId, 8);
});

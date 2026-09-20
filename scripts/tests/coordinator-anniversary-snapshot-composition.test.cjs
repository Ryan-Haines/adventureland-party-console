const test = require('node:test'), assert = require('node:assert/strict');
const { createCoordinatorAnniversarySnapshot } = require('../../runtime/coordinator/anniversary/snapshot-composition.ts');
test('anniversary composition follows current merchant and status records without retaining stale realm data', () => {
  const state = { anniversary: { nativeSlice: 'slice_nightberry', eventCycle: null, abortedRounds: {}, partyHold: null,
    rounds: {}, attempts: {}, returnDestination: null, chatAdvertisement: null, activity: [], crafted: 0, advertisedRounds: {} },
    statuses: { M: { seenAt: 100, server: 'USII' } }, leader: 'P', merchantCharacter: 'M', followers: {} };
  const workers = { N: { realm: 'SR_EUI' } };
  const service = createCoordinatorAnniversarySnapshot(state, workers, { now: () => 100, counts: () => ({ slice_nightberry: 12 }),
    enabled: () => true, owned: () => ({}), log() {}, persist() {} });
  assert.equal(service.snapshot().merchant, 'M');
  state.merchantCharacter = 'N'; state.statuses = {};
  const next = service.snapshot(); assert.equal(next.merchant, 'N'); assert.ok(next.message.includes('EU I'));
  state.statuses = { N: { seenAt: 100, server: 'USII' } };
  assert.ok(service.snapshot().message.includes('US II'));
});

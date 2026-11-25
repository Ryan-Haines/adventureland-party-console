// The merchant queue's restart migration of saved cleanouts, which left the live W03 window
// (test-windows DESIGN.md 4.3, A9): the live row restored twenty historical cleanouts through the
// saved settings and read the queue the restart left. W03 keeps selling only the excess stock on a
// real cleanout visit.
const assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { createMerchantQueue } = require('../../runtime/merchant-jobs/coordinator/owner.ts');

// The live row's saved queue: twenty cleanouts of one recipient, each with a rendezvous count of
// 0, 1 or 2, and the merchant idle.
function restored() {
  const queue = Array.from({ length: 20 }, (_, i) => ({ id: 'historical-cleanout-' + i, target: 'W', reason: 'inventory cleanout',
    queuedAt: 1000 + i, rendezvousRetryCount: i % 3, retryAt: 61_000 }));
  const state = { queue, current: null, blocks: {} };
  const ports = { merchant: () => 'M', bankboi: () => false, capacitySignature: () => 'new', gold: () => ({ bank: 0, merchant: 0 }),
    nextId: () => 'next', now: () => 1000, routinePriority: () => 95, priority: job => job.priority ?? 95, stamp: job => ({ ...job, priority: 95 }),
    hasPendingStandInventory: () => false, persist() {}, dispatch() {}, log() {} };
  createMerchantQueue(state, ports);
  return { state };
}

scenarioTable('a restart migrates saved cleanouts of one recipient into one job', restored, [
  ['twenty saved cleanouts leave one, which keeps the highest rendezvous retry count', ({ state }) => {
    const cleanouts = state.queue.filter(job => job.reason === 'inventory cleanout' && job.target === 'W');
    assert.equal(cleanouts.length, 1);
    assert.equal(cleanouts[0].rendezvousRetryCount, 2);
  }],
]);

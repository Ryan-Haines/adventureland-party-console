// The tasks owner's ladder steps on a manual trip, which left the live W10 window (test-windows
// DESIGN.md 4.3, T12): the live row planted them through taskOps on the trip that held the party,
// so they need no game. W10 keeps the unreachable travel and the assembly wait on a stunned member.
const assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { createTaskOwner, MANUAL_SOURCE } = require('../../runtime/tasks/coordinator/owner.ts');

function trip() {
  const saved = [], owner = createTaskOwner({ now: () => 1000, notify() {}, snapshot: (group, trigger) => saved.push([group, trigger]) });
  owner.sync([{ id: 'party:L', kind: 'party', members: ['L', 'F'] }]);
  const handle = owner.request('party:L', { kind: 'manual', owner: 'manual:trip', members: ['L', 'F'], source: MANUAL_SOURCE });
  owner.tick();
  return { owner, handle, safePoints: () => saved.filter(([group, trigger]) => group === 'party:L' && trigger === 'safe-point').length };
}

scenarioTable('a manual trip climbs its ladder and comes back to its walk on progress', trip, [
  ['two route failures go to regroup and the safe point, which saves one snapshot, and progress returns the trip to its walk rung', ({ owner, handle, safePoints }) => {
    assert.equal(owner.live('party:L').kind, 'manual', 'precondition: the trip holds the party');
    const before = safePoints();
    const steps = [owner.fail(handle, 'e2e-route'), owner.fail(handle, 'e2e-route'), owner.progress(handle), owner.rung(handle)];
    assert.deepEqual(steps.map(s => s?.rung ?? s), ['regroup', 'safe-point', true, 'walk'], 'regroup, safe point, progress, then the rung');
    assert.equal(safePoints() - before, 1, 'the safe point step saves one snapshot');
  }],
]);

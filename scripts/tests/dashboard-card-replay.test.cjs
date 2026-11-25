const {test}=require('node:test'),assert=require('node:assert/strict');
const {replay}=require('./helpers/dashboard-card-replay.cjs');

// The benchmark's card replay (tools/dashboard/benchmarks/dashboard-optimizations.cjs) counts each
// counted component's calls.
test('the replay counts the map renders a movement sample causes', async () => {
  const result = await replay({steps: 2});
  assert.ok(result.movement.renders.map > 0, 'each position sample renders the map section');
  assert.equal(result.movement.renders.card, 0, 'a position sample leaves the card alone');
});

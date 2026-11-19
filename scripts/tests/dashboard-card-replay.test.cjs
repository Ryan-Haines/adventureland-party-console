const {test}=require('node:test'),assert=require('node:assert/strict');
const {replay,modelShape,cardModel}=require('./helpers/dashboard-card-replay.cjs');

// The benchmark's card replay (tools/dashboard/benchmarks/dashboard-optimizations.cjs) builds its
// model from PartyConsoleModel's fields and counts each counted component's calls.
test('the replay model refuses a field PartyConsoleModel lacks, at build and on read', () => {
  const shape = modelShape();
  assert.ok(shape.has('threshold') && shape.has('save'), 'the shape is usePartyConsole\'s returned fields');
  assert.throws(() => cardModel(shape, {thresholdText: '100'}), /PartyConsoleModel has no field thresholdText/);
  const model = cardModel(shape, {threshold: '100'});
  assert.equal(model.threshold, '100');
  assert.equal(typeof model.save, 'function', 'an unsupplied field is a no-op action');
  assert.throws(() => model.thresholdText, /a card read thresholdText/);
});

test('the replay counts the map renders a movement sample causes', async () => {
  const result = await replay({steps: 2});
  assert.ok(result.movement.renders.map > 0, 'each position sample renders the map section');
  assert.equal(result.movement.renders.card, 0, 'a position sample leaves the card alone');
});

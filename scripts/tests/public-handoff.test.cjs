const { test } = require('node:test');
const assert = require('node:assert/strict');
const { publicHandoff } = require('../../runtime/roster/public-handoff.ts');

test('completed transfers never expose stale timeout flags to older dashboards', () => {
  const operation = { phase: 'complete', startedAt: 1, timedOut: true, error: null };
  assert.equal(publicHandoff(operation).timedOut, false);
  assert.equal(operation.timedOut, true, 'serialization does not mutate stored ownership');
  assert.equal(publicHandoff(null), null);
});

test('only an actual timeout failure exposes the compatibility timeout flag', () => {
  const operation = { phase: 'navigate', startedAt: 1, error: null };
  assert.equal(publicHandoff(operation).timedOut, false);
  operation.phase = 'failed';
  operation.error = 'Steam handoff timed out; ownership remains reserved until recovery';
  assert.equal(publicHandoff(operation).timedOut, true);
  operation.error = 'Bootstrap could not be saved';
  assert.equal(publicHandoff(operation).timedOut, false);
});

// The targeting hooks fixture add-on's heard list (e2e/fixtures/targeting-hooks-addon.ts), which
// e2e/live-targeting-hooks.spec.ts reads at each step. A live run tells every pass's changed and
// passed notices, several a second on the leader, so a rare notice such as targeting.retired must
// outlast them until the step that reads it.
const assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { targetingHooks, CHARACTER_NOTICES } = require('../../e2e/fixtures/targeting-hooks-addon.ts');

// The character half on a registry whose reads answer nothing.
function characterHalf() {
  globalThis.__partyHooks = { turns: { target: () => undefined, allows: () => undefined }, targeting: {}, askRow: () => ({ attacking: false }) };
  const state = { heard: [], asked: {}, answers: {} };
  return { state, hooks: targetingHooks(state, 'character', CHARACTER_NOTICES) };
}

scenarioTable("the targeting hooks fixture's heard list", characterHalf, [
  // A live hooks run: the warrior's one retired notice came about 90 s before the retired step, and
  // the passes told since then pushed it out of a list bounded as a whole.
  ['a retired notice outlasts the passes told after it', ({ state, hooks }) => {
    hooks['targeting.retired']({ character: 'W', target: 'goo', why: 'approach', by: 'core:targeting' });
    for (let i = 0; i < 3000; i++) {
      hooks['targeting.changed']({ character: 'W', from: 'bee', to: 'bee', row: 'S3', by: 'core:targeting' });
      hooks['targeting.passed']({ character: 'W', target: 'bee', row: 'S3', by: 'core:targeting' });
    }
    assert.deepEqual(state.heard.filter(h => h.hook === 'targeting.retired').map(h => h.payload.target), ['goo']);
    assert.ok(state.heard.length <= 2001, `the list stays bounded (${state.heard.length})`);
    assert.equal(state.heard.at(-1).hook, 'targeting.passed', 'the newest pass is kept');
  }],
]);

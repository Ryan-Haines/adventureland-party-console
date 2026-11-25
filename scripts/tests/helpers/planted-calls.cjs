// A planted call budget for owner tests that run with no game socket.
// The registry's `calls` dispatch has
// no fallback, an owner's question fails in a realm with no budget. This registration answers in
// the budget's place on the realm's registry: every question `send`, and the margin a row plants.
// No run loads it.
const { partyHooks } = require('../../../runtime/hooks/index.ts');
const { CALL_WINDOW_MS } = require('../../../runtime/characters/call-budget.ts');

const planted = { margin: 0 };
// A realm's registry: the test's own by default, or a bundle's in a vm context (`c.__partyHooks`).
function plantCalls(...realm) {
  const registry = realm.length ? realm[0] : partyHooks();
  if (!registry) throw Error('plantCalls: the realm has no registry yet');
  if (!registry.registrations().some(r => r.name === 'core:planted-calls'))
    registry.register({ name: 'core:planted-calls', folder: 'core', author: 'test', summary: 'A planted call budget.',
      hooks: { 'calls.band': () => 'send', 'calls.margin': () => planted.margin, 'calls.window': () => CALL_WINDOW_MS } });
  return registry;
}
// A bundle run in a vm context creates its realm's registry on its first `partyHooks()`
// (runtime/hooks/index.ts); the planted budget registers on it then. A context that already holds
// its registry, as one an earlier bundle such as the targeting owner's module made, keeps it, so every bundle in the
// context answers and asks on that one registry.
function plantCallsWhenCreated(context) {
  if (context.__partyHooks) { plantCalls(context.__partyHooks); return; }
  Object.defineProperty(context, '__partyHooks', { configurable: true, get: () => undefined,
    set(registry) { Object.defineProperty(context, '__partyHooks', { configurable: true, writable: true, value: registry }); plantCalls(registry); } });
}
// Runs `run` with the planted margin at `margin`.
async function withMargin(margin, run) {
  plantCalls();
  const prior = planted.margin;
  planted.margin = margin;
  try { await run(); } finally { planted.margin = prior; }
}

module.exports = { plantCalls, plantCallsWhenCreated, withMargin };

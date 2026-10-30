const test = require('node:test'), assert = require('node:assert/strict');
const { createFormationRoute } = require('../../runtime/coordinator/http/formation.ts');
const { supportedEvents, eventPriorityOrder } = require('../../dashboard/lib/event-policy.ts');
// Failure inventory: docs/testing-october-events.md § Event priorities from an older client.
const older = ['mrgreen', 'mrpumpkin', 'anniversary', 'abtesting', 'goobrawl', 'crabxx', 'franky', 'icegolem', 'snowman', 'slenderman'];
function post(eventPriorities) {
  const state = { leader: null, merchantCharacter: null, followers: {}, eventsByCharacter: {}, eventLimitsByCharacter: {}, eventPrioritiesByCharacter: {}, eventSelectionsByCharacter: {} };
  const route = createFormationRoute(state, { managed: () => true, owned: () => true, supported: supportedEvents, inherited: () => false, selected: () => [], persist() {} });
  let code = 200, body;
  route({ body: { character: 'W', eventPriorities } }, { status(value) { code = value; return this; }, json(value) { body = value; return this; } });
  return { code, body, saved: state.eventPrioritiesByCharacter.W };
}

test('an older client list keeps its order and gains the new events in catalog order', () => {
  const result = post(older);
  assert.equal(result.code, 200);
  assert.deepEqual(result.saved, [...older, ...supportedEvents.filter(id => !older.includes(id))]);
  assert.deepEqual(post(supportedEvents).saved, supportedEvents, 'a complete list is unchanged');
});

test('a list missing a pre-existing event, repeating an id or naming an unknown one is rejected', () => {
  for (const list of [older.slice(1), [...older, 'mrgreen'], [...older, 'nosuchevent'], 'mrgreen'])
    assert.equal(post(list).code, 400, JSON.stringify(list));
});

test('a saved older list reads with the new events appended', () => {
  assert.deepEqual(eventPriorityOrder({ eventPrioritiesByCharacter: { W: older } }, 'W'), [...older, ...supportedEvents.filter(id => !older.includes(id))]);
});

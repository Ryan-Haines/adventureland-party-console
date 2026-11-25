const test = require('node:test'), assert = require('node:assert/strict');
const { activeCoordinatorNames, updateCoordinatorABStrategy } = require('../../runtime/events/coordinator/abtesting.ts');

test('active names preserve status order and include the exact ten-second boundary', () => {
  assert.deepEqual(activeCoordinatorNames({ B: { name: 'B', seenAt: 10000 }, A: { name: 'A', seenAt: 9999 },
    C: { name: 'C', seenAt: 20001 } }, 20000), ['B', 'C']);
});

test('AB strategy evaluates merchants and excludes disabled members, persisting only serialized changes', () => {
  const state = { merchantCharacter: 'M', abtestingStrategy: null, statuses: {
    W: { name: 'W', activeEvent: 'abtesting', activeEventId: 'event', eventTeam: 'a' },
    P: { name: 'P', activeEvent: 'abtesting', activeEventId: 'event', eventTeam: 'b' },
  } };
  let writes = 0; const checked = [];
  const ports = { activeNames: () => ['W', 'P', 'M'], enabled: (name, event) => { checked.push([name, event]); return name === 'W'; },
    now: () => 1000, persist: () => writes++ };
  const result = updateCoordinatorABStrategy(state, ports);
  assert.deepEqual(checked, [['W', 'abtesting'], ['P', 'abtesting'], ['M', 'abtesting']]);
  assert.deepEqual(result.expectedNames, ['W']); assert.equal(writes, 1);
  updateCoordinatorABStrategy(state, ports); assert.equal(writes, 1);
  state.statuses = {}; updateCoordinatorABStrategy(state, ports);
  assert.deepEqual(state.abtestingStrategy, result); assert.equal(writes, 1);
  state.statuses = { W: { name: 'W', activeEvent: 'abtesting', activeEventId: 'next', eventTeam: 'b' } };
  updateCoordinatorABStrategy(state, ports);
  assert.equal(state.abtestingStrategy.eventId, 'next'); assert.equal(writes, 2);
});

// The `abtesting.strategy` row: A/B Testing needs two server teams, which the live
// table cannot seed. The notice goes once per change of the saved strategy.
test('U: a strategy change is announced', () => {
  const heard = [];
  require('../../runtime/hooks/index.ts').partyHooks().publish({ name: 'test:abtesting-strategy', folder: 'core', author: 'test',
    summary: 'Hears the A/B strategy.', hooks: { 'abtesting.strategy': payload => heard.push(payload) } });
  const state = { merchantCharacter: null, abtestingStrategy: null, statuses: {
    W: { name: 'W', activeEvent: 'abtesting', activeEventId: 'event', eventTeam: 'a' } } };
  const ports = { activeNames: () => ['W'], enabled: () => true, now: () => 1000, persist() {} };
  updateCoordinatorABStrategy(state, ports); updateCoordinatorABStrategy(state, ports);
  assert.equal(heard.length, 1, 'an unchanged strategy is not announced again');
  assert.equal(heard[0].by, 'core:events');
  assert.deepEqual(heard[0].strategy, state.abtestingStrategy);
});
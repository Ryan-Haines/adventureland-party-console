const test = require('node:test'), assert = require('node:assert/strict');
const { activeCoordinatorNames, updateCoordinatorABStrategy } = require('../../runtime/coordinator/events/abtesting-update.ts');

test('active names preserve status order and include the exact ten-second boundary', () => {
  assert.deepEqual(activeCoordinatorNames({ B: { name: 'B', seenAt: 10000 }, A: { name: 'A', seenAt: 9999 },
    C: { name: 'C', seenAt: 20001 } }, 20000), ['B', 'C']);
});

test('AB strategy excludes merchant and disabled members, persisting only serialized changes', () => {
  const state = { merchantCharacter: 'M', abtestingStrategy: null, statuses: {
    W: { name: 'W', activeEvent: 'abtesting', activeEventId: 'event', eventTeam: 'a' },
    P: { name: 'P', activeEvent: 'abtesting', activeEventId: 'event', eventTeam: 'b' },
  } };
  let writes = 0; const checked = [];
  const ports = { activeNames: () => ['W', 'P', 'M'], enabled: (name, event) => { checked.push([name, event]); return name === 'W'; },
    now: () => 1000, persist: () => writes++ };
  const result = updateCoordinatorABStrategy(state, ports);
  assert.deepEqual(checked, [['W', 'abtesting'], ['P', 'abtesting']]);
  assert.deepEqual(result.expectedNames, ['W']); assert.equal(writes, 1);
  updateCoordinatorABStrategy(state, ports); assert.equal(writes, 1);
  state.statuses = {}; updateCoordinatorABStrategy(state, ports);
  assert.deepEqual(state.abtestingStrategy, result); assert.equal(writes, 1);
  state.statuses = { W: { name: 'W', activeEvent: 'abtesting', activeEventId: 'next', eventTeam: 'b' } };
  updateCoordinatorABStrategy(state, ports);
  assert.equal(state.abtestingStrategy.eventId, 'next'); assert.equal(writes, 2);
});

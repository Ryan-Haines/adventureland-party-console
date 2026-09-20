const test = require('node:test'), assert = require('node:assert/strict');
const {initialCoordinatorHistory} = require('../../runtime/coordinator/telemetry/initial-history.ts');
const {createCombatLogRoutes} = require('../../runtime/coordinator/telemetry/combat-log.ts');

test('appending normalized combat logs preserves legacy entries and their identity', () => {
  const legacy = {at: 'old timestamp', message: 'legacy observation', custom: true};
  const state = initialCoordinatorHistory({combatLogs: {P: [legacy]}}, {});
  const handlers = {}, replies = [];
  let persists = 0;
  createCombatLogRoutes(state.combatLogs, {owned: name => name === 'P', now: () => 100,
    persist: () => persists++}).install({post: (path, handler) => handlers[path] = handler});
  handlers['/party-api/combat-log']({body: {character: 'P', events: [{message: 'new', details: 7}]}},
    {json: value => replies.push(value), status: () => assert.fail('valid log was rejected')});
  assert.equal(state.combatLogs.P[0], legacy);
  assert.equal(legacy.at, 'old timestamp');
  assert.deepEqual(state.combatLogs.P[1], {at: 100, type: 'event', message: 'new', details: 7});
  assert.deepEqual(replies, [{ok: true, count: 2}]);
  assert.equal(persists, 1);
});

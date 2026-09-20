const test = require('node:test'), assert = require('node:assert/strict');
const { createCoordinatorPartyConvoys } = require('../../runtime/coordinator/navigation/convoy-composition.ts');

test('convoy composition resolves current Hunt target or shared focus and preserves command sequencing', () => {
  const state = { leader: 'A', merchantCharacter: 'M', statuses: { A: { seenAt: 100, map: 'main', x: 0, y: 0, server: 'USII' } },
    followers: {}, commands: {}, activeConvoy: null, navigationEpoch: 0, location: null, nextCommandId: 7,
    monsterChoices: [{ id: 'goo' }], farmingPolicy: 'hunt', monsterHunt: { target: 'rat' }, monsterFocus: ['goo'] };
  const calls = [], input = { map: 'main', x: 50, y: 60 };
  const service = createCoordinatorPartyConvoys(state, { now: () => 100, activeNames: () => ['A'], intent: () => ({ revision: 2 }), persist() {},
    resolveArea: (...args) => { calls.push(args); return { ...input, label: 'resolved' }; } });
  assert.equal(service.start(input), true);
  assert.equal(calls[0][0], state.monsterChoices); assert.deepEqual(calls[0][1], ['rat']); assert.equal(calls[0][2], input);
  assert.equal(state.activeConvoy.location.label, 'resolved');
  assert.equal(state.commands.A.type, 'party-monster-travel');
  const priorId = state.commands.A.id;
  state.farmingPolicy = 'auto'; service.start(input);
  assert.equal(calls[1][1], state.monsterFocus); assert.ok(state.commands.A.id > priorId);
  state.farmingPolicy = 'hunt'; state.monsterHunt.target = null; state.monsterFocus = [];
  service.start(input); assert.deepEqual(calls[2][1], []);
  const count = calls.length; service.start(input, undefined, undefined, 'grouped-approach');
  assert.equal(calls.length, count);
  assert.equal(service.start(input, 'rebuilt ordinary convoy', ['A'], null), true);
  assert.equal(state.activeConvoy.purpose, null);
  assert.equal(state.commands.A.purpose, null);
  assert.equal(calls.length, count + 1, 'null-purpose rebuild retains ordinary area resolution');
  service.start(input, 'selected wild boar', ['A'], 'manual-monster-override');
  assert.equal(state.activeConvoy.combatHandoffAllowed, true);
  assert.equal(state.commands.A.combatHandoffAllowed, true);
});

const test = require('node:test'), assert = require('node:assert/strict');
const {coordinatorHuntParticipants, cancelCoordinatorHuntConvoy, clearCoordinatorHunt,
  coordinatorHuntDestination, coordinatorHuntThreat} = require('../../runtime/coordinator/hunt/controls.ts');

test('Hunt participants require a fresh combat leader and keep only its active same-realm followers', () => {
  const member = {seenAt: 90000, server: 'II', ctype: 'warrior'};
  const state = {leader: 'Z', followers: {B: true, A: true, Merchant: true, Away: true, Offline: true},
    statuses: {Z: {...member}, A: member, B: member, Stranger: member, Offline: member,
      Merchant: {...member, ctype: 'merchant'}, Away: {...member, server: 'I'}}};
  const active = () => ['B', 'Away', 'Merchant', 'Stranger', 'A', 'Z', 'Missing'];
  assert.deepEqual(coordinatorHuntParticipants(state, () => 100000, active), ['Z', 'A', 'B']);
  const forbidden = () => assert.fail('inactive leader must not query active members');
  state.statuses.Z.seenAt--;
  assert.deepEqual(coordinatorHuntParticipants(state, () => 100000, forbidden), []);
  state.statuses.Z = {...member, ctype: 'merchant'};
  assert.deepEqual(coordinatorHuntParticipants(state, () => 100000, forbidden), []);
  delete state.statuses.Z;
  assert.deepEqual(coordinatorHuntParticipants(state, () => assert.fail('missing leader must not read clock'), forbidden), []);
});

test('Hunt cancellation scopes cleanup to convoy participants; clearing also removes orphan Hunt commands', () => {
  const manual = {purpose: 'manual'}, hunt = {purpose: 'monster-hunt'};
  const state = {activeConvoy: {purpose: 'monster-hunt', participants: ['A', 'B', 'Missing']},
    commands: {A: hunt, B: manual, C: hunt}, monsterHunt: {cycleId: 'cycle', participants: ['A','B','C']}};
  cancelCoordinatorHuntConvoy(state);
  assert.equal(state.activeConvoy, null); assert.deepEqual(state.commands, {B: manual, C: hunt});
  assert.equal(state.monsterHunt.cycleId, 'cycle');
  const eventConvoy = state.activeConvoy = {purpose: 'event-return', participants: ['B']};
  clearCoordinatorHunt(state);
  assert.equal(state.activeConvoy, eventConvoy); assert.equal(state.monsterHunt, null);
  assert.deepEqual(state.commands, {B: manual}); assert.equal(state.commands.B, manual);
});

test('Hunt destinations preserve zone identity, coercion and stable ties while excluding cross-map distance', () => {
  const state = {leader: 'W', statuses: {W: {map: 'main', x: '10', y: '0'}}, monsterChoices: [{id: 'rat', locations: [{}]}]};
  const foreign = {map: 'cave', x: 10, y: 0}, far = {map: 'main', x: 100, y: 0};
  const first = {map: 'main', x: '9', y: 0}, tied = {map: 'main', x: 11, y: 0};
  assert.equal(coordinatorHuntDestination(state, 'rat', (choices, focus) => {
    assert.equal(choices, state.monsterChoices); assert.deepEqual(focus, ['rat']);
    return [foreign, far, first, tied];
  }), first);
  state.statuses = {W: {map: 'elsewhere', x: 0, y: 0}};
  assert.equal(coordinatorHuntDestination(state, 'rat', () => [foreign, first]), foreign);
  assert.equal(coordinatorHuntDestination(state, 'rat', () => []), undefined);
  state.monsterChoices[0].locations = [];
  assert.equal(coordinatorHuntDestination(state, 'rat', () => assert.fail('no valid locations')), null);
});

test('Hunt threat lookup retains numeric coercion and zero fallback', () => {
  const catalog = [{id: 'rat', threat: '2.5', hp: '800'}, {id: 'bad', threat: 'unknown', hp: null}];
  assert.deepEqual(coordinatorHuntThreat(catalog, 'rat'), {threat: 2.5, hp: 800});
  assert.deepEqual(coordinatorHuntThreat(catalog, 'bad'), {threat: 0, hp: 0});
  assert.deepEqual(coordinatorHuntThreat(undefined, 'rat'), {threat: 0, hp: 0});
});

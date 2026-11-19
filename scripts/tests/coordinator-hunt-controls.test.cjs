const test = require('node:test'), assert = require('node:assert/strict');
const {cancelCoordinatorHuntConvoy, clearCoordinatorHunt, coordinatorHuntDestination} = require('../../runtime/hunting/coordinator/hunt.ts');
const {coordinatorHuntParticipants} = require('../../runtime/tasks/coordinator/groups.ts');

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
  // Movement's cancel of the group's walk.
  const cancel = () => { state.activeConvoy = null; };
  cancelCoordinatorHuntConvoy(state, cancel);
  assert.equal(state.activeConvoy, null); assert.deepEqual(state.commands, {B: manual, C: hunt});
  assert.equal(state.monsterHunt.cycleId, 'cycle');
  const eventConvoy = state.activeConvoy = {purpose: 'event-return', participants: ['B']};
  clearCoordinatorHunt(state, cancel);
  assert.equal(state.activeConvoy, eventConvoy); assert.equal(state.monsterHunt, null);
  assert.deepEqual(state.commands, {B: manual}); assert.equal(state.commands.B, manual);
});

test("Hunt destinations take the nearest spawn on the leader's map, ties in catalog order", () => {
  const spawn = ({map, x, y}) => ({map, x, y});
  const locations = [{map: 'cave', x: 10, y: 0}, {map: 'main', x: 100, y: 0}, {map: 'main', x: 9, y: 0}, {map: 'main', x: 11, y: 0}];
  const state = {leader: 'W', statuses: {W: {map: 'main', x: 10, y: 0}}, monsterChoices: [{id: 'rat', locations}]};
  assert.deepEqual(spawn(coordinatorHuntDestination(state, 'rat')), locations[2]);
  state.statuses = {W: {map: 'elsewhere', x: 0, y: 0}};
  assert.deepEqual(spawn(coordinatorHuntDestination(state, 'rat')), locations[0], "no spawn on the leader's map: catalog order");
  state.monsterChoices[0].locations = [];
  assert.equal(coordinatorHuntDestination(state, 'rat'), null);
});

// While the deploy lease names a participant the Hunt takes no step and says why; the release
// half runs in the end run's live rows.
test('a planted lease naming the priest holds the Hunt with its label',()=>{
 const {createHunt}=require('../../runtime/hunting/coordinator/hunt.ts');
 const {huntMessage}=require('../../runtime/hunting/coordinator/record.ts');
 const lease=['P'];
 const s={targetMode:'hunt',leader:'W',followers:{P:true},statuses:{},commands:{},
  monsterHunt:{cycleId:'c',stage:'farming',participants:['W','P'],missions:[],currentIndex:-1,target:'bee',startedAt:1}};
 const hunt=createHunt(s,{now:()=>5000,persist(){},cancelConvoy(){},navigation:{intent:()=>({revision:0})},drain:()=>({participants:lease})});
 hunt.tick();
 assert.deepEqual([s.monsterHunt.stage,huntMessage(s.monsterHunt)],['farming','Waiting for safe console load; finishing current combat']);
});

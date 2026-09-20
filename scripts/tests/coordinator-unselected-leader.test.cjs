const test = require('node:test'), assert = require('node:assert/strict');
const {coordinatorHuntParticipants, coordinatorHuntDestination} = require('../../runtime/coordinator/hunt/controls.ts');
const {coordinatorEventCheckpoint} = require('../../runtime/coordinator/navigation/runtime.ts');
const {projectEventSchedules} = require('../../runtime/coordinator/events/schedule-reports.ts');
const {createPartyConvoys} = require('../../runtime/coordinator/navigation/convoy.ts');
const {selectCoordinatorMonsterDestination} = require('../../runtime/coordinator/navigation/selected-destination.ts');
const {createHuntMode} = require('../../runtime/coordinator/hunt/mode.ts');

test('Hunt authorization preserves an exhausted destination result and missing quest id', () => {
  const calls = [], state = {leader: 'L', farmingPolicy: 'auto', monsterHunt: null,
    monsterHunterLocation: null, statuses: {}, monsterFocus: [], monsterFocusByCharacter: {}};
  const mode = createHuntMode(state, {participants: () => ['L'], release: () => {},
    monsterDestination: id => {calls.push(['destination', id]); return undefined;},
    authorize: (names, location, shared) => calls.push(['authorize', names, location, shared]),
    begin: () => {}});
  mode.select('hunt', null, undefined, false);
  assert.deepEqual(calls, [['destination', undefined], ['authorize', ['L'], undefined, true]]);
});

test('unselected convoy leader returns before clock, routing, or command allocation', () => {
  const unexpected = () => assert.fail('missing leader must not start convoy work');
  const state = {leader: null, statuses: {}, activeConvoy: null};
  const convoy = createPartyConvoys(state, new Proxy({}, {get: () => unexpected}));
  assert.equal(convoy.start({map: 'main', x: 10, y: 20}), false);
  assert.deepEqual(state, {leader: null, statuses: {}, activeConvoy: null});
});

test('convoy replacement history retains each destination and navigation revision',()=>{
 let sequence=1;
 const state={leader:'L',merchantCharacter:null,followers:{},statuses:{L:{map:'main',x:0,y:0,seenAt:1000,speed:60}},
  activeConvoy:null,commands:{},combatLogs:{},navigationEpoch:0,monsterHunt:{stage:'mission-travel',target:'cgoo'}};
 const convoys=createPartyConvoys(state,{now:()=>1000,nextCommand:()=>sequence++,activeNames:()=>['L'],
  intent:()=>({revision:7}),resolve:x=>x,persist(){}});
 convoys.start({map:'arena',x:384,y:-420},'hunt cgoo',undefined,'monster-hunt');
 const first=state.activeConvoy.id;
 convoys.start({map:'main',x:100,y:200},'next hunt',undefined,'monster-hunt');
 const entries=state.combatLogs.L;
 assert.deepEqual(entries.map(e=>e.message),['Convoy started','Convoy cancelled','Convoy started']);
 assert.equal(entries[0].details.destination.map,'arena');assert.equal(entries[1].details.convoyId,first);
 assert.equal(entries[2].details.replacedConvoyId,first);assert.equal(entries[2].details.destination.map,'main');
 assert.equal(entries[2].details.revisions.L,7);
});

test('null destination selection retains shared focus and original dictionary lookup', () => {
  const location = {map: 'main', x: 1, y: 2};
  const state = {leader: null, followers: {}, statuses: {}, monsterFocus: ['rat'],
    monsterFocusByCharacter: {null: []}, monsterPrioritiesByCharacter: {},
    monsterChoices: [{id: 'rat', locations: [location]}]};
  assert.equal(selectCoordinatorMonsterDestination(state, null), null);
  state.statuses.null = location;
  assert.deepEqual(selectCoordinatorMonsterDestination(state, null), {id: 'rat', location});
});

test('unselected Hunt leader does not query members, clock or destination zones', () => {
  const unexpected = () => assert.fail('unselected leader must not start Hunt work');
  const state = {leader: null, statuses: {}, followers: {}, monsterChoices: [{id: 'rat', locations: [{}]}]};
  assert.deepEqual(coordinatorHuntParticipants(state, unexpected, unexpected), []);
  assert.equal(coordinatorHuntDestination(state, 'rat', unexpected), null);
});

test('checkpoint adapter forwards null leader unchanged to the navigation owner', () => {
  const names = [];
  assert.equal(coordinatorEventCheckpoint({leader: null}, name => {names.push(name); return null;}), null);
  assert.deepEqual(names, [null]);
});

test('unselected leader keeps latest cross-realm feed and legacy dictionary key semantics', () => {
  const reports = {P: {seenAt: 100, server: 'I', eventFeedAt: 90, eventSchedules: [{id: 'old'}]},
    W: {seenAt: 100, server: 'II', eventFeedAt: 95, eventSchedules: [{id: 'new'}]}};
  assert.equal(projectEventSchedules(reports, null, () => 100)[0].id, 'new');
  // JSON dictionaries can retain this key; the old JavaScript lookup consulted it too.
  reports.null = {server: 'I'};
  assert.equal(projectEventSchedules(reports, null, () => 100)[0].id, 'old');
});

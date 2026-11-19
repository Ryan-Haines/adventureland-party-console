const test = require('node:test');
const assert = require('node:assert/strict');
const {coordinatorHuntDestination, createHunt, missionDestination} = require('../../runtime/hunting/coordinator/hunt.ts');
const {huntMessage} = require('../../runtime/hunting/coordinator/record.ts');

test('missing mission data remains unresolved and is retried without fabricating a waypoint', () => {
  const hunt = {target: 'rat', currentIndex: 0, missions: [{target: 'rat'}]};
  const destination = {map: 'house', x: 10, y: 20};
  let calls = 0;
  const resolve = target => {
    assert.equal(target, 'rat');
    return ++calls === 1 ? undefined : destination;
  };
  assert.equal(missionDestination(hunt, resolve), undefined);
  assert.equal(missionDestination(hunt, resolve), destination);
  assert.equal(missionDestination(hunt, resolve), destination);
  assert.equal(calls, 2);
  assert.equal(hunt.missions[0].destination, destination);
});

test('cleared targets and missing destinations preserve the existing no-travel hold', () => {
  const state = {leader: 'W', statuses: {W: {map: 'main', x: 0, y: 0}},
    monsterChoices: [{id: 'rat', locations: [{}]}], commands: {}, activeConvoy: null};
  assert.equal(coordinatorHuntDestination(state, null), null);
  const hunt = {participants: ['W'], stage: 'mission-travel'};
  const service = createHunt(state, {now: () => 0, start() {throw Error('No destination to visit');}, navigation: {intent: () => ({})}});
  assert.equal(service.start(hunt, undefined, 'Monster Hunt: rat', 'mission-travel'), false);
  assert.equal(huntMessage(hunt), 'Waiting for Daisy or monster spawn location data');
  assert.equal(state.activeConvoy, null);
  assert.deepEqual(state.commands, {});
});

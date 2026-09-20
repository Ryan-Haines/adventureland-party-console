const test = require('node:test');
const assert = require('node:assert/strict');
const safety = require('../hunt-safety.cjs');
const {createHuntConvoy} = require('../../runtime/coordinator/hunt/convoy.ts');
const {coordinatorHuntDestination} = require('../../runtime/coordinator/hunt/controls.ts');

test('missing mission data remains unresolved and is retried without fabricating a waypoint', () => {
  const hunt = {target: 'rat', currentIndex: 0, missions: [{target: 'rat'}]};
  const destination = {map: 'house', x: 10, y: 20};
  let calls = 0;
  const resolve = target => {
    assert.equal(target, 'rat');
    return ++calls === 1 ? undefined : destination;
  };
  assert.equal(safety.missionDestination(hunt, resolve), undefined);
  assert.equal(safety.missionDestination(hunt, resolve), destination);
  assert.equal(safety.missionDestination(hunt, resolve), destination);
  assert.equal(calls, 2);
  assert.equal(hunt.missions[0].destination, destination);
});

test('cleared targets and missing destinations preserve the existing no-travel hold', () => {
  const state = {leader: 'W', statuses: {W: {map: 'main', x: 0, y: 0}},
    monsterChoices: [{id: 'rat', locations: [{}]}], commands: {}, activeConvoy: null};
  assert.equal(coordinatorHuntDestination(state, null, () => {throw Error('No target to resolve');}), null);
  const hunt = {participants: ['W'], stage: 'mission-travel'};
  const convoy = createHuntConvoy(state, {start() {throw Error('No destination to visit');}});
  assert.equal(convoy.start(hunt, undefined, 'Monster Hunt: rat', 'mission-travel'), false);
  assert.equal(hunt.message, 'Waiting for Daisy or monster spawn location data');
  assert.equal(state.activeConvoy, null);
  assert.deepEqual(state.commands, {});
});

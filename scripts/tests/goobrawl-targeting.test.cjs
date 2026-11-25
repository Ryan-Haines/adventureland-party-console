const { targetingContext } = require('./helpers/targeting-module.cjs');
const {productionFunctions} = require('./helpers/production-functions.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Targeting's stand-ins for the sliced context. The finder asks the events owner's facts
// (helpers/character-events.cjs) over the context's attendance and game data: Goo Brawl is the catalog's
// area event on its map, whose goos `G.monsters` knows.

const code = productionFunctions(['nearestEventTarget']);

function fixture() {
  const entities = {
    near: { id: 'near', type: 'monster', mtype: 'bgoo', x: 5, y: 0, visible: true },
    leader: { id: 'leader', type: 'monster', mtype: 'bgoo', x: 80, y: 0, visible: true },
    party: { id: 'party', type: 'monster', mtype: 'goo', x: 60, y: 0, visible: true },
  };
  const runtime = targetingContext({
    eventAttend: { selected: () => true, joined: () => 'goobrawl', traveling: () => null }, parent: { entities }, character: { map: 'goobrawl', x: 0, y: 0 },
    G: { maps: { goobrawl: { event: 'goobrawl' } }, monsters: { rgoo: {}, bgoo: {}, goo: {} } },
    eventTargetTypes: ['rgoo', 'bgoo', 'goo'], leaderTarget: null, partyTargets: [], combatTargetId: null,
  });
  vm.runInContext(code, runtime);
  return { runtime, entities };
}

const { scenarioTable } = require('./fixtures/scenarios.cjs');
scenarioTable('the Goo Brawl target finder picks the rainbow goo, then the leader, the party and the current goo', fixture, [
['rainbow goo overrides every ordinary party target', ({ runtime, entities }) => {
  runtime.leaderTarget = { id: 'leader' };
  entities.rainbow = { id: 'rainbow', type: 'monster', mtype: 'rgoo', x: 100, y: 0, visible: true };
  assert.equal(runtime.nearestEventTarget().id, 'rainbow');
}],
['goobrawl piles onto the leader target instead of the nearest goo', ({ runtime }) => {
  runtime.leaderTarget = { id: 'leader' };
  assert.equal(runtime.nearestEventTarget().id, 'leader');
}],
['goobrawl converges on the most-selected party target', ({ runtime }) => {
  runtime.partyTargets = [{ id: 'party' }, { id: 'leader' }, { id: 'party' }];
  assert.equal(runtime.nearestEventTarget().id, 'party');
}],
['goobrawl retains the current target while party telemetry catches up', ({ runtime }) => {
  runtime.combatTargetId = 'leader';
  assert.equal(runtime.nearestEventTarget().id, 'leader');
}],
]);


const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../characters/shared.js'), 'utf8');
const code = source.slice(source.indexOf('  function nearestEventTarget('),
  source.indexOf('  function isLiveAbtesting('));

function fixture() {
  const entities = {
    near: { id: 'near', type: 'monster', mtype: 'bgoo', x: 5, y: 0, visible: true },
    leader: { id: 'leader', type: 'monster', mtype: 'bgoo', x: 80, y: 0, visible: true },
    party: { id: 'party', type: 'monster', mtype: 'goo', x: 60, y: 0, visible: true },
  };
  const runtime = vm.createContext({
    eventSelected: () => true, travellingEventName: null,
    parent: { entities }, character: { map: 'goobrawl', x: 0, y: 0 },
    G: { maps: { goobrawl: { event: 'goobrawl' } } },
    eventTargetTypes: ['rgoo', 'bgoo', 'goo'], joinedEvent: 'goobrawl',
    leaderTarget: null, partyTargets: [], combatTargetId: null,
    isLiveAbtesting: () => false, nearestAbtestingOpponent: () => null,
  });
  vm.runInContext(code, runtime);
  return { runtime, entities };
}

test('rainbow goo overrides every ordinary party target', () => {
  const { runtime, entities } = fixture();
  runtime.leaderTarget = { id: 'leader' };
  entities.rainbow = { id: 'rainbow', type: 'monster', mtype: 'rgoo', x: 100, y: 0, visible: true };
  assert.equal(runtime.nearestEventTarget().id, 'rainbow');
});

test('goobrawl piles onto the leader target instead of the nearest goo', () => {
  const { runtime } = fixture();
  runtime.leaderTarget = { id: 'leader' };
  assert.equal(runtime.nearestEventTarget().id, 'leader');
});

test('goobrawl converges on the most-selected party target', () => {
  const { runtime } = fixture();
  runtime.partyTargets = [{ id: 'party' }, { id: 'leader' }, { id: 'party' }];
  assert.equal(runtime.nearestEventTarget().id, 'party');
});

test('goobrawl retains the current target while party telemetry catches up', () => {
  const { runtime } = fixture();
  runtime.combatTargetId = 'leader';
  assert.equal(runtime.nearestEventTarget().id, 'leader');
});


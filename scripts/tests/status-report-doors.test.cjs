// The status owner's character report (runtime/status/character/report.ts) reads each owner through
// its door in ReportPorts.owners: movement's walk state and character parts, the targeting owner's grouped reads,
// The events owner's exit, the tasks owner's reunion and the status owner's own telemetry. Every door the test leaves out answers a stand-in
// value.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createReport } = require('../../runtime/status/character/report.ts');

// A door that answers any read or call with itself, so the report's other sections build.
const any = new Proxy(function () {}, {
  get: (_t, key) => key === Symbol.toPrimitive ? () => 0 : key === 'then' || key === 'toJSON' ? undefined : key === Symbol.iterator ? [][Symbol.iterator] : any,
  apply: () => any,
});
const doors = over => new Proxy(over, { get: (t, key) => key in t ? t[key] : any });
// The character frame the report reads: the hooks install puts __partyHooks on it before any report.
const root = () => ({ __partyHooks: any });

test('the report reads the walk, the targeting and the reunion through their owners\' doors', () => {
  const report = createReport({
    me: () => doors({ name: 'Ranger', map: 'main', x: 1, y: 2, items: [], slots: {}, s: {} }), G: () => doors({ drops: {} }),
    parent: () => ({ entities: {} }), root, initialTracker: () => null,
    game: doors({ entity: () => null }), current: () => true, sleep: () => Promise.resolve(), smart: () => null,
    owners: doors({
      movement: doors({ walkState: { townTraveling: false, following: false, departing: false, intent: {}, partyLocation: { map: 'main' } }, live: () => null }),
      walks: doors({ groupWalk: { travel: { id: 'c1' } }, reportGap: () => 0, isCurrentlyKiting: () => false }),
      targeting: doors({ returnCombatActive: () => false }),
      tasks: { partyList: () => ['Ranger'], reunion: () => ({ id: 'r1' }) },
      events: doors({ exit: { recovery: () => ({ phase: 'idle' }) } }),
      items: doors({ bag: doors({ facts: () => ({ banking: false, bankQueued: false, stocking: false, upgrading: false }) }) }),
    }),
  });
  const body = report.snapshot();
  assert.equal(body.navigationState, 'convoy');
  assert.deepEqual(body.farmReunion, { id: 'r1' });
  assert.deepEqual(body.eventRecovery, { phase: 'idle' });
});

test('the report leaves convoyProtocol to the walk client and names the queue protocol from runtime/protocol', () => {
  const { QUEUE_PROTOCOL, currentQueue, restorableQueue, speaksWalkProtocol } = require('../../runtime/protocol/reports.ts');
  const report = createReport({
    me: () => doors({ name: 'Ranger', map: 'main', x: 1, y: 2, items: [], slots: {}, s: {} }), G: () => doors({ drops: {} }),
    parent: () => ({ entities: {} }), root, initialTracker: () => null,
    game: doors({ entity: () => null }), current: () => true, sleep: () => Promise.resolve(), smart: () => null,
    owners: doors({
      movement: doors({ walkState: { townTraveling: false, following: false, departing: false, intent: {}, partyLocation: { map: 'main' } }, live: () => null }),
      walks: doors({ groupWalk: { travel: { id: 'c1' } }, reportGap: () => 0, isCurrentlyKiting: () => false }),
      targeting: doors({ returnCombatActive: () => false }),
      tasks: { partyList: () => ['Ranger'], reunion: () => ({ id: 'r1' }) },
      events: doors({ exit: { recovery: () => ({ phase: 'idle' }) } }),
      items: doors({ bag: doors({ facts: () => ({ banking: false, bankQueued: false, stocking: false, upgrading: false }) }) }),
    }),
  });
  const body = report.snapshot();
  assert.equal('convoyProtocol' in body, false);
  assert.equal(currentQueue(body.groupedCombat), true);
  assert.equal(body.groupedCombat.protocol, QUEUE_PROTOCOL);
  // A saved queue of the version before restores; it is not current.
  assert.equal(restorableQueue({ protocol: QUEUE_PROTOCOL - 1 }), true);
  assert.equal(currentQueue({ protocol: QUEUE_PROTOCOL - 1 }), false);
  assert.equal(speaksWalkProtocol({ convoyProtocol: 4 }), true);
  assert.equal(speaksWalkProtocol({}), false);
});

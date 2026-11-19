const assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { presence, eventHolds } = require('../../runtime/events/coordinator/source.ts');

// The events owner's coordinator source (runtime/events/coordinator/source.ts): a member's presence at
// an occurrence from its status and attendance, and the holds that presence gives the tasks owner's `member.holder`.
const instance = (over) => ({ id: 'g1', realm: 'USII', lastLiveAt: 90, ended: false, elapsedMs: 0, lastObservedAt: 90, attending: true, deaths: 0, lastDeathAt: 0, dead: false, ...over });
const state = (entry, over = {}) => ({ statuses: { W: { server: 'USII', joinedEvent: 'goobrawl' } }, eventAttendance: { W: { goobrawl: entry } }, ...over });
scenarioTable("the events source reads a presence from status and attendance and the holds it gives", () => undefined, [
 // Presence counts only a live, allowed occurrence on the member's own realm.
 ['presence counts no other realm, no stale joinedEvent, no ignored instance and no Cave participant, and keeps a dead attending member', () => {
   assert.equal(presence(state(instance()), 'W').phase, 'attending');
   assert.equal(presence(state(instance({ realm: 'EUI' })), 'W'), null, 'a live occurrence on another realm');
   assert.equal(presence(state(instance({ ended: true })), 'W'), null, 'a joinedEvent with no live occurrence');
   assert.equal(presence(state(instance({ ignored: 'death limit' })), 'W'), null, 'an ignored instance');
   assert.equal(presence(state(instance()), 'W', true), null, 'a Cave participant');
   const trip = { huntEventTrips: { W: [{ event: 'goobrawl', startedAt: 80 }] } };
   assert.equal(presence(state(instance({ attending: false, dead: true }), trip), 'W').phase, 'attending', 'a dead member attends while its instance lives');
   assert.equal(presence(state(instance({ attending: false })), 'W'), null, 'staging alone, before the walk');
   assert.equal(presence(state(instance({ attending: false }), trip), 'W').phase, 'walking');
   // Row 36 (c): the merchant records no trip, so its admitted session is its walking presence.
   const session = { eventSessions: { W: { event: 'goobrawl', participants: ['W'], authorizedAt: 85 } } };
   assert.deepEqual([presence(state(instance({ attending: false }), session), 'W').phase, presence(state(instance({ attending: false }), session), 'W').since], ['walking', 85]);
   // An ended occurrence has a member that still stands on its instance map returning before the
   // return's record exists, so its group holds as that return (the Hunt resumed on the Goobrawl
   // map before the return began).
   const onMap = { statuses: { W: { server: 'USII', map: 'goobrawl' } }, eventAttendance: { W: { goobrawl: instance({ ended: true, attending: false }) } } };
   assert.deepEqual([presence(onMap, 'W').phase, presence(onMap, 'W').ended], ['returning', true], 'an ended occurrence while still on its map');
   assert.equal(presence({ ...onMap, eventReturn: { event: 'goobrawl', cycleId: 'r1', participants: ['W'] } }, 'W').phase, 'returning');
   // A finished return for the occurrence (kept across a coordinator reload) leaves no awaiting hold,
   // so a stale joinedEvent on the ended map is no presence.
   assert.equal(presence({ ...onMap, eventReturnLast: { event: 'goobrawl', occurrence: 'g1' } }, 'W'), null, 'the occurrence whose return finished');
   assert.equal(presence({ ...onMap, eventReturnLast: { event: 'goobrawl', occurrence: 'g0' } }, 'W').phase, 'returning', 'another occurrence finished');
   // A return that let the member go (its deferred row, as a next live event takes it) and ended
   // with no members leaves no awaiting hold: the member reads its deferred row, not the ended map.
   const letGo = presence({ ...onMap, deferredEventReturns: { W: { event: 'goobrawl', cycleId: 'r1', deferredAt: 95 } } }, 'W');
   assert.deepEqual([letGo.phase, letGo.ended, letGo.occurrence], ['returning', undefined, 'r1'], 'the deferred row, not the awaiting hold');
 }],
 // A member attending Mr. Green that the admission moves to the Cipher, which its priority list puts first,
 // walks to the Cipher: the admission names the event, not the order of the records.
 ['a member admitted to another live event walks to it, and the record it attended gives way', () => {
   const both = (over = {}) => ({ statuses: { W: { server: 'USII', joinedEvent: 'mrgreen' } },
     eventAttendance: { W: { mrgreen: instance(), witchcipher: instance({ id: 'c1', attending: false }) } }, ...over });
   const trips = { huntEventTrips: { W: [{ event: 'mrgreen', startedAt: 70, endedAt: 80 }, { event: 'witchcipher', startedAt: 80 }] } };
   assert.deepEqual((({ event, phase }) => ({ event, phase }))(presence(both(trips), 'W')), { event: 'witchcipher', phase: 'walking' });
   assert.equal(presence(both({ huntEventTrips: { W: [{ event: 'mrgreen', startedAt: 70 }] } }), 'W').event, 'mrgreen', 'its own admission keeps it');
   assert.equal(presence(both(trips), 'W', false, (_, event) => event !== 'witchcipher').event, 'mrgreen', 'an admission it no longer attends');
 }],
 // The events owner answers `member.holder` from K3 and K6 through the member's
 // presence, one row per hold.
 ["member.holder: attending another occurrence is not coming, returning is coming, its own walk is not held", () => {
   const attending = { event: 'mrpumpkin', occurrence: 'mp1', realm: 'I', phase: 'attending', since: 0 };
   const row = (at, ask, named) => eventHolds(at, ask, named).map(h => [h.owner, h.coming, h.endsOn]);
   assert.deepEqual(row(attending, { activity: 'farm' }), [['06', false, 'event.ended']]);
   assert.deepEqual(row(attending, { activity: 'event', key: 'mrpumpkin' }), [], "the walk to the member's own occurrence");
   const returning = { ...attending, occurrence: 'c1', phase: 'returning' };
   assert.deepEqual(row(returning, { activity: 'farm' }), [['06', true, 'event.returned']]);
   assert.deepEqual(row(returning, { activity: 'event-return', key: 'c1' }), [], "its own cycle's event return");
   assert.deepEqual(row(null, { activity: 'farm' }, { owner: '06', reason: 'event-attendance' }), [['06', true, 'event.left']], 'S-06k');
   assert.deepEqual(row(null, { activity: 'farm' }, { owner: '08', reason: 'job' }), []);
 }],
]);

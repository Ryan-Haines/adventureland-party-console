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
 ["member.holder: attending another occurrence is not coming, returning is coming, its own walk is not held, the walk to the event it returns from lets it go", () => {
   const attending = { event: 'mrpumpkin', occurrence: 'mp1', realm: 'I', phase: 'attending', since: 0 };
   const row = (at, ask, named) => eventHolds(at, ask, named).map(h => [h.owner, h.coming, h.endsOn]);
   assert.deepEqual(row(attending, { activity: 'farm' }), [['06', false, 'event.ended']]);
   assert.deepEqual(row(attending, { activity: 'event', key: 'mrpumpkin' }), [], "the walk to the member's own occurrence");
   const returning = { ...attending, occurrence: 'c1', phase: 'returning' };
   assert.deepEqual(row(returning, { activity: 'farm' }), [['06', true, 'event.returned']]);
   assert.deepEqual(row(returning, { activity: 'event-return', key: 'c1' }), [], "its own cycle's event return");
   // The fix6 run of row 21 (left-out member): the event ended under the warrior's walk to the
   // pumpkin, the walk's ladder rebuilt it, and the warrior stayed on it while its return waited.
   assert.deepEqual(row(returning, { activity: 'event', key: 'mrpumpkin' }), [['06', false, 'event.returned']],
     'the walk to the event it returns from');
   assert.deepEqual(row(null, { activity: 'farm' }, { owner: '06', reason: 'event-attendance' }), [['06', true, 'event.left']], 'S-06k');
   assert.deepEqual(row(null, { activity: 'farm' }, { owner: '08', reason: 'job' }), []);
 }],
]);

// The events source over the tasks owner, as the coordinator's task tick runs them: each tick the
// source describes the party's event tasks from the planted state, and a Hunt source describes its
// mission. The live rows planted the same tasks through `taskOps` and a page timer (test-windows
// QUESTIONS.md U13).
const { createTaskOwner } = require('../../runtime/tasks/coordinator/owner.ts');
const { askSources } = require('../../runtime/tasks/coordinator/sources.ts');
const { eventSource } = require('../../runtime/events/coordinator/source.ts');
function eventTasks(planted) {
  let now = 1000;
  const party = { id: 'party:W', kind: 'party', members: ['W', 'P'] };
  const owner = createTaskOwner({ now: () => now, notify() {}, snapshot() {} });
  owner.sync([party]);
  const events = eventSource({ presence: name => presence(planted, name), eventReturn: () => planted.eventReturn, merchantReturn: () => undefined, commandHold: () => null });
  const hunt = { slot: 'mission', ask: { kind: 'hunt-mission', owner: 'hunt:1', members: ['W', 'P'] }, end: 'released' };
  const tick = () => {
    now += 1000;
    askSources(owner, [party], now, view => [{ name: events.name, answers: events.hooks['task.request'](view) }, { name: 'core:hunt', answers: [hunt] }]);
    owner.tick();
  };
  const ring = () => owner.ring(party.id).map(r => [r.decision, r.kind, r.by ?? r.code ?? null]);
  return { owner, tick, ring, group: party.id, planted, at: () => now };
}
const onGoobrawl = over => ({ statuses: { W: { server: 'USII', map: 'goobrawl', joinedEvent: 'goobrawl' }, P: { server: 'USII', map: 'main' } },
  eventAttendance: { W: { goobrawl: instance({ ended: true, attending: false }) } }, ...over });
scenarioTable('the events source over the tasks owner: a return under a higher task, and a stale marker after a reload', eventTasks, [
 // T16 to T19's F19 half (test-windows DEVIATIONS.md W27): an escape, a Hunt turn-in and a death
 // recovery each take the party from the event return, which waits with its record and resumes
 // when the task ends. The return's row suspends (rules.ts `event-return`); a cancel would end it,
 // and the source's next description would start a new one.
 ['an escape, a Hunt turn-in and a death recovery each suspend the event return, which keeps its record and resumes', ({ owner, tick, ring, group, planted, at }) => {
   planted.eventReturn = { event: 'mrgreen', cycleId: 'c1', participants: ['W', 'P'], phase: 'evacuating', startedAt: 900 };
   tick();
   for (const kind of ['escape', 'hunt-turn-in', 'death-recovery']) {
     const from = ring().length;
     assert.equal(owner.live(group).owner, 'event-return:c1', `precondition: the return is live before the ${kind}`);
     const handle = owner.request(group, { kind, owner: `f19:${kind}`, deadline: at() + 600_000 });
     assert.equal(handle.status, 'granted', `the ${kind} takes the party`);
     tick();
     assert.deepEqual(ring().slice(from).filter(([d, k]) => d === 'suspended' && k === 'event-return'), [['suspended', 'event-return', kind]], `The ${kind} suspends the event return`);
     assert.equal(owner.live(group).kind, kind, `no event return walk under the ${kind}: the walk follows the live task`);
     assert.deepEqual(owner.held(group).filter(h => h.source === 'core:event').map(h => [h.owner, h.handle.status]), [['event-return:c1', 'waiting']], `the ${kind} keeps the return's record`);
     owner.release(handle);
     tick();
     assert.ok(ring().slice(from).some(([d, k]) => d === 'resumed' && k === 'event-return'), `The event return resumes after the ${kind}`);
     assert.deepEqual(ring().slice(from).filter(([d, k]) => d === 'ended' && k === 'event-return'), [], `the ${kind} never ends the return`);
   }
 }, { statuses: {} }],
 // T36's stale-marker half (DEVIATIONS.md W34): after a reload the warrior still reports the
 // ended Goobrawl from its map, and the finished return (`eventReturnLast`, saved across the
 // reload) leaves that occurrence nothing to await, so the source asks no event task and the Hunt
 // keeps the party.
 ['a stale joinedEvent after a reload gives no presence and suspends no Hunt', ({ owner, tick, ring, group, planted }) => {
   assert.equal(planted.statuses.W.joinedEvent, 'goobrawl', 'precondition: the warrior still reports the stale event');
   tick(); tick();
   assert.deepEqual(['W', 'P'].map(name => presence(planted, name)), [null, null], 'no presence from a stale joinedEvent');
   assert.equal(owner.live(group).kind, 'hunt-mission');
   assert.deepEqual(ring().filter(([d, k]) => d === 'granted' && k.startsWith('event') || d === 'suspended' && k.startsWith('hunt')), [],
     'a stale joinedEvent after a reload suspends no Hunt');
 }, onGoobrawl({ eventReturnLast: { event: 'goobrawl', occurrence: 'g1' } })],
]);

const test = require('node:test');
const assert = require('node:assert/strict');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {attendScenario}=require('./fixtures/event-attend-scenario.cjs');

scenarioTable('a respawned member walks back to an event that has no join (MOV-066)', () => attendScenario({ event: 'franky', joins: false, map: 'level2w' }), [
 ['non-joinable event recovery still walks', async ({ attend, calls }) => {
  assert.equal((await attend.rejoin('rejoin')).status, 'recovered');
  assert.deepEqual(calls, [['walk', 'level2w', 'franky']]);
 }],
]);

// EV33: the event marker derives from the member's
// attendance assignment and its own action in this life; the rejoin mark rides the reply.
scenarioTable('EV33: the marker and the rejoin follow the assignment and the life', () => attendScenario({ event: 'franky', map: 'level2w' }), [
 ['a join reply that lands after a death acts on nothing', async ({ attend, calls, t }) => {
  const poll = attend.poll();
  t.life = 5; await poll;
  assert.deepEqual(calls, [['join', 'franky']]);
  assert.equal(attend.joined(), null, 'the join of an earlier life marks nothing');
 }],
 ['the death recovery owns the way back: the poll takes no step while it holds, and its rejoin rung joins', async ({ attend, calls, t }) => {
  t.holder = { kind: 'death-recovery', owner: 'death:P:5' };
  await attend.poll();
  assert.deepEqual(calls, [], 'the poll leaves the respawned member to its recovery');
  assert.equal((await attend.rejoin('rejoin')).status, 'recovered');
  assert.deepEqual(calls, [['join', 'franky']], 'the recovery joins through the rejoin rung');
 }],
 ['the marker stands under a higher task, and ends with a new life or a lower task', async ({ attend, t }) => {
  await attend.poll();
  assert.equal(attend.joined(), 'franky', 'the join reply marks the assignment');
  t.task = { kind: 'escape', owner: 'escape:1', tier: 'escape' };
  assert.equal(attend.joined(), 'franky', 'an escape suspends the attendance');
  t.task = { kind: 'farming', owner: 'farm', tier: 'farming' };
  assert.equal(attend.joined(), null, 'a lower task ends it');
  t.task = { kind: 'event-attendance', owner: 'attend:franky:1', tier: 'event-attendance', event: 'franky' };
  await attend.poll(); t.life = 9;
  assert.equal(attend.joined(), null, 'a new life ends it');
 }],
 ['a reload after a native revival still finds the rejoin mark of its assignment', async () => {
  const reloaded = attendScenario({ event: 'franky', map: 'level2w', rejoin: 'franky' });
  assert.equal(reloaded.attend.rejoinPending(), 'franky');
  reloaded.t.task = { kind: 'event-attendance', owner: 'attend:goobrawl:1', tier: 'event-attendance', event: 'goobrawl' };
  assert.equal(reloaded.attend.rejoinPending(), null, 'the mark names another event than the assignment');
 }],
]);

// SV58: CODE that resumes after a native revival during an event
// starts the member's way back into it from the rejoin mark, with the attempt state reset as on a
// new death; with no mark set, a living member starts no rejoin. The death recovery on the shared
// respawn harness (fixtures/respawn-recovery-scenario.cjs).
const {ports}=require('./fixtures/respawn-recovery-scenario.cjs');
scenarioTable('SV58: a living member returns to its event from the rejoin mark, and only with one set', () => null, [
 ['an alive start with the mark set walks back into the event', async () => {
  let rejoins = 0;
  const f = ports({ rejoinMark: () => 'franky', rejoinEvent: async () => { rejoins++; return { status: 'recovered' }; } });
  try {
   f.state.dead = false; f.state.task = { kind: 'event-attendance', owner: 'event', event: 'franky' };
   // The first pass waits for a report after the start, as after a respawn.
   await f.recover(); f.advance(1000); await f.recover();
   assert.equal(rejoins, 1, 'the rejoin rung ran');
   assert.equal(f.published[0].recovery.attempt, 0, 'the attempt state starts fresh');
   f.advance(1000); await f.recover();
   assert.equal(rejoins, 1, 'a finished recovery does not start again from the same mark');
  } finally { f.restore(); }
 }],
 ['an alive start with no mark starts no rejoin', async () => {
  let rejoins = 0;
  const f = ports({ rejoinMark: () => null, rejoinEvent: async () => { rejoins++; return { status: 'recovered' }; } });
  try {
   f.state.dead = false; f.state.task = { kind: 'event-attendance', owner: 'event', event: 'franky' };
   await f.recover();
   assert.deepEqual([rejoins, f.published.length], [0, 0]);
  } finally { f.restore(); }
 }],
]);

// EV7: a sick or in-bank reply never ends the round. A sick reply joins again when the
// game's hop sickness ends; an in-bank reply joins at the next poll. Neither marks a refusal.
scenarioTable('EV7: a sick or bank refusal keeps the round', () => attendScenario({ event: 'franky', map: 'level2w' }), [
 ['a sick reply joins again when the hop sickness ends', async ({ attend, character, calls, refusal, t }) => {
  character.s = { hopsickness: { ms: 4000 } }; t.joinError = { reason: 'cant_when_sick' };
  await attend.poll();
  assert.equal(refusal.value, null, 'the round is not refused');
  assert.equal(t.later?.ms, 4000, 'the next join waits for the sickness');
  t.joinError = null; delete character.s; t.later.action(); await attend.poll();
  assert.deepEqual(calls.filter(c => c[0] === 'join').length, 2);
  assert.equal(attend.joined(), 'franky');
 }],
 ['an in-bank reply joins at the next poll', async ({ attend, calls, refusal, t }) => {
  t.joinError = { reason: 'cant_in_bank' };
  await attend.poll();
  assert.equal(refusal.value, null);
  assert.equal(t.later, undefined, 'no timer of its own');
  t.joinError = null; await attend.poll();
  assert.equal(calls.filter(c => c[0] === 'join').length, 2);
 }],
 // The numbers audit (2026-11-13): b9b5c91e's 5 s join wait went with no bound in its place, so a
 // lost reply held the join. It now ends at the call margin and the next poll joins again.
 // callMargin (bigcheck/bounds.md): the lost reply queues its firing for the next report.
 ['a join whose reply never comes ends at the call margin and joins again at the next poll', async ({ attend, calls, refusal, t }) => {
  const { boundsPending, boundsSent } = require('../../runtime/status/api.ts');
  boundsSent(boundsPending().length);
  t.joinLost = true;
  await attend.poll();
  assert.deepEqual(boundsPending().map(f => [f.bound, f.owner, f.state.method]), [['callMargin', '06', 'join']], 'the call margin tells the bound record');
  boundsSent(1);
  assert.equal(refusal.value, null, 'a lost reply refuses nothing');
  assert.notEqual(attend.joined(), 'franky');
  t.joinLost = false; await attend.poll();
  assert.equal(calls.filter(c => c[0] === 'join').length, 2);
  assert.equal(attend.joined(), 'franky');
 }],
 ['a cant_join reply refuses the round once and is not sent again', async ({ attend, calls, refusal, t }) => {
  t.joinError = { reason: 'cant_join' };
  await attend.poll();
  assert.equal(refusal.value?.reply, 'cant_join');
  assert.equal(calls.filter(c => c[0] === 'join').length, 1);
 }],
]);

// EV33's late member: a member that died in the occurrence comes back after the
// group's walk started, so its rejoin rung asks the walk as this life's re-entry and walks the
// leg movement hands back as the recovery's own request.
scenarioTable('EV33: a late member walks alone beside its group', () => attendScenario({ event: 'mrgreen', joins: false, map: 'halloween', rejoin: 'mrgreen',
  feed: { mrgreen: { live: true, map: 'halloween', x: 10, y: 20 } }, leg: (point, reentry) => reentry === undefined ? undefined : { independent: point } }), [
 ['the rejoin rung with the mark walks through the recovery', async ({ attend, calls }) => {
  assert.equal((await attend.rejoin('rejoin')).status, 'recovered');
  assert.deepEqual(calls.filter(c => c[0] === 'walk' || c[0] === 'recovery-walk').map(c => c[0]), ['walk', 'recovery-walk']);
 }],
]);
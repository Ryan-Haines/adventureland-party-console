const test = require('node:test');
const assert = require('node:assert/strict');
const settle = () => new Promise(resolve => setImmediate(resolve));
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { fixture } = require('./fixtures/anniversary-kiss-scenario.cjs');
const { partyHooks } = require('../../runtime/hooks/index.ts');

// The staging walk reads movement's Town landing check (the walk port `landed`), the same check as
// the early return and the stage labels: a character the check does not count as landed walks to
// Main, and a landed one stays (EVT-044).
scenarioTable('anniversary staging walks whenever the Town landing check does not count the character as landed', options => fixture(options), [
 ['a character off the landing walks to Main', async t => {
  await t.run();
  assert.deepEqual(t.calls.filter(c => c[0] === 'to-main').map(c => c[1]), [{ map: 'main', x: 0, y: 0 }]);
 }, { scheduled: true, landed: false }],
 ['a landed character stays', async t => {
  await t.run();
  assert.equal(t.calls.some(c => c[0] === 'to-main'), false);
 }, { scheduled: true, landed: true }],
]);

// EV20: an abort retires the pending move or kiss with no late claim or kiss.
for (const pending of ['move', 'skill']) test('abort retires a pending ' + pending + ' without late claims or kisses', async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const t = fixture(pending === 'move' ? { approach: true, move: () => wait } : { skill: () => wait, newBuff: true });
  const run = t.run(); await settle();
  t.plan.abortedRounds.round = { reason: 'target-missing' };
  await t.anniversary.abort();
  const count = t.calls.length;
  release(); await run;
  assert.deepEqual(t.calls.slice(count).filter(c => c[0] === 'kiss' || c[0] === '/anniversary/claim'), []);
  assert.equal(t.calls.some(c => c[0] === '/anniversary/claim'), false);
  assert.equal(t.anniversary.busy(), false);
});

scenarioTable('the anniversary approach and kiss end in one terminal report and keep the featured hold (MOV-055)', () => null, [
 ['a kiss with no reply and no new buff aborts with kiss-timeout; an old buff does not conceal it', async () => {
  for (const oldBuff of [false, true]) {
    // The game's next player update after the lost reply shows no new buff and no slice.
    const t = fixture({ oldBuff, update: () => 'player' }); await t.run();
    const failure = t.calls.find(c => c[0] === '/anniversary/failure')[1];
    assert.equal(failure.failureReason, 'kiss-timeout'); assert.equal(failure.round, 'round');
    assert.equal(failure.navigationRevision, 0); assert.equal(t.anniversary.busy(), false);
  }
 }],
 // The live Anniversary staging row: the warrior asked at the round's first update, the coordinator
 // had not yet read the round and refused the reservation, and the refusal stood as a failed kiss
 // whose retry waited for a change that never came while both stood still in Main.
 ['a reservation the coordinator refuses as stale is no failed kiss; the next poll kisses', async () => {
  const t = fixture({ stale: 1, resolves: true, newBuff: true, newSlice: true });
  await t.run();
  assert.equal(t.calls.some(c => c[0] === '/anniversary/failure' || c[0] === 'kiss'), false, 'no kiss went out and none failed');
  await t.run();
  assert.equal(t.calls.filter(c => c[0] === 'kiss').length, 1, 'the next poll kisses');
 }],
]);

// EV36: a visit that preempts a farming convoy owns it only while the command,
// revision and convoy it found stand and its admission holds.
scenarioTable('EV36: an anniversary visit stops when a newer command or a return takes over', options => fixture(options), [
 ['a command during the stop ends the visit with no move', async t => {
  await t.run();
  assert.equal(t.calls.some(c => c[0] === 'stop' && c[1] === 'move'), false, 'the second stop is not sent');
  assert.equal(t.calls.some(c => c[0] === 'convoy-stopped' || c[0] === 'kiss' || c[0] === '/anniversary/attempt'), false);
 }, { convoy: true, onStop: (kind, f) => { if (kind === 'smart') f.setCommand(2); } }],
 ['a return during the visit ends it before any stop', async t => {
  await t.run();
  assert.equal(t.calls.some(c => c[0] === 'stop' || c[0] === 'release-convoy'), false);
  assert.equal(t.calls.some(c => c[0] === '/anniversary/attempt'), false);
 }, { convoy: true, preempt: { alreadyReturning: true } }],
]);

// The `anniversary.phase` row: the server picks the round's featured players by
// account hash, so the live table cannot seed a round; the tick announces each new phase once.
test('U: the anniversary phases are announced', async () => {
  const heard = [];
  partyHooks().publish({ name: 'test:anniversary-phase', folder: 'core', author: 'test', summary: 'Hears the anniversary phases.',
    hooks: { 'anniversary.phase': payload => heard.push(payload) } });
  const t = fixture({ scheduled: true, landed: false });
  await t.anniversary.tick(); await t.anniversary.tick();
  assert.deepEqual(heard.map(h => [h.member, h.phase, h.by]), [['F', 'staging', 'core:events']]);
});

// EVT-054: a finished visit hands the party back to the current Hunt
// once every participant's fresh report is out of combat and owns its command, and not before.
test('EVT-054: the anniversary hands back to the Hunt only when every participant is ready', () => {
  const { handoffAnniversaryToHunt } = require('../../runtime/events/coordinator/anniversary.ts');
  const now = 5000, ready = { seenAt: now, groupedCombat: { currentAttackersAt: now, currentAttackers: [] } };
  const state = { targetMode: 'hunt', monsterHunt: { stage: 'hunting' }, commands: {}, deferredEventReturns: {},
    statuses: { W: { ...ready }, P: { ...ready, groupedCombat: { currentAttackersAt: now, currentAttackers: ['goo'] } } } };
  const cycle = { id: 'c1', participants: ['W', 'P'], returnRoutes: { W: { revision: 1 }, P: { revision: 1 } } };
  const finished = [];
  const ports = { now: () => now, persist() {}, navigation: { intent: () => ({ revision: 1 }), finish: (c, reason) => finished.push(reason) } };
  assert.equal(handoffAnniversaryToHunt(state, cycle, ports), false, 'a member still fights');
  state.statuses.P = { ...ready };
  assert.equal(handoffAnniversaryToHunt(state, cycle, ports), true);
  assert.deepEqual(finished, ['Anniversary visit complete; resuming current Hunt']);
});

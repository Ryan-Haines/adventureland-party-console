const assert = require('node:assert/strict');

const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { exitScenario } = require('./fixtures/event-exit-scenario.cjs');
const moves = (calls, kinds) => calls.filter(c => kinds.includes(c[0])).map(c => c.slice(0, 2));
const completes = calls => calls.filter(c => c[0] === 'request' && c[1] === '/event-return-complete').length;

// The exit is one climb of movement's ladder over K1's `exit` rungs,
// with no count or deadline, and it reports only a real arrival in Main's Town.
scenarioTable('an event exit leaves its instance by its own rungs and acknowledges only real arrival', exitScenario, [
 ['an instance exit whose leave and transport never move the character climbs with no count until its cycle ends', async t => {
  await t.run('pirateship');
  // v1.5.0 stopped "after three attempts"; the climb still tries the exit on its
  // fifth round.
  assert.ok(t.calls.filter(c => c[0] === 'leave').length >= 5, 'the leave rung comes round again');
  assert.ok(t.calls.filter(c => c[0] === 'transport').length >= 5, 'and the transport after it');
  assert.equal(completes(t.calls), 0, 'no arrival is reported');
  assert.ok(t.calls.some(c => c[0] === 'release' && c[1] === 'event-exit:1'), 'the next cycle retires the exit');
 }, 'ship0', { leave: async () => {}, transport: async () => {}, townReady: false }],
 ['a boss event off an event map walks to Main, then casts Town there', async t => {
  await t.run('franky');
  // The boss exit's departure clears targeting's target and the attendance's event types as it
  // starts.
  assert.deepEqual(moves(t.calls, ['prepare', 'walk', 'town', 'departing', 'clearTarget', 'eventTargets']), [['departing', true], ['clearTarget'], ['eventTargets', []],
    ['prepare', 'level2w'], ['walk', 'level2w'], ['town', 'main'], ['departing', false]]);
  assert.equal(completes(t.calls), 1);
  // The arrival carries the walk's runtime id, which the coordinator's exit check compares.
  assert.equal(t.calls.find(c => c[1] === '/event-return-complete')[2].runtimeId, 'runtime-1');
  assert.equal(t.state().phase, 'town-ready');
 }, 'level2w'],
 ['A/B Testing leaves its instance with no Town or walk', async t => {
  await t.run('abtesting');
  assert.deepEqual(moves(t.calls, ['leave', 'transport', 'town', 'walk']), [['leave', 'abtesting']]);
  assert.equal(completes(t.calls), 1);
 }, 'abtesting'],
 ['the ship0 instance leaves by its own exit with no Town or walk', async t => {
  await t.run('pirateship');
  assert.deepEqual(moves(t.calls, ['leave', 'transport', 'town', 'walk']), [['leave', 'ship0']]);
  assert.equal(completes(t.calls), 1);
 }, 'ship0'],
 ['a leave that fails gives way to the transport to Main', async t => {
  await t.run('abtesting');
  assert.deepEqual(t.calls.find(c => c[0] === 'transport'), ['transport', 'main', 0]);
  assert.equal(t.state().phase, 'town-ready');
 }, 'abtesting', { leave: async () => { throw new Error('instance ended'); } }],
 ['Goo Brawl walks to its Transporter and asks it for Main', async t => {
  await t.run('goobrawl');
  assert.deepEqual(moves(t.calls, ['approach', 'transport', 'town']), [['approach', 'goobrawl'], ['transport', 'main']]);
  assert.equal(t.calls.find(c => c[0] === 'transport')[2], 9, "the Transporter's Main spawn from G.npcs");
 }, 'goobrawl'],
 ['a reply naming another return cycle retires the running exit (E3.1 row 15)', async t => {
  const running = t.run('pirateship');
  t.exit.observe({ eventReturnCycleId: 'other', serverNow: 5 });
  await running;
  assert.equal(completes(t.calls), 0);
  assert.equal(t.exit.pending(), false);
  assert.equal(t.exit.accepts({ cycleId: 'cycle-1' }), false, 'a Town command of the old cycle is not taken');
 }, 'ship0', { leave: async () => {}, transport: async () => {} }],
 // v1.5.0's exit rows cut with no removal line.
 ['Crab casts Town after its fight, with no leave or walk', async t => {
  await t.run('crabxx');
  assert.deepEqual(t.calls[0], ['afterCombat']);
  assert.deepEqual(moves(t.calls, ['town', 'leave', 'walk', 'transport']), [['town', 'main']]);
  assert.equal(completes(t.calls), 1);
  assert.equal(t.state().phase, 'town-ready');
 }, 'main'],
 ['an instance exit that lands away from the square casts Town in Main', async t => {
  await t.run('abtesting');
  assert.deepEqual(moves(t.calls, ['leave', 'transport', 'town']), [['leave', 'abtesting'], ['town', 'main']]);
  assert.equal(completes(t.calls), 1);
 }, 'abtesting', { leave: async c => Object.assign(c, { map: 'main', x: 800, y: 400 }) }],
 ['a member already near the square reports its arrival with no Town or walk', async t => {
  Object.assign(t.character, { x: 50, y: 20 });
  await t.run('crabxx');
  assert.deepEqual(moves(t.calls, ['town', 'leave', 'walk', 'transport']), []);
  assert.equal(completes(t.calls), 1);
 }, 'main'],
 ['Town waits for its cooldown and comes again after an interruption before the arrival is reported', async t => {
  let casts = 0;
  t.t.town = async c => { if (++casts === 1) throw new Error('damage interrupted Town'); Object.assign(c, { x: 0, y: 0 }); };
  t.t.onReport = (_c, seen) => { t.calls.push(['report']); if (seen === 2) t.t.townReady = true; };
  await t.run('crabxx');
  assert.equal(casts, 2, 'the interrupted cast comes round again');
  assert.deepEqual(moves(t.calls, ['report', 'town']).slice(0, 3), [['report'], ['report'], ['town', 'main']], 'no cast before the cooldown ends');
  assert.equal(completes(t.calls), 1);
  assert.equal(t.calls.find(c => c[1] === '/event-return-complete')[2].x, 0);
 }, 'main', { townReady: false }],
 ['a member that dies on the way waits to live again before it goes on', async t => {
  t.t.walk = c => { c.rip = true; };
  // The respawn lands in Main's Town on the second report the member spends dead.
  let dead = 0;
  t.t.onReport = c => { if (c.rip && ++dead === 2) Object.assign(c, { rip: false, map: 'main', x: 0, y: 0 }); };
  await t.run('franky');
  assert.equal(t.calls.filter(c => c[0] === 'walk').length, 1, 'no rung runs while dead');
  assert.equal(completes(t.calls), 1);
  assert.equal(t.exit.pending(), false);
 }, 'level2w'],
 // Observed live on the death rows: the exit's Town claim lasts two report gaps, and a member
 // dead for longer stood with its climb and no hold until the event return took it.
 ['a dead member keeps its claim on each report until it lives', async t => {
  t.character.rip = true;
  let dead = 0;
  t.t.onReport = c => { t.calls.push(['report']); if (c.rip && ++dead === 4) Object.assign(c, { rip: false, map: 'main', x: 0, y: 0 }); };
  await t.run('franky');
  const trail = moves(t.calls, ['report', 'claim']).map(c => c[0]);
  assert.deepEqual(trail.slice(0, 8), ['claim', 'claim', 'report', 'claim', 'report', 'claim', 'report', 'claim'], 'a claim before each report the member spends dead');
  assert.equal(completes(t.calls), 1);
 }, 'main'],
 ['a Goo Brawl exit cancelled during its transport never casts Town', async t => {
  t.t.transport = () => { t.exit.observe({ eventReturnCycleId: 'other', serverNow: 1 }); };
  await t.run('goobrawl');
  assert.equal(t.calls.filter(c => c[0] === 'town').length, 0);
  assert.equal(completes(t.calls), 0);
 }, 'goobrawl'],
]);

// (row 4b): a member an ended A/B round does not release leaves by one reconnect to its realm,
// marked on the return's progress first; a live feed keeps the rung shut.
scenarioTable('the A/B exit reconnects once, after its other rungs, and only once the round is over', exitScenario, [
 ['a stranded member reconnects after leave, transport and Town, once per return cycle', async t => {
  await t.run('abtesting');
  const marks = t.calls.filter(c => c[0] === 'request' && c[1] === '/return-progress' && c[2].exitReconnectAttempted);
  assert.equal(marks.length, 1, 'one reconnect mark');
  assert.deepEqual(moves(t.calls, ['leave', 'transport', 'town']).slice(0, 3).map(c => c[0]), ['leave', 'transport', 'town']);
  assert.ok(t.calls.findIndex(c => c[0] === 'town') < t.calls.indexOf(marks[0]), 'the reconnect comes after the Town');
 }, 'abtesting', { leave: async () => {}, transport: async () => {}, town: async () => {} }],
 ['a reload with the mark set skips the rung', async t => {
  await t.run('abtesting');
  assert.equal(t.calls.filter(c => c[2]?.exitReconnectAttempted).length, 0);
 }, 'abtesting', { leave: async () => {}, transport: async () => {}, town: async () => {}, progress: { revision: 0, phase: 'exiting-map', exitMap: 'abtesting', exitReconnectAttempted: true } }],
 ['a current feed that lists A/B Testing live keeps the rung shut', async t => {
  await t.run('abtesting');
  assert.equal(t.calls.filter(c => c[2]?.exitReconnectAttempted).length, 0);
 }, 'abtesting', { leave: async () => {}, transport: async () => {}, town: async () => {}, feedLive: true }],
]);

// The exit never stops while a rung is left. Goo Brawl's Transporter that never moves the
// character gives way to its Town rung, and the climb comes back to the Transporter, until the
// cycle ends.
scenarioTable('an exit with a rung left keeps climbing', exitScenario, [
 ['a Transporter that never moves the character climbs to Town and back', async t => {
  await t.run('goobrawl');
  assert.ok(t.calls.filter(c => c[0] === 'town').length >= 1, 'the Town rung is reached');
  assert.ok(t.calls.filter(c => c[0] === 'transport').length >= 2, 'the Transporter comes round again');
  assert.equal(completes(t.calls), 0, 'no arrival is reported while the character stays');
 }, 'goobrawl', { transport: async () => {}, town: async () => {} }],
]);

// The event marker is derived (attend.ts `joined`), so an escape and a reload leave no stale marker:
// off the event's map with no action of this load it reads none, and it comes back only with the
// attendance assignment's own next action.
const { attendScenario } = require('./fixtures/event-attend-scenario.cjs');
scenarioTable('no stale event marker after an escape and a reload', () => attendScenario({ event: 'franky', map: 'level2w' }), [
 ['a reload under an escape reads no marker, and the next poll after it marks again', async ({ t }) => {
  const escape = { kind: 'escape', owner: 'escape:1', tier: 'escape' };
  const reloaded = attendScenario({ event: 'franky', map: 'level2w', task: escape });
  reloaded.character.map = 'main';
  assert.equal(reloaded.attend.joined(), null, 'the reload under the escape keeps no marker');
  reloaded.t.task = t.task;
  await reloaded.attend.poll();
  assert.equal(reloaded.attend.joined(), 'franky', 'the assignment\'s own join marks it again');
 }],
]);
// (b): the exit has no stop in its movement port. It releases only its own owners and claims only
// its own requests, so a walk another owner holds, such as the merchant job owner's job walk for the
// merchant, keeps going.
scenarioTable('(b): an exit never stops a walk it does not own', exitScenario, [
 ['a finished exit releases and claims only its own owners', async t => {
  await t.run('franky');
  assert.equal(completes(t.calls), 1);
  const own = owner => /^event-(exit|return):|^franky$/.test(owner);
  const released = t.calls.filter(c => c[0] === 'release').map(c => c[1]);
  assert.ok(released.every(own), 'released: ' + released);
  assert.ok(t.calls.filter(c => c[0] === 'claim').every(c => own(c[1])), 'every claim names the exit or the return');
 }, 'level2w'],
]);
// The marks with no e2e run (attend.ts `suspends`, `eventName`, `leave`, `traveling`). A join in
// flight is the event travel; off the event's map, a request above event attendance keeps the
// member's own join mark, a lower task drops it, and a player command off the event (`leave`)
// clears it; `eventName` is the joined event, else the live one.
scenarioTable('K7: the event travel and the join mark', over => attendScenario({ event: 'franky', map: 'level2w', ...over }), [
 ['a join in flight is the event travel', async ({ attend, calls }) => {
  let during = null, named = null;
  calls.push = (...entries) => { during = attend.traveling(); named = attend.eventName(); return Array.prototype.push.apply(calls, entries); };
  await attend.poll();
  assert.equal(during, 'franky', 'the join goes out under the travel');
  assert.equal(named, 'franky', 'the live event names the member before the join lands');
 }, { joinLost: true }],
 ['a higher request keeps the join mark, a lower task drops it', async ({ attend, character, t }) => {
  await attend.poll();
  assert.equal(attend.traveling(), null, 'the travel ends with the join');
  character.map = 'main';
  const own = t.task;
  t.task = { kind: 'death-recovery', owner: 'survival:1', tier: 'death-recovery' };
  assert.equal(attend.joined(), 'franky', 'the death recovery suspends the attendance');
  assert.equal(attend.eventName(), 'franky');
  t.task = { kind: 'farming', owner: 'farm:1', tier: 'farming' };
  assert.equal(attend.joined(), null, 'a farming task ends it');
  t.task = own;
 }],
 ['a player command off the event clears the mark', async ({ attend, character }) => {
  await attend.poll();
  character.map = 'main';
  assert.equal(attend.joined(), 'franky');
  attend.leave();
  assert.equal(attend.joined(), null);
 }],
]);

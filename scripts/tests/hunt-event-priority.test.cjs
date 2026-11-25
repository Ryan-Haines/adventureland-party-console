const test = require('node:test'), assert = require('node:assert/strict');
const {fixture}=require('./fixtures/anniversary-kiss-scenario.cjs');

const { installEventAttendance } = require('../../runtime/events/character/attend.ts');
// Event travel reads the answer the reply carries, behind the Cave and movement's rank half.
function travel(over = {}) {
 const t = { admission: null, current: true, cave: false, held: false, ctype: 'mage', ...over };
 return installEventAttendance({ character: () => ({ map: 'main', ctype: t.ctype }),
  travel: { admission: () => t.admission, current: () => t.current, caveOwns: () => t.cave, held: () => t.held } }).allowed;
}
// The character half of the kiss rule: the kiss report reaches the coordinator only after the
// kiss starts, so the character's own intake keeps an event walk's command off it while it kisses.
test("a kissing character defers an event attendance walk's command and takes every other", () => {
 const t = { kiss: null };
 const defers = installEventAttendance({ kiss: () => t.kiss }).defers;
 const walk = { id: 9, type: 'party-monster-travel', phase: 'assemble', requester: { kind: 'group-walk', tier: 'event-attendance' } };
 assert.equal(defers(walk), null, 'no kiss runs');
 t.kiss = { round: 'r1', startedAt: 5 };
 assert.equal(defers(walk), 'anniversary kiss');
 assert.equal(defers({ ...walk, requester: { kind: 'group-walk', tier: 'farming' } }), null, 'a farming walk is a newer command (row 32)');
 assert.equal(defers({ id: 10, type: 'town-party' }), null);
 assert.equal(defers(null), null);
});

test("event travel moves only with the coordinator's admission, and a denied preemption stops nothing (MOV-054)", async ()=>{
 {
  assert.equal(travel()('crabxx'), false, 'no reply carries an admission');
  assert.equal(travel({ ctype: 'merchant' })('crabxx'), true, "the merchant's own group asks no admission");
  const admitted = { event: 'crabxx', allowed: true };
  assert.equal(travel({ admission: admitted })('crabxx'), true);
  assert.equal(travel({ admission: admitted })('franky'), false, 'the admission names its event');
  assert.equal(travel({ admission: { event: 'crabxx', allowed: false } })('crabxx'), false);
  for (const held of [{ held: true }, { cave: true }, { current: false }]) assert.equal(travel({ admission: admitted, ...held })('crabxx'), false);
 }
 {
  // The anniversary's preemption (character/anniversary.ts `preempt`): the Hunt hand-in answer
  // stops nothing of the convoy it found.
  const t = fixture({ convoy: true, preempt: { huntTurnIn: true } });
  await t.run();
  const before = t.calls.findIndex(c => c[0] === '/anniversary/attempt');
  assert.ok(before >= 0, 'the kiss reaches its attempt');
  assert.deepEqual(t.calls.slice(0, before).filter(c => c[0] === 'stop' || c[0] === 'release-convoy' || c[0] === 'convoy-stopped'), []);
 }
});

// The poll (attend.ts `poll`): it acts only on the member's attendance assignment, which
// the tasks owner's rank table gives only while no higher task holds the group.
const {attendScenario}=require('./fixtures/event-attend-scenario.cjs');
test('the poll joins only for its attendance assignment, and a member on an ended occurrence asks for its return at its first current feed without it', async () => {
 {
  const { attend, calls, t } = attendScenario({ task: null });
  await attend.poll();
  assert.deepEqual(calls, [], 'no assignment, no join');
  t.task = { kind: 'cave', owner: 'cave:1', tier: 'cave' };
  await attend.poll();
  assert.deepEqual(calls, [], 'a higher task holds the group');
  t.task = { kind: 'event-attendance', owner: 'attend:goobrawl:1', tier: 'event-attendance', event: 'goobrawl' };
  await attend.poll();
  assert.deepEqual(calls, [['join', 'goobrawl']]);
  assert.equal(attend.joined(), 'goobrawl', 'the map names the assigned event');
 }
 {
  const { attend, calls, t } = attendScenario({ feed: {}, task: { kind: 'event-return', owner: 'event-return:ended:goobrawl:1', tier: 'event-return', phase: 'awaiting-return', goal: { event: 'goobrawl', occurrence: '1' } } });
  await attend.poll(); await attend.poll();
  assert.deepEqual(calls, [['request', '/event-ended', { character: 'P', event: 'goobrawl' }]], 'one post per hold');
 }
});
// The search (attend.ts `searchFor`): one pass over the `search` maps' points, the feed's map
// first; a sighting ends the pass at its walk, and a pass with no sighting ends the occurrence's search.
// event-search.test.cjs holds the walking order.
test('the Slenderman search walks each point once and ends at a sighting', async () => {
 const game = { maps: { main: {}, halloween: { spawns: [[1, 1], [1, 1]] }, spookytown: { spawns: [[2, 2]], npcs: [{ position: [3, 3] }] }, cave: { spawns: [[4, 4]] } }, events: {} };
 const { attend, calls, t } = attendScenario({ event: 'slenderman', joins: false, map: 'halloween', game, feed: { slenderman: { live: true, id: 's1', map: 'spookytown' } } });
 await attend.poll();
 assert.deepEqual(calls.map(call => call[1]), ['spookytown', 'spookytown', 'halloween', 'cave'], 'the feed map first, each point once');
 calls.length = 0; await attend.poll();
 assert.deepEqual(calls, [], 'an ended pass does not walk again in the occurrence');
 t.feed = { slenderman: { live: true, id: 's2', map: 'halloween' } }; await attend.poll();
 assert.equal(calls[0][1], 'halloween', 'a new occurrence searches again, from its own feed map');
});
// A monster walk the player picked by hand leaves the live event first (attend.ts `leaveForManualWalk`):
// it exits an event area's map and leaves a joined event elsewhere, and any other walk keeps the event.
test('a manual monster walk leaves the live event by the map exit or the leave, and no other walk does', async () => {
 {
  const { attend, calls } = attendScenario({});
  await attend.poll();
  assert.equal(attend.joined(), 'goobrawl');
  await attend.leaveForManualWalk({ id: 1 }, 'walk');
  assert.equal(attend.joined(), 'goobrawl', 'a walk the player did not pick by hand keeps the event');
  assert.equal(calls.filter(c => c === 'exit-map' || c === 'leave-event').length, 0);
  await attend.leaveForManualWalk({ id: 1, manualMonsterOverride: true }, 'walk');
  assert.deepEqual(calls.filter(c => c === 'exit-map' || c === 'leave-event'), ['exit-map'], 'on the event area map the walk exits the map');
 }
 {
  const { attend, calls } = attendScenario({ map: 'main' });
  await attend.poll();
  assert.equal(attend.joined(), 'goobrawl');
  await attend.leaveForManualWalk({ id: 1, manualMonsterOverride: true }, 'walk');
  assert.deepEqual(calls.filter(c => c === 'exit-map' || c === 'leave-event'), ['leave-event'], 'off the area map a joined event is left');
 }
});

// Fixed-end event timer row (live run on a4884e05f): the warrior's combat approach to the declared
// Mr. Pumpkin needed a planned route, so the straight-walk reach test read false, and every poll
// asked the party's event walk. The walk's command cancelled the approach about 800 ms in, the
// coordinator let the warrior go from the walk, and the next approach started, every 2 s, with no
// hit. A live approach to the event's target is already the character's way to it: the poll asks no
// walk while it runs.
test('an event poll asks no walk while the combat approach walks to the event target', async () => {
 const boss = { id: '737', mtype: 'mrpumpkin' };
 const scenario = over => attendScenario({ event: 'mrpumpkin', joins: false, map: 'halloween', walkBoss: true, attendance: () => ({ event: 'mrpumpkin' }),
   feed: { mrpumpkin: { live: true, map: 'halloween', x: -495, y: 685 } }, target: boss, reachable: false, ...over });
 {
  const { attend, calls } = scenario({ approaching: '737' });
  await attend.poll(); await attend.poll();
  assert.deepEqual(calls.filter(call => call[0] === 'walk'), [], 'the approach keeps the journey');
 }
 {
  const { attend, calls } = scenario({ approaching: null });
  await attend.poll();
  assert.equal(calls.filter(call => call[0] === 'walk').length, 1, 'with no approach the poll walks');
 }
});

// The event checks follow the game's state update: targeting and the skill gates ask the active
// event many times in one pass, and the character, the entities and the feed it reads change only
// when the game applies an update or a new feed arrives. Isolated: a live run counts no reads.
test('the active event reads the game state once per update and again on a new update or feed', () => {
 const { attendScenario } = require('./fixtures/event-attend-scenario.cjs');
 const { attend, t } = attendScenario({ updates: 1, feed: { goobrawl: { live: true } } });
 const first = attend.active(), reads = t.reads;
 assert.equal(first?.name, 'goobrawl');
 for (let i = 0; i < 5; i++) assert.equal(attend.active(), first, 'the same update answered differently');
 assert.equal(t.reads, reads, 'a check with nothing changed read the game state again');
 t.feed = { goobrawl: { live: true } };
 attend.active();
 assert.ok(t.reads > reads, 'a new feed kept the last answer');
 const fed = t.reads;
 t.updates = 2;
 attend.active();
 assert.ok(t.reads > fed, 'a new update kept the last answer');
});

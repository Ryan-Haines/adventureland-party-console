const test = require('node:test');
const assert = require('node:assert/strict');
const { installEventFacts } = require('../../runtime/events/character/combat.ts');
const { eventJoins, eventNames, eventSupported, eventWalkBoss, eventMap } = require('../../runtime/events/rules.ts');

// K1's game-data reads on the
// character: the monster lists derive once per game data object.
function counted(data, limits) {
  // Counts reads of G.events, the first input the monster list derives from.
  const reads = { events: 0 };
  const proxy = game => new Proxy(game, { get(target, key) { if (key === 'events') reads.events++; return target[key]; } });
  let G = proxy(data);
  const events = installEventFacts({ game: () => G, limits: name => name === 'graveyard' ? limits : undefined });
  return { events, reads, replace: next => { G = proxy(next); } };
}
const game = () => ({
  events: { goobrawl: { join: true }, crabxx: { sprite: 'crabxx', join: true }, mrpumpkin: {}, anniversary: {}, egghunt: {} },
  monsters: { goo: {}, bgoo: {}, rgoo: {}, crabxx: {}, mrpumpkin: { spawns: [['hp:2', 'phoenix'], ['other', 'goo']] }, phoenix: {},
    zombie: {}, ghoul: {}, gargoyle: {} },
  maps: { goobrawl: { event: 'goobrawl' }, main: {} },
});

test('event monster types keep their derivation and derive once per game data object', () => {
  const { events, reads } = counted(game());
  assert.deepEqual(events.targets('goobrawl'), ['rgoo', 'bgoo', 'goo']);
  assert.deepEqual(events.targets('crabxx'), ['crabxx']);
  assert.deepEqual(events.targets('mrpumpkin'), ['mrpumpkin', 'phoenix']);
  assert.deepEqual(events.targets('graveyard'), ['zombie', 'ghoul', 'gargoyle']);
  assert.deepEqual(events.targets('unknown'), []);
  const first = reads.events;
  for (let index = 0; index < 50; index++) events.targets('goobrawl');
  assert.equal(reads.events, first, 'repeated calls with the same game data must reuse the derived list');
  assert.deepEqual(counted(game(), { monsters: ['ghoul'] }).events.targets('graveyard'), ['ghoul'], "the Graveyard setting's pick");
});

test('a caller cannot change later results, and replaced game data is derived again', () => {
  const { events, replace } = counted(game());
  const types = events.targets('goobrawl');
  types.push('crabxx');
  types.length = 1;
  assert.deepEqual(events.targets('goobrawl'), ['rgoo', 'bgoo', 'goo']);
  // A game update loads a new G object; its events can differ.
  const next = game();
  next.events.crabxx.sprite = 'phoenix';
  replace(next);
  assert.deepEqual(events.targets('crabxx'), ['phoenix', 'crabxx']);
});

// K1 `name`, `kind` and `map` with the game data: the names b9b5c91e's lists gave.
test("K1's names, joins, support and map read the game data as b9b5c91e's lists did", () => {
  const data = game();
  assert.deepEqual(eventNames(data), ['goobrawl', 'crabxx', 'mrpumpkin', 'anniversary', 'egghunt', 'abtesting', 'franky', 'icegolem',
    'snowman', 'slenderman', 'mrgreen', 'horseman', 'graveyard', 'trickortreat', 'witchcipher']);
  assert.deepEqual(['goobrawl', 'snowman', 'mrpumpkin', 'anniversary'].map(name => eventJoins(name, data)), [true, false, false, false]);
  assert.deepEqual(['goobrawl', 'snowman', 'graveyard', 'witchcipher', 'anniversary', 'egghunt'].map(eventSupported), [true, true, true, true, false, false]);
  assert.deepEqual(['slenderman', 'mrgreen', 'mrpumpkin', 'horseman', 'graveyard', 'franky'].map(eventWalkBoss), [true, true, true, true, false, false]);
  assert.deepEqual([eventMap('goobrawl', data), eventMap('crabxx', data)], ['goobrawl', 'crabxx']);
});

// K1 `kind`: the merchant
// fights a selected event it joined, never an interaction event, where it only brews or knocks.
test("the merchant's event fight follows K1's kind: none at the Cipher or the doors", () => {
  let joined = null;
  const facts = installEventFacts({ game: () => game(), limits: () => undefined, character: () => ({ ctype: 'merchant' }),
    attend: () => ({ joined: () => joined, selected: () => true }), exitPending: () => false, merchantJob: () => null });
  for (const [event, fights] of [['mrpumpkin', true], ['goobrawl', true], ['witchcipher', false], ['trickortreat', false], [null, false]]) {
    joined = event;
    assert.equal(facts.merchantFightsEvent(), fights, String(event));
  }
});

// The destination reads K1: a `point` row with no boss (the Graveyard) walks to its point
// ahead of the feed's position; a boss row's point (the Horseman) stands only when the feed names
// none; a live walk boss with none in this character's view (1.5 row 5, `inView`) goes to the party's
// freshest sighting; an interaction row goes where its October activity is.
test('the event destination reads K1 point, boss and kind columns in b9b5c91e order', () => {
  const { installEventAttendance } = require('../../runtime/events/character/attend.ts');
  const now = 50000, sight = { mtype: 'mrgreen', id: 'g', map: 'spookytown', x: 5, y: 6, observedAt: now };
  const attend = installEventAttendance({ now: () => now, reportOffset: () => 0, realm: () => 'US', game: () => ({ maps: {} }),
    character: () => ({ map: 'main', x: 1, y: 2 }), entities: () => ({}),
    members: () => [{ activeEvent: 'mrgreen', server: 'US', seenAt: now, map: 'spookytown', eventCombatSighting: sight }],
    facts: { walkBoss: name => ['mrgreen', 'horseman'].includes(name), map: name => name, targets: () => [] },
    october: { destination: name => ({ map: 'halloween', x: name.length, y: 0 }) } });
  const feed = { map: 'main', x: 10, y: 20 };
  assert.deepEqual(attend.destination('graveyard', feed), { map: 'spookytown', x: 255, y: -1425 });
  assert.deepEqual(attend.destination('horseman', feed), { map: 'main', x: 10, y: 20 });
  assert.deepEqual(attend.destination('horseman', {}), { map: 'halloween', x: -405, y: -1640 });
  assert.deepEqual(attend.destination('mrgreen', { live: true }), { map: 'spookytown', in: undefined, x: 5, y: 6 });
  assert.deepEqual(attend.destination('witchcipher', {}), { map: 'halloween', x: 11, y: 0 });
});

// EV32: Mr. Green's destination is the boss in view first, then the feed's last-seen
// hint; a walk that reaches the hint and finds no boss sends the next walk to the boss's catalog
// spawn, once per hint, and a new hint is walked to first.
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { attendScenario } = require('./fixtures/event-attend-scenario.cjs');
const hinted = (x = 1) => ({ mrgreen: { live: true, id: 'round', map: 'main', x, y: 2 } });
scenarioTable('EV32: the Mr. Green destination order', over => attendScenario({ event: 'mrgreen', joins: false, map: 'halloween', walkBoss: true,
  feed: hinted(), game: { maps: { main: {}, halloween: { spawns: [[100, 200]] } }, events: { mrgreen: {} } },
  // The clock answers a live walk-boss event as attending, not staging (clock.ts `attendance`).
  attendance: (name, state) => state?.live === true ? { staging: false } : null, ...over }), [
 ['a boss in view wins over the hint', ({ attend }) => {
  assert.deepEqual(attend.destination('mrgreen', hinted().mrgreen), { map: 'main', in: undefined, x: 50, y: 60 });
 }, { entities: { boss: { type: 'monster', mtype: 'mrgreen', visible: true, hp: 100, x: 50, y: 60 } } }],
 ['an empty hint sends the next walk to the spawn, and a new hint is walked to first', async ({ attend, calls, t }) => {
  assert.deepEqual(attend.destination('mrgreen', t.feed.mrgreen), { map: 'main', x: 1, y: 2 });
  await attend.poll();
  assert.deepEqual(calls.filter(c => c[0] === 'walk'), [['walk', 'main', 'mrgreen']]);
  assert.deepEqual(attend.destination('mrgreen', t.feed.mrgreen), { map: 'halloween', x: 100, y: 200 }, "the boss's catalog spawn");
  t.feed = hinted(7);
  assert.deepEqual(attend.destination('mrgreen', t.feed.mrgreen), { map: 'main', x: 7, y: 2 }, 'a new hint is its own');
 }],
]);
// The live hooks row "an add-on event kind is attended and returned from": the fixture's Dreams
// walk row names a point and no targets, and the game knows no monster by its name or sprite, so
// the warrior never named it as its live event and was never admitted.
test('an add-on walk row with a point and no targets is the live event; one with no point is not', () => {
  const { adoptAddonKinds } = require('../../runtime/events/rules.ts');
  adoptAddonKinds([{ name: 'dreams', label: 'Dreams', kind: 'walk', point: { map: 'main', x: 0, y: 0 } }, { name: 'nopoint', label: 'No point', kind: 'walk' }]);
  try {
    assert.equal(attendScenario({ event: 'dreams', joins: false, map: 'main', targets: [] }).attend.active()?.name, 'dreams');
    assert.equal(attendScenario({ event: 'nopoint', joins: false, map: 'main', targets: [] }).attend.active(), null);
  } finally { adoptAddonKinds([]); }
});
// The live Cipher gathering row: after gather_end the warrior stood at its 100M-hp arcticbee with
// its ingredients, in reach of the gathering monster, and never took the Witch trip, since a target
// in reach held its event poll.
test('a Cipher fighter with its gathering monster in reach still takes the Witch trip after gather_end', async () => {
  const gathering = { name: 'witchcipher', state: { live: true }, types: ['arcticbee'], kind: 'monster' };
  const handing = { name: 'witchcipher', state: { live: true }, types: [], kind: 'interaction' };
  let activity = gathering;
  const { attend, calls, t } = attendScenario({ event: 'witchcipher', joins: false, map: 'halloween', activity: () => activity,
    feed: { witchcipher: { live: true } } });
  await attend.poll();
  Object.assign(t, { target: { id: 'bee' }, reachable: true });
  activity = handing;
  await attend.poll();
  assert.deepEqual(calls.filter(c => c[0] === 'interaction'), [['interaction', 'witchcipher']]);
});

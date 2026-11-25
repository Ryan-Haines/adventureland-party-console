// The search for a boss with no fixed spot (runtime/events/character/attend.ts `nextSearchPoint`),
// the user's decision of 2026-11-17 on Slenderman: a real signal sends the search to its map, and
// with no signal one combined pass over the points of Halloween, Spookytown and the Cave goes nearest
// first, so Spookytown is not always last.
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextSearchPoint, searchPoints } = require('../../runtime/events/character/attend.ts');
const { eventKey } = require('../../runtime/events/rules.ts');

// Two maps joined by one door each way, as the game's Halloween and Spookytown doors are
// (design/maps.js: halloween's [784, -1085, ..., "spookytown", 1] and spookytown's
// [34, 1449, ..., "halloween", 2]).
// The Cave is two doors away, through Main, as on the game's maps (Halloween's Main door, then a
// Main door to the Cave); the doors here sit close to Main's spawn to keep the sums short.
const game = { maps: {
  halloween: { spawns: [[0, 0], [100, 0], [784, -1060]], doors: [[784, -1085, 80, 40, 'spookytown', 1, 2], [1212, 150, 200, 36, 'main', 0, 4]] },
  main: { spawns: [[0, 0]], doors: [[10, 10, 24, 32, 'cave', 0, 4], [5, 0, 24, 32, 'halloween', 0, 5]] },
  cave: { spawns: [[0, 33]], doors: [[0, 33, 36, 20, 'main', 0, 0]] },
  spookytown: { spawns: [[0, 0], [30, 1400]], doors: [[34, 1449, 80, 30, 'halloween', 2, 1]], npcs: [{ position: [60, 1300] }] } } };
const key = point => point.map + ':' + point.x + ':' + point.y;
const order = (from, signal) => {
  const maps = eventKey('slenderman').search, searched = new Set(), walked = [];
  let at = from;
  for (let point; (point = nextSearchPoint(game, at, searched, maps, signal));) { searched.add(key(point)); walked.push(key(point)); at = point; }
  return walked;
};

test('the Slenderman search covers the three maps the game spawns it on in one pass', () => {
  // server_functions.js spawn_special_monster and its warp pick Cave, Halloween or Spookytown.
  assert.deepEqual(eventKey('slenderman').search, ['halloween', 'spookytown', 'cave']);
  assert.deepEqual(searchPoints(game, 'spookytown').map(key), ['spookytown:0:0', 'spookytown:30:1400', 'spookytown:60:1300']);
});

test('a signal sends the search to its map first', () => {
  // From Halloween's door, Spookytown's points are the nearer ones; the feed's Halloween goes first.
  assert.deepEqual(order({ map: 'halloween', x: 784, y: -1050 }, 'halloween').slice(0, 3),
    ['halloween:784:-1060', 'halloween:100:0', 'halloween:0:0']);
  // A Spookytown signal sends a character standing in Halloween across the door first.
  assert.equal(order({ map: 'halloween', x: 0, y: 0 }, 'spookytown')[0], 'spookytown:30:1400');
});

test('with no signal the nearest unsearched point comes next across both maps', () => {
  // Beside Halloween's Spookytown door, the walk through the door to Spookytown's landing is shorter
  // than the walk back to Halloween's centre, so Spookytown comes before Halloween's far points.
  assert.deepEqual(order({ map: 'halloween', x: 784, y: -1050 }, null),
    ['halloween:784:-1060', 'spookytown:30:1400', 'spookytown:60:1300', 'spookytown:0:0', 'halloween:100:0', 'halloween:0:0', 'cave:0:33']);
});

test('a map two doors away is costed through both doors', () => {
  // From Halloween's Main door, the Cave's landing through Main is nearer than Halloween's centre,
  // and from the Cave, Halloween's centre comes back through Main.
  assert.deepEqual(order({ map: 'halloween', x: 1212, y: 150 }, null).slice(0, 2), ['cave:0:33', 'halloween:0:0']);
});

// The live rerun walked Halloween (201, -160) and then (201, -180), 20 apart, and ran out of time on
// Halloween while the boss stood in Spookytown. A point inside the game's vision of where the
// character stands is searched without a walk (protocol/reports.ts `inView`, 700 by 500).
test('the points in view of where the character stands count searched', () => {
  const { seenSearchPoints } = require('../../runtime/events/character/attend.ts');
  const maps = eventKey('slenderman').search;
  assert.deepEqual(seenSearchPoints(game, { map: 'halloween', x: 0, y: 0 }, maps), ['halloween:0:0', 'halloween:100:0']);
  assert.deepEqual(seenSearchPoints(game, { map: 'main', x: 0, y: 0 }, maps), [], 'Main is no search map');
});

// The user's decision of 2026-11-17: when the party saw the boss vanish from a spot in view, the
// feed's map stops counting as the signal and the search goes to the other maps first. The live row
// warped Slenderman from Halloween to Spookytown; the game feed still named Halloween.
test("a map the party saw the boss vanish from comes after the other maps", () => {
  const maps = eventKey('slenderman').search;
  // The nearest unsearched point across the other maps: the Cave, two doors away through Main.
  assert.equal(nextSearchPoint(game, { map: 'halloween', x: 0, y: 0 }, new Set(), maps, null, 'halloween').map, 'cave');
  assert.equal(nextSearchPoint(game, { map: 'halloween', x: 0, y: 0 }, new Set(), maps, null, null).map, 'halloween', 'with no vanish Halloween is nearest');
});
// The game warps Slenderman with a bare `disappear`; its handler moves the boss to `DEAD<id>` first.
const warp = (s, id) => { s.t.entities = { ['DEAD' + id]: { ...s.t.entities[id], dead: true } }; s.attend.disappeared({ id }); s.t.entities = {}; };
test("a boss that vanished in view sends the search off the feed's map first", async () => {
  const { attendScenario } = require('./fixtures/event-attend-scenario.cjs');
  const s = attendScenario({ event: 'slenderman', joins: false, map: 'halloween', game, feed: { slenderman: { live: true, map: 'halloween' } },
    entities: { b: { type: 'monster', mtype: 'slenderman', hp: 10, x: 120, y: 0, map: 'halloween' } } });
  Object.assign(s.character, { map: 'halloween', x: 0, y: 0 });
  warp(s, 'b');
  await s.attend.poll();
  const walks = s.calls.filter(c => c[0] === 'walk');
  assert.ok(walks.length > 0, 'the search walks');
  assert.notEqual(walks[0][1], 'halloween', 'the first point is off the map the boss vanished from');
});
// The search walked to the boss's sighting and the boss warped on its arrival.
test("a boss that vanishes during the search's walk to it sends the next point off that map", async () => {
  const { attendScenario } = require('./fixtures/event-attend-scenario.cjs');
  const s = attendScenario({ event: 'slenderman', joins: false, map: 'halloween', game, feed: { slenderman: { live: true, map: 'halloween' } },
    entities: { b: { type: 'monster', mtype: 'slenderman', hp: 10, x: 120, y: 0, map: 'halloween' } },
    leg: () => { warp(s, 'b'); s.t.leg = null; } });
  Object.assign(s.character, { map: 'halloween', x: 0, y: 0 });
  await s.attend.poll();
  const walks = s.calls.filter(c => c[0] === 'walk');
  assert.equal(walks[0][1], 'halloween', 'the first walk goes to the sighting');
  assert.notEqual(walks[1][1], 'halloween', 'the next point is off the map the boss vanished from');
});
// The live rerun's packets: the boss stood at (120, 0) under two seconds and nothing read it before
// the warp. The fighters got a bare `disappear` for it, then the attack's own `not_there` reply, and
// stepped to (-63, 0). The search then walked eight Halloween points and never left Halloween.
test("a boss that warps out of view with no read of it sends the search off that map", async () => {
  const { attendScenario } = require('./fixtures/event-attend-scenario.cjs');
  const s = attendScenario({ event: 'slenderman', joins: false, map: 'halloween', game, feed: { slenderman: { live: true, map: 'halloween' } },
    entities: { 493: { type: 'monster', mtype: 'slenderman', hp: 497485, x: 120, y: 0, map: 'halloween' } } });
  Object.assign(s.character, { map: 'halloween', x: 0, y: 0 });
  warp(s, '493');
  s.attend.disappeared({ id: '493', place: 'attack', reason: 'not_there' });
  Object.assign(s.character, { x: -63, y: 0 });
  await s.attend.poll();
  const walks = s.calls.filter(c => c[0] === 'walk');
  assert.ok(walks.length > 0, 'the search walks');
  assert.notEqual(walks[0][1], 'halloween', 'the first point is off the map the boss vanished from');
});
// The live rerun's sequence: both fighters' reports carried the boss at Halloween (120, 0) just before
// the bare `disappear`, so the next reply still named that sighting. The search walked to it, the
// clock's check ended the pass on it, and the next poll's new pass walked Halloween's own points
// first: (-38, -283), (-589.5, -335.5) and on for three minutes while the boss stood in Spookytown.
test("a party sighting from before the vanish neither draws the search back nor resets the vanish", async () => {
  const { attendScenario } = require('./fixtures/event-attend-scenario.cjs');
  const feed = { slenderman: { live: true, map: 'halloween' } };
  const s = attendScenario({ event: 'slenderman', joins: false, map: 'halloween', game, feed, now: 1000,
    entities: { 493: { type: 'monster', mtype: 'slenderman', hp: 507124, x: 120, y: 0, map: 'halloween' } },
    partySighting: { id: '493', map: 'halloween', x: 120, y: 0, server: 'US I', observedAt: 990 },
    // Each walk is the party's shared walk, which takes a new navigation revision and ends the poll's
    // pass; the clock checks the search while it runs, and the next reply drops the old sighting.
    leg: () => { s.attend.searching('slenderman', feed.slenderman); s.t.partySighting = null; s.intent.revision++; } });
  Object.assign(s.character, { map: 'halloween', x: 58, y: -8 });
  warp(s, '493');
  await s.attend.poll();
  await s.attend.poll();
  const walks = s.calls.filter(c => c[0] === 'walk').map(c => c[1]);
  assert.equal(walks.length, 2, 'each poll walks one leg');
  assert.ok(walks.every(map => map !== 'halloween'), 'both walks leave the map the boss vanished from: ' + walks.join(', '));
});
// The game sends `outside` when the boss leaves view because the character moved, which is no warp.
test("a boss that leaves view as the character moves keeps the feed's map first", async () => {
  const { attendScenario } = require('./fixtures/event-attend-scenario.cjs');
  const s = attendScenario({ event: 'slenderman', joins: false, map: 'halloween', game, feed: { slenderman: { live: true, map: 'halloween' } },
    entities: { 493: { type: 'monster', mtype: 'slenderman', hp: 10, x: 120, y: 0, map: 'halloween' } } });
  Object.assign(s.character, { map: 'halloween', x: 0, y: 0 });
  s.attend.disappeared({ id: '493', outside: true });
  s.t.entities = {};
  Object.assign(s.character, { x: 800, y: 0 });
  await s.attend.poll();
  const walks = s.calls.filter(c => c[0] === 'walk');
  assert.equal(walks[0][1], 'halloween', "the feed's map stays first");
});

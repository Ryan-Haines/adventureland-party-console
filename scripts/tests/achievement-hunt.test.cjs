// Isolated checks for Achievement Hunt target choice. Each test names the
// failure mode from docs/achievement-hunt.md that it guards against.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAchievementHunt } = require('../../runtime/coordinator/hunt/achievement-hunt.ts');
const { achievementMonsters, chooseAchievementTarget } = require('../../runtime/hunt/achievement-policy.ts');
const { createAchievementHuntRoute } = require('../../runtime/coordinator/http/achievement-hunt.ts');

const ladder = (...counts) => counts.map((count) => [count, 'stat', 'hp', 10]);
const catalog = [
  { id: 'goo', name: 'Goo', xp: 100, threat: 1, hp: 50, definition: { achievements: ladder(10, 100, 1000) } },
  { id: 'bee', name: 'Bee', xp: 400, threat: 5, hp: 100, definition: { achievements: ladder(10, 100, 1000) } },
  { id: 'wolf', name: 'White Wolf', xp: 48800, threat: 50, hp: 48000, definition: { achievements: ladder(1, 100, 1000) } },
  { id: 'dragold', name: 'Dragold', xp: 24000000, threat: 800, hp: 25600000, definition: { achievements: ladder(1, 10, 20), special: true, cooperative: true } },
  { id: 'hen', name: 'Chicken', threat: 0, hp: 10, definition: {} },
];
const choices = ['goo', 'bee', 'wolf', 'hen'].map((id) => ({ id, locations: [{ map: 'main', x: 0, y: 0 }] }));

function fixture(kills, extra = {}) {
  let now = 1_000_000;
  const selected = [];
  const state = {
    leader: 'L', farmingPolicy: 'achievements', monsterFocus: [], bestiaryCatalog: catalog, monsterChoices: choices,
    statuses: { L: { seenAt: now, monsterAchievementKills: { ...kills } }, F: { seenAt: now, monsterAchievementKills: {} } },
    achievementHunt: { monsters: ['goo', 'bee', 'wolf'], blacklistDeaths: true, deathThreshold: 2 },
    achievementBlacklist: {}, achievementTarget: null, achievementMessage: '',
    ...extra,
  };
  const ports = {
    now: () => now, members: () => ['L', 'F'], busy: () => null, persist() {}, radius: () => 400,
    destination: (id) => (id === 'nowhere' ? null : { map: 'main', x: 1, y: 2 }),
    select: (id) => { selected.push(id); state.monsterFocus = [id]; return ['L', 'F']; },
  };
  const hunt = createAchievementHunt(state, ports);
  return {
    state, ports, hunt, selected,
    advance: (ms) => { now += ms; for (const status of Object.values(state.statuses)) status.seenAt = now; },
    kills: (id, count) => { state.statuses.L.monsterAchievementKills[id] = count; },
  };
}

test('the list runs weakest to strongest; special and achievement-less monsters are marked or left out', () => {
  const order = achievementMonsters(catalog, choices);
  assert.deepEqual(order.map((m) => m.id), ['goo', 'bee', 'wolf', 'dragold']);
  // XP, not attack × speed: a Vampire Rat hits harder than a Fire Spirit but is far weaker.
  const rank = achievementMonsters([
    { id: 'fireroamer', name: 'Fire Spirit', xp: 64200, threat: 384, hp: 84000, definition: { achievements: ladder(10) } },
    { id: 'prat', name: 'Vampire Rat', xp: 7600, threat: 512, hp: 9200, definition: { achievements: ladder(1) } },
  ], [{ id: 'fireroamer', locations: [{}] }, { id: 'prat', locations: [{}] }]);
  assert.deepEqual(rank.map((m) => m.id), ['prat', 'fireroamer']);
  // Training dummies and Cave of Many Dreams monsters are unlisted by the game: special, not regular.
  const dummy = achievementMonsters([{ id: 'target_ar900', name: 'Target Automatron', xp: 1000, definition: { achievements: ladder(100), unlist: true } }], [{ id: 'target_ar900', locations: [{}] }]);
  assert.equal(dummy[0].special, true);
  // Failure mode 13: Dracul's spawn is a random respawn, though its definition has no special flag.
  // The spawn type comes from the game's map data, carried in each spawn record.
  const dracul = achievementMonsters([{ id: 'mvampire', name: 'Dracul', xp: 1, definition: { achievements: ladder(1) } }],
    [{ id: 'mvampire', locations: [{}], spawnRecords: [{ map: 'cave', x: 0, y: 0, count: 1, restrictions: [], stype: 'randomrespawn' }] }]);
  assert.equal(dracul[0].special, true);
  const fixedDracul = achievementMonsters([{ id: 'mvampire', name: 'Dracul', xp: 1, definition: { achievements: ladder(1) } }],
    [{ id: 'mvampire', locations: [{}], spawnRecords: [{ map: 'cave', x: 0, y: 0, count: 3, restrictions: [] }] }]);
  assert.equal(fixedDracul[0].special, false);
  assert.equal(order.find((m) => m.id === 'dragold').special, true);
  assert.equal(order.find((m) => m.id === 'wolf').special, false);
});

test('every selected monster reaches step 1 before any is farmed for step 2', () => {
  const order = achievementMonsters(catalog, choices);
  const pick = (kills) => chooseAchievementTarget(order, new Set(['goo', 'bee', 'wolf']), () => false, kills)?.id;
  assert.equal(pick({}), 'goo');
  assert.equal(pick({ goo: 10 }), 'bee'); // goo moves to step 2; bee still needs step 1
  assert.equal(pick({ goo: 10, bee: 10 }), 'wolf'); // wolf's step 1 is a single kill
  assert.equal(pick({ goo: 10, bee: 10, wolf: 1 }), 'goo'); // all at step 2: weakest first again
  assert.equal(pick({ goo: 1000, bee: 1000, wolf: 1000 }), undefined);
});

test('a blacklisted monster is passed over and the next one on the list is the target', () => {
  const f = fixture({});
  f.state.achievementBlacklist.goo = { monsterId: 'goo', at: 0, reason: 'Manually blacklisted' };
  f.hunt.tick();
  assert.deepEqual(f.selected, ['bee']);
});

test('no thrashing: the target is kept until its own milestone is met', () => {
  const f = fixture({});
  f.hunt.tick();
  f.advance(5_000); f.kills('goo', 9); f.hunt.tick();
  assert.deepEqual(f.selected, ['goo']);
  f.advance(5_000); f.kills('goo', 10); f.hunt.tick();
  assert.deepEqual(f.selected, ['goo', 'bee']);
  assert.match(f.state.achievementMessage, /Farming Bee: 0 \/ 10 kills \(step 1\)/);
});

test('a monster that comes back at a lower step takes over from a higher-step target', () => {
  const f = fixture({ goo: 10, bee: 10 }, { achievementHunt: { monsters: ['bee', 'wolf'], blacklistDeaths: true, deathThreshold: 2 } });
  f.hunt.tick(); // wolf's step 1
  f.advance(5_000); f.kills('wolf', 1); f.hunt.tick(); // all at step 2: bee
  assert.deepEqual(f.selected, ['wolf', 'bee']);
  f.state.achievementHunt.monsters = ['bee', 'wolf', 'goo']; // goo is re-selected, still at step 2: bee is kept
  f.advance(5_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['wolf', 'bee']);
  f.kills('goo', 0); f.state.statuses.F.monsterAchievementKills = {}; // a fresh step-1 monster appears
  f.advance(5_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['wolf', 'bee', 'goo']);
});

test('deaths count once each, only after the target started, then blacklist it and move on', () => {
  const f = fixture({});
  f.state.statuses.L.lastDeath = { at: 1 }; // before the target started
  f.hunt.tick();
  f.advance(1_000); f.state.statuses.L.lastDeath = { at: 1_000_500 }; f.hunt.tick();
  f.advance(1_000); f.hunt.tick(); // the same death reported again
  assert.equal(f.state.achievementTarget.deaths, 1);
  f.advance(1_000); f.state.statuses.F.lastDeath = { at: 1_002_800 }; f.hunt.tick();
  assert.equal(f.state.achievementBlacklist.goo.deaths, 2);
  assert.deepEqual(f.selected, ['goo', 'bee']);
});

test('a monster focus changed by hand switches to Auto instead of fighting the player', () => {
  const f = fixture({});
  f.hunt.tick();
  f.advance(20_000); f.state.monsterFocus = ['crab']; f.hunt.tick();
  assert.equal(f.state.farmingPolicy, 'auto');
  assert.match(f.state.achievementMessage, /changed by hand/);
  assert.deepEqual(f.selected, ['goo']);
});

test('another owner of travel, an offline leader or another farming mode stop it from starting a convoy', () => {
  const busy = fixture({});
  busy.ports.busy = () => 'a daily dungeon is running';
  busy.hunt.tick();
  assert.deepEqual(busy.selected, []);
  assert.match(busy.state.achievementMessage, /daily dungeon/);
  const offline = fixture({});
  offline.state.statuses.L.seenAt = 0;
  offline.hunt.tick();
  assert.deepEqual(offline.selected, []);
  const other = fixture({}, { farmingPolicy: 'hunt' });
  other.hunt.tick();
  assert.deepEqual(other.selected, []);
  // Leaving the mode forgets the target; the new mode owns travel.
  const left = fixture({});
  left.hunt.tick();
  left.state.farmingPolicy = 'scatter';
  left.advance(1_000); left.hunt.tick();
  assert.equal(left.state.achievementTarget, null);
  assert.deepEqual(left.selected, ['goo']);
});

test('a monster without a route is skipped for a while, and the rest of the list continues', () => {
  const f = fixture({});
  f.ports.destination = (id) => (id === 'goo' ? null : { map: 'main', x: 1, y: 2 });
  f.hunt.tick();
  assert.deepEqual(f.selected, []);
  f.advance(1_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['bee']);
});

test('with everything finished it reports so and keeps the party where it is', () => {
  const f = fixture({ goo: 1000, bee: 1000, wolf: 1000 });
  f.hunt.tick();
  assert.deepEqual(f.selected, []);
  assert.match(f.state.achievementMessage, /Nothing left to farm/);
});

test('the settings route validates monsters and thresholds, and edits the blacklist', () => {
  const f = fixture({}, { achievementHunt: { monsters: [], blacklistDeaths: true, deathThreshold: 3 } });
  const route = createAchievementHuntRoute(f.state, { now: () => 1, known: () => new Set(['goo', 'bee']), reset() {}, persist() {} });
  const call = (body) => { let out; route({ body }, { status: (code) => ({ json: (value) => { out = { code, value }; } }), json: (value) => { out = { code: 200, value }; } }); return out; };
  assert.equal(call({ settings: { monsters: ['goo', 'kraken'] } }).code, 400);
  assert.equal(call({ settings: { deathThreshold: 0 } }).code, 400);
  assert.equal(call({ settings: { monsters: ['goo', 'goo', 'bee'] } }).code, 200);
  assert.deepEqual(f.state.achievementHunt.monsters, ['goo', 'bee']);
  assert.equal(call({ blacklist: { action: 'add', monsterId: 'bee' } }).code, 200);
  assert.ok(f.state.achievementBlacklist.bee);
  assert.equal(call({ blacklist: { action: 'clear' } }).code, 200);
  assert.deepEqual(f.state.achievementBlacklist, {});
});

test('an Achievement Hunt switch stays in the mode; picking a monster by hand still resets it to Auto', () => {
  const { createMonsterSelection } = require('../../runtime/coordinator/navigation/monster-selection.ts');
  const party = () => ({ leader: 'L', followers: { F: true }, statuses: {}, farmAreaState: null, farmingPolicy: 'achievements', monsterFocus: ['bee'],
    monsterFocusByCharacter: {}, scatterMonsterTypes: ['bee'], scatterEpoch: 1, partyFarmingMode: 'scatter', partyFarmingMonsterType: 'bee',
    scatterBreakTarget: null, eventReturn: null, deferredEventReturns: {}, eventSessions: {}, commands: {}, passiveRareHunts: {} });
  const ports = { now: () => 1, release() {}, clearHunt() {}, members: () => ['L', 'F'], authorize() {}, start: () => true, startPhoenix() {}, stopPhoenix() {}, persist() {} };
  const kept = party();
  createMonsterSelection(kept, ports).select('goo', { map: 'main', x: 1, y: 2 }, undefined, true);
  assert.equal(kept.farmingPolicy, 'achievements');
  assert.deepEqual(kept.monsterFocus, ['goo']);
  assert.deepEqual(kept.scatterMonsterTypes, []); // learned scatter state for the old monster resets
  const manual = party();
  createMonsterSelection(manual, ports).select('goo', { map: 'main', x: 1, y: 2 }, undefined);
  assert.equal(manual.farmingPolicy, 'auto');
  // Failure mode 27: a switch on the hunt's timer keeps event state for members still finishing an event.
  const returning = () => ({ ...party(), eventReturn: { id: 'r' }, deferredEventReturns: { F: { id: 'd' } }, eventSessions: { goobrawl: {} } });
  const switched = returning();
  createMonsterSelection(switched, ports).select('goo', { map: 'main', x: 1, y: 2 }, undefined, true);
  assert.deepEqual([switched.eventReturn, switched.deferredEventReturns, switched.eventSessions], [{ id: 'r' }, { F: { id: 'd' } }, { goobrawl: {} }]);
  const picked = returning();
  createMonsterSelection(picked, ports).select('goo', { map: 'main', x: 1, y: 2 }, undefined);
  assert.deepEqual([picked.eventReturn, picked.deferredEventReturns, picked.eventSessions], [null, {}, {}]);
});

test('each farming scope keeps its own Achievement Hunt; a saved leader profile keeps the party-wide selection', () => {
  const { createFarmingScopes } = require('../../runtime/coordinator/hunt/scopes.ts');
  const legacy = { monsters: ['goo', 'bee'], blacklistDeaths: true, deathThreshold: 4 };
  const root = {
    leader: 'L', followers: { F: true }, merchantCharacter: 'M', farmingProfiles: { L: { farmingPolicy: 'auto' } },
    achievementHunt: legacy, achievementBlacklist: {}, achievementTarget: null, achievementMessage: '',
    monsterFocusByCharacter: {}, bestiaryCatalog: catalog, monsterChoices: choices, statuses: {},
  };
  const scopes = createFarmingScopes(root, () => 1_000_000);
  assert.deepEqual(root.achievementHunt, legacy); // the leader's profile inherited the existing selection
  const solo = scopes.view('S');
  assert.deepEqual(solo.achievementHunt.monsters, []);
  assert.equal(scopes.effective('F').achievementHunt, root.achievementHunt); // followers use the leader's
  // A solo character farms its own target and leaves the party's mode alone.
  root.statuses = { L: { seenAt: 1_000_000, monsterAchievementKills: { goo: 10 } }, S: { seenAt: 1_000_000, monsterAchievementKills: { goo: 10 } } };
  solo.achievementHunt = { monsters: ['goo', 'wolf'], blacklistDeaths: true, deathThreshold: 3 };
  solo.farmingPolicy = 'achievements';
  const selected = [];
  createAchievementHunt(solo, {
    now: () => 1_000_000, members: () => ['S'], busy: () => null, persist() {}, radius: () => 400,
    destination: () => ({ map: 'main', x: 1, y: 2 }),
    select: (id) => { selected.push(id); solo.monsterFocus = [id]; return ['S']; },
  }).tick();
  assert.deepEqual(selected, ['wolf']); // goo already has step 1; wolf has not
  assert.equal(scopes.profile('S').achievementTarget.id, 'wolf');
  assert.equal(root.achievementTarget, null);
  assert.equal(root.farmingPolicy, 'auto');
});

// Filling respawn waits: failure modes 14-19 in docs/achievement-hunt.md.
const { nearbyFillers } = require('../../runtime/hunt/achievement-policy.ts');
const snakes = [
  { id: 'snake', name: 'Snake', xp: 960, threat: 3, hp: 720, definition: { achievements: ladder(100, 1000) } },
  { id: 'osnake', name: 'Snake', xp: 1600, threat: 3, hp: 720, definition: { achievements: ladder(100, 1000) } },
  { id: 'greenjr', name: 'Green Jr.', xp: 9000, threat: 9, hp: 9000, definition: { achievements: ladder(1) } },
  { id: 'ghost', name: 'Ghost', xp: 400, threat: 2, hp: 400, definition: { achievements: ladder(100) } },
  { id: 'crab', name: 'Tiny Crab', xp: 100, threat: 1, hp: 400, definition: { achievements: ladder(100) } },
];
const halloween = (x, y) => ({ map: 'halloween', x, y, boundary: [x - 60, y - 50, x + 60, y + 50] });
const spawn = (place, count) => ({ ...place, sourceMap: place.map, count, restrictions: [] });
const snakeChoices = [
  { id: 'osnake', locations: [halloween(-590, -335)], spawnRecords: [spawn(halloween(-590, -335), 2)] },
  { id: 'snake', locations: [halloween(-590, -300)], spawnRecords: [spawn(halloween(-590, -300), 9)] },
  { id: 'greenjr', locations: [halloween(-590, -300)] },
  // A box touching the Orange Snake box without sharing it, like Tiny Crabs beside Squigtoads.
  { id: 'crab', locations: [halloween(-590, -440)], spawnRecords: [spawn(halloween(-590, -440), 8)] },
  { id: 'ghost', locations: [halloween(900, -750)] },
];

test('boss-like monsters the game does not flag are special; rare but weak ones stay regular', () => {
  const one = (id, count) => ({ id, locations: [{ map: 'winterland', x: 0, y: 0 }],
    spawnRecords: [{ map: 'winterland', x: 0, y: 0, count, restrictions: [] }, { map: 'test', x: 0, y: 0, count: 9, restrictions: ['ignore'] }] });
  const order = achievementMonsters([
    { id: 'stompy', name: 'Stompy', xp: 600000, hp: 640000, definition: { achievements: ladder(1), respawn: 2160 } },
    { id: 'a1', name: 'Spike', xp: 32000000, hp: 18700000, definition: { achievements: ladder(1), respawn: -1 } },
    { id: 'squigtoad', name: 'Squigtoad', xp: 32000, hp: 9600, definition: { achievements: ladder(10), respawn: 120 } },
    { id: 'pinkgoblin', name: 'Pink Goblin', xp: 460000, hp: 420000, definition: { achievements: ladder(10), respawn: 40 } },
  ], [one('stompy', 1), one('a1', 1), one('squigtoad', 2), one('pinkgoblin', 3)]);
  const special = Object.fromEntries(order.map((m) => [m.id, m.special]));
  assert.deepEqual(special, { stompy: true, a1: true, squigtoad: false, pinkgoblin: false });
});

test('two monsters with one game name show their ids', () => {
  const order = achievementMonsters(snakes, snakeChoices);
  assert.equal(order.find((m) => m.id === 'osnake').name, 'Snake (osnake)');
  assert.equal(order.find((m) => m.id === 'snake').name, 'Snake (snake)');
  assert.equal(order.find((m) => m.id === 'ghost').name, 'Ghost');
});

test('fillers share the target spawn, are no stronger than the target, regular and not excluded', () => {
  const order = achievementMonsters(snakes, snakeChoices);
  const at = halloween(-590, -335);
  // Green Jr. shares the snake spawn but is stronger; the crab box only touches it; the ghost spawn is far away.
  assert.deepEqual(nearbyFillers(order, snakeChoices, 'osnake', at, () => false), ['snake']);
  assert.deepEqual(nearbyFillers(order, snakeChoices, 'osnake', at, (id) => id === 'snake'), []);
  // A target spot without a box counts spawns within 100 of it: the snake box holds it, the crab box is 130 away.
  assert.deepEqual(nearbyFillers(order, snakeChoices, 'osnake', { map: 'halloween', x: -590, y: -260 }, () => false), ['snake']);
});

function snakeFixture(extra = {}) {
  let now = 1_000_000;
  const selected = [];
  const state = {
    leader: 'L', farmingPolicy: 'achievements', monsterFocus: [], bestiaryCatalog: snakes, monsterChoices: snakeChoices,
    statuses: { L: { seenAt: now, monsterAchievementKills: { snake: 100 } }, F: { seenAt: now, monsterAchievementKills: {} } },
    // Plain snakes aren't selected, so these tests fill from any regular monster on the ground.
    achievementHunt: { monsters: ['osnake'], blacklistDeaths: true, deathThreshold: 3, fillIdle: true, fillSelectedOnly: false },
    achievementBlacklist: {}, achievementTarget: null, achievementMessage: '',
    monsterPrioritiesByCharacter: { L: { snake: 70, bat: 20 } }, location: null, activeConvoy: null,
    ...extra,
  };
  const ports = {
    now: () => now, members: () => ['L', 'F'], busy: () => null, persist() {}, radius: () => 400,
    destination: (id) => ({ ...snakeChoices.find((c) => c.id === id).locations[0] }),
    select: (id, location) => { selected.push(id); state.monsterFocus = [id]; state.location = location; return ['L', 'F']; },
  };
  return { state, ports, selected, hunt: createAchievementHunt(state, ports), advance: (ms) => { now += ms; for (const s of Object.values(state.statuses)) s.seenAt = now; } };
}

test('the target is the top priority tier and nearby fillers the bottom one, for every member', () => {
  const f = snakeFixture();
  f.hunt.tick();
  assert.deepEqual(f.selected, ['osnake']);
  assert.deepEqual(f.state.monsterFocus, ['osnake', 'snake']);
  assert.deepEqual(f.state.monsterPrioritiesByCharacter, { L: { snake: 10, bat: 20, osnake: 90 }, F: { osnake: 90, snake: 10 } });
  // The filler list is the hunt's own focus, not a change by hand.
  f.advance(20_000); f.hunt.tick();
  assert.equal(f.state.farmingPolicy, 'achievements');
});

test("leaving the mode restores each member's previous priorities", () => {
  const f = snakeFixture();
  f.hunt.tick();
  f.state.farmingPolicy = 'default';
  f.advance(1_000); f.hunt.tick();
  assert.equal(f.state.achievementTarget, null);
  assert.deepEqual(f.state.monsterPrioritiesByCharacter, { L: { snake: 70, bat: 20 }, F: {} });
});

test('a relocation to a spawn without the target sends the party back to the target', () => {
  const f = snakeFixture();
  f.hunt.tick();
  f.advance(20_000);
  f.state.location = { map: 'halloween', x: -590, y: 200 }; // a competition move to a snake-only spawn
  f.hunt.tick();
  assert.deepEqual(f.selected, ['osnake', 'osnake']);
  assert.deepEqual(f.state.location, { ...snakeChoices[0].locations[0] });
});

test('with Fill respawn waits off the focus is the target alone', () => {
  const f = snakeFixture();
  f.state.achievementHunt.fillIdle = false;
  f.hunt.tick();
  assert.deepEqual(f.state.monsterFocus, ['osnake']);
  assert.deepEqual(f.state.monsterPrioritiesByCharacter, { L: { snake: 70, bat: 20 } });
});

test('a rare variant at the same step is farmed first, with the common monster as its filler', () => {
  const f = snakeFixture();
  f.state.achievementHunt.monsters = ['snake', 'osnake'];
  f.state.statuses.L.monsterAchievementKills = {}; // both at step 1: the sweep alone would pick plain snakes
  f.hunt.tick();
  assert.deepEqual(f.selected, ['osnake']);
  assert.deepEqual(f.state.monsterFocus, ['osnake', 'snake']);
  // Off, the sweep's own choice stands.
  const off = snakeFixture();
  off.state.achievementHunt = { ...off.state.achievementHunt, monsters: ['snake', 'osnake'], fillIdle: false };
  off.state.statuses.L.monsterAchievementKills = {};
  off.hunt.tick();
  assert.deepEqual(off.selected, ['snake']);
  // A stronger monster that is not rarer keeps the sweep's order.
  const common = snakeFixture();
  common.state.achievementHunt.monsters = ['snake', 'osnake'];
  common.state.monsterChoices = snakeChoices.map((choice) => choice.id === 'osnake' ? { ...choice, spawnRecords: [spawn(choice.locations[0], 12)] } : choice);
  common.state.statuses.L.monsterAchievementKills = {};
  common.hunt.tick();
  assert.deepEqual(common.selected, ['snake']);
  // A variant a step behind the common monster does not take over a lower step.
  const behind = snakeFixture();
  behind.state.achievementHunt.monsters = ['snake', 'osnake'];
  behind.state.statuses.L.monsterAchievementKills = { osnake: 100 };
  behind.hunt.tick();
  assert.deepEqual(behind.selected, ['snake']);
});

test('a target kept across a restart or a settings change gets its fillers without moving', () => {
  const f = snakeFixture();
  f.state.achievementHunt.fillIdle = false;
  f.hunt.tick();
  assert.deepEqual(f.state.monsterFocus, ['osnake']);
  f.state.achievementHunt.fillIdle = true;
  f.hunt.reset(); // the settings route calls this after every change
  f.advance(1_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['osnake']);
  assert.deepEqual(f.state.monsterFocus, ['osnake', 'snake']);
  // A restarted coordinator resumes a saved target that has no focus list yet.
  const restarted = snakeFixture({ achievementTarget: { id: 'osnake', step: 0, milestone: 100, startedAt: 1_000_000, deaths: 0, counted: {} },
    monsterFocus: ['osnake'], location: { ...snakeChoices[0].locations[0] } });
  restarted.hunt.tick();
  assert.deepEqual(restarted.selected, []);
  assert.deepEqual(restarted.state.monsterFocus, ['osnake', 'snake']);
});

test('a dead party member holds the next switch until everyone is back', () => {
  const f = fixture({});
  f.hunt.tick();
  f.advance(1_000); f.state.statuses.L.lastDeath = { at: 1_000_500 }; f.state.statuses.L.rip = true; f.hunt.tick();
  f.advance(1_000); f.state.statuses.F.lastDeath = { at: 1_001_500 }; f.state.statuses.F.rip = true; f.hunt.tick();
  assert.equal(f.state.achievementBlacklist.goo.deaths, 2);
  assert.deepEqual(f.selected, ['goo']);
  assert.match(f.state.achievementMessage, /^Waiting: L and F are dead/);
  f.advance(1_000); f.state.statuses.L.rip = false; f.hunt.tick();
  assert.match(f.state.achievementMessage, /^Waiting: F is dead/);
  f.advance(1_000); f.state.statuses.F.rip = false; f.hunt.tick();
  assert.deepEqual(f.selected, ['goo', 'bee']);
});

test('deaths during an event trip do not count toward the target, as in Hunt', () => {
  const f = fixture({});
  f.hunt.tick();
  f.advance(1_000); f.state.statuses.L.lastDeath = { at: 1_000_500, eventTrip: { event: 'goobrawl', startedAt: 1_000_100 } }; f.hunt.tick();
  assert.equal(f.state.achievementTarget.deaths, 0);
  f.advance(1_000); f.state.statuses.L.lastDeath = { at: 1_001_500, eventTrip: null }; f.hunt.tick();
  assert.equal(f.state.achievementTarget.deaths, 1);
});

test('a leader standing away from the target after a failed trip is sent back, at most every 30 seconds', () => {
  const f = snakeFixture();
  f.hunt.tick();
  assert.deepEqual(f.selected, ['osnake']);
  // The convoy failed: the configured location is the target, but the leader is elsewhere.
  f.state.activeConvoy = { phase: 'failed' };
  Object.assign(f.state.statuses.L, { map: 'winterland', x: 400, y: -2600 });
  f.advance(20_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['osnake', 'osnake']);
  f.advance(5_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['osnake', 'osnake'], 'no retry inside 30 seconds');
  f.advance(30_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['osnake', 'osnake', 'osnake']);
  // At the spawn the target is kept, and a convoy still travelling is never interrupted.
  Object.assign(f.state.statuses.L, { map: 'halloween', x: -590, y: -335 });
  f.advance(40_000); f.hunt.tick();
  Object.assign(f.state.statuses.L, { map: 'winterland', x: 400, y: -2600 }); f.state.activeConvoy = { phase: 'travel' };
  f.advance(40_000); f.hunt.tick();
  assert.equal(f.selected.length, 3);
  // A leader on its own errand, such as a town restock, is not pulled back.
  f.state.activeConvoy = null; f.state.statuses.L.navigationState = 'town';
  f.advance(40_000); f.hunt.tick();
  assert.equal(f.selected.length, 3);
  f.state.statuses.L.navigationState = 'idle';
  f.advance(40_000); f.hunt.tick();
  assert.equal(f.selected.length, 4);
});

test('new installs blacklist a target on its sixth death, the threshold the live run used', () => {
  const { defaultAchievementHuntSettings } = require('../../runtime/coordinator/hunt/achievement-settings.ts');
  assert.equal(defaultAchievementHuntSettings.deathThreshold, 6);
  assert.equal(defaultAchievementHuntSettings.fillSelectedOnly, true);
});

test('fillers are only selected monsters unless that setting is off', () => {
  // Failure mode 28: a monster the player left unselected became a filler.
  const f = snakeFixture();
  f.state.achievementHunt.fillSelectedOnly = true;
  f.hunt.tick();
  assert.deepEqual(f.state.monsterFocus, ['osnake']);
  const both = snakeFixture();
  Object.assign(both.state.achievementHunt, { fillSelectedOnly: true, monsters: ['osnake', 'snake'] });
  both.hunt.tick();
  assert.deepEqual(both.state.monsterFocus, ['osnake', 'snake']);
  // Settings saved before this option existed lack it, and get the default.
  const saved = snakeFixture();
  delete saved.state.achievementHunt.fillSelectedOnly;
  saved.hunt.tick();
  assert.deepEqual(saved.state.monsterFocus, ['osnake']);
});

// Bosses: failure modes 29 and 30 in docs/achievement-hunt.md.
const winterBox = { map: 'winterland', x: 433, y: -2745, boundary: [30, -2954, 836, -2536] };
const bossCatalog = [
  { id: 'goo', name: 'Goo', xp: 100, threat: 1, hp: 50, definition: { achievements: ladder(10, 100, 1000) } },
  { id: 'wolf', name: 'White Wolf', xp: 48800, threat: 50, hp: 48000, definition: { achievements: ladder(1, 100, 1000) } },
  { id: 'stompy', name: 'Stompy', xp: 600000, threat: 900, hp: 640000, definition: { achievements: ladder(1), respawn: 2160 } },
];
const bossChoices = [
  { id: 'goo', locations: [{ map: 'main', x: 0, y: 0 }], spawnRecords: [{ map: 'main', x: 0, y: 0, count: 9, restrictions: [] }] },
  { id: 'wolf', locations: [winterBox], spawnRecords: [{ ...winterBox, count: 7, restrictions: [] }] },
  { id: 'stompy', locations: [winterBox], spawnRecords: [{ ...winterBox, count: 1, restrictions: [] }] },
];
function bossFixture() {
  let now = 1_000_000;
  const selected = [];
  const state = {
    leader: 'L', farmingPolicy: 'achievements', monsterFocus: [], bestiaryCatalog: bossCatalog, monsterChoices: bossChoices,
    // Goo already has step 1, so the weaker-first sweep picks White Wolf.
    statuses: { L: { seenAt: now, monsterAchievementKills: { goo: 10 } }, F: { seenAt: now, monsterAchievementKills: {} } },
    achievementHunt: { monsters: ['goo', 'wolf'], blacklistDeaths: true, deathThreshold: 6, fillIdle: true },
    achievementBlacklist: {}, achievementTarget: null, achievementMessage: '', location: null, activeConvoy: null,
  };
  const ports = {
    now: () => now, members: () => ['L', 'F'], busy: () => null, persist() {}, radius: () => 400,
    destination: (id) => ({ ...bossChoices.find((c) => c.id === id).locations[0] }),
    select: (id, location) => { selected.push(id); state.monsterFocus = [id]; state.location = location; return ['L', 'F']; },
  };
  return { state, selected, hunt: createAchievementHunt(state, ports), advance: (ms) => { now += ms; for (const s of Object.values(state.statuses)) s.seenAt = now; } };
}

test('a target with a boss on its ground tells fighters to keep away from that boss', () => {
  const order = achievementMonsters(bossCatalog, bossChoices);
  assert.equal(order.find((m) => m.id === 'stompy').boss, true);
  assert.equal(order.find((m) => m.id === 'wolf').boss, false);
  const f = bossFixture();
  f.hunt.tick();
  assert.deepEqual(f.selected, ['wolf']);
  assert.deepEqual(f.state.achievementTarget.avoid, ['stompy']);
  // Seeing the boss is not enough to leave; fighters keep their distance.
  f.state.statuses.L.avoidSightings = [{ mtype: 'stompy', target: null }];
  f.advance(5_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['wolf']);
});

test('a boss attacking the party sends the hunt to a stand-in, and it returns 10 minutes after the boss was last seen', () => {
  const f = bossFixture();
  f.hunt.tick();
  // Failure mode 29: Stompy attacks a party member at the White Wolf spawn.
  f.state.statuses.F.avoidSightings = [{ mtype: 'stompy', target: 'F' }];
  f.state.statuses.F.lastDeath = { at: 1_002_000 };
  f.advance(5_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['wolf', 'goo']);
  assert.equal(f.state.achievementTarget.standInFor, 'wolf');
  assert.match(f.state.achievementMessage, /Farming Goo: .* while Stompy holds White Wolf \(back in 10m\)/);
  // The death still counts against White Wolf, not the stand-in, and it stays off the blacklist below the threshold.
  assert.deepEqual(f.state.achievementBlacklist, {});
  // Failure mode 30: a later sighting of the boss pushes the return back; then it returns.
  f.state.statuses.F.avoidSightings = [];
  f.advance(5 * 60_000); f.state.statuses.L.avoidSightings = [{ mtype: 'stompy', target: null }]; f.hunt.tick();
  f.state.statuses.L.avoidSightings = [];
  f.advance(9 * 60_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['wolf', 'goo'], 'the boss was seen 9 minutes ago');
  f.advance(2 * 60_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['wolf', 'goo', 'wolf']);
  assert.equal(f.state.achievementTarget.standInFor, undefined);
  assert.equal(f.state.achievementTarget.deaths, 1, 'the death before leaving still counts toward the blacklist');
});

// Rare spawns: failure mode 31 in docs/achievement-hunt.md.
const rareCatalog = [
  { id: 'goo', name: 'Goo', xp: 100, threat: 1, hp: 50, definition: { achievements: ladder(10, 100, 1000) } },
  { id: 'mvampire', name: 'Dracul', xp: 2000, threat: 9, hp: 240000, definition: { achievements: ladder(1, 10) } },
  { id: 'phoenix', name: 'Phoenix', xp: 9000, threat: 9, hp: 160000, definition: { achievements: ladder(1, 10) } },
];
const rareChoices = [
  { id: 'goo', locations: [{ map: 'main', x: 0, y: 0 }], spawnRecords: [{ map: 'main', x: 0, y: 0, count: 9, restrictions: [] }] },
  { id: 'mvampire', locations: [{ map: 'cave', x: 0, y: 0 }], spawnRecords: [{ map: 'cave', x: 0, y: 0, count: 1, restrictions: [], stype: 'randomrespawn' }] },
  { id: 'phoenix', locations: [{ map: 'main', x: 900, y: 0 }], spawnRecords: [{ map: 'main', x: 900, y: 0, count: 1, restrictions: [] }] },
];
function rareFixture(monsters, rules = {}) {
  let now = 1_000_000;
  const selected = [], sets = [];
  const state = {
    leader: 'L', farmingPolicy: 'achievements', monsterFocus: [], bestiaryCatalog: rareCatalog, monsterChoices: rareChoices,
    statuses: { L: { seenAt: now, monsterAchievementKills: {} } },
    achievementHunt: { monsters, blacklistDeaths: true, deathThreshold: 6, fillIdle: true },
    achievementBlacklist: {}, achievementTarget: null, achievementMessage: '', location: null, activeConvoy: null, achievementPassive: null,
  };
  const passive = { rules: { ...rules } };
  const ports = {
    now: () => now, members: () => ['L'], busy: () => null, persist() {}, radius: () => 400,
    destination: (id) => ({ ...rareChoices.find((c) => c.id === id).locations[0] }),
    select: (id, location) => { selected.push(id); state.monsterFocus = [id]; state.location = location; return ['L']; },
    passive: { rule: (id) => passive.rules[id], set: (changes) => { sets.push(changes); Object.assign(passive.rules, changes); } },
  };
  return { state, selected, sets, passive, hunt: createAchievementHunt(state, ports),
    advance: (ms) => { now += ms; state.statuses.L.seenAt = now; } };
}

test('a selected rare is never the target; passive hunting fights it when seen, then gets its old rule back', () => {
  const order = achievementMonsters(rareCatalog, rareChoices);
  assert.deepEqual(order.filter((m) => m.rare).map((m) => m.id), ['mvampire', 'phoenix']);
  assert.ok(order.filter((m) => m.rare).every((m) => m.special), 'rares are listed with the special monsters');
  // Dracul and Phoenix are at step 1 and Goo at step 2, yet Goo is the target (failure mode 31).
  const f = rareFixture(['goo', 'mvampire', 'phoenix'], { phoenix: { enabled: false, keepMoving: false, priority: 80, maxLevel: 5 } });
  f.state.statuses.L.monsterAchievementKills = { goo: 10 };
  f.hunt.tick();
  assert.deepEqual(f.selected, ['goo']);
  assert.deepEqual(f.passive.rules.mvampire, { enabled: true, keepMoving: false, priority: 100, maxLevel: -1 });
  // The player's own Phoenix priority and level cap are kept while the hunt switches it on.
  assert.deepEqual(f.passive.rules.phoenix, { enabled: true, keepMoving: false, priority: 80, maxLevel: 5 });
  // Dracul finishes its ladder: its rule goes back to off. Leaving the mode restores Phoenix exactly.
  f.state.statuses.L.monsterAchievementKills = { goo: 10, mvampire: 10 };
  f.advance(5_000); f.hunt.tick();
  assert.equal(f.passive.rules.mvampire.enabled, false);
  f.state.farmingPolicy = 'auto';
  f.advance(5_000); f.hunt.tick();
  assert.deepEqual(f.passive.rules.phoenix, { enabled: false, keepMoving: false, priority: 80, maxLevel: 5 });
  assert.deepEqual(f.state.achievementPassive, {});
  f.advance(5_000); f.hunt.tick();
  assert.equal(f.sets.length, 3, 'nothing changes once the rules are restored');
});

test("a rare the player already hunts passively is left alone, and only rares selected waits for them", () => {
  const own = { enabled: true, keepMoving: false, priority: 300, maxLevel: -1 };
  const f = rareFixture(['phoenix'], { phoenix: own });
  f.hunt.tick();
  assert.deepEqual(f.selected, []);
  assert.deepEqual(f.sets, []);
  assert.deepEqual(f.passive.rules.phoenix, own);
  const g = rareFixture(['mvampire']);
  g.hunt.tick();
  assert.equal(g.state.achievementMessage, 'No target to farm: fighting Dracul when seen');
});

test('the boss recheck time is a setting, validated by the settings route', () => {
  const f = bossFixture();
  f.state.achievementHunt.bossRecheckMinutes = 3;
  f.hunt.tick();
  f.state.statuses.F.avoidSightings = [{ mtype: 'stompy', target: 'F' }];
  f.advance(5_000); f.hunt.tick();
  assert.match(f.state.achievementMessage, /\(back in 3m\)/);
  f.state.statuses.F.avoidSightings = [];
  f.advance(2 * 60_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['wolf', 'goo']);
  f.advance(60_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['wolf', 'goo', 'wolf']);
  const { validAchievementHuntSettings } = require('../../runtime/coordinator/hunt/achievement-settings.ts');
  assert.equal(validAchievementHuntSettings({ bossRecheckMinutes: 30 }), true);
  for (const bad of [0, 121, 2.5, '10']) assert.equal(validAchievementHuntSettings({ bossRecheckMinutes: bad }), false, String(bad));
});

test('a rare on the same ground as the target is never farmed as its variant', () => {
  const f = snakeFixture({ monsterChoices: snakeChoices.map((choice) => choice.id === 'osnake'
    ? { ...choice, spawnRecords: [{ ...spawn(choice.locations[0], 1), stype: 'randomrespawn' }] } : choice) });
  f.state.achievementHunt.monsters = ['snake', 'osnake'];
  f.state.statuses.L.monsterAchievementKills = {};
  f.hunt.tick();
  assert.deepEqual(f.selected, ['snake']);
});

test('a target whose start throws is skipped and the hunt moves on', () => {
  const f = snakeFixture();
  f.state.achievementHunt.monsters = ['snake', 'osnake'];
  f.state.statuses.L.monsterAchievementKills = {};
  const select = f.ports.select;
  f.ports.select = (id, location) => { if (id === 'osnake') throw new Error('Choose all five Phoenix regions exactly once'); return select(id, location); };
  assert.doesNotThrow(() => f.hunt.tick());
  assert.match(f.state.achievementMessage, /^Skipping osnake: Choose all five Phoenix regions exactly once/);
  f.advance(1_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['snake']);
});

// Counts reads of each entry's definition, which every list build reads once per entry.
function countedCatalog(entries) {
  const reads = { count: 0 };
  const list = entries.map((entry) => {
    const copy = { ...entry };
    delete copy.definition;
    return Object.defineProperty(copy, 'definition', { enumerable: true, get() { reads.count++; return entry.definition; } });
  });
  return { list, reads };
}

test('the hunt builds its monster list once while the catalog and the choices stay the same (failure mode 32)', () => {
  const counted = countedCatalog(catalog);
  const f = fixture({}, { bestiaryCatalog: counted.list });
  f.hunt.tick();
  const perBuild = counted.reads.count;
  assert.ok(perBuild > 0);
  for (let tick = 0; tick < 20; tick++) { f.advance(1_000); f.hunt.tick(); }
  assert.equal(counted.reads.count, perBuild);
  assert.deepEqual(f.selected, ['goo']);
});

test('a new catalog or new monster choices rebuild the list (failure mode 33)', () => {
  const counted = countedCatalog(catalog);
  const f = fixture({}, { bestiaryCatalog: counted.list });
  f.hunt.tick();
  const perBuild = counted.reads.count;
  f.state.monsterChoices = choices.slice();
  f.advance(1_000); f.hunt.tick();
  assert.equal(counted.reads.count, 2 * perBuild);
  // A catalog without Goo moves the hunt on to Bee.
  f.state.bestiaryCatalog = catalog.filter((entry) => entry.id !== 'goo');
  f.advance(1_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['goo', 'bee']);
});

test('a repeated choice id resolves to the first choice, as a linear search did (failure mode 34)', () => {
  const entry = { id: 'goo', name: 'Goo', xp: 1, definition: { achievements: ladder(1) } };
  const order = achievementMonsters([entry], [
    { id: 'goo', locations: [{}], spawnRecords: [{ map: 'main', x: 0, y: 0, count: 4, restrictions: [] }] },
    { id: 'goo', locations: [{}], spawnRecords: [{ map: 'main', x: 0, y: 0, count: 1, restrictions: [], stype: 'randomrespawn' }] },
  ]);
  assert.equal(order[0].rare, false);
  assert.equal(order[0].special, false);
});

// docs/efficiency.md (Achievement Hunt state), retention item 9.
test('blacklisting a target past 500 entries drops only the oldest', () => {
  const old = Object.fromEntries(Array.from({ length: 500 }, (_, index) => ['m' + index, { monsterId: 'm' + index, at: index, reason: 'Manually blacklisted' }]));
  const f = fixture({}, { achievementBlacklist: old });
  f.hunt.tick();
  f.advance(1_000); f.state.statuses.L.lastDeath = { at: 1_000_500 }; f.hunt.tick();
  f.advance(1_000); f.state.statuses.F.lastDeath = { at: 1_001_800 }; f.hunt.tick();
  assert.equal(f.state.achievementBlacklist.goo.deaths, 2);
  assert.equal(Object.keys(f.state.achievementBlacklist).length, 500);
  assert.equal(f.state.achievementBlacklist.m0, undefined);
  assert.ok(f.state.achievementBlacklist.m1);
});

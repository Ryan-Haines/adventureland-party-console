// Isolated checks for Achievement Hunt target choice (runtime/addons/achievement-hunt), the
// fork's scripts/tests/achievement-hunt.test.cjs on the add-on. Each row names the failure
// mode it guards against (the fork's docs/achievement-hunt.md); the failure list is in
// e2e/movement-owner-failures.md items 10 to 14.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAchievementHunt } = require('../hunt.ts');
const { achievementMonsters: monstersAt, chooseAchievementTarget } = require('../policy.ts');
const { registration } = require('../index.ts');
// The boss cut-off at the add-on's declared defaults (index.ts `settings`), which every row but the boss cut-off row plays at.
const cut = { spawns: registration.settings.bossSpawns.default, hp: registration.settings.bossHp.default };
// The realm's registry with core:hunting's `passive.rule` answer, which the hunt asks through
// addon-api.ts `ask`: the answer runtime/hunting/coordinator/install.ts gives with no saved rules,
// so passive hunting knows a monster by name exactly when its legacy table lists it. The fixture
// reads both from runtime/hunting/rules.ts, the file install.ts reads them from.
const { createRegistry } = require('../../../hooks/registry.ts');
const { defaultPassiveRule, legacyPriorities } = require('../../../hunting/rules.ts');
const hooks = createRegistry();
hooks.register({ name: 'core:hunting', folder: 'core', author: 'test', summary: 'The passive rule read.', hooks: {
  'passive.rule': (id) => ({ rule: defaultPassiveRule(id), default: defaultPassiveRule(id), corePriority: Object.hasOwn(legacyPriorities, id) }) } });
globalThis.__partyHooks = hooks;
const corePriority = (id) => hooks.ask('passive.rule', id).corePriority;
const achievementMonsters = (catalog, choices) => monstersAt(catalog, choices, cut, corePriority);
const { settingsWriter } = require('../../../../scripts/tests/helpers/settings-writer.cjs');
// The coordinator hands a target mode add-on a write that names it as the source (application.ts `addonPorts`).
const addonWrite = (state) => { const writer = settingsWriter(state); return (changes) => writer.write({ changes, by: 'addon:achievement-hunt' }); };
// Each failure mode is a row of one scenario table per behaviour; the rows share the
// fixture below and run in the order written.
const tables = require('../../../../scripts/tests/helpers/row-table.cjs').rowTables();
const row = tables.row;

const ladder = (...counts) => counts.map((count) => [count, 'stat', 'hp', 10]);
const catalog = [
  { id: 'goo', name: 'Goo', xp: 100, threat: 1, hp: 50, definition: { achievements: ladder(10, 100, 1000) } },
  { id: 'bee', name: 'Bee', xp: 400, threat: 5, hp: 100, definition: { achievements: ladder(10, 100, 1000) } },
  { id: 'wolf', name: 'White Wolf', xp: 48800, threat: 50, hp: 48000, definition: { achievements: ladder(1, 100, 1000) } },
  { id: 'dragold', name: 'Dragold', xp: 24000000, threat: 800, hp: 25600000, definition: { achievements: ladder(1, 10, 20), special: true, cooperative: true } },
  { id: 'hen', name: 'Chicken', threat: 0, hp: 10, definition: {} },
];
const choices = ['goo', 'bee', 'wolf', 'hen'].map((id) => ({ id, locations: [{ map: 'main', x: 0, y: 0 }] }));

// One hunt over the add-on's ports (index.ts `ports`): the catalog and choices it reads, its
// members with the leader's kills, the hunt settings, extra party fields and extra ports. The walk
// goes to the choice's first location, and a selection moves the party's location there.
function huntFixture({ catalog, choices, members = ['L', 'F'], kills = {}, hunt: settings, state: fields = {}, ports: extraPorts = {} }) {
  let now = 1_000_000;
  const selected = [];
  const state = {
    leader: 'L', targetMode: 'achievements', monsterFocus: [], bestiaryCatalog: catalog, monsterChoices: choices,
    statuses: Object.fromEntries(members.map((name, i) => [name, { seenAt: now, reportIntervalMs: 1000, monsterAchievementKills: i ? {} : { ...kills } }])),
    achievementHunt: settings, achievementBlacklist: {}, achievementTarget: null, achievementMessage: '',
    ...fields,
  };
  const ports = {
    now: () => now, members: () => members, busy: () => null, persist() {}, radius: () => 400, bossCut: () => cut, write: addonWrite(state),
    destination: (id) => { const choice = choices.find((c) => c.id === id); return choice ? { ...choice.locations[0] } : null; },
    select: (id, location) => { selected.push(id); state.monsterFocus = [id]; state.location = location; return members; },
    focus: (ids) => { state.monsterFocus = ids; },
    ...extraPorts,
  };
  const hunt = createAchievementHunt(() => ({ scope: state, store: state, ports }));
  return {
    state, ports, hunt, selected,
    advance: (ms) => { now += ms; for (const status of Object.values(state.statuses)) status.seenAt = now; },
    kills: (id, count) => { state.statuses.L.monsterAchievementKills[id] = count; },
  };
}
const fixture = (kills, extra = {}) => huntFixture({ catalog, choices, kills, state: extra,
  hunt: { monsters: ['goo', 'bee', 'wolf'], blacklistDeaths: true, deathThreshold: 2 } });

row('items 10 and 14: the target order, its steps and what stops or skips a switch', 'the list runs weakest to strongest; special and achievement-less monsters are marked or left out', () => {
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

row('items 10 and 14: the target order, its steps and what stops or skips a switch', 'every selected monster reaches step 1 before any is farmed for step 2', () => {
  const order = achievementMonsters(catalog, choices);
  const pick = (kills) => chooseAchievementTarget(order, new Set(['goo', 'bee', 'wolf']), () => false, kills)?.id;
  assert.equal(pick({}), 'goo');
  assert.equal(pick({ goo: 10 }), 'bee'); // goo moves to step 2; bee still needs step 1
  assert.equal(pick({ goo: 10, bee: 10 }), 'wolf'); // wolf's step 1 is a single kill
  assert.equal(pick({ goo: 10, bee: 10, wolf: 1 }), 'goo'); // all at step 2: weakest first again
  assert.equal(pick({ goo: 1000, bee: 1000, wolf: 1000 }), undefined);
});

row('items 10 and 14: the target order, its steps and what stops or skips a switch', 'a blacklisted monster is passed over and the next one on the list is the target', () => {
  const f = fixture({});
  f.state.achievementBlacklist.goo = { monsterId: 'goo', at: 0, reason: 'Manually blacklisted' };
  f.hunt.tick();
  assert.deepEqual(f.selected, ['bee']);
});

row('items 10 and 14: the target order, its steps and what stops or skips a switch', 'no thrashing: the target is kept until its own milestone is met', () => {
  const f = fixture({});
  f.hunt.tick();
  f.advance(5_000); f.kills('goo', 9); f.hunt.tick();
  assert.deepEqual(f.selected, ['goo']);
  f.advance(5_000); f.kills('goo', 10); f.hunt.tick();
  assert.deepEqual(f.selected, ['goo', 'bee']);
  assert.match(f.state.achievementMessage, /Farming Bee: 0 \/ 10 kills \(step 1\)/);
});

row('items 10 and 14: the target order, its steps and what stops or skips a switch', 'a monster that comes back at a lower step takes over from a higher-step target', () => {
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

row('items 10 and 14: the target order, its steps and what stops or skips a switch', 'deaths count once each, only after the target started, then blacklist it and move on', () => {
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

row('items 10 and 14: the target order, its steps and what stops or skips a switch', 'a monster focus changed by hand switches the target mode to Farming instead of fighting the player', () => {
  // The target mode goes to Farming and the combat mode stays as the player chose it.
  const f = fixture({}, { combatMode: 'scatter' });
  f.hunt.tick();
  f.advance(20_000); f.state.monsterFocus = ['crab']; f.hunt.tick();
  assert.deepEqual([f.state.targetMode, f.state.combatMode], ['farming', 'scatter']);
  assert.match(f.state.achievementMessage, /changed by hand/);
  assert.deepEqual(f.selected, ['goo']);
});

row('items 10 and 14: the target order, its steps and what stops or skips a switch', 'another owner of travel, an offline leader or another farming mode stop it from starting a convoy', () => {
  const busy = fixture({});
  busy.ports.busy = () => 'a daily dungeon is running';
  busy.hunt.tick();
  assert.deepEqual(busy.selected, []);
  assert.match(busy.state.achievementMessage, /daily dungeon/);
  const offline = fixture({});
  offline.state.statuses.L.seenAt = 0;
  offline.hunt.tick();
  assert.deepEqual(offline.selected, []);
  const other = fixture({}, { targetMode: 'hunt' });
  other.hunt.tick();
  assert.deepEqual(other.selected, []);
  // Leaving the mode forgets the target; the new mode owns travel.
  const left = fixture({});
  left.hunt.tick();
  left.state.targetMode = 'farming';
  left.advance(1_000); left.hunt.tick();
  assert.equal(left.state.achievementTarget, null);
  assert.deepEqual(left.selected, ['goo']);
});

row('items 10 and 14: the target order, its steps and what stops or skips a switch', 'a monster without a route is skipped for a while, and the rest of the list continues', () => {
  const f = fixture({});
  f.ports.destination = (id) => (id === 'goo' ? null : { map: 'main', x: 1, y: 2 });
  f.hunt.tick();
  assert.deepEqual(f.selected, []);
  f.advance(1_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['bee']);
});

row('items 10 and 14: the target order, its steps and what stops or skips a switch', 'with everything finished it reports so and keeps the party where it is', () => {
  const f = fixture({ goo: 1000, bee: 1000, wolf: 1000 });
  f.hunt.tick();
  assert.deepEqual(f.selected, []);
  assert.match(f.state.achievementMessage, /Nothing left to farm/);
});

// The add-on's settings answer `target.settings` (POST /party-api/addon-farming); they live in
// the scope's add-on store.
const settingsCall = (scope, store, body, now = 1_000_000) => {
  const result = registration.hooks['target.settings']({ owner: 'L', scope, store, now, ports: { persist() {} }, body }, {});
  return result.ok ? { code: 200, value: result.reply } : { code: result.status, value: result.error };
};
row('items 11 to 13: the settings, the mode switch, the scope store and the return to the target', 'the settings validate monsters and thresholds, edit the blacklist, and say when the mode cannot start', () => {
  const scope = { bestiaryCatalog: catalog, monsterChoices: choices, statuses: { L: { seenAt: 1_000_000, reportIntervalMs: 1000 } } };
  const store = { achievementHunt: { monsters: [], blacklistDeaths: true, deathThreshold: 3 } };
  assert.deepEqual(settingsCall(scope, store, { action: 'available' }), { code: 409, value: 'choose at least one monster for Achievement Hunt' });
  assert.equal(settingsCall(scope, store, { settings: { monsters: ['goo', 'kraken'] } }).code, 400);
  assert.equal(settingsCall(scope, store, { settings: { deathThreshold: 0 } }).code, 400);
  assert.equal(settingsCall(scope, store, { settings: { monsters: ['goo', 'goo', 'bee'] } }).code, 200);
  assert.deepEqual(store.achievementHunt.monsters, ['goo', 'bee']);
  assert.equal(settingsCall(scope, store, { action: 'available' }).code, 200);
  assert.equal(settingsCall(scope, store, { action: 'available' }, 1_010_000).value, 'the character must be online');
  assert.equal(settingsCall(scope, store, { blacklist: { action: 'add', monsterId: 'bee' } }).code, 200);
  assert.ok(store.achievementBlacklist.bee);
  assert.equal(settingsCall(scope, store, { blacklist: { action: 'clear' } }).code, 200);
  assert.deepEqual(store.achievementBlacklist, {});
});

row('items 11 to 13: the settings, the mode switch, the scope store and the return to the target', 'an Achievement Hunt switch stays in the target mode; picking a monster by hand switches it to Farming and keeps the combat mode', () => {
  const { createMonsterSelection } = require('../../../hunting/coordinator/farm.ts');
  const party = () => ({ leader: 'L', followers: { F: true }, statuses: {}, farmAreaState: null, targetMode: 'achievements', monsterFocus: ['bee'],
    monsterFocusByCharacter: {}, scatterMonsterTypes: ['bee'], scatterEpoch: 1, partyFarmingMode: 'scatter', partyFarmingMonsterType: 'bee',
    scatterBreakTarget: null, eventReturn: null, deferredEventReturns: {}, eventSessions: {}, commands: {}, passiveRareHunts: {} });
  const ports = { now: () => 1, release() {}, clearHunt() {}, members: () => ['L', 'F'], authorize() {}, start: () => true, startPhoenix() {}, stopPhoenix() {}, persist() {},
    write() { throw Error('an Achievement Hunt switch keeps the target mode'); } };
  // A pick by hand writes target Farming through the writer and leaves the combat mode.
  const byHand = (p) => ({ ...ports, write: (batch) => settingsWriter(p).write(batch) });
  const kept = party();
  createMonsterSelection(kept, ports).select('goo', { map: 'main', x: 1, y: 2 }, true);
  assert.equal(kept.targetMode, 'achievements');
  assert.deepEqual(kept.monsterFocus, ['goo']);
  assert.deepEqual(kept.scatterMonsterTypes, []); // learned scatter state for the old monster resets
  const manual = { ...party(), combatMode: 'default' };
  createMonsterSelection(manual, byHand(manual)).select('goo', { map: 'main', x: 1, y: 2 });
  assert.deepEqual([manual.targetMode, manual.combatMode], ['farming', 'default']);
  // Failure mode 27: a switch on the hunt's timer keeps event state for members still finishing an event.
  const returning = () => ({ ...party(), eventReturn: { id: 'r' }, deferredEventReturns: { F: { id: 'd' } }, eventSessions: { goobrawl: {} } });
  const switched = returning();
  createMonsterSelection(switched, ports).select('goo', { map: 'main', x: 1, y: 2 }, true);
  assert.deepEqual([switched.eventReturn, switched.deferredEventReturns, switched.eventSessions], [{ id: 'r' }, { F: { id: 'd' } }, { goobrawl: {} }]);
  // A pick by hand leaves the members' occurrences and keeps the event return with its deferred
  // rows (the events owner's owned commands: a focus change ends only commands of its own
  // tier).
  const picked = returning();
  createMonsterSelection(picked, byHand(picked)).select('goo', { map: 'main', x: 1, y: 2 });
  assert.deepEqual([picked.eventReturn, picked.deferredEventReturns, picked.eventSessions], [{ id: 'r' }, { F: { id: 'd' } }, {}]);
});

row('items 11 to 13: the settings, the mode switch, the scope store and the return to the target', 'each farming scope keeps its own Achievement Hunt in its profile; followers use the leader scope', () => {
  const { createFarmingScopes } = require('../../../tasks/coordinator/groups.ts');
  const root = {
    leader: 'L', followers: { F: true }, merchantCharacter: 'M', farmingProfiles: { L: { combatMode: 'auto' } },
    monsterFocusByCharacter: {}, bestiaryCatalog: catalog, monsterChoices: choices, statuses: {},
  };
  const scopes = createFarmingScopes(root, require('../../../settings/coordinator/table.ts').coordinatorSettings().lists, () => 1_000_000);
  const solo = scopes.view('S');
  assert.deepEqual(solo.addonFarming, {});
  assert.equal(scopes.effective('F').addonFarming, root.addonFarming); // followers use the leader's store
  // A solo character farms its own target through the add-on's tick and leaves the party's mode alone.
  root.statuses = { L: { seenAt: 1_000_000, reportIntervalMs: 1000, monsterAchievementKills: { goo: 10 } }, S: { seenAt: 1_000_000, reportIntervalMs: 1000, monsterAchievementKills: { goo: 10 } } };
  solo.targetMode = 'achievements';
  const store = solo.addonFarming['achievement-hunt'] = { achievementHunt: { monsters: ['goo', 'wolf'], blacklistDeaths: true, deathThreshold: 3 } };
  const selected = [];
  const delivered = registration.hooks['target.mode']({ owner: 'S', scope: solo, store, now: 1_000_000, ports: {
    members: () => ['S'], busy: () => null, persist() {}, radius: () => 400, bossCut: () => cut, write: addonWrite(solo), destination: () => ({ map: 'main', x: 1, y: 2 }),
    select: (id) => { selected.push(id); solo.monsterFocus = [id]; return ['S']; }, focus: (ids) => { solo.monsterFocus = ids; } } }, {});
  assert.deepEqual(selected, ['wolf']); // goo already has step 1; wolf has not
  assert.equal(scopes.profile('S').addonFarming['achievement-hunt'].achievementTarget.id, 'wolf');
  assert.deepEqual(delivered, { avoid: [] });
  assert.equal(root.addonFarming['achievement-hunt'], undefined);
  assert.equal(root.targetMode, 'farming');
});

row('items 11 to 13: the settings, the mode switch, the scope store and the return to the target', 'each tick reads the view it was handed, not the first one', () => {
  // The coordinator hands a new view object every tick. The first view's leader is offline, so the
  // hunt waits; the second view's leader reports, so the hunt reads it and chooses a target there.
  const view = (seenAt, calls) => {
    const scope = { leader: 'V', targetMode: 'achievements', bestiaryCatalog: catalog, monsterChoices: choices, monsterFocus: [],
      statuses: { V: { seenAt, reportIntervalMs: 1000, monsterAchievementKills: { goo: 10 } } } };
    const store = { achievementHunt: { monsters: ['goo', 'wolf'], blacklistDeaths: true, deathThreshold: 3 } };
    return { owner: 'V', scope, store, now: 1_000_000, ports: {
      members: () => { calls.push('members'); return ['V']; }, busy: () => null, persist() {}, radius: () => 400, write: addonWrite(scope),
      destination: () => ({ map: 'main', x: 1, y: 2 }), select: (id) => { calls.push(id); scope.monsterFocus = [id]; return ['V']; }, focus: (ids) => { scope.monsterFocus = ids; } } };
  };
  const first = [], second = [];
  const stale = view(0, first), current = view(1_000_000, second);
  registration.hooks['target.mode'](stale, {});
  assert.equal(stale.store.achievementMessage, 'Waiting for an online party leader');
  registration.hooks['target.mode'](current, {});
  assert.deepEqual([first.length, second.includes('wolf')], [0, true]);
  assert.equal(current.store.achievementTarget.id, 'wolf');
});

row('items 11 to 13: the settings, the mode switch, the scope store and the return to the target', 'switching the add-on off and on starts a fresh hunt with no failed routes kept', () => {
  // The first hunt finds no spawn for wolf and marks it unroutable on these monster choices. After
  // `addon.off` the next tick of the same scope routes wolf again on the same choices.
  const scope = { leader: 'O', targetMode: 'achievements', bestiaryCatalog: catalog, monsterChoices: choices, monsterFocus: [],
    statuses: { O: { seenAt: 1_000_000, reportIntervalMs: 1000, monsterAchievementKills: { goo: 10 } } } };
  const store = { achievementHunt: { monsters: ['goo', 'wolf'], blacklistDeaths: true, deathThreshold: 3 } };
  let routes = false;
  const selected = [];
  const view = () => ({ owner: 'O', scope, store, now: 1_000_000, ports: {
    members: () => ['O'], busy: () => null, persist() {}, radius: () => 400, write: addonWrite(scope),
    destination: () => routes ? { map: 'main', x: 1, y: 2 } : null,
    select: (id) => { selected.push(id); scope.monsterFocus = [id]; return ['O']; }, focus: (ids) => { scope.monsterFocus = ids; } } });
  registration.hooks['target.mode'](view(), {});
  assert.match(store.achievementMessage, /^Skipping wolf/);
  registration.hooks['addon.off']();
  scope.targetMode = 'achievements';
  routes = true;
  registration.hooks['target.mode'](view(), {});
  assert.deepEqual(selected, ['wolf']);
});

// Filling respawn waits: failure modes 14-19 in docs/achievement-hunt.md.
const { nearbyFillers } = require('../policy.ts');
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

row('items 10 and 14: the target order, its steps and what stops or skips a switch', 'boss-like monsters the game does not flag are special; rare but weak ones stay regular', () => {
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

row('items 10 and 14: the target order, its steps and what stops or skips a switch', 'two monsters with one game name show their ids', () => {
  const order = achievementMonsters(snakes, snakeChoices);
  assert.equal(order.find((m) => m.id === 'osnake').name, 'Snake (osnake)');
  assert.equal(order.find((m) => m.id === 'snake').name, 'Snake (snake)');
  assert.equal(order.find((m) => m.id === 'ghost').name, 'Ghost');
});

row('item 10: fillers, their priorities and rare variants', 'fillers share the target spawn, are no stronger than the target, regular and not excluded', () => {
  const order = achievementMonsters(snakes, snakeChoices);
  const at = halloween(-590, -335);
  // Green Jr. shares the snake spawn but is stronger; the crab box only touches it; the ghost spawn is far away.
  assert.deepEqual(nearbyFillers(order, snakeChoices, 'osnake', at, () => false), ['snake']);
  assert.deepEqual(nearbyFillers(order, snakeChoices, 'osnake', at, (id) => id === 'snake'), []);
  // A target spot without a box counts spawns within 100 of it: the snake box holds it, the crab box is 130 away.
  assert.deepEqual(nearbyFillers(order, snakeChoices, 'osnake', { map: 'halloween', x: -590, y: -260 }, () => false), ['snake']);
});

// Plain snakes aren't selected, so these rows fill from any regular monster on the ground.
const snakeFixture = (extra = {}) => huntFixture({ catalog: snakes, choices: snakeChoices, kills: { snake: 100 },
  hunt: { monsters: ['osnake'], blacklistDeaths: true, deathThreshold: 3, fillIdle: true, fillSelectedOnly: false },
  state: { monsterPrioritiesByCharacter: { L: { snake: 70, bat: 20 } }, location: null, activeConvoy: null, ...extra } });

row('item 10: fillers, their priorities and rare variants', 'the target is the top priority tier and nearby fillers the bottom one, for every member', () => {
  const f = snakeFixture();
  f.hunt.tick();
  assert.deepEqual(f.selected, ['osnake']);
  assert.deepEqual(f.state.monsterFocus, ['osnake', 'snake']);
  assert.deepEqual(f.state.monsterPrioritiesByCharacter, { L: { snake: 10, bat: 20, osnake: 90 }, F: { osnake: 90, snake: 10 } });
  // The priorities are the player's setting, so the hunt's change writes one line per member
  // naming the add-on.
  assert.deepEqual(f.state.settingsChanges.map((l) => [l.field, l.character, l.by, l.new]), [
    ['monsterPrioritiesByCharacter', 'L', 'addon:achievement-hunt', { snake: 10, bat: 20, osnake: 90 }],
    ['monsterPrioritiesByCharacter', 'F', 'addon:achievement-hunt', { osnake: 90, snake: 10 }]]);
  // The filler list is the hunt's own focus, not a change by hand.
  f.advance(20_000); f.hunt.tick();
  assert.equal(f.state.targetMode, 'achievements');
});

row('item 10: fillers, their priorities and rare variants', "leaving the mode restores each member's previous priorities", () => {
  const f = snakeFixture();
  f.hunt.tick();
  f.state.targetMode = 'farming';
  f.advance(1_000); f.hunt.tick();
  assert.equal(f.state.achievementTarget, null);
  assert.deepEqual(f.state.monsterPrioritiesByCharacter, { L: { snake: 70, bat: 20 }, F: {} });
});

row('item 10: fillers, their priorities and rare variants', 'a relocation to a spawn without the target sends the party back to the target', () => {
  const f = snakeFixture();
  f.hunt.tick();
  f.advance(20_000);
  f.state.location = { map: 'halloween', x: -590, y: 200 }; // a competition move to a snake-only spawn
  f.hunt.tick();
  assert.deepEqual(f.selected, ['osnake', 'osnake']);
  assert.deepEqual(f.state.location, { ...snakeChoices[0].locations[0] });
});

row('item 10: fillers, their priorities and rare variants', 'with Fill respawn waits off the focus is the target alone', () => {
  const f = snakeFixture();
  f.state.achievementHunt.fillIdle = false;
  f.hunt.tick();
  assert.deepEqual(f.state.monsterFocus, ['osnake']);
  assert.deepEqual(f.state.monsterPrioritiesByCharacter, { L: { snake: 70, bat: 20 } });
});

row('item 10: fillers, their priorities and rare variants', 'a rare variant at the same step is farmed first, with the common monster as its filler', () => {
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

row('item 10: fillers, their priorities and rare variants', 'a target kept across a restart or a settings change gets its fillers without moving', () => {
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

row('items 10 and 14: the target order, its steps and what stops or skips a switch', 'a dead party member holds the next switch until everyone is back', () => {
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

row('items 10 and 14: the target order, its steps and what stops or skips a switch', 'deaths during an event trip do not count toward the target, as in Hunt', () => {
  const f = fixture({});
  f.hunt.tick();
  f.advance(1_000); f.state.statuses.L.lastDeath = { at: 1_000_500, eventTrip: { event: 'goobrawl', startedAt: 1_000_100 } }; f.hunt.tick();
  assert.equal(f.state.achievementTarget.deaths, 0);
  f.advance(1_000); f.state.statuses.L.lastDeath = { at: 1_001_500, eventTrip: null }; f.hunt.tick();
  assert.equal(f.state.achievementTarget.deaths, 1);
});

row('items 11 to 13: the settings, the mode switch, the scope store and the return to the target', 'a leader standing away from the target after a failed trip is sent back, again only after two of its reports', () => {
  const f = snakeFixture();
  f.hunt.tick();
  assert.deepEqual(f.selected, ['osnake']);
  // The convoy failed: the configured location is the target, but the leader is elsewhere.
  f.state.activeConvoy = { phase: 'failed' };
  Object.assign(f.state.statuses.L, { map: 'winterland', x: 400, y: -2600 });
  f.advance(20_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['osnake', 'osnake']);
  f.advance(1_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['osnake', 'osnake'], 'no retry before two of the leader report intervals');
  f.advance(1_500); f.hunt.tick();
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

row('items 11 to 13: the settings, the mode switch, the scope store and the return to the target', 'new installs blacklist a target on its sixth death, the threshold the live run used', () => {
  const { defaultAchievementHuntSettings } = require('../settings.ts');
  assert.equal(defaultAchievementHuntSettings.deathThreshold, 6);
  assert.equal(defaultAchievementHuntSettings.fillSelectedOnly, true);
});

row('item 10: fillers, their priorities and rare variants', 'fillers are only selected monsters unless that setting is off', () => {
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
// Goo already has step 1, so the weaker-first sweep picks White Wolf.
const bossFixture = () => huntFixture({ catalog: bossCatalog, choices: bossChoices, kills: { goo: 10 },
  hunt: { monsters: ['goo', 'wolf'], blacklistDeaths: true, deathThreshold: 6, fillIdle: true }, state: { location: null, activeConvoy: null } });

row('item 10: bosses on the target ground and rare spawns', 'a target with a boss on its ground tells fighters to keep away from that boss', () => {
  const order = achievementMonsters(bossCatalog, bossChoices);
  assert.equal(order.find((m) => m.id === 'stompy').boss, true);
  assert.equal(order.find((m) => m.id === 'wolf').boss, false);
  const f = bossFixture();
  f.hunt.tick();
  assert.deepEqual(f.selected, ['wolf']);
  assert.deepEqual(f.state.achievementTarget.avoid, ['stompy']);
  // Seeing the boss is not enough to leave; fighters keep their distance.
  f.state.statuses.L.addonReports = { 'achievement-hunt': { sightings: [{ mtype: 'stompy', target: null }] } };
  f.advance(5_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['wolf']);
});

row('item 10: bosses on the target ground and rare spawns', 'a boss attacking the party sends the hunt to a stand-in, and it returns 10 minutes after the boss was last seen', () => {
  const f = bossFixture();
  f.hunt.tick();
  // Failure mode 29: Stompy attacks a party member at the White Wolf spawn.
  f.state.statuses.F.addonReports = { 'achievement-hunt': { sightings: [{ mtype: 'stompy', target: 'F' }] } };
  f.state.statuses.F.lastDeath = { at: 1_002_000 };
  f.advance(5_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['wolf', 'goo']);
  assert.equal(f.state.achievementTarget.standInFor, 'wolf');
  assert.match(f.state.achievementMessage, /Farming Goo: .* while Stompy holds White Wolf \(back in 10m\)/);
  // The death still counts against White Wolf, not the stand-in, and it stays off the blacklist below the threshold.
  assert.deepEqual(f.state.achievementBlacklist, {});
  // Failure mode 30: a later sighting of the boss pushes the return back; then it returns.
  f.state.statuses.F.addonReports = { 'achievement-hunt': { sightings: [] } };
  f.advance(5 * 60_000); f.state.statuses.L.addonReports = { 'achievement-hunt': { sightings: [{ mtype: 'stompy', target: null }] } }; f.hunt.tick();
  f.state.statuses.L.addonReports = { 'achievement-hunt': { sightings: [] } };
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
// A solo leader whose passive hunting rules the hunt switches through its `passive` port.
function rareFixture(monsters, rules = {}) {
  const passive = { rules: { ...rules } }, sets = [];
  const port = { rule: (id) => passive.rules[id], set: (changes) => { sets.push(changes); Object.assign(passive.rules, changes); return { ok: true, changed: ['passiveHunting'] }; } };
  return { ...huntFixture({ catalog: rareCatalog, choices: rareChoices, members: ['L'], ports: { passive: port },
    hunt: { monsters, blacklistDeaths: true, deathThreshold: 6, fillIdle: true }, state: { location: null, activeConvoy: null, achievementPassive: null } }), passive, sets };
}

row('item 10: bosses on the target ground and rare spawns', 'a selected rare is never the target; passive hunting fights it when seen, then gets its old rule back', () => {
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
  f.state.targetMode = 'farming';
  f.advance(5_000); f.hunt.tick();
  assert.deepEqual(f.passive.rules.phoenix, { enabled: false, keepMoving: false, priority: 80, maxLevel: 5 });
  assert.deepEqual(f.state.achievementPassive, {});
  f.advance(5_000); f.hunt.tick();
  assert.equal(f.sets.length, 3, 'nothing changes once the rules are restored');
});

row('item 10: bosses on the target ground and rare spawns', "a rare the player already hunts passively is left alone, and only rares selected waits for them", () => {
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

row('items 11 to 13: the settings, the mode switch, the scope store and the return to the target', 'the boss recheck time is a setting, validated by the settings route', () => {
  const f = bossFixture();
  f.state.achievementHunt.bossRecheckMinutes = 3;
  f.hunt.tick();
  f.state.statuses.F.addonReports = { 'achievement-hunt': { sightings: [{ mtype: 'stompy', target: 'F' }] } };
  f.advance(5_000); f.hunt.tick();
  assert.match(f.state.achievementMessage, /\(back in 3m\)/);
  f.state.statuses.F.addonReports = { 'achievement-hunt': { sightings: [] } };
  f.advance(2 * 60_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['wolf', 'goo']);
  f.advance(60_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['wolf', 'goo', 'wolf']);
  const { validAchievementHuntSettings } = require('../settings.ts');
  assert.equal(validAchievementHuntSettings({ bossRecheckMinutes: 30 }), true);
  for (const bad of [0, 121, 2.5, '10']) assert.equal(validAchievementHuntSettings({ bossRecheckMinutes: bad }), false, String(bad));
});

row('items 11 to 13: the settings, the mode switch, the scope store and the return to the target', 'leaving the target when a boss attacks is a setting: off keeps farming it, on and a save without it leave', () => {
  // Off: Stompy attacks at the White Wolf spawn and the hunt stays, still keeping away from Stompy.
  const f = bossFixture();
  f.state.achievementHunt.leaveOnBossAttack = false;
  f.hunt.tick();
  f.state.statuses.F.addonReports = { 'achievement-hunt': { sightings: [{ mtype: 'stompy', target: 'F' }] } };
  f.advance(5_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['wolf'], 'off stays on the target');
  assert.equal(f.state.achievementTarget.standInFor, undefined);
  assert.deepEqual(f.state.achievementTarget.avoid, ['stompy']);
  // Switched on while the boss attacks: the hunt leaves for a stand-in.
  f.state.achievementHunt.leaveOnBossAttack = true;
  f.advance(5_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['wolf', 'goo'], 'on stops leaving');
  // Switched off during the hold: the stand-in ends and the party goes back to White Wolf.
  f.state.achievementHunt.leaveOnBossAttack = false;
  f.state.statuses.F.addonReports = { 'achievement-hunt': { sightings: [] } };
  f.advance(5_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['wolf', 'goo', 'wolf']);
  // A save from before the setting has no value for it, and leaves as on does.
  const old = bossFixture();
  assert.equal('leaveOnBossAttack' in old.state.achievementHunt, false);
  old.hunt.tick();
  old.state.statuses.F.addonReports = { 'achievement-hunt': { sightings: [{ mtype: 'stompy', target: 'F' }] } };
  old.advance(5_000); old.hunt.tick();
  assert.deepEqual(old.selected, ['wolf', 'goo'], 'a save without the field stops leaving');
  const { validAchievementHuntSettings, defaultAchievementHuntSettings } = require('../settings.ts');
  assert.equal(defaultAchievementHuntSettings.leaveOnBossAttack, true);
  assert.equal(validAchievementHuntSettings({ leaveOnBossAttack: false }), true);
  assert.equal(validAchievementHuntSettings({ leaveOnBossAttack: 'no' }), false);
});

row('item 10: bosses on the target ground and rare spawns', 'a rare on the same ground as the target is never farmed as its variant', () => {
  const f = snakeFixture({ monsterChoices: snakeChoices.map((choice) => choice.id === 'osnake'
    ? { ...choice, spawnRecords: [{ ...spawn(choice.locations[0], 1), stype: 'randomrespawn' }] } : choice) });
  f.state.achievementHunt.monsters = ['snake', 'osnake'];
  f.state.statuses.L.monsterAchievementKills = {};
  f.hunt.tick();
  assert.deepEqual(f.selected, ['snake']);
});

// The selection refuses by returning null, so a throw from it is a fault the hunt does not hide as
// an unroutable target.
row('items 10 and 14: the target order, its steps and what stops or skips a switch', 'a target whose start throws reaches the error path; a refused start is skipped', () => {
  const f = snakeFixture();
  f.state.achievementHunt.monsters = ['snake', 'osnake'];
  f.state.statuses.L.monsterAchievementKills = {};
  const select = f.ports.select;
  f.ports.select = (id, location) => { if (id === 'osnake') throw new Error('Choose all five Phoenix regions exactly once'); return select(id, location); };
  assert.throws(() => f.hunt.tick(), /Choose all five Phoenix regions exactly once/);
  f.ports.select = (id, location) => id === 'osnake' ? null : select(id, location);
  f.hunt.tick();
  assert.match(f.state.achievementMessage, /^Skipping osnake: the party convoy could not be started/);
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

row('item 10: the monster list is built once per catalog (the fork failure modes 32 to 34)', 'the hunt builds its monster list once while the catalog and the choices stay the same (failure mode 32)', () => {
  const counted = countedCatalog(catalog);
  const f = fixture({}, { bestiaryCatalog: counted.list });
  f.hunt.tick();
  const perBuild = counted.reads.count;
  assert.ok(perBuild > 0);
  for (let tick = 0; tick < 20; tick++) { f.advance(1_000); f.hunt.tick(); }
  assert.equal(counted.reads.count, perBuild);
  assert.deepEqual(f.selected, ['goo']);
});

row('item 10: the monster list is built once per catalog (the fork failure modes 32 to 34)', 'a new catalog or new monster choices rebuild the list (failure mode 33)', () => {
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

row('item 10: the monster list is built once per catalog (the fork failure modes 32 to 34)', 'a repeated choice id resolves to the first choice, as a linear search did (failure mode 34)', () => {
  const entry = { id: 'goo', name: 'Goo', xp: 1, definition: { achievements: ladder(1) } };
  const order = achievementMonsters([entry], [
    { id: 'goo', locations: [{}], spawnRecords: [{ map: 'main', x: 0, y: 0, count: 4, restrictions: [] }] },
    { id: 'goo', locations: [{}], spawnRecords: [{ map: 'main', x: 0, y: 0, count: 1, restrictions: [], stype: 'randomrespawn' }] },
  ]);
  assert.equal(order[0].rare, false);
  assert.equal(order[0].special, false);
});

// docs/efficiency.md (Achievement Hunt state), retention item 9.

tables.run();

// The fork's own registration, a toggle beside the target mode (tests/fork.ts), conflicts with
// core's own slot, and addon:check names the conflict in plain words.
test('the fork beside the target mode: addon:check refuses it, naming the slot', () => {
  const { spawnSync } = require('node:child_process'), path = require('node:path'), root = path.resolve(__dirname, '../../../..');
  const fork = spawnSync(process.execPath, [path.join(root, 'runtime/hooks/cli/check.mts'), '--with', path.join(__dirname, 'fork.ts')], { cwd: root, encoding: 'utf8' });
  assert.equal(fork.status, 1);
  assert.match(fork.stdout, /Refused achievement-hunt-fork: achievement-hunt-fork runs beside the target mode, and core:target-modes fills it: the target mode slot holds one selected entry, so both cannot be on/);
});

// The boss cut-off is two declared settings whose defaults keep the fork's list, and a lower HP
// setting makes one more monster boss-like.
test('the boss-like list is the same at the defaults, and a lower HP setting adds a monster', () => {
  assert.deepEqual([registration.settings.bossSpawns.default, registration.settings.bossHp.default], [2, 50_000]);
  const big = { id: 'big', name: 'Big', xp: 5, hp: 60_000, definition: { achievements: ladder(10) } };
  const mid = { id: 'mid', name: 'Mid', xp: 6, hp: 30_000, definition: { achievements: ladder(10) } };
  const spawns = [{ id: 'big', locations: [{ map: 'main', x: 0, y: 0 }], spawnRecords: [{ count: 1 }] },
    { id: 'mid', locations: [{ map: 'main', x: 0, y: 0 }], spawnRecords: [{ count: 1 }] }];
  const boss = (at) => monstersAt([big, mid], spawns, at, corePriority).filter(m => m.boss).map(m => m.id);
  assert.deepEqual(boss(cut), ['big']);
  assert.deepEqual(boss({ ...cut, hp: 20_000 }), ['big', 'mid']);
});

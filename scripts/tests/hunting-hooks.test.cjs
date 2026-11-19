// The hunts and farming hooks' unit rows: the rows the live table (e2e/live-hunting-hooks.spec.ts)
// cannot reach, each with its reason, plus. A live rare and the Phoenix patrol cannot be summoned on
// demand, and the counts need a planted death or escape notice. Written for the end run, not run at
// the build.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { partyHooks } = require('../../runtime/hooks/index.ts');

// One registration that hears every 07 notice for the row that plants its change. The registry
// asks only enabled add-ons, so listen switches this one on and every other add-on off.
function listen(name) {
  const heard = [];
  const notices = ['hunt.stage', 'hunt.questChanged', 'hunt.counted', 'hunt.blacklisted', 'farming.focusChanged', 'farm.relocated',
    'farming.mode', 'scatter.learned', 'rare.encounter', 'rare.patrol', 'cave.phase'];
  const result = partyHooks().register({ name, folder: 'addons', author: 'test', summary: 'Hears the hunting notices for a unit row.',
    hooks: Object.fromEntries(notices.map(hook => [hook, payload => heard.push({ hook, payload })])) });
  assert.ok(result.ok, result.message);
  partyHooks().configure({ [name]: { enabled: true } });
  return heard;
}

test('U: a planted too-hard escape counts on the target; the planted second count blacklists the target', () => {
  const heard = listen('hunting-count-fixture');
  const { recordHuntFailure } = require('../../runtime/hunting/coordinator/hunt.ts');
  const state = { huntSettings: { blacklistDeaths: true, deathThreshold: 2 }, huntFailures: {}, huntBlacklist: {} };
  // Each notice names the group whose Hunt counted it.
  assert.equal(recordHuntFailure(state, 'bee', 'deaths', 1, 100, 'party:L', 'escape'), false);
  assert.deepEqual(heard.filter(h => h.hook === 'hunt.counted').map(h => [h.payload.group, h.payload.target, h.payload.kind, h.payload.count, h.payload.threshold]),
    [['party:L', 'bee', 'escape', 1, 2]]);
  assert.equal(recordHuntFailure(state, 'bee', 'deaths', 1, 200, 'party:L'), true);
  assert.deepEqual(heard.filter(h => h.hook === 'hunt.blacklisted').map(h => [h.payload.group, h.payload.target]), [['party:L', 'bee']]);
  recordHuntFailure(state, 'bee', 'deaths', 1, 300, 'party:L');
  assert.equal(heard.filter(h => h.hook === 'hunt.blacklisted').length, 1, 'a target joins the blacklist once');
});

test("U: the add-on's order is the patrol's next region", () => {
  const { dispatch } = require('../../runtime/hooks/rows/07-hunting.ts');
  const recorded = [];
  const answer = order => dispatch({ answering: () => [{ name: 'fixture', hooks: { 'rare.search': () => order } }], settings: () => ({}),
    call: (r, hook, f) => f(), record: (...entry) => recorded.push(entry) }).search({ group: 'party', regions: ['a', 'b', 'c'], current: 'a' });
  assert.deepEqual(answer(['a', 'c', 'b']), ['a', 'c', 'b']);
  assert.equal(answer(['a', 'b', 'd']), undefined, 'an order naming another region orders nothing');
  assert.equal(answer(['a', 'b']), undefined, 'an order leaving a region out orders nothing');
});

test("U: the add-on's rare row is listed with its rule", () => {
  const { SLOTS } = require('../../runtime/hooks/rows/07-hunting.ts');
  assert.equal(SLOTS['rare-list'].section, true);
  assert.match(SLOTS['rare-list'].data, /rule fields/);
  assert.equal(SLOTS['hunt-status'].section, true);
});

test('U: a planted Fairy sighting starts and ends an encounter', () => {
  // The rare service over the shared rare fixture (fixtures/rare-hunting-scenario.cjs), which the end
  // run ports to rares.ts `createRares`: the sighting starts the encounter, and 3 s without a fresh
  // sighting before the party engages ends it `claimed`.
  const heard = listen('hunting-rare-fixture');
  const { fixture } = require('./fixtures/rare-hunting-scenario.cjs');
  const f = fixture();
  f.sight('tinyp');
  for (const s of Object.values(f.party.statuses)) s.rareSightings = [];
  f.advance(3500);
  f.controller.tick();
  const encounter = heard.filter(h => h.hook === 'rare.encounter');
  assert.deepEqual(encounter.map(h => h.payload.change), ['started', 'ended']);
  assert.equal(encounter[1].payload.code, 'claimed');
});

test('U: the patrol finishes a planted region', () => {
  // `rare.patrol` over rares.ts `createRares` with one planted Phoenix region: the leader stands away,
  // so the patrol walks a leg; at the stop a fresh observation covers every sample, and the leader's
  // next report after the walk ended finishes the region.
  const heard = listen('hunting-patrol-fixture');
  const { createRares } = require('../../runtime/hunting/coordinator/rares.ts');
  const { zones } = require('../../runtime/hunting/zones.ts');
  const { settingsWriter } = require('./helpers/settings-writer.cjs');
  let now = 100000;
  const catalog = [{ id: 'phoenix', locations: [{ map: 'main', boundary: [0, 0, 100, 100], x: 50, y: 50 }] }];
  const party = { leader: 'W', followers: {}, statuses: {}, commands: {}, monsterChoices: catalog, monsterFocus: ['phoenix'],
    targetMode: 'farming', passiveRareHunts: {}, phoenixRouteOrder: [], location: null, activeConvoy: null };
  const status = party.statuses.W = { name: 'W', ctype: 'warrior', region: 'US', server: 'II', map: 'main', in: 'main', x: 300, y: 300,
    hp: 1000, max_hp: 1000, seenAt: now, combatSelection: { runtimeId: 'r1' } };
  const observe = () => { status.seenAt = now; status.rareObservation = { at: now, runtimeId: 'r1', map: 'main', in: 'main', server: 'II',
    x: status.x, y: status.y, sightings: [] }; };
  const rares = createRares(party, { now: () => now, runs: () => true, members: () => ['W'], intent: () => ({ revision: 1 }),
    persist() {}, taskRefuses: () => false, reconcileHuntArrival() {}, routeDistance: async () => 0,
    ladder: () => ({ fail: () => null, progress() {}, rung: () => null }), write: settingsWriter(party).write, cancelConvoy() { party.activeConvoy = null; },
    convoy(location, label, names, purpose) { party.activeConvoy = { id: 'leg', location, label, purpose, phase: 'travel', participants: names }; return true; },
    group: () => 'party:W', monsters: () => ({ phoenix: { respawn: 32 } }) });
  // The navigate route writes the order before the walk starts, so the row plants it.
  party.phoenixRouteOrder = [zones(catalog, ['phoenix'])[0].id];
  rares.start();
  observe(); rares.tick();
  assert.equal(party.activeConvoy?.purpose, 'phoenix-patrol');
  Object.assign(status, { x: 100, y: 100 }); party.activeConvoy = null;
  now += 500; observe(); rares.tick();
  now += 500; observe(); rares.tick();
  assert.deepEqual(heard.filter(h => h.hook === 'rare.patrol').map(h => h.payload.change), ['leg', 'region-done']);
});

test('RARE_PROGRESS_BOUND_MS: a rare in combat whose HP sets no new low trips the bound and records it', () => {
  // The numbers rule's kept bound (bigcheck/bounds.md) over rares.ts `createRares`: the leader sees the
  // rare, so the encounter fights it; the members' reports keep its HP at one value, and once the
  // bound passes the encounter ends `no-progress` and the status owner's bound record counts the firing.
  const heard = listen('hunting-rare-progress-fixture');
  const { createRares } = require('../../runtime/hunting/coordinator/rares.ts');
  const { RARE_PROGRESS_BOUND_MS } = require('../../runtime/hunting/rules.ts');
  const { boundFirings } = require('../../runtime/status/coordinator/api.ts');
  const { migratePassiveSettings } = require('../../runtime/hunting/rules.ts');
  const { settingsWriter } = require('./helpers/settings-writer.cjs');
  const before = boundFirings().counts.RARE_PROGRESS_BOUND_MS || 0;
  let now = 100000;
  const party = { leader: 'W', followers: {}, statuses: {}, commands: {}, monsterChoices: [], monsterFocus: ['goo'], targetMode: 'farming',
    passiveHunting: migratePassiveSettings(null, { phoenix: true }), passiveRareHunts: { phoenix: true }, phoenixRouteOrder: [], location: null, activeConvoy: null };
  const status = party.statuses.W = { name: 'W', ctype: 'warrior', region: 'US', server: 'II', map: 'main', in: 'main', x: 0, y: 0,
    hp: 1000, max_hp: 1000, seenAt: now, combatSelection: { runtimeId: 'r1' } };
  const sighting = { id: 'phoenix', mtype: 'phoenix', x: 20, y: 10, hp: 5600, visible: true };
  const observe = () => { status.seenAt = now; status.rareSightings = [sighting];
    status.rareObservation = { at: now, runtimeId: 'r1', map: 'main', in: 'main', server: 'II', x: 0, y: 0, sightings: [sighting] }; };
  const rares = createRares(party, { now: () => now, runs: () => true, members: () => ['W'], intent: () => ({ revision: 1 }),
    persist() {}, taskRefuses: () => false, reconcileHuntArrival() {}, routeDistance: async () => 0,
    ladder: () => ({ fail: () => null, progress() {}, rung: () => null }), write: settingsWriter(party).write, cancelConvoy() { party.activeConvoy = null; },
    convoy() { return true; }, group: () => 'party:W', monsters: () => ({ phoenix: { respawn: 32 } }) });
  observe(); rares.report('W', status); rares.tick();
  for (let waited = 0; waited <= RARE_PROGRESS_BOUND_MS; waited += 1000) { now += 1000; observe(); rares.report('W', status); rares.tick(); }
  const encounter = heard.filter(h => h.hook === 'rare.encounter');
  assert.deepEqual(encounter.map(h => h.payload.change), ['started', 'ended']);
  assert.equal(encounter[1].payload.code, 'no-progress');
  assert.equal(boundFirings().counts.RARE_PROGRESS_BOUND_MS, before + 1);
  const entry = boundFirings().entries.at(-1); assert.equal(entry.owner, '07'); assert.equal(entry.state.hp, 5600);
});

test('the Hunt pauses for an event only through 01\'s table: no row reads a stale joinedEvent or writes paused-event', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../runtime/hunting/coordinator/hunt.ts'), 'utf8');
  assert.doesNotMatch(source, /\bjoinedEvent\b/);
  assert.doesNotMatch(source, /stage\s*=\s*['"]paused-event['"]/);
});

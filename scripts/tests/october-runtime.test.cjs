// The October runtime's rows (`cipher.plan`). They run through october/ports.ts's install,
// which builds the transfer, the merchant's class and the bag's cells that event-selections' door rows,
// built on createOctoberRuntime alone, do not have.
const test = require('node:test');
const assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { octoberScenario } = require('./fixtures/october-scenario.cjs');
const { testRegistry } = require('./helpers/test-registry.cjs');

const bag = (...names) => names.map(name => ({ name, q: 1 }));

// U row for `cipher.plan`: the Cipher seed has its own spec, so the live table cannot plant
// a round; the owner's chosen plan is announced once. The listener is an add-on, as any hearer of a
// notice is.
test("U: the owner's Cipher plan is announced", t => {
  const heard = [], hooks = testRegistry(t);
  assert.equal(hooks.register({ name: 'test-cipher-plan', folder: 'addons', author: 'test', summary: 'Hears the Cipher plan.',
    hooks: { 'cipher.plan': payload => heard.push(payload) } }).ok, true);
  hooks.configure({ 'test-cipher-plan': { enabled: true } });
  const { runtime } = octoberScenario({ plan: false });
  runtime.activity('witchcipher');
  assert.deepEqual(heard.map(h => [h.round, h.mode, h.by]), [['r1', 'brewing', 'core:events']]);
});

// (a as answered 2026-11-11, rules 1 to 4).
scenarioTable('the Cipher handoff', () => null, [
 ['a fighter keeps gathering until gather_end under a brewing plan', () => {
  const { runtime } = octoberScenario();
  const activity = runtime.activity('witchcipher');
  assert.equal(activity.kind, 'monster', 'the gathering walk, not the Witch');
  assert.deepEqual(activity.types, ['arcticbee'], "the party's scarcest ingredient's monster");
  // The walk goes to the first spawn of the type in the hunting owner's spawn catalog (the box's
  // centre).
  assert.deepEqual((({ map, x, y }) => ({ map, x, y }))(runtime.destination('witchcipher')), { map: 'winterland', x: 60, y: 120 });
 }],
 // The live gathering row's arcticbees raised frostscale to the other ingredients' 3, and the tie
 // moved both fighters to goo on main for the round's last two minutes.
 ['a fighter keeps its gathering monster when the stock it gathers ties the rest', () => {
  const { runtime } = octoberScenario({ liveStock: { verdantspore: 3, frostscale: 3, embercoal: 3, gloomfeather: 3 } });
  assert.deepEqual(runtime.activity('witchcipher').types, ['arcticbee']);
  assert.equal(runtime.destination('witchcipher').map, 'winterland');
 }],
 ['a fighter with ingredients goes to the Witch at gather_end to hand them over', () => {
  const { runtime } = octoberScenario({ now: 1000001, items: bag('frostscale') });
  assert.equal(runtime.activity('witchcipher').kind, 'interaction');
  assert.equal(runtime.destination('witchcipher').map, 'halloween', "the Witch's spot");
 }],
 // The live gathering row's warrior asked a party walk to the Witch that waited for the priest, which
 // held nothing and so never asked; it stayed at its arcticbee past gather_end.
 ['a fighter walks to the Witch alone, then hands over', async () => {
  const { runtime, walks } = octoberScenario({ now: 1000001, items: bag('frostscale') });
  await runtime.run('witchcipher', () => true);
  assert.deepEqual(walks, [{ map: 'halloween', x: 500, y: 630, alone: true }]);
 }],
 ['a fighter that handed everything over goes back to farming', () => {
  const { runtime } = octoberScenario({ now: 1000001, items: [] });
  assert.equal(runtime.activity('witchcipher'), null);
 }],
 ["the merchant leaves for the Witch at gather_end less its group's walk lead", () => {
  const early = octoberScenario({ name: 'M', ctype: 'merchant', now: 1000000 - 60001, leads: { witchcipher: 60000 } });
  assert.equal(early.runtime.activity('witchcipher'), null, 'before the lead it keeps its jobs');
  const due = octoberScenario({ name: 'M', ctype: 'merchant', now: 1000000 - 60000, leads: { witchcipher: 60000 } });
  assert.equal(due.runtime.activity('witchcipher').kind, 'interaction', 'at the lead it walks to arrive by gather_end');
  // A pending bank fetch holds the walk before its due start, and at the due start the walk goes
  // with what the bag holds, so the merchant reaches the Witch by gather_end.
  early.t.fetching = due.t.fetching = true;
  assert.equal(early.runtime.activity('witchcipher'), null, 'the walk waits for the fetch');
  assert.equal(early.runtime.snapshot().phase, 'fetching from bank');
  assert.equal(due.runtime.activity('witchcipher').kind, 'interaction', 'a pending fetch does not hold the due walk');
 }],
 ['the merchant with no affordable mix never waits at the Witch before its lead', () => {
  const { runtime } = octoberScenario({ name: 'M', ctype: 'merchant', minClues: 1000, leads: { witchcipher: 60000 } });
  assert.equal(runtime.activity('witchcipher'), null);
  assert.equal(runtime.snapshot().phase, 'waiting for gathering');
 }],
]);

// A fighter hands its ingredients to the merchant in reach on its report, one transfer at a
// time, and a death or a pending inventory command stops it.
scenarioTable('the Cipher transfer', () => null, [
 ['a report with the merchant in reach sends each ingredient stack', async () => {
  const { runtime, sends } = octoberScenario({ items: [...bag('frostscale', 'gloomfeather'), { name: 'hpot0', q: 5 }] });
  await runtime.transfer();
  assert.deepEqual(sends, [['M', 0, 1], ['M', 1, 1]]);
 }],
 ['a second transfer while one runs sends nothing', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const { runtime, sends } = octoberScenario({ items: bag('frostscale'), sendWait: () => gate });
  const first = runtime.transfer(); await runtime.transfer(); release(); await first;
  assert.equal(sends.length, 1);
 }],
 ['a dead character sends nothing', async () => {
  const { runtime, sends } = octoberScenario({ items: bag('frostscale'), rip: true });
  await runtime.transfer();
  assert.deepEqual(sends, []);
 }],
 ['a pending inventory command holds the bag', async () => {
  const { runtime, sends } = octoberScenario({ items: bag('frostscale'), inventoryCommand: true });
  await runtime.transfer();
  assert.deepEqual(sends, []);
 }],
]);

// The merchant visits no Trick or Treat door with a full bag, and resumes on the first poll with a
// free cell.
scenarioTable('Trick or Treat waits for a free cell', () => null, [
 ['a full bag waits and a freed cell visits', () => {
  const s = octoberScenario({ name: 'M', ctype: 'merchant', freeSlots: 0 });
  assert.equal(s.runtime.activity('trickortreat'), null);
  assert.equal(s.runtime.snapshot().phase, 'waiting for inventory capacity');
  s.t.freeSlots = 1;
  assert.equal(s.runtime.activity('trickortreat').kind, 'interaction');
 }],
]);

// While the round's plan is live on the merchant, the events owner claims every
// ingredient at the merchant through the items owner's `items.claim`, and the merchant's walk to the
// Witch waits while the items owner's `items.claimPending` names copies on the way.
const { cipherClaims, cipherFetching, CIPHER_CLAIMER } = require('../../runtime/events/coordinator/cipher.ts');
const merchantReport = mode => ({ eventSchedules: [{ id: 'witchcipher', cipher: { board: { id: 'r1' },
  runtime: { journal: { gathering: { round: 'r1', mode } } } } }] });
// The items owner's claim fetch on the row's own registry, standing in for the items owner:
// `pending` copies are on the way until the row sets another count.
function claimScenario(row, mode, pending) {
  const fetch = { pending };
  assert.equal(testRegistry(row).register({ name: 'test:cipher-pending', folder: 'core', author: 'test', summary: 'Answers the claim fetch.',
    hooks: { 'items.claimPending': (name, by) => by === CIPHER_CLAIMER ? fetch.pending : 0 } }).ok, true);
  return { fetch, party: { merchantCharacter: 'M', statuses: { M: merchantReport(mode) } } };
}
scenarioTable('the Cipher claim', () => null, [
 ["a stored ingredient of the plan reaches the bag before the Witch walk", (none, row) => {
  const { fetch, party } = claimScenario(row, 'brewing', 4);
  assert.deepEqual(cipherClaims(party, { character: 'M', bag: [], bank: null }).map(claim => [claim.item.name, claim.place]),
    [['verdantspore', 'merchant'], ['frostscale', 'merchant'], ['embercoal', 'merchant'], ['gloomfeather', 'merchant']]);
  // A fighter's ingredients belong at the merchant too, so the bank rule does not take them.
  assert.deepEqual(cipherClaims(party, { character: 'F', bag: [], bank: null }).map(claim => claim.place), ['merchant', 'merchant', 'merchant', 'merchant']);
  assert.equal(cipherFetching(party, 'M', 'r1'), true);
  fetch.pending = 0;
  assert.equal(cipherFetching(party, 'M', 'r1'), false, 'the bag holds them, so the walk goes');
 }],
 ['a finished plan claims nothing', (none, row) => {
  const { party } = claimScenario(row, 'finished', 0);
  assert.deepEqual(cipherClaims(party, { character: 'M', bag: [], bank: null }), []);
  assert.equal(cipherFetching(party, 'M', 'r1'), false);
 }],
]);

// The Cipher solver (october.ts) on boards of known answer. A clue's `right` counts the slots a
// mix shares with the recipe; the candidates are the 4^5 recipes every clue fits, and the
// solver's guess is an untried candidate that splits them best.
const { validMix, cipherScore, cipherCandidates, affordableMix, solveCipher, trickOrTreatRoute } = require('../../runtime/events/october.ts');
const [V, F, E, G] = ['verdantspore', 'frostscale', 'embercoal', 'gloomfeather'];
const plenty = { [V]: 5, [F]: 5, [E]: 5, [G]: 5 };
scenarioTable('the Cipher solver', () => null, [
 ['a mix is five known ingredients, and a score counts shared slots', () => {
  assert.equal(validMix([V, V, F, E, G]), true);
  assert.equal(validMix([V, V, F, E]), false, 'four slots');
  assert.equal(validMix([V, V, F, E, 'hpot0']), false, 'not an ingredient');
  assert.equal(cipherScore([V, V, F, E, G], [V, F, F, E, V]), 3);
 }],
 ['the candidates are the recipes every clue fits', () => {
  assert.equal(cipherCandidates({ board: [] }).length, 1024);
  assert.deepEqual(cipherCandidates({ board: [{ mix: [V, F, E, G, V], right: 5 }] }), [[V, F, E, G, V]]);
  assert.equal(cipherCandidates({ board: [{ mix: [V, V, V, V, V], right: 4 }] }).length, 15, 'one slot differs, three ways each');
  assert.deepEqual(cipherCandidates({ board: [{ mix: [V, V, V, V], right: 1 }] }), [], 'a malformed clue');
  assert.deepEqual(cipherCandidates({ board: [], mixes: 2 }), [], 'the board lists fewer clues than the round brewed');
 }],
 ['a mix is affordable when the stock holds each copy', () => {
  assert.equal(affordableMix([V, V, F, E, G], { [V]: 2, [F]: 1, [E]: 1, [G]: 1 }), true);
  assert.equal(affordableMix([V, V, F, E, G], { [V]: 1, [F]: 1, [E]: 1, [G]: 1 }), false);
 }],
 ['the guess is an untried candidate, and a solved board guesses nothing new', () => {
  const board = { board: [{ mix: [V, V, V, V, V], right: 4 }] };
  const guess = solveCipher(board, plenty);
  assert.equal(guess.candidates, 15);
  assert.ok(cipherCandidates(board).some(mix => mix.join() === guess.mix.join()), 'a candidate');
  assert.ok(guess.worst < 15, 'it splits the candidates');
  assert.equal(solveCipher({ board: [{ mix: [V, F, E, G, V], right: 5 }] }, plenty).mix, null, 'the only candidate is tried');
 }],
]);

// The October runtime's door route, its failed-step rerun, a brew and a brew of unknown outcome,
// on createOctoberRuntime with plain ports. The doors stand at x = 100 * id on Halloween; the
// Witch at (500, 600); the round's gathering has ended and one clue is on the board.
const { createOctoberRuntime } = require('../../runtime/events/october-runtime.ts');
function octoberRuntime(over = {}) {
  const t = { now: Date.parse('2026-10-22T12:00:00Z'), knocks: [], brews: [], doorStatus: { doors: [], doors_left: 7 }, mixes: 0,
    knock: async () => ({}), brew: async () => ({ mixes_left: 2 }), stock: { ...plenty }, ...over };
  const witch = { map: 'halloween', x: 500, y: 600 }, saved = {};
  let at = { map: 'halloween', x: 0, y: 0 };
  const board = { live: true, id: 'r1', gather_end: t.now - 1, end: t.now + 1, board: [{ mix: [V, V, V, V, V], right: 4 }], mixes: 1 };
  const runtime = createOctoberRuntime({
    now: () => t.now, realm: () => 'US I', name: () => 'M', merchant: () => true, merchantClass: () => true, freeSlots: () => 10, leads: () => null,
    settings: () => ({}), status: () => ({ halloween: true, witchcipher: board }),
    definitions: () => ({ trickortreat: { doors: Array.from({ length: 7 }, (_, id) => ['halloween', 100 * id, 0]), knocks: 7 } }),
    position: () => at, stock: () => t.stock, gathering: () => ({ owner: 'M', round: 'r1', ready: true, stock: plenty }),
    doorStatus: () => t.doorStatus, load: () => saved.journal ?? null, save: journal => { saved.journal = journal; },
    walk: async point => { at = { map: point.map, x: point.x, y: point.y - (point === witch ? 0 : 40) }; },
    knock: async door => { t.knocks.push(door); return t.knock(door); },
    info: async () => ({ mixes: t.mixes, mixes_left: 3 - t.mixes }),
    brew: async mix => { t.brews.push(mix); return t.brew(mix); },
    farmDestination: () => null, witch: () => witch, transfer: async () => {},
  });
  return { runtime, t };
}
scenarioTable('the October runtime steps', octoberRuntime, [
 ['the door route knocks every door in the route order and completes', async ({ runtime, t }) => {
  await runtime.run('trickortreat', () => true);
  assert.deepEqual(t.knocks, [...trickOrTreatRoute]);
  assert.deepEqual(runtime.snapshot().journal.doors, [...trickOrTreatRoute]);
  assert.equal(runtime.snapshot().phase, 'complete');
 }],
 ['a failed door step waits until the door status changes, then runs again', async ({ runtime, t }) => {
  t.knock = async () => { throw { reason: 'not_in_range' }; };
  await runtime.run('trickortreat', () => true);
  assert.equal(runtime.snapshot().phase, 'retry waiting');
  await runtime.run('trickortreat', () => true);
  assert.equal(t.knocks.length, 1, 'the same state runs no step');
  t.knock = async () => ({}); t.doorStatus = { doors: [], doors_left: 6 };
  await runtime.run('trickortreat', () => true);
  assert.equal(runtime.snapshot().phase, 'complete');
 }],
 ['a brew spends one mix on the solved guess and records the clue', async ({ runtime, t }) => {
  await runtime.run('witchcipher', () => true);
  assert.equal(t.brews.length, 1);
  assert.equal(runtime.snapshot().phase, 'clue received');
  assert.equal(runtime.snapshot().journal.pending, undefined);
 }],
 ['a brew of unknown outcome is never replayed: the next step reconciles it from the day count', async ({ runtime, t }) => {
  t.brew = async () => { throw { reason: 'timeout' }; };
  await runtime.run('witchcipher', () => true);
  assert.ok(runtime.snapshot().journal.pending, 'the request stays pending');
  t.mixes = 1; t.stock = { ...plenty, [V]: 4 };
  await runtime.run('witchcipher', () => true);
  assert.equal(t.brews.length, 1, 'no second brew');
  assert.equal(runtime.snapshot().journal.last.action, 'reconciled brew');
  assert.equal(runtime.snapshot().phase, 'waiting for board');
 }],
]);

// The clock's Cipher report reads the ingredients from the events owner's character facts. shared.js's
// `ingredients` port runs as written over the installed facts, on a frame with no other global.
test("the clock's ingredients port reads the events owner's character facts", () => {
  const { cipherIngredients } = require('../../runtime/events/api.ts');
  const facts = require('./helpers/character-events.cjs').installCharacterEvents({});
  const shared = require('node:fs').readFileSync('characters/shared.js', 'utf8');
  const port = shared.slice(shared.indexOf('root.installEventClock(')).match(/ingredients: (function \(\) \{[^}]*\})/)[1];
  assert.deepEqual(new Function('root', 'characterEvents', 'return ' + port)({}, facts)(), cipherIngredients);
});

// B66: v1.5.0's Cipher gathering walk took
// `eventDestination(type)`, whose scan returned the first map in G.maps with the type's spawn
// (shared.js eventDestination, `findSpawn`), so goo could route to the dungeon0 instance, which has
// no route. (v1.5.0 shared.js:479-482) and the build take the catalog's first
// location, which keeps instance, ignore and irregular maps out (areas.ts FLAGS).
test('B66: the Cipher walk to goo takes the first farm location, never an instance map', () => {
  const { spawnCatalog } = require('../../runtime/hunting/areas.ts');
  const { firstSpawn } = require('../../runtime/hunting/zones.ts');
  const game = { monsters: { goo: { name: 'Goo' } }, maps: {
    dungeon0: { name: 'Dungeon', instance: true, monsters: [{ type: 'goo', count: 4, boundary: [0, 0, 100, 100] }] },
    main: { name: 'Mainland', monsters: [{ type: 'goo', count: 6, boundary: [-200, 600, 200, 800] }] } } };
  assert.equal(firstSpawn(spawnCatalog(game, undefined, 'goo'), 'goo').map, 'main');
  // v1.5.0's scan over the same maps.
  const ryan = Object.keys(game.maps).find(map => (game.maps[map].monsters || []).some(entry => entry && entry.type === 'goo'));
  assert.equal(ryan, 'dungeon0');
});

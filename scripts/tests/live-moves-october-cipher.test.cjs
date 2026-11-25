// The Cipher merchant's inventory decisions, which left the live October spec (test-windows
// DESIGN.md 4.1, E15, E16 and E17): the live rows planted the merchant's stock and the Witch's
// board and read which mix the merchant brewed, so the decisions need no game. Each row runs the
// merchant's Cipher step (runtime/events/october-runtime.ts `cipher`) on plain ports, with the
// gathering over and the merchant at the Witch. The live part left out is the server's own brew
// reply ("right": 1 for the abundant guess), which the game decides.
const assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { createOctoberRuntime } = require('../../runtime/events/october-runtime.ts');
const { cipherIngredients } = require('../../runtime/events/october.ts');

const [V, F, E, G] = cipherIngredients;
const stockOf = counts => Object.fromEntries(cipherIngredients.map((id, i) => [id, counts[i]]));

// The merchant's runtime on one Cipher round. `stock` is its bag and the party's fresh inventory;
// `board` the round's clues; `minClues` the clue setting. The gathering ends at `now`.
function merchant({ stock, board = [], minClues = 0 }) {
  const t = { now: Date.parse('2026-10-22T12:00:00Z'), brews: [], infos: 0 };
  const witch = { map: 'halloween', x: 858, y: -120 }, saved = {};
  const round = { live: true, id: 'e2e-stock-decision', gather_end: t.now, end: t.now + 600_000, board, mixes: board.length };
  const runtime = createOctoberRuntime({
    now: () => t.now, realm: () => 'US I', name: () => 'M', merchant: () => true, merchantClass: () => true, freeSlots: () => 10, leads: () => null,
    settings: () => ({ witchcipher: { cipher: { minClues, automatic: true } } }), status: () => ({ witchcipher: round }),
    // The game's ingredient table (G.events.witchcipher.ingredients): each ingredient and the monsters that drop it.
    definitions: () => ({ witchcipher: { ingredients: [[V, ['goo']], [F, ['arcticbee']], [E, ['plantoid']], [G, ['snake']]] } }),
    position: () => witch, stock: () => stock, gathering: () => ({ owner: 'M', round: round.id, ready: true, stock }),
    doorStatus: () => null, load: () => saved.journal ?? null, save: journal => { saved.journal = journal; },
    walk: async () => {}, walkAlone: async () => {}, knock: async () => ({}),
    info: async () => { t.infos++; return { mixes: t.brews.length, mixes_left: 3 - t.brews.length }; },
    brew: async mix => { t.brews.push(mix); return { success: true, mixes_left: 2 }; },
    farmDestination: () => null, witch: () => witch, transfer: async () => {},
  });
  return { runtime, t, run: () => runtime.run('witchcipher', () => true) };
}

scenarioTable('E15 to E17: the Cipher merchant brews from its stock and the clue setting', merchant, [
  // The live row's stock held 25 verdantspore, whose mix is also the solver's first candidate on an
  // empty board, so here the abundant ingredient is embercoal: the pick then shows the preference,
  // not the candidates' order.
  ['E15: among equally informative guesses it brews the one its most abundant ingredient pays for', async ({ t, run }) => {
    await run();
    assert.deepEqual(t.brews, [Array(5).fill(E)]);
  }, { stock: stockOf([1, 1, 25, 1]) }],
  // The live row's board: the secret is five frostscale, and each clue swapped one slot for embercoal.
  ['E16: a recipe its stock cannot pay ends the round at gather_end on the shortage, with no brew', async ({ runtime, t, run }) => {
    await run();
    assert.deepEqual(t.brews, [], 'no mix is spent');
    const { mode, ingredient, monster, reason } = runtime.snapshot().journal.gathering;
    assert.deepEqual({ mode, ingredient, monster, reason }, { mode: 'finished', ingredient: F, monster: 'arcticbee', reason: 'recipe shortage' });
  }, { stock: stockOf([25, 1, 1, 1]), board: Array.from({ length: 5 }, (_, i) => ({ mix: Array.from({ length: 5 }, (_, j) => j === i ? E : F), right: 4 })) }],
  ['E17: with clues 0 it brews on an empty board', async ({ t, run }) => {
    await run();
    assert.equal(t.brews.length, 1);
  }, { stock: stockOf([5, 5, 5, 5]) }],
  ['E17: with clues 1 the empty board waits for a clue', async ({ runtime, t, run }) => {
    await run();
    assert.deepEqual(t.brews, []);
    assert.equal(runtime.snapshot().phase, 'waiting for clues');
  }, { stock: stockOf([5, 5, 5, 5]), minClues: 1 }],
]);

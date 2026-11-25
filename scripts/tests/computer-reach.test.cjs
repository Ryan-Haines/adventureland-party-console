// A carried Ancient Computer or Super Computer (G items `computer`, `supercomputer`) networks its
// carrier to the NPCs whose calls skip the distance check (node/server.js, the items owner's
// `reachesWithoutWalking` in runtime/items/rules.ts). The rows drive one real trip, a fighter's own
// potion stock-up (bank.ts `stockUp`), over bank.ts's harness; its setup is a whole character and G,
// which no existing table of the trips builds. The stand row reads the same harness's bag reads.
const assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { bankHarness } = require('./helpers/items-character.cjs');

const G = {
  items: { hpot1: { g: 25, s: 9999 }, computer: { type: 'computer', stand: 'cstand' }, supercomputer: { type: 'computer', stand: 'cstand' } },
  maps: { main: {}, bank: { mount: true } }, npcs: {},
};
function build({ items = [], slots = {}, map = 'main' } = {}) {
  const moves = [], buys = [];
  const character = { name: 'W', ctype: 'warrior', map, x: 5, y: 5, gold: 10_000, items: [...items, null, null], isize: items.length + 2, slots, bank: {} };
  const h = bankHarness({ character, G, ports: {
    findNpc: name => ({ map: 'main', x: 0, y: 0, npc: name }),
    move: async destination => { moves.push(destination); },
    buy: async (name, quantity) => { buys.push([name, quantity]); character.items[character.items.indexOf(null)] = { name, q: quantity }; },
    restockPolicy: () => ({ hp: { item: 'hpot1', min: 5, max: 20 } }),
  } });
  return { ...h, character, moves, buys };
}
const stocked = async f => { assert.equal(await f.bank.stockUp(), true); assert.deepEqual(f.buys, [['hpot1', 20]]); };

scenarioTable('a carried computer replaces the NPC walk only where the server networks the call', build, [
  ['CMP-1, CMP-7: an Ancient Computer carrier buys in place and walks nowhere, there or back', async f => {
    await stocked(f);
    assert.deepEqual(f.moves, []);
  }, { items: [{ name: 'computer' }] }],
  ['a Super Computer networks as the Ancient Computer does', async f => {
    await stocked(f);
    assert.deepEqual(f.moves, []);
  }, { items: [{ name: 'supercomputer' }] }],
  ['CMP-2: a character with no computer walks to the vendor and back', async f => {
    await stocked(f);
    assert.deepEqual(f.moves.map(move => move.npc || 'back'), ['fancypots', 'back']);
  }, {}],
  ['CMP-3: a carrier on a bank map walks, since every networked call refuses in the bank', async f => {
    await stocked(f);
    assert.equal(f.moves[0].npc, 'fancypots');
  }, { items: [{ name: 'computer' }], map: 'bank' }],
  ['CMP-4: an equipped computer networks nothing, as the server reads only the bag', async f => {
    await stocked(f);
    assert.equal(f.moves[0].npc, 'fancypots');
  }, { slots: { elixir: { name: 'computer' } } }],
  ['CMP-8: a merchant with only a computer has a stand, the cstand open_stand opens', f => {
    assert.equal(f.p.reads.standItem(), 'computer');
  }, { items: [{ name: 'computer' }] }],
]);

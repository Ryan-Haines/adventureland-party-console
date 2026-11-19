// The published reads (runtime/hooks/read-answers.ts): every READS row has a door on each side it
// names, and the installs publish them, so an add-on's ctx.read answers instead of throwing
// "has no answer".
const test = require('node:test'), assert = require('node:assert/strict');
const { run } = require('./helpers/coordinator-host.cjs');
const { createRegistry } = require('../../runtime/hooks/registry.ts');

test('every READS row has a door on each side it names', () => {
  assert.deepEqual(require('../../runtime/hooks/character-reads.ts').characterReads().missing, []);
  assert.deepEqual(require('../../runtime/hooks/coordinator-reads.ts').coordinatorReads().missing, []);
});

test("the coordinator's start publishes its reads: market.ponty and movement.npcPlace answer", async () => {
  const host = await run(1_900_000_000_000);
  const read = (name, ...args) => host.hooks.askRow(name, args);
  assert.ok(Array.isArray(read('market.ponty')));
  // Before the game data loads no map lists an NPC.
  assert.equal(read('movement.npcPlace', 'no-such-npc'), null);
});

test("the character's reads, as its install publishes them: npc.lostAndFoundList and movement.npcPlace answer", () => {
  const hooks = createRegistry();
  hooks.attach({ side: 'character', name: 'M' });
  assert.equal(hooks.publishReads(require('../../runtime/hooks/character-reads.ts').characterReads().answers).ok, true);
  const saved = globalThis.G;
  globalThis.G = { maps: { main: { npcs: [{ id: 'secondhands', position: [10, 20] }] } } };
  try {
    assert.deepEqual(hooks.askRow('npc.lostAndFoundList', []), []);
    assert.deepEqual(hooks.askRow('movement.npcPlace', ['secondhands']), { map: 'main', x: 10, y: 20 });
  } finally { globalThis.G = saved; }
});

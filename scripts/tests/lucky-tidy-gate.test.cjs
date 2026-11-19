// The merchant's tidy on a status reply (production.ts `tidyReply`). Separate: the live best-effort
// lucky rows seed an item into the locked lucky slot while the merchant stands idle, and the tidy
// moved it out before the row's upgrade read it. Failure mode: a reply with no command tidies while
// the runner holds the merchant (idle at its stand, gathering, a job), which v1.5.0
// never did (shared.js `merchantIdleActive`, `gatheringActive`, `__merchantActiveJob`).
const test = require('node:test'), assert = require('node:assert/strict');
const { productionHarness } = require('./helpers/items-character.cjs');

function merchant(held) {
  const character = { name: 'M', ctype: 'merchant', map: 'main', rip: false,
    items: [{ name: 'hpot1', q: 1 }, { name: 'mpot1', q: 1 }, null, null, { name: 'seashell', q: 3 }, null, null, null] };
  const swaps = [];
  const h = productionHarness({ character, bank: { bagStill: () => false }, ports: {
    eventReserved: () => false, standReturning: () => false, runnerRecord: () => held,
    swap: async (a, b) => { swaps.push([a, b]); [character.items[a], character.items[b]] = [character.items[b], character.items[a]]; },
  } });
  h.production.luckyReply({ luckySlotLocks: { M: 4 } });
  return { ...h, character, swaps };
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };

test('a reply with no command leaves the seeded lucky slot alone while the runner holds the merchant', async () => {
  const held = merchant(true);
  held.production.tidyReply({});
  await settle();
  assert.deepEqual(held.swaps, []);
  assert.equal(held.character.items[4]?.name, 'seashell');
  // With no holder the tidy keeps the lucky slot empty, as it did before.
  const free = merchant(false);
  free.production.tidyReply({});
  await settle();
  assert.ok(free.swaps.length > 0);
  assert.equal(free.character.items[4], null);
});

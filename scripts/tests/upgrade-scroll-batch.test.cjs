// The merchant's manual upgrade scrolls (production.ts `prepareManualImprovementScrolls`, which
// answers the plan it stocked, and `merchantImprove`) over items-character.cjs productionHarness.
// The scrolls a row starts with sit in the bag; a purchase adds to the bag's pile.
const { productionHarness, emptyCheckpoint } = require('./helpers/items-character.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');

function runtime(levels = [0, 0, 0, 0, 0], scrolls = {}) {
  const purchases = [];
  const items = [...levels.map(level => ({ name: 'wshoes', level })), ...Object.entries(scrolls).map(([name, q]) => ({ name, q })), ...Array(8).fill(null)];
  const character = { name: 'M', items, gold: 1e9, q: {} };
  const pile = name => items.findIndex(item => item?.name === name);
  // The bank holds no scrolls: its retrieval answers the bag's count.
  const onPlayer = name => items.reduce((sum, item) => sum + (item?.name === name ? item.q : 0), 0);
  const { production } = productionHarness({ character, bank: { retrieveFromBankUntil: async name => ({ onPlayer: onPlayer(name), inBank: 0 }) },
    G: { items: { wshoes: { upgrade: {} }, scroll0: { g: 1000 }, scroll1: { g: 40000 } }, skills: {} },
    ports: {
      request: emptyCheckpoint,
      // The game's upgrade: the scroll is used and the item gains a level.
      upgrade: async (slot, scroll) => {
        items[scroll] = items[scroll].q > 1 ? { ...items[scroll], q: items[scroll].q - 1 } : null;
        items[slot] = { ...items[slot], level: items[slot].level + 1 };
        return { success: true, num: slot };
      },
      grade: item => item.level >= 9 ? 2 : item.level >= 7 ? 1 : 0,
      buyConfirmed: async (name, quantity) => {
        purchases.push([name, quantity]);
        const at = pile(name);
        if (at >= 0) items[at] = { ...items[at], q: items[at].q + quantity }; else items[items.indexOf(null)] = { name, q: quantity };
      },
    } });
  return { production, character, items, purchases, command: { upgrades: levels.slice(0, 3).map(level => ({ item: { name: 'wshoes', level }, tiers: 8 - level })) } };
}

test('three requested +8 shoes stock 21 normal and one high, not all five inventory shoes', async () => {
  const { production, purchases, command } = runtime(undefined, { scroll0: 3 });
  await production.prepareManualImprovementScrolls(command, []);
  assert.deepEqual(purchases, [['scroll0', 18], ['scroll1', 1]]);
  await production.prepareManualImprovementScrolls(command, []);
  assert.equal(purchases.length, 2, 'existing stock prevents duplicate purchases');
});

test('existing high scroll is reused and never multiplied across future items', async () => {
  const { production, purchases, command } = runtime(undefined, { scroll1: 1 });
  await production.prepareManualImprovementScrolls(command, []);
  assert.deepEqual(purchases, [['scroll0', 21]]);
});

test('refill plans unfinished live levels, retaining batched normals and a single crossing scroll', async () => {
  const { production, items, command } = runtime([7, 0, 0]);
  const plan = await production.prepareManualImprovementScrolls(command, []);
  assert.equal(plan.scroll0, 14);
  assert.equal(plan.scroll1, 1);
  items[0] = null;
  const remaining = await production.prepareManualImprovementScrolls({ upgrades: command.upgrades.slice(1) }, []);
  assert.equal(remaining.scroll0, 14);
  assert.equal(remaining.scroll1, 1);
});

test('same starting grade is batched even when it is a high grade', async () => {
  const { production, command } = runtime([7, 7, 7]);
  const plan = await production.prepareManualImprovementScrolls(command, []);
  assert.equal(plan.scroll0, undefined);
  assert.equal(plan.scroll1, 3);
});

test('a partially upgraded marked item only budgets its remaining steps to the original target', async () => {
  const { production } = runtime([4]);
  const plan = await production.prepareManualImprovementScrolls({ upgrades: [
    { slot: 0, item: { name: 'wshoes', level: 0 }, tiers: 8 },
  ] }, []);
  assert.equal(plan.scroll0, 3);
  assert.equal(plan.scroll1, 1);
});

test('destroyed or missing queued ingredients do not inflate the budget', async () => {
  const { production, items, command } = runtime([0, 0, 0]);
  items[1] = null;
  items[2] = null;
  const plan = await production.prepareManualImprovementScrolls(command, []);
  assert.equal(plan.scroll0, 7);
  assert.equal(plan.scroll1, 1);
});

test('upgrade loop refills a normal batch and buys high scrolls individually at the boundary', async () => {
  const { production, items, purchases, command } = runtime([0, 0, 0]);
  await production.merchantImprove(command, []);
  assert.deepEqual(purchases, [['scroll0', 21], ['scroll1', 1], ['scroll1', 1], ['scroll1', 1]]);
  assert.equal(items.find(item => item?.name === 'scroll0'), undefined, 'no excess normals after an all-successful run');
  assert.ok(items.filter(item => item?.name === 'wshoes').every(item => item.level === 8));
});

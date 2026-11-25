// Lane I of (design/-plan.md "Lane I"): the reads the dashboard's item views take from the items
// owner's items owner, one row per fix.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const party = path.join(__dirname, '../../dashboard/features/party');

test('the dashboard and the coordinator join a copy\'s meta with one rule', () => {
  const dashboard = require(path.join(party, 'item-catalog-meta.ts'));
  const { entryMeta } = require('../../runtime/items/coordinator/api.ts');
  const known = { definition: { name: 'Ring' }, world: { set: null, usedIn: [] } };
  const catalog = { allItems: [{ id: 'ringsj', meta: known }] };
  // A live meta that names `world` with no value, as an in-process report can.
  const live = { properties: { int: 2 }, world: undefined };
  const coordinator = entryMeta(catalog, { item: { name: 'ringsj' }, meta: live });
  assert.deepEqual(dashboard.joinItemMeta(catalog, 'ringsj', live), coordinator);
  assert.equal(dashboard.joinItemMeta(catalog, 'ringsj', live), dashboard.joinItemMeta(catalog, 'ringsj', live));
  assert.equal(dashboard.joinItemMeta(catalog, 'ringsj', null), known);
});

test('the items owner answers the offered maximum, +12 for an upgrade and +7 for a compound', () => {
  const { maximumItemLevel, UPGRADE_LEVEL_MAX, COMPOUND_TARGET_MAX } = require('../../runtime/items/api.ts');
  assert.equal(maximumItemLevel({ upgrade: {} }), UPGRADE_LEVEL_MAX);
  assert.equal(maximumItemLevel({ compound: {} }), COMPOUND_TARGET_MAX);
  assert.equal(maximumItemLevel({}), 0);
});

test('the items owner answers an item\'s active automatic rules in F5 order, with the banner inputs', () => {
  const { activeRules, commerceRuleKey, ruleKey } = require('../../runtime/items/api.ts');
  const item = { name: 'ringsj', level: 1 };
  const state = { merchantCharacter: 'M', autoExchanges: { 'ringsj@1': true }, autoNpcSales: { [commerceRuleKey(item)]: { item } },
    autoUpgradeMarks: { M: { [ruleKey(item)]: { tiers: 2, quantity: 1 } }, F: { [ruleKey(item)]: 4 } },
    autoCompounds: { F: [{ name: 'ringsj', quantity: 1, targetTier: 3 }, { name: 'ringsj', quantity: 0, targetTier: 5 }] } };
  assert.deepEqual(activeRules(state, item), [{ action: 'exchange' }, { action: 'npc' }, { action: 'upgrade', tiers: 2 }]);
  // Without shared rules the bank banner asks every character holding a rule; the highest tier wins.
  assert.deepEqual(activeRules(state, item, ['M', 'F']), [{ action: 'exchange' }, { action: 'npc' },
    { action: 'upgrade', tiers: 4 }, { action: 'compound', targetTier: 3 }]);
  assert.deepEqual(activeRules({ merchantCharacter: 'M' }, item), []);
});

// The suggested value hook loaded as the page loads it, with the estimate hook answering `estimates`.
function suggestedValue(estimates) {
  const fs = require('node:fs');
  const code = require('esbuild').transformSync(fs.readFileSync(path.join(party, 'suggested-item-value.tsx'), 'utf8'), { loader: 'tsx', format: 'cjs' }).code;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', code)(m, m.exports, id => id === './upgrade-estimate' ? { useUpgradeEstimates: () => estimates }
    : id.startsWith('@/') ? require(path.join(__dirname, '../../dashboard', id.slice(2) + '.ts'))
    : id.startsWith('./') ? {} : require(path.join(party, id)));
  return m.exports.useSuggestedItemValue;
}

test('the suggested value reads the estimate\'s rate and shows its pending and unavailable states', () => {
  const { ESTIMATE_QUANTILE } = require('../../runtime/items/api.ts');
  const entry = { item: { name: 'bow', level: 2 }, meta: { upgradeable: true, definition: { g: 100 }, world: { suggestedPrices: [] } } };
  const buy = [{ id: 'bow', cost: 100, upgradeable: true, scrollCosts: [1, 2, 3, 4] }];
  const priced = suggestedValue({ buy: { status: 'available', gold: 900, attempts: 5, scrolls: [5] } })(entry, buy, []);
  assert.equal(priced.sources[0].rate, ESTIMATE_QUANTILE);
  assert.equal(priced.suggested, 900);
  assert.equal(suggestedValue({})(entry, buy, []).pending, true);
  assert.equal(suggestedValue({ buy: { status: 'unavailable', error: 'budget' } })(entry, buy, []).failure, 'budget');
  // A farm source upgrades at the catalog's scroll prices; with none it is unavailable.
  const farmed = { ...entry, meta: { ...entry.meta, world: { suggestedPrices: [{ monsterName: 'goo', suggested: 50 }] } } };
  assert.equal(suggestedValue({})(farmed, [], []).unavailable, true);
});

test('a stand sheet listing stays fresh for \'s named window and no longer', () => {
  const { marketListingFresh, MARKET_LISTING_FRESH_MS } = require('../../runtime/items/rules.ts');
  assert.equal(MARKET_LISTING_FRESH_MS, 120_000);
  assert.equal(marketListingFresh(1_000_000 - MARKET_LISTING_FRESH_MS, 1_000_000), true);
  assert.equal(marketListingFresh(1_000_000 - MARKET_LISTING_FRESH_MS - 1, 1_000_000), false);
  assert.equal(marketListingFresh(undefined, 1_000_000), false);
});

test('the + the plain upgrade gain, as the pinned client names no multiplier for it', () => {
  const { itemProperties } = require('../../dashboard/lib/game-formulas.ts');
  const meta = { upgradeable: true, definition: { armor: 10 }, scaling: { armor: 4 } };
  const at = level => itemProperties(meta, {}, level).armor;
  assert.equal(at(13) - at(12), 4);
  assert.equal(at(12) - at(11), 5);
});

// The public state carries the items owner's incompatible-rule rows, itemRuleConflicts over the
// coordinator's own state, which the dashboard draws with no reshaped copy of the BankBois.
test("the public state's incompatible-rule rows match itemRuleConflicts", () => {
  const { itemRuleConflicts, incompatibleRuleRows } = require('../../runtime/items/rules.ts');
  const { commerceRuleKey } = require('../../runtime/items/identity.ts');
  const item = { name: 'cap', level: 0 }, other = { name: 'coat', level: 0 };
  const s = { merchantCharacter: 'M', autoItemMarks: {}, autoUpgradeMarks: { M: { 'cap@+0': { tiers: 1, quantity: 1 } } }, autoCompounds: {},
    autoDeconstruction: {}, autoNpcSales: { [commerceRuleKey(item)]: { item }, [commerceRuleKey(other)]: { item: other } }, autoStandMarks: {},
    autoExchanges: {}, marked: {}, merchantMarked: {}, upgrades: {}, production: { attempts: {} }, bankbois: { B: { name: 'B', items: [] } }, merchantRules: { conflicts: [] } };
  assert.deepEqual(incompatibleRuleRows(s), [{ item, actions: itemRuleConflicts(s, item) }]);
  assert.deepEqual(incompatibleRuleRows(s)[0].actions, ['Processing', 'NPC sale']);
});

// The bank sheet and the vault unlock read one access rule and one key count, and the BankBoi grid
// draws the bag the BankBoi reports.
test('a paid, unlocked basement vault opens its floor for the sheet and the unlock alike', () => {
  const { vaultAccess, keyHeld, bagSize } = require('../../runtime/items/api.ts');
  const { createVaultUnlock } = require('../../runtime/items/coordinator/storage.ts');
  const vaults = [{ floor: 'bank_b', pack: 'items8', gold: 0 }, { floor: 'bank_b', pack: 'items9', gold: 500 }];
  const packs = { items0: [], items8: [{ item: { name: 'bkey', q: 2 } }] };
  assert.equal(vaultAccess(vaults, packs, 'bank_b'), true);
  assert.equal(vaultAccess(vaults, { items0: [] }, 'bank_b'), false);
  assert.equal(keyHeld([{ item: { name: 'bkey' } }], packs, 'bkey'), 3);
  const state = { merchantCharacter: 'M', statuses: { M: { items: [] } }, bankVaults: vaults, bankSnapshot: { packs }, merchantQueue: [], merchantCurrent: null };
  const unlock = createVaultUnlock(state, { now: () => 1, nextCommand: () => 1, enqueue: ask => { state.merchantQueue.push(ask.fields); return 'queued'; },
    log() {}, persist() {}, dispatch() {}, publicJob: job => job });
  assert.equal(unlock('items9', 'gold').body.ok, true, 'the floor is open, so the gold vault queues');
  state.bankSnapshot.packs = { items0: [] };
  assert.equal(unlock('items9', 'gold').body.error, 'unlock the bank floor first');
  assert.equal(bagSize({ inventorySize: 48 }), 48);
});
// The items owner names the Tracktrix copies once; the dashboard's pinned cell, the merchant's cleanout
// and its tracker read all take that list.
test('D-D9: every Tracktrix copy 10 names stays pinned, protected and read as a tracker', () => {
  const { TRACKER_ITEMS } = require('../../runtime/items/api.ts');
  const { compactInventory } = require('./helpers/dashboard-query-module.cjs')('compact-inventory.tsx');
  const { cleanoutProtected, isPersonalTracker } = require('../../runtime/merchant-jobs/character/visits.ts');
  assert.deepEqual([...TRACKER_ITEMS], ['tracker', 'supercomputer']);
  for (const name of TRACKER_ITEMS) {
    const entries = [null, { slot: 1, item: { name: 'hpot0' } }, { slot: 2, item: { name } }];
    assert.equal(compactInventory(entries).at(-1).item.name, name);
    assert.equal(cleanoutProtected({ name }), true); assert.equal(isPersonalTracker({ name }), true);
  }
});
// The drop rate reads the items owner's ACQUISITION steps, the ones the bag and the bestiary
// write.
test('a world, HP-scaled or chest step is a direct drop; an exchange step is not', () => {
  const { ACQUISITION } = require('../../runtime/items/api.ts');
  const { isDirectDrop } = require('./helpers/dashboard-query-module.cjs')('drop-rate.ts');
  for (const step of [ACQUISITION.worldDrop, ACQUISITION.scaledWorldDrop, ACQUISITION.open + 'goldenegg'])
    assert.equal(isDirectDrop({ acquisitionPath: [step, 'ring'] }), true, step);
  assert.equal(isDirectDrop({ acquisitionPath: ['gem0', 'ring'] }), false);
});

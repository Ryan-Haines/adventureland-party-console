// The merchant's restart, stale-state and settings rules, which left the live merchant specs
// (test-windows DESIGN.md 4.1, A2, A33, A34, M13, M55, M57 and M61): each live row planted a saved
// journal, mark, job or setting through the coordinator or the client's storage and read what the
// merchant did with it, so the rules need no game. The bank walks, buys and upgrades around them are
// ordinary merchant play, which W51 to W58 run.
const test = require('node:test'), assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { bankRuntime } = require('./helpers/bank-stacks.cjs');
const { productionHarness } = require('./helpers/items-character.cjs');
const { stackKey } = require('../../runtime/items/identity.ts');
const { reconcileNpcSales } = require('../../runtime/items/coordinator/market.ts');
const { SteamGroup } = require('../../runtime/lifecycle/roster/steam-group.ts');
const { COMMERCE_PROGRESS_VERSION, defaultMerchantAutomations } = require('../../runtime/merchant-jobs/rules.ts');
const { createRoutinePriorityRoute } = require('../../runtime/merchant-jobs/coordinator/routes.ts');
const { PROTECTED_FREE_SLOTS_DEFAULT } = require('../../runtime/items/rules.ts');

// A2: the old runner's sort journal expected the merchant's luck mark `m` to survive the bank's
// store, which drops it (bank.ts `stored`). The deposit landed; the bag cell the journal names is empty.
test('A2: a legacy bank sort journal whose deposit landed clears at the walk out and moves nothing', async () => {
  const shoes = { name: 'shoes', level: 2, l: 'l' }, identity = stackKey({ ...shoes, m: 'E2EWarrior' });
  const r = bankRuntime({ items0: [{ name: 'helmet', level: 1 }, { ...shoes }] });
  r.saved['party-bank-sort-buffer'] = [{ slot: 7, floor: 'bank', identities: [identity],
    pending: { pack: 'items0', slot: 1, inventory: 'null', bank: JSON.stringify([identity, 1]) } }];
  await r.leave();
  assert.deepEqual(r.saved['party-bank-sort-buffer'], [], 'the journal clears');
  assert.equal(r.character.map, 'main', 'the merchant leaves the bank');
  assert.deepEqual(r.calls.filter(([kind]) => kind === 'store' || kind === 'retrieve'), [], 'no copy moves');
  assert.deepEqual(r.character.bank.items0, [{ name: 'helmet', level: 1 }, shoes]);
});

// A33 and A34: a commerce order restored mid-batch whose owned helmets left their saved cells.
// The fixture is merchant-buy-cycle.test.cjs's `worker` on the items harness, with the live row's
// saved progress.
function restored(surplus) {
  const helmet = { name: 'helmet', level: 0 }, items = Array(42).fill(null), upgrades = [];
  for (const slot of [17, 18, 19, ...(surplus ? [20] : [])]) items[slot] = { ...helmet };
  const purchase = { id: 'helmet', quantity: 3, level: 1, attempts: 3, budget: 100000 };
  const command = { id: 1, jobId: 'compacted-owned-upgrade-batch', commerceProgressVersion: COMMERCE_PROGRESS_VERSION, order: { buys: [purchase] },
    resumeState: { phase: 'leveling', buyIndex: 0, attempts: 3, spent: 9600, completedResults: 0, results: [], activeItem: helmet, activeSlot: 22,
      cycleActive: true, batchItems: [{ slot: 24, item: helmet }, { slot: 25, item: helmet }], batchRemaining: 0, sequence: 2 } };
  const G = { items: { helmet: { g: 100, upgrade: true }, scroll0: { g: 1, s: 9999 } }, skills: {}, npcs: { armors: { items: ['helmet'] }, scrolls: { items: ['scroll0'] } } };
  const h = productionHarness({ character: { name: 'M', items, gold: 1e9, bank: { gold: 0 } }, G, bank: { findBankItem: () => null },
    reads: { merchantCatalog: () => ({ buyable: [], craftable: [] }) },
    ports: { job: () => ({ commandId: command.id }), grade: () => 0, move: async () => {}, protectedSlots: () => PROTECTED_FREE_SLOTS_DEFAULT,
      upgrade: async slot => { upgrades.push(slot); }, buyConfirmed: async () => {},
      request: async path => path === '/merchant/checkpoint' ? { yield: false } : {} } });
  return { items, upgrades, before: JSON.stringify(items), run: () => h.production.merchantCommerce(command) };
}
scenarioTable('A33 and A34: a restarted upgrade batch whose owned items moved holds for inventory review', restored, [
  ['A33: the owned helmets moved, so the order stops for review and upgrades nothing', async t => {
    await assert.rejects(t.run(), /requires inventory review/);
    assert.deepEqual(t.upgrades, []);
    assert.equal(JSON.stringify(t.items), t.before, 'the helmets stay where they are');
  }, false],
  ['A34: an identical surplus helmet is not adopted as the owned one', async t => {
    await assert.rejects(t.run(), /requires inventory review/);
    assert.deepEqual(t.upgrades, []);
    assert.equal(JSON.stringify(t.items), t.before);
  }, true],
]);

// M55: the restore's first reconcile is a bag change, since the marks were blocked on an earlier bag.
test('M55: an automatic sale mark missing again expires, while a manual mark and a locked automatic one stay', () => {
  const base = { source: 'merchant', slot: 20, item: { name: 'helmet', level: 0 }, quantity: 1, state: 'blocked', blockedInventory: 'an earlier bag' };
  const missing = { error: 'Marked item is not in merchant inventory', code: 'marked_missing' };
  const expired = reconcileNpcSales([{ ...base, id: 'old-auto', auto: true, ...missing }, { ...base, id: 'manual', auto: false, ...missing }], [], false, 1);
  assert.deepEqual(expired.marks.map(mark => mark.id), ['manual']);
  const locked = [{ slot: 20, item: { name: 'helmet', level: 0, l: 'l' } }];
  const kept = reconcileNpcSales([{ ...base, id: 'locked-auto', auto: true, error: 'Item is locked' }, { ...base, id: 'manual', auto: false, error: 'Marked item is not in merchant inventory' }], locked, false, 2);
  assert.equal(kept.marks.find(mark => mark.id === 'locked-auto')?.error, 'Item is locked');
  // A restart reloads the saved marks and reconciles the same bag again.
  assert.equal(reconcileNpcSales(JSON.parse(JSON.stringify(kept.marks)), locked, false, 3).marks.length, 2);
});

// M57: the merchant's stale assigned job does not decide a login; the roster's assignment does. The
// job's own expiry with no heartbeat is coordinator-merchant-recovery.test.cjs's "only the
// lifecycle owner's offline answer recovers a silent job, and a sale never replays".
test('M57: a login of the merchant that holds a headless slot answers the roster conflict', async () => {
  const group = new SteamGroup({ steam: [], native: null, slots: ['E2EMerchant', null, null], handoff: null },
    { bridgeReady: () => true, owned: () => true, now: () => 1, save() {}, validateParticipants() {}, id: () => 'op' });
  await assert.rejects(group.begin('login', 'E2EMerchant'), /Character is already assigned/);
});

// M61: the marked helmet's stat changed from dex to int after the str mark, so the mark is stale.
test('M61: a stale stat mark is resolved with no scroll applied and no stat counted', async () => {
  const item = { name: 'helmet', level: 0, stat_type: 'dex' }, completes = [], upgrades = [];
  const character = { name: 'Merchant', ctype: 'merchant', items: [{ ...item, stat_type: 'int' }, { name: 'strscroll', q: 1 }, null, null], slots: {}, bank: {}, q: {}, gold: 1000 };
  const { production } = productionHarness({ character, G: { items: { helmet: {}, strscroll: { type: 'pscroll', stat: 'str' } }, skills: {} }, ports: {
    upgrade: async (...args) => { upgrades.push(args); return { success: true }; },
    request: async (path, options) => { if (path === '/merchant/complete') completes.push(options.body); return {}; } } });
  await production.merchantSelfImprove({ jobId: 'j1', statScrolls: [{ slot: 0, item, statType: 'str', scroll: 'strscroll' }], upgrades: [] });
  const [complete] = completes;
  assert.deepEqual(complete.statScrollsResolved.map(mark => mark.statType), ['str']);
  assert.deepEqual(complete.statScrollsApplied, []);
  assert.deepEqual(upgrades, [], 'no scroll is applied');
  assert.deepEqual(character.items.slice(0, 2), [{ ...item, stat_type: 'int' }, { name: 'strscroll', q: 1 }]);
});

// M13: the routine switches the dashboard's routine list writes (merchant-jobs/coordinator/routes.ts
// `createRoutinePriorityRoute`), saved as the `merchantAutomations` field.
test('M13: the gathering tool crafting switches start off and each one saves alone', () => {
  const defaults = defaultMerchantAutomations();
  assert.deepEqual([defaults['craft fishing tools'], defaults['craft mining tools']], [false, false], 'opt in');
  const state = { priorities: {}, automations: { ...defaults }, queue: [] };
  const route = createRoutinePriorityRoute(state, { priorities: {}, automations: defaults, stamp: job => job, persist() {}, dispatch() {},
    write: batch => { for (const change of batch.changes) if (change.field === 'merchantAutomations') state.automations = change.value; return { ok: true }; } });
  const res = { status(n) { this.code = n; return this; }, json(v) { this.value = v; return v; } };
  route({ body: { priorities: {}, enabled: { 'craft fishing tools': true } } }, res);
  // A restart reloads the saved field as it was written.
  const saved = JSON.parse(JSON.stringify(state.automations));
  assert.deepEqual([saved['craft fishing tools'], saved['craft mining tools']], [true, false]);
});

// npc-orders' order list, buy rule, merchant jobs and step answers (orders.ts), and the registration.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readOrders, placeOrder, stopOrder, resumeOrder, removeOrder, nextPurchase, pontyStock, ronStock, planJob, jobEnded, stepAnswer, kindReason } = require('../orders.ts');
const { registration } = require('../index.ts');

const order = (fields = {}) => ({ id: 'a', npc: 'ponty', item: 'wbook0', level: 0, count: 3, maxPrice: 1000, ...fields });
const row = (fields = {}) => ({ key: 'k1', rid: 'r1', item: 'wbook0', level: 0, quantity: 1, unitPrice: 800, realm: 'USI', ...fields });
const listing = (fields = {}) => ({ key: 'USI-r1', rid: 'r1', item: { name: 'wbook0', level: 0 }, quantity: 1, price: 800, unitPrice: 800,
  serverRegion: 'US', serverIdentifier: 'I', ...fields });
const places = { ponty: { map: 'main', x: 10, y: 20 }, ron: { map: 'woffice', x: -24, y: -178 } };
const memory = (values = {}) => { const v = { ...values }; return { v, get: key => v[key], set: (key, value) => { v[key] = value; } }; };
const facts = (fields = {}) => ({ places, gold: 10_000, reserve: 0, listings: [listing()], ronDonate: false, ronDonation: 5000, now: 50, ...fields });
const view = (fields = {}) => ({ merchant: 'M', current: null, queued: [], ...fields });

test('the orders setting is a records setting, and readOrders keeps only rows a buy can run from', () => {
  const s = registration.settings.orders;
  assert.equal(s.kind, 'records');
  assert.deepEqual(s.default, []);
  assert.deepEqual(Object.keys(s.fields), ['id', 'npc', 'item', 'level', 'count', 'maxPrice', 'stopped']);
  assert.deepEqual(readOrders([order(), order({ maxPrice: 0 }), order({ npc: 'x' }), { npc: 'ron', item: 'ring', count: 0, maxPrice: 5 }]).map(o => o.id),
    ['a', 'ron:ring@'], 'a row with no id takes its item identity');
  assert.deepEqual(readOrders('[]'), []);
  assert.equal(registration.settings.ronDonate.default, false, 'Ron donations start refused');
});

test('one item holds one order; Stop keeps a Buy all listed and Remove drops it', () => {
  let list = placeOrder([], { npc: 'ponty', item: 'wbook0', level: 0, count: 3, maxPrice: 1000 }, 'a');
  list = placeOrder(list, { npc: 'ponty', item: 'wbook0', level: 0, count: 0, maxPrice: 900 }, 'b');
  assert.deepEqual(list.map(o => [o.id, o.count, o.maxPrice]), [['b', 0, 900]]);
  list = stopOrder(list, 'b');
  assert.equal(list[0].stopped, true);
  assert.deepEqual(removeOrder(list, 'b'), []);
});

test('the next buy is the cheapest lot under the cap that fits the copies wanted and the gold above the reserve', () => {
  const stock = [row({ rid: 'dear', unitPrice: 1200 }), row({ rid: 'big', quantity: 5, unitPrice: 100 }), row({ rid: 'ok', unitPrice: 900 }),
    row({ rid: 'cheap', unitPrice: 700 }), row({ rid: 'eu', realm: 'EUI', unitPrice: 1 })];
  assert.equal(nextPurchase(order(), stock, 10_000, 5_000).buy.rid, 'eu', 'Ponty sells on every realm');
  const us = stock.filter(r => r.realm === 'USI');
  assert.equal(nextPurchase(order(), us, 10_000, 5_000).buy.rid, 'cheap');
  assert.equal(nextPurchase(order(), us, 10_000, 5_000, 3).wait, 'Done', 'Buy 3 stops at exactly 3');
  assert.equal(nextPurchase(order(), us, 10_000, 5_000, 0, ['cheap']).buy.rid, 'ok', 'a tried lot is skipped');
  assert.equal(nextPurchase(order({ count: 0 }), us, 10_000, 5_000).buy.rid, 'big', 'Buy all takes a whole lot');
  assert.match(nextPurchase(order(), us, 5_500, 5_000).wait, /gold reserve/);
  assert.equal(nextPurchase(order(), us, null, 5_000).buy.rid, 'cheap', "unknown gold leaves the reserve to the buy's own bound");
  assert.match(nextPurchase(order({ maxPrice: 50 }), us, 10_000, 0).wait, /cap/);
  assert.match(nextPurchase(order({ count: 2 }), [row({ quantity: 5 })], 10_000, 0).wait, /more than the 2/);
  assert.equal(nextPurchase(order({ stopped: true }), us, 10_000, 0).wait, 'Stopped');
  assert.match(nextPurchase(order({ item: 'ring' }), us, 10_000, 0).wait, /None in stock/);
  assert.deepEqual(pontyStock([listing(), { rid: 'x' }]).map(r => [r.rid, r.realm, r.unitPrice]), [['r1', 'USI', 800]]);
});

test('merchant.jobKind declares Ponty, and Ron with spends only after the player ticks the donation', () => {
  const kinds = registration.hooks['merchant.jobKind'];
  assert.deepEqual(kinds({ ronDonate: false }).map(k => [k.kind, k.command, !!k.spends]), [['ponty', 'addon-steps', false]]);
  assert.deepEqual(kinds({ ronDonate: true }).map(k => [k.kind, !!k.spends]), [['ponty', false], ['ron', true]]);
});

test('Buy 2 buys two copies through two jobs and no third; the ended notice counts each done job', () => {
  const store = memory(), orders = [order({ count: 2 })], lots = [listing({ rid: 'r1' }), listing({ rid: 'r2' }), listing({ rid: 'r3' })];
  const first = planJob(view(), orders, facts({ listings: lots }), store);
  assert.deepEqual([first.kind, first.target, first.realm, first.fields.rid, first.fields.quantity], ['ponty', 'M', 'USI', 'r1', 1]);
  assert.deepEqual(first.steps, [{ walk: { to: { map: 'main', x: 10, y: 20 } } },
    { action: 'market.pontyBuy', args: { rid: 'r1' }, reason: 'npc-orders: 1 wbook0 from Ponty' }]);
  assert.equal(planJob(view(), orders, facts({ listings: lots, places: { ponty: null, ron: null } }), memory()), undefined, 'no job before the game data loads');
  assert.equal(planJob(view({ queued: [{ id: '1', reason: kindReason('ponty'), target: 'M' }] }), orders, facts({ listings: lots }), store), undefined,
    'one job of its own at a time');
  jobEnded({ kind: kindReason('ponty'), code: 'done' }, store);
  assert.deepEqual(store.v.bought, { a: 1 });
  assert.equal(planJob(view(), orders, facts({ listings: lots }), store).fields.rid, 'r2', 'the bought lot is not asked again');
  jobEnded({ kind: kindReason('ponty'), code: 'done' }, store);
  assert.equal(planJob(view(), orders, facts({ listings: lots }), store), undefined, 'no third copy');
  assert.deepEqual(store.v.bought, { a: 2 });
});

test('a failed or vanished Ponty job counts nothing and skips its lot', () => {
  const store = memory();
  planJob(view(), [order()], facts({ listings: [listing({ rid: 'r1' }), listing({ rid: 'r2', unitPrice: 900 })] }), store);
  jobEnded({ kind: kindReason('ponty'), code: 'interrupted' }, store);
  assert.equal(store.v.pending.rid, 'r1', 'a job J4 queues again stays pending');
  jobEnded({ kind: kindReason('ponty'), code: 'failed' }, store);
  assert.equal(store.v.bought, undefined);
  const next = planJob(view(), [order()], facts({ listings: [listing({ rid: 'r1' }), listing({ rid: 'r2', unitPrice: 900 })] }), store);
  assert.equal(next.fields.rid, 'r2');
  // The job never reached its end notice: the next pass drops it and skips its lot.
  assert.equal(planJob(view(), [order()], facts({ listings: [listing({ rid: 'r2', unitPrice: 900 })] }), store), undefined);
  assert.deepEqual([store.v.pending, store.v.tried], [null, ['r1', 'r2']]);
});

test('a cap under every lot or a reserve above the gold plans no job', () => {
  assert.equal(planJob(view(), [order({ maxPrice: 10 })], facts(), memory()), undefined);
  assert.equal(planJob(view(), [order()], facts({ gold: 900, reserve: 500 }), memory()), undefined);
});

test('a Ron job runs only after the player ticks the donation and presses Visit Ron', () => {
  const ron = [order({ id: 'r', npc: 'ron', item: 'ring', level: undefined })], store = memory();
  const cmd = registration.hooks['addon.command'];
  const ctx = { store: { party: store } };
  assert.equal(cmd({ owner: '', store: {}, now: 40, body: { visitRon: true } }, { ronDonate: false }, ctx).ok, false);
  assert.equal(planJob(view(), ron, facts({ ronDonate: true }), store), undefined, 'no visit asked');
  assert.equal(cmd({ owner: '', store: {}, now: 40, body: { visitRon: true } }, { ronDonate: true }, ctx).ok, true);
  assert.equal(planJob(view(), ron, facts({ ronDonate: false }), store), undefined, 'no consent');
  const job = planJob(view(), ron, facts({ ronDonate: true }), store);
  assert.deepEqual([job.kind, job.realm, job.fields], ['ron', undefined, { orders: ron }]);
  assert.deepEqual(job.steps.map(s => s.action ?? s.walk.to.map), ['woffice', 'gold.donate', 'npc.lostAndFound']);
  assert.deepEqual(job.steps[1].args, { gold: 5000 });
  assert.equal(planJob(view(), ron, facts({ ronDonate: true }), store), undefined, 'one job per press');
});

test("merchant.step closes a Ponty job, and buys Ron's listed lots one at a time under each order's cap and count", () => {
  assert.equal(registration.hooks['status.report'], undefined, 'the NPC places come from movement.npcPlace');
  assert.deepEqual(stepAnswer({ job: { id: 'j', kind: 'ponty', target: 'M', fields: {} }, done: [{ outcome: 'sent' }] }, memory(), () => [], 1), { end: 'done' });
  const orders = [order({ id: 'ring', npc: 'ron', item: 'ring', level: 0, count: 2, maxPrice: 500 }), order({ id: 'cape', npc: 'ron', item: 'cape', level: undefined, count: 0, maxPrice: 100 })];
  const job = { id: 'j', kind: 'ron', target: 'M', fields: { orders } };
  let list = [{ rid: 'a', name: 'ring', level: 0, quantity: 1, price: 400 }, { rid: 'b', name: 'ring', level: 0, quantity: 1, price: 300 },
    { rid: 'c', name: 'ring', level: 0, quantity: 1, price: 450 }, { rid: 'd', name: 'cape', level: null, quantity: 2, price: 400 }, { rid: 'e', name: 'wbook0', level: 0, quantity: 1, price: 1 }];
  const store = memory(), first = [{ action: 'walk', outcome: 'sent' }, { action: 'gold.donate', outcome: 'sent' }, { action: 'npc.lostAndFound', outcome: 'sent' }];
  const buy = (outcome = 'sent') => ({ action: 'npc.lostAndFoundBuy', outcome });
  assert.deepEqual(stepAnswer({ job, done: first }, store, () => list, 7).steps, [{ action: 'npc.lostAndFoundBuy', args: { rid: 'b' }, reason: 'npc-orders: 1 ring from Ron' }],
    'the cheapest wanted lot first; the cape lot is over its cap at 200 each');
  assert.deepEqual(store.v.ronStock, { lots: list, at: 7 });
  list = list.filter(l => l.rid !== 'b');
  assert.equal(stepAnswer({ job, done: [...first, buy()] }, store, () => list, 8).steps[0].args.rid, 'a');
  assert.deepEqual(store.v.ronBought, { ring: 1 });
  assert.equal(stepAnswer({ job, done: [...first, buy(), buy('refused')] }, store, () => list, 9).steps[0].args.rid, 'a', 'a refused buy counts nothing');
  assert.deepEqual(store.v.ronBought, { ring: 1 });
  list = list.filter(l => l.rid !== 'a');
  assert.deepEqual(stepAnswer({ job, done: [...first, buy(), buy('refused'), buy()] }, store, () => list, 10), { end: 'done' }, 'Buy 2 stops at 2');
  assert.deepEqual(store.v.ronBought, { ring: 2 });
  assert.equal(stepAnswer({ job: { ...job, kind: 'x' }, done: [] }, store, () => [], 1).end, 'failed');
  assert.deepEqual(ronStock([{ rid: 'd', name: 'cape', level: null, quantity: 2, price: 400 }]).map(r => r.unitPrice), [200]);
});

test('a paused Buy X buys nothing and resumes with its count and price', () => {
  let list = placeOrder([], { npc: 'ponty', item: 'hpbelt', count: 3, maxPrice: 50000 }, 'x');
  list = stopOrder(list, 'x');
  assert.deepEqual(nextPurchase(list[0], [], 1e9, 0), { wait: 'Stopped' });
  list = resumeOrder(list, 'x');
  assert.equal(list[0].stopped, undefined);
  assert.equal(list[0].count, 3);
  assert.equal(list[0].maxPrice, 50000);
});

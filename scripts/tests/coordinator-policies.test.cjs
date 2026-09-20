const { test } = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../../runtime/coordinator/index.ts');

test('item marks retain custom identity but ignore changing trade and quantity metadata', () => {
  const item = { name: 'leather', q: 40, p: 'shiny', custom: { serial: 2 } };
  assert.equal(policy.sameMarkedItem(item, { ...item, q: 1, price: 500, rid: 'new', b: true }), true);
  assert.equal(policy.sameMarkedItem(item, { ...item, custom: { serial: 3 } }), false);
  assert.equal(policy.sameMarkedItem(null, item), false);
  assert.equal(policy.markedItem({ slot: 3, item }), item);
  const legacy = { ...item, slot: 0.5 }; assert.equal(policy.markedItem(legacy), legacy);
});

test('legacy automatic item rules apply only to +0, with explicit level rules preferred', () => {
  const rules = { wcap: 'bank', 'wcap@+8': 'merchant' };
  assert.equal(policy.autoItemRuleMode(rules, { name: 'wcap', level: 0 }), 'bank');
  assert.equal(policy.autoItemRuleMode(rules, { name: 'wcap', level: 1 }), undefined);
  assert.equal(policy.autoItemRuleMode(rules, { name: 'wcap', level: 8 }), 'merchant');
  assert.notEqual(policy.automaticCommerceRuleKey({ name: 'wcap', level: 7 }), policy.automaticCommerceRuleKey({ name: 'wcap', level: 8 }));
});

test('collection counts occupied matching slots once across bank and merchant marks', () => {
  const entries = [{ slot: 4, item: { name: 'leather', q: 200 } }, null, { item: { name: 'coat' } }];
  const marks = [{ slot: 4, item: { name: 'leather', q: 1 } }, { name: 'leather' }, { slot: 9, item: { name: 'coat' } }];
  assert.equal(policy.collectionSlotCount(entries, marks), 1);
  marks.push({ name: 'coat' }); assert.equal(policy.collectionSlotCount(entries, marks), 2);
});

test('nearby collection requires fresh matching realm and instance, not merely map proximity', () => {
  const status = { map: 'main', server: 'USII', in: 'main', x: 0, y: 0, seenAt: 1000 };
  const target = { ...status, x: 200 };
  assert.equal(policy.merchantCollectionNearby(status, target, 16000), true);
  for (const changes of [{ server: 'USIII' }, { in: 'other' }, { x: 201 }, { rip: true }, { x: NaN }]) {
    assert.equal(policy.merchantCollectionNearby(status, { ...target, ...changes }, 16000), false);
  }
  assert.equal(policy.merchantCollectionNearby(status, target, 16001), false);
  assert.equal(policy.markedCollectionReady('marked items', target, 2, 5, false, 1000), false);
  assert.equal(policy.markedCollectionReady('marked items', target, 2, 5, true, 1000), true);
  assert.equal(policy.markedCollectionReady('marked items', target, 0, 5, true, 1000), false);
  assert.equal(policy.markedCollectionReady('manual visit', undefined, 0, 5, false, 1000), true);
});

test('storage handoffs outrank explicit priorities and live bid overrides include zero', () => {
  const priorities = { routines: { 'stand bid purchases': 40 }, bids: { leather: { priorityOverride: 0 } }, completesStorageHandoff: job => job.reason === 'manual bank exchange' };
  assert.equal(policy.merchantJobPriority({ reason: 'manual bank exchange', priorityOverride: 100 }, priorities), 101);
  assert.equal(policy.merchantJobPriority({ reason: 'Ponty purchases', bidItemId: 'leather' }, priorities), 0);
  priorities.bids.leather.priorityOverride = 90;
  assert.equal(policy.merchantJobPriority({ reason: 'Ponty purchases', bidItemId: 'leather' }, priorities), 90);
  assert.equal(policy.merchantJobPriority({ reason: 'Ponty purchases' }, priorities), 76);
});

test('exchange shortages retrieve matching BankBoi stacks once and never consume a different level', () => {
  const workers = [{ name: 'B', items: [{ slot: 0, item: { name: 'leather', q: 20 } }, { slot: 1, item: { name: 'leather', level: 1, q: 50 } }] },
    { name: 'C', items: [{ slot: 0, item: { name: 'leather', q: 30 } }] }];
  const requests = [], exchanges = [{ id: 'leather' }], shortages = [{ id: 'leather', quantity: 40 }];
  assert.equal(policy.queueExchangeStorage(exchanges, shortages, workers, requests), true);
  assert.deepEqual(requests.map(({ pack, slot }) => [pack, slot]), [['bankboi:B', 0], ['bankboi:C', 0]]);
  assert.equal(policy.queueExchangeStorage(exchanges, shortages, workers, requests), true);
  assert.equal(requests.length, 2);
  assert.equal(policy.queueExchangeStorage([], shortages, workers, requests), false);
});

test('queue selection retains FIFO ties and leaves delayed, blocked, and capacity-limited jobs queued', () => {
  const queue = [{ reason: 'a', queuedAt: 1, retryAt: 101 }, { reason: 'b', queuedAt: 2, blockedOnBankboi: true }, { reason: 'c', queuedAt: 3 }, { reason: 'd', queuedAt: 4 }];
  const selection = { now: 100, priority: () => 50, capacityBlocked: job => job.reason === 'c', collectionReady: () => true };
  assert.equal(policy.selectMerchantJob(queue, selection), 3);
  assert.equal(queue.length, 4);
  selection.capacityBlocked = () => false;
  assert.equal(policy.selectMerchantJob(queue, selection), 2);
  selection.now = 101; assert.equal(policy.selectMerchantJob(queue, selection), 0);
});

test('luck uses authoritative absence and caster ownership before persisted cast time', () => {
  const savedCast = 1000, now = 2000;
  assert.equal(policy.mluckRemaining({ name: 'P' }, 'M', savedCast, now), 3599000);
  assert.equal(policy.mluckRemaining({ name: 'P', conditions: [] }, 'M', savedCast, now), 0);
  assert.equal(policy.mluckRemaining({ name: 'P', conditions: [{ id: 'mluck', source: 'Other', remainingMs: 500 }] }, 'M', savedCast, now), 0);
  assert.equal(policy.mluckRemaining({ name: 'P', conditions: [{ id: 'mluck', source: 'M', remainingMs: 500 }] }, 'M', savedCast, now), 500);
  assert.equal(policy.mluckTravelLead({ map: 'main', x: 0, y: 0, speed: 40 }, { map: 'main', x: 400, y: 0 }), 50000);
  assert.equal(policy.mluckTravelLead({ map: 'bank' }, { map: 'main' }), 330000);
});

test('A/B keeps retained strategy without reporters and resolves unknown teams at the original deadline', () => {
  const statuses = { A: { name: 'A', map: 'abtesting', activeEventId: 'event' } };
  const pending = policy.resolveABStrategy(null, ['A', 'B'], statuses, 1000);
  assert.equal(pending.mode, 'pending');
  assert.equal(policy.resolveABStrategy(pending, ['A', 'B'], {}, 99999), pending);
  assert.equal(policy.resolveABStrategy(pending, ['A', 'B'], statuses, 20999).mode, 'pending');
  const resolved = policy.resolveABStrategy(pending, ['A', 'B'], statuses, 21000);
  assert.equal(resolved.mode, 'uniform'); assert.equal(resolved.majorityTeam, null);
  assert.equal(pending.mode, 'pending');
});

test('A/B resolves split and balanced teams without mutating the previous snapshot', () => {
  const statuses = Object.fromEntries(['A', 'B', 'C'].map((name, index) => [name, { name, map: 'abtesting', eventTeam: index < 2 ? 'red' : 'blue' }]));
  const split = policy.resolveABStrategy(null, ['A', 'B', 'C'], statuses, 1000);
  assert.equal(split.mode, 'split'); assert.deepEqual(split.sabotageNames, ['C']);
  assert.equal(policy.resolveABStrategy(null, ['A', 'C'], statuses, 1000).mode, 'balanced');
});

test('map cache preserves insertion eviction and includes only referenced available tilesets', () => {
  const geometry = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [String(index), { tiles: [['grass', 1], ['missing', 0]] }]));
  const maps = policy.createMapDefinitions(() => ({ geometry, tilesets: { grass: { file: '/grass.png' }, unused: { file: '/unused.png' } } }));
  const first = maps.get('0');
  assert.deepEqual(first.tilesets, { grass: { file: 'https://adventure.land/grass.png' } });
  for (let i = 1; i < 8; i++) maps.get(String(i));
  assert.equal(maps.get('0'), first); maps.get('8');
  assert.notEqual(maps.get('0'), first); assert.equal(maps.get('unknown'), null);
});

test('ALData serializes concurrent reservations into the twelve-request rolling window', async () => {
  let now = 0; const sleeps = [], requests = [];
  const client = policy.createALDataClient('https://fixture', {
    now: () => now, sleep: async ms => { sleeps.push(ms); now += ms; }, timeout: () => new AbortController().signal,
    fetch: async (url, options) => { requests.push({ url, options }); return new Response('{"ok":true}'); },
  });
  const results = await Promise.all(Array.from({ length: 13 }, () => client.request('/market')));
  assert.equal(results.length, 13); assert.deepEqual(sleeps, [60000]);
  assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
});

test('ALData retains rate-limit, HTTP, and empty-response semantics', async () => {
  let response;
  const client = policy.createALDataClient('https://fixture', { now: () => 0, sleep: async () => {}, timeout: () => new AbortController().signal, fetch: async () => response });
  response = new Response(null, { status: 204 }); assert.equal(await client.request('/'), null);
  response = new Response('', { status: 200 }); assert.equal(await client.request('/'), null);
  response = new Response('', { status: 429 }); await assert.rejects(client.request('/'), /ALData rate limit reached/);
  response = new Response('', { status: 503 }); await assert.rejects(client.request('/'), /ALData returned HTTP 503/);
});

test('persistence logs invalid input, preserves keys, and round-trips only the supplied snapshot', () => {
  const values = new Map([['settings', '{bad']]), errors = [];
  const store = policy.createJsonStore(values, { invalid: (key, error) => errors.push([key, error]) });
  const descriptor = { key: 'settings', empty: () => ({ enabled: false }), decode: value => value };
  assert.deepEqual(store.read(descriptor), { enabled: false }); assert.equal(errors.length, 1);
  store.write(descriptor, { enabled: true }); assert.deepEqual(store.read(descriptor), { enabled: true });
});

test('shutdown releases resources once in reverse order, continuing past failures', async () => {
  const events = [], resources = policy.createResources({ cleanupFailed: name => events.push('failed ' + name) });
  resources.add('first', () => events.push('first'));
  resources.add('second', () => { throw new Error('fixture'); });
  resources.add('last', async () => events.push('last'));
  const closing = resources.close(); assert.equal(resources.close(), closing);
  assert.throws(() => resources.add('late', () => {}), /during coordinator shutdown/);
  await closing; assert.deepEqual(events, ['last', 'failed second', 'first']);
});

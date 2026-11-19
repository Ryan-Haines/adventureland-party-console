const { test } = require('node:test');
const assert = require('node:assert/strict');
// Each row reads its owner's module: the items owner's identity, market and storage, the merchant owner's rules, owner
// and sources, the events owner's A/B testing, the status owner's streams and the settings owner's JSON store.
const { commerceRuleKey, markMatches, markedItem, ruleMode } = require('../../runtime/items/api.ts');
const { createALDataClient } = require('../../runtime/items/coordinator/market.ts');
const { queueExchangeStorage } = require('../../runtime/items/coordinator/storage.ts');
const { merchantJobPriority, selectMerchantJob } = require('../../runtime/merchant-jobs/rules.ts');
const { collectionSlotCount, markedCollectionReady, merchantCollectionNearby } = require('../../runtime/merchant-jobs/coordinator/owner.ts');
const { mluckRemaining, mluckTravelLead } = require('../../runtime/merchant-jobs/coordinator/sources.ts');
const { resolveABStrategy } = require('../../runtime/events/coordinator/api.ts');
const { createMapDefinitions } = require('../../runtime/status/coordinator/streams.ts');
const { createJsonStore } = require('../../runtime/settings/coordinator/persistence/json-store.ts');
const { ageOf } = require('../../runtime/protocol/reports.ts');

test('item marks retain custom identity but ignore changing trade and quantity metadata', () => {
  const item = { name: 'leather', q: 40, p: 'shiny', custom: { serial: 2 } };
  assert.equal(markMatches(item, { ...item, q: 1, price: 500, rid: 'new', b: true }), true);
  assert.equal(markMatches(item, { ...item, custom: { serial: 3 } }), false);
  assert.equal(markMatches(null, item), false);
  assert.equal(markedItem({ slot: 3, item }), item);
  const legacy = { ...item, slot: 0.5 }; assert.equal(markedItem(legacy), legacy);
});

test('legacy automatic item rules apply only to +0, with explicit level rules preferred', () => {
  const rules = { wcap: 'bank', 'wcap@+8': 'merchant' };
  assert.equal(ruleMode(rules, { name: 'wcap', level: 0 }), 'bank');
  assert.equal(ruleMode(rules, { name: 'wcap', level: 1 }), undefined);
  assert.equal(ruleMode(rules, { name: 'wcap', level: 8 }), 'merchant');
  assert.notEqual(commerceRuleKey({ name: 'wcap', level: 7 }), commerceRuleKey({ name: 'wcap', level: 8 }));
});

test('collection counts occupied matching slots once across bank and merchant marks', () => {
  const entries = [{ slot: 4, item: { name: 'leather', q: 200 } }, null, { item: { name: 'coat' } }];
  const marks = [{ slot: 4, item: { name: 'leather', q: 1 } }, { name: 'leather' }, { slot: 9, item: { name: 'coat' } }];
  assert.equal(collectionSlotCount(entries, marks), 1);
  marks.push({ name: 'coat' }); assert.equal(collectionSlotCount(entries, marks), 2);
});

test('nearby collection requires fresh matching realm and instance, not merely map proximity', () => {
  const status = { map: 'main', server: 'USII', in: 'main', x: 0, y: 0, seenAt: 1000 };
  const target = { ...status, x: 200 }, edge = status.seenAt + ageOf('presence');
  assert.equal(merchantCollectionNearby(status, target, edge), true);
  for (const changes of [{ server: 'USIII' }, { in: 'other' }, { x: 201 }, { rip: true }, { x: NaN }]) {
    assert.equal(merchantCollectionNearby(status, { ...target, ...changes }, edge), false);
  }
  assert.equal(merchantCollectionNearby(status, target, edge + 1), false);
  assert.equal(markedCollectionReady('marked items', target, 2, 5, false, 1000), false);
  assert.equal(markedCollectionReady('marked items', target, 2, 5, true, 1000), true);
  assert.equal(markedCollectionReady('marked items', target, 0, 5, true, 1000), false);
  assert.equal(markedCollectionReady('manual visit', undefined, 0, 5, false, 1000), true);
});

test('storage handoffs outrank explicit priorities and live bid overrides include zero', () => {
  const priorities = { routines: { 'stand bid purchases': 40 }, bids: { leather: { priorityOverride: 0 } }, completesStorageHandoff: job => job.reason === 'manual bank exchange' };
  assert.equal(merchantJobPriority({ reason: 'manual bank exchange', priorityOverride: 100 }, priorities), 101);
  assert.equal(merchantJobPriority({ reason: 'Ponty purchases', bidItemId: 'leather' }, priorities), 0);
  priorities.bids.leather.priorityOverride = 90;
  assert.equal(merchantJobPriority({ reason: 'Ponty purchases', bidItemId: 'leather' }, priorities), 90);
  assert.equal(merchantJobPriority({ reason: 'Ponty purchases' }, priorities), 76);
});

test('exchange shortages retrieve matching BankBoi stacks once and never consume a different level', () => {
  const workers = [{ name: 'B', items: [{ slot: 0, item: { name: 'leather', q: 20 } }, { slot: 1, item: { name: 'leather', level: 1, q: 50 } }] },
    { name: 'C', items: [{ slot: 0, item: { name: 'leather', q: 30 } }] }];
  const requests = [], exchanges = [{ id: 'leather' }], shortages = [{ id: 'leather', quantity: 40 }];
  assert.equal(queueExchangeStorage(exchanges, shortages, workers, requests), true);
  assert.deepEqual(requests.map(({ pack, slot }) => [pack, slot]), [['bankboi:B', 0], ['bankboi:C', 0]]);
  assert.equal(queueExchangeStorage(exchanges, shortages, workers, requests), true);
  assert.equal(requests.length, 2);
  assert.equal(queueExchangeStorage([], shortages, workers, requests), false);
});

test('queue selection retains FIFO ties and leaves delayed, blocked, and capacity-limited jobs queued', () => {
  const queue = [{ reason: 'a', queuedAt: 1, retryAt: 101 }, { reason: 'b', queuedAt: 2, blockedOnBankboi: true }, { reason: 'c', queuedAt: 3 }, { reason: 'd', queuedAt: 4 }];
  const selection = { now: 100, priority: () => 50, capacityBlocked: job => job.reason === 'c', collectionReady: () => true };
  assert.equal(selectMerchantJob(queue, selection), 3);
  assert.equal(queue.length, 4);
  selection.capacityBlocked = () => false;
  assert.equal(selectMerchantJob(queue, selection), 2);
  selection.now = 101; assert.equal(selectMerchantJob(queue, selection), 0);
});

test('luck uses authoritative absence and caster ownership before persisted cast time', () => {
  const savedCast = 1000, now = 2000;
  assert.equal(mluckRemaining({ name: 'P' }, 'M', savedCast, now), 3599000);
  assert.equal(mluckRemaining({ name: 'P', conditions: [] }, 'M', savedCast, now), 0);
  assert.equal(mluckRemaining({ name: 'P', conditions: [{ id: 'mluck', source: 'Other', remainingMs: 500 }] }, 'M', savedCast, now), 0);
  assert.equal(mluckRemaining({ name: 'P', conditions: [{ id: 'mluck', source: 'M', remainingMs: 500 }] }, 'M', savedCast, now), 500);
  assert.equal(mluckTravelLead({ map: 'main', x: 0, y: 0, speed: 40 }, { map: 'main', x: 400, y: 0 }), 50000);
  assert.equal(mluckTravelLead({ map: 'bank' }, { map: 'main' }), 330000);
});

// The strategy decides once every expected participant has reported its team.
test('A/B keeps retained strategy without reporters and resolves once the reports carry their teams', () => {
  const statuses = { A: { name: 'A', map: 'abtesting', activeEventId: 'event' } };
  const pending = resolveABStrategy(null, ['A', 'B'], statuses, 1000);
  assert.equal(pending.mode, 'pending');
  assert.equal(resolveABStrategy(pending, ['A', 'B'], {}, 99999), pending);
  assert.equal(resolveABStrategy(pending, ['A', 'B'], statuses, 99999).mode, 'pending');
  const resolved = resolveABStrategy(pending, ['A', 'B'], { A: { ...statuses.A, eventTeam: 'red' }, B: { ...statuses.A, name: 'B', eventTeam: 'red' } }, 1001);
  assert.equal(resolved.mode, 'uniform'); assert.equal(resolved.majorityTeam, 'red');
  assert.equal(pending.mode, 'pending');
});

test('A/B resolves split and balanced teams without mutating the previous snapshot', () => {
  const statuses = Object.fromEntries(['A', 'B', 'C'].map((name, index) => [name, { name, map: 'abtesting', eventTeam: index < 2 ? 'red' : 'blue' }]));
  const split = resolveABStrategy(null, ['A', 'B', 'C'], statuses, 1000);
  assert.equal(split.mode, 'split'); assert.deepEqual(split.sabotageNames, ['C']);
  assert.equal(resolveABStrategy(null, ['A', 'C'], statuses, 1000).mode, 'balanced');
});

test('map cache keeps each catalog map until the catalog changes and includes only referenced available tilesets', () => {
  const geometry = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [String(index), { tiles: [['grass', 1], ['missing', 0]] }]));
  let catalog = { geometry, tilesets: { grass: { file: '/grass.png' }, unused: { file: '/unused.png' } } };
  const maps = createMapDefinitions(() => catalog);
  const first = maps.get('0');
  assert.deepEqual(first.tilesets, { grass: { file: 'https://adventure.land/grass.png' } });
  for (let i = 1; i < 9; i++) maps.get(String(i));
  assert.equal(maps.get('0'), first);
  catalog = { ...catalog };
  assert.notEqual(maps.get('0'), first); assert.equal(maps.get('unknown'), null);
});

// No request waits before a 429; after one, the next waits its retry-after. A 429
// with no retry-after waits ALData's 60 s window and counts one bound firing.
test("ALData waits the 429 reply's retry-after and no fixed window", async () => {
  const { boundFirings } = require('../../runtime/status/coordinator/api.ts');
  let now = 0, limited = { 'retry-after': '7' }; const sleeps = [], requests = [];
  const client = createALDataClient('https://fixture', {
    now: () => now, sleep: async ms => { sleeps.push(ms); now += ms; },
    fetch: async (url, options) => { requests.push({ url, options });
      return limited ? new Response('', { status: 429, headers: limited }) : new Response('{"ok":true}'); },
  });
  await assert.rejects(client.request('/market'), /ALData rate limit reached/); limited = null;
  const results = await Promise.all(Array.from({ length: 13 }, () => client.request('/market')));
  assert.equal(results.length, 13); assert.deepEqual(sleeps.slice(0, 1), [7000]); assert.equal(now, 7000);
  assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
  const before = boundFirings().counts.ALDATA_RATE_WINDOW_MS || 0;
  limited = {}; await assert.rejects(client.request('/market'), /ALData rate limit reached/); limited = null;
  await client.request('/market');
  assert.deepEqual(sleeps.slice(1), [60000]); assert.equal(boundFirings().counts.ALDATA_RATE_WINDOW_MS, before + 1);
  // An HTTP-date retry-after waits until that date; an unreadable one waits the window.
  const seconds = 5; limited = { 'retry-after': new Date(now + seconds * 1e3).toUTCString() }; await assert.rejects(client.request('/market')); limited = null;
  await client.request('/market'); assert.equal(sleeps.at(-1), seconds * 1e3);
  limited = { 'retry-after': 'soon' }; await assert.rejects(client.request('/market')); limited = null;
  await client.request('/market'); assert.equal(sleeps.at(-1), sleeps[1], 'the same window as the headerless 429');
});

test('ALData retains rate-limit, HTTP, and empty-response semantics', async () => {
  let response;
  const client = createALDataClient('https://fixture', { now: () => 0, sleep: async () => {}, fetch: async () => response });
  response = new Response(null, { status: 204 }); assert.equal(await client.request('/'), null);
  response = new Response('', { status: 200 }); assert.equal(await client.request('/'), null);
  response = new Response('', { status: 429 }); await assert.rejects(client.request('/'), /ALData rate limit reached/);
  response = new Response('', { status: 503 }); await assert.rejects(client.request('/'), /ALData returned HTTP 503/);
});

// The kept bound: ALData that never answers ends at
// aldataRequestBoundMs, the request fails, and the status owner's bound record counts the firing.
test('aldataRequestBoundMs: an ALData request that never answers trips the bound and records it', async () => {
  const { itemsSavedFields } = require('../../runtime/items/saved-fields.ts');
  const { boundFirings } = require('../../runtime/status/coordinator/api.ts');
  const field = itemsSavedFields.settings.aldataRequestBoundMs, saved = field.default; field.default = 50;
  const before = boundFirings().counts.aldataRequestBoundMs || 0;
  try {
    const client = createALDataClient('https://fixture', { now: () => 0, sleep: async () => {},
      fetch: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason))) });
    await assert.rejects(client.request('/merchants'));
    assert.equal(boundFirings().counts.aldataRequestBoundMs, before + 1);
    const entry = boundFirings().entries.at(-1); assert.equal(entry.owner, '10'); assert.equal(entry.subject, '/merchants');
  } finally { field.default = saved; }
});

test('persistence logs invalid input and falls back to the empty value', () => {
  const values = new Map([['settings', '{bad']]), errors = [];
  const store = createJsonStore(values, { invalid: (key, error) => errors.push([key, error]) });
  const descriptor = { key: 'settings', empty: () => ({ enabled: false }), decode: value => value };
  assert.deepEqual(store.read(descriptor), { enabled: false }); assert.equal(errors.length, 1);
});

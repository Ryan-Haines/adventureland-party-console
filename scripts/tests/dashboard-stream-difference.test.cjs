const { test } = require('node:test');
const assert = require('node:assert/strict');
const stream = require('../../runtime/coordinator/telemetry/dashboard-stream.ts');
const { httpFixture } = require('./helpers/coordinator-http.cjs');
const { compactEntry } = require('../../runtime/coordinator/telemetry/public-state-characters.ts');

// Failure inventory: docs/efficiency.md, Character threads follow-ups, H3.
// The stream's field rule before H3: a field changed when its JSON text changed.
function reference(before, after) {
  const result = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) result[key] = after[key] ?? null;
  return result;
}
const message = (fn) => { try { return { value: fn() }; } catch (error) { return { error: error.constructor.name }; } };
function same(before, after) {
  const expected = message(() => reference(before, after)), actual = message(() => stream.difference(before, after));
  assert.deepEqual(Object.keys(actual.value || {}), Object.keys(expected.value || {}), require('node:util').inspect({ before, after }));
  assert.deepEqual(actual, expected);
}

const shared = { name: 'coat', level: 3 };
const values = [
  undefined, null, 0, -0, 1, 1.5, -1, NaN, Infinity, -Infinity, 1e21, '', '0', '1', 'null', 'a☃\ud800', true, false,
  () => 1, Symbol('s'), [], [undefined], [null], [() => 1], [1, 2], [2, 1], [1, [2]], [1, [3]], new Array(2), {}, { a: 1 },
  { a: 1, b: 2 }, { b: 2, a: 1 }, { a: undefined }, { a: () => 1 }, { a: null }, { a: NaN }, { 1: 'x', a: 'y' },
  { a: { b: [1, { c: 2 }] } }, { a: { b: [1, { c: 3 }] } }, new Date(5), new Date(6), { toJSON: () => 'x' }, { toJSON: () => undefined },
  { a: { toJSON: () => undefined } }, { a: new Date(5) }, new Map([[1, 2]]), new Set([1]), Object.create(null), Object.assign(Object.create(null), { a: 1 }),
  new Number(1), new String('1'), new Boolean(false), shared, { ...shared }, { item: shared, q: 1 }, { item: { ...shared }, q: 1 },
  Object.defineProperty({}, 'hidden', { value: 1, enumerable: false }), Object.defineProperty({ a: 1 }, 'g', { get: () => 2, enumerable: true }),
];

test('a field changes exactly when its JSON text changes, for every value pair', () => {
  for (const a of values) for (const b of values) same({ k: a }, { k: b });
});

test('added, removed and reordered fields keep the reference key order', () => {
  same({ a: 1, b: 2 }, { b: 2, c: 3 });
  same({ b: 1, a: 1 }, { a: 2, c: 1, b: 2 });
  same({ 2: 'x', 10: 'y', a: 1 }, { 1: 'z', 10: 'y', a: 2 });
  same({ a: undefined }, {});
  same({}, { a: null });
  same({ a: [{ q: 1 }, null] }, { a: [{ q: 1 }, null], z: 1 });
});

test('values that JSON.stringify rejects still throw', () => {
  same({ a: 1n }, { a: 1n });
  const cycle = { name: 'x' }; cycle.self = cycle;
  const other = { name: 'x' }; other.self = other;
  same({ a: cycle }, { a: other });
  same({ a: { deep: cycle } }, { a: { deep: other } });
});

test('a random walk over nested inventory-shaped records matches the reference', () => {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = list => list[Math.floor(random() * list.length)];
  const leaf = () => pick([null, undefined, 0, 1, NaN, 'goo', 'coat', true, [1], { q: 2 }, [null, 1]]);
  const entry = depth => depth > 2 || random() < 0.3 ? leaf() :
    Object.fromEntries(Array.from({ length: 1 + Math.floor(random() * 3) }, () => [pick(['item', 'meta', 'q', 'p', 'level', '0', '7']), entry(depth + 1)]));
  let before = {};
  for (let step = 0; step < 3000; step++) {
    const after = { ...before };
    for (let n = Math.floor(random() * 4); n >= 0; n--) {
      const key = pick(['0', '1', '2', 'hp', 'conditions', 'target', '41']);
      if (random() < 0.15) delete after[key]; else after[key] = random() < 0.5 && key in before ? structuredClone(before[key] ?? null) : entry(0);
    }
    same(before, after);
    before = after;
  }
});

function fixture(items) {
  const http = httpFixture();
  const statuses = { A: { name: 'A', dashboardRuntime: 'r1', hp: 100, mp: 50, x: 1, y: 2, map: 'main',
    conditions: [{ id: 'buff', remainingMs: 9950 }],
    items: Array.from({ length: items }, (_, slot) => ({ slot, item: { name: 'coat', level: slot % 7, q: 1 }, meta: { sprite: 'coat', definition: { name: 'Coat' } } })),
    slots: { mainhand: { slot: 'mainhand', item: { name: 'blade', level: 8 }, meta: { sprite: 'blade' } } } } };
  const live = stream.createDashboardStream({ now: () => 1000, statuses: () => statuses, active: name => !!statuses[name],
    every: () => ({}), cancel: () => {} });
  live.install(http.router);
  return { http, live, statuses };
}
function serializations(fn) {
  const original = JSON.stringify;
  let objects = 0;
  JSON.stringify = function (value, ...rest) { if (value && typeof value === 'object') objects++; return original.call(this, value, ...rest); };
  try { fn(); } finally { JSON.stringify = original; }
  return objects;
}

test('a status report with an unchanged 42-slot inventory serializes no field', () => {
  const f = fixture(42);
  f.live.lease('A');
  f.statuses.A = { ...f.statuses.A, hp: 99, items: f.statuses.A.items.map(entry => structuredClone(entry)), slots: structuredClone(f.statuses.A.slots) };
  assert.equal(serializations(() => f.live.lease('A')), 0);
});

test('the stream sends the same deltas and sequence numbers for status reports', () => {
  const f = fixture(4), client = f.http.invoke('GET', '/party-api/dashboard-stream');
  const changes = [
    status => ({ ...status, hp: 90 }),
    status => ({ ...status }),
    status => ({ ...status, items: status.items.map((entry, slot) => slot === 2 ? { ...entry, item: { ...entry.item, q: 5 } } : structuredClone(entry)) }),
    status => ({ ...status, items: status.items.slice(0, 3) }),
    status => ({ ...status, conditions: [{ id: 'buff', remainingMs: 8950 }] }),
    status => ({ ...status, conditions: [{ id: 'buff', remainingMs: 8900 }] }),
    status => ({ ...status, target: 'goo', slots: {} }),
  ];
  for (const change of changes) { f.statuses.A = change(f.statuses.A); f.live.lease('A'); }
  const sent = client.response.chunks.map(chunk => JSON.parse(chunk.slice(6))).map(({ epoch, ...rest }) => rest);
  assert.deepEqual(sent.map(m => [m.type, m.sequence]), [['snapshot', 1], ['delta', 2], ['delta', 3], ['delta', 4], ['delta', 5], ['delta', 6]]);
  assert.deepEqual(sent.slice(1).map(m => [m.characters.A.vitals, m.characters.A.items, m.characters.A.slots]), [
    [{ hp: 90 }, {}, {}],
    [{}, { 2: JSON.parse(JSON.stringify(compactEntry({ slot: 2, item: { name: 'coat', level: 2, q: 5 }, meta: { sprite: 'coat', definition: { name: 'Coat' } } }))) }, {}],
    [{}, { 3: null }, {}],
    [{ conditions: [{ id: 'buff', remainingMs: 9000 }] }, {}, {}],
    [{ target: 'goo' }, {}, { mainhand: null }],
  ]);
  client.request.close();
});

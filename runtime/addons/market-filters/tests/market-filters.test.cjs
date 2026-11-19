// The filter bar's row test, its order and its control. The control renders through
// react-test-renderer with the ui kit's components as tags named after their export, the way the
// dashboard's own slot tests draw a piece.
const test = require('node:test');
const assert = require('node:assert/strict');
const { keep, order, normalize, parsePrice, parseLevel, servers, grades } = require('../filters.ts');
const { load, dashboardRequire } = require('../../../../scripts/tests/helpers/dashboard-query-module.cjs');
const React = dashboardRequire('react');
const { create, act } = dashboardRequire('react-test-renderer');

const tags = new Proxy({}, { get: (_, key) => String(key) });
const rows = [
  { item: 'bow', level: 7, grade: 1, price: 2_000_000, seen: 2, realm: 'US I' },
  { item: 'bow', level: 3, grade: 0, price: 90_000, seen: 3, realm: 'EU I' },
  { item: 'seashell', grade: 0, price: 4_000, seen: 1, realm: 'US I' },
];
const named = (row) => `${row.item}${row.level ?? ''}`;
const kept = (value) => rows.filter((row) => keep(row, value)).map(named);

test('an unset or empty value keeps every row', () => {
  assert.deepEqual(kept(undefined), ['bow7', 'bow3', 'seashell']);
  assert.deepEqual(kept({}), ['bow7', 'bow3', 'seashell']);
  assert.equal(normalize({ minLevel: undefined, server: '', newest: false }), undefined);
});

test('each bound narrows the rows, and the bounds combine', () => {
  assert.deepEqual(kept({ minLevel: 5 }), ['bow7']);
  // A seashell takes no upgrade, so a level bound reads it as level 0.
  assert.deepEqual(kept({ maxLevel: 3 }), ['bow3', 'seashell']);
  assert.deepEqual(kept({ maxPrice: 100_000 }), ['bow3', 'seashell']);
  assert.deepEqual(kept({ minPrice: 50_000 }), ['bow7', 'bow3']);
  assert.deepEqual(kept({ server: 'US I' }), ['bow7', 'seashell']);
  assert.deepEqual(kept({ server: 'US I', maxPrice: 10_000 }), ['seashell']);
  // A Classifieds row has no realm, so a server bound drops it.
  assert.equal(keep({ item: 'bow', price: 1 }, { server: 'US I' }), false);
});

test('a tier keeps only rows of that grade, and grade 0 is a bound', () => {
  assert.deepEqual(kept({ grade: 0 }), ['bow3', 'seashell']);
  assert.deepEqual(kept({ grade: 1 }), ['bow7']);
  assert.deepEqual(kept({ grade: 1, server: 'EU I' }), []);
  assert.deepEqual(normalize({ grade: 0 }), { grade: 0 });
  assert.equal(keep({ item: 'bow' }, { grade: 0 }), false);
});

test('prices read the Market shorthand and levels read whole numbers', () => {
  assert.equal(parsePrice('250k'), 250_000);
  assert.equal(parsePrice('1.5M'), 1_500_000);
  assert.equal(parsePrice('1,200'), 1_200);
  assert.equal(parsePrice('1.'), undefined);
  assert.equal(parsePrice('cheap'), undefined);
  assert.equal(parseLevel(' 8 '), 8);
  assert.equal(parseLevel('8.5'), undefined);
});

test('servers and grades list each value once, in order', () => {
  assert.deepEqual(servers(rows), ['EU I', 'US I']);
  assert.deepEqual(servers([{ item: 'bow' }]), []);
  assert.deepEqual(grades(rows), [0, 1]);
  assert.deepEqual(grades([{ item: 'bow' }]), []);
});

test('Newest first sorts by seen time with an unseen row last, and leaves the order alone otherwise', () => {
  const sorted = (value) => [...rows, { item: 'unseen' }].sort((a, b) => order(a, b, value)).map(named);
  assert.deepEqual(sorted({ newest: true }), ['bow3', 'bow7', 'seashell', 'unseen']);
  assert.deepEqual(sorted({ maxPrice: 10 }), ['bow7', 'bow3', 'seashell', 'unseen']);
  // The Classifieds tab stamps every row with one time, so its rows tie.
  assert.equal(order({ item: 'a', seen: 5 }, { item: 'b', seen: 5 }, { newest: true }), 0);
  assert.equal(order({ item: 'a' }, { item: 'b' }, { newest: true }), 0);
});

const { dashboard, MarketFilterBar } = load('../../../runtime/addons/market-filters/dashboard.tsx', { '@/components/ui/*': tags, 'lucide-react': tags });

test('the add-on fills the list-view slot of all four Market tabs with one bar, its keep and its order', () => {
  assert.deepEqual(Object.keys(dashboard.pieces), ['list-view']);
  const pieces = dashboard.pieces['list-view'];
  assert.deepEqual(Object.keys(pieces), ['market:wts', 'market:wtb', 'market:classifieds', 'market:ponty']);
  for (const piece of Object.values(pieces)) {
    assert.equal(piece.control, MarketFilterBar);
    assert.equal(piece.keep(rows[0], { grade: 1 }), true);
    assert.equal(piece.order(rows[0], rows[1], { newest: true }) > 0, true);
  }
});

async function bar(props) {
  let view;
  await act(async () => { view = create(React.createElement(MarketFilterBar, { part: 'market:wts', rows, settings: {}, ...props })); });
  return view;
}
const input = (view, label) => view.root.find((node) => node.type === 'Input' && node.props['aria-label'] === label);
const select = (view, label) => view.root.find((node) => node.type === 'select' && node.props['aria-label'] === label);
const button = (view, text) => view.root.find((node) => node.type === 'Button' && [].concat(node.props.children).join('').trim() === text);

test('the bar sets the tab value as the player types, and Clear sets it back to unset', async () => {
  const sets = [];
  let value;
  const set = (next) => { sets.push(next); value = next; };
  const view = await bar({ value, set });
  assert.equal(view.root.findAll((node) => node.type === 'Input' && /search/i.test(node.props.placeholder ?? '')).length, 0);
  assert.deepEqual(select(view, 'Server').findAllByType('option').map((node) => node.props.value), ['', 'EU I', 'US I']);
  assert.deepEqual(select(view, 'Tier').findAllByType('option').map((node) => node.props.children), ['Any tier', 'Normal', 'High']);
  await act(async () => input(view, 'Lowest level').props.onChange({ target: { value: '5' } }));
  await act(async () => input(view, 'Highest price, such as 250k or 1.5m').props.onChange({ target: { value: '3m' } }));
  await act(async () => select(view, 'Tier').props.onChange({ target: { value: '0' } }));
  await act(async () => button(view, 'Newest first').props.onClick());
  assert.deepEqual(sets.at(-1), { minLevel: 5, maxPrice: 3_000_000, grade: 0, newest: true });
  await act(async () => view.update(React.createElement(MarketFilterBar, { part: 'market:wts', rows, settings: {}, value, set })));
  assert.equal(button(view, 'Newest first').props['aria-pressed'], true);
  await act(async () => button(view, 'Clear').props.onClick());
  assert.equal(sets.at(-1), undefined);
  assert.equal(input(view, 'Lowest level').props.value, '');
  assert.equal(button(view, 'Newest first').props['aria-pressed'], false);
  view.unmount();
});

test('the bar draws the value the slot already holds when the player comes back to the tab', async () => {
  const view = await bar({ value: { minLevel: 2, server: 'EU I', grade: 1, newest: true }, set() {} });
  assert.equal(input(view, 'Lowest level').props.value, '2');
  assert.equal(select(view, 'Server').props.value, 'EU I');
  assert.equal(select(view, 'Tier').props.value, '1');
  assert.equal(button(view, 'Newest first').props['aria-pressed'], true);
  view.unmount();
});

test('a tab whose rows carry no realm and no grade draws no server or tier choice', async () => {
  const view = await bar({ part: 'market:classifieds', rows: [{ item: 'bow', price: 5 }], set() {} });
  assert.equal(view.root.findAll((node) => node.type === 'select').length, 0);
  view.unmount();
});

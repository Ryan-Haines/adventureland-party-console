const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('../../dashboard/node_modules/react');
const { create, act } = require('../../dashboard/node_modules/react-test-renderer');
const { createRequire } = require('node:module');
const dashboardRequire = createRequire(require('node:path').resolve('dashboard/package.json'));
const { QueryClientProvider } = dashboardRequire('@tanstack/react-query');
const load = require('./helpers/dashboard-query-module.cjs');
const { createDashboardClient } = load('query-cache.tsx');
const { useCharacterData, characterKey } = load('dashboard-live.tsx');
const { usePanelModel } = load('use-panel-model.ts');
global.IS_REACT_ACT_ENVIRONMENT = true;

test('React vitals subscriptions isolate other cards and the inventory subscription; unchanged values do not commit', async (t) => {
  const previousDocument = global.document;
  global.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  t.after(() => { if (previousDocument === undefined) delete global.document; else global.document = previousDocument; });
  const client = createDashboardClient();
  const names = ['A', 'B', 'C', 'D'], counts = { A: 0, B: 0, C: 0, D: 0, inventory: 0 };
  const model = { state: { characters: Object.fromEntries(names.map(name => [name, { name, ctype: 'priest' }])), marked: {} }, chars: names.map(name => ({ name })) };
  for (const name of names) {
    client.setQueryData(characterKey(name, 'vitals'), { hp: 100 });
    client.setQueryData(characterKey(name, 'inventory'), { items: [], slots: {} });
  }
  function Card({ name }) { const value = useCharacterData(name, 'vitals'); counts[name]++; return React.createElement('span', null, value.hp); }
  function Inventory() { const value = usePanelModel(model, { inventory: true }); counts.inventory++; return React.createElement('span', null, value.chars[0].items.length); }
  let tree;
  await act(async () => { tree = create(React.createElement(QueryClientProvider, { client }, ...names.map(name => React.createElement(Card, { key: name, name })), React.createElement(Inventory))); });
  const before = { ...counts };
  await act(async () => { client.setQueryData(characterKey('A', 'vitals'), { hp: 50 }); await new Promise(done => setTimeout(done, 5)); });
  assert.equal(counts.A, before.A + 1);
  for (const name of ['B', 'C', 'D', 'inventory']) assert.equal(counts[name], before[name], name + ' did not render for A HP');
  const after = { ...counts };
  await act(async () => { client.setQueryData(characterKey('A', 'vitals'), { hp: 50 }); client.setQueryData(characterKey('A', 'inventory'), { items: [], slots: {} }); await new Promise(done => setTimeout(done, 5)); });
  assert.deepEqual(counts, after);
  await act(async () => tree.unmount()); client.clear();
});

test('map consumers share reads, release closed observers, pause hidden tabs and never show the previous map', async () => {
  const { useMapDefinition } = load('query-cache.tsx');
  const client = createDashboardClient(); client.setQueryData(['party', 'core'], { referenceRevision: 'r1' });
  const previousDocument = global.document, previousFetch = global.fetch;
  const document = new EventTarget(); document.hidden = false; global.document = document;
  let calls = 0, finish; const shown = [];
  global.fetch = async url => {
    calls++;
    if (String(url).includes('/cave')) return new Promise(resolve => { finish = resolve; });
    return { ok: true, status: 200, json: async () => ({ name: 'main' }) };
  };
  function Maps({ open, map }) { const query = useMapDefinition(map, open); shown.push(query.data?.name); return null; }
  const render = (open, map) => React.createElement(QueryClientProvider, { client },
    React.createElement(Maps, { open, map }), React.createElement(Maps, { open, map }));
  let tree;
  try {
    await act(async () => { tree = create(render(true, 'main')); await new Promise(done => setTimeout(done, 10)); });
    assert.equal(calls, 1);
    await act(async () => tree.update(render(true, 'cave')));
    assert.equal(shown.at(-1), undefined, 'no previous map placeholder');
    await act(async () => { finish({ ok: true, status: 200, json: async () => ({ name: 'cave' }) }); await new Promise(done => setTimeout(done, 5)); });
    await act(async () => tree.update(render(false, 'cave')));
    assert.equal(client.getQueryCache().find({ queryKey: ['party', 'reference', 'r1', 'map', 'cave'] }).getObserversCount(), 0);
    await act(async () => { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); tree.update(render(true, 'new-map')); });
    assert.equal(calls, 2, 'hidden tab starts no map read');
  } finally {
    if (tree) await act(async () => tree.unmount()); client.clear(); global.document = previousDocument; global.fetch = previousFetch;
  }
});

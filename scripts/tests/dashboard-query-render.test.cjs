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

test('panel merges retain unchanged characters and handle roster and subscription changes', async () => {
  const client = createDashboardClient();
  let latest, tree;
  let model = { state: { characters: { A: { name: 'A' }, B: { name: 'B' } }, marked: {} }, chars: [{ name: 'A' }, { name: 'B' }] };
  let needs = { inventory: true };
  client.setQueryData(characterKey('A', 'inventory'), { items: [], slots: {} });
  client.setQueryData(characterKey('B', 'inventory'), { items: [], slots: {} });
  function Panel() { latest = usePanelModel(model, needs); return null; }
  const render = () => React.createElement(QueryClientProvider, { client }, React.createElement(Panel));
  try {
    await act(async () => { tree = create(render()); });
    const first = latest;
    await act(async () => tree.update(render()));
    assert.equal(latest.state, first.state);
    assert.equal(latest.chars, first.chars);
    await act(async () => {
      client.setQueryData(characterKey('A', 'inventory'), { items: [{ slot: 0, item: { name: 'coat' } }], slots: {} });
      await new Promise(resolve => setTimeout(resolve, 5));
    });
    assert.notEqual(latest.state.characters.A, first.state.characters.A);
    assert.equal(latest.state.characters.B, first.state.characters.B);
    needs = { vitals: true };
    client.setQueryData(characterKey('A', 'vitals'), { hp: 42 });
    await act(async () => tree.update(render()));
    assert.equal(latest.state.characters.A.hp, 42);
    assert.equal(latest.state.characters.A.items, undefined);
    model = { ...model, state: { ...model.state, characters: { A: model.state.characters.A } }, chars: [{ name: 'A' }] };
    await act(async () => tree.update(render()));
    assert.deepEqual(Object.keys(latest.state.characters), ['A']);
    assert.equal(latest.chars.length, 1);
  } finally { if (tree) await act(async () => tree.unmount()); client.clear(); }
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

// 12-3 cause 3: a failed reference read reruns on the next core answer, once; a second failure
// under the same reference revision waits for the revision to change.
test('a failed reference read retries on the next core answer and then waits', async () => {
  const { useQuery } = dashboardRequire('@tanstack/react-query');
  const { useReferenceRetry, key } = load('query-cache.tsx');
  const client = createDashboardClient();
  let reads = 0, tree;
  function Reader() {
    const query = useQuery({ queryKey: ['party', 'reference', 'r1', 'map'], retry: false,
      queryFn: async () => { reads++; throw new Error('not ready'); } });
    useReferenceRetry(query);
    return null;
  }
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  try {
    await act(async () => { tree = create(React.createElement(QueryClientProvider, { client }, React.createElement(Reader))); });
    await settle();
    assert.equal(reads, 1);
    await act(async () => { client.setQueryData(key('core'), { referenceRevision: 'r1' }); });
    await settle();
    assert.equal(reads, 2, 'the core answer reruns the failed read');
    await act(async () => { client.setQueryData(key('core'), { referenceRevision: 'r1', at: 2 }); });
    await settle();
    assert.equal(reads, 2, 'a second failure waits for the revision');
  } finally {
    await act(async () => tree?.unmount());
    client.clear();
  }
});

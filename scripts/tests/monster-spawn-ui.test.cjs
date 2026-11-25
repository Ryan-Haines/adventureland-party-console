const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('../../dashboard/node_modules/react');
const { create, act } = require('../../dashboard/node_modules/react-test-renderer');
const { restoreGlobals } = require('./helpers/test-registry.cjs');
const { MonsterSpawns } = require('./helpers/dashboard-query-module.cjs')('monster-spawns.tsx');
const { needsCatalog } = require('../../runtime/status/coordinator/reply.ts');
const { CATALOG_VERSIONS } = require('../../runtime/status/rules.ts');

const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join(' ');
async function render(records, check) {
  let view;
  try {
    await act(async () => { view = create(React.createElement(MonsterSpawns, { records })); });
    check(view, text(view.toJSON()));
  } finally { await act(async () => view?.unmount()); }
}
test('spawn display distinguishes loading, missing records, ordinary routes and restrictions', async t => {
  restoreGlobals(t, ['IS_REACT_ACT_ENVIRONMENT']); global.IS_REACT_ACT_ENVIRONMENT = true;
  await render(undefined, (_, output) => assert.match(output, /Waiting for refreshed/));
  await render([], (_, output) => assert.match(output, /No static spawn recorded/));
  await render([{ sourceMap: 'crypt', map: 'crypt', count: 1, x: 10, y: 20, restrictions: ['instance'] },
    { sourceMap: 'main', map: 'main', count: 0, restrictions: ['zero-count'] },
    { sourceMap: 'level2n', map: 'level2n', restrictions: [] }], (view, output) => {
    assert.match(output, /Instance-only map/);
    assert.match(output, /Zero-count spawn/);
    assert.match(output, /Ordinary hunt routing unavailable/);
    assert.match(output, /Available for ordinary hunt routing/);
    assert.deepEqual(view.root.findAll(node => node.type === 'button' || !!node.props.onClick).map(node => node.type), []);
  });
});
test('an older spawn version triggers refresh and the current one satisfies catalog discovery', () => {
  const state = Object.fromEntries(['travelPlaces','monsterChoices','monsterHunterLocation','bestiaryCatalog','skillCatalog','appearanceChoices','merchantCatalog'].map(key => [key, []]));
  state.merchantCatalogVersion = CATALOG_VERSIONS.merchant;
  state.monsterLocationsVersion = CATALOG_VERSIONS.monsterLocations - 1;
  assert.equal(needsCatalog(state), true);
  state.monsterLocationsVersion = CATALOG_VERSIONS.monsterLocations;
  assert.equal(needsCatalog(state), false);
});

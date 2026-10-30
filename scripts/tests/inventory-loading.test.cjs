const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('../../dashboard/node_modules/react');
const { create, act } = require('../../dashboard/node_modules/react-test-renderer');
const { namedFunction } = require('./helpers/named-function.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;

test('inventory waits for complete data across presence, reconnect and character removal', async () => {
  const panels = [];
  const context = { exports: {}, require(name) {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return require('../../dashboard/node_modules/react/jsx-runtime');
    if (name === './use-panel-model') return { usePanelModel: model => model };
    if (name === './live-metrics') return { committedLiveRecord() {} };
    if (name === './upgrade-offering-controls') return { UpgradeOfferingProvider: ({ children }) => children };
    if (name === './inventory-panel') return { InventoryPanel: ({ character }) => {
      panels.push(character.items.filter(Boolean).length);
      return React.createElement('span', null, 'Inventory ready');
    } };
    return new Proxy({}, { get: () => () => null });
  } };
  const source = fs.readFileSync('dashboard/features/party/connected-inventory.tsx', 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  const Component = context.exports.ConnectedInventory;
  const render = character => React.createElement(Component, { name: 'GoldMajesty', model: {
    state: { characters: character ? { GoldMajesty: character } : {}, marked: {} }, chars: [],
  } });
  let tree;
  try {
    await act(async () => { tree = create(render({ name: 'GoldMajesty' })); });
    assert.match(JSON.stringify(tree.toJSON()), /Loading inventory/); assert.equal(panels.length, 0);
    await act(async () => tree.update(render({ name: 'GoldMajesty', items: [], slots: {} })));
    assert.deepEqual(panels, [0]);
    await act(async () => tree.update(render({ name: 'GoldMajesty' })));
    assert.match(JSON.stringify(tree.toJSON()), /Loading inventory/);
    await act(async () => tree.update(render(undefined)));
    assert.match(JSON.stringify(tree.toJSON()), /Loading inventory/);
    await act(async () => tree.update(render({ name: 'GoldMajesty', items: [{ item: { name: 'coat' } }], slots: {} })));
    assert.deepEqual(panels, [0, 1]);
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test('bank snapshots use cached world metadata and never calculate drop graphs', () => {
  const source = fs.readFileSync('characters/shared.js', 'utf8');
  const cached = { drops: [{ monsterId: 'bee' }] };
  const context = vm.createContext({
    G: { items: { coat: { name: 'Coat', skin: 'coat' } }, positions: {}, imagesets: {} },
    character: { bank: { gold: 123, items0: [{ name: 'coat' }] } },
    itemWorldCache: {}, fingerprint: item => ({ ...item }), catalogKnown: false,
    safeItemDefinition: value => value, item_properties: () => ({}), itemSeller: () => null,
    safeFields: value => value, maximumItemLevel: () => 0, itemUsage: () => ({}), itemBonuses: () => [],
    itemWorldInfo: () => { throw Error('blocking world discovery in live report'); },
  });
  vm.runInContext(['itemSheetSprite', 'itemProperties', 'itemTitle', 'itemDefinition', 'bankSnapshot']
    .map(name => namedFunction(source, name)).join('\n'), context);
  const first = context.bankSnapshot();
  assert.equal(first.packs.items0.length, 42);
  assert.equal(first.packs.items0[0].item.name, 'coat');
  assert.equal(first.packs.items0[0].meta.world, undefined);
  context.itemWorldCache.coat = cached;
  assert.equal(context.bankSnapshot().packs.items0[0].meta.world, cached);
});

// Failure inventory for per-copy reports: (1) a report sent after the
// coordinator holds the catalog still carries the definition, world or usage
// of every copy; (2) a report sent before that point drops static meta the
// coordinator has no other source for; (3) a copy with its own skin loses its
// sprite; (4) a level or stat change on one copy is lost; (5) a titled copy
// loses its title (1.5, docs/item-titles.md).
test('reports carry per-copy item meta once the coordinator holds the catalog', () => {
  const source = fs.readFileSync('characters/shared.js', 'utf8');
  const context = vm.createContext({
    G: { items: { coat: { name: 'Coat', skin: 'coat', upgrade: { armor: 1 } } },
      positions: { coat: ['pack_20', 1, 2], xmascoat: ['pack_20', 3, 4] },
      imagesets: { pack_20: { file: '/pack.png', size: 20, columns: 10, rows: 10 } } },
    itemWorldCache: { coat: { drops: [{ monsterId: 'bee' }] } }, catalogKnown: false,
    safeItemDefinition: value => ({ ...value }), itemSeller: () => null,
    item_properties: item => ({ armor: 10 + (item.level || 0), stat: item.stat_type ? 3 : 0 }),
    safeFields: value => value, maximumItemLevel: () => 12, itemUsage: () => ({ classes: [], hands: [] }), itemBonuses: () => [],
  });
  vm.runInContext(['itemSheetSprite', 'itemProperties', 'itemTitle', 'itemDefinition']
    .map(name => namedFunction(source, name)).join('\n'), context);
  const full = context.itemDefinition({ name: 'coat', level: 2 });
  assert.deepEqual(Object.keys(full).sort(), ['bonuses', 'buyable', 'compoundable', 'definition', 'maxLevel',
    'properties', 'scaling', 'sprite', 'title', 'upgradeable', 'usage', 'world']);
  assert.equal(full.sprite.x, 1);
  context.catalogKnown = true;
  assert.deepEqual(JSON.parse(JSON.stringify(context.itemDefinition({ name: 'coat', level: 2 }))),
    { properties: { armor: 12 } });
  assert.deepEqual(JSON.parse(JSON.stringify(context.itemDefinition({ name: 'coat', level: 5, stat_type: 'str' }))),
    { properties: { armor: 15, stat: 3 } });
  assert.equal(context.itemDefinition({ name: 'coat', skin: 'xmascoat' }).sprite.x, 3);
  assert.equal(context.itemDefinition({ name: 'coat', skin: 'coat' }).sprite, undefined);
  assert.equal(context.itemDefinition({ name: 'missing' }), null);
  context.G.titles = { shiny: { luck: 5 } };
  assert.deepEqual(JSON.parse(JSON.stringify(context.itemDefinition({ name: 'coat', level: 2, p: 'shiny' }))),
    { properties: { armor: 12 }, title: { luck: 5 } });
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../../dashboard/node_modules/typescript');
const rules = require('../../runtime/items/rules.ts');
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'),
  { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const dialogCode = compile('dashboard/features/party/wtborder-dialog.tsx');
const exactLevelPrice = (() => { const m = { exports: {} }; vm.runInNewContext(compile('dashboard/features/party/exact-level-price.tsx'), m); return m.exports.exactLevelPrice; })();

function setup() {
  const state = [];
  let cursor = 0;
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }) };
  const useState = initial => {
    const index = cursor++;
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
    return [state[index], value => { state[index] = value; }];
  };
  // Components resolve to their own names, so the rendered tree names each element.
  const names = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
  const stubs = {
    react: { useState },
    './exact-level-price': { exactLevelPrice },
    './suggested-item-value': { useSuggestedItemValue: () => ({ suggested: 100, defaultPrice: 100 }) },
    './wtb-preferences': { useWTBReplacement: () => ({ save: action => action(), dialog: null }),
      standBuyExplanation: 'stand', higherLevelExplanation: 'levels' },
    // The dialog reads the items owner's item value and Ponty price.
    '../../../runtime/items/api.ts': { itemValue: rules.itemValue, pontyPrice: rules.pontyPrice },
  };
  const module = { exports: {} };
  vm.runInNewContext(dialogCode, { module, exports: module.exports, React, require: name => stubs[name] || names });
  const context = { pontyPrice: rules.pontyPrice, WTBOrderDialog: module.exports.WTBOrderDialog };
  return {
    render(props) { cursor = 0; return context.WTBOrderDialog(props); },
    ponty: context.pontyPrice,
  };
}
function nodes(tree) {
  return tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : [];
}
const cap = level => ({ item: { name: 'wcap', level }, meta: { definition: { name: "Wanderer's Cap", g: 10000, upgrade: {}, grades: [7, 9] }, upgradeable: true } });
const props = level => ({ item: cap(level), buyable: [], onOpenChange() {}, onSave: async () => {} });
const preset = (tree, label) => nodes(tree).find(node => node.type === 'StandPriceButton' && node.props.label === label);

test('slider +8 overrides an existing +0 bid; Ponty selection survives polling and saves +8', async () => {
  const harness = setup();
  const input = { ...props(8), existing: { price: 100, quantity: 2, minimumQuality: 0, priorityOverride: 60 } };
  let saved;
  input.onSave = async (...args) => { saved = args; };
  let tree = harness.render(input);
  assert.equal(nodes(tree).find(node => node.type === 'DialogTitle').children.join(''), "Add to WTB · Wanderer's Cap +8");
  assert.equal(nodes(tree).find(node => node.type === 'Input').props.value, '', 'do not reuse a bid priced for +0');
  const price = preset(tree, 'Ponty price').props.value;
  assert.equal(price, harness.ponty(cap(8).item, cap(8).meta));
  assert.ok(price > harness.ponty(cap(7).item, cap(7).meta));
  preset(tree, 'Ponty price').props.onClick();
  tree = harness.render({ ...input, existing: { ...input.existing, price: 999 } });
  assert.equal(nodes(tree).find(node => node.type === 'Input').props.value, String(price));
  await nodes(tree).find(node => node.type === 'Button' && node.children.includes('Place WTB')).props.onClick();
  assert.deepEqual(saved.slice(0,5), ['wcap', price, 2, 8, 60]);
  assert.equal(saved[5].useStandSlot,false); assert.equal(saved[5].acceptHigherLevels,true);
});

test('market presets require the selected level and update when the dialog level changes', () => {
  const harness = setup();
  const input = { ...props(8), history: { marketLow: 700, marketLowLevel: 7, lowest: 800, lowestLevel: 8, recent: 900, recentLevel: 8, highestPublicWTB: 500, highestPublicWTBLevel: 0 } };
  let tree = harness.render(input);
  assert.equal(preset(tree, 'Market price').props.disabled, true);
  assert.equal(preset(tree, 'Highest WTB price').props.disabled, true);
  assert.equal(preset(tree, 'Lowest seen').props.value, 800);
  assert.equal(preset(tree, 'Recent price').props.value, 900);
  nodes(tree).filter(node => node.type === 'Input')[2].props.onChange({ target: { value: '7' } });
  tree = harness.render(input);
  assert.equal(preset(tree, 'Market price').props.value, 700);
  assert.equal(preset(tree, 'Recent price').props.disabled, true);
  assert.equal(preset(tree, 'Ponty price').props.value, harness.ponty(cap(7).item, cap(7).meta));
});

test('new dialog sessions use their selected level and retain only matching existing prices', () => {
  for (const level of [0, 7, 8]) {
    const input = { ...props(level), existing: { minimumQuality: level, price: 123, quantity: 1 } };
    const tree = setup().render(input);
    assert.equal(nodes(tree).find(node => node.type === 'Input').props.value, '123');
    assert.ok(nodes(tree).find(node => node.type === 'DialogTitle').children.join('').endsWith(`+${level}`));
  }
  const wrapper = ts.transpileModule(fs.readFileSync('dashboard/features/party/party-wtborder-dialog.tsx', 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = vm.createContext({ exports: {}, require(name) {
    if (name === 'react/jsx-runtime') return require('../../dashboard/node_modules/react/jsx-runtime');
    if (name === './use-panel-model') return { usePanelModel: model => model };
    if (name === './wtborder-dialog') return { WTBOrderDialog: () => null };
    throw new Error('Unexpected component dependency: ' + name);
  } });
  vm.runInContext(wrapper, context);
  const render = context.exports.PartyWTBOrderDialog;
  const model = { state: {}, wtbItem: null };
  assert.equal(render({ model }), null, 'a closed order has no dialog instance');
  model.wtbItem = cap(8);
  const connected=render({ model });
  assert.equal(connected.type(connected.props).props.item, model.wtbItem, 'new sessions receive the selected item and level');
});

// DF19, A82: a WTB made from a market listing opens with the listing's price, still
// editable; a bid already at the dialog's level keeps its own price. stand-sheet.tsx's Add hands the
// draft price on through onEditBuy.
test('A82: the listing price fills the dialog unless a bid at that level holds one', async t => {
  const tree = setup().render({ ...props(3), item: { ...cap(3), price: 4321 } });
  assert.equal(nodes(tree).find(node => node.type === 'Input').props.value, '4321');
  const held = setup().render({ ...props(3), item: { ...cap(3), price: 4321 }, existing: { minimumQuality: 3, price: 99, quantity: 1 } });
  assert.equal(nodes(held).find(node => node.type === 'Input').props.value, '99');
  assert.equal(nodes(setup().render(props(3))).find(node => node.type === 'Input').props.value, '');
  await standSheetAdd(t);
});

// The WTB picker's Add in the rendered StandSheet hands the cap's draft price and level to onEditBuy.
async function standSheetAdd(t) {
  const React = require('../../dashboard/node_modules/react'), { create, act } = require('../../dashboard/node_modules/react-test-renderer');
  const { load, queryRoot } = require('./helpers/dashboard-query-module.cjs');
  require('./helpers/test-registry.cjs').restoreGlobals(t, ['IS_REACT_ACT_ENVIRONMENT', 'fetch', 'document', 'window', 'EventSource']);
  global.IS_REACT_ACT_ENVIRONMENT = true;
  // The sheet's add-on slots read /addons, its open market holds a watch stream, and its stored
  // preferences and clock listen on window and document. A hidden page keeps the clock stopped.
  const addons = { slots: {}, rings: [], reads: {}, addons: [], refusals: [], overlays: {} };
  global.fetch = async () => ({ ok: true, status: 200, json: async () => addons, text: async () => JSON.stringify(addons) });
  const listeners = { addEventListener() {}, removeEventListener() {} };
  global.document = { hidden: true, ...listeners }; global.window = { ...listeners, dispatchEvent() {} };
  global.EventSource = class { close() {} };
  const tags = new Proxy({}, { get: (_, key) => String(key) });
  const { StandSheet } = load('stand-sheet.tsx', { '@/components/ui/*': tags, 'lucide-react': tags });
  const bid = { price: 4321, quantity: 2, minimumQuality: 3, useStandSlot: false }, opened = [];
  const sheet = { open: true, marketOpen: true, stand: { slots: 16, used: 0, free: 16 }, merchant: { standOpen: true, slots: {} }, onOpenChange() {}, onMarketOpenChange() {},
    catalog: [{ id: 'wcap', name: "Wanderer's Cap" }], buyable: [], bids: { wcap: bid }, listings: [], priceHistory: {}, blacklist: {}, marketIgnoredItems: [],
    onBid: async () => {}, onInspect() {}, onEditBuy: (...args) => opened.push(args) };
  const { client, wrap } = queryRoot();
  let view;
  try {
    await act(async () => { view = create(wrap(React.createElement(StandSheet, sheet))); });
    const picker = view.root.findAll(node => node.props['data-area'] === 'wtb-orders')[0];
    const add = picker.findAllByType('Button').find(node => node.children.includes('Add'));
    await act(async () => add.props.onClick());
    assert.deepEqual(opened.map(([item, , price]) => [item.name, item.level, price]), [['wcap', 3, 4321]]);
  } finally { await act(async () => view?.unmount()); client.clear(); }
}

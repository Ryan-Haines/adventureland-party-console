const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('../../dashboard/node_modules/react');
const { create, act } = require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

test('catalog appends rows near the scroll bottom and resets on filtering and reopening', async () => {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('dashboard/features/party/equipment-catalog-dialog.tsx', 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require(id) {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return require('../../dashboard/node_modules/react/jsx-runtime');
    if (id === './equipment-types') return { EQUIPMENT_TYPES: ['weapon'] };
    return new Proxy({}, { get: (_, name) => name });
  }});
  const { ROW_BATCH, NEAR_BOTTOM_PX } = exports, size = 2 * ROW_BATCH + 10;
  const catalog = Array.from({ length: size }, (_, i) => ({
    id: `item${i}`, name: `Item ${i}`, sprite: { image: '/item.png' }, meta: { definition: { type: 'weapon', tier: 1, g: i } },
  }));
  let tree, open = true;
  const render = () => React.createElement(exports.EquipmentCatalogDialog, { open, catalog, onOpenChange() {}, onInspect() {} });
  const rows = () => tree.root.findAllByType('SpriteCrop').length;
  const scroll = (remaining) => tree.root.findAllByType('div').find(node => node.props.onScroll).props.onScroll({
    currentTarget: { scrollHeight: 4000, clientHeight: 600, scrollTop: 3400 - remaining },
  });
  try {
    await act(async () => { tree = create(render()); });
    assert.equal(rows(), ROW_BATCH);
    await act(async () => scroll(NEAR_BOTTOM_PX + 1));
    assert.equal(rows(), ROW_BATCH, 'scrolling far from the end does not mount more rows');
    await act(async () => { scroll(NEAR_BOTTOM_PX); scroll(NEAR_BOTTOM_PX); });
    assert.equal(rows(), 2 * ROW_BATCH);
    await act(async () => scroll(0));
    assert.equal(rows(), size);
    await act(async () => scroll(0));
    assert.equal(rows(), size, 'the final batch is bounded by the filtered catalog');
    const input = tree.root.findByType('Input');
    await act(async () => input.props.onChange({ target: { value: `Item ${size - 1}` } }));
    assert.equal(rows(), 1);
    await act(async () => input.props.onChange({ target: { value: '' } }));
    assert.equal(rows(), ROW_BATCH);
    await act(async () => scroll(0));
    open = false;
    await act(async () => tree.update(render()));
    open = true;
    await act(async () => tree.update(render()));
    assert.equal(rows(), ROW_BATCH);
  } finally { if (tree) await act(async () => tree.unmount()); }
});

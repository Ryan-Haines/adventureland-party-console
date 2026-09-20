const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../../node_modules/typescript');
const { needsCatalog } = require('../../runtime/coordinator/status/response-party.ts');

function render(records) {
  const source = fs.readFileSync('dashboard/features/party/monster-spawns.tsx', 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export function', 'function');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { records, React: { createElement: (type, props, ...children) => ({ type, props, children: children.flat(Infinity) }) } };
  vm.runInNewContext(code + ';result = MonsterSpawns({records});', context);
  return context.result;
}
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : (tree?.children || []).map(text).join(' ');
test('spawn display distinguishes loading, missing records, ordinary routes and restrictions', () => {
  assert.match(text(render(undefined)), /Waiting for refreshed/);
  assert.match(text(render([])), /No static spawn recorded/);
  const tree = render([{ sourceMap: 'crypt', map: 'crypt', count: 1, x: 10, y: 20, restrictions: ['instance'] },
    { sourceMap: 'main', map: 'main', count: 0, restrictions: ['zero-count'] },
    { sourceMap: 'level2n', map: 'level2n', restrictions: [] }]);
  const output = text(tree);
  assert.match(output, /Instance-only map/);
  assert.match(output, /Zero-count spawn/);
  assert.match(output, /Ordinary hunt routing unavailable/);
  assert.match(output, /Available for ordinary hunt routing/);
  const nodes = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : [];
  assert.ok(nodes(tree).every(node => node.type !== 'button' && !node.props?.onClick));
});
test('spawn version 2 triggers refresh and version 3 satisfies catalog discovery', () => {
  const state = Object.fromEntries(['travelPlaces','monsterChoices','monsterHunterLocation','bestiaryCatalog','skillCatalog','appearanceChoices','merchantCatalog'].map(key => [key, []]));
  state.merchantCatalogVersion = 'token-shops-v3';
  state.monsterLocationsVersion = 2;
  assert.equal(needsCatalog(state), true);
  state.monsterLocationsVersion = 3;
  assert.equal(needsCatalog(state), false);
});

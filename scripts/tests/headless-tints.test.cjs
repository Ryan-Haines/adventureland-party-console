const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { namedFunction } = require('./helpers/named-function.cjs');
const { installGameRendering } = require('../../runtime/characters/game-rendering.ts');

// Failure inventory: docs/efficiency.md, Character threads follow-ups, CT6.
// A unit test: a headless client has no renderer, so its tint bookkeeping is
// observable only from inside the game context. The pinned native tint_logic
// runs side by side with the headless one.
const files = '.caracal/game_files/17175/';
const functions = fs.readFileSync(files + 'functions.js', 'utf8');
const common = fs.readFileSync(files + 'old_common_functions.js', 'utf8') + fs.readFileSync(files + 'common_functions.js', 'utf8');
function game(noGraphics) {
  const dom = { calls: 0 };
  const chain = new Proxy(function () {}, { get: (_t, key) => key === 'length' ? 0 : (...args) => { dom.calls++; return chain; }, apply: () => chain });
  const context = vm.createContext({ Date, Math, Object, Array, String, Number, JSON, console,
    $: () => { dom.calls++; return chain; }, tints: [], tint_c: {}, no_graphics: noGraphics ? '1' : '', mode: {} });
  for (const name of ['delete_indices', 'ascending_comp']) vm.runInContext(namedFunction(common, name), context);
  for (const name of ['round', 'min', 'max', 'mssince']) if (common.includes('function ' + name + '(')) vm.runInContext(namedFunction(common, name), context);
  if (typeof context.mssince !== 'function') vm.runInContext(namedFunction(functions, 'mssince'), context);
  for (const name of ['tint_logic', 'add_tint', 'get_tint']) vm.runInContext(namedFunction(functions, name), context);
  context.textures = {}; context.set_texture = () => {};
  return { context, dom };
}
const at = ms => new Date(Date.now() + ms);
function seed(context, ended) {
  const calls = [];
  const fill = { type: 'fill', selector: '.f', start: at(-100), end: at(ended ? -1 : 500), on_end: () => calls.push(fill.type) };
  context.tints.push(
    { type: 'skill', selector: '.skidloader1', skid: 1, start: at(-100), end: at(ended ? -1 : 500) },
    { type: 'progress', selector: '.loader1', start: at(-100), end: at(ended ? -1 : 500), upgrade: true },
    { type: 'dissipate', selector: '.pvptint', start: at(-100), end: at(ended ? -1 : 500), r: 200, g: 100, b: 50, i: 18 },
    { type: 'brute', selector: '.atint', key: 'a', cur: 1, start: at(-100), end: at(ended ? -1 : 500), color: '#444', reset_to: '#666' },
    fill, { type: 'glow', selector: '.g', end: at(-1) }, { type: 'half', selector: '.h', end: at(-1) });
  return calls;
}
const snapshot = tints => tints.map(({ type, selector, i, added, mid }) => ({ type, selector, i, added: !!added, mid: mid !== undefined }));

test('headless tint frames keep the native list, counters and end callbacks without DOM work', () => {
  for (const ended of [false, true]) {
    const native = game(true), headless = game(true);
    installGameRendering(headless.context);
    const nativeCalls = seed(native.context, ended), headlessCalls = seed(headless.context, ended);
    for (let frame = 0; frame < 3; frame++) {
      native.context.tint_logic(); headless.context.tint_logic();
      const expected = snapshot(native.context.tints).map(t => ({ ...t, added: false }));
      assert.deepEqual(snapshot(headless.context.tints).map(t => ({ ...t, added: false })), expected, 'frame ' + frame);
    }
    assert.deepEqual(headlessCalls, nativeCalls);
    assert.ok(native.dom.calls > 0);
    assert.equal(headless.dom.calls, 0);
  }
});

test('add_tint still merges into a running headless tint', () => {
  const headless = game(true);
  installGameRendering(headless.context);
  headless.context.add_tint('.atint', { ms: 1000, type: 'brute', key: 'a' });
  headless.context.add_tint('.atint', { ms: 2000, type: 'brute', key: 'a' });
  assert.equal(headless.context.tints.length, 1);
  headless.context.tint_logic();
  assert.equal(headless.context.tints.length, 1);
});

test('a client with graphics keeps the native tint animation', () => {
  const browser = game(false);
  const native = browser.context.tint_logic;
  installGameRendering(browser.context);
  assert.equal(browser.context.tint_logic, native);
  seed(browser.context, false);
  browser.context.tint_logic();
  assert.ok(browser.dom.calls > 0);
});

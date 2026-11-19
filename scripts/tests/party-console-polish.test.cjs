const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('../../dashboard/node_modules/react');
const { create, act } = require('../../dashboard/node_modules/react-test-renderer');
const { createRequire } = require('node:module');
const path = require('node:path');
const req = createRequire(path.resolve('dashboard/package.json'));
const { QueryClient, QueryClientProvider } = req('@tanstack/react-query');
const load = require('./helpers/dashboard-query-module.cjs');
const { PartyGold } = load('party-gold.tsx');
const { drawDue, prepareMap, visibleTiles, receiveMapFrame } = load('map-render-buffer.ts');
global.IS_REACT_ACT_ENVIRONMENT = true;

// The header shows the coordinator's account gold and marks the offline share.
test('gold shows the coordinator total and marks the offline share', async () => {
  const client = new QueryClient();
  let tree;
  const render = accountGold => React.createElement(QueryClientProvider, { client },
    React.createElement(PartyGold, { state: { bankGold: 20, accountGold } }));
  try {
    await act(async () => { tree = create(render({ carried: 15, offline: 5, total: 35 })); });
    assert.match(JSON.stringify(tree.toJSON()), /combined: 35/);
    assert.match(JSON.stringify(tree.toJSON()), /of which offline: 5/);
    assert.match(JSON.stringify(tree.toJSON()), /5 offline/);
    await act(async () => tree.update(render({ carried: null, offline: null, total: null })));
    assert.match(JSON.stringify(tree.toJSON()), /combined: unknown/);
  } finally { if (tree) await act(async () => tree.unmount()); client.clear(); }
});

test('20 FPS scheduler reduces one and four 60 Hz map draw counts by two thirds', () => {
  for (const maps of [1, 4]) {
    let draws = 0, last = -Infinity;
    for (let tick = 0; tick < 600; tick++) {
      const now = tick * 1000 / 60;
      if (drawDue(now, last, 20)) { draws += maps; last = now; }
    }
    assert.equal(draws, 200 * maps);
  }
  assert.equal(drawDue(1, 0), true, 'farming preview is uncapped');
});

test('map buffer resets interpolation and old events at map boundaries; tile work is bounded and aligned', () => {
  const buffer = { frame: null, previous: null, receivedAt: 0 };
  receiveMapFrame(buffer, { map: 'main', events: [{ at: 1000 }] }, 0, 1000);
  receiveMapFrame(buffer, { map: 'main', events: [] }, 100, 1100);
  assert.equal(buffer.previous.map, 'main');
  receiveMapFrame(buffer, { map: 'cave', events: [] }, 200, 1200);
  assert.equal(buffer.previous, null); assert.deepEqual(buffer.frame.events, []);
  // A ring lasts as long as the game client's damage text, ten 100 ms fade steps (js/functions.js
  // `d_text`); the ring used to outlast the text by 100 ms.
  receiveMapFrame(buffer, { map: 'cave', events: [{ at: 2000 }, { at: 2001 }] }, 300, 2001);
  receiveMapFrame(buffer, { map: 'cave', events: [] }, 400, 3000);
  assert.deepEqual(buffer.frame.events, [{ at: 2001 }]);
  const definition = { tiles: [['tile', 0, 0, 10, 20]], placements: [[0, -100000, -100000, 100000, 100000]], groups: [[[0, 0, 40]]] };
  const prepared = prepareMap(definition);
  assert.equal(prepared.groups[0].y, 60);
  const range = visibleTiles(prepared.placements[0], 0, 0, 100, 100);
  assert.deepEqual(range, { left: -10, top: -20, right: 100, bottom: 100 });
  assert.equal(visibleTiles(prepared.groups[0].placements[0], 100, 100, 200, 200), null);
});

test('renderer pauses covered/hidden canvases, releases observers, clears mismatched maps and uses shared latest frames', async () => {
  const { MapCanvas } = load('map-canvas.tsx');
  const saved = Object.fromEntries(['requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'devicePixelRatio'].map(key => [key, global[key]]));
  let id = 0, disconnected = 0, clears = 0, paints = 0;
  const callbacks = new Map();
  global.requestAnimationFrame = callback => { callbacks.set(++id, callback); return id; };
  global.cancelAnimationFrame = id => callbacks.delete(id);
  global.ResizeObserver = class { observe() {} disconnect() { disconnected++; } };
  global.devicePixelRatio = 1;
  const ctx = new Proxy({ clearRect() { clears++; }, fillRect() { paints++; } }, { get(target, name) { return target[name] || (() => {}); } });
  const canvas = { clientWidth: 400, clientHeight: 300, width: 400, height: 300, getContext: () => ctx };
  const definition = { name: 'main', tiles: [], groups: [], placements: [], tilesets: {} };
  const buffer = { current: { frame: { map: 'main', x: 0, y: 0, entities: [] }, previous: null, receivedAt: 0 } };
  const props = { definition, frame: null, previous: null, receivedAt: 0, scale: 1, detailed: false, fps: 20, buffer };
  let tree;
  const tick = now => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(now)); };
  try {
    await act(async () => { tree = create(React.createElement(MapCanvas, props), { createNodeMock: () => canvas }); });
    tick(0); tick(16); tick(33); tick(50);
    assert.equal(paints, 2);
    buffer.current.frame = { map: 'cave', x: 0, y: 0, entities: [] };
    tick(100); assert.equal(clears, 1); assert.equal(paints, 2);
    await act(async () => tree.update(React.createElement(MapCanvas, { ...props, active: false })));
    assert.equal(callbacks.size, 0); assert.equal(disconnected, 1);
    await act(async () => tree.update(React.createElement(MapCanvas, { ...props, definition: { ...definition, name: 'cave' }, active: true })));
    tick(150); assert.equal(paints, 3);
    await act(async () => tree.unmount()); tree = null;
    assert.equal(callbacks.size, 0); assert.equal(disconnected, 2);
  } finally {
    if (tree) await act(async () => tree.unmount());
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete global[key]; else global[key] = value; }
  }
});

function loadControls() {
  const Module = require('node:module');
  const filename = path.resolve('dashboard/features/party/character-session-controls.tsx');
  const result = require('esbuild').buildSync({ entryPoints: [filename], bundle: true, packages: 'external', external: ['@/components/ui/button', '@/components/ui/dialog'], platform: 'node', format: 'cjs', write: false });
  const m = new Module(filename, module); m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = m.require.bind(m);
  m.require = name => {
    if (name === '@/components/ui/button') return { Button: props => React.createElement('button', props) };
    if (name === '@/components/ui/dialog') return Object.fromEntries(['Dialog', 'DialogContent', 'DialogTitle', 'DialogDescription'].map(key => [key, props => key === 'Dialog' && !props.open ? null : React.createElement('section', props)]));
    return original(name);
  };
  m._compile(result.outputFiles[0].text, filename); return m.exports.CharacterSessionControls;
}
const Controls = loadControls();
test('Steam monitor joins, promotes, ignores primary, cancels, rejects changed confirmations, handles failure and duplicate submission', async () => {
  for (const [kind, primary, other, expected] of [['headless', false, null, 'login'], ['headless', false, 'B', 'login'], ['native', false, 'B', 'primary'], ['native', true, 'A', null]]) {
    let calls = [], finish, tree;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    client.setQueryData(['debug-browser'], false);
    const render = props => React.createElement(QueryClientProvider, { client }, React.createElement(Controls, props));
    const props = { name: 'A', slot: { index: 1, character: 'A', kind, primary, state: 'online' }, primaryCharacter: other, pending: false,
      onSteam: (name, action) => { calls.push([name, action]); return new Promise(resolve => { finish = resolve; }); }, onLogout: async () => {}, onHeadless: async () => {} };
    await act(async () => { tree = create(render(props)); });
    const monitor = () => tree.root.findAllByType('button').find(button => /Steam/.test(button.props['aria-label'] || ''));
    await act(async () => monitor().props.onClick());
    if (!expected) { assert.equal(tree.root.findAllByType('button').length, 3); await act(async () => tree.unmount()); client.clear(); continue; }
    const buttons = () => tree.root.findAllByType('button');
    await act(async () => buttons()[3].props.onClick());
    assert.equal(buttons().length, 3); assert.deepEqual(calls, []);
    await act(async () => monitor().props.onClick());
    await act(async () => tree.update(render({ ...props, primaryCharacter: 'Changed' })));
    assert.equal(buttons()[4].props.disabled, true);
    await act(async () => buttons()[4].props.onClick()); assert.deepEqual(calls, []);
    await act(async () => buttons()[3].props.onClick());
    await act(async () => tree.update(render(props)));
    await act(async () => monitor().props.onClick());
    const submit = buttons()[4].props.onClick;
    let pending;
    await act(async () => { pending = submit(); void submit(); });
    assert.deepEqual(calls, [['A', expected]]);
    await act(async () => { finish(); await pending; });
    assert.equal(buttons().length, 3);
    await act(async () => tree.update(render({ ...props, onSteam: async () => { throw new Error('failed request'); } })));
    await act(async () => monitor().props.onClick());
    await act(async () => buttons()[4].props.onClick());
    assert.match(tree.root.findByProps({ role: 'alert' }).children.join(''), /failed request/);
    await act(async () => tree.unmount()); client.clear();
  }
});

// DF19: the decided dashboard items whose dialog is this file's: A81, A83, A87, A88 and A74's
// label. The gold test is above; the Tracktrix bonuses test is tracktrix-bonuses.test.cjs.
test('DF19: the decided items A81, A83, A87, A88 and A74 hold', async () => {
  const fs = require('node:fs'), ts = req('typescript');
  const read = name => fs.readFileSync(path.join('dashboard/features/party', name), 'utf8');
  // A81: the Hunt setup's focus picker offers no priority boxes; priorities are set in the card's picker.
  const workspace = ts.createSourceFile('w.tsx', read('party-workspace.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const pickers = [];
  ts.forEachChild(workspace, function visit(node) {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(workspace) === 'MonsterFocusPicker')
      pickers.push(node.attributes.properties.map(p => p.name?.getText(workspace)));
    ts.forEachChild(node, visit);
  });
  assert.ok(pickers.length > 0);
  for (const props of pickers) assert.ok(!props.includes('priorities') && !props.includes('onPriorityChange'), String(props));
  // A83: the merchant card lists every character's NPC sale rule with its owner's name, and its
  // removal names that owner.
  const panel = read('inventory-panel.tsx');
  assert.match(panel, /\.map\(\(\[key, rule\]\) => rule\.character \? \{\s*key,\s*item: rule\.item,\s*detail: rule\.character,\s*onRemove: \(\) => onRemoveAutomaticSale\('npc', rule\.item, rule\.character\),/);
  assert.doesNotMatch(panel, /\? !rule\.character/);
  assert.match(read('connected-inventory.tsx'), /send\('\/merchant\/auto-npc-sale', \{ character: owner, item, action: 'remove' \}\)/);
  // A87: Kills starts off in a new browser, and each browser keeps the choice.
  const { defaultLogFilters } = require('../../runtime/status/game-log.ts');
  assert.equal(defaultLogFilters.kills, false);
  const sidebar = read('log-sidebar.tsx');
  // The sidebar keeps its filters through the stored-JSON hook, which reads and writes this browser's
  // localStorage and survives a refused write.
  assert.match(sidebar, /useStoredJson<Record<string,boolean>>\('party-log-filters',/);
  const stored = fs.readFileSync('dashboard/hooks/use-stored-boolean.ts', 'utf8');
  assert.match(stored, /text = localStorage\.getItem\(key\);/);
  assert.match(stored, /try \{\s*localStorage\.setItem\(key, text\);\s*\} catch \{/);
  // A74: the game tab says its lines live in memory.
  assert.match(sidebar, /kept in memory; cleared on a console restart/);
  // A88: the header shows Live, or the failed read's notice, from the core poll.
  const { ConnectionLine } = load('party-header.tsx');
  const { RECONNECTING_NOTICE } = load('query-cache.tsx');
  const text = props => { let tree; act(() => { tree = create(React.createElement(ConnectionLine, props)); }); const out = tree.toJSON().children.join(''); tree.unmount(); return out; };
  assert.equal(text({ loading: false, unavailable: false }), 'Live');
  assert.equal(text({ loading: false, unavailable: true }), RECONNECTING_NOTICE);
  assert.equal(text({ loading: true, unavailable: false }), 'Connecting...');
  assert.match(read('party-header.tsx'), /<ConnectionLine loading=\{model\.coordinatorLoading\} unavailable=\{model\.coordinatorUnavailable\} \/>/);
});

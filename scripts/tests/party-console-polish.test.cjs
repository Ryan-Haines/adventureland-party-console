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
// label. The gold test is above; the Tracktrix bonuses test is tracktrix-bonuses.test.cjs. Each item
// renders its component under the real query client; the ui kit and the icons render as tags named
// after their export. useStoredJson's storage reads and its refused write are dashboard-hooks.test.cjs's.
test('DF19: the decided items A81, A83, A87, A88 and A74 hold', async () => {
  const { queryRoot } = load;
  const tags = new Proxy({}, { get: (_, key) => String(key) });
  const installed = { '../../../.build/addons/dashboard': { dashboards: {} } };
  const page = { hidden: false, visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  // This browser's storage, and the tab's session storage, which a new session starts empty.
  const store = () => { const saved = new Map(); return { saved, getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)), removeItem: key => saved.delete(key) }; };
  const storage = store(), session = store();
  const globals = { document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage, fetch: globalThis.fetch };
  Object.assign(globalThis, { document: page, localStorage: storage, sessionStorage: session,
    window: Object.assign(new EventTarget(), { hidden: false, visibilityState: 'visible', localStorage: storage, sessionStorage: session, matchMedia: () => ({ matches: false, ...page }) }) });
  const at = Date.now();
  globalThis.fetch = async () => new Response(JSON.stringify({ gameLogs: { W: [
    { at, session: 's', seq: 1, message: 'Killed a goo', color: '' },
    { at, session: 's', seq: 2, message: 'Received 5 gold', color: '' }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
  const text = node => typeof node === 'string' ? node : (node.children || []).map(text).join('');
  const draw = async element => {
    const { client, wrap } = queryRoot(); let view;
    await act(async () => { view = create(wrap(element)); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    let open = true;
    const done = async () => { if (!open) return; open = false; await act(async () => view.unmount()); client.clear(); };
    drawn.push(done);
    return { view, done };
  };
  // A failed assert leaves its render polling; the finally below unmounts it.
  const drawn = [];
  try {
    // A81: the Hunt setup's focus picker gets no priority table; priorities are set in the card's picker.
    const { PartyWorkspacePanels } = load('party-workspace.tsx', { './*': tags, '@/components/ui/*': tags, 'lucide-react': tags,
      '../../../runtime/hooks/dashboard/slots': tags });
    const workspace = await draw(React.createElement(PartyWorkspacePanels, { model: { state: { characters: { W: { name: 'W' } }, leader: 'W' },
      monsters: [], post: async () => {}, huntSetup: ['goo'], huntSetupCharacter: 'W', setHuntSetup() {}, setMonsterNavigateBusy() {}, setMonsterNavigateTarget() {},
      setFarmAreaRequest() {}, startFarmingArea() {} } }));
    const picker = workspace.view.root.findByType('ConnectedFarmingAreaPicker').props.preparation;
    assert.equal(picker.type, 'MonsterFocusPicker');
    assert.deepEqual(picker.props.selected, ['goo']);
    assert.ok(!('priorities' in picker.props) && !('onPriorityChange' in picker.props), Object.keys(picker.props).join());
    await workspace.done();

    // A83: the merchant card lists F's NPC sale rule under F's name beside the merchant-wide rule, and its
    // removal is sent for F.
    const { InventoryPanel } = load('inventory-panel.tsx', { '@base-ui/react/menu': { Menu: new Proxy({}, { get: (_, key) => 'Menu' + String(key) }) },
      './query-actions': { usePartyAction: () => ({}), performAction: async () => undefined }, './merchant-visit-control': { MerchantVisitControl: () => null },
      '@/components/ui/*': tags });
    const removed = [];
    const panelProps = { character: { name: 'M', ctype: 'merchant', items: [], slots: {}, seenAt: 1 }, characters: [{ name: 'M', seenAt: 1 }, { name: 'F', seenAt: 1 }],
      merchant: 'M', marked: [], merchantMarked: [], autoItemMarks: {}, autoUpgradeMarks: {}, allAutoUpgradeMarks: {}, merchantDeliveries: {}, standListings: [],
      autoNpcSales: { 'F:ring': { item: { name: 'ring' }, character: 'F' }, wbook: { item: { name: 'wbook' }, keep: 2 } },
      autoStandMarks: {}, buyable: [], catalog: [], priceHistory: {}, upgradeMarks: [], statScrollMarks: [], statScrollInventory: {}, compoundGroups: [],
      autoCompoundMarks: [], allAutoCompoundMarks: {}, autoExchanges: {}, onRemoveAutomaticSale: (...args) => removed.push(args), onUpdateNpcReserve() {} };
    const panel = await draw(React.createElement(InventoryPanel, panelProps));
    const button = label => panel.view.root.find(node => node.type === 'button' && node.props['aria-label'] === label);
    const rows = panel.view.root.findAll(node => node.type === 'div' && node.props.className?.startsWith('flex min-h-12'));
    const rowText = rows.map(text);
    assert.equal(rowText.length, 2, rowText.join(' | '));
    assert.ok(rowText.some(row => row.includes('ring') && row.includes('F')), rowText.join(' | '));
    assert.ok(rowText.some(row => row.includes('wbook') && !row.includes('F')), rowText.join(' | '));
    await act(async () => button('Remove ring').props.onClick());
    await act(async () => button('Really remove ring').props.onClick());
    assert.deepEqual(removed, [['npc', { name: 'ring' }, 'F']]);
    await panel.done();
    let inventory;
    const sent = [];
    const none = () => null;
    const { ConnectedInventory } = load('connected-inventory.tsx', { './inventory-panel': { InventoryPanel: props => { inventory = props; return null; } },
      './use-panel-model': { usePanelModel: base => base }, './upgrade-offering-controls': { UpgradeOfferingProvider: ({ children }) => children },
      './shared-rule-conflicts': { SharedRuleConflicts: none }, './lucky-slot-tracker': { LuckySlotDialog: none },
      './deconstruction-confirmation': { DeconstructionConfirmation: none } });
    const noop = () => {};
    const connected = await draw(React.createElement(ConnectedInventory, { name: 'M', model: { state: { merchantCharacter: 'M', characters: { M: { name: 'M', items: [], slots: {} } }, marked: {} },
      chars: [], command: noop, setActionError: noop, setStandItem: noop, setNpcSaleItem: noop, setAutoNpcSaleItem: noop, clearAutomaticSales: noop,
      removeAutomaticSale: noop, statScrollInventory: [], setSelected: noop, detailMeta: noop, setGearComparison: noop, sendCharacter: noop, post: noop,
      send: (...args) => sent.push(args) } }));
    inventory.onRemoveAutomaticSale('npc', { name: 'ring' }, 'F');
    assert.deepEqual(sent, [['/merchant/auto-npc-sale', { character: 'F', item: { name: 'ring' }, action: 'remove' }]]);
    await connected.done();

    // A87: Kills starts off in a new browser, and the choice this browser makes is the one it opens with.
    // A74: the game tab says its lines live in memory.
    const { LogSidebar } = load('log-sidebar.tsx', { 'lucide-react': tags, ...installed });
    const sidebar = () => draw(React.createElement(LogSidebar, { state: { characters: { W: { name: 'W' }, P: { name: 'P' } }, bankbois: [] }, width: 400, onWidth() {}, onClose() {} }));
    const kills = view => view.root.find(node => node.type === 'button' && text(node) === 'Kills');
    const fresh = await sidebar();
    assert.equal(kills(fresh.view).props['aria-pressed'], false);
    assert.doesNotMatch(text(fresh.view.root), /Killed a goo/);
    assert.match(text(fresh.view.root), /Received 5 gold/);
    assert.match(text(fresh.view.root), /kept in memory; cleared on a console restart/);
    await act(async () => kills(fresh.view).props.onClick());
    assert.match(text(fresh.view.root), /Killed a goo/);
    await fresh.done();
    session.saved.clear();
    const reopened = await sidebar();
    assert.equal(kills(reopened.view).props['aria-pressed'], true);
    await reopened.done();

    // A88: the header shows Live, or the failed read's notice, from the core poll.
    const { ConnectionLine, PartyHeader } = load('party-header.tsx', { '@/components/ui/*': tags, 'lucide-react': tags,
      './console-updates': { ConsoleUpdateIndicator: tags.ConsoleUpdateIndicator, useUpdates: () => ({ state: null }) }, './console-build-control': tags,
      './pin-top-bar': { usePinTopBar: () => [false] }, './console-controls': tags, './hand-control': tags, './mail-count': tags, './party-gold': tags, ...installed });
    const { RECONNECTING_NOTICE } = load('query-cache.tsx');
    const line = async props => { const drawn = await draw(React.createElement(ConnectionLine, props)); const out = text(drawn.view.root); await drawn.done(); return out; };
    assert.equal(await line({ loading: false, unavailable: false }), 'Live');
    assert.equal(await line({ loading: false, unavailable: true }), RECONNECTING_NOTICE);
    assert.equal(await line({ loading: true, unavailable: false }), 'Connecting...');
    const model = { state: { realmControl: {} }, coordinatorLoading: false, coordinatorUnavailable: true };
    for (const setter of ['setMailOpen', 'setCatalogOpen', 'setBestiaryOpen', 'setSkillsOpen', 'setStandOpen', 'setMarketOpen', 'setBankOpen', 'openSettings', 'setRealmDestination', 'aldataAction'])
      model[setter] = () => {};
    const header = await draw(React.createElement(PartyHeader, { model, onLogs() {}, metricsActive: false, onMetrics() {} }));
    assert.deepEqual(header.view.root.findByType(ConnectionLine).props, { loading: false, unavailable: true });
    assert.match(text(header.view.root), new RegExp(RECONNECTING_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await header.done();
  } finally {
    for (const done of drawn) await done();
    Object.assign(globalThis, globals);
  }
});

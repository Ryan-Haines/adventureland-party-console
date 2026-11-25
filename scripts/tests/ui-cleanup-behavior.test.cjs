// The status owner's dashboard fixes: the status countdown, DF43, DF44 and DF20.
const test = require('node:test'), assert = require('node:assert/strict');
const {observeStatus,statusRemaining} = require('../../dashboard/features/party/status-duration.ts');
test('status countdown retains duration across polls, refreshes and handles unknown duration',()=>{
 const condition={id:'luck',remainingMs:10000,definition:{},source:'M'};
 let value=observeStatus(condition,undefined,1000);
 assert.equal(statusRemaining(value,6000),5000);
 assert.equal(observeStatus(condition,value,4000),value);
 value=observeStatus({...condition,remainingMs:7000},value,4000);
 assert.equal(statusRemaining(value,5000),6000);
 value=observeStatus({...condition,remainingMs:20000},value,5000);
 assert.equal(statusRemaining(value,26000),0);
 assert.equal(observeStatus({...condition,remainingMs:null},value,6000),undefined);
});

// The dashboard pieces below render through react-test-renderer under the real query client. The ui kit,
// the icons and the leaf views each one draws render as tags named after their export.
const load = require('./helpers/dashboard-query-module.cjs'), { dashboardRequire, queryRoot } = load;
const React = dashboardRequire('react'), { create, act } = dashboardRequire('react-test-renderer');
const tags = new Proxy({}, { get: (_, key) => String(key) });
const ui = { '@/components/ui/*': tags, 'lucide-react': tags, '../../../runtime/hooks/dashboard/slots': tags };
// The named sibling modules of a component, each drawn as tags.
const siblings = (...names) => Object.fromEntries(names.map(name => ['./' + name, tags]));
const text = node => typeof node === 'string' ? node : (node.children || []).map(text).join('');
async function draw(element) {
  const { client, wrap } = queryRoot(); let view;
  const acting = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => { view = create(wrap(React.createElement(React.Suspense, { fallback: 'loading' }, element))); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  let open = true;
  const done = async () => {
    if (!open) return;
    open = false; drawn.delete(done);
    await act(async () => view.unmount()); client.clear(); globalThis.IS_REACT_ACT_ENVIRONMENT = acting;
  };
  drawn.add(done);
  return { root: view.root, done };
}
// A test that fails before its own `done` leaves its render mounted; afterEach unmounts it. A render
// drawn under planted globals unmounts in its block's finally, while those globals still stand.
const drawn = new Set();
test.afterEach(async () => { for (const done of [...drawn]) await done(); });
// Sets each named global for one block and puts the old values back.
async function withGlobals(values, block) {
  const saved = Object.fromEntries(Object.keys(values).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  try { return await block(); } finally {
    for (const [name, descriptor] of Object.entries(saved)) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name];
  }
}

// DF43: on a console reached by plain HTTP the browser has no crypto.randomUUID and no clipboard. The
// one id helper builds a version 4 UUID from getRandomValues, and Copy key uses the clipboard only on
// a secure origin. owner:check's dashboard id rule holds that no other dashboard file calls randomUUID.
test('DF43: ids and Copy key work on a plain-HTTP origin', async () => {
  const saved = globalThis.crypto.randomUUID;
  try {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
    const { requestId } = require('../../dashboard/lib/request-id.ts');
    const ids = [requestId(), requestId()];
    for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(ids[0], ids[1]);
  } finally { Object.defineProperty(globalThis.crypto, 'randomUUID', { value: saved, configurable: true }); }
  const { AccountSections } = load('account-sections.tsx', { ...ui, ...siblings('account-settings', 'app-keys-settings', 'console-updates', 'dashboard-state-import', 'home-realm-setting', 'hosting-settings', 'marketplace-settings', 'pin-top-bar') });
  for (const secure of [false, true]) {
    const copied = [], shown = [];
    await withGlobals({ window: { isSecureContext: secure }, navigator: { clipboard: { writeText: async key => { copied.push(key); } } },
      requestAnimationFrame: () => 0 }, async () => {
      const model = { state: {}, aldataBusy: false, aldataAction() {}, aldataKeyVisible: false, aldataKey: 'key-1', setALDataKeyVisible: open => shown.push(open) };
      const view = await draw(React.createElement(AccountSections, { model, section: 'aldata' }));
      try {
        await act(async () => view.root.find(node => node.props['aria-label'] === 'Copy key').props.onClick());
        if (secure) {
          assert.deepEqual(copied, ['key-1']);
          assert.deepEqual(shown, []);
        } else {
          assert.deepEqual(copied, [], 'a plain-HTTP page has no clipboard to write');
          assert.deepEqual(shown, [true]);
          assert.match(text(view.root), /press Ctrl\+C to copy it/);
        }
      } finally { await view.done(); }
    });
  }
});

// DF44: the giveaway picker takes a typed host the directory never
// listed, checked by the game's name rule, the lifecycle owner's one copy.
test('DF44: a typed giveaway host passes only by the game name rule', async () => {
  const { characterNameAllowed } = require('../../runtime/lifecycle/api.ts');
  // The game's rule allows between 4 and 12 letters, digits and underscores.
  for (const name of ['Seller', 'seller_2', 'A1b2']) assert.equal(characterNameAllowed(name), true, name);
  for (const name of ['', 'A1', '12345', 'two words', 'semi;colon']) assert.equal(characterNameAllowed(name), false, name);
  const { PartyManagementPanels } = load('party-management-panels.tsx', { ...ui, './use-panel-model': { usePanelModel: base => base }, ...siblings('stand-price-button') });
  const noop = () => {};
  const view = await draw(React.createElement(PartyManagementPanels, { model: { giveawayOpen: true, giveawayMerchantOpen: true, giveawayRealm: 'EU I',
    giveawayMerchant: '', standMarketCount: 0, standNpcSale: 0, standPontyPrice: 0, state: { characters: {}, giveawayPlayers: { 'EU I': ['Listed'] } }, setGiveawayOpen: noop, setGiveawayRealm: noop,
    setGiveawayMerchant: noop, setGiveawayMerchantOpen: noop } }));
  const typed = async name => {
    await act(async () => view.root.findByType('CommandInput').props.onValueChange(name));
    return view.root.findAllByType('CommandItem').map(node => node.props.value);
  };
  assert.ok((await typed('Seller')).includes('Seller'), 'a typed name the rule allows is offered');
  assert.ok(!(await typed('A1')).includes('A1'), 'a typed name the rule refuses is not');
  assert.equal((await typed('Listed')).filter(value => value === 'Listed').length, 1, 'a listed host shows once');
  await view.done();
});

// DF20: each dashboard bug fix keeps its fix. The Cipher id is DF43
// above; the import path and size are dashboard-state-import.test.cjs; the Cave map floor is
// daily-dungeons-dashboard.test.cjs; a refused log filter save is dashboard-hooks.test.cjs's stored
// preference test and the sidebar's saved filters are party-console-polish.test.cjs DF19.
test('DF20: the D2 dashboard bug fixes hold', async () => {
  // Event times read the events owner's milliseconds as they are: a time an hour away shows 60m, not a
  // seconds guess. The Anniversary dialog's round times go through the same eventTimeLabel.
  const { eventTimeLabel } = load('event-selection-control.tsx');
  const now = Date.UTC(2026, 10, 13, 12);
  assert.match(eventTimeLabel(now + 3_600_000, now), /\(60m 0s\)$/);
  assert.match(eventTimeLabel(5e11, 0), /\(8333333m 20s\)$/, 'a value under 1e12 stays milliseconds');
  // The escape label reads an ASCII dash in a dungeon.
  const { EscapeControl } = load('escape-control.tsx', { ...ui, './dungeon-query': { useDungeons: () => ({ data: { state: { phase: 'running' } }, busy: false }) },
    './escape-status': tags });
  await withGlobals({ document: { hidden: false, visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    fetch: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }) }, async () => {
    const escape = await draw(React.createElement(EscapeControl));
    try { assert.match(text(escape.root), /^Escape - exit dungeon/); } finally { await escape.done(); }
  });
  // Monster priority saves once, when the box commits; typing only edits the draft.
  const { MonsterFocusPicker } = load('monster-focus-picker.tsx', { ...ui, './sprite-crop': tags, './sprite': tags, './monster-spawns': tags, './passive-hunting-menu': tags });
  const saves = [];
  const picker = await draw(React.createElement(MonsterFocusPicker, { monsters: [{ id: 'goo', name: 'Goo' }], selected: ['goo'], onChange() {},
    priorities: { goo: 1 }, onPriorityChange: next => saves.push(next) }));
  const box = () => picker.root.find(node => node.props['aria-label'] === 'Goo · goo priority');
  await act(async () => box().props.onChange({ target: { value: '4' } }));
  await act(async () => box().props.onChange({ target: { value: '42' } }));
  assert.deepEqual(saves, [], 'a keystroke saves nothing');
  await act(async () => box().props.onBlur());
  assert.deepEqual(saves, [{ goo: 42 }]);
  await picker.done();
  // The deploy request's refusal shows on the control, with the host's own error.
  class PartyActionError extends Error { constructor(message) { super(message); this.status = 400; this.details = { error: message }; } }
  const { ConsoleBuildControl } = load('console-build-control.tsx', { ...ui, './query-actions': {
    PartyActionError,
    hostAction: async (_client, path, _body, init) => {
      if (init?.method === 'GET') return { active: 'a', available: 'b', builds: [{ id: 'a', createdAt: '1', components: { dashboard: 'x' } }, { id: 'b', createdAt: '2', components: { dashboard: 'y' } }] };
      throw new PartyActionError('deploy refused: ' + path);
    } } });
  const session = new Map();
  await withGlobals({ document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    sessionStorage: { getItem: key => session.get(key) ?? null, setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) },
    window: { location: { reload() {} }, scrollY: 0 } }, async () => {
    const build = await draw(React.createElement(ConsoleBuildControl));
    try {
      await act(async () => build.root.findByType('Popover').props.onOpenChange(true));
      await act(async () => build.root.findAll(node => node.type === 'Button' && text(node) === 'Load when safe')[0].props.onClick());
      assert.match(text(build.root), /deploy refused: \/console-build\/deploy/);
    } finally { await build.done(); }
  });
  // The game image proxy hands the browser's abort to its fetch and keeps the game's Cache-Control.
  const { proxyGameImage } = require('../../dashboard/lib/game-image.ts');
  let signal;
  await withGlobals({ fetch: async (_url, init) => { signal = init.signal; return new Response('png', { headers: { 'content-type': 'image/png', 'cache-control': 'max-age=60' } }); } }, async () => {
    const abort = new AbortController();
    const answer = await proxyGameImage(new Request('http://console/proxy?url=/images/tiles/map/a.png', { signal: abort.signal }), '/images/', /\.png$/, 'Map image');
    assert.equal(answer.headers.get('cache-control'), 'max-age=60');
    abort.abort();
    assert.equal(signal.aborted, true, 'the browser drops the request and the fetch ends with it');
    assert.equal((await proxyGameImage(new Request('http://console/proxy?url=https://example.com/a.png'), '/images/', /\.png$/, 'Map image')).status, 400);
  });
  await withGlobals({ fetch: async () => { throw new Error('stalled'); } }, async () =>
    assert.equal((await proxyGameImage(new Request('http://console/proxy?url=/images/a.png'), '/images/', /\.png$/, 'Map image')).status, 502));
  // A headless character's gear comparison shows the doll the coordinator saved for it.
  const portraits = [];
  const { PartyReferencePanels } = load('party-reference-panels.tsx', { ...ui, ...siblings('anniversary-dialog', 'bestiary-dialog', 'monster-details-dialog', 'skills-dialog', 'donation-preview'),
    './query-actions': { performAction: async () => {} }, './deferred-panel': { DeferredPanel: ({ children }) => children },
    './use-panel-model': { usePanelModel: base => base }, './character-portrait': { CharacterPortrait: props => { portraits.push(props.html); return null; } } });
  const headless = { name: 'P', ctype: 'priest', characterDollHtml: null, slots: {}, items: [] };
  const entry = { slot: 0, item: { name: 'blade' }, meta: { definition: { name: 'Blade', type: 'weapon' } } };
  const panels = await draw(React.createElement(PartyReferencePanels, { model: { chars: [headless], monsterAchievements: {}, gearComparison: { character: headless, entry },
    setGearComparison() {}, state: { characters: { P: headless }, characterAppearances: { P: { characterDollHtml: '<div>doll</div>' } } } } }));
  assert.equal(portraits.at(-1), '<div>doll</div>');
  await panels.done();
  // The two trip toggles are one control, one per routine.
  const { MerchantSettingsSection } = load('merchant-collection-settings.tsx', { ...ui, ...siblings('bank-sort-control', 'buy-upgrade-batch-setting', 'gathering-tool-settings', 'merchant-realm-blacklist-setting', 'merchant-trip-setting', 'merchant-stand-location-setting') });
  const settings = await draw(React.createElement(MerchantSettingsSection, { model: { state: { merchantAutomations: { withdrawals: false } }, clearCollectionErrors() {} } }));
  assert.deepEqual(settings.root.findAllByType('MerchantTripSetting').map(node => [node.props.routine, node.props.enabled]),
    [['deliveries', true], ['withdrawals', false]]);
  await settings.done();
});

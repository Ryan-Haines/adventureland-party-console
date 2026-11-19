// The dashboard's general add-on slots:
// each place drawn with a fixture add-on's piece after
// the core content, and the same place with no add-on installed. The places render through
// react-test-renderer under the real query client; the ui kit and the icons render as tags named
// after their export, and GET /party-api/addons answers with the fixture add-on switched on.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, queryRoot, dashboardRequire } = require('./helpers/dashboard-query-module.cjs');
const React = dashboardRequire('react');
const { create, act } = dashboardRequire('react-test-renderer');

const tags = new Proxy({}, { get: (_, key) => String(key) });
// slots.tsx imports the generated list of installed dashboards by this id (runtime/hooks/build/installed.mts).
const INSTALLED = '../../../.build/addons/dashboard';
// Every piece of the fixture add-on is a span that names its slot, its part and the data it got.
const piece = (slot) => (props) => React.createElement('span', { 'data-fixture': `${slot}:${props.part}` }, JSON.stringify(Object.keys(props).sort()));
const installed = (pieces) => ({ [INSTALLED]: { dashboards: pieces ? { fixture: { pieces } } : {} } });

globalThis.fetch = async () => new Response(JSON.stringify({ slots: { 'combat-mode': [], 'target-mode': [] }, rings: [], reads: {}, refusals: [],
  addons: [{ name: 'fixture', author: 'test', summary: 'a fixture', enabled: true, settings: { shown: { label: 'Shown', kind: 'boolean', default: true, value: true } } }] }),
{ status: 200, headers: { 'content-type': 'application/json' } });

async function draw(element) {
  const { wrap } = queryRoot();
  let view;
  await act(async () => { view = create(wrap(element)); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  return view;
}
// The drawn children of `node`, through every component to the tags and texts it renders.
const flat = (node) => (node.children || []).flatMap(child => typeof child === 'string' || typeof child.type === 'string' ? [child] : flat(child));
// Those children as the names a reader tells apart: a tag's name, a fixture piece's place, or a text.
const names = (node) => flat(node).map(child => typeof child === 'string' ? child
  : child.props['data-fixture'] ? 'piece ' + child.props['data-fixture'] : child.type);
// The innermost tag whose drawn children include a `type` tag.
const holder = (view, type) => view.root.findAll(node => typeof node.type === 'string' && flat(node).some(child => child.type === type)).at(-1);
const fixtures = (view) => view.root.findAll(node => typeof node.type === 'string' && node.props['data-fixture']).map(node => node.props['data-fixture']);

const headerStubs = {
  '@/components/ui/*': tags, 'lucide-react': tags, './console-updates': { ConsoleUpdateIndicator: tags.ConsoleUpdateIndicator, useUpdates: () => ({ state: null }) },
  './console-build-control': tags, './pin-top-bar': { usePinTopBar: () => [false] }, './console-controls': tags,
  './hand-control': tags, './mail-count': tags, './party-gold': tags,
};
const model = { state: { realmControl: {} }, coordinatorLoading: false, coordinatorUnavailable: false };
for (const setter of ['setMailOpen', 'setCatalogOpen', 'setBestiaryOpen', 'setSkillsOpen', 'setStandOpen', 'setMarketOpen', 'setBankOpen', 'setSettingsOpen', 'setRealmDestination', 'aldataAction'])
  model[setter] = () => {};
const header = (pieces) => draw(React.createElement(load('party-header.tsx', { ...headerStubs, ...installed(pieces) }).PartyHeader,
  { model, onLogs() {}, metricsActive: false, onMetrics() {} }));

test("top-bar: the add-on's button follows Bank, its view follows Logs and its status follows the hand count", async () => {
  const bare = await header(null);
  const row = (view, name) => names(view.root.find(node => node.props['data-header-row'] === name));
  assert.deepEqual(row(bare, 'actions'), ['Button', 'Button', 'Button', 'Button']);
  assert.deepEqual(fixtures(bare), []);
  const view = await header({ 'top-bar': { views: piece('top-bar'), actions: piece('top-bar'), status: piece('top-bar') } });
  assert.deepEqual(row(view, 'actions'), ['Button', 'Button', 'Button', 'Button', 'piece top-bar:actions']);
  assert.deepEqual(row(view, 'views').slice(-1), ['piece top-bar:views']);
  assert.deepEqual(names(holder(view, 'HandControlCount')).slice(-2), ['HandControlCount', 'piece top-bar:status']);
  assert.deepEqual(names(holder(bare, 'HandControlCount')).slice(-1), ['HandControlCount']);
  // The piece gets its part, the party state and the base every piece gets (addon-kit.ts AddonPieceBase).
  assert.equal(view.root.find(node => node.props['data-fixture'] === 'top-bar:actions').children[0],
    '["open","part","read","reload","save","send","settings","state","stores"]');
  bare.unmount(); view.unmount();
});

const entry = (mode, color) => ({ mode, addon: '', button: { label: mode, description: mode, color } });
const farmingProps = { policy: 'default', effectiveMode: 'default', blacklist: {}, catalog: [], onClearBlacklist: async () => {}, onSelect() {}, onRareChange: async () => {},
  settingsOpen: false, onSettingsOpenChange() {}, combatEntries: [entry('default', 'emerald')], targetEntries: [entry('farming', 'sky')],
  combatMode: 'default', targetMode: 'farming', effectiveTarget: 'farming', addonCard: { character: 'W', reports: { fixture: { worn: 'hat' } } } };
// The Farming settings line of W's card, opened.
async function farmingLine(pieces, props = {}) {
  const control = load('farming-mode-control.tsx', { '@/components/ui/*': tags, 'lucide-react': tags, ...installed(pieces) }).FarmingModeControl;
  const view = await draw(React.createElement(control, { ...farmingProps, ...props }));
  await act(async () => view.root.find(node => node.type === 'button' && node.props['aria-expanded'] === false).props.onClick());
  return view;
}
const line = (view) => view.root.find(node => node.type === 'div' && typeof node.props.className === 'string' && node.props.className.startsWith('mt-2 rounded border'));

test("card-section: the add-on's block shows after the mode rows of the Farming settings line, with its own report", async () => {
  const bare = await farmingLine(null);
  assert.deepEqual(names(line(bare)), ['div', 'div']);
  const view = await farmingLine({ 'card-section': { 'farming-line': piece('card-section') } });
  assert.deepEqual(names(line(view)), ['div', 'div', 'piece card-section:farming-line']);
  const drawn = view.root.find(node => node.props['data-fixture'] === 'card-section:farming-line');
  assert.equal(drawn.children[0], '["character","open","part","read","reload","report","save","send","settings","stores"]');
  assert.deepEqual(view.root.findAll(node => node.props.part === 'farming-line' && node.props.report)[0].props.report, { worn: 'hat' });
  bare.unmount(); view.unmount();
});

const conditionDetails = (pieces) => draw(React.createElement(load('condition-details.tsx', { '@/components/ui/*': tags, ...installed(pieces) }).ConditionDetails,
  { selected: { character: 'W', condition: { name: 'poisoned', definition: { name: 'Poisoned' }, live: {} } }, onOpenChange() {} }));

test("dialog-section: the add-on's section closes the status effect dialog, with the condition as its subject", async () => {
  const bare = await conditionDetails(null);
  assert.deepEqual(names(bare.root.findByType('DialogContent')), ['DialogHeader', 'dl']);
  const view = await conditionDetails({ 'dialog-section': { condition: piece('dialog-section') } });
  assert.deepEqual(names(view.root.findByType('DialogContent')), ['DialogHeader', 'dl', 'piece dialog-section:condition']);
  assert.equal(view.root.findAll(node => node.props.part === 'condition' && node.props.subject)[0].props.subject.name, 'poisoned');
  bare.unmount(); view.unmount();
});

// The Market's Live WTS tab with one listing on each of two realms.
const listing = (seller, serverRegion, serverIdentifier, price) => ({ key: seller, source: 'aldata', seller, slot: 'trade1', serverRegion, serverIdentifier, map: 'main', x: 0, y: 0,
  lastSeen: new Date().toISOString(), seenAt: Date.now(), price, quantity: 1, item: { name: 'hpot0', level: 0 } });
// The sheet's stores subscribe to the page's visibility and the window's events, and read its storage.
const page = { hidden: false, visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
const saved = new Map(), storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)), removeItem: key => saved.delete(key) };
async function market(pieces) {
  globalThis.document ??= page;
  globalThis.window ??= { ...page, localStorage: storage, matchMedia: () => ({ matches: false, ...page }) };
  // The open Market holds a market watch stream; this stand-in opens no connection.
  globalThis.EventSource ??= class { close() {} };
  const sheet = load('stand-sheet.tsx', { '@/components/ui/*': tags, 'lucide-react': tags, ...installed(pieces) }).StandSheet;
  const none = () => {};
  return draw(React.createElement(sheet, { open: false, onOpenChange: none, marketOpen: true, onMarketOpenChange: none, stand: { used: 0, slots: 0 }, listings: [], catalog: [],
    buyable: [], bids: {}, priceHistory: {}, blacklist: {}, marketIgnoredItems: [], autoStandBuys: false, autoBlacklistMerchants: false,
    aldata: { listings: [listing('Alpha', 'US', 'I', 200), listing('Beta', 'EU', 'I', 100)], buyOrders: [], trades: [], tradesUpdatedAt: Date.now() },
    onAutoStandBuys: async () => {}, onEdit: none, onEditBuy: none, onRemove: async () => {}, onBuyALData: async () => {}, onBuyPonty: async () => {},
    onSellALData: async () => {}, onBid: async () => {}, onListForWTB: none, onInspect: none }));
}
// The sellers the tab shows, in the order it draws them.
const shown = (view) => {
  const texts = view.root.findAll(node => typeof node.type === 'string').flatMap(node => node.children.filter(text => typeof text === 'string'));
  return ['Alpha', 'Beta'].map(seller => [seller, texts.findIndex(text => text.includes(seller))]).filter(([, at]) => at >= 0).sort((a, b) => a[1] - b[1]).map(([seller]) => seller);
};

test("list-view: the add-on's server choice narrows the Live WTS tab, its order sorts it, and clearing it restores every row in the tab's order", async () => {
  const bare = await market(null);
  // The tab's own order: fresh listings by price, so Beta's 100 comes before Alpha's 200.
  assert.deepEqual(shown(bare), ['Beta', 'Alpha']);
  assert.deepEqual(fixtures(bare), []);
  const view = await market({ 'list-view': { 'market:wts': { control: piece('list-view'),
    keep: (row, value) => !value.realm || row.realm === value.realm, order: (a, b, value) => value.dearest ? b.price - a.price : 0 } } });
  const control = () => view.root.find(node => node.props.part === 'market:wts' && node.props.set);
  // The control follows the tab's core filters and reads the tab's own rows, every field the tab draws.
  const filters = view.root.find(node => node.type === 'Input' && /^Search item, seller/.test(node.props.placeholder ?? '')).parent;
  assert.deepEqual(names(filters).slice(-1), ['piece list-view:market:wts']);
  assert.deepEqual(control().props.rows.map(row => [row.seller, row.realm, row.price, row.quantity, row.grade, row.map]), [['Beta', 'EU I', 100, 1, 0, 'main'], ['Alpha', 'US I', 200, 1, 0, 'main']]);
  assert.equal(control().props.search, true);
  assert.equal(control().props.value, undefined);
  assert.deepEqual(shown(view), ['Beta', 'Alpha']);
  await act(async () => control().props.set({ dearest: true }));
  assert.deepEqual(shown(view), ['Alpha', 'Beta']);
  await act(async () => control().props.set({ realm: 'EU I' }));
  assert.deepEqual(shown(view), ['Beta']);
  await act(async () => control().props.set(undefined));
  assert.deepEqual(shown(view), ['Beta', 'Alpha']);
  bare.unmount(); view.unmount();
});

async function logs(pieces) {
  globalThis.document ??= page;
  globalThis.window ??= { ...page, localStorage: storage, matchMedia: () => ({ matches: false, ...page }) };
  globalThis.sessionStorage ??= storage;
  const sidebar = load('log-sidebar.tsx', { 'lucide-react': tags, ...installed(pieces) }).LogSidebar;
  return draw(React.createElement(sidebar, { state: { characters: {}, bankbois: [] }, width: 400, onWidth() {}, onClose() {} }));
}

test("page-section: the add-on's block closes the live logs sidebar, after the log entries", async () => {
  const bare = await logs(null);
  const aside = (view) => view.root.find(node => node.type === 'aside');
  const last = names(aside(bare)).slice(-1);
  assert.deepEqual(fixtures(bare), []);
  const view = await logs({ 'page-section': { logs: piece('page-section') } });
  assert.deepEqual(names(aside(view)).slice(-2), [...last, 'piece page-section:logs']);
  bare.unmount(); view.unmount();
});

// W's card map, open, with the map canvas recording the pins it is handed.
async function cardMap(pieces) {
  const canvas = (props) => React.createElement('MapCanvas', { pins: props.pins });
  const section = load('character-map-section.tsx', { '@/components/ui/*': tags, 'lucide-react': tags, ...installed(pieces),
    './map-dock-state': { useMapOpen: () => [true, () => {}], useMapLarge: () => [false, () => {}], useStripShown: () => false },
    './map-canvas': { MapCanvas: canvas }, './dashboard-live': { useCharacterData: () => ({}) }, './field-read-audit': { audited: (_, value) => value },
    './query-cache': { useMapDefinition: () => ({ data: null }), useVisible: () => false }, './map-capture-button': tags }).CharacterMapSection;
  return draw(React.createElement(section, { char: { name: 'W', map: 'main', x: 0, y: 0 } }));
}

test("map-layer: the add-on's marker shows on the card map above the core layers", async () => {
  const bare = await cardMap(null);
  assert.deepEqual(bare.root.findAllByType('MapCanvas')[0].props.pins, []);
  const marker = ({ part, map, character }) => [{ x: 10, y: 20, label: `${part} ${map} ${character}`, color: 'amber' }];
  const view = await cardMap({ 'map-layer': { card: marker } });
  assert.deepEqual(view.root.findAllByType('MapCanvas')[0].props.pins, [{ x: 10, y: 20, label: 'card main W', color: '#fbbf24' }]);
  bare.unmount(); view.unmount();
});

// The four slots the hook rows declared before any dashboard place drew them (slot-coverage.md
// "Today's slots": hunt-status, rare-list, merchant-routines and item-rules).
test("hunt-status: the add-on's line shows under the Hunt status, with the hunt view", async () => {
  const hunting = { effectiveTarget: 'hunt', targetMode: 'hunt', hunt: { stage: 'questing', target: 'bee' } };
  const block = (view) => view.root.find(node => node.type === 'div' && typeof node.props.className === 'string' && node.props.className.includes('border-amber-900/70'));
  const bare = await farmingLine(null, hunting);
  assert.deepEqual(fixtures(bare), []);
  const view = await farmingLine({ 'hunt-status': { hunt: piece('hunt-status') } }, hunting);
  assert.deepEqual(names(block(view)).slice(-1), ['piece hunt-status:hunt']);
  assert.equal(view.root.findAll(node => node.props.part === 'hunt' && node.props.hunt)[0].props.hunt.target, 'bee');
  bare.unmount(); view.unmount();
});

const passiveMenu = (pieces) => draw(React.createElement(load('passive-hunting-menu.tsx', { '@/components/ui/*': tags, 'lucide-react': tags, ...installed(pieces) }).PassiveHuntingMenu,
  { settings: { rules: {}, useFieldGenerators: false }, catalog: [{ id: 'bee', name: 'Bee' }], onSave: async () => {} }));

test("rare-list: the add-on's rows follow the passive hunting menu's monster rows", async () => {
  const body = (view) => view.root.find(node => node.type === 'tbody');
  const bare = await passiveMenu(null);
  const core = names(body(bare));
  const view = await passiveMenu({ 'rare-list': { 'passive-hunting': piece('rare-list') } });
  assert.deepEqual(names(body(view)), [...core, 'piece rare-list:passive-hunting']);
  bare.unmount(); view.unmount();
});

const routines = (pieces, kinds) => draw(React.createElement(load('routine-priorities-dialog.tsx', { '@/components/ui/*': tags, 'lucide-react': tags, ...installed(pieces),
  '@/lib/use-reorder-list': { useReorderList: () => ({ listRef: { current: null }, remember() {}, rowAt: () => null }) } }).RoutinePrioritiesDialog,
  { open: true, onOpenChange() {}, priorities: {}, enabled: {}, kinds, onSave: async () => {} }));

test("merchant-routines: the add-on's routine row follows the routine priorities", async () => {
  const bare = await routines(null);
  const content = (view) => view.root.findByType('DialogContent');
  const core = names(content(bare));
  const view = await routines({ 'merchant-routines': { routines: piece('merchant-routines') } });
  const drawn = names(content(view));
  assert.deepEqual(drawn.filter(name => name !== 'piece merchant-routines:routines'), core);
  const at = drawn.indexOf('piece merchant-routines:routines');
  assert.ok(at >= 0 && at < drawn.indexOf('DialogFooter'), drawn.join(', '));
  bare.unmount(); view.unmount();
});
test("merchant-routines: the add-on's row gets the merchant's add-on job kinds with their label and priority", async () => {
  const kinds = [{ reason: 'addon:restock:wands', addon: 'restock', label: 'Wand restock', priority: 40 }];
  const view = await routines({ 'merchant-routines': { routines: piece('merchant-routines') } }, kinds);
  assert.deepEqual(view.root.findAll(node => node.props.part === 'routines' && node.props.kinds)[0].props.kinds, kinds);
  view.unmount();
});

const itemDetails = (pieces) => draw(React.createElement(load('item-details.tsx', { '@/components/ui/*': tags, 'lucide-react': tags, ...installed(pieces) }).ItemDetails,
  { selected: { character: 'W', entry: { slot: 3, item: { name: 'hpot0', q: 5 }, meta: { definition: { name: 'Small HP Potion', type: 'pot' } } } },
    catalog: [], monsters: [], characters: [], achievements: {}, onOpenChange() {} }));

test("item-rules: the add-on's claim shows in the item's details, with the item and its holder", async () => {
  const bare = await itemDetails(null);
  assert.deepEqual(fixtures(bare), []);
  const view = await itemDetails({ 'item-rules': { 'item-details': piece('item-rules') } });
  assert.deepEqual(fixtures(view), ['item-rules:item-details']);
  const props = view.root.findAll(node => node.props.part === 'item-details' && node.props.item)[0].props;
  assert.deepEqual([props.item.name, props.character], ['hpot0', 'W']);
  bare.unmount(); view.unmount();
});

// settings-section (14 4.3): the Farming settings dialog draws every enabled add-on's section, not
// only an add-on that fills a target mode entry with a status line.
test('settings-section: an enabled add-on with a section and no target mode gets its Farming settings section', () => {
  const section = (props) => React.createElement('span', { 'data-fixture': 'settings-section' }, String(props.inherited));
  const { addonSections } = load('../../../runtime/hooks/dashboard/slots.tsx', { '@/components/ui/*': tags, [INSTALLED]: { dashboards: { fixture: { section } } } });
  const reply = { slots: { 'combat-mode': [], 'target-mode': [] }, settings: { fixture: {} }, read: {},
    addons: [{ name: 'fixture', enabled: true, settings: {} }] };
  const sent = [];
  const drawn = addonSections(reply, { state: { farmingProfiles: {} }, owner: 'W', inherited: false, save: async () => { sent.push('farming'); },
    command: async (addon, body) => { sent.push([addon, body]); }, monsters: {} });
  assert.equal(drawn.sections?.props.children.length, 1);
  // With no target mode entry, its save posts the add-on's own command.
  drawn.sections.props.children[0].props.save({ tank: 'W' });
  assert.deepEqual(sent, [['fixture', { tank: 'W' }]]);
  const following = addonSections(reply, { state: { farmingProfiles: {} }, owner: 'W', inherited: true, save: async () => {}, command: async () => {}, monsters: {} });
  assert.equal(following.sections.props.children[0].props.save, undefined);
  const off = addonSections({ ...reply, addons: [{ name: 'fixture', enabled: false, settings: {} }] }, { state: { farmingProfiles: {} }, owner: 'W', inherited: false, save: async () => {}, command: async () => {}, monsters: {} });
  assert.equal(off.sections, null);
});

test("card-section: a piece gets the party's names and its own add-on's report", async () => {
  const got = [];
  const recorder = (props) => { got.push(props); return React.createElement('span', { 'data-fixture': 'card-section:foot' }); };
  const { AddonCard, AddonSlot } = load('../../../runtime/hooks/dashboard/slots.tsx', { '@/components/ui/*': tags, ...installed({ 'card-section': { foot: recorder } }) });
  const view = await draw(React.createElement(AddonCard, { value: { members: ['P', 'W'] } },
    React.createElement(AddonSlot, { name: 'card-section', part: 'foot', character: 'W', reports: { fixture: { worn: 'hat' } } })));
  const props = got.at(-1);
  assert.deepEqual(props.members, ['P', 'W']);
  assert.deepEqual(props.report, { worn: 'hat' });
  view.unmount();
});

test("settings.overlay: the setting's control gains 'Overlaid by' while an add-on overlays it, and nothing otherwise", async () => {
  const fetched = globalThis.fetch;
  const reply = (overlays) => async () => new Response(JSON.stringify({ slots: { 'combat-mode': [], 'target-mode': [] }, rings: [], reads: {}, refusals: [], addons: [], overlays }),
    { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    globalThis.fetch = reply({ eventPrioritiesByCharacter: 'event-order' });
    const on = load('../../../runtime/hooks/dashboard/slots.tsx', { '@/components/ui/*': tags, ...installed(null) });
    const view = await draw(React.createElement(on.OverlaidBy, { fields: ['eventPrioritiesByCharacter', 'eventLimitsByCharacter'] }));
    assert.deepEqual(flat(view.root).filter(c => typeof c !== 'string').map(c => c.children.join('')), ['Overlaid by Event Order while it is on']);
    view.unmount();
    globalThis.fetch = reply({});
    const off = load('../../../runtime/hooks/dashboard/slots.tsx', { '@/components/ui/*': tags, ...installed(null) });
    const bare = await draw(React.createElement(off.OverlaidBy, { fields: ['eventPrioritiesByCharacter'] }));
    assert.equal(bare.toJSON(), null);
    bare.unmount();
  } finally { globalThis.fetch = fetched; }
});

// The add-on list with the fixture switched on and its stores, and every request the page sent.
function serve(extra = {}, answers = {}) {
  const sent = [];
  globalThis.fetch = async (url, init = {}) => {
    sent.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    const path = String(url).replace('/party-api', '').split('?')[0];
    const body = path === '/addons' ? { slots: { 'combat-mode': [], 'target-mode': [] }, rings: [], reads: {}, refusals: [], overlays: {},
      addons: [{ name: 'fixture', author: 'test', summary: 'a fixture', enabled: true, settings: {} }], ...extra } : answers[path] ?? { ok: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return sent;
}

test("top-bar: a piece reads its add-on's party store, saves it through the store verb and sends the add-on's command", async () => {
  const fetched = globalThis.fetch;
  try {
    const sent = serve({ stores: { fixture: { party: { tank: 'W' }, 'character:W': { worn: 'hat' } } } }, { '/addon-command': { ok: true, reply: 'held' } });
    const got = [];
    const recorder = (props) => { got.push(props); return React.createElement('span', { 'data-fixture': 'top-bar:actions' }); };
    const { AddonSlot } = load('../../../runtime/hooks/dashboard/slots.tsx', { '@/components/ui/*': tags, ...installed({ 'top-bar': { actions: recorder } }) });
    const view = await draw(React.createElement(AddonSlot, { name: 'top-bar', part: 'actions', state: {} }));
    const props = got.at(-1);
    // A top-bar piece holds the party store only: it names no character and no farming scope.
    assert.deepEqual(props.stores, { party: { tank: 'W' } });
    assert.deepEqual(await props.send({ hold: true }, 'W'), { ok: true, reply: 'held' });
    await act(async () => props.save('party', { tank: 'P' }));
    await assert.rejects(props.save('scope', { tank: 'P' }), /no scope store/);
    const posts = sent.filter(request => request.method === 'POST').map(request => request.body);
    assert.deepEqual(posts, [{ name: 'fixture', character: 'W', body: { hold: true } }, { name: 'fixture', verb: 'store', key: 'party', patch: { tank: 'P' } }]);
    // The save reloads the add-on list.
    assert.equal(sent.filter(request => request.url.endsWith('/addons')).length, 2);
    view.unmount();
  } finally { globalThis.fetch = fetched; }
});

test("card-section: a piece saves its character's and its scope's stores, and sends for the card's character", async () => {
  const fetched = globalThis.fetch;
  try {
    const sent = serve({ stores: { fixture: { 'character:W': { worn: 'hat' }, 'scope:P': { roles: { W: 'tank' } } } } });
    const got = [];
    const recorder = (props) => { got.push(props); return React.createElement('span', { 'data-fixture': 'card-section:foot' }); };
    const { AddonCard, AddonSlot } = load('../../../runtime/hooks/dashboard/slots.tsx', { '@/components/ui/*': tags, ...installed({ 'card-section': { foot: recorder } }) });
    const view = await draw(React.createElement(AddonCard, { value: { members: ['P', 'W'], scope: 'P' } },
      React.createElement(AddonSlot, { name: 'card-section', part: 'foot', character: 'W' })));
    const props = got.at(-1);
    assert.deepEqual(props.stores, { party: {}, character: { worn: 'hat' }, scope: { roles: { W: 'tank' } } });
    await act(async () => props.save('scope', { roles: { W: 'tank', P: 'healer' } }));
    await act(async () => props.save('character', { worn: 'cap' }));
    await props.send({ wear: 'hat' });
    assert.deepEqual(sent.filter(request => request.method === 'POST').map(request => request.body), [
      { name: 'fixture', verb: 'store', key: 'scope:P', patch: { roles: { W: 'tank', P: 'healer' } } },
      { name: 'fixture', verb: 'store', key: 'character:W', patch: { worn: 'cap' } },
      { name: 'fixture', character: 'W', body: { wear: 'hat' } }]);
    view.unmount();
  } finally { globalThis.fetch = fetched; }
});

test("dashboard read: a piece's read asks GET /party-api/addon-read once and redraws with the answer", async () => {
  const fetched = globalThis.fetch;
  try {
    const sent = serve({}, { '/addon-read': { value: 3 } });
    const seen = [];
    const reader = (props) => { seen.push(props.read('items.grade', { name: 'blade', level: 9 })); return React.createElement('span', { 'data-fixture': 'top-bar:status' }); };
    const { AddonSlot } = load('../../../runtime/hooks/dashboard/slots.tsx', { '@/components/ui/*': tags, ...installed({ 'top-bar': { status: reader } }) });
    const view = await draw(React.createElement(AddonSlot, { name: 'top-bar', part: 'status', state: {} }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(seen[0], undefined);
    assert.equal(seen.at(-1), 3);
    const reads = sent.filter(request => request.url.includes('/addon-read'));
    assert.equal(reads.length, 1);
    assert.equal(reads[0].url, '/party-api/addon-read?name=items.grade&args=' + encodeURIComponent(JSON.stringify([{ name: 'blade', level: 9 }])));
    view.unmount();
  } finally { globalThis.fetch = fetched; }
});

test("addon-dialogs: a piece opens its add-on's own dialog with a subject, close removes it, and an undeclared id opens nothing", async () => {
  const fetched = globalThis.fetch;
  try {
    serve();
    let opener;
    const button = (props) => { opener = props; return React.createElement('span', { 'data-fixture': 'top-bar:actions' }); };
    const dialog = (props) => React.createElement('span', { 'data-fixture': 'dialog:pick', 'data-subject': props.subject, onClick: props.close }, JSON.stringify(Object.keys(props).sort()));
    const stubs = { '@/components/ui/*': tags, ...installed({ 'top-bar': { actions: button } }) };
    stubs[INSTALLED].dashboards.fixture.dialogs = { pick: dialog };
    const { AddonSlot, AddonDialogs } = load('../../../runtime/hooks/dashboard/slots.tsx', stubs);
    const view = await draw(React.createElement(React.Fragment, null, React.createElement(AddonSlot, { name: 'top-bar', part: 'actions', state: {} }), React.createElement(AddonDialogs)));
    assert.deepEqual(fixtures(view), ['top-bar:actions']);
    await act(async () => opener.open('missing'));
    assert.deepEqual(fixtures(view), ['top-bar:actions']);
    await act(async () => opener.open('pick', 'W'));
    const shownDialog = view.root.find(node => node.props['data-fixture'] === 'dialog:pick');
    assert.equal(shownDialog.props['data-subject'], 'W');
    assert.equal(shownDialog.children[0], '["close","open","read","reload","save","send","settings","stores","subject"]');
    await act(async () => shownDialog.props.onClick());
    assert.deepEqual(fixtures(view), ['top-bar:actions']);
    view.unmount();
    // With no installed add-on declaring a dialog, the mount draws nothing.
    const none = load('../../../runtime/hooks/dashboard/slots.tsx', { '@/components/ui/*': tags, ...installed(null) });
    const bare = await draw(React.createElement(none.AddonDialogs));
    assert.equal(bare.toJSON(), null);
    bare.unmount();
  } finally { globalThis.fetch = fetched; }
});

test("records: the add-on manager draws a records setting as a table with add, remove and a cell edit, each saving the whole list", async () => {
  const fetched = globalThis.fetch;
  try {
    const orders = { label: 'Orders', kind: 'records', default: [], characters: ['P', 'W'],
      fields: { item: { label: 'Item', kind: 'text' }, count: { label: 'Count', kind: 'number', min: 1, max: 99 }, buyer: { label: 'Buyer', kind: 'character' } },
      value: [{ item: 'hpot0', count: 5, buyer: 'W' }] };
    const sent = serve({ addons: [{ name: 'fixture', author: 'test', summary: 'a fixture', enabled: true, settings: { orders } }] });
    const { AddonSettings } = load('../../../runtime/hooks/dashboard/settings-page.tsx', { '@/components/ui/*': tags, ...installed(null) });
    const view = await draw(React.createElement(AddonSettings));
    const table = view.root.findByType('table');
    assert.deepEqual(table.findAllByType('th').map(th => th.children.join('')), ['Item', 'Count', 'Buyer', '']);
    assert.equal(view.root.find(node => node.props['aria-label'] === 'fixture Orders 1 Buyer').type, 'select');
    const posted = () => sent.filter(request => request.method === 'POST').map(request => request.body.settings.orders);
    await act(async () => view.root.find(node => node.props['aria-label'] === 'fixture Orders 1 Count').props.onBlur({ target: { value: '7' } }));
    await act(async () => view.root.find(node => node.props['aria-label'] === 'fixture Orders add').props.onClick());
    await act(async () => view.root.find(node => node.props['aria-label'] === 'fixture Orders 1 remove').props.onClick());
    assert.deepEqual(posted(), [[{ item: 'hpot0', count: 7, buyer: 'W' }],
      [{ item: 'hpot0', count: 5, buyer: 'W' }, { item: '', count: 1, buyer: null }], []]);
    view.unmount();
  } finally { globalThis.fetch = fetched; }
});

test("records: the settings writer checks each record field by its own kind and refuses a malformed record", () => {
  const { accepts, declarationProblem } = require('../../runtime/settings/rules.ts');
  const orders = { label: 'Orders', kind: 'records', default: [], fields: { item: { label: 'Item', kind: 'text' }, count: { label: 'Count', kind: 'number', min: 1, max: 99 },
    side: { label: 'Side', kind: 'choice', choices: ['buy', 'sell'] } } };
  assert.equal(declarationProblem('fixture', 'orders', orders, false), undefined);
  assert.equal(accepts(orders, orders, [{ item: 'hpot0', count: 5, side: 'buy' }, { item: 'mpot0' }]), true);
  assert.equal(accepts(orders, orders, [{ item: 'hpot0', count: 0 }]), false);
  assert.equal(accepts(orders, orders, [{ item: 'hpot0', side: 'trade' }]), false);
  assert.equal(accepts(orders, orders, [{ item: 'hpot0', price: 5 }]), false);
  assert.equal(accepts(orders, orders, [['hpot0']]), false);
  assert.equal(accepts(orders, orders, { item: 'hpot0' }), false);
  assert.match(declarationProblem('fixture', 'orders', { ...orders, fields: {} }, false), /with no fields/);
  assert.match(declarationProblem('fixture', 'orders', { ...orders, fields: { side: { label: 'Side', kind: 'choice' } } }, false), /no choices/);
  assert.match(declarationProblem('fixture', 'orders', { ...orders, fields: { who: { label: 'Who', kind: 'per-character' } } }, false), /which a record does not have/);
});

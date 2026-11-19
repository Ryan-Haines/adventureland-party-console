// The dashboard's pure display reads: one setup, each
// file loaded as the page loads it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SECOND = 1000;
const party = path.join(__dirname, '../../dashboard/features/party');
// A .tsx file goes through esbuild; its relative imports resolve to the party folder's .ts files.
function loadTsx(name) {
  const code = require('esbuild').transformSync(fs.readFileSync(path.join(party, name), 'utf8'), { loader: 'tsx', format: 'cjs' }).code;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', code)(m, m.exports, (id) => require(path.join(party, id.replace(/^\.\//, '') + '.ts')));
  return m.exports;
}

test('durations: Active with no end, Expiring at zero, else the time left rounded up', () => {
  const { durationLabel, timeLeft } = loadTsx('duration-label.tsx');
  assert.equal(durationLabel(null), 'Active');
  assert.equal(durationLabel(undefined), 'Active');
  assert.equal(durationLabel(0), 'Expiring');
  assert.equal(durationLabel(1500), '2s');
  assert.equal(timeLeft(61001), '1m 2s');
  const { formatDuration, durationStat } = require(path.join(party, 'format-duration.ts'));
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(0.5), '<0.001s');
  assert.equal(formatDuration(61 * SECOND), '1m 1s');
  assert.equal(formatDuration(61 * 60 * SECOND), '1h 1m');
  // An elixir's duration is in hours; every other duration key is milliseconds.
  assert.equal(durationStat('duration', 2, { type: 'elixir' }), '2h');
  assert.equal(durationStat('cooldown', 1500), '1.5s');
  assert.equal(durationStat('attack', 10), null);
});

test('a fallback empty value keeps its identity and cannot be written', () => {
  const { emptyArray, emptyRecord } = require(path.join(party, 'empty-values.ts'));
  assert.equal(emptyArray(), emptyArray());
  assert.equal(emptyRecord(), emptyRecord());
  assert.ok(Object.isFrozen(emptyArray()) && Object.isFrozen(emptyRecord()));
});

test('the debug instance serves game images from its own copy, and other URLs pass through', () => {
  const { gameImageUrl, setLocalDebugAssets } = require(path.join(party, 'game-image-url.ts'));
  const image = 'https://adventure.land/images/tiles/items/pack_20vt8.png';
  assert.equal(gameImageUrl(image), image);
  setLocalDebugAssets(true);
  assert.equal(gameImageUrl(image), '/debug-assets/images/tiles/items/pack_20vt8.png');
  assert.equal(gameImageUrl('https://adventure.land/js/game.js'), 'https://adventure.land/js/game.js');
  setLocalDebugAssets(false);
});

test('catalog meta: live per-copy fields win, world falls back to the catalog, one object per input', () => {
  const { joinItemMeta } = require(path.join(party, 'item-catalog-meta.ts'));
  const known = { definition: { name: 'Ring' }, world: { set: null, usedIn: [] }, sprite: { url: 'catalog' } };
  const catalog = { allItems: [{ id: 'ringsj', meta: known }] };
  const live = { sprite: { url: 'copy' } };
  const joined = joinItemMeta(catalog, 'ringsj', live);
  assert.equal(joined.sprite.url, 'copy');
  assert.equal(joined.world, known.world);
  assert.equal(joinItemMeta(catalog, 'ringsj', live), joined);
  assert.equal(joinItemMeta(catalog, 'ringsj', null), known);
  assert.equal(joinItemMeta(catalog, 'unknown', live), live);
});

test('a Hunt blacklist entry names its deaths and expirations', () => {
  const { huntBlacklistLabel } = require(path.join(party, 'hunt-blacklist-label.ts'));
  assert.equal(huntBlacklistLabel({ deaths: 0, reason: 'Manually blacklisted' }), 'manually added');
  assert.equal(huntBlacklistLabel({ deaths: 2, expirations: 1 }), '2 hunt deaths · 1 hunt expired');
  assert.equal(huntBlacklistLabel({ deaths: 1, reason: 'Hunt quest expired before completion' }), '1 hunt death · 1 hunt expired');
  assert.equal(huntBlacklistLabel({ deaths: 0 }), '');
});

// The game's calculate_item_properties names an upgrade multiplier for +7 to +12 only (game), so
// the preview at +13 adds the plain gain.
test('an upgrade preview at +13 adds the plain gain on top of +12', () => {
  const { itemProperties } = require('../../dashboard/lib/game-formulas.ts');
  const meta = { upgradeable: true, definition: { attack: 10 }, scaling: { attack: 4 } };
  assert.equal(itemProperties(meta, {}, 12).attack, 75);
  assert.equal(itemProperties(meta, {}, 13).attack, 79);
});

// One blacklist threshold row for the hunt settings and an add-on's own rule (the kit's
// BlacklistThresholdRow): the switch saves at once, the count saves on blur, and Enter blurs.
test('the blacklist threshold row toggles, drafts and commits its count, and locks the count while off', async () => {
  const React = require('../../dashboard/node_modules/react'), { create, act } = require('../../dashboard/node_modules/react-test-renderer');
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const code = require('esbuild').transformSync(fs.readFileSync(path.join(party, 'blacklist-threshold-row.tsx'), 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', code)(m, m.exports, id => id === '@/components/ui/checkbox' ? { Checkbox: 'Checkbox' }
    : require(id === 'react/jsx-runtime' ? '../../dashboard/node_modules/react/jsx-runtime' : id));
  const events = [];
  const props = { label: 'Blacklist hunts after', inputLabel: 'Deaths before blacklisting', unit: 'deaths', checked: false, value: '3', min: 1, disabled: false,
    onToggle: on => events.push(['toggle', on]), onDraft: value => events.push(['draft', value]), onCommit: () => events.push(['commit']) };
  let view;
  await act(async () => { view = create(React.createElement(m.exports.BlacklistThresholdRow, props)); });
  const input = () => view.root.findByType('input');
  assert.equal(input().props.disabled, true, 'the count is locked while the rule is off');
  view.root.findByType('Checkbox').props.onCheckedChange(true);
  await act(async () => view.update(React.createElement(m.exports.BlacklistThresholdRow, { ...props, checked: true })));
  assert.equal(input().props.disabled, false);
  input().props.onChange({ target: { value: '5' } });
  let blurred = false;
  input().props.onKeyDown({ key: 'Enter', currentTarget: { blur: () => { blurred = true; } } });
  input().props.onBlur();
  assert.ok(blurred, 'Enter blurs the count');
  assert.deepEqual(events, [['toggle', true], ['draft', '5'], ['commit']]);
  await act(async () => view.unmount());
});

// The Bestiary groups a drop under Event drops by the catalog's event window field, so a reworded
// condition label keeps the drop there.
test('a Cipher drop with a reworded label stays under Event drops', () => {
  const code = require('esbuild').transformSync(fs.readFileSync(path.join(party, 'bestiary-drops.tsx'), 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', code)(m, m.exports, id => id === './drop-rate' ? require(path.join(party, 'drop-rate.ts'))
    : id === 'react/jsx-runtime' ? require('../../dashboard/node_modules/react/jsx-runtime') : {});
  const drop = (id, extra) => ({ id, name: id, meta: { world: { drops: [{ monsterId: 'goo', sourceType: 'monster', rate: 0.003, quantity: 1, ...extra }] } } });
  const catalog = [drop('verdantspore', { acquisitionPath: ['Gathering only during the Cipher'], eventWindow: 'witchcipher' }), drop('gslime', { acquisitionPath: ['Monster drop'] })];
  assert.deepEqual(m.exports.eventDropsFor({ id: 'goo', drops: [] }, catalog).map(d => [d.id, d.condition]), [['verdantspore', 'Gathering only during the Cipher']]);
});

// P: the Cipher box keeps v1.5.0's sentence word for word.
test('the Cipher box says the merchant brews up to five mixes', () => {
  const React = require('../../dashboard/node_modules/react');
  const { renderToStaticMarkup } = require('../../dashboard/node_modules/react-dom/server');
  const leaf = new Proxy({}, { get: (_, name) => name === '__esModule' ? true : p => React.createElement('div', null, p.children) });
  const { CipherControls } = require('./helpers/dashboard-query-module.cjs')('cipher-controls.tsx', { '@/components/ui/*': leaf });
  const html = renderToStaticMarkup(React.createElement(CipherControls, { value: {}, onChange() {}, disabled: true, onManual: async () => {} }));
  assert.match(html, /The merchant brews up to five mixes per account per UTC day, on one realm\./);
});

// B174: the kills and loot views ask for the same "today". v1.5.0
// took the browser's midnight and metrics-days.ts:1 took Toronto's, so in Tokyo the two views
// counted different days. The fix makes both the browser's midnight.
test('B174: the kills and loot views start today at the same midnight', () => {
  const zone = process.env.TZ;
  process.env.TZ = 'Asia/Tokyo';
  try {
    const load = require('./helpers/dashboard-query-module.cjs'), { dashboardRequire } = load;
    const React = dashboardRequire('react'), { renderToStaticMarkup } = dashboardRequire('react-dom/server');
    const keys = {};
    const query = { ...dashboardRequire('@tanstack/react-query'), useQueryClient: () => ({}),
      useQuery: options => { keys[options.queryKey[2]] = options.queryKey; return { data: undefined, isError: false }; } };
    const { MetricsKills, MetricsLoot } = load(['metrics-kills.tsx', 'metrics-loot.tsx'], { '@tanstack/react-query': query });
    // 05:00 on 17 November in Tokyo, still 16 November in Toronto.
    const clock = Date.UTC(2026, 10, 16, 20), shared = { active: true, live: true, clock, characters: [], server: '', resetDisabled: false };
    renderToStaticMarkup(React.createElement(MetricsKills, { ...shared, from: clock - 3_600_000, to: clock, resetAt: 0,
      onReset() {}, resetting: false, resetTitle: '' }));
    renderToStaticMarkup(React.createElement(MetricsLoot, { ...shared, names: new Map() }));
    const midnight = new Date(clock).setHours(0, 0, 0, 0);
    assert.equal(keys.kills[5], midnight, 'kills: today starts at the browser\'s midnight');
    assert.equal(keys['loot-days'][3], midnight, 'loot: today starts at the same midnight');
  } finally {
    if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone;
  }
});

// B195: the NPC sale dialog's character field follows the shared-rules setting.
// v1.5.0 left state.merchantRules out of onNpcSale's dependencies, so after the
// setting changed the dialog opened with the old character.
test('B195: the NPC sale dialog reads the shared-rules setting as it is now', () => {
  const load = require('./helpers/dashboard-query-module.cjs'), { dashboardRequire } = load;
  const React = dashboardRequire('react'), { create, act } = dashboardRequire('react-test-renderer');
  const none = () => null;
  let panel;
  const { ConnectedInventory } = load('connected-inventory.tsx', { './inventory-panel': { InventoryPanel: props => { panel = props; return null; } },
    './use-panel-model': { usePanelModel: base => base }, './upgrade-offering-controls': { UpgradeOfferingProvider: ({ children }) => children },
    './shared-rule-conflicts': { SharedRuleConflicts: none }, './lucky-slot-tracker': { LuckySlotDialog: none },
    './deconstruction-confirmation': { DeconstructionConfirmation: none } });
  // The page's setters keep their identity across renders, as React's state setters do.
  const drafts = [], noop = () => {}, setNpcSaleItem = draft => drafts.push(draft);
  const model = state => ({ state, chars: [], command: noop, setActionError: noop, setStandItem: noop, setNpcSaleItem,
    setAutoNpcSaleItem: noop, clearAutomaticSales: noop, removeAutomaticSale: noop, statScrollInventory: [], setSelected: noop, detailMeta: noop,
    setGearComparison: noop, sendCharacter: noop, post: noop, send: noop });
  const state = { merchantCharacter: 'M', merchantRules: false, characters: { F: { name: 'F', items: [], slots: {} } }, marked: {} };
  const acting = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    let root;
    act(() => { root = create(React.createElement(ConnectedInventory, { name: 'F', model: model(state) })); });
    const entry = { slot: 1, item: { name: 'ring' } };
    panel.onNpcSale(entry);
    act(() => { root.update(React.createElement(ConnectedInventory, { name: 'F', model: model({ ...state, merchantRules: true }) })); });
    panel.onNpcSale(entry);
    assert.deepEqual(drafts.map(draft => draft.character), ['F', undefined], 'shared rules sell for the merchant');
    act(() => root.unmount());
  } finally { globalThis.IS_REACT_ACT_ENVIRONMENT = acting; }
});

// The CC meter's red mark was a fixed 180 beside a fixed 200 maximum, so a change to the server's
// call limit in the call budget left the card drawing the old scale. Both now read the calls owner's CALL_LIMIT.
test('the CC meter fills to the call budget limit and turns red at 90% of it', () => {
  const { CC_MAX, ccWarning } = require(path.join(party, 'call-meter.ts'));
  const { CALL_LIMIT } = require('../../runtime/characters/call-budget-limits.ts');
  assert.equal(CC_MAX, CALL_LIMIT);
  assert.equal(ccWarning(CALL_LIMIT * 0.9), true);
  assert.equal(ccWarning(CALL_LIMIT * 0.9 - 1), false);
  assert.equal(ccWarning(undefined), false);
});

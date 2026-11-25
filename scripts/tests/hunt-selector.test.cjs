const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('../../dashboard/node_modules/react');
const { create, act } = require('../../dashboard/node_modules/react-test-renderer');
const { restoreGlobals } = require('./helpers/test-registry.cjs');
const tags = new Proxy({}, { get: (_, key) => String(key) });
const { load, queryRoot } = require('./helpers/dashboard-query-module.cjs');
const { FarmingModeControl } = load('farming-mode-control.tsx', { '@/components/ui/*': tags, 'lucide-react': tags });

// The two mode rows' core entries with their declared buttons (runtime/hooks/core.ts),
// and the pair a single old mode loads as.
const entries = slot => require('../../runtime/hooks/core.ts').coreRegistrations.flatMap(r => (r.slots ?? []).filter(s => s.slot === slot)
  .map(s => ({ mode: s.mode, addon: r.name, button: s.button })));
const pair = policy => policy === 'hunt' ? { combatMode: 'auto', targetMode: 'hunt' } : { combatMode: policy, targetMode: 'farming' };
const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join('');
// Renders the control as connected-character-card.tsx does, with the Hunt task's activity text as
// huntLine, opens the Farming settings panel the way a player does, runs `check` and unmounts.
async function render(t, policy, hunt, characterHunt, check) {
  restoreGlobals(t, ['IS_REACT_ACT_ENVIRONMENT', 'fetch']); global.IS_REACT_ACT_ENVIRONMENT = true;
  // The panel's add-on slots read /addons; no add-on is installed here.
  const addons = { slots: {}, rings: [], reads: {}, addons: [], refusals: [], overlays: {} };
  global.fetch = async () => ({ ok: true, status: 200, json: async () => addons, text: async () => JSON.stringify(addons) });
  const { client, wrap } = queryRoot(), selected = [];
  let view;
  try {
    await act(async () => { view = create(wrap(React.createElement(FarmingModeControl, { hunt, huntLine: hunt?.message, characterHunt, effectiveMode: 'default',
      combatEntries: entries('combat-mode'), targetEntries: entries('target-mode'), ...pair(policy), addonCard: {}, onSettings() {},
      blacklist: { bbpompom: { deaths: 2 } }, onSelect: mode => selected.push(mode) }))); });
    const toggle = view.root.findByProps({ 'aria-expanded': false });
    await act(async () => toggle.props.onClick());
    assert.equal(toggle.props['aria-expanded'], true);
    await check({ view, selected, text: text(view.toJSON()) });
  } finally { await act(async () => view?.unmount()); client.clear(); }
}

test('Hunt remains clickable and explains blacklist fallback after returning to Auto', t => render(t, 'auto',
  { stage: 'ended', message: 'Hunt ended: no eligible quests remain (Hunt blacklist)' }, { id: 'bbpompom', count: 20, remainingMs: 600000 }, async view => {
    const button = view.view.root.findByProps({ role: 'group', 'aria-label': 'Target mode' }).findAll(node => node.type === 'button' && text(node) === 'Hunt')[0];
    assert.ok(button);
    assert.ok(!button.props.disabled);
    await act(async () => button.props.onClick());
    assert.deepEqual(view.selected, [{ targetMode: 'hunt' }]);
    assert.match(view.text, /Last Hunt status/);
    assert.match(view.text, /no eligible quests remain/);
    assert.match(view.text, /blacklisted quests remain skipped/);
    assert.match(view.text, /Blacklisted \u2014 skipped for Hunt/);
  }));

test('active Hunt still shows its current progress', t => render(t, 'hunt', { stage: 'mission-travel', message: 'Travelling to bees' }, undefined, view => {
  assert.match(view.text, /Hunt status/);
  assert.match(view.text, /Travelling to bees/);
  assert.doesNotMatch(view.text, /Last Hunt status/);
}));

test('ordinary farming without Hunt history does not show an empty Hunt panel', t => render(t, 'default', undefined, undefined, view => {
  assert.doesNotMatch(view.text, /Last Hunt status|Preparing Monster Hunt cycle/);
}));
test('backup status shows batch readiness instead of three-minute turn-in advice',t=>render(t,'hunt',
 {stage:'backup-farming',backup:{members:{W:{ready:true,fresh:true,remainingMs:0},P:{target:'mole',ready:false,fresh:true,remainingMs:500000},M:{fresh:false,remainingMs:0}}}},undefined,view=>{
 assert.match(view.text,/Next batch after every blacklisted quest expires/);assert.match(view.text,/waiting for fresh status/);assert.doesNotMatch(view.text,/return at 3 minutes/);
}));

const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('../../dashboard/node_modules/react');
const renderer = require('../../dashboard/node_modules/react-test-renderer');
const { load, queryRoot } = require('./helpers/dashboard-query-module.cjs');
const { restoreGlobals } = require('./helpers/test-registry.cjs');
const { FOLLOWER_ROUTE_MESSAGE } = require('../../dashboard/lib/party-routing.ts');

const tags = new Proxy({}, { get: (_, key) => String(key) });
// One bundle, so the test's MonsterRouteButton is the type the picker's route slot renders.
const { MonsterFocusPicker, MonsterRouteButton, usePartyConsole } = load(
  ['monster-focus-picker.tsx', 'monster-route-button.tsx', 'use-party-console.tsx'],
  { '@/components/ui/*': tags, 'lucide-react': tags,
    './query-actions': { ...load('query-actions.ts'), usePartyAction: () => ({ mutateAsync: async () => ({}) }) } });

// The real usePartyConsole answers Find through findMonsterFor; the route slot is the one
// connected-character-card.tsx's renderMonsterRouteButton hands the picker.
async function setup(t) {
  restoreGlobals(t, ['IS_REACT_ACT_ENVIRONMENT', 'fetch', 'document']);
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const writes = [], data = { characters: { Leader: { name: 'Leader' } }, marked: {}, activeSlots: [], leader: 'Leader', followers: {} };
  let completeSave, model;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => structuredClone(data), text: async () => JSON.stringify(data) });
  // A visible tab: query-cache's useVisible listens for visibilitychange on it.
  global.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const props = {
    monsters: [{ id: 'phoenix', name: 'Phoenix' }, { id: 'goo', name: 'Goo' }],
    selected: ['phoenix'], priorities: {}, onPriorityChange() {},
    onChange: focus => { writes.push(Array.from(focus)); return new Promise(resolve => { completeSave = resolve; }); },
  };
  function Card(picker) {
    model = usePartyConsole();
    const formation = model.state;
    const renderRouteButton = React.useCallback(focus => React.createElement(MonsterRouteButton,
      { formation, character: 'Leader', onRoute: () => model.findMonsterFor('Leader', focus) }), [formation]);
    return React.createElement(MonsterFocusPicker, { ...picker, renderRouteButton });
  }
  const { client, wrap } = queryRoot();
  const render = () => wrap(React.createElement(Card, { ...props }));
  let root;
  await renderer.act(async () => { root = renderer.create(render()); });
  await renderer.act(() => new Promise(resolve => setTimeout(resolve, 0)));
  return {
    // The test's finally unmounts; a t.after hook would run after restoreGlobals took document away.
    async unmount() { await renderer.act(async () => root.unmount()); client.clear(); },
    props, writes, data, client, get root() { return root; }, get model() { return model; },
    update: () => root.update(render()),
    completeSave() { completeSave(); },
    route() { root.root.findAll(n => n.props['aria-label'] === 'Find selected monster' && !!n.props.onClick)[0].props.onClick(); },
    routed() { return Array.from(model.farmAreaRequest.ids); },
  };
}

test('Find uses the displayed Goo draft after clearing imported Phoenix, before and during the save', async t => {
  const h = await setup(t), act = renderer.act;
  try {
    await act(async () => h.route()); assert.deepEqual(h.routed(), ['phoenix']);
    await act(async () => h.root.root.findByProps({ 'aria-label': 'Clear all monster focus' }).props.onClick());
    await act(async () => h.route()); assert.deepEqual(h.routed(), []);
    await act(async () => h.root.root.findAllByType('Checkbox')[2].props.onCheckedChange(true));
    await act(async () => h.route()); assert.deepEqual(h.routed(), ['goo']);
    // Each press goes straight into the ordered write chain (no 180 ms wait), so the Goo tick
    // waits for the Clear's save.
    assert.deepEqual(h.writes, [[]]);
    await act(async () => h.completeSave());
    assert.deepEqual(h.writes, [[], ['goo']]);
    h.props.selected = ['phoenix']; // A poll still contains the imported selection while saving.
    await act(async () => h.update());
    await act(async () => h.route()); assert.deepEqual(h.routed(), ['goo']);
    assert.equal(h.model.farmAreaRequest.character, 'Leader');
    h.props.selected = ['goo'];
    await act(async () => { h.update(); h.completeSave(); });
    await act(async () => h.route()); assert.deepEqual(h.routed(), ['goo']);
    h.props.selected = ['phoenix']; // Later external changes still update the settled picker.
    await act(async () => h.update());
    await act(async () => h.route()); assert.deepEqual(h.routed(), ['phoenix']);
  } finally { await h.unmount(); }
});

test('Find retains all-monsters filtering and current follower routing restrictions', async t => {
  const h = await setup(t), act = renderer.act;
  const follower = n => n.props['aria-label'] === FOLLOWER_ROUTE_MESSAGE && !!n.props.onClick;
  try {
    await act(async () => h.root.root.findAllByType('Checkbox')[1].props.onCheckedChange(true));
    await act(async () => h.route());
    assert.deepEqual(h.routed(), []);
    const request = h.model.farmAreaRequest;
    h.data.leader = 'Other'; h.data.followers = { Leader: true };
    // The refetched core state reaches the render on the next tick.
    await act(async () => { await h.client.refetchQueries(); await new Promise(resolve => setTimeout(resolve, 10)); });
    const trigger = h.root.root.findAll(follower)[0];
    assert.equal(trigger.props['aria-disabled'], true);
    await act(async () => trigger.props.onClick());
    assert.equal(h.model.actionError, null);
    // The route itself refuses a follower too, behind the disabled button.
    await act(async () => h.root.root.findByType(MonsterRouteButton).props.onRoute());
    assert.match(h.model.actionError, /only leader can route to monster/);
    assert.equal(h.model.farmAreaRequest, request);
  } finally { await h.unmount(); }
});

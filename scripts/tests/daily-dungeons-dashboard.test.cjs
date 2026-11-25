const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/dashboard-query-module.cjs');
const { dungeonEntryLabel } = load('dungeon-query.ts');
test('entry countdown requires fresh server eligibility and never guesses availability at reset', () => {
  const now = 100000;
  const view = { members: [{ fresh: true, observation: { visit: { checkedAt: now, available: false, resets: now + 65000 } } }] };
  assert.equal(dungeonEntryLabel(view, now), 'Next entry: 0h 1m 5s');
  view.members[0].observation.visit.resets = now;
  assert.equal(dungeonEntryLabel(view, now), 'Checking availability…');
  view.members[0].observation.visit.available = true;
  assert.equal(dungeonEntryLabel(view, now), 'Available now');
  view.members[0].fresh = false;
  assert.equal(dungeonEntryLabel(view, now), 'Availability unknown');
  view.members[0].fresh = true;
  // The daily answer counts until the game reset it names, so only a reset passed since checkedAt makes it unknown.
  view.members[0].observation.visit.checkedAt = now - 1;
  assert.equal(dungeonEntryLabel(view, now - 1), 'Available now');
  assert.equal(dungeonEntryLabel(view, now), 'Availability unknown');
});
test('dungeon panel exposes actual objectives and explicit priest recovery controls', () => {
  const React = require('../../dashboard/node_modules/react');
  const { renderToStaticMarkup } = require('../../dashboard/node_modules/react-dom/server');
  const dashboardRequire = require('node:module').createRequire(require('node:path').resolve('dashboard/package.json'));
  const { QueryClientProvider } = dashboardRequire('@tanstack/react-query');
  const { createDashboardClient } = load('query-cache.tsx');
  const { DungeonPanel } = load('dungeon-panel.tsx');
  const client = createDashboardClient(), now = Date.now();
  client.setQueryData(['party', 'daily-dungeons'], { state: { phase: 'active', run: 'r', participants: ['W'],commands:{} }, members: [{ name: 'W', fresh: true,
    observation: { alive: false, cave: { run: 'r', floor: 1, expires: now + 50000, remainingMs: 50000, paused: true, gold: 20, amber: 3,
      points: [{ id: 'stairs', label: 'Stairs down', locked: true }],
      choice: { id: 'nera', title: 'Nera', text: 'Choose where to revive', deadline: now + 30000, resolved: false, votes: {},
        options: [{ id: 'here', label: 'Revive here', amber: 1 }, { id: 'door', label: 'Revive at doorway', amber: 0 }] } } } }] });
  try {
    const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(DungeonPanel,{model:{state:{merchantCatalog:null}}})));
    assert.match(html, /Stairs down.*locked/);
    // Encounter choices now open in a client portal, which the Cave windows exercise (e2e/cave-rows.ts).
    assert.match(html, /paused for Nera/);
    assert.match(html, /Call Nera/);
    const view = client.getQueryData(['party', 'daily-dungeons']);
    view.state.priestRecovery = {id:'r:revive:W:1',run:'r',priest:'P',target:'W',authorized:true};
    view.members.push({name:'P',fresh:true,observation:{alive:true,recovery:{actor:{c:{}},id:'r:revive:W:1',phase:'uncertain',reason:'Revive outcome unknown'}}});
    view.members[0].observation.cave.choice.resolved=true;
    const render=()=>renderToStaticMarkup(React.createElement(QueryClientProvider,{client},React.createElement(DungeonPanel,{model:{state:{merchantCatalog:null}}})));
    const waiting=render();assert.match(waiting,/Revive outcome unknown/);assert.match(waiting,/disabled=""[^>]*>Call Nera/);
    view.members[1].observation.recovery.phase='failed';
    assert.doesNotMatch(render(),/disabled=""[^>]*>Call Nera/);
  } finally { client.clear(); }
});

// DF20: the Cave map draws only the current floor's entities.
// W and P stream frames on floor 1; the party goes down and only W's floor 2 frame has come in.
test('DF20: the Cave map draws the current floor only', async t => {
  const { dashboardRequire } = load, React = dashboardRequire('react'), { create, act } = dashboardRequire('react-test-renderer');
  const { caveFloorMap } = require('../../runtime/hunting/api.ts');
  require('./helpers/test-registry.cjs').restoreGlobals(t, ['document', 'EventSource', 'IS_REACT_ACT_ENVIRONMENT']);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const streams = [];
  globalThis.EventSource = class { constructor(url) { this.url = url; streams.push(this); } close() { this.closed = true; } };
  const tags = new Proxy({}, { get: (_, key) => String(key) });
  const { CaveMap } = load('cave-map.tsx', { '@/components/ui/*': tags, './map-canvas': { MapCanvas: 'MapCanvas' }, './map-capture-button': { MapCaptureButton: 'MapCaptureButton' } });
  const props = floor => ({ view: { state: { participants: ['W', 'P'] } }, cave: { run: 'r', floor, points: [] }, action: async () => {}, actionsReady: true,
    waitingForReports: false, error: '', open: true, onOpenChange() {}, destinations: null, onSelectPoint() {} });
  const send = (name, floor, monster) => streams.filter(s => !s.closed && s.url.endsWith('/' + name)).forEach(s => s.onmessage({ data: JSON.stringify({
    name, map: caveFloorMap('r', floor), definition: { name: caveFloorMap('r', floor) }, x: 0, y: 0, at: 0, entities: [{ id: monster }] }) }));
  let view;
  await act(async () => { view = create(React.createElement(CaveMap, props(0))); });
  await act(async () => { send('W', 0, 'goo'); send('P', 0, 'bat'); });
  await act(async () => { view.update(React.createElement(CaveMap, props(1))); });
  await act(async () => { send('W', 1, 'mole'); });
  const canvas = view.root.findByType('MapCanvas').props;
  assert.deepEqual(canvas.frame.entities.map(e => e.id), ['mole']);
  assert.deepEqual(canvas.pins.map(p => p.label), ['W']);
  // The member name list under the map names every streaming member, on any floor.
  assert.deepEqual(view.root.findAllByType('span').map(s => s.props.children).filter(name => ['W', 'P'].includes(name)), ['W', 'P']);
  await act(async () => view.unmount());
});

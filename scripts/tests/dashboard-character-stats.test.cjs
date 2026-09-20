const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const React = require('../../dashboard/node_modules/react');
const { create, act } = require('../../dashboard/node_modules/react-test-renderer');
const dashboardRequire = Module.createRequire(path.resolve('dashboard/package.json'));
const { QueryClientProvider } = dashboardRequire('@tanstack/react-query');
const load = require('./helpers/dashboard-query-module.cjs');
const { createDashboardClient } = load('query-cache.tsx');
const { characterKey } = load('dashboard-live.tsx');

// Exercise the real trigger and query subscription, replacing only the portal
// (react-test-renderer has no browser DOM).
const filename = path.resolve('dashboard/features/party/character-stats-trigger.tsx');
const bundle = buildSync({ entryPoints: [filename], bundle: true, packages: 'external',
  external: ['./character-stats-dialog'], platform: 'node', format: 'cjs', write: false });
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled.require = function (id) {
  if (id === './character-stats-dialog') return {
    CharacterStatsDialog: props => React.createElement('stats-dialog', props),
  };
  return Module.prototype.require.call(this, id);
};
compiled._compile(bundle.outputFiles[0].text, filename);
const { CharacterStatsTrigger } = compiled.exports;
global.IS_REACT_ACT_ENVIRONMENT = true;

test('doll opens locally without workspace renders or requests; equipment stays live and observers close', async () => {
  const client = createDashboardClient();
  const previousFetch = global.fetch;
  let requests = 0, workspaceRenders = 0;
  global.fetch = async () => { requests++; throw new Error('Stats must use cached live data'); };
  const a = { name: 'A', ctype: 'priest', hp: 100 };
  const b = { name: 'B', ctype: 'warrior', hp: 200 };
  for (const name of ['A', 'B']) client.setQueryData(characterKey(name, 'inventory'), {
    slots: { mainhand: { meta: { properties: { attack: 10 } } } },
  });
  const observers = name => client.getQueryCache().find({ queryKey: characterKey(name, 'inventory') }).getObserversCount();
  function Workspace({ character }) {
    workspaceRenders++;
    return React.createElement(React.Fragment, null,
      React.createElement(CharacterStatsTrigger, { character }),
      React.createElement(CharacterStatsTrigger, { character: b }));
  }
  const render = character => React.createElement(QueryClientProvider, { client }, React.createElement(Workspace, { character }));
  let tree;
  try {
    await act(async () => { tree = create(render(a)); });
    assert.equal(observers('A'), 0);
    const before = workspaceRenders;
    await act(async () => tree.root.findAllByType('button')[0].props.onClick());
    assert.equal(workspaceRenders, before, 'opening stats never invalidates the parent workspace');
    assert.equal(tree.root.findAllByType('stats-dialog').length, 1);
    assert.equal(tree.root.findByType('stats-dialog').props.character.name, 'A');
    assert.equal(observers('A'), 1);
    assert.equal(observers('B'), 0, 'other characters do not get stats subscriptions');
    await act(async () => {
      client.setQueryData(characterKey('A', 'inventory'), { slots: { mainhand: { meta: { properties: { attack: 25 } } } } });
      await new Promise(resolve => setTimeout(resolve, 5));
    });
    assert.equal(tree.root.findByType('stats-dialog').props.character.slots.mainhand.meta.properties.attack, 25);
    await act(async () => tree.update(render({ ...a, hp: 50 })));
    assert.equal(tree.root.findByType('stats-dialog').props.character.hp, 50, 'vitals continue updating through the card');
    const beforeClose = workspaceRenders;
    await act(async () => tree.root.findByType('stats-dialog').props.onOpenChange(false));
    assert.equal(workspaceRenders, beforeClose);
    assert.equal(tree.root.findAllByType('stats-dialog').length, 0);
    assert.equal(observers('A'), 0);
    await act(async () => tree.root.findAllByType('button')[1].props.onClick());
    assert.equal(tree.root.findByType('stats-dialog').props.character.name, 'B');
    assert.equal(requests, 0);
  } finally {
    if (tree) await act(async () => tree.unmount());
    client.clear();
    global.fetch = previousFetch;
  }
});

test('live updates preserve portrait markup identity and the button while stats open and close', async () => {
  const client = createDashboardClient();
  const base = { name: 'Qwentina', ctype: 'priest', hp: 100,
    characterDollHtml: '<div><img src="/body.png"><img src="/head.png"></div>' };
  const render = character => React.createElement(QueryClientProvider, { client },
    React.createElement(CharacterStatsTrigger, { character }));
  let tree;
  const markup = () => tree.root.find(node => !!node.props.dangerouslySetInnerHTML).props.dangerouslySetInnerHTML;
  try {
    await act(async () => { tree = create(render(base)); });
    const button = tree.root.findByType('button');
    const original = markup();
    for (let hp = 99; hp >= 90; hp--) {
      await act(async () => tree.update(render({ ...base, hp })));
      assert.equal(markup(), original, 'same HTML object prevents React from rewriting innerHTML');
      assert.equal(tree.root.findByType('button'), button);
    }
    const artwork = tree.root.find(node => node.props['aria-hidden'] === 'true');
    assert.match(artwork.props.className, /pointer-events-none/);
    assert.match(artwork.props.className, /\[&_\*\]:pointer-events-none/);
    assert.match(artwork.props.className, /user-drag:none/);
    assert.equal(artwork.props.draggable, false);
    await act(async () => button.props.onClick());
    assert.equal(tree.root.findByType('stats-dialog').props.character.hp, 90);
    assert.equal(markup(), original);
    const changed = { ...base, hp: 80, characterDollHtml: '<img src="/new-outfit.png">' };
    await act(async () => tree.update(render(changed)));
    assert.equal(tree.root.findByType('button'), button, 'appearance changes preserve the click target');
    assert.equal(markup().__html, changed.characterDollHtml);
    assert.notEqual(markup(), original);
    await act(async () => tree.root.findByType('stats-dialog').props.onOpenChange(false));
    await act(async () => tree.update(render({ ...changed, hp: 70 })));
    await act(async () => button.props.onClick());
    assert.equal(tree.root.findByType('stats-dialog').props.character.hp, 70);
  } finally {
    if (tree) await act(async () => tree.unmount());
    client.clear();
  }
});

test('portrait memoizes HTML even when sprite metadata is reconstructed; fallbacks retain dimensions', async () => {
  const { CharacterPortrait } = load('character-portrait.tsx');
  const sprite = { url: '/sprite.png', columns: 4, rows: 4, x: 1, y: 2, tileSize: 16 };
  const render = props => React.createElement(CharacterPortrait, { skin: 'priest', ...props });
  let tree;
  try {
    await act(async () => { tree = create(render({ html: '<img src="/body.png">', sprite })); });
    const markup = tree.root.find(node => !!node.props.dangerouslySetInnerHTML).props.dangerouslySetInnerHTML;
    await act(async () => tree.update(render({ html: markup.__html, sprite: { ...sprite } })));
    assert.equal(tree.root.find(node => !!node.props.dangerouslySetInnerHTML).props.dangerouslySetInnerHTML, markup);
    await act(async () => tree.update(render({ html: null, sprite })));
    const crop = tree.root.find(node => !!node.props.style?.backgroundImage);
    assert.equal(crop.props.style.width, 48);
    assert.equal(crop.props.style.height, 68);
    await act(async () => tree.update(render({ html: null, sprite: null })));
    assert.match(JSON.stringify(tree.toJSON()), /priest/);
  } finally { if (tree) await act(async () => tree.unmount()); }
});

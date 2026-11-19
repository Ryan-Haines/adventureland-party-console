// The dashboard's shared hooks: the display clock, the stored preference, the session
// preference and the forwarding actions.
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('../../dashboard/node_modules/react');
const { create, act } = require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

// A hidden page stops the tick, and showing it again starts one.
test('two clock readers share one interval, which stops while the page is hidden and when both unmount', async () => {
  const started = [], cleared = [], visibility = new Set();
  const setInterval = global.setInterval, clearInterval = global.clearInterval, previous = global.document;
  global.setInterval = (fn, ms) => { const id = setInterval(fn, ms); started.push(id); return id; };
  global.clearInterval = id => { if (id !== undefined) cleared.push(id); clearInterval(id); };
  global.document = { hidden: false, addEventListener: (type, fn) => type === 'visibilitychange' && visibility.add(fn),
    removeEventListener: (type, fn) => visibility.delete(fn) };
  const show = hidden => { global.document.hidden = hidden; visibility.forEach(fn => fn()); };
  try {
    const { useClock } = require('../../dashboard/hooks/use-clock.ts');
    const Reader = () => React.createElement('span', null, useClock() > 0 ? 'ticking' : 'idle');
    let first, second;
    await act(async () => { first = create(React.createElement(Reader)); second = create(React.createElement(Reader)); });
    assert.equal(started.length, 1);
    assert.equal(first.toJSON().children[0], 'ticking');
    await act(async () => show(true));
    assert.deepEqual(cleared, started, 'a hidden page runs no tick');
    await act(async () => show(false));
    assert.equal(started.length, 2, 'the page shown again ticks');
    await act(async () => first.unmount());
    assert.equal(cleared.length, 1);
    await act(async () => second.unmount());
    assert.deepEqual(cleared, started);
    assert.equal(visibility.size, 0);
  } finally { global.setInterval = setInterval; global.clearInterval = clearInterval; global.document = previous; }
});

test('a stored preference reads its value, falls back when missing or unparsed, and keeps the fallback when storage throws', async () => {
  const listeners = new Map();
  const of = type => listeners.get(type) || listeners.set(type, new Set()).get(type);
  global.window = { addEventListener: (type, fn) => of(type).add(fn), removeEventListener: (type, fn) => of(type).delete(fn),
    dispatchEvent: event => of(event.type).forEach(fn => fn()) };
  const data = new Map([['shown', 'false'], ['filters', '{"errors":false}'], ['corrupt', '{']]);
  let broken = false;
  global.localStorage = {
    getItem: key => { if (broken) throw Error('blocked'); return data.has(key) ? data.get(key) : null; },
    setItem: (key, value) => { if (broken) throw Error('blocked'); data.set(key, value); },
  };
  try {
    const { useStoredBoolean, useStoredJson } = require('../../dashboard/hooks/use-stored-boolean.ts');
    const none = {};
    let shown, missing, filters, corrupt;
    const Reader = () => { shown = useStoredBoolean('shown', true); missing = useStoredBoolean('missing', true);
      filters = useStoredJson('filters', none); corrupt = useStoredJson('corrupt', none); return null; };
    let tree;
    await act(async () => { tree = create(React.createElement(Reader)); });
    assert.equal(shown[0], false);
    assert.equal(missing[0], true);
    assert.deepEqual(filters[0], { errors: false });
    assert.equal(corrupt[0], none, 'a saved text that does not parse reads as the fallback');
    const first = filters[0];
    await act(async () => shown[1](open => !open));
    assert.equal(data.get('shown'), 'true');
    assert.equal(shown[0], true);
    assert.equal(filters[0], first, 'an unchanged saved text keeps its object across renders');
    await act(async () => filters[1]({ errors: true }));
    assert.equal(data.get('filters'), '{"errors":true}');
    assert.deepEqual(filters[0], { errors: true });
    broken = true;
    await act(async () => tree.update(React.createElement(Reader)));
    assert.equal(missing[0], true);
    await act(async () => tree.unmount());
  } finally { delete global.window; delete global.localStorage; }
});

test('a session preference survives a remount under party-ui:<key> and lives for the page when storage throws', async () => {
  const data = new Map();
  let broken = false;
  global.sessionStorage = {
    getItem: key => { if (broken) throw Error('blocked'); return data.has(key) ? data.get(key) : null; },
    setItem: (key, value) => { if (broken) throw Error('blocked'); data.set(key, value); },
  };
  try {
    const { useSessionState } = require('../../dashboard/features/party/session-state.ts');
    let tab;
    const Reader = () => { tab = useSessionState('logs-tab', 'game'); return null; };
    let tree;
    await act(async () => { tree = create(React.createElement(Reader)); });
    await act(async () => tab[1]('dashboard'));
    assert.equal(data.get('party-ui:logs-tab'), '"dashboard"');
    await act(async () => tree.unmount());
    await act(async () => { tree = create(React.createElement(Reader)); });
    assert.equal(tab[0], 'dashboard', 'a remount reads the saved value back');
    await act(async () => tree.unmount());
    broken = true;
    await act(async () => { tree = create(React.createElement(Reader)); });
    assert.equal(tab[0], 'game', 'a storage that throws reads as unset');
    await act(async () => tab[1]('dashboard'));
    assert.equal(tab[0], 'dashboard', 'the value lives for the page');
    await act(async () => tree.unmount());
  } finally { delete global.sessionStorage; }
});

test('a forwarded action keeps its identity and calls the newest model', async () => {
  const { useForwardingActions } = require('../../dashboard/features/party/use-forwarding-actions.ts');
  const calls = [];
  let forwarded;
  const Reader = ({ model }) => { forwarded = useForwardingActions(model, ['act']); return null; };
  let tree;
  await act(async () => { tree = create(React.createElement(Reader, { model: { act: value => calls.push(['old', value]) } })); });
  const first = forwarded.act;
  await act(async () => tree.update(React.createElement(Reader, { model: { act: value => calls.push(['new', value]) } })));
  assert.equal(forwarded.act, first);
  forwarded.act(7);
  assert.deepEqual(calls, [['new', 7]]);
  await act(async () => tree.unmount());
});

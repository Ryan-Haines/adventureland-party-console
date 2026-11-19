const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { requestCave } = require('../../runtime/hunting/character/cave.ts');
const { contextScope } = require('./helpers/run-scope.cjs');
// The request's scope handles (lifecycle's `act` and `observe`) and a frame without the native
// deferred queue; the call band sends every call here.
require('../../runtime/hooks/index.ts').partyHooks().publish({ name: 'core:calls', folder: 'core', author: 'test', summary: 'Sends every call.',
  hooks: { 'calls.band': () => 'send', 'calls.window': () => 0, 'calls.margin': () => 0 } });
function fixture() {
  const socket = new EventEmitter(); socket.connected = true;
  let expire;
  const timers = {
    act: { setTimeout(fn) { expire = fn; return 1; }, clearTimeout() {}, sleep: async () => {} },
    observe: { on: (target, event, fn) => target.on(event, fn), off: (target, event, fn) => target.off(event, fn) },
  };
  return { socket, frame: { socket }, timers, expire: () => expire() };
}
test('cave query sends correlated interaction and accepts only matching reply', async () => {
  const f = fixture(); let packet;
  f.socket.on('interaction', data => { packet = data; });
  const result = requestCave(f.frame, 'q', 'info', {}, 1, f.timers);
  // The calls owner's band wait (calls.wait) settles before the request sends.
  await null;
  assert.deepEqual(packet, { type: 'cave', action: 'info', request_id: 'q' });
  f.socket.emit('game_response', { request_id: 'other', place: 'interaction', visit: {} });
  f.socket.emit('game_response', { request_id: 'q', place: 'attack' });
  assert.equal(f.socket.listenerCount('game_response'), 1);
  f.socket.emit('game_response', { request_id: 'q', place: 'interaction', visit: { available: true } });
  assert.equal((await result).visit.available, true);
  assert.equal(f.socket.listenerCount('game_response'), 0);
  assert.equal(f.socket.listenerCount('disconnect'), 0);
});
// callMargin (bigcheck/bounds.md): a lost reply queues its firing for the next report; a disconnect
// is no bound firing.
for (const reason of ['timeout', 'disconnected']) test('cave query cleans up on ' + reason, async () => {
  const { boundsPending, boundsSent } = require('../../runtime/status/api.ts');
  boundsSent(boundsPending().length);
  const f = fixture(); const result = requestCave(f.frame, 'q', 'info', {}, 1, f.timers); await null;
  const rejection = assert.rejects(result, error => error.reason === reason);
  if (reason === 'timeout') f.expire(); else f.socket.emit('disconnect');
  await rejection;
  assert.deepEqual(boundsPending().map(f => [f.bound, f.owner]), reason === 'timeout' ? [['callMargin', '07']] : []);
  assert.equal(f.socket.listenerCount('game_response'), 0);
  assert.equal(f.socket.listenerCount('disconnect'), 0);
});
test('server ineligibility and failures are preserved', async () => {
  const f = fixture();
  f.socket.on('interaction', data => f.socket.emit('game_response', { request_id: data.request_id, place: 'interaction', visit: { available: false } }));
  assert.equal((await requestCave(f.frame, 'q', 'info', {}, 1, f.timers)).visit.available, false);
});

test('native cave response is captured before a throwing game UI listener', async () => {
  const f = fixture(); let incoming;
  f.socket.prependAny = listener => { incoming = listener; };
  f.socket.offAny = listener => { if (incoming === listener) incoming = undefined; };
  f.socket.on('game_response', () => { throw Error('UI failure'); });
  const result = requestCave(f.frame, 'q', 'info', {}, 1, f.timers); await null;
  const reply = { request_id: 'q', place: 'interaction', visit: { available: true } };
  incoming('game_response', reply);
  assert.throws(() => f.socket.emit('game_response', reply), /UI failure/);
  assert.equal((await result).visit.available, true);
  assert.equal(incoming, undefined);
  assert.equal(f.socket.listenerCount('game_response'), 1);
});

test('request failures reject and remove catch-all listeners without retrying', async () => {
  const f = fixture(); let incoming, sends = 0;
  f.socket.prependAny = listener => { incoming = listener; };
  f.socket.offAny = () => { incoming = undefined; };
  f.socket.on('interaction', data => {
    sends++;
    incoming('game_response', { request_id: data.request_id, place: 'interaction', failed: true, reason: 'unavailable' });
  });
  await assert.rejects(requestCave(f.frame, 'q', 'enter', {}, 1, f.timers), error => error.reason === 'unavailable');
  assert.equal(sends, 1);
  assert.equal(incoming, undefined);
});
// README "Bug fixes that become tests" row 07 interaction (fork 46e63781): the client resolves one
// native `interaction` deferred per reply, so each request registers one before its emit.
test('each request registers one native interaction deferred before its emit', async () => {
  const f = fixture(), order = [];
  f.frame.push_deferred = name => { order.push('deferred:' + name); return new Promise(() => {}); };
  f.socket.on('interaction', data => { order.push('emit'); f.socket.emit('game_response', { request_id: data.request_id, place: 'interaction', visit: {} }); });
  await requestCave(f.frame, 'q', 'info', {}, 1, f.timers);
  assert.deepEqual(order, ['deferred:interaction', 'emit']);
});
test('browser timers are invoked with their native global receiver', async () => {
  const vm = require('node:vm');
  const ts = require('typescript');
  const fs = require('node:fs');
  const js = ts.transpileModule(fs.readFileSync(require.resolve('../../runtime/hunting/character/cave.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  // cave.ts imports the hooks, the report reading and rules.ts; the context loads them from the module's folder.
  const here = require('node:path').resolve(__dirname, '../../runtime/hunting/character');
  const context = vm.createContext({ exports: {}, require: id => require(require('node:path').resolve(here, id)) });
  vm.runInContext(`globalThis.setTimeout = function () { if (this !== globalThis) throw Error('Illegal invocation'); return 1; };
    globalThis.clearTimeout = function () { if (this !== globalThis) throw Error('Illegal invocation'); };`, context);
  vm.runInContext(js, context);
  const f = fixture();
  f.socket.on('interaction', data => f.socket.emit('game_response', { request_id: data.request_id, place: 'interaction', visit: { available: true } }));
  // The context is its own CODE frame, so the hunting owner's handles time on the context's timers.
  const handles = { act: contextScope(context, '07', 'act'), observe: contextScope(context, '07', 'observe') };
  assert.equal((await context.exports.requestCave(f.frame, 'q', 'info', {}, 1, handles)).visit.available, true);
});

// HN39: the stairs wait while the party cannot move, a
// `cave_paused` refusal is journaled `failed`, and the same stairs go again on the first report where
// the party can move. One dungeon runtime over a floor with one stairs door down.
const { installDungeonRuntime } = require('../../runtime/hunting/character/cave.ts');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
function stairsRuntime() {
  let now = 100000, saved = null, refuse = null;
  const sent = [];
  const cave = { run: 'run-1', floor: 0, expires: 200000, server_time: now, remaining_ms: 100000, paused: false, gold: 0, amber: 0,
    doors: [{ x: 0, y: 0, floor: 0, down: true, to: 'zone_run-1_1' }], objectives: [], choice: null };
  const runtime = installDungeonRuntime({ name: 'W', members: () => ['W'], leader: () => 'W', ready: () => true, now: () => now,
    alive: () => true, current: () => true, cave: () => cave, supported: () => true, info: async () => ({ available: true }),
    request: async (action, fields) => { sent.push({ action, fields }); if (refuse) throw { reason: refuse }; return {}; },
    keeper: () => undefined, text: String, move: async () => {}, stop: async () => {},
    read: () => saved, write: value => { saved = value; } });
  const command = { id: 'stairs-1', action: 'stairs', run: 'run-1', target: { id: 'run-1:0:door:0', to: 'zone_run-1_1' } };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return { cave, sent, runtime, command, settle,
    refuse: reason => { refuse = reason; },
    report: async () => { now += 1000; runtime.receive({ owned: true, command, movementReady: true }); await settle(); await settle(); },
    status: () => saved?.entries.find(e => e.id === 'stairs-1')?.status };
}
scenarioTable('the Cave stairs wait for `canMove` and go again after a pause refusal (HN39)', stairsRuntime, [
  ['a paused party sends no stairs and journals nothing', async r => {
    r.cave.paused = true;
    await r.report();
    assert.equal(r.sent.length, 0);
    assert.equal(r.status(), undefined);
  }],
  ['a `cave_paused` refusal is a definite failure', async r => {
    r.refuse('cave_paused');
    await r.report();
    assert.equal(r.sent.length, 1);
    assert.equal(r.status(), 'failed');
  }],
  ['the refused stairs go again on the first report where the party can move', async r => {
    r.refuse('cave_paused');
    await r.report();
    r.refuse(null);
    await r.report();
    assert.equal(r.sent.length, 2);
    assert.equal(r.status(), 'complete');
  }],
]);

const test = require('node:test'), assert = require('node:assert/strict');
const {startCoordinatorCharacters} = require('../../runtime/coordinator/characters/startup.ts');

function fixture(watchCode = true) {
  const workers = {W: {enabled: true, connected: true, script: 'warrior.js'}, P: {enabled: true, connected: true, script: 'priest.js'}};
  const state = {nativeOwner: null, steamMembers: [], headlessSlots: ['W', 'P'], steamSwitch: null};
  const calls = [], listeners = {}; let restore, generations;
  const ports = {events: {on: (event, listener) => {calls.push(['listen', event]); listeners[event] = listener;}},
    shutdown: async reason => calls.push(['shutdown', reason]), watch: (name, worker) => calls.push(['watch', name, worker.connected, worker.enabled]),
    owned: name => ({type: name === 'W' ? 'warrior' : 'priest'}), ensure: name => workers[name],
    start: name => calls.push(['start', name]), persist: () => calls.push(['persist']),
    later: (callback, milliseconds) => {restore = callback; calls.push(['later', milliseconds]);}, watchCode,
    watchGenerations: value => {generations = value; calls.push(['generations']);}, stop: async () => {}, report: () => {},
    subscribeAccount: () => calls.push(['account'])};
  return {workers, state, calls, listeners, ports, run: () => startCoordinatorCharacters(workers, state, ports),
    restore: () => restore(), get generations() {return generations;}};
}

test('character startup installs hooks, prepares slots, schedules restoration and subscribes in order', async () => {
  const t = fixture(); t.run();
  assert.deepEqual(t.calls, [['listen', 'SIGINT'], ['listen', 'SIGTERM'], ['listen', 'SIGQUIT'], ['listen', 'message'],
    ['watch', 'W', false, true], ['watch', 'P', false, true], ['later', 4000], ['generations'], ['account']]);
  assert.equal(t.workers.W.enabled, false); assert.equal(t.workers.P.enabled, false);
  // A Steam handoff completed while the four-second startup timer was pending.
  t.state.steamMembers = ['W']; t.restore();
  assert.deepEqual(t.calls.slice(-2), [['start', 'P'], ['persist']]);
  assert.equal(t.workers.W.enabled, false); assert.equal(t.workers.P.enabled, true);
  t.listeners.message({type: 'coordinator_shutdown'}); await Promise.resolve();
  assert.deepEqual(t.calls.at(-1), ['shutdown', 'coordinator reload request']);
});

test('generation callbacks see current worker processes and watching can be disabled independently', () => {
  const t = fixture(); t.run(); assert.deepEqual(t.generations.workers(), []);
  t.restore(); const process = {id: 'current'}; t.workers.W.instance = process;
  const [worker] = t.generations.workers(); assert.equal(worker.process, process); assert.equal(worker.className, 'warrior');
  assert.equal(t.generations.current(worker), true);
  t.workers.W.instance = {id: 'replacement'}; assert.equal(t.generations.current(worker), false);
  const disabled = fixture(false); disabled.run();
  assert.equal(disabled.generations, undefined); assert.ok(disabled.calls.some(call => call[0] === 'watch'));
  assert.deepEqual(disabled.calls.at(-1), ['account']);
});

test('worker preparation failure prevents timer, generation watch and account subscription', () => {
  const t = fixture(), failure = Error('watch failed'); t.ports.watch = () => {throw failure;};
  assert.throws(t.run, error => error === failure);
  assert.equal(t.calls.length, 4); assert.equal(t.workers.W.connected, false); assert.equal(t.workers.W.enabled, true);
});

const test = require('node:test'), assert = require('node:assert/strict');
const {startCharacters} = require('../../runtime/lifecycle/coordinator/start.ts');
const {lifecycleSavedFields} = require('../../runtime/lifecycle/fields.ts');

// startCharacters over recording ports: the slot preparation and restore are workers.ts's, whose
// rows are coordinator-startup-slots.test.cjs; the generation watch is code.ts's.
function fixture({watchCode = true, artifact = false} = {}) {
  const calls = [], listeners = {}; let restore;
  const ports = {events: {on: (event, listener) => {calls.push(['listen', event]); listeners[event] = listener;}},
    shutdown: async reason => calls.push(['shutdown', reason]),
    workers: {prepareSlots: () => calls.push(['prepare']), restoreSlots: () => calls.push(['restore']), accountChanged: account => calls.push(['account', account])},
    code: {watchGenerations: (directory, activation) => calls.push(['generations', directory, activation])},
    watchCode, artifact, subscribeAccount: listener => {calls.push(['subscribe']); listeners.account = listener;},
    started: () => ({realm: 'USII', generation: 'g1', reason: 'start'}), notify: (hook, payload) => calls.push([hook, payload]),
    timers: {setTimeout: (callback, ms) => {restore = callback; calls.push(['later', ms]);}}};
  return {calls, listeners, ports, run: () => startCharacters(ports), restore: () => restore()};
}

test('character startup installs hooks, prepares slots, schedules restoration and subscribes in order', async () => {
  const t = fixture(); t.run();
  assert.deepEqual(t.calls, [['listen', 'SIGINT'], ['listen', 'SIGTERM'], ['listen', 'SIGQUIT'], ['listen', 'message'], ['prepare'],
    ['later', lifecycleSavedFields.settings.slotRestoreDelayMs.default], ['generations', './CODE/adventure_land', undefined], ['subscribe'],
    ['lifecycle.started', {realm: 'USII', generation: 'g1', reason: 'start', by: 'core:lifecycle'}]]);
  t.restore(); assert.deepEqual(t.calls.at(-1), ['restore']);
  t.listeners.account({id: 'a'}); assert.deepEqual(t.calls.at(-1), ['account', {id: 'a'}]);
  t.listeners.message({type: 'coordinator_shutdown'}); await Promise.resolve();
  assert.deepEqual(t.calls.at(-1), ['shutdown', 'coordinator reload request']);
});

test('the generation watch follows watch_CODE or the activation record, and stays off with neither', () => {
  const artifact = fixture({watchCode: false, artifact: true}); artifact.run();
  assert.deepEqual(artifact.calls.find(call => call[0] === 'generations'), ['generations', './CODE/adventure_land', './CODE/adventure_land/activation.json']);
  const disabled = fixture({watchCode: false}); disabled.run();
  assert.equal(disabled.calls.some(call => call[0] === 'generations'), false);
  assert.ok(disabled.calls.some(call => call[0] === 'subscribe'));
});

test('worker preparation failure prevents timer, generation watch and account subscription', () => {
  const t = fixture(), failure = Error('watch failed'); t.ports.workers.prepareSlots = () => {throw failure;};
  assert.throws(t.run, error => error === failure);
  assert.equal(t.calls.length, 4);
});

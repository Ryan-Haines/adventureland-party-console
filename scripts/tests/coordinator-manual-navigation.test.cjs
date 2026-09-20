const test = require('node:test'), assert = require('node:assert/strict');
const {createCoordinatorManualNavigation} = require('../../runtime/coordinator/navigation/manual-composition.ts');

function fixture() {
  const state = {merchantCharacter: 'M', leader: 'W', activeRealm: 'SR_USII', nextCommandId: 20,
    statuses: {W: {seenAt: 100000}, P: {seenAt: 100000}}, characterLocations: {}, commands: {},
    farmAreaState: {paused: true, failures: {old: 2}, pending: 'retry', message: 'blocked'}};
  const calls = [], timers = [], block = {realm: 'SR_EUI', connected: true};
  const service = createCoordinatorManualNavigation(state, {
    now: () => 100000, queue: (names, reason) => calls.push(['queue', names, reason]), releaseEscape: () => calls.push(['release']),
    navigation: {members: () => ['W', 'P'], invalidate: (...args) => calls.push(['invalidate', ...args]),
      authorize: (names, location, shared) => {calls.push(['authorize', names, location, shared]); for (const name of names) state.characterLocations[name] = location;}},
    convoy: (...args) => calls.push(['convoy', ...args]), block: () => block, resolveRealm: () => true, realmLabel: realm => realm,
    stop: async worker => calls.push(['stop', worker]), later: (callback, ms) => {timers.push(callback); calls.push(['later', ms]);},
    log: message => calls.push(['log', message]), persist: () => calls.push(['persist']),
  });
  return {state, calls, timers, block, service};
}

test('manual party travel resets recovery but keeps an event return deferred', () => {
  const t = fixture(), destination = {map: 'cave', x: 4, y: 8}; t.state.statuses.P.joinedEvent = 'franky';
  const result = t.service.handle({type: 'party-monster-travel', character: 'W', location: destination, resumeAfterEvent: true});
  assert.deepEqual(result, {status: 200, body: {ok: true, deferredUntilEventEnd: true}});
  assert.deepEqual(t.calls, [['release'], ['authorize', ['W', 'P'], destination, true]]);
  assert.deepEqual(t.state.farmAreaState, {paused: false, failures: {}, pending: null, message: null, recoveryVersion: 2});
  assert.equal(t.state.characterLocations.P, destination);
});

test('individual travel and merchant home preserve command IDs and delayed worker restart', async () => {
  const t = fixture();
  assert.equal(t.service.handle({type: 'character-travel', character: 'P', location: {map: 'main', x: '1', y: '2'}}), null);
  assert.equal(t.state.commands.P.id, 20); assert.equal(t.state.commands.P.location, t.state.characterLocations.P);
  assert.deepEqual(t.calls[0], ['release']);
  t.calls.length = 0;
  assert.equal(t.service.handle({type: 'go-home', character: 'M'}), null);
  assert.equal(t.block.realm, 'SR_USII'); assert.equal(t.state.commands.M.id, 21);
  assert.deepEqual(t.calls.slice(-2), [['persist'], ['later', 150]]);
  assert.equal(t.calls.some(call => call[0] === 'stop'), false);
  await t.timers[0](); assert.deepEqual(t.calls.at(-1), ['stop', t.block]);
  t.calls.length = 0;
  t.service.handle({type: 'character-travel', character: 'M', location: {map: 'bank', x: 0, y: 0}});
  assert.equal(t.calls.some(call => call[0] === 'release'), false); assert.equal(t.state.commands.M.id, 22);
});

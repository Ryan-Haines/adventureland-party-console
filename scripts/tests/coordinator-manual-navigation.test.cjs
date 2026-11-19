const test = require('node:test'), assert = require('node:assert/strict');
const {createCoordinatorManualNavigation} = require('../../runtime/movement/coordinator/arrivals.ts');
const {createMerchantHomeCommand} = require('../../runtime/merchant-realm/api.ts');

function fixture() {
  const state = {merchantCharacter: 'M', leader: 'W', activeRealm: 'SR_USII', nextCommandId: 20,
    statuses: {W: {seenAt: 100000}, P: {seenAt: 100000}}, characterLocations: {}, commands: {},
    farmAreaState: {paused: true, failures: {old: 2}, pending: 'retry', message: 'blocked'}};
  const calls = [], timers = [], block = {realm: 'SR_EUI', connected: true};
  const persist = () => calls.push(['persist']), stop = async worker => calls.push(['stop', worker]);
  // Go home is the realm owner's command, built on its ports as application.ts builds it,
  // on the fixture's clock, which stands at the reports' time.
  const home = createMerchantHomeCommand(state, {now: () => state.statuses.W.seenAt, nextCommand: () => state.nextCommandId++, block: () => block,
    realmExists: () => true, realmLabel: realm => realm, restart: stop, log: message => calls.push(['log', message]), persist});
  const service = createCoordinatorManualNavigation(state, {home,
    now: () => 100000, queue: (names, reason) => calls.push(['queue', names, reason]), releaseEscape: () => calls.push(['release']),
    navigation: {members: () => ['W', 'P'], invalidate: (...args) => calls.push(['invalidate', ...args]),
      authorize: (names, location, shared) => {calls.push(['authorize', names, location, shared]); for (const name of names) state.characterLocations[name] = location;}},
    convoy: (...args) => calls.push(['convoy', ...args]), caller: () => undefined, block: () => block, resolveRealm: () => true, realmLabel: realm => realm,
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

test('individual travel and merchant home preserve command IDs and restart the worker at the write', async () => {
  const t = fixture();
  assert.equal(t.service.handle({type: 'character-travel', character: 'P', location: {map: 'main', x: '1', y: '2'}}), null);
  assert.equal(t.state.commands.P.id, 20); assert.equal(t.state.commands.P.location, t.state.characterLocations.P);
  assert.deepEqual(t.calls[0], ['release']);
  t.calls.length = 0;
  assert.equal(t.service.handle({type: 'go-home', character: 'M'}), null);
  assert.equal(t.block.realm, 'SR_USII'); assert.equal(t.state.commands.M.id, 21);
  // Go home's reply goes to the dashboard, so the worker stops at the write (3.10 rule 5).
  assert.deepEqual(t.calls.slice(-2), [['persist'], ['stop', t.block]]);
  assert.equal(t.timers.length, 0);
  t.calls.length = 0;
  t.service.handle({type: 'character-travel', character: 'M', location: {map: 'bank', x: 0, y: 0}});
  assert.equal(t.calls.some(call => call[0] === 'release'), false); assert.equal(t.state.commands.M.id, 22);
});

test('Town invalidates shared intent only for the party leader', () => {
  const t = fixture();
  assert.equal(t.service.handle({type: 'town', character: 'W'}), null);
  assert.deepEqual(t.calls.find(call => call[0] === 'invalidate'), ['invalidate', ['W', 'P'], 'manual Town', true]);
  assert.equal(t.state.commands.W.label, 'town');
  t.calls.length = 0;
  assert.equal(t.service.handle({type: 'town', character: 'P'}), null);
  assert.deepEqual(t.calls.find(call => call[0] === 'invalidate'), ['invalidate', ['P'], 'manual Town', false]);
  assert.equal(t.state.commands.P.label, 'town');
});

test('return to leader rejects stale status; bank commands keep their merchant-specific routing', () => {
  const t = fixture();
  Object.assign(t.state.statuses.W, {map: 'cave', x: 7, y: 9});
  assert.equal(t.service.handle({type: 'return-leader', character: 'P'}), null);
  assert.equal(t.state.commands.P.type, 'return-leader');
  assert.deepEqual(t.calls.find(call => call[0] === 'authorize'), ['authorize', ['P'], {map: 'cave', x: 7, y: 9}, undefined]);
  assert.equal(t.service.handle({type: 'return-leader', character: 'W'}).status, 409, 'the leader has no other leader to join');
  t.state.statuses.W.seenAt = 0;
  assert.equal(t.service.handle({type: 'return-leader', character: 'P'}).status, 409, 'a stale leader report is refused');
  t.calls.length = 0;
  t.service.handle({type: 'bank', character: 'P'}); t.service.handle({type: 'bank', character: 'M'});
  const queued = t.calls.filter(call => call[0] === 'queue');
  assert.equal(queued.length, 2); assert.notEqual(queued[0][2], queued[1][2], 'the merchant has its own bank visit reason');
});

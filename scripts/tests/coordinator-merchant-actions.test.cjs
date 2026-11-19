const test = require('node:test'), assert = require('node:assert/strict');
const {settingsWriter}=require('./helpers/settings-writer.cjs');
const {createCoordinatorMerchantActions} = require('../../runtime/merchant-jobs/coordinator/routes.ts');
const {createMerchantRealmOwner} = require('../../runtime/merchant-realm/coordinator/owner.ts');

function fixture() {
  const state = {merchantCharacter: 'M', nextCommandId: 40, activeRealm: 'SR_USII', merchantQueue: [], merchantCurrent: null,
    commands: {}, merchantAutomations: {}, autoExchanges: {}, marked: {}, merchantMarked: {}, statScrolls: {}, upgrades: {},
    compounds: {}, autoCompounds: {}, gatheringModes: [], statuses: {M: {}}, standSearch: null,
    aldata: {marketListings: [], marketBuyOrders: []}, ponty: {listings: []}};
  const block = {realm: 'SR_EUI'}, calls = [], timers = [];
  // The realm owner answers force stand's want; its headless restart stops the worker at the write.
  const realm = createMerchantRealmOwner(state, {now: () => 100000, block: name => {assert.equal(name, 'M'); return block;},
    realmLabel: value => value, log() {}, persist: () => calls.push(['persist']), restart: value => calls.push(['stop', value])});
  const service = createCoordinatorMerchantActions(state, {
    now: () => 100000, stamp: job => ({...job, priority: 50}), log: message => calls.push(['log', message, block.realm]),
    persist: () => calls.push(['persist']), dispatch: () => calls.push(['dispatch']), plan: () => [], automations: {}, write: settingsWriter(state).write,
    resolveRealm: realm => realm === 'SR_USII', realmLabel: realm => realm, realm,
  });
  const invoke = (handler, body) => {let result; handler({body}, {json: value => {result = value;}, status: code => assert.fail('HTTP ' + code)}); return result;};
  return {state, block, calls, timers, service, invoke};
}

test('merchant force-stand pauses active work and prepares the home realm before deferred restart', async () => {
  const t = fixture(); t.state.merchantCurrent = {id: 'active', target: 'M', reason: 'service', phase: 'working', startedAt: 1, heartbeatAt: 2};
  t.state.commands.M = {id: 1, type: 'merchant-service'};
  t.invoke(t.service.controls.force, {enabled: true});
  assert.equal(t.state.merchantCurrent, null); assert.equal(t.state.commands.M, undefined);
  assert.equal(t.state.merchantQueue[0].id, 'active'); assert.equal(t.state.merchantQueue[0].phase, undefined);
  assert.equal(t.state.merchantQueue[0].priority, 50);
  assert.equal(t.block.realm, 'SR_USII'); assert.equal(t.state.merchantRealmRequests.M.owner, 'user:force-stand');
  // The realm owner's one path (3.10 rule 5): the force stand reply goes to the dashboard, so the
  // headless worker stops once `block.realm` is written.
  assert.deepEqual(t.calls.slice(-4), [['stop', t.block], ['persist'], ['log', 'Force stand returning M to SR_USII', 'SR_USII'], ['persist']]);
});

// MJ43: force stand moves a Steam merchant home at once, with no arrival window first.
test('MJ43: force stand sends a Steam merchant home at once', () => {
  const t = fixture(); t.state.statuses.M = {runtime: 'native'};
  t.invoke(t.service.controls.force, {enabled: true});
  assert.deepEqual([t.state.commands.M.type, t.state.commands.M.realm], ['native-realm-switch', 'SR_USII']);
  assert.equal(t.calls.some(call => call[0] === 'stop'), false);
});

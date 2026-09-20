const test = require('node:test'), assert = require('node:assert/strict');
const {createCoordinatorMerchantActions} = require('../../runtime/coordinator/http/merchant-actions.ts');

function fixture() {
  const state = {merchantCharacter: 'M', nextCommandId: 40, activeRealm: 'SR_USII', merchantQueue: [], merchantCurrent: null,
    commands: {}, merchantAutomations: {}, autoExchanges: {}, marked: {}, merchantMarked: {}, statScrolls: {}, upgrades: {},
    compounds: {}, autoCompounds: {}, gatheringModes: [], statuses: {M: {}}, standSearch: null,
    aldata: {marketListings: [], marketBuyOrders: []}, ponty: {listings: []}};
  const block = {realm: 'SR_EUI'}, calls = [], timers = [];
  const service = createCoordinatorMerchantActions(state, {
    now: () => 100000, stamp: job => ({...job, priority: 50}), log: message => calls.push(['log', message, block.realm]),
    persist: () => calls.push(['persist']), dispatch: () => calls.push(['dispatch']), plan: () => [], automations: {},
    resolveRealm: realm => realm === 'SR_USII', block: name => {assert.equal(name, 'M'); return block;}, realmLabel: realm => realm,
    stop: async value => calls.push(['stop', value]), later: (callback, ms) => {timers.push(callback); calls.push(['later', ms]);},
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
  assert.equal(t.state.merchantQueue[0].priority, 50); assert.equal(t.state.merchantHomeReturnAt, 100000);
  assert.equal(t.block.realm, 'SR_USII');
  assert.deepEqual(t.calls.slice(-3), [['log', 'Force stand returning M to SR_USII', 'SR_USII'], ['later', 100], ['persist']]);
  assert.equal(t.calls.some(call => call[0] === 'stop'), false);
  await t.timers[0](); assert.deepEqual(t.calls.at(-1), ['stop', t.block]);
});

test('manual orders, merchant requests and controls share one current command sequence', () => {
  const t = fixture();
  assert.equal(t.invoke(t.service.requests.donate, {amount: 10}).jobId, 'merchant-100000-40');
  t.invoke(t.service.controls.clear, {}); assert.equal(t.state.commands.M.id, 41); assert.equal(t.state.merchantQueue.length, 0);
  t.state.statuses = {M: {nearbyStandListings: [{seller: 'Seller', slot: 'trade1', rid: 12,
    item: {name: 'helmet'}, price: 100, quantity: 2}]}};
  assert.equal(t.invoke(t.service.orders.stand, {listings: [{seller: 'Seller', slot: 'trade1', rid: 12,
    itemName: 'helmet', price: 100, buyQuantity: 1}]}).jobId, 'merchant-100000-42');
  assert.equal(t.invoke(t.service.requests.giveaway, {seller: 'Seller', realm: 'US II'}).jobId, 'merchant-100000-43');
  assert.equal(t.state.nextCommandId, 44); assert.equal(t.state.merchantQueue[1].priority, 50);
  assert.equal(t.calls.filter(call => call[0] === 'dispatch').length, 3);
});

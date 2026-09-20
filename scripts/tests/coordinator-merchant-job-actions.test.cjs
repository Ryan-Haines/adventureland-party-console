const test = require('node:test'), assert = require('node:assert/strict');
const {createCoordinatorMerchantJobActions} = require('../../runtime/coordinator/http/merchant-job-actions.ts');

function fixture() {
  const state = {merchantCharacter: 'M', merchantCurrent: null, merchantQueue: [], nextCommandId: 70,
    activeRealm: 'SR_USII', statuses: {}, commands: {}, gatheringModes: [], gatheringCooldowns: {},
    standBids: {}, marked: {}, merchantMarked: {}};
  const calls = [], timers = [], block = {realm: 'SR_USII', connected: true};
  const offer = {key: 'offer', seller: 'Seller', buyer: 'Buyer', serverRegion: 'US', serverIdentifier: 'II',
    item: {name: 'helmet', level: 0}, quantity: 1, price: 100, map: 'main', x: 0, y: 0};
  const service = createCoordinatorMerchantJobActions(state, {
    now: () => 100000, priority: job => job.priority || 0, routinePriority: () => 0,
    persist: () => calls.push('persist'), stamp: job => ({...job, priority: 50}), log: () => calls.push('log'),
    dispatch: () => calls.push('dispatch'), active: () => Object.keys(state.statuses),
    fulfill: (item, quantity) => calls.push(['fulfill', item, quantity]), dismiss: key => calls.push(['dismiss', key]),
    blacklist: () => assert.fail('unexpected blacklist'), resolve: realm => realm === 'SR_EUI' || realm === 'SR_USII',
    block: () => block, label: realm => realm, stop: async value => calls.push(['stop', value]),
    later: (callback, delay) => {calls.push('later'); timers.push({callback, delay});},
    fetchMarket: async path => {calls.push(path); return ['Seller', 'Buyer'].map(id => ({id, map: 'main', x: 100, y: 0, serverRegion: 'US', serverIdentifier: 'II'}));},
    normalizePurchases: records => {calls.push(['purchases', records[0].id]); return [{...offer, x: 100}];},
    normalizeSales: records => {calls.push(['sales', records[0].id]); return [{...offer, x: 200}];},
  });
  async function invoke(handler, body) {
    let code = 200, value;
    const res = {status: status => {code = status; return res;}, json: result => {calls.push('response'); value = result; return result;}};
    await handler({body, params: {}, query: {}}, res);
    return {code, value};
  }
  return {state, calls, timers, block, offer, service, invoke};
}

test('merchant job realm changes respond before scheduling a restart and reject stale reports', async () => {
  const t = fixture(); t.state.merchantCurrent = {id: 'job', target: 'M', reason: 'Ponty purchases'};
  assert.equal((await t.invoke(t.service.realms.switchRealm, {jobId: 'old', character: 'M', realm: 'SR_EUI'})).code, 409);
  assert.equal(t.timers.length, 0); t.calls.length = 0;
  assert.equal((await t.invoke(t.service.realms.switchRealm, {jobId: 'job', character: 'M', realm: 'SR_EUI'})).code, 200);
  assert.deepEqual(t.calls, ['log', 'persist', 'response', 'later']);
  assert.equal(t.block.realm, 'SR_EUI'); assert.equal(t.state.merchantCurrent.phase, 'switching realm');
  assert.equal(t.timers[0].delay, 150); await t.timers[0].callback(); assert.equal(t.calls.at(-1)[1], t.block);
  t.state.merchantCurrent = {id: 'new', phase: 'assigned'};
  await t.invoke(t.service.progress.heartbeat, {jobId: 'new'});
  assert.equal(t.state.merchantCurrent.phase, 'processing'); assert.equal(t.state.merchantCurrent.heartbeatAt, 100000);
});

test('marketplace location refresh selects the correct feed normalization and permits only one retry', async () => {
  for (const sale of [false, true]) {
    const t = fixture();
    t.state.merchantCurrent = {id: 'job', reason: sale ? 'ALData marketplace sales' : 'ALData marketplace purchases',
      buyOrder: t.offer, listings: [t.offer]};
    const report = {jobId: 'job', listingKey: 'offer'};
    assert.deepEqual((await t.invoke(t.service.location, report)).value, {location: {map: 'main', x: sale ? 200 : 100, y: 0}});
    assert.deepEqual(t.calls.slice(0, 3), ['persist', '/merchants', [sale ? 'sales' : 'purchases', sale ? 'Buyer' : 'Seller']]);
    assert.equal((await t.invoke(t.service.location, report)).value.reason, 'location retry already used');
    assert.equal(t.calls.filter(call => call === '/merchants').length, 1);
  }
});

test('cluster reports use the live command sequence and Ponty acknowledgements remain idempotent', async () => {
  const t = fixture();
  t.state.statuses = {P: {seenAt: 100000, map: 'main', x: 0, y: 0}, Q: {seenAt: 100000, map: 'main', x: 10, y: 0}};
  t.state.marked.Q = [1]; t.state.nextCommandId = 90;
  t.state.merchantCurrent = {id: 'job', target: 'P', reason: 'marked items'};
  await t.invoke(t.service.clusters.marked, {jobId: 'job'});
  await t.invoke(t.service.clusters.marked, {jobId: 'job'});
  assert.equal(t.state.merchantQueue.length, 1); assert.equal(t.state.merchantQueue[0].id, 'merchant-100000-90');
  assert.equal(t.state.merchantQueue[0].priority, 50); assert.equal(t.state.nextCommandId, 91);
  t.state.merchantCurrent = {id: 'ponty', reason: 'Ponty purchases', listings: [t.offer]};
  t.state.commands = {M: {}};
  const report = {jobId: 'ponty', listingKey: 'offer', success: true};
  await t.invoke(t.service.marketplace.ponty, report); await t.invoke(t.service.marketplace.ponty, report);
  assert.equal(t.calls.filter(call => call[0] === 'fulfill').length, 1);
  assert.equal(t.calls.filter(call => call[0] === 'dismiss').length, 1);
  assert.deepEqual(t.state.commands.M.completedListingKeys, ['offer']);
});

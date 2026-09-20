const test = require('node:test');
const assert = require('node:assert/strict');
const { createMerchantQueue } = require('../../runtime/coordinator/merchant/queue.ts');
const { evaluateAutoCompounds, planAutoExchanges } = require('../../runtime/coordinator/merchant/automatic-improvements.ts');

function fixture() {
  const state = { queue: [], current: null, blocks: {} }, effects = [];
  let id = 0;
  const ports = { merchant: () => 'M', bankboi: name => name === 'B', capacitySignature: () => 'new',
    gold: () => ({bank: 20, merchant: 10}), nextId: () => String(++id), now: () => 1000,
    routinePriority: reason => reason === 'marked items' ? 90 : 50,
    priority: job => job.priority ?? ports.routinePriority(job.reason),
    stamp: job => ({...job, priority: ports.routinePriority(job.reason)}),
    hasPendingStandInventory: () => true, persist: () => effects.push('persist'),
    dispatch: () => effects.push('dispatch'), log: message => effects.push(message) };
  return {state, ports, effects, service: createMerchantQueue(state, ports)};
}

test('saved deconstruction pickups become ordinary collection without dispatching immediately', () => {
  const {state, ports, effects} = fixture();
  state.queue.push({id:'old',target:'P',reason:'deconstruction pickup',priority:80});
  createMerchantQueue(state, ports);
  assert.equal(state.queue[0].reason,'marked items');
  assert.equal(state.queue[0].priority,90);
  assert.deepEqual(effects,[]);
});

test('queue deduplicates party visits but retains distinct merchant jobs', () => {
  const {state, service, effects} = fixture();
  service.queue(['P', 'P', null, 'B', 'M'], 'marked items');
  service.queue(['P', 'M'], 'manual visit');
  assert.deepEqual(state.queue.map(job => [job.target, job.reason]), [['P', 'manual visit'], ['M', 'marked items'], ['M', 'manual visit']]);
  assert.equal(state.queue[0].id, '1');
  assert.deepEqual(effects.slice(-2), ['persist', 'dispatch']);
});

test('blocked inventory waits for a capacity change; blocked gold waits for gold', () => {
  const {state, service} = fixture();
  state.blocks['P\nservice'] = {capacitySignature: 'new'};
  state.blocks['Q\nservice'] = {bankGold: 20, merchantGold: 10};
  service.queue(['P', 'Q']);
  assert.equal(state.queue.length, 0);
  state.blocks['P\nservice'].capacitySignature = 'old';
  state.blocks['Q\nservice'].bankGold = 19;
  service.queue(['P', 'Q']);
  assert.equal(state.queue.length, 2);
  assert.deepEqual(state.blocks, {});
});

test('active work is not duplicated; in-place stand sync retains its special priority', () => {
  const {state, service} = fixture();
  state.current = {id: 'active', target: 'P', reason: 'manual visit'};
  service.queue(['P']);
  assert.equal(state.queue.length, 0);
  assert.equal(service.localStandSync(), true);
  assert.equal(service.localStandSync(), false);
  assert.equal(state.queue[0].priorityOverride, 99);
  assert.equal(state.queue[0].inPlaceStandSync, true);
});

test('compound targets count new production and require three unlocked ingredients at one level', () => {
  const item = (name, level, locked) => ({item: {name, level, l: locked}});
  const result = evaluateAutoCompounds([{name:'ring', targetTier:2, quantity:1}, {name:'amulet', targetTier:2}],
    [item('ring',2), item('amulet',1), item('amulet',1), item('amulet',1)]);
  assert.equal(result.runnable, true);
  assert.deepEqual(result.remaining.map(rule => rule.name), ['ring','amulet']);
  assert.deepEqual(result.completed, []);
  assert.equal(evaluateAutoCompounds([{name:'ring',targetTier:2}], [item('ring',1),item('ring',1),item('ring',1,true)]).runnable,false);
});

test('automatic exchanges preserve levels and count whole quantities across supplied inventories', () => {
  const result = planAutoExchanges({leather:{name:'leather'}, sword:{name:'sword',level:1}},
    [{id:'leather',required:20},{id:'sword',level:1,required:3}],
    [{item:{name:'leather',q:19}},{item:{name:'leather',q:22}},{item:{name:'sword',level:0,q:99}}]);
  assert.deepEqual(result, {lines:[{id:'leather',level:0,quantity:2}],keys:['leather']});
});

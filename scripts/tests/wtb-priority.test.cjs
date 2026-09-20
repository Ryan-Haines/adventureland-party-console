const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = require('./helpers/coordinator-source.cjs').coordinatorSource();
function runtime() {
  const party = { standBids: { cheap: { priorityOverride: 0 }, urgent: { priorityOverride: 100 }, normal: {} }, standListings: [],
    merchantRoutinePriorities: { 'stand bid purchases': 40, 'ALData marketplace purchases': 60,
      'party collection': 90, 'inventory cleanout': 95 }, merchantQueue: [], merchantCharacter: 'M',
    merchantJobBlocks: {}, statuses: {}, bankbois: {}, nextCommandId: 1 };
  const r = vm.createContext({ party, coordinatorPolicies: require('../../runtime/coordinator/index.ts'), persistSettings() {}, dispatchMerchant() {}, merchantLog() {} });
  vm.runInContext(source.slice(source.indexOf('  function merchantRoutinePriority('), source.indexOf('  function merchantCapacitySignature(')), r);
  vm.runInContext(source.slice(source.indexOf('  function merchantCapacitySignature('), source.indexOf('  function scheduleNearbyGiveaways(')), r);
  require('./helpers/coordinator-merchant.cjs').merchantQueueRuntime(r);
  return { r, party };
}
test('WTB overrides apply to Ponty, local and world merchants; automatic sources share a default and manual purchases retain theirs', () => {
  const { r } = runtime();
  for (const reason of ['Ponty purchases', 'stand bid purchases', 'ALData marketplace purchases']) {
    assert.equal(r.merchantJobPriority({ reason, bidItemId: 'urgent' }), 100);
    assert.equal(r.merchantJobPriority({ reason, bidItemId: 'cheap' }), 0);
    assert.equal(r.merchantJobPriority({ reason, bidItemId: 'normal' }), 40);
    assert.equal(r.merchantJobPriority({ reason }), reason === 'stand bid purchases' ? 40 : 75);
  }
});
test('marked collection uses Party collection priority and full-inventory work raises the queued job', () => {
  const { r, party } = runtime();
  party.itemCollectionThreshold = 1;
  party.statuses.Q = { seenAt: Date.now(), items: [{slot: 0, item: {name: 'coat'}}] };
  party.marked = { Q: [{slot: 0, item: {name: 'coat'}}] };
  r.queueMerchant(['Q'], 'marked items');
  assert.equal(party.merchantQueue[0].priority, 90);
  r.queueMerchant(['Q'], 'inventory cleanout');
  assert.equal(party.merchantQueue.length, 1);
  assert.equal(party.merchantQueue[0].reason, 'inventory cleanout');
  assert.equal(party.merchantQueue[0].priority, 95);
});
test('local stand sync outranks optional work and is deduplicated', () => {
  const { r, party } = runtime();
  party.standListings.push({ id: 'listing', state: 'configured', item: { name: 'coat' }, slot: 4 });
  assert.equal(r.queueLocalStandSync(), true);
  assert.equal(r.queueLocalStandSync(), false);
  assert.equal(party.merchantQueue.length, 1);
  assert.equal(party.merchantQueue[0].priority, 99);
  assert.equal(party.merchantQueue[0].inPlaceStandSync, true);
});
test('live stand listings do not claim inventory slots that the bag has reused', () => {
  const {createStandMarks}=require('../../runtime/coordinator/merchant/stand-marks.ts');
  const item={name:'ring',level:2};
  const state={merchantCharacter:'M',standListings:[{id:'live',slot:3,item,state:'live',tradeSlot:'trade1'}],
    withdrawals:{},statuses:{M:{items:[{slot:3,item}]}},bankSnapshot:null};
  const marks=createStandMarks(state,{now:()=>1,nextCommand:()=>2});
  assert.equal(marks.find(null,null,3,item),-1);
  marks.markAll(item,100);
  assert.equal(state.standListings.length,2);
  assert.equal(state.standListings[0].id,'live');
  assert.equal(state.standListings[1].slot,3);
  const {createAutomaticMerchantSales}=require('../../runtime/coordinator/merchant/automatic-sales.ts');
  const {automaticCommerceRuleKey}=require('../../runtime/coordinator/inventory/item-identity.ts');
  state.standListings.splice(1);
  Object.assign(state.standListings[0],{state:'live',tradeSlot:'trade1'});
  Object.assign(state,{autoNpcSales:{},autoStandMarks:{[automaticCommerceRuleKey(item)]:{price:100}},
    npcSaleMarks:[],merchantCurrent:null,merchantQueue:[]});
  const automatic=createAutomaticMerchantSales(state,{now:()=>1,nextCommand:()=>3,queue(){},
    publish(){},syncStand:()=>true,idle(){},persist(){}});
  automatic.reconcile({name:'M',items:[{slot:3,item}]});
  assert.equal(state.standListings.length,2);
  assert.equal(state.standListings[0].id,'live');
  assert.equal(state.standListings[1].slot,3);
});
test('party transfers are ineligible while only the three-slot logistics reserve remains', () => {
  const { r, party } = runtime();
  party.statuses.M = { items: Array.from({ length: 42 }, (_, slot) => slot < 39 ? { item: { name: 'x' } } : null) };
  party.merchantQueue.push(
    r.stampMerchantJob({ id: 'transfer', target: 'Q', reason: 'inventory cleanout', queuedAt: 1 }),
    r.stampMerchantJob({ id: 'self-clean', target: 'M', reason: 'npc sales', priorityOverride: 80, queuedAt: 2 }),
  );
  assert.equal(r.merchantTransferCapacityBlocked(party.merchantQueue[0]), true);
  assert.equal(r.pickJobByPriority().id, 'self-clean');
  assert.equal(party.merchantQueue[0].id, 'transfer');
});
test('queued jobs use live saved overrides and reverting to default takes effect', () => {
  const { r, party } = runtime();
  party.merchantQueue = ['cheap', 'normal', 'urgent'].map((bidItemId, queuedAt) => ({ bidItemId, queuedAt, reason: 'Ponty purchases' }));
  assert.equal(r.pickJobByPriority().bidItemId, 'urgent');
  party.standBids.cheap.priorityOverride = 90;
  assert.equal(r.pickJobByPriority().bidItemId, 'cheap');
  delete party.standBids.cheap.priorityOverride;
  assert.equal(r.merchantJobPriority({ bidItemId: 'cheap', reason: 'Ponty purchases' }), 40);
});
test('matching considers urgent bids first instead of insertion order', () => {
  const { r } = runtime();
  assert.equal(r.prioritizedStandBids('Ponty purchases').map(([id]) => id).join(','), 'urgent,normal,cheap');
});

test('bid API persists zero, preserves omitted overrides, clears null and rejects invalid values without cancelling jobs', () => {
  let cancelled = 0, saved = 0, status;
  const party = { standBids: { belt: { priorityOverride: 75 } }, merchantCatalog: { allItems: [{ id: 'belt' }] }, statuses: {} };
  const {createMerchantBidRoute}=require('../../runtime/coordinator/http/merchant-bid.ts');
  const handler=createMerchantBidRoute(party,{removeQueued:()=>cancelled++,persist:()=>saved++,log(){},
    observe(){},publish(){},ponty:()=>true,aldata(){},dispatch(){}});
  const send = fields => { status = 200; const res = { status: code => { status = code; return res; }, json() {} };
    handler({ body: { itemId: 'belt', price: 100, quantity: 3, ...fields } }, res); };
  send({}); assert.equal(party.standBids.belt.priorityOverride, 75);
  send({ priorityOverride: 0 }); assert.equal(party.standBids.belt.priorityOverride, 0);
  send({ priorityOverride: null }); assert.equal(party.standBids.belt.priorityOverride, undefined);
  for (const priorityOverride of [-1, 101, 0.5, 'invalid']) {
    send({ priorityOverride }); assert.equal(status, 400);
  }
  assert.equal(saved, 3); assert.equal(cancelled, 3);
  assert.equal(JSON.parse(JSON.stringify(party.standBids)).belt.quantity, 3);
});

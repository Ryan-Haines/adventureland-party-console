const test = require('node:test'), assert = require('node:assert/strict');
const { createCoordinatorMerchantQueue } = require('../../runtime/coordinator/merchant/queue-composition.ts');
function fixture() {
  const state = { merchantQueue: [], merchantCurrent: null, merchantJobBlocks: {}, merchantCharacter: 'M',
    bankbois: { V: {} }, bankSnapshot: { gold: '100' }, statuses: { M: { gold: '20' } }, nextCommandId: 7, standListings: [] };
  const calls = []; let now = 100;
  const service = createCoordinatorMerchantQueue(state, { now: () => now++, capacitySignature: () => 'capacity',
    routinePriority: () => 1, priority: () => 1, stamp: job => job,
    persist: () => calls.push('persist'), dispatch: () => calls.push('dispatch'), log: message => calls.push(message) });
  return { state, calls, service };
}
test('queue composition filters BankBois and sequences IDs/timestamps against replacement queues', () => {
  const f = fixture(); f.service.queue(['V','A','A']);
  assert.deepEqual(f.state.merchantQueue, [{ id: 'merchant-100-7', target: 'A', reason: 'service', queuedAt: 101 }]);
  assert.deepEqual(f.calls, ['persist','dispatch']); assert.equal(f.state.nextCommandId, 8);
  f.state.merchantQueue = []; f.service.queue(['B']);
  assert.equal(f.state.merchantQueue[0].target, 'B');
});

test('collection eligibility is enforced before enqueue while explicit visits remain available',()=>{
 const state={merchantQueue:[],merchantCurrent:null,merchantJobBlocks:{},merchantCharacter:'M',statuses:{},nextCommandId:1};
 let eligible=false;
 const service=createCoordinatorMerchantQueue(state,{now:()=>100,collectionReady:()=>eligible,capacitySignature:()=>'',routinePriority:()=>90,priority:()=>90,stamp:j=>j,persist(){},dispatch(){},log(){}});
 service.queue(['P'],'marked items');assert.deepEqual(state.merchantQueue,[]);
 eligible=true;service.queue(['P'],'marked items');assert.equal(state.merchantQueue.length,1);
 state.merchantQueue=[];eligible=false;service.queue(['P'],'party collection');assert.equal(state.merchantQueue.length,1);
});
test('resource blocks compare coerced live balances and stand sync excludes live or banked inventory', () => {
  const f = fixture(); f.state.merchantJobBlocks['M\nservice'] = { bankGold: 100, merchantGold: 20 };
  f.service.queue(['M']); assert.equal(f.state.merchantQueue.length, 0);
  f.state.statuses.M.gold = '21'; f.service.queue(['M']); assert.equal(f.state.merchantQueue.length, 1);
  assert.equal(f.state.merchantJobBlocks['M\nservice'], undefined);
  f.state.standListings = [null, { state: 'live' }, { state: 'pending', bankPack: 'items0' }];
  assert.equal(f.service.localStandSync(), false);
  f.state.standListings.push({ state: 'pending' });
  assert.equal(f.service.localStandSync(), true); assert.equal(f.service.localStandSync(), false);
  assert.equal(f.state.merchantQueue.at(-1).priorityOverride, 99);
});

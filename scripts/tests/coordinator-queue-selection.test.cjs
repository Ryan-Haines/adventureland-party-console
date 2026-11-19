const test = require('node:test'), assert = require('node:assert/strict');
const {takeCoordinatorMerchantJob: take,coordinatorCollectionReady: ready,coordinatorCollectionSlots: slots,coordinatorCollectionNearby: nearby} = require('../../runtime/merchant-jobs/coordinator/owner.ts'),{coordinatorReadyFacts} = require('../../runtime/merchant-jobs/coordinator/dispatch.ts');
const {coordinatorMerchantTransferBlocked} = require('../../runtime/merchant-jobs/rules.ts');
const {partyHooks} = require('../../runtime/hooks/index.ts');
// The pick reads the dispatch pass's facts; the other owners' answers hold nothing here.
partyHooks().publish({name: 'core:queue-selection-reads', folder: 'core', author: 'test', summary: 'Nothing holds a job.',
  hooks: {'cave.state': () => ({owned: false}), 'items.needs': () => ({gold: 0, withdrawals: [], slots: 0, postage: 0})}});
const pass = (state, now) => coordinatorReadyFacts(state, {now: () => now,
  capacityBlocked: job => coordinatorMerchantTransferBlocked(state, job), collectionReady: job => ready(state, job, () => now)});

function fixture() {
  const items = [0, 1].map(slot => ({slot, item: {name: 'item' + slot, q: 999}}));
  const state = {merchantCharacter: 'M', statuses: {
    M: {map: 'main', server: 'II', in: 'main', x: 1000, y: 0, seenAt: 100000, items: Array(42).fill(null)},
    P: {map: 'main', server: 'II', in: 'main', x: 0, y: 0, seenAt: 100000, items}},
    marked: {P: items}, merchantMarked: {P: [items[0]]}, itemCollectionThreshold: 5,
    merchantRoutinePriorities: {}, standBids: {}, withdrawals: {}, merchantQueue: []};
  return state;
}

test('ineligible collection leaves the actual queue without erasing marks or suppressing future scheduling',()=>{
 const {pruneIneligibleCollections:prune}=require('../../runtime/merchant-jobs/coordinator/owner.ts');
 const state=fixture(),job={id:'pickup',target:'P',reason:'marked items'},manual={target:'P',reason:'party collection'};
 state.merchantQueue=[job,manual];state.transferSignatures={P:'previous'};
 const marks=state.marked.P;
 assert.equal(prune(state,()=>100000,{}),true);assert.deepEqual(state.merchantQueue,[manual]);
 assert.equal(state.marked.P,marks);assert.equal(state.transferSignatures.P,undefined);
 state.itemCollectionThreshold=2;state.merchantQueue.push(job);
 assert.equal(prune(state,()=>100000,{}),false);
 state.itemCollectionThreshold=5;state.statuses.M.x=0;
 assert.equal(prune(state,()=>100000,{}),false);
 state.statuses.M.x=1000;assert.equal(prune(state,()=>100000,{}),true);
});
test('targetless collection projection preserves absent and legacy dictionary-key behavior', () => {
  const state=fixture();assert.equal(slots(state,undefined),0);assert.equal(nearby(state,undefined,()=>100000),false);
  state.statuses.undefined={...state.statuses.P,x:1000};state.marked.undefined=state.marked.P;
  assert.equal(slots(state,undefined),2);assert.equal(nearby(state,undefined,()=>100000),true);
});

test('queue selection retains blocked jobs and stamps only the selected job after dequeue', () => {
  const state = fixture(), future = {target: 'M', reason: 'restock', retryAt: 200000, priorityOverride: 99};
  const storage = {target: 'M', reason: 'service', blockedOnBankboi: true};
  const remote = {target: 'P', reason: 'marked items', priorityOverride: 100};
  const luck = {target: 'M', reason: 'merchant luck exchange', priorityOverride: 60, queuedAt: 0};
  state.merchantQueue = [future, storage, remote, luck];
  const queue = state.merchantQueue;
  const result = take(state, pass(state, 100004));
  assert.equal(state.merchantQueue, queue); assert.deepEqual(queue, [future, storage, remote]);
  assert.equal(result.reason, 'merchant luck'); assert.equal(result.castMerchantLuck, true);
  assert.equal(result.expandLuckCluster, false); assert.equal(result.priority, 60);
  assert.equal(result.queuedAt, 100004);
  assert.equal(luck.reason, 'merchant luck exchange'); assert.equal(luck.queuedAt, 0);
  state.statuses.M.x = 0;
  assert.equal(take(state, pass(state, 100005)).target, 'P'); assert.deepEqual(queue, [future, storage]);
});

test('collection combines current mark maps without counting duplicate marks or stack quantities', () => {
  const state = fixture(); assert.equal(slots(state, 'P'), 2);
  const job = {target: 'P', reason: 'marked items'};
  assert.equal(ready(state, job, () => 100000), false);
  state.statuses.M = {...state.statuses.M, x: 200}; assert.equal(ready(state, job, () => 100000), true);
  state.merchantMarked = {}; state.marked = {P: [state.statuses.P.items[0]]}; assert.equal(slots(state, 'P'), 1);
  state.statuses.P.seenAt = 0; assert.equal(ready(state, job, () => 100000), false);
  assert.equal(ready(state, {reason: 'manual visit'}, () => assert.fail('manual work must not consult collection clock')), true);
});

test('queue ties use original enqueue time and an ineligible queue stays untouched', () => {
  const state = fixture(), newer = {target: 'M', reason: 'service', queuedAt: 20};
  const older = {target: 'M', reason: 'service', queuedAt: 10}; state.merchantQueue = [newer, older];
  assert.equal(take(state, pass(state, 100000)).queuedAt, 10); assert.deepEqual(state.merchantQueue, [newer]);
  newer.blockedOnBankboi = true; assert.equal(take(state, pass(state, 100000)), null);
  assert.equal(state.merchantQueue[0], newer);
});

// B02: b9b5c91e picked by priority, then queue time
// (priority.ts:85-107), so after a Ponty job on EU I an older home job of equal priority ran next and
// the merchant hopped home and back for the next EU I job. Among equal priorities the pick now takes
// the job on the realm the merchant stands on, and the items owner's realm stay holds on that tie.
test('B02: among equal priorities the pick takes the job on the merchant realm, and queue time breaks the rest', () => {
  const state = fixture(), now = state.statuses.M.seenAt; state.activeRealm = 'SR_USII'; state.statuses.M.server = 'EUI';
  const home = {target: 'M', reason: 'restock', priorityOverride: 50, queuedAt: 10};
  const ponty = {target: 'M', reason: 'Ponty purchases', priorityOverride: 50, queuedAt: 20,
    listings: [{key: 'a', serverRegion: 'EU', serverIdentifier: 'I'}]};
  state.merchantQueue = [home, ponty];
  assert.equal(take(state, pass(state, now)).reason, 'Ponty purchases', 'the EU I job before the older home job');
  state.merchantQueue = [home, {...ponty}]; state.statuses.M.server = 'USII';
  assert.equal(take(state, pass(state, now)).reason, 'restock', 'at home the home job goes first');
  state.merchantQueue = [home, {...ponty, priorityOverride: 40}]; state.statuses.M.server = 'EUI';
  assert.equal(take(state, pass(state, now)).reason, 'restock', 'a higher priority still wins over the realm');
});

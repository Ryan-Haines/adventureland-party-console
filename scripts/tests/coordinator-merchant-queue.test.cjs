const test = require('node:test');
const assert = require('node:assert/strict');
const {createMerchantQueue} = require('../../runtime/merchant-jobs/coordinator/owner.ts');
const { compoundRunnable, planAutoExchanges } = require('../../runtime/items/coordinator/production.ts');

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
test('ambiguous upgrade blocks ignore unrelated potion changes but release on relevant inventory changes',()=>{
 const {upgradeRecoverySignature}=require('../../runtime/items/coordinator/production.ts');
 const marks=[{requestId:'one',item:{name:'sword',level:0},tiers:1}],items=[{slot:1,item:{name:'sword',level:0}},{slot:2,item:{name:'mpot1',q:10}}];
 const f=fixture();f.ports.upgradeRecoverySignature=()=>upgradeRecoverySignature(marks,items);
 f.state.blocks['M\nmanual upgrades']={upgradeRecoverySignature:f.ports.upgradeRecoverySignature()};
 items[1].item.q=9;f.service.queue(['M'],'manual upgrades');assert.equal(f.state.queue.length,0);
 items[0].slot=3;f.service.queue(['M'],'manual upgrades');assert.equal(f.state.queue.length,1);
});
test('repeated heartbeat queue checks do not persist unchanged settings and still dispatch ready work',()=>{
 const {state,service,effects}=fixture();
 service.queue(['M'],'auto upgrade');
 effects.length=0;
 for(let i=0;i<100;i++)service.queue(['M'],'auto upgrade');
 assert.equal(state.queue.length,1);
 assert.equal(effects.filter(e=>e==='persist').length,0);
 assert.equal(effects.filter(e=>e==='dispatch').length,100);
 state.current=state.queue.shift();effects.length=0;
 service.queue(['M'],'auto upgrade');service.queue([]);
 assert.equal(effects.filter(e=>e==='persist').length,0);
});

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

test('delivery jobs deduplicate independently of other visits and active delivery work',()=>{
 const {state,service}=fixture();
 service.queue(['P'],'deliveries');service.queue(['P'],'deliveries');service.queue(['P'],'manual visit');
 assert.deepEqual(state.queue.map(j=>j.reason),['deliveries','manual visit']);
 state.current=state.queue.shift();service.queue(['P'],'deliveries');
 assert.deepEqual(state.queue.map(j=>j.reason),['manual visit']);
 const other=fixture();other.service.queue(['P'],'marked items');other.service.queue(['P'],'deliveries');
 assert.deepEqual(other.state.queue.map(j=>j.reason),['marked items','deliveries']);
});

test('compound targets count new production and require three unlocked ingredients at one level', () => {
  const item = (name, level, locked) => ({item: {name, level, l: locked}});
  assert.equal(compoundRunnable([{name:'ring', targetTier:2, quantity:1}, {name:'amulet', targetTier:2}],
    [item('ring',2), item('amulet',1), item('amulet',1), item('amulet',1)]), true);
  assert.equal(compoundRunnable([{name:'ring',targetTier:2}], [item('ring',1),item('ring',1),item('ring',1,true)]),false);
});

test('automatic exchanges preserve levels and count whole quantities across supplied inventories', () => {
  const result = planAutoExchanges({leather:{name:'leather'}, sword:{name:'sword',level:1}},
    [{id:'leather',required:20},{id:'sword',level:1,required:3}],
    [{item:{name:'leather',q:19}},{item:{name:'leather',q:22}},{item:{name:'sword',level:0,q:99}}]);
  assert.deepEqual(result, {lines:[{id:'leather',level:0,quantity:2}],keys:['leather']});
});

// (e2e/merchant-sale-scheduling-failures.md item 1): a saved cleanout beside the running cleanout of
// its recipient leaves on the restart's migration and every pass; another recipient's cleanout and a
// party collection at the running recipient stay, and the running job is untouched.
test('a running cleanout owns the queued cleanout of its recipient', () => {
  const { mergePickupJobs } = require('../../runtime/merchant-jobs/rules.ts');
  const current = Object.freeze({ id: 'run', target: 'F', reason: 'inventory cleanout', commandId: 7 });
  const queue = [{ id: 'a', target: 'F', reason: 'inventory cleanout', queuedAt: 5 }, { id: 'b', target: 'G', reason: 'inventory cleanout', queuedAt: 6 },
    { id: 'c', target: 'F', reason: 'marked items', queuedAt: 7 }];
  assert.deepEqual(mergePickupJobs(queue, 'M', current).map(job => job.id), ['b', 'c']);
  assert.deepEqual(mergePickupJobs(queue, 'M', { ...current, reason: 'marked items' }).map(job => job.id), ['a', 'b', 'c']);
  const f = fixture(); f.state.current = { ...current }; f.state.queue.push({ id: 'a', target: 'F', reason: 'inventory cleanout', queuedAt: 5 });
  createMerchantQueue(f.state, f.ports);
  assert.deepEqual([f.state.queue.length, f.state.current.commandId], [0, 7]);
});

// Section 4's `jobs.enqueue` (part 9): every source's one door. A marked ask keeps the queue's merge
// and refusals; a carried ask is its own job, the pickup group excepted; the door spends no command
// id the ask names and sends one `merchant.job.queued` per job it adds.
test('jobs.enqueue: answers queued, merged and refused by J5, keeps carried work apart and merges cleanouts at the door', () => {
  const { merchantRecords } = require('../../runtime/merchant-jobs/coordinator/records.ts');
  const f = fixture();
  f.ports.enabled = reason => reason !== 'deliveries';
  f.ports.merchant = () => 'Door';
  assert.equal(f.service.enqueue({ reason: 'party collection', target: 'F' }), 'queued');
  assert.equal(f.service.enqueue({ reason: 'marked items', target: 'F' }), 'merged:1');
  assert.equal(f.state.queue[0].reason, 'marked items', 'a member visit takes the higher routine');
  assert.equal(f.service.enqueue({ reason: 'manual upgrades', target: 'B' }), 'refused:bankboi');
  assert.equal(f.service.enqueue({ reason: 'deliveries', target: 'G' }), 'refused:routine off');
  assert.equal(f.service.enqueue({ reason: 'manual upgrades', target: null }), 'refused:no target');
  f.state.current = { id: 'run', target: 'H', reason: 'party collection' };
  assert.equal(f.service.enqueue({ reason: 'party collection', target: 'H' }), 'merged:run');
  f.state.current = null;
  assert.equal(f.service.enqueue({ reason: 'stand purchases', target: 'Door', fields: { listings: [1] } }), 'queued');
  assert.equal(f.service.enqueue({ reason: 'stand purchases', target: 'Door', fields: { id: 'own', listings: [2] } }), 'queued');
  assert.deepEqual(f.state.queue.filter(job => job.reason === 'stand purchases').map(job => [job.id, job.listings[0]]), [['2', 1], ['own', 2]]);
  assert.equal(f.service.enqueue({ reason: 'inventory cleanout', target: 'G', fields: { retryAt: 10, queuedAt: 5, retryCount: 1 } }), 'queued');
  assert.equal(f.service.enqueue({ reason: 'inventory cleanout', target: 'G', fields: { retryAt: 30, queuedAt: 9, retryCount: 3, ladderDue: 'job-interrupted' } }), 'merged:3');
  const cleanout = f.state.queue.find(job => job.reason === 'inventory cleanout');
  // The merge keeps the earlier place in line, the later retry time and the higher count.
  assert.deepEqual([cleanout.queuedAt, cleanout.retryAt, cleanout.retryCount, cleanout.ladderDue], [5, 30, 3, 'job-interrupted']);
  f.state.current = { id: 'clean', target: 'K', reason: 'inventory cleanout' };
  assert.equal(f.service.enqueue({ reason: 'inventory cleanout', target: 'K', fields: {} }), 'merged:clean');
  assert.equal(f.state.queue.length, 4);
  assert.deepEqual(merchantRecords('Door').filter(entry => entry.decision === 'queued').map(entry => entry.owner), ['job:1', 'job:2', 'job:own', 'job:3']);
});

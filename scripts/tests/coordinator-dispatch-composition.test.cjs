const test = require('node:test'), assert = require('node:assert/strict');
const {createCoordinatorMerchantDispatcher} = require('../../runtime/merchant-jobs/coordinator/dispatch.ts');
const { publishTasks } = require('../../runtime/tasks/api.ts');
const { publishEventAnswers } = require('../../runtime/events/api.ts');
const { itemsDoor } = require('./helpers/coordinator-merchant.cjs');
const { partyHooks } = require('../../runtime/hooks/index.ts');
// The pass's facts read the hunting owner's Cave state, which owns no member here. The merchant's working gold
// reads the merchant owner's ready jobs, which the dispatcher under test registers in play; it answers none here.
partyHooks().publish({ name: 'core:dispatch-composition-reads', folder: 'core', author: 'test', summary: 'No Cave run owns a member and no job is ready.',
  hooks: { 'cave.state': () => ({ owned: false }), 'jobs.ready': () => [] } });
function fixture() {
  // The event half of the merchant's reservation asks the tasks owner's `task.live` for the
  // merchant's group; `live.task` is that group's live task, none unless a row sets it.
  const live = { task: null };
  publishTasks({ groupOf: name => 'party:' + name, live: () => live.task });
  // The other half reads the events owner's deferred returns, which hold none here.
  publishEventAnswers({ deferredReturn: () => false });
  const state = { merchantQueue: [{ id: 'job', target: 'M', reason: 'restock' }], merchantCurrent: null,
    nextCommandId: 7, merchantCharacter: 'M', bankbois: {}, bankboiTransaction: null, commands: {}, gatheringModes: [], gatheringCooldowns: {},
    statuses: { M: { seenAt: 100, server: 'USII' } }, activeRealm: 'SR_USII', aldata: { key: 'fixture' }, threshold: 100,
    merchantCargo: {}, npcSaleMarks: [], standListings: [], marked: {}, upgrades: {}, purchases: {}, compounds: {}, autoCompounds: {},
    withdrawals: {}, statScrolls: {}, merchantDeliveries: {}, goldTargets: {}, standBids: {}, merchantMarked: {} };
  const calls = [], restock = { hp: { max: 20 } };
  const ports = { now: () => 100, ensureHome: () => true, returningHome: () => false, routineNeedsHome: () => false,
    anniversary: () => ({}), routinePriority: () => 0, priority: () => 1, capacityBlocked: () => false, collectionReady: () => true,
    pick: () => state.merchantQueue.shift(), stamp: job => job, planPonty: () => null,
    restock: () => restock, idle: () => calls.push('idle'), persist: () => calls.push('persist'), log() {} };
  const storage = { busy: () => false, start: async () => { calls.push('storage'); } };
  itemsDoor(state, storage);
  return { state, calls, ports, restock, live, storage, service: createCoordinatorMerchantDispatcher(Object.assign(state,{production:state.production||{attempts:{}}}), ports) };
}

test('party collection carries the recipient delivery and equip instruction across dispatch', () => {
  const f = fixture(), delivery = {slot:24,item:{name:'wattire',level:8,stat_type:'int'},equipOnDelivery:true};
  f.state.merchantDeliveries.QwenTina = [delivery];
  f.state.statuses.QwenTina = {seenAt:100,server:'USII',map:'winterland',x:500,y:500,items:[]};
  f.state.merchantQueue = [{id:'delivery',target:'QwenTina',reason:'party collection'}];
  f.service.dispatch();
  assert.equal(f.state.commands.M.target,'QwenTina');
  assert.deepEqual(f.state.commands.M.merchantDeliveries,[delivery]);
  assert.equal(f.state.commands.M.merchantDeliveries[0].equipOnDelivery,true);
});

test('delivery-only visit dispatches without any other work and retains only ready marks',()=>{
 const f=fixture(),delivery={id:'d',slot:2,item:{name:'sword'},equipOnDelivery:true};
 f.state.merchantDeliveries.P=[delivery,{item:{name:'ring'},blocked:'uncertain'},{item:{name:'coat'},awaitingEquip:true},{}];
 f.state.statuses.P={seenAt:100,server:'USII',map:'main',x:500,y:500,items:[]};
 f.state.merchantQueue=[{id:'d',target:'P',reason:'deliveries'}];f.service.dispatch();
 assert.equal(f.state.commands.M.type,'merchant-service');assert.equal(f.state.commands.M.target,'P');
 assert.deepEqual(f.state.commands.M.merchantDeliveries,[delivery]);
 assert.deepEqual(f.state.commands.M.upgrades,[]);assert.deepEqual(f.state.commands.M.purchases,[]);
});

test('completed or blocked deliveries leave no empty trip, while disabled scheduling preserves other visits',()=>{
 for(const marks of [[],[{item:{name:'ring'},blocked:'uncertain'}],[{item:{name:'coat'},awaitingEquip:true}]]) {
  const f=fixture();f.state.merchantDeliveries.P=marks;
  f.state.merchantQueue=[{id:'d',target:'P',reason:'deliveries'}];f.service.dispatch();
  assert.equal(f.state.merchantCurrent,null);assert.deepEqual(f.state.merchantQueue,[]);
 }
 for(const reason of ['manual visit','party collection','restock']) {
  const f=fixture(),delivery={id:'d',item:{name:'sword'}};
  f.state.merchantAutomations={deliveries:false,'party collection':false};
  f.state.merchantDeliveries.P=[delivery];f.state.statuses.P={seenAt:100,server:'USII',items:[]};
  f.state.merchantQueue=[{id:'d',target:'P',reason:'deliveries'},{id:'visit',target:'P',reason,manual:true}];
  f.service.dispatch();assert.equal(f.state.merchantCurrent.id,'visit');
  assert.deepEqual(f.state.commands.M.merchantDeliveries,[delivery]);
 }
});

// MJ79: each holder keeps the merchant, and no job is assigned under it.
// A row's second column checks what follows: the storage holder starts storage, and the queued job
// resumes once the upgrade bag is free.
test('MJ79: every J1 holder holds the merchant and the queued job waits', async () => {
  const { merchantSlotCommand } = require('../../runtime/merchant-jobs/coordinator/api.ts');
  const holders = {
    'console update': f => { f.ports.consoleUpdate = () => true; },
    'party switch': f => { f.ports.partySwitch = () => true; },
    'event reservation': f => { f.state.eventSelectionsByCharacter = { M: ['snowman'] }; f.state.statuses.M.merchantEventReserved = true; },
    'event attendance task': f => { f.live.task = { kind: 'event-attendance' }; },
    'event return task': f => { f.live.task = { kind: 'event-return' }; },
    production: f => { f.state.production = { attempts: { a: { name: 'sword', level: 3, kind: 'upgrade' } } }; },
    'upgrade bag': [f => { f.state.statuses.M.upgradeInventoryBusy = true; }, (f, service) => {
      f.state.statuses.M.upgradeInventoryBusy = false; service.dispatch();
      assert.equal(f.state.commands.M?.jobId, 'job', 'the queued job resumes once the bag is free');
    }],
    'stale merchant': f => { f.state.statuses.M.seenAt = -Infinity; },
    cast: f => { f.state.statuses.M.gatheringPhase = 'cast'; },
    'manual equipment': f => { merchantSlotCommand(f.state, 'manual:equip', { id: 3, type: 'equip' }); },
    storage: [f => { f.storage.busy = () => true; }, async f => {
      await Promise.resolve();
      assert.deepEqual(f.calls.filter(call => call === 'storage'), ['storage'], 'the storage holder starts storage');
    }],
    'featured anniversary': f => { f.ports.anniversary = () => ({ featured: true }); },
    anniversary: f => { f.ports.anniversary = () => ({ reserved: true }); },
    'force stand': f => { f.state.merchantForceStand = true; },
  };
  for (const [holder, row] of Object.entries(holders)) {
    const [set, then] = [row].flat(), f = fixture();
    set(f);
    const service = require('../../runtime/merchant-jobs/coordinator/dispatch.ts').createCoordinatorMerchantDispatcher(f.state, f.ports);
    service.dispatch();
    assert.equal(f.state.merchantCurrent, null, holder);
    assert.deepEqual(f.state.merchantQueue.map(job => job.id), ['job'], holder);
    assert.notEqual(f.state.commands.M?.jobId, 'job', holder);
    await then?.(f, service);
  }
});

// MJ82: the capacity bank runs once per signature of the marked items it carries.
test('MJ82: the capacity bank runs once for the same marked items and again when they change', () => {
  const f = fixture();
  f.ports.capacityBlocked = job => job.reason === 'party collection';
  // A bank mark names its copy in the merchant's bag (items.fate, fates.ts `markNames`).
  const sword = { slot: 0, item: { name: 'sword', level: 3 } }, bow = { slot: 1, item: { name: 'bow', level: 2 } };
  f.state.statuses.M.items = [sword, bow];
  f.state.marked.M = [sword];
  f.state.statuses.P = { seenAt: 100, server: 'USII', items: [] };
  f.state.merchantQueue = [{ id: 'pickup', target: 'P', reason: 'party collection' }];
  f.service = require('../../runtime/merchant-jobs/coordinator/dispatch.ts').createCoordinatorMerchantDispatcher(f.state, f.ports);
  f.service.dispatch();
  assert.equal(f.state.merchantCurrent?.reason, 'manual bank exchange');
  assert.equal(f.state.merchantCurrent?.capacityRecovery, true);
  f.state.merchantCurrent = null;
  f.state.commands = {};
  f.service.dispatch();
  assert.notEqual(f.state.merchantCurrent?.reason, 'manual bank exchange');
  f.state.merchantCurrent = null;
  f.state.commands = {};
  f.state.merchantQueue = [{ id: 'pickup', target: 'P', reason: 'party collection' }];
  f.state.marked.M = [sword, bow];
  f.service.dispatch();
  assert.equal(f.state.merchantCurrent?.reason, 'manual bank exchange');
});

// MJ80: a reservation that begins while a job is assigned and not acknowledged pauses it by the
// holder, so the next reply carries the reservation and no job command.
test('MJ80: an event reservation pauses an unacknowledged job and clears its command', () => {
  const f = fixture();
  f.service.dispatch();
  assert.equal(f.state.merchantCurrent?.id, 'job');
  assert.equal(f.state.commands.M?.jobId, 'job');
  f.state.eventSelectionsByCharacter = { M: ['snowman'] };
  f.state.statuses.M.merchantEventReserved = true;
  f.service.dispatch();
  assert.equal(f.state.merchantCurrent, null);
  assert.equal(f.state.commands.M, undefined);
  assert.deepEqual(f.state.merchantQueue.map(job => [job.id, job.phase]), [['job', undefined]]);
  const acknowledged = fixture();
  acknowledged.service.dispatch();
  acknowledged.state.merchantCurrent.heartbeatAt = 100;
  acknowledged.state.eventSelectionsByCharacter = { M: ['snowman'] };
  acknowledged.state.statuses.M.merchantEventReserved = true;
  acknowledged.service.dispatch();
  assert.equal(acknowledged.state.merchantCurrent?.id, 'job');
});

// A self-found giveaway whose end has passed leaves the queue in the dispatcher's pass, and
// the merchant takes no command for it; one still running at the pass time stays queued.
test('the dispatcher pass drops an expired giveaway and keeps one that is still running',()=>{
  const expired = { id: 'old', target: 'Seller', reason: 'join giveaway', seller: 'Seller', slot: 'trade1', rid: 'r1', realm: 'SR_USII', expiresAt: 99 };
  const f = fixture(); f.state.merchantQueue = [expired];
  f.service.dispatch();
  assert.deepEqual(f.state.merchantQueue, []); assert.equal(f.state.merchantCurrent, null); assert.equal(f.state.commands.M, undefined);
  const g = fixture(); g.state.merchantQueue = [{ ...expired, id: 'live', expiresAt: 100 + 60_000 }]; g.state.statuses.Seller = { seenAt: 100, server: 'USII' };
  g.service.dispatch();
  assert.equal(g.state.merchantCurrent?.id ?? g.state.commands.M?.jobId, 'live');
});

const {createCoordinatorMerchantQueue} = require('../../../runtime/merchant-jobs/coordinator/owner.ts');

/** Test adapter for coordinator state; the queue is the merchant jobs owner's production composition. */
function merchantQueueRuntime(r) {
  const service=createCoordinatorMerchantQueue(r.party,{now:()=>Date.now(),collectionReady:job=>r.markedCollectionReady?.(job) ?? true,
    capacitySignature:name=>r.merchantCapacitySignature(name),routinePriority:reason=>r.merchantRoutinePriority(reason),
    priority:job=>r.merchantJobPriority(job),stamp:job=>r.stampMerchantJob(job),persist:()=>r.persistSettings(),
    dispatch:()=>r.dispatchMerchant(),log:(...args)=>r.merchantLog?.(...args)});
  r.merchantQueue=service;
  r.queueMerchant=service.queue;
  r.queueLocalStandSync=service.localStandSync;
  return service;
}
/** The production `jobs.enqueue` door over a unit test's own state, built at the first ask, with the
 * test's clock and stamp (each optional). The queue state a test leaves out starts empty, as a new
 * coordinator's does. */
function merchantDoor(state, {now=()=>Date.now(), stamp=job=>job}={}) {
  let door;
  return ask => {
    if (!door) {
      state.merchantCurrent ??= null; state.merchantJobBlocks ||= {}; state.statuses ||= {}; state.merchantCharacter ??= null;
      door=createCoordinatorMerchantQueue(state,{now,capacitySignature:()=>'',routinePriority:()=>0,priority:()=>0,stamp,
        persist(){},dispatch(){},log(){}});
    }
    return door.enqueue(ask);
  };
}
/**
 * The items owner's core:items registration and its answers over a unit test's state, published by owner.ts's
 * publishItemsAnswers as installItems publishes them, with the test's BankBoi storage (`busy`,
 * `start`). The realm owner is absent, so the realm stay asks nothing of it.
 */
function itemsDoor(state, storage={busy:()=>false,start:async()=>{}}) {
  const {publishItemsAnswers}=require('../../../runtime/items/coordinator/owner.ts');
  state.production ||= {attempts:{}};
  publishItemsAnswers(state,{storage,log(){},merchant:()=>state.merchantCharacter??null,home:()=>null,here:()=>null,
    want(){throw Error('the realm owner is not installed in this test');},release(){}},()=>state.nextCommandId++);
}
/** A unit test's ports with the door added as `enqueue`, on the same clock, ids and stamp. */
// The estimate's I/O yield is the root's run scope in the coordinator; the fixtures yield with setImmediate.
function withDoor(state, ports) { return {yieldToIO: () => new Promise(resolve => setImmediate(resolve)), ...ports, enqueue: merchantDoor(state, ports)}; }
module.exports={merchantQueueRuntime,merchantDoor,withDoor,itemsDoor};

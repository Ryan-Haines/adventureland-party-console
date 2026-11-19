// The merchant jobs owner's stand return as the coordinator composes it (stand.ts createCoordinatorMerchantIdle), over a
// test context's party state, with the items owner's items answers (itemsDoor) and the tasks owner, which the
// event hold reads, installed over the same state.
const {createCoordinatorMerchantIdle}=require('../../../runtime/merchant-jobs/coordinator/stand.ts');
const {itemsDoor}=require('./coordinator-merchant.cjs');
const {installTasksOver}=require('./tasks-owner.cjs');
const {partyHooks}=require('../../../runtime/hooks/index.ts');
const {publishEventAnswers}=require('../../../runtime/events/api.ts');
module.exports=function idleRuntime(r){
  const p=r.party;
  itemsDoor(p,{busy:()=>r.bankboiService.busy(),start:async()=>{}});
  installTasksOver(p,{hooks:partyHooks(),now:()=>Date.now()});
  // The events owner's deferred return answer reads the saved row as events/coordinator/install.ts:50 publishes it;
  // the events owner keeps that answer inline, so the helper cannot import it.
  publishEventAnswers({deferredReturn:name=>!!p.deferredEventReturns?.[name]});
  r.merchantIdle=createCoordinatorMerchantIdle(p,{now:()=>Date.now(),anniversary:()=>r.merchantAnniversaryControl(),
    ensureHome:reason=>r.ensureMerchantHome(reason),inventoryMerge:status=>r.merchantInventoryStacks.plan(p,status),
    capacityBlocked:job=>r.merchantTransferCapacityBlocked(job),collectionReady:job=>r.markedCollectionReady(job)});
  r.dispatchMerchantIdle=r.merchantIdle.idle;
};

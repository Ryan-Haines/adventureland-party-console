const {createMerchantIdle}=require('../../../runtime/coordinator/merchant/idle.ts');
module.exports=function idleRuntime(r){
  const p=r.party;
  r.merchantIdle=createMerchantIdle({storagePending:()=>!!(r.bankboiService.busy()||p.bankboiTransaction||r.bankStackRouting.servicePlan(p)),
    merchant:()=>p.merchantCharacter,status:name=>p.statuses[name],anniversary:()=>r.merchantAnniversaryControl(),
    currentJob:()=>!!p.merchantCurrent,ensureHome:reason=>r.ensureMerchantHome(reason),forcedStand:()=>!!p.merchantForceStand,
    readyQueuedWork:()=>p.merchantQueue.some(job=>Number(job.retryAt||0)<=Date.now()&&!job.blockedOnBankboi&&!r.merchantTransferCapacityBlocked(job)&&r.markedCollectionReady(job)),
    modes:()=>p.gatheringModes,cooldown:mode=>p.gatheringCooldowns?.[mode],now:()=>Date.now(),listings:()=>p.standListings||[],
    inventoryMerge:status=>r.merchantInventoryStacks.plan(p,status),command:name=>p.commands[name],issue:(name,cmd)=>{p.commands[name]=cmd;},
    nextCommand:()=>p.nextCommandId++,realm:()=>p.activeRealm});
  r.dispatchMerchantIdle=r.merchantIdle.idle;
};

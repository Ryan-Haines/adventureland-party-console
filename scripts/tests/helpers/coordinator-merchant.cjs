const {createMerchantQueue} = require('../../../runtime/coordinator/merchant/queue.ts');

/** Test adapter for coordinator state; all queue behavior is the production service. */
function merchantQueueRuntime(r) {
  const party=r.party;
  const service=createMerchantQueue({get queue(){return party.merchantQueue;},get current(){return party.merchantCurrent;},get blocks(){return party.merchantJobBlocks;}},{
    merchant:()=>party.merchantCharacter,bankboi:name=>!!party.bankbois?.[name],capacitySignature:name=>r.merchantCapacitySignature(name),
    collectionReady:job=>r.markedCollectionReady?.(job) ?? true,
    gold:()=>({bank:Number(party.bankSnapshot?.gold)||0,merchant:Number(party.statuses?.[party.merchantCharacter]?.gold)||0}),
    nextId:()=> 'merchant-'+Date.now()+'-'+party.nextCommandId++,now:()=>Date.now(),
    routinePriority:reason=>r.merchantRoutinePriority(reason),priority:job=>r.merchantJobPriority(job),stamp:job=>r.stampMerchantJob(job),
    hasPendingStandInventory:()=> (party.standListings||[]).some(listing=>listing&&listing.state!=='live'&&!listing.bankPack),
    persist:()=>r.persistSettings(),dispatch:()=>r.dispatchMerchant(),log:(...args)=>r.merchantLog?.(...args),
  });
  r.merchantQueue=service;
  r.queueMerchant=service.queue;
  r.queueLocalStandSync=service.localStandSync;
  return service;
}
module.exports={merchantQueueRuntime};

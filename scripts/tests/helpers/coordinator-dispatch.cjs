const {createMerchantDispatcher}=require('../../../runtime/merchant-jobs/coordinator/dispatch.ts');

// The merchant dispatcher over a fixture state. `r.ports` holds the plants a test swaps, under the
// dispatcher's own port names (dispatch.ts `createMerchantDispatcher`); `r.dispatch` runs one pass.
function dispatchRuntime(overrides={}) {
  const effects=[];
  const party={merchantCharacter:'M',merchantQueue:[],merchantCurrent:null,
    bankbois:{},bankboiTransaction:null,gatheringModes:[],gatheringCooldowns:{},commands:{},nextCommandId:100,
    statuses:{M:{seenAt:100000,server:'USII',map:'main',x:1,y:2,gold:500,items:Array(42).fill(null)},
      Q:{seenAt:100000,server:'USII',map:'main',x:3,y:4,gold:50,items:[{slot:1,item:{name:'ring',level:2}}]}},
    marked:{M:[{slot:0,item:{name:'coat'}}],Q:[{slot:2,item:{name:'sword'}}]},upgrades:{M:[{slot:4,tiers:8}]},
    purchases:{M:[{id:'hpot0',quantity:20}]},compounds:{},autoCompounds:{M:[{name:'ring',targetTier:2}],Q:[{name:'ring',targetTier:2}]},
    statScrolls:{M:[{item:{name:'coat'},stat:'dex'}],Q:[{item:{name:'sword'},stat:'str'}]},
    withdrawals:{M:[{pack:'items0',slot:3}]},merchantDeliveries:{Q:[{item:{name:'coat'}}]},goldTargets:{M:10000,Q:1000},
    activeRealm:'SR_USII',aldata:{key:'fixture-key'},npcSaleMarks:[{slot:7,item:{name:'helmet'}}],
    standListings:[{id:'stand',item:{name:'coat'}}],merchantCargo:{bank:[],gold:0},threshold:100000,
    ...overrides};
  const now=()=>100000,busy=()=>false;
  const ports={ensureHome:()=>true,storage:async()=>effects.push('storage'),
    anniversary:()=>({featured:false,reserved:false,kissDue:false,busy:false}),
    idle:()=>effects.push('idle'),routinePriority:()=>50,priority:job=>job.priority||50,
    capacityBlocked:()=>false,collectionReady:()=>true,pick:()=>party.merchantQueue.shift()||null,
    stamp:job=>job,restock:()=>({hp:{min:5,max:20,item:'hpot0'},mp:{min:0,max:0,item:'mpot0'}}),
    log:(message,level,details)=>effects.push({message,level,details}),persist:()=>effects.push('persist'),
    planPonty:listings=>listings.slice().reverse()};
  const r={party,effects,ports};
  const work=name=>({marked:party.marked[name]||[],upgrades:party.upgrades[name]||[],purchases:party.purchases[name]||[],
    compounds:party.compounds[name]||[],autoCompounds:party.autoCompounds[name]||[],withdrawals:party.withdrawals[name]||[],
    statScrolls:party.statScrolls[name]||[],deliveries:party.merchantDeliveries[name]||[],goldTarget:party.goldTargets[name]});
  require('./coordinator-merchant.cjs').itemsDoor(party,{busy,start:async()=>{await ports.storage();}});
  r.merchantDispatcher=createMerchantDispatcher({get queue(){return party.merchantQueue;},set queue(v){party.merchantQueue=v;},
    get current(){return party.merchantCurrent;},set current(v){party.merchantCurrent=v;}},{
    now,nextCommand:()=>party.nextCommandId++,merchant:()=>party.merchantCharacter,
    returningHome:()=>!!party.realmReturningHome,ensureHome:reason=>ports.ensureHome(reason),
    bankboi:name=>!!party.bankbois[name],anniversary:()=>ports.anniversary(),forcedStand:()=>!!party.merchantForceStand,
    manualEquipmentPending:()=>['equip','unequip'].includes(party.commands[party.merchantCharacter]?.type),
    gatheringModes:()=>party.gatheringModes,gathering:()=>require('../../../runtime/merchant-jobs/coordinator/dispatch.ts').gatheringReady(party,now()),
    routinePriority:reason=>ports.routinePriority(reason),priority:job=>ports.priority(job),
    readyFacts:()=>({now:now(),enabled:()=>true,waits:job=>!!require('../../../runtime/hooks/index.ts').partyHooks().ask('items.needs',{...job}).blockedBy,
      capacityBlocked:job=>ports.capacityBlocked(job),collectionReady:job=>ports.collectionReady(job)}),
    pick:facts=>ports.pick(facts),stamp:job=>ports.stamp(job),status:name=>party.statuses[name],
    // `jobs.enqueue` adds the job to the fixture's queue; `jobs.pause` hands back the job it paused.
    enqueue:ask=>{party.merchantQueue.push({reason:ask.reason,target:ask.target,queuedAt:now(),...ask.fields});return 'queued';},
    pause:job=>job,
    planPonty:(...args)=>ports.planPonty(...args),
    inputs:()=>({merchant:party.merchantCharacter,activeRealm:party.activeRealm,aldataKey:party.aldata.key,threshold:party.threshold,
      gatheringModes:party.gatheringModes,cargo:party.merchantCargo,npcSales:require('../../../runtime/items/coordinator/api.ts').readyNpcSales(party.npcSaleMarks,now()),standListings:party.standListings,
      statScrolls:party.statScrolls,work,restock:name=>ports.restock(name),
      visitWithdrawals:job=>require('../../../runtime/items/coordinator/api.ts').visitWithdrawals(party,job)}),
    command:(_owner,command)=>{party.commands[party.merchantCharacter]=command;},idle:()=>ports.idle(),persist:()=>ports.persist(),
    log:(...args)=>ports.log(...args)});
  r.dispatch=r.merchantDispatcher.dispatch;
  // The merchant jobs owner's job source, as the coordinator publishes it: needs.ts visitWithdrawals reads jobs.ready.
  const {merchantJobSource}=require('../../../runtime/merchant-jobs/coordinator/registrations.ts');
  require('../../../runtime/hooks/index.ts').partyHooks().publish(merchantJobSource(()=>party.merchantCurrent,name=>party.statuses[name],()=>r.merchantDispatcher.ready()));
  return r;
}

function sampleJob(reason,target='M') {
  return {id:'job',target,reason,queuedAt:1,inPlaceStandSync:true,amount:1000000,itemId:'coat',
    listings:[{key:'listing',seller:'seller',serverRegion:'US',serverIdentifier:'II',price:500,quantity:2,item:{name:'coat'}}],
    buyOrder:{buyer:'buyer',item:{name:'coat'}},sellQuantity:2,bidItemId:'coat:0',homeRealm:'SR_USI',
    completedListingKeys:['done'],order:{buys:[{id:'hpot0',quantity:10}],crafts:[]},exchanges:[{id:'leather',quantity:1}],
    exchangeRewards:['reward'],exchangeResume:true,autoExchangeKeys:['leather'],resumeState:{pass:1},
    pack:'items2',floor:'bank',gold:100000,key:{id:'bkey'},seller:'seller',slot:'trade1',rid:'rid',
    realm:'SR_USII',location:{map:'main',x:10,y:20},mail:{id:'mail'},radius:200};
}
module.exports={dispatchRuntime,sampleJob};

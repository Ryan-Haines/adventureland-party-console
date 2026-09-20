const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = require('./helpers/coordinator-source.cjs').coordinatorSource();
function fixture(count=2) {
 const target={name:'Q',map:'main',in:'main',server:'USII',x:0,y:0,seenAt:Date.now(),items:Array.from({length:count},(_,slot)=>({slot,item:{name:'item'+slot}}))};
 const party={itemCollectionThreshold:5,merchantCharacter:'M',statuses:{Q:target,M:{...target,name:'M',x:1000,items:Array(42).fill(null)}},marked:{Q:target.items.slice()},merchantMarked:{},merchantQueue:[],merchantRoutinePriorities:{'party collection':90},standBids:{},bankbois:{},merchantJobBlocks:{},nextCommandId:1};
 const r=vm.createContext({party,coordinatorPolicies:require('../../runtime/coordinator/index.ts'),persistSettings(){},dispatchMerchant(){},merchantLog(){}});
 vm.runInContext(source.slice(source.indexOf('  function markedItem('),source.indexOf('  function autoItemRuleKey(')),r);
 vm.runInContext(source.slice(source.indexOf('  function merchantRoutinePriority('),source.indexOf('  function scheduleNearbyGiveaways(')),r);
 vm.runInContext(require('./helpers/named-function.cjs').namedFunction(source, 'publicMerchantJob'),r);
 require('./helpers/coordinator-merchant.cjs').merchantQueueRuntime(r);
 r.publicOverview=r.coordinatorPolicies.createCoordinatorPublicOverview(party,{
  ...require('./helpers/coordinator-public-state.cjs').publicStateRuntime().ports,
  stamp:job=>r.stampMerchantJob(job),collectionSlots:name=>r.collectionSlotCount(name),collectionNearby:name=>r.merchantCollectionNearby(name),
 });
 return {r,party,target,job:{target:'Q',reason:'marked items',clusterExpanded:true,retryCount:2}};
}
test('two marked slots cannot start a remote trip or retry; five can',()=>{
 const {r,party,job}=fixture(); party.merchantQueue=[job]; assert.equal(r.pickJobByPriority(),null);
 const full=fixture(5); full.party.merchantQueue=[full.job]; assert.equal(full.r.pickJobByPriority().target,'Q');
});
test('below-threshold pickup requires fresh nearby positions in the same realm and instance',()=>{
 const {r,party,job}=fixture();const m=party.statuses.M;m.x=200;assert.equal(r.markedCollectionReady(job),true);
 for(const [key,value] of [['x',201],['map','bank'],['server','USIII'],['in','other'],['seenAt',1]]) {const old=m[key];m[key]=value;assert.equal(r.markedCollectionReady(job),false);m[key]=old;}
});
test('counts slots once and rejects stale marks and quantities as slot counts',()=>{
 const {r,party,target}=fixture(1);party.marked.Q.push(target.items[0],{slot:5,item:{name:'item0'}});party.merchantMarked.Q=[target.items[0]];target.items[0].item.q=9999;
 assert.equal(r.collectionSlotCount('Q'),1);
});
test('manual visits replace deferred automatic collection and bypass the threshold',()=>{
 const {r,party,job}=fixture();party.merchantQueue=[job];r.queueMerchant(['Q'],'manual visit');
 assert.equal(r.pickJobByPriority().reason,'manual visit');
});
test('nearby collection label identifies below-threshold jobs without changing internal reason',()=>{
 const {r,job}=fixture();const output=r.publicMerchantJob(job);assert.equal(output.collectionLabel,'nearby collection');assert.equal(output.reason,'marked items');assert.equal(output.collectionSlots,2);
});
test('deferred pickup does not block other eligible jobs',()=>{
 const {r,party,job}=fixture();party.merchantQueue=[job,{target:'M',reason:'upgrades and compounds'}];assert.equal(r.pickJobByPriority().target,'M');
});

for (const reason of ['npc sale pickup','auto npc sale pickup']) test(reason+' shares collection threshold at enqueue, selection and retry',()=>{
 const {coordinatorCollectionReady,pruneIneligibleCollections}=require('../../runtime/coordinator/merchant/queue-selection.ts');
 const {party,r,target}=fixture(1),job={target:'Q',reason,retryCount:2};
 party.merchantMarked.Q=[{...target.items[0],npcSaleId:'sale'}];party.marked.Q=[];
 party.npcSaleMarks=[{id:'sale',source:'character',character:'Q',auto:reason==='auto npc sale pickup',state:'collecting'}];
 r.queueMerchant(['Q'],reason);assert.equal(party.merchantQueue.length,0);
 party.merchantQueue=[job];assert.equal(r.pickJobByPriority(),null);
 assert.equal(pruneIneligibleCollections(party,Date.now),true);assert.equal(party.merchantQueue.length,0);
 assert.equal(party.merchantMarked.Q.length,1);
 party.statuses.M.x=200;assert.equal(coordinatorCollectionReady(party,job,Date.now),true);
 party.statuses.M.x=201;assert.equal(coordinatorCollectionReady(party,job,Date.now),false);
 party.itemCollectionThreshold=1;assert.equal(coordinatorCollectionReady(party,job,Date.now),true);
 target.seenAt=1;assert.equal(coordinatorCollectionReady(party,job,Date.now),false);
 assert.equal(coordinatorCollectionReady(party,{target:'M',reason:'auto npc sales'},Date.now),true);
});

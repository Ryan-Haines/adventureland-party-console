const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorPurchases}=require('../../runtime/coordinator/commerce/purchase-composition.ts');
function fixture(){
 const listing={item:{name:'helmet',level:7},price:10,unitPrice:10,quantity:1,seenAt:100000,serverIdentifier:'II'};
 const state={standPriceHistory:{},standBids:{helmet:{price:20,quantity:2,minimumQuality:7}},merchantAutomations:{},merchantCurrent:null,
  merchantQueue:[],merchantCharacter:'M',nextCommandId:40,ponty:{updatedAt:100000,listings:[listing]},aldata:{marketListings:[]},activeRealm:'SR_USII',statuses:{M:{server:'USII'}}};
 const calls=[];
 const service=createCoordinatorPurchases(state,{now:()=>100000,priority:job=>{calls.push(['priority',job]);return 50;},
  publish:()=>calls.push('publish'),log:()=>calls.push('log'),prioritized:()=>Object.entries(state.standBids),
  planPonty:(...args)=>{calls.push(['plan',...args]);return args[0];},stamp:job=>({...job,priority:50}),persist:()=>calls.push('persist'),
  dispatch:()=>calls.push('dispatch'),blacklisted:()=>false});
 return {state,listing,calls,service};
}

test('local and Ponty purchases share pending bids and the live command counter across queue replacement',()=>{
 const t=fixture();assert.deepEqual(t.calls,[]);
 t.service.local.observe([t.listing]);assert.equal(t.state.merchantQueue[0].id,'merchant-100000-40');
 assert.equal(t.service.bids.queuePonty(),false);assert.equal(t.calls.some(call=>call[0]==='plan'),false);
 t.state.merchantQueue=[];t.state.nextCommandId=90;t.state.merchantCharacter='New';t.state.statuses={New:{server:'EUI'}};
 assert.equal(t.service.bids.queuePonty(),true);
 assert.deepEqual(t.calls.find(call=>call[0]==='plan'),['plan',[t.listing],2,'EUI',true]);
 assert.equal(t.state.merchantQueue[0].id,'merchant-100000-90');assert.equal(t.state.merchantQueue[0].target,'New');
 assert.equal(t.state.merchantQueue[0].priority,50);assert.equal(t.state.nextCommandId,91);
 t.service.local.observe([t.listing]);assert.equal(t.state.merchantQueue.length,1);
});

test('local matching forwards bid priority and fulfillment preserves the level requirement before releasing work',()=>{
 const t=fixture();t.state.standBids.ring={price:20,quantity:1};
 t.service.local.observe([t.listing,{...t.listing,item:{name:'ring',level:0},price:15}]);
 const priorities=t.calls.filter(call=>call[0]==='priority').map(call=>call[1]);
 assert.ok(priorities.some(job=>job.reason==='stand bid purchases'&&job.bidItemId==='helmet'));
 assert.equal(t.service.bids.fulfill({name:'helmet',level:6},2),0);assert.equal(t.state.merchantQueue.length,1);
 assert.equal(t.service.bids.fulfill({name:'helmet',level:7},2),2);assert.equal(t.state.standBids.helmet,undefined);
 assert.equal(t.state.merchantQueue.length,0);assert.equal(t.calls.filter(call=>call==='publish').length,1);
});

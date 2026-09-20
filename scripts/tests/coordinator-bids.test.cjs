const test=require('node:test');
const assert=require('node:assert/strict');
const {createBidPurchases}=require('../../runtime/coordinator/commerce/bids.ts');
const {createPontyMarket}=require('../../runtime/coordinator/commerce/ponty.ts');
function bids(){
 const state={standBids:{wcap:{quantity:2,price:500,minimumQuality:8}},merchantCurrent:null,merchantQueue:[],merchantCharacter:'M',merchantAutomations:{},ponty:{updatedAt:1000000,listings:[]},aldata:{marketListings:[]},activeRealm:'SR_USII'};
 const effects=[],ports={now:()=>1000000,nextCommand:()=>1,publish:()=>effects.push('publish'),log:(...args)=>effects.push(args),prioritized:()=>Object.entries(state.standBids),
  planPonty:(candidates,quantity)=>candidates.slice(0,quantity),stamp:job=>job,persist:()=>effects.push('persist'),dispatch:()=>effects.push('dispatch'),blacklisted:listing=>listing.seller==='Blocked'};
 return {state,effects,service:createBidPurchases(state,ports)};
}
const listing=(key,level,price,other={})=>({key,item:{name:'wcap',level},seller:'Seller',price,unitPrice:price,quantity:1,seenAt:1000000,serverIdentifier:'II',...other});
test('market bids select affordable eligible levels and cancel duplicate queued purchases when filled',()=>{
 const f=bids();f.state.aldata.marketListings=[listing('low',7,10),listing('expensive',8,600),listing('blocked',8,100,{seller:'Blocked'}),listing('a',8,200),listing('b',9,300)];
 f.service.queueMarket();assert.deepEqual(f.state.merchantQueue[0].listings.map(entry=>entry.key),['a','b']);
 f.service.queueMarket();assert.equal(f.state.merchantQueue.length,1);
 assert.equal(f.service.fulfill({name:'wcap',level:7},1),0);assert.equal(f.service.fulfill({name:'wcap',level:8},2),2);
 assert.equal(f.state.standBids.wcap,undefined);assert.equal(f.state.merchantQueue.length,0);
});
test('Ponty bids enforce the selected quality, freshness and PVP exclusions',()=>{
 const f=bids();f.state.ponty.listings=[listing('low',7,10),listing('pvp',8,100,{serverIdentifier:'PVP'}),listing('old',8,100,{seenAt:1}),listing('good',8,200)];
 assert.equal(f.service.queuePonty(),true);assert.deepEqual(f.state.merchantQueue[0].pontyCandidates.map(entry=>entry.key),['good']);
 assert.equal(f.service.queuePonty(),false);
});
test('an empty fresh local Ponty report suppresses that realm remotely and a dismissal survives refresh',async()=>{
 const state={listings:[]};let now=1000000;
 const remote=[{key:'us',serverRegion:'US',serverIdentifier:'II',seenAt:now},{key:'eu',serverRegion:'EU',serverIdentifier:'I',seenAt:now}];
 const service=createPontyMarket(state,{now:()=>now,catalog:()=>({allItems:{}}),request:async()=>remote,normalize:records=>records,realmExists:()=>true,queueMatches(){}});
 await service.refresh();service.observe({report:{realm:'US:II',seenAt:now},listings:[]});assert.deepEqual(state.listings.map(entry=>entry.key),['eu']);
 service.dismiss('eu');await service.refresh();assert.deepEqual(state.listings,[]);
 now+=30001;service.rebuild();assert.deepEqual(state.listings.map(entry=>entry.key),['us']);
 now+=90000;service.rebuild();assert.deepEqual(state.listings.map(entry=>entry.key),['us','eu']);
});

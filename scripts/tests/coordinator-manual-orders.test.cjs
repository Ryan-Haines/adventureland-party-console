const test=require('node:test'),assert=require('node:assert/strict');
const {createManualMarketOrderRoutes}=require('../../runtime/coordinator/http/manual-market-orders.ts');
function fixture(){
 const listing={key:'a',item:{name:'cap',level:8},price:500,quantity:2,seenAt:100000,serverRegion:'US',serverIdentifier:'II',seller:'Seller',buyer:'Buyer',slot:'trade1',rid:'rid'};
 const state={merchantCharacter:'M',activeRealm:'SR_USI',merchantQueue:[],merchantCurrent:null,statuses:{M:{nearbyStandListings:[listing]}},aldata:{marketListings:[listing],marketBuyOrders:[listing]},ponty:{listings:[]}};
 const calls=[],routes=createManualMarketOrderRoutes(state,{now:()=>100000,nextCommand:()=>1,stamp:job=>({...job,priority:50}),log:(...args)=>calls.push(args),persist:()=>calls.push('persist'),dispatch:()=>calls.push('dispatch'),plan:()=>null});
 function send(route,body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;}};routes[route]({body},res);return res;}
 return {state,listing,calls,send};
}
for(const sale of [false,true])test('ALData '+(sale?'sale':'purchase')+' clamps quantity and carries snapshot metadata and home realm',()=>{
 const f=fixture();assert.equal(f.send(sale?'sale':'purchase',sale?{order:{key:'a'},sellQuantity:9}:{listing:{key:'a'},buyQuantity:9}).code,200);
 const job=f.state.merchantQueue[0];assert.equal(job.homeRealm,'SR_USI');assert.equal(job.priority,50);
 if(sale){assert.equal(job.sellQuantity,2);assert.equal(job.buyOrder,f.listing);}else{assert.equal(job.listings[0].buyQuantity,2);assert.equal(job.listings[0].item.level,8);assert.deepEqual(job.completedListingKeys,[]);}
 assert.deepEqual(f.calls.slice(-2),['persist','dispatch']);
});
test('ALData invalid, missing, stale and PVP selections leave the queue unchanged',()=>{
 const f=fixture();assert.equal(f.send('purchase',{listing:{key:'a'},buyQuantity:0}).code,400);
 assert.equal(f.send('purchase',{listing:{key:'missing'},buyQuantity:1}).code,409);
 f.listing.seenAt=-20001;assert.equal(f.send('purchase',{listing:{key:'a'},buyQuantity:1}).code,409);
 f.listing.seenAt=100000;f.listing.serverIdentifier='PVP';assert.equal(f.send('sale',{order:{key:'a'},sellQuantity:1}).code,409);
 assert.deepEqual(f.state.merchantQueue,[]);assert.deepEqual(f.calls,[]);
});
test('stand batch validation is atomic and requires the advertised price and instance',()=>{
 const f=fixture(),line={seller:'Seller',slot:'trade1',rid:'rid',itemName:'cap',price:500,buyQuantity:1};
 assert.equal(f.send('stand',{listings:[line,{...line,rid:'old'}]}).code,409);assert.deepEqual(f.state.merchantQueue,[]);
 assert.equal(f.send('stand',{listings:[{...line,price:499}]}).code,409);
 assert.equal(f.send('stand',{listings:[line]}).code,200);assert.equal(f.state.merchantQueue[0].listings[0].item.level,8);
 assert.equal(f.state.merchantQueue[0].priority,undefined);
});
test('ALData orders preserve absent realm metadata instead of inventing a destination',()=>{
 const f=fixture();delete f.listing.serverRegion;delete f.listing.serverIdentifier;
 assert.equal(f.send('purchase',{listing:{key:'a'},buyQuantity:1}).code,200);
 const listing=f.state.merchantQueue[0].listings[0];
 assert.equal(Object.hasOwn(listing,'serverRegion'),false);assert.equal(Object.hasOwn(listing,'serverIdentifier'),false);
 assert.equal(listing.item,f.listing.item);assert.equal(f.state.merchantQueue[0].homeRealm,'SR_USI');
});

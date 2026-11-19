const {withDoor}=require('./helpers/coordinator-merchant.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {createNativeStand,nativeAllocation,nativeLedger}=require('../../runtime/items/coordinator/market.ts');
const {createNativeStandRoute}=require('../../runtime/items/coordinator/routes/market.ts');
const {createMerchantBidRoute}=require('../../runtime/items/coordinator/routes/market.ts');
const {createBidPurchases}=require('../../runtime/items/coordinator/market.ts');
const {createLocalMarket}=require('../../runtime/items/coordinator/market.ts');
const {publishedMarketListings}=require('../../runtime/items/coordinator/market.ts');
function fixture(){
 const state={standPriceHistory:{},standBids:{berry:{price:100,quantity:9,useStandSlot:true,revision:1}},standListings:[],merchantCharacter:'M',merchantCurrent:null,merchantQueue:[],merchantAutomations:{},ponty:{updatedAt:100,listings:[]},aldata:{marketListings:[]},activeRealm:'SR_USII',statuses:{},merchantCatalog:{allItems:[{id:'berry'},{id:'cap',upgradeable:true}]}};
 const effects=[],ports={now:()=>100,nextCommand:()=>1,publish:()=>effects.push('publish'),log(){},prioritized:()=>Object.entries(state.standBids),planPonty:(list,q)=>list.filter(x=>x.quantity<=q),stamp:x=>x,persist:()=>effects.push('persist'),dispatch(){},blacklisted:()=>false};
 const bids=createBidPurchases(state,withDoor(state,ports)),native=createNativeStand(state,bids.fulfill),route=createNativeStandRoute(state,withDoor(state,{fulfill:bids.fulfill,persist:ports.persist}));
 const observation={open:true,slots:{},gold:10000000,space:true,receipts:{}};
 return {state,effects,bids,native,route,ports,observation};
}
function placed(f){const offer=f.native.plan(f.observation,false).create[0];f.observation.slots[offer.slot]={b:true,name:offer.itemId,level:offer.level,price:offer.price,q:offer.quantity,rid:'server-1'};f.native.observe(f.observation);return offer;}
function send(route,body){const response={code:200,status(code){this.code=code;return this},json(body){this.body=body;return this}};route({body},response);return response;}
test('native partial fill updates one ledger and advertisements once across duplicate, delayed and restart reports',()=>{
 const f=fixture(),offer=placed(f);f.state.merchantQueue=[{id:'queued',reason:'Ponty purchases',bidItemId:'berry'}];
 f.observation.slots[offer.slot].q=8;f.native.observe(f.observation);f.native.observe(f.observation);
 assert.equal(f.state.standBids.berry.quantity,8);assert.equal(f.state.merchantQueue.length,0);assert.equal(f.effects.filter(x=>x==='publish').length,1);
 f.observation.receipts[offer.token]=1;f.native.observe(f.observation);assert.equal(f.state.standBids.berry.quantity,8);
 const restarted=structuredClone(f.state),service=createNativeStand(restarted,(item,q)=>restarted.standBids[item.name].quantity-=q);
 service.observe(f.observation);assert.equal(restarted.standBids.berry.quantity,8);assert.equal(restarted.nativeStand.offers[offer.token].acknowledged,1);
 const listings=publishedMarketListings({nativeSlice:null,tradableNative:0,missing:[]},f.state.standBids,[]);assert.equal(listings.find(entry=>entry.name==='berry').wtb.quantity,8);
 assert.equal(f.native.plan(f.observation,false).create.length,0,'never replenish an already purchased quantity');
});
test('full fill requires receipts; missing slot, closed stand, inventory or gold changes are not purchases',()=>{
 const f=fixture(),offer=placed(f);delete f.observation.slots[offer.slot];f.observation.open=false;f.observation.gold-=900;
 f.native.observe(f.observation);assert.equal(f.state.standBids.berry.quantity,9);
 // An emptied offer with no receipt and no copy received drops, and plan() places the order again.
 f.observation.open=true;f.native.observe(f.observation);assert.deepEqual(f.state.nativeStand.offers,{});assert.equal(f.state.standBids.berry.quantity,9);
 const retry=placed(f);assert.equal(retry.quantity,9);delete f.observation.slots[retry.slot];
 f.observation.receipts[retry.token]=9;f.native.observe(f.observation);assert.equal(f.state.standBids.berry,undefined);assert.deepEqual(f.state.nativeStand.offers,{});
 f.native.observe(f.observation);assert.equal(f.effects.filter(x=>x==='publish').length,1);
});
test('replacement does not imply a purchase but confirmed receipts still account for prior fills',()=>{
 for(const replacement of [{name:'berry',price:100,q:1},{b:true,name:'berry',price:100,q:1,rid:'other'}]){
  const f=fixture(),offer=placed(f);f.observation.slots[offer.slot]=replacement;f.observation.receipts[offer.token]=8;f.native.observe(f.observation);
  assert.equal(f.state.standBids.berry.quantity,1);
  assert.equal(f.state.nativeStand.offers[offer.token],replacement.b?offer:undefined);
  if(replacement.b)assert.equal(offer.phase,'live');
 }
});
test('removal race accounts for fills before removal acknowledgement and restores only remaining quantity',()=>{
 const f=fixture(),offer=placed(f);assert.equal(f.native.plan(f.observation,true).remove[0],offer);
 delete f.observation.slots[offer.slot];f.observation.receipts[offer.token]=1;f.observation.removed=offer.token;f.native.observe(f.observation);
 assert.equal(f.state.standBids.berry.quantity,8);assert.deepEqual(f.state.nativeStand.offers,{});
 assert.equal(f.native.plan(f.observation,false).create[0].quantity,8);
});
test('native equipment and ordinary batches are capped without truncating remaining orders',()=>{
 // The game caps every wishlist offer at 9,999 copies, equipment included.
 for(const [name,limit] of [['berry',9999],['cap',9999]]){const f=fixture();f.state.standBids={[name]:{price:1,quantity:20000,useStandSlot:true}};
  const offer=placed(f);assert.equal(offer.quantity,limit);assert.equal(f.state.standBids[name].quantity,20000);
  delete f.observation.slots[offer.slot];f.observation.receipts[offer.token]=limit;f.native.observe(f.observation);
  assert.equal(f.native.plan(f.observation,false).create[0].quantity,Math.min(limit,20000-limit));
 }
});
test('queued shopping does not suspend; execution removes native offers before reserving purchase',()=>{
 const f=fixture(),offer=placed(f);f.state.merchantQueue=[{id:'queued',reason:'ALData marketplace purchases',bidItemId:'berry'}];
 assert.equal(f.native.plan(f.observation,false).remove.length,0);
 f.state.merchantCurrent={id:'job',reason:'ALData marketplace purchases',bidItemId:'berry'};
 const request={character:'M',jobId:'job',action:'purchase',key:'listing',item:{name:'berry'},price:100,quantity:9};
 assert.equal(send(f.route,request).body.quantity,0);
 f.native.plan(f.observation,true);delete f.observation.slots[offer.slot];f.observation.removed=offer.token;f.observation.receipts[offer.token]=1;f.native.observe(f.observation);
 assert.equal(send(f.route,request).body.quantity,8);assert.equal(send(f.route,request).code,409);
 assert.equal(send(f.route,{...request,action:'purchased'}).code,200);send(f.route,{...request,action:'purchased'});
 assert.equal(f.state.standBids.berry,undefined);assert.equal(f.effects.filter(x=>x==='publish').length,2);
});
test('all shopping channels acknowledge partial/full purchases once; delayed completion survives job recovery',()=>{
 for(const reason of ['stand bid purchases','ALData marketplace purchases','Ponty purchases']){
  const f=fixture();f.state.merchantCurrent={id:'job',reason,bidItemId:'berry'};
  const body={character:'M',jobId:'job',action:'purchase',key:'a',item:{name:'berry'},price:100,quantity:1};
  assert.equal(send(f.route,body).body.quantity,1);f.state.merchantCurrent=null;
  send(f.route,{...body,action:'purchased'});send(f.route,{...body,action:'purchased'});assert.equal(f.state.standBids.berry.quantity,8);
  f.state.merchantCurrent={id:'next',reason,bidItemId:'berry'};assert.equal(send(f.route,{...body,jobId:'next',quantity:9}).body.quantity,8);
  send(f.route,{...body,jobId:'next',action:'purchased'});assert.equal(f.state.standBids.berry,undefined);
 }
});
test('ambiguous shopping is persisted and blocks both replenishment and later shopping',()=>{
 const f=fixture();f.state.merchantCurrent={id:'job',reason:'Ponty purchases',bidItemId:'berry'};
 const body={character:'M',jobId:'job',action:'purchase',key:'a',item:{name:'berry'},price:100,quantity:1};send(f.route,body);
 const saved=JSON.parse(JSON.stringify(f.state));saved.merchantCurrent={id:'next',reason:'Ponty purchases',bidItemId:'berry'};
 const route=createNativeStandRoute(saved,withDoor(saved,{fulfill(){},persist(){}}));assert.equal(send(route,{...body,jobId:'next'}).code,409);
 assert.equal(createNativeStand(saved,()=>{}).plan(f.observation,false).create.length,0);
});
test('exact levels apply to local, ALData, Ponty candidates and fulfillment',()=>{
 const f=fixture();f.state.standBids={cap:{price:100,quantity:2,minimumQuality:7,acceptHigherLevels:false}};
 const listing={key:'cap8',item:{name:'cap',level:8},quantity:1,price:50,unitPrice:50,seenAt:100,serverIdentifier:'II'};
 f.state.aldata.marketListings=[listing];f.state.ponty.listings=[listing];f.bids.queueMarket();f.bids.queuePonty();
 const local=createLocalMarket(f.state,withDoor(f.state,{now:()=>100,nextCommand:()=>1,pending:()=>false,priority:()=>1,log(){}}));local.observe([listing]);
 assert.equal(f.state.merchantQueue.length,0);assert.equal(f.bids.fulfill(listing.item,1),0);
 assert.equal(f.bids.fulfill({name:'cap',level:7},1),1);f.state.standBids.cap.acceptHigherLevels=true;f.bids.queueMarket();assert.equal(f.state.merchantQueue.length,1);
});
test('automatic allocation uses priority and ID ties, after sales and explicit buys; new sales evict auto',()=>{
 const f=fixture();f.state.autoStandBuys=true;f.state.standListings=Array.from({length:13},(_,i)=>({id:String(i),state:'live'}));
 f.state.standBids={z:{price:1,quantity:1,priorityOverride:99},a:{price:1,quantity:1,priorityOverride:99},explicit:{price:1,quantity:1,useStandSlot:true},low:{price:1,quantity:1,priorityOverride:1}};
 assert.deepEqual(nativeAllocation(f.state),[{itemId:'explicit',auto:false},{itemId:'a',auto:true},{itemId:'z',auto:true}]);
 f.state.standListings.push({id:'new',state:'configured'});assert.deepEqual(nativeAllocation(f.state).map(x=>x.itemId),['explicit','a']);assert.equal(f.state.standBids.a.useStandSlot,undefined);
});
test('full stand replacement is transactional: cancel has no mutation, selected sale pauses or explicit buy stays shopping',()=>{
 const f=fixture();f.state.standBids.berry.useStandSlot=false;f.state.standListings=Array.from({length:16},(_,i)=>({id:String(i),state:'live',item:{name:'sale'+i},price:2,quantity:1}));
 const route=createMerchantBidRoute(f.state,{removeQueued(){},log(){},observe(){},persist(){},publish(){},ponty:()=>true,aldata(){},dispatch(){}});
 const body={itemId:'berry',price:100,quantity:9,useStandSlot:true};nativeLedger(f.state);const before=JSON.stringify(f.state);
 const response=send(route,body);assert.equal(response.code,409);assert.equal(response.body.occupants.length,16);assert.equal(JSON.stringify(f.state),before);
 assert.equal(send(route,{...body,replaceStandEntry:'sale:0'}).code,200);assert.equal(f.state.standListings[0].state,'paused');assert.equal(f.state.standListings[0].price,2);
 f.state.standBids.cap={price:5,quantity:1};assert.equal(send(route,{itemId:'cap',price:5,quantity:1,useStandSlot:true,replaceStandEntry:'buy:berry'}).code,200);
 assert.equal(f.state.standBids.berry.quantity,9);assert.equal(f.state.standBids.berry.useStandSlot,false);f.state.autoStandBuys=true;assert.ok(!nativeAllocation(f.state).some(x=>x.itemId==='berry'));
});
test('edits retire changed offers; cancellation and recreation fence old receipts by order revision',()=>{
 const f=fixture(),offer=placed(f);f.state.standBids.berry.price=200;assert.equal(f.native.plan(f.observation,false).remove.length,1);
 f.state.standBids.berry={price:100,quantity:20,useStandSlot:true,revision:2};f.observation.slots[offer.slot].q=8;f.native.observe(f.observation);assert.equal(f.state.standBids.berry.quantity,20);
});
test('insufficient space reports a placement problem without changing cash targets',()=>{
 // No room for the order reports a placement problem; a gold shortfall pauses it instead (the
 // paused-gold row below).
 const f=fixture();f.state.goldTargets={M:1000};f.observation.space=false;
 assert.equal(f.native.plan(f.observation,false).create.length,0);assert.match(f.state.nativeStand.problems.berry,/Insufficient/);assert.equal(f.state.goldTargets.M,1000);
});
test('preference toggles preserve a newer shared remainder and cannot resurrect a completed order',()=>{
 const f=fixture();f.state.standBids.berry.quantity=8;
 const route=createMerchantBidRoute(f.state,{removeQueued(){},log(){},observe(){},persist(){},publish(){},ponty:()=>true,aldata(){},dispatch(){}});
 const body={itemId:'berry',price:50,quantity:9,preferencesOnly:true,useStandSlot:false};
 assert.equal(send(route,body).code,200);assert.equal(f.state.standBids.berry.quantity,8);assert.equal(f.state.standBids.berry.price,100);
 delete f.state.standBids.berry;assert.equal(send(route,body).code,400);assert.equal(f.state.standBids.berry,undefined);
});

test('field edits preserve live fulfillment and reject stale order identities',()=>{
 const f=fixture();f.state.standBids.berry.quantity=10;
 nativeLedger(f.state).sequence=1; // Revision 1 was allocated when this order was created.
 const route=createMerchantBidRoute(f.state,{removeQueued(){},log(){},observe(){},persist(){},publish(){},ponty:()=>true,aldata(){},dispatch(){}});
 f.bids.fulfill({name:'berry'},4);
 const edit=(editField,value,extra={})=>send(route,{itemId:'berry',editField,value,bidRevision:1,price:100,quantity:10,...extra});
 assert.equal(edit('price',95).code,200);assert.equal(f.state.standBids.berry.quantity,6);
 assert.equal(f.state.standBids.berry.price,95);
 assert.equal(edit('priorityOverride',99).code,200);assert.equal(f.state.standBids.berry.priorityOverride,99);
 assert.equal(edit('priorityOverride',null).code,200);assert.equal(f.state.standBids.berry.priorityOverride,undefined);
 assert.equal(f.state.standBids.berry.quantity,6);
 for(const [field,value] of [['price',0],['quantity',0],['priorityOverride',101],['unknown',1]]) {
  const before=JSON.stringify(f.state.standBids);assert.equal(edit(field,value).code,400);assert.equal(JSON.stringify(f.state.standBids),before);
 }
 assert.equal(edit('quantity',3).code,200);assert.equal(f.state.standBids.berry.quantity,3);
 f.bids.fulfill({name:'berry'},3);
 assert.equal(edit('price',90).code,409);assert.equal(f.state.standBids.berry,undefined);
 send(route,{itemId:'berry',price:90,quantity:2});
 assert.equal(edit('quantity',10).code,409);assert.equal(f.state.standBids.berry.quantity,2);
});

// A placed buy order the gold above the reserve cannot pay is removed and shows "paused: gold", with
// one `items.orderPaused` notice while it stays paused and none on the next plan; the cash target
// stays as it was, and when gold arrives the order is placed again.
test('a buy order short of gold is paused once and placed again when gold arrives',()=>{
 const {itemsSince}=require('./helpers/items-notices.cjs');
 const f=fixture(),offer=placed(f);f.state.statuses.M={gold:0};f.state.goldTargets={M:1000};
 const since=itemsSince(String(f.state.merchantCharacter));
 const short=f.native.plan({...f.observation,gold:0},false);
 assert.deepEqual(short.remove.map(x=>x.token),[offer.token]);assert.equal(f.state.nativeStand.problems.berry,'paused: gold');
 f.native.plan({...f.observation,gold:0},false);
 assert.deepEqual(since().filter(e=>e.decision==='orderPaused').map(e=>e.item),['berry']);
 assert.equal(f.state.goldTargets.M,1000);
 delete f.observation.slots[offer.slot];f.native.observe({...f.observation,removed:offer.token});
 const funded=f.native.plan(f.observation,false);
 assert.equal(funded.create.length,1);assert.equal(f.state.nativeStand.problems.berry,undefined);
});
// A live offer whose slot empties with no receipt is dropped, and the copies the
// merchant received since it was placed are booked as filled (red on an earlier build, which
// kept it).
test('an emptied offer is dropped and its received copies counted',()=>{
 const f=fixture();f.state.statuses.M={items:[]};const offer=placed(f);
 f.state.statuses.M.items=[{name:'berry',q:3}];delete f.observation.slots[offer.slot];
 f.native.observe(f.observation);
 assert.deepEqual(Object.keys(nativeLedger(f.state).offers),[]);
 assert.equal(f.state.standBids.berry.quantity,6,'nine wanted less the three received');
 // A live offer saved with no start count books none of the copies held before the report.
 const saved=fixture();saved.state.statuses.M={items:[]};const old=placed(saved);delete old.heldAtStart;
 saved.state.statuses.M.items=[{name:'berry',q:3}];saved.native.observe(saved.observation);
 delete saved.observation.slots[old.slot];saved.native.observe(saved.observation);
 assert.equal(saved.state.standBids.berry.quantity,9,'copies held before the first report are not received');
});


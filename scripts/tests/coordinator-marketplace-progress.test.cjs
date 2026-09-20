const test=require('node:test'),assert=require('node:assert/strict');
const {createMarketplaceProgressRoutes}=require('../../runtime/coordinator/http/marketplace-progress.ts');
function fixture(blacklistingEnabled=true){
 const listing={key:'a',item:{name:'cap',level:8},quantity:1,price:100,seller:'Seller',serverRegion:'US',serverIdentifier:'II'};
 const state={merchantCharacter:'M',merchantCurrent:{id:'job',target:'M',reason:'ALData marketplace purchases',listings:[listing]},merchantQueue:[],commands:{M:{}},standBids:{cap:{quantity:4}}};
 const calls=[],routes=createMarketplaceProgressRoutes(state,{blacklistingEnabled:()=>blacklistingEnabled,now:()=>100,fulfill:(item,q)=>{calls.push(['fulfill',item,q]);state.standBids.cap.quantity-=q;},log(){},dismiss:key=>calls.push(['dismiss',key]),persist:()=>calls.push(['persist']),blacklist:(...args)=>{calls.push(['blacklist',...args]);return {failures:1,cooldownMinutes:1,until:1000};}});
 function send(route,body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};routes[route]({body:{jobId:'job',listingKey:'a',...body}},res);return res;}
 return {state,calls,listing,send};
}
test('successful marketplace progress fulfills once and pulls queued listings for the same seller into the visit',()=>{
 const t=fixture(),next={...t.listing,key:'b'};t.state.merchantQueue=[{reason:'ALData marketplace purchases',bidItemId:'cap',listings:[next,{...next,key:'c',seller:'Other'}]}];
 const result=t.send('aldata',{success:true,quantity:1}).body;assert.equal(result.remaining,3);assert.equal(result.additionalListings[0].bidItemId,'cap');
 assert.deepEqual(t.state.merchantCurrent.listings.map(x=>x.key),['a','b']);assert.equal(t.state.merchantQueue[0].listings[0].key,'c');
 assert.equal(t.send('aldata',{success:true,quantity:1}).body.alreadyCompleted,true);assert.equal(t.state.standBids.cap.quantity,3);
});
test('unavailable listing is not evidence to blacklist the seller or cancel other purchases',()=>{
 const t=fixture();t.state.merchantCurrent.listings.push({...t.listing,key:'b'});
 assert.equal(t.send('aldata',{success:false,failureCode:'listing_not_available'}).body.cancelSeller,null);
 assert.deepEqual(t.state.merchantCurrent.completedListingKeys,['a']);assert.equal(t.calls.some(x=>x[0]==='blacklist'),false);
});
test('missing seller cancels that realm-specific seller in current and queued work while retaining other sellers',()=>{
 const t=fixture(),same={...t.listing,key:'b'},different={...same,key:'c',serverIdentifier:'I'};
 t.state.merchantCurrent.listings.push(same,different);t.state.merchantQueue=[{reason:'ALData marketplace purchases',listings:[same,different]},{reason:'fishing'}];
 const result=t.send('aldata',{success:false,failureCode:'seller_not_visible'}).body;assert.equal(result.cancelSeller.seller,'Seller');
 assert.deepEqual(t.state.merchantCurrent.completedListingKeys,['a','b']);assert.equal(t.state.merchantQueue[0].listings[0].key,'c');assert.equal(t.state.merchantQueue[1].reason,'fishing');
});
test('Ponty progress dismisses once and fulfills the planned listing quantity',()=>{
 const t=fixture();t.state.merchantCurrent.reason='Ponty purchases';t.listing.quantity=2;
 t.send('ponty',{success:true});t.send('ponty',{success:true});assert.equal(t.state.standBids.cap.quantity,2);assert.equal(t.calls.filter(x=>x[0]==='dismiss').length,1);
 assert.equal(t.send('ponty',{listingKey:'missing'}).code,400);
});
for(const success of [true,false])test('purchase '+(success?'collection':'cancellation')+' retains unrelated and incomplete queued jobs by identity',()=>{
 const t=fixture(),fishing={reason:'fishing'},stand={reason:'stand purchases',listings:[{seller:'Seller'}]},incomplete={reason:'ALData marketplace purchases'};
 t.state.merchantQueue=[fishing,stand,incomplete];
 t.send('aldata',{success,quantity:1,failureCode:'seller_not_visible'});
 assert.equal(t.state.merchantQueue[0],fishing);assert.equal(t.state.merchantQueue[1],stand);assert.equal(t.state.merchantQueue[2],incomplete);
});

test('disabling automatic blacklisting skips an unavailable seller without adding a strike',()=>{
 const t=fixture(false);const result=t.send('aldata',{success:false,failureCode:'seller_not_visible'});
 assert.equal(result.code,200);assert.equal(result.body.cancelSeller.seller,'Seller');
 assert.equal(t.calls.some(call=>call[0]==='blacklist'),false);
});

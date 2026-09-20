const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeMarketSales,normalizeMarketBids}=require('../../runtime/coordinator/commerce/market-normalization.ts');
const {observeMarketPrices,observeMarketTrades}=require('../../runtime/coordinator/commerce/price-history.ts');
const {merchantBlocked,recordMerchantFailure}=require('../../runtime/coordinator/commerce/merchant-blacklist.ts');
const {createALDataService}=require('../../runtime/coordinator/commerce/aldata-service.ts');
const {createLocalMarket}=require('../../runtime/coordinator/commerce/local-market.ts');
const {publishedMarketListings}=require('../../runtime/coordinator/commerce/public-listings.ts');
const merchant=slots=>({id:'Seller',serverRegion:'US',serverIdentifier:'II',lastSeen:'2026-09-12T12:00:00Z',slots});
test('market normalization preserves item level and separates sales from buy orders',()=>{
 const reports=[merchant({trade1:{name:'wcap',level:7,price:100,q:2},trade2:{name:'wcap',level:8,price:500,b:true},trade3:{name:'coat',price:0}})];
 const sales=normalizeMarketSales(reports),bids=normalizeMarketBids(reports);
 assert.equal(sales.length,1);assert.equal(sales[0].item.level,7);assert.equal(sales[0].key,'Seller:US:II:trade1:wcap:7:100');
 assert.equal(bids.length,1);assert.equal(bids[0].buyer,'Seller');assert.equal(bids[0].seller,undefined);assert.equal(bids[0].item.level,8);
});
test('normalized market coordinates are numeric while map metadata remains untouched',()=>{
 const rawMap={legacy:'main'},report={...merchant({trade1:{name:'cap',price:10}}),map:rawMap,x:'12',y:'invalid'};
 const listing=normalizeMarketSales([report])[0];
 assert.equal(listing.map,rawMap);assert.equal(listing.x,12);assert.equal(listing.y,0);
 delete report.map;delete report.x;delete report.y;
 const missing=normalizeMarketSales([report])[0];
 assert.equal(missing.map,undefined);assert.equal(missing.x,0);assert.equal(missing.y,0);
});
test('history distinguishes historical low, fresh low, recent listing and highest WTB levels',()=>{
 const history={wcap:{lowest:50,lowestLevel:3},coat:{marketLow:1,marketLowLevel:1,highestPublicWTB:100}};
 observeMarketPrices(history,[{item:{name:'wcap',level:8},price:500,seenAt:999999},{item:{name:'wcap',level:7},price:100,seenAt:999998}],false,1000000);
 assert.equal(history.wcap.lowestLevel,3);assert.equal(history.wcap.marketLowLevel,7);assert.equal(history.wcap.recentLevel,8);assert.equal(history.coat.marketLow,undefined);
 observeMarketTrades(history,[{listings:[{name:'wcap',level:8,wtb:{price:900}},{name:'wcap',level:7,wtb:{price:200}}]}]);
 assert.equal(history.wcap.highestPublicWTB,900);assert.equal(history.wcap.highestPublicWTBLevel,8);assert.equal(history.coat.highestPublicWTB,undefined);
});
test('merchant retry cooldown grows from retained strikes after the previous cooldown expires',()=>{
 const records={},identity={seller:'Seller',serverRegion:'US',serverIdentifier:'II'};
 recordMerchantFailure(records,identity,'missing',100);assert.equal(merchantBlocked(records,identity,60100),false);
 const second=recordMerchantFailure(records,identity,'missing',60101);assert.equal(second.failures,2);assert.equal(second.until,180101);
});
function fixture(responses){
 const state={key:'secret',auth:'CORRECT',marketListings:[],marketBuyOrders:[],trades:[]},calls=[];
 const ports={request:async(...args)=>{calls.push(args);const next=responses.shift();if(next instanceof Error)throw next;return next;},now:()=>100,
  observePrices:()=>calls.push(['prices']),observeTrades:()=>calls.push(['trades']),queueMatches:()=>calls.push(['queue']),persistSettings:()=>calls.push(['persist']),
  persistAuthentication:()=>calls.push(['auth']),owner:()=> 'owner',merchant:()=> 'M',publishedListings:()=>[{name:'wcap',level:8,wtb:{price:500}}]};
 return {state,calls,service:createALDataService(state,ports)};
}
test('partial market snapshots retry once and preserve known sales when the retry is also partial',async()=>{
 const bid=[merchant({trade1:{name:'wcap',b:true,price:50}})],f=fixture([bid,bid]);f.state.marketListings=[{key:'old'}];
 await f.service.refresh('merchants');assert.equal(f.calls.filter(entry=>entry[0]==='/merchants').length,2);
 assert.equal(f.state.marketListings[0].key,'old');assert.equal(f.state.marketBuyOrders.length,1);assert.equal(f.state.refreshing,false);
 assert.equal(f.service.snapshot().key,undefined);
});
test('market failures release the refresh latch; authenticated publication sends the selected level',async()=>{
 const f=fixture([new Error('offline'),null]);await f.service.refresh();assert.equal(f.state.error,'offline');assert.equal(f.state.refreshing,false);
 assert.equal(await f.service.publish(),true);const request=f.calls.find(entry=>entry[0].startsWith('/trades/'));
 assert.equal(JSON.parse(request[1].body).listings[0].level,8);assert.equal(f.state.publishStatus,'published');assert.equal(f.state.error,null);
});

test('local stand matching respects bid priority and caps purchased quantities',()=>{
 const state={standPriceHistory:{},standBids:{wcap:{quantity:2,price:500,minimumQuality:8},coat:{quantity:1,price:100}},merchantAutomations:{},merchantCurrent:null,merchantQueue:[],merchantCharacter:'M'};
 const service=createLocalMarket(state,{now:()=>100,nextCommand:()=>1,pending:()=>false,priority:id=>id==='wcap'?90:10,log(){}});
 const listings=[{item:{name:'coat'},price:10,quantity:1},{item:{name:'wcap',level:7},price:50,quantity:1},{item:{name:'wcap',level:8},price:200,quantity:10}];
 assert.equal(service.observe(listings),true);assert.equal(state.merchantQueue[0].bidItemId,'wcap');assert.equal(state.merchantQueue[0].listings[0].buyQuantity,2);
 assert.equal(state.standPriceHistory.wcap.lowestLevel,7);
});

test('published standing bids and sales retain levels without adding a zero level',()=>{
 const result=publishedMarketListings({nativeSlice:null,tradableNative:0,missing:[]},{wcap:{minimumQuality:8,quantity:1,price:500}},
  [{item:{name:'coat',level:0,p:'shiny'},price:20,quantity:1,state:'live'}]);
 assert.equal(result[0].level,8);assert.equal(result[0].wtb.price,500);assert.equal(result[1].level,undefined);assert.equal(result[1].p,'shiny');
});

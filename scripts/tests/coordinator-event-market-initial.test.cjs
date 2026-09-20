const test=require('node:test'),assert=require('node:assert/strict');
const {initialAnniversaryState}=require('../../runtime/coordinator/anniversary/initial-state.ts');
const {initialALDataState}=require('../../runtime/coordinator/commerce/initial-aldata.ts');
test('anniversary defaults preserve saved rounds, attempts, and additional fields',()=>{
 const saved={rounds:{r:1},attempts:{a:2},crafted:3,extra:true};const state=initialAnniversaryState(saved);
 assert.equal(state.rounds,saved.rounds);assert.equal(state.attempts,saved.attempts);assert.equal(state.crafted,3);assert.equal(state.extra,true);
 assert.deepEqual(initialAnniversaryState(null).attempts,{});assert.deepEqual(initialAnniversaryState({attempts:false}).attempts,{});
 assert.notEqual(initialAnniversaryState().rounds,initialAnniversaryState().rounds);
});
test('ALData restores saved history and timestamps while resetting transient request state',()=>{
 const trades=[{id:1}],listings=[{id:2}],orders=[{id:3}];const state=initialALDataState({key:'key',auth:'YES',authCheckedAt:'12',publishedAt:'34'},
 {aldataTrades:trades,aldataMarketListings:listings,aldataMarketBuyOrders:orders,aldataMerchantsUpdatedAt:'56',aldataTradesUpdatedAt:'78'});
 assert.equal(state.key,'key');assert.equal(state.auth,'YES');assert.equal(state.authCheckedAt,12);assert.equal(state.publishedAt,34);assert.equal(state.trades,trades);assert.equal(state.marketListings,listings);assert.equal(state.marketBuyOrders,orders);
 assert.equal(state.merchantsUpdatedAt,56);assert.equal(state.tradesUpdatedAt,78);assert.deepEqual(state.merchants,[]);assert.deepEqual(state.requestTimes,[]);assert.equal(state.publishTimer,null);assert.equal(state.publishStatus,'idle');assert.equal(state.error,null);
});
test('ALData applies legacy coercion for absent or invalid saved values',()=>{
 const state=initialALDataState({key:42,auth:'',authCheckedAt:'bad'},{});assert.equal(state.key,'');assert.equal(state.auth,'NO');assert.equal(state.authCheckedAt,0);assert.deepEqual(state.trades,[]);
});

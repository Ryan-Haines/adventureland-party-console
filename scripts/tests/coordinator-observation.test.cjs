const test=require('node:test');
const assert=require('node:assert/strict');
const {createMerchantObservation}=require('../../runtime/items/coordinator/market.ts');
const {appendActivity,createCoordinatorActivity}=require('../../runtime/status/coordinator/logs.ts');

test('observed partial and complete stand sales update reservations and publish once per observation',()=>{
 const state={standListings:[{tradeSlot:'trade1',item:{name:'coat',q:10},quantity:10}]},effects=[];
 const observer=createMerchantObservation(state,{log:(message,level)=>effects.push([message,level]),persist:()=>effects.push('persist'),publish:()=>effects.push('publish')});
 const before={standOpen:true,gold:100,slots:{trade1:{item:{name:'coat',q:10}}}};
 const after={standOpen:true,gold:200,slots:{trade1:{item:{name:'coat',q:6}}}};
 observer.observe(after,before);assert.equal(state.standListings[0].quantity,6);assert.equal(state.standListings[0].item.q,6);
 assert.deepEqual(effects,[['Sold coat × 4 at stand (+100 gold)','success'],'persist','publish']);
 observer.observe({standOpen:true,gold:300,slots:{}},after);assert.deepEqual(state.standListings,[]);
 assert.match(effects[3][0],/Sold coat × 6/);
});

test('inventory differences without a matching gold increase do not imply stand sales',()=>{
 const state={standListings:[{tradeSlot:'trade1',item:{name:'coat'}}]},effects=[];
 const observer=createMerchantObservation(state,{log:message=>effects.push(message),persist:()=>effects.push('persist'),publish:()=>effects.push('publish')});
 observer.observe({standOpen:true,gold:100,slots:{}},{standOpen:true,gold:100,slots:{trade1:{item:{name:'coat'}}}});
 assert.equal(state.standListings.length,1);assert.deepEqual(effects,[]);
});

test('activity keeps the history document bound, and only a merchant line saves it',()=>{
 const entries=[];const now=1;
 for(let index=0;index<600;index++)appendActivity(entries,'event '+index,'info',null,()=>now);
 assert.equal(entries.length,500);assert.equal(entries[0].message,'event 100');
 // The merchant line saves the history document; the anniversary line is not in it.
 const state={merchantActivity:[],anniversary:{activity:[]}};let saves=0;
 const activity=createCoordinatorActivity(state,{now:()=>2,persistHistory:()=>saves++});
 activity.anniversary('kiss');assert.equal(saves,0);assert.deepEqual(state.anniversary.activity.map(e=>e.message),['kiss']);
 activity.merchant('sold','success');assert.equal(saves,1);assert.deepEqual(state.merchantActivity,[{at:2,level:'success',message:'sold',details:null}]);
});

// The stand log tested the legacy point (-63, 100), so a stand opened at the configured location
// logged "Stand opened away from market".
test('a stand opened at the configured location logs At stand, and the legacy point only counts with none set',()=>{
 const effects=[],state={standListings:[],merchantStandLocation:{map:'main',x:20,y:-40}};
 const observer=createMerchantObservation(state,{log:(message)=>effects.push(message),persist(){},publish(){}});
 observer.observe({standOpen:true,map:'main',x:22,y:-38,gold:0},{standOpen:false,gold:0});
 state.merchantStandLocation=null;
 observer.observe({standOpen:true,map:'main',x:-60,y:98,gold:0},{standOpen:false,gold:0});
 assert.deepEqual(effects,['At stand','At stand']);
});

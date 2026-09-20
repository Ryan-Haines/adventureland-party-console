const test=require('node:test');
const assert=require('node:assert/strict');
const {createMerchantObservation}=require('../../runtime/coordinator/status/merchant-observation.ts');
const {appendActivity,appendMerchantActivity}=require('../../runtime/coordinator/telemetry/activity.ts');

test('observed partial and complete stand sales update reservations and publish once per observation',()=>{
 const state={listings:[{tradeSlot:'trade1',item:{name:'coat',q:10},quantity:10}]},effects=[];
 const observer=createMerchantObservation(state,{log:(message,level)=>effects.push([message,level]),persist:()=>effects.push('persist'),publish:()=>effects.push('publish')});
 const before={standOpen:true,gold:100,slots:{trade1:{item:{name:'coat',q:10}}}};
 const after={standOpen:true,gold:200,slots:{trade1:{item:{name:'coat',q:6}}}};
 observer.observe(after,before);assert.equal(state.listings[0].quantity,6);assert.equal(state.listings[0].item.q,6);
 assert.deepEqual(effects,[['Sold coat × 4 at stand (+100 gold)','success'],'persist','publish']);
 observer.observe({standOpen:true,gold:300,slots:{}},after);assert.deepEqual(state.listings,[]);
 assert.match(effects[3][0],/Sold coat × 6/);
});

test('inventory differences without a matching gold increase do not imply stand sales',()=>{
 const state={listings:[{tradeSlot:'trade1',item:{name:'coat'}}]},effects=[];
 const observer=createMerchantObservation(state,{log:message=>effects.push(message),persist:()=>effects.push('persist'),publish:()=>effects.push('publish')});
 observer.observe({standOpen:true,gold:100,slots:{}},{standOpen:true,gold:100,slots:{trade1:{item:{name:'coat'}}}});
 assert.equal(state.listings.length,1);assert.deepEqual(effects,[]);
});

test('activity suppresses only recent duplicate cooldown messages and keeps bounded history',()=>{
 const entries=[],message='Fishing cooling down; will resume automatically';let now=1;
 assert.equal(appendMerchantActivity(entries,message,'info',null,()=>now),true);
 now=300000;assert.equal(appendMerchantActivity(entries,message,'info',null,()=>now),false);
 now=300001;assert.equal(appendMerchantActivity(entries,message,'info',null,()=>now),true);
 for(let index=0;index<600;index++)appendActivity(entries,'event '+index,'info',null,()=>now);
 assert.equal(entries.length,500);assert.equal(entries[0].message,'event 100');
});

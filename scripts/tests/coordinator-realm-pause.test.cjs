const test=require('node:test'),assert=require('node:assert/strict');
const {pauseMerchantForRealm}=require('../../runtime/coordinator/merchant/realm-pause.ts');
test('realm pause retains work intent and queue age but discards command progress',()=>{
 const current={id:'job',target:'F',queuedAt:'42',phase:'work',startedAt:1,heartbeatAt:2,progressAt:3,handoff:{gold:4},order:{buys:['ring']}};
 const state={merchantCurrent:current,merchantQueue:[{id:'next'}],commands:{F:{id:1},M:{id:2}}};
 pauseMerchantForRealm(state,()=>100,job=>({...job,priority:5}));
 assert.deepEqual(state.merchantQueue[0],{id:'job',target:'F',queuedAt:42,order:{buys:['ring']},priority:5});
 assert.equal(state.merchantQueue[1].id,'next');assert.equal(state.merchantCurrent,null);assert.equal(state.commands.F,undefined);assert.deepEqual(state.commands.M,{id:2});assert.equal(current.phase,'work');
 pauseMerchantForRealm(state,()=>200,()=>{throw Error('must not stamp');});assert.equal(state.merchantQueue.length,2);
});
test('realm pause fills a missing queue timestamp without deleting unrelated commands',()=>{
 const state={merchantCurrent:{id:'job',queuedAt:0},merchantQueue:[],commands:{M:{}}};
 pauseMerchantForRealm(state,()=>100,job=>job);assert.equal(state.merchantQueue[0].queuedAt,100);assert.deepEqual(state.commands,{M:{}});
});

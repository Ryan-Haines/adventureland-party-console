const test=require('node:test'),assert=require('node:assert/strict');
const {recoverMerchantQueue}=require('../../runtime/coordinator/merchant/restart-queue.ts');
test('process restart recovers cargo and job intent once, removing only original transient fields',()=>{
 const current={id:'current',target:'F',phase:'handoff',startedAt:1,heartbeatAt:2,handoff:{banked:['mark'],gold:'12'}};
 const state={merchantCurrent:current,merchantQueue:[{id:'queued'}],merchantCargo:{bank:[],gold:3}};
 recoverMerchantQueue(state,()=>100,job=>({...job,priority:9}));
 assert.equal(state.merchantCurrent,null);assert.deepEqual(state.merchantCargo,{bank:[{owner:'F',mark:'mark'}],gold:15});
 assert.deepEqual(state.merchantQueue[0],{id:'current',target:'F',heartbeatAt:2,reason:'resumed service',queuedAt:100,priority:9});
 assert.equal(current.phase,'handoff');recoverMerchantQueue(state,()=>200,job=>job);assert.equal(state.merchantCargo.gold,15);
});
test('recovered commerce job wins exact-order deduplication without collapsing other work',()=>{
 const order={buys:[{name:'ring'}]},current={id:'current',reason:'merchant commerce',queuedAt:4,order};
 const state={merchantCurrent:current,merchantQueue:[{id:'duplicate',reason:'merchant commerce',order:{...order,crafts:[]}},{id:'different',reason:'merchant commerce',order:{buys:[{name:'coat'}]}},{id:'other',reason:'manual visit',order}],merchantCargo:{bank:[],gold:0}};
 const stamped=[];recoverMerchantQueue(state,()=>100,job=>{stamped.push(job.id);return job;});
 assert.deepEqual(stamped,['current','different','other']);assert.equal(state.merchantQueue[0].queuedAt,4);
});

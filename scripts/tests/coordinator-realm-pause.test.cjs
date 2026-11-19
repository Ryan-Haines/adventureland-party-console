const test=require('node:test'),assert=require('node:assert/strict');
const {pauseCurrentJob}=require('../../runtime/merchant-jobs/coordinator/api.ts');
// v1.5.0's row planted progressAt: 3, the stamp its 90 s commerce requeue read. v1.5.0
// replaced that window with the item reply bound, so a merchant job carries no
// progressAt and this row plants none.
test('realm pause retains work intent and queue age but discards command progress',()=>{
 const current={id:'job',target:'F',queuedAt:'42',phase:'work',startedAt:1,heartbeatAt:2,handoff:{gold:4},order:{buys:['ring']}};
 const state={merchantCurrent:current,merchantQueue:[{id:'next'}],commands:{F:{id:1,type:'merchant-handoff',jobId:'job'},M:{id:2}}};
 pauseCurrentJob(state,'realm',()=>100,job=>({...job,priority:5}));
 assert.deepEqual(state.merchantQueue[0],{id:'job',target:'F',queuedAt:42,order:{buys:['ring']},priority:5,pausedBy:'realm'});
 assert.equal(state.merchantQueue[1].id,'next');assert.equal(state.merchantCurrent,null);assert.equal(state.commands.F,undefined);assert.deepEqual(state.commands.M,{id:2});assert.equal(current.phase,'work');
 pauseCurrentJob(state,'realm',()=>200,()=>{throw Error('must not stamp');});assert.equal(state.merchantQueue.length,2);
});
test('realm pause fills a missing queue timestamp without deleting unrelated commands',()=>{
 const state={merchantCurrent:{id:'job',queuedAt:0},merchantQueue:[],commands:{M:{}}};
 pauseCurrentJob(state,'realm',()=>100,job=>job);assert.equal(state.merchantQueue[0].queuedAt,100);assert.deepEqual(state.commands,{M:{}});
});

// A party switch never pauses an ALData sale, so the sale is never requeued and filled twice; it runs
// to its end or its deadline.
test('the realm pause leaves an ALData sale running', () => {
  const sale = { id: 'sale', reason: 'ALData marketplace sales', phase: 'processing', queuedAt: 4 };
  const state = { merchantCharacter: 'M', merchantCurrent: sale, merchantQueue: [], commands: { M: { id: 1, jobId: 'sale' } } };
  pauseCurrentJob(state,'realm',() => 100, job => job);
  assert.equal(state.merchantCurrent, sale);
  assert.equal(state.merchantQueue.length, 0);
  assert.equal(state.commands.M.jobId, 'sale');
});

const test=require('node:test'),assert=require('node:assert/strict');
const {createCompletionRetries}=require('../../runtime/coordinator/merchant/completion-retries.ts');
const {fixture}=require('./helpers/coordinator-completion.cjs');
function policy(error,count=0){
 const f=fixture({job:{reason:'merchant luck',rendezvousRetryCount:count}});
 return createCompletionRetries(f.state,f.ports).decide(f.state.merchantCurrent,{success:false,error});
}
test('rendezvous timeouts retry twice; anniversary pauses do not consume timeout retries',()=>{
 assert.equal(policy('F rendezvous timed out',0).rendezvous,true);
 assert.equal(policy('F rendezvous timed out',1).rendezvous,true);
 assert.equal(policy('F rendezvous timed out',2).retry,false);
 assert.equal(policy('merchant_anniversary_reserved',2).retry,true);
 assert.equal(policy('merchant_anniversary_reserved',2).rendezvous,false);
});
test('retry preserves itinerary and defers dispatch for ten seconds',()=>{
 const f=fixture({job:{reason:'merchant luck',batchId:'trip',retryCount:0,exchanges:[]}});
 const retries=createCompletionRetries(f.state,f.ports),job=f.state.merchantCurrent;
 retries.enqueue(job,retries.decide(job,{error:'F rendezvous timed out'}));
 assert.equal(f.state.merchantQueue[0].retryAt,110000);
 assert.equal(f.state.merchantQueue[0].batchId,'trip');
 assert.equal(f.state.merchantQueue[0].rendezvousRetryCount,1);
});

const test=require('node:test'),assert=require('node:assert/strict');
const {createCompletionRetries}=require('../../runtime/merchant-jobs/coordinator/endings.ts');
const {fixture}=require('./helpers/coordinator-completion.cjs');
function policy(error,count=0,code){
 const f=fixture({job:{reason:'merchant luck',rendezvousRetryCount:count}});
 return createCompletionRetries(f.state,f.ports).decide(f.state.merchantCurrent,{success:false,error,code});
}
// MJ11: a rendezvous timeout no longer stops after two retries; every
// one retries and names the failure the next claim books on the tasks owner's merchant-job ladder.
test('MJ11: rendezvous timeouts retry at every count and book the ladder; anniversary pauses book nothing',()=>{
 for(const count of [0,1,2,5]){
  const decision=policy('F rendezvous timed out',count);
  assert.equal(decision.retry,true);assert.equal(decision.row.ladder,'rendezvous-timeout');
 }
 assert.equal(policy('merchant_anniversary_reserved',2,'merchant_anniversary_reserved').retry,true);
 assert.equal(policy('merchant_anniversary_reserved',2,'merchant_anniversary_reserved').row.ladder,null);
});
test('retry preserves itinerary and defers dispatch for ten seconds',()=>{
 const f=fixture({job:{reason:'merchant luck',batchId:'trip',retryCount:0,exchanges:[]}});
 const retries=createCompletionRetries(f.state,f.ports),job=f.state.merchantCurrent;
 retries.enqueue(job,retries.decide(job,{error:'F rendezvous timed out'}));
 assert.equal(f.state.merchantQueue[0].retryAt,110000);
 assert.equal(f.state.merchantQueue[0].batchId,'trip');
 assert.equal(f.state.merchantQueue[0].rendezvousRetryCount,1);
 assert.equal(f.state.merchantQueue[0].ladderDue,'rendezvous-timeout');
});
test("P5: the add-on waits 30 s before a retry, a shorter wait keeps core's, and it gives a job up on its second failure",()=>{
 const {partyHooks}=require('../../runtime/hooks/index.ts');
 let wait=30000;
 assert.deepEqual(partyHooks().register({name:'patient',folder:'addons',author:'test',summary:'Waits longer.',
  hooks:{'retry.policy':ask=>ask.owner==='merchant-jobs'?{wait,giveUp:ask.attempt>=1}:undefined}}),{ok:true});
 partyHooks().configure({patient:{enabled:true}});
 try{
  const run=(retryCount)=>{const f=fixture({job:{reason:'merchant luck',retryCount,exchanges:[]}});
   const retries=createCompletionRetries(f.state,f.ports),job=f.state.merchantCurrent;
   retries.enqueue(job,retries.decide(job,{error:'F rendezvous timed out'}));return f.state.merchantQueue;};
  assert.equal(run(0)[0].retryAt,130000);
  wait=1000;
  assert.equal(run(0)[0].retryAt,110000);
  assert.equal(run(1).length,0);
 }finally{partyHooks().configure({patient:{enabled:false}});}
});

const test=require('node:test'),assert=require('node:assert/strict');
const {createMerchantCompletionRoute}=require('../../runtime/merchant-jobs/coordinator/routes.ts');
const {fixture}=require('./helpers/coordinator-completion.cjs');

test('unresolved upgrade ambiguity installs an inventory recovery block rather than immediate retry',()=>{
 const f=fixture({job:{reason:'manual upgrades'}});
 createMerchantCompletionRoute(f.state,f.ports)({body:{jobId:'job',success:false,error:'Upgrade inventory recovery ambiguous: sword +0 to +1; original slot 7; candidates 10, 11',code:'upgrade_ambiguous'}},f.response);
 assert.equal(typeof f.state.merchantJobBlocks['F\nmanual upgrades']?.upgradeRecoverySignature,'string');
 assert.equal(f.state.merchantQueue.length,0);
});


test('upgrade and compound communication failures preserve work with escalating durable delays',()=>{
 const {createCompletionRetries}=require('../../runtime/merchant-jobs/coordinator/endings.ts');
 for(const reason of ['upgrades and compounds','manual upgrades','auto upgrade','manual compounds','auto compound']) {
  const f=fixture({job:{reason}}),retries=createCompletionRetries(f.state,f.ports);
  let job=f.state.merchantCurrent;
  for(const delay of [10000,30000,60000,300000,300000]) {
   const body={success:false,error:'POST /movement-plan · timeout'};
   const decision=retries.decide(job,body);assert.equal(decision.retry,true);
   retries.enqueue(job,decision);job=f.state.merchantQueue.shift();
   assert.equal(job.retryAt,f.ports.now()+delay);
   assert.equal(job.reason,reason);assert.equal(job.commandId,undefined);
   job=JSON.parse(JSON.stringify(job));
  }
  assert.equal(retries.decide(job,{success:false,error:'Bank item unavailable'}).retry,false);
  assert.equal(retries.decide(job,{success:true,error:'POST /movement-plan · timeout'}).retry,false);
 }
});
test('transient lucky-slot input loss retries automatic upgrades without a capacity block',()=>{
 const f=fixture({job:{reason:'auto upgrade'}});
 createMerchantCompletionRoute(f.state,f.ports)({body:{jobId:'job',success:false,error:"Couldn't use lucky slot: item or scroll unavailable",code:'lucky_unavailable'}},f.response);
 assert.deepEqual(f.state.merchantJobBlocks,{});
 assert.equal(f.state.merchantQueue.length,1);
 assert.equal(f.state.merchantQueue[0].reason,'auto upgrade');
});
// The key mail marks the account YES and asks the publication, which runs the key check once ALData
// has had its rate window (coordinator-market-feeds.test.cjs). Before, a 65 s timer here checked it.
test('a sent key mail marks the account YES and asks the publication, with no timer',()=>{
 const f=fixture({job:{reason:'ALData authentication'}});
 createMerchantCompletionRoute(f.state,f.ports)({body:{jobId:'job',success:true}},f.response);
 assert.equal(f.state.aldata.auth,'YES');
 assert.equal(f.state.aldata.authCheckedAt,f.ports.now());
 assert.ok(f.calls.some(call=>call[0]==='publishALData'));
 assert.deepEqual(f.timers,[]);
});
test('deferred automatic compounds never fabricate manual improvement jobs',()=>{
 const f=fixture({job:{reason:'auto compound'},state:{upgrades:{},statScrolls:{},compounds:{},purchases:{},autoCompounds:{}}});
 createMerchantCompletionRoute(f.state,f.ports)({body:{jobId:'job',success:true,deferredWork:true}},f.response);
 assert.deepEqual(f.calls.filter(c=>c[0]==='queue'),[['queue',['F'],'auto compound']]);
 assert.equal(f.state.merchantQueue.length,0);
});
test('empty deferred work creates no follow-up, and automatic upgrade marks keep their classification',()=>{
 for(const upgrades of [[],[{name:'sword',auto:true}]]) {
  const f=fixture({job:{reason:'merchant luck'},state:{upgrades:{F:upgrades},statScrolls:{},compounds:{},purchases:{},autoCompounds:{}}});
  createMerchantCompletionRoute(f.state,f.ports)({body:{jobId:'job',success:true,deferredWork:true}},f.response);
  assert.deepEqual(f.calls.filter(c=>c[0]==='queue'),upgrades.length?[['queue',['F'],'auto upgrade']]:[]);
 }
});


test('Hunt ownership defers once with the same job identity and preserved progress',()=>{
 const f=fixture({job:{reason:'merchant commerce',queuedAt:123,retryCount:2,resumeState:{phase:'leveling',attempts:17,spent:400}}});
 const job=f.state.merchantCurrent;
 const body={jobId:job.id,commandId:job.commandId,success:false,failureKind:'hunt_movement_owned',error:'hunt_movement_owned'};
 const route=createMerchantCompletionRoute(f.state,f.ports);
 route({body},f.response);route({body},f.response);
 assert.equal(f.state.merchantQueue.length,1);
 const q=f.state.merchantQueue[0];assert.equal(q.id,job.id);assert.equal(q.queuedAt,123);assert.equal(q.retryCount,2);
 assert.deepEqual(q.resumeState,job.resumeState);assert.equal(q.commandId,undefined);
 f.state.merchantCurrent={...q,commandId:999};
 const current=f.state.merchantCurrent;route({body:{...body,commandId:123}},f.response);
 assert.equal(f.response.code,409);assert.equal(f.state.merchantCurrent,current);
});

// IT33: a failure's code reaches the row its
// text reached on b9b5c91e: `upgrade_ambiguous` the recovery block, `movement_plan` and
// `interrupted` the interrupted production retry, `bankboi_pending` the BankBoi yield.
test('each I7 code reaches the J4 row its text reached',()=>{
 const {createCompletionRetries}=require('../../runtime/merchant-jobs/coordinator/endings.ts');
 const ambiguous=fixture({job:{reason:'manual upgrades'}});
 createMerchantCompletionRoute(ambiguous.state,ambiguous.ports)({body:{jobId:'job',success:false,code:'upgrade_ambiguous',error:'Upgrade inventory recovery ambiguous'}},ambiguous.response);
 assert.equal(typeof ambiguous.state.merchantJobBlocks['F\nmanual upgrades']?.upgradeRecoverySignature,'string');
 for(const code of ['movement_plan','interrupted']){
  const f=fixture({job:{reason:'auto upgrade'}}),retries=createCompletionRetries(f.state,f.ports);
  assert.equal(retries.decide(f.state.merchantCurrent,{success:false,code,error:'stopped'}).retry,true,code);
 }
 const f=fixture({job:{reason:'withdrawals'}}),retries=createCompletionRetries(f.state,f.ports);
 const decision=retries.decide(f.state.merchantCurrent,{success:false,code:'bankboi_pending',error:'BankBoi storage pending'});
 assert.equal(decision.retry,true);
});

// The waits that stood for a member's word run at that word: a missed rendezvous retries at the
// target's next report and a death at the merchant's report alive, both before ENDING_RETRY_MS's
// bound, and a purchase's market recheck runs at the merchant's next report.
test('a rendezvous or death retry runs at the member report, and the purchase recheck at the merchant report',()=>{
 const {createCompletionRetries}=require('../../runtime/merchant-jobs/coordinator/endings.ts');
 const {wakeJobWaits}=require('../../runtime/merchant-jobs/coordinator/report-wait.ts');
 const {merchantJobSource}=require('../../runtime/merchant-jobs/coordinator/registrations.ts');
 const source=merchantJobSource(()=>null,()=>undefined,()=>[]);
 for(const [error,who] of [['F rendezvous timed out','F'],['Merchant died during rendezvous with F','M']]){
  const f=fixture({job:{reason:'restock'}}),retries=createCompletionRetries(f.state,f.ports),job=f.state.merchantCurrent;
  const body={success:false,error,code:/died/.test(error)?'died':undefined};
  const decision=retries.decide(job,body);assert.equal(decision.retry,true,error);
  retries.enqueue(job,decision);const queued=f.state.merchantQueue[0];
  assert.ok(queued.retryAt>f.ports.now(),'the bound stays behind the report');
  if(who==='M')f.state.statuses.M.rip=true;
  source.hooks['status.received']({character:who});
  if(who==='M'){assert.ok(queued.retryAt>0,'a report of a dead merchant runs no retry');f.state.statuses.M.rip=false;source.hooks['status.received']({character:'M'});}
  assert.equal(queued.retryAt,0);assert.equal(queued.retryOn,undefined);
 }
 const f=fixture({job:{reason:'Ponty purchases'}});
 createMerchantCompletionRoute(f.state,f.ports)({body:{jobId:'job',success:true}},f.response);
 assert.equal(f.calls.filter(c=>c[0]==='ponty').length,0);
 wakeJobWaits('F');assert.equal(f.calls.filter(c=>c[0]==='ponty').length,0);
 wakeJobWaits('M');assert.equal(f.calls.filter(c=>c[0]==='ponty').length,1);assert.equal(f.calls.filter(c=>c[0]==='aldata').length,1);
});

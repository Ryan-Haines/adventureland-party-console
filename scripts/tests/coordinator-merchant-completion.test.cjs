const test=require('node:test'),assert=require('node:assert/strict');
const {createMerchantCompletionRoute}=require('../../runtime/coordinator/http/merchant-completion.ts');
const {fixture,scenarios}=require('./helpers/coordinator-completion.cjs');
const contracts=require('./fixtures/merchant-completion-contracts.json');
const json=value=>JSON.parse(JSON.stringify(value));
for(const scenario of scenarios)test('merchant completion: '+scenario.name,()=>{
 const f=fixture(scenario);
 createMerchantCompletionRoute(f.state,f.ports)({body:{jobId:'job',...scenario.body}},f.response);
 assert.deepEqual(json({name:scenario.name,state:f.state,calls:f.calls,response:{code:f.response.code,body:f.response.body}}),contracts.find(entry=>entry.name===scenario.name));
});
test('authentication timer confirms and publishes later',async()=>{
 const f=fixture(scenarios.find(s=>s.name==='authentication schedules confirmation'));
 createMerchantCompletionRoute(f.state,f.ports)({body:{jobId:'job',success:true}},f.response);
 f.timers[0]();await Promise.resolve();await Promise.resolve();
 assert.equal(f.state.aldata.auth,'CORRECT');
 assert.ok(f.calls.some(call=>call[0]==='publishALData'));
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

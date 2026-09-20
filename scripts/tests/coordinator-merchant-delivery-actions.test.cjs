const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorMerchantDeliveryActions}=require('../../runtime/coordinator/http/merchant-delivery-actions.ts');
const {fixture,scenarios}=require('./helpers/coordinator-completion.cjs');
const contracts=require('./fixtures/merchant-completion-contracts.json');
const json=value=>JSON.parse(JSON.stringify(value));
function compose(f,extra={}) {
 return createCoordinatorMerchantDeliveryActions(f.state,{...f.ports,
  inbox:()=>({complete:f.ports.mailComplete}),fetchMarket:f.ports.fetchAuth,
  bankboi:async()=>{},identity:JSON.stringify,...extra});
}

test('delivery composition preserves all recorded completion receipts, retries and side-effect order',()=>{
 for(const scenario of scenarios){
  const f=fixture(scenario),service=compose(f);
  service.complete({body:{jobId:'job',...scenario.body}},f.response);
  assert.deepEqual(json({name:scenario.name,state:f.state,calls:f.calls,response:{code:f.response.code,body:f.response.body}}),
   contracts.find(entry=>entry.name===scenario.name),scenario.name);
 }
});

test('mail and deferred improvements share the live command counter and completion uses the current inbox',()=>{
 const f=fixture({}),calls=[];let inbox;
 const queue=require('../../runtime/coordinator/merchant/queue-composition.ts').createCoordinatorMerchantQueue(f.state,{now:f.ports.now,capacitySignature:()=>'',routinePriority:()=>1,priority:()=>1,stamp:j=>j,persist(){},dispatch(){},log(){}});
 const service=compose(f,{queue:queue.queue,inbox:()=>{assert.ok(inbox,'inbox accessed before initialization');return inbox;}});
 service.mail.collect({id:'first'});
 assert.equal(f.state.merchantQueue[0].id,'merchant-100000-10');
 f.state.nextCommandId=80;
 service.send({body:{recipient:'P',subject:'hello',message:'test'}},f.response);
 assert.equal(f.state.merchantQueue[1].id,'merchant-100000-80');
 f.state.merchantQueue=[];
 f.state.merchantCurrent={id:'job',target:'F',reason:'collect mail',mail:{id:'first'}};
 inbox={complete:(...args)=>calls.push(args)};
 service.complete({body:{jobId:'job',success:true,error:null,deferredWork:true}},f.response);
 assert.deepEqual(calls,[['first',true,null]]);
 assert.equal(f.state.merchantQueue[0].id,'merchant-100000-81');
 assert.deepEqual(f.state.merchantQueue.map(j=>j.reason),['manual upgrades','manual compounds','manual buying','marked items']);
 assert.equal(f.state.nextCommandId,85);
});

test('authentication confirmation encodes current credentials when the delayed callback runs',async()=>{
 const f=fixture(scenarios.find(s=>s.name==='authentication schedules confirmation')),paths=[];
 const service=compose(f,{fetchMarket:async path=>{paths.push(path);return {auth:'CORRECT'};}});
 service.complete({body:{jobId:'job',success:true}},f.response);
 assert.deepEqual(paths,[]);assert.ok(f.calls.some(call=>call[0]==='timer'&&call[1]===65000));
 f.state.merchantCharacter='M /'; f.state.aldata.key='key/?#';
 f.timers[0]();await Promise.resolve();await Promise.resolve();
 assert.deepEqual(paths,['/auth/M%20%2F/key%2F%3F%23']);
 assert.equal(f.state.aldata.auth,'CORRECT');assert.ok(f.calls.some(call=>call[0]==='publishALData'));
});

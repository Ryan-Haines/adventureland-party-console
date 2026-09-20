const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const policy=require('../../runtime/hunt/policy.ts');
test('return retries use structured failures, bounded backoff, and preserve the pending claim',()=>{
  const h={stage:'returning',participants:['A'],owner:'A',turnIn:{owner:'A',phase:'returning'}};
  const saved=JSON.stringify(h.turnIn);
  for(let attempt=0;attempt<3;attempt++){
    h.returnRetries=attempt;
    const delay=[5000,15000,30000][attempt];
    const c={phase:'failed',failedAt:1000,failureCode:'assembly-timeout',failure:'arbitrary display text'};
    assert.equal(policy.retryReturn(h,c,1000+delay-1),false);
    assert.equal(policy.retryReturn(h,c,1000+delay),true);
  }
  h.returnRetries=3;
  assert.equal(policy.retryReturn(h,{phase:'failed',failureCode:'assembly-timeout'},999999),false);
  assert.equal(JSON.stringify(h.turnIn),saved);
  h.returnRetries=0;
  assert.equal(policy.retryReturn(h,{phase:'failed',failureCode:'manual-cancel'},999999),false);
  h.turnIn.phase='complete';
  assert.equal(policy.retryReturn(h,{phase:'failed',failureCode:'runtime-lost'},999999),false);
});
test('a new turn-in resets retry and Town fallback state',()=>{
  const h={stage:'farming',participants:['A'],owner:'A',turnIn:{owner:'A',phase:'complete'},returnRetries:3,returnDisableTown:true};
  policy.beginTurnIn(h,'A');assert.equal(h.returnRetries,0);assert.equal(h.returnDisableTown,false);
});
for(const kind of ['handoff','order-handoff'])test('late '+kind+' completion cannot erase a newer convoy command',()=>{
  const {createMerchantHandoffRoutes}=require('../../runtime/coordinator/http/merchant-handoff.ts');
  const newer={id:99,type:'party-monster-travel',convoyId:'return'};
  const party={merchantCurrent:{id:'job',target:'A'},commands:{A:newer}};
  const routes=createMerchantHandoffRoutes(party,{persist(){}});
  const handler=kind==='handoff'?routes.complete:routes.orderComplete;
  handler({body:{character:'A',jobId:'job',commandId:12}},{json(){},status(){return this;}});
  assert.equal(party.commands.A,newer);
});

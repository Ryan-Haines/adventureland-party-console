const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const policy=require('../../runtime/hunt/policy.ts');

test('automatic return recovery and explicit retry retain native fallback and pending rewards',()=>{
 const {createHuntRecovery}=require('../../runtime/coordinator/hunt/recovery.ts');
 const {createHuntControlRoutes}=require('../../runtime/coordinator/http/hunt-control.ts');
 const hunt={cycleId:'hunt',stage:'returning',convoyId:'old',participants:['A'],owner:'A',turnIn:{owner:'A',phase:'returning'}};
 const state={monsterHunt:hunt,activeConvoy:{id:'old',purpose:'monster-hunt',phase:'failed',nativeFallback:true,failureCode:'route-failed',failedAt:1000},commands:{},statuses:{A:{convoyProtocol:4}},monsterHunterLocation:{map:'main',x:126,y:-413}};
 const ports={now:()=>10000,ownsTravel:()=>true,fresh:()=>true,intent:()=>({revision:1}),cancelled:()=>false,persist(){},cancelHuntConvoy(){state.activeConvoy=null;},cancelConvoy(){state.activeConvoy=null;},start(h){assert.equal(h.returnNativeFallback,true);}};
 assert.equal(createHuntRecovery(state,ports).retry(hunt),true);assert.equal(hunt.returnRetries,1);
 state.activeConvoy={id:'old',purpose:'monster-hunt',phase:'failed',nativeFallback:true};hunt.convoyId='old';delete hunt.returnNativeFallback;
 let result;createHuntControlRoutes(state,ports).retryReturn({}, {json:v=>result=v,status(){return this;}});
 assert.equal(result.ok,true);assert.equal(hunt.returnNativeFallback,true);assert.equal(hunt.turnIn.phase,'returning');
 const restored=JSON.parse(JSON.stringify(hunt));assert.equal(restored.returnNativeFallback,true);
 restored.turnIn.phase='complete';restored.stage='farming';policy.beginTurnIn(restored,'A');assert.equal(restored.returnNativeFallback,undefined);
});
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

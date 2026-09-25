const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const policy=require('../../runtime/hunt/policy.ts');

test('explicit return retry retains native fallback and pending rewards',()=>{
 const {createHuntRecovery}=require('../../runtime/coordinator/hunt/recovery.ts');
 const {createHuntControlRoutes}=require('../../runtime/coordinator/http/hunt-control.ts');
 const hunt={cycleId:'hunt',stage:'returning',convoyId:'old',participants:['A'],owner:'A',turnIn:{owner:'A',phase:'returning'}};
 const state={monsterHunt:hunt,activeConvoy:{id:'old',purpose:'monster-hunt',phase:'failed',nativeFallback:true,failureCode:'route-failed',failedAt:1000},commands:{},statuses:{A:{convoyProtocol:4}},monsterHunterLocation:{map:'main',x:126,y:-413}};
 const ports={now:()=>10000,ownsTravel:()=>true,fresh:()=>true,intent:()=>({revision:1}),cancelled:()=>false,persist(){},cancelHuntConvoy(){state.activeConvoy=null;},cancelConvoy(){state.activeConvoy=null;},start(h){assert.equal(h.returnNativeFallback,true);}};
 assert.equal(createHuntRecovery(state,ports).retry,undefined,'shared return is the only automatic retry owner');
 state.activeConvoy={id:'old',purpose:'monster-hunt',phase:'failed',nativeFallback:true};hunt.convoyId='old';delete hunt.returnNativeFallback;
 let result;createHuntControlRoutes(state,ports).retryReturn({}, {json:v=>result=v,status(){return this;}});
 assert.equal(result.ok,true);assert.equal(hunt.returnNativeFallback,true);assert.equal(hunt.turnIn.phase,'returning');
 const restored=JSON.parse(JSON.stringify(hunt));assert.equal(restored.returnNativeFallback,true);
 restored.turnIn.phase='complete';restored.stage='farming';policy.beginTurnIn(restored,'A');assert.equal(restored.returnNativeFallback,undefined);
});
test('a new turn-in resets retry and Town fallback state',()=>{
  const h={stage:'farming',participants:['A'],owner:'A',turnIn:{owner:'A',phase:'complete'},returnRetries:3,returnDisableTown:true};
  policy.beginTurnIn(h,'A');assert.equal(h.returnDisableTown,false);
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

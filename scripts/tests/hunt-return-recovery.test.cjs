const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const policy=require('../../runtime/hunting/coordinator/hunt.ts');

test('explicit return retry retains native fallback and pending rewards',()=>{
 const hunt={cycleId:'hunt',stage:'returning',convoyId:'old',participants:['A'],owner:'A',turnIn:{owner:'A',phase:'returning'}};
 const state={monsterHunt:hunt,activeConvoy:{id:'old',purpose:'monster-hunt',phase:'failed',nativeFallback:true},commands:{},statuses:{A:{convoyProtocol:4}},monsterHunterLocation:{map:'main',x:126,y:-413}};
 const ports={ownsTravel:()=>true,fresh:()=>true,cancelled:()=>false,persist(){},cancelConvoy(){state.activeConvoy=null;},start(h){assert.equal(h.returnNativeFallback,true);}};
 const result=policy.retryHuntReturn(state,ports);
 assert.equal(result.body.ok,true);assert.equal(hunt.returnNativeFallback,true);assert.equal(hunt.turnIn.phase,'returning');
 const restored=JSON.parse(JSON.stringify(hunt));assert.equal(restored.returnNativeFallback,true);
 restored.turnIn.phase='complete';restored.stage='farming';policy.beginTurnIn(restored,'A');assert.equal(restored.returnNativeFallback,undefined);
});
test('a new turn-in resets retry and Town fallback state',()=>{
  const h={stage:'farming',participants:['A'],owner:'A',turnIn:{owner:'A',phase:'complete'},returnRetries:3,returnDisableTown:true};
  policy.beginTurnIn(h,'A');assert.equal(h.returnDisableTown,false);
});
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const keepsNewer=({party,newer,handler})=>{
  handler({body:{character:'A',jobId:'job',commandId:12}},{json(){},status(){return this;}});
  assert.equal(party.commands.A,newer);
};
scenarioTable('a late merchant completion route leaves a newer convoy command in place',kind=>{
  const {createMerchantHandoffRoutes}=require('../../runtime/merchant-jobs/coordinator/routes.ts');
  const newer={id:99,type:'party-monster-travel',convoyId:'return'};
  const party={merchantCurrent:{id:'job',target:'A'},commands:{A:newer}};
  const routes=createMerchantHandoffRoutes(party,{offline:()=>false,persist(){}});
  const handler=kind==='handoff'?routes.complete:routes.orderComplete;
  return {party,newer,handler};
},[
  ['late handoff completion cannot erase a newer convoy command',keepsNewer,'handoff'],
  ['late order-handoff completion cannot erase a newer convoy command',keepsNewer,'order-handoff'],
]);

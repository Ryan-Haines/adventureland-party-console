const test = require('node:test'), assert = require('node:assert/strict');
const { createCoordinatorAnniversaryReturns } = require('../../runtime/events/coordinator/anniversary.ts');

for(const mode of ['owned','new-navigation','manual-cancel','protected','not-ready'])test('early anniversary return handles '+mode+' farming walk',()=>{
 const cycle={id:'round',startsAt:0,endsAt:300000,participants:['A'],waypoints:{A:{revision:1,location:{map:'main',x:0,y:0}}}};
 const state={anniversary:{eventCycle:cycle,abortedRounds:{},returnReady:mode==='not-ready'?{}:{A:{}}},merchantCharacter:'M',deferredEventReturns:{},townCycle:null,
  activeConvoy:{id:'walk',purpose:'shared-walk',phase:'failed',walkingActivity:'farm-recovery',participants:['A'],walkingParents:{A:{revision:1}},nonPreemptible:mode==='protected'}};
 let dispatched=0,cancelled=0;
 const service=createCoordinatorAnniversaryReturns(state,{now:()=>5000,participants:()=>['A'],activeNames:()=>['A'],log(){},persist(){},schedule(){},
  cancelConvoy(){cancelled++;state.activeConvoy=null;},navigation:{
   intent:()=>({revision:mode==='new-navigation'?2:1,cancelled:mode==='manual-cancel'}),location:()=>null,
   capture:()=>({A:{revision:mode==='new-navigation'?2:1}}),reconcile(){},
   dispatch(){dispatched++;cycle.returnDispatchedAt=5000;return true;}}});
 service.tick();assert.equal(cancelled,mode==='owned'?1:0);assert.equal(dispatched,mode==='owned'?1:0);
 if(dispatched)assert.equal(cycle.returnReason,'party completed anniversary visits');
});

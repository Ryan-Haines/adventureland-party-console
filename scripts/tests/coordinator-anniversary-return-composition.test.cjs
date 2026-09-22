const test = require('node:test'), assert = require('node:assert/strict');
const { createCoordinatorAnniversaryReturns } = require('../../runtime/coordinator/anniversary/return-composition.ts');
test('anniversary composition waits for current travel owners and dispatches/reconciles through shared navigation', () => {
  const cycle = { id: 'round', target: 'Other', startsAt: 0, endsAt: 100, participants: ['A'], returnRoutes: {} };
  const state = { anniversary: { eventCycle: cycle, abortedRounds: {}, partyHold: null, },
    merchantCharacter: 'M', deferredEventReturns: {}, activeConvoy: {}, townCycle: null };
  const calls = [];
  const service = createCoordinatorAnniversaryReturns(state, { now: () => 100, participants: () => ['A'], activeNames: () => ['A'],
    log() {}, persist: () => calls.push('persist'), schedule() {}, navigation: {
      intent: () => ({ revision: 1 }), location: () => null, capture: () => ({}),
      dispatch: (...args) => { calls.push(['dispatch', ...args]); cycle.returnDispatchedAt = 100; return true; },
      reconcile: (...args) => calls.push(['reconcile', ...args]),
    } });
  assert.equal(service.dispatch(true), false);
  state.activeConvoy = null; state.townCycle = {}; assert.equal(service.dispatch(true), false);
  state.townCycle = null; assert.equal(service.dispatch(true), true);
  assert.equal(calls[0][1], cycle); assert.deepEqual(calls[0].slice(2), ['anniversary-return', ['A']]);
  service.reconcile('A', {});
  assert.deepEqual(calls.at(-1), ['reconcile', cycle, 'anniversary-return']);
});

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

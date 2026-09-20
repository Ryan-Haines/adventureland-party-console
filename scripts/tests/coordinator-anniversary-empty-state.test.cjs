const test=require('node:test'),assert=require('node:assert/strict');
const {initialAnniversaryState}=require('../../runtime/coordinator/anniversary/initial-state.ts');
const {createAnniversaryReturns}=require('../../runtime/coordinator/anniversary/returns.ts');
const {createAnniversaryNavigationRoutes}=require('../../runtime/coordinator/http/anniversary-navigation.ts');
const {anniversaryHolding,newAnniversaryRound,lostCombatHandoff}=require('../../runtime/coordinator/events/return-guards.ts');
const {createEventReturns}=require('../../runtime/coordinator/events/returns.ts');

test('combat recovery accepts absent anniversary cycles and unselected targets without holding travel',()=>{
 const calls=[];
 const ports={anniversaryParticipants:()=>{calls.push('participants');return ['P'];},now:()=>{calls.push('clock');return 100;}};
 for(const cycle of [undefined,null]){
  assert.equal(anniversaryHolding(cycle,ports),false);
  assert.equal(newAnniversaryRound(cycle,{},ports),false);
  assert.equal(lostCombatHandoff(cycle,ports),false);
 }
 assert.deepEqual(calls,[]);
 for(const target of [undefined,null,'outsider']){
  const cycle={id:'r',endsAt:200,target,stagedAt:90};
  assert.equal(anniversaryHolding(cycle,ports),false);
  assert.equal(newAnniversaryRound(cycle,{startedAt:50},ports),false);
 }
 assert.deepEqual(calls,Array(6).fill('participants'));
});

test('lost anniversary handoff without captured participants retains active-party recovery fallback',()=>{
 const cycle={id:'r',endsAt:50,combatHandoffAt:10,combatEvent:'crabxx'};
 const state={current:null,last:null,deferred:{}};
 const towns=[];
 const ports={now:()=>100,nextCommandId:()=>1,activeNames:()=>['P','M'],merchant:()=> 'M',enabled:()=>true,
  statuses:()=>({}),commands:()=>Object.fromEntries(towns.map(name=>[name,{type:'event-return-town'}])),
  anniversary:()=>cycle,anniversaryParticipants:()=>['P'],convoy:()=>null,sessions:()=>[],
  checkpoint:()=>null,capture:()=>({}),town:name=>towns.push(name),persist:()=>{},townBusy:()=>false};
 createEventReturns(state,ports).reconcile();
 assert.deepEqual(state.current.participants,['P']);
 assert.deepEqual(towns,['P']);
 assert.equal(Object.hasOwn(cycle,'participants'),false);
});

test('fresh anniversary state accepts return polling without inventing runtime fields or scheduling travel',()=>{
 const state=initialAnniversaryState(),before=structuredClone(state);
 const unexpected=()=>assert.fail('empty anniversary state must not schedule work');
 const returns=createAnniversaryReturns(state,new Proxy({}, {get:()=>unexpected}));
 assert.equal(returns.dispatch(),false);
 const routes=createAnniversaryNavigationRoutes(state,{
  owned:()=>true,merchant:()=> 'M',revision:()=>8,persist:unexpected,scheduleReturn:unexpected,
 });
 let result;
 routes.ready({body:{character:'P',round:'old',navigationRevision:8}},{json:body=>result=body,status:unexpected});
 assert.deepEqual(result,{ok:true,stale:true});assert.deepEqual(state,before);
 for(const key of ['eventCycle','returnReady','returnDestination','partyHold','chatAdvertisement'])assert.equal(Object.hasOwn(state,key),false);
});

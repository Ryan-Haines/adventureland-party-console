const test = require('node:test'), assert = require('node:assert/strict');
const { createCoordinatorEventObservations } = require('../../runtime/coordinator/events/observation-composition.ts');

for(const observed of [false,true])for(const protection of ['none','new-revision','protected','unrelated'])
test('anniversary staging handoff ownership; observed='+observed+' protection='+protection,()=>{
 const waypoint={revision:1,location:{map:'winterland',x:10,y:20}};
 const cycle={id:'round',participants:['A'],endsAt:10000,waypoints:{A:waypoint}};
 const convoy={id:'staging',purpose:'shared-walk',walkingActivity:'anniversary-staging',phase:'travel',
  participants:['A'],walkingParents:{A:{revision:1}},nonPreemptible:protection==='protected'};
 if(protection==='unrelated')convoy.participants=['B'];
 const state={activeConvoy:convoy,eventSessions:{},eventReturn:null,deferredEventReturns:{},merchantCharacter:'M',
  anniversary:{eventCycle:cycle},statuses:{},commands:{A:{id:5,convoyId:'staging'}},nextCommandId:7};
 let released=0;
 const service=createCoordinatorEventObservations(state,{now:()=>1000,activeNames:()=>['A'],enabled:()=>true,
  checkpoint:()=>waypoint.location,persist(){},log(){},goobrawlStillFighting:()=>false,begin(){},finishIfReady(){},
  cancelConvoy(){state.activeConvoy=null;delete state.commands.A;},releaseAnniversary(){released++;},
  navigation:{capture:()=>({A:{...waypoint,revision:protection==='new-revision'?2:1}}),location:()=>waypoint.location,intent:()=>({revision:1})}});
 if(observed)service.observe({name:'A',joinedEvent:'snowman',serverLiveEvents:[{name:'snowman'}]});
 else assert.equal(service.authorize('A','snowman').allowed,true);
 assert.equal(state.activeConvoy,protection==='none'?null:convoy);
 assert.equal(released,1);assert.equal(cycle.combatEvent,'snowman');assert.equal(cycle.combatHandoffAt,1000);
 assert.equal(cycle.waypoints.A,waypoint);
});
test('event observation composition writes live sessions and resumes deferred travel through current command ownership', () => {
  const state = { eventSessions: {}, eventReturn: null, deferredEventReturns: {}, merchantCharacter: 'M',
    anniversary: { eventCycle: null, returnReady: {}, returnDestination: null, partyHold: null }, statuses: {}, commands: {}, nextCommandId: 7 };
  const checkpoint = { map: 'cave', x: 10, y: 20 }, calls = [];
  const service = createCoordinatorEventObservations(state, { now: () => 100, activeNames: () => ['A','M'], enabled: () => true,
    checkpoint: () => checkpoint, persist: () => calls.push('persist'), log() {}, goobrawlStillFighting: () => false, begin() {}, finishIfReady() {},
    navigation: { capture: () => ({}), location: () => checkpoint, intent: () => ({ revision: 1 }) } });
  service.observe({ name: 'A', serverLiveEvents: [{ name: 'franky', id: 'round' }] });
  service.authorize('A', 'franky');
  assert.deepEqual(state.eventSessions.A.participants, ['A']); assert.equal(state.eventSessions.A.checkpoint, checkpoint);
  state.deferredEventReturns = { A: { event: 'franky', cycleId: 'recovery', checkpoint, navigationRevision: 1, phase: 'awaiting-reconnect' } };
  state.commands = { A: { type: 'manual' } }; service.observe({ name: 'A', map: 'cave' });
  assert.equal(state.commands.A.type, 'manual'); assert.equal(state.nextCommandId, 7);
  delete state.commands.A; service.observe({ name: 'A', map: 'cave' });
  assert.equal(state.commands.A.type, 'event-return-town'); assert.equal(state.commands.A.id, 7);
  assert.equal(state.commands.A.checkpoint, checkpoint); assert.equal(state.nextCommandId, 8);
});

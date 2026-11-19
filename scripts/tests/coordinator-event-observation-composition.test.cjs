const test = require('node:test'), assert = require('node:assert/strict');
const { createCoordinatorEventObservations } = require('../../runtime/events/coordinator/returns.ts');
// The observation service over `state` with every event selected, at `location`: the checkpoint and the
// navigation's place. `ports` replaces single answers, and its `navigation` single navigation answers.
function observations(state,location,{navigation={},...ports}={}){
 return createCoordinatorEventObservations(state,{now:()=>1000,nextCommand:()=>state.nextCommandId++,activeNames:()=>['A'],enabled:()=>true,admits:()=>true,
  selected:()=>['franky','crabxx','goobrawl','mrpumpkin','anniversary'],checkpoint:()=>location,persist(){},log(){},goobrawlStillFighting:()=>false,begin(){},finishIfReady(){},
  ...ports,navigation:{capture:()=>({}),location:()=>location,intent:()=>({revision:1}),...navigation}});
}

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
 const service=observations(state,waypoint.location,{cancelConvoy(){state.activeConvoy=null;delete state.commands.A;},releaseAnniversary(){released++;},
  navigation:{capture:()=>({A:{...waypoint,revision:protection==='new-revision'?2:1}})}});
 if(observed)service.observe({name:'A',joinedEvent:'snowman',serverLiveEvents:[{name:'snowman'}]});
 else assert.equal(service.admit({name:'A',activeEvent:'snowman'}).allowed,true);
 assert.equal(state.activeConvoy,protection==='none'?null:convoy);
 assert.equal(released,1);assert.equal(cycle.combatEvent,'snowman');assert.equal(cycle.combatHandoffAt,1000);
 assert.equal(cycle.waypoints.A,waypoint);
});
test('event observation composition writes live sessions and resumes deferred travel through current command ownership', () => {
  const state = { eventSessions: {}, eventReturn: null, deferredEventReturns: {}, merchantCharacter: 'M',
    anniversary: { eventCycle: null, returnReady: {}, returnDestination: null, partyHold: null }, statuses: {}, commands: {}, nextCommandId: 7 };
  const checkpoint = { map: 'cave', x: 10, y: 20 }, calls = [];
  const service = observations(state, checkpoint, { now: () => 100, activeNames: () => ['A','M'], persist: () => calls.push('persist') });
  service.observe({ name: 'A', serverLiveEvents: [{ name: 'franky', id: 'round' }] });
  service.admit({ name: 'A', activeEvent: 'franky' });
  assert.deepEqual(state.eventSessions.A.participants, ['A']); assert.equal(state.eventSessions.A.checkpoint, checkpoint);
  state.deferredEventReturns = { A: { event: 'franky', cycleId: 'recovery', checkpoint, navigationRevision: 1, phase: 'awaiting-reconnect' } };
  state.commands = { A: { type: 'manual' } }; service.observe({ name: 'A', map: 'cave' });
  assert.equal(state.commands.A.type, 'manual'); assert.equal(state.nextCommandId, 7);
  delete state.commands.A; service.observe({ name: 'A', map: 'cave' });
  assert.equal(state.commands.A.type, 'event-return-town'); assert.equal(state.commands.A.id, 7);
  assert.equal(state.commands.A.checkpoint, checkpoint); assert.equal(state.nextCommandId, 8);
});

for(const protection of ['none','new-revision','protected','unrelated'])test('retired same-event owned walk cancellation persists once; protection='+protection,()=>{
 const checkpoint={map:'uhills',x:-550,y:-160};
 const deferred={event:'mrpumpkin',cycleId:'old',checkpoint,navigationRevision:1,phase:'returning-to-town'};
 const convoy={id:'walk',purpose:'shared-walk-return',walkingActivity:'event-return',participants:['A'],
  walkingParents:{A:{revision:protection==='new-revision'?2:1,command:{cycleId:'old'}}},nonPreemptible:protection==='protected'};
 if(protection==='unrelated')convoy.walkingParents.A.command.cycleId='different';
 const state={activeConvoy:convoy,eventSessions:{A:{event:'mrpumpkin',id:'new',lastLiveAt:1000,checkpoint:null,waypoints:{},participants:[],wasLive:true}},
  eventReturn:null,deferredEventReturns:{A:deferred},merchantCharacter:'M',anniversary:{eventCycle:null},
  statuses:{A:{seenAt:1000,serverLiveEvents:[{name:'mrpumpkin',id:'new'}]}},commands:{A:{id:1,type:'party-monster-travel',convoyId:'walk'}},nextCommandId:2};
 const saved=[];let cancelled=0;
 const service=observations(state,checkpoint,{persist:()=>saved.push({activeConvoy:state.activeConvoy,phase:state.deferredEventReturns.A.phase}),
  cancelConvoy(){cancelled++;state.activeConvoy=null;delete state.commands.A;}});
 service.observe({name:'A',serverLiveEvents:[{name:'mrpumpkin',id:'new'}]});
 assert.equal(cancelled,protection==='none'?1:0);assert.equal(saved.length,protection==='none'?2:1);
 if(protection==='none')assert.equal(saved[0].activeConvoy,null);
 assert.equal(saved.at(-1).phase,'awaiting-event-admission');
 assert.equal(saved.at(-1).activeConvoy,protection==='none'?null:convoy);
 assert.equal(state.commands.A?.id,protection==='none'?undefined:1);
 assert.deepEqual(state.deferredEventReturns.A.checkpoint,checkpoint);
 assert.equal(state.deferredEventReturns.A,deferred);assert.deepEqual(state.eventSessions.A.participants,[]);
 service.observe({name:'A',serverLiveEvents:[{name:'mrpumpkin',id:'new'}]});
 assert.equal(saved.length,protection==='none'?2:1);
});

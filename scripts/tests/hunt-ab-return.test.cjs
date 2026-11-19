const test = require('node:test'), assert = require('node:assert/strict');
const {createCoordinatorEventReturns} = require('../../runtime/events/coordinator/returns.ts');
const {createHunt} = require('../../runtime/hunting/coordinator/hunt.ts');
require('./fixtures/coordinator-core.cjs');
const {createEventAcknowledgementRoutes} = require('../../runtime/events/coordinator/routes.ts');
const navigation = require('./helpers/farming-navigation.cjs');

function fixture() {
  const now = 50000, names = ['GDroidPT','GermanicHP','QwenTina'];
  const daisy = {map:'main',x:126,y:-413};
  const state = {leader:names[0], followers:{GermanicHP:true,QwenTina:true}, merchantCharacter:'M',
    targetMode:'hunt', partyFarmingMode:'default', location:daisy, characterLocations:{},
    monsterHunterLocation:daisy, monsterSearchRadiusByCharacter:{}, nextCommandId:10,
    eventReturn:null,eventReturnLast:null,deferredEventReturns:{},anniversary:{},eventSessions:{},
    commands:{},statuses:{},navigationIntents:{},combatLogs:{},huntEventTrips:{},
    monsterHunt:{cycleId:'hunt',stage:'returning',participants:names,convoyId:'daisy',target:null,
      missions:[],currentIndex:0,owner:names[0],turnIn:{owner:names[0],phase:'returning'},returnRetries:2},
    activeConvoy:{id:'daisy',purpose:'monster-hunt',phase:'shared-travel',participants:names,
      nonPreemptible:true,expected:{},location:daisy}};
  for (const [i,name] of names.entries()) {
    const revision = 3166+i;
    state.navigationIntents[name]={revision,cancelled:false};
    state.activeConvoy.expected[name]={revision};
    state.commands[name]={id:i+1,type:'party-monster-travel',convoyId:'daisy',navigationRevision:revision};
    state.statuses[name]={seenAt:now,server:'II',convoyProtocol:4,map:'abtesting',mapEvent:'abtesting',x:0,y:0,hp:100,
      monsterHunt:{id:'target_ar900',count:21,remainingMs:100000},
      // Movement's report of the member's live walk: the Daisy return walks at the turn-in's tier.
      movementLive:{tier:'hunt-turn-in'}};
    state.huntEventTrips[name]=[{event:'abtesting',startedAt:1000}];
  }
  require('./helpers/travel-observations.cjs').observeTravel(state.statuses);
  state.monsterHunt.travelCheckpoint={destination:daisy,revisions:Object.fromEntries(names.map(n=>[n,state.navigationIntents[n].revision]))};
  let starts=0;
  const cancelConvoy=()=>{const c=state.activeConvoy;for(const n of names)if(state.commands[n]?.convoyId===c?.id)delete state.commands[n];state.activeConvoy=null;};
  const nav=navigation(state,{now:()=>now,names:()=>names,activeNames:()=>names,persist(){},log(){},cancelConvoy,
    startConvoy(){throw Error('Event checkpoint convoy must not replace the Daisy return');}});
  const eventPorts={now:()=>now,nextCommand:()=>state.nextCommandId++,activeNames:()=>names,enabled:()=>true,checkpoint:()=>daisy,cancelConvoy,
    startConvoy(){throw Error('unexpected event exit convoy');},anniversaryParticipants:()=>[],navigation:nav,persist(){},
    // The hunting owner's `hunt.view` names the group's cycle while the state holds one.
    huntCycle:()=>!!state.monsterHunt};
  let service=createCoordinatorEventReturns(state,eventPorts);
  // The hunting owner's Hunt service; its tick is the Daisy return's step, and the turn-in's claim marks the reach.
  const hunt=createHunt(state,{now:()=>now,participants:()=>names,online:()=>true,ownsTravel:()=>true,cancelConvoy,persist(){},
    selectedDestination:()=>null,navigation:{authorize(){},intent:n=>state.navigationIntents[n]},
    start(destination){starts++;state.activeConvoy={id:'resumed',purpose:'monster-hunt',participants:names,phase:'assemble',location:destination};
      for(const n of names)state.commands[n]={id:100+starts,type:'party-monster-travel',convoyId:'resumed'};return true;}});
  const travel={step:()=>hunt.tick()};
  const ack=createEventAcknowledgementRoutes(state,{now:()=>now,owned:()=>true,intent:nav.intent,nextCommand:()=>state.nextCommandId++,persist(){},
    selectedDestination:()=>daisy,finishReturn:()=>service.finishIfReady(),contains:()=>true});
  function mainland(recovery) {for(const n of names)Object.assign(state.statuses[n],{map:'main',mapEvent:null,
    eventRecovery:{cycleId:recovery.cycleId,phase:'town-ready'}});}
  function stranded() {
    const c=state.activeConvoy;for(const n of names)delete state.statuses[n].movementLive;
    Object.assign(c,{phase:'failed',failureCode:'owner-lost',failure:'Convoy owner-lost: GDroidPT travel replaced by event-return-town (saved revision 3166, current 3166)'});
    const recovery=service.begin('abtesting');mainland(recovery);recovery.pending=[];return recovery;
  }
  return {state,names,nav,travel,ack,mainland,stranded,get service(){return service;},
    restart(){const restored=JSON.parse(JSON.stringify(state));Object.assign(state,restored);service=createCoordinatorEventReturns(state,eventPorts);},
    // The hand-in reached Daisy: it claims, and with no finished quest to claim it completes in the same step.
    starts:()=>starts,claimed:()=>['claiming','complete'].includes(state.monsterHunt.turnIn.phase)?1:0};
}

test('A/B ending during protected Daisy travel preserves commands and completes directly into that journey',()=>{
  const f=fixture(), convoy=f.state.activeConvoy, commands={...f.state.commands};
  const recovery=f.service.begin('abtesting');
  assert.deepEqual(f.state.commands,commands);
  f.service.reconcile();assert.equal(f.state.eventReturn,recovery);
  f.mainland(recovery);f.service.reconcile();
  assert.equal(f.state.eventReturn,null);assert.equal(f.state.activeConvoy,convoy);
  assert.deepEqual(f.state.commands,commands);assert.equal(f.state.monsterHunt.turnIn.phase,'returning');
  for(const n of f.names)assert.equal(f.state.huntEventTrips[n][0].endedAt,50000);
});

for(const restart of [false,true])test('already stranded A/B return resumes Daisy and reaches claim phase'+(restart?' after restart':''),()=>{
  const f=fixture();f.stranded();if(restart)f.restart();
  // The exit ends `returned` and leaves the Hunt's failed walk to the hunting owner, whose next step climbs its ladder and restarts it.
  f.service.reconcile();assert.equal(f.state.eventReturn,null);assert.equal(f.state.activeConvoy.id,'daisy');
  f.travel.step(f.state.monsterHunt);
  assert.equal(f.starts(),1);assert.deepEqual(f.state.activeConvoy.location,{map:'main',x:126,y:-413});
  assert.equal(f.state.monsterHunt.returnRetries,2,'event handoff does not spend a route failure retry');
  f.service.reconcile();f.travel.step(f.state.monsterHunt);assert.equal(f.starts(),1);
  f.state.activeConvoy=null;for(const n of f.names)Object.assign(f.state.statuses[n],{x:126,y:-413});
  f.travel.step(f.state.monsterHunt);assert.equal(f.claimed(),1);assert.equal(f.state.monsterHunt.stage,'at-daisy');
});

const {scenarioTable}=require('./fixtures/scenarios.cjs');
scenarioTable('the A/B handoff waits without touching ownership while a member is not clear',fixture,['stale','inside','dead','cancelled','revision','command','old-cycle'].map(blocker=>
['A/B handoff waits without touching ownership: '+blocker,f=>{
  const r=f.stranded(),n=f.names[1];
  if(blocker==='stale')f.state.statuses[n].seenAt=40000;
  // A report on the event's map names the event, as the character's report reads it from G.maps.
  if(blocker==='inside')Object.assign(f.state.statuses[n],{map:'abtesting',mapEvent:'abtesting'});
  if(blocker==='dead')f.state.statuses[n].rip=true;
  if(blocker==='cancelled')f.state.navigationIntents[n].cancelled=true;
  if(blocker==='revision')f.state.navigationIntents[n].revision++;
  if(blocker==='command')f.state.commands[n]={id:999,type:'character-travel'};
  if(blocker==='old-cycle')r.waypoints[n].revision--;
  const convoy=f.state.activeConvoy,commands={...f.state.commands};
  f.service.reconcile();assert.equal(f.state.eventReturn,r);assert.equal(f.state.activeConvoy,convoy);assert.deepEqual(f.state.commands,commands);
}]));

test('delayed A/B completion and duplicate event-ended requests preserve the resumed Daisy command',()=>{
  const f=fixture(),r=f.stranded();f.service.reconcile();f.travel.step(f.state.monsterHunt);
  const commands={...f.state.commands},n=f.names[0];let response;
  f.ack.returnComplete({body:{character:n,cycleId:r.cycleId,navigationRevision:3166,map:'main',x:0,y:0}},
    {json(value){response=value;},status(){return this;}});
  assert.equal(response.stale,true);assert.deepEqual(f.state.commands,commands);
  assert.equal(f.service.begin('abtesting'),null);assert.deepEqual(f.state.commands,commands);
});

const test = require('node:test'), assert = require('node:assert/strict');
const {createCoordinatorEventReturns} = require('../../runtime/coordinator/events/return-composition.ts');
const {createHuntTravel} = require('../../runtime/coordinator/hunt/travel.ts');
const {createEventAcknowledgementRoutes} = require('../../runtime/coordinator/http/event-acknowledgements.ts');
const navigation = require('../farming-navigation.cjs');

function fixture() {
  const now = 50000, names = ['GDroidPT','GermanicHP','QwenTina'];
  const daisy = {map:'main',x:126,y:-413};
  const state = {leader:names[0], followers:{GermanicHP:true,QwenTina:true}, merchantCharacter:'M',
    farmingPolicy:'hunt', partyFarmingMode:'default', location:daisy, characterLocations:{},
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
    state.statuses[name]={seenAt:now,map:'abtesting',mapEvent:'abtesting',x:0,y:0,hp:100,
      monsterHunt:{id:'target_ar900',count:21,remainingMs:100000}};
    state.huntEventTrips[name]=[{event:'abtesting',startedAt:1000}];
  }
  state.monsterHunt.travelCheckpoint={destination:daisy,revisions:Object.fromEntries(names.map(n=>[n,state.navigationIntents[n].revision]))};
  let starts=0,claimed=0;
  const cancelConvoy=()=>{const c=state.activeConvoy;for(const n of names)if(state.commands[n]?.convoyId===c?.id)delete state.commands[n];state.activeConvoy=null;};
  const nav=navigation(state,{now:()=>now,names:()=>names,activeNames:()=>names,persist(){},log(){},cancelConvoy,
    startConvoy(){throw Error('Event checkpoint convoy must not replace the Daisy return');}});
  const eventPorts={now:()=>now,activeNames:()=>names,enabled:()=>true,checkpoint:()=>daisy,cancelConvoy,
    startConvoy(){throw Error('unexpected event exit convoy');},anniversaryParticipants:()=>[],navigation:nav,persist(){}};
  let service=createCoordinatorEventReturns(state,eventPorts);
  const travel=createHuntTravel(state,{now:()=>now,fresh:()=>true,ownsTravel:()=>true,
    start(hunt,destination){starts++;state.activeConvoy={id:'resumed',purpose:'monster-hunt',participants:names,phase:'assemble',location:destination};hunt.convoyId='resumed';
      for(const n of names)state.commands[n]={id:100+starts,type:'party-monster-travel',convoyId:'resumed'};},
    processDaisy(hunt){claimed++;hunt.turnIn.phase='claiming';},persist(){}});
  const ack=createEventAcknowledgementRoutes(state,{now:()=>now,owned:()=>true,intent:nav.intent,nextCommand:()=>state.nextCommandId++,persist(){},
    selectedDestination:()=>daisy,finishReturn:()=>service.finishIfReady(),contains:()=>true});
  function mainland(recovery) {for(const n of names)Object.assign(state.statuses[n],{map:'main',mapEvent:null,
    eventRecovery:{cycleId:recovery.cycleId,phase:'town-ready'}});}
  function stranded() {
    const c=state.activeConvoy;
    Object.assign(c,{phase:'failed',failureCode:'owner-lost',failure:'Convoy owner-lost: GDroidPT travel replaced by event-return-town (saved revision 3166, current 3166)'});
    const recovery=service.begin('abtesting');mainland(recovery);recovery.pending=[];return recovery;
  }
  return {state,names,nav,travel,ack,mainland,stranded,get service(){return service;},
    restart(){const restored=JSON.parse(JSON.stringify(state));Object.assign(state,restored);service=createCoordinatorEventReturns(state,eventPorts);},
    starts:()=>starts,claimed:()=>claimed};
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
  f.service.reconcile();assert.equal(f.state.eventReturn,null);assert.equal(f.state.activeConvoy,null);
  f.travel.step(f.state.monsterHunt);
  assert.equal(f.starts(),1);assert.deepEqual(f.state.activeConvoy.location,{map:'main',x:126,y:-413});
  assert.equal(f.state.monsterHunt.returnRetries,2,'event handoff does not spend a route failure retry');
  f.service.reconcile();f.travel.step(f.state.monsterHunt);assert.equal(f.starts(),1);
  f.state.activeConvoy=null;for(const n of f.names)Object.assign(f.state.statuses[n],{x:126,y:-413});
  f.travel.step(f.state.monsterHunt);assert.equal(f.claimed(),1);assert.equal(f.state.monsterHunt.stage,'at-daisy');
});

for(const blocker of ['stale','inside','dead','cancelled','revision','command','other-convoy','escape','death-recovery','other-failure','old-cycle','town-running'])
test('A/B handoff waits without touching ownership: '+blocker,()=>{
  const f=fixture(),r=f.stranded(),n=f.names[1];
  if(blocker==='stale')f.state.statuses[n].seenAt=40000;
  if(blocker==='inside')f.state.statuses[n].map='abtesting';
  if(blocker==='dead')f.state.statuses[n].rip=true;
  if(blocker==='cancelled')f.state.navigationIntents[n].cancelled=true;
  if(blocker==='revision')f.state.navigationIntents[n].revision++;
  if(blocker==='command')f.state.commands[n]={id:999,type:'character-travel'};
  if(blocker==='other-convoy')f.state.activeConvoy={id:'new',purpose:'anniversary',participants:f.names,phase:'travel'};
  if(blocker==='escape')f.state.escape={stage:'escaping'};
  if(blocker==='death-recovery')f.state.combatRecovery={phase:'preparing'};
  if(blocker==='other-failure')f.state.activeConvoy.failureCode='route-failed';
  if(blocker==='old-cycle')r.waypoints[n].revision--;
  if(blocker==='town-running')f.state.statuses[n].eventRecovery.phase='town';
  const convoy=f.state.activeConvoy,commands={...f.state.commands};
  f.service.reconcile();assert.equal(f.state.eventReturn,r);assert.equal(f.state.activeConvoy,convoy);assert.deepEqual(f.state.commands,commands);
});

test('delayed A/B completion and duplicate event-ended requests preserve the resumed Daisy command',()=>{
  const f=fixture(),r=f.stranded();f.service.reconcile();f.travel.step(f.state.monsterHunt);
  const commands={...f.state.commands},n=f.names[0];let response;
  f.ack.returnComplete({body:{character:n,cycleId:r.cycleId,navigationRevision:3166,map:'main',x:0,y:0}},
    {json(value){response=value;},status(){return this;}});
  assert.equal(response.stale,true);assert.deepEqual(f.state.commands,commands);
  assert.equal(f.service.begin('abtesting'),null);assert.deepEqual(f.state.commands,commands);
});

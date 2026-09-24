const test = require('node:test'), assert = require('node:assert/strict');
const {createCoordinatorEventReturns} = require('../../runtime/coordinator/events/return-composition.ts');
const {createHuntMode} = require('../../runtime/coordinator/hunt/mode.ts');
const navigation = require('../farming-navigation.cjs');

function fixture(event = 'goobrawl') {
  let now=50000, starts=0;
  const names=['QwenTina','GermanicHP','GDroidPT'], backup={map:'winterland',x:-169,y:-2026};
  const state={leader:names[0],followers:{GermanicHP:true,GDroidPT:true},merchantCharacter:'M',
    farmingPolicy:'hunt',monsterHunterLocation:{map:'main',x:126,y:-413},location:backup,characterLocations:{},navigationIntents:{},
    monsterFocus:['wolfie'],monsterFocusByCharacter:{},nextCommandId:100,commands:{},statuses:{},
    eventReturn:null,eventReturnLast:null,deferredEventReturns:{},anniversary:{},eventSessions:{},
    combatLogs:{},huntEventTrips:{},activeConvoy:null,
    monsterHunt:{cycleId:'hunt',stage:'paused-event',resumeStage:'mission-travel',target:'bee',
      participants:names,missions:[{target:'bee'}],currentIndex:0,loot:{complete:false}}};
  for(const n of names){state.navigationIntents[n]={revision:4,cancelled:false};
    state.statuses[n]={seenAt:now,map:event,mapEvent:event,x:0,y:0,hp:100};}
  const cancelConvoy=()=>{const c=state.activeConvoy;for(const n of names)if(state.commands[n]?.convoyId===c?.id)delete state.commands[n];state.activeConvoy=null;};
  const nav=navigation(state,{now:()=>now,names:()=>names,activeNames:()=>names,persist(){},log(){},cancelConvoy,
    startConvoy(location,label,participants,purpose){starts++;state.activeConvoy={id:'checkpoint',location,label,participants,purpose,phase:'assemble'};return true;}});
  const ports={now:()=>now,activeNames:()=>names,enabled:()=>true,checkpoint:()=>backup,cancelConvoy,
    startConvoy:()=>false,anniversaryParticipants:()=>[],navigation:nav,persist(){}};
  let service=createCoordinatorEventReturns(state,ports);
  const recovery=service.begin(event);
  function atTown(n){Object.assign(state.statuses[n],{map:'main',mapEvent:null,x:0,y:0,
    eventRecovery:{cycleId:recovery.cycleId,phase:'town-ready'}});}
  function child(){recovery.returnDispatchedAt=now-10000;recovery.returnRoutes={QwenTina:{revision:4,commandId:73,location:backup}};
    state.activeConvoy={id:'child',phase:'failed',failure:'runtime-lost',purpose:'shared-walk',walkingActivity:'farm-recovery',
      participants:['QwenTina'],walkingParents:{QwenTina:{revision:4,parentId:73}}};
    state.commands.QwenTina={id:74,type:'party-monster-travel',convoyId:'child'};}
  const mode=createHuntMode(state,{participants:()=>names,cancelled:n=>!!state.navigationIntents[n].cancelled,selectedDestination:()=>({location:backup}),
    release(){},authorize:nav.authorize,
    clear(){throw Error('must not erase recovery')},convoy(){throw Error('must not dispatch fallback')},
    begin(){state.monsterHunt.stage='checking-quests';},returnToDaisy(){throw Error('must await evacuation')}});
  return {state,names,recovery,service:()=>service,atTown,child,mode,starts:()=>starts,
    restart(){Object.assign(state,JSON.parse(JSON.stringify(state)));service=createCoordinatorEventReturns(state,ports);}};
}

for(const event of ['goobrawl','abtesting','pirateship','icegolem','crabxx','franky'])
test(`${event} evacuation hands directly to current Hunt without a checkpoint detour`,()=>{
  const f=fixture(event);f.names.forEach(f.atTown);f.service().reconcile();
  assert.equal(f.state.eventReturn,null);assert.equal(f.starts(),0);
  assert.equal(f.state.monsterHunt.target,'bee');assert.equal(f.state.monsterHunt.stage,'mission-travel');
  assert.deepEqual(f.state.monsterHunt.loot,{complete:false});
  assert.equal(Object.keys(f.state.commands).length,0);
});

test('staggered restart, deferred exit, failed farm child and Hunt off/on resume current policy',()=>{
  const f=fixture();f.atTown('QwenTina');f.atTown('GermanicHP');f.child();
  f.state.deferredEventReturns.GDroidPT={cycleId:f.recovery.cycleId,checkpoint:{map:'winterland',x:0,y:0}};
  f.mode.select('auto',null,undefined,false);f.mode.select('hunt',null,undefined,false);
  f.restart();f.restart();f.service().reconcile();
  assert.equal(f.state.eventReturn,null);assert.equal(f.state.activeConvoy,null);assert.equal(f.starts(),0);
  assert.equal(f.state.monsterHunt.stage,'checking-quests');assert.equal(f.state.monsterHunt.target,'bee');
  assert.equal(f.state.deferredEventReturns.GDroidPT.checkpoint,null);
  assert.equal(f.state.commands.GDroidPT.type,'event-return-town','offline member still has an evacuation obligation');
});

test('currently connected late member must really leave before handoff',()=>{
  const f=fixture();f.atTown('QwenTina');f.atTown('GermanicHP');f.service().reconcile();
  assert.ok(f.state.eventReturn);assert.match(f.state.eventReturn.blocker,/GDroidPT/);
  f.atTown('GDroidPT');f.service().reconcile();assert.equal(f.state.eventReturn,null);
});

for(const kind of ['stale','manual','merchant','newer-command','unrelated-convoy'])
test(`Hunt handoff preserves ${kind} ownership or observation`,()=>{
  const f=fixture();f.names.forEach(f.atTown);
  if(kind==='stale')f.state.statuses.GDroidPT.seenAt=1;
  if(kind==='manual')f.state.navigationIntents.GDroidPT={revision:5,cancelled:true};
  if(kind==='merchant')f.state.commands.GDroidPT={id:800,type:'merchant-handoff'};
  if(kind==='newer-command')f.state.commands.GDroidPT={id:800,type:'character-travel'};
  if(kind==='unrelated-convoy')f.state.activeConvoy={id:'manual',purpose:'manual',phase:'travel',participants:f.names};
  const commands=JSON.stringify(f.state.commands);f.service().reconcile();
  assert.ok(f.state.eventReturn);assert.equal(f.starts(),0);assert.equal(JSON.stringify(f.state.commands),commands);
});

test('unowned farm child cannot be retired by label alone',()=>{
  const f=fixture();f.names.forEach(f.atTown);f.child();f.state.activeConvoy.walkingParents.QwenTina.parentId=999;
  f.service().reconcile();assert.equal(f.state.activeConvoy.id,'child');assert.ok(f.state.eventReturn);
});

test('leaving Hunt during evacuation returns to the newly selected normal destination',()=>{
  const f=fixture();delete f.state.monsterHunt.loot;f.names.forEach(f.atTown);f.recovery.pending=[];
  f.mode.select('auto',null,undefined,false);f.service().reconcile();
  assert.equal(f.state.activeConvoy.purpose,'event-return');assert.equal(f.state.activeConvoy.location.map,'winterland');
});

test('leaving Hunt retains pending loot and completed turn-in without departing during evacuation',()=>{
  const f=fixture();f.state.statuses.QwenTina.monsterHunt={id:'bee',count:0,remainingMs:300000};
  f.mode.select('auto',null,undefined,false);
  assert.equal(f.state.monsterHunt.exitMode,'auto');assert.equal(f.starts(),0);
  f.names.forEach(f.atTown);f.service().reconcile();
  assert.equal(f.state.eventReturn,null);assert.equal(f.state.monsterHunt.stage,'returning');
  assert.equal(f.state.monsterHunt.loot.complete,false);assert.equal(f.starts(),0);
});

test('normal farming repairs an owned failed checkpoint child after runtime replacement',()=>{
  const f=fixture();f.state.farmingPolicy='auto';delete f.state.monsterHunt;
  f.names.forEach(f.atTown);f.recovery.pending=[];f.child();f.restart();f.service().reconcile();
  assert.notEqual(f.state.activeConvoy?.id,'child');assert.equal(f.starts(),1);
});

test('explicit Hunt reselection releases manual cancellation without dispatching the backup',()=>{
  const f=fixture();f.state.navigationIntents.GDroidPT.cancelled=true;
  f.mode.select('hunt',null,undefined,false);
  assert.equal(f.state.navigationIntents.GDroidPT.cancelled,false);
  assert.equal(f.state.location.map,'main');assert.equal(f.starts(),0);
  f.names.forEach(f.atTown);f.service().reconcile();assert.equal(f.state.eventReturn,null);
});

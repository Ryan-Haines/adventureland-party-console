const test=require('node:test'),assert=require('node:assert/strict');
const {createSharedWalks,completeSharedWalkMember}=require('../../runtime/coordinator/navigation/shared-walk.ts');
const {createPartyConvoys}=require('../../runtime/coordinator/navigation/convoy.ts');
function fixture(){
 let now=1000,starts=0;const names=['L','F','P'];
 const state={leader:'L',merchantCharacter:'M',followers:{F:true,P:true},navigationEpoch:0,nextCommandId:1,activeConvoy:null,commands:{},
 navigationIntents:Object.fromEntries(names.map(n=>[n,{revision:1}])),
 statuses:Object.fromEntries(names.map(n=>[n,{map:'main',x:0,y:0,seenAt:now,server:'USII',speed:57,convoyProtocol:4}]))};
 const convoys=createPartyConvoys(state,{now:()=>now,nextCommand:()=>state.nextCommandId++,activeNames:()=>names,
 intent:n=>state.navigationIntents[n],resolve:x=>x,persist(){}});
 const walks=createSharedWalks(state,{now:()=>now,members:()=>names,owned:n=>names.includes(n),enabled:()=>true,allowed:()=>true,
 start:(...args)=>{starts++;return convoys.start(...args);},cancel:()=>convoys.cancel(),persist(){}});
 const body=(name,extra={})=>({character:name,runtimeId:name,navigationRevision:1,token:name,activity:'event',key:'icegolem',
 destination:{map:'winterland',x:100,y:100},...extra});
 return {state,walks,convoys,body,starts:()=>starts,advance:ms=>{now+=ms;for(const s of Object.values(state.statuses))s.seenAt=now;}};
}
test('three event callers coalesce into one convoy and repeated requests retain its identity',()=>{
 const t=fixture();for(const n of ['F','L'])t.walks.submit(t.body(n));assert.equal(t.starts(),0);
 t.walks.submit(t.body('P'));const id=t.state.activeConvoy.id;
 for(let i=0;i<5;i++)for(const n of ['L','F','P'])assert.equal(t.walks.submit(t.body(n)).convoyId,id);
 assert.equal(t.starts(),1);assert.equal(t.state.activeConvoy.purpose,'shared-walk');assert.equal(t.state.activeConvoy.combatHandoffAllowed,false);
});

test('anniversary staging leaves farming combat behind on its shared route to Main',()=>{
 const t=fixture();
 for(const n of ['L','F','P'])Object.assign(t.state.statuses[n],{map:'winterland',groupedCombat:{threats:[{id:'wolf',target:n}]}});
 for(const n of ['L','F','P']) {
  t.walks.submit(t.body(n,{activity:'anniversary-staging',key:'round',destination:{map:'main',x:0,y:0}}));
 }
 const c=t.state.activeConvoy;
 assert.equal(t.starts(),1);
 assert.deepEqual(c.location,{map:'main',x:0,y:0});
 assert.equal(require('../convoy-defense.cjs').step(t.state,1000,()=>{throw Error('must not defend');}),false);
 assert.notEqual(c.phase,'defending');
 for(const n of c.participants)assert.equal(t.state.commands[n].navigationExempt,true);
 t.walks.submit(t.body('F',{activity:'anniversary-staging',key:'round',destination:{map:'main',x:0,y:0},cancel:true}));
 assert.equal(t.state.activeConvoy,null);
});
test('command-owned return legs restore exactly the suspended completion owner',()=>{
 const t=fixture();for(const n of ['L','F','P'])t.state.commands[n]={id:t.state.nextCommandId++,type:'event-return-town',cycleId:'event-1'};
 const parents={...t.state.commands},b=n=>t.body(n,{activity:'event-return',key:'event-1',parentCommandId:parents[n].id});
 for(const n of ['L','F','P'])t.walks.submit(b(n));const c=t.state.activeConvoy;
 assert.equal(c.navigationExempt,true);assert.equal(c.purpose,'shared-walk-return');
 const parent=completeSharedWalkMember(c,'F');assert.equal(parent,parents.F);
 t.state.commands.F=parent;assert.equal(t.walks.submit(b('F')).phase,'complete');
 assert.equal(t.state.commands.L.type,'party-monster-travel');assert.equal(t.starts(),1);
});
test('cancellation, changed revisions and superseded convoys cannot restart an old workflow',()=>{
 const t=fixture();for(const n of ['L','F','P'])t.walks.submit(t.body(n));
 t.walks.submit(t.body('F',{cancel:true}));assert.equal(t.state.activeConvoy,null);
 assert.equal(t.walks.submit(t.body('L')).phase,'failed');assert.equal(t.starts(),1);
 t.state.navigationIntents.P.revision=2;assert.ok(t.walks.submit(t.body('P')).error);
});
test('a leader already at the destination can anchor followers without repeating its workflow',()=>{
 const t=fixture();Object.assign(t.state.statuses.L,{map:'winterland',x:100,y:100});
 t.walks.submit(t.body('F'));t.walks.submit(t.body('P'));
 assert.equal(t.starts(),1);assert.deepEqual(new Set(t.state.activeConvoy.participants),new Set(['L','F','P']));
 assert.equal(completeSharedWalkMember(t.state.activeConvoy,'L'),undefined);
});
test('retry exhaustion is retained even when a waiting caller abandons its failed walking leg',()=>{
 const t=fixture();for(const n of ['L','F','P'])t.walks.submit(t.body(n));
 const c=t.state.activeConvoy;c.phase='failed';c.failure='regroup exhausted';
 t.walks.submit(t.body('F',{cancel:true}));assert.equal(t.state.activeConvoy,c);assert.equal(c.phase,'failed');
});

function goobrawlReturnFixture(activity='farm-recovery') {
 const t=fixture(), names=['L','F','P'], checkpoint={map:'spookytown',x:677,y:129};
 Object.assign(t.state,{eventReturn:null,eventReturnLast:null,deferredEventReturns:{},anniversary:{},eventSessions:{}});
 for(const name of names)Object.assign(t.state.statuses[name],{map:'goobrawl',x:244,y:-6});
 const farm=name=>t.body(name,{activity,key:activity==='event'?'icegolem':'farming',destination:checkpoint});
 for(const name of names)t.walks.submit(farm(name));
 const old=t.state.activeConvoy;
 if(activity==='event')Object.assign(old,{phase:'failed',failure:'Convoy unavailable',failureCode:'unavailable'});
 const capture=members=>Object.fromEntries(members.map(name=>[name,{revision:t.state.navigationIntents[name].revision,location:checkpoint}]));
 const {createCoordinatorEventReturns}=require('../../runtime/coordinator/events/return-composition.ts');
 const service=createCoordinatorEventReturns(t.state,{
  now:()=>1000,activeNames:()=>names,enabled:()=>true,checkpoint:()=>checkpoint,
  cancelConvoy:()=>t.convoys.cancel(),startConvoy:(...args)=>t.convoys.start(...args),
  anniversaryParticipants:()=>[],persist(){},navigation:{capture,
   dispatch:(owner,purpose,members)=>t.convoys.start(owner.checkpoint,'saved checkpoint',members,purpose),
   reconcile:()=>false,finish(){}}
 });
 return {...t,names,checkpoint,farm,old,service};
}

test('Snowman repairs persisted staging failure, completes recovery, and releases all-ready Backup Hunt',()=>{
 const t=goobrawlReturnFixture('anniversary-staging');
 t.state.characterLocations=Object.fromEntries(t.names.map(n=>[n,t.checkpoint]));
 const {createCoordinatorEventReturns}=require('../../runtime/coordinator/events/return-composition.ts');
 const {stepHuntBackup}=require('../../runtime/coordinator/hunt/backup.ts');
 const nav=require('../farming-navigation.cjs')(t.state,{now:()=>1000,names:()=>t.names,activeNames:()=>t.names,
  persist(){},log(){},cancelConvoy:()=>t.convoys.cancel(),startConvoy:(...args)=>t.convoys.start(...args)});
 const service=createCoordinatorEventReturns(t.state,{now:()=>1000,activeNames:()=>t.names,enabled:()=>true,
  checkpoint:()=>t.checkpoint,cancelConvoy:()=>t.convoys.cancel(),startConvoy:(...args)=>t.convoys.start(...args),
  anniversaryParticipants:()=>[],persist(){},navigation:nav});
 const waypoints=Object.fromEntries(t.names.map(n=>[n,{revision:1,location:t.checkpoint}]));
 t.state.eventReturn={cycleId:'snowman-return',event:'snowman',participants:t.names,pending:[],startedAt:900,
  checkpoint:t.checkpoint,waypoints,deferred:[]};
 t.state.anniversary.eventCycle={id:'round',participants:t.names,combatEvent:'snowman',combatHandoffAt:800,waypoints};
 Object.assign(t.old,{phase:'failed',failure:'Convoy owner-lost',failureCode:'owner-lost',restartRecovery:true});
 for(const n of t.names)Object.assign(t.state.statuses[n],{map:'main',x:0,y:0,hp:100,
  eventRecovery:{cycleId:'snowman-return',phase:'town-ready'}});
 const hunt={stage:'paused-event',resumeStage:'backup-farming',participants:t.names,backup:{members:{}},missions:[],currentIndex:-1};
 const huntPorts={now:()=>1000,intent:n=>t.state.navigationIntents[n],cancelHuntConvoy(){},persist(){}};
 stepHuntBackup(hunt,t.state,huntPorts);
 assert.match(hunt.message,/snowman recovery.*Convoy owner-lost/);
 service.reconcile();
 assert.equal(t.state.activeConvoy.purpose,'event-return');
 assert.notEqual(t.state.activeConvoy.id,t.old.id);
 assert.deepEqual(t.state.eventReturn.waypoints,waypoints);
 for(const n of t.names)Object.assign(t.state.statuses[n],t.checkpoint);
 service.reconcile();
 assert.equal(t.state.eventReturn,null);
 assert.equal(t.state.activeConvoy,null);
 assert.ok(t.state.anniversary.eventCycle.returnCompletedAt);
 stepHuntBackup(hunt,t.state,huntPorts);
 assert.equal(hunt.stage,'batch-loot');assert.equal(hunt.batchPickup,true);assert.equal(hunt.backup,undefined);
});
test('ordinary farming recovery cannot displace active Phoenix patrol during a reload gap',()=>{
 const t=fixture();t.state.phoenixPatrolActive=true;
 for(const n of ['L','F','P'])assert.ok(t.walks.submit(t.body(n,{activity:'farm-recovery',key:'farm'})).error);
 assert.equal(t.starts(),0);
 t.state.phoenixPatrolActive=false;
 for(const n of ['L','F','P'])t.walks.submit(t.body(n,{activity:'farm-recovery',key:'farm'}));
 assert.equal(t.starts(),1);
});

test('late staging tokens are blocked throughout combat handoff and recovery',()=>{
 const t=fixture(),stage=n=>t.body(n,{activity:'anniversary-staging',key:'round'});
 for(const n of ['L','F','P'])t.walks.submit(stage(n));
 t.state.anniversary={eventCycle:{participants:['L','F','P'],combatHandoffAt:900}};
 t.convoys.cancel();
 assert.ok(t.walks.submit(stage('L')).error);
 assert.ok(t.walks.submit({...stage('L'),token:'new'}).error);
 t.state.anniversary.eventCycle.returnCompletedAt=1000;
 t.state.eventReturn={participants:['L','F','P']};
 assert.ok(t.walks.submit({...stage('L'),token:'recovery'}).error);
 t.state.eventReturn=null;
 assert.equal(t.walks.submit({...stage('L'),token:'next-round'}).phase,'waiting');
});

for(const restarted of [false,true])test('Goobrawl return retires farming walk and preserves exit continuation; restarted='+restarted,()=>{
 const t=goobrawlReturnFixture();
 const recovery=t.service.begin('goobrawl');
 assert.equal(t.state.activeConvoy,null);
 const parents={...t.state.commands}, waypoints=structuredClone(recovery.waypoints);
 if(restarted){
  // Startup restores the obsolete walk and issues its held convoy commands.
  // Two participants can also be deferred while fresh reports arrive.
  t.state.activeConvoy=structuredClone(t.old);
  Object.assign(t.state.activeConvoy,{phase:'failed',restartRecovery:true,failureCode:'runtime-lost'});
  for(const name of ['L','F']){
   t.state.deferredEventReturns[name]={cycleId:recovery.cycleId};
   t.state.commands[name]={id:200+name.charCodeAt(0),type:'party-monster-travel',convoyId:t.old.id};
  }
  recovery.pending=['P'];
  t.service.reconcile();
  assert.equal(t.state.activeConvoy,null);
  assert.equal(t.state.commands.P,parents.P,'existing event command survives cancellation');
  // Reconnected members receive their deferred event-return commands.
  for(const name of ['L','F'])t.state.commands[name]=parents[name];
 }
 for(const name of t.names)assert.ok(t.walks.submit(t.farm(name)).error,'late farming request cannot reclaim navigation');
 const exit=name=>t.body(name,{token:'exit-'+name,activity:'event-return',key:recovery.cycleId,
  parentCommandId:parents[name].id,destination:{map:'goobrawl',x:0,y:0}});
 for(const name of t.names)t.walks.submit(exit(name));
 const convoy=t.state.activeConvoy;
 assert.equal(convoy.purpose,'shared-walk-return');
 assert.notEqual(convoy.id,t.old.id);
 for(const name of t.names){
  assert.equal(completeSharedWalkMember(convoy,name),parents[name]);
  t.state.commands[name]=parents[name];
  assert.equal(t.walks.submit(exit(name)).phase,'complete');
 }
 t.state.activeConvoy=null;
 for(const name of t.names){
  Object.assign(t.state.statuses[name],{map:'main',x:0,y:0});
  delete t.state.commands[name];
  delete t.state.deferredEventReturns[name];
 }
 recovery.pending=[];
 assert.equal(t.service.finishIfReady(),true);
 assert.equal(t.state.activeConvoy.purpose,'event-return');
 assert.deepEqual(t.state.activeConvoy.location,t.checkpoint);
 assert.deepEqual(recovery.waypoints,waypoints);
});

test('saved return commands may use farming reunion while unrelated walks remain blocked',()=>{
 const t=fixture(),names=['L','F','P'];
 t.state.eventReturn={participants:names,returnRoutes:{}};
 for(const name of names){
  const command={id:t.state.nextCommandId++,type:'event-resume-travel',location:{map:'halloween',x:100,y:100}};
  t.state.commands[name]=command;
  t.state.eventReturn.returnRoutes[name]={revision:1,commandId:command.id};
 }
 const parents={...t.state.commands};
 const body=name=>t.body(name,{activity:'farm-recovery',key:'farming',parentCommandId:parents[name].id,destination:parents[name].location});
 assert.ok(t.walks.submit({...body('L'),parentCommandId:999}).error);
 assert.ok(t.walks.submit({...body('L'),activity:'event'}).error);
 for(const name of names)assert.equal(t.walks.submit(body(name)).phase,'waiting');
 const convoy=t.state.activeConvoy;assert.ok(convoy);
 for(const name of names){
  assert.equal(t.walks.submit(body(name)).phase,'travelling');
  assert.equal(completeSharedWalkMember(convoy,name),parents[name]);
  t.state.commands[name]=parents[name];
  assert.equal(t.walks.submit(body(name)).phase,'complete');
 }
});

for(const restarted of [false,true])test('Ice Golem return releases unavailable entry convoy at Winterland spawn; restarted='+restarted,()=>{
 const t=goobrawlReturnFixture('event');
 for(const name of t.names)Object.assign(t.state.statuses[name],{map:'winterland',x:0,y:0});
 const recovery=t.service.begin('icegolem');
 assert.equal(t.state.activeConvoy,null);
 const parents={...t.state.commands},waypoints=structuredClone(recovery.waypoints);
 if(restarted){
  t.state.activeConvoy=structuredClone(t.old);
  Object.assign(t.state.activeConvoy,{restartRecovery:true});
  t.service.reconcile();
  assert.equal(t.state.activeConvoy,null);
 }
 for(const name of t.names){
  assert.equal(t.state.commands[name],parents[name]);
  assert.ok(t.walks.submit(t.farm(name)).error,'old token cannot reenter event');
  assert.ok(t.walks.submit({...t.farm(name),token:'late-'+name}).error,'new token cannot reenter event');
 }
 const exit=name=>t.body(name,{token:'exit-'+name,activity:'event-return',key:recovery.cycleId,
  parentCommandId:parents[name].id,destination:{map:'main',x:0,y:0}});
 for(const name of t.names)t.walks.submit(exit(name));
 const convoy=t.state.activeConvoy;
 assert.equal(convoy.purpose,'shared-walk-return');
 assert.deepEqual(convoy.location,{map:'main',x:0,y:0});
 for(const name of t.names){
  assert.equal(completeSharedWalkMember(convoy,name),parents[name]);
  t.state.commands[name]=parents[name];
  assert.equal(t.walks.submit(exit(name)).phase,'complete');
  Object.assign(t.state.statuses[name],{map:'main',x:0,y:0});
  delete t.state.commands[name];
 }
 t.state.activeConvoy=null;recovery.pending=[];
 assert.equal(t.service.finishIfReady(),true);
 assert.equal(t.state.activeConvoy.purpose,'event-return');
 assert.deepEqual(t.state.activeConvoy.location,t.checkpoint);
 assert.deepEqual(recovery.waypoints,waypoints);
});

for(const kind of ['new-revision','protected','outsider','missing-revision'])test('Ice Golem cleanup preserves entry convoy with '+kind,()=>{
 const t=goobrawlReturnFixture('event');
 if(kind==='new-revision')t.state.navigationIntents.L.revision++;
 if(kind==='protected')t.old.nonPreemptible=true;
 if(kind==='outsider'){
  t.old.participants.push('outsider');
  t.state.navigationIntents.outsider={revision:1};
  t.old.walkingParents.outsider={revision:1};
 }
 if(kind==='missing-revision')delete t.old.walkingParents.L;
 t.service.begin('icegolem');
 assert.equal(t.state.activeConvoy,t.old);
});

for(const newer of [false,true])test('late Town acknowledgement rebuilds return membership only for matching navigation; newer='+newer,()=>{
 const t=goobrawlReturnFixture('event'), recovery=t.service.begin('icegolem');
 recovery.pending=[];recovery.returnDispatchedAt=900;
 recovery.returnRoutes={F:{revision:1,location:t.checkpoint,commandId:77}};
 // The acknowledgement already removed the deferred marker before reconcile.
 for(const name of ['L','P']){
  Object.assign(t.state.statuses[name],{map:'main',x:0,y:0,eventRecovery:{cycleId:recovery.cycleId,phase:'deferred-town-ready'}});
  if(newer)t.state.navigationIntents[name].revision++;
 }
 t.service.reconcile();
 if(newer){assert.equal(t.state.activeConvoy,null);assert.equal(recovery.returnDispatchedAt,900);}
 else {
  assert.equal(t.state.activeConvoy.purpose,'event-return');
  assert.deepEqual(new Set(t.state.activeConvoy.participants),new Set(t.names));
  assert.deepEqual(t.state.activeConvoy.location,t.checkpoint);
 }
});

for(const protectedKind of ['new-revision','protected','other-purpose'])test('event return preserves '+protectedKind+' convoy',()=>{
 const t=goobrawlReturnFixture();
 const recovery=t.service.begin('goobrawl');
 t.state.activeConvoy=t.old;
 if(protectedKind==='new-revision')t.state.navigationIntents.L.revision++;
 if(protectedKind==='protected')t.old.nonPreemptible=true;
 if(protectedKind==='other-purpose')t.old.walkingActivity='event';
 t.service.reconcile();
 assert.equal(t.state.activeConvoy,t.old);
 assert.equal(t.state.eventReturn,recovery);
});

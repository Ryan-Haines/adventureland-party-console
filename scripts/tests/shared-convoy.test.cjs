const test=require('node:test'),assert=require('node:assert/strict');
const {settle}=require('./helpers/native-convoy-runtime.cjs');
const {sharedRoute,publishSharedRoute}=require('../../runtime/movement/coordinator/route-store.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {partyEngine,travellingParty,eventPursuit,client,copy,publication}=require('./fixtures/shared-convoy-scenario.cjs');
test('same-boss coordinate changes preserve cross-map progress until destination arrival',()=>{
 const {movingEventDestination}=require('../../runtime/movement/coordinator/arrivals.ts');
 // The pursuit reads the game's monster table, which the coordinator loads with the
 // movement geometry; the harness loads Mr. Pumpkin's entry.
 require('../../runtime/movement/coordinator/planner-service.ts').setGameMonsters({mrpumpkin:{name:'Mr. Pumpkin',speed:40}});
 const {p}=travellingParty(),c=p.activeConvoy,now=22000;
 Object.assign(c,{purpose:'shared-walk',walkingActivity:'event',walkingEvent:'mrpumpkin',routeServer:'USII',sharedStartedAt:1000,
  location:{map:'halloween',in:'halloween',x:0,y:0},walkingParents:{},runtimes:{}});
 p.navigationIntents={};
 for(const name of c.participants){c.walkingParents[name]={revision:0};c.runtimes[name]=name;p.navigationIntents[name]={revision:0};
  Object.assign(p.statuses[name],{seenAt:now,joinedEvent:'mrpumpkin',in:'main'});}
 Object.assign(p.statuses.P,{map:'halloween',in:'halloween',eventCombatSighting:{id:'boss-1',mtype:'mrpumpkin',map:'halloween',in:'halloween',x:500,y:500,observedAt:now}});
 const owned=c;assert.equal(movingEventDestination(p,c,now),null);assert.equal(p.activeConvoy,owned);assert.equal(c.phase,'travel');
 for(const s of Object.values(p.statuses))Object.assign(s,{map:'halloween',in:'halloween'});
 assert.deepEqual(movingEventDestination(p,c,now),{map:'halloween',in:'halloween',x:500,y:500});
 p.statuses.P.eventCombatSighting.observedAt=now-3001;assert.equal(movingEventDestination(p,c,now),null);
 p.statuses.P.eventCombatSighting.observedAt=now;p.navigationIntents.L.cancelled=true;assert.equal(movingEventDestination(p,c,now),null);
 // One list from game data, the boss rows with a speed (rules.ts `eventBossMoves`).
 // Speeds are G.monsters at 17175 (.caracal/game_files/17175/data.js): Franky 48, Ice Golem 12.
 const {eventBossMoves}=require('../../runtime/events/rules.ts');
 const {sameWalkingLeg}=require('../../runtime/movement/coordinator/walk.ts');
 const table={franky:{speed:48},icegolem:{speed:12},mrpumpkin:{speed:40},statue:{speed:0}},moves=key=>eventBossMoves(key,{monsters:table});
 assert.equal(eventBossMoves('franky',{}),false,'no game data claims no boss');
 // Adds the Horseman to the pursuit list by name; the boss row and its G.monsters speed put it
 // there. Speed 46 is G.monsters.horseman at game data 18285 (the AL MCP).
 assert.equal(eventBossMoves('horseman',{monsters:{horseman:{speed:46}}}),true,'the Horseman is pursued');
 p.navigationIntents.L.cancelled=false;
 for(const [event,follows] of [['franky',true],['icegolem',true],['statue',false]]){
  Object.assign(c,{walkingEvent:event,eventPursuitBossId:undefined});
  for(const s of Object.values(p.statuses))s.joinedEvent=event;
  p.statuses.P.eventCombatSighting={...p.statuses.P.eventCombatSighting,mtype:event};
  assert.deepEqual(movingEventDestination(p,c,now,moves),follows?{map:'halloween',in:'halloween',x:500,y:500}:null,event);
 }
 // The shared walk's coalescing reads the same list.
 const leg=(key,x)=>({activity:'event',key,destination:{map:'level2w',x,y:0}});
 assert.equal(sameWalkingLeg(leg('icegolem',0),leg('icegolem',300),moves),true);
 assert.equal(sameWalkingLeg(leg('statue',0),leg('statue',300),moves),false);
 assert.equal(sameWalkingLeg(leg('statue',0),leg('statue',0.5),moves),true);
});

// Design 2.3 and appendix C's W row (event-pursuit.ts:30): a moving boss re-aims the travelling
// event walk in place. On each re-aim held the party for a new route, at most every 20 s.
scenarioTable('a moving boss re-aims the travelling event walk in place, with no 20 s window (2.3)', ()=>undefined, [
 ['each fresh sighting 250 or more from the destination re-aims the walk, which keeps travelling', ()=>{
  const {p,e,c,now,sight}=eventPursuit();
  assert.equal(e.step(p,now),true);
  assert.equal(c.phase,'travel');
  assert.deepEqual(c.location,{map:'halloween',in:'halloween',x:500,y:500});
  assert.deepEqual(e.signal(p,'F',now).destination,c.location,'the signal carries the new point');
  sight(now+1000,900);e.step(p,now+1000);
  assert.equal(c.phase,'travel');
  assert.equal(c.location.x,900,'a second sighting 1 s later re-aims again');
 }],
 ['a member whose straight line is blocked declines, and the walk holds for a new route', ()=>{
  const {p,e,c,now}=eventPursuit();e.step(p,now);assert.equal(c.phase,'travel');
  p.statuses.P.convoyNavigation={...p.statuses.P.convoyNavigation,reaimDeclined:{...c.location}};
  e.step(p,now+100);
  assert.equal(c.phase,'shared-hold');
  assert.equal(p.commands.F.phase,'shared-hold');
 }],
 // The harness's native map is Main, where can_move clears only y 0, so the members walk there.
 ['a travelling member takes the new point on its live journey, and reports a blocked line', async()=>{
  const {p,e}=partyEngine(),c=p.activeConvoy,names=['L','F','P'];e.step(p,1000);
  const runners=names.map(n=>client(n,p,{nativeMovingFlag:true}));
  await Promise.all(runners.map((r,i)=>r.start(p.commands[names[i]])));
  const tick=async()=>{for(let j=0;j<3;j++){runners[j].context.groupWalk.signal=e.signal(p,names[j],1000);runners[j].tick();}await settle();};
  for(let i=0;i<200 && !runners.every(r=>r.context.groupWalk.travel.routeReady);i++)await tick();
  c.phase='travel';c.eventPursuitBossId='boss-1';await tick();
  const F=runners[1].context,journey=F.__partyMovement.report().id;
  assert.equal(F.groupWalk.travel.phase,'travelling');
  c.location={map:'main',x:150,y:0};await tick();
  assert.equal(F.__partyMovement.report().id,journey,'the same journey');
  assert.equal(F.__partyMovement.records().filter(r=>r.decision==='retargeted').length,1);
  assert.deepEqual(F.groupWalk.travel.destination,c.location);
  c.location={map:'main',x:150,y:60};await tick();
  assert.deepEqual(F.groupWalk.travel.reaimDeclined,c.location,'a blocked line is reported');
  assert.equal(F.__partyMovement.report().id,journey);
 }],
]);
scenarioTable('the leader publishes one shared route that every member installs before departure', partyEngine, [
 ['a leader standing inside the rendezvous range publishes from where it stands and every member installs the route', async ({p,e})=>{
 // The live return-handoff run's warrior stood 29 units from the rally after a dash
 // (mob11-final-fail-ev); the coordinator refused its route until the 60 s preparation bound.
 e.step(p,1000);p.statuses.L.x=20;
 const runners=['L','F','P'].map(n=>client(n,p));runners[0].context.character.x=20;
 await Promise.all(runners.map((r,i)=>r.start(p.commands[['L','F','P'][i]])));
 for(let i=0;i<200 && !runners.every(r=>r.context.groupWalk.travel.routeReady);i++){
  for(let j=0;j<3;j++){const r=runners[j];r.context.groupWalk.signal=e.signal(p,['L','F','P'][j],1000);r.tick();}await settle();
 }
 assert.deepEqual(sharedRoute(p.activeConvoy)?.origin,{map:'main',x:20,y:0});
 assert.ok(runners.every(r=>r.context.groupWalk.travel.routeReady));
 assert.deepEqual(runners.map(r=>r.searches),[1,0,0]);
 }],
 // The Hunt fallback live row's leader walked 88 from the rally while it settled. Its report named
 // the follower's miss, a route failure that spent the spawn's one native attempt.
 ['a leader that leaves the rally range while it settles reports its own drift, which prepares the walk again', async ({p,e})=>{
  const {readinessFailure}=require('../../runtime/movement/coordinator/route-store.ts');
  e.step(p,1000);
  const r=client('L',p),character=r.context.character;character.moving=true;
  await r.start(p.commands.L);
  for(let i=0;i<5;i++){r.context.groupWalk.signal=e.signal(p,'L',1000);r.tick();await settle();}
  character.x=88;character.moving=false;
  let failed;
  for(let i=0;i<50 && !failed;i++){r.context.groupWalk.signal=e.signal(p,'L',1000);r.tick();await settle();
   failed=r.calls.find(c=>c[0]==='request'&&c[1]==='/convoy-failed');}
  assert.ok(failed,'the settled leader fails its walk');
  assert.match(failed[2].body.reason,/Leader moved from planning origin/);
  assert.equal(readinessFailure(p.activeConvoy,'L: '+failed[2].body.reason),true);
 }],
 // One ready report per member departs, counted only when it acknowledges the walk's
 // current command.
 ['the walk departs on the first ready report that acknowledges the current command', ({p,e})=>{
  e.step(p,1000);publishSharedRoute(p,publication(p),1000);
  for(const n of ['L','F','P'])report(p,n);p.statuses.P.convoyNavigation.commandId=0;e.step(p,1000);
  assert.equal(p.activeConvoy.phase,'shared-prepare','a ready report from before the command waits');
  report(p,'P','route-ready',1100);e.step(p,1100);
  assert.equal(p.activeConvoy.phase,'travel','the first acknowledging ready report departs');
 }],
]);
test('failure context changes only diagnostics, retaining the original failure and request sequence',async()=>{
 const runs=[];
 for(const enabled of [false,true]){
  const {p,e}=partyEngine();e.step(p,1000);const r=client('L',p),logs=[];
  r.context.game_log=m=>logs.push(m);
  if(!enabled){r.context.captureConvoyFailureContext=()=>{};r.context.logConvoyFailureContext=()=>{};}
  const started=await r.start(p.commands.L);await r.ready();
  const phase=r.context.groupWalk.travel.phase;
  r.context.groupWalk.signal.runtimeId='superseded-runtime';r.setNow(5000);r.tick();await settle();await settle();
  const failure=r.calls.find(c=>c[0]==='request'&&c[1]==='/convoy-failed');assert.ok(failure);
  assert.equal(failure[2].body.reason,'Shared route coordinator signal expired');
  assert.equal(failure[2].body.failureCode,'route-failed');
  if(enabled){assert.equal(failure[2].body.details.failureContext.phase,phase);assert.equal(failure[2].body.details.failureContext.signal.state,'identity mismatch');assert.equal(logs.filter(m=>/^Convoy (context|signal):/.test(m)).length,2);}
  await r.cancel();await started.promise;
  const body=copy(failure[2].body);delete body.details.failureContext;
  // Each run has independent monotonic-clock samples; retain all identities,
  // counts and failure details while comparing elapsed measurements separately.
  const metrics=body.details.movement.nativePlanning;
  for(const record of [metrics,metrics.intervals])for(const key of ['totalMs','maxMs','minMs','meanMs']){
   if(!(key in record))continue;
   assert.ok(Number.isFinite(record[key])&&record[key]>=0,key+' must be a valid elapsed measurement');
   record[key]=0;
  }
  const schedule=body.details.movement.planningSchedule;
  assert.ok(schedule,'movement must retain planning schedule diagnostics');
  for(const phase of ['scheduler','plan']){
   const record=schedule[phase];
   assert.deepEqual(Object.keys(record).sort(),['calls','elapsedMs','intervals']);
   assert.ok(Number.isSafeInteger(record.calls)&&record.calls>=0,phase+' calls must remain valid');
   assert.deepEqual(Object.keys(record.intervals).sort(),['maxMs','meanMs','minMs']);
   const {minMs,maxMs,meanMs}=record.intervals;
   assert.ok(minMs<=meanMs+1e-8&&meanMs<=maxMs+1e-8,phase+' intervals must be ordered');
   for(const [sample,keys] of [[record,['elapsedMs']],[record.intervals,['minMs','maxMs','meanMs']]])for(const key of keys){
    assert.ok(Number.isFinite(sample[key])&&sample[key]>=0,phase+'.'+key+' must be a valid elapsed measurement');
    sample[key]=0;
   }
  }
  runs.push({body,requests:r.calls.filter(c=>c[0]==='request').map(c=>c[1]),moves:r.moves(),searches:r.searches});
 }
 assert.deepEqual(runs[1],runs[0]);
});
test('owned return reevaluates Town only when a forbidden cached route becomes eligible',async()=>{
 for(const [cachedTown,disabled,source] of [[false,true,'remainder'],[true,false,'remainder'],[false,false,'search'],[undefined,false,'remainder']]){
  const {p,e}=partyEngine();Object.assign(p.activeConvoy,{continuousReturn:1,disableTown:disabled});e.step(p,1000);
  const r=client('L',p,{plan:body=>({...body,ms:0,plot:body.town?[{map:'main',x:0,y:0,town:true},{map:'main',x:120,y:0}]:[{map:'main',x:120,y:0}]})});
  r.context.__partySharedRouteRemainder={id:p.activeConvoy.id,revision:p.commands.L.navigationRevision,
   runtimeId:'L',destinationKey:JSON.stringify(p.activeConvoy.location),destination:p.activeConvoy.location,
   origin:{map:'main',x:0,y:0},server:'USI',geometry:r.context.movement.identity,transporting:false,
   townAllowed:cachedTown,plot:[{map:'main',x:120,y:0}]};
  const started=await r.start(p.commands.L);await r.ready();
  const route=sharedRoute(p.activeConvoy);assert.equal(route.source,source);
  assert.equal(route.plot.some(point=>point.town),source==='search','eligible fresh search must select actual Town candidate');
  assert.equal(r.searches,0,'validated candidate comparison must not start native fallback');
  await r.cancel();await started.promise;
 }
});

// On the coordinator, a deferred departure waits while a member's fight falls,
// from its own reports, where it waited a fixed 60 s; a fight that stops falling across the
// member's window climbs the walk's ladder at once.
function deferredDeparture(){
 const {p,e}=partyEngine(),{report}=require('./fixtures/shared-convoy-scenario.cjs');e.step(p,1000);
 const c=p.activeConvoy,r={p,e,c,at:1000};p.combatLogs={};
 // One round: every member reports, F with the drift that defers the departure and its fight.
 r.round=(hp,elapsed)=>{
  r.at+=elapsed;
  for(const n of c.participants){report(p,n,n==='F'?'failed':'route-ready',r.at);
   Object.assign(p.statuses[n],{reportIntervalMs:1000,groupedCombat:{currentAttackersAt:r.at,currentAttackers:[]}});}
  Object.assign(p.statuses.F.convoyNavigation,{failure:'Route origin changed before departure',attackPeriodMs:1000});
  p.statuses.F.groupedCombat.currentAttackers=[{id:'goo',mtype:'goo',map:'main',x:10,y:0,target:'F',hp}];
  e.step(p,r.at);
  // The hold the deferral issues is acknowledged, and the walk prepares again from the new origin.
  r.at+=100;for(const n of c.participants)report(p,n,'held',r.at);e.step(p,r.at);
 };
 return r;
}
scenarioTable('a deferred departure waits on its members\' fight, not a fixed 60 s (ready, R2F2)', ()=>undefined, [
 ['a fight whose HP keeps falling holds the departure past 60 s without a climb', ()=>{
  const r=deferredDeparture();
  for(let hp=3000;hp>0;hp-=100)r.round(hp,2500);
  assert.ok(r.at-1000>60000,'more than 60 s of deferral');
  assert.equal(r.c.ladderRung,undefined,'no climb');assert.equal(r.c.phase,'shared-prepare');
 }],
 ['a fight that stops falling across the window climbs with no progress, long before 60 s', ()=>{
  const r=deferredDeparture();
  r.round(3000,1000);r.round(3000,1000);r.round(3000,1000);
  assert.ok(r.at-1000<10000);
  const climbs=r.p.combatLogs.L.filter(entry=>entry.message==='Convoy climbing');
  assert.equal(r.c.ladderRung,'replan');assert.equal(climbs.length,1);
  assert.match(climbs[0].details.reason,/^Departure readiness made no progress: F: Route origin changed before departure$/);
 }],
]);
// The geometry reload ends at its named bound and the runtime wait at its
// setting, which keeps today's moment for the hunting readers, and a member reporting from a runtime joins with no
// protocol test. The runtime wait stays only on a walk a Hunt route owns; every other walk
// lets the member go as T5 `runtime-lost`.
const {mismatchedParty}=require('./fixtures/shared-convoy-scenario.cjs');
const freshStep=({p,e,c},at)=>{for(const n of c.participants)p.statuses[n].seenAt=at;e.step(p,at);};
scenarioTable('the walk\'s geometry and runtime ends read their settings, with no protocol test (R3.1 items 3 and 4)', ()=>undefined, [
 // (answer A): a report naming the old runtime after the signal does not fail the repair, since
 // the reload runs later on the member; GEOMETRY_REPAIR_DEADLINE_MS from the start does.
 ['a geometry reload waits through old-runtime reports and fails at its deadline', ()=>{
  const {GEOMETRY_REPAIR_DEADLINE_MS}=require('../../runtime/movement/rules.ts');
  const w=mismatchedParty(),{c}=w,deadline=c.geometryRepair.startedAt+GEOMETRY_REPAIR_DEADLINE_MS;
  freshStep(w,deadline-1);assert.equal(c.geometryRepair.phase,'waiting');assert.notEqual(c.phase,'failed');
  freshStep(w,deadline);assert.equal(c.failureCode,'geometry-mismatch');assert.match(c.failure,/not received by the repair deadline$/);
 }],
 ['a walk a Hunt route owns lets go a reporting member with no runtime as every other walk does', ()=>{
  const {p,e}=partyEngine(),w={p,e,c:p.activeConvoy};delete p.statuses.F.convoyNavigation.runtimeId;
  w.c.purpose='monster-hunt';p.monsterHunt={stage:'mission-travel',currentIndex:0,missions:[{destination:w.c.location}]};
  freshStep(w,1000);
  assert.deepEqual(w.c.participants,['L','P']);assert.equal(w.c.failureCode,undefined);
  freshStep(w,2000);assert.notEqual(w.c.phase,'assemble');
 }],
 // A fresh member that no answer will ever bring is let go at once as T5 and the walk goes on,
 // where a 40 s wait stood earlier.
 ['a walk no Hunt route owns lets go a reporting member with no runtime as rule:T5 and goes on', ()=>{
  const {p,e}=partyEngine(),w={p,e,c:p.activeConvoy};delete p.statuses.F.convoyNavigation.runtimeId;
  freshStep(w,1000);
  assert.deepEqual(w.c.participants,['L','P']);assert.equal(w.c.failureCode,undefined);
  freshStep(w,2000);assert.notEqual(w.c.phase,'assemble');assert.equal(w.c.sharedWaitingAt,undefined);
 }],
 ['a walk no Hunt route owns lets go a reporting member on another server as rule:T5 and goes on', ()=>{
  const {p,e}=partyEngine(),w={p,e,c:p.activeConvoy};p.statuses.F.server='EUI';
  freshStep(w,1000);
  assert.deepEqual(w.c.participants,['L','P']);assert.equal(w.c.failureCode,undefined);
  freshStep(w,2000);assert.notEqual(w.c.phase,'assemble');
 }],
 // T5 `runtime-lost`: an event walk whose member restarted fails, and the failed event walk releases
 // its members. A member whose reports stop is let go instead (the rows below).
 ['an event walk whose member restarted fails runtime-lost and releases its members', ()=>{
  const {p,e}=travellingParty(),w={p,e,c:p.activeConvoy};
  Object.assign(w.c,{purpose:'shared-walk',walkingActivity:'event',walkingParents:Object.fromEntries(w.c.participants.map(n=>[n,{revision:0,parentId:0}]))});
  p.statuses.F.combatSelection={runtimeId:'F2'};freshStep(w,2000);
  assert.equal(w.c.phase,'failed');assert.equal(w.c.failureCode,'runtime-lost');assert.equal(p.commands.F.phase,'event-walk-release');
 }],
 ['a member reporting from a runtime joins without a protocol number', ()=>{
  const {p,e}=partyEngine(),w={p,e,c:p.activeConvoy};delete p.statuses.F.convoyProtocol;
  freshStep(w,1000);assert.equal(w.c.sharedWaitingAt,undefined);
 }],
]);
// `assemble`: the rally ends on its members' arrivals, their holders' answers and each
// member's own walking stall, never on a round of reports; a walk a Hunt route owns keeps today's
// rally ends. regroup hold ends on acknowledgements the same way.
const {report}=require('./fixtures/shared-convoy-scenario.cjs');
const rally=()=>{const {p,e}=partyEngine(),w={p,e,c:p.activeConvoy};p.combatLogs={};Object.assign(p.statuses.F,{x:500});return w;};
scenarioTable('the rally waits on arrivals, holders and the members\' own stalls, not a round or 30 or 120 s (assemble); the regroup hold on acknowledgements', ()=>undefined, [
 ['a rally whose member keeps walking is not cut at 120 s', ()=>{
  const w=rally();w.p.statuses.F.moving=true;
  for(let at=1000;at<=130000;at+=1000)freshStep(w,at);
  assert.equal(w.c.ladderRung,undefined,'no climb');assert.equal(w.c.phase,'shared-prepare');
 }],
 // The walk's command stays the member's command, so the heartbeat reply carries it to every report
 // until one acknowledges it (runtime/status/rules.ts keeps `party-monster-travel`).
 ['a rally whose member has not acknowledged its command waits and keeps the command for its next reply', ()=>{
  const w=rally();freshStep(w,1000);const sent=w.p.commands.F;
  for(const at of [2000,3000,4000,5000,6000,7000])freshStep(w,at);
  assert.equal(w.c.ladderRung,undefined,'no climb after a round');assert.equal(w.c.phase,'shared-prepare');
  assert.equal(w.p.commands.F,sent,'the same command goes with the next reply');
 }],
 ['an acknowledged member that does not move climbs on its own walking stall, not on a round', ()=>{
  const w=rally();freshStep(w,1000);
  for(const at of [2000,3000,4000,5000,6000]){for(const n of w.c.participants)report(w.p,n,'route-ready',at);w.e.step(w.p,at);}
  assert.equal(w.c.ladderRung,undefined,'no climb after a round');
  w.e.hold(w.p,'F: Stalled walking movement (5 seconds without progress)','route-failed',6000);
  assert.equal(w.c.ladderRung,'replan');assert.match(w.c.failure,/^F: Stalled walking movement/);
 }],
 ['a rally a Hunt route owns waits past 30 s and 120 s like every rally', ()=>{
  const w=rally();w.c.purpose='monster-hunt';w.p.monsterHunt={stage:'mission-travel',currentIndex:0,missions:[{destination:w.c.location}]};
  for(let at=1000;at<=130000;at+=1000)freshStep(w,at);
  assert.equal(w.c.phase,'shared-prepare');assert.equal(w.c.failure,undefined);
 }],
 // The hold command goes with each reply until F's report acknowledges it, and names F paused,
 // so the walk waits until Play.
 ['a regroup hold waits for a paused member that has not taken the hold, and ends when its report acknowledges it', ()=>{
  const {p,e}=travellingParty(),c=p.activeConvoy;p.combatLogs={};
  const {createRegistry}=require('../../runtime/hooks/registry.ts');
  require('../../runtime/movement/coordinator/runtime.ts').installCoordinatorMovement(createRegistry(),()=>({state:p,partyConvoys:{cancel(){}}}),{time:async()=>0,statuses:()=>p.statuses});
  Object.assign(c,{phase:'shared-hold',sharedStoppedAt:2000,runtimes:{L:'L',F:'F',P:'P'}});
  p.statuses.F.consoleMaintenance={id:'pause',mode:'draining'};
  const round=(at,f)=>{for(const n of ['L','P'])report(p,n,'held',at);report(p,'F',f,at);e.step(p,at);};
  for(const at of [2500,3500,4500,5500,6500])round(at,'travelling');
  assert.equal(c.ladderRung,undefined,'no climb after a round');assert.equal(c.phase,'shared-hold');
  p.statuses.F.consoleMaintenance=null;round(7500,'held');
  assert.notEqual(c.phase,'shared-hold','after Play F takes the hold and the walk goes on');assert.equal(c.ladderRung,undefined);
 }],
 // T5 `runtime-lost` lets go a member whose reports stopped (the `walk` reading: two of its
 // report intervals), with no holder asked; it catches up through its own task. The walk's own row is
 // in movement-rules.test.cjs, and the start's in shared-walk.test.cjs.
 ['a regroup hold lets go a member whose reports stop', ()=>{
  const {p,e}=travellingParty(),c=p.activeConvoy;p.combatLogs={};
  Object.assign(c,{phase:'shared-hold',sharedStoppedAt:2000,runtimes:{L:'L',F:'F',P:'P'}});
  p.statuses.F.reportIntervalMs=1000;report(p,'F','travelling',2000);
  for(const n of ['L','P'])report(p,n,'held',4500);e.step(p,4500);
  assert.deepEqual(c.participants,['L','P'],'red: the hold waits on F');
 }],
]);
// A member's departure counts within its own measured clock difference of the
// walk's start, half its measured round trip, where a picked 500 ms stood.
test('a departure counts within the member\'s measured clock difference of the walk\'s start',()=>{
 const {departureConfirmed}=require('../../runtime/movement/coordinator/route-store.ts');
 const {p}=travellingParty(),c=p.activeConvoy;c.departAt=10000;
 for(const n of c.participants)p.statuses[n].convoyNavigation.departedAt=10000;
 assert.equal(departureConfirmed(p,c,10000),true);
 p.statuses.F.convoyNavigation.departedAt=9700;
 assert.equal(departureConfirmed(p,c,10000),false,'with no clock sync a departure before the start does not count');
 p.statuses.F.travelSample={transport:{clock:{networkMs:800}}};
 assert.equal(departureConfirmed(p,c,10000),true,'half the measured 800 ms covers 300 ms');
});

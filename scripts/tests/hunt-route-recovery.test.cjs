const test=require('node:test'),assert=require('node:assert/strict');
const {createHunt}=require('../../runtime/hunting/coordinator/hunt.ts');
const {convertHunt,huntMessage}=require('../../runtime/hunting/coordinator/record.ts');
require('./fixtures/coordinator-core.cjs');
// hunt.ts `routeKey`: a spawn's entry in the Hunt's routeRecovery.
const routeDestinationKey=p=>JSON.stringify([p.map,p.in??p.map,p.x,p.y]);
const destination={map:'level4',x:-238,y:-274},alternate={map:'arena',x:0,y:-500},exit={map:'main',x:100,y:200};
// A failed mission walk to the cgoo spawn through the hunting owner's Hunt service (hunt.ts
// `createHunt`). The group's ladder answers the next rung after the walk: the alternative while a
// spawn is left, else regroup.
function fixture(engine='native') {
 const hunt={cycleId:'hunt1',stage:'mission-travel',participants:['L','F'],missions:[{target:'cgoo',owners:['L'],destination,destinationVersion:1}],currentIndex:0,target:'cgoo',
  convoyId:'original',owner:'L',selectionLeader:'L',policyVersion:3,version:2};
 const state={leader:'L',followers:{F:true},nextCommandId:1,targetMode:'hunt',monsterHunt:hunt,statuses:{},commands:{},navigationIntents:{L:{revision:1},F:{revision:1}},
  monsterSearchRadiusByCharacter:{},combatLogs:{},monsterHunterLocation:{map:'main',x:0,y:0},monsterChoices:[{id:'cgoo',locations:[destination,alternate]}]};
 for(const n of hunt.participants) state.statuses[n]={map:'arena',x:0,y:-500,seenAt:1000,hp:100,server:'I',convoyProtocol:4,movementGeometry:{version:17175,fingerprint:'G'},monsterHunt:{id:'cgoo',count:9,remainingMs:100000}};
 require('./helpers/travel-observations.cjs').observeTravel(state.statuses);
 const started=[];let id=0;
 const r={hunt,state,started,ladder:{fail:(code,options)=>({rung:options?.alternative?'alternative':'regroup'})}};
 const service=createHunt(state,{now:()=>1000,participants:()=>hunt.participants,online:()=>true,ownsTravel:()=>false,persist(){},selectedDestination:()=>null,
  cancelConvoy:()=>{state.activeConvoy=null;state.commands={};},
  ladder:{fail:(...a)=>r.ladder.fail(...a),progress(){},rung:()=>'walk'},
  start(d,label,names){if(state.activeConvoy)return false;const c=state.activeConvoy={id:'retry'+(++id),epoch:1,location:d,purpose:'monster-hunt',phase:'assemble',participants:names};for(const n of names)state.commands[n]={id,type:'party-monster-travel',purpose:'monster-hunt',convoyId:c.id};started.push(d);return true;},
  navigation:{authorize(){},intent:n=>state.navigationIntents[n]}});
 function fail(engine='native',reason='Native planning timed out (30 seconds)') {
  const c=state.activeConvoy ||= {id:'original',epoch:1,location:destination,purpose:'monster-hunt'};
  Object.assign(c,{phase:'failed',failureCode:'route-failed',failure:reason,failureDetails:{movement:{engine,failureContext:{relocation:{method:'door',origin:{map:'arena',x:0,y:-500},destination:exit}}}}});
 }
 fail(engine);
 return Object.assign(r,{fail,step:()=>service.tick(),entry:()=>r.hunt.routeRecovery?.[routeDestinationKey(destination)]});
}

test('native exhaustion selects another monster spawn and never dispatches the suggested door',()=>{
 const r=fixture();r.step();assert.equal(r.entry().phase,'excluded');assert.deepEqual(r.started,[r.hunt.missions[0].destination]);assert.equal(r.started[0].map,'arena');assert.equal(r.entry().relocation,undefined);
});
test('ALClient execution failure gets one native attempt, then another spawn',()=>{
 const r=fixture('alclient');r.step();assert.equal(r.entry().phase,'native');assert.equal(r.state.activeConvoy.nativeFallback,true);
 r.fail();r.step();assert.equal(r.entry().phase,'excluded');assert.equal(r.started.length,2);assert.equal(r.started[1].map,'arena');
});
test('no alternative spawn starts the round of spawns over without inventing travel',()=>{
 const r=fixture();r.state.monsterChoices[0].locations=[destination];r.step();assert.equal(r.started.length,0);
 // With the owner on the Hunt, it starts the round of spawns over and does not hold.
 assert.match(huntMessage(r.hunt),/starting over from the first spawn/);assert.equal(r.entry(),undefined);
});
// record.ts `convertHunt` spends an entry saved mid-relocation at load.
for(const phase of ['relocation','post-relocation','held'])test('saved '+phase+' door recovery is retired',()=>{
 const r=fixture();const key=routeDestinationKey(destination);r.hunt.routeRecovery={[key]:{destination,geometry:'17175:G',phase,relocation:{method:'door',origin:{map:'main',x:0,y:0},destination:{map:'bank',x:0,y:-37}},attempts:[],firstFailure:'old',message:'old'}};
 Object.assign(r.state.activeConvoy,{phase:'travel',location:{map:'bank',x:0,y:-37},routeRecovery:{key,stage:'relocation'}});
 convertHunt(r.hunt);r.step();assert.equal(r.entry().phase,'excluded');assert.equal(r.entry().relocation,undefined);assert.equal(r.started[0].map,'arena');
});
// An event no longer reaches route recovery: the owner suspends the Hunt while an event task
// holds the group, which the Goobrawl variants check.
for(const kind of ['merchant','revision','cancelled','dead','turn-in'])test('recovery preserves '+kind+' ownership',()=>{
 const r=fixture();if(kind==='merchant')r.state.commands.L={type:'equip-deliveries',id:9};
 if(kind==='revision')r.state.activeConvoy.expected={L:{revision:0}};if(kind==='cancelled')r.state.navigationIntents.L.cancelled=true;if(kind==='dead')r.state.statuses.L.rip=true;if(kind==='turn-in')r.state.statuses.L.monsterHunt.count=0;
 r.step();assert.equal(r.hunt.routeRecovery,undefined);
 // The turn-in's own walk goes to Daisy; recovery starts none.
 assert.deepEqual(r.started.filter(d=>d!==r.state.monsterHunterLocation),[]);if(kind!=='turn-in')assert.equal(r.started.length,0);
});
test('geometry changes retire the old budget',()=>{
 const r=fixture('alclient');r.step();assert.ok(r.entry());r.state.statuses.L.movementGeometry.fingerprint='new';r.step();assert.equal(r.entry(),undefined);
});
// (route failure): a drift reset climbs the ladder once and cancels no running walk.
test('a drift reset records a climb and leaves the running walk alone',()=>{
 const r=fixture('alclient'),climbs=[];r.ladder={fail:(code,options)=>{climbs.push([code,options]);return {rung:'alternative'};}};
 r.step();
 const walk=r.state.activeConvoy={id:'running',epoch:1,location:destination,purpose:'monster-hunt',phase:'travel',participants:['L','F']};r.hunt.convoyId='running';
 r.state.statuses.L.movementGeometry.fingerprint='new';r.step();
 assert.equal(r.state.activeConvoy,walk);assert.equal(r.hunt.convoyId,'running');
 assert.deepEqual(climbs.filter(([code])=>code==='route-drift'),[['route-drift',{alternative:true}]]);
});
// A runtime replacement during a Hunt walk keeps the spawn's recorded attempts, since the climb is
// saved with the task; movement's T5 `runtime-lost` waits for each member's fresh report from its
// new runtime.
test('a runtime replacement keeps the spawn attempts the Hunt recorded',()=>{
 const r=fixture('alclient');r.step();
 const attempts=JSON.parse(JSON.stringify(r.entry().attempts));
 for(const n of r.hunt.participants) r.state.statuses[n].runtimeId='replaced';
 r.step();assert.deepEqual(r.entry().attempts.slice(0,attempts.length),attempts);
});

// A Hunt walk ends on the rules every walk uses, so movement declares none of the Hunt-only walk
// ends. The saved-fields row, then one walk row per row of the design's table " progress ends".
// `walkGeometryReloadMs` went with the rework pass's (the geometry repair ends on its progress).
test('movement declares none of the Hunt-only walk ends', () => {
  const { movementSavedFields } = require('../../runtime/movement/saved-fields.ts');
  for (const field of ['huntWalkRallyStallMs', 'huntWalkRallyMs', 'huntWalkPrepareMs', 'huntWalkRouteHandleMs', 'walkRuntimeWaitMs',
    'walkCommunicationStableMs', 'walkCommunicationResumeGapMs', 'walkGeometryReloadMs'])
    assert.equal(Object.hasOwn(movementSavedFields, field), false, field + ' is still declared');
});

// Walk rows: each plants the same reports on a walk no Hunt owns and on a walk a Hunt route owns,
// past the moment the old setting ended the Hunt walk, and reads the same phase, failure, rung and
// members from both after every report. A difference is a Hunt-only end still in movement.
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const walk=require('./fixtures/convoy-coordinator-scenario.cjs');
const {partyEngine}=require('./fixtures/shared-convoy-scenario.cjs');
const huntOwned=p=>{p.activeConvoy.purpose='monster-hunt';p.monsterHunt={stage:'mission-travel',currentIndex:0,missions:[{destination:p.activeConvoy.location}]};};
const threeMembers=()=>{const {p,e}=partyEngine();p.step=at=>e.step(p,at);return p;};
const reportAll=(p,at,each=()=>{})=>{for(const [n,s] of Object.entries(p.statuses)){s.seenAt=at;each(n,s);}p.step(at);};
function sameEnds(build,plant){
 const run=hunt=>{const p=build(),seen=[];if(hunt)huntOwned(p);
  plant(p,()=>{const c=p.activeConvoy;seen.push(c&&{phase:c.phase,failure:c.failure,failureCode:c.failureCode,rung:c.ladderRung,members:[...c.participants]});});
  return seen;};
 assert.deepEqual(run(true),run(false));
}
scenarioTable('a Hunt walk ends on the rules every other walk uses', ()=>undefined, [
 // `huntWalkRallyStallMs` 30 s and `huntWalkRallyMs` 120 s: `assemble`, the rally's progress rule.
 ['the rally: a member still walking to it is not cut at 30 or 120 s', ()=>sameEnds(walk.fixture,(p,look)=>{
  p.statuses.B.convoyNavigation.phase='assembling';
  for(const at of [31000,61000,121000,125000]){reportAll(p,at,(n,s)=>{if(n==='B'){s.moving=true;s.x+=10;}});look();}
 })],
 // `huntWalkPrepareMs` 60 s: `prepare`, the planner's answer within its own budget.
 ['the preparation: members still planning are not cut at 60 s', ()=>sameEnds(walk.fixture,(p,look)=>{
  walk.prepare(p);look();
  for(const at of [30000,61600,90000]){reportAll(p,at);look();}
 })],
 // `huntWalkRouteHandleMs` 3 s: hold rule, the count of members carrying the walk's command.
 ['the route handle: a member without it is counted from its reports, not failed at 3 s', ()=>sameEnds(walk.fixture,(p,look)=>{
  walk.prepare(p);
  for(const at of [2000,4000,5100,8000]){walk.ready(p,'A',at);p.statuses.B.seenAt=at;p.step(at);look();}
 })],
 // `walkRuntimeWaitMs` 30 s: T5 `runtime-lost`, each member's first fresh report from its runtime.
 ['the runtime wait: a member reporting with no runtime goes as T5, not after 30 s', ()=>sameEnds(threeMembers,(p,look)=>{
  delete p.statuses.F.convoyNavigation.runtimeId;
  for(const at of [1000,2000,31500,32100]){reportAll(p,at);look();}
 })],
 // `walkCommunicationStableMs` 5 s and `walkCommunicationResumeGapMs` 30 s: the gap ends when
 // the reports are fresh again.
 ['the report gap: the hold ends on the first round of fresh held reports, not after 5 s', ()=>sameEnds(walk.fixture,(p,look)=>{
  walk.prepare(p);const c=p.activeConvoy,s=p.statuses.B;
  s.convoyNavigation={...s.convoyNavigation,id:c.id,epoch:c.epoch,commandId:p.commands.B.id,navigationRevision:0,runtimeId:'B',
   phase:'communication-hold',communication:{operation:'/movement-plan',kind:'timeout',since:1600}};
  reportAll(p,2000);look();
  for(const at of [3000,4000,8000]){reportAll(p,at,(n,r)=>{r.convoyNavigation={id:c.id,epoch:c.epoch,commandId:p.commands[n]?.id,navigationRevision:0,runtimeId:n,phase:'held'};});look();}
 })],
]);

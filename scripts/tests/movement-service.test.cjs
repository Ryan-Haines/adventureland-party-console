const test=require('node:test'), assert=require('node:assert/strict'), path=require('node:path');
const {validateRoute}=require('../../runtime/movement/geometry/validation.ts');
const {geometryFingerprint,cachedGeometryFingerprint}=require('../../runtime/movement/geometry/contracts.ts');
const {createPlannerService}=require('../../runtime/movement/coordinator/planner-service.ts');
const {testScope}=require('./helpers/run-scope.cjs');
const {testRegistry}=require('./helpers/test-registry.cjs');
const {createNative}=require('../../tools/game/pathfinder-benchmark/native.cjs');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {settle,fixture,reachedWalkFixture,correctionFixture}=require('./fixtures/movement-service-scenario.cjs');
const {townConnector}=require('./fixtures/town-connector-scenario.cjs');
// The owner's questions go to a planted call budget on the realm's registry.
const {plantCalls,withMargin}=require('./helpers/planted-calls.cjs');
plantCalls();

// The console's kept goals (design "Corrections from " item 26): the native footprint check
// runs on every installed route, and resumes are bound to the navigation revision.
scenarioTable('every installed route is validated against game collision, transitions and instances before a move', fixture, [
 ['a route that collides, takes a wrong transition or ends in another instance is refused before any move', async ()=>{
  // Collision: both planners return a colliding route, so neither is walked.
  const collides=fixture({offline:true,planError:'Path not found',collision:true,nativePlot:[{map:'main',x:50,y:0},{map:'main',x:100,y:0}]});
  const failed=assert.rejects(collides.service.move({map:'main',x:100,y:0}),e=>/Native route rejected/.test(e.message));
  await collides.ticks();await failed;
  assert.equal(collides.calls.length,0);collides.dispose();
  // Transition: a leave is valid only from an instance map to Main's spawn, with no other metadata.
  const t=fixture();t.host.G.maps.cyberland={spawns:[[0,0]]};t.host.G.maps.jail={spawns:[[0,0]]};
  const ports={game:t.host.G,walk:()=>true,door:()=>true,hasKey:()=>false},to={map:'main',x:0,y:0,method:'leave'};
  for(const map of ['cyberland','jail'])assert.equal(validateRoute(ports,{map,x:3,y:3},to,[to],true),null);
  for(const bad of [{...to,town:true},{...to,transport:true,s:0},{...to,map:'bank'},{...to,x:50}])assert.ok(validateRoute(ports,{map:'cyberland',x:0,y:0},bad,[bad],true));
  assert.ok(validateRoute(ports,{map:'main',x:0,y:0},to,[to],true));t.dispose();
  // Instance: a destination in another instance of the same map is never arrival.
  const i=fixture();
  await assert.rejects(i.service.move({map:'main',in:'other',x:0,y:0}),/another instance/);assert.equal(i.calls.length,0);i.dispose();
 }],
 ['geometry identity ignores renderer decoration but detects same-version collision changes', r=>{
 const before=geometryFingerprint(r.host.G);
 r.host.G.geometry.main={x_lines:[],y_lines:[],data:{tiles:[1,2],placements:[5]}};
 r.host.G.maps.main.npcs=[{id:'npc',position:[1,2],color:'white',sprite:{}}];
 r.host.G.maps.main.data=r.host.G.geometry.main;
 assert.equal(geometryFingerprint(r.host.G),before);
 r.host.G.geometry.main.x_lines.push([50,-10,10]);assert.notEqual(geometryFingerprint(r.host.G),before);r.dispose();
 }],
 // Issue #16: a planned route's blocked last waypoint inside the edge is trimmed, so the walk
 // does not stall on it; a precise, shared or distant endpoint and a final transition keep it
 // and are refused, and the trim never hides an earlier collision.
 ['a blocked final waypoint inside the edge is trimmed, and nothing else is', async ()=>{
  for(const native of [false,true]){
   const plot=[{map:'main',x:40,y:0},{map:'main',x:50,y:0}],r=fixture({collision:true,plot,nativePlot:plot});
   const p=r.service.move({map:'main',x:50,y:0},undefined,{native});await r.ticks(14);await p;
   assert.equal(r.calls.some(c=>c[0]==='move'&&c[1]===50),false,'trimmed for '+(native?'native':'ALClient'));
   assert.equal(plot.length,2,'the planner result is not changed');r.dispose();
  }
  for(const options of [{arrivalTolerance:1},{shared:true},{}]){
   const previous=Object.keys(options).length?40:20;
   const plot=[{map:'main',x:previous,y:0},{map:'main',x:50,y:0}],r=fixture({collision:true,plot,nativePlot:plot});
   const failed=assert.rejects(r.service.move({map:'main',x:50,y:0},undefined,options),/collisions/);
   await r.ticks(14);await failed;assert.equal(r.calls.length,0,JSON.stringify(options));r.dispose();
  }
  for(const plot of [[{map:'main',x:40,y:0},{map:'main',x:50,y:0,town:true}],[{map:'main',x:50,y:0},{map:'main',x:40,y:0},{map:'main',x:50,y:0}]]){
   const r=fixture({collision:true,plot,nativePlot:plot}),failed=assert.rejects(r.service.move({map:'main',x:50,y:0}),/Native route rejected/);
   await r.ticks(14);await failed;assert.equal(r.calls.length,0);r.dispose();
  }
 }],
 // The walking repairs on plain geometry ports: walls are boxes 10 wide and 40 tall, and a leg
 // walks when no point of it, sampled each unit, stands inside one.
 ['every broken future-map walking edge gets a connector, and an endpoint attachment reaches the exact owned goal and refuses a foreign, long or unsafe leg', ()=>{
  const {repairWalkingInteriors}=require('../../runtime/movement/geometry/walking-interior.ts');
  const walls=[50,150,250,350];
  const inside=p=>walls.some(x=>Math.abs(p.x-x)<=5&&Math.abs(p.y)<=20);
  const walk=(a,b)=>{const n=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y));for(let i=0;i<=n;i++){const t=n?i/n:0;if(inside({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}))return false;}return true;};
  const ports={game:{maps:{main:{spawns:[[0,0]]},bank:{spawns:[[0,0]]}},npcs:{},geometry:{}},walk,door:()=>true,hasKey:()=>false};
  // The plot crosses into Main, then walks four legs that each cross one wall.
  const plot=[{map:'main',x:0,y:0,transport:true,s:0},{map:'main',x:10,y:0},...[100,200,300,400].map(x=>({map:'main',x,y:0}))];
  const repaired=repairWalkingInteriors(ports,{map:'bank',x:0,y:0},plot);
  const walking=repaired.slice(1);
  for(let i=1;i<walking.length;i++)assert.ok(walk(walking[i-1],walking[i]),`leg ${i} walks`);
  assert.deepEqual(walking.at(-1),{map:'main',x:400,y:0});
  // An endpoint attachment reaches the exact owned goal and refuses a foreign, long or unsafe leg.
  const {repairWalkingEndpoint}=require('../../runtime/movement/geometry/walking-endpoint.ts');
  const me={map:'main',in:'main',x:0,y:0},goal={map:'main',x:100,y:0},route=[{map:'main',x:40,y:0},goal];
  const attached=repairWalkingEndpoint(ports,me,goal,route);
  assert.ok(attached.length>route.length);assert.deepEqual(attached.at(-1),goal);
  for(let i=1;i<attached.length;i++)assert.ok(walk(attached[i-1],attached[i]),`endpoint leg ${i} walks`);
  const foreign={...goal,in:'other'};
  assert.deepEqual(repairWalkingEndpoint(ports,me,foreign,[route[0],foreign]),[route[0],foreign]);
  const far={map:'main',x:340,y:0},long=[{map:'main',x:40,y:0},far];
  assert.deepEqual(repairWalkingEndpoint(ports,me,far,long),long);
  const walled={...ports,walk:(a,b)=>walk(a,b)&&Math.hypot(b.x-100,b.y)>12===Math.hypot(a.x-100,a.y)>12};
  assert.deepEqual(repairWalkingEndpoint(walled,me,goal,route),route);
 }],
 ['late plan cannot restart cancelled or superseded navigation', async ()=>{
 for(const change of ['stop','supersede','reload']){
  const r=fixture({pending:true}),p=r.service.move({map:'main',x:100,y:0});const failed=assert.rejects(p);
  await r.ticks(1);const request=r.request;if(change==='stop')await r.service.stop('smart');else r[change]();
  fixture.resolve({...request,plot:[{map:'main',x:100,y:0}]});await r.ticks();await failed;
  assert.equal(r.calls.length,0,change);r.dispose();
 }
 }],
]);


scenarioTable('the owner decides inside the service: re-aim, idle aggro, cost, typed commands, currency, planned routes', fixture, [
 // (e2e/movement-owner-failures.md): the owner's own rules on the service, for the cases a
 // run cannot set up on demand.
 ['an idle block refuses a single candidate only while the character fights', r=>{
 r.host.parent.entities={idle:{type:'monster',id:'idle',x:100,y:10,aggro:1,range:20,visible:true}};
 assert.equal(r.service.stepAllows({x:100,y:20}),true,'standing still fights nothing, so the step may enter the block');
 r.setNow(1001);r.host.parent.entities.hit={type:'monster',id:'hit',x:-60,y:0,target:'Test',range:20,visible:true};
 assert.equal(r.service.stepAllows({x:100,y:20}),false,'a fighting character keeps out of the idle block');
 assert.equal(r.service.stepAllows({x:0,y:-40}),true,'a step outside every block passes');
 r.dispose();
 }],
 // Step 10 (e2e/movement-owner-failures.md "Step 10" item 2): every console caller names its
 // requester, so a call with none is the player's typed command. It ranks as `manual`: it
 // replaces a lower journey, a stop of its own journey is the holder's, and a stop of a higher
 // row's journey is refused.
 ['a call with no requester ranks as the player\'s typed command', async r=>{
 const follow=r.service.move({map:'main',x:100,y:0},undefined,{request:{kind:'follow',owner:'follow'}});follow.catch(()=>{});await r.ticks(2);
 const typed=r.service.move({map:'main',x:50,y:0});typed.catch(()=>{});await r.ticks(1);
 assert.equal(r.service.live().kind,'manual');
 assert.ok(r.service.records().some(e=>e.decision==='ended'&&e.owner==='follow'&&e.code==='replaced:manual'));
 await r.host.stop();assert.equal(r.service.live(),null);
 assert.ok(r.service.records().some(e=>e.decision==='ended'&&e.owner==='manual'&&e.code==='released'));
 r.service.move({map:'main',x:100,y:0},undefined,{request:{kind:'cave',owner:'cave:1'}}).catch(()=>{});await r.ticks(1);
 assert.deepEqual(await r.host.stop(),{success:false,refused:true});assert.equal(r.service.live().owner,'cave:1');
 // Step 11: every typed call is counted by its site, the move and each of the two stops, so a
 // console caller that lost its requester shows in the owner report beyond the ring's bound.
 const typedSites=r.service.ownerReport().typed;
 assert.equal(Object.values(typedSites).reduce((a,b)=>a+b,0),3);assert.ok(Object.keys(typedSites).every(site=>site.length>0));
 // A stop superseded by a navigation revision names its cause, so it is no typed call.
 await r.host.stop('smart',undefined,{superseded:'navigation-revision'});
 assert.equal(Object.values(r.service.ownerReport().typed).reduce((a,b)=>a+b,0),3);
 r.dispose();
 }, {stall:true}],
 ['a waiting walk whose currency test fails ends stale instead of resuming', async r=>{
 let current=true;
 r.service.move({map:'main',x:100,y:0},undefined,{request:{kind:'manual',owner:'manual'}}).catch(()=>{});await r.ticks(2);
 const waited=r.service.move({map:'main',x:50,y:0},undefined,{request:{kind:'group-walk',owner:'walk:party:c:1:0',tier:'farming',current:()=>current}});
 const ended=assert.rejects(waited,e=>e.code==='stale');
 current=false;r.setNow(1100);r.service.audit();await ended;
 assert.equal(r.service.live()?.owner,'manual');assert.ok(r.service.records().some(e=>e.decision==='expired'&&e.code==='stale'&&e.owner==='walk:party:c:1:0'));
 r.dispose();
 }, {stall:true}],
 ['a leader\'s own planned shared route goes around an idle pack, an imported one stays as published', async ()=>{
 const blocked=[{map:'main',x:200,y:0}];
 const r=fixture({stall:true,plot:blocked});
 r.host.parent.entities={idle:{type:'monster',id:'idle',x:100,y:0,aggro:1,range:20,visible:true}};
 r.service.move({map:'main',x:200,y:0},undefined,{shared:true,request:{kind:'group-walk',owner:'walk:party:c:1:0',tier:'farming'}}).catch(()=>{});await r.ticks(3);
 assert.ok(r.service.report().routeAggro.detours>=1,'the leader plans the detour');assert.ok(r.service.state.plot.length>1);
 const imported=[{map:'main',x:0,y:0},{map:'main',x:200,y:0}];
 r.service.install(imported.slice(),r.service.identity,'shared');
 assert.deepEqual(r.service.state.plot.map(p=>[p.x,p.y]),[[0,0],[200,0]],'an imported shared route is the plot every member walks');
 r.dispose();
 }],
 // Step 12 (e2e/movement-owner-failures.md "Step 12" items 2 and 3): a requester's crossing
 // with no journey goes through the rank table, and the owner sends it.
 ['step 12 items 2 and 3: a crossing ranks as its requester\'s hold, and a Town cast counts until its answer', async r=>{
 r.service.hold({kind:'escape',owner:'escape:1',deadline:5000});
 await assert.rejects(r.service.transport({kind:'errand',owner:'errand',deadline:5000},'bank',0),e=>e.refused===true);
 assert.equal(r.calls.filter(c=>c[0]==='transport').length,0,'a refused crossing sends nothing');
 r.service.release('escape:1');
 await r.service.transport({kind:'errand',owner:'errand',deadline:5000},'bank',0);
 assert.deepEqual(r.calls.find(c=>c[0]==='transport'),['transport',{to:'bank',s:0}]);
 assert.equal(r.service.live(),null,'the hold taken for the crossing ends with the answer');
 let answer;r.host.town=()=>new Promise(resolve=>{answer=resolve;});
 const town=r.service.town({kind:'town',owner:'town:1',deadline:5000});
 assert.equal(r.service.townCasting(),true,'a sent cast counts before the server answers');
 answer();await town;assert.equal(r.service.townCasting(),false);
 // A journey the requester starts before the answer outlives the hold its crossing took.
 let late;r.host.town=()=>new Promise(resolve=>{late=resolve;});
 const cast=r.service.town({kind:'errand',owner:'errand',deadline:5000});
 r.service.move({map:'main',x:100,y:0},undefined,{request:{kind:'errand',owner:'errand'}}).catch(()=>{});await r.ticks(1);
 late();await cast;assert.equal(r.service.live()?.owner,'errand','the journey of the errand keeps walking');assert.equal(r.service.live()?.journey,true);
 r.dispose();
 }],
 // Design section 2.2 for a yielding hold: the walk its own owner starts from it releases it, as a
 // standing hold does; a walk by another owner replaces it. W43 run 1 read the escape's walk home
 // end its own hold as `replaced:escape` on each rung.
 ['a yielding hold ends released when its own owner walks and replaced when another owner does', async r=>{
 const ends=owner=>r.service.records().filter(e=>e.decision==='ended'&&e.owner===owner&&!e.journeyId).map(e=>e.code);
 r.service.hold({kind:'escape',owner:'escape:1',deadline:5000,yields:true});
 r.service.move({map:'main',x:100,y:0},undefined,{request:{kind:'escape',owner:'escape:1'}}).catch(()=>{});await r.ticks(1);
 assert.deepEqual(ends('escape:1'),['released']);
 await r.host.stop('smart',undefined,{kind:'escape',owner:'escape:1'});await r.ticks(1);
 r.service.hold({kind:'escape',owner:'escape:2',deadline:5000,yields:true});
 r.service.move({map:'main',x:100,y:0},undefined,{request:{kind:'manual',owner:'manual'}}).catch(()=>{});await r.ticks(1);
 assert.deepEqual(ends('escape:2'),['replaced:manual']);
 r.dispose();
 }],
 // Rows 02-06, 06-41 and 07-25 of the removed numbers audit (bigcheck/bounds.md): a transport, leave or
 // Town reply the network lost ends the crossing timed out at its kept bound, which tells the status
 // owner's bound record, and a Town cast stops counting. Each bound is v1.5.0's value
 // (rules.ts `MOVEMENT_PICKS`); the end run measures it.
 ['a crossing whose reply never comes ends timed out at its bound and tells the bound record', async r=>{
 const {boundsPending,boundsSent}=require('../../runtime/status/api.ts');
 const picks=require('../../runtime/movement/rules.ts').MOVEMENT_PICKS;
 const names=['crossingTransportBoundMs','crossingLeaveBoundMs','crossingTownBoundMs'],saved=names.map(name=>picks[name]);
 for(const name of names)picks[name]=5;
 boundsSent(boundsPending().length);
 try{
  r.host.parent.push_deferred=()=>new Promise(()=>{});r.host.town=()=>new Promise(()=>{});
  await assert.rejects(r.service.transport({kind:'errand',owner:'errand',deadline:5000},'bank',0),/timed out/);
  await assert.rejects(r.service.leave({kind:'errand',owner:'errand',deadline:5000}),/timed out/);
  const town=r.service.town({kind:'town',owner:'town:1',deadline:5000});
  assert.equal(r.service.townCasting(),true);
  await assert.rejects(town,/timed out/);
  assert.equal(r.service.townCasting(),false,'a lost Town reply stops counting as a cast');
  assert.deepEqual(boundsPending().map(f=>[f.bound,f.owner]),[['crossingTransportBoundMs','02'],['crossingLeaveBoundMs','02'],['crossingTownBoundMs','02']]);
 }finally{
  boundsSent(boundsPending().length);
  names.forEach((name,i)=>{picks[name]=saved[i];});
  r.dispose();
 }
 }],
 ['a requester loop runs on the owner\'s tick, one run at a time, and ends with the owner', async r=>{
 let runs=0,finish;r.service.every('loop',()=>{runs++;return new Promise(resolve=>{finish=resolve;});});
 const tick=async()=>{r.host.smart_move_logic();await settle();};
 await tick();await tick();
 assert.equal(runs,1,'a run that has not settled holds the next');
 finish();await settle();await tick();assert.equal(runs,2);
 r.dispose();finish();await settle();await tick();
 assert.equal(runs,2,'a disposed owner drives no loop');
 }],
 // The game asks the code
 // page's on_map_click before a click walks; the owner ranks the click as the player's command.
 ['step 12 items 9 to 12: a click pauses a lower journey, holds off lower requests and steps, and hands back after its countdown', async r=>{
 const follow=r.service.move({map:'main',x:100,y:0},undefined,{request:{kind:'follow',owner:'follow'}});follow.catch(()=>{});await r.ticks(3);
 const journeyId=r.service.report().id;
 r.c.moving=true;r.host.on_map_click(40,60);await settle();
 assert.deepEqual(r.service.clicking(),{walking:true,remainingMs:null,label:'Your click'});
 assert.ok(r.service.records().some(e=>e.decision==='paused'&&e.journeyId===journeyId&&e.cause==='click'));
 await assert.rejects(r.service.move({map:'main',x:0,y:80},undefined,{request:{kind:'approach',owner:'approach:1'}}),e=>e.code==='refused');
 assert.equal(r.service.step({x:20,y:0},'test').reason,'click','combat steps do not fight the click');
 assert.equal(r.service.hold({kind:'follow',owner:'follow:hold',deadline:5000}),'refused');
 r.c.moving=false;r.service.audit();
 assert.deepEqual(r.service.clicking(),{walking:false,remainingMs:5000,label:'Your click - taking over in 5 s'},'the countdown starts when the click walk ends');
 r.setNow(3000);r.c.moving=true;r.host.on_map_click(60,60);await settle();r.c.moving=false;r.service.audit();
 assert.equal(r.service.clicking().remainingMs,5000,'a new click starts the countdown again');
 r.setNow(7999);r.service.audit();assert.ok(r.service.clicking(),'the click holds until its countdown ends');
 r.setNow(8000);r.service.audit();assert.equal(r.service.clicking(),null);
 assert.ok(r.service.records().some(e=>e.decision==='resumed'&&e.journeyId===journeyId&&e.cause==='click'),'the paused journey resumes by itself');
 assert.equal(r.service.report().id,journeyId);
 // A row above the player's commands keeps the character (the Cave; escape and death recovery
 // give way to the player): the click changes nothing.
 r.service.move({map:'main',x:100,y:0},undefined,{request:{kind:'cave',owner:'cave:1'}}).catch(()=>{});await r.ticks(2);
 r.c.moving=true;r.host.on_map_click(10,10);await settle();
 assert.equal(r.service.clicking(),null);assert.ok(r.service.records().some(e=>e.decision==='refused'&&e.code==='click'));
 // A newer command of the player's own replaces the click at once.
 r.service.release('cave:1');r.host.on_map_click(10,10);await settle();assert.ok(r.service.clicking());
 r.service.move({map:'main',x:0,y:0},undefined,{request:{kind:'manual',owner:'manual'}}).catch(()=>{});
 assert.equal(r.service.clicking(),null);
 r.dispose();
 }, {stall:true}],
 // User decision 2026-10-29 (e2e/movement-owner-failures.md "Step 12" item 17): a click breaks a
 // Town channel, so it outranks the console's Town; the cast's hold ends `interrupted:click`.
 ['a click interrupts a Town hold, which waits for the hand-back and then holds again', async r=>{
 assert.equal(r.service.hold({kind:'town',owner:'town:7',deadline:9000}),'granted');
 r.c.moving=true;r.host.on_map_click(40,60);await settle();
 assert.equal(r.service.endCode('town:7'),'interrupted:click');
 assert.equal(r.service.clicking().town,'town:7','the card can say Town comes again');
 assert.equal(r.service.hold({kind:'town',owner:'town:7',deadline:9000}),'refused','Town waits for the click');
 r.c.moving=false;r.service.audit();r.setNow(1000+5000);r.service.audit();
 assert.equal(r.service.clicking(),null);
 assert.equal(r.service.hold({kind:'town',owner:'town:7',deadline:20000}),'granted','the same identity holds again after the hand-back');
 r.service.release('town:7');
 // The cast after the click ends by its own release, so the Town requester stops casting.
 assert.equal(r.service.endCode('town:7'),'released','the last end is the release of the cast after it, not the click');
 r.dispose();
 }],
 // S1.1 to S1.3, S1.6, S1.7 and S11.10 (02-movement-failures.md "movement records"): every
 // journey writes one started and one ended entry, its end code comes from design section 6's
 // list or rule 3's `stale`, a replaced end names its taker in `by`, the ring keeps the newest
 // MOVEMENT_RING_SIZE entries in sequence, and none of the reads the status report takes
 // (report.ts `movementLive`, `movementClick`, `movement`) carries the ring.
 ['S1: each journey has one start and one coded end, a replacement names its taker, and the ring keeps its newest entries apart from the report', async r=>{
 const {MOVEMENT_RING_SIZE}=require('../../runtime/protocol/records.ts');
 const CODES=/^(arrived|released|kept|replaced:[\w-]+|stopped:[\w-]+|expired|stale|failed:[\w-]+|returned-to-safe|superseded|runtime-replaced)$/;
 r.service.move({map:'main',x:100,y:0},undefined,{request:{kind:'follow',owner:'follow'}}).catch(()=>{});await r.ticks(2);
 r.service.move({map:'main',x:100,y:0},undefined,{request:{kind:'app',owner:'app:1'}}).catch(()=>{});await r.ticks(2);
 assert.equal(r.service.live()?.owner,'app:1');
 for(const read of [r.service.live(),r.service.clicking(),r.service.report()||r.service.last()])
  assert.doesNotMatch(JSON.stringify(read)??'',/"(records|ring|incidents|leadUp)"/,'the status report reads no ring');
 r.service.release('app:1');
 const records=r.service.records(),ids=[...new Set(records.filter(e=>e.journeyId).map(e=>e.journeyId))];
 assert.equal(ids.length,2);
 for(const id of ids){
  const of=records.filter(e=>e.journeyId===id);
  assert.deepEqual([of.filter(e=>e.decision==='started').length,of.filter(e=>e.decision==='ended').length],[1,1],id);
  assert.match(of.find(e=>e.decision==='ended').code,CODES);
 }
 const replaced=records.find(e=>e.decision==='ended'&&e.owner==='follow');
 assert.deepEqual([replaced.code,replaced.by?.kind,replaced.by?.owner],['replaced:app','app','app:1']);
 for(let i=0;i<200;i++)r.service.hold({kind:'town',owner:'town:'+i,deadline:5000});
 const ring=r.service.records();
 assert.equal(ring.length,MOVEMENT_RING_SIZE);
 assert.ok(ring.every((e,i)=>i===0||e.seq===ring[i-1].seq+1),'contiguous sequence');
 assert.equal(ring.at(-1).owner,'town:199','the ring drops its oldest end');
 r.dispose();
 }, {stall:true}],
 // S4.1 to S4.5, S8c.12, D.MG5 (02-movement-failures.md "ranked requests, the stop rule, kept and
 // retargeted journeys, waits and holds"), design sections 2.1 to 2.3.
 ['S4: a lower request is refused, a non-holder stop is refused, the holder keeps or retargets with no stop, and a waiting walk starts after', async r=>{
 const stops=()=>r.calls.filter(c=>c[0]==='stop').length;
 let stopped=0;const stop=r.host.stop;r.host.stop=(...a)=>{stopped++;return stop(...a);};
 const native=()=>stopped;
 const app=r.service.move({map:'main',x:100,y:0},undefined,{request:{kind:'app',owner:'app:1',deadline:5000}});app.catch(()=>{});await r.ticks(2);
 const journeyId=r.service.report().id;
 // 2.1 rule 1: the lower follow hears `refused` and the travel keeps the character.
 await assert.rejects(r.service.move({map:'main',x:0,y:80},undefined,{request:{kind:'follow',owner:'follow'}}),e=>e.code==='refused');
 assert.ok(r.service.records().some(e=>e.decision==='refused'&&e.owner==='follow'));
 // A2: a stop by a non-holder is refused, names its caller and leaves the journey.
 const sentBefore=r.calls.length;
 assert.deepEqual(await r.host.stop('move',undefined,{kind:'follow',owner:'follow'}),{success:false,refused:true});
 assert.equal(r.service.report().id,journeyId);
 assert.deepEqual(r.service.records().filter(e=>e.decision==='refused-stop').map(e=>[e.journeyId,e.by?.owner]),[[journeyId,'follow']]);
 assert.equal(r.calls.length,sentBefore,'a refused stop sends no packet');
 // 2.2, A3: the holder's own repeat keeps the journey; S8c.12: it takes the new deadline.
 const before=native();
 r.service.move({map:'main',x:100,y:0},undefined,{request:{kind:'app',owner:'app:1',deadline:9000}}).catch(()=>{});await r.ticks(1);
 assert.equal(r.service.report().id,journeyId);assert.ok(r.service.records().some(e=>e.decision==='kept'&&e.journeyId===journeyId));
 r.setNow(6000);r.service.audit();assert.equal(r.service.report()?.id,journeyId,'the kept journey runs to its new deadline');
 // 2.3: a new point on a clear line retargets in place.
 r.service.move({map:'main',x:300,y:0},undefined,{request:{kind:'app',owner:'app:1',deadline:9000}}).catch(()=>{});await r.ticks(1);
 assert.equal(r.service.report().id,journeyId);assert.ok(r.service.records().some(e=>e.decision==='retargeted'&&e.journeyId===journeyId));
 assert.equal(native(),before,'kept and retargeted journeys send no stop');
 assert.equal(r.service.records().filter(e=>e.decision==='started').length,1,'one journey');
 // N2: a group walk asked below the travel waits, and starts after it from where the character stands.
 let walkCurrent=true;
 const walk=r.service.move({map:'main',x:0,y:60},undefined,{request:{kind:'group-walk',owner:'walk:party:c:1:0',tier:'farming',current:()=>walkCurrent}});walk.catch(()=>{});
 await r.ticks(1);
 assert.ok(r.service.records().some(e=>e.decision==='waiting'&&e.owner==='walk:party:c:1:0'));
 r.service.release('app:1');await r.ticks(2);
 assert.equal(r.service.live()?.owner,'walk:party:c:1:0','the walk starts after the travel');
 r.dispose();
 }, {stall:true}],
 // S8a.5 (design section 3.2 invariant 2): a hold with a deadline ends expired at the next audit
 // past it, asking again moves the deadline, and a standing hold yields to any request.
 ['S8a.5: a hold ends expired past its deadline, a repeat moves it, and a standing hold yields', async r=>{
 assert.equal(r.service.hold({kind:'town',owner:'town:1',deadline:2000}),'granted');
 assert.equal(r.service.hold({kind:'town',owner:'town:1',deadline:4000}),'kept');
 r.setNow(3000);r.service.audit();assert.equal(r.service.live()?.owner,'town:1','the repeat moved the deadline');
 r.setNow(4000);r.service.audit();assert.equal(r.service.live(),null);
 assert.equal(r.service.endCode('town:1'),'expired');
 assert.equal(r.service.hold({kind:'cave',owner:'cave:1',deadline:9000,yields:true}),'granted');
 r.service.move({map:'main',x:100,y:0},undefined,{request:{kind:'follow',owner:'follow'}}).catch(()=>{});await r.ticks(1);
 assert.equal(r.service.live()?.owner,'follow','a standing hold yields to a lower request');
 r.dispose();
 }, {stall:true}],
 // S8a.7, D.INV1, D.INV2 (design section 3.2 invariants 1 and 2): a hold with no deadline and a
 // climber standing two ticks between rungs with nothing holding the character each count once
 // and write one ring entry.
 ['S8a.7: an untimed hold and an unowned climber each count once and write one ring entry', async r=>{
 const {taskRound}=require('../../runtime/protocol/ladder.ts');
 r.service.hold({kind:'town',owner:'town:1'});
 r.service.audit();r.service.audit();
 assert.equal(r.service.ownerReport().invariants.untimed,1);
 assert.equal(r.service.records().filter(e=>e.decision==='invariant'&&e.cause==='untimed').length,1);
 r.service.release('town:1');
 r.service.climb('task:farm',taskRound(r.host.G,'the farm'),'farming');
 r.service.audit();assert.equal(r.service.ownerReport().invariants.unowned,0,'one tick between rungs is no lapse');
 r.service.audit();r.service.audit();
 assert.equal(r.service.ownerReport().invariants.unowned,1);
 assert.equal(r.service.records().filter(e=>e.decision==='invariant'&&e.cause==='unowned').length,1);
 r.dispose();
 }],
 // B9.1 to B9.8, S8c.11, S8b.15b, S3.5, S8a.8, S2.7 and S8c.6 (02-movement-failures.md "a rung with no
 // progress logs one stuck record"; design section 7). The fixture's clock is virtual, so the
 // owner's cost meter must read the real clock to count anything.
 ['B9: a rung with no progress writes one stuck record with its lead-up, the next rung comes at once, and the notice runs to progress or its bound', async r=>{
 const {taskRound}=require('../../runtime/protocol/ladder.ts');
 const at={map:'main',x:0,y:0},none={arrived:false,at,planned:{transitions:0,walking:100},remaining:{transitions:0,walking:100}};
 r.service.settingsReply({movementStuckNoticeMs:3000});
 const climbSeq=(r.service.records().at(-1)?.seq??0)+1;
 const ladder=r.service.climb('task:farm',taskRound(r.host.G,'the farm'),'farming');
 const first=ladder.next(at,{});
 r.service.move({map:'main',x:100,y:0},undefined,{request:{kind:'follow',owner:'follow'}}).catch(()=>{});await r.ticks(2);
 r.service.release('follow');
 r.setNow(5000);
 assert.equal(ladder.result(none),'failed');
 const stuck=r.service.incidents().filter(i=>i.kind==='stuck');
 assert.equal(stuck.length,1);
 assert.equal(r.service.records().filter(e=>e.decision==='stuck').length,1);
 const record=stuck[0];
 assert.deepEqual([record.character,record.owner,record.activity,record.rung,record.noProgressMs,record.position.map,record.position.x,record.position.y],
  ['Test','task:farm','farming',first.rung,4000,'main',r.c.real_x,r.c.real_y]);
 assert.deepEqual([record.blocked?.owner,record.blocked?.code],['follow','released'],'the follow walk released before the climb');
 const stuckSeq=r.service.records().find(e=>e.decision==='stuck').seq;
 const ring=r.service.records().filter(e=>e.seq>=climbSeq&&e.seq<stuckSeq);
 assert.deepEqual(record.leadUp.map(e=>e.seq),ring.map(e=>e.seq),'every entry since the climb started, cut by no count');
 assert.deepEqual(r.service.incident(record.id),record);
 assert.equal(r.service.records().find(e=>e.decision==='stuck').cause,record.id);
 const second=ladder.next(at,{});
 assert.notEqual(second.rung,first.rung,'the next rung comes at once');
 assert.deepEqual(r.service.records().filter(e=>e.decision==='rung').map(e=>[e.owner,e.code,e.ladderStep]),[['task:farm',first.rung,0],['task:farm',second.rung,1]]);
 assert.ok(r.service.records().some(e=>e.decision==='rung-failed'&&e.code===first.rung&&e.ladderStep===0));
 const climb=r.service.climbing();
 assert.deepEqual([climb.trying,climb.notice?.text,climb.notice?.incident,climb.notice?.until],[second.trying,'Stuck - trying '+second.trying,record.id,8000]);
 r.setNow(8000);assert.equal(r.service.climbing().notice,undefined,'the notice leaves at its bound');
 ladder.result({arrived:false,at,planned:{transitions:0,walking:100},remaining:{transitions:0,walking:100}});
 const third=ladder.next(at,{});assert.ok(r.service.climbing().notice,'a second stuck moment shows again');
 ladder.result({arrived:false,at:{map:'main',x:0,y:0},planned:{transitions:0,walking:100},remaining:{transitions:0,walking:10}});
 assert.equal(r.service.climbing().notice,undefined,'progress ends the notice');
 // S2.7, B9.8: an error inside the owner is caught and counted, the call goes on, the error is
 // recorded with its lead-up and the climber moves to its next rung.
 const index=r.service.climbing().index;
 Object.defineProperty(r.host.parent,'entities',{configurable:true,get(){throw Error('planted');}});
 const step=r.service.step({x:10,y:0},'kiting');
 assert.equal(step.status,'sent','the call goes on as a free character\'s');
 assert.equal(r.service.ownerReport().errors,1);
 const caught=r.service.incidents().find(i=>i.kind==='caught-error');
 assert.match(caught?.error??'',/planted/);assert.ok(caught.leadUp.length>0);
 assert.equal(r.service.climbing().index,index+1,'the climber tries its next rung');
 // S8c.6: the owner measures its calls on the real clock, which runs while the service clock stands.
 assert.ok(r.service.ownerReport().totalMs>0,'cost read on the real clock');
 void third;r.dispose();
 }, {stall:true}],
 // S5.3 to S5.10 (02-movement-failures.md "ranked requests ... waits and holds" and "six farming
 // windows"; design section 2.4 rules 4 to 6). The fixture walks at speed 60.
 ['S5: a combat step pauses the journey, a repeat inside 2 units sends nothing, letting go resumes it, and the pause ends on its own', async r=>{
 // S5.8: with no journey, a let go stops the character's own step once.
 r.service.step({x:5,y:0},'kiting');Object.assign(r.c,{moving:true,going_x:5,going_y:0});
 r.service.letGo();r.service.letGo();
 assert.equal(r.service.ownerReport().steps.stops,1);
 r.c.moving=false;
 r.service.move({map:'main',x:100,y:0},undefined,{request:{kind:'follow',owner:'follow'}}).catch(()=>{});await r.ticks(2);
 const journeyId=r.service.report().id,searches=r.service.report().searches;
 const moves=()=>r.calls.filter(c=>c[0]==='move').length;
 assert.equal(r.service.step({x:10,y:0},'kiting').status,'sent');
 assert.ok(r.service.records().some(e=>e.decision==='paused'&&e.journeyId===journeyId&&e.cause==='combat'));
 Object.assign(r.c,{moving:true,going_x:10,going_y:0});
 const sent=moves();
 assert.equal(r.service.step({x:11,y:0},'kiting').status,'kept','rule 4: a repeat within 2 units is the step being walked');
 assert.equal(moves(),sent);
 // S5.5 (design 'Corrections', item 2): letting go of a paused journey sends no stop; the travel
 // move replaces the step.
 const stopsBefore=r.service.ownerReport().steps.stops;
 r.service.letGo();
 assert.ok(r.service.records().some(e=>e.decision==='resumed'&&e.journeyId===journeyId&&e.cause==='let-go'));
 await r.ticks(2);
 assert.equal(r.service.ownerReport().steps.stops,stopsBefore,'no stop for the paused journey');
 assert.deepEqual(r.calls.filter(c=>c[0]==='move').at(-1),['move',100,0],'the travel move replaces the step');
 assert.equal(r.service.report().searches,searches,'S5.3: a resumed journey with a valid route plans nothing again');
 assert.equal(r.service.report().id,journeyId);
 // S5.10: a pause with no step or hold after it holds while the last step walks (steps.ts
 // `stepWindowMs`) and has ended by the design's 1.6 s.
 r.c.moving=false;
 const {stepWindowMs}=require('../../runtime/movement/character/steps.ts'),windowMs=stepWindowMs({x:0,y:0},{x:20,y:0},r.c.speed);
 assert.ok(windowMs<=1600);
 assert.equal(r.service.step({x:20,y:0},'kiting').status,'sent');
 const resumes=()=>r.service.records().filter(e=>e.decision==='resumed'&&e.journeyId===journeyId).length,before=resumes();
 r.setNow(1000+windowMs-1);await r.ticks(1);assert.equal(resumes(),before,'the pause holds while the step walks');
 r.setNow(1000+1600);await r.ticks(1);
 assert.deepEqual(r.service.records().filter(e=>e.decision==='resumed').at(-1)?.cause,'idle','the combat pause ended on its own');
 // S5.9: a player command replaces the paused journey at once and the paused one ends.
 r.service.step({x:30,y:0},'kiting');
 r.service.move({map:'main',x:0,y:50}).catch(()=>{});await r.ticks(1);
 assert.equal(r.service.live()?.kind,'manual');
 assert.ok(r.service.records().some(e=>e.decision==='ended'&&e.journeyId===journeyId));
 r.dispose();
 }, {stall:true}],
 // S6.8 (02-movement-failures.md "six farming windows"): a failed journey's end names the
 // service's failure text and the planner in the journey report (report.ts `movement`).
 ['S6.8: a journey whose plan fails ends failed, and its report names the failure text and the planner', async r=>{
 const walk=r.service.move({map:'main',x:100,y:0},undefined,{request:{kind:'follow',owner:'follow'}});
 const failed=assert.rejects(walk,/planner unreachable/);await r.ticks(4);await failed;
 const end=r.service.records().find(e=>e.decision==='ended'&&e.owner==='follow');
 assert.match(end.code,/^failed:/);
 const last=r.service.last();
 assert.deepEqual([last.end,last.reason,typeof last.failureContext?.planner],[end.code,'planner unreachable','string']);
 r.dispose();
 }, {offline:true,planError:'planner unreachable'}],
]);


// and: every end goes through finish, which names it in the ring and clears the slot.
test('combat handoff, cancel and dispose each end the journey once with a named end',async()=>{
 const handoff=fixture({pending:true}),journey=handoff.service.move({map:'main',x:100,y:0});
 const rejected=assert.rejects(journey,/Combat handoff/);handoff.service.combatHandoff();await rejected;
 assert.equal(handoff.service.last().reason,'Combat handoff');assert.equal(handoff.service.live(),null);
 assert.ok(handoff.logs.some(log=>log.phase==='Travel paused for combat'));
 assert.ok(!handoff.logs.some(log=>log.phase==='Movement failed'));handoff.dispose();
 const cancel=fixture({pending:true}),walking=cancel.service.move({map:'main',x:100,y:0});const cancelled=assert.rejects(walking);
 await cancel.ticks(1);cancel.service.cancel('Individual combat approach cancelled',{code:'combat-approach-cancelled'});await cancelled;
 assert.equal(cancel.service.last().done,false);assert.equal(cancel.service.last().failureContext.code,'combat-approach-cancelled');
 assert.equal(cancel.logs.at(-1).phase,'Movement cancelled');cancel.dispose();
 const disposed=fixture({stall:true}),moving=disposed.service.move({map:'main',x:100,y:0},undefined,{request:{kind:'follow',owner:'follow'}});
 const replaced=assert.rejects(moving);await disposed.ticks(2);disposed.dispose();await replaced;
 const ends=disposed.service.records().filter(e=>e.decision==='ended'&&e.owner==='follow');
 assert.deepEqual(ends.map(e=>e.code),['runtime-replaced'],'one named end per journey');
 // Step 13: a journey its holder releases right after its first move went out stops at a point
 // the server takes. The game's move() records where a move began (from_x, from_y), and the
 // server drops a move to the point it still holds, so the stop names a point off it.
 const released=fixture({stall:true}),c=released.c,move=released.host.move;
 released.host.move=(x,y)=>{c.from_x=c.real_x;c.from_y=c.real_y;return move(x,y);};
 const request={kind:'approach',owner:'approach:combat-approach:1'},walk=released.service.move({map:'main',x:100,y:0},undefined,{request});walk.catch(()=>{});
 await released.ticks(2);assert.ok(released.calls.some(m=>m[0]==='move'&&m[1]!==c.real_x),'the walk sent its move');
 released.service.release(request.owner);
 const stop=released.calls.filter(m=>m[0]==='move').at(-1);
 assert.ok(stop[1]!==c.real_x||stop[2]!==c.real_y,'the stop names a point the server takes');assert.ok(Math.hypot(stop[1]-c.real_x,stop[2]-c.real_y)<1);released.dispose();
});

// The walking try (R2F3), with the call budget's margin at 200 ms: a step that stops short goes
// again one round trip later and the try ends one round trip after that; a walk the client shows
// moving is never cut on its position alone; two reports that show it moving with no 2-unit
// progress end it.
scenarioTable("the walking try ends on the game's own movement, never on a fixed time (R2F3)", fixture, [
 ['a step that stops short goes again one round trip later, and the try ends one round trip after that', r=>withMargin(200,async()=>{
 const p=r.service.move({map:'main',x:100,y:0},undefined,{shared:true});
 const rejected=assert.rejects(p,/Stalled walking movement/);await r.ticks();
 r.setNow(1150);await r.ticks();assert.equal(r.calls.filter(c=>c[0]==='move').length,1,'no re-send inside one round trip');
 r.setNow(1250);await r.ticks();assert.equal(r.calls.filter(c=>c[0]==='move').length,2,'the re-send after one round trip');
 r.setNow(1400);await r.ticks();assert.equal(r.service.report()?.progress.reissued,true,"the try runs on inside the re-send's round trip");
 r.setNow(1500);await r.ticks();await rejected;
 assert.equal(r.service.last().progress.destination.x,100);r.dispose();
 }), {stall:true}],
 // B107: a combat step pauses the journey, so the try does not send the travel step
 // again while the character stands after the combat step. re-sent the segment 250 ms after the
 // character stopped, under the combat step (shared.js:17152).
 ['B107: a combat step pauses the walk, so the stopped travel step is not sent again under it', r=>withMargin(200,async()=>{
 const p=r.service.move({map:'main',x:100,y:0},undefined,{shared:true});p.catch(()=>{});await r.ticks();
 const moves=()=>r.calls.filter(c=>c[0]==='move').length;
 assert.equal(moves(),1,'the travel step');
 assert.equal(r.service.step({x:0,y:60},'combat').status,'sent');
 r.setNow(1500);await r.ticks();
 assert.equal(moves(),2,'the combat step, and no travel re-send under it');
 r.dispose();
 }), {stall:true}],
 // An add-on's zone refusal names the add-on and its reason in the step's reason, so the player
 // reads who refused the step.
 ['a step that ends inside an add-on zone is refused with the add-on and its reason', (r,row)=>{
 const hooks=testRegistry(row);
 hooks.register({name:'zone-fixture',folder:'addons',author:'test',summary:'Refuses every step while the row enables it.',
 hooks:{'step.safety':()=>'inside the fixture zone'}});
 hooks.configure({'zone-fixture':{enabled:true}});
 // The zones' view asks the events owner which event the character joined.
 const facts=globalThis.__partyEventFacts;globalThis.__partyEventFacts={joinedEventName:()=>null};
 let step;try{step=r.service.step({x:20,y:0},'test');}finally{globalThis.__partyEventFacts=facts;}
 assert.equal(step.status,'refused');
 assert.equal(step.reason,'unsafe:zone zone-fixture: inside the fixture zone');
 r.dispose();
 }],
 ['a walk the client shows moving is never cut on its position alone', r=>withMargin(200,async()=>{
 const p=r.service.move({map:'main',x:100,y:0},undefined,{shared:true});p.catch(()=>{});await r.ticks();
 r.c.moving=true;for(const at of [2000,8000,20000]){r.setNow(at);await r.ticks();}
 assert.equal(r.service.report()?.progress.phase,'walking');r.dispose();
 }), {stall:true}],
 ['two reports that show it moving with no 2-unit progress end the try', r=>withMargin(200,async()=>{
 const p=r.service.move({map:'main',x:100,y:0},undefined,{shared:true});
 const rejected=assert.rejects(p,/Stalled walking movement \(moving without progress/);await r.ticks();
 r.c.moving=true;r.service.reported();r.c.real_x+=1;r.setNow(2000);r.service.reported();await r.ticks();await rejected;r.dispose();
 }), {stall:true}],
 // The end run on c23b613bb (row 40, CB23): the warrior stood after a click to its own spot, its
 // step went again, and two reports read it moving at the spot where it stood, before the game drew
 // the re-sent walk (game.js `draw` moves `real_x` once per draw, 250 ms apart for a CODE window).
 // The try ended `failed:route-failed` one draw later, 19.7 units on.
 ['two reports in one game update show no walk between them, so they end no try', r=>withMargin(200,async()=>{
 const p=r.service.move({map:'main',x:100,y:0},undefined,{shared:true});p.catch(()=>{});await r.ticks();
 r.host.parent.last_draw=1000;r.c.moving=true;r.service.reported();r.setNow(1100);r.service.reported();await r.ticks();
 assert.equal(r.service.report()?.progress.phase,'walking','the second report read the same draw');
 r.host.parent.last_draw=1250;r.c.real_x+=20;r.setNow(1300);r.service.reported();await r.ticks();
 assert.equal(r.service.report()?.progress.phase,'walking');r.dispose();
 }), {stall:true}],
 ['a stand between two moving reports starts the report test again', r=>withMargin(200,async()=>{
 const p=r.service.move({map:'main',x:100,y:0},undefined,{shared:true});p.catch(()=>{});await r.ticks();
 r.host.parent.last_draw=1000;r.c.moving=true;r.service.reported();
 r.c.moving=false;r.host.parent.last_draw=1250;r.setNow(1250);await r.ticks();
 assert.equal(r.calls.filter(c=>c[0]==='move').length,2,'the step went again after the stand');
 r.c.moving=true;r.setNow(1300);r.service.reported();await r.ticks();
 assert.equal(r.service.report()?.progress.phase,'walking','the report after the re-send starts the test');r.dispose();
 }), {stall:true}],
 // The end run on 367447e73 (D7): a player command started as the escape's native walk released,
 // and its stop took three planning ticks to settle, past the margin of that run.
 ['the stop before a plan settles on its own answer, however long the game takes to stop', r=>withMargin(200,async()=>{
 const walkTo=r.host.move;let stopped;
 r.host.move=(x,y)=>{r.calls.push(['move',x,y]);return new Promise(resolve=>{stopped=()=>{r.c.moving=false;resolve({success:true,reason:'stopped'});};});};
 r.c.moving=true;
 let error;const walk=r.service.move({map:'main',x:100,y:0});walk.catch(e=>{error=e;});
 for(const at of [1100,1400,2000]){r.setNow(at);await r.ticks(1);}
 assert.equal(r.request,undefined,'no plan while the stop has not answered');
 r.host.move=walkTo;stopped();await r.ticks();
 assert.equal(error,undefined,'the journey waits for the stop');
 assert.ok(r.request,'the plan goes once the stop answers');r.dispose();
 })],
 ['a stop that a later move interrupts ends the journey before its plan', r=>withMargin(200,async()=>{
 let answer;r.host.move=(x,y)=>{r.calls.push(['move',x,y]);return new Promise(resolve=>{answer=resolve;});};
 r.c.moving=true;
 let error;r.service.move({map:'main',x:100,y:0}).catch(e=>{error=e;});
 await r.ticks(2);answer({success:true,reason:'interrupted'});await r.ticks(2);
 assert.match(String(error?.message),/did not settle before route planning/);
 assert.equal(r.request,undefined);r.dispose();
 })],
 // A step that stopped short and is no longer walkable from where the character
 // stands cannot be sent again, so its try ends on that reason.
 ['a step no longer walkable from where it stopped ends the try at once', ()=>withMargin(200,async()=>{
 const options={stall:true,plot:[{map:'main',x:50,y:0}]},r=fixture(options);
 const p=r.service.move({map:'main',x:50,y:0},undefined,{shared:true});
 const rejected=assert.rejects(p,/collision/i);await r.ticks();
 assert.equal(r.calls.filter(c=>c[0]==='move'&&c[1]===50).length,1,'the step went once');
 options.collision=true;r.setNow(1250);await r.ticks();await rejected;
 assert.equal(r.calls.filter(c=>c[0]==='move'&&c[1]===50).length,1,'no re-send of a step that is not walkable');r.dispose();
 })],
 // The journey's own round on the one climber, with no count.
 ['a journey that fails tries the other route once, then ends for its requester to climb', r=>withMargin(200,async()=>{
 const p=r.service.move({map:'main',x:100,y:0});
 const rejected=assert.rejects(p,/Stalled walking movement/);
 for(let at=1000;at<=3000;at+=150){r.setNow(at);await r.ticks(2);}
 await rejected;
 assert.equal(r.searches,1,'one native plan after the first failure, none after the second');
 assert.equal(r.service.last().rung,'end');r.dispose();
 }), {stall:true}],
]);

// A shared request names its own planning budget within the planner's bounds, and
// movement names no Cave.
scenarioTable('a shared request carries its own planning budget', fixture, [
 ['a shared request plans with its own 60 s budget and goes on while its search advances', async r=>{
 const p=r.service.move({map:'main',x:100,y:0},undefined,{shared:true,native:true,nativePlanningTimeoutMs:60000});
 await r.ticks(12);await p;assert.equal(r.service.last().done,true);r.dispose();
 }],
 // The sight search, repair and crossing picks are rules.ts `MOVEMENT_PICKS`, so a reply that names
 // one changes nothing; the planning budget stays delivered.
 ["the sight search reads its named picks and a reply cannot replace them", r=>{
 const {movementSavedFields}=require('../../runtime/movement/saved-fields.ts');
 r.service.settingsReply({movementPlanningMs:500,movementSightSearchMs:4000,movementSightSteps:2});
 assert.deepEqual(r.service.sightSearch(),{ms:8000,steps:6});
 for(const name of ['movementRepairMs','movementSightSearchMs','movementSightSteps','crossingTransportBoundMs','crossingLeaveBoundMs','crossingTownBoundMs'])
  assert.equal(movementSavedFields.settings[name],undefined,name+' is no saved setting');
 r.dispose();
 }],
]);

scenarioTable('reached walking points finish without a zero-distance move and keep the transition barrier', reachedWalkFixture, [
 // A reached point within the one-unit boundary is consumed with no move; one past it still walks.
 ['entire reached route finishes without a move including the one-unit boundary', ()=>{
 const reached=reachedWalkFixture([{map:'main',x:177,y:460},{map:'main',x:178,y:460}]);
 assert.equal(reached.executor.tick({}),true);assert.deepEqual(reached.calls,[]);
 const outside=reachedWalkFixture([{map:'main',x:178.01,y:460}]);
 outside.executor.tick({});assert.equal(outside.calls.length,1);
 }],
]);


// The Town arrival connector: one Town plot step, its cast and the walk to the exact spawn, on the
// harness's connector (fixtures/town-connector-scenario.cjs).
scenarioTable('the Town arrival connector', ()=>townConnector, [
 // The server scatters a Town landing around the spawn. The arrival connector's walk to the exact
 // spawn outlasts a round trip; the live Town connector rows ended it with "Failed town warp".
 ['a scattered Town landing walks its connector past a round trip and arrives', async connector=>{
  const f=connector({move:character=>{character.moving=true;return Promise.resolve();},town:()=>Promise.resolve({success:true})});
  assert.equal(f.executor.tick({}),false);await settle();
  f.at(1.5,41.5);f.clock.now+=50;
  assert.equal(f.executor.tick({}),false);assert.deepEqual(f.calls,['town',['move',0,0]]);
  f.clock.now+=500;assert.equal(f.executor.tick({}),false,'the connector still walks after five round trips');
  f.at(0,0).moving=false;f.clock.now+=50;f.executor.tick({});f.clock.now+=50;
  assert.equal(f.executor.tick({}),true);assert.deepEqual(f.executor.remaining(),[]);
 }],
 // A lost connector move is sent again no sooner than v1.5.0's 1000 ms after its last send with no
 // progress, so the walk request rate stays at v1.5.0's (the round2 connector rows'
 // 950 ms floor). The connector is a walk: once the resend's round trip passes with the client
 // standing, the crossing fails, as the round2 "all submission loss" row expects (red before: the
 // connector was sent again every second with no end).
 ['a lost arrival connector is sent again no faster than once per second, and a lost resend fails the crossing', async connector=>{
  const f=connector({move:()=>new Promise(()=>{}),town:()=>Promise.resolve({success:true})});
  f.executor.tick({});await settle();
  f.at(1.5,41.5);
  let failure=null;
  for(let i=0;i<30&&!failure;i++){f.clock.now+=100;try{assert.equal(f.executor.tick({}),false);}catch(error){failure=error;}}
  assert.equal(f.moves.length,2,'the first send and one resend');
  assert.ok(f.moves[1]-f.moves[0]>=1000,`the resend came ${f.moves[1]-f.moves[0]} ms after the first send`);
  assert.match(String(failure?.message),/Failed town warp/);
  assert.ok(f.clock.now-f.moves[1]>100&&f.clock.now-f.moves[1]<=200,'the crossing fails one round trip after the resend');
 }],
 // The live round2 "all submission loss" row measured a round trip above the 1000 ms spacing; the
 // connector was sent 27 times in 35 s with no end.
 ['a lost connector resend fails the crossing when the round trip outlasts the resend spacing', async connector=>{
  const f=connector({move:()=>new Promise(()=>{}),town:()=>Promise.resolve({success:true}),roundTrip:1200});
  f.executor.tick({});await settle();
  f.at(1.5,41.5);
  let failure=null;
  for(let i=0;i<60&&!failure;i++){f.clock.now+=100;try{assert.equal(f.executor.tick({}),false);}catch(error){failure=error;}}
  assert.equal(f.moves.length,2,'the first send and one resend');
  assert.ok(f.moves[1]-f.moves[0]>=1200,`the resend came ${f.moves[1]-f.moves[0]} ms after the first send`);
  assert.match(String(failure?.message),/Failed town warp/);
  assert.ok(f.clock.now-f.moves[1]>1200&&f.clock.now-f.moves[1]<=1300,'the crossing fails one round trip after the resend');
 }],
 // A connector whose resend walks makes progress and arrives: the first send was the only loss.
 ['a connector whose first send is lost walks on its resend and arrives', async connector=>{
  const f=connector({move:(character,moves)=>{if(moves.length===1)return new Promise(()=>{});character.moving=true;return Promise.resolve();},town:()=>Promise.resolve({success:true})});
  f.executor.tick({});await settle();
  f.at(1.5,41.5);
  for(let i=0;i<15;i++){f.clock.now+=100;assert.equal(f.executor.tick({}),false);}
  assert.equal(f.moves.length,2);
  f.at(1,20);f.clock.now+=500;assert.equal(f.executor.tick({}),false,'the walking connector goes on');
  f.at(0,0).moving=false;f.clock.now+=50;f.executor.tick({});f.clock.now+=50;
  assert.equal(f.executor.tick({}),true);
 }],
 // Halloween Mr. Green return (live run on a4884e05f): the game answers a Town cast only when the
 // cast ends (js/runner_functions.js town(): new_map with effect 1, a failure or its own 10 s
 // timeout), and on a busy realm the cast showed on the character 3 s after the send. The executor
 // failed the warp after one round trip with no answer ("Failed town warp") and stopped the cast.
 // A transition waits on its own answer while the game has not given one.
 ['a Town warp whose answer is still pending is not failed by the round trip', async connector=>{
  let answer;
  const f=connector({move:()=>Promise.resolve(),town:()=>new Promise(resolve=>{answer=resolve;})});
  assert.equal(f.executor.tick({}),false);await settle();
  for(let i=0;i<30;i++){f.clock.now+=100;assert.equal(f.executor.tick({}),false,"the cast is still the game's");await settle();}
  assert.deepEqual(f.calls,['town'],'one cast, no stop and no second send');
  f.at(0,0);answer({success:true});await settle();
  f.clock.now+=50;f.executor.tick({});f.clock.now+=50;
  assert.equal(f.executor.tick({}),true,'the answered warp arrives');
 }],
]);

// The `ready` check on the character: the executor's loot and Town waits
// last while the gate's chests or attackers' HP fall, not 30 s or 5 s.
function departureExecutor(step,reads){
 const f=fixture(),{createMovementExecutor}=require('../../runtime/movement/character/executor.ts');
 const {departureGate}=require('../../runtime/movement/character/walk-client.ts');
 const r={now:1000,chests:[],attackers:[],pending:false,barriers:[],town:[],...reads};
 const gate=departureGate({chests:()=>r.chests,attackers:()=>r.attackers,windowMs:()=>2000,now:()=>r.now},{ask:()=>r.pending});
 r.executor=createMovementExecutor(f.host,{plot:[step],use_town:true},{game:f.host.G,walk:()=>true,door:()=>true},()=>r.now,gate,
  {band:()=>'job',stopTown:()=>Promise.resolve(f.host.stop('town')),standStill:()=>Promise.resolve(),roundTrip:()=>0});
 r.options={barrier:(step,index,completed,lootLeft)=>{r.barriers.push(lootLeft);return new Promise(()=>{});},
  townAttempt:state=>r.town.push(state)};
 r.f=f;return r;
}
scenarioTable('a departure wait lasts while its fight or loot falls and ends when they stop', ()=>undefined, [
 ['falling loot holds a map change past 30 s; loot that stops falling is left and the barrier says so', ()=>{
 const r=departureExecutor({map:'main',x:0,y:0,town:true},{chests:[1,2,3]});
 r.executor.tick(r.options);
 for(let i=0;i<2;i++){r.now+=20000;r.chests=r.chests.slice(1);assert.equal(r.executor.tick(r.options),false);}
 assert.deepEqual(r.barriers,[],'still waiting for the last chest after 40 s');
 r.now+=1999;r.executor.tick(r.options);assert.deepEqual(r.barriers,[],'within the window');
 r.now+=1;r.executor.tick(r.options);assert.deepEqual(r.barriers,[true],'the chest is left and the barrier carries it');
 r.executor.cancel();assert.equal(r.executor.progress().phase,'idle');r.f.dispose();
 }],
 ['a falling departure fight holds a Town cast past 5 s; a fight that stops falling ends the try', ()=>{
 const r=departureExecutor({map:'main',x:0,y:0,town:true},{pending:true,attackers:[{hp:900},{hp:400}]});
 r.executor.tick(r.options);
 for(const hp of [800,500,200]){r.now+=3000;r.attackers=[{hp},{hp:400}];assert.equal(r.executor.tick(r.options),false);}
 assert.deepEqual(r.town,[],'still waiting after 9 s');
 r.attackers=[{hp:200},{hp:400},{hp:5000}];r.now+=1000;assert.equal(r.executor.tick(r.options),false,'a new attacker is no fall');
 r.now+=1000;assert.throws(()=>r.executor.tick(r.options),/Town unavailable: the departure fight and loot stopped falling/);
 assert.deepEqual(r.town,['unavailable']);r.f.dispose();
 }],
 // Observed live on 2026-11-22 at 10:30 and 17:29: a Water Spirit killed the priest, the
 // survivors' escape walked home to Main with a Town step, and each refused it ("Town warp
 // currently unavailable") because the fight that started the escape was pending. They walked
 // across Winterland under attack instead. The escape's request row departs `now`.
 ['an escape casts its Town with the fight pending and a chest left', ()=>{
 const r=departureExecutor({map:'main',x:0,y:0,town:true},{pending:true,chests:[1],attackers:[{hp:900}]});
 const options={request:{kind:'escape',owner:'escape:e1'}};
 assert.equal(r.executor.tick(options),false);
 assert.deepEqual(r.f.calls,[['town']]);r.f.dispose();
 }],
 // A departure holds the Town cast on what its column waits for: `loot` (the Hunt's return)
 // leaves the fight, and `fight` (an add-on's `go`) leaves the chests.
 ['a loot departure casts its Town with the fight pending; a fight departure casts it with a chest left', ()=>{
 const loot=departureExecutor({map:'main',x:0,y:0,town:true},{pending:true,attackers:[{hp:900}]});
 assert.equal(loot.executor.tick({departure:'loot'}),false);
 assert.deepEqual(loot.f.calls,[['town']],'loot');loot.f.dispose();
 const fight=departureExecutor({map:'main',x:0,y:0,town:true},{chests:[1]});
 assert.equal(fight.executor.tick({departure:'fight'}),false);
 assert.deepEqual(fight.f.calls,[['town']],'fight');fight.f.dispose();
 }],
]);

scenarioTable('an exhausted owned route waits for settlement and keeps its declared tolerance', fixture, [
 // A journey completes only standing still within its own tolerance, and an owned terminal
 // acknowledgement retires only its own settled journey.
 ['exhausted owned route waits for physical settlement without spending recovery retries', async ()=>{
 const r=fixture();
 const p=r.service.move({map:'main',x:100,y:0},undefined,{arrivalTolerance:1});let completed=false;p.then(()=>completed=true);p.catch(()=>{});
 r.service.install([{map:'main',x:100,y:0}],r.service.identity);r.service.state.plot.length=0;r.c.moving=true;r.c.real_x=30;
 await r.ticks(20);assert.equal(completed,false);assert.equal(r.service.report().rung,'replan','settling spends no rung of the journey round');
 r.c.real_x=100;r.c.moving=false;await r.ticks();await p;assert.equal(r.service.last().done,true);r.dispose();
 const declared=fixture();
 declared.c.in='generated-owner';const q=declared.service.move({map:'main',x:100,y:0},undefined,{arrivalTolerance:40});
 declared.c.real_x=70;declared.service.install([],declared.service.identity);await declared.ticks();await q;
 assert.equal(declared.service.last().done,true);assert.equal(declared.service.last().rung,'replan');declared.dispose();
 }],
 ['terminal acknowledgement refuses unacknowledged, intermediate, displaced, and superseded owned journeys', async ()=>{
 for(const mode of ['unacknowledged','intermediate','displaced','superseded','runtime','paused']){
  const owner={convoyId:'return',epoch:3,commandId:7,navigationRevision:1},r=fixture();
  r.c.hp=100;r.host.G.maps.cyberland={spawns:[[0,0]]};r.c.map=r.c.in='cyberland';
  const original=r.ports.context;r.ports.context=()=>({...original(),server:'USI'});
  // An unacknowledged leave is one the game still shows in transport (transition row): the try
  // waits on it, so its journey stays live for the acknowledgement to refuse.
  r.host.parent.push_deferred=()=>{Object.assign(r.c,{map:'main',in:'main',real_x:0,real_y:0});
    if(mode==='unacknowledged')r.host.is_transporting=()=>true;
    return mode==='unacknowledged'?new Promise(()=>{}):Promise.resolve();};
  const p=r.service.move({map:'main',in:'main',x:mode==='intermediate'?100:0,y:0},undefined,
    {shared:true,awaitSharedRoute:true,owner,barrier:async(_s,_i,completed)=>!completed});
  p.catch(()=>{});
  const plot=[{map:'main',in:'main',x:0,y:0,method:'leave'}];
  if(mode==='intermediate')plot.push({map:'main',in:'main',x:100,y:0});
  r.service.install(plot,r.service.identity);await r.ticks(5);r.setNow(1500);await r.ticks(3);
  const id=r.service.report().id,calls=r.calls.length;
  if(mode==='displaced')r.c.real_x=5;
  if(mode==='superseded')r.supersede();if(mode==='runtime')r.reload();
  if(mode==='paused')r.ports.context=()=>({...original(),server:'USI',paused:true});
  assert.equal(r.service.settleTerminal(id,owner),false,mode);assert.equal(r.calls.length,calls,mode);
  assert.equal(r.service.state.moving,true,mode);r.dispose();
 }
 }],
]);

scenarioTable('an accepted server correction pauses only the live owned walking step', correctionFixture, [
 ['accepted native correction stops the current owned walk before its old velocity drifts', async r=>{
 const p=r.service.move({map:'main',x:100,y:0},undefined,{shared:true});p.catch(()=>{});
 await r.ticks();const id=r.service.report().id, before=r.calls.length;
 r.socket.emit('correction',{x:10,y:20});
 assert.deepEqual(r.calls.slice(before),[['move',10,20]]);
 assert.equal(r.service.report().id,id);assert.equal(r.service.report().progress.phase,'idle');
 assert.equal(r.service.state.plot.length,1);r.dispose();await assert.rejects(p);
 }],
]);

// No plan request starts a worker. A worker that retires on a
// failure starts one replacement at once; a replacement that fails before its first answer starts
// none, and the geometry's next delivery prepares it again. The fake worker exits on the request
// `exit` and never answers `hang`; its setup cannot share the real worker's.
function retiringPlanner() {
 // The planner reads its budgets as hidden settings; the row holds a party state with its own.
 const {hiddenSettings,holdHiddenSettings}=require('../../runtime/settings/coordinator/table.ts');
 const budget=values=>holdHiddenSettings({...hiddenSettings({}),...values});
 const worker=new URL('data:text/javascript,'+encodeURIComponent("import {parentPort} from 'node:worker_threads';"+
  "parentPort.postMessage({ready:true});parentPort.on('message',m=>m.id==='exit'?process.exit(0):m.id==='hang'?0:parentPort.postMessage({id:m.id,plot:[],ms:0}));"));
 const service=createPlannerService(worker,testScope('02','act')),game={maps:{},geometry:{},npcs:{transporter:{places:{}}}};
 // `release` drops the row's held state, so the planner reads the declared budgets again.
 const r={service,game,prepared:service.prepare(game,1),budget,release:()=>holdHiddenSettings(null),
  ask:id=>({id,from:{map:'main',x:0,y:0},to:{map:'main',x:10,y:0},speed:60,version:1,fingerprint:r.prepared.fingerprint})};
 return r;
}
scenarioTable('a retired planner worker is replaced once at its retirement, never per plan request', retiringPlanner, [
 ['a worker that exits or times out on a plan starts one replacement at once, which plans the next request', async r=>{
  try {
   await r.prepared.ready;
   await assert.rejects(r.service.plan(r.ask('exit')),/Planner worker exited/);
   assert.deepEqual((await r.service.plan(r.ask('a'))).plot,[]);
   r.budget({movementAlclientPlanMs:50});
   await assert.rejects(r.service.plan(r.ask('hang')),/ALClient planning timed out/);
   assert.deepEqual((await r.service.plan(r.ask('b'))).plot,[]);
  } finally{r.release();r.service.dispose();}
 }],
 ['a replacement that fails before its first answer starts none; requests fail until the geometry is delivered again', async r=>{
  try {
   await r.prepared.ready;
   await assert.rejects(r.service.plan(r.ask('exit')),/Planner worker exited/);
   await assert.rejects(r.service.plan(r.ask('exit')),/Planner worker exited/);
   for(const id of ['a','b','c'])await assert.rejects(r.service.plan(r.ask(id)),/No compatible game geometry prepared: .*; prepared none$/);
   r.prepared=r.service.prepare(r.game,1);await r.prepared.ready;
   assert.deepEqual((await r.service.plan(r.ask('d'))).plot,[]);
  } finally{r.service.dispose();}
 }],
]);

scenarioTable('the movement records, geometry identity and journey lines are built apart from the service', ()=>undefined, [
['diagnostics snapshot coordinates and deduplicate independently of mutable movement state', _ => {
 const {movementDiagnostics}=require('../../runtime/movement/character/records.ts');
 let now=1000;const logs=[],colours=[];
 const report=movementDiagnostics({game_log:(message,colour)=>colours.push(colour)},{now:()=>now,events:(type,message,data,key)=>logs.push({type,data,message,key})},'Test',16846,'geometry');
 const destination={map:'main',x:100,y:0,moving:true,plot:[{map:'main',x:100,y:0}]};
 const issue={reason:'collisions detected',from:{map:'main',x:0,y:0},to:{map:'main',x:50,y:0}};
 report('runtime:1',destination,'Route rejected',issue,'falling back to native smart_move');
 destination.moving=false;destination.plot=[];
 report('runtime:1',destination,'Route rejected',issue,'falling back to native smart_move');
 assert.equal(logs.length,1);assert.deepEqual(logs[0].data.destination,{map:'main',x:100,y:0});
 // `diagnostic`: the game log in the phase's colour, the navigation events under its key.
 assert.deepEqual([colours,logs[0].type,logs[0].key],[['#fbbf24'],'navigation','movement:runtime:1:Route rejected:1000']);
 report('runtime:2',destination,'Movement failed');report('runtime:3',destination,'Native fallback succeeded');
 assert.deepEqual(colours.slice(1),['red','#94a3b8']);logs.splice(1);
 // Class D: a line is written once while its journey lives, whatever was written between, so
 // lines that alternate are each written once, and the journey's end writes each repeat count.
 const rejected=()=>report('runtime:1',destination,'Route rejected',issue,'falling back to native smart_move');
 const repaired=()=>report('runtime:1',destination,'Route repaired');
 repaired();rejected();repaired();
 assert.deepEqual(logs.map(l=>l.data.phase),['Route rejected','Route repaired']);
 report.end('runtime:1');
 assert.deepEqual(logs.slice(2).map(l=>[l.data.phase,l.data.count]),[['Route rejected',3],['Route repaired',2]]);
 assert.match(logs[2].message,/Similar messages: 3 \(not route attempts\)/);
 // The journey's end drops its lines, so the next journey writes the same content again.
 report('runtime:1',destination,'Route repaired');assert.equal(logs.length,5);
 destination.x=200;issue.to.x=80;
 assert.equal(logs[0].data.destination.x,100);assert.equal(logs[0].data.issue.to.x,50);
}],
// The row v1.5.0's cut of geometry-identity-cache.test.cjs planned. The cache keeps
// its identity while the inputs are the same objects; a renderer field changes nothing, and a
// replaced collision line or a new door gives a new identity.
['movement reuses its geometry identity until collision or transition data changes', _ => {
 const g={maps:{main:{spawns:[[0,0]],doors:[],npcs:[]}},geometry:{main:{x_lines:[[0,0,10]],y_lines:[]}},npcs:{transporter:{places:{}}}};
 const first=cachedGeometryFingerprint(g);
 assert.equal(first,geometryFingerprint(g));
 g.maps.main.data={rendered:true};
 assert.equal(cachedGeometryFingerprint(g),first,'a renderer field keeps the identity');
 g.geometry.main={x_lines:[[0,0,20]],y_lines:[]};
 const moved=cachedGeometryFingerprint(g);
 assert.notEqual(moved,first,'a replaced collision line gives a new identity');
 g.maps.main.doors.push([10,10,20,20,'bank',0,0]);
 assert.notEqual(cachedGeometryFingerprint(g),moved,'a new door gives a new identity');
}],
// B106: the "Movement replaced" line names the destination that replaced the
// journey. v1.5.0 wrote the line before the new destination, so it named only the
// replaced journey's; the new one sat in the failure context alone.
['B106: the replaced journey\'s line names the destination that replaced it', _ => {
 const {movementDiagnostics}=require('../../runtime/movement/character/records.ts');
 const lines=[];
 const report=movementDiagnostics({game_log:message=>lines.push(message)},{now:()=>0,events(){}},'Test',16846,'geometry');
 const context={code:'destination-replaced',replacement:{map:'main',x:-200,y:40}};
 report('runtime:1',{map:'main',x:100,y:0},'Movement failed',undefined,'Movement replaced by a new destination',context);
 assert.match(lines[0],/Destination: main \(100, 0\)\. Replaced by: main \(-200, 40\)\./);
 report('runtime:2',{map:'main',x:100,y:0},'Movement failed',undefined,'Movement replaced by a new destination',{...context,replacement:'bank'});
 assert.match(lines[1],/Replaced by: bank\./);
}],
// B126: a shared walk repairs its drift while each repair finds it closer to its goal.
// v1.5.0 let a shared walk repair three endpoints, then failed it. Combat pushes this
// walk off its route four times, each farther along (helpers/shared-drift.cjs).
['B126: a shared walk pushed off its route four times rejoins it each time and arrives', async _ => {
 const {sharedDrift}=require('./helpers/shared-drift.cjs');
 const d=sharedDrift({drifts:[1,3,5,7]});
 try {
  assert.deepEqual(await d.walk(),{outcome:'arrived',at:{x:2400,y:0},rejoins:4});
 } finally { d.dispose(); }
}],
]);

// Sparkbot follow row (live run on 1166d93dc): the follower's return-leader walk went to the spot it
// stood on, and the drain's park held the journey before its first tick consumed the reached
// point. The walk never ended and the follower's travel token kept its targeting off. A journey
// whose goal is where the character stands has arrived, paused or not.
test('a journey to the spot the character stands on ends arrived while the drain parks movement',async()=>{
 const r=fixture();
 r.ports.pauses.drainPark=()=>true;
 const p=r.service.move({map:'main',x:0,y:0});let done=false;p.then(()=>done=true,()=>{});
 // The route was planned before the park: its two walking points are the spot it stands on.
 r.service.install([{map:'main',x:0,y:0},{map:'main',x:0,y:0}],r.service.identity);
 await r.ticks();
 assert.equal(done,true,'the walk ends at once');
 assert.equal(r.service.last().done,true);
 assert.deepEqual(r.calls.filter(c=>c[0]==='move'),[],'no move is sent');
 r.dispose();
});


// A stop the call budget holds stays the owner's unsent decision until the budget lets it go, with
// no cap of its own. A closed connection sends no more call cost, so the decision ends when the
// socket it was decided on disconnects or the game replaces it, through the named bound, and the
// next pass sends nothing for it. Isolated: a live run cannot drop the socket inside one hold.
test('a stop the budget holds ends when its connection closes or its socket is replaced, through its bound',async()=>{
 const {partyHooks}=require('../../runtime/hooks/index.ts');
 const {boundsPending}=require('../../runtime/status/api.ts');
 const fired=()=>boundsPending().filter(f=>f.bound==='unsentDisconnected'&&f.owner==='02').length,before=fired();
 const band=answer=>partyHooks().publish({name:'core:planted-calls',folder:'core',author:'test',summary:'A planted call budget.',hooks:{'calls.band':()=>answer}});
 try{
  for(const close of [r=>{r.host.parent.socket.connected=false;},r=>{r.host.parent.socket={emit(){},connected:true};}]){
   const r=fixture();r.host.parent.socket.connected=true;band('not-now');
   let ended=false;const stopped=r.host.stop('move').then(()=>{ended=true;});
   await r.ticks(2);assert.equal(ended,false,'the stop went while the budget held it');
   close(r);
   await r.ticks(2);await Promise.race([stopped,new Promise(resolve=>setImmediate(resolve))]);assert.equal(ended,true,'the held stop outlived its connection');
   r.dispose();
  }
  assert.equal(fired(),before+2,'the closed connection did not tell the bound record');
 }finally{band('send');}
});

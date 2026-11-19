const assert=require('node:assert/strict');
const {runtime}=require('./fixtures/merchant-rendezvous-scenario.cjs');
// Step 12: the direct leg asks the movement owner as the errand, as the route does, so both
// are smart_move calls; the direct legs follow the recipient (e2e/movement-owner-failures.md
// "Step 12" item 1).
const { scenarioTable } = require('./fixtures/scenarios.cjs');
scenarioTable('a merchant rendezvous reaches a moving recipient and fails on the owner ends, never on a clock', ()=>runtime, [
['smart route hands off early to refreshed direct movement for a kiting recipient', async make => {
 const t=make({tick:(_,p,n)=>{p.y=n*8;}});await t.r.rendezvous('job','F');
 const legs=t.calls.filter(c=>c.kind==='smart');assert.ok(legs.length>1);assert.notEqual(legs[1].y,legs.at(-1).y);
 assert.ok(legs.every(c=>c.request==='errand'),'every leg names the errand');
 assert.equal(t.calls.filter(c=>c.kind==='move').length,0,'no native move outside the owner');
 assert.ok(Math.hypot(t.r.character.x-t.player.x,t.r.character.y-t.player.y)<=180);
 assert.ok(t.calls.some(c=>c.kind==='stop'&&c.type==='smart'));
}],
['walls keep the merchant on navigation rather than issuing unsafe direct moves', async make => {
 const t=make({wall:true});await t.r.rendezvous('job','F');assert.equal(t.calls.filter(c=>c.kind==='move').length,0);
}],
// The try's own end, here the executor's walking stall, climbs the round; no clock restarts it.
['an unresolved path climbs the errand round once per failed try, with no search restarted on a clock', async make => {
 // No count ends the climb, so the bound is one route per stall.
 const t=make({stuck:true,wall:true});let failure;await assert.rejects(t.r.rendezvous('job','F'),error=>(failure=error,/timed out/.test(error.message)));
 assert.equal(t.calls.filter(c=>c.kind==='smart').length,failure.details.recoveries+1,'one route per stall, never a restart loop');assert.equal(t.calls.at(-1).kind,'stop');
}],
['manual cancellation cannot stop a newer movement command', async make => {
 const t=make({tick:r=>{r.lastCommand++;}});await assert.rejects(t.r.rendezvous('job','F'),/interrupted/);
 assert.equal(t.calls.filter(c=>c.kind==='stop').length,0);
}],
['each delivery reacquires a recipient that moved outside transfer range', async make => {
 const t=make();t.player.x=100;await t.r.merchantSendItem('F',1,2);t.player.x=550;await t.r.merchantSendItem('F',2,3);
 assert.equal(t.calls.filter(c=>c.kind==='send').length,2);assert.ok(t.calls.some(c=>c.kind==='smart'&&c.request==='errand'));
 assert.ok(Math.hypot(t.r.character.x-t.player.x,t.r.character.y-t.player.y)<=180);
}],
['unavailable recipients and merchant death fail without indefinite waiting', async make => {
 const t=make({invisible:true,stuck:true});await assert.rejects(t.r.waitForPlayer('F',1000),/timed out/);
 t.r.character.rip=true;await assert.rejects(t.r.rendezvous('job','F'),/Merchant died/);
}],
['anniversary staging explicitly pauses and stops only owned pursuit', async make => {
 const t=make({stuck:true,tick:(r,p,n)=>{if(n===5)r.eventMerchant.anniversaryReserved=()=>true;}});
 await assert.rejects(t.r.rendezvous('job','F'),error=>error.code==='merchant_anniversary_reserved'&&error.details.pauseReason==='merchant_anniversary_reserved');
 assert.equal(t.calls.at(-1).kind,'stop');
}],
// A stall climbs the movement owner's ladder (the route, the other route, the next
// report) and no count ends it; only the pursuit's own bound does. The walking stall that
// ends the direct leg's try climbs it, not a 10 s window of the errand.
['direct movement climbs the owner ladder on the walking stall, past two recoveries, until the pursuit bound', async make => {
 const t=make({stuck:true});t.player.x=500;
 await assert.rejects(t.r.rendezvous('job','F'),error=>/rendezvous timed out$/.test(error.message)&&error.details.recoveries>2);
 const other=t.calls.find(c=>c.kind==='smart'&&c.native===true);
 assert.ok(other,'the other route plans natively');
 assert.ok(other.at<10000,'the stalled try climbs when it ends, at '+other.at+' ms');
 // Step 12: direct legs are owner requests too, so the count of smart_move calls is no longer
 // the route count; every leg names the errand and no native move goes out.
 assert.ok(t.calls.filter(c=>c.kind==='smart').every(c=>c.request==='errand'));
 assert.equal(t.calls.filter(c=>c.kind==='move').length,0);
}],
['fresh target status overrides a visible entity on an obsolete map', async make => {
 const t=make({stuck:true});t.player.x=100;
 t.r.request=async()=>({targetStatus:{map:'winterland',x:20,y:30,seenAt:t.r.Date.now(),server:'USII'}});
 await assert.rejects(t.r.rendezvous('job','F'),/timed out/);
 assert.equal(t.calls.find(c=>c.kind==='smart').map,'winterland');
 assert.equal(t.calls.filter(c=>c.kind==='move').length,0);
}],
// The planner bounds its own search (`movementPlanningMs`, up to 120 s by option), so a
// search past the errand's old 45 s clock finishes on its one route.
['a path calculation longer than 45 s finishes within the planner budget on one route', async make => {
 const t=make({wall:true,tick:(r,p,n)=>{if(n===250)r.smart.found=true;},
  smartMove:r=>{r.smart={moving:true,found:false};return new Promise(()=>{});}});
 await t.r.rendezvous('job','F');
 assert.equal(t.calls.filter(c=>c.kind==='smart').length,1);
 assert.ok(t.r.Date.now()>50000);
}],
// The planner's own budget ends a search, and its error climbs the errand round (`prepare`).
['path calculation ends on the planner budget, whose error climbs the errand round with no restart while it searches', async make => {
 let failure;
 const t=make({stuck:true,wall:true,smartMove:r=>{r.smart={moving:true,found:false};const at=r.Date.now();return new Promise((_,reject)=>{r.planning={at,reject};});},
  tick:r=>{const p=r.planning;if(p&&r.Date.now()-p.at>=60000){r.planning=null;p.reject(Error('Native route planning took longer than 60000 ms'));}}});
 await assert.rejects(t.r.rendezvous('job','F'),error=>(failure=error,/rendezvous timed out$/.test(error.message)));
 const routes=t.calls.filter(c=>c.kind==='smart');
 assert.ok(routes.length>=2,'the planner error climbs to a new route');
 assert.ok(routes[1].at>=60000,'no route restarts while the planner searches');
 assert.ok(failure.details.recoveries>=1);assert.match(failure.details.routeError,/planning/);
}],
['cross-map travel ignores recipient movement then approaches its latest position on arrival', async make => {
 const t=make({invisible:true,stuck:true,tick:(r,p,n)=>{
  p.x+=40;
  if(n===80){r.character.map=p.map;r.character.x=p.x-400;r.smart.found=true;}
  if(n===81)r.get_player=()=>({...p,x:r.character.x+100});
 },smartMove:r=>{r.smart={moving:true,found:false};return new Promise(()=>{});}});
 t.player.map='spookytown';
 await t.r.rendezvous('job','F');
 const routes=t.calls.filter(c=>c.kind==='smart');
 assert.equal(routes.length,2);
 assert.equal(routes[0].map,'spookytown');assert.equal(routes[0].x,undefined);
 assert.equal(routes[1].x,t.player.x-40);
}],
['failed route retains the underlying error in rendezvous diagnostics', async make => {
 const t=make({wall:true,stuck:true,smartMove:()=>Promise.reject({reason:'failed'})});
 await assert.rejects(t.r.rendezvous('job','F'),error=>error.details.routeError==='failed');
}],
['multi-map rendezvous routes locally to doorways and explicitly crosses without tunnel shortcuts', async make => {
 const t=make({invisible:true});t.player.map='spookytown';t.player.x=100;t.player.y=1400;
 t.r.G={maps:{main:{spawns:[[0,0],[1600,-524]],doors:[[1600,-547,60,40,'halloween',1,1]]},
  halloween:{spawns:[[0,0],[1200,100],[784,-1060]],doors:[[784,-1085,80,40,'spookytown',1,2]]},
  spookytown:{spawns:[[0,0],[32,1404]]}}};
 t.r.transport=async(map,spawn)=>{
  t.calls.push({kind:'transport',map,spawn});t.r.character.map=map;
  [t.r.character.x,t.r.character.y]=t.r.G.maps[map].spawns[spawn];
  if(map==='spookytown')t.r.get_player=()=>t.player;
 };
 await t.r.rendezvous('job','F');
 const routes=t.calls.filter(c=>c.kind==='smart');
 assert.equal(routes.length,2);
 assert.equal(routes[0].map,'main');assert.equal(routes[0].x,1600);
 assert.equal(routes[1].map,'halloween');assert.equal(routes[1].y,-1060);
 assert.deepEqual(t.calls.filter(c=>c.kind==='transport').map(c=>c.map),['halloween','spookytown']);
}],
['same-map rendezvous lets an intermediate tunnel shortcut finish without reversing it', async make => {
 const t=make({invisible:true,stuck:true,wall:true,tick:(r,p,n)=>{
  if(n===5){r.character.map='mtunnel';r.character.x=0;r.character.y=8;}
  if(n===30){r.character.map='main';r.character.x=950;r.character.y=0;r.get_player=()=>p;}
 },smartMove:r=>{r.smart={moving:true,found:true};return new Promise(()=>{});}});
 await t.r.rendezvous('job','F');
 assert.equal(t.calls.filter(c=>c.kind==='smart').length,1,'intermediate maps cannot replace the running route');
 assert.equal(t.calls.findIndex(c=>c.kind==='stop'),1,'only arrival cleanup stops the route');
}],
['recipient map change still replaces a running intermediate-map shortcut', async make => {
 const t=make({invisible:true,stuck:true,wall:true,tick:(r,p,n)=>{
  if(n===5){r.character.map='mtunnel';r.character.x=0;r.character.y=8;p.map='winterland';}
  if(n===30){r.character.map='winterland';r.character.x=950;r.character.y=0;r.get_player=()=>p;}
 },smartMove:r=>{r.smart={moving:true,found:true};return new Promise(()=>{});}});
 await t.r.rendezvous('job','F');
 const routes=t.calls.filter(c=>c.kind==='smart');assert.equal(routes.length,2);assert.equal(routes[1].map,'winterland');
}],
// The doorway crossing ends on the game's answer and the map change, bound by the errand's own
// deadline (G), where an 8 s clock ended it before.
['a doorway crossing waits past 8 s for the map change, bound by the errand deadline', async make => {
 const t=make({invisible:true,tick:r=>{const c=r.crossing;if(c&&r.Date.now()-c.at>=9000){r.crossing=null;r.character.map=c.map;[r.character.x,r.character.y]=r.G.maps[c.map].spawns[c.spawn];r.get_player=()=>t.player;}}});
 t.player.map='halloween';t.player.x=1250;t.player.y=100;
 t.r.G={maps:{main:{spawns:[[0,0],[1600,-524]],doors:[[1600,-547,60,40,'halloween',1,1]]},halloween:{spawns:[[0,0],[1200,100]]}}};
 t.r.transport=async(map,spawn)=>{t.calls.push({kind:'transport',map,spawn});t.r.crossing={map,spawn,at:t.r.Date.now()};};
 await t.r.rendezvous('job','F');
 assert.deepEqual(t.calls.filter(c=>c.kind==='transport').map(c=>c.map),['halloween']);
 assert.equal(t.r.character.map,'halloween');
}],
// The target's status is read on each of the merchant's own reports (its measured cadence),
// where a 1 s clock read it before.
['the target status is read once at the start and once per merchant report', async make => {
 const t=make({invisible:true,reportEvery:15,tick:(r,p,n)=>{if(n===60)r.get_player=()=>({...p,x:r.character.x+100});}});
 let reads=0;const read=t.r.request;t.r.request=async(...args)=>{reads++;return read(...args);};
 await t.r.rendezvous('job','F');
 assert.equal(reads,1+t.r.reports);
}],
// merchant-rendezvous.test.cjs (row 22): the native walk ends up to its arrival tolerance short of its
// point. The errand walk takes the transporter point's `reach` as that tolerance (errands.ts,
// door-approach.ts `transporterApproach`), so the walk ends inside the transport's range.
['transporter rendezvous accounts for native walking endpoint tolerance', async make => {
 const {TRANSPORTER_RANGE}=require('../../runtime/movement/geometry/validation.ts'),npc=[0,100],point={map:'winterland',x:0,y:40};
 const t=make({invisible:true,stuck:true,smartMove:(r,destination,options)=>{
  r.character.x=destination.x;r.character.y=destination.y-(options?.arrivalTolerance??20);
  return Promise.resolve();
 }});
 t.r.character.map='winterland';t.player.x=0;
 t.r.G={maps:{winterland:{spawns:[[0,0]],npcs:[{id:'transporter',position:npc}]},main:{spawns:[[0,0]]}},npcs:{transporter:{places:{main:0}}}};
 const inRange=()=>Math.hypot(t.r.character.x-npc[0],t.r.character.y-npc[1])<=TRANSPORTER_RANGE;
 t.r.movement={transporterApproach:()=>({...point,reach:TRANSPORTER_RANGE-Math.hypot(point.x-npc[0],point.y-npc[1])}),transportAllowed:inRange};
 let transported=false;
 t.r.transport=async()=>{assert.ok(inRange());transported=true;t.r.character.map='main';t.r.character.x=0;t.r.character.y=0;t.r.get_player=()=>t.player;};
 await t.r.rendezvous('job','F');
 assert.equal(transported,true);
}],
]);

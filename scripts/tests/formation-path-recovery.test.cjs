const assert=require('node:assert/strict'),test=require('node:test');
require('./fixtures/coordinator-core.cjs');
const {formationRecovery}=require('../../runtime/movement/coordinator/recovery.ts');
const {evaluateGroup}=require('../../runtime/coordinator/targeting/queue.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {identity,recoveryFixture:fixture,blockedCoverageFixture}=require('./fixtures/formation-recovery-scenario.cjs');
const {recoveryClient}=require('./fixtures/formation-recovery-client.cjs');
// The staging goals are the rungs of the owner's progress ladder. Without progress each
// failure moves to the next untried goal, and a spent round lets the queue pick another target;
// a failure that left the mover closer to the target starts the round again, so no count ends it.
scenarioTable("the coordinator's formation recovery pauses, routes, climbs its staging goals, regroups and fails early on blocked coverage (MOV-089)", ()=>({fixture,blockedCoverageFixture,identity}), [
 ['route failures climb the staging goals by progress, with no count, and hold the pause between tries', ({fixture})=>{
 for(const [label,closer,tries,phase] of [['no progress',0,3,'failed'],['progress each try',20,6,'routing']]){
  const f=fixture();f.tick();f.ack();f.tick();
  for(let i=1;i<=tries;i++){
   f.members[1].status.x+=closer;
   Object.assign(f.members[1].status.groupedCombat.formationRecovery,{attempt:i,outcome:'failed',reason:'wall'});
   const failed=f.tick();
   assert.equal(failed.phase,'retry',label+' try '+i);
   // The pause holds until the mover's next report; that report chooses the next goal.
   const next=f.tick();
   if(i<tries)assert.deepEqual([next.phase,next.attempt],['routing',i+1],label+' try '+i);
   else assert.equal(next.phase,phase,label);
  }
  if(phase==='failed')assert.match(f.r.reason,/no untried safe recovery destination/);
 }}],
 // In formation-recovery.ts and formation-recovery-client.ts, each wait of the
 // round ends on its members' reports, never on the 30 s and 500 ms windows (red on each).
 ['a pause acknowledgement is missed once a member reported for two of its intervals without it', ({fixture})=>{
  const f=fixture();for(const m of f.members)m.status.reportIntervalMs=1000;
  f.tick();f.tick(1000);assert.equal(f.r.phase,'pausing','one interval later the acknowledgement may still be on its way');
  f.tick(1500);assert.deepEqual([f.r.phase,f.r.reason],['failed','recovery pause acknowledgement missed']);}],
 ['a closer target revokes the old formation recovery once the members acknowledge', ({fixture,identity})=>{
 const f=fixture();let g=null,now=10000;
 f.members[0].status.groupedCombat.candidates=[f.target];
 for(let i=0;i<10;i++){
  now+=100;for(const m of f.members){m.status.seenAt=now;m.status.groupedCombat.currentAttackersAt=now;
   m.status.groupedCombat.ack=g?.selection;m.status.groupedCombat.queueAck=g?.queueRevision;
   if(g?.formationRecovery)m.status.groupedCombat.formationRecovery={target:identity,at:now,ack:g.formationRecovery.id};}
  g=evaluateGroup(g,f.members,'W',now,0,false,'cgoo');
 }
 assert.equal(g.formationRecovery.phase,'routing');assert.equal(g.committed,false);
 f.members[0].status.groupedCombat.candidates.push({...f.target,id:'closer',x:20});
 g=evaluateGroup(g,f.members,'W',now+100,0,false,'cgoo');assert.equal(g.target.id,'goo');assert.equal(g.committed,false);
 assert.ok(g.pursuit.revoking);
 for(const m of f.members){m.status.seenAt=now+200;m.status.groupedCombat.pursuitAck=g.pursuit.revoking;}
 g=evaluateGroup(g,f.members,'W',now+200,0,false,'cgoo');
 assert.equal(g.target.id,'closer');assert.equal(g.formationRecovery,undefined);
 assert.equal(g.queue[0].id,'closer','the red marker and the selected target switch together');}],
 ["a routing try has no clock: only the mover's report of its route ends it", ({fixture})=>{
  const f=fixture();f.tick();f.ack();f.tick();assert.equal(f.r.phase,'routing');
  f.tick(31000);assert.deepEqual([f.r.phase,f.r.attempt],['routing',1]);}],
 ["the regroup ends once each member's next report still shows the cover", ({fixture})=>{
  const f=fixture();f.tick();f.ack();f.tick();
  Object.assign(f.members[1].status.groupedCombat.formationRecovery,{attempt:1,outcome:'arrived'});
  assert.equal(f.tick().phase,'regrouping');
  assert.equal(f.tick().phase,'regrouping','the cover seen on this report waits for the next');
  assert.equal(f.tick(),undefined,'the next reports confirm it');}],
 ['early coverage failure fails only the current try, and never on an expired follower report', ({blockedCoverageFixture})=>{
 const f=blockedCoverageFixture();const before=f.r;const r=f.tick();
 assert.equal(r.phase,'retry');assert.equal(r.attempt,1);assert.equal(r.id,before.id);
 assert.match(r.reason,/follower.*unreachable/);
 assert.equal(r.failedGoals.length,1);
 for(const at of [0,10000,100000]){const f=blockedCoverageFixture();f.members[0].status.groupedCombat.formationRecovery.at=at;
  const r=formationRecovery({formationRecovery:f.r},f.members,f.target,'key',f.now+100,false,160,f.r.target);assert.equal(r.phase,'routing');}}],
 ['recovery fails closed on pending attacks, aggro, stale observations, travel, cancellation and changed identity', ({fixture,identity})=>{
 for(const mutate of [f=>f.members[0].cancelled=true,f=>f.members[0].status.groupedCombat.evidence=[{state:'pending'}],
  f=>f.members[0].status.groupedCombat.currentAttackers=[{id:'other'}],f=>f.members[0].status.groupedCombat.travelCommand={id:1},
  f=>f.members[0].status.rip=true,f=>f.members[0].status.map='main',f=>f.target.state='engaged']){
  const f=fixture();f.tick();f.ack();mutate(f);assert.equal(f.tick(),undefined);
 }
 const f=fixture();f.tick();f.ack();f.members[0].status.seenAt=0;
 assert.equal(formationRecovery({formationRecovery:f.r},f.members,f.target,'key',f.now,false,160,identity),undefined);}],
 ['a late failure from a different recovery id cannot settle the current route', ({fixture})=>{
 const f=fixture();f.tick();f.ack();f.tick();
 Object.assign(f.members[1].status.groupedCombat.formationRecovery,{ack:'old',attempt:1,outcome:'failed'});
 assert.equal(f.tick().phase,'routing');}],
 ['failed destinations are not repeated and refreshed alternatives are used', ({fixture})=>{
 const f=fixture();f.tick();f.ack();f.tick();const original=f.r.goal;
 Object.assign(f.members[1].status.groupedCombat.formationRecovery,{attempt:1,outcome:'failed',reason:'path_not_found'});
 f.tick();Object.assign(f.members[1].status.groupedCombat.formationRecovery,{goals:[original,{x:400,y:80}]});
 f.tick(5000);assert.deepEqual(f.r.goal,{x:400,y:80});
 Object.assign(f.members[1].status.groupedCombat.formationRecovery,{attempt:2,outcome:'failed',goals:[original,{x:400,y:80}]});
 f.tick();assert.equal(f.tick(15000).phase,'failed');assert.match(f.r.reason,/untried/);}],
 ["the safe approach handoff needs every member's matching readiness on the current try, not visibility alone", ({fixture})=>{
 const f=fixture();f.tick();f.ack();f.tick();
 const ready=(m,at)=>Object.assign(m.status.groupedCombat.formationRecovery,{attempt:at,approachReady:true});
 for(const m of f.members)ready(m,0);
 assert.equal(f.tick().phase,'routing','readiness from another try does not count');
 for(const m of f.members)ready(m,1);
 f.members[0].status.groupedCombat.formationRecovery.approachReady=false;
 assert.equal(f.tick().phase,'routing','one member not ready keeps the recovery');
 f.members[0].status.groupedCombat.formationRecovery.approachReady=true;
 assert.equal(f.tick(),undefined);
 assert.equal(f.tick(),undefined,'old acknowledged reports cannot restart the recovery');}],
 ['priest recovery pauses all members before routing, permits separation, then waits for stable coverage', ({fixture})=>{
 const f=fixture();assert.equal(f.tick().phase,'pausing');assert.equal(f.tick().phase,'pausing');
 f.ack();assert.equal(f.tick().phase,'routing');
 f.members[1].status.x=300;assert.equal(f.tick().phase,'routing');
 Object.assign(f.members[1].status.groupedCombat.formationRecovery,{attempt:1,outcome:'arrived'});
 assert.equal(f.tick().phase,'regrouping');assert.equal(f.tick(1000).phase,'regrouping');
 for(const m of f.members)m.status.x=300;
 assert.equal(f.tick().phase,'regrouping');assert.equal(f.tick(500),undefined);}],
 ['early coverage failure never preserves recovery over fresh combat or changed ownership', ({blockedCoverageFixture,identity})=>{
 for(const mutate of [
  f=>f.target.state='engaged',
  f=>f.target.state='pending',
  f=>f.members[0].status.groupedCombat.currentAttackers=[{id:'aggro'}],
  f=>f.members[0].status.groupedCombat.evidence=[{state:'pending'}],
  f=>f.members[0].status.groupedCombat.travelCommand={id:123},
  f=>f.members[0].cancelled=true,
 ]){const f=blockedCoverageFixture();mutate(f);assert.equal(f.tick(),undefined);}
 const f=blockedCoverageFixture();f.members[0].status.groupedCombat.currentAttackersAt=0;
 assert.equal(formationRecovery({formationRecovery:f.r},f.members,f.target,'key',f.now+100,false,160,identity),undefined);}],
 ['early coverage failure preserves native progress, older clients and unfinished searches', ({blockedCoverageFixture})=>{
 for(const mutate of [
  f=>delete f.members[1].status.groupedCombat.formationRecovery.coverageBlocked,
  f=>delete f.members[0].status.groupedCombat.formationRecovery.followerRoute,
  f=>f.members[0].status.groupedCombat.formationRecovery.followerRoute='planning',
  f=>f.members[0].status.groupedCombat.formationRecovery.followerRoute='routing',
  f=>f.members[1].status.moving=true,
  f=>f.members[0].status.moving=true,
  f=>f.members[2].status.moving=true,
  f=>f.members[1].status.groupedCombat.formationRecovery.approachReady=true,
  f=>f.members[0].status.groupedCombat.formationRecovery.attempt=2,
  f=>f.members[2].status.groupedCombat.formationRecovery.ack='retired',
  f=>f.members[0].status.groupedCombat.formationRecovery.target='foreign',
 ]){const f=blockedCoverageFixture();mutate(f);assert.equal(f.tick().phase,'routing');}}],
 ['an older or not-yet-certified third follower cannot prompt early coverage failure', ({blockedCoverageFixture})=>{
 const f=blockedCoverageFixture();delete f.members[2].status.groupedCombat.formationRecovery.followerRoute;
 assert.equal(f.tick().phase,'routing');}],
]);
scenarioTable("the recovery client walks the mover's route and certifies follower points", ()=>recoveryClient, [
 ['a cached role terminal is discarded when actual healer coverage changes', client=>{
 let covered=true;const c=client({segmentClear:()=>true,endpointSafe:()=>true,followGoals:()=>[{x:120,y:0}],followTerminalValid:()=>covered});
 assert.ok(c.api.followPoint({x:240,y:0}));covered=false;assert.equal(c.api.followPoint({x:240,y:0}),undefined);}],
 ['bounded follower search reports unreachable under its exact control and clears on replacement', client=>{
 const c=client({segmentClear:()=>false,endpointSafe:()=>false});c.control.mover='W';c.api.accept(c.control);
 assert.equal(c.api.followPoint({x:80,y:0}),undefined);assert.equal(c.api.report().followerRoute,'unreachable');
 c.api.accept({...c.control,attempt:2});assert.equal(c.api.report().followerRoute,undefined);
 c.api.stop();assert.equal(c.api.report(),undefined);}],
 ['cached follower terminal loses ownership when dynamic endpoint certification becomes unsafe', client=>{
 let safe=true;const c=client({segmentClear:()=>true,endpointSafe:()=>safe});
 assert.ok(c.api.followPoint({x:80,y:0}));safe=false;
 assert.equal(c.api.followPoint({x:80,y:0}),undefined);assert.equal(c.self.x,0);}],
 ['certified alternate recovery goal is reached when the preferred endpoint is unreachable', async client=>{
 const alternative={x:80,y:0},blocked={x:240,y:0};
 const c=client({segmentClear:(a,b)=>b.x!==blocked.x,safe:()=>true});
 c.control.goal=blocked;c.control.goals=[blocked,alternative];c.api.accept(c.control);
 for(let i=0;i<10&&c.journey.driver;i++){c.journey.driver.tick();await new Promise(setImmediate);}
 assert.equal(c.api.report().outcome,'arrived');assert.deepEqual({x:c.self.x,y:c.self.y},alternative);assert.equal(c.starts,1);}],
 ['certified role terminal may stay outside follow forty while inside the existing healing envelope', client=>{
 const goal={x:240,y:0},terminal={x:120,y:0};
 const c=client({segmentClear:()=>true,endpointSafe:()=>true,followGoals:()=>[terminal],followTerminalValid:(point,mover)=>Math.hypot(point.x-mover.x,point.y-mover.y)<=187});
 const point=c.api.followPoint(goal);assert.deepEqual(point,terminal);assert.ok(Math.hypot(point.x-goal.x,point.y-goal.y)>40);}],
 ['completed safe follow terminal replans when a small leader drift leaves it outside forty pixels', async client=>{
 const monster={x:-597,y:-184},gap=p=>Math.hypot(Math.max(Math.abs(p.x-monster.x)-29,0),Math.max(Math.abs(p.y-monster.y)-34,0));
 const clear=(a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((monster.x-a.x)*dx+(monster.y-a.y)*dy)/length)):0;
  return gap({x:a.x+dx*t,y:a.y+dy*t})>=Math.min(gap(a),193)-0.01;};
 const c=client({segmentClear:clear,endpointSafe:p=>gap(p)>193});Object.assign(c.self,{x:-344.13,y:-437.24});
 let point;for(let i=0;i<300&&!point;i++){point=c.api.followPoint({x:-427,y:-334});await new Promise(setImmediate);}
 assert.ok(point);Object.assign(c.self,point);assert.equal(c.api.followPoint({x:-427,y:-334}),undefined);
 const shifted={x:-442,y:-319};assert.ok(Math.hypot(c.self.x-shifted.x,c.self.y-shifted.y)>40);
 let next;for(let i=0;i<300&&!next;i++){next=c.api.followPoint(shifted);await new Promise(setImmediate);}
 assert.ok(next,'A completed terminal outside current follow40 must not leave the follower stuck');
 assert.ok(clear(c.self,next));assert.ok(gap(next)>193);assert.ok(Math.hypot(next.x-shifted.x,next.y-shifted.y)<=40);}],
 ['coverage-blocked report is specific to the actual owned mover gate and clears when coverage resumes', client=>{
 let covered=false;const c=client({coveredStep:()=>covered,segmentClear:()=>true,stepSize:12});c.api.accept(c.control);
 c.journey.driver.tick();c.journey.driver.tick();assert.equal(c.api.report().coverageBlocked,true);assert.equal(c.self.moving,false);
 covered=true;c.journey.driver.tick();assert.equal(c.api.report().coverageBlocked,false);}],
 ['native recovery keeps one route across multiple corners and permits movement away from the target', async client=>{
 const wall=(a,b)=>!((a.x<100&&b.x>=100||b.x<100&&a.x>=100)&&a.y+(b.y-a.y)*(100-a.x)/(b.x-a.x)<200);
 let c;c=client({segmentClear:wall,safe:p=>wall(c.self,p),stepSize:12});c.api.accept(c.control);assert.equal(c.starts,1);
 let farthest=0,headings=new Set();
 for(let i=0;i<400&&c.journey.driver;i++){
  const before={...c.self};c.journey.driver.tick();
  if(c.self.x!==before.x||c.self.y!==before.y)headings.add(Math.round(Math.atan2(c.self.y-before.y,c.self.x-before.x)*10));
  farthest=Math.max(farthest,Math.hypot(c.self.x-240,c.self.y));
  for(let j=0;j<3;j++)c.api.tick();await new Promise(setImmediate);
 }
 assert.ok(farthest>240,'the route moves away from the target to get around the wall');assert.ok(headings.size>1,'the route turns at corners');
 assert.equal(c.api.report().outcome,'arrived');assert.equal(c.journey.driver,null);assert.equal(c.starts,1);}],
 ['pending follower search is planning rather than an unreachable report', client=>{
 const c=client({segmentClear:()=>true});c.control.mover='W';c.api.accept(c.control);let clock=0;
 const mock=test.mock.method(performance,'now',()=>clock+=5);
 try{assert.equal(c.api.followPoint({x:80,y:0}),undefined);assert.equal(c.api.report().followerRoute,'planning');}
 finally{mock.mock.restore();}}],
 ['proposal survives periodic ticks until coordinator authorization', client=>{
 const c=client();c.api.propose(identity,[{x:240,y:0}]);c.api.tick();assert.equal(c.api.report().goals.length,1);assert.equal(c.starts,0);}],
 ['recovery followers issue no waypoint when the entire follow region is unsafe', client=>{
 const c=client({segmentClear:()=>false,endpointSafe:()=>false});
 for(let i=0;i<3;i++)assert.equal(c.api.followPoint({x:80,y:0}),undefined);
 assert.deepEqual({x:c.self.x,y:c.self.y},{x:0,y:0});assert.equal(c.starts,0);}],
 ['recovery followers move while attacks remain paused; route segments wait for coverage', client=>{
 let follows=0,covered=false;const c=client({stepSize:12,coveredStep:()=>covered,follow:()=>follows++});
 c.api.accept(c.control);c.journey.driver.tick();c.journey.driver.tick();c.journey.driver.tick();assert.equal(c.self.x,0);
 covered=true;c.journey.driver.tick();assert.equal(c.self.x,12,'long native segment is split before movement');
 c.api.accept({...c.control,mover:'W'});assert.equal(c.api.movement(),true);assert.equal(follows,1);assert.equal(c.api.blocks(),true);}],
 ['recovery followers stop safely within forty pixels when the leader point is inside monster clearance', async client=>{
 const leader={x:-427,y:-334},monster={x:-597,y:-184},width=27,height=34;
 const gap=p=>Math.hypot(Math.max(Math.abs(p.x-monster.x)-(width+31)/2,0),Math.max(Math.abs(p.y-monster.y)-height,0));
 for(const [origin,safety] of [[{x:-285.34,y:-508.24},191],[{x:-344.13,y:-437.24},193]]){
  const clear=(a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
   const t=length?Math.max(0,Math.min(1,((monster.x-a.x)*dx+(monster.y-a.y)*dy)/length)):0;
   return gap({x:a.x+dx*t,y:a.y+dy*t})>=Math.min(gap(a),safety)-0.01;};
  assert.ok(gap(leader)<safety,'Captured native leader endpoint is unsafe for the follower');
  const c=client({segmentClear:clear,endpointSafe:p=>gap(p)>safety});Object.assign(c.self,origin);
  let point;for(let i=0;i<300&&!point;i++){point=c.api.followPoint(leader);await new Promise(setImmediate);}
  assert.ok(point,'A certified safe follow terminal point must be found');assert.ok(clear(origin,point));
  assert.ok(gap(point)>safety);assert.ok(Math.hypot(point.x-leader.x,point.y-leader.y)<=40);
 }}],
 ['recovery planner and follower route around the same blocked segment without native failed-path retries', async client=>{
 const clear=(a,b)=>!((a.x<100&&b.x>=100||b.x<100&&a.x>=100) && a.y+(b.y-a.y)*(100-a.x)/(b.x-a.x)<60);
 let c;c=client({segmentClear:clear,safe:p=>clear(c.self,p),stepSize:12,plan(){throw Error('terrain-only planner used');}});
 c.api.accept(c.control);
 for(let i=0;i<150&&c.journey.driver;i++){
  const previous={...c.self};c.journey.driver.tick();assert.ok(clear(previous,c.self));await Promise.resolve();
 }
 assert.equal(c.api.report().outcome,'arrived');assert.equal(c.starts,1);
 c.self.x=0;c.self.y=0;
 let highest=0,clock=0;
 const previous={...c.self};
 const exhausted=test.mock.method(performance,'now',()=>clock+=5);
 try{assert.equal(c.api.followPoint({x:240,y:0}),undefined);assert.deepEqual(c.self,previous);}
 finally{exhausted.mock.restore();}
 for(let i=0;i<150&&c.self.x<240;i++){
  const point=c.api.followPoint({x:240,y:0});
  if(!point){await new Promise(setImmediate);continue;}
  assert.ok(clear(c.self,point));
  c.self.x=point.x;c.self.y=point.y;highest=Math.max(highest,point.y);
 }
 assert.ok(highest>=60,'follower takes the opening instead of waiting at the wall');assert.ok(Math.hypot(c.self.x-240,c.self.y)<=40,'follower ends inside the follow ring');}],
 ['role terminal callbacks cannot waive the independent live enemy endpoint certificate', client=>{
 const c=client({segmentClear:()=>true,endpointSafe:()=>false,followGoals:()=>[{x:120,y:0}],followTerminalValid:()=>true});
 assert.equal(c.api.followPoint({x:240,y:0}),undefined);}],
 ['role terminals outside current healing coverage cannot authorize a follower waypoint', client=>{
 const c=client({segmentClear:()=>true,endpointSafe:()=>true,followGoals:()=>[{x:0,y:0}],followTerminalValid:()=>false});
 assert.equal(c.api.followPoint({x:80,y:0}),undefined);assert.equal(c.self.x,0);}],
 ['route release clears owned movement and ignores its delayed failure', async client=>{
 let reject,releases=0;const c=client({start:()=>new Promise((_,r)=>reject=r),release:()=>releases++});
 c.api.accept(c.control);c.api.accept(undefined);reject({reason:'path_not_found'});await new Promise(setImmediate);
 assert.equal(releases,1);assert.equal(c.api.blocks(),false);assert.equal(c.api.report(),undefined);assert.equal(c.journey.driver,null);}],
 ['structured path errors remain readable and cannot poison the next attempt', async client=>{
 const c=client({start:()=>Promise.reject({reason:'path_not_found'})});c.api.accept(c.control);await new Promise(setImmediate);
 assert.equal(c.api.report().reason,'path_not_found');
 c.api.accept({...c.control,phase:'retry',attempt:2});assert.equal(c.api.report().outcome,undefined);}],
 ['a map shortcut fails the route and a newly unsafe segment replans, neither walking', client=>{
 for(const kind of ['unsafe','map']){
  const c=client();c.api.accept(c.control);c.journey.driver.tick();
  if(kind==='unsafe')c.unsafe();if(kind==='map')c.smart.plot[0].town=true;
  c.journey.driver.tick();assert.equal(c.self.x,0);
  if(kind==='map'){assert.equal(c.api.report().outcome,'failed');assert.equal(c.journey.driver,null);}
  else{assert.equal(c.api.report().outcome,undefined);assert.equal(c.smart.found,false);assert.ok(c.journey.driver);}
 }}],
]);

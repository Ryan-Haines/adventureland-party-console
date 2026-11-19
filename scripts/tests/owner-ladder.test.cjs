// Isolated tests for steps 3 and 8a of the movement owner migration. Failure lists first,
// in e2e/movement-owner-failures.md "Isolated: the death goal and the ladder" and "Step 8a"
// items 3 and 4. Map data is typed by hand from the game's design/maps.js. Step 8a runs the
// step 3 survival ladder cases on the one owner ladder (runtime/protocol/ladder.ts).
const assert=require('node:assert/strict');
const {deathGoal,townGoal,isSafeAt,ARRIVAL_TOLERANCE}=require('../../runtime/movement/rules.ts');
const {PROGRESS_DISTANCE}=require('../../runtime/protocol/ladder.ts');


const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {clock,createSurvivalLadder,mainSpawns,maps,rejoin}=require('./fixtures/owner-ladder-scenario.cjs');
scenarioTable('the safe table gives each death map its goal and each map its Town landing (MOV-206)', ()=>undefined, [
 // Failures 1 to 5 read the same deathGoal, one assertion each.
 ['failures 1 to 5: a death regroups at Main\'s on_death spawn, with a radius that covers its scatter', ()=>{
  // 1: a map without on_death regroups at Main's own respawn point.
  assert.deepEqual(deathGoal(maps,'halloween'),{goal:'death',map:'main',x:-87,y:673,spawn:5,radius:ARRIVAL_TOLERANCE});
  assert.deepEqual(deathGoal(maps,undefined),deathGoal(maps,'halloween'));
  // 2: a Main on_death on the death map is used (the Arena, spawn 7).
  assert.deepEqual(deathGoal(maps,'arena'),{goal:'death',map:'main',x:294,y:498,spawn:7,radius:ARRIVAL_TOLERANCE});
  // A respawn point off Main gives way to Main's own.
  assert.equal(deathGoal(maps,'crypt').spawn,5);
  assert.equal(deathGoal(maps,'spider_instance').spawn,5);
  // 4: with no on_death anywhere the goal is Main spawn 0.
  const bare={main:{spawns:mainSpawns}};
  assert.deepEqual({x:deathGoal(bare,'halloween').x,y:deathGoal(bare,'halloween').y,spawn:deathGoal(bare,'halloween').spawn},{x:0,y:0,spawn:0});
  // 5: spawn 0 has size 100, so the server scatters by up to 50 on each axis.
  assert.equal(deathGoal(bare,'x').radius,Math.hypot(50,50));
  assert.equal(deathGoal(maps,'arena').radius,ARRIVAL_TOLERANCE);
 }],
 ['failure 6: isSafeAt checks map, instance and radius', ()=>{
  const goal=deathGoal(maps,'arena');
  assert.equal(isSafeAt(goal,{map:'main',x:294+ARRIVAL_TOLERANCE,y:498}),true);
  assert.equal(isSafeAt(goal,{map:'main',x:294+ARRIVAL_TOLERANCE+0.01,y:498}),false);
  assert.equal(isSafeAt(goal,{map:'arena',x:294,y:498}),false);
  assert.equal(isSafeAt(goal,{map:'main',in:'instance-1',x:294,y:498}),false);
 }],
 // Step 4: e2e/movement-owner-failures.md "Isolated: step 4 rule and goal changes".
 ['step 4 failure 5: Town lands on spawn 0 of the map, scattered by its size', ()=>{
  // Main spawn 0 is (0, 0) with size 100, so each axis scatters by up to 50.
  assert.deepEqual(townGoal(maps,'main'),{goal:'town',map:'main',x:0,y:0,spawn:0,radius:Math.hypot(50,50)});
  assert.deepEqual(townGoal(maps,'arena'),{goal:'town',map:'arena',x:151.6,y:40.82,spawn:0,radius:ARRIVAL_TOLERANCE});
  const goal=townGoal(maps,'main');
  assert.equal(isSafeAt(goal,{map:'main',x:50,y:50}),true);
  assert.equal(isSafeAt(goal,{map:'main',x:50,y:51}),false);
  assert.equal(isSafeAt(goal,{map:'arena',x:0,y:0}),false);
 }],
 ['step 4 failure 6: a map without spawns or game data without Main has no Town goal', ()=>{
  assert.equal(townGoal({main:{spawns:mainSpawns},bare:{spawns:[]}},'bare'),null);
  assert.equal(townGoal({arena:maps.arena},'main'),null);
  assert.equal(townGoal(maps,'nowhere'),null);
 }],
]);

const at=(map,x,y)=>({map,x,y});
const route=(transitions,walking)=>({transitions,walking});
scenarioTable('the survival ladder climbs by progress, changes strategy and never ends on a count (MOV-203)', ()=>undefined, [
 ['failure 7: a failure that gets no closer moves one step on', ()=>{
  const ladder=createSurvivalLadder({maps});
  assert.equal(ladder.next(at('arena',300,-300),{townAllowed:true}).rung,'replan');
  assert.equal(ladder.result({arrived:false,at:at('arena',300,-300),planned:route(1,400),remaining:route(1,400)}),'failed');
  assert.equal(ladder.next(at('arena',300,-300),{townAllowed:true}).rung,'other-route');
 }],
 ['failure 8: getting closer or reaching a new map returns to the first step', ()=>{
  // Each kind of getting closer starts one failure up the ladder, so its return to the first step shows.
  const climbed=()=>{const ladder=createSurvivalLadder({maps});
    ladder.next(at('arena',300,-300),{townAllowed:true});
    ladder.result({arrived:false,at:at('arena',300,-300),planned:route(1,400),remaining:route(1,400)});
    assert.equal(ladder.next(at('arena',300,-300),{townAllowed:true}).rung,'other-route');
    return ladder;};
  for(const [kind,outcome] of [
    // Exactly PROGRESS_DISTANCE units counts (failure 9 holds one unit fewer).
    [PROGRESS_DISTANCE+' units less walking',{arrived:false,at:at('arena',300,-300+PROGRESS_DISTANCE),planned:route(1,400),remaining:route(1,400-PROGRESS_DISTANCE)}],
    ['a transition fewer',{arrived:false,at:at('arena',300,-300),planned:route(1,400),remaining:route(0,600)}],
    ['a map not visited yet',{arrived:false,at:at('main',232,397)}],
  ]){
    const ladder=climbed();
    assert.equal(ladder.result(outcome),'progress',kind);
    assert.equal(ladder.report().failures,0,kind+': the failures since the last progress');
    assert.equal(ladder.next(outcome.at,{townAllowed:true}).rung,'replan',kind+': the first step');
  }
 }],
 ['failure 9: drifting without getting closer is not progress', ()=>{
  const ladder=createSurvivalLadder({maps});
  ladder.next(at('arena',300,-300),{townAllowed:true});
  ladder.result({arrived:false,at:at('arena',300,-300),planned:route(1,400),remaining:route(1,300)});
  // Back and forth: a new plan from a point farther away, then one unit short of PROGRESS_DISTANCE.
  const short=PROGRESS_DISTANCE-1;
  ladder.next(at('arena',300,-400),{townAllowed:true});
  assert.equal(ladder.result({arrived:false,at:at('arena',300,-400+short),planned:route(1,500),remaining:route(1,500-short)}),'failed');
  ladder.next(at('arena',300,-400+short),{townAllowed:true});
  assert.equal(ladder.result({arrived:false,at:at('arena',300,-300),planned:route(1,300),remaining:route(1,300-short)}),'failed',short+' units is not '+PROGRESS_DISTANCE);
  // A map seen before in this walk is not new.
  const back=createSurvivalLadder({maps});
  back.next(at('arena',0,0),{townAllowed:true});back.result({arrived:false,at:at('main',232,397)});
  back.next(at('main',232,397),{townAllowed:true});
  assert.equal(back.result({arrived:false,at:at('arena',150,40)}),'failed');
 }],
 ['failure 11: no Town while Town is not allowed, and no relocation where the map has none', ()=>{
  const steps=town=>{
    const ladder=createSurvivalLadder({maps}),seen=[];
    for(let i=0;i<7;i++){const next=ladder.next(at('arena',300,-300),{townAllowed:town});seen.push([next.rung,next.options.relocation??null,next.options.town??null]);
      if(next.rung==='wait')ladder.waited();else ladder.result({arrived:false,at:at('arena',300,-300)});}
    return seen;
  };
  assert.ok(steps(true).some(([step,relocation])=>step==='relocate'&&relocation==='town'));
  for(const [step,relocation,town] of steps(false)){
    assert.notEqual(relocation,'town',step);
    if(step!=='wait')assert.equal(town,false,step);
  }
  // A map with no spawn far enough and no ordinary door has nothing to relocate to.
  const ladder=createSurvivalLadder({maps:{...maps,closed:{spawns:[[0,0]],doors:[]}}}),seen=[];
  for(let i=0;i<7;i++){const next=ladder.next(at('closed',10,10),{townAllowed:true});seen.push(next.rung);
    if(next.rung==='wait')ladder.waited();else ladder.result({arrived:false,at:at('closed',10,10)});}
  assert.ok(!seen.includes('relocate')&&!seen.includes('relocate-other'),seen.join());
 }],
 ['failure 12: a relocation is followed by a walk to the goal', ()=>{
  const ladder=createSurvivalLadder({maps});
  let previous;
  for(let i=0;i<7;i++){
    const next=ladder.next(at('arena',300,-300),{townAllowed:true});
    if(previous?.startsWith('relocate'))assert.equal(next.rung,'replan',`after ${previous}`);
    previous=next.rung;
    if(next.rung==='wait')ladder.waited();else ladder.result({arrived:false,at:at('arena',300,-300)});
  }
 }],
 // Failure 10 and step 8a item 4: no count or time ends the ladder or moves its progress time.
 ['step 8a failure 4: no number of failures ends the ladder, and progressAt moves only on progress', ()=>{
  clock.now=1000;
  const ladder=createSurvivalLadder({maps});
  assert.equal(ladder.report().progressAt,1000);
  const rungs=[];
  for(let i=0;i<50;i++){
    clock.now+=500;
    const next=ladder.next(at('arena',300,-300),{townAllowed:true});rungs.push(next.rung);
    if(next.rung==='wait')ladder.waited();else ladder.result({arrived:false,at:at('arena',300,-300),planned:route(1,400),remaining:route(1,400)});
  }
  assert.equal(rungs.length,50);
  // One round is seven rungs ending in a wait; the 50 rungs repeat it seven times and start an eighth.
  const round=['replan','other-route','relocate','replan','relocate-other','replan','wait'];
  assert.deepEqual(rungs,Array.from({length:50},(_,i)=>round[i%7]),'the survival round changed its rung order');
  const stuck=ladder.report();
  assert.equal(stuck.rounds,7,'the rounds the 50 rungs completed');
  assert.equal(stuck.progressAt,1000,'failures and waits do not move progressAt');
  assert.equal(stuck.failures,43,'the 50 rungs less the seven waits');
  assert.ok(stuck.trying);
  clock.now+=500;
  ladder.next(at('arena',300,-300),{townAllowed:true});
  assert.equal(ladder.result({arrived:false,at:at('main',232,397)}),'progress');
  assert.equal(ladder.report().progressAt,clock.now);
  assert.equal(ladder.report().failures,0);
  // Arriving counts as progress too.
  clock.now+=500;
  ladder.next(at('main',232,397),{townAllowed:true});
  assert.equal(ladder.result({arrived:true,at:at('main',-87,673)}),'arrived');
  assert.equal(ladder.report().progressAt,clock.now);
 }],
 // Step 8c item 24 (intent audit item 2): the other-route rung follows a rung that made no
 // progress, which is the evidence a planner switch needs. It plans natively, so a native
 // route that failed stays native, and it turns Town off, never on.
 ['step 8c: the other route plans natively after either planner and never turns Town on', ()=>{
  for(const engine of ['alclient','native']){
    const ladder=createSurvivalLadder({maps}),at={map:'arena',in:'arena',x:300,y:-300};
    ladder.next(at,{townAllowed:true});ladder.result({arrived:false,at,engine});
    const other=ladder.next(at,{townAllowed:true});
    assert.equal(other.rung,'other-route');assert.deepEqual(other.options,{native:true,town:false,avoidLeave:true});
  }
 }],
]);


const fail=(ladder,at,planned,remaining)=>ladder.result({arrived:false,at,planned,remaining});
scenarioTable('the rejoin, task walk and coordinator walk rounds run on the same ladder (MOV-203)', ()=>undefined, [
 // Step 8a item 3: the rejoin round shares the survival ladder's progress test, and a rung that
 // walks away on purpose counts only a new map.
 ['step 8a failure 3: the rejoin round runs on the same ladder and the same progress test', ()=>{
  const ladder=rejoin(false),seen=[];
  for(let i=0;i<5;i++){const next=ladder.next(at('main',0,0));seen.push(next.rung);
    if(next.rung==='wait')ladder.waited();else fail(ladder,at('main',0,0),route(2,900),route(2,900));}
  assert.deepEqual(seen,['rejoin','lone-walk','relocate','lone-walk','wait']);
  assert.match(ladder.next(at('main',0,0)).trying,/rejoining the event with the party/);
  // 10 units closer is progress for a walk toward the event, as for the walk home.
  fail(ladder,at('main',0,0),route(2,900),route(2,900));
  ladder.next(at('main',0,0));
  assert.equal(fail(ladder,at('main',0,10),route(2,900),route(2,890)),'progress');
  assert.equal(ladder.next(at('main',0,10)).rung,'rejoin');
  // A join event's round is the join and the wait.
  const join=rejoin(true),joins=[];
  for(let i=0;i<4;i++){const next=join.next(at('main',0,0));joins.push(next.rung);if(next.rung==='wait')join.waited();else fail(join,at('main',0,0));}
  assert.deepEqual(joins,['rejoin','wait','rejoin','wait']);
  // On the relocation, getting closer is not progress; reaching a new map is.
  const away=rejoin(false);
  away.next(at('main',0,0));fail(away,at('main',0,0),route(2,900),route(2,900));
  away.next(at('main',0,0));fail(away,at('main',0,0),route(2,900),route(2,900));
  assert.equal(away.next(at('main',0,0)).rung,'relocate');
  assert.equal(fail(away,at('main',0,0),route(2,900),route(1,10)),'failed');
  away.next(at('main',0,0));
  assert.equal(fail(away,at('main',0,0),route(2,900),route(2,900)),'failed');
  assert.equal(away.next(at('main',0,0)).rung,'wait');away.waited();
  away.next(at('main',0,0));fail(away,at('main',0,0));away.next(at('main',0,0));fail(away,at('main',0,0));
  assert.equal(away.next(at('main',0,0)).rung,'relocate');
  assert.equal(fail(away,at('halloween',8,630)),'progress');
 }],
 // Step 8c item 15 (design § 5.2): the coordinator walk's round, climbed by climbWalk on the
 // convoy's own state. The live walk ladder row reaches its first three rungs; the rest of the
 // round, its resets and the drift rule need a group that can be placed at will.
 ['step 8c item 15: the walk round climbs to its safe point and the next report, starts over on progress, and drift is no failure', ()=>{
  const {climbWalk,walkRound,walkWaited}=require('../../runtime/protocol/ladder.ts');
  const {readinessFailure,recoveryPlanner}=require('../../runtime/movement/coordinator/route-store.ts');
  const goal={map:'main',x:2600,y:0},safe={map:'main',x:0,y:0},leader=at('main',500,0),left={transitions:0,walking:2100};
  const walk={},seen=[];
  for(let i=0;i<12;i++){const a=climbWalk(walk,walkRound(safe),leader,left,1000+i);seen.push(a.rung);if(a.rung==='wait')walkWaited(walk,walkRound(safe),1000+i);}
  // No count ends the climb. After the wait the round starts over: its first rung, the re-plan,
  // runs with the walk the coordinator begins on that report (shared-navigation.ts), so the
  // next failure climbs to the other route.
  assert.deepEqual(seen,['replan','other-route','rebuild','safe-point','wait','other-route','rebuild','safe-point','wait','other-route','rebuild','safe-point']);
  assert.equal(walk.ladder.rounds,2);assert.equal(walk.ladderTrying,'walking to the safe point to start again');
  // A walk standing at its safe point, or with none, skips that rung.
  const at_safe={},skipped=[];
  for(let i=0;i<4;i++)skipped.push(climbWalk(at_safe,walkRound(safe),at('main',10,0),left,1000+i).rung);
  assert.deepEqual(skipped,['replan','other-route','rebuild','wait']);
  // Getting closer, here 10 units, starts the round again.
  const closer={};
  for(const remaining of [left,left,{transitions:0,walking:2090}])climbWalk(closer,walkRound(safe),leader,remaining,1000);
  assert.deepEqual([closer.ladderRung,closer.ladder.failures],['replan',0]);
  // A member that drifted while the route was prepared prepares again and does not climb.
  for(const phase of ['shared-prepare','travel'])assert.equal(readinessFailure({phase},'Route origin changed before departure'),true,phase);
  assert.equal(readinessFailure({phase:'travel'},'Path not found: native'),false,'a route failure climbs');
  // The planner switches on the failure's cause, never on a count of stalls: two stalls with
  // progress between them keep the walk's planner, and a cause naming the route switches it.
  const stalled={};
  for(const reason of ['F: Stalled walking movement (moving without progress across two reports)','F: Stalled walking movement (stopped short after its step was sent again)'])
   recoveryPlanner(stalled,reason);
  assert.equal(stalled.nativeFallback,false);
  recoveryPlanner(stalled,'F: Path not found: shared');assert.equal(stalled.nativeFallback,true);
 }],
]);

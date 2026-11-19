const assert=require('node:assert/strict');

const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture,goobrawlReturnFixture}=require('./fixtures/shared-walk-scenario.cjs');
scenarioTable('an event or staging walk replaces a trip by rank and spawn time, and waits for its healer', fixture, [
 // The party reaches an event no more than 60 s after its spawn.
 ['a fighter event walk waits for the healer while it can still reach the spawn within 60 s (C7)', t=>{
 t.state.statuses.P.ctype='priest';t.scheduled('mrpumpkin',1000);let startedAt=null,now=1000;
 // The members poll every few seconds, as the real ones do every 500 ms; the healer never asks.
 for(;now<=70_000&&startedAt===null;now+=5_000){for(const n of ['F','L'])t.walks.submit(t.body(n,{key:'mrpumpkin'}));if(t.starts())startedAt=now;else t.advance(5_000);}
 assert.equal(startedAt,61_000,'the walk waits while the party can still arrive within 60 s of the 1 s spawn, then goes');
 assert.deepEqual([...t.state.activeConvoy.participants].sort(),['F','L']);
 }],
 // Without a spawn time the healer wait, and the wait for a member that has not asked, end on that
 // member's own ask, which its event poll repeats until the walk answers, or on a holder that says
 // it is not coming. No round of reports and no clock ends them.
 ['a member that has not asked is waited on until it asks, healer or not, with no round', ()=>{
  for(const ctype of ['priest','ranger']){
   const g=fixture();g.state.statuses.P.ctype=ctype;const ask=()=>{g.walks.submit(g.body('L'));g.walks.submit(g.body('F'));};
   for(let i=0;i<10;i++){ask();g.advance(1_000);}
   assert.equal(g.starts(),0,ctype+': ten reports later the walk still waits for P');
   ask();g.walks.submit(g.body('P'));assert.equal(g.starts(),1,ctype+': P\'s ask starts the walk');
   assert.deepEqual([...g.state.activeConvoy.participants].sort(),['F','L','P']);
  }
 }],
 // A member that cancels its waiting request before a walk admits it is not gathered into the
 // next walk, so the walk waits on its next ask.
 ['a cancelled waiting request joins no later walk', ()=>{
  const g=fixture();g.walks.submit(g.body('L'));g.walks.submit(g.body('F'));
  assert.equal(g.starts(),0,'the walk waits for P');
  assert.equal(g.walks.submit({...g.body('F'),cancel:true}).phase,'failed');
  g.walks.submit(g.body('L'));g.walks.submit(g.body('P'));
  assert.equal(g.starts(),0,'red: the cancelled request of F still counts as asked');
 }],
 // T5 `runtime-lost` leaves a member whose reports stopped, with no holder asked, so the start goes
 // on.
 ['an eligible member whose reports stop is left and the start goes on', ()=>{
  const g=fixture();
  g.state.statuses.P.reportIntervalMs=1000;const stopped=g.state.statuses.P.seenAt;g.advance(2_500);g.state.statuses.P.seenAt=stopped;
  g.walks.submit(g.body('L'));g.walks.submit(g.body('F'));
  assert.equal(g.starts(),1,'red: the start waits on P');
  assert.deepEqual([...g.state.activeConvoy.participants].sort(),['F','L']);
 }],
 // The user's decision of 2026-11-17 (decisions.md): a member whose reports stopped past the walk
 // reading stops holding the walk's start even while the lifecycle owner answers it loading, so a
 // CODE reload that outlasts that reading lets it go; it comes back on its next report. This
 // replaces the earlier row, where the reload held the start until it ended.
 ['a member whose CODE reload outlasts the walk reading is let go while 13 answers it loading', ()=>{
  const {memberHolds}=require('../../runtime/lifecycle/coordinator/lease.ts');
  const worker={instance:{},codeReloadRunning:true};
  const g=fixture(false,undefined,[{name:'core:test-lifecycle',holder:'13',
   answer:({member})=>memberHolds(member,{now:()=>g.now(),report:n=>g.state.statuses[n],worker:n=>n==='P'?worker:{instance:{}}})}]);
  // P reports on the status timer and goes silent past the walk reading's age for that interval.
  const {ageOf,STATUS_TIMER_MS}=require('../../runtime/protocol/reports.ts');
  g.state.statuses.P.reportIntervalMs=STATUS_TIMER_MS;const stopped=g.state.statuses.P.seenAt;
  g.advance(ageOf({reading:'walk',attackerKnown:false,intervalMs:STATUS_TIMER_MS})+1);g.state.statuses.P.seenAt=stopped;
  g.walks.submit(g.body('L'));g.walks.submit(g.body('F'));
  assert.equal(g.starts(),1,'the start waited on a member the console knows is silent');
  assert.deepEqual([...g.state.activeConvoy.participants].sort(),['F','L']);
 }],
 ['a member a holder says is not coming is left, and a dead healer is left at once', ()=>{
  const g=fixture(false,undefined,[{name:'core:test-holder',
   answer:({member})=>member==='P'?[{owner:'05',reason:'escaping',coming:false,endsOn:'survival.escapeEnded'}]:[]}]);
  g.state.statuses.P.ctype='priest';
  {
   g.walks.submit(g.body('L'));g.walks.submit(g.body('F'));
   assert.equal(g.starts(),1,'the escaping healer is not coming, so the walk goes on without it');
   assert.deepEqual([...g.state.activeConvoy.participants].sort(),['F','L']);
  }
  const d=fixture();d.state.statuses.P.ctype='priest';d.state.statuses.P.rip=true;
  d.walks.submit(d.body('L'));d.walks.submit(d.body('F'));
  assert.equal(d.starts(),1,'E02-05h: a dead healer never holds the party');
 }],
 // closed: an event walk's start hands each holder the walk's activity and event key, by which the
 // tasks owner's wind-down asks the events owner's `event.schedule` for the group's occurrence. The
 // ask carries no event facts, even when the request names a spawn.
 ["an event walk's start asks each holder with its activity and event key", ()=>{
  const asks=[],g=fixture(false,undefined,[{name:'core:test-holder',answer:ask=>{asks.push(ask);return [];}}]);
  {
   g.walks.submit(g.body('L',{key:'mrpumpkin',spawnAt:1000}));
   const ask=asks.find(entry=>entry.member==='P');
   assert.ok(ask,'the start asks about P');
   assert.equal(ask.activity,'event');assert.equal(ask.key,'mrpumpkin');
   for(const fact of ['spawnAt','walkMs','shortWindow'])assert.equal(fact in ask,false,fact+' comes from event.schedule, not the ask');
  }
 }],
 ['an event with a game data window takes over a trip at once, one without waits within the spawn bound (A25)', ()=>{
 const {setGameEvents}=require('../../runtime/movement/coordinator/planner-service.ts');setGameEvents({icegolem:{duration:2400}});
 try{
  const t=fixture();t.scheduled('icegolem',1000);t.convoys.start({map:'cave',x:0,y:0},'Hunt',['L','F','P'],'monster-hunt',undefined,'hunt-mission');const trip=t.state.activeConvoy.id;
  for(const n of ['L','F','P'])t.walks.submit(t.body(n));
  assert.notEqual(t.state.activeConvoy.id,trip,'Ice Golem runs 2400 s in game data and takes over');
  const w=fixture();w.scheduled('mrpumpkin',1000);w.convoys.start({map:'cave',x:0,y:0},'Hunt',['L','F','P'],'monster-hunt',undefined,'hunt-mission');const held=w.state.activeConvoy.id;
  const ask=()=>{for(const n of ['L','F','P'])w.walks.submit(w.body(n,{key:'mrpumpkin'}));};
  ask();assert.equal(w.state.activeConvoy.id,held,'Mr. Pumpkin has no window: the walk waits for the trip');
  w.advance(60_001);ask();assert.notEqual(w.state.activeConvoy.id,held,'past the spawn bound it takes over');
 }finally{setGameEvents(null);}
 }],
 // The attendance wind-down's finish: the walk starts once no monster targets a member, and
 // never past the spawn bound.
 ['an event walk lets the fight finish while it can still reach the spawn within 60 s', ()=>{
  const ask=t=>{t.scheduled('mrpumpkin',1000);for(const n of ['L','F','P'])t.walks.submit(t.body(n,{key:'mrpumpkin'}));};
  const t=fixture();t.state.statuses.F.threats=[{id:'goo1',mtype:'goo'}];
  ask(t);assert.equal(t.starts(),0,'a monster targets the warrior: the fight finishes first');
  t.advance(5_000);t.state.statuses.F.threats=[];ask(t);assert.equal(t.starts(),1,'the fight is over: the walk starts');
  const late=fixture();late.state.statuses.F.threats=[{id:'goo1',mtype:'goo'}];
  late.advance(60_001);ask(late);assert.equal(late.starts(),1,'past the spawn bound the walk leaves the fight');
  const none=fixture();none.state.statuses.F.threats=[{id:'goo1',mtype:'goo'}];
  for(const n of ['L','F','P'])none.walks.submit(none.body(n));assert.equal(none.starts(),1,'without a spawn time the walk starts at once');
 }],
 // The start waits on every holder's coming hold alike; the lifecycle owner holds a paused member.
 // The events owner's holds are its own answer, checked in coordinator-grouped-snapshot.test.cjs. Red on an
 // earlier build, where the start read the tasks owner's holds only.
 ["the lifecycle owner's coming hold holds an event walk's start", ()=>{
  const ask=t=>{for(const n of ['L','F','P'])t.walks.submit(t.body(n));};
  const paused=fixture();paused.state.statuses.P.consoleMaintenance={id:'u1',held:true};
  ask(paused);assert.equal(paused.starts(),0,'the paused member holds the start coming');
  delete paused.state.statuses.P.consoleMaintenance;paused.advance(500);ask(paused);assert.equal(paused.starts(),1);
 }],
 // A member whose own report names a task walk's live request as what holds it
 // (`commandHold` the tasks owner) is coming, so the start waits for the report that drops
 // it.
 ["the tasks owner's named commandHold holds an event walk's start coming", ()=>{
  const t=fixture(),ask=()=>{for(const n of ['L','F','P'])t.walks.submit(t.body(n));};
  t.state.statuses.P.commandHold={owner:'01',reason:'finishing the Hunt walk'};
  ask();assert.equal(t.starts(),0,'the named hold holds the start');
  delete t.state.statuses.P.commandHold;t.advance(500);ask();assert.equal(t.starts(),1);
 }],
 ["an event walk takes over a winding-down trip only once the tasks owner's walk:event answer allows it (U1 (a))", ()=>{
  // L and F walk the trip and have joined another event, so the walk's one member P holds nothing
  // and only the tasks owner's answer keeps the trip.
  const t=fixture();t.state.statuses.L.joinedEvent=t.state.statuses.F.joinedEvent='icegolem';
  t.convoys.start({map:'cave',x:0,y:0},'Hunt',['L','F'],'monster-hunt',undefined,'hunt-mission');const held=t.state.activeConvoy.id;
  t.scheduled('mrpumpkin',1000);const ask=()=>t.walks.submit(t.body('P',{key:'mrpumpkin'}));
  ask();assert.equal(t.state.activeConvoy.id,held,'the trip winds down: no takeover');
  t.advance(60_001);ask();assert.notEqual(t.state.activeConvoy.id,held,'past the spawn bound it takes over');
 }],
 // The movement owner records each request's life, the survival owner's `survival.life`, and a request or token from an earlier life
 // is `stale`. Written in the leftovers pass; the end run runs it first.
 ['a walk request answers by its requester\'s life: a token from before a death is stale after it', t=>{
  const lives={};t.hooks.register({name:'core:test-life',folder:'core',author:'test',summary:"05's life.",hooks:{'survival.life':n=>lives[n]||0}});
  assert.equal(t.walks.submit(t.body('L')).phase,'waiting');
  lives.L=2000;assert.deepEqual(t.walks.submit(t.body('L')),{error:'stale'},'the token from the earlier life is refused');
  assert.equal(t.walks.submit(t.body('L',{token:'L2'})).phase,'waiting','the revived member asks again with a new token');
 }],
 ['a request from an earlier life never joins a walk; the revival\'s own request does', t=>{
  const lives={};t.hooks.register({name:'core:test-life',folder:'core',author:'test',summary:"05's life.",hooks:{'survival.life':n=>lives[n]||0}});
  t.walks.submit(t.body('F'));lives.F=2000;t.walks.submit(t.body('L'));t.walks.submit(t.body('P'));
  assert.equal(t.starts(),0,'F\'s request from before its death does not count as asked');
  t.walks.submit(t.body('F',{token:'F2'}));assert.equal(t.starts(),1);
  assert.deepEqual([...t.state.activeConvoy.participants].sort(),['F','L','P']);
 }],
 // (4) (shared-walk.ts:502-509; e2e/live-event-runtime-recovery.spec.ts:54-72): P died on the
 // event's trip and the party's walk travels on without it.
 ['a revived member\'s rejoin beside the party\'s travelling walk runs as its own leg', t=>{
  const lives={};t.hooks.register({name:'core:test-life',folder:'core',author:'test',summary:"05's life.",hooks:{'survival.life':n=>lives[n]||0}});
  t.convoys.start({map:'winterland',x:100,y:100},'event walking leg',['L','F'],'shared-walk');
  const c=t.state.activeConvoy;Object.assign(c,{phase:'travel',walkingActivity:'event',walkingEvent:'icegolem',routeServer:'USII'});
  const died=t.state.statuses.P.seenAt;lives.P=died;
  Object.assign(t.state.statuses.P,{lastDeath:{at:died,eventTrip:{event:'icegolem'}},joinedEvent:'icegolem',hp:100});t.advance(1);
  assert.equal(t.walks.submit(t.body('P',{token:'P1'})).phase,'waiting','a request that names no rejoin waits for the walk');
  assert.equal(t.walks.submit(t.body('P',{token:'P2',reentry:died-1})).phase,'waiting','a rejoin from an earlier life waits');
  assert.deepEqual(t.walks.submit(t.body('P',{token:'P3',reentry:died})),{ok:true,phase:'independent',destination:{map:'winterland',x:100,y:100}});
  assert.equal(t.state.activeConvoy,c,'the travelling walk goes on');
  assert.deepEqual([c.phase,[...c.participants].sort()],['travel',['F','L']]);
 }],
 // The live Anniversary staging row: a farming party asked for the walk to Main before the round
 // and the walk never started, because no attendance task holds the group before a round is live.
 ['an Anniversary staging walk starts while the farming task holds the group, and waits under a Hunt', t=>{
  const stage=n=>t.walks.submit(t.body(n,{activity:'anniversary-staging',key:'997179',destination:{map:'main',x:0,y:0}}));
  Object.assign(t.live,{kind:'hunt-mission',tier:'hunt-mission',owner:'hunt'});
  for(const n of ['L','F','P'])stage(n);
  assert.equal(t.starts(),0,'a Hunt keeps the group through the staging lead');
  Object.assign(t.live,{kind:'farming',tier:'farming',owner:'farm'});
  for(const n of ['L','F','P'])stage(n);
  assert.equal(t.starts(),1,'the farming party walks to Main for the round');
  assert.equal(t.state.activeConvoy.walkingActivity,'anniversary-staging');
 }],
]);

scenarioTable('a failed event walk climbs the walk ladder and its exit keeps the saved checkpoints', fixture, [
 // A member's reported stop fails the walk at the route's clock, as the step's own failures do, so
 // the next report on virtual time reads against it (red: the wall clock stamped it).
 ['a reported stop stamps the walk\x27s failure with the route\x27s clock', t=>{
 for(const n of ['L','F','P'])t.walks.submit(t.body(n));
 const {createSharedConvoyNavigation}=require('../../runtime/movement/coordinator/walk.ts');
 assert.equal(createSharedConvoyNavigation().hold(t.state,'F: unavailable','unavailable',5000),true);
 assert.deepEqual([t.state.activeConvoy.phase,t.state.activeConvoy.failedAt],['failed',5000]);
 }],
 // The live Slenderman row's search walked to one Halloween point the native planner had no route to,
 // and the walk climbed its ladder 52 times on that point, so the search never reached Spookytown.
 ['a search point the planner has no route to fails its walk, which answers the search; another walk climbs', t=>{
 const {createSharedConvoyNavigation}=require('../../runtime/movement/coordinator/walk.ts');
 for(const n of ['L','F','P'])t.walks.submit(t.body(n,{search:true}));
 assert.equal(createSharedConvoyNavigation().hold(t.state,'L: Native planner found no route','route-failed',5000),true);
 assert.deepEqual([t.state.activeConvoy.phase,t.state.activeConvoy.failureCode],['failed','unreachable']);
 assert.equal(t.walks.submit(t.body('L',{search:true})).phase,'failed','the search hears the refusal');
 // The rerun's point (858, -160) on Halloween sat past a wall the native plan's last step crossed.
 const wall=fixture();
 for(const n of ['L','F','P'])wall.walks.submit(wall.body(n,{search:true}));
 createSharedConvoyNavigation().hold(wall.state,'L: Native route rejected: collisions detected between {"map":"halloween","x":850,"y":-150} and {"map":"halloween","x":858,"y":-160}','route-failed',5000);
 assert.equal(wall.state.activeConvoy.failureCode,'unreachable','a native plan the game collision rejects');
 const other=fixture();
 for(const n of ['L','F','P'])other.walks.submit(other.body(n));
 createSharedConvoyNavigation().hold(other.state,'L: Native planner found no route','route-failed',5000);
 assert.notEqual(other.state.activeConvoy.phase,'failed','a walk that is no search keeps climbing');
 }],
 ['a failed event walk answers no later request with its failure; the next walk continues its ladder (design § 5.2)', t=>{
 for(const n of ['L','F','P'])t.walks.submit(t.body(n));const c=t.state.activeConvoy;
 Object.assign(c,{phase:'failed',failure:'The shared route no longer matches the game geometry',failureCode:'route-failed',retryExhausted:true,ladder:{index:2,rounds:0,failures:2,progressAt:1000,visited:['main']}});
 t.advance(500);const answer=t.walks.submit(t.body('L',{token:'L2'}));
 assert.notEqual(answer.phase,'failed');
 for(const n of ['F','P'])t.walks.submit(t.body(n,{token:n+'2'}));
 assert.notEqual(t.state.activeConvoy.id,c.id,'the next request starts the next step');assert.equal(t.state.activeConvoy.ladder.index,2);
 }],
 ['Snowman repairs persisted staging failure, completes recovery, and releases all-ready Backup Hunt', ()=>{
 const t=goobrawlReturnFixture('anniversary-staging');
 t.state.characterLocations=Object.fromEntries(t.names.map(n=>[n,t.checkpoint]));
 const {createCoordinatorEventReturns}=require('../../runtime/events/coordinator/returns.ts');
 const {createHunt}=require('../../runtime/hunting/coordinator/hunt.ts');
 const nav=require('./helpers/farming-navigation.cjs')(t.state,{now:()=>1000,names:()=>t.names,activeNames:()=>t.names,
  persist(){},log(){},cancelConvoy:()=>t.convoys.cancel(),startConvoy:(...args)=>t.convoys.start(...args)});
 const service=createCoordinatorEventReturns(t.state,{now:()=>1000,nextCommand:()=>t.state.nextCommandId++,activeNames:()=>t.names,enabled:()=>true,
  checkpoint:()=>t.checkpoint,cancelConvoy:()=>t.convoys.cancel(),startConvoy:(...args)=>t.convoys.start(...args),
  anniversaryParticipants:()=>[],persist(){},navigation:nav,huntCycle:()=>false});
 const waypoints=Object.fromEntries(t.names.map(n=>[n,{revision:1,location:t.checkpoint}]));
 t.state.eventReturn={cycleId:'snowman-return',event:'snowman',participants:t.names,pending:[],startedAt:900,
  checkpoint:t.checkpoint,waypoints,deferred:[]};
 t.state.anniversary.eventCycle={id:'round',participants:t.names,combatEvent:'snowman',combatHandoffAt:800,waypoints};
 Object.assign(t.old,{phase:'failed',failure:'Convoy owner-lost',failureCode:'owner-lost',restartRecovery:true});
 for(const n of t.names)Object.assign(t.state.statuses[n],{map:'main',x:0,y:0,hp:100,
  eventRecovery:{cycleId:'snowman-return',phase:'town-ready'}});
 const hunt={stage:'backup-farming',participants:t.names,backup:{members:{}},missions:[],currentIndex:-1};
 service.reconcile();
 assert.equal(t.state.activeConvoy.purpose,'event-return');
 assert.notEqual(t.state.activeConvoy.id,t.old.id);
 assert.deepEqual(t.state.eventReturn.waypoints,waypoints);
 for(const n of t.names)Object.assign(t.state.statuses[n],t.checkpoint);
 service.reconcile();
 assert.equal(t.state.eventReturn,null);
 assert.equal(t.state.activeConvoy,null);
 assert.ok(t.state.anniversary.eventCycle.returnCompletedAt);
 // The all-ready backup ends at the Hunt's next tick (hunt.ts `backupStep`).
 Object.assign(t.state,{targetMode:'hunt',monsterHunt:hunt});
 createHunt(t.state,{now:()=>1000,participants:()=>t.names,cancelConvoy:()=>t.convoys.cancel(),persist(){},selectedDestination:()=>null,
  start:(...args)=>t.convoys.start(...args),navigation:{authorize(){},intent:n=>t.state.navigationIntents[n]||{}},ownsTravel:()=>false}).tick();
 assert.equal(hunt.stage,'batch-loot');assert.equal(hunt.batchPickup,true);assert.equal(hunt.backup,undefined);
 }],
]);

// Each group walk tells the registry its own coordinator handed createPartyConvoys, so two
// coordinators in one process keep separate listeners.
require('node:test')('two coordinators in one process tell their own registries', () => {
  const {createRegistry}=require('../../runtime/hooks/registry.ts');
  const heard=[];
  const registry=(name)=>{const r=createRegistry();r.register({name:'core:test-ears',folder:'core',author:'test',summary:'test',
   hooks:{'walk.formed':notice=>{heard.push([name,notice.walk]);}}});return r;};
  const first=fixture(false,registry('first')),second=fixture(false,registry('second'));
  for(const g of [first,second]){g.walks.submit(g.body('L'));g.walks.submit(g.body('F'));g.walks.submit(g.body('P'));}
  assert.deepEqual(heard,[['first',first.state.activeConvoy.id],['second',second.state.activeConvoy.id]]);
});

// P5: T5 leaves an `unavailable` walk open to its next request; an add-on's `retry.policy`
// give-up exhausts it, so it stays failed until the player selects the destination again.
require('node:test')("P5 (02): an add-on's retry.policy gives up a failed walk T5 leaves open", () => {
  const {createSharedConvoyNavigation}=require('../../runtime/movement/coordinator/walk.ts');
  const fail=asks=>{
    const t=fixture();
    if(asks)assert.deepEqual(t.hooks.register({name:'quits',folder:'addons',author:'test',summary:'test',
      hooks:{'retry.policy':ask=>{asks.push([ask.owner,ask.failure,ask.core.giveUp]);return ask.owner==='02'?{giveUp:true}:undefined;}}}),{ok:true});
    if(asks)t.hooks.configure({quits:{enabled:true}});
    for(const n of ['L','F','P'])t.walks.submit(t.body(n));
    assert.equal(createSharedConvoyNavigation().hold(t.state,'F: unavailable','unavailable',5000),true);
    return t.state.activeConvoy;
  };
  assert.equal(!!fail(null).retryExhausted,false,'with no add-on T5 leaves the failure open');
  const asks=[],c=fail(asks);
  assert.deepEqual(asks,[['02','unavailable',false]]);
  assert.deepEqual([c.phase,c.retryExhausted],['failed',true]);
});

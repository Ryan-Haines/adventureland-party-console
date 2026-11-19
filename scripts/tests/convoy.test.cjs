const {productionFunctions} = require('./helpers/production-functions.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const settle = () => new Promise(resolve => setImmediate(resolve));
const command = { id: 2, convoyId: 'test', epoch: 7, phase: 'assemble',
  rally: { map: 'main', x: 0, y: 0 }, location: { map: 'main', x: 120, y: 0 }, slowestSpeed: 57 };

const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {runtime}=require('./helpers/native-convoy-runtime.cjs');
scenarioTable('the character convoy runner holds, caps speed and walks the shared route under its owner (MOV-078, MOV-079)', (...options)=>runtime(...options), [
 ['same convoy phase and epoch changes retain one cruise cap; changed speed sends one update', async r=>{
 const a=await r.start({...command,id:1,phase:'assemble'});
 const old=r.context.groupWalk.travel;old.cruiseHandoff=true;await r.cancel();await a.promise;
 const b=await r.start({...command,epoch:8});
 assert.deepEqual(r.calls.filter(x=>x[0]==='cruise'),[['cruise',57]]);
 const current=r.context.groupWalk.travel;r.context.setConvoyCruise(current,60);r.context.setConvoyCruise(current,60);
 r.context.releaseConvoyCruise(old);
 assert.deepEqual(r.calls.filter(x=>x[0]==='cruise'),[['cruise',57],['cruise',60]]);
 await r.cancel();await b.promise;
 assert.deepEqual(r.calls.filter(x=>x[0]==='cruise'),[['cruise',57],['cruise',60],['cruise',500]]);
 }],
 ['assembly holds ownership and caps speed without awaiting cruise acknowledgement', async r=>{
  const {promise}=await r.start({...command,phase:'assemble'});
  assert.equal(r.context.groupWalk.travel.phase,'assembled');
  assert.deepEqual(r.calls.filter(x=>x[0]==='cruise'),[['cruise',57]]);
  assert.equal(r.searches,0);await r.cancel();await promise;
 }],
 ['old assembly cleanup cannot reset the preparation owner or its speed', async r=>{
  const a=await r.start({...command,id:1,phase:'assemble'});
  const old=r.context.groupWalk.travel;old.cancelled=true;
  const b=await r.start({...command,phase:'assemble'});
  old.release();await a.promise;
  assert.equal(r.context.groupWalk.travel.commandId,2);
  assert.equal(r.calls.some(x=>x[0]==='cruise'&&x[1]===500),false);
  await r.cancel();await b.promise;
 }],
 ['Town succeeds near spawn without requiring 90 units of displacement', async r=>{
  r.context.character.x=10;
  r.context.can_use=()=>true;r.context.is_on_cooldown=()=>false;
  const {promise}=await r.start({...command,phase:'town'});
  assert.equal(r.context.groupWalk.travel.phase,'towned');
  await r.cancel();await promise;
 }],
 ['legacy terminal hold without a reason reports convoy identity and missing context', async r=>{
  const {promise}=await r.start({...command,phase:'hold'});
  assert.match(r.context.groupWalk.travel.failure,/missing-failure-context.*test.*epoch 7.*main/);
  assert.equal(r.calls.some(x=>String(x[1]).includes('Convoy held; request a fresh convoy')),false);
  await r.cancel();await promise;
 }],
 ['convoy diagnostics exclude movement evidence from preceding commands', r=>{
  r.context.movement.report=()=>({id:'current',owner:{commandId:8}});
  r.context.movement.last=()=>({id:'old',failureContext:{commandId:7}});
  assert.equal(r.context.convoyMovementEvidence({commandId:9}),null);
  assert.equal(r.context.convoyMovementEvidence({commandId:8}).id,'current');
  assert.equal(r.context.convoyMovementEvidence({commandId:7}).id,'old');
 }],
 // Step 8c item 7: the rally walk (shared.js `navigate`) marks an interruption only when its
 // own journey ends. An escape that replaces the walk's journey is the walk's interruption;
 // an escape the walk waited behind ends as the escape's own, and the walk then starts.
 ['a walk marks an interruption only on its own journey, never on the journey it waited behind', async r=>{
  const settled=async()=>{for(let i=0;i<5;i++)await settle();};
  const assemble={...command,phase:'assemble',rally:{map:'main',x:100,y:0},requester:{kind:'group-walk',tier:'farming'}};
  const escape={request:{kind:'escape',owner:'e2e-escape'}};
  await r.start(assemble);await settled();
  const own=r.context.groupWalk.travel;
  // Step 8c item 13: the walk's identity names its group, convoy, epoch and navigation revision; a
  // command with no group is the main party's, a solo service names its character.
  assert.equal(r.context.movement.live().owner,'walk:party:test:7:0','precondition: the rally walk runs');
  assert.equal(r.context.convoyRequest({ id: 'solo', epoch: 3, navigationRevision: 2, group: 'F', requester: { kind: 'group-walk', tier: 'farming' } }).owner, 'walk:F:solo:3:2');
  r.context.smart_move({map:'main',x:10,y:0},undefined,escape).catch(()=>{});await settled();
  assert.deepEqual([own.interruption?.code,own.interruption?.by?.owner],['replaced:escape','e2e-escape']);
  const behind=runtime();
  behind.context.smart_move({map:'main',x:140,y:0},undefined,escape).catch(()=>{});await settled();
  await behind.start(assemble);await settled();
  const waited=behind.context.groupWalk.travel,records=()=>behind.context.movement.records();
  assert.ok(records().some(e=>e.decision==='waiting'&&e.owner==='walk:party:test:7:0'),'precondition: the walk waits behind the escape');
  await behind.context.stop(undefined,undefined,{kind:'escape',owner:'e2e-escape'});await settled();
  assert.equal(waited.interruption,undefined,'the escape\'s end is not the walk\'s interruption');
  assert.equal(behind.context.movement.live()?.owner,'walk:party:test:7:0','the walk starts once the escape ends');
 }],
 // Step 8c item 14: the Town cast renews its hold on each completed report (shared.js
 // onEachReport), and holdForTask releases its own hold by its whole identity. b9b5c91e renewed
 // on a 250 ms timer and matched holders by prefix.
 ['the Town cast renews its hold on each report, and holdForTask releases only its own hold', async r=>{
  const c=r.context,m=c.movement,timers=r.timers.length,holds=[],hold=m.hold;
  m.hold=function(request){holds.push(request.owner);return hold.apply(this,arguments);};
  c.character.c={town:{ms:3000}};
  const cast=c.townCast({kind:'town',owner:'town:e2e'});
  await new Promise(resolve=>setTimeout(resolve,600));
  assert.deepEqual(holds,['town:e2e'],'no renewal over 600 ms without a report');
  assert.equal(r.timers.length,timers,'the cast registers no timer of its own');
  c.reportSucceeded();c.reportSucceeded();
  assert.deepEqual(holds,['town:e2e','town:e2e','town:e2e'],'one renewal per report');
  // The channel's end is read on the owner's next scheduler pass (owner.ts `nextPass`).
  c.character.c={};c.smart_move_logic();await cast;m.hold=hold;
  assert.equal(m.live(),null,'the cast releases its hold when the channel ends');
  // A new task releases the old task's hold; another event return's hold, which shares the
  // prefix, stays.
  c.holdForTask({kind:'event-return',owner:'event-return:c1'});
  c.holdForTask({kind:'event-return',owner:'event-return:c2'});
  assert.equal(m.live().owner,'event-return:c2');
  m.release('event-return:c2');
  assert.equal(m.hold({kind:'task-walk',owner:'event-return:c20',tier:'event-return',deadline:1e9}),'granted');
  c.holdForTask({kind:'farm',owner:'farm'});
  assert.equal(m.live()?.owner,'event-return:c20','a holder that shares the prefix keeps its hold');
  m.release('event-return:c20');
  // The lone event return walk shares the hold's identity and keeps walking.
  c.holdForTask({kind:'event-return',owner:'event-return:c3'});
  c.smart_move({map:'main',x:100,y:0},undefined,{request:{kind:'task-walk',owner:'event-return:c3',tier:'event-return'}}).catch(()=>{});await settle();
  c.holdForTask({kind:'farm',owner:'farm'});
  assert.deepEqual([m.live()?.owner,m.live()?.journey],['event-return:c3',true]);
 }],
]);

// A lone leader on the shared route: the coordinator engine steps its command, the runtime plans and
// publishes the route, and the travel phase departs it.
const {partyEngine,client,report}=require('./fixtures/shared-convoy-scenario.cjs');
// A Town waypoint asks targeting whether a departure fight is pending; no fight is pending here.
require('../../runtime/hooks/index.ts').partyHooks().publish({name:'core:targeting',folder:'core',author:'test',summary:'The departure read the walk asks.',
 hooks:{'targeting.departurePending':()=>false}});
function leader(options={},convoy={}){
 const {p,e}=partyEngine();
 p.activeConvoy.participants=['L'];for(const n of ['F','P']){delete p.commands[n];delete p.statuses[n];}
 Object.assign(p.activeConvoy,convoy);
 if(convoy.rally)Object.assign(p.statuses.L,{map:convoy.rally.map,in:convoy.rally.map,x:convoy.rally.x,y:convoy.rally.y});
 e.step(p,1000);
 const r=client('L',p,options);
 const tick=async(n=1,at=1000)=>{for(let i=0;i<n;i++){r.context.groupWalk.signal=e.signal(p,'L',at);r.tick();await settle();}};
 const ready=async()=>{for(let i=0;i<50&&!r.context.groupWalk.travel.routeReady;i++)await tick();assert.equal(r.context.groupWalk.travel.routeReady,true);};
 const depart=()=>{report(p,'L','route-ready',1100);e.step(p,1100);assert.equal(p.activeConvoy.phase,'travel');};
 const walk=async()=>{for(let i=0;i<80&&r.context.groupWalk.travel;i++){report(p,'L','travelling',1200);await tick(1,1200);}};
 const sent=path=>r.calls.filter(x=>x[1]===path);
 return {p,e,r,tick,ready,depart,walk,sent};
}
scenarioTable('a leader plans the shared route without moving and walks it only once the coordinator departs the walk',leader,[
 ['Franky exit resolves at the Mainland boundary without walking the remaining route',async f=>{
  const {r,p}=f;
  r.context.character.map='cave';r.context.G.maps.cave.doors=[[0,0,0,0,'main',0,0]];
  const run=await r.start(p.commands.L);
  await f.ready();f.depart();await f.walk();await run.promise;
  assert.equal(r.context.character.map,'main');assert.equal(r.context.character.x,0);
  assert.equal(r.context.movement.state.moving,false);assert.equal(r.context.movement.state.searching,false);
  assert.equal(r.context.partyLocation,null);assert.equal(f.sent('/convoy-complete').length,1);
 },{slow:false},{purpose:'franky-exit',navigationExempt:true,combatHandoffAllowed:false,rally:{map:'cave',x:0,y:0}}],
 ['a stale arrival response after party regroup does not report another movement failure',async f=>{
  const {r}=f,original=r.context.request;
  r.context.request=async(url,options)=>{if(url==='/convoy-complete')throw Error('POST /convoy-complete · HTTP 409 · http: stale convoy completion');return original(url,options);};
  const run=await r.start(f.p.commands.L);await f.ready();f.depart();await f.walk();await settle();
  assert.equal(r.context.groupWalk.travel.phase,'arrived');
  assert.equal(f.sent('/convoy-failed').length,0);
  await r.cancel();await run.promise;
 },{slow:false}],
 ['unsupported scheduler fails before starting a route',async f=>{
  const {r}=f;
  r.context.smart_move_logic=()=>{};
  const run=await r.start(f.p.commands.L);await f.tick(3);
  assert.match(r.context.groupWalk.travel.failure,/scheduler was replaced/);
  assert.equal(r.searches,0);await r.cancel();await run.promise;
 },{slow:false}],
 ['native route search failure remains held until cancellation',async f=>{
  const {r}=f;
  const run=await r.start(f.p.commands.L);await f.tick(6);
  assert.equal(r.context.groupWalk.travel.phase,'failed');
  assert.equal(r.context.movement.state.moving,false);assert.equal(f.sent('/convoy-failed').length,1);
  await f.tick(3);assert.equal(r.context.groupWalk.travel.phase,'failed');
  await r.cancel();await run.promise;
 },{slow:false,noPath:true}],
 ['native multi-tick search prepares without movement; same plot walks at offset departure',async f=>{
  const {r}=f;let restores=0;
  r.context.partyPorcupineEquipment={depart(){restores++;return new Promise(()=>{});}};
  const run=await r.start(f.p.commands.L),stops=r.moves().length;
  await f.ready();assert.equal(r.moves().length,stops);
  const plot=JSON.stringify(r.context.movement.state.plot);
  await f.tick(10);
  assert.equal(JSON.stringify(r.context.movement.state.plot),plot);assert.equal(r.searches,1);
  assert.equal(r.moves().length,stops);assert.equal(restores,0);
  f.depart();await f.walk();await run.promise;
  assert.equal(r.searches,1);assert.equal(r.context.groupWalk.travel,null);
  assert.equal(f.sent('/convoy-complete').length,1);assert.equal(r.context.character.x,120);
  assert.equal(restores,1);
 },{slow:false}],
 ['native town waypoints wait for release',async f=>{
  const {r}=f;
  r.context.character.x=100;r.context.movement.state.use_town=true;
  const run=await r.start(f.p.commands.L);
  await f.ready();assert.ok(r.context.movement.state.plot.some(p=>p.town));
  assert.equal(r.calls.filter(x=>x[0]==='use').length,0);
  f.depart();await f.walk();await run.promise;
  assert.equal(r.calls.filter(x=>x[0]==='use').length,1);assert.equal(r.searches,1);
 },{slow:false},{rally:{map:'main',x:100,y:0},location:{map:'main',x:0,y:0}}],
 ['hunt departure never adds individual Town shortcuts to prepared routes',async f=>{
  const {r}=f;
  r.context.character.x=100;r.context.movement.state.use_town=true;
  const run=await r.start(f.p.commands.L);
  await f.ready();assert.equal(r.context.movement.state.plot.some(p=>p.town),false);
  f.depart();await f.walk();await run.promise;
  assert.equal(r.calls.filter(x=>x[0]==='use').length,0);
 },{slow:false},{purpose:'monster-hunt',rally:{map:'main',x:100,y:0},location:{map:'main',x:0,y:0}}],
 ['stationary phase handoff never emits a stop move before synchronized departure',async f=>{
  const {r,p}=f;
  const assembly=await r.start({...command,id:1,phase:'assemble'});
  assert.equal(r.context.groupWalk.travel.phase,'assembled');
  r.context.groupWalk.travel.cruiseHandoff=true;
  await r.cancel();await assembly.promise;
  const run=await r.start(p.commands.L);
  await f.ready();
  assert.equal(r.context.character.moving,false);assert.equal(r.moves().length,0);
  await f.tick(3);assert.equal(r.moves().length,0);
  f.depart();await f.tick(1,1200);
  assert.ok(r.moves().length>0);
  await r.cancel();await run.promise;
 },{slow:false,nativeMovingFlag:true}],
 ['cancelled preparation cannot release a route and wrapper is reused for ordinary navigation',async f=>{
  const {r}=f;
  const run=await r.start(f.p.commands.L);await f.ready();
  const wrapper=r.context.smart_move_logic;await r.cancel();await run.promise;
  r.tick();assert.equal(r.context.movement.state.moving,false);
  const ordinary=r.context.smart_move(command.location);
  for(let i=0;i<200&&r.context.movement.state.moving;i++){r.tick();await settle();}
  await ordinary;assert.equal(r.context.character.x,120);assert.equal(r.context.smart_move_logic,wrapper);
  assert.equal(r.timers.length,1);
 },{slow:false}],
 ['anniversary planning yields immediately to defense and late route ticks cannot restart movement',async f=>{
  const {r}=f;
  const run=await r.start(f.p.commands.L);await f.ready();f.depart();
  r.context.groupWalk.travel.defensePaused=true;
  const count=r.moves().length;await f.tick(4,1200);
  assert.equal(r.moves().length,count);assert.equal(f.sent('/convoy-complete').length,0);
  await r.cancel();await run.promise;
 },{slow:false},{purpose:'anniversary-return',navigationExempt:true}],
]);

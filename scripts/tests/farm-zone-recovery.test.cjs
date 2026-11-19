const test=require('node:test'),assert=require('node:assert/strict');
const {walkStatePorts}=require('./helpers/walk-state-ports.cjs');
const { createMovementContext } = require('./fixtures/movement-owner-callers.cjs');
const zones=require('../../.build/shared/farming-zones.cjs');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {movement,controlFixture}=require('./fixtures/farm-approach-scenario.cjs');

scenarioTable("the farm approach searches the zone and routes around obstacles to a blocked target", ()=>movement, [
 ['the farm zone search routes into the zone or waits there: an idle leader outside routes in, an empty area waits, a merchant never searches', movement=>{
  {const r=movement();r.c.character.ctype='warrior';r.c.recoverFarmApproach(null);assert.equal(r.calls(),0);r.now(13000);r.c.recoverFarmApproach(null);assert.equal(r.calls(),1);
   assert.equal(zones.contains(r.c.partyLocation,r.c.farmApproach.route.destination),true);}
  {const r=movement();r.c.partyLocation={map:'main',x:0,y:0};r.c.character.x=200;
   for(const time of [10000,12000,20000,60000]){r.now(time);assert.equal(r.c.recoverFarmApproach(null),false);}
   assert.equal(r.calls(),0);assert.equal('searchAt' in r.c.farmApproach,false,'no search delay of its own (RF6 class B)');
   r.c.is_in_range=()=>true;r.c.character.range=300;
   assert.equal(r.c.recoverFarmApproach(r.target),false);
   assert.equal(r.calls(),0);
   r.c.partyLocation={map:'main',x:0,y:0,shapes:[{boundary:[100,-50,300,50]}]};
   assert.equal(r.c.recoverFarmApproach(null),false);assert.equal(r.calls(),0);}
  {const r=movement();r.c.character.ctype='merchant';r.c.recoverFarmApproach(null);assert.equal(r.calls(),0);}}],
 // An unplannable search point and an exhausted search wait for the next report,
 // so the native planner runs once per report, not once per 100 ms tick.
 ['the zone search waits for the next report after a route ends and after its last point, with no per-tick retry', async movement=>{
  {const r=movement();let reported;r.c.nextReport=()=>new Promise(done=>{reported=done;});
   r.c.recoverFarmApproach(null);r.now(13000);r.c.recoverFarmApproach(null);assert.equal(r.calls(),1);
   r.reject();await new Promise(done=>setImmediate(done));
   for(const time of [13100,13200,13300,20000]){r.now(time);assert.equal(r.c.recoverFarmApproach(null),true);}
   assert.equal(r.calls(),1,'no planner search per tick');assert.equal(r.c.partyCombatPosition.reason,'zone search waiting for the next report');
   reported();await new Promise(done=>setImmediate(done));
   r.now(20100);r.c.recoverFarmApproach(null);r.now(23100);r.c.recoverFarmApproach(null);assert.equal(r.calls(),2,'the next point plans after the report');}
  {const r=movement();let reported;r.c.nextReport=()=>new Promise(done=>{reported=done;});r.c.partyFarmingZones={searchPoints:()=>[]};
   r.c.recoverFarmApproach(null);assert.equal(r.c.partyCombatPosition.reason,'zone search exhausted; waiting for reachable spawns');
   r.now(10100);r.c.recoverFarmApproach(null);assert.equal(r.c.partyCombatPosition.reason,'zone search waiting for the next report');
   reported();await new Promise(done=>setImmediate(done));
   r.now(10200);r.c.recoverFarmApproach(null);assert.equal(r.c.partyCombatPosition.reason,'zone search exhausted; waiting for reachable spawns');}}],
 ['a blocked farm target gets one route and a bounded detour, a clear one is never routed, and a route that cannot reach it hands the target back to targeting', async movement=>{
  {const r=movement();assert.equal(r.c.recoverFarmApproach(r.target),false);r.now(11600);
   assert.equal(r.c.recoverFarmApproach(r.target),true);r.now(14600);r.c.recoverFarmApproach(r.target);assert.equal(r.calls(),1);
   r.now(44601);r.c.recoverFarmApproach(r.target);assert.equal(r.stops(),0,'the route keeps going past 30 s');
   r.reject();await new Promise(done=>setImmediate(done));
   assert.deepEqual(r.notices,[['targeting.unreachable',{character:'W',target:'bee',why:'approach'}]]);
   assert.equal(r.c.farmApproach.route,null);}
  {const r=movement();let moves=0;
   r.c.can_move_to=()=>true;r.c.move=()=>{moves++;return Promise.resolve();};
   r.c.requestGroupApproach=()=>{throw Error('unexpected convoy');};
   r.c.recoverFarmApproach(r.target);r.now(13100);r.c.recoverFarmApproach(r.target);
   assert.equal(moves,1);assert.equal(r.calls(),0);}}],
 ['the farm approach ends only the route it owns: aggro pauses its search, a newer owner is never stopped, target loss ends its own route', movement=>{
  {const r=movement();r.c.recoverFarmApproach(r.target);r.now(11600);
   r.c.parent.entities.a={type:'monster',visible:true,target:'W'};r.c.recoverFarmApproach(r.target);assert.equal(r.calls(),0);
   delete r.c.parent.entities.a;r.c.recoverFarmApproach(r.target);r.now(14600);r.c.recoverFarmApproach(r.target);assert.equal(r.calls(),1);
   r.replace();r.c.recoverFarmApproach(r.target);assert.equal(r.stops(),0);assert.equal(r.c.farmApproach.route,null);}
  {const r=movement();r.c.recoverFarmApproach(r.target);r.now(11600);r.c.recoverFarmApproach(r.target);r.now(14600);r.c.recoverFarmApproach(r.target);
   r.c.recoverFarmApproach(null);assert.equal(r.stops(),1);assert.equal(r.c.farmApproach.route,null);}}],
 ['target outside priest spacing does not convoy when already attackable or still approaching', movement=>{
 const r=movement();let requests=0;
 r.c.groupedFarming=()=>true;r.c.groupedCombat={anchor:{x:0,y:0},range:100};
 r.c.requestGroupApproach=()=>{requests++;return true;};
 r.c.character.range=210;r.c.is_in_range=()=>true;
 assert.equal(r.c.recoverFarmApproach(r.target),false);assert.equal(requests,0);
 r.c.is_in_range=()=>false;r.c.recoverFarmApproach(r.target);
 r.now(11000);r.c.recoverFarmApproach(r.target);assert.equal(requests,0);
 r.now(12600);r.c.recoverFarmApproach(r.target);r.now(15600);r.c.recoverFarmApproach(r.target);assert.equal(requests,0);assert.equal(r.calls(),1);}],
]);
// farm-zone-recovery.test.cjs (row 24): on the native hen return the defence may keep an engaged
// target that the selection rejected, so the selection clears. The empty-zone search stays off, the
// walk's defensive approach to a selected target still goes, and the ordinary search comes back once
// the walk lets the member go (approach.ts recoverFarmApproach).
test('convoy defense retains movement when combat selection clears',()=>{
 const r=movement(),moves=[];
 r.c.move=(x,y)=>{moves.push({x,y});return Promise.resolve();};r.c.can_move_to=()=>true;
 r.c.partyConvoyActive=true;r.c.groupWalk.travel={id:'hen-return',defensePaused:true};r.c.convoyDefense='hen-return';
 assert.equal(r.c.recoverFarmApproach(null),true);
 assert.deepEqual(moves,[],'no empty-zone move leaves the defensive loot checkpoint');
 assert.equal(r.c.recoverFarmApproach(r.target),false);
 r.now(11600);assert.equal(r.c.recoverFarmApproach(r.target),true);
 assert.equal(moves.length,1,'the same walk still lets the member approach a selected defensive target');
 r.c.partyConvoyActive=false;r.c.groupWalk.travel=null;r.c.convoyDefense=null;
 r.c.recoverFarmApproach(null);assert.equal(moves.length+r.calls(),2,'the ordinary farm search comes back after the release');
});
test('convoy setup waits through transport lock and handles a racing unable rejection',async()=>{
 let now=1000,stops=0;
 // The walk client's travel (walk-client.ts coordinatedMonsterTravel) stops the member before it
 // holds; the convoy's command names the walk that takes movement over (owner.ts walkRequest).
 const {createWalkClient}=require('../../runtime/movement/character/walk-client.ts');
 const host={parent:{transporting:true},can_walk:()=>now>=1300,game_log(){}};
 const client=createWalkClient(host,{...walkStatePorts(host),now:()=>now,character:()=>({s:{}}),current:()=>true,intent:()=>({revision:0}),generation:()=>1,
  setPartyLocation(){},endFollow(){},movement:()=>({}),walkStands:()=>({end(){}}),walkRequest:()=>({kind:'group-walk',owner:'walk:C:1:0'}),
  stop:async()=>{if(++stops===1)throw {reason:'unable'};},
  // Each owner scheduler pass stands for 100 ms of the test's clock.
  nextPass:async()=>{now+=100;}});
 const travel=client.coordinatedMonsterTravel({id:2,convoyId:'C',epoch:1,navigationRevision:0,phase:'shared-hold',location:{map:'main',x:0,y:0}});
 for(let i=0;i<10&&client.groupWalk.travel.phase!=='held';i++)await new Promise(setImmediate);
 assert.equal(stops,2);assert.equal(now,1400);assert.equal(client.groupWalk.travel.phase,'held');
 client.groupWalk.travel.release();await travel;
});
scenarioTable("farm area control relocates on competition and keeps failed convoys with their owner", ()=>controlFixture, [
 ['competition cannot relocate while a scattered follower still sees the target type', controlFixture=>{
 const t=controlFixture();t.party.statuses.W.farmAreaEvidence=[{key:'kill',actor:'Other',mtype:'bee',map:'main',x:50,y:50,at:t.now(),kill:true}];
 t.party.statuses.P.farmCompetition.monsters.bee=1;t.c.farmAreaTick();assert.equal(t.starts.length,0);assert.equal(t.party.farmAreaState.pending??null,null);
 delete t.party.statuses.P.farmCompetition.monsters.bee;t.advance();t.c.farmAreaTick();assert.equal(t.starts.length,1);}],
 ['competition waits for fighting to finish, relocates once, and keeps normal focus', controlFixture=>{
 const t=controlFixture();t.party.statuses.W.farmAreaEvidence=[{key:'kill',actor:'Other',mtype:'bee',map:'main',x:50,y:50,at:t.now(),kill:true}];
 t.party.statuses.W.map='main';t.party.statuses.W.groupedCombat.currentAttackers=[{id:'bee',map:'main',target:'W',hp:100}];t.party.statuses.W.target={hp:100};t.party.statuses.W.combat={inRange:true};t.c.farmAreaTick();assert.ok(t.party.farmAreaState.pending);
 t.advance();t.c.farmAreaTick();assert.equal(t.starts.length,0);
 t.party.statuses.W.target=null;t.party.statuses.W.groupedCombat.currentAttackers=[];t.advance();t.c.farmAreaTick();assert.equal(t.starts[0].x,350);assert.deepEqual(t.party.monsterFocus,['bee']);
 t.party.activeConvoy=null;t.advance();t.c.farmAreaTick();assert.equal(t.starts.length,1);}],
 ['a failed farm convoy retries a transient failure without marking the zone unreachable, and a geometry mismatch re-plans', ()=>{
  {const t=controlFixture();
   for(let i=0;i<3;i++){
    t.party.activeConvoy={phase:'failed',location:t.areas[0],failure:'W: stale route owner'};
    t.advance();t.c.farmAreaTick();assert.notEqual(t.party.farmAreaState.paused,true);
    assert.equal(t.party.farmAreaState.failures[t.areas[0].id],undefined);
    t.advance(10100);t.c.farmAreaTick();assert.equal(t.starts.length,i+1);
   }
   assert.equal(t.party.farmAreaState.lastFailure.transient,true);}
  // A geometry mismatch re-plans the same area from where the members stand, with no pause
  // for the player.
  {const t=controlFixture(),convoy={phase:'failed',location:t.areas[0],failureCode:'geometry-mismatch',failure:'Geometry recovery failed after one reload'};
   t.party.activeConvoy=convoy;t.advance();t.c.farmAreaTick();
   assert.equal(t.party.activeConvoy,null);assert.notEqual(t.party.farmAreaState.paused,true);
   assert.equal(t.party.farmAreaState.pending.destination.id,t.areas[0].id);assert.equal(t.party.farmAreaState.failures[t.areas[0].id],undefined);
   t.advance(10100);t.c.farmAreaTick();assert.equal(t.starts.length,1);}
  // The end code classifies the failure, never its text: a route failure whose words name an owner
  // counts a strike, and an owner-lost code with route words counts none.
  {const t=controlFixture();
   t.party.activeConvoy={phase:'failed',location:t.areas[0],failureCode:'route-failed',failure:'W: stale route owner'};
   t.advance();t.c.farmAreaTick();assert.equal(t.party.farmAreaState.failures[t.areas[0].id],1);
   t.party.activeConvoy={phase:'failed',location:t.areas[1],failureCode:'owner-lost',failure:'No route found'};
   t.advance(10100);t.c.farmAreaTick();assert.equal(t.party.farmAreaState.failures[t.areas[1].id],undefined);}}],
 // The end code is the failure's cause, so the first route failure leaves the area out of the
 // alternatives; a second strike was needed before, which walked the broken route once more.
 ['one route failure moves the group to another area', ()=>{
  const t=controlFixture();
  t.party.activeConvoy={phase:'failed',location:t.areas[0],failureCode:'route-failed',failure:'W: no path'};
  t.advance();t.c.farmAreaTick();
  assert.equal(t.party.farmAreaState.pending.destination.id,t.areas[1].id);}],
 // Nothing pauses farming travel any more, so the load ends a pause a saved state carries.
 ['a saved recovery pause is cleared, so it never holds farming', ()=>{
 const {loadFarmingRecord}=require('../../runtime/hunting/coordinator/record.ts');
 const loaded=loadFarmingRecord({farmAreaState:{paused:true,failures:{old:2}}},{},()=>1).farmAreaState;
 assert.deepEqual([loaded.paused,loaded.recoveryVersion,loaded.failures],[false,2,{}]);}],
]);
test('wild boar entry point is inside the zone and valid with game collision geometry',()=>{
 const {installGameGeometry}=require('./helpers/game-geometry.cjs');
 const r=createMovementContext({root:{partyFarmingZones:zones},character:{map:'winterland',x:20,y:30,base:{h:8,v:7,vn:2}},G:{}});
 assert.equal(installGameGeometry(r),true);
 // The hunting owner's farm client picks the entry point; shared.js hands it movement's walkable,
 // a point a body can stand on (movement/character/install.ts walk.walkable).
 const {installFarmClient}=require('../../runtime/hunting/character/farm.ts');
 const walkable=p=>r.can_move({map:p.map,x:p.x,y:p.y,going_x:p.x,going_y:p.y,base:r.character.base});
 const ports={character:()=>r.character,walkable,kept:()=>({})};
 const farm=installFarmClient(new Proxy(ports,{get:(t,k)=>k in t?t[k]:()=>null}));
 const area={map:'winterland',x:20,y:-1109,shapes:[{boundary:[-173,-1488,212,-730]}]};
 const point=farm.entryPoint(area);assert.equal(zones.contains(area,point),true);assert.ok(point.y < -730);
});
test('explicit farming route releases completed Escape before authorizing the convoy',()=>{
 const party={escape:{stage:'complete'},farmAreaState:{paused:true,message:'old failure',pending:{},failures:{old:2}}};
 let destination=null;
 const c={party,escapeControl:{release(){party.escape.stage='released';}},farmingNavigation:{authorize(names,point,shared){assert.equal(party.escape.stage,'released');assert.equal(shared,true);destination=point;}}};
 require('./helpers/coordinator-farming-authorization.cjs').installFarmingAuthorization(c);
 const zone={map:'winterland',x:20,y:-1109};c.authorizeFarmingRoute(['W'],zone,true);
 assert.equal(destination,zone);assert.equal(party.farmAreaState.paused,false);assert.equal(party.farmAreaState.message,null);
});

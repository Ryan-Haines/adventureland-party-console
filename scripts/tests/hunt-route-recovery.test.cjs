const test=require('node:test'),assert=require('node:assert/strict');
const {recoverHuntRoute,ownsHuntRoute,routeDestinationKey}=require('../../runtime/coordinator/hunt/route-recovery.ts');
const {movementRelocation}=require('../../runtime/characters/movement-relocation.ts');
const copy=x=>JSON.parse(JSON.stringify(x));
const destination={map:'level4',x:-238,y:-274},alternate={map:'arena',x:0,y:-500},exit={map:'main',x:100,y:200};
function fixture(engine='native') {
 const hunt={cycleId:'hunt1',stage:'mission-travel',participants:['L','F'],missions:[{target:'cgoo',owners:['L'],destination}],currentIndex:0,target:'cgoo'};
 const state={leader:'L',monsterHunt:hunt,statuses:{},commands:{},monsterChoices:[{id:'cgoo',locations:[destination,alternate]}]};
 for(const n of hunt.participants) state.statuses[n]={map:'arena',x:0,y:-500,seenAt:1000,hp:100,server:'I',movementGeometry:{version:17175,fingerprint:'G'},monsterHunt:{id:'cgoo',count:9,remainingMs:100000}};
 const started=[];let id=0,persists=0;
 const ports={now:()=>1000,fresh:()=>true,intent:()=>({revision:1}),persist:()=>persists++,cancelConvoy:()=>{state.activeConvoy=null;state.commands={};},
 start(h,d,label,stage){if(state.activeConvoy)return false;const c=state.activeConvoy={id:'retry'+(++id),epoch:1,location:d,purpose:'monster-hunt',phase:'assemble',participants:h.participants};h.convoyId=c.id;h.stage=stage;for(const n of h.participants)state.commands[n]={id,type:'party-monster-travel',purpose:'monster-hunt',convoyId:c.id};started.push(d);return true;}};
 function fail(engine='native',reason='Native planning timed out (30 seconds)') {
  const c=state.activeConvoy ||= {id:'original',epoch:1,location:destination,purpose:'monster-hunt'};
  Object.assign(c,{phase:'failed',failureCode:'route-failed',failure:reason,failureDetails:{movement:{engine,failureContext:{relocation:{method:'door',origin:{map:'arena',x:0,y:-500},destination:exit}}}}});
 }
 fail(engine);
 return {hunt,state,ports,started,fail,step:()=>recoverHuntRoute(hunt,state,ports),entry:()=>hunt.routeRecovery[routeDestinationKey(destination)],get persists(){return persists;}};
}
function reachExit(r){r.state.activeConvoy=null;r.state.commands={};for(const n of ['L','F'])Object.assign(r.state.statuses[n],exit);r.step();}
test('native exhaustion relocates once, verifies every member, retries ALClient once, then selects another spawn',()=>{
 const r=fixture();r.step();assert.deepEqual(r.started,[exit]);assert.equal(r.entry().attempts.length,1);
 assert.equal(r.state.activeConvoy.routeRecovery.stage,'relocation');
 r.state.activeConvoy=null;r.state.commands={};Object.assign(r.state.statuses.L,exit);r.step();
 assert.equal(r.entry().phase,'relocation','one member cannot verify party relocation');
 reachExit(r);assert.equal(r.entry().phase,'post-relocation');assert.deepEqual(r.started.at(-1),destination);
 assert.equal(r.state.activeConvoy.nativeFallback,false);
 r.fail('alclient','Final route still blocked');r.step();
 assert.equal(r.entry().phase,'excluded');assert.equal(r.entry().attempts.length,2);
 assert.equal(r.hunt.missions[0].destination.map,'arena');assert.equal(r.hunt.missions[0].destinationVersion,1);
 assert.equal(r.entry().firstFailure,'Native planning timed out (30 seconds)');
});
test('an ALClient execution failure gets one full native attempt before relocation',()=>{
 const r=fixture('alclient');r.step();assert.equal(r.entry().phase,'native');
 assert.equal(r.state.activeConvoy.nativeFallback,true);assert.equal(r.state.commands.L.nativeFallback,true);
 r.fail();r.step();assert.equal(r.entry().phase,'relocation');assert.deepEqual(r.started,[destination,exit]);
});
test('an inaccessible origin holds without cycling through other spawn destinations',()=>{
 const r=fixture();r.step();r.fail('native','Ordinary exit is inaccessible');r.step();
 assert.equal(r.entry().phase,'held');assert.match(r.hunt.message,/Cannot escape origin.*Ordinary exit/);
 const count=r.entry().attempts.length;for(let i=0;i<6;i++)r.step();
 assert.equal(r.entry().attempts.length,count);assert.deepEqual(r.started,[exit]);
});
test('a restored farming reunion inherits the same failure budget and root cause',()=>{
 const r=fixture();r.step();reachExit(r);
 const restored=copy(r.hunt);Object.assign(r.hunt,restored);
 Object.assign(r.state.activeConvoy,{id:'farm-child',routeRecovery:undefined,purpose:'shared-walk',walkingActivity:'farm-recovery'});
 r.fail('alclient','still blocked');r.step();assert.equal(r.entry().phase,'excluded');
 assert.equal(r.entry().attempts.length,2);assert.match(r.entry().firstFailure,/Native planning/);
});
test('exhausting every spawn leaves an explicit hold with no new convoy',()=>{
 const r=fixture();r.state.monsterChoices[0].locations=[destination];r.step();reachExit(r);r.fail('alclient','No route');r.step();
 assert.match(r.hunt.message,/No reachable cgoo spawn remains/);const count=r.started.length;r.step();assert.equal(r.started.length,count);
});
for(const kind of ['event','merchant','revision','cancelled','dead','turn-in'])test('recovery does not consume attempts or replace '+kind+' ownership',()=>{
 const r=fixture();
 if(kind==='event')r.state.statuses.L.activeEvent='anniversary';
 if(kind==='merchant')r.state.commands.L={type:'equip-deliveries',id:9};
 if(kind==='revision'){r.state.activeConvoy.expected={L:{revision:0}};}
 if(kind==='cancelled')r.ports.intent=()=>({revision:1,cancelled:true});
 if(kind==='dead')r.ports.fresh=()=>false;
 if(kind==='turn-in')r.state.statuses.L.monsterHunt.count=0;
 assert.equal(r.step(),false);assert.equal(r.hunt.routeRecovery,undefined);assert.equal(r.started.length,0);
});
test('a real geometry change clears exhausted history and grants a fresh attempt',()=>{
 const r=fixture();r.step();r.fail();r.step();assert.equal(r.entry().phase,'held');
 r.state.statuses.L.movementGeometry.fingerprint='new';assert.equal(r.step(),false);
 assert.equal(r.hunt.routeRecovery[routeDestinationKey(destination)],undefined);assert.equal(r.state.activeConvoy,null);
});
test('legacy failure without relocation data reports missing evidence, not a fabricated exit',()=>{
 const r=fixture();r.state.activeConvoy.failureDetails={movement:{engine:'native'}};r.step();
 assert.equal(r.entry().phase,'held');assert.match(r.hunt.message,/no permitted relocation was reported/);assert.equal(r.started.length,0);
});
test('unrelated destinations and event walks do not inherit Hunt route budgets',()=>{
 const r=fixture();assert.equal(ownsHuntRoute(r.hunt,{location:exit,purpose:'monster-hunt'}),false);
 assert.equal(ownsHuntRoute(r.hunt,{location:destination,purpose:'shared-walk',walkingActivity:'event'}),false);
 assert.equal(ownsHuntRoute({stage:'returning'},{}),false);
});
test('relocation respects Town policy, instance restrictions and actual ordinary door metadata',()=>{
 const game={maps:{arena:{spawns:[[0,0]],doors:[[10,10,20,20,'main',1,0]]},main:{spawns:[[0,0],[100,200]]}},npcs:{}};
 const origin={map:'arena',x:0,y:-500};
 assert.equal(movementRelocation(game,origin,true).method,'town');
 assert.deepEqual(movementRelocation(game,origin,false).destination,exit);
 game.maps.arena.doors[0][7]='key';assert.equal(movementRelocation(game,origin,false),undefined);
 game.maps.arena.instance=true;assert.equal(movementRelocation(game,origin,true),undefined);
});


test('restart between failure report and Hunt tick preserves the original failure evidence',()=>{
 const r=fixture();const {initialCommandState}=require('../../runtime/coordinator/navigation/initial-commands.ts');
 const saved=initialCommandState({activeConvoy:copy(r.state.activeConvoy)},()=>2000);
 assert.equal(saved.activeConvoy.failureCode,'route-failed');assert.match(saved.activeConvoy.failure,/Native planning timed out/);
 assert.equal(saved.activeConvoy.restartRecovery,false);assert.ok(saved.activeConvoy.failureDetails.movement.failureContext.relocation);
 Object.assign(r.state,saved);r.step();assert.equal(r.entry().phase,'relocation');
});


test('a previously misclassified readiness failure cannot poison the persisted route budget',()=>{
 const r=fixture();r.step();r.entry().firstFailure='GDroidPT: Leader moved from planning origin';
 assert.equal(r.step(),false);assert.equal(r.state.activeConvoy,null);assert.equal(r.hunt.routeRecovery[routeDestinationKey(destination)],undefined);
});


test('temporary relocation keeps the public farming destination at the original monster spawn',()=>{
 const r=fixture();r.ports.start=((original)=>(...args)=>{r.state.location=args[1];return original(...args);})(r.ports.start);
 r.step();assert.deepEqual(r.state.activeConvoy.location,exit);assert.deepEqual(r.state.location,destination);
 assert.deepEqual(r.hunt.missions[0].destination,destination);
});
test('a previously adopted recovery exit is repaired from the retained catalogued monster destination',()=>{
 const r=fixture();r.step();r.entry().firstFailure='Leader moved from planning origin';
 r.hunt.missions[0].destination=exit;r.state.activeConvoy.routeRecovery=undefined;r.hunt.convoyId=r.state.activeConvoy.id;
 assert.equal(r.step(),true);assert.deepEqual(r.hunt.missions[0].destination,destination);assert.equal(r.state.activeConvoy,null);
 assert.equal(r.step(),false);assert.equal(r.hunt.routeRecovery[routeDestinationKey(destination)],undefined);
});

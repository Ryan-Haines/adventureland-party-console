const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {installPartyMovement}=require('../../runtime/movement/character/owner.ts');
// The replay has no departure fight.
require('../../runtime/hooks/index.ts').partyHooks().publish({ name: 'core:targeting', folder: 'core', author: 'test', summary: 'The departure fight read the movement owner asks.',
  hooks: { 'targeting.departurePending': () => false } });
const {createNative}=require('./pathfinder-benchmark/native.cjs');
const {directory}=require('../../scripts/tests/helpers/installed-game.cjs');
const fixture=require('../../scripts/tests/fixtures/cave-combat-forward-rejoin.json');
// Movement's `act` handle on the process's run scope, as shared.js gives the owner (scopes.act02).
const {testScope}=require('../../scripts/tests/helpers/run-scope.cjs');
async function main(){
 const native=createNative(directory);native.game.geometry[fixture.map]=fixture.geometry;native.game.maps[fixture.map]=fixture.mapData;
 const results=[];
 for(const observed of [fixture,fixture.second]){
  let stall=true,now=0,searches=0;const calls=[],logs=[];
  const initial=observed.initial||observed.from;
  const c={name:'Replay',map:fixture.map,in:fixture.map,x:initial.x,y:initial.y,real_x:initial.x,real_y:initial.y,base:fixture.base,items:[],moving:false};
  const host={character:c,G:native.game,smart:{moving:false,plot:[]},parent:{socket:{emit(){throw Error('Replay forbids network');}},push_deferred:()=>Promise.resolve()},
   smart_move:()=>Promise.resolve(),stop:()=>Promise.resolve(),smart_move_logic(){},start_pathfinding(){searches++;throw Error('Direct geometry replay must not start BFS');},continue_pathfinding(){},
   move:async(x,y)=>{if(!stall){assert.ok(native.context.can_move({map:c.map,x:c.real_x,y:c.real_y,going_x:x,going_y:y,base:c.base}));calls.push({from:{x:c.real_x,y:c.real_y},to:{x,y}});Object.assign(c,{x,y,real_x:x,real_y:y});}},
   can_use:()=>true,can_walk:()=>true,is_transporting:()=>false,can_move:input=>native.context.can_move(input),is_door_close:()=>false,can_use_door:()=>false,find_npc:()=>null,game_log(){}};
  const service=installPartyMovement(host,{now:()=>now,current:()=>true,pauses:{manual:()=>false,drainPark:()=>false,caveHolds:()=>false,held:()=>false},scope:testScope('02','act'),request(){throw Error('Replay forbids HTTP planning');},events:(type,message,event)=>logs.push(event),departureChests:()=>[]});
  let completed=false,error;const destination=observed.path.at(-1);
  const promise=service.move(destination,undefined,{native:true,shared:true,awaitSharedRoute:true,repairSharedDrift:true}).then(()=>completed=true,e=>error=e);
  service.install(observed.path,service.identity,'captured-cave-convoy');host.smart_move_logic();await new Promise(r=>setImmediate(r));await host.stop('move');
  Object.assign(c,{x:observed.displaced.x,y:observed.displaced.y,real_x:observed.displaced.x,real_y:observed.displaced.y});stall=false;
  for(let i=0;i<40&&!completed&&!error;i++){now+=100;host.smart_move_logic();await new Promise(r=>setImmediate(r));}
  if(error)throw error;assert.ok(completed,'Owned native destination must be reached');await promise;
  assert.equal(searches,0);assert.equal(c.real_x,destination.x);assert.equal(c.real_y,destination.y);
  assert.ok(logs.some(e=>e.phase==='Rejoined forward walking segment'));
  results.push({source:fixture.source,from:observed.from,displaced:observed.displaced,destination,completed,searches,calls,logs});service.dispose();
 }
 const output=path.resolve(process.argv[2]||'.build/cave-forward-replay.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results},null,2));
 console.log(JSON.stringify({output,scenarios:results.length,completed:results.every(r=>r.completed),searches:results.map(r=>r.searches)}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});

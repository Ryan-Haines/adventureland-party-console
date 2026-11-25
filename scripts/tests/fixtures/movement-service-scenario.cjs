// The movement service's scenario builder (a shared
// setup lives in the harness). `fixture` installs the real service (runtime/movement/character/owner.ts)
// on a stub game host; `reachedWalkFixture` runs the executor on a reached plot, and
// `correctionFixture` adds the game's pinned correction handler.
const {installPartyMovement}=require('../../../runtime/movement/character/owner.ts');
const {testScope}=require('../helpers/run-scope.cjs');
// No departure fight is pending in these rows (the departure gate's published read), and
// `targetIds` records each combat target write the owner asks of targeting.
const targetIds=[];
require('../../../runtime/hooks/index.ts').partyHooks().publish({ name: 'core:targeting', folder: 'core', author: 'test', summary: 'The targeting reads and writes the movement owner asks.',
  hooks: { 'targeting.departurePending': () => false, 'targeting.setTargetId': (id,by) => { targetIds.push([id,by]); } } });
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}) {
 let now=1000, revision=1, runtime='test', searches=0, request;
 const calls=[], logs=[], c={name:'Test',map:'main',in:'main',x:0,y:0,real_x:0,real_y:0,speed:60,base:{h:8,v:7,vn:2},items:[],moving:false};
 const G={version:16846,geometry:{},maps:{main:{spawns:[[0,0]],doors:[],npcs:[]},bank:{spawns:[[0,0]],doors:[],npcs:[]},...options.maps},npcs:{transporter:{places:{}}}};
 const host={character:c,G,smart:{moving:false,plot:[]},parent:{socket:options.socket||{emit:(...a)=>calls.push(a)},push_deferred:()=>Promise.resolve()},
  smart_move:()=>{host.smart.moving=true;host.smart.found=false;host.smart.searching=false;return Promise.resolve();},
  stop:async()=>{host.smart.moving=false;},smart_move_logic(){},start_pathfinding:()=>{searches++;host.smart.found=true;host.smart.plot=options.nativePlot||[{map:'main',x:100,y:0}];},continue_pathfinding(){},
  move:async(x,y)=>{calls.push(['move',x,y]);if(!options.stall)Object.assign(c,{x,y,real_x:x,real_y:y});},use:async()=>{calls.push(['town']);Object.assign(c,{x:0,y:0,real_x:0,real_y:0});},
  can_use:()=>true,can_walk:()=>true,is_transporting:()=>false,can_move:p=>!(options.collision&&p.going_x===50),
  is_door_close:()=>true,can_use_door:()=>true,find_npc:()=>null,game_log(){} };
 const ports={now:()=>now,current:()=>true,pauses:{manual:()=>false,drainPark:()=>false,caveHolds:()=>false,held:()=>false},
  request:async(_,o)=>{request=o.body;if(options.pending)return new Promise(resolve=>{fixture.resolve=resolve;});if(options.offline)throw Error(options.planError || 'offline');return {...request,plot:options.plot||[{map:'main',x:100,y:0}]};},
  events:(type,m,e)=>logs.push({...e,message:m}),departureChests:()=>[],
  // Movement's `act` handle on the process's run scope (shared.js `scopes.act02`), which carries the
  // crossings' reply bounds (owner.ts `replyBound`).
  scope:testScope('02','act')};
 const service=installPartyMovement(host,ports);
 // The owner's walk state: the navigation revision and the runtime id a test supersedes or reloads.
 Object.assign(service.walkState,{intent:{revision,cancelled:false},runtimeId:runtime});
 return {service,host,c,calls,logs,ports,get request(){return request;},get searches(){return searches;},setNow:t=>now=t,
  supersede:()=>{service.walkState.intent={revision:++revision,cancelled:false};},reload:()=>{service.walkState.runtimeId=runtime='new';},
  async ticks(count=8){for(let i=0;i<count;i++){host.smart_move_logic();await settle();}},dispose:()=>service.dispose()};
}

function reachedWalkFixture(plot) {
 const {createMovementExecutor}=require('../../../runtime/movement/character/executor.ts');
 let now=1000,transporting=false;const calls=[];
 const character={map:'main',in:'main',real_x:177,real_y:460,moving:false};
 const host={character,move:(x,y)=>{calls.push([x,y]);character.moving=true;return Promise.resolve();},
  can_walk:()=>true,is_transporting:()=>transporting,can_use:()=>true,
  town:()=>{calls.push('town');return new Promise(()=>{});}};
 const state={plot,use_town:true};
 const executor=createMovementExecutor(host,state,{game:{maps:{main:{spawns:[[177,460]]},bank:{}}},walk:()=>true},()=>now,{townReady:()=>true,transitionReady:()=>true,judge:()=>()=>'clear'},{band:()=>'job',stopTown:()=>Promise.resolve(),standStill:()=>Promise.resolve(),roundTrip:()=>0});
 return {executor,host,state,calls,character,setNow:value=>now=value,setTransporting:value=>transporting=value};
}

// Retained pinned native functions execute before the maintained CODE listener.
function correctionFixture(options={}) {
 const {EventEmitter}=require('node:events'),vm=require('node:vm');
 const socket=new EventEmitter();let actor;
 const native=require('./native-correction-contract.json');
 const context=vm.createContext({socket, get character(){return actor;}, can_move:()=>options.accept!==false,
  add_log(){},phrase:{html:s=>s},console:{log(){}},sqrt:Math.sqrt,sq:x=>x*x,Place:'game'});
 vm.runInContext(native.velocity+';'+native.correction,context);
 const r=fixture({stall:true,socket,...options});actor=r.c;
 Object.assign(actor,{from_x:0,from_y:0,going_x:100,going_y:0,vx:60,vy:0,ref_speed:60});
 return {...r,socket};
}

module.exports = { settle, fixture, reachedWalkFixture, correctionFixture, targetIds };

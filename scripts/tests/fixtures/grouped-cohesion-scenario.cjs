// Setups for the grouped cohesion tests (scripts/tests/grouped-cohesion.test.cjs), in the shared harness.
// The coordinator group of three members, and one member's regroup movement over shared.js.
const fs=require('node:fs');
const { targetingContext } = require('../helpers/targeting-module.cjs');
const shared=fs.readFileSync('characters/shared.js','utf8');
function fixture(){
  return ['W','P','M'].map((name,i)=>({name,ctype:['warrior','priest','mage'][i],revision:1,
    status:{seenAt:1000,hp:100,map:'cave',in:'cave',server:'USII',x:i*20,y:0,range:200,
      combatSelection:{id:null,map:null,revision:0,runtimeId:name+'-runtime'},groupedCombat:{protocol:4,anchorVisible:true,ack:null}}}));
}
function movement(){
  let now=1000;const moves=[],paths=[];
  const c=targetingContext({Date:{now:()=>now},Math,JSON,Promise,Infinity,
    character:{name:'W',ctype:'warrior',map:'main',in:'main',x:0,y:0,speed:40},
    leader:'W',convoyRuntimeId:'W-runtime',coordinatorClockOffset:0,navigationIntent:{revision:1,cancelled:false},
    partyConvoyActive:false,groupWalk:{travel:null},partyLocation:null,game_log(){},
    G:{maps:{main:{spawns:[[0,0]],doors:[]},cave:{spawns:[[0,0]],doors:[]}}},sleep:()=>new Promise(()=>{}),
    groupedCombat:{key:'["W-runtime"]',leader:'W',members:['W','P'],seenAt:1000,ready:false,range:180,
      anchor:{name:'P',server:'USII',map:'cave',in:'cave',x:200,y:0},blockers:['W: different map'],priest:'P'},
    groupedFarming:()=>true,rareActive:()=>false,reunionRealm:()=> 'USII',runtimeCurrent:()=>true,
    get_player:()=>null,get_entity:()=>null,isExternallyClaimedMonster:()=>false,isAttackingPartyMember:()=>false,parent:{entities:{}},
    cancelFarmApproach(){},can_move_to:()=>false,safeCombatPoint:()=>true,stop:()=>Promise.resolve(),
    move:(x,y)=>{moves.push([x,y]);return Promise.resolve();},smart:{},
    root:{sharedRoutine:{isOccupied:()=>false,defensiveFormationMove:()=>false}},
    smart_move:destination=>{paths.push(destination);c.smart.on_done=()=>{};return new Promise(()=>{});},
  // W leads the group on the tasks owner's door, which the queue's freshness reads (queue-client.ts `groupedFresh`).
  },{},{tasks:{membership:{leader:()=>'W'}}});
  // The group moves read the passive rare candidate from the hunting owner's rare client, which hunts no rare here.
  c.passiveRareCandidate=require('../helpers/rare-client.cjs').rareClient({hunts:{}}).candidate;require('../helpers/queue-markers.cjs').installQueueMarkers(c);
  require('../helpers/group-movement.cjs').installGroupMoves(c);
  return {c,moves,paths,at(t){now=t;c.groupedCombat.seenAt=t;}};
}
// A member cut off from its group: its farm spot is on main, every walk fails, and its
// movement owner climbs the regroup's task ladder (helpers/task-ladder.cjs).
function cutOff(ports){
  const f=movement(),{ladders}=require('../helpers/task-ladder.cjs').taskLadder(f.c,ports);
  f.c.partyLocation={map:'main',x:500,y:0};
  f.c.smart_move=destination=>{f.paths.push(destination);return Promise.reject(Error('no route'));};
  return {...f,ladders};
}
module.exports={fixture,movement,cutOff};

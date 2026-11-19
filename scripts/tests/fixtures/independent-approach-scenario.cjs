// Setups for the independent approach client tests (scripts/tests/independent-approach-client.test.cjs),
// in the shared harness. The approach client with its ports, and the ports snapshot.
const {installCombatSteps} = require('../helpers/combat-steps.cjs');
const {installApproach} = require('../helpers/approach.cjs');
const vm=require('node:vm');
const {createIndependentApproachClient}=require('../../../runtime/movement/character/approach.ts');
function fixture(retarget){const ctx={allowed:true,planned:true,key:'USII:uhills:target',target:'target',point:{x:100,y:100},radius:200,selection:'s1',committed:false};const notices=[];let owner=null,throwing=false,ready=false,buffered=true,now=10000,clear=true;
 const routes=[];const client=createIndependentApproachClient({context:()=>ctx,now:()=>now,ready:()=>ready,buffered:()=>buffered,clear:()=>clear,goal:(p,r)=>({x:p.x-r,y:p.y}),
  start:(goal,id,direct)=>{if(throwing)throw Error('native start rejected');owner=id;return new Promise((resolve,reject)=>routes.push({goal,id,direct,resolve,reject}));},
  ...(retarget?{retarget:(goal,id)=>owner===id&&retarget(goal,id)}:{}),
  owned:id=>owner===id,cancel:id=>{if(owner===id)owner=null;},position:()=>{},unreachable:target=>notices.push(target)});
 return {client,routes,ctx,notices,get owner(){return owner;},set throwing(v){throwing=v;},set ready(v){ready=v;},set buffered(v){buffered=v;},set now(v){now=v;},set clear(v){clear=v;}};}
function snapshotPorts(){
 let entity=null;const moves=[];
 const c=vm.createContext({Date,character:{name:'M',ctype:'mage',x:0,y:0,real_x:0,real_y:0,range:200,map:'uhills',in:'uhills',rip:false,base:{h:8,v:7,vn:2}},navigationIntent:{cancelled:false,revision:1},coordinatorClockOffset:0,
  groupedCombat:{independentApproach:true,key:'runtime',selection:'s1',committed:false,target:{id:'boss',x:400,y:0,map:'uhills',in:'uhills',server:'USII',state:'planned'}},partyConvoyActive:false,groupWalk:{travel:null},eventTraveling:false,joinedEvent:null,
  groupedFarming:()=>true,groupedFresh:()=>true,dungeonOwned:()=>false,runtimeCurrent:()=>true,reunionRealm:()=> 'USII',isAttackingPartyMember:()=>false,
  parent:{socket:{connected:true},entities:{}},get_entity:()=>entity,is_in_range:e=>Math.hypot(e.x-c.character.real_x,e.y-c.character.real_y)<=c.character.range,can_move_to:()=>true,can_move:()=>true,
  combatApproachPoint:(e,r)=>({x:e.x-r,y:e.y}),cancelGroupRoute:()=>{},cancelFarmApproach:()=>{},resetCombatMovement:()=>{},movement:{consolePaused:()=>false,report:()=>null,tick:()=>{},move:(goal,callback,options)=>{moves.push({goal,options});return Promise.resolve();}},
  root:{partyRoleRunner:{isKnownDead:()=>false}}});
 installApproach(c);return {c,moves,ports:c.independentApproachPorts(),set entity(v){entity=v;}};
}
// The combat steps' approach point (runtime/movement/character/steps.ts) over a character out of
// native range by default.
function approachPointContext(context){
 // The game's `distance` on the CODE frame, which the steps read for the attack distance.
 const c=vm.createContext({distance:()=>100,is_in_range:()=>false,...context});
 installCombatSteps(c);
 return c;
}
module.exports={fixture,snapshotPorts,approachPointContext};

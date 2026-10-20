// Achievement Hunt bosses on the fighter side (docs/achievement-hunt.md § Bosses, failure modes 29 and 38 to 40).
// The real shared.js functions and the built role runner run in a VM with the boss
// geometry; the e2e game server cannot place a boss next to farm targets on demand.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {namedFunction}=require('./helpers/named-function.cjs');
const source=fs.readFileSync('characters/shared.js','utf8');
const slice=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to));

const monsters={stompy:{range:64,speed:40,aggro:0.2},mrpumpkin:{range:520,speed:40,aggro:0.05},
  mrgreen:{range:620,speed:40,aggro:1},wolf:{range:30,speed:30},xscorpion:{range:40,speed:30}};
// 64 * sqrt(2) of aggro reach plus 1.5 s of a speed 40 walk; Mr. Green adds 40.
const ZONE=64*Math.SQRT2+60;

function fixture(entities,{self={},avoid=['stompy'],walkable=()=>true}={}){
 const moves=[];
 const character={name:'Sadokunn',ctype:'warrior',map:'winterland',in:'winterland',x:600,y:0,range:50,speed:55,...self};
 const r=require('./helpers/client-dependencies.cjs').passingContext({travelCombatActive:()=>false,root:{},character,
  groupedCombat:null,groupedFarming:()=>true,unfinishedFight:()=>false,groupedFresh:()=>true,
  leaderLockAllows:()=>true,reunionRealm:()=> 'USIII',rareTarget:()=>null,
  isExternallyClaimedMonster:()=>false,isAttackingPartyMember:e=>e.target==='Sadokunn',activeCombatEvent:()=>false,joinedEvent:null,isPartyThreat:()=>false,
  inFarmArea:()=>true,inFarmRadius:()=>true,partyLocation:{},combatTargetId:null,lastAttackTarget:null,lastAttackAt:0,farmApproach:{failed:{}},
  convoyTraveling:false,partyThreats:[],scatterBreakTarget:null,eventTargetTypes:[],farmingMode:'default',partyFarmingMonsterType:null,
  followLeader:false,leaderTarget:null,smart:{moving:false},kiteState:{},formationFrame:null,formationPerformance:{collisionChecks:0},
  distance:(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),is_in_range:e=>Math.hypot(e.x-character.x,e.y-character.y)<=character.range,
  can_move_to:(x,y)=>walkable(x,y),move:(x,y)=>{moves.push({x,y});character.moving=true;character.going_x=x;character.going_y=y;return Promise.resolve();},
  formationMembers:()=>[character],
  monsterFocus:['wolf','xscorpion'],avoidMonsters:avoid,parent:{entities},G:{monsters}});
 vm.runInContext(slice('  /** Visible, living bosses from the coordinator\'s avoid list. */','  function rareSightings('),r);
 vm.runInContext(slice('  function isAllowedTarget(','  function sameEventTeamMember('),r);
 vm.runInContext(['desiredCombatRange','combatDistance','combatApproachPoint','safeCombatPoint','sendCombatMove'].map(n=>namedFunction(source,n)).join('\n'),r);
 r.moves=moves;
 return r;
}
const mob=(id,mtype,x,y=0,extra={})=>({id,type:'monster',mtype,visible:true,x,y,...extra});
const boss=(mtype,x,y=0,extra={})=>mob('boss',mtype,x,y,{target:null,...extra});
const reason=(r,target)=>{const d={};r.isAllowedTarget(target,null,d);return d.reason;};
const gap=(p,q)=>Math.hypot(p.x-q.x,p.y-q.y);

test('Mr. Pumpkin blocks only the scorpions inside its keep-out zone, not its whole spawn (failure mode 38)',()=>{
 // The old rule kept pulls 150 + 2 * 520 = 1190 px from Mr. Pumpkin: every scorpion in the box.
 const r=fixture({boss:boss('mrpumpkin',0)},{avoid:['mrpumpkin']});
 assert.equal(r.isAllowedTarget(mob('far','xscorpion',200)),true);
 assert.equal(reason(r,mob('near','xscorpion',120)),'boss keep-out zone');
});
test('the spot the character attacks from counts, not only the target',()=>{
 // A melee character west of the boss closes on a scorpion 180 px east of it from the west side, inside the zone.
 const r=fixture({boss:boss('mrpumpkin',0)},{avoid:['mrpumpkin'],self:{x:-600}});
 assert.ok(180>ZONE);
 assert.equal(reason(r,mob('east','xscorpion',180)),'boss keep-out zone');
 // A ranged character already in range attacks from where it stands.
 const ranged=fixture({boss:boss('mrpumpkin',0)},{avoid:['mrpumpkin'],self:{x:500,range:400,ctype:'ranger'}});
 assert.equal(ranged.isAllowedTarget(mob('east','xscorpion',180)),true);
});
test('a walking boss blocks the ground it reaches within 2 seconds; Mr. Green carries a wider zone',()=>{
 const target=mob('w','wolf',220);
 assert.equal(fixture({boss:boss('stompy',0)}).isAllowedTarget(target),true);
 // Stompy walks east at 40 px/s and covers the 69 px to the zone edge in 1.7 s.
 const walking=fixture({boss:boss('stompy',0,0,{moving:true,going_x:1000,going_y:0})});
 assert.equal(reason(walking,target),'boss keep-out zone');
 assert.equal(walking.isAllowedTarget(mob('w2','wolf',260)),true);
 const green=fixture({boss:boss('mrgreen',0)},{avoid:['mrgreen']});
 assert.equal(reason(green,mob('x','xscorpion',ZONE+20)),'boss keep-out zone');
 assert.equal(green.isAllowedTarget(mob('x2','xscorpion',ZONE+60)),true);
});
test('the party never targets an avoided boss, even one attacking it, except in its own event (failure mode 39)',()=>{
 const pumpkin=boss('mrpumpkin',300,0,{target:'Sadokunn'});
 const r=fixture({boss:pumpkin},{avoid:['mrpumpkin']});
 assert.equal(reason(r,pumpkin),'avoided boss');
 r.joinedEvent='mrpumpkin';
 assert.equal(r.isAllowedTarget(pumpkin),true);
});
test('the zone rule never drops a fight already under way or a monster attacking the party',()=>{
 const r=fixture({boss:boss('stompy',0)});
 r.combatTargetId='near';assert.equal(r.isAllowedTarget(mob('near','wolf',100)),true);
 r.combatTargetId=null;assert.equal(r.isAllowedTarget(mob('biting','wolf',100,0,{target:'Sadokunn'})),true);
});
test('without an avoid list, or once the boss is dead or out of sight, pulls next to it are allowed',()=>{
 const near=mob('near','wolf',100);
 assert.equal(fixture({boss:boss('stompy',0)},{avoid:[]}).isAllowedTarget(near),true);
 assert.equal(fixture({boss:boss('stompy',0,0,{dead:true})}).isAllowedTarget(near),true);
 assert.equal(fixture({boss:boss('stompy',0,0,{visible:false})}).isAllowedTarget(near),true);
});
test('combat steps never end inside a zone, except a step out of it',()=>{
 const r=fixture({boss:boss('stompy',0)},{self:{x:200}});
 assert.equal(r.safeCombatPoint({x:140,y:0},null),false);
 assert.equal(r.safeCombatPoint({x:240,y:0},null),true);
 r.character.x=100;r.bossZoneCache=null;
 assert.equal(r.safeCombatPoint({x:130,y:0},null),true);
 assert.equal(r.safeCombatPoint({x:80,y:0},null),false);
});
test('Stompy walks in mid-fight: the tank moves away with the same wolf engaged and attacking (failure mode 40)',()=>{
 const wolf=mob('w','wolf',330,0,{target:'Sadokunn'});
 const stompy=boss('stompy',0,0,{moving:true,going_x:1000,going_y:0});
 const r=fixture({w:wolf,boss:stompy},{self:{x:300}});
 r.combatTargetId='w';
 // 150 px from the zone edge at 40 px/s: 3.7 s away, so the tank keeps its spot.
 assert.equal(r.bossRetreatTick(wolf),false);
 assert.equal(r.moves.length,0);
 stompy.x=100;
 assert.equal(r.bossRetreatTick(wolf),true);
 assert.equal(r.moves.length,1);
 const step=r.moves[0];
 assert.ok(step.x>300,'moves away from Stompy');
 assert.equal(r.bossZoneReaching(step,2),null);
 assert.equal(r.root.partyCombatPosition.mode,'boss-retreat');
 assert.equal(r.root.partyCombatPosition.target,'w');
 assert.equal(r.combatTargetId,'w');
 // The wolf follows its target, and the tank keeps it while the fight moves.
 wolf.x=step.x-20;
 assert.equal(r.isAllowedTarget(wolf),true);
 // The next tick keeps the same destination instead of sending another move.
 r.character.x=320;
 assert.equal(r.bossRetreatTick(wolf),true);
 assert.equal(r.moves.length,1);
});
test('the retreat goes around a wall, stays clear of a second boss and keeps the priest in heal range',()=>{
 const wolf=mob('w','wolf',330,0,{target:'Sadokunn'});
 const priest={name:'Healer',ctype:'priest',x:330,y:-150,range:240};
 const r=fixture({w:wolf,boss:boss('stompy',180),other:mob('other','mrpumpkin',380,260,{target:null})},
  {avoid:['stompy','mrpumpkin'],self:{x:300},walkable:x=>x<=340});
 r.formationMembers=()=>[r.character,priest];
 assert.equal(r.bossRetreatTick(wolf),true);
 const step=r.moves[0];
 assert.ok(step.x<=340,'the wall east of x 340 blocks the straight retreat');
 assert.ok(gap(step,{x:180,y:0})>gap(r.character,{x:180,y:0}),'moves away from Stompy');
 assert.equal(r.bossZoneReaching(step,2),null,'outside both zones');
 const heal=240-24;
 assert.ok(gap(step,priest)<=Math.max(heal,gap(r.character,priest))+0.01,'stays in heal range');
});
test('the retreat leaves a joined event, a convoy and smart_move routes alone',()=>{
 const r=fixture({boss:boss('stompy',250)},{self:{x:300}});
 r.joinedEvent='franky';assert.equal(r.bossRetreatTick(null),false);
 r.joinedEvent=null;r.convoyTraveling={phase:'travelling'};assert.equal(r.bossRetreatTick(null),false);
 r.convoyTraveling=false;r.smart.moving=true;assert.equal(r.bossRetreatTick(null),false);
 r.smart.moving=false;assert.equal(r.bossRetreatTick(null),true);
 assert.equal(r.moves.length,1);
});
test('the status reports visible bosses and whom they attack, for the coordinator to leave the target',()=>{
 const r=fixture({s:{...boss('stompy',0),id:'s',target:'Icelocked'},w:mob('w','wolf',50)});
 assert.deepEqual(JSON.parse(JSON.stringify(r.avoidSightings())),[{id:'s',mtype:'stompy',x:0,y:0,target:'Icelocked'}]);
});

// Counts how often the fighter lists parent.entities.
function countedEntities(entities){
 const scans={count:0};
 return {scans,entities:new Proxy(entities,{ownKeys(target){scans.count++;return Reflect.ownKeys(target);}})};
}
test('one targeting pass lists the entities once for every candidate and the status (failure mode 36)',()=>{
 const wolves=Array.from({length:10},(_,i)=>mob('w'+i,'wolf',300+10*i));
 const counted=countedEntities(Object.fromEntries([['boss',boss('stompy',0)],...wolves.map(w=>[w.id,w])]));
 const r=fixture(counted.entities);
 for(const w of wolves)assert.equal(r.isAllowedTarget(w),true);
 assert.equal(r.avoidSightings().length,1);
 assert.equal(counted.scans.count,1);
});
test('the next pass sees a boss that appeared, and an avoid list change applies at once (failure mode 37)',async()=>{
 const entities={};
 const r=fixture(entities),near=mob('near','wolf',100);
 assert.equal(r.isAllowedTarget(near),true);
 entities.boss=boss('stompy',0);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(r.isAllowedTarget(near),false);
 r.avoidMonsters=[];
 assert.equal(r.isAllowedTarget(near),true);
});

// Runs the role runner that npm run build:runtime writes to .build/runtime/roles.js,
// so the test exercises the movement loop's real order.
function roleRunner(retreat){
 const calls=[],intervals=[],timeouts=[];let attacks=0;
 const target={id:'w',type:'monster',mtype:'wolf',visible:true,x:20,y:0,map:'winterland'};
 const routine={
  isOccupied:()=>false,getAbtestingMode:()=>null,getFarmingMode:()=>'default',hasScatterBreakTarget:()=>false,getScatterBreakTarget:()=>null,
  getEventTarget:()=>null,shouldFollowLeader:()=>false,getPreferredTarget:()=>target,allowsTarget:()=>true,setCombatTarget(){},noteAttack(){},
  followLeaderIfFar:async()=>false,regenerateHpOrMp:()=>new Promise(()=>{}),smartLoot:async()=>{},kiteIfNeeded:async()=>false,
  approachCombatTarget:()=>{calls.push('approach');return new Promise(()=>{});},basicAttackReserved:()=>false,healPartyBelow:async()=>{},
  resetCombatMovement(){},useRecoveryPotion:async()=>false,absorbSinsBelow:async()=>false,
  bossRetreatTick:t=>{calls.push(['retreat',t&&t.id]);return retreat;},
  groupedMovement:()=>{calls.push('grouped');return false;},getNearestPartyTarget:()=>null,getNearestPartyAttacker:()=>null,
 };
 const c=vm.createContext({character:{name:'Sadokunn',ctype:'warrior',map:'winterland',in:'winterland',moving:false,frequency:2,slots:{mainhand:null,offhand:null},items:[]},
  parent:{caracAL:{}},sharedRoutine:routine,get_entity:()=>target,G:{items:{},classes:{},skills:{}},
  can_attack:()=>true,is_in_range:()=>true,game_log(){},attack:()=>{attacks++;return new Promise(()=>{});},
  setInterval:(fn,ms)=>{const entry={fn,ms};intervals.push(entry);return entry;},clearInterval:entry=>{if(entry)entry.off=true;},
  setTimeout:(fn,ms)=>{const entry={fn,ms};timeouts.push(entry);return entry;},clearTimeout:entry=>{if(entry)entry.off=true;}});
 vm.runInContext(fs.readFileSync('.build/runtime/roles.js','utf8'),c);c.partyRoleRunner.start();
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
 return {calls,attacks:()=>attacks,flush,c,
  tick:async ms=>{intervals.filter(t=>t.ms===ms&&!t.off).forEach(t=>t.fn());await flush();},
  attackTick:()=>{const entry=timeouts.find(t=>!t.off&&String(t.fn).includes('tick()'));if(entry){entry.off=true;entry.fn();}}};
}
test('the movement loop runs the retreat with the current target ahead of grouped movement and the approach (failure mode 40)',async()=>{
 const r=roleRunner(true);await r.flush();await r.tick(1000);await r.tick(250);r.calls.length=0;
 await r.tick(100);
 assert.deepEqual(r.calls,[['retreat','w']],'a retreat claims the tick');
 r.attackTick();assert.equal(r.attacks(),1,'the attack loop keeps attacking the target');
 r.c.partyRoleRunner.stop();
});
test('the movement loop goes on to grouped movement when no zone is coming (failure mode 40)',async()=>{
 const r=roleRunner(false);await r.flush();await r.tick(1000);await r.tick(250);r.calls.length=0;
 await r.tick(100);
 assert.deepEqual(r.calls.slice(0,2),[['retreat','w'],'grouped']);
 r.c.partyRoleRunner.stop();
});

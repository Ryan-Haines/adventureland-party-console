// The formation solver and the terrain recovery movers around it,
// as scenario tables split by sub-behaviour. The
// setups live in the harness (fixtures/formation-scenario.cjs); sliced shared.js functions run on
// the shared movement harness, so every combat step goes through the owner.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { formationScenario, approachParty, roleRunnerBundle, survivalHalf, turnsPorts } = require('./fixtures/formation-scenario.cjs');
const { routineModule, drivePositions } = require('./helpers/targeting-module.cjs');

const { movementTick } = require('./helpers/movement-tick.cjs');
const { plantCallsWhenCreated } = require('./helpers/planted-calls.cjs');
const { update } = require('./helpers/run-scope.cjs');

scenarioTable('formation solver: grouped defense and the shared nomination (MOV-085a)', formationScenario, [
['Default defense requires one shared target; local attackers cannot nominate independently',({c,monster,entities})=>{
 assert.equal(c.isAttackingPartyMember(monster),true);
 assert.equal(c.groupedAttackAllowed(monster),false);
 c.groupedCombat={protocol:4,key:'["runtime"]',leader:'W',members:['W','P'],seenAt:1,selection:'A',
  committed:true,priest:'P',target:{...monster,server:'USII',state:'engaged'},fights:[monster]};
 assert.equal(c.groupedAttackAllowed(monster),true,'confirmed engagement survives stale coordinator');
 entities.B={...monster,id:'B',target:'W'};assert.equal(c.groupedAttackAllowed(entities.B),false);
 assert.equal(c.groupedDefensiveTarget().id,'A');
}],
['party attackers block an untouched shared nomination but never its confirmed engagement',({c,monster,entities})=>{
 monster.target=null;
 c.groupedCombat={protocol:4,key:'["runtime"]',leader:'W',members:['W','P'],seenAt:10000,selection:'A',
  committed:true,priest:'P',target:{...monster,server:'USII',state:'planned'},fights:[]};
 assert.equal(c.groupedAttackAllowed(monster),true);entities.B={...monster,id:'B',target:'P'};
 assert.equal(c.groupedAttackAllowed(monster),false);c.groupedCombat.target.state='engaged';
 assert.equal(c.groupedAttackAllowed(monster),true);assert.equal(c.groupedAttackAllowed(entities.B),false);
}],
['shared identity survives stale reports and missing visibility, but rejects any other ID',({c,monster,now})=>{
 c.groupedCombat={protocol:4,key:'["runtime"]',leader:'W',members:['W','P'],seenAt:10000,target:{...monster,server:'USII',state:'engaged'}};
 assert.equal(c.leaderLockAllows(monster),true);assert.equal(c.leaderLockAllows({id:'B'}),false);
 now(14000);assert.equal(c.leaderLockAllows(monster),true);delete c.parent.entities.A;
 assert.equal(c.leaderLockAllows(monster),true);
},true],
['temporarily missing leader target retains its identity; deliberate clear and replacement advance revision',({c,monster})=>{
  c.publishCombatSelection(monster, false); assert.equal(c.combatSelection.revision, 1);
  c.publishCombatSelection(null, false); assert.equal(c.combatSelection.id, 'A');
  c.publishCombatSelection({ id: 'B' }, false); assert.equal(c.combatSelection.revision, 2);
  c.publishCombatSelection(null, true); assert.equal(c.combatSelection.id, null); assert.equal(c.combatSelection.revision, 3);
}],
['unfinished fight rejects even another existing attacker until shared promotion',({c,monster})=>{
 c.groupedCombat={protocol:4,key:'["runtime"]',leader:'W',members:['W','P'],seenAt:10000,selection:'fight-A',
  committed:true,priest:'P',target:{...monster,server:'USII',state:'engaged'},fights:[monster]};
 const other={...monster,id:'B',target:'P'};
 assert.equal(c.leaderLockAllows(other),false);assert.equal(c.groupedAttackAllowed(other),false);
 assert.equal(c.groupedAttackAllowed(monster),true);c.get_entity=()=>null;
 assert.equal(c.groupedAcknowledgement(),'fight-A');
},true],
]);

scenarioTable('formation solver: priest-centred coverage and holds (MOV-085b)', formationScenario, [
['unchanged movement requests cannot walk a warrior beyond a stationary priest',()=>{
 const f=approachParty();for(let i=0;i<80;i++)f.tick(false);
 const r=f.contexts[0];assert.ok(r.moves.every(p=>Math.hypot(p.x,p.y)<=174.61));
 assert.ok(f.members.every(a=>a.x<200));
}],
 ['coverage takes priority over max weapon range; scatter and events retain their own movement',({c,warrior,monster,moves})=>{
  warrior.x = 210; monster.x = 238; monster.target = 'Ally';
  c.formationMove(monster); assert.ok(moves.at(-1).x < warrior.x);
  // The hunting owner's farm.grouped answers false in scatter and at an event (hunting/character/farm.ts), and the
  // formation reads that answer.
  c.groupedFarming = () => false;
  c.farmingMode = 'scatter'; assert.equal(c.formationMove(monster), false);
  c.farmingMode = 'default'; c.eventTargetTypes = ['franky']; assert.equal(c.formationMove(monster), false);
}],
]);

scenarioTable('formation solver: warrior approach and arcs (MOV-085c)', formationScenario, [
...[false,true].map(invisible=>['three-character approach advances priest and reaches melee; shared-only sight='+invisible,()=>{
 const f=approachParty(invisible);let previous=f.members.map(a=>a.x),reversals=0;
 for(let i=0;i<150;i++){
  f.tick();const [w,p,m]=f.members;
  assert.ok(Math.hypot(w.x-p.x,w.y-p.y)<=174.61,'warrior stays within preferred coverage');
  assert.ok(Math.hypot(m.x-p.x,m.y-p.y)<=174.61,'mage stays within preferred coverage');
  f.members.forEach((a,j)=>{if(a.x<previous[j]-0.5)reversals++;previous[j]=a.x;});
 }
 assert.ok(f.members[1].x>100,'priest advances');
 assert.ok(Math.hypot(f.members[0].x-400,f.members[0].y)<=33,'warrior reaches melee');
 assert.ok(reversals<5,'no repeated backwards corrections');
}]),
...[null,'W'].map(aggro=>['kill promotion approaches and repeatedly attacks stationary 280-range BBPom; aggro='+aggro,async r=>{
 const {c,warrior,monster,entities}=r;
 const bundle=roleRunnerBundle();
 let now=10000,selected=monster,accepted=[],timers=[],intervals=[];
 Object.assign(warrior,{x:0,y:0,frequency:2,slots:{},items:[],damage_type:'physical'});
 Object.assign(monster,{x:28,hp:100,target:null});
 c.is_in_range=t=>c.combatDistance(t)<=warrior.range;
 c.can_attack=t=>c.is_in_range(t);
 c.attack=async t=>{assert.ok(c.is_in_range(t));accepted.push(t.id);};
 c.game_log=()=>{};c.stop=()=>Promise.resolve();
 c.setTimeout=(fn,ms)=>{const t={fn,at:now+ms};timers.push(t);return t;};c.clearTimeout=t=>{if(t)t.off=true;};
 c.setInterval=(fn,ms)=>{const t={fn,ms};intervals.push(t);return t;};c.clearInterval=t=>{if(t)t.off=true;};
 c.sharedRoutine={isAllowedTarget:()=>true,isOccupied:()=>false,getAbtestingMode:()=>null,getFarmingMode:()=> 'default',
  setCombatTarget:()=>{},followLeaderIfFar:async()=>{},resetCombatMovement:c.resetCombatMovement,
  formationMove:c.formationMove,groupedAttackAllowed:()=>true,noteAttack:()=>{},survival:survivalHalf(),
  isAttackingPartyMember:()=>false,getNearestPartyAttacker:()=>null,
  };
 c.partyMovement={startMovementTick:movementTick(c),resetCombatMovement:()=>c.sharedRoutine.resetCombatMovement()};
 c.partyTurns={facts:()=>turnsPorts.call(c.sharedRoutine)};
 // The game's socket: the role loop runs a pass on each `entities` packet,
 // which the server sends as monsters and players move.
 const packets={};c.parent.socket={on:(event,fn)=>{(packets[event]??=[]).push(fn);},off:()=>{}};
 // The warrior picks its own kill, with no grouped nomination.
 c.sharedRoutine.classTarget=()=>selected;c.sharedRoutine.targeting=routineModule(c,c.sharedRoutine,{hunting:{farm:{grouped:()=>false}}});
 plantCallsWhenCreated(c);vm.runInContext(bundle,c);c.RunnerTest.installRoleRunner({combat:true});c.partyRoleRunner.start();
 async function tick(){
  now+=100;r.now(now);
  for(const t of intervals.filter(t=>!t.off&&t.ms===100))t.fn();
  for(const fn of packets.entities??[])fn({});
  for(const t of timers.filter(t=>!t.off&&t.at<=now)){t.off=true;t.fn();}
  // Each tick is one game update: the packets' and the timers' passes run once it lands (run.ts).
  await update();
  for(let n=0;n<12;n++)await Promise.resolve();
  const p=r.moves.at(-1);if(p){const d=Math.hypot(p.x-warrior.x,p.y-warrior.y);if(d){warrior.x+=(p.x-warrior.x)*Math.min(1,6/d);warrior.y+=(p.y-warrior.y)*Math.min(1,6/d);}}
 }
 try {
  for(let n=0;n<10;n++)await tick();assert.ok(accepted.includes('A'),JSON.stringify(c.partyCombatState));
  monster.dead=true;monster.hp=0;
  const next={...monster,id:'B',mtype:'bbpompom',x:warrior.x+75,y:warrior.y,dead:false,hp:100,target:aggro,range:280};entities.B=next;selected={...next};
  c.get_entity=id=>id==='B'?{...next}:entities[id];
  const before=warrior.x;c.partyRoleRunner.invalidateTarget('A');
  for(let n=0;n<30;n++)await tick();
  assert.ok(warrior.x>before,'must move into range instead of settling short');
  assert.ok(accepted.filter(id=>id==='B').length>=2,'must engage and continue basic attacks');
  assert.equal(next.target,aggro,'enemy aggro and position remain fixed');
 } finally {c.partyRoleRunner.stop();}
}]),
['numeric intercept body preserves both pinned native combat distance contracts',r=>{
 const monster={type:'monster',mtype:'goo',map:'main',x:100,y:100,width:120,height:60,mscale:2,renderer:{private:true}};
 const point={x:140,y:160};
 const projected=r.c.combatRangeReference(monster,point);assert.equal(projected.type,'monster');assert.equal(projected.mtype,'goo');assert.equal(projected.renderer,undefined);assert.equal('in' in projected,false);
 for(const version of ['15555','17665']){
  const fixture=require('./fixtures/native-combat-distance-contracts.json').versions[version];
  const c=vm.createContext({G:{dimensions:{goo:[24,24]},monsters:{goo:{}}}});
  for(const declaration of fixture.functions)vm.runInContext(declaration,c);
  const own={x:0,y:0,map:'main',width:20,height:20};
  assert.equal(c.distance(own,projected),c.distance(own,{...monster,...point}),version);
 }
}],
]);

scenarioTable('formation solver: mage escort (MOV-085d)', formationScenario, [
 ['mage follows a moving priest and never emits a blocked path',({c,warrior:mage,priest,monster,moves})=>{
 mage.ctype='mage';mage.range=200;mage.x=0;mage.y=25;monster.target=null;
 priest.y=-60;c.formationMove(monster);assert.ok(moves.at(-1).y<mage.y);
 moves.length=0;c.can_move_to=()=>false;c.formationMove(monster);assert.equal(moves.length,0);
}],
 ['mage escorts during events, separates in scatter, and never follows an opposing priest',({c,warrior:mage,priest,monster,moves})=>{
 mage.ctype='mage';mage.range=200;mage.x=0;mage.y=90;monster.target=null;
 // The hunting owner's farm.grouped answers false at an event and in scatter, so the mage's own escort decides.
 c.groupedFarming=()=>false;
 c.eventAttend.joined=()=>'franky';assert.equal(c.formationMove(monster),true);assert.ok(moves.at(-1).y<mage.y);
 c.eventAttend.joined=()=>null;c.farmingMode='scatter';assert.equal(c.formationMove(monster),false);
 c.farmingMode='default';
 c.characterEvents.sameTeam=m=>m.name!==priest.name;assert.equal(c.formationMove(monster),false);
}],
]);

// The priest's own context: monsters other than the target it must keep clear of.
scenarioTable('formation solver: secondary-monster avoidance (MOV-085e)', () => formationScenario(true), [
 ['priest at target range moves away from an unaggroed secondary monster',({c,monster,entities,moves})=>{
  entities.B = { id: 'B', type: 'monster', visible: true, x: 10, y: 45 };
  c.formationMove(monster);
  assert.ok(moves.length); assert.ok(moves.at(-1).y < 0);
  assert.ok(Math.abs(Math.hypot(moves.at(-1).x - monster.x, moves.at(-1).y) - c.desiredCombatRange()) <= 3);
  assert.equal(c.partyCombatPosition.nearestOtherMonster, 'B');
  assert.equal(entities.B.target, undefined, 'avoidance does not acquire the roaming monster');
}],
 // With every step blocked the pass takes the blocked branch, which publishes the clearance the
 // priest's own spot predicts: the current gap, the closest approach and the nearest monster.
 ['clearance takes the closest approach of every secondary monster along its motion, and stops at its destination',({c,monster,entities})=>{
  c.can_move_to = () => false;
  // B crosses the priest's spot: 15 units off at both ends of its walk, 0 halfway.
  entities.B = { id: 'B', type: 'monster', visible: true, x: 0, y: -15, moving: true, going_x: 0, going_y: 15, speed: 50 };
  c.formationMove(monster); assert.equal(c.partyCombatPosition.mode, 'formation-blocked');
  assert.ok(c.partyCombatPosition.predictedSecondaryClearance < 2, 'continuous closest approach catches crossing');
  entities.B.going_y = -10;
  c.formationMove(monster);
  assert.ok(c.partyCombatPosition.predictedSecondaryClearance >= 10, 'prediction must not continue past the destination');
  // B stands nearest now; C, farther, walks onto the priest's spot and stops there.
  entities.B = { id: 'B', type: 'monster', visible: true, x: 0, y: 20 };
  entities.C = { id: 'C', type: 'monster', visible: true, x: 0, y: -30, aheight: 10, moving: true, going_x: 0, going_y: 5, speed: 100 };
  c.formationMove(monster);
  assert.equal(c.partyCombatPosition.nearestOtherMonster, 'B'); assert.equal(c.partyCombatPosition.predictedSecondaryClearance, 0);
 }],
 ['numeric prediction retains rectangle hitbox distance without reading renderer properties',r=>{
 Object.assign(r.priest,{awidth:20,aheight:20});
 Object.defineProperty(r.priest,'renderer',{enumerable:true,get(){throw Error('renderer copied');}});
 const e={type:'monster',visible:true,id:'B',x:50,y:0,awidth:20,aheight:20,range:10};
 Object.defineProperty(e,'renderer',{enumerable:true,get(){throw Error('renderer copied');}});
 r.entities.B=e;r.c.can_move_to=()=>false;
 r.c.formationMove(r.monster);
 assert.equal(r.c.partyCombatPosition.secondaryClearance,30);
}],
]);

scenarioTable('formation solver: corner and stall detours (MOV-085f)', formationScenario, [
 ['a stalled corner approach takes one persistent local detour without smart movement, or holds where none is safe',()=>{
  {const r=formationScenario();
   r.warrior.ctype='mage';r.warrior.range=200;r.warrior.x=0;r.warrior.y=0;
   r.priest.x=200;r.priest.y=0;r.monster.x=400;r.monster.target=null;
   // Vertical wall at x=100, with a passage beyond y=60.
   const clear=(ax,ay,bx,by)=>!((ax<100&&bx>=100||bx<100&&ax>=100)&& ay+(by-ay)*(100-ax)/(bx-ax)<60);
   r.c.can_move_to=(x,y)=>clear(r.warrior.x,r.warrior.y,x,y);
   r.c.can_move=p=>clear(p.x,p.y,p.going_x,p.going_y);
   r.c.smart_move=()=>{throw Error('smart movement during combat');};
   r.c.formationMove(r.monster);r.now(12000);r.c.formationMove(r.monster);
   assert.equal(r.c.partyCombatPosition.mode,'formation-regrouping');
   assert.ok(r.moves.at(-1).y>0);const waypoint=r.c.formationState.recovery.point;
   r.now(12100);r.c.formationMove(r.monster);assert.equal(r.c.formationState.recovery.point,waypoint);}
  {const r=formationScenario(true);
   r.monster.target=null;r.monster.x=400;
   r.c.can_move_to=()=>false;r.c.can_move=()=>false;
   r.c.formationMove(r.monster);r.now(12000);r.c.formationMove(r.monster);
   assert.equal(r.moves.length,0);assert.match(r.c.partyCombatPosition.reason,/no safe local detour/);}}],
 // In the live fight-ends row this detour walked the warrior tank around the
 // square's west wall, away from its seed, on ticks the tank and hold add-on answered nothing.
 ['the anchor takes no corner detour when its approach stalls; a warrior that follows the priest takes one',()=>{
  const stalled=anchor=>{const r=formationScenario();
   r.warrior.x=0;r.warrior.y=0;r.priest.x=0;r.priest.y=0;r.monster.x=400;r.monster.target=null;
   r.c.is_in_range=t=>Math.hypot(r.warrior.x-t.x,r.warrior.y-t.y)<=r.warrior.range;
   r.c.groupedCombat={anchor:{name:anchor,map:'main',x:0,y:0}};
   // Vertical wall at x=100, with a passage beyond y=60.
   const clear=(ax,ay,bx,by)=>!((ax<100&&bx>=100||bx<100&&ax>=100)&& ay+(by-ay)*(100-ax)/(bx-ax)<60);
   r.c.can_move_to=(x,y)=>clear(r.warrior.x,r.warrior.y,x,y);
   r.c.can_move=p=>clear(p.x,p.y,p.going_x,p.going_y);
   const modes=[];for(const at of [10000,12000,12100]){r.now(at);const count=r.moves.length;r.c.formationMove(r.monster);
    if(r.moves.length>count)modes.push(r.c.partyCombatPosition.mode);}
   return modes;};
  assert.ok(stalled('P').includes('formation-regrouping'),'the row stalls a corner approach that takes a detour');
  assert.deepEqual(stalled('W').filter(mode=>/regroup/.test(mode)),[],'the anchor takes no regroup step');}],
]);

// A recovery follower walks after the recovery mover around a wall, but only inside coverage and
// clearance. The follow point lies straight away from the priest, so every offset step leaves its
// cover and only the certified detour moves; the grouped target's state, the party's fresh reports
// and the context's `can_move` decide the detour, through the recovery client's `follow` port. The
// goo attacks nobody, so the recovery is peaceful.
function wallFollower(r, follower, mover, directMessage) {
 Object.assign(follower,{x:610,y:-144});Object.assign(mover,{x:681.43,y:-319.04});r.monster.target=null;
 const away=Math.atan2(follower.y-r.priest.y,follower.x-r.priest.x),target={...r.monster,server:'USII',state:'planned'};
 r.c.groupedCombat={protocol:4,key:'["runtime"]',leader:'W',members:['W','P'],seenAt:10000,target,fights:[],formationRecovery:{mover:mover.name}};
 drivePositions(r.c,[r.warrior,r.priest].map(p=>({...p,seenAt:10000,server:'USII'})));
 r.c.partyQueueClient={formation:{followPoint:()=>({x:follower.x+Math.cos(away)*34,y:follower.y+Math.sin(away)*34})}};
 r.c.can_move=()=>true;r.c.can_move_to=()=>false;
 const follow=r.c.terrainRecoveryPorts().follow;
 follow();assert.equal(r.moves.length,1);assert.ok(r.moves[0].x<610&&r.moves[0].y>-144);
 target.state='engaged';follow();assert.equal(r.moves.length,1,'active combat cannot bypass coverage');
 target.state='planned';r.c.can_move=()=>false;
 follow();assert.equal(r.moves.length,1,'monster or terrain clearance still required');
 r.c.can_move=()=>true;r.c.can_move_to=()=>true;
 follow();assert.equal(r.moves.length,1,directMessage);
}
scenarioTable('terrain recovery: followers and goals (MOV-086, MOV-087, MOV-088)', formationScenario, [
 ['peaceful recovery follower may take a safe wall detour away from priest',r=>wallFollower(r,r.warrior,r.priest,'direct visible route cannot bypass coverage')],
]);
// Downloaded game geometry: each row skips when the geometry is not installed.
const geometry=c=>require('./helpers/game-geometry.cjs').installGameGeometry(c);
scenarioTable('formation solver: real game geometry runs (MOV-085g)', () => formationScenario(true), [
['Winter Cave BBPom remains stationary while supporters regain sight and the party reaches melee',(_r,t)=>{
 const f=approachParty(true),positions=[[-220.1456,-154.0168],[-322.5770,-254.2951],[-336.2232,-247.9942]];
 Object.assign(f.target,{map:'winter_cave',mtype:'bbpompom',x:-117.2685,y:-95.5884,hp:6400,max_hp:6400,awidth:32,aheight:40});
 f.members.forEach((a,i)=>Object.assign(a,{map:'winter_cave',x:positions[i][0],y:positions[i][1],base:{h:8,v:7,vn:2},awidth:24,aheight:32}));
 for(const r of f.contexts){
  if(!geometry(r.c))return t.skip('downloaded game geometry unavailable');
  r.c.G.maps.winter_cave={};r.c.G.monsters.bbpompom={range:280};f.target.range=280;r.c.groupedFresh=()=>true;
  r.c.is_in_range=target=>r.c.combatDistance(target)<=r.c.character.range;
 }
 for(let i=0;i<300;i++){
  if(i===40)for(const r of f.contexts){r.c.get_entity=id=>id==='H'?f.target:null;r.c.parent.entities={H:f.target};}
  f.tick();
  for(const r of f.contexts){const actor=r.c.character;if(!actor.moving)continue;
   assert.ok(r.c.can_move_to(actor.going_x,actor.going_y),'issued movement stays collision safe');}
  const [w,p,m]=f.members;
  assert.ok(Math.hypot(w.x-p.x,w.y-p.y)<195,'warrior stays in healing range');
  assert.ok(Math.hypot(m.x-p.x,m.y-p.y)<195,'mage stays in healing range');
 }
 assert.ok(f.contexts[0].c.is_in_range(f.target),'warrior must approach the stationary BBPom '+JSON.stringify(f.contexts.map(r=>({x:r.c.character.x,y:r.c.character.y,position:r.c.partyCombatPosition}))));
 assert.equal(f.contexts[0].c.groupedAttackAllowed(f.target),true,'basic attack authorization resumes');
}],
 ['Frozen Cave movement remains collision-safe with actual downloaded game geometry',(r,t)=>{
 if(!geometry(r.c))return t.skip('downloaded game geometry unavailable');
 Object.assign(r.priest,{map:'winter_cave',x:-298,y:-132,base:{h:8,v:7,vn:2},awidth:24,aheight:32});
 Object.assign(r.warrior,{map:'winter_cave',x:-93,y:-117,awidth:24,aheight:32});
 Object.assign(r.monster,{map:'winter_cave',x:-51,y:-80,target:'W',awidth:32,aheight:40});
 drivePositions(r.c,[r.warrior,r.priest]);
 for(let i=0;i<40;i++) {
   r.now(10000+i*100);const count=r.moves.length;r.c.formationMove(r.monster);
   if(r.moves.length===count)continue;
   const next=r.moves.at(-1);assert.ok(r.c.can_move_to(next.x,next.y));
   const dx=next.x-r.priest.x,dy=next.y-r.priest.y,length=Math.hypot(dx,dy);
   if(length){r.priest.x+=dx/length*Math.min(5.6,length);r.priest.y+=dy/length*Math.min(5.6,length);}
 }
}],
]);
// A return walk owns movement while the runner still attacks and supports.
scenarioTable('combat movement hands back through the owner (MOV-096)', formationScenario, [
 ['return runner attacks and supports while planning or held without issuing combat movement',async r=>{
 const {c,warrior,monster}=r;
 const bundle=roleRunnerBundle();
 let now=10000,attacks=0,support=0,intervals=[],timers=[];
 Object.assign(warrior,{x:0,y:0,frequency:2,slots:{},items:[],damage_type:'physical'});Object.assign(monster,{x:28,hp:100,target:'W'});
 c.is_in_range=()=>true;c.can_attack=()=>true;c.attack=async()=>{attacks++;};c.game_log=()=>{};
 c.setTimeout=(fn,ms)=>{const t={fn,at:now+ms};timers.push(t);return t;};c.clearTimeout=t=>{if(t)t.off=true;};
 c.setInterval=(fn,ms)=>{const t={fn,ms};intervals.push(t);return t;};c.clearInterval=t=>{if(t)t.off=true;};
 const forbidden=()=>{throw Error('combat attempted movement during return');};
 c.sharedRoutine={returnCombatActive:()=>true,returnDefenseTarget:()=>monster,returnAttacker:t=>t.target==='W',
  isAllowedTarget:()=>true,isOccupied:()=>false,getAbtestingMode:()=>null,getFarmingMode:()=> 'default',
  setCombatTarget:()=>{},followLeaderIfFar:forbidden,resetCombatMovement:forbidden,formationMove:forbidden,
  groupedMovement:forbidden,kiteIfNeeded:forbidden,approachCombatTarget:forbidden,pollRareHunting:forbidden,
  groupedAttackAllowed:()=>true,noteAttack:()=>{},survival:survivalHalf(),isAttackingPartyMember:()=>false,getNearestPartyAttacker:()=>null,
  smartLoot:async()=>{}};
 // The event return's fight takes a movement tick: the events owner's `event-return-combat` mover (combat.ts
 // `movers`) answers while the targeting owner's return fight is on, which this routine plants.
 c.characterEvents.movers['event-return-combat']=()=>c.sharedRoutine.returnCombatActive();
 c.partyMovement={startMovementTick:movementTick(c),resetCombatMovement:()=>c.sharedRoutine.resetCombatMovement()};
 c.partyTurns={facts:()=>turnsPorts.call(c.sharedRoutine)};
 const packets={};c.parent.socket={on:(event,fn)=>{(packets[event]??=[]).push(fn);},off:()=>{}};
 c.sharedRoutine.classTarget=()=>{throw Error('ordinary target acquisition during return');};c.sharedRoutine.targeting=routineModule(c,c.sharedRoutine);
 plantCallsWhenCreated(c);vm.runInContext(bundle,c);c.RunnerTest.installRoleRunner({combat:true,
  // The role loop's pass runs the class's casts on the target (beforeAttack) after the spends; it
  // asks no role hook before them.
  beforeAttack:async()=>{support++;return false;}});c.partyRoleRunner.start();
 try {
  for(let n=0;n<30;n++){
   now+=100;r.now(now);
   for(const t of intervals.filter(t=>!t.off && [100,250].includes(t.ms)))t.fn();
   for(const fn of packets.entities??[])fn({});
   for(const t of timers.filter(t=>!t.off&&t.at<=now)){t.off=true;t.fn();}
   for(let k=0;k<12;k++)await Promise.resolve();
  }
  assert.ok(attacks>=2,'attacks must run while the planner or hold owns movement');assert.ok(support>0);
  assert.equal(r.moves.length,0);assert.equal(c.partyCombatState.error,null);
 } finally {c.sharedRoutine.resetCombatMovement=()=>{};c.partyRoleRunner.stop();}
}],
]);

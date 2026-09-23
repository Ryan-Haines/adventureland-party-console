const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.AL_SHARED_SOURCE || 'characters/shared.js', 'utf8');
test('Default defense requires one shared target; local attackers cannot nominate independently',()=>{
 const {c,monster,entities}=setup();
 assert.equal(c.isAttackingPartyMember(monster),true);
 assert.equal(c.groupedAttackAllowed(monster),false);
 c.groupedCombat={protocol:4,key:'["runtime"]',leader:'W',members:['W','P'],seenAt:1,selection:'A',
  committed:true,priest:'P',target:{...monster,server:'USII',state:'engaged'},fights:[monster]};
 assert.equal(c.groupedAttackAllowed(monster),true,'confirmed engagement survives stale coordinator');
 entities.B={...monster,id:'B',target:'W'};assert.equal(c.groupedAttackAllowed(entities.B),false);
 assert.equal(c.groupedDefensiveTarget().id,'A');
});

test('party attackers block an untouched shared nomination but never its confirmed engagement',()=>{
 const {c,monster,entities}=setup();monster.target=null;
 c.groupedCombat={protocol:4,key:'["runtime"]',leader:'W',members:['W','P'],seenAt:10000,selection:'A',
  committed:true,priest:'P',target:{...monster,server:'USII',state:'planned'},fights:[]};
 assert.equal(c.groupedAttackAllowed(monster),true);entities.B={...monster,id:'B',target:'P'};
 assert.equal(c.groupedAttackAllowed(monster),false);c.groupedCombat.target.state='engaged';
 assert.equal(c.groupedAttackAllowed(monster),true);assert.equal(c.groupedAttackAllowed(entities.B),false);
});

function setup(priestSelf = false) {
  let now = 10000;
  const moves = [];
  const warrior = { name: 'W', ctype: 'warrior', map: 'main', x: 158, y: 0, range: 30, speed: 60, hp: 100, max_hp: 100, visible: true };
  const priest = { name: 'P', ctype: 'priest', map: 'main', x: 0, y: 0, range: 196, speed: 56, hp: 100, max_hp: 100, visible: true };
  const monster = { id: 'A', type: 'monster', mtype: 'goo', map: 'main', x: 186, y: 0, range: 20, target: 'W', visible: true };
  const players = { W: warrior, P: priest }, entities = { A: monster };
  const c = require('./helpers/client-dependencies.cjs').passingContext({ farmingTravelToken: null, character: priestSelf ? priest : warrior, leader: 'W', followLeader: true,
    farmingMode: 'default', eventTraveling: false, joinedEvent: null, eventTargetTypes: [],
    G: { maps: { main: {} }, monsters: { goo: { range: 20 } } }, parent: { entities },
    partyPositions: [warrior, priest].map(p => ({ ...p, seenAt: now, server: 'USII' })),
    get_player: name => players[name], get_entity: id => entities[id], currentPartyList: () => ['W', 'P'],
    reunionRealm: () => 'USII', coordinatorClockOffset: 0, leaderCombatSelection: null, groupedCombat: null,
    combatSelection: { id: null, revision: 0 }, convoyRuntimeId: 'runtime',
    Date: class extends Date { static now() { return now; } },
    can_move_to: () => true, is_in_range: () => true, kiteState: {},
    move: (x, y) => { moves.push({ x, y }); return new Promise(() => {}); },
  }); c.root = c;
  c.sameEventTeamMember=()=>true;
  vm.runInContext(source.slice(source.indexOf('  function isAttackingPartyMember('),source.indexOf('  function getNearestPartyAttacker(')),c);
  vm.runInContext(source.slice(source.indexOf('  function groupedFarming('), source.indexOf('  function isAllowedTarget(')), c);
  vm.runInContext(source.slice(source.indexOf('  var formationState ='), source.indexOf('  root.sharedRoutine = {')), c);
  return { c, warrior, priest, monster, moves, players, entities, now: value => now = value };
}

test('peaceful recovery follower may take a safe wall detour away from priest',()=>{
 const r=setup();Object.assign(r.warrior,{x:610,y:-144});Object.assign(r.priest,{x:681.43,y:-319.04});
 r.c.groupedCombat={target:r.monster,formationRecovery:{mover:'P'}};
 r.c.formationMembers=()=>[r.warrior,r.priest];
 r.c.partyQueueClient={formation:{followPoint:()=>({x:586,y:-120})}};
 r.c.terrainRecoveryContext=()=>({allowed:true});r.c.can_move_to=()=>false;
 r.c.terrainRecoverySafe=()=>true;
 r.c.terrainCoverageStep=()=>false;
 r.c.followTerrainRecovery();assert.equal(r.moves.length,1);assert.ok(r.moves[0].x<610&&r.moves[0].y>-144);
 r.c.terrainRecoveryContext=()=>({allowed:false});r.c.followTerrainRecovery();assert.equal(r.moves.length,1,'active combat cannot bypass coverage');
 r.c.terrainRecoveryContext=()=>({allowed:true});r.c.terrainRecoverySafe=()=>false;
 r.c.followTerrainRecovery();assert.equal(r.moves.length,1,'monster or terrain clearance still required');
 r.c.terrainRecoverySafe=()=>true;r.c.can_move_to=()=>true;
 r.c.followTerrainRecovery();assert.equal(r.moves.length,1,'direct visible route cannot bypass coverage');
});

test('target loss stops only the direct destination owned by combat',()=>{
 const r=setup();const stopped=[];r.c.stop=kind=>{stopped.push(kind);return Promise.resolve();};
 r.c.sendCombatMove(r.monster,{x:160,y:5},'formation-kiting');
 Object.assign(r.warrior,{moving:true,going_x:160,going_y:5});r.c.resetCombatMovement();
 assert.deepEqual(stopped,['move']);assert.equal(r.c.partyCombatPosition.mode,'idle');
 r.c.sendCombatMove(r.monster,{x:160,y:5},'formation-kiting');r.warrior.going_x=300;
 r.c.resetCombatMovement();assert.equal(stopped.length,1,'new navigation destination survives');
});

test('no selected target uses cheap defense only for an immediate same-instance attacker',()=>{
 const r=setup(true);let evades=0;
 r.c.formationMove=()=>{throw Error('full formation solver without target');};
 r.c.kiteIfNeeded=async()=>{evades++;};
 const start=source.indexOf('    defensiveFormationMove: function () {');
 const end=source.indexOf('    pollFarmingCombatHandoff:',start);
 vm.runInContext('var defense = {'+source.slice(start,end)+'};',r.c);
 r.monster.target=null;assert.equal(r.c.defense.defensiveFormationMove(),false);
 r.monster.target='P';r.monster.x=500;assert.equal(r.c.defense.defensiveFormationMove(),false);
 r.entities.B={id:'B',type:'monster',visible:true,target:'P',x:15,y:0,map:'other'};
 assert.equal(r.c.defense.defensiveFormationMove(),false);
 r.entities.B.map='main';assert.equal(r.c.defense.defensiveFormationMove(),true);assert.equal(evades,1);
});

test('distant passive monsters do not cause an otherwise settled priest to orbit',()=>{
 const r=setup(true);r.monster.target=null;
 r.entities.B={id:'B',type:'monster',visible:true,x:350,y:0,range:20};
 r.c.formationMove(r.monster);assert.equal(r.moves.length,0);assert.equal(r.c.partyCombatPosition.mode,'formation-hold');
});

test('numeric prediction retains rectangle hitbox distance without reading renderer properties',()=>{
 const r=setup(true);Object.assign(r.priest,{awidth:20,aheight:20});
 Object.defineProperty(r.priest,'renderer',{enumerable:true,get(){throw Error('renderer copied');}});
 const e={id:'B',x:50,y:0,awidth:20,aheight:20,range:10};
 Object.defineProperty(e,'renderer',{enumerable:true,get(){throw Error('renderer copied');}});
 assert.equal(r.c.priestSecondaryClearance(r.priest,[e]).current,30);
 r.entities.B=Object.assign({type:'monster',visible:true},{id:'B',x:50,y:0,awidth:20,aheight:20,range:10});
 r.c.formationMove(r.monster);
});

test('stalled corner approach uses a persistent local detour without smart movement',()=>{
 const r=setup();r.warrior.ctype='mage';r.warrior.range=200;r.warrior.x=0;r.warrior.y=0;
 r.priest.x=200;r.priest.y=0;r.monster.x=400;r.monster.target=null;
 // Vertical wall at x=100, with a passage beyond y=60.
 const clear=(ax,ay,bx,by)=>!((ax<100&&bx>=100||bx<100&&ax>=100)&& ay+(by-ay)*(100-ax)/(bx-ax)<60);
 r.c.can_move_to=(x,y)=>clear(r.warrior.x,r.warrior.y,x,y);
 r.c.can_move=p=>clear(p.x,p.y,p.going_x,p.going_y);
 r.c.smart_move=()=>{throw Error('smart movement during combat');};
 r.c.formationMove(r.monster);r.now(12000);r.c.formationMove(r.monster);
 assert.equal(r.c.partyCombatPosition.mode,'formation-regrouping');
 assert.ok(r.moves.at(-1).y>0);const waypoint=r.c.formationState.recovery.point;
 r.now(12100);r.c.formationMove(r.monster);assert.equal(r.c.formationState.recovery.point,waypoint);
});

test('unreachable corner holds instead of oscillating when not under attack',()=>{
 const r=setup(true);r.monster.target=null;r.monster.x=400;
 r.c.can_move_to=()=>false;r.c.can_move=()=>false;
 r.c.formationMove(r.monster);r.now(12000);r.c.formationMove(r.monster);
 assert.equal(r.moves.length,0);assert.match(r.c.partyCombatPosition.reason,/no safe local detour/);
});

test('Frozen Cave movement remains collision-safe with actual downloaded game geometry',t=>{
 const r=setup(true);
 if(!require('./helpers/game-geometry.cjs').installGameGeometry(r.c))return t.skip('downloaded game geometry unavailable');
 Object.assign(r.priest,{map:'winter_cave',x:-298,y:-132,base:{h:8,v:7,vn:2},awidth:24,aheight:32});
 Object.assign(r.warrior,{map:'winter_cave',x:-93,y:-117,awidth:24,aheight:32});
 Object.assign(r.monster,{map:'winter_cave',x:-51,y:-80,target:'W',awidth:32,aheight:40});
 r.c.partyPositions=[r.warrior,r.priest];
 for(let i=0;i<40;i++) {
   r.now(10000+i*100);const count=r.moves.length;r.c.formationMove(r.monster);
   if(r.moves.length===count)continue;
   const next=r.moves.at(-1);assert.ok(r.c.can_move_to(next.x,next.y));
   const dx=next.x-r.priest.x,dy=next.y-r.priest.y,length=Math.hypot(dx,dy);
   if(length){r.priest.x+=dx/length*Math.min(5.6,length);r.priest.y+=dy/length*Math.min(5.6,length);}
 }
});

test('shared identity survives stale reports and missing visibility, but rejects any other ID',()=>{
 const {c,monster,now}=setup(true);
 c.groupedCombat={protocol:4,key:'["runtime"]',leader:'W',members:['W','P'],seenAt:10000,target:{...monster,server:'USII',state:'engaged'}};
 assert.equal(c.leaderLockAllows(monster),true);assert.equal(c.leaderLockAllows({id:'B'}),false);
 now(14000);assert.equal(c.leaderLockAllows(monster),true);delete c.parent.entities.A;
 assert.equal(c.leaderLockAllows(monster),true);
});

test('temporarily missing leader target retains its identity; deliberate clear and replacement advance revision', () => {
  const { c, monster } = setup();
  c.publishCombatSelection(monster, false); assert.equal(c.combatSelection.revision, 1);
  c.publishCombatSelection(null, false); assert.equal(c.combatSelection.id, 'A');
  c.publishCombatSelection({ id: 'B' }, false); assert.equal(c.combatSelection.revision, 2);
  c.publishCombatSelection(null, true); assert.equal(c.combatSelection.id, null); assert.equal(c.combatSelection.revision, 3);
});

test('warrior stays healable and on the priest-facing side through continuous arc updates', () => {
  const { c, warrior, priest, monster, moves, now } = setup();
  for (let i = 0; i < 80; i++) {
    now(10000 + i * 100); assert.equal(c.formationMove(monster), true);
    const p = moves.at(-1), dx = p.x - warrior.x, dy = p.y - warrior.y, d = Math.hypot(dx, dy);
    assert.ok(d > 6, 'next segment must outlast a 100ms movement tick');
    warrior.x += dx / d * 6; warrior.y += dy / d * 6; warrior.moving = true;
    assert.ok(Math.hypot(warrior.x - priest.x, warrior.y - priest.y) <= 180, 'healing margin');
    assert.ok(warrior.x <= monster.x, 'never complete a circle behind the monster');
  }
});

test('wall reverses arc; completely blocked paths emit no movement', () => {
  const { c, monster, moves } = setup();
  c.can_move_to = (_x, y) => y < -1;
  assert.equal(c.formationMove(monster), true); assert.ok(moves.at(-1).y < 0);
  assert.equal(c.formationState.direction, -1);
  c.can_move_to = () => false;
  const count = moves.length; c.formationMove(monster);
  assert.equal(moves.length, count); assert.equal(c.partyCombatPosition.mode, 'formation-blocked');
});

test('priest holds a good position and retreats with aggro while preserving healing coverage', () => {
  const { c, warrior, priest, monster, moves } = setup(true);
  assert.equal(c.formationMove(monster), true); assert.equal(moves.length, 0);
  monster.target = 'P'; monster.x = 170;
  assert.equal(c.formationMove(monster), true);
  assert.ok(moves.at(-1).x < priest.x, 'retreat from approaching monster');
  assert.ok(Math.hypot(moves.at(-1).x - warrior.x, moves.at(-1).y - warrior.y) <= 180);
});

test('moving priest shifts the center; absent, dead, stale, other-map priests use fallback', () => {
  for (const change of [r => r.priest.rip = true, r => r.priest.map = 'winterland',
    r => { delete r.players.P; r.now(14000); }]) {
    const r = setup(); change(r); assert.equal(r.c.formationMove(r.monster), false);
  }
  const { c, priest, monster } = setup(); priest.y = 20;
  c.formationMove(monster);
  assert.equal(c.partyCombatPosition.healingDistance, Math.hypot(158, 20));
});

test('coverage takes priority over max weapon range; scatter and events retain their own movement', () => {
  const { c, warrior, monster, moves } = setup();
  warrior.x = 210; monster.x = 238; monster.target = 'Ally';
  c.formationMove(monster); assert.ok(moves.at(-1).x < warrior.x);
  c.farmingMode = 'scatter'; assert.equal(c.formationMove(monster), false);
  c.farmingMode = 'default'; c.eventTargetTypes = ['franky']; assert.equal(c.formationMove(monster), false);
});

test('priest at target range moves away from an unaggroed secondary monster', () => {
  const { c, monster, entities, moves } = setup(true);
  entities.B = { id: 'B', type: 'monster', visible: true, x: 10, y: 45 };
  c.formationMove(monster);
  assert.ok(moves.length); assert.ok(moves.at(-1).y < 0);
  assert.ok(Math.abs(Math.hypot(moves.at(-1).x - monster.x, moves.at(-1).y) - c.desiredCombatRange()) <= 3);
  assert.equal(c.partyCombatPosition.nearestOtherMonster, 'B');
  assert.equal(entities.B.target, undefined, 'avoidance does not acquire the roaming monster');
});

test('prediction detects a crossing between endpoints and stops monsters at their destination', () => {
  const { c } = setup(true);
  const enemy = { id: 'B', x: 15, y: -15, moving: true, going_x: 15, going_y: 15, speed: 50 };
  const crossing = c.priestSecondaryClearance({ x: 30, y: 0 }, [enemy]);
  assert.ok(crossing.minimum < 2, 'continuous closest approach catches crossing');
  enemy.going_y = -10;
  const stopped = c.priestSecondaryClearance({ x: 30, y: 0 }, [enemy]);
  assert.ok(stopped.minimum >= 10, 'prediction must not continue past the destination');
});

test('minimum clearance considers every secondary monster, not only the initially nearest one', () => {
  const { c } = setup(true);
  const enemies = [{ id: 'B', x: 0, y: 20 }, { id: 'C', x: 0, y: -30 }];
  const result = c.priestSecondaryClearance({ x: 0, y: -33 }, enemies);
  assert.equal(result.nearest, 'B'); assert.equal(result.minimum, 0);
});

test('other-map, other-instance, dead and invisible monsters do not trigger avoidance', () => {
  for (const extra of [{ map: 'winterland' }, { in: 'elsewhere' }, { dead: true }, { visible: false }]) {
    const { c, entities, monster, moves } = setup(true); c.character.in = 'main';
    entities.B = { id: 'B', type: 'monster', visible: true, x: 0, y: 20, ...extra };
    c.formationMove(monster); assert.equal(moves.length, 0);
  }
});

test('secondary avoidance reverses around a wall and never emits an unchecked path', () => {
  const { c, entities, monster, moves } = setup(true);
  entities.B = { id: 'B', type: 'monster', visible: true, x: 35, y: 0 };
  c.formationMove(monster);
  const first = moves.at(-1); assert.ok(first);
  c.can_move_to = (_x, y) => y * first.y < 0;
  c.formationMove(monster); assert.ok(moves.at(-1).y * first.y < 0);
  c.can_move_to = () => false;
  const count = moves.length; c.formationMove(monster); assert.equal(moves.length, count);
});

test('small nearest-monster changes retain arc direction', () => {
  const { c, entities, monster, moves } = setup(true);
  entities.B = { id: 'B', type: 'monster', visible: true, x: 35, y: 0 };
  entities.C = { id: 'C', type: 'monster', visible: true, x: 36, y: 0 };
  c.formationMove(monster); const direction = c.formationState.secondaryDirection;
  for (let i = 0; i < 10; i++) {
    entities.B.x = i % 2 ? 35 : 36; entities.C.x = i % 2 ? 36 : 35;
    c.formationMove(monster);
    assert.equal(c.formationState.secondaryDirection, direction);
  }
  assert.ok(moves.length);
});

test('priest holds when an arc offers less than five units of safe improvement', () => {
  const { c, monster, entities, moves } = setup(true);
  entities.B = { id: 'B', type: 'monster', visible: true, x: 140, y: 0 };
  c.formationMove(monster);
  assert.equal(moves.length, 0);
  assert.equal(c.partyCombatPosition.avoidanceReason, 'no meaningful safe improvement');
});



function ghostApproach() {
  const r = setup();
  r.warrior.x = 70; r.monster.x = 140; r.monster.range = 120; r.monster.mtype = 'ghost';
  r.c.G.monsters.ghost = { range: 120 };
  r.c.is_in_range = target => Math.hypot(r.warrior.x-target.x,r.warrior.y-target.y) <= r.warrior.range;
  return r;
}
test('warrior closes on a ghost through its attack radius and reaches melee without lateral stalling', () => {
  const r=ghostApproach();
  let previous=70;
  for(let i=0;i<12 && !r.c.is_in_range(r.monster);i++) {
    r.now(10000+i*100);r.c.formationMove(r.monster);
    const p=r.moves.at(-1),dx=p.x-r.warrior.x,dy=p.y-r.warrior.y,d=Math.hypot(dx,dy),step=Math.min(6,d);
    r.warrior.x+=dx/d*step;r.warrior.y+=dy/d*step;r.warrior.moving=true;
    const distance=Math.hypot(r.warrior.x-r.monster.x,r.warrior.y-r.monster.y);
    assert.ok(distance<previous,'each approach step closes the gap');previous=distance;
  }
  assert.equal(r.c.is_in_range(r.monster),true);
  r.c.formationMove(r.monster);
  assert.equal(r.c.partyCombatPosition.warriorPhase,'melee-kiting');
});
test('safe approach segment survives repeated ticks and refreshes after 250ms',()=>{
  const r=ghostApproach();r.c.formationMove(r.monster);r.warrior.moving=true;
  r.now(10100);r.c.formationMove(r.monster);r.now(10200);r.c.formationMove(r.monster);
  assert.equal(r.moves.length,1);assert.equal(r.c.partyCombatPosition.movementReason,'retaining safe segment');
  r.warrior.x+=12;r.now(10300);r.c.formationMove(r.monster);assert.equal(r.moves.length,2);
});
test('approach immediately replans a blocked segment, changed target or threatened healing coverage',()=>{
  for(const change of [r=>{r.c.can_move_to=(x,y)=>y>1;},r=>{r.monster.id='new';},r=>{r.priest.x=-130;}]) {
    const r=ghostApproach();r.c.formationMove(r.monster);r.warrior.moving=true;r.now(10100);change(r);
    r.c.formationMove(r.monster);assert.equal(r.moves.length,2);
    assert.notEqual(r.c.partyCombatPosition.movementReason,'retaining safe segment');
  }
});
test('warrior does not close through another attacker and refreshes before arriving',()=>{
  const r=ghostApproach();
  r.entities.B={id:'B',type:'monster',visible:true,x:90,y:0,range:50,target:'W'};
  r.c.formationMove(r.monster);const p=r.moves.at(-1);
  assert.ok(Math.hypot(p.x-90,p.y)>=19,'secondary attack zone stays protected');
  delete r.entities.B;r.c.resetCombatMovement();r.c.formationMove(r.monster);
  const dest=r.moves.at(-1);r.warrior.x=dest.x-2;r.warrior.y=dest.y;r.warrior.moving=true;
  const count=r.moves.length;r.now(10100);r.c.formationMove(r.monster);assert.equal(r.moves.length,count+1);
});
test('warrior resumes approach as soon as a target leaves actual attack range',()=>{
  const r=ghostApproach();r.warrior.x=112;r.c.formationMove(r.monster);
  assert.equal(r.c.formationState.warriorPhase,'melee-kiting');
  r.monster.x=143;r.c.formationMove(r.monster);assert.equal(r.c.formationState.warriorPhase,'approaching');
  r.monster.x=146;r.c.formationMove(r.monster);assert.equal(r.c.formationState.warriorPhase,'approaching');
});

test('mage returns around the monster to stay close to priest instead of orbiting on far side', () => {
 const {c,warrior:mage,priest,monster,moves,now}=setup();mage.ctype='mage';mage.range=200;mage.x=370;mage.y=0;monster.target=null;
 for(let i=0;i<180;i++) {
  now(10000+i*100);const before=moves.length;c.formationMove(monster);
  if(!moves.length || c.partyCombatPosition?.mode==='formation-hold') continue;
  const p=moves.at(-1),length=Math.hypot(p.x-mage.x,p.y-mage.y);if(!length)continue;
  mage.x+=(p.x-mage.x)/length*Math.min(6,length);mage.y+=(p.y-mage.y)/length*Math.min(6,length);mage.moving=true;
  assert.ok(Math.hypot(mage.x-monster.x,mage.y-monster.y)>24,'does not run through monster');
 }
 assert.ok(Math.hypot(mage.x-priest.x,mage.y-priest.y)<=30,JSON.stringify({x:mage.x,y:mage.y}));
 assert.ok(mage.x<monster.x,'priest-facing side');
});
test('mage follows a moving priest and never emits a blocked path',()=>{
 const {c,warrior:mage,priest,monster,moves}=setup();mage.ctype='mage';mage.range=200;mage.x=0;mage.y=25;monster.target=null;
 priest.y=-60;c.formationMove(monster);assert.ok(moves.at(-1).y<mage.y);
 moves.length=0;c.can_move_to=()=>false;c.formationMove(monster);assert.equal(moves.length,0);
});

test('mage escorts during events, separates in scatter, and never follows an opposing priest',()=>{
 const {c,warrior:mage,priest,monster,moves}=setup();mage.ctype='mage';mage.range=200;mage.x=0;mage.y=90;monster.target=null;
 c.joinedEvent='franky';assert.equal(c.formationMove(monster),true);assert.ok(moves.at(-1).y<mage.y);
 c.joinedEvent=null;c.farmingMode='scatter';assert.equal(c.formationMove(monster),false);
 c.farmingMode='default';
 c.sameEventTeamMember=m=>m.name!==priest.name;assert.equal(c.formationMove(monster),false);
});

test('unfinished fight rejects even another existing attacker until shared promotion',()=>{
 const {c,monster}=setup(true);
 c.groupedCombat={protocol:4,key:'["runtime"]',leader:'W',members:['W','P'],seenAt:10000,selection:'fight-A',
  committed:true,priest:'P',target:{...monster,server:'USII',state:'engaged'},fights:[monster]};
 const other={...monster,id:'B',target:'P'};
 assert.equal(c.leaderLockAllows(other),false);assert.equal(c.groupedAttackAllowed(other),false);
 assert.equal(c.groupedAttackAllowed(monster),true);c.get_entity=()=>null;
 assert.equal(c.groupedAcknowledgement(),'fight-A');
});


test('terrain-clear mage approach stalled by a monster gets a safe detour or an explicit hold',()=>{
 const r=setup(),{c,warrior:mage,priest,monster,entities,moves}=r;
 Object.assign(mage,{ctype:'mage',range:200,x:-300,y:0});Object.assign(priest,{x:0,y:0});Object.assign(monster,{x:180,target:null});
 entities.blocker={id:'blocker',type:'monster',visible:true,map:'main',x:-150,y:0,range:65};
 c.can_move=()=>true;c.can_move_to=()=>true;c.joinedEvent='franky';
 c.formationMove(monster);moves.length=0;r.now(12000);c.formationMove(monster);
 assert.ok(['formation-regrouping','formation-blocked'].includes(c.partyCombatPosition.mode),JSON.stringify(c.partyCombatPosition));
 if(moves.length){const next=moves.at(-1);assert.ok(Math.abs(next.y)>1,'detours off the blocked straight line');}
 const planned=c.formationState.recovery;
 r.now(12100);c.formationMove(monster);assert.equal(c.formationState.recovery,planned,'holds the recovery owner');
 c.character.map='different';c.formationMove(monster);assert.notEqual(c.formationState.recovery,planned);
});
test('no safe monster detour reports blockage without emitting another wandering move',()=>{
 const r=setup(),{c,warrior:mage,priest,monster,entities,moves}=r;
 Object.assign(mage,{ctype:'mage',range:200,x:-300,y:0});Object.assign(priest,{x:0,y:0});Object.assign(monster,{x:180,target:null});
 entities.blocker={id:'blocker',type:'monster',visible:true,map:'main',x:0,y:0,range:250};
 c.can_move=()=>true;c.can_move_to=()=>true;c.formationMove(monster);moves.length=0;r.now(12000);c.formationMove(monster);
 assert.equal(c.partyCombatPosition.mode,'formation-blocked');assert.equal(c.partyCombatPosition.constraint,'monster-blocked approach');assert.equal(moves.length,0);
 const at=c.formationState.recovery.retryAt;r.now(12100);c.formationMove(monster);assert.equal(c.formationState.recovery.retryAt,at);
});


test('mage safely reaches healing and attack range around a passive blocker over successive ticks',()=>{
 const r=setup(),{c,warrior:mage,priest,monster,entities,moves}=r;
 Object.assign(mage,{ctype:'mage',range:200,x:-300,y:0});Object.assign(priest,{x:0,y:0});Object.assign(monster,{x:180,target:null});
 entities.blocker={id:'blocker',type:'monster',visible:true,map:'main',x:-150,y:0,range:65};
 c.can_move=()=>true;c.can_move_to=()=>true;c.joinedEvent='franky';
 for(let tick=0;tick<400;tick++){
  r.now(10000+tick*100);moves.length=0;c.formationMove(monster);const p=moves.at(-1);
  if(p){const length=Math.hypot(p.x-mage.x,p.y-mage.y);if(length){mage.x+=(p.x-mage.x)*Math.min(1,6/length);mage.y+=(p.y-mage.y)*Math.min(1,6/length);}}
  assert.ok(Math.hypot(mage.x+150,mage.y)>=73-0.1,'never enters the blocker safety zone');
 }
 assert.ok(Math.hypot(mage.x-priest.x,mage.y-priest.y)<176.4,JSON.stringify(mage));
 assert.ok(Math.hypot(mage.x-monster.x,mage.y-monster.y)<200,JSON.stringify(mage));
});


function approachParty(invisible=false) {
 const w={name:'W',ctype:'warrior',map:'main',x:162,y:0,range:30,speed:60,hp:100,max_hp:100,visible:true};
 const p={name:'P',ctype:'priest',map:'main',x:0,y:0,range:194,speed:56,hp:100,max_hp:100,visible:true};
 const m={name:'M',ctype:'mage',map:'main',x:20,y:0,range:200,speed:52,hp:100,max_hp:100,visible:true};
 const target={id:'H',mtype:'darkhound',type:'monster',map:'main',server:'USII',x:400,y:0,hp:19200,max_hp:19200,range:20,visible:true,target:null,state:'planned'};
 const members=[w,p,m],contexts=members.map(actor=>{
  const r=setup(), c=r.c;c.character=actor;c.currentPartyList=()=>members.map(a=>a.name);c.get_player=name=>members.find(a=>a.name===name);
  c.get_entity=id=>id===target.id && (!invisible || actor===w)?target:null;
  c.parent.entities=actor===w || !invisible ? {H:target}:{};
  c.is_in_range=t=>Math.hypot(actor.x-t.x,actor.y-t.y)<=actor.range;
  c.stop=()=>{actor.moving=false;return Promise.resolve();};
  c.move=(x,y)=>{r.moves.push({x,y});actor.moving=true;actor.going_x=x;actor.going_y=y;return new Promise(()=>{});};
  return r;
 });
 let now=10000;
 function tick(advance=true) {
  for(const r of contexts) {
   r.now(now);r.c.partyPositions=members.map(a=>({...a,server:'USII',seenAt:now}));
   r.c.groupedCombat={protocol:4,key:'party',selection:'H',committed:true,seenAt:now,range:174.6,priest:'P',target,observers:[{...w,server:'USII',seenAt:now}],recovering:[],fights:[]};
   r.c.formationMove(r.c.get_entity('H') || target);
  }
  if(advance)for(const a of members)if(a.moving){
   const dx=a.going_x-a.x,dy=a.going_y-a.y,len=Math.hypot(dx,dy),fraction=Math.min(1,a.speed*0.1/len);
   if(len>0){a.x+=dx*fraction;a.y+=dy*fraction;}
  }
  now+=100;
 }
 return {members,contexts,target,tick};
}
for(const invisible of [false,true])test('three-character approach advances priest and reaches melee; shared-only sight='+invisible,()=>{
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
});
test('unchanged movement requests cannot walk a warrior beyond a stationary priest',()=>{
 const f=approachParty();for(let i=0;i<80;i++)f.tick(false);
 const r=f.contexts[0];assert.ok(r.moves.every(p=>Math.hypot(p.x,p.y)<=174.61));
 assert.ok(f.members.every(a=>a.x<200));
});
test('holding preserves a destination owned by newer navigation',()=>{
 const r=setup();r.c.sendCombatMove(r.monster,{x:170,y:0},'formation-approaching');
 let stops=0;r.c.stop=()=>{stops++;};Object.assign(r.warrior,{moving:true,going_x:400,going_y:100});
 r.c.holdFormation(r.monster,'no meaningful safe improvement');assert.equal(stops,0);
});

test('ordinary invisible nomination enters formation through grouped movement; stale sightings hold',()=>{
 const r=setup(true),c=r.c;let formations=0,stops=0;
 c.passiveRareCandidate=()=>false;c.groupedDefensiveTarget=()=>null;c.cancelGroupRoute=()=>{};c.cancelFightRoute=()=>{};c.cancelFarmApproach=()=>{};
 c.navigationIntent={revision:1,cancelled:false};c.partyConvoyActive=false;c.convoyTraveling=false;
 c.sharedRoutine={isOccupied:()=>false};c.groupedFresh=()=>true;c.groupedCovered=()=>true;c.groupedAnchorVisible=()=>true;
 c.formationMove=t=>{formations++;assert.equal(t.id,'H');return true;};c.stop=()=>{stops++;return Promise.resolve();};
 c.groupedCombat={key:'party',target:{id:'H',map:'main',server:'USII',x:400,y:0,state:'planned'},
  ready:true,recovering:[],fights:[],blockers:[],anchor:{name:'P',map:'main',x:0,y:0},range:174.6,
  observers:[{name:'W',server:'USII',map:'main',x:162,y:0,seenAt:10000}]};
 assert.equal(c.groupedMovement(),true);assert.equal(formations,1);
 c.kiteState.destination={x:30,y:0};Object.assign(c.character,{moving:true,going_x:30,going_y:0});
 c.groupedCombat.observers[0].seenAt=1000;
 assert.equal(c.groupedMovement(),true);assert.equal(formations,1);assert.equal(stops,1);
 assert.match(c.partyCombatPosition.reason,/missing fresh target visibility/);
});

test('accepted en-route nomination clears travel rejection and retains the red target outside the destination area',()=>{
 const {c,monster}=setup();
 Object.assign(c,{monsterFocus:['goo'],navigationIntent:{revision:1},partyLocation:{map:'cave',x:900,y:0},
  monsterSearchRadius:100,farmApproach:{failed:{}},monsterPriority:()=>50,isExternallyClaimedMonster:()=>false,
  passiveRareCandidate:()=>false,__partyEntitiesObservedAt:10000,__partyNomination:{blocked:'travel intent'},
  __partyFarmingEngagement:{target:{id:'A'},at:10000}});
 const candidate=c.queueCandidates()[0];assert.equal(candidate.id,'A');assert.equal(c.__partyNomination.blocked,undefined);
 c.groupedCombat={protocol:4,queue:[{...candidate,server:'USII',state:'planned'}]};
 assert.equal(c.queueRetentions()[0].eligible,true);
 assert.equal(c.queueMarkers()[0].role,'current');assert.equal(c.queueMarkers()[0].id,'A');
});

for(const aggro of [null,'W'])test('kill promotion approaches and repeatedly attacks stationary 280-range BBPom; aggro='+aggro,async()=>{
 const r=setup(),{c,warrior,monster,entities}=r;
 const bundle=require('esbuild').buildSync({entryPoints:['runtime/characters/roles/runner.ts'],bundle:true,write:false,format:'iife',globalName:'RunnerTest',platform:'browser'}).outputFiles[0].text;
 let now=10000,selected=monster,accepted=[],timers=[],intervals=[];
 Object.assign(warrior,{x:0,y:0,frequency:2,slots:{},items:[],damage_type:'physical',mp:1000,max_mp:1000,mp_cost:0});
 c.G.skills={};
 Object.assign(monster,{x:28,hp:100,target:null});
 c.is_in_range=t=>c.combatDistance(t)<=warrior.range;
 c.can_attack=t=>c.is_in_range(t);
 c.attack=async t=>{assert.ok(c.is_in_range(t));accepted.push(t.id);};
 c.game_log=()=>{};c.stop=()=>Promise.resolve();
 c.setTimeout=(fn,ms)=>{const t={fn,at:now+ms};timers.push(t);return t;};c.clearTimeout=t=>{if(t)t.off=true;};
 c.setInterval=(fn,ms)=>{const t={fn,ms};intervals.push(t);return t;};c.clearInterval=t=>{if(t)t.off=true;};
 c.sharedRoutine={allowsTarget:()=>true,isOccupied:()=>false,getAbtestingMode:()=>null,getFarmingMode:()=> 'default',
  setCombatTarget:()=>{},followLeaderIfFar:async()=>{},resetCombatMovement:c.resetCombatMovement,
  formationMove:c.formationMove,groupedAttackAllowed:()=>true,noteAttack:()=>{},
  regenerateHpOrMp:async()=>{},healPartyBelow:async()=>{},basicAttackReserved:()=>false};
 vm.runInContext(bundle,c);c.RunnerTest.installRoleRunner({chooseTarget:()=>selected,combat:true});c.partyRoleRunner.start();
 async function tick(){
  now+=100;r.now(now);
  for(const t of intervals.filter(t=>!t.off&&t.ms===100))t.fn();
  for(const t of timers.filter(t=>!t.off&&t.at<=now)){t.off=true;t.fn();}
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
});

test('Winter Cave BBPom remains stationary while supporters regain sight and the party reaches melee',t=>{
 const f=approachParty(true),positions=[[-220.1456,-154.0168],[-322.5770,-254.2951],[-336.2232,-247.9942]];
 Object.assign(f.target,{map:'winter_cave',mtype:'bbpompom',x:-117.2685,y:-95.5884,hp:6400,max_hp:6400,awidth:32,aheight:40});
 f.members.forEach((a,i)=>Object.assign(a,{map:'winter_cave',x:positions[i][0],y:positions[i][1],base:{h:8,v:7,vn:2},awidth:24,aheight:32}));
 for(const r of f.contexts){
  if(!require('./helpers/game-geometry.cjs').installGameGeometry(r.c))return t.skip('downloaded game geometry unavailable');
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
});
test('visibility recovery applies the same healing limit as ordinary movement',()=>{
 const r=setup();r.monster.target=null;r.monster.x=400;
 assert.equal(r.c.formationRecoverySafePoint({x:220,y:0}),false);
 assert.equal(r.c.formationRecoverySafePoint({x:170,y:0}),true);
});

 test('terrain-blocked priest proposes safe recovery goals after local recovery stalls',()=>{
  const r=setup(true),proposals=[];
  r.monster.target=null;r.monster.x=400;r.c.can_move_to=()=>false;
  r.c.can_move=p=>p.x===p.going_x&&p.y===p.going_y;
  r.c.terrainRecoveryContext=()=>({allowed:true,target:'goo'});
  r.c.partyQueueClient={formation:{movement:()=>false,propose:(id,goals)=>proposals.push({id,goals})}};
  r.c.formationMove(r.monster);assert.equal(proposals.length,0);
  r.now(12000);r.c.formationMove(r.monster);assert.equal(proposals.length,1);
  assert.equal(proposals[0].id,'goo');assert.ok(proposals[0].goals.length>0);
  assert.ok(proposals[0].goals.every(p=>r.c.terrainRecoverySafe(p,true)));
 });
 test('Arena cliff collision separates blocked direct movement from valid endpoints',t=>{
  const r=setup(true);
  if(!require('./helpers/game-geometry.cjs').installGameGeometry(r.c))return t.skip('downloaded geometry unavailable');
  Object.assign(r.priest,{map:'arena',x:-50,y:-300,base:{h:8,v:7,vn:2},awidth:24,aheight:32});
  r.entities.A.map='main';
  const goal={x:-50,y:-500};
  assert.equal(r.c.can_move_to(goal.x,goal.y),false);
  assert.equal(r.c.terrainRecoverySafe(goal,true),true,'goal itself is standable');
  assert.equal(r.c.terrainRecoverySafe(goal),false,'straight segment crosses cliff');
 });

 test('warrior closes on an enemy attacking a supporter, then retains melee movement after taunt',()=>{
  const r=setup(),{c,warrior,priest,monster,moves}=r;
  Object.assign(warrior,{x:80,y:0});Object.assign(priest,{x:0,y:0});Object.assign(monster,{x:160,y:0,target:'P'});
  c.is_in_range=()=>Math.hypot(warrior.x-monster.x,warrior.y-monster.y)<=30;
  for(let i=0;i<40&&!c.is_in_range();i++){
   r.now(10000+i*100);moves.length=0;const before=Math.hypot(warrior.x-monster.x,warrior.y-monster.y);
   c.formationMove(monster);const p=moves.at(-1);assert.ok(p,'must approach a reachable supporter attacker');
   assert.ok(Math.hypot(p.x-monster.x,p.y-monster.y)<before);
   const len=Math.hypot(p.x-warrior.x,p.y-warrior.y);warrior.x+=(p.x-warrior.x)*Math.min(1,6/len);warrior.y+=(p.y-warrior.y)*Math.min(1,6/len);
  }
  assert.equal(c.is_in_range(),true);monster.target='W';moves.length=0;r.now(20000);c.formationMove(monster);
  assert.equal(c.partyCombatPosition.warriorPhase,'melee-kiting');assert.ok(moves.length>0);
 });
 test('warrior cannot backpedal indefinitely when an engaged target lies beyond healing coverage',()=>{
  const r=setup(),{c,warrior,priest,monster,moves}=r;
  Object.assign(warrior,{x:174,y:0});Object.assign(priest,{x:0,y:0,range:194});Object.assign(monster,{x:400,y:0,target:'W'});
  c.is_in_range=()=>false;
  for(let i=0;i<5;i++){r.now(10000+i*100);moves.length=0;c.formationMove(monster);
   if(moves.length)assert.ok(moves.at(-1).x>=warrior.x-0.5,'coverage boundary must hold, not retreat from the fight');}
 });

 test('neutral target with clear terrain still requests priest recovery when party coverage deadlocks',()=>{
  const r=setup(true),{c,priest,warrior,monster,players}=r,proposals=[];
  Object.assign(priest,{x:0,y:0,range:194});Object.assign(warrior,{x:174,y:0,range:30});
  Object.assign(monster,{x:400,y:0,target:null});
  players.M={name:'M',ctype:'mage',map:'main',x:-174,y:0,range:200,speed:50,hp:100,visible:true};
  c.currentPartyList=()=>['W','P','M'];c.partyPositions=[warrior,priest,players.M].map(p=>({...p,seenAt:10000,server:'USII'}));
  c.can_move=()=>true;c.can_move_to=()=>true;c.is_in_range=()=>false;
  c.terrainRecoveryContext=()=>({allowed:true,target:'neutral'});
  c.partyQueueClient={formation:{movement:()=>false,propose:(target,goals)=>proposals.push({target,goals})}};
  c.formationMove(monster);assert.equal(proposals.length,0);
  r.now(12000);c.formationMove(monster);
  assert.ok(proposals.length>0,'clear terrain must not suppress recovery of a stalled healer');
  assert.equal(proposals[0].target,'neutral');assert.ok(proposals[0].goals.some(p=>p.x>priest.x));
 });

for (const meleeClass of ['paladin','rogue']) test(meleeClass+' reaches melee while maintaining priest coverage', () => {
  const r=ghostApproach();r.warrior.ctype=meleeClass;r.c.partyPositions.find(m=>m.name===r.warrior.name).ctype=meleeClass;
  let previous=70;
  for(let i=0;i<12 && !r.c.is_in_range(r.monster);i++) {
    r.now(10000+i*100);r.c.formationMove(r.monster);
    const p=r.moves.at(-1),dx=p.x-r.warrior.x,dy=p.y-r.warrior.y,d=Math.hypot(dx,dy),step=Math.min(6,d);
    r.warrior.x+=dx/d*step;r.warrior.y+=dy/d*step;r.warrior.moving=true;
    const distance=Math.hypot(r.warrior.x-r.monster.x,r.warrior.y-r.monster.y);
    assert.ok(distance<previous,'each approach step closes the gap');previous=distance;
  }
  assert.equal(r.c.is_in_range(r.monster),true);
  r.c.formationMove(r.monster);
  assert.equal(r.c.partyCombatPosition.warriorPhase,'melee-kiting');
});

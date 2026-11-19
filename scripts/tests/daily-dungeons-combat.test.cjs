const { targetingContext } = require('./helpers/targeting-module.cjs');
// Sliced shared.js functions run with the shared movement harness (fixtures/movement-owner-callers.cjs).
const {productionFunctions} = require('./helpers/production-functions.cjs');
const {drivePositions,positionsOf} = require('./helpers/targeting-module.cjs');
const { createMovementContext } = require('./fixtures/movement-owner-callers.cjs');
const { installCaveClient } = require('../../runtime/hunting/character/cave.ts');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function fixture() {
  const actor = {name:'W',ctype:'warrior',map:'cave',in:'run',hp:100,max_hp:100,real_x:0,real_y:0,cave:{run:'run',paused:false}};
  const priest = {...actor,name:'P',ctype:'priest',hp:40};
  const enemies = {a:{id:'a',type:'monster',visible:true,hp:100,map:'cave',in:'run',target:'P'},
    b:{id:'b',type:'monster',visible:true,hp:100,map:'cave',in:'run',target:'W'}};
  // The hunting owner's Cave client (hunting/character/cave.ts) over the context's character, frame, party and
  // queue, as shared.js installs it; a row asks it no other port.
  const cave = installCaveClient(new Proxy({ character: () => c.character, frame: () => c.parent, player: name => c.get_player(name),
    members: () => c.currentPartyList(), current: () => true, queue: () => c.groupedCombat, withTimeout: promise => promise },
  { get: (own, key) => key in own ? own[key] : () => { throw Error('The Cave client asked ' + String(key)); } }));
  const c = targetingContext(createMovementContext({can_move_to:()=>true,character:actor,root:{},parent:{entities:enemies,chests:{}},
    currentPartyList:()=>['W','P'],get_player:name=>name==='W'?actor:priest,get_entity:id=>enemies[id],
    groupedFresh:()=>true,groupedCombat:{target:{id:'a'}},monsterPriority:()=>50,runtimeCurrent:()=>true,distance:()=>50}), undefined,
  { hunting: { cave }, tasks: { partyList: () => c.currentPartyList() } });
  return {c,actor,priest,enemies,cave};
}
test('cave focus follows the shared queue and proactively admits visible enemy sides',()=>{
  const {c,actor,enemies}=fixture();
  enemies.neutral={...enemies.a,id:'neutral',target:null,cave:{side:'neutral'}};
  enemies.other={...enemies.a,id:'other',in:'other'};
  enemies.stranger={...enemies.a,id:'stranger',target:'Stranger'};
  enemies.spider={...enemies.a,id:'spider',target:null,cave:{side:'enemy'}};
  enemies.rat={...enemies.a,id:'rat',target:null,cave:{side:'predator'}};
  assert.equal(c.getDungeonTarget().id,'a');
  actor.target='b'; assert.equal(c.getDungeonTarget().id,'a');
  c.groupedCombat.target.id='b';assert.equal(c.getDungeonTarget().id,'b');
  for (const id of ['neutral','other','stranger']) assert.equal(c.dungeonTargetAllowed(enemies[id]),false);
  for (const id of ['spider','rat']) assert.equal(c.dungeonTargetAllowed(enemies[id]),true);
  enemies.b.dead=true;assert.equal(c.getDungeonTarget(),null);
  c.groupedFresh=()=>false;assert.equal(c.getDungeonTarget(),null);
});

test('cave looting opens only this instance, stops during votes and death',async()=>{
  const {c,actor,cave}=fixture(); const opened=[]; c.parent.open_chest=async id=>opened.push(id);
  c.parent.chests={yes:{map:'cave',in:'run',x:10,y:0},wrong:{map:'cave',in:'other',x:10,y:0}};
  await cave.loot(); assert.deepEqual(opened,['yes']);
  actor.cave.paused=true;await cave.loot();
  actor.cave.paused=false;actor.rip=true;await cave.loot();
  assert.deepEqual(opened,['yes']);
});
test('normal priest healing in cave uses live injured allies instead of pre-entry status',async()=>{
  // The survival owner's heal choice (needs.ts) reads its members through the character half's
  // `members` port, which shared.js answers with the Cave's live members inside a Cave (S-07s6).
  const {c,actor,priest,cave}=fixture(); actor.ctype='priest';actor.mp=100;actor.heal=10;actor.level=80;
  drivePositions(c,[{...priest,map:'main',hp:100}]);
  const {createNeeds}=require('../../runtime/characters/survival/needs.ts'),g=globalThis;
  Object.assign(g,{character:actor,get_player:c.get_player,is_on_cooldown:()=>false,can_use:()=>true,is_in_range:()=>true,
    G:{skills:{partyheal:{mp:400,levels:[[60,800]]},heal:{class:['priest']}},items:{}}});
  const needs=createNeeds({members:()=>actor.cave?cave.partyMembers():positionsOf(c),escapeStage:()=>null,sameTeam:()=>true,townCasting:()=>false,partyhealAllowed:()=>true,isLeader:()=>false,
    partyAttacker:()=>null,fighting:()=>false,lines:()=>({hp:50,mp:20}),state:()=>({}),kiting:()=>false,roster:()=>['W','P']});
  const asks=needs.heal({character:actor,roleLoop:true,pulse:false,healFirstBelow:80})||[];
  assert.deepEqual(asks.map(a=>[a.skill,a.targets.map(t=>t.name).join()]),[['heal','P']]);
});

test('solo cave defense includes self and confirmed kills cannot keep the old focus',()=>{
  const {c,cave}=fixture();c.currentPartyList=()=>[];c.groupedCombat.target.id='b';
  assert.equal(c.getDungeonTarget().id,'b');
  assert.equal(cave.partyMembers().length,1);
  // A confirmed death is in the module's killed list (install.ts `killed`).
  c.targeting.state.killed.set('b',Date.now());
  assert.equal(c.getDungeonTarget(),null);
});

test('fresh scoped committed cave enemy survives a blocked direct bearing for combat recovery',()=>{
  const {c,actor,enemies}=fixture();actor.cave.floor=0;
  enemies.wall={...enemies.a,id:'wall',target:null,cave:{side:'enemy'}};
  c.can_move_to=()=>false;
  c.groupedCombat={caveScope:'run:0',members:['W','P'],committed:false,target:{id:'wall',state:'planned'}};
  assert.equal(c.dungeonCombatThreat(enemies.wall),false,'An unreachable new enemy must not interrupt travel');
  assert.equal(c.getDungeonTarget(),null);
  c.groupedCombat.committed=true;c.groupedCombat.target.state='engaged';
  assert.equal(c.getDungeonTarget()?.id,'wall','An owned committed enemy must reach the combat detour');
  assert.equal(c.dungeonCombatThreat(enemies.wall),false,'Initial travel handoff remains stricter');
});

for(const [reason,change] of [
  ['stale group',c=>c.groupedFresh=()=>false],
  ['wrong cave scope',c=>c.groupedCombat.caveScope='different:0'],
  ['dead enemy',(c,e)=>e.dead=true],
  ['known native death',c=>c.targeting.state.killed.set('wall',Date.now())],
  ['invisible enemy',(c,e)=>e.visible=false],
  ['wrong map',(c,e)=>e.map='other'],
  ['wrong instance',(c,e)=>e.in='other'],
  ['ally',(c,e)=>e.cave.side='ally'],
])test('committed cave target still rejects '+reason,()=>{
  const {c,actor,enemies}=fixture();actor.cave.floor=0;c.can_move_to=()=>false;
  const enemy=enemies.wall={...enemies.a,id:'wall',target:null,cave:{side:'enemy'}};
  c.groupedCombat={caveScope:'run:0',members:['W','P'],committed:true,target:{id:'wall',state:'engaged'}};
  change(c,enemy);assert.equal(c.getDungeonTarget(),null);
});

test('cave queue survives farming reset and acknowledges before saved leader initialization',()=>{
  const now=Date.now();
  const next={caveScope:'run:0',leader:'W',members:['W','P'],seenAt:now,key:JSON.stringify(['runtime']),resetAt:0,target:null};
  const c=targetingContext(createMovementContext({character:{name:'P',cave:{run:'run',floor:0}},leader:null,
    root:{__partyCombatResetAt:now},groupedCombat:null,convoyRuntimeId:'runtime',coordinatorClockOffset:0,Date}));
  vm.runInContext(productionFunctions(['acceptQueue']),c);
  vm.runInContext(productionFunctions(['groupedFresh']),c);
  c.acceptQueue(next);assert.equal(c.groupedCombat,next);assert.equal(c.groupedFresh(),true);
  c.character.cave.floor=1;assert.equal(c.groupedFresh(),false);
});
test('cave healing roster uses captured participants when native party list is empty',()=>{
  const {c,actor,cave}=fixture();actor.cave.floor=0;
  c.groupedCombat={caveScope:'run:0',members:['W','P']};c.currentPartyList=()=>[];
  assert.equal(cave.partyMembers().length,2);
});

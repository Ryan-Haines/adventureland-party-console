const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('characters/shared.js', 'utf8');
function fixture() {
  const actor = {name:'W',ctype:'warrior',map:'cave',in:'run',hp:100,max_hp:100,cave:{run:'run',paused:false}};
  const priest = {...actor,name:'P',ctype:'priest',hp:40};
  const enemies = {a:{id:'a',type:'monster',visible:true,hp:100,map:'cave',in:'run',target:'P'},
    b:{id:'b',type:'monster',visible:true,hp:100,map:'cave',in:'run',target:'W'}};
  const c = vm.createContext({character:actor,root:{},parent:{entities:enemies,chests:{}},
    currentPartyList:()=>['W','P'],get_player:name=>name==='W'?actor:priest,get_entity:id=>enemies[id],
    monsterPriority:()=>50,runtimeCurrent:()=>true,distance:()=>50,
    anniversaryWithTimeout:p=>p,loot:async()=>{}});
  vm.runInContext(source.slice(source.indexOf('  function dungeonOwned()'),source.indexOf('  function dungeonRuntime()')),c);
  return {c,actor,priest,enemies};
}
test('cave focus follows live leader target, otherwise agrees by priority and ID, never neutral or other instance',()=>{
  const {c,actor,enemies}=fixture();
  enemies.neutral={...enemies.a,id:'neutral',target:null};
  enemies.other={...enemies.a,id:'other',in:'other'};
  enemies.stranger={...enemies.a,id:'stranger',target:'Stranger'};
  assert.equal(c.getDungeonTarget().id,'a');
  actor.target='b'; assert.equal(c.getDungeonTarget().id,'b');
  for (const id of ['neutral','other','stranger']) assert.equal(c.dungeonTargetAllowed(enemies[id]),false);
  enemies.b.dead=true;assert.equal(c.getDungeonTarget().id,'a');
});
test('cave looting opens only this instance, stops during votes and death',async()=>{
  const {c,actor}=fixture(); const opened=[]; c.loot=async id=>opened.push(id);
  c.parent.chests={yes:{map:'cave',in:'run'},wrong:{map:'cave',in:'other'}};
  await c.lootDungeonChests(); assert.deepEqual(opened,['yes']);
  actor.cave.paused=true;await c.lootDungeonChests();
  actor.cave.paused=false;actor.rip=true;await c.lootDungeonChests();
  assert.deepEqual(opened,['yes']);
});
test('normal priest healing in cave uses live injured allies instead of pre-entry status',async()=>{
  const {c,actor,priest}=fixture(); actor.ctype='priest';actor.mp=100;
  c.partyPositions=[{...priest,map:'main',hp:100}];c.healingBusy=false;
  c.sameEventTeamMember=()=>true;c.isLiveAbtesting=()=>false;
  c.G={skills:{partyheal:{mp:100},heal:{mp:1}}};c.can_heal=()=>true;
  let healed;c.heal=async member=>{healed=member.name;};
  c.setTimeout=setTimeout;c.clearTimeout=clearTimeout;
  vm.runInContext(source.slice(source.indexOf('  async function healPartyBelow('),source.indexOf('  async function energizeLowestMana(')),c);
  assert.equal(await c.healPartyBelow(.9),true);assert.equal(healed,'P');
});

test('solo cave defense includes self and confirmed kills cannot keep the old focus',()=>{
  const {c,enemies}=fixture();c.currentPartyList=()=>[];
  assert.equal(c.getDungeonTarget().id,'b');
  assert.equal(c.cavePartyMembers().length,1);
  c.root.partyRoleRunner={isKnownDead:id=>id==='b'};
  assert.equal(c.getDungeonTarget(),null);
});

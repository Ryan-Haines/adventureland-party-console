const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('characters/shared.js', 'utf8');
function fixture(tool = 'rod') {
  const broom = {name:'broom',level:1}, calls=[];
  const same = (a,b) => !!a && !!b && a.name===b.name && a.level===b.level;
  const c=vm.createContext({root:{__merchantGatheringGeneration:1},merchantWeapon:null,
    character:{ctype:'merchant',slots:{mainhand:{name:tool,level:4}},items:[broom]},
    G:{items:{broom:{wtype:'staff'},sword:{wtype:'sword'}},classes:{merchant:{mainhand:{staff:true,sword:true}}}},
    gatheringStandListings:[],sameItem:same,fingerprint:item=>item?{...item}:null,
    setTimeout:fn=>fn(),gatheringStatus:(...args)=>calls.push(args),
    close_stand:async()=>{},findItem:item=>c.character.items.findIndex(candidate=>same(candidate,item)),
    equip:async(index,slot)=>{const old=c.character.slots[slot];c.character.slots[slot]=c.character.items[index];c.character.items[index]=old;},
    unequip:async slot=>{c.character.items.push(c.character.slots[slot]);c.character.slots[slot]=null;}
  });
  vm.runInContext(source.slice(source.indexOf('  async function equipGatheringTool('),source.indexOf('  async function depositGatheringGains(')),c);
  return {c,broom,calls};
}
test('fishing and mining restore the displaced broom without a merchant weapon mark',async()=>{
  for(const tool of ['rod','pickaxe']) {
    const {c,broom}=fixture(tool);
    assert.equal(await c.restoreGatheringEquipment({mainhand:broom}),true);
    assert.equal(c.character.slots.mainhand.name,'broom');
    assert.equal(c.character.slots.mainhand.level,1);
  }
});
test('explicit merchant weapon overrides saved equipment; sale markings release saved equipment',async()=>{
  const {c,broom}=fixture();
  c.merchantWeapon={item:{name:'sword',level:0}};c.character.items.push(c.merchantWeapon.item);
  assert.equal(await c.restoreGatheringEquipment({mainhand:broom}),true);
  assert.equal(c.character.slots.mainhand.name,'sword');
  const second=fixture();second.c.gatheringStandListings=[{item:second.broom}];
  assert.equal(await second.c.restoreGatheringEquipment({mainhand:second.broom}),true);
  assert.equal(second.c.character.slots.mainhand,null);
});
test('missing saved weapon reports a failure and obsolete restoration cannot mutate equipment',async()=>{
  const {c,broom,calls}=fixture();c.character.items=[];
  assert.equal(await c.restoreGatheringEquipment({mainhand:broom}),false);
  assert.equal(calls.at(-1)[1],'error');
  c.character.items=[broom];
  assert.equal(await c.restoreGatheringEquipment({mainhand:broom},()=>false),false);
  assert.equal(c.character.slots.mainhand.name,'rod');
});
test('tool equip captures the current broom instead of stale session equipment',async()=>{
  const {c,broom}=fixture();c.character.items=[c.character.slots.mainhand];c.character.slots.mainhand=broom;
  const session={tool:'rod',mainhand:{name:'sword',level:0}};
  await c.equipGatheringTool(session,()=>true);
  assert.equal(session.mainhand.name,'broom');
  assert.equal(c.character.slots.mainhand.name,'rod');
  assert.equal(await c.restoreGatheringEquipment(session),true);
  assert.equal(c.character.slots.mainhand.name,'broom');
});

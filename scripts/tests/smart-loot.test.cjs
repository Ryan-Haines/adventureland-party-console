const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('characters/shared.js','utf8');
function setup(){
 let now=10000,cleanouts=0;const calls=[];
 const c=vm.createContext({root:{},character:{map:'main',in:'main',x:0,y:0},parent:{chests:{a:{x:10,y:0},b:{x:20,y:0},gold:{items:0,x:30,y:0}}},
  lastLootAt:0,lastLootChest:null,lootRetryAt:{},Date:{now:()=>now},freeInventorySlots:()=>0,
  requestMerchantCleanout:async()=>{cleanouts++;},game_log(){},
  loot:async id=>{calls.push(id);if(id==='a')throw {reason:'loot_no_space'};if(id==='b')throw {reason:'loot_failed'};delete c.parent.chests[id];return {success:true};}});
 vm.runInContext(source.slice(source.indexOf('  function eligibleDepartureChests('),source.indexOf('  function itemQuantity(')),c);
 return {c,calls,advance(ms=300){now+=ms;},cleanouts:()=>cleanouts};
}
test('full bags still open gold chests after earlier item and generic loot failures',async()=>{
 const r=setup();await r.c.smartLoot();assert.deepEqual(r.calls,['a','b']);
 r.advance();await r.c.smartLoot();assert.deepEqual(r.calls,['a','b','gold']);
 assert.equal(r.c.parent.chests.gold,undefined);assert.ok(r.cleanouts()>0);
});

test('cached remote chests do not get opened or hold a departure after nearby gold is collected',async()=>{
 const r=setup();r.c.parent.chests={gold:{items:0,x:30,y:0},
  remote:{map:'main',x:640,y:1657},old:{map:'arena',x:0,y:0},
  instance:{map:'main',in:'other',x:0,y:0},opened:{x:0,y:0,to_delete:true},unknown:{}};
 assert.deepEqual(Array.from(r.c.eligibleDepartureChests()),['gold']);
 await r.c.smartLoot(Object.keys(r.c.parent.chests));assert.deepEqual(r.calls,['gold']);
 assert.equal(r.c.root.partyLootStatus.pending,false);
 r.advance();assert.equal(await r.c.smartLoot(),true);assert.equal(r.c.root.partyLootStatus.pending,false);
 r.c.character.x=640;r.c.character.y=1657;
 assert.deepEqual(Array.from(r.c.eligibleDepartureChests()),['remote'],'cached drops become eligible on approach');
});
test('departure retries rotate past failed chests without reporting loot completion',async()=>{
 const r=setup();await assert.rejects(r.c.smartLoot(['a','b','gold']),e=>e.reason==='loot_no_space');
 r.advance();await assert.rejects(r.c.smartLoot(['a','b','gold']),e=>e.reason==='loot_failed');
 r.advance();await r.c.smartLoot(['a','b','gold']);
 assert.ok(r.calls.includes('gold'));assert.equal(r.c.root.partyLootStatus.pending,true);
});

test('rejected chests back off without pretending the remaining loot was collected',async()=>{
 const r=setup();await r.c.smartLoot();r.advance();await r.c.smartLoot();
 r.advance();assert.equal(await r.c.smartLoot(),false);assert.equal(r.calls.length,3);
 assert.equal(r.c.root.partyLootStatus.pending,true);
 r.advance(5000);await r.c.smartLoot();assert.equal(r.calls.at(-1),'a');assert.equal(r.calls.filter(id=>id==='b').length,1);
 r.advance(30000);await r.c.smartLoot();assert.equal(r.calls.filter(id=>id==='b').length,2);
});
test('opening response does not abort later chests and the pass remains rate limited',async()=>{
 const r=setup();r.c.loot=async id=>{r.calls.push(id);return {success:false,reason:'openning'};};
 await r.c.smartLoot();assert.deepEqual(r.calls,['a','b']);
 assert.equal(await r.c.smartLoot(),false);assert.equal(r.calls.length,2);
 r.advance();await r.c.smartLoot();assert.equal(r.calls[2],'gold');
});

for(const reason of ['cooldown','openning'])test('walking retries transient '+reason+' before leaving chest range',async()=>{
 const r=setup();r.c.freeInventorySlots=()=>10;r.c.parent.chests={drop:{x:0,y:0}};
 r.c.loot=async id=>{r.calls.push(id);if(r.calls.length===1)throw {reason};delete r.c.parent.chests[id];return {success:true};};
 await r.c.smartLoot();assert.equal(r.calls.length,1);
 r.advance(250);r.c.character.x=25;await r.c.smartLoot();
 assert.deepEqual(r.calls,['drop','drop']);assert.equal(r.c.parent.chests.drop,undefined);
});

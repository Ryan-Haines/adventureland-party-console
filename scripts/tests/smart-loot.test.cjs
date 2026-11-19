// The loot pass (market.ts `smartLoot`) over items-character.cjs `marketHarness`. A refused chest
// (loot_failed, loot_no_space) waits until its owner, the map or the character's state changes; a
// transient answer (cooldown, openning) is asked again on the next pass.
const {marketHarness}=require('./helpers/items-character.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
function setup(){
 let cleanouts=0,free=0;const calls=[];
 const r={calls,cleanouts:()=>cleanouts,setFree:n=>{free=n;},
  loot:async id=>{calls.push(id);if(id==='a')throw {reason:'loot_no_space'};if(id==='b')throw {reason:'loot_failed'};delete r.chests[id];return {success:true};}};
 r.chests={a:{x:10,y:0},b:{x:20,y:0},gold:{items:0,x:30,y:0}};
 const character={name:'M',map:'main',in:'main',x:0,y:0,items:[]};
 const h=marketHarness({character,reads:{freeInventorySlots:()=>free},game:{loot:id=>r.loot(id)},
  merchant:{cleanout:async()=>{cleanouts++;}},ports:{chests:()=>r.chests}});
 return Object.assign(r,{character,market:h.market,status:()=>globalThis.partyLootStatus});
}
test('full bags still open gold chests after earlier item and generic loot failures',async()=>{
 const r=setup();await r.market.smartLoot();assert.deepEqual(r.calls,['a','b']);
 await r.market.smartLoot();assert.deepEqual(r.calls,['a','b','gold']);
 assert.equal(r.chests.gold,undefined);assert.ok(r.cleanouts()>0);
});

test('cached remote chests do not get opened or hold a departure after nearby gold is collected',async()=>{
 const r=setup();r.chests={gold:{items:0,x:30,y:0},
  remote:{map:'main',x:640,y:1657},old:{map:'arena',x:0,y:0},
  instance:{map:'main',in:'other',x:0,y:0},opened:{x:0,y:0,to_delete:true},unknown:{}};
 assert.deepEqual(Array.from(r.market.eligibleDepartureChests()),['gold']);
 await r.market.smartLoot(Object.keys(r.chests));assert.deepEqual(r.calls,['gold']);
 assert.equal(r.status().pending,false);
 assert.equal(await r.market.smartLoot(),true);assert.equal(r.status().pending,false);
 r.character.x=640;r.character.y=1657;
 assert.deepEqual(Array.from(r.market.eligibleDepartureChests()),['remote'],'cached drops become eligible on approach');
});
test('departure retries rotate past failed chests without reporting loot completion',async()=>{
 const r=setup();await assert.rejects(r.market.smartLoot(['a','b','gold']),e=>e.reason==='loot_no_space');
 await assert.rejects(r.market.smartLoot(['a','b','gold']),e=>e.reason==='loot_failed');
 await r.market.smartLoot(['a','b','gold']);
 assert.ok(r.calls.includes('gold'));assert.equal(r.status().pending,true);
});

test('rejected chests back off without pretending the remaining loot was collected',async()=>{
 const r=setup();await r.market.smartLoot();await r.market.smartLoot();
 assert.equal(await r.market.smartLoot(),false);assert.equal(r.calls.length,3);
 assert.equal(r.status().pending,true);
 // A refusal holds until the chest's state changes: a new owner on a, then on b.
 r.chests.a.owner='W';await r.market.smartLoot();assert.equal(r.calls.at(-1),'a');assert.equal(r.calls.filter(id=>id==='b').length,1);
 r.chests.b.owner='W';await r.market.smartLoot();assert.equal(r.calls.filter(id=>id==='b').length,2);
});
test('opening response does not abort later chests',async()=>{
 const r=setup();r.loot=async id=>{r.calls.push(id);return {success:false,reason:'openning'};};
 await r.market.smartLoot();assert.deepEqual(r.calls,['a','b']);
 await r.market.smartLoot();assert.equal(r.calls[2],'gold');
});

for(const reason of ['cooldown','openning'])test('walking retries transient '+reason+' before leaving chest range',async()=>{
 const r=setup();r.setFree(10);r.chests={drop:{x:0,y:0}};
 r.loot=async id=>{r.calls.push(id);if(r.calls.length===1)throw {reason};delete r.chests[id];return {success:true};};
 await r.market.smartLoot();assert.equal(r.calls.length,1);
 r.character.x=25;await r.market.smartLoot();
 assert.deepEqual(r.calls,['drop','drop']);assert.equal(r.chests.drop,undefined);
});

test('a chest the game opened in the last 5 s is not asked again, so no admission goes unsent',async()=>{
 const r=setup();r.setFree(10);r.chests={drop:{x:0,y:0,openning:new Date(0)},gold:{items:0,x:30,y:0}};
 await r.market.smartLoot();assert.deepEqual(r.calls,['gold']);
 r.chests.drop.openning=new Date(-6000);await r.market.smartLoot();assert.deepEqual(r.calls,['gold','drop']);
});

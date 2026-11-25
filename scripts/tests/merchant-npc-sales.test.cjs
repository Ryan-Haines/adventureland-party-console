const { createMovementContext } = require('./fixtures/movement-owner-callers.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {reconcileNpcSales, readyNpcSales, failNpcSales, blockNpcSales} = require('../../runtime/items/coordinator/market.ts');
const mark = (id='sale') => ({id,source:'merchant',slot:18,item:{name:'hpamulet',level:0},quantity:1,state:'queued'});
const inventory = [{slot:18,item:{name:'hpamulet',level:0}}];
test('durable orphan sale is runnable without a new automatic mark', () => {
 const result=reconcileNpcSales([mark()],inventory,false);
 assert.equal(result.runnable,true); assert.equal(result.marks.length,1);
 assert.equal(reconcileNpcSales(result.marks,inventory,false).changed,false);
});
// A failed sale waits for the merchant's bag to change, with no clock (REVIEW-QUEUE.md TW-U3); a
// bank-sourced sale waits as a bag-sourced one does, and every failure waits again.
test('a failed sale waits for the merchant bag to change, every time it fails', () => {
 const moved=[{slot:7,item:inventory[0].item}];
 let marks=[mark(),{...mark('bank'),source:'bank'}];
 for(const [failedOn,changed] of [[inventory,moved],[moved,inventory]]){
  marks=failNpcSales(marks,['sale','bank'],'interrupted',failedOn);
  assert.equal(readyNpcSales(marks).length,0);
  const pending=reconcileNpcSales(marks,failedOn,false);
  assert.equal(pending.runnable,false);assert.deepEqual(pending.marks.map(m=>[m.state,m.error]),[['retrying','interrupted'],['retrying','interrupted']]);
  const lifted=reconcileNpcSales(pending.marks,changed,false);
  assert.equal(lifted.runnable,true);assert.equal(readyNpcSales(lifted.marks).length,2);marks=lifted.marks;
 }
});
// A completion's blocked sale waits under the items owner's one block rule until the bag
// changes.
test('a reported block holds the sale until the merchant bag changes', () => {
 const marks=[mark()];blockNpcSales(marks,[{id:'sale',error:'Item reserved for queued order',code:'reserved'}],inventory);
 assert.deepEqual([marks[0].state,marks[0].error,marks[0].code],['blocked','Item reserved for queued order','reserved']);
 assert.equal(reconcileNpcSales(marks,inventory,false).marks[0].state,'blocked');
 assert.notEqual(reconcileNpcSales(marks,[{slot:7,item:inventory[0].item}],false).marks[0].state,'blocked');
});
test('moved items are found and duplicate reservations do not sell twice', () => {
 const result=reconcileNpcSales([mark(),mark('duplicate')],[{slot:7,item:inventory[0].item}],false);
 assert.equal(result.marks.length,1);assert.equal(result.marks[0].slot,7);
});
test('missing and locked items block until inventory changes', () => {
 for(const items of [[],[{slot:18,item:{...inventory[0].item,l:'l'}}]]){
  const result=reconcileNpcSales([mark()],items,false);
  assert.equal(result.runnable,false);assert.equal(result.marks[0].state,'blocked');
  assert.equal(reconcileNpcSales(result.marks,items,false).changed,false);
  assert.equal(reconcileNpcSales(result.marks,inventory,false).runnable,true);
 }
});
// The sale rows run the items owner's merchantNpcSale (runtime/items/character/market.ts) on the items
// harness. `holder` is the merchant job owner's running job, `walk` movement's walk and `verifyProtection`
// production's craft check.
function saleRuntime(){
 const {marketHarness}=require('./helpers/items-character.cjs');
 const calls=[],character={name:'M',items:[{name:'hpamulet',level:0},{name:'coat'}],gold:0};
 const r={character,holder:{jobId:'job'},walk:async()=>{},verifyProtection:async()=>{},find_npc:id=>id};
 const h=marketHarness({character,merchant:{job:()=>r.holder},
  game:{sell:async(slot,q)=>{calls.push([slot,q]);character.items[slot]=null;character.gold+=12000;}},
  ports:{walk:value=>r.walk(value),production:{verifyMarks:async()=>{},verifyProtection:slots=>r.verifyProtection(slots)},
   request:async(url,options)=>calls.push(options.body)}});
 r.merchantNpcSale=h.market.merchantNpcSale;
 return {r,calls};
}
test('partial sales retain confirmed IDs and report interruption at top level',async()=>{
 const {r,calls}=saleRuntime();let moves=0;r.walk=async()=>{if(++moves===2)throw Error('interrupted');};
 await assert.rejects(r.merchantNpcSale({jobId:'job',npcSales:[mark(),{...mark('coat'),item:{name:'coat'}}]}),/interrupted/);
 const result=calls.at(-1);assert.equal(result.success,false);assert.equal(result.error,'interrupted');
 assert.deepEqual(Array.from(result.npcSalesResolved),['sale']);
});
test('sale rechecks lock and quantity after travel',async()=>{
 for(const locked of [true,false]){
  const {r,calls}=saleRuntime();r.character.items[0].q=10;
  r.walk=async()=>{r.character.items[0].q=2;if(locked)r.character.items[0].l='l';};
  await r.merchantNpcSale({jobId:'job',npcSales:[{...mark(),quantity:10}]});
  if(locked){assert.equal(calls.length,1);assert.equal(calls[0].npcSalesBlocked[0].error,'Item is locked');}
  else assert.deepEqual(calls[0],[0,2]);
 }
});
test('lost job ownership prevents a sale',async()=>{
 const {r,calls}=saleRuntime();r.walk=async()=>{r.holder=null;};
 await assert.rejects(r.merchantNpcSale({jobId:'job',npcSales:[mark()]}),/interrupted/);
 assert.equal(calls.length,1);assert.equal(calls[0].error,'interrupted');
});

test('NPC sales request the named vendor interaction point instead of its blocked sprite coordinates',async()=>{
 const {r,calls}=saleRuntime();let destination;
 r.find_npc=()=>({map:'main',x:-35,y:-162});
 r.walk=async value=>{destination=value;};
 await r.merchantNpcSale({jobId:'job',npcSales:[mark()]});
 assert.equal(destination,'fancypots');assert.deepEqual(calls[0],[0,1]);
 const {resolveDestination}=require('../../runtime/movement/character/destinations.ts');
 assert.deepEqual(resolveDestination({character:{map:'bank'},G:{maps:{}},find_npc:r.find_npc},destination),
   {map:'main',x:-35,y:-147});
});
test('stale town return cannot stop a new sale route',async()=>{
 // The town return is the job owner's (visits.ts); a holder that no longer holds stops it first.
 const {createMerchantVisits}=require('../../runtime/merchant-jobs/character/visits.ts');let stopped=false;
 const visits=createMerchantVisits({character:()=>({ctype:'merchant',map:'bank',x:0,y:0}),market:()=>({map:'main',x:-63,y:100}),stopWalk:async()=>{stopped=true;}});
 assert.equal(await visits.merchantTownReturn(null,()=>false),false);assert.equal(stopped,false);
});

test('NPC sale command stays available until completion so retry IDs survive status polls',()=>{
 // The status reply deletes a delivered command unless `retained` keeps it; a sale job command is kept.
 const {retained}=require('../../runtime/status/rules.ts'),{jobCommandRetained}=require('../../runtime/merchant-jobs/api.ts');
 assert.equal(retained({id:3,type:'merchant-npc-sale',npcSales:[mark()]},2,jobCommandRetained),true,'kept after a poll that has not applied it');
 assert.equal(retained({id:3,type:'merchant-npc-sale',npcSales:[mark()]},3,jobCommandRetained),true,'kept until the completion route clears it');
 assert.equal(retained({id:4,type:'unlisted-one-shot'},3,jobCommandRetained),false,'a one-shot command leaves the slot on delivery');
});

test('a queued buy result cannot be sold by a later merchant routine',async()=>{
 const {r,calls}=saleRuntime();r.verifyProtection=async()=>{throw Error('Item reserved for queued order');};
 await r.merchantNpcSale({jobId:'job',npcSales:[mark()]});
 assert.equal(r.character.items[0].name,'hpamulet');assert.equal(calls.length,1);
 assert.equal(calls[0].npcSalesBlocked[0].error,'Item reserved for queued order');
});

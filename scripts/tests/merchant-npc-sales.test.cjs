const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {reconcileNpcSales, readyNpcSales, failNpcSales} = require('../../runtime/coordinator/merchant/npc-sales.ts');
const mark = (id='sale') => ({id,source:'merchant',slot:18,item:{name:'hpamulet',level:0},quantity:1,state:'queued'});
const inventory = [{slot:18,item:{name:'hpamulet',level:0}}];
test('durable orphan sale is runnable without a new automatic mark', () => {
 const result=reconcileNpcSales([mark()],inventory,false,1000);
 assert.equal(result.runnable,true); assert.equal(result.marks.length,1);
 assert.equal(reconcileNpcSales(result.marks,inventory,false,1000).changed,false);
});
test('sale retries back off indefinitely and survive reconciliation', () => {
 let marks=[mark()]; let now=1000;
 for(const delay of [5000,15000,30000,60000,60000,60000]){
  marks=failNpcSales(marks,['sale'],'interrupted',now);
  assert.equal(marks[0].retryAt,now+delay);
  const pending=reconcileNpcSales(marks,inventory,false,now+delay-1);
  assert.equal(pending.runnable,false);assert.equal(pending.marks[0].error,'interrupted');
  assert.equal(readyNpcSales(marks,now+delay).length,1);now+=delay;
 }
});
test('moved items are found and duplicate reservations do not sell twice', () => {
 const result=reconcileNpcSales([mark(),mark('duplicate')],[{slot:7,item:inventory[0].item}],false,1);
 assert.equal(result.marks.length,1);assert.equal(result.marks[0].slot,7);
});
test('missing and locked items block until inventory changes', () => {
 for(const items of [[],[{slot:18,item:{...inventory[0].item,l:'l'}}]]){
  const result=reconcileNpcSales([mark()],items,false,1);
  assert.equal(result.runnable,false);assert.equal(result.marks[0].state,'blocked');
  assert.equal(reconcileNpcSales(result.marks,items,false,2).changed,false);
  assert.equal(reconcileNpcSales(result.marks,inventory,false,3).runnable,true);
 }
});
const shared=fs.readFileSync('characters/shared.js','utf8');
function saleRuntime(){
 const calls=[];const r=vm.createContext({root:{__merchantActiveJob:{jobId:'job'}},character:{items:[{name:'hpamulet',level:0},{name:'coat'}],gold:0},
 sameItem:(a,b)=>!!a&&a.name===b.name,findItem:item=>r.character.items.findIndex(i=>i&&i.name===item.name),
 verifyProductionProtection:async()=>{},find_npc:id=>id,smart_move:async()=>{},sell:async(slot,q)=>{calls.push([slot,q]);r.character.items[slot]=null;r.character.gold+=12000;},
 request:async(url,options)=>calls.push(options.body)});
 require('./helpers/client-dependencies.cjs').merchantGuards(r);
 vm.runInContext(shared.slice(shared.indexOf('  async function merchantNpcSale('),shared.indexOf('  async function merchantDonate(')),r);
 return {r,calls};
}
test('partial sales retain confirmed IDs and report interruption at top level',async()=>{
 const {r,calls}=saleRuntime();let moves=0;r.smart_move=async()=>{if(++moves===2)throw Error('interrupted');};
 await assert.rejects(r.merchantNpcSale({jobId:'job',npcSales:[mark(),{...mark('coat'),item:{name:'coat'}}]}),/interrupted/);
 const result=calls.at(-1);assert.equal(result.success,false);assert.equal(result.error,'interrupted');
 assert.deepEqual(Array.from(result.npcSalesResolved),['sale']);
});
test('sale rechecks lock and quantity after travel',async()=>{
 for(const locked of [true,false]){
  const {r,calls}=saleRuntime();r.character.items[0].q=10;
  r.smart_move=async()=>{r.character.items[0].q=2;if(locked)r.character.items[0].l='l';};
  await r.merchantNpcSale({jobId:'job',npcSales:[{...mark(),quantity:10}]});
  if(locked){assert.equal(calls.length,1);assert.equal(calls[0].npcSalesBlocked[0].error,'Item is locked');}
  else assert.deepEqual(calls[0],[0,2]);
 }
});
test('lost job ownership prevents a sale',async()=>{
 const {r,calls}=saleRuntime();r.smart_move=async()=>{r.root.__merchantActiveJob=null;};
 await assert.rejects(r.merchantNpcSale({jobId:'job',npcSales:[mark()]}),/interrupted/);
 assert.equal(calls.length,1);assert.equal(calls[0].error,'interrupted');
});

test('NPC sales request the named vendor interaction point instead of its blocked sprite coordinates',async()=>{
 const {r,calls}=saleRuntime();let destination;
 r.find_npc=()=>({map:'main',x:-35,y:-162});
 r.smart_move=async value=>{destination=value;};
 await r.merchantNpcSale({jobId:'job',npcSales:[mark()]});
 assert.equal(destination,'fancypots');assert.deepEqual(calls[0],[0,1]);
 const {resolveDestination}=require('../../runtime/characters/movement-destination.ts');
 assert.deepEqual(resolveDestination({character:{map:'bank'},G:{maps:{}},find_npc:r.find_npc},destination),
   {map:'main',x:-35,y:-147});
});
test('stale town return cannot stop a new sale route',async()=>{
 const r=vm.createContext({});
 const start=shared.indexOf('  async function merchantTownReturn('),end=shared.indexOf('\n  }',start)+4;
 vm.runInContext(shared.slice(start,end),r);
 await r.merchantTownReturn(null,()=>false);
});

test('NPC sale command stays available until completion so retry IDs survive status polls',()=>{
 const coordinator=require('./helpers/coordinator-source.cjs').coordinatorSource();
 const start=coordinator.indexOf('        const retainedCommands =');
 const end=coordinator.indexOf('        const leaderStatus',start);
 const command={type:'merchant-npc-sale',npcSales:[mark()]};
 const r=vm.createContext({command,party:{commands:{M:command}},body:{name:'M'}});
 vm.runInContext(coordinator.slice(start,end),r);
 assert.equal(r.party.commands.M,command);
});

test('a queued buy result cannot be sold by a later merchant routine',async()=>{
 const {r,calls}=saleRuntime();r.verifyProductionProtection=async()=>{throw Error('Item reserved for queued order');};
 await r.merchantNpcSale({jobId:'job',npcSales:[mark()]});
 assert.equal(r.character.items[0].name,'hpamulet');assert.equal(calls.length,1);
 assert.equal(calls[0].npcSalesBlocked[0].error,'Item reserved for queued order');
});

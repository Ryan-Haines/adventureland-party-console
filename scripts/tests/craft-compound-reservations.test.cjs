// Native merchant status always reports all 42 inventory slots.
const {productionHarness,vault}=require('./helpers/items-character.cjs');
const nativeInventory=(items=[])=>items.concat(Array(42-items.length).fill(null));
const test=require('node:test'),assert=require('node:assert/strict');
const {craftProtection}=require('../../runtime/items/coordinator/production.ts');
const {availableCraftStock}=require('../../runtime/items/rules.ts');
const {createImprovementScheduler}=require('../../runtime/items/coordinator/production.ts');
const {createMerchantProgressRoutes}=require('../../runtime/merchant-jobs/coordinator/routes.ts');
const ring=(level=0)=>({name:'dexring',level});
const entries=n=>Array.from({length:n},(_,slot)=>({slot,item:ring()}));
const order=()=>({buys:[],crafts:[{id:'tristone',quantity:3}],requirements:[{id:'dexring',level:0,quantity:3}],craftMaterials:[[{id:'dexring',level:0,quantity:1}]],sources:{},bank:[],materialBuys:[]});
const job=()=>({id:'craft',reason:'merchant commerce',target:'M',order:order()});

test('queued reservations survive moves, pause and restart; progress and cancellation release quantities',()=>{
 const state={merchantQueue:[job()]};
 assert.equal(availableCraftStock(entries(6),craftProtection(state)).filter(Boolean).length,3);
 const restarted=JSON.parse(JSON.stringify(state));restarted.merchantCurrent=restarted.merchantQueue.pop();
 restarted.merchantCurrent.resumeState={phase:'crafting',craftIndex:0,crafted:1};
 assert.equal(craftProtection(restarted).requirements[0].quantity,2);
 assert.equal(availableCraftStock(entries(5).reverse(),craftProtection(restarted)).filter(Boolean).length,3);
 restarted.merchantCurrent.resumeState.crafted=3;assert.equal(craftProtection(restarted).requirements.length,0);
 restarted.merchantCurrent=null;assert.equal(craftProtection(restarted).requirements.length,0);
});
test('orders reserve disjoint quantities and exact levels; legacy missing recipes fail closed',()=>{
 const second={...job(),id:'second'};const state={merchantQueue:[job(),second]};
 assert.equal(availableCraftStock(entries(9),craftProtection(state)).filter(Boolean).length,3);
 assert.equal(availableCraftStock([{item:ring(1)}],craftProtection(state)).filter(Boolean).length,1);
 state.merchantQueue[0].resumeState={phase:'crafting',craftIndex:0,crafted:1};delete state.merchantQueue[0].order.craftMaterials;
 assert.match(craftProtection(state).error,/recipe missing for tristone/);
 assert.equal(availableCraftStock(entries(9),craftProtection(state)).filter(Boolean).length,0);
 state.merchantCatalog={craftable:[{id:'tristone',materials:[{id:'dexring',level:0,quantity:1}]}]};
 assert.equal(craftProtection(state).error,undefined);
});
test('stock shared by stacks is reserved by quantity without modifying snapshots',()=>{
 const input=[{item:{name:'leather',q:8}}];
 const output=availableCraftStock(input,{requirements:[{id:'leather',quantity:3}]});
 assert.equal(output[0].item.q,5);assert.equal(input[0].item.q,8);
});
function scheduler(stock,craft=true){
 const state={merchantCharacter:'M',statuses:{M:{items:[]}},merchantAutomations:{},autoCompounds:{M:[{name:'dexring',targetTier:3}]},bankSnapshot:{packs:{items0:stock}},merchantQueue:craft?[job()]:[],withdrawals:{}};
 const queued=[];const service=createImprovementScheduler(Object.assign(state,{production:state.production||{attempts:{}}}),{now:()=>1,nextCommand:()=>1,stamp:x=>x,queue:(names,reason)=>queued.push(reason),persist(){},log(){}});
 return {state,queued,service};
}
test('empty merchant schedules bank-only triplets, but protected-only stock cannot interrupt crafting',()=>{
 const f=scheduler(entries(3),false);assert.equal(f.service.compound('M',{items:nativeInventory([])}),true);
 f.state.merchantQueue=[job(),{id:'stale',target:'M',reason:'auto compound'}];
 assert.equal(f.service.compound('M',{items:nativeInventory([])}),false);assert.equal(f.state.merchantQueue.length,1);
 f.state.bankSnapshot.packs.items0=entries(6);assert.equal(f.service.compound('M',{items:nativeInventory([])}),true);
});
test('BankBoi stages only surplus copies after craft reservations',()=>{
 const f=scheduler([]);f.state.bankbois={B:{name:'B',items:entries(6)}};
 assert.equal(f.service.compound('M',{items:nativeInventory([])}),false);
 assert.deepEqual(f.state.withdrawals.M.map(x=>x.slot),[3,4,5]);
});
test('protection checkpoint refreshes new jobs without changing progress or yielding',()=>{
 const state={merchantCurrent:{id:'auto',resumeState:{phase:'existing'}},merchantQueue:[job()]};
 const routes=createMerchantProgressRoutes(state,{offline:()=>false,});let body;
 routes.checkpoint({body:{jobId:'auto',protectionOnly:true}},{json:value=>{body=value}});
 assert.equal(body.craftProtection.requirements[0].quantity,3);assert.equal(state.merchantCurrent.resumeState.phase,'existing');
});
// The automatic compound pass (production.ts `merchantImprove`) over items-character.cjs
// productionHarness: the vault answers the withdrawals, the coordinator's protection checkpoint
// answers `protection`, and the game's compound raises the first copy and spends one scroll. The
// scroll stack sits after the eight cells the rows fill.
function runtime(bankCount,protectedCount=0){
 const character={name:'M',level:1,q:{},items:[...Array(8).fill(null),{name:'cscroll0',q:100}],bank:{items0:Array.from({length:bankCount},()=>ring())}};
 let protection={requirements:protectedCount?[{id:'dexring',level:0,quantity:protectedCount}]:[],allocations:protectedCount?[{id:'dexring',level:0,quantity:protectedCount,location:'items0'}]:[]};
 const compounds=[],{bank,bankRetrieve,withdrawals}=vault(character);
 const answer={checkpoint:async()=>({craftProtection:protection})};
 const {production,p}=productionHarness({character,bank,ports:{bankRetrieve,
  request:async(path,options)=>answer.checkpoint(path,options),
  compound:async(a,b,c,scroll)=>{compounds.push([a,b,c]);const items=character.items;
   items[a]={...items[a],level:items[a].level+1};items[b]=null;items[c]=null;items[scroll]={...items[scroll],q:items[scroll].q-1};return {success:true};}}});
 const rings=level=>character.items.filter(i=>i?.name==='dexring'&&i.level===level).length;
 return {production,p,character,withdrawals,compounds,answer,rings,protect:n=>{protection={requirements:[{id:'dexring',level:0,quantity:n}]}}};
}
const improve=autoCompounds=>({type:'merchant-self-improve',jobId:'auto',autoCompounds});
test('live executor builds +3 from bank-only +0 triplets while retaining three craft ingredients',async()=>{
 const f=runtime(30,3);
 await f.production.merchantImprove(improve([{name:'dexring',targetTier:3,quantity:1}]),[]);
 assert.equal(f.compounds.length,13);assert.equal(f.withdrawals.length,27);
 assert.equal(f.character.bank.items0.filter(Boolean).length,3);
 assert.equal(f.rings(3),1);
});
test('new craft queued during travel blocks the imminent compound attempt',async()=>{
 const f=runtime(0);f.character.items.splice(0,3,ring(),ring(),ring());
 f.p.move=async()=>f.protect(3);
 await f.production.merchantImprove(improve([{name:'dexring',targetTier:1}]),[]);
 assert.equal(f.compounds.length,0);assert.equal(f.rings(0),3);
});

test('auto withdrawals across bank packs do not steal reservations; prepared craft stock stays in the bag',async()=>{
 const f=runtime(3,3);f.character.bank.items1=Array.from({length:3},()=>ring());
 await f.production.merchantImprove(improve([{name:'dexring',targetTier:1,quantity:1}]),[]);
 assert.equal(f.compounds.length,1);assert.equal(f.character.bank.items0.filter(Boolean).length,3);
 const craft=job();craft.resumeState={phase:'leveling'};
 const protection=craftProtection({merchantCharacter:'M',merchantQueue:[craft]});
 const bag=entries(6).map(entry=>({...entry,craftLocation:'inventory:M'}));
 assert.deepEqual(availableCraftStock(bag,protection).filter(Boolean).map(entry=>entry.slot),[3,4,5]);
});
test('bounded bank retrieval respects locks, live shortage, and scroll capacity',async()=>{
 const one=()=>improve([{name:'dexring',targetTier:1,quantity:1}]);
 const f=runtime(4);f.character.bank.items0[0].l='l';
 await f.production.merchantImprove(one(),[]);assert.deepEqual(f.withdrawals,[1,2,3]);
 const shortage=runtime(2);await shortage.production.merchantImprove(one(),[]);assert.equal(shortage.withdrawals.length,0);
 const full=runtime(3);full.character.items.fill({name:'other'},0,8);
 await assert.rejects(full.production.merchantImprove(one(),[]),error=>error.code==='inventory_full');assert.equal(full.withdrawals.length,0);
});

test('live rule cancellation prevents bank retrieval and compounding from a stale command',async()=>{
 const f=runtime(3);
 f.answer.checkpoint=async()=>({craftProtection:{requirements:[]},compoundRules:[],compoundBlocked:[]});
 await f.production.merchantImprove(improve([{name:'dexring',targetTier:1,quantity:-1}]),[]);
 assert.equal(f.withdrawals.length,0);assert.equal(f.compounds.length,0);
});

test('three Tri-Stones finish after the higher-priority compound pass uses surplus dex rings',async()=>{
 const f=runtime(30,3);f.character.items=[...Array(19).fill(null),{name:'cscroll0',q:100}];
 await f.production.merchantImprove(improve([{name:'dexring',targetTier:3,quantity:1}]),[]);
 const materials=[{id:'strring',quantity:1},{id:'intring',quantity:1},{id:'dexring',quantity:1},{id:'vitscroll',quantity:10}];
 const craft={...job(),order:{...order(),crafts:[{id:'ctristone',quantity:3}],craftMaterials:[materials],requirements:materials.map(m=>({...m,quantity:m.quantity*3}))}};
 const state={merchantCharacter:'M',merchantCurrent:craft,merchantQueue:[]};let crafted=0;
 f.character.gold=100000;f.character.bank.items1=[...Array.from({length:3},()=>({name:'strring',level:0})),...Array.from({length:3},()=>({name:'intring',level:0})),{name:'vitscroll',q:30}];
 Object.assign(f.p.G(),{npcs:{},craft:{ctristone:{items:materials.map(m=>[m.quantity,m.id,0])}}});
 f.p.reads.merchantCatalog=()=>({buyable:[],craftable:[]});f.p.reads.itemSeller=()=>null;
 f.answer.checkpoint=async(path,{body})=>{if(path==='/merchant/checkpoint'){craft.resumeState=body.state;return {yield:false}}if(path==='/merchant/complete'){assert.equal(body.success,true);state.merchantCurrent=null}return {}};
 f.p.craft=async()=>{for(const material of materials){let left=material.quantity;for(let slot=0;slot<f.character.items.length && left;slot++){const item=f.character.items[slot];if(item?.name!==material.id||(item.level||0)!==0)continue;const amount=Math.min(left,item.q||1);left-=amount;if((item.q||1)===amount)f.character.items[slot]=null;else item.q-=amount}assert.equal(left,0)}crafted++};
 await f.production.merchantCommerce({jobId:'craft',order:craft.order});
 assert.equal(crafted,3);assert.equal(craftProtection(state).requirements.length,0);
 assert.equal(f.rings(3),1);
});
test('live compound executor refreshes delivery reservations before consuming a triplet',async()=>{
 for(const count of [3,4]) {
  const f=runtime(0);f.character.items.splice(0,count,...Array.from({length:count},()=>ring()));
  f.answer.checkpoint=async()=>({craftProtection:{requirements:[],deliveries:[{location:'inventory:M',slot:0,item:ring()}]}});
  await f.production.merchantImprove(improve([{name:'dexring',targetTier:1,quantity:-1}]),[]);
  assert.equal(f.compounds.length,count===3?0:1);assert.equal(f.character.items[0].level,0);
  assert.ok(f.compounds.every(slots=>!slots.includes(0)));
 }
});

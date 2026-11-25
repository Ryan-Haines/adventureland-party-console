// A commerce order's crafting (production.ts `merchantCommerce`) over items-character.cjs
// productionHarness and its `vault`. Each coordinator request and walk lands in `calls`; the
// checkpoint yields after the `yieldAt`th craft.
const {productionHarness,vault}=require('./helpers/items-character.cjs');
const {scenarioTable}=require('./fixtures/scenarios.cjs'),assert=require('node:assert/strict');
function runtime(quantity=4) {
 const calls=[],character={name:'M',items:[{name:'intring',q:quantity}],gold:100,bank:{items1:[]}},crafts=()=>calls.filter(c=>c[0]==='craft').length;
 const G={items:{},npcs:{},skills:{},craft:{tri:{items:[[1,'intring',0]]}}};
 let saved,yieldAt=0;
 const {bank,bankRetrieve}=vault(character);
 const {production,p}=productionHarness({character,G,bank,reads:{merchantCatalog:()=>({buyable:[],craftable:[]}),itemSeller:()=>null},ports:{bankRetrieve,
  move:async()=>calls.push(['move']),
  request:async(path,{body})=>{calls.push([path,body]);if(path==='/merchant/checkpoint'){saved=body.state;return {yield:yieldAt>0&&crafts()===yieldAt}};return {}},
  craft:async()=>{character.items.find(i=>i&&i.name==='intring').q--;calls.push(['craft'])}}});
 return {execute:command=>production.merchantCommerce(command),calls,character,p,bank,G,saved:()=>saved,yieldAt:n=>yieldAt=n,crafts};
}
const order={buys:[],crafts:[{id:'tri',quantity:4}],sources:{},bank:[],requirements:[{id:'intring',level:0,quantity:4}]};
// Every row builds the same runtime(); a row names its failure mode and carries its own bag and bank stubs and resume state.
scenarioTable('a commerce order crafts from the bag and the bank and resumes after an interruption',()=>runtime(),[
 ['crafting finds stock banked after order creation across multiple live stacks',async r=>{
 r.character.items=Array(5).fill(null);
 r.character.bank.items1=[{name:'intring',q:2},{name:'intring',q:2}];
 // No bank allocations: all four were on the merchant when this order was placed.
 r.p.craft=async()=>{const item=r.character.items.find(i=>i&&i.q>0);item.q--;r.calls.push(['craft']);};
 await r.execute({jobId:'j',order});assert.equal(r.crafts(),4);
 }],
 ['resumed crafting retrieves only the remaining materials banked during interruption',async r=>{
 r.character.items=Array(5).fill(null);
 r.character.bank.items1=[{name:'intring',q:2}];
 await r.execute({jobId:'j',order,resumeState:{phase:'crafting',craftIndex:0,crafted:2}});
 assert.equal(r.crafts(),2);assert.equal(r.calls.at(-1)[1].success,true);
 }],
 ['six Tri-Stones resume after four crafts with real level-less bank scrolls and exact-level rings',async r=>{
 r.character.items=Array(12).fill(null);
 const materials=[[1,'strring',0],[1,'intring',0],[1,'dexring',0],[10,'vitscroll',0]];
 r.G.craft.ctristone={items:materials};
 r.character.bank.items1=[{name:'strring',level:1},...materials.slice(0,3).flatMap(m=>Array.from({length:2},()=>({name:m[1],level:0}))),{name:'vitscroll',q:305}];
 Object.assign(r.p,{
  split:async(slot,quantity)=>{const item=r.character.items[slot];item.q-=quantity;r.character.items[r.character.items.indexOf(null)]={...item,q:quantity};},
  craft:async()=>{for(const [quantity,id,level] of materials){const slot=r.character.items.findIndex(i=>i&&i.name===id&&(i.level||0)===level);assert.ok(slot>=0);const item=r.character.items[slot];if((item.q||1)===quantity)r.character.items[slot]=null;else item.q-=quantity;}r.calls.push(['craft']);}
 });
 r.bank.bankStoreFully=async slot=>{r.character.bank.items1.push(r.character.items[slot]);r.character.items[slot]=null;};
 await r.execute({jobId:'j',order:{crafts:[{id:'ctristone',quantity:6}],requirements:materials.map(([quantity,id,level])=>({id,level,quantity:quantity*6}))},resumeState:{phase:'crafting',craftIndex:0,crafted:4}});
 assert.equal(r.crafts(),2);assert.equal(r.character.bank.items1[0].level,1);
 assert.equal(r.character.bank.items1.find(i=>i?.name==='vitscroll').q,285);
 assert.equal(r.calls.at(-1)[1].success,true);
 }],
 ['craft checkpoint resumes remaining operations without repeating completed crafts',async r=>{
 r.yieldAt(2);await r.execute({jobId:'j',order,resumeState:{phase:'crafting',craftIndex:0,crafted:0}});
 assert.equal(r.crafts(),2);assert.equal(r.saved().crafted,2);
 r.yieldAt(0);await r.execute({jobId:'j',order,resumeState:r.saved()});assert.equal(r.crafts(),4);
 assert.equal(r.calls.at(-1)[1].success,true);
 }],
 ['missing exact-level materials fail before craft travel and consumption',async r=>{
 r.character.items[0].level=1;
 await assert.rejects(r.execute({jobId:'j',order,resumeState:{phase:'crafting',craftIndex:0,crafted:0}}),/Crafting material is unavailable/);
 assert.equal(r.crafts(),0);assert.equal(r.calls.some(c=>c[0]==='move'),false);
 }],
 ['unresolved storage references cannot reach game bank retrieval',async r=>{
 await assert.rejects(r.execute({jobId:'j',order:{...order,requirements:[],bank:[{pack:'bankboi:B',slot:0,item:{name:'intring'},quantity:1}]}}),/Crafting storage is not ready/);
 assert.equal(r.crafts(),0);
 }],
 ['whole storage stacks are withdrawn in exact crafting quantity and excess returns to bank',async r=>{
 r.character.items=Array(5).fill(null);r.character.bank.items1[0]={name:'intring',q:20};
 r.bank.findBankItem=()=>({pack:'items1',slot:0});
 r.p.split=async(slot,wanted)=>{r.character.items[slot].q-=wanted;r.character.items[1]={name:'intring',q:wanted}};
 r.bank.bankStoreFully=async slot=>{r.character.bank.items1[0]=r.character.items[slot];r.character.items[slot]=null};
 await r.execute({jobId:'j',order:{...order,bank:[{pack:'items1',slot:0,item:{name:'intring',q:20},quantity:4}]}});
 assert.equal(r.crafts(),4);assert.equal(r.character.bank.items1[0].q,16);
 }],
]);

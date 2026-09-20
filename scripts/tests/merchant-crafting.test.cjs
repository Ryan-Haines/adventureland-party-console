const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const shared=fs.readFileSync('characters/shared.js','utf8');
const source=shared.slice(shared.indexOf('  async function merchantCommerce('),shared.indexOf('\n  function findExchangeBankItem'));
function runtime(quantity=4) {
 const calls=[],character={name:'M',items:[{name:'intring',q:quantity}],gold:100,bank:{items1:[]}};
 const r={character,root:{},G:{items:{},npcs:{},craft:{tri:{items:[[1,'intring',0]]}}}},crafts=()=>calls.filter(c=>c[0]==='craft').length;
 let saved,yieldAt=0;
 Object.assign(r,{merchantCatalog:()=>({buyable:[],craftable:[]}),itemQuantity:i=>i.q||1,find_npc:()=>({map:'main',x:100,y:100}),smart_move:async()=>calls.push(['move']),
 merchantVisitBank:async()=>{},sortCurrentBankFloor:async()=>{},findBankItem:()=>null,
 request:async(path,{body})=>{calls.push([path,body]);if(path==='/merchant/checkpoint'){saved=body.state;return {yield:yieldAt>0&&crafts()===yieldAt}};return {}},
 auto_craft:async()=>{character.items.find(i=>i&&i.name==='intring').q--;calls.push(['craft'])},itemSeller:()=>null});
 const execute=vm.runInNewContext('('+source+')',r);
 return {execute,calls,character,context:r,saved:()=>saved,yieldAt:n=>yieldAt=n,crafts};
}
const order={buys:[],crafts:[{id:'tri',quantity:4}],sources:{},bank:[],requirements:[{id:'intring',level:0,quantity:4}]};
function liveBank(r) {
 Object.assign(r.context,{
  findBankItem:wanted=>{
   for(const [pack,items] of Object.entries(r.character.bank)) {
    const slot=items.findIndex(i=>i&&i.name===wanted.name&&(i.level||0)===(wanted.level||0));
    if(slot>=0)return {pack,slot};
   }
   return null;
  },
  fingerprint:item=>({...item}),
  bank_retrieve:async(pack,slot,to)=>{r.character.items[to]=r.character.bank[pack][slot];r.character.bank[pack][slot]=null},
 });
}
test('crafting finds stock banked after order creation across multiple live stacks',async()=>{
 const r=runtime();r.character.items=Array(5).fill(null);
 r.character.bank.items1=[{name:'intring',q:2},{name:'intring',q:2}];liveBank(r);
 // No bank allocations: all four were on the merchant when this order was placed.
 r.context.auto_craft=async()=>{const item=r.character.items.find(i=>i&&i.q>0);item.q--;r.calls.push(['craft']);};
 await r.execute({jobId:'j',order});assert.equal(r.crafts(),4);
});
test('resumed crafting retrieves only the remaining materials banked during interruption',async()=>{
 const r=runtime();r.character.items=Array(5).fill(null);
 r.character.bank.items1=[{name:'intring',q:2}];liveBank(r);
 await r.execute({jobId:'j',order,resumeState:{phase:'crafting',craftIndex:0,crafted:2}});
 assert.equal(r.crafts(),2);assert.equal(r.calls.at(-1)[1].success,true);
});
test('craft checkpoint resumes remaining operations without repeating completed crafts',async()=>{
 const r=runtime();r.yieldAt(2);await r.execute({jobId:'j',order,resumeState:{phase:'crafting',craftIndex:0,crafted:0}});
 assert.equal(r.crafts(),2);assert.equal(r.saved().crafted,2);
 r.yieldAt(0);await r.execute({jobId:'j',order,resumeState:r.saved()});assert.equal(r.crafts(),4);
 assert.equal(r.calls.at(-1)[1].success,true);
});
test('missing exact-level materials fail before craft travel and consumption',async()=>{
 const r=runtime();r.character.items[0].level=1;
 await assert.rejects(r.execute({jobId:'j',order,resumeState:{phase:'crafting',craftIndex:0,crafted:0}}),/Crafting material is unavailable/);
 assert.equal(r.crafts(),0);assert.equal(r.calls.some(c=>c[0]==='move'),false);
});
test('unresolved storage references cannot reach game bank retrieval',async()=>{
 const r=runtime();await assert.rejects(r.execute({jobId:'j',order:{...order,requirements:[],bank:[{pack:'bankboi:B',slot:0,item:{name:'intring'},quantity:1}]}}),/Crafting storage is not ready/);
 assert.equal(r.crafts(),0);
});

test('whole storage stacks are withdrawn in exact crafting quantity and excess returns to bank',async()=>{
 const r=runtime();r.character.items=Array(5).fill(null);r.character.bank.items1[0]={name:'intring',q:20};
 Object.assign(r.context,{
  findBankItem:()=>({pack:'items1',slot:0}),freeInventorySlots:()=>r.character.items.filter(i=>!i).length,
  bank_retrieve:async(pack,slot,to)=>{r.character.items[to]=r.character.bank[pack][slot];r.character.bank[pack][slot]=null},
  split:async(slot,wanted)=>{r.character.items[slot].q-=wanted;r.character.items[1]={name:'intring',q:wanted}},
  bankStoreFully:async slot=>{r.character.bank.items1[0]=r.character.items[slot];r.character.items[slot]=null},
  sameItem:(item,wanted)=>item&&item.name===wanted.name,fingerprint:item=>item?{...item}:null,
  setTimeout:callback=>callback()
 });
 await r.execute({jobId:'j',order:{...order,bank:[{pack:'items1',slot:0,item:{name:'intring',q:20},quantity:4}]}});
 assert.equal(r.crafts(),4);assert.equal(r.character.bank.items1[0].q,16);
});

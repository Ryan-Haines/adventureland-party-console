// A merchant on a bank floor over bank.ts (items-character.cjs `bankHarness`). `game` holds the
// game's calls, which a row may replace after the build: bank_store, bank_retrieve, bank_swap, swap,
// split and smart_move, and `bank_packs`, the vault table (each pack on the bank floor until a row
// says otherwise). Each call is recorded in `calls` and lands
// as the game does: a store with no cell merges into the pack's pile with room, else takes its first
// empty cell; a swap of two piles of one stack merges them within the item's limit (`limits`, the
// G item `s`). `G` adds item definitions and tables beside them.
const {bankHarness}=require('./items-character.cjs');
const {stackKey}=require('../../../runtime/items/identity.ts');
function bankRuntime(bank,items=Array(8).fill(null),limits={tombkey:50,beewings:9999},{ports={},character={},G:definitions={}}={}) {
 const calls=[];
 const clone=x=>x?{...x}:null;
 const limit=item=>limits[item.name]||1;
 const fits=(target,source)=>!!target&&!!source&&stackKey(target)===stackKey(source)&&(target.q||1)+(source.q||1)<=limit(target);
 const game={bank_packs:Object.fromEntries(Object.keys(bank).map(pack=>[pack,['bank']])),smart_move:async()=>{},protection:{locations:[],items:[]}};
 game.bank_retrieve=async(pack,slot,inv)=>{calls.push(['retrieve',pack,slot,inv]);inv??=items.findIndex(x=>!x);[items[inv],bank[pack][slot]]=[clone(bank[pack][slot]),clone(items[inv])];};
 game.bank_store=async(inv,pack,slot)=>{
  calls.push(['store',inv,pack,slot]);
  if(slot!==undefined){[items[inv],bank[pack][slot]]=[clone(bank[pack][slot]),clone(items[inv])];return;}
  const item=items[inv];
  let target=bank[pack].findIndex(x=>fits(x,item));
  if(target>=0)bank[pack][target]={...bank[pack][target],q:bank[pack][target].q+item.q};
  else {target=Array.from({length:42},(_,i)=>i).find(i=>!bank[pack][i]);if(target===undefined)throw Error('full');bank[pack][target]=clone(item);}
  items[inv]=null;
 };
 game.bank_swap=async(pack,a,b)=>{calls.push(['bank_swap',pack,a,b]);const first=bank[pack][a],second=bank[pack][b];
  if(fits(second,first)){bank[pack][b]={...second,q:second.q+first.q};bank[pack][a]=null;}
  else [bank[pack][a],bank[pack][b]]=[second,first];};
 game.swap=async(a,b)=>{calls.push(['swap',a,b]);const first=items[a],second=items[b];
  if(fits(first,second)){items[a]={...first,q:first.q+second.q};items[b]=null;}
  else [items[a],items[b]]=[second,first];};
 game.split=async(slot,q)=>{calls.push(['split',slot,q]);const to=items.findIndex(x=>!x);if(to<0)throw Error('full');items[to]={...items[slot],q};items[slot]={...items[slot],q:items[slot].q-q};};
 const me={name:'Merchant',ctype:'merchant',items,bank,map:'bank',isize:items.length,...character};
 const G={...definitions,items:{...Object.fromEntries(Object.entries(limits).map(([name,s])=>[name,{s}])),...definitions.items},maps:{}};
 const harness=bankHarness({character:me,G,ports:{
  bankPacks:()=>game.bank_packs,
  bankStore:(...args)=>game.bank_store(...args),bankRetrieve:(...args)=>game.bank_retrieve(...args),bankSwap:(...args)=>game.bank_swap(...args),
  swap:(...args)=>game.swap(...args),split:(...args)=>game.split(...args),
  move:async map=>{const floor=typeof map==='string'?map:map?.map;await game.smart_move(floor);if(floor)me.map=floor;},
  canStack:(target,source)=>stackKey(target)===stackKey(source)&&(target.q||1)+(source.q||1)<=limit(target),
  // The coordinator's bank checkpoint answers the stack protection (`game.protection`) and no sort.
  request:async path=>path==='/merchant/bank-sort/checkpoint'?{mode:'off',protection:game.protection}:{},
  ...ports}});
 // The merchant leaves the bank: bank.ts's walk settles the stack journal and compacts the piles first.
 const leave=async()=>{harness.bank.observeVisit();await harness.bank.bankSortMove('main');};
 return {...harness,game,G,character:me,calls,leave,
  quantities:()=>Object.values(bank).flat().filter(Boolean).map(x=>x.q),
  total:()=>[...Object.values(bank).flat(),...items].filter(Boolean).reduce((sum,x)=>sum+(x.q||1),0)};
}
module.exports={bankRuntime};

const {createBankStacks}=require('../../../runtime/characters/bank-stacks.ts');
const {stackIdentity,stackLocations}=require('../../../runtime/bank-stacks.ts');
function installBankStacks(c) {
 let journal=null,now=0;
 const protection=()=>c.stackProtection || {locations:[],items:[]};
 const floor=pack=>(c.bank_packs || c.parent?.bank_packs || {})[pack]?.[0] || c.character.map || 'bank';
 const ports={items:()=>c.character.items,bank:()=>c.character.bank||{},size:()=>c.character.isize||c.character.items.length,
  map:()=>c.character.map||'bank',floor,reachable:()=>[...new Set(Object.keys(c.character.bank||{}).map(floor))],
  limit:item=>Number(c.G.items[item.name]?.s)||1,protection:async()=>protection(),current:()=>true,
  move:async map=>{if(c.smart_move)await c.smart_move(map);c.character.map=map;},
  retrieve:(...args)=>c.bank_retrieve(...args),store:(...args)=>c.bank_store(...args),
  swap:(...args)=>c.swap(...args),bankSwap:(...args)=>c.bank_swap(...args),split:(...args)=>c.split(...args),
  read:()=>journal,write:value=>{journal=value?JSON.parse(JSON.stringify(value)):null;},sleep:async ms=>{now+=ms;},now:()=>now};
 const service=createBankStacks(ports);
 c.bankStackService=()=>service;
 return {service,ports,protection};
}
function bankRuntime(bank,items=Array(8).fill(null),limits={tombkey:50,beewings:9999}) {
 const calls=[];
 const c={character:{bank,items,map:'bank',isize:items.length},G:{items:Object.fromEntries(Object.entries(limits).map(([name,s])=>[name,{s}]))},parent:{}};
 const clone=x=>x?{...x}:null;
 c.bank_retrieve=async(pack,slot,inv)=>{calls.push(['retrieve',pack,slot,inv]);[items[inv],bank[pack][slot]]=[clone(bank[pack][slot]),clone(items[inv])];};
 c.bank_store=async(inv,pack,slot)=>{
  calls.push(['store',inv,pack,slot]);
  if(slot!==undefined){[items[inv],bank[pack][slot]]=[clone(bank[pack][slot]),clone(items[inv])];return;}
  const item=items[inv],limit=limits[item.name]||1;
  let target=bank[pack].findIndex(x=>x&&stackIdentity(x)===stackIdentity(item)&&(x.q||1)+(item.q||1)<=limit);
  if(target>=0)bank[pack][target]={...bank[pack][target],q:bank[pack][target].q+item.q};
  else {target=Array.from({length:42},(_,i)=>i).find(i=>!bank[pack][i]);if(target===undefined)throw Error('full');bank[pack][target]=clone(item);}
  items[inv]=null;
 };
 c.bank_swap=async(pack,a,b)=>{calls.push(['bank_swap',pack,a,b]);const first=bank[pack][a],second=bank[pack][b];
  if(first&&second&&stackIdentity(first)===stackIdentity(second)&&(first.q||1)+(second.q||1)<=limits[first.name]){second.q+=first.q;bank[pack][a]=null;}
  else [bank[pack][a],bank[pack][b]]=[second,first];};
 c.swap=async(a,b)=>{calls.push(['swap',a,b]);const first=items[a],second=items[b];
  if(first&&second&&stackIdentity(first)===stackIdentity(second)&&(first.q||1)+(second.q||1)<=limits[first.name]){items[a]={...first,q:first.q+second.q};items[b]=null;}
  else [items[a],items[b]]=[second,first];};
 c.split=async(slot,q)=>{calls.push(['split',slot,q]);const to=items.findIndex(x=>!x);if(to<0)throw Error('full');items[to]={...items[slot],q};items[slot]={...items[slot],q:items[slot].q-q};};
 const result=installBankStacks(c);
 return {c,calls,...result,quantities:()=>Object.values(bank).flat().filter(Boolean).map(x=>x.q),total:()=>[...Object.values(bank).flat(),...items].filter(Boolean).reduce((sum,x)=>sum+(x.q||1),0),locations:()=>stackLocations(bank,result.protection())};
}
module.exports={installBankStacks,bankRuntime};

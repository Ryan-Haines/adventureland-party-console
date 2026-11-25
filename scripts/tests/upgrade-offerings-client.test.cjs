// The items owner's merchantImprove (runtime/items/character/production.ts) on the items harness. Each attempt runs
// production's upgradeConfirmed over the coordinator's planted replies; `upgrade` is the game's call.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {productionHarness}=require('./helpers/items-character.cjs');
function runtime({rules=[],stock=0,bank=0,manual=false,required=true,survive=false}={}){
 const calls=[],waits=[],visits=[];
 const character={name:'M',ctype:'merchant',map:'main',level:1,items:[{name:'sword',level:7},{name:'scroll0',q:10},stock?{name:'offeringp',q:stock}:null,null,null,null],bank:null};
 const G={items:{sword:{upgrade:{}},offeringp:{name:'Primling'},scroll0:{type:'uscroll'}},skills:{}};
 const f={character,calls,waits,visits,G,rules,
  upgrade:async(slot,scroll,offering)=>{
   calls.push({level:character.items[slot].level,offering:offering===undefined?undefined:character.items[offering].name});
   if(offering!==undefined&&--character.items[offering].q===0)character.items[offering]=null;
   if(survive)return {failed:true,success:false,num:slot};
   character.items[slot]={...character.items[slot],level:character.items[slot].level+1};return {success:true};
  },
  vault:{
   merchantVisitBank:async()=>{visits.push('bank');character.map='bank';character.bank={items0:bank?[{name:'offeringp',q:bank}]:[]};},
   accessibleFloors:()=>['bank'],packsOnFloor:()=>['items0'],
   bankRetrieveConfirmed:async(pack,slot)=>{character.items[2]=character.bank[pack][slot];character.bank[pack][slot]=null;bank=0;},
  }};
 const h=productionHarness({character,G,bank:{merchantVisitBank:(...a)=>f.vault.merchantVisitBank(...a),accessibleFloors:()=>f.vault.accessibleFloors(),
   packsOnFloor:()=>f.vault.packsOnFloor(),bankRetrieveConfirmed:(...a)=>f.vault.bankRetrieveConfirmed(...a)},
  ports:{grade:()=>0,findNpc:n=>n,job:()=>({jobId:'job',commandId:1}),move:async map=>{character.map=map;},
   swap:async(a,b)=>{[character.items[a],character.items[b]]=[character.items[b],character.items[a]];},
   upgrade:(...args)=>f.upgrade(...args),
   request:async(path,{body})=>{
    if(body.action==='wait-offering'){waits.push(body);return {ok:true};}
    if(body.action==='pending')return {pending:[]};
    if(path==='/merchant/production')return {};
    return {craftProtection:{requirements:[]},upgradeOfferingRules:rules,upgradeOfferingStock:{offeringp:bank+(character.items[2]?.q||0)}};
   }}});
 const mark={slot:0,item:{name:'sword',level:7},tiers:manual?1:2,...(manual?{offering:'offeringp',requestId:'manual'}:{auto:true})};
 return Object.assign(f,{h,command:{jobId:'job',target:'M',upgrades:[mark]},improve:()=>h.production.merchantImprove(f.command,[])});
}
const required={id:'p',name:'sword',floor:8,ceiling:9,offering:'offeringp',required:true};
test('interrupted automatic pass follows a relocated survivor and stops at the original target',async()=>{
 const f=runtime();const original=f.upgrade;let attempts=0;
 f.upgrade=async(...args)=>{if(++attempts===2)throw Error('interrupted');return original(...args);};
 await assert.rejects(f.improve(),/interrupted/);
 assert.equal(f.character.items[0].level,8);assert.ok(f.command.upgrades[0].passId);
 f.character.items[4]=f.character.items[0];f.character.items[0]=null;
 f.upgrade=original;await f.improve();
 assert.equal(f.character.items[4].level,9);assert.equal(f.calls.length,2);
});
test('auto +9 stops at +8 without required primling and preserves unfinished work',async()=>{
 const f=runtime({rules:[required]});await f.improve();
 assert.equal(f.character.items[0].level,8);assert.equal(f.calls.length,1);assert.equal(f.waits.length,1);assert.equal(f.visits.length,0);
 assert.equal(f.waits[0].mark.tiers,2);assert.equal(f.waits[0].mark.item.level,7);assert.equal(f.command._offeringWaits.length,1);
});
test('optional bank stock is retrieved and consumed only at its matching transition',async()=>{
 const f=runtime({rules:[{...required,required:false}],bank:1});await f.improve();
 assert.deepEqual(f.calls,[{level:7,offering:undefined},{level:8,offering:'offeringp'}]);assert.deepEqual(f.visits,['bank']);assert.equal(f.character.items[2],null);
});
test('optional rule without owned stock upgrades normally without a bank visit',async()=>{
 const f=runtime({rules:[{...required,required:false}]});await f.improve();
 assert.equal(f.character.items[0].level,9);assert.equal(f.calls[1].offering,undefined);assert.equal(f.visits.length,0);
});
test('manual offering makes exactly one attempt when failure leaves item intact',async()=>{
 const f=runtime({manual:true,stock:3,survive:true});await f.improve();
 assert.equal(f.calls.length,1);assert.equal(f.character.items[0].level,7);assert.equal(f.character.items[2].q,2);
});
test('required multi-step range pauses after the available stack is consumed',async()=>{
 const f=runtime({rules:[{...required,floor:7}],stock:1});await f.improve();
 assert.equal(f.calls.length,1);assert.equal(f.waits.length,1);assert.equal(f.character.items[0].level,8);
});
test('manual offering never downgrades to an unboosted upgrade',async()=>{
 const f=runtime({manual:true});await f.improve();assert.equal(f.calls.length,0);assert.equal(f.waits.length,1);
});
test('uncertain bank retrieval defers instead of making an optional unboosted attempt',async()=>{
 const f=runtime({rules:[{...required,floor:7,required:false}],bank:1});
 f.vault.bankRetrieveConfirmed=async()=>{throw Error('Bank withdrawal was not confirmed');};
 await assert.rejects(f.improve(),/not confirmed/);assert.equal(f.calls.length,0);
});
test('one blocked item does not prevent an unrelated upgrade',async()=>{
 const f=runtime({rules:[{...required,floor:7}]});
 f.character.items[3]={name:'hat',level:0};f.G.items.hat={upgrade:{}};
 f.command.upgrades.push({slot:3,item:{name:'hat',level:0},tiers:1,auto:true});
 await f.improve();assert.equal(f.waits.length,1);assert.equal(f.character.items[3].level,1);
});

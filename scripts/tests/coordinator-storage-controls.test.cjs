const test=require('node:test'),assert=require('node:assert/strict');
const {createBankUnlockRoute}=require('../../runtime/coordinator/http/bank-unlock.ts');
const {createRestockRoute}=require('../../runtime/coordinator/http/restock.ts');
const {createMerchantBlacklistRoute}=require('../../runtime/coordinator/http/merchant-blacklist.ts');
function invoke(route,body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;}};route({body},res);return res;}
function bank(){
 const state={merchantCharacter:'M',bankVaults:[{pack:'items8',floor:'bank_b',gold:0,key:{id:'key'}},{pack:'items9',floor:'bank_b',gold:10000,key:{id:'key'}}],bankSnapshot:{packs:{items0:[]}},statuses:{M:{items:[]}},merchantQueue:[],merchantCurrent:null};
 const calls=[],route=createBankUnlockRoute(state,{now:()=>100,nextCommand:()=>1,stamp:j=>j,publicJob:j=>j,log:(...args)=>calls.push(args),persist:()=>calls.push('persist'),dispatch:()=>calls.push('dispatch')});
 return {state,calls,send:body=>invoke(route,body)};
}
test('vault unlocking requires floor access before gold and rejects an absent key',()=>{
 const f=bank();assert.equal(f.send({pack:'items9'}).body.error,'unlock the bank floor first');assert.equal(f.send({pack:'items8',kind:'key'}).body.error,'required bank key is not owned');assert.deepEqual(f.state.merchantQueue,[]);
 f.state.bankSnapshot.packs.items0=[{slot:2,item:{name:'key'}}];const result=f.send({pack:'items8',kind:'key'});assert.equal(result.code,200);assert.equal(result.body.job.gold,0);assert.equal(result.body.job.key,'key');assert.deepEqual(f.calls.slice(-2),['persist','dispatch']);
 assert.equal(f.send({pack:'items8',kind:'key'}).body.error,'a bank unlock is already queued');
});
test('newly opened floor permits paid vaults but never reopens an unlocked pane',()=>{
 const f=bank();f.state.bankSnapshot.packs.items8=[];assert.equal(f.send({pack:'items8'}).code,409);const result=f.send({pack:'items9'});assert.equal(result.body.job.gold,10000);assert.equal(result.body.job.key,null);
});
test('restock preserves defaults, explicit zero and null coercion, rejecting reversed bounds',()=>{
 const state={restockPolicies:{}};let saved=0;const route=createRestockRoute(state,{owned:n=>n==='F',persist:()=>saved++});
 assert.equal(invoke(route,{character:'X'}).code,400);invoke(route,{character:'F'});assert.deepEqual(state.restockPolicies.F.hp,{item:'hpot1',min:5,max:20});
 invoke(route,{character:'F',hp:null});assert.deepEqual(state.restockPolicies.F.hp,{item:'hpot1',min:0,max:0});
 assert.equal(invoke(route,{character:'F',hp:{min:20,max:5}}).code,400);assert.equal(saved,2);
});
test('manual blacklist preserves realm keys and indefinite or fractional-minute expiry',()=>{
 const state={merchantBlacklist:{}};let saved=0;const route=createMerchantBlacklistRoute(state,{now:()=>100,key:e=>[e.seller,e.serverRegion,e.serverIdentifier].join('|'),log(){},persist:()=>saved++});
 invoke(route,{seller:' Seller ',minutes:-1});assert.equal(state.merchantBlacklist['Seller||'].until,-1);
 invoke(route,{seller:'Seller',serverRegion:'US',serverIdentifier:'II',minutes:1.5});assert.equal(state.merchantBlacklist['Seller|US|II'].until,90100);
 assert.equal(invoke(route,{seller:'Seller',minutes:0}).code,400);assert.equal(saved,2);
 invoke(route,{action:'clear',key:'Seller||'});assert.equal(Object.keys(state.merchantBlacklist).length,1);invoke(route,{action:'clear'});assert.deepEqual(state.merchantBlacklist,{});
});

test('blacklist toggle persists independently of records and manual blocks remain effective',()=>{
 const {merchantBlocked}=require('../../runtime/coordinator/commerce/merchant-blacklist.ts');
 const state={merchantBlacklist:{'S|US|I':{reason:'seller_not_visible',until:500},'S||':{reason:'manual',until:-1}}};
 let saved=0;const route=createMerchantBlacklistRoute(state,{now:()=>100,key:()=>'',log(){},persist:()=>saved++});
 assert.equal(invoke(route,{action:'configure',enabled:false}).code,200);assert.equal(state.autoBlacklistMerchants,false);
 const entry={seller:'S',serverRegion:'US',serverIdentifier:'I'};
 assert.equal(merchantBlocked(state.merchantBlacklist,entry,100,false),true);
 delete state.merchantBlacklist['S||'];assert.equal(merchantBlocked(state.merchantBlacklist,entry,100,false),false);
 assert.equal(merchantBlocked(state.merchantBlacklist,entry,100,true),true);
 assert.equal(invoke(route,{action:'configure',enabled:'false'}).code,400);assert.equal(saved,1);
 invoke(route,{action:'clear'});assert.deepEqual(state.merchantBlacklist,{});assert.equal(state.autoBlacklistMerchants,false);
});

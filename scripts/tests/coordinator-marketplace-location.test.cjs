const test=require('node:test'),assert=require('node:assert/strict');
const {createMarketplaceLocationRoute}=require('../../runtime/coordinator/http/marketplace-location.ts');
const {createMerchantRealmRoutes}=require('../../runtime/coordinator/http/merchant-realms.ts');
const response=()=>({code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
function fixture(){
 const listing={key:'key',seller:'Seller',serverRegion:'US',serverIdentifier:'II',item:{name:'cap',level:8},price:100,map:'main',x:0,y:0};
 const state={merchantCurrent:{id:'job',reason:'ALData marketplace purchases',listings:[listing]}};
 const offer={...listing,x:100},ports={fetch:async()=>[{id:'Seller',serverRegion:'US',serverIdentifier:'II',map:'main',x:100,y:0}],normalize:()=>[offer],persist(){},log(){}};
 const route=createMarketplaceLocationRoute(state,ports);
 async function send(){const r=response();await route({body:{jobId:'job',listingKey:'key'}},r);return r;}
 return {state,offer,ports,send};
}
test('marketplace location refresh requires the same level and favorable price, and consumes its one retry',async()=>{
 const t=fixture();assert.equal((await t.send()).body.location.x,100);assert.equal((await t.send()).body.reason,'location retry already used');
 const wrongLevel=fixture();wrongLevel.offer.item={name:'cap',level:7};assert.equal((await wrongLevel.send()).body.location,null);
 const expensive=fixture();expensive.offer.price=101;assert.equal((await expensive.send()).body.location,null);
});
test('in-flight marketplace location reply cannot revive a cancelled job',async()=>{
 const t=fixture(),fetch=t.ports.fetch;t.ports.fetch=async()=>{t.state.merchantCurrent=null;return fetch();};assert.equal((await t.send()).code,409);
});
test('merchant realm transitions acknowledge before delayed restart and avoid restarting an already-connected destination',()=>{
 const state={merchantCharacter:'M',activeRealm:'SR_USII',merchantCurrent:{id:'job',reason:'Ponty purchases'}},block={realm:'SR_EUI',connected:true},calls=[];
 const routes=createMerchantRealmRoutes(state,{now:()=>100,resolve:()=>true,block:()=>block,log(){},persist:()=>calls.push('persist'),restart:(_,delay)=>calls.push(['restart',delay]),label:r=>r});
 const res=response();const json=res.json;res.json=function(body){calls.push('response');return json.call(this,body);};
 routes.ensureHome({body:{character:'M',realm:'SR_USII'}},res);assert.deepEqual(calls,['persist','response',['restart',150]]);
 const already=response();routes.switchRealm({body:{jobId:'job',character:'M',realm:'SR_USII'}},already);assert.equal(already.body.alreadyThere,true);
});
test('merchant home return initializes an unassigned worker realm before restart',()=>{
 const block={},state={merchantCharacter:'M',activeRealm:'SR_USII',merchantCurrent:null},calls=[];
 const routes=createMerchantRealmRoutes(state,{now:()=>100,resolve:()=>true,block:()=>block,log(){},persist(){},
   restart:worker=>calls.push(worker.realm),label:r=>r});
 const res=response();routes.ensureHome({body:{character:'M',realm:'SR_USII'}},res);
 assert.equal(res.code,200);assert.equal(block.realm,'SR_USII');assert.deepEqual(calls,['SR_USII']);
});

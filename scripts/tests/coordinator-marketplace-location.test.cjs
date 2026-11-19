const test=require('node:test'),assert=require('node:assert/strict');
const {createMarketplaceLocationRoute}=require('../../runtime/items/coordinator/routes/market.ts');
const {createMerchantRealmOwner}=require('../../runtime/merchant-realm/coordinator/owner.ts');
const {createMerchantRealmRoutes}=require('../../runtime/merchant-realm/coordinator/routes.ts');
// The routes ask the realm owner's want; its restart waits for the reply to be sent (3.10 rule 5).
const realmRoutes=(state,ports)=>createMerchantRealmRoutes(state,{...ports,realm:createMerchantRealmOwner(Object.assign(state,{statuses:state.statuses||{},commands:state.commands||{},nextCommandId:state.nextCommandId||1}),{...ports,realmLabel:r=>r})});
const response=()=>({code:200,sent:[],status(code){this.code=code;return this;},json(body){this.body=body;return this;},once(event,listener){if(event==='finish')this.sent.push(listener);return this;}});
function fixture(){
 const listing={key:'key',seller:'Seller',serverRegion:'US',serverIdentifier:'II',item:{name:'cap',level:8},price:100,map:'main',x:0,y:0};
 const state={merchantCurrent:{id:'job',reason:'ALData marketplace purchases',listings:[listing]}};
 const offer={...listing,x:100},ports={fetch:async()=>[{id:'Seller',serverRegion:'US',serverIdentifier:'II',map:'main',x:100,y:0}],normalize:()=>[offer],persist(){},log(){}};
 const route=createMarketplaceLocationRoute(state,ports);
 async function send(){const r=response();await route({body:{jobId:'job',listingKey:'key'}},r);return r;}
 return {state,offer,ports,send};
}
// A refresh follows a seller only to a spot that differs from the one it last followed.
test('marketplace location refresh requires the same level and favorable price, and follows only a new spot',async()=>{
 const t=fixture();assert.equal((await t.send()).body.location.x,100);assert.equal((await t.send()).body.location,null);
 t.offer.x=200;assert.equal((await t.send()).body.location.x,200);
 // The refresh follows any spot that differs, a few pixels included; the same spot answers null.
 t.offer.x=203;assert.equal((await t.send()).body.location.x,203);assert.equal((await t.send()).body.location,null);
 const wrongLevel=fixture();wrongLevel.offer.item={name:'cap',level:7};assert.equal((await wrongLevel.send()).body.location,null);
 const expensive=fixture();expensive.offer.price=101;assert.equal((await expensive.send()).body.location,null);
});
test('in-flight marketplace location reply cannot revive a cancelled job',async()=>{
 const t=fixture(),fetch=t.ports.fetch;t.ports.fetch=async()=>{t.state.merchantCurrent=null;return fetch();};assert.equal((await t.send()).code,409);
});
test('merchant realm transitions acknowledge before delayed restart and avoid restarting an already-connected destination',()=>{
 const state={merchantCharacter:'M',activeRealm:'SR_USII',merchantCurrent:{id:'job',reason:'Ponty purchases'}},block={realm:'SR_EUI',connected:true},calls=[];
 const routes=realmRoutes(state,{now:()=>100,resolve:()=>true,block:()=>block,log(){},persist:()=>calls.push('persist'),restart:()=>calls.push('restart'),label:r=>r});
 const res=response();const json=res.json;res.json=function(body){calls.push('response');return json.call(this,body);};
 routes.ensureHome({body:{character:'M',realm:'SR_USII'}},res);assert.deepEqual(calls,['persist','response']);
 res.sent.forEach(listener=>listener());assert.deepEqual(calls,['persist','response','restart']);
 const already=response();routes.switchRealm({body:{jobId:'job',character:'M',realm:'SR_USII'}},already);assert.equal(already.body.alreadyThere,true);
});
test('merchant home return initializes an unassigned worker realm before restart',()=>{
 const block={},state={merchantCharacter:'M',activeRealm:'SR_USII',merchantCurrent:null},calls=[];
 const routes=realmRoutes(state,{now:()=>100,resolve:()=>true,block:()=>block,log(){},persist(){},
   restart:worker=>calls.push(worker.realm),label:r=>r});
 const res=response();routes.ensureHome({body:{character:'M',realm:'SR_USII'}},res);res.sent.forEach(listener=>listener());
 assert.equal(res.code,200);assert.equal(block.realm,'SR_USII');assert.deepEqual(calls,['SR_USII']);
});
// The confirmation of a blacklisted listing realm binds the order you placed: the hop reads it
// from the job, since the character's hop sends no confirm of its own.
test('a manual order confirmed for a blacklisted realm hops there; an unconfirmed one asks',()=>{
 for(const [realmConfirmed,code] of [[true,200],[undefined,409]]){
  const state={merchantCharacter:'M',activeRealm:'SR_USII',merchantRealmBlacklist:['SR_EUI'],
   merchantCurrent:{id:'job',reason:'ALData marketplace purchases',manual:true,realmConfirmed}},block={realm:'SR_USII',connected:true};
  const routes=realmRoutes(state,{now:()=>100,resolve:()=>true,block:()=>block,log(){},persist(){},restart(){},label:r=>r});
  const res=response();routes.switchRealm({body:{jobId:'job',character:'M',realm:'SR_EUI'}},res);
  assert.equal(res.code,code);if(code===409)assert.equal(res.body.needsConfirmation,true);
 }
});

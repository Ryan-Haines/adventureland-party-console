const test=require('node:test'),assert=require('node:assert/strict');
const {createMerchantClusterRoutes}=require('../../runtime/coordinator/http/merchant-clusters.ts');
function fixture(reason){
 const state={merchantCharacter:'M',merchantCurrent:{id:'job',target:'L',reason,expandLeaderCluster:true,radius:200},merchantQueue:[],marked:{F:[{}]},merchantMarked:{},
  statuses:Object.fromEntries(['L','F','P','M','Far','Dead'].map((name,i)=>[name,{seenAt:100000,map:'main',server:'USII',x:i*20,y:0,ctype:name==='M'?'merchant':'priest',rip:name==='Dead'}]))};
 state.statuses.Far.x=500;const calls=[];let next=1;
 const routes=createMerchantClusterRoutes(state,{now:()=>100000,nextCommand:()=>next++,active:()=>Object.keys(state.statuses),stamp:job=>({...job,stamped:true}),log(){},persist:()=>calls.push('persist')});
 function send(route){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};routes[route]({body:{jobId:'job'}},res);return res;}
 return {state,calls,send};
}
test('nearby marked collection accepts one marked slot and replaces a duplicate trip with same-batch work',()=>{
 const t=fixture('marked items');t.state.merchantQueue=[{id:'old',target:'F',reason:'marked items'},{id:'other',target:'Far',reason:'marked items'}];
 assert.deepEqual(t.send('marked').body.queued,['F']);assert.equal(t.state.merchantQueue[0].batchId,'marked-job');assert.equal(t.state.merchantQueue[1].id,'other');
 const count=t.state.merchantQueue.length;t.send('marked');assert.equal(t.state.merchantQueue.length,count);assert.equal(t.calls.length,1);
});
test('leader collection expands by distance without duplicating an already queued recipient',()=>{
 const t=fixture('party collection');t.state.merchantQueue=[{target:'P',reason:'party collection'}];
 assert.deepEqual(t.send('leader').body.queued,['F','P','Dead']);assert.equal(t.state.merchantQueue.filter(x=>x.target==='P').length,1);
 assert.equal(t.state.merchantQueue[0].target,'F');assert.equal(t.state.merchantQueue.some(x=>x.target==='Far'),false);
});
test('Luck cluster excludes merchants, dead members and other realms while preserving recipient order',()=>{
 const t=fixture('merchant luck');t.state.statuses.P.server='EUI';assert.deepEqual(t.send('luck').body.recipients,['L','F']);
 assert.equal(t.state.merchantQueue[0].castMerchantLuck,true);assert.equal(t.state.merchantQueue[0].expandLuckCluster,false);assert.equal(t.state.merchantQueue[0].batchId,'job');
});

// The tasks owner's scoped farming routes (runtime/tasks/coordinator/routes.ts): a follower's mode change
// goes to the saved mode route and starts no group work.
const test = require('node:test'), assert = require('node:assert/strict');
const {createScopedFarmingRoute} = require('../../runtime/tasks/coordinator/routes.ts');
function response(){return {code:200,status(code){this.code=code;return this},json(body){this.body=body;return body}}}
test('only follower mode saves use the preference route; merchants and inherited settings stay protected',()=>{
 let active=0, saved=0;
 const ports={owned:()=>true,merchant:()=> 'M',combat:n=>n!=='M',owner:n=>n==='P'?'W':n,solo:()=>null,mainOwner:()=> 'W',mode:n=>n==='P'?'hunt':'scatter'};
 const main=(req,res)=>{active++;res.json({ok:true})};
 const follower=(req,res)=>{saved++;res.json({ok:true,savedOnly:true})};
 const mode=createScopedFarmingRoute(main,()=>main,ports,true,follower);
 const res=response();mode({body:{character:'P',mode:'hunt'}},res);
 assert.equal(active,0);assert.equal(saved,1);assert.equal(res.body.savedFarmingPolicy,'hunt');assert.equal(res.body.effectiveFarmingPolicy,'scatter');
 const merchant=response();mode({body:{character:'M',mode:'hunt'}},merchant);assert.equal(merchant.code,409);
 const settings=createScopedFarmingRoute(main,()=>main,ports,true), blocked=response();
 settings({body:{character:'P'}},blocked);assert.equal(blocked.code,409);assert.equal(active,0);
 mode({body:{character:'W',mode:'scatter'}},response());assert.equal(active,1);
});

const test = require('node:test'), assert = require('node:assert/strict');
const {createSavedFarmingModeRoute} = require('../../runtime/coordinator/http/saved-farming-mode.ts');
const {observeStatus,statusRemaining} = require('../../dashboard/features/party/status-duration.ts');
const {createScopedFarmingRoute} = require('../../runtime/coordinator/http/farming-scope.ts');
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
test('follower preference saves validate Hunt backup and never start active work',()=>{
 const profile={farmingPolicy:'auto',location:null,monsterFocus:[]}, commands={P:{type:'attack'}}, leader={farmingPolicy:'scatter'};
 let saved=0;
 const route=createSavedFarmingModeRoute({profile:()=>profile,validLocation:(focus,location)=>location?.map==='cave'?location:null,persist(){saved++}});
 const call=body=>{const res=response();route({body:{character:'P',...body}},res);return res};
 assert.equal(call({mode:'invalid'}).code,400);
 assert.equal(call({mode:'hunt'}).body.code,'backup_required');
 assert.equal(profile.farmingPolicy,'auto');assert.equal(saved,0);
 assert.equal(call({mode:'hunt',backup:{monsterFocus:['rat'],location:{map:'cave',x:1,y:2}}}).body.savedOnly,true);
 assert.equal(profile.farmingPolicy,'hunt');assert.deepEqual(profile.monsterFocus,['rat']);
 assert.equal(profile.monsterHunt,undefined);assert.deepEqual(commands,{P:{type:'attack'}});assert.equal(leader.farmingPolicy,'scatter');
 assert.equal(call({mode:'default'}).code,200);assert.equal(profile.location.map,'cave');
});
test('status countdown retains duration across polls, refreshes and handles unknown duration',()=>{
 const condition={id:'luck',remainingMs:10000,definition:{},source:'M'};
 let value=observeStatus(condition,undefined,1000);
 assert.equal(statusRemaining(value,6000),5000);
 assert.equal(observeStatus(condition,value,4000),value);
 value=observeStatus({...condition,remainingMs:7000},value,4000);
 assert.equal(value.total,10000);assert.equal(statusRemaining(value,5000),6000);
 value=observeStatus({...condition,remainingMs:20000},value,5000);
 assert.equal(value.total,20000);assert.equal(statusRemaining(value,26000),0);
 assert.equal(observeStatus({...condition,remainingMs:null},value,6000),undefined);
 assert.equal(observeStatus(condition,undefined,30000).total,10000);
 assert.equal(observeStatus({...condition,definition:{duration:60000}},undefined,30000).total,60000);
});

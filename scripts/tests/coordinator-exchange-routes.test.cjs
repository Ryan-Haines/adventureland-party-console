const {withDoor}=require('./helpers/coordinator-merchant.cjs');
const test=require('node:test');
const {settingsWriter}=require('./helpers/settings-writer.cjs');
const assert=require('node:assert/strict');
const {createMerchantExchangeRoutes}=require('../../runtime/items/coordinator/routes/production.ts');
function fixture(){
 const state={merchantCharacter:'M',merchantCatalog:{exchangeable:[{id:'leather',level:0},{id:'token',level:1,reward:'coat'}]},merchantCurrent:null,merchantQueue:[],
  merchantRules:{owner:'M',members:['M']},autoItemMarks:{M:{}},autoUpgradeMarks:{},autoCompounds:{},autoDeconstruction:{},autoStandMarks:{},autoExchanges:{},autoNpcSales:{}},effects=[],writes=[];
 const writer=settingsWriter(state);
 const routes=createMerchantExchangeRoutes(state,withDoor(state,{write:batch=>{writes.push(batch);return writer.write(batch);},now:()=>100,nextCommand:()=>1,stamp:job=>({...job,priority:50}),log:()=>effects.push('log'),persist:()=>effects.push('persist'),dispatch:()=>effects.push('dispatch'),queueStorage:(job,shortages)=>{effects.push(['supply',job.id,shortages]);return true;}}));
 const post=(route,body)=>{const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};routes[route]({body},res);return res;};
 return {state,effects,writes,post};
}
test('exchange orders preserve level and reward choice and reject unavailable combinations',()=>{
 const f=fixture();assert.equal(f.post('order',{exchanges:[{id:'token',level:0,reward:'coat',quantity:1}]}).code,400);
 assert.equal(f.post('order',{exchanges:[{id:'token',level:1,reward:'coat',quantity:2}]}).code,200);
 assert.deepEqual(f.state.merchantQueue[0].exchanges,[{id:'token',level:1,quantity:2,reward:'coat'}]);assert.equal(f.state.merchantQueue[0].priority,50);
});
test('exchange progress is fenced to the current job and checkpoints remaining work before returning',()=>{
 const f=fixture();f.state.merchantCurrent={id:'job',reason:'exchange',target:'M'};
 const since=require('./helpers/items-notices.cjs').itemsSince('M');
 assert.equal(f.post('progress',{jobId:'stale',remaining:[],rewards:[]}).code,409);
 assert.equal(f.post('progress',{jobId:'job',remaining:[]}).code,400);assert.deepEqual(f.effects,[]);
 assert.equal(f.post('progress',{jobId:'job',remaining:[],rewards:[{name:'coat'}]}).code,200);assert.equal(f.state.merchantCurrent.exchangeResume,true);
 assert.deepEqual(f.state.merchantCurrent.exchangeRewards,[{name:'coat'}]);assert.deepEqual(f.effects,['persist']);
 assert.deepEqual(since().filter(e=>e.decision==='exchanged').map(e=>e.item),['coat'],'the record names the reward item');
});
test('exchange shortage requests are delegated without transferring merchant ownership prematurely',()=>{
 const f=fixture(),job=f.state.merchantCurrent={id:'job',reason:'exchange',target:'M'};
 const shortages=[{id:'leather',quantity:40}];assert.deepEqual(f.post('supply',{jobId:'job',shortages}).body,{pending:true});
 assert.equal(f.state.merchantCurrent,job);assert.deepEqual(f.effects,[['supply','job',shortages]]);
});

// Ported from aac30d45 coordinator-exchange-routes.test.cjs:5-17: the
// `progress` route answers each reward's fate under the rule owner, and a reward the rules bank is
// written as the owner's saved `bank` rule through the settings writer, so a restart reads it. v1.5
// (466), e2e/automatic-bank-routing-failures.md item 7: an explicit NPC sale rule keeps its reward and
// gets no bank rule beside it.
test("exchange progress answers the reward fates and saves the banked one as the rule owner's bank rule",()=>{
 const f=fixture();f.state.merchantCurrent={id:'job',reason:'exchange',target:'M'};
 const {commerceRuleKey}=require('../../runtime/items/identity.ts');
 f.state.autoNpcSales={[commerceRuleKey({name:'helmet'})]:{item:{name:'helmet'}}};
 const response=f.post('progress',{jobId:'job',remaining:[],rewards:[{name:'leather',q:3},{name:'helmet'}]});
 assert.equal(response.code,200);
 assert.deepEqual(response.body.rewardActions.map(entry=>entry.action),['bank','npc']);
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].by,'items:exchange-reward');
 const saved=JSON.stringify(f.writes[0].changes);
 assert.ok(saved.includes('leather@+0'),'the saved rule names the banked reward');assert.ok(!saved.includes('helmet@+0'));
 assert.deepEqual(f.effects,['persist']);
});

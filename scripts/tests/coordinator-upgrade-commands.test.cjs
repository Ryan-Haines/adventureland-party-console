const test=require('node:test'),assert=require('node:assert/strict');
const {createUpgradeCommands}=require('../../runtime/coordinator/inventory/upgrade-commands.ts');
const {autoItemRuleKey}=require('../../runtime/coordinator/inventory/item-identity.ts');
function fixture(){const state={upgrades:{},autoUpgradeMarks:{},goldTargets:{},statuses:{F:{}}},calls=[];
 const service=createUpgradeCommands(state,{key:autoItemRuleKey,persist:()=>calls.push('persist'),queue:(...args)=>calls.push(['queue',...args]),reconcile:(...args)=>calls.push(['reconcile',...args])});
 return {state,calls,send:body=>service.handle({character:'F',...body})};}
test('upgrade intent retains starting item and distinguishes equipped slots',()=>{
 const f=fixture(),item={name:'cap',level:7};f.send({type:'upgrade-mark',item,slot:2,tiers:1});f.send({type:'upgrade-mark',item,slot:'helmet',equipped:true,tiers:1});
 assert.deepEqual(f.state.upgrades.F,[{slot:2,item,tiers:1},{slot:'helmet',item,equipped:true,tiers:1}]);
 assert.equal(f.send({type:'upgrade-mark',item,slot:2,tiers:7}).status,400);assert.equal(f.state.upgrades.F[0].tiers,1);
 f.send({type:'upgrade-mark',item,slot:2,remove:true});assert.equal(f.state.upgrades.F.length,1);
 assert.equal(f.send({type:'upgrade-mark',item,slot:'helmet',tiers:1}),undefined);
});
test('automatic mark is idempotent for the matching target without removing manual intent',()=>{
 const f=fixture(),item={name:'cap',level:7},body={type:'auto-upgrade-mark',item,slot:2,tiers:1};
 f.state.upgrades.F=[{slot:3,item,tiers:1}];f.send(body);const key=autoItemRuleKey(item);
 assert.deepEqual(f.state.autoUpgradeMarks.F[key],{tiers:1,quantity:-1});assert.equal(f.state.upgrades.F.length,2);
 f.send({...body,remove:true});assert.equal(f.state.autoUpgradeMarks.F[key],undefined);assert.equal(f.state.upgrades.F.length,1);assert.equal(f.state.upgrades.F[0].slot,3);
 // Explicit removal does not schedule more production.
 assert.equal(f.calls.filter(c=>c[0]==='queue').length,1);
 assert.ok(f.calls.filter(c=>c[0]==='queue').every(c=>c[2]==='auto upgrade'));
});
test('rule editing supports legacy scalar rules and updates only matching automatic marks',()=>{
 const f=fixture(),item={name:'cap',level:7},key=autoItemRuleKey(item);f.state.autoUpgradeMarks.F={[key]:1};
 f.state.upgrades.F=[{slot:1,item,tiers:1,auto:true},{slot:2,item,tiers:1}];
 assert.equal(f.send({type:'update-auto-upgrade-rule',ruleKey:key,tiers:2,quantity:3}),null);
 assert.deepEqual(f.state.autoUpgradeMarks.F[key],{tiers:2,quantity:3});assert.equal(f.state.upgrades.F[0].tiers,2);assert.equal(f.state.upgrades.F[1].tiers,1);
 assert.equal(f.calls.at(-1)[0],'reconcile');assert.equal(f.send({type:'update-auto-upgrade-rule',ruleKey:'missing'}).status,404);
 assert.equal(f.send({type:'update-auto-upgrade-rule',ruleKey:key,quantity:0}).status,400);
 f.send({type:'update-auto-upgrade-rule',ruleKey:key,remove:true});assert.equal(f.state.upgrades.F.length,1);
});
test('gold target preserves zero and refuses nonnumeric or unsafe amounts',()=>{
 const f=fixture();assert.equal(f.send({type:'gold-target',amount:0}),null);assert.equal(f.state.goldTargets.F,0);
 for(const amount of ['10',-1,1.5,1000000000001])assert.equal(f.send({type:'gold-target',amount}),undefined);
});

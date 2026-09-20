const {test}=require('node:test'),assert=require('node:assert/strict');
const {migrateSharedRules,resolveRuleConflict,itemRuleConflicts}=require('../../runtime/coordinator/inventory/shared-rules.ts');
const {beginProduction,finishProduction}=require('../../runtime/coordinator/inventory/production.ts');
const {reconcileCoordinatorCollectionMarks,reconcileCoordinatorUpgradeMarks}=require('../../runtime/coordinator/inventory/mark-reconciliation.ts');
const {coordinatorCollectionReady,coordinatorCollectionSlots}=require('../../runtime/coordinator/merchant/queue-selection.ts');
const {automaticCommerceRuleKey}=require('../../runtime/coordinator/inventory/item-identity.ts');
function fixture(){return {merchantCharacter:'M',autoItemMarks:{},autoUpgradeMarks:{},autoCompounds:{},autoDeconstruction:{},autoNpcSales:{},autoStandMarks:{},autoExchanges:{},marked:{},merchantMarked:{},upgrades:{},production:{attempts:{}}};}
const item={name:'cap',level:0}, entry={slot:1,item,meta:{upgradeable:true}};
test('migration gives merchant precedence, imports unique rules and preserves manual requests',()=>{
 const s=fixture();s.autoUpgradeMarks={M:{'cap@+0':{tiers:1,quantity:2}},F:{'cap@+0':{tiers:2},'sword@+0':{tiers:1}}};s.upgrades.F=[{...entry,tiers:2}];
 assert.equal(migrateSharedRules(s,['F']),true);assert.equal(s.autoUpgradeMarks.M['cap@+0'].tiers,1);assert.equal(s.autoUpgradeMarks.M['sword@+0'].tiers,1);assert.equal(s.upgrades.F[0].tiers,2);
 assert.ok(s.merchantRules.backup.autoUpgradeMarks.F);const before=JSON.stringify(s);assert.equal(migrateSharedRules(s,['F']),false);assert.equal(JSON.stringify(s),before);
});
test('conflicting fighter rules remain inactive until chosen and identical rules collapse',()=>{
 const s=fixture();s.autoItemMarks={F:{'cap@+0':'bank','sword@+0':'bank'},G:{'cap@+0':'merchant','sword@+0':'bank'}};migrateSharedRules(s,['F','G']);
 assert.equal(s.autoItemMarks.M['cap@+0'],undefined);assert.equal(s.autoItemMarks.M['sword@+0'],'bank');assert.equal(s.merchantRules.conflicts.length,1);
 assert.equal(resolveRuleConflict(s,'item:cap@+0','G'),true);assert.equal(s.autoItemMarks.M['cap@+0'],'merchant');assert.equal(resolveRuleConflict(s,'item:cap@+0','F'),false);
});
test('fighter consumes merchant rule and banking waits for processing without deleting preference',()=>{
 const s=fixture();s.autoItemMarks.M={'cap@+0':'bank'};s.autoUpgradeMarks.M={'cap@+0':{tiers:1,quantity:1}};migrateSharedRules(s,['F']);
 reconcileCoordinatorCollectionMarks(s,'F',{items:[entry]});assert.deepEqual(s.marked.F,[]);assert.equal(s.autoItemMarks.M['cap@+0'],'bank');
 reconcileCoordinatorUpgradeMarks(s,'F',{items:[entry]});assert.equal(s.upgrades.F[0].auto,true);
 s.autoUpgradeMarks.M['cap@+0'].quantity=0;reconcileCoordinatorUpgradeMarks(s,'F',{items:[entry]});assert.deepEqual(s.upgrades.F,[]);
 reconcileCoordinatorCollectionMarks(s,'F',{items:[entry]});assert.equal(s.marked.F.length,1);
});
test('explicit equipped automatic request survives reconciliation in its original slot',()=>{
 const s=fixture();s.autoUpgradeMarks.M={'cap@+0':1};s.upgrades.F=[{slot:'helmet',equipped:true,item,tiers:1,auto:true}];migrateSharedRules(s,['F']);
 reconcileCoordinatorUpgradeMarks(s,'F',{items:[],slots:{helmet:{item}}});assert.equal(s.upgrades.F.length,1);assert.equal(s.upgrades.F[0].slot,'helmet');
});
test('destructive rule conflicts pause automatic upgrades without hiding the rules',()=>{
 const s=fixture();s.autoUpgradeMarks.M={'cap@+0':{tiers:1,quantity:1}};s.autoNpcSales[automaticCommerceRuleKey(item)]={item};migrateSharedRules(s,['F']);
 assert.deepEqual(itemRuleConflicts(s,item),['Processing','NPC sale']);reconcileCoordinatorUpgradeMarks(s,'F',{items:[entry]});assert.deepEqual(s.upgrades.F,[]);
 s.autoUpgradeMarks.M['cap@+0'].quantity=0;assert.deepEqual(itemRuleConflicts(s,item),[]);
});
test('auto processing contributes to the same collection slots and threshold',()=>{
 const s=fixture();migrateSharedRules(s,['F']);Object.assign(s,{itemCollectionThreshold:5,statuses:{M:{map:'main',server:'US I',x:0,y:0,seenAt:100},F:{map:'main',server:'US I',x:2000,y:0,seenAt:100,items:[entry]}}});s.upgrades.F=[{...entry,auto:true,tiers:1}];
 assert.equal(coordinatorCollectionSlots(s,'F'),1);assert.equal(coordinatorCollectionReady(s,{target:'F',reason:'auto upgrade'},()=>100),false);
 assert.equal(coordinatorCollectionReady(s,{target:'F',reason:'manual upgrades'},()=>100),true);s.statuses.M.x=2000;assert.equal(coordinatorCollectionReady(s,{target:'F',reason:'auto upgrade'},()=>100),true);
});
test('production decrements remaining quantity once across persisted retry; stock does not count',()=>{
 let s=fixture();s.autoUpgradeMarks.M={'cap@+0':{tiers:1,quantity:2}};s.statuses={F:{items:[{slot:0,item:{name:'cap',level:9}}]}};
 const body={id:'one',kind:'upgrade',item};beginProduction(s,body);finishProduction(s,'one',true);assert.equal(s.autoUpgradeMarks.M['cap@+0'].quantity,1);
 s=JSON.parse(JSON.stringify(s));beginProduction(s,body);finishProduction(s,'one',true);assert.equal(s.autoUpgradeMarks.M['cap@+0'].quantity,1);
 beginProduction(s,{...body,id:'two'});finishProduction(s,'two',true);assert.equal(s.autoUpgradeMarks.M['cap@+0'].quantity,0);assert.ok(s.autoUpgradeMarks.M['cap@+0']);
 assert.throws(()=>beginProduction(s,{...body,id:'three',automatic:{family:'upgrade',key:'cap@+0'}}),/quota completed/);
});
test('failed production and edited rules do not consume a new quantity; unlimited remains unlimited',()=>{
 const s=fixture();s.autoUpgradeMarks.M={'cap@+0':{tiers:1,quantity:2}};const body={id:'a',kind:'upgrade',item};beginProduction(s,body);finishProduction(s,'a',false);assert.equal(s.autoUpgradeMarks.M['cap@+0'].quantity,2);
 beginProduction(s,{...body,id:'b'});s.autoUpgradeMarks.M['cap@+0'].quantity=10;finishProduction(s,'b',true);assert.equal(s.autoUpgradeMarks.M['cap@+0'].quantity,10);
 s.autoUpgradeMarks.M['cap@+0'].quantity=-1;beginProduction(s,{...body,id:'c'});finishProduction(s,'c',true);assert.equal(s.autoUpgradeMarks.M['cap@+0'].quantity,-1);
});
test('only final-level compound output consumes quota, and overlapping attempts are rejected',()=>{
 const s=fixture();s.autoCompounds.M=[{name:'ring',targetTier:2,quantity:1}];beginProduction(s,{id:'a',kind:'compound',item:{name:'ring',level:0}});
 assert.throws(()=>beginProduction(s,{id:'b',kind:'compound',item:{name:'ring',level:1}}),/recovery pending/);finishProduction(s,'a',true);assert.equal(s.autoCompounds.M[0].quantity,1);
 beginProduction(s,{id:'b',kind:'compound',item:{name:'ring',level:1}});finishProduction(s,'b',true);assert.equal(s.autoCompounds.M[0].quantity,0);
 assert.throws(()=>beginProduction(s,{id:'b',kind:'upgrade',item}),/identity changed/);
});

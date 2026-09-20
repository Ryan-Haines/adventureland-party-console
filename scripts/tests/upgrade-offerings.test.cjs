const {test}=require('node:test'),assert=require('node:assert/strict');
const {offeringRule}=require('../../runtime/upgrade-offerings.ts');
const {createOfferingCommands}=require('../../runtime/coordinator/inventory/upgrade-offerings.ts');
const {createUpgradeCommands}=require('../../runtime/coordinator/inventory/upgrade-commands.ts');
const {offeringStock}=require('../../runtime/coordinator/inventory/offering-stock.ts');
const {recordOfferingWait,upgradeOfferingReady}=require('../../runtime/coordinator/inventory/offering-waits.ts');
const {beginProduction,finishProduction}=require('../../runtime/coordinator/inventory/production.ts');
const {reconcileUpgradeMarks}=require('../../runtime/coordinator/inventory/upgrade-marks.ts');
const {initialItemIntents}=require('../../runtime/coordinator/inventory/initial-intents.ts');
function fixture(){return {merchantCharacter:'M',merchantCatalog:{allItems:[{id:'sword',upgradeable:true,meta:{maxLevel:13}}]},statuses:{M:{items:[]}},
 upgrades:{M:[]},autoUpgradeMarks:{M:{'sword@+0':{tiers:9,quantity:1}}},autoCompounds:{},goldTargets:{},production:{attempts:{}},upgradeOfferingRules:[]};}
function rule(extra={}){return {id:'primling',name:'sword',floor:7,ceiling:9,offering:'offeringp',required:true,...extra};}
test('ranges cover transitions, with adjacent ranges and no overlap',()=>{
 const state=fixture(),command=createOfferingCommands(state,()=>{});
 for(const r of [rule({id:undefined}),rule({id:undefined,floor:9,ceiling:13,offering:'offering'})])assert.equal(command({type:'upgrade-offering-rule',rule:r}),null);
 assert.equal(offeringRule(state.upgradeOfferingRules,'sword',6),undefined);
 assert.equal(offeringRule(state.upgradeOfferingRules,'sword',8).offering,'offeringp');
 assert.equal(offeringRule(state.upgradeOfferingRules,'sword',9).offering,'offering');
 assert.equal(offeringRule(state.upgradeOfferingRules,'sword',13),undefined);
 assert.equal(offeringRule(state.upgradeOfferingRules,'other',8),undefined);
 const conflict=command({type:'upgrade-offering-rule',rule:rule({id:undefined,floor:8,ceiling:10})});
 assert.equal(conflict.status,409);assert.match(conflict.body.error,/already a rule.*\+7 to \+9/);
 for(const invalid of [{floor:9,ceiling:9},{floor:-1},{ceiling:14},{offering:'scroll0'},{required:'yes'},{name:'unknown'}])
  assert.equal(command({type:'upgrade-offering-rule',rule:rule({id:undefined,...invalid})}).status,400);
 const saved=JSON.parse(JSON.stringify(state));assert.deepEqual(initialItemIntents(saved).upgradeOfferingRules,state.upgradeOfferingRules);
 const first=state.upgradeOfferingRules[0];assert.equal(command({type:'upgrade-offering-rule',rule:{...first,required:false}}),null);
 assert.equal(command({type:'upgrade-offering-rule',rule:{id:first.id},remove:true}),null);assert.equal(state.upgradeOfferingRules.length,1);
});
test('stock counts merchant and bank only, excluding locked and reserved quantities',()=>{
 const state=fixture();state.statuses.M.items=[{slot:0,item:{name:'offeringp',q:3}},{slot:1,item:{name:'offeringx',l:'l'}}];
 state.statuses.F={items:[{item:{name:'offering',q:50}}]};state.bankSnapshot={packs:{items0:[{item:{name:'offering',q:2}}]}};
 state.merchantQueue=[{id:'craft',order:{crafts:[{id:'sword',quantity:1}],requirements:[{id:'offeringp',quantity:2}]}}];
 assert.deepEqual(offeringStock(state),{offeringp:1,offering:2,offeringx:0});
});
test('manual offering replaces a mark with a durable one-step request and cannot silently fall back',()=>{
 const state=fixture();state.statuses.M.items=[{item:{name:'offeringp',q:1}}];state.upgrades.M=[{slot:0,item:{name:'sword',level:8},tiers:4,auto:true}];
 const command=createUpgradeCommands(state,{key:i=>i.name+'@+'+(i.level||0),persist(){},queue(){},reconcile(){}});
 assert.equal(command.handle({type:'upgrade-mark',character:'M',slot:0,item:{name:'sword',level:8},tiers:1,offering:'offeringp'}),null);
 const mark=state.upgrades.M[0];assert.equal(mark.tiers,1);assert.equal(mark.auto,undefined);assert.ok(mark.requestId);
 assert.equal(command.handle({type:'upgrade-mark',character:'M',slot:0,item:mark.item,tiers:1,offering:'offering'}).status,409);
 const body={id:'attempt',kind:'upgrade',item:mark.item,requestId:mark.requestId,offering:mark.offering};
 beginProduction(state,body);finishProduction(state,'attempt',false);assert.deepEqual(state.upgrades.M,[]);
 assert.equal(beginProduction(state,body).completed,true);assert.equal(state.autoUpgradeMarks.M['sword@+0'].quantity,1);
 assert.throws(()=>beginProduction(state,{...body,id:'new'}),/no longer exists/);
});
test('required automatic step is refused without its offering; optional and outside-range attempts are allowed',()=>{
 for(const [level,required,offering,allowed] of [[8,true,undefined,false],[8,true,'offeringp',true],[8,false,undefined,true],[7,true,undefined,true],[9,true,undefined,true]]){
  const state=fixture();state.upgradeOfferingRules=[rule({floor:8,required})];
  const body={id:'a',kind:'upgrade',item:{name:'sword',level},automatic:{family:'upgrade',key:'sword@+0'},offering};
  if(allowed) assert.ok(beginProduction(state,body));else assert.throws(()=>beginProduction(state,body),/Required upgrade offering/);
 }
});
test('waiting retains original target across reconciliation and wakes on stock or rule changes',()=>{
 const state=fixture();state.upgradeOfferingRules=[rule({floor:8})];const mark={slot:0,item:{name:'sword',level:0},tiers:9,auto:true};state.upgrades.M=[mark];
 recordOfferingWait(state,{owner:'M',mark,level:8,offering:'offeringp'});
 assert.equal(upgradeOfferingReady(state,mark),false);
 const live=[{slot:0,item:{name:'sword',level:8},meta:{upgradeable:true}}];
 const next=reconcileUpgradeMarks(state.upgrades.M,state.autoUpgradeMarks.M,live);
 assert.equal(next.marks[0].tiers,9);assert.equal(next.marks[0].item.level,0);assert.ok(next.marks[0].waitingOffering);
 state.bankSnapshot={packs:{items0:[{item:{name:'offeringp'}}]}};assert.equal(upgradeOfferingReady(state,mark),true);
 state.bankSnapshot=null;state.upgradeOfferingRules=[];assert.equal(upgradeOfferingReady(state,mark),true);
});

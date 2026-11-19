const {scenarioTable}=require('./fixtures/scenarios.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {settingsWriter}=require('./helpers/settings-writer.cjs');
const {createClearItemMarks}=require('../../runtime/items/coordinator/fates.ts');
const {ruleKey,commerceRuleKey}=require('../../runtime/items/identity.ts');
const {reconcileCollectionMarks}=require('../../runtime/items/coordinator/fates.ts'),{ruleMode}=require('../../runtime/items/identity.ts');
function fixture(){
 const item={name:'ring',level:0},key=ruleKey(item),commerce=commerceRuleKey(item);
 const mark={slot:1,item},other={slot:2,item};
 const state={merchantCharacter:'M',statuses:{M:{items:[mark,other],slots:{ring1:{item}}}},
 marked:{M:[mark,{...other,auto:true}]},merchantMarked:{M:[mark]},upgrades:{M:[{...mark,tiers:1},{...other,auto:true,tiers:1}]},statScrolls:{M:[mark]},
 compounds:{M:[{id:'group',items:[mark,other]}]},autoItemMarks:{M:{[key]:'bank'}},autoUpgradeMarks:{M:{[key]:1}},autoCompounds:{M:[{name:'ring',targetTier:2}]},
 autoExchanges:{'ring@0':{name:'ring',level:0}},merchantWeapon:{item},autoNpcSales:{[commerce]:{item}},autoStandMarks:{[commerce]:{item}},autoDeconstruction:{M:{[commerce]:{item}}},
 npcSaleMarks:[{id:'sale',source:'merchant',...mark}],standListings:[{id:'stand',...mark}],deconstructionMarks:[{id:'decon',owner:'M',...mark}],merchantCurrent:{reason:'auto upgrade'},merchantQueue:[]};
 let saves=0;const send=createClearItemMarks(state,{persist:()=>saves++,changed:()=>{},write:settingsWriter(state).write});
 return {state,item,key,commerce,send:extra=>send({type:'clear-item-marks',character:'M',slot:1,item,...extra}),saves:()=>saves};
}
scenarioTable('clearing an item drops its marks and rules',fixture,[
 ['clear removes overlapping marks and applicable rules in one persisted mutation',f=>{
 assert.equal(f.send(),null);assert.equal(f.saves(),1);
 for(const field of ['marked','merchantMarked','upgrades','statScrolls','compounds','autoCompounds']) assert.deepEqual(f.state[field].M,[],field);
 for(const field of ['autoItemMarks','autoUpgradeMarks','autoDeconstruction']) assert.deepEqual(f.state[field].M,{},field);
 for(const field of ['autoNpcSales','autoStandMarks','autoExchanges']) assert.deepEqual(f.state[field],{},field);
 for(const field of ['npcSaleMarks','standListings','deconstructionMarks']) assert.deepEqual(f.state[field],[],field);
 assert.equal(f.state.merchantWeapon,null);assert.equal(f.state.merchantCurrent.itemMarksCleared,true);
 const restored=JSON.parse(JSON.stringify(f.state));assert.deepEqual(reconcileCollectionMarks(restored.marked.M,restored.merchantMarked.M,restored.statuses.M.items,one=>ruleMode(restored.autoItemMarks.M,one.item)).bank,[]);
 assert.equal(f.send(),null);
}],
 ['stale item request changes nothing',f=>{
 const before=JSON.stringify(f.state);assert.equal(f.send({item:{name:'cap'}}).status,409);assert.equal(JSON.stringify(f.state),before);assert.equal(f.saves(),0);
}],
 ['clearing a copy preserves other manual copies, other owners and bank stock marks',f=>{
 f.state.marked.M.push({slot:2,item:f.item});f.state.autoItemMarks.F={[f.key]:'bank'};
 f.state.npcSaleMarks.push({id:'bank',source:'bank',slot:1,item:f.item},{id:'fighter',source:'character',character:'F',slot:1,item:f.item});
 f.state.standListings.push({id:'bank-stand',bankPack:'items0',slot:1,item:f.item});
 f.send();assert.equal(f.state.marked.M.length,1);assert.equal(f.state.autoItemMarks.F[f.key],'bank');assert.deepEqual(f.state.npcSaleMarks.map(m=>m.id),['bank','fighter']);assert.equal(f.state.standListings[0].id,'bank-stand');
}],
 ['equipped clear removes equipped marks without clearing a manual inventory copy',f=>{
 f.state.upgrades.M.push({slot:'ring1',equipped:true,item:f.item});
 f.send({slot:'ring1',equipped:true});assert.equal(f.state.upgrades.M.length,1);assert.equal(f.state.upgrades.M[0].slot,1);
}],
// A mark change refreshes any current job's work after its current operation.
 ['a commerce job refreshes its work after a clear and lucky recovery bookkeeping is preserved',f=>{
 f.state.merchantCurrent={reason:'merchant commerce'};f.state.luckyRecovery={phase:'restoring'};
 f.send();assert.deepEqual(f.state.merchantCurrent,{reason:'merchant commerce',itemMarksCleared:true});assert.deepEqual(f.state.luckyRecovery,{phase:'restoring'});
}],
 ['a partially upgraded item clears its original automatic rule',f=>{
 f.state.upgrades.M[0]={slot:1,item:f.item,tiers:3,auto:true};
 const live={...f.item,level:1};f.state.statuses.M.items[0]={slot:1,item:live};
 assert.equal(f.send({item:live}),null);assert.equal(f.state.autoUpgradeMarks.M[f.key],undefined);assert.deepEqual(f.state.upgrades.M,[]);
}],
 ['queued automatic exchange drops only the cleared item',f=>{
 f.state.merchantQueue=[{reason:'exchange',autoExchangeKeys:['ring@0','gem@0'],exchanges:[{id:'ring',level:0},{id:'gem',level:0}]},{reason:'exchange',autoExchangeKeys:['ring@0'],exchanges:[{id:'ring',level:0}]}];
 f.send();assert.equal(f.state.merchantQueue.length,1);assert.deepEqual(f.state.merchantQueue[0].exchanges,[{id:'gem',level:0}]);
}],
// B160: clearing a bank copy's marks also releases what its dismantle and listing
// reserved, the merchant cell and the withdrawals that name them. b9b5c91e clear-item-marks.ts:53-58
// dropped only the marks on the bank cell, so the reservations outlived them.
 ['B160: clearing a bank copy releases the cell and withdrawals its dismantle and listing reserved',()=>{
 const item={name:'ring',level:0},state={merchantCharacter:'M',statuses:{M:{items:[]}},bankSnapshot:{packs:{items0:[{slot:3,item}]}},
  marked:{},merchantMarked:{M:[{slot:5,item,deconstructionId:'decon'},{slot:6,item:{name:'cap'}}]},upgrades:{},statScrolls:{},compounds:{},
  autoItemMarks:{},autoUpgradeMarks:{},autoCompounds:{},autoExchanges:{},merchantWeapon:null,merchantQueue:[],
  deconstructionMarks:[{id:'decon',owner:'M',bankPack:'items0',bankSlot:3,item}],standListings:[{id:'stand',storage:{pack:'items0',slot:3},item}],
  withdrawals:{M:[{pack:'items1',slot:9,item,deconstructionId:'decon'},{pack:'items1',slot:10,item,standListingId:'stand'},{pack:'items1',slot:11,item:{name:'cap'}}]}};
 const send=createClearItemMarks(state,{persist(){},changed(){},write:settingsWriter(state).write});
 assert.equal(send({type:'clear-item-marks',character:'M',pack:'items0',slot:3,item}),null);
 assert.deepEqual([state.deconstructionMarks,state.standListings],[[],[]]);
 assert.deepEqual(state.merchantMarked.M.map(mark=>mark.slot),[6],'the dismantle\'s merchant cell is released');
 assert.deepEqual(state.withdrawals.M.map(entry=>entry.slot),[11],'the dismantle\'s and the listing\'s withdrawals go');
}],
]);


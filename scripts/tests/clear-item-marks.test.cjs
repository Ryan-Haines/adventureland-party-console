const {test}=require('node:test'), assert=require('node:assert/strict');
const {createClearItemMarks}=require('../../runtime/coordinator/inventory/clear-item-marks.ts');
const {autoItemRuleKey,automaticCommerceRuleKey}=require('../../runtime/coordinator/inventory/item-identity.ts');
const {reconcileCollectionMarks}=require('../../runtime/coordinator/inventory/collection-marks.ts');
function fixture(){
 const item={name:'ring',level:0},key=autoItemRuleKey(item),commerce=automaticCommerceRuleKey(item);
 const mark={slot:1,item},other={slot:2,item};
 const state={merchantCharacter:'M',statuses:{M:{items:[mark,other],slots:{ring1:{item}}}},
 marked:{M:[mark,{...other,auto:true}]},merchantMarked:{M:[mark]},upgrades:{M:[{...mark,tiers:1},{...other,auto:true,tiers:1}]},statScrolls:{M:[mark]},
 compounds:{M:[{id:'group',items:[mark,other]}]},autoItemMarks:{M:{[key]:'bank'}},autoUpgradeMarks:{M:{[key]:1}},autoCompounds:{M:[{name:'ring',targetTier:2}]},
 autoExchanges:{'ring@0':{name:'ring',level:0}},merchantWeapon:{item},autoNpcSales:{[commerce]:{item}},autoStandMarks:{[commerce]:{item}},autoDeconstruction:{M:{[commerce]:{item}}},
 npcSaleMarks:[{id:'sale',source:'merchant',...mark}],standListings:[{id:'stand',...mark}],deconstructionMarks:[{id:'decon',owner:'M',...mark}],merchantCurrent:{reason:'auto upgrade'}};
 let saves=0;const send=createClearItemMarks(state,{persist:()=>saves++,changed:()=>{}});
 return {state,item,key,commerce,send:extra=>send({type:'clear-item-marks',character:'M',slot:1,item,...extra}),saves:()=>saves};
}
test('clear removes overlapping marks and applicable rules in one persisted mutation',()=>{
 const f=fixture();assert.equal(f.send(),null);assert.equal(f.saves(),1);
 for(const field of ['marked','merchantMarked','upgrades','statScrolls','compounds','autoCompounds']) assert.deepEqual(f.state[field].M,[],field);
 for(const field of ['autoItemMarks','autoUpgradeMarks','autoDeconstruction']) assert.deepEqual(f.state[field].M,{},field);
 for(const field of ['autoNpcSales','autoStandMarks','autoExchanges']) assert.deepEqual(f.state[field],{},field);
 for(const field of ['npcSaleMarks','standListings','deconstructionMarks']) assert.deepEqual(f.state[field],[],field);
 assert.equal(f.state.merchantWeapon,null);assert.equal(f.state.merchantCurrent.itemMarksCleared,true);
 const restored=JSON.parse(JSON.stringify(f.state));assert.deepEqual(reconcileCollectionMarks(restored.marked.M,restored.merchantMarked.M,restored.autoItemMarks.M,restored.statuses.M.items).bank,[]);
 assert.equal(f.send(),null);
});
test('stale item request changes nothing',()=>{
 const f=fixture(),before=JSON.stringify(f.state);assert.equal(f.send({item:{name:'cap'}}).status,409);assert.equal(JSON.stringify(f.state),before);assert.equal(f.saves(),0);
});
test('clearing a copy preserves other manual copies, other owners and bank stock marks',()=>{
 const f=fixture();f.state.marked.M.push({slot:2,item:f.item});f.state.autoItemMarks.F={[f.key]:'bank'};
 f.state.npcSaleMarks.push({id:'bank',source:'bank',slot:1,item:f.item},{id:'fighter',source:'character',character:'F',slot:1,item:f.item});
 f.state.standListings.push({id:'bank-stand',bankPack:'items0',slot:1,item:f.item});
 f.send();assert.equal(f.state.marked.M.length,1);assert.equal(f.state.autoItemMarks.F[f.key],'bank');assert.deepEqual(f.state.npcSaleMarks.map(m=>m.id),['bank','fighter']);assert.equal(f.state.standListings[0].id,'bank-stand');
});
test('equipped clear removes equipped marks without clearing a manual inventory copy',()=>{
 const f=fixture();f.state.upgrades.M.push({slot:'ring1',equipped:true,item:f.item});
 f.send({slot:'ring1',equipped:true});assert.equal(f.state.upgrades.M.length,1);assert.equal(f.state.upgrades.M[0].slot,1);
});
test('unrelated commerce is not interrupted and lucky recovery bookkeeping is preserved',()=>{
 const f=fixture();f.state.merchantCurrent={reason:'merchant commerce'};f.state.luckyRecovery={phase:'restoring'};
 f.send();assert.deepEqual(f.state.merchantCurrent,{reason:'merchant commerce'});assert.deepEqual(f.state.luckyRecovery,{phase:'restoring'});
});


test('a partially upgraded item clears its original automatic rule',()=>{
 const f=fixture();f.state.upgrades.M[0]={slot:1,item:f.item,tiers:3,auto:true};
 const live={...f.item,level:1};f.state.statuses.M.items[0]={slot:1,item:live};
 assert.equal(f.send({item:live}),null);assert.equal(f.state.autoUpgradeMarks.M[f.key],undefined);assert.deepEqual(f.state.upgrades.M,[]);
});
test('queued automatic exchange drops only the cleared item',()=>{
 const f=fixture();f.state.merchantQueue=[{reason:'exchange',autoExchangeKeys:['ring@0','gem@0'],exchanges:[{id:'ring',level:0},{id:'gem',level:0}]},{reason:'exchange',autoExchangeKeys:['ring@0'],exchanges:[{id:'ring',level:0}]}];
 f.send();assert.equal(f.state.merchantQueue.length,1);assert.deepEqual(f.state.merchantQueue[0].exchanges,[{id:'gem',level:0}]);
});

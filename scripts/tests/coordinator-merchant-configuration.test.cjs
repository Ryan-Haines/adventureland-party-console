const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorMerchantConfiguration}=require('../../runtime/merchant-jobs/coordinator/routes.ts');
const {settingsWriter}=require('./helpers/settings-writer.cjs');
function fixture(){
 const state={merchantCharacter:'M',gatheringModes:[],gatheringNoTool:{},merchantActivity:['old'],nextCommandId:10,commands:{},merchantCurrent:null,
  merchantRoutinePriorities:{},merchantAutomations:{},merchantQueue:[],threshold:100,itemCollectionThreshold:5,transferSignatures:{F:'old'}};
 const calls=[];let reasons;
 const service=createCoordinatorMerchantConfiguration(state,{
  ownedType:name=>name==='New'?'merchant':'priest',persist:()=>calls.push('persist'),write:settingsWriter(state).write,dispatch:()=>calls.push('dispatch'),log:()=>calls.push('log'),
  priorities:{service:50},automations:{'stand bid purchases':true},bidPurchaseReasons:()=>{assert.ok(reasons,'read before initialization');return reasons;},
  stamp:job=>({...job,priority:state.merchantRoutinePriorities.service}),write:batch=>writer.write(batch),
 });
 const writer=settingsWriter(state);
 function invoke(handler,body={}){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};handler({body},res);return res;}
 // The thresholds route is the settings owner's; the job owner answers its collection change.
 const {createThresholdRoute}=require('../../runtime/settings/coordinator/routes/thresholds.ts');
 service.thresholds=createThresholdRoute(state,{collectionChanged:service.collectionChanged,write:batch=>writer.write(batch)});
 return {state,calls,service,invoke,reasons:value=>{reasons=value;}};
}

test('routine checkboxes share the gathering button state and issue one combined command',()=>{
 const t=fixture();t.state.gatheringModes=['mining'];t.state.gatheringNoTool={fishing:true};
 t.invoke(t.service.priorities,{priorities:{},enabled:{fishing:true,mining:false}});
 assert.deepEqual(t.state.gatheringModes,['fishing']);assert.deepEqual(t.state.commands.M,{id:10,type:'merchant-gather',modes:['fishing']});
 assert.equal(t.state.gatheringNoTool.fishing,undefined);
 t.invoke(t.service.priorities,{priorities:{},enabled:{fishing:true,mining:false}});assert.equal(t.state.nextCommandId,11);
 t.invoke(t.service.settings.gather,{mode:'fishing',enabled:false});assert.deepEqual(t.state.gatheringModes,[]);
});


test('upgrade batch setting defaults to one and persists only valid integer limits', () => {
 const t=fixture();
 assert.equal(t.invoke(t.service.thresholds,{threshold:100}).body.buyUpgradeBatchSize,1);
 for(const value of [0,43,1.5,'invalid']) assert.equal(t.invoke(t.service.thresholds,{buyUpgradeBatchSize:value}).code,400);
 assert.equal(t.state.buyUpgradeBatchSize,undefined);
 assert.equal(t.invoke(t.service.thresholds,{buyUpgradeBatchSize:10}).code,200);
 assert.equal(t.state.buyUpgradeBatchSize,10);
 const {initialCollectionState}=require('../../runtime/items/saved-fields.ts'),read={declared:require('../../runtime/settings/coordinator/table.ts').declared};
 assert.equal(initialCollectionState({},{},read).buyUpgradeBatchSize,1);
 assert.equal(initialCollectionState({buyUpgradeBatchSize:10},{},read).buyUpgradeBatchSize,10);
 // The import runs the declared check.
 const batch=require('../../runtime/settings/coordinator/table.ts').coordinatorSettings().table.fields.get('buyUpgradeBatchSize').setting.check;
 assert.equal(batch(10),true);
 assert.equal(batch(1.5),false);
});

const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorMerchantConfiguration}=require('../../runtime/coordinator/http/merchant-configuration.ts');
function fixture(){
 const state={merchantCharacter:'M',gatheringModes:[],gatheringNoTool:{},merchantActivity:['old'],nextCommandId:10,commands:{},merchantCurrent:null,
  merchantRoutinePriorities:{},merchantAutomations:{},merchantQueue:[],threshold:100,itemCollectionThreshold:5,transferSignatures:{F:'old'}};
 const calls=[];let reasons;
 const service=createCoordinatorMerchantConfiguration(state,{
  ownedType:name=>name==='New'?'merchant':'priest',persist:()=>calls.push('persist'),dispatch:()=>calls.push('dispatch'),log:()=>calls.push('log'),
  priorities:{service:50},automations:{'stand bid purchases':true},bidPurchaseReasons:()=>{assert.ok(reasons,'read before initialization');return reasons;},
  stamp:job=>({...job,priority:state.merchantRoutinePriorities.service}),
 });
 function invoke(handler,body={}){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};handler({body},res);return res;}
 return {state,calls,service,invoke,reasons:value=>{reasons=value;}};
}

test('merchant settings follow replaced command, gathering and activity collections',()=>{
 const t=fixture();assert.deepEqual(t.calls,[]);
 assert.equal(t.invoke(t.service.settings.configure,{character:'New'}).code,200);
 t.state.commands={};t.state.gatheringModes=['mining'];t.state.gatheringNoTool={fishing:true};t.state.nextCommandId=90;
 t.invoke(t.service.settings.gather,{mode:'fishing',enabled:true});
 assert.deepEqual(t.state.commands.New,{id:90,type:'merchant-gather',modes:['mining','fishing']});
 assert.equal(t.state.gatheringNoTool.fishing,undefined);assert.equal(t.state.nextCommandId,91);
 t.state.merchantCurrent={id:'current'};
 assert.equal(t.invoke(t.service.settings.activity,{character:'New',jobId:'old',message:'test'}).code,409);
 assert.equal(t.invoke(t.service.settings.activity,{character:'New',jobId:'current',message:'test'}).code,200);
 t.state.merchantActivity=['replacement'];t.invoke(t.service.settings.clearActivity);assert.deepEqual(t.state.merchantActivity,[]);
});

test('routine configuration lazily reads bid reasons and replaces the current queue after filtering and stamping',()=>{
 const t=fixture();t.reasons(new Set(['Ponty purchases']));
 t.state.merchantRoutinePriorities={service:1};t.state.merchantAutomations={};
 const queue=[{id:'bid',reason:'Ponty purchases',bidItemId:'helmet'},{id:'manual',reason:'service'}];t.state.merchantQueue=queue;
 assert.equal(t.invoke(t.service.priorities,{priorities:{service:70},enabled:{'stand bid purchases':false}}).code,200);
 assert.deepEqual(t.state.merchantQueue,[{id:'manual',reason:'service',priority:70}]);
 assert.equal(queue.length,2);assert.equal(t.state.merchantRoutinePriorities.service,70);
 assert.deepEqual(t.calls,['persist','dispatch']);
});

test('threshold configuration clears collection signatures only after a valid collection value',()=>{
 const t=fixture(),original=t.state.transferSignatures;
 assert.equal(t.invoke(t.service.thresholds,{threshold:200,itemCollectionThreshold:0}).code,400);
 assert.equal(t.state.threshold,200);assert.equal(t.state.itemCollectionThreshold,5);
 assert.equal(t.state.transferSignatures,original);assert.deepEqual(t.calls,[]);
 t.state.transferSignatures={New:'replacement'};
 assert.equal(t.invoke(t.service.thresholds,{itemCollectionThreshold:8}).code,200);
 assert.equal(t.state.itemCollectionThreshold,8);assert.deepEqual(t.state.transferSignatures,{});
 assert.deepEqual(t.calls,['persist']);
});

test('routine checkboxes share the gathering button state and issue one combined command',()=>{
 const t=fixture();t.state.gatheringModes=['mining'];t.state.gatheringNoTool={fishing:true};
 t.invoke(t.service.priorities,{priorities:{},enabled:{fishing:true,mining:false}});
 assert.deepEqual(t.state.gatheringModes,['fishing']);assert.deepEqual(t.state.commands.M,{id:10,type:'merchant-gather',modes:['fishing']});
 assert.equal(t.state.gatheringNoTool.fishing,undefined);
 t.invoke(t.service.priorities,{priorities:{},enabled:{fishing:true,mining:false}});assert.equal(t.state.nextCommandId,11);
 t.invoke(t.service.settings.gather,{mode:'fishing',enabled:false});assert.deepEqual(t.state.gatheringModes,[]);
});

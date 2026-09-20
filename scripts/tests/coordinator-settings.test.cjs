const test=require('node:test');
const assert=require('node:assert/strict');
const {createMerchantSettingsRoutes}=require('../../runtime/coordinator/http/merchant-settings.ts');
const {createRoutinePriorityRoute}=require('../../runtime/coordinator/http/routine-priorities.ts');
const {createThresholdRoute}=require('../../runtime/coordinator/http/thresholds.ts');
const {httpFixture}=require('./helpers/coordinator-http.cjs');

test('gathering toggles preserve other modes, clear no-tool status, and reject stale merchant reports',()=>{
 const state={merchant:'M',modes:['fishing'],noTool:{mining:true},activity:[]},http=httpFixture(),commands=[];let id=0,saves=0;
 const routes=createMerchantSettingsRoutes(state,{ownedType:()=> 'merchant',persist:()=>saves++,dispatch(){},nextCommand:()=>++id,
  command:(name,command)=>commands.push({name,command}),currentJob:()=>({id:'job'}),log(){}});
 http.router.post('/gather',routes.gather);http.router.post('/status',routes.gatherStatus);
 assert.equal(http.invoke('POST','/gather',{mode:'mining',enabled:true}).response.code,200);
 assert.deepEqual(state.modes,['fishing','mining']);assert.deepEqual(state.noTool,{});
 http.invoke('POST','/gather',{mode:'mining',enabled:true});assert.deepEqual(state.modes,['fishing','mining']);
 assert.equal(http.invoke('POST','/status',{character:'old',mode:'fishing',noTool:true}).response.code,409);
 http.invoke('POST','/status',{character:'M',mode:'fishing',noTool:true});assert.deepEqual(state.modes,['mining']);
 assert.equal(state.noTool.fishing,true);assert.equal(commands.at(-1).command.type,'merchant-gather');assert.equal(saves,3);
});

test('merchant configuration and activity validate ownership and the active job',()=>{
 const state={merchant:'M',modes:[],noTool:{},activity:['old']},http=httpFixture(),effects=[];
 const routes=createMerchantSettingsRoutes(state,{ownedType:name=>name==='N'?'merchant':'warrior',persist:()=>effects.push('save'),dispatch:()=>effects.push('dispatch'),
  nextCommand:()=>1,command(){},currentJob:()=>({id:'current'}),log:message=>effects.push(message)});
 for(const [name,handler]of Object.entries(routes))http.router.post('/'+name,handler);
 assert.equal(http.invoke('POST','/configure',{character:'P'}).response.code,400);
 http.invoke('POST','/configure',{character:'N'});assert.equal(state.merchant,'N');assert.deepEqual(effects,['save','dispatch']);
 assert.equal(http.invoke('POST','/activity',{character:'N',jobId:'old',message:'discard'}).response.code,409);
 http.invoke('POST','/activity',{character:'N',jobId:'current',message:'progress'});assert.equal(effects.includes('progress'),true);
 http.invoke('POST','/clearActivity');assert.deepEqual(state.activity,[]);
});

test('routine settings discard disabled automatic bids while preserving manual marketplace work',()=>{
 const state={priorities:{fishing:20},automations:{'stand bid purchases':true},queue:[
  {id:'auto',target:'M',reason:'ALData marketplace purchases',bidItemId:'bid'},
  {id:'manual',target:'M',reason:'ALData marketplace purchases'}]},http=httpFixture();let saves=0;
 http.router.post('/priorities',createRoutinePriorityRoute(state,{priorities:{fishing:20},automations:{'stand bid purchases':true},
  bidPurchaseReasons:new Set(['ALData marketplace purchases']),stamp:job=>({...job,stamped:true}),persist:()=>saves++,dispatch(){}}));
 const result=http.invoke('POST','/priorities',{priorities:{fishing:0,unknown:999},enabled:{'stand bid purchases':false}}).response;
 assert.equal(result.code,200);assert.equal(state.priorities.fishing,0);assert.deepEqual(state.queue.map(j=>j.id),['manual']);
 assert.equal(state.queue[0].stamped,true);assert.equal(saves,1);
 assert.equal(http.invoke('POST','/priorities',{priorities:{fishing:101}}).response.code,400);assert.equal(saves,1);
});

test('collection thresholds validate bounds and invalidate collection signatures only when supplied',()=>{
 const state={threshold:100000,itemCollectionThreshold:5},http=httpFixture();let saves=0,invalidations=0;
 http.router.post('/config',createThresholdRoute(state,{persist:()=>saves++,collectionChanged:()=>invalidations++}));
 assert.equal(http.invoke('POST','/config',{}).response.code,400);
 for(const value of [0,43,1.5])assert.equal(http.invoke('POST','/config',{itemCollectionThreshold:value}).response.code,400);
 http.invoke('POST','/config',{threshold:0});assert.equal(state.threshold,0);assert.equal(invalidations,0);
 http.invoke('POST','/config',{itemCollectionThreshold:42});assert.equal(state.itemCollectionThreshold,42);assert.equal(invalidations,1);assert.equal(saves,2);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const {createMerchantSettingsRoutes}=require('../../runtime/merchant-jobs/coordinator/routes.ts');
const {createRoutinePriorityRoute}=require('../../runtime/merchant-jobs/coordinator/routes.ts');
const {createThresholdRoute}=require('../../runtime/settings/coordinator/routes/thresholds.ts');
const {httpFixture}=require('./helpers/coordinator-http.cjs');
const {settingsWriter,merchantViewNames}=require('./helpers/settings-writer.cjs');
const viewWriter=view=>settingsWriter(view,{names:merchantViewNames});

// A missing tool leaves the mode on and records it; the tool found clears the record. Each
// change of the record sends `merchant.gathering.noTool`.
test('gathering toggles preserve other modes, clear no-tool status, and reject stale merchant reports',()=>{
 const {partyHooks}=require('../../runtime/hooks/index.ts'),told=[];
 partyHooks().register({name:'core:no-tool-fixture',folder:'core',author:'test',summary:'Hears the no-tool notice.',
  hooks:{'merchant.gathering.noTool':payload=>told.push([payload.kind,payload.code])}});
 const state={merchant:'M',modes:['fishing'],noTool:{mining:true},activity:[]},http=httpFixture(),commands=[];let id=0,saves=0;
 const routes=createMerchantSettingsRoutes(state,{write:viewWriter(state).write,ownedType:()=> 'merchant',persist:()=>saves++,dispatch(){},nextCommand:()=>++id,
  command:(name,command)=>commands.push({name,command}),currentJob:()=>({id:'job'}),log(){}});
 http.router.post('/gather',routes.gather);http.router.post('/status',routes.gatherStatus);
 assert.equal(http.invoke('POST','/gather',{mode:'mining',enabled:true}).response.code,200);
 assert.deepEqual(state.modes,['fishing','mining']);assert.deepEqual(state.noTool,{});
 http.invoke('POST','/gather',{mode:'mining',enabled:true});assert.deepEqual(state.modes,['fishing','mining']);
 assert.equal(http.invoke('POST','/status',{character:'old',mode:'fishing',noTool:true}).response.code,409);
 const sent=commands.length;
 http.invoke('POST','/status',{character:'M',mode:'fishing',noTool:true});assert.deepEqual(state.modes,['fishing','mining']);
 assert.equal(state.noTool.fishing,true);assert.equal(commands.length,sent);assert.equal(saves,3);
 http.invoke('POST','/status',{character:'M',mode:'fishing',toolFound:true});assert.deepEqual(state.noTool,{});
 assert.deepEqual(told,[['mining','cleared'],['fishing','set'],['fishing','cleared']]);
});

test('merchant configuration and activity validate ownership and the active job',()=>{
 const state={merchant:'M',modes:[],noTool:{},activity:['old']},http=httpFixture(),effects=[];
 const routes=createMerchantSettingsRoutes(state,{write:viewWriter(state).write,ownedType:name=>name==='N'?'merchant':'warrior',persist:()=>effects.push('save'),dispatch:()=>effects.push('dispatch'),
  nextCommand:()=>1,command(){},currentJob:()=>({id:'current'}),log:message=>effects.push(message)});
 for(const [name,handler]of Object.entries(routes))http.router.post('/'+name,handler);
 assert.equal(http.invoke('POST','/configure',{character:'P'}).response.code,400);
 http.invoke('POST','/configure',{character:'N'});assert.equal(state.merchant,'N');assert.deepEqual(effects,['dispatch']);
 // The merchant is a setting the writer saves, with its audit line.
 assert.deepEqual(state.settingsChanges.map(l=>[l.field,l.new,l.by]),[['merchantCharacter','N','dashboard:merchant-config']]);
 assert.equal(http.invoke('POST','/activity',{character:'N',jobId:'old',message:'discard'}).response.code,409);
 http.invoke('POST','/activity',{character:'N',jobId:'current',message:'progress'});assert.equal(effects.includes('progress'),true);
 http.invoke('POST','/clearActivity');assert.deepEqual(state.activity,[]);
});

test('routine settings discard disabled automatic bids while preserving manual marketplace work',()=>{
 const state={priorities:{fishing:20},automations:{'stand bid purchases':true},queue:[
  {id:'auto',target:'M',reason:'ALData marketplace purchases',bidItemId:'bid'},
  {id:'manual',target:'M',reason:'ALData marketplace purchases'}]},http=httpFixture();let saves=0;
 http.router.post('/priorities',createRoutinePriorityRoute(state,{priorities:{fishing:20},automations:{'stand bid purchases':true},
  bidPurchaseReasons:new Set(['ALData marketplace purchases']),stamp:job=>({...job,stamped:true}),persist:()=>saves++,dispatch(){},write:viewWriter(state).write}));
 const result=http.invoke('POST','/priorities',{priorities:{fishing:0,unknown:999},enabled:{'stand bid purchases':false}}).response;
 assert.equal(result.code,200);assert.equal(state.priorities.fishing,0);assert.deepEqual(state.queue.map(j=>j.id),['manual']);
 assert.equal(state.queue[0].stamped,true);assert.equal(saves,1);
 assert.equal(http.invoke('POST','/priorities',{priorities:{fishing:101}}).response.code,400);assert.equal(saves,1);
});

test('collection thresholds validate bounds and invalidate collection signatures only when supplied',()=>{
 const state={threshold:100000,itemCollectionThreshold:5},http=httpFixture(),writer=settingsWriter(state);let invalidations=0;
 http.router.post('/config',createThresholdRoute(state,{write:writer.write,collectionChanged:()=>invalidations++}));
 assert.equal(http.invoke('POST','/config',{}).response.code,400);
 for(const value of [0,43,1.5])assert.equal(http.invoke('POST','/config',{itemCollectionThreshold:value}).response.code,400);
 http.invoke('POST','/config',{threshold:0});assert.equal(state.threshold,0);assert.equal(invalidations,0);
 http.invoke('POST','/config',{itemCollectionThreshold:42});assert.equal(state.itemCollectionThreshold,42);assert.equal(invalidations,1);assert.equal(writer.saves.length,2);
});

// The card's empty combat line sends `value: null` for its character, and the settings owner's writer takes
// that as removal of the entry, so the character returns to the owner's default.
test('a null character entry clears that entry and keeps the others',()=>{
 const state={hpPotionBelow:{}},writer=settingsWriter(state);
 assert.equal(writer.write({changes:[{field:'hpPotionBelow',character:'W',value:40},{field:'hpPotionBelow',character:'P',value:50}]}).ok,true);
 assert.equal(writer.write({changes:[{field:'hpPotionBelow',character:'W',value:null}]}).ok,true);
 assert.deepEqual(state.hpPotionBelow,{P:50});
});

// A batch that names a scope setting before the leader still saves it in the new leader's profile.
test('a leader change applies before the scope settings in the same batch',()=>{
 const profiles={A:{addonSettings:{}},W:{addonSettings:{}}},state={leader:'A'};
 Object.defineProperty(state,'addonSettings',{enumerable:true,get:()=>profiles[state.leader].addonSettings,set:v=>{profiles[state.leader].addonSettings=v;}});
 const writer=settingsWriter(state);
 const result=writer.write({changes:[{field:'addonSettings',value:{x:{limit:4}}},{field:'leader',value:'W'}]});
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.deepEqual(profiles.W.addonSettings,{x:{limit:4}});assert.deepEqual(profiles.A.addonSettings,{});
});

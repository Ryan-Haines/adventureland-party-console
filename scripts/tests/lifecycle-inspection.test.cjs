// The lifecycle owner's saved character inspection (runtime/lifecycle/coordinator/inspection.ts). Its
// own file: no other test builds the route, whose setup is a stub game directory and a stub account
// fetch. Failure modes: the saved profile maps to the report's stat names and each item carries the
// game's definition and the catalog's card data; a missing game file leaves the stats out and the log
// names why; a game file that never ends holds the inspection; gameScriptEvalMs (fields.ts) stops it,
// the inspection answers without derived stats, and the status owner's bound record counts the firing. A game account
// API that never answers holds it too; inspectionFetchBoundMs ends the read, the route answers 502, and
// the bound record counts the firing.
const test=require('node:test'),assert=require('node:assert/strict');
const {characterInspectionRoute}=require('../../runtime/lifecycle/coordinator/inspection.ts');
const {lifecycleSavedFields}=require('../../runtime/lifecycle/fields.ts');
const {boundFirings}=require('../../runtime/status/coordinator/api.ts');
// The inspection route for P over a stub game directory and account fetch; `ports` replaces single
// answers. `ask` runs it once and answers the status and body.
const inspectionRoute=ports=>characterInspectionRoute({owned:()=>true,now:()=>1,version:()=>7,directory:'/x/app',read:()=>'',catalog:()=>({}),session:()=>'s',log(){},...ports});
async function ask(route){
 let status=200,body;
 await route({params:{name:'P'}},{status(code){status=code;return this;},json(value){body=value;return this;}});
 return {status,body};
}
test('gameScriptEvalMs: a game file that never ends trips the bound and the inspection still answers',async()=>{
 const field=lifecycleSavedFields.settings.gameScriptEvalMs,saved=field.default;field.default=50;
 const before=boundFirings().counts.gameScriptEvalMs||0;
 try{
  const route=inspectionRoute({read:()=>'while(true){}',
   loadFetch:async()=>async()=>({ok:true,json:async()=>({success:true,profile:{name:'P',class:'priest',level:2,inventory:[],equipment:{}}})})});
  const {status,body}=await ask(route);
  assert.equal(status,200);assert.equal(body.character.inspection.calculated,false);
  assert.equal(boundFirings().counts.gameScriptEvalMs,before+1);
  const entry=boundFirings().entries.at(-1);assert.equal(entry.owner,'13');assert.equal(entry.state.version,7);
 }finally{field.default=saved;}
});
test('inspectionFetchBoundMs: a game account API that never answers trips the bound and the route answers 502',async()=>{
 const field=lifecycleSavedFields.settings.inspectionFetchBoundMs,saved=field.default;field.default=50;
 const before=boundFirings().counts.inspectionFetchBoundMs||0;
 try{
  // The stub answers only when the request's signal aborts, as a server that never replies, and
  // rejects as node-fetch does, with an `AbortError`.
  const route=inspectionRoute({
   loadFetch:async()=>(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('The operation was aborted.'),{name:'AbortError'}))))});
  const {status,body}=await ask(route);
  assert.equal(status,502);assert.ok(body.error);
  assert.equal(boundFirings().counts.inspectionFetchBoundMs,before+1);
  const entry=boundFirings().entries.at(-1);assert.equal(entry.owner,'13');assert.equal(entry.subject,'P');
 }finally{field.default=saved;}
});

// A stub game directory: data.js holds G, old_common_functions.js the game's helpers, stats.js the
// projection the coordinator evaluates (ProgressionStats).
const stubGame={'data.js':"var G={items:{blade:{upgrade:{gold:1}}},levels:{'2':900},classes:{priest:{main_stat:'int'}}};",
 'old_common_functions.js':"function process_game_data(){};var character_slots=['mainhand'],doublehand_types={};",
 'stats.js':"var ProgressionStats={helpers:function(){return {itemProperties:function(item){return {attack:item.level*10};}};},create:function(){return function(type,level){return {max_hp:400+level,max_mp:300,attack:42,int:12,luckm:1.5,speed:55};};}};"};
const profile={success:true,profile:{name:'P',class:'priest',level:2,xp:5,inventory:[{name:'blade',level:1},null],equipment:{mainhand:{name:'blade',level:3}}}};
async function inspect(read,logs){
 const route=inspectionRoute({read,log:message=>logs.push(message),
  catalog:()=>({allItems:[{id:'blade',meta:{card:'Blade'}}]}),loadFetch:async()=>async()=>({ok:true,json:async()=>profile})});
 const {status,body}=await ask(route);
 return {status,character:body.character};
}
test("a saved profile maps to the report stats and carries each item's game and catalog data",async()=>{
 const logs=[],{status,character}=await inspect(file=>stubGame[require('node:path').basename(file)],logs);
 assert.equal(status,200);assert.deepEqual(logs,[]);
 assert.equal(character.inspection.calculated,true);
 assert.equal(character.max_hp,402);assert.equal(character.max_xp,900);assert.equal(character.primaryStat,'int');
 assert.equal(character.attack,42);assert.equal(character.int,12);assert.equal(character.luck,150);assert.equal(character.speed,55);
 const blade=character.slots.mainhand.meta;
 assert.equal(blade.card,'Blade','the catalog card data stays');
 assert.equal(blade.properties.attack,30);assert.equal(blade.upgradeable,true);assert.equal(blade.maxLevel>0,true);
 assert.equal(character.items[0].slot,0);assert.equal(character.items[1],null);
});
test('a missing game file answers without derived stats and the log names why',async()=>{
 const logs=[],{status,character}=await inspect(file=>{throw Object.assign(Error('ENOENT: '+file),{code:'ENOENT'});},logs);
 assert.equal(status,200);assert.equal(character.inspection.calculated,false);
 assert.equal(character.slots.mainhand.meta.card,'Blade');
 assert.equal(logs.length,1);assert.match(logs[0],/^game 7 files gave no stat projection: ENOENT/);
});

// The lifecycle owner's route install registers the inspection route, beside its other
// routes.
test('the lifecycle route install registers the character inspection route',()=>{
 const {installLifecycleRoutes}=require('../../runtime/lifecycle/coordinator/routes.ts');
 const routes=[],router={get:(path)=>routes.push('GET '+path),post:(path)=>routes.push('POST '+path),use(){}};
 installLifecycleRoutes(router,{control:{},statuses:()=>({}),code:'/x/CODE',inspection:{owned:()=>true,now:()=>1,version:()=>7,directory:'/x/app',read:()=>'',catalog:()=>({}),session:()=>'s',log(){},loadFetch:async()=>fetch}});
 assert.ok(routes.includes('GET /party-api/characters/:name/inspection'));
});

// (inspection.ts's half): the route reads its three hidden settings through the settings owner's
// hiddenValue, so the party's copy applies. A held reuse of 0 makes every inspection read the game
// again; a read of the declaration's default kept the first answer for 30 s. It runs last, since
// the held party copy stays for the rest of the file.
test('the inspection reads its reuse window as the party holds it', async () => {
 const {hiddenSettings,holdHiddenSettings}=require('../../runtime/settings/coordinator/table.ts');
 holdHiddenSettings({...hiddenSettings({}),inspectionReuseMs:0});
 let fetches=0;
 const route=inspectionRoute({
  loadFetch:async()=>async()=>(fetches++,{ok:true,json:async()=>profile})});
 const response={status(){return this;},json(){return this;}};
 await route({params:{name:'P'}},response);await route({params:{name:'P'}},response);
 assert.equal(fetches,2);
});

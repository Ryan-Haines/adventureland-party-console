const {productionFunctions} = require('./helpers/production-functions.cjs');
const {scenarioTable} = require('./fixtures/scenarios.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
// `fates` is the items owner's items.fate answer per slot, which the handoff asks before each send.
function fixture(items, capacity = 42, extra = {}, fates = {}) {
  const sent = []; let receipt;
  const character = {items, isize: 42, slots: {}, gold: 0, name: 'F', map:'main', in:'main', x:0, y:0, cc:0, rip:false};
  const context = vm.createContext({character, G: {items: {
    weapon: {type: 'weapon'}, armor: {type: 'chest'}, ring: {type: 'ring'}, ingredient: {type: 'material'}
  }}, waitForPlayer: async()=>({}), assertMerchantContinuation(){},
  navigationIntent:{revision:1},lastCommand:1,runtimeCurrent:()=>true,reunionRealm:()=> 'USI',
  get_player:()=>({map:'main',in:'main',x:1,y:0,rip:false}),engagedMonster:()=>null,sleep:async()=>{},
  fingerprint: item=>({...item}), itemQuantity: item=>item?.q || 1,
  sameItem:(a,b)=>!!a && a.name===b.name, findItem: item=>items.findIndex(i=>i?.name===item.name),
  freeInventorySlots:()=>42-items.filter(Boolean).length,
  send_item:async(_,slot,q)=>{sent.push(items[slot].name); if(q >= (items[slot].q || 1)) items[slot]=null; else items[slot].q-=q;},
  request:async(url,options)=>{if(options)receipt=options.body;return url.startsWith('/merchant/job/')?{fates}:{};}, game_log(){}
  });
 // These rows plant no compound rule, so the items owner's compound stock answers no protected copy.
 context.compoundAvailableStock = () => [];
  // The cleanout rules and the visit are the job owner's character module;
  // keepTracktrixLast stays the items owner's and reads the tracker rule through the owner's door.
  require('./helpers/merchant-visits.cjs').installVisits(context);
  context.merchantJobs = { isPersonalTracker: context.isPersonalTracker };
  vm.runInContext(productionFunctions(['keepTracktrixLast']),context);
  return {sent, run:async()=>{await context.merchantHandoff({id:1,cleanout:true,capacity,merchant:'M',...extra});return receipt;}};
}
const bag=(front, size=42)=>[...front,...Array.from({length:size-front.length},()=>({name:'locked',l:true}))];
scenarioTable('the emergency cleanout sends the right copies in order and reports what remains',fixture,[
 ['emergency cleanout protects supplies and tracktrix and orders remaining categories',async f=>{
  const receipt=await f.run();
  assert.deepEqual(f.sent,['ingredient','ring','armor','weapon']);
  assert.equal(receipt.cleanoutRemaining,false);
 },
  bag(['weapon','armor','ring','ingredient','tracker','hpot0','mpot0','hpot1','mpot1'].map(name=>({name})))],
 ['manual and automatic marks precede extras; spare capacity cleans beyond emergency relief',async f=>{
  const receipt=await f.run();
  assert.deepEqual(f.sent,['weapon','armor','ingredient','ingredient','ring']);
  assert.equal(receipt.cleanoutRemaining,false);
 },
  bag(['weapon','ingredient','ring','armor','ingredient'].map(name=>({name}))),42,{
   marked:[{slot:0,item:{name:'weapon'}}],autoItemMarks:{armor:'merchant'}}],
 ['a capacity-limited pickup does not request another visit once emergency clears',async f=>{
  const receipt=await f.run();
  assert.deepEqual(f.sent,['ingredient','ring']);
  assert.equal(receipt.cleanoutRemaining,false);
 },
  bag(['ingredient','ring','armor','weapon'].map(name=>({name})),40),2],
 ['remaining emergency may retry, but a stale cleanout leaves unmarked items alone',async()=>{
  const f=fixture(bag(['ingredient','ring','armor','weapon'].map(name=>({name}))),2);
  assert.equal((await f.run()).cleanoutRemaining,true);
  const safe=fixture(bag([{name:'ingredient'},{name:'weapon'}],38));
  assert.equal((await safe.run()).cleanoutRemaining,false);
  assert.deepEqual(safe.sent,[]);
 }],
 ['all marked pickups run before emergency extras, even after enough slots are free',async f=>{
  assert.equal((await f.run()).cleanoutRemaining,false);
  assert.deepEqual(f.sent,['weapon','armor','ring','ingredient','ingredient']);
 },bag(['weapon','armor','ring','ingredient','ingredient'].map(name=>({name})),39),42,{
   marked:['weapon','armor','ring','ingredient','ingredient'].map((name,slot)=>({slot,item:{name}}))}],
 ['cleanout protects explicitly marked supplies and live locked items too',async f=>{
  await f.run();
  assert.deepEqual(f.sent,['ingredient']);
 },bag([{name:'tracker'},{name:'hpot0'},{name:'mpot0'},{name:'weapon',l:true},{name:'ingredient'}]),42,{
   marked:['tracker','hpot0','mpot0','weapon'].map((name,slot)=>({slot,item:{name}}))}],
 ["MJ90: each copy's fate decides every send, so a claimed or held copy stays through the cleanout and an auto rule",async f=>{
  await f.run();
  assert.deepEqual(f.sent,['ingredient','ring']);
 },bag(['elixir','ingredient','armor','ring'].map(name=>({name})),39),42,{autoItemMarks:{elixir:'merchant'}},
   {0:{fate:'keep',row:'F4',by:'claim:carried:F'},1:{fate:'keep',row:'F7',by:'default'},2:{fate:'held',row:'F1',by:'production'}}],
]);

const {test}=require('node:test'),assert=require('node:assert/strict');
const {productionHarness}=require('./helpers/items-character.cjs');
const {beginProduction,finishProduction,abortManualProduction,inspectProduction,pendingProduction,checkpointProduction}=require('../../runtime/items/coordinator/production.ts');
// The items owner's production journal (runtime/items/character/production.ts) on the items
// harness, answered by the coordinator's production records. The manual offering upgrade runs at
// the lucky slot, so no swap comes first; the game's upgrade consumes the offering and fails with
// the item kept.
function fixture(){
 const item={name:'sword',level:8},mark={slot:0,item,tiers:1,offering:'offeringp',requestId:'one'};
 const state={merchantCharacter:'M',upgrades:{M:[mark]},production:{attempts:{}},autoUpgradeMarks:{M:{}},autoCompounds:{}};
 const character={name:'M',ctype:'merchant',items:[{...item},{name:'offeringp',q:2},{name:'scroll2',q:2}]};
 let lost=false,calls=0;
 const h=productionHarness({character,G:{items:{scroll2:{type:'uscroll'}},skills:{}},ports:{
  job:()=>({jobId:'j',commandId:1}),
  upgrade:async(slot,scroll,offering)=>{calls++;character.items[offering].q--;character.items[scroll].q--;return {failed:true,success:false,num:slot};},
  request:async(path,{body})=>{
   if(body.protectionOnly)return {craftProtection:{requirements:[]},upgradeOfferingRules:[],upgradeOfferingStock:{}};
   if(body.action==='pending')return {pending:pendingProduction(state.production,true)};
   if(body.action==='checkpoint')return checkpointProduction(state,body);
   if(body.action==='inspect')return inspectProduction(state,body);
   if(body.action==='complete'){finishProduction(state,body.id,body.success);if(lost){lost=false;throw Error('response lost');}}
   else if(body.action==='abort-manual')abortManualProduction(state,body.id);
   else return {attempt:beginProduction(state,body)};
  },
 }});
 h.production.setLuckySlot(0);
 const upgrade=()=>h.production.upgradeConfirmed(0,2,undefined,undefined,undefined,{offering:'offeringp',requestId:'one'});
 return {h,character,state,mark,upgrade,calls:()=>calls,lose:()=>lost=true};
}
test('surviving failed manual attempt with a lost completion response consumes exactly one offering',async()=>{
 const f=fixture();f.lose();
 await assert.rejects(f.upgrade(),/response lost/);
 await f.h.production.recover();
 await f.upgrade();
 assert.equal(f.calls(),1);assert.equal(f.character.items[1].q,1);assert.equal(f.state.upgrades.M.length,0);
});
test('restart before issuing a game call retains the manual request for a real attempt',async()=>{
 const f=fixture(),body={id:'manual-offering:one',kind:'upgrade',item:f.mark.item,requestId:'one',offering:'offeringp'};
 beginProduction(f.state,body);f.h.stored['party-production']={id:body.id,item:body.item,slots:[0],phase:'running',request:body};
 await f.h.production.recover();assert.equal(f.state.upgrades.M.length,1);assert.equal(f.state.production.attempts[body.id],undefined);assert.equal(f.h.stored['party-production'],null);
});
test('restart after issuing a surviving attempt retires it without consuming again',async()=>{
 const f=fixture(),body={id:'manual-offering:one',kind:'upgrade',item:f.mark.item,requestId:'one',offering:'offeringp'};
 beginProduction(f.state,body);f.h.stored['party-production']={id:body.id,item:body.item,slots:[0],phase:'running',issued:true,request:body};
 await f.h.production.recover();assert.equal(f.state.upgrades.M.length,0);assert.equal(f.state.production.attempts[body.id].completed,true);assert.equal(f.h.stored['party-production'],null);
 assert.equal(f.calls(),0);assert.equal(f.character.items[1].q,2);
});

// The offering dialog and the items owner's rule write judge a rule with offeringProblem, so every destination the
// dialog offers is one the write accepts, and the write refuses in the dialog's words.
test('every ceiling the offering dialog offers is one 10 accepts, and a refusal names its words',()=>{
 const {offeringProblem,maximumItemLevel}=require('../../runtime/items/api.ts');
 const {createOfferingCommands}=require('../../runtime/items/coordinator/production.ts');
 const {settingsWriter}=require('./helpers/settings-writer.cjs');
 const max=maximumItemLevel({upgrade:true});
 for(let ceiling=1;ceiling<=max;ceiling++){
  const state={merchantCatalog:{allItems:[{id:'sword',upgradeable:true}]},upgradeOfferingRules:[]};
  const rule={id:'',name:'sword',floor:ceiling-1,ceiling,offering:'offeringp',required:true};
  assert.equal(offeringProblem([],rule,max),null,'dialog +'+ceiling);
  assert.equal(createOfferingCommands(state,settingsWriter(state).write)({type:'upgrade-offering-rule',rule}),null,'write +'+ceiling);
 }
 const state={merchantCatalog:{allItems:[{id:'sword',upgradeable:true}]},upgradeOfferingRules:[]};
 const refused=createOfferingCommands(state,settingsWriter(state).write)({type:'upgrade-offering-rule',rule:{id:'',name:'sword',floor:4,ceiling:4,offering:'offeringp',required:true}});
 assert.deepEqual(refused,{status:400,body:{error:offeringProblem([],{name:'sword',floor:4,ceiling:4},max).error}});
 assert.equal(refused.body.error,'Choose a higher destination level.');
});

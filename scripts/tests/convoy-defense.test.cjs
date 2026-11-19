const test=require('node:test'),assert=require('node:assert/strict');
test('Hunt mode does not authorize a new destination while fighting, and convoy startup waits',()=>{
 const {createHuntMode}=require('../../runtime/tasks/coordinator/slots.ts');const {createHunt}=require('../../runtime/hunting/coordinator/hunt.ts');
 const state={combatMode:'auto',monsterHunt:null,leader:'W',statuses:{},monsterFocus:[],monsterFocusByCharacter:{}};let authorized=0,begun=0;
 const {createHuntEntry}=require('../../runtime/hunting/coordinator/modes.ts');
 const mode=createHuntMode(state,{entry:createHuntEntry(state,{participants:()=>['W'],cancelled:()=>false,fighting:()=>true,release(){},clear(){},authorize(){authorized++;},begin(){begun++;}}),
  write:require('./helpers/settings-writer.cjs').settingsWriter(state).write});
 mode.select({targetMode:'hunt'},null,undefined,false);assert.equal(authorized,0);assert.equal(begun,1);assert.equal(state.targetMode,'hunt');
 // The Hunt's walk start (hunt.ts `start`) waits on movement's travel defense; it starts no walk.
 const h={participants:['W']},hunt=createHunt(state,{now:()=>1000,participants:()=>['W'],cancelConvoy(){},persist(){},selectedDestination:()=>null,
  start:()=>assert.fail('no walk while the defense waits'),navigation:{authorize(){},intent:()=>({})},ownsTravel:()=>false});
 assert.equal(hunt.start(h,{map:'main',x:0,y:0},'Daisy','daisy-sync-travel'),false);assert.equal(h.stage,'daisy-sync-travel');
});

const { createMovementContext } = require('./fixtures/movement-owner-callers.cjs');
test('protocol 4 local defense retains an identifiable handle until the coordinator acknowledges it',()=>{
 const fs=require('node:fs'),vm=require('node:vm');let stops=0,freezes=0;
 const convoy={id:'C',epoch:3,commandId:42,navigationRevision:9,purpose:'monster-hunt',freezeRoute(){freezes++;}};
 const c=createMovementContext({root:{partyRoleRunner:{wake(){}}},navigationIntent:{revision:9},parent:{entities:{}},groupWalk:{travel:convoy},releaseConvoyCruise(){},stop(){stops++;}});
 require('./helpers/walk-reports.cjs').installWalkDefense(c);
 c.interruptConvoyForDefense();c.interruptConvoyForDefense();
 assert.equal(c.groupWalk.travel,convoy);assert.equal(convoy.phase,'defending');assert.equal(convoy.defensePaused,true);
 assert.equal(convoy.commandId,42);assert.equal(convoy.navigationRevision,9);assert.equal(stops,1);assert.equal(freezes,1);
});
// Rows kept from the movement test audit that cut
// with no removal line. The coordinator rows run over a Hunt walk a follower's bee attacks, with
// survival's walk verdict (defense.ts walkOn) answering fight.
function defenseParty(){
 require('./fixtures/coordinator-core.cjs');
 const {partyHooks}=require('../../runtime/hooks/index.ts');
 partyHooks().publish({name:'core:test-verdict',folder:'core',author:'test',summary:"05's walk verdict: the party wins the fight.",hooks:{'survival.verdict':()=>'fight'}});
 const t={id:'A',map:'main',in:'main',server:'USII',x:5,y:0,state:'engaged',target:'P',mtype:'bee'};
 const p={commands:{},nextCommandId:10,navigationIntents:{W:{revision:1},P:{revision:1}},combatLogs:{},groupedCombat:{fights:[t],deaths:[]},
  statuses:Object.fromEntries(['W','P'].map(name=>[name,{name,map:'main',in:'main',server:'USII',x:0,y:0,hp:100,speed:50,seenAt:1000,groupedCombat:{reportedAt:1000,threats:[],sightings:[t]}}])),
  activeConvoy:{id:'C',epoch:1,phase:'assemble',purpose:'monster-hunt',participants:['W','P'],leader:'W',rally:{map:'main',x:0,y:0},location:{map:'cave',x:20,y:20},slowestSpeed:50,completed:[]}};
 require('./helpers/requesters.cjs').publishPresence(()=>p.statuses);
 require('./helpers/travel-observations.cjs').observeTravel(p.statuses);
 return {p,t,defense:require('../../runtime/movement/coordinator/defense.ts'),make:(s,walk,phase,name)=>({id:99,phase,name})};
}
const {scenarioTable}=require('./fixtures/scenarios.cjs');
scenarioTable('the coordinator defends a walk only from a live party attacker', defenseParty, [
 ['follower aggressor pauses the convoy; a planned neutral does not', ({p,t,defense,make})=>{
  p.groupedCombat.fights=[];p.groupedCombat.target={...t,state:'planned'};
  assert.equal(defense.classifyTravelDefense(p,['W','P'],1000).state,'clear');
  p.statuses.P.groupedCombat.currentAttackers=[t];assert.equal(defense.classifyTravelDefense(p,['W','P'],1000).state,'defending');
  defense.step(p,1000,make);assert.equal(p.activeConvoy.phase,'defending');
 }],
 ['an old invisible engagement cannot hold departure, but a visible party attacker can', ({p,t,defense})=>{
  for(const s of Object.values(p.statuses))s.groupedCombat.sightings=[];
  assert.equal(defense.classifyTravelDefense(p,['W','P'],1000).state,'clear');
  p.statuses.P.groupedCombat.currentAttackers=[t];assert.equal(defense.classifyTravelDefense(p,['W','P'],1000).state,'defending');
 }],
 ...['escape-recovery','franky-exit','event-return'].map(purpose=>['a '+purpose+' walk keeps its travel policy', ({p,t,defense,make})=>{
  p.activeConvoy.purpose=purpose;p.statuses.P.groupedCombat.currentAttackers=[t];
  assert.equal(defense.step(p,1000,make),false);assert.equal(p.activeConvoy.phase,'assemble');
 }]),
]);

// The client half of 256: the protocol 4 row above keeps the handle, so the release half went with it.
test('client interruption ignores stale convoy signals and an escape convoy walks on',()=>{
 const vm=require('node:vm');
 const context=convoy=>{const c=vm.createContext({root:{partyRoleRunner:{wake(){}}},navigationIntent:{revision:9},parent:{entities:{}},groupWalk:{travel:convoy},releaseConvoyCruise(){},stop(){c.stops++;},stops:0});
  require('./helpers/walk-reports.cjs').installWalkDefense(c);return c;};
 const convoy={id:'C',epoch:3,commandId:42,navigationRevision:9,purpose:'monster-hunt'},c=context(convoy);
 c.interruptConvoyForDefense('C',2);assert.equal(convoy.defensePaused,undefined);assert.equal(c.stops,0);
 c.interruptConvoyForDefense('C',3);assert.equal(convoy.phase,'defending');assert.equal(c.stops,1);
 const escape={id:'E',epoch:1,commandId:1,navigationRevision:9,purpose:'escape-recovery'},e=context(escape);
 e.interruptConvoyForDefense();assert.equal(escape.defensePaused,undefined);assert.equal(e.stops,0);
});

// 255 over the merchant job owner's recovery: a satisfied restock ends its job (owner.ts
// endMerchantJob), and the end clears only the job's own command, so W's newer walk command
// stays.
test('late merchant recovery cannot delete a replacement convoy command',()=>{
 const {createMerchantRecovery}=require('../../runtime/merchant-jobs/coordinator/recovery.ts'),{pauseMerchantJob,endMerchantJob}=require('../../runtime/merchant-jobs/coordinator/owner.ts');
 const state={current:{id:'old',target:'W',reason:'restock'},queue:[]},walk={id:2,type:'party-monster-travel',convoyId:'return'};
 const slot={merchantCharacter:'M',commands:{W:walk},combatLogs:{},get merchantCurrent(){return state.current;},set merchantCurrent(value){state.current=value;}};
 createMerchantRecovery(state,{now:()=>1,nextCommand:()=>7,end:(job,code)=>endMerchantJob(slot,job,{decision:'ended',code}),restockSatisfied:()=>true,
  stamp:job=>job,log(){},persist(){},dispatch(){},recoverSale(){},recovers:()=>true,offline:()=>false,pause:(job,by)=>pauseMerchantJob(slot,job,by)}).observe('W',[]);
 assert.equal(state.current,null,'the restock ended');assert.equal(slot.commands.W,walk);
});

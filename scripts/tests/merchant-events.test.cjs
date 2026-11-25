// The merchant's event attendance runs attend.ts over fixtures/event-attend-scenario.cjs, and its event
// attacks run the turns executor and targeting's module over the shared movement harness.
const { createMovementContext } = require('./fixtures/movement-owner-callers.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {attendScenario}=require('./fixtures/event-attend-scenario.cjs');
// The merchant's attendance (attend.ts `poll`): the merchant's own work yields first, then it joins a join
// row or walks to a walk row, with the equipment it has.
const merchant=event=>attendScenario({event,joins:event!=='snowman',map:'winterland',ctype:'merchant'});
const enters=async({attend,calls,character},event)=>{
 character.slots={mainhand:{name:'goldenpower'}};const weapon=character.slots.mainhand;
 await attend.poll();assert.equal(attend.joined(),event);assert.equal(character.slots.mainhand,weapon);
 assert.equal(calls[0],'yield');assert.equal(calls.some(call=>call[0]==='join'),event!=='snowman');
 assert.equal(calls.some(call=>call[0]==='walk'),event==='snowman');
};
scenarioTable('a merchant enters each event with its existing equipment',merchant,
 ['abtesting','goobrawl','crabxx','franky','icegolem','snowman'].map(event=>['merchant enters '+event+' with existing equipment',s=>enters(s,event),event]));

// v1.5.0's "nearby event target records attendance even without a travel leg", against
// the events owner's poll (attend.ts): a reachable event target beside the merchant attends the
// walk event with no walk.
test('a nearby event target records attendance with no travel leg', async () => {
 const {attend,calls}=attendScenario({event:'snowman',joins:false,map:'winterland',ctype:'merchant',target:{id:'boss'},reachable:true});
 await attend.poll();
 assert.equal(attend.joined(),'snowman');assert.equal(calls.some(call=>call[0]==='walk'),false);
});
// v1.5.0's "merchant event attacks reach the normal controller and rejected attacks
// remain retryable", against the turns owner's executor (turns/executor.ts 3.4): the merchant's
// event attack goes out through the one executor, and a refusal holds that target for the call
// margin only.
test("a merchant's refused event attack is sent again past the call margin", () => {
 const {turnsWorld}=require('./fixtures/turns-world.cjs');
 const actor={name:'M',ctype:'merchant',mp:1000,max_mp:1000,mp_cost:10,frequency:1,rip:false,items:[],level:80};
 const w=turnsWorld({actor,skills:{attack:{}},selected:()=>'boss',facts:{merchant:true,merchantEventFight:true},
  asks:()=>[{skill:'attack',targets:[{id:'boss'}],rank:'damage',category:'damage',reason:'event'}]});
 global.parent.next_skill={};
 try{
  w.turns.pass('tick');assert.equal(w.sent.length,1);
  w.reply({place:'attack',failed:true,response:'merchant',id:'boss'});
  assert.equal(w.turns.attackFlight(),null,'the refusal settles the flight');
  w.turns.pass('tick');assert.equal(w.sent.length,1,'held for the margin');
  // The margin is the largest ping (turns-world plants 50 ms).
  w.advance(51);w.turns.pass('tick');assert.equal(w.sent.length,2,'sent again');
 }finally{w.restore();}
});

scenarioTable('merchant event walks rank as attendance and release on time', () => merchant('goobrawl'), [
 ['merchant role and runner use event targets and block ordinary farming and passing attacks', async ()=>{
 // The merchant's target choice is targeting's merchant row: event monsters only, ahead of the rare row,
 // through the selection pass.
 const event={id:'event',type:'monster',visible:true},farm={id:'farm',type:'monster',visible:true};
 const m=createMovementContext({character:{ctype:'merchant',rip:false,map:'main'},nearestEventTarget:()=>event,rareTarget:()=>farm,isAllowedTarget:()=>true,
  getPriorityEventTarget:()=>null,returnCombatActive:()=>false,getDungeonTarget:()=>null,setCombatTarget(){},sharedTargetId:()=>null,
  get_entity:id=>id==='event'?event:null,partyCombatState:{}});
 // Targeting's module over the context, as shared.js builds it (helpers/targeting-module.cjs).
 require('./helpers/targeting-module.cjs').targetingModule(m);
 assert.equal(m.targeting.classTarget(),event);
 m.nearestEventTarget=()=>null;assert.equal(m.targeting.classTarget(),null);m.nearestEventTarget=()=>event;
 const pass=m.targeting.selectionPass({root:m,allows:()=>true,reset(){},retire:()=>null,covers:()=>false,equipment:()=>null,notify(){},follow:async()=>{},errorReason:String});
 await pass.selectTarget();assert.equal(pass.selected(),'event');
 const {hold}=require('../../runtime/characters/turns/rules.ts');
 const facts=over=>hold({active:true,rip:false,held:false,hand:null,abtesting:()=>'',revive:false,roleCombat:true,merchant:true,
   merchantEventFight:false,dungeonOwned:false,occupied:[],...over});
 assert.equal(facts({}).attack,false);assert.equal(facts({merchantEventFight:true}).attack,true);
 assert.equal(facts({merchantEventFight:true}).passing,false);
 assert.equal(facts({merchantEventFight:true,occupied:[{row:'O7',source:'10',read:()=>true}]}).attack,false);
 }],
 ['merchant respawns and rejoins its selected event', async ({attend,calls,t})=>{
 t.rejoin='goobrawl';assert.equal(attend.rejoinPending(),'goobrawl');
 assert.equal((await attend.rejoin('rejoin')).status,'recovered');
 assert.equal(attend.joined(),'goobrawl');assert.ok(calls.some(call=>call[0]==='join'));
 }],
]);

// The merchant's event hold (merchant-jobs/coordinator/event-hold.ts): v1.5.0's
// row cut with no removal line. A fresh report of a selected live event holds the
// merchant, and the tasks owner's live event task and the events owner's deferred return hold it after the selection goes.
test('merchant reservations survive restart, deselection and deferred return, then release', () => {
 const {merchantEventReserved}=require('../../runtime/merchant-jobs/coordinator/event-hold.ts');
 const {publishTasks}=require('../../runtime/tasks/api.ts'),{publishEventAnswers}=require('../../runtime/events/api.ts');
 let live=null,deferred=false;
 publishTasks({groupOf:name=>name==='M'?'merchant:M':null,live:()=>live});
 publishEventAnswers({deferredReturn:()=>deferred});
 const state={merchantCharacter:'M',statuses:{M:{seenAt:100,merchantEventReserved:true}},eventSelectionsByCharacter:{M:['snowman']}};
 assert.equal(merchantEventReserved(state,100),true,'a fresh report of a selected event');
 assert.equal(merchantEventReserved(state,20000),false,'a stale report holds nothing');
 state.eventSelectionsByCharacter.M=[];
 live={kind:'event-attendance'};assert.equal(merchantEventReserved(state,20000),true,'the attendance holds it after deselection');
 live={kind:'event-return'};assert.equal(merchantEventReserved(state,20000),true,'and the return');
 live=null;deferred=true;assert.equal(merchantEventReserved(state,20000),true,'a deferred return holds it until it runs');
 deferred=false;assert.equal(merchantEventReserved(state,20000),false,'then it releases');
});

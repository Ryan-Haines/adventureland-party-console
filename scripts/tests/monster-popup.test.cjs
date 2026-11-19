const test = require('node:test');
const assert = require('node:assert/strict');

test('manual monster navigation is an atomic auto-mode convoy override', () => {
  const {settingsWriter}=require('./helpers/settings-writer.cjs');
  const {createMonsterSelection}=require('../../runtime/hunting/coordinator/farm.ts');
  const party={statuses:{},leader:'L',followers:{F:true},monsterFocusByCharacter:{F:['bat']},scatterEpoch:1,commands:{L:{type:'party-monster-travel'}},combatMode:'scatter',targetMode:'hunt'};
  let cleared=0,authorized;
  const service=createMonsterSelection(party,{now:()=>1000,release(){},clearHunt:()=>cleared++,members:()=>['L','F'],authorize:(...args)=>authorized=args,
    start:()=>true,stopPhoenix(){},persist(){},write:settingsWriter(party).write});
  const location={map:'main',x:1,y:2};service.select('goo',location);
  // The pick switches the target to Farming and keeps the combat mode.
  assert.deepEqual([party.targetMode,party.combatMode],['farming','scatter']);assert.deepEqual(party.monsterFocus,['goo']);assert.equal(cleared,1);
  assert.equal(party.commands.L.manualMonsterOverride,true);assert.deepEqual(authorized,[['L','F'],location,true]);
});

// A pick by hand during an event return keeps the return, its
// deferred rows and the exit command it issued; the members leave their occurrences.
test('a farm pick by hand during an event return keeps the return and its exit command', () => {
  const {settingsWriter}=require('./helpers/settings-writer.cjs');
  const {createMonsterSelection}=require('../../runtime/hunting/coordinator/farm.ts');
  const exit={id:4,type:'event-return-town',cycleId:'r'},recovery={event:'franky',cycleId:'r',participants:['L','F'],pending:['F']};
  const party={statuses:{},leader:'L',followers:{F:true},monsterFocusByCharacter:{},scatterEpoch:1,commands:{F:exit},combatMode:'scatter',targetMode:'hunt',
    eventReturn:recovery,deferredEventReturns:{P:{event:'franky',cycleId:'r'}},eventSessions:{L:{event:'franky',participants:['L']}}};
  const service=createMonsterSelection(party,{now:()=>1000,release(){},clearHunt(){},members:()=>['L','F'],authorize(){},
    start:()=>true,stopPhoenix(){},persist(){},write:settingsWriter(party).write});
  service.select('crab',{map:'main',x:1,y:2});
  assert.equal(party.eventReturn,recovery);assert.deepEqual(Object.keys(party.deferredEventReturns),['P']);
  assert.equal(party.commands.F,exit);assert.deepEqual(party.eventSessions,{});
});

const test = require('node:test'), assert = require('node:assert/strict');
const {travelCombatFor} = require('../../runtime/movement/coordinator/defense.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture}=require('./fixtures/travel-defense-scenario.cjs');

scenarioTable('travel holds pulls only until its navigation is cancelled, forced or ended (MOV-132)', fixture, [
 ['travel ownership suppresses pulls only until cancellation, supersession, arrival or emergency override', ({p,names})=>{
 p.navigationIntents.GDroidPT={revision:5};
  assert.equal(travelCombatFor(p,names[0]).revision,5);
  p.navigationIntents.GDroidPT.cancelled=true;assert.equal(travelCombatFor(p,names[0]),null);
  p.navigationIntents.GDroidPT.cancelled=false;p.activeConvoy.force=true;assert.equal(travelCombatFor(p,names[0]),null);
  p.activeConvoy=null;assert.equal(travelCombatFor(p,names[0]),null);
 }],
 // The walk released at the leader's engagement leaves each other member a combat handoff command.
 ['a combat handoff command holds no fight for the member it hands over', ({p,names})=>{
  p.activeConvoy=null;p.navigationIntents.GermanicHP={revision:3};
  p.commands.GermanicHP={id:7,type:'event-resume-travel',convoyHandoff:'trip',location:{map:'main',x:-100,y:-50},navigationRevision:3,label:'the selected farming waypoint'};
  assert.equal(travelCombatFor(p,names[1]),null);
  // A return's own resume command still holds the member's fight.
  delete p.commands.GermanicHP.convoyHandoff;
  assert.equal(travelCombatFor(p,names[1]).id,'command:7');
 }],
]);

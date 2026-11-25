const test=require('node:test'),assert=require('node:assert/strict');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture}=require('./fixtures/event-return-turnover-hold-scenario.cjs');

// The event return holds the member while its group task is the return, read
// from the heartbeat assignment, not from a cycle id the coordinator names beside it.
scenarioTable('an event exit keeps movement ownership exactly while the group task is the return (MOV-053)', fixture, [
 ['the return holds the member while the assignment names it, and the return combat read follows the cycle', c=>{
 c.receiveTask({task:{kind:'event-return'}});assert.equal(c.eventReturnHolds(),true);assert.equal(c.returnCombatActive(),true);
 c.receiveTask({});assert.equal(c.eventReturnHolds(),false);
 c.cycle=null;assert.equal(c.returnCombatActive(),false);
 c.cycle='';assert.equal(c.returnCombatActive(),false);
 }],
 ['a retained exit defends only against live monsters on this map and instance that attack the party', c=>{
 const idle={id:'idle',type:'monster',visible:true,hp:100,map:'main',in:'main',target:null};
 c.parent.entities={idle};assert.equal(c.returnCombatActive(),true);assert.equal(c.returnDefenseTarget(),null);
 const attacker={...idle,id:'attacker',target:'P'};c.parent.entities.attacker=attacker;assert.equal(c.returnDefenseTarget().id,'attacker');
 for(const mutation of [{dead:true},{hp:0},{map:'other'},{in:'other-instance'},{target:'stranger'}]){
  c.parent.entities.attacker={...attacker,...mutation};assert.equal(c.returnDefenseTarget(),null);
 }
 }],
 ['a retained exit gives way to death, cancelled navigation, Escape and combat recovery', c=>{
 assert.equal(c.returnCombatActive(),true);
 c.character.rip=true;assert.equal(c.returnCombatActive(),false,'death');c.character.rip=false;
 c.navigationIntent.cancelled=true;assert.equal(c.returnCombatActive(),false,'cancelled navigation');c.navigationIntent.cancelled=false;
 c.escapeOwns=()=>true;assert.equal(c.returnCombatActive(),false,'Escape');c.escapeOwns=()=>false;
 c.assignment.combatRecoveryHolds=()=>true;assert.equal(c.returnCombatActive(),false,'emergency combat recovery');
 }],
]);

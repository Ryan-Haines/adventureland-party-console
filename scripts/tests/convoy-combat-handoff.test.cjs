const test = require('node:test');
const assert = require('node:assert/strict');
const { engageWalk } = require('../../runtime/movement/coordinator/walk.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {client,coordinator,farmingWalk}=require('./fixtures/convoy-combat-handoff-scenario.cjs');
const { engageFarming } = require('../../runtime/hunting/coordinator/api.ts');

// Step 11 item 6: the legacy barrier checks sameWalk, so an engagement from another epoch,
// command, runtime or navigation revision releases nothing.
const stale = change => r => {
  change(r);
  assert.equal(engageWalk(r.party, r.body, r.options), false); assert.ok(r.party.activeConvoy);
  assert.equal(r.party.commands.B.id, 4);
};
scenarioTable('a stale identity, revision, wrong map, outside radius or preparation never releases routes', coordinator, [
  ['a stale epoch', stale(r => r.body.epoch++)],
  ['a stale command', stale(r => r.body.commandId++)],
  ['a stale runtime', stale(r => r.body.runtimeId = 'old')],
  ['a stale navigation revision', stale(r => r.body.navigationRevision++)],
  ['the wrong map', stale(r => r.body.target.map = 'main')],
  ['a target outside the radius', stale(r => r.body.target.x = 101)],
  ['a target with no position', stale(r => r.body.target.x = NaN)],
  ['a type the farm does not hunt', stale(r => r.body.target.mtype = 'crab')],
  ['a walk still preparing', stale(r => r.party.activeConvoy.phase = 'shared-prepare')],
  ['a walk that allows no combat handoff', stale(r => r.party.activeConvoy.combatHandoffAllowed = false)],
]);

scenarioTable('a travelling character picks its handoff target by distance from the destination waypoint (MOV-048)', client, [
 ['travel acquisition uses monster distance from destination waypoint, never character distance', c=>{
 const  command = { location: { map: 'winterland', x: 0, y: 0 } };
  const target = { id: 'm', type: 'monster', mtype: 'goo', visible: true, x: 500, y: 0 };
  c.parent.entities.m = target;
  assert.equal(c.farmingTravelTarget(command), null, 'near character but outside waypoint hunt radius');
  target.x = 100; assert.equal(c.farmingTravelTarget(command), target, 'inside inclusive boundary before arriving');
  command.combatHandoffAllowed = false;
  assert.equal(c.farmingTravelTarget(command), null, 'NPC service convoys retain movement ownership');
  delete command.combatHandoffAllowed;
  target.x = 101; assert.equal(c.farmingTravelTarget(command), null);
  target.x = 20; c.character.map = 'main'; assert.equal(c.farmingTravelTarget(command), null);
  c.character.map = 'winterland'; target.claimed = true; assert.equal(c.farmingTravelTarget(command), null);
  target.claimed = false; target.mtype = 'crab'; assert.equal(c.farmingTravelTarget(command), null);
  target.mtype = 'goo'; target.visible = false; assert.equal(c.farmingTravelTarget(command), null);
 }],
 ['authorized ordinary farming retains travel outside its destination farm', c=>{
 c.travelCombatActive=()=>true;
 const target={id:'early',type:'monster',mtype:'goo',visible:true,map:'winterland',x:520,y:0};c.parent.entities.early=target;
 const command={location:{map:'cave',x:900,y:0},purpose:null,combatHandoffAllowed:true};
 assert.equal(c.farmingTravelTarget(command),null);
 command.location={map:'winterland',x:520,y:0};
 assert.equal(c.farmingTravelTarget(command),target);
 target.x=601;assert.equal(c.farmingTravelTarget(command),null);
 target.x=520;command.combatHandoffAllowed=false;assert.equal(c.farmingTravelTarget(command),null);
 }],
]);

// HN17: the leader's goo at the area's edge
// ends the walk only with every member inside the area plus its own attack range (rules.ts
// `standsAt`). With the priest 200 beyond its range the walk keeps travelling and never
// switches to `defending`.
scenarioTable('HN17: the farming walk ends early only with every member inside its attack range', farmingWalk, [
 ['a member 200 beyond its range: the walk goes on', r => {
  assert.equal(engageFarming(r.party, r.body, r.options, { validReport: () => true }, r.now), false);
  assert.equal(r.party.activeConvoy.phase, 'travel'); assert.equal(r.party.activeConvoy.farmingEngagement, undefined);
 }, 350],
 ['every member inside its range: the walk ends for the fight', r => {
  assert.equal(engageFarming(r.party, r.body, r.options, { validReport: () => true }, r.now), true);
  assert.ok(!r.party.activeConvoy, 'the walk ended');
 }, 100],
]);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const navigation = require('../convoy-navigation.cjs');
const source = fs.readFileSync('characters/shared.js', 'utf8');

function client() {
  const c = vm.createContext({travelCombatActive:()=>false, root: { partyFarmingZones: require('../../.build/shared/farming-zones.cjs') }, character: { name: 'Us', map: 'winterland', x: 500, y: 0 },
    monsterFocus: ['goo'], monsterSearchRadius: 100, farmingMode: 'default', partyTargets: [], combatTargetId: null,
    monsterPriority: () => 50, isAllowedTarget: t => !t.claimed, parent: { entities: {} } });
  vm.runInContext(source.slice(source.indexOf('  function farmingTravelTarget('), source.indexOf('  function navigationDestinationLabel(')), c);
  vm.runInContext(source.slice(source.indexOf('  function inFarmArea('), source.indexOf('  var farmAreaEvidence')), c);
  return c;
}
test('travel acquisition uses monster distance from destination waypoint, never character distance', () => {
  const c = client(), command = { location: { map: 'winterland', x: 0, y: 0 } };
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
});

function coordinator() {
  const party = { nextCommandId: 10, activeConvoy: { id: 'c', epoch: 2, phase: 'travel', departAt: 1000,
    participants: ['A', 'B'], completed: [], location: { map: 'winterland', x: 0, y: 0 }, runtimes: { A: 'r' } },
    commands: { A: { id: 3, convoyId: 'c', epoch: 2 }, B: { id: 4, convoyId: 'c', epoch: 2 } } };
  const body = { character: 'A', convoyId: 'c', epoch: 2, commandId: 3, runtimeId: 'r', navigationRevision: 7,
    target: { id: 'm', map: 'winterland', mtype: 'goo', x: 100, y: 0 } };
  const options = { revisions: { A: 7, B: 8 }, focus: ['goo'], radius: 100, now: 2000 };
  return { party, body, options };
}

test('authorized ordinary farming acquires configured monsters near the party before its destination map',()=>{
 const c=client();c.travelCombatActive=()=>true;
 const target={id:'early',type:'monster',mtype:'goo',visible:true,map:'winterland',x:520,y:0};c.parent.entities.early=target;
 const command={location:{map:'cave',x:900,y:0},purpose:null,combatHandoffAllowed:true};
 assert.equal(c.farmingTravelTarget(command),target);
 target.x=601;assert.equal(c.farmingTravelTarget(command),null);
 target.x=520;command.combatHandoffAllowed=false;assert.equal(c.farmingTravelTarget(command),null);
});

test('monster picker travel acquires visible wild boar before reaching its spawn',()=>{
 const c=client();c.travelCombatActive=()=>true;c.monsterFocus=['boar'];
 const target={id:'boar',type:'monster',mtype:'boar',visible:true,map:'winterland',x:520,y:0};c.parent.entities.boar=target;
 const command={location:{map:'winterland',x:1500,y:0},purpose:'manual-monster-override',combatHandoffAllowed:true};
 assert.equal(c.farmingTravelTarget(command),target);
 target.claimed=true;assert.equal(c.farmingTravelTarget(command),null);
 target.claimed=false;target.x=601;assert.equal(c.farmingTravelTarget(command),null);
});
test('accepted engagement releases convoy and sends revision-bound individual recovery to late members', () => {
  const { party, body, options } = coordinator();
  assert.equal(navigation.engage(party, body, options), true);
  assert.equal(party.activeConvoy, null); assert.equal(party.commands.A, undefined);
  assert.equal(party.commands.B.type, 'event-resume-travel'); assert.equal(party.commands.B.navigationRevision, 8);
  assert.equal(party.commands.B.convoyHandoff, 'c'); assert.equal(party.commands.B.location.map, 'winterland');
  assert.equal(party.lastConvoyEngagement.target.id, 'm');
  assert.equal(navigation.engage(party, body, options), false, 'duplicate cannot cancel newer movement');
});

test('event return reconciliation preserves the combat handoff instead of recreating travel', () => {
  const { party, body, options } = coordinator();
  const owner = { returnDispatchedAt: 1, returnRoutes: {
    A: { convoyId: 'c', revision: 7, location: party.activeConvoy.location },
    B: { convoyId: 'c', revision: 8, location: party.activeConvoy.location },
  } };
  Object.assign(party, { anniversary: { eventCycle: owner }, eventSessions: {}, deferredEventReturns: {},
    navigationIntents: { A: { revision: 7 }, B: { revision: 8 } }, characterLocations: {}, statuses: {},
    followers: { B: true }, leader: 'A' });
  assert.equal(navigation.engage(party, body, options), true);
  assert.equal(owner.returnRoutes.A.engagedAt, 2000);
  assert.equal(owner.returnRoutes.B.commandId, party.commands.B.id);
  const nav = require('../farming-navigation.cjs')(party, { now: () => 5000, persist() {},
    names: () => ['A', 'B'], activeNames: () => ['A', 'B'] });
  const commandId = party.commands.B.id;
  assert.equal(nav.reconcile(owner, 'anniversary-return'), false);
  assert.equal(party.commands.A, undefined); assert.equal(party.commands.B.id, commandId);
  owner.returnRoutes.B.engagedAt = 4000;
  assert.equal(nav.reconcile(owner, 'anniversary-return'), true);
});
test('stale identity, revision, wrong map, outside radius and preparation never release routes', () => {
  for (const change of [r => r.body.epoch++, r => r.body.commandId++, r => r.body.runtimeId = 'old',
    r => r.body.navigationRevision++, r => r.body.target.map = 'main', r => r.body.target.x = 101,
    r => r.body.target.x = NaN, r => r.body.target.mtype = 'crab',
    r => r.party.activeConvoy.phase = 'prepare', r => r.options.now = 999,
    r => r.party.activeConvoy.combatHandoffAllowed = false]) {
    const r = coordinator(); change(r);
    assert.equal(navigation.engage(r.party, r.body, r.options), false); assert.ok(r.party.activeConvoy);
    assert.equal(r.party.commands.B.id, 4);
  }
});

const test = require('node:test'), assert = require('node:assert/strict');
const { createHunt } = require('../../runtime/hunting/coordinator/hunt.ts');
const { priority } = require('../../runtime/tasks/api.ts');
// The status line, which labelHunt keeps beside the Hunt record.
const { huntMessage } = require('../../runtime/hunting/coordinator/record.ts');

function fixture() {
  const daisy = {map: 'main', x: 0, y: 0}, farm = {map: 'cave', x: 250, y: 400};
  const state = {nextCommandId: 40, targetMode: 'hunt', monsterHunt: null, activeConvoy: null,
    leader: 'W', followers: {P: true}, statuses: {}, commands: {}, monsterHunterLocation: daisy,
    eventReturn: null, monsterFocus: ['bat'], monsterSearchRadiusByCharacter: {},
    // The Hunt's spawns are the catalog's (hunt.ts `coordinatorHuntDestination`).
    monsterChoices: ['rat', 'bee', 'bat'].map(id => ({id, locations: [farm]}))};
  for (const name of ['W', 'P']) state.statuses[name] = {seenAt: 100000, server: 'II', hp: 100,
    map: 'main', x: 0, y: 0, convoyProtocol: 4, monsterHunt: {id: 'rat', count: 10, remainingMs: 900000}};
  require('./helpers/travel-observations.cjs').observeTravel(state.statuses);
  const calls = [], conditions = {fighting: false, rare: false};
  const service = createHunt(state, {
    now: () => 100000, participants: () => ['W', 'P'], online: () => true,
    cancelConvoy: () => { calls.push('cancel'); state.activeConvoy = null; },
    persist: () => calls.push('persist'), selectedDestination: () => ({location: farm}),
    start: (...args) => {
      calls.push(['start', ...args]);
      // Movement's walk start records the walk's purpose and members, which the Hunt's cancel reads.
      state.activeConvoy = {id: 'travel', phase: 'assemble', purpose: args[3], participants: args[2]};
      for (const name of args[2]) state.commands[name] = {id: state.nextCommandId++, type: 'convoy', convoyId: 'travel'};
      return true;
    },
    navigation: {authorize: (...args) => calls.push(['authorize', ...args]), intent: () => ({})},
    ownsTravel: priority,
  });
  return {state, service, calls, daisy, farm};
}

test('new Hunt excludes saved offline followers and characters outside the current party', () => {
  const {state, service} = fixture();
  Object.assign(state.followers, {Offline: true, Stale: true, OtherRealm: true, Merchant: true});
  state.statuses.Stale = {...state.statuses.P, seenAt: 80000};
  state.statuses.OtherRealm = {...state.statuses.P, server: 'III'};
  state.statuses.Merchant = {...state.statuses.P, ctype: 'merchant'};
  state.statuses.Independent = {...state.statuses.P};
  service.begin();
  assert.deepEqual(state.monsterHunt.participants, ['W', 'P']);
  assert.equal(state.monsterHunt.stage, 'mission-travel');
});

for (const stage of ['checking-quests', 'mission-travel', 'returning', 'backup-farming']) {
  test(`persisted ${stage} Hunt releases an offline quest owner and resumes current party quests`, () => {
    const {state, service} = fixture();
    service.begin();
    const hunt = state.monsterHunt;
    state.followers.Offline = true;
    hunt.participants.push('Offline');
    hunt.owner = 'Offline';
    hunt.missions = [{target: 'bee', owners: ['Offline']}];
    hunt.target = 'bee';
    hunt.stage = stage;
    if (stage === 'returning') hunt.turnIn = {owner: 'Offline', phase: 'returning'};
    if (stage === 'backup-farming') hunt.backup = {startedAt: 90000, members: {}};
    state.commands.Offline = {type: 'monster-hunt-interact', purpose: 'monster-hunt', cycleId: hunt.cycleId};
    // A persisted cycle comes back with no walk: a live Hunt walk with a silent follower is a reload
    // gap, which keeps the roster (hunt.ts `communicationOwnsRoster`).
    state.activeConvoy = null; hunt.convoyId = null;
    service.tick();
    assert.deepEqual(hunt.participants, ['W', 'P']);
    assert.equal(hunt.owner, 'W');
    assert.equal(hunt.turnIn, undefined);
    assert.equal(state.commands.Offline, undefined);
    assert.equal(hunt.target, 'rat');
    assert.equal(hunt.stage, 'mission-travel');
  });
}

test('checking quests keeps fresh dead members and waits when the leader is stale', () => {
  const {state, service} = fixture();
  state.statuses.P.rip = true;
  service.begin();
  assert.deepEqual(state.monsterHunt.participants, ['W', 'P']);
  assert.match(huntMessage(state.monsterHunt), /Waiting for fresh Hunt status from P/);
  state.statuses.W.seenAt = 1;
  state.monsterHunt.participants.push('Offline');
  service.tick();
  assert.deepEqual(state.monsterHunt.participants, ['W', 'P', 'Offline']);
});

test('backup repairs a persisted area that does not contain the selected monster and departs', () => {
  const {state, service, calls, farm} = fixture();
  service.begin('auto', {map:'main',x:0,y:0,monsterIds:['goo']});
  const hunt = state.monsterHunt;
  state.activeConvoy = null;
  state.huntBlacklist = {rat:{}};
  hunt.backup = {startedAt:100000,members:{}};
  hunt.stage = 'backup-farming';
  hunt.target = null;
  calls.length = 0;
  service.tick();
  assert.equal(hunt.returnLocation, farm);
  assert.equal(hunt.stage, 'backup-travel');
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'start' && call[1] === farm));
});

test('backup preserves an explicitly selected compatible area', () => {
  const {state, service, calls} = fixture();
  const chosen = {map:'other-cave',x:900,y:900,monsterIds:['bat']};
  service.begin('auto', chosen);
  const hunt = state.monsterHunt;
  Object.assign(hunt, {backup: {startedAt: 100000, members: {}}, stage: 'backup-farming', target: null});
  state.activeConvoy = null; state.huntBlacklist = {rat: {}}; calls.length = 0;
  service.tick();
  assert.equal(hunt.returnLocation, chosen);
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'start' && call[1] === chosen));
});

test('Hunt restart preserves unfinished loot before preparing travel',()=>{
 const {state,service,calls}=fixture();service.begin();
 const loot={id:'final-kill',after:99999,map:'main',in:'main',realm:':II',x:0,y:0,complete:false};
 state.monsterHunt.loot=loot;state.monsterHunt.stage='returning';state.activeConvoy=null;calls.length=0;
 service.begin('auto',null);
 assert.equal(state.monsterHunt.loot,loot);assert.equal(state.activeConvoy,null);
 assert.equal(calls.some(Array.isArray),false);
 service.tick();assert.equal(state.monsterHunt.loot,loot);assert.match(huntMessage(state.monsterHunt),/Pending Hunt loot/);
 state.statuses.W.huntLoot={...loot,observedAt:100000,complete:true};service.tick();
 // The Hunt clears a completed loot record as it releases the barrier, so the walk starting is what separates a
 // completed record from a dropped one: the pending ticks above held it.
 assert.equal(state.monsterHunt.loot,undefined);assert.doesNotMatch(huntMessage(state.monsterHunt),/Pending Hunt loot/);assert.ok(calls.some(Array.isArray));
});

test('Hunt composition starts its route despite nearby attackers and retains the mission', () => {
  const {state, service} = fixture();
  state.statuses.P.groupedCombat.currentAttackers=[{id:'bee',mtype:'bee',map:'main',target:'P',x:0,y:0}]; service.begin();
  const hunt = state.monsterHunt, mission = hunt.missions[0];
  assert.equal(hunt.stage, 'mission-travel'); assert.ok(state.activeConvoy);
  assert.equal(state.activeConvoy.combatHandoffAllowed, false);
  state.statuses.P.groupedCombat.currentAttackers=[]; service.tick();
  assert.equal(state.monsterHunt, hunt); assert.equal(hunt.missions[0], mission);
  assert.equal(hunt.stage, 'mission-travel'); assert.equal(hunt.convoyId, 'travel');
});

// The rare writes nothing of the Hunt record since ed75cbc1c, so the Hunt's own label is the
// status line once its mission travel resumes.
test('resumed mission travel labels the mission on the status line',()=>{
 const r=fixture();r.service.begin();
 const h=r.state.monsterHunt;
 Object.assign(h,{stage:'mission-travel',target:'rat',convoyId:'travel',owner:'W',policyVersion:3});
 r.state.activeConvoy={id:'travel',phase:'travel',purpose:'monster-hunt',huntTarget:'rat'};
 r.service.tick();
 assert.equal(huntMessage(h),'Travelling to rat');
});

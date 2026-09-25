const test = require('node:test'), assert = require('node:assert/strict');
const { createCoordinatorHunt } = require('../../runtime/coordinator/hunt/composition.ts');
const { priority } = require('../../runtime/hunt/policy.ts');

function fixture() {
  const daisy = {map: 'main', x: 0, y: 0}, farm = {map: 'cave', x: 250, y: 400};
  const state = {nextCommandId: 40, farmingPolicy: 'hunt', monsterHunt: null, activeConvoy: null,
    leader: 'W', followers: {P: true}, statuses: {}, commands: {}, monsterHunterLocation: daisy,
    eventReturn: null, monsterFocus: ['bat'], monsterSearchRadiusByCharacter: {}};
  for (const name of ['W', 'P']) state.statuses[name] = {seenAt: 100000, server: 'II', hp: 100,
    map: 'main', x: 0, y: 0, convoyProtocol: 4, monsterHunt: {id: 'rat', count: 10, remainingMs: 900000}};
  require('./helpers/travel-observations.cjs').observeTravel(state.statuses);
  const calls = [], conditions = {fighting: false, rare: false};
  const service = createCoordinatorHunt(state, {
    now: () => 100000, participants: () => ['W', 'P'], fighting: () => conditions.fighting,
    rareEncounter: () => conditions.rare, cancelHuntConvoy: () => { calls.push('cancel-hunt'); state.activeConvoy = null; },
    cancelConvoy: () => { calls.push('cancel'); state.activeConvoy = null; },
    clear: () => { calls.push('clear'); state.monsterHunt = null; }, persist: () => calls.push('persist'),
    selectedDestination: () => ({location: farm}), monsterDestination: () => farm, missionDestination: () => farm,
    start: (...args) => {
      calls.push(['start', ...args]);
      state.activeConvoy = {id: 'travel', phase: 'assemble', legIndex: 0};
      for (const name of args[2]) state.commands[name] = {id: state.nextCommandId++, type: 'convoy', convoyId: 'travel'};
      return true;
    },
    navigation: {authorize: (...args) => calls.push(['authorize', ...args]), intent: () => ({})},
    ownsTravel: priority, recordDeaths: () => [], contains: () => true,
    arrivalProtected: () => false, partyFighting: () => false,
  });
  return {state, service, calls, conditions, daisy, farm};
}

test('resuming Hunt retains the newly selected backup area and focus', () => {
  const {state, service, farm} = fixture();
  service.lifecycle.begin('auto', {map:'main',x:0,y:0,monsterIds:['goo']});
  const hunt = state.monsterHunt;
  service.lifecycle.begin('auto', farm, true);
  assert.equal(state.monsterHunt, hunt);
  assert.equal(hunt.returnLocation, farm);
  assert.equal(hunt.returnFocus, JSON.stringify(['bat']));
});

test('new Hunt excludes saved offline followers and characters outside the current party', () => {
  const {state, service} = fixture();
  Object.assign(state.followers, {Offline: true, Stale: true, OtherRealm: true, Merchant: true});
  state.statuses.Stale = {...state.statuses.P, seenAt: 80000};
  state.statuses.OtherRealm = {...state.statuses.P, server: 'III'};
  state.statuses.Merchant = {...state.statuses.P, ctype: 'merchant'};
  state.statuses.Independent = {...state.statuses.P};
  service.lifecycle.begin();
  assert.deepEqual(state.monsterHunt.participants, ['W', 'P']);
  assert.equal(state.monsterHunt.stage, 'mission-travel');
});

for (const stage of ['checking-quests', 'mission-travel', 'returning', 'backup-farming']) {
  test(`persisted ${stage} Hunt releases an offline quest owner and resumes current party quests`, () => {
    const {state, service} = fixture();
    service.lifecycle.begin();
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
    service.tick.tick();
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
  service.lifecycle.begin();
  assert.deepEqual(state.monsterHunt.participants, ['W', 'P']);
  assert.match(state.monsterHunt.message, /Waiting for fresh Hunt status from P/);
  state.statuses.W.seenAt = 1;
  state.monsterHunt.participants.push('Offline');
  service.quests.prepare(state.monsterHunt);
  assert.deepEqual(state.monsterHunt.participants, ['W', 'P', 'Offline']);
});

test('backup repairs a persisted area that does not contain the selected monster and departs', () => {
  const {state, service, calls, farm} = fixture();
  service.lifecycle.begin('auto', {map:'main',x:0,y:0,monsterIds:['goo']});
  const hunt = state.monsterHunt;
  state.activeConvoy = null;
  state.huntBlacklist = {rat:{}};
  hunt.backup = {startedAt:100000,members:{}};
  hunt.stage = 'backup-farming';
  hunt.target = null;
  calls.length = 0;
  service.tick.tick();
  assert.equal(hunt.returnLocation, farm);
  assert.equal(hunt.stage, 'backup-travel');
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'start' && call[1] === farm));
});

test('backup preserves an explicitly selected compatible area', () => {
  const {service} = fixture();
  const chosen = {map:'other-cave',x:900,y:900,monsterIds:['bat']};
  const hunt = {returnFocus:JSON.stringify(['bat']),returnLocation:chosen};
  assert.equal(service.lifecycle.backupDestination(hunt), chosen);
});

for(const resume of [true,false])test('Hunt restart preserves unfinished loot before preparing travel; resume='+resume,()=>{
 const {state,service,calls}=fixture();service.lifecycle.begin();
 const loot={id:'final-kill',after:99999,map:'main',in:'main',realm:':II',x:0,y:0,complete:false};
 state.monsterHunt.loot=loot;state.monsterHunt.stage='returning';state.activeConvoy=null;calls.length=0;
 service.lifecycle.begin('auto',null,resume);
 assert.equal(state.monsterHunt.loot,loot);assert.equal(state.activeConvoy,null);
 assert.equal(calls.some(Array.isArray),false);
 service.tick.tick();assert.equal(state.monsterHunt.loot,loot);assert.match(state.monsterHunt.message,/Pending Hunt loot/);
 state.statuses.W.huntLoot={...loot,observedAt:100000,complete:true};service.tick.tick();
 assert.equal(state.monsterHunt.loot?.complete ?? true,true);assert.ok(calls.some(Array.isArray));
});

test('Hunt composition begins through quest selection and configures the departing convoy commands', () => {
  const {state, service, calls, farm} = fixture();
  assert.equal(service.lifecycle.begin('auto', farm), true);
  assert.equal(state.monsterHunt.cycleId, 'hunt-100000-40');
  assert.equal(state.monsterHunt.target, 'rat');
  assert.equal(state.monsterHunt.stage, 'mission-travel');
  assert.equal(state.monsterHunt.convoyId, 'travel');
  assert.equal(state.activeConvoy.townFirst, false);
  assert.equal(state.activeConvoy.combatHandoffAllowed, false);
  assert.equal(state.activeConvoy.huntTarget, 'rat');
  assert.equal(state.commands.W.id, 41); assert.equal(state.commands.P.id, 42);
  assert.equal(state.commands.P.combatHandoffAllowed, false);
  assert.equal(state.commands.P.huntTarget, 'rat');
  assert.deepEqual(calls.filter(Array.isArray), [
    ['authorize', ['W', 'P'], farm, true], ['start', farm, 'Monster Hunt: rat', ['W', 'P'], 'monster-hunt',undefined],
  ]);
});
test('idle Hunt composition accepts startup without a selected leader', () => {
  const {state, service, calls} = fixture();
  state.leader = null; state.farmingPolicy = 'auto'; state.followers = {}; state.statuses = {};
  service.tick.tick();
  assert.equal(state.monsterHunt, null); assert.equal(state.leader, null); assert.deepEqual(calls, []);
});

test('Hunt composition starts its route despite nearby attackers and retains the mission', () => {
  const {state, service, calls, conditions} = fixture();
  state.statuses.P.groupedCombat.currentAttackers=[{id:'bee',mtype:'bee',map:'main',target:'P',x:0,y:0}]; service.lifecycle.begin();
  const hunt = state.monsterHunt, mission = hunt.missions[0];
  assert.equal(hunt.stage, 'mission-travel'); assert.ok(state.activeConvoy);
  assert.equal(state.activeConvoy.combatHandoffAllowed, false);
  state.statuses.P.groupedCombat.currentAttackers=[]; service.quests.prepare(hunt);
  assert.equal(state.monsterHunt, hunt); assert.equal(hunt.missions[0], mission);
  assert.equal(hunt.stage, 'mission-travel'); assert.equal(hunt.convoyId, 'travel');
});

test('Hunt composition claims at Daisy without travel and uses the current command map and counter', () => {
  const {state, service, calls} = fixture();
  state.statuses = Object.fromEntries(Object.entries(state.statuses).map(([name, status]) =>
    [name, {...status, monsterHunt: {...status.monsterHunt, count: 0}}]));
  state.commands = {}; state.nextCommandId = 90;
  service.tick.tick();
  assert.equal(state.monsterHunt.cycleId, 'hunt-100000-90');
  assert.equal(state.monsterHunt.stage, 'at-daisy'); assert.equal(state.activeConvoy, null);
  assert.equal(state.commands.W.action, 'claim'); assert.equal(state.commands.W.id, 91);
  assert.equal(state.commands.P.action, 'claim'); assert.equal(state.commands.P.id, 92);
  assert.equal(state.commands.P.cycleId, state.monsterHunt.cycleId);
  assert.equal(calls.some(Array.isArray), false);
});

test('resumed mission travel clears the previous rare interruption message',()=>{
 const r=fixture();r.service.lifecycle.begin();
 const h=r.state.monsterHunt;
 Object.assign(h,{stage:'mission-travel',target:'rat',convoyId:'travel',message:'Travel encounter: pursuing Fairy 225',owner:'W',policyVersion:3});
 r.state.activeConvoy={id:'travel',phase:'travel',purpose:'monster-hunt',huntTarget:'rat'};
 r.service.tick.tick();
 assert.equal(h.message,'Monster Hunt: rat');
});

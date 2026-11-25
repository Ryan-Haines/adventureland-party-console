const test = require('node:test'), assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
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

scenarioTable('a persisted Hunt at each stage releases an offline quest owner to the current party', fixture,
  ['checking-quests', 'mission-travel', 'returning', 'backup-farming'].map(stage => [`persisted ${stage} Hunt releases an offline quest owner and resumes current party quests`, ({state, service}) => {
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
  }]));

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

// Live 2026-11-22: the Hunt's return waited two hours on level2e beside a level 8 pinkgoblin that
// heals 96000 every 4 s (G.monsters.pinkgoblin.abilities.self_healing) while it kept W in its
// fight. Survival's walk verdict runs here over the game data, as core:survival answers it.
test('a Hunt return walks on from a fight the party cannot win and waits for one it can', () => {
  require('./fixtures/coordinator-core.cjs');
  const {partyHooks} = require('../../runtime/hooks/index.ts');
  const {createVerdicts} = require('../../runtime/coordinator/survival/verdict.ts');
  const goblin = {attack: 2400, frequency: 0.4, damage_type: 'magical'};
  const monsters = {pinkgoblin: {...goblin, abilities: {self_healing: {heal: 96000, cooldown: 4000}}}, goblin};
  for (const heals of [true, false]) {
    const {state, service, calls, farm} = fixture();
    const verdicts = createVerdicts({now: () => 100000, monsters: () => monsters});
    partyHooks().publish({name: 'core:test-verdict', folder: 'core', author: 'test', summary: "05's walk verdict over the game data.",
      hooks: {'survival.verdict': q => verdicts.walk(q.members.map(name => ({name, ...state.statuses[name]})), q.attackers)}});
    service.begin();
    const hunt = state.monsterHunt;
    Object.assign(hunt, {stage: 'returning', turnIn: {owner: 'W', phase: 'returning'}, convoyId: null});
    state.activeConvoy = null; state.commands = {}; calls.length = 0;
    Object.assign(state.statuses.W, {map: farm.map, x: farm.x, y: farm.y, ctype: 'warrior', hp: 10699, attack: 1289, frequency: 0.821, resistance: 313});
    Object.assign(state.statuses.P, {map: farm.map, x: farm.x, y: farm.y, ctype: 'priest', hp: 7708, attack: 1056, frequency: 1.225});
    state.statuses.W.groupedCombat.currentAttackers = [{id: '428', mtype: heals ? 'pinkgoblin' : 'goblin', hp: 1890000, map: farm.map, target: 'W', x: farm.x, y: farm.y}];
    service.tick();
    const started = calls.some(call => Array.isArray(call) && call[0] === 'start' && call[2] === 'Monster Hunt turn-in');
    assert.equal(started, heals, heals ? 'the self-healing goblin never dies, so the return walks on' : 'the fight the priest wins holds the return');
    if (!heals) assert.match(huntMessage(hunt), /Defending W from goblin 428/);
  }
});

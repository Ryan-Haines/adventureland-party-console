const test = require('node:test');
const assert = require('node:assert/strict');
// The realm registry holds only the core registrations, so an installed add-on that answers a
// one-answer hook this file's own add-on answers leaves its rows as they are (helpers/core-hooks.cjs).
require('./helpers/core-hooks.cjs');
const { createCave: createDungeons } = require('../../runtime/hunting/coordinator/cave.ts');
const { installDungeonRuntime, createDungeonJournal } = require('../../runtime/hunting/character/cave.ts');
const { createDeathRecovery } = require('../../runtime/characters/survival/recovery-member.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture,eligibilityRuntime,cave}=require('./fixtures/daily-dungeons-scenario.cjs');

for (const native of [false, true]) test('cave choice text remains readable with ' + (native ? 'native translations' : 'headless translation fallback'), () => {
  const raw = cave();
  raw.choice.title = 'The Shop with One Item'; raw.choice.title_message = {phrase: 'shop.title'};
  raw.choice.text = 'Have a look.'; raw.choice.text_message = {phrase: 'shop.text'};
  raw.choice.options = [
    {id: 'open', label: 'Open the shop', label_message: {phrase: 'shop.open'}},
    {id: 'leave', label: "We don't need it", label_message: {phrase: 'shop.leave'}, unavailable: 'Not nearby', unavailable_message: {phrase: 'shop.far'}}
  ];
  raw.objectives = [{floor: 0, x: 1, y: 2, name: 'Meda', name_message: {phrase: 'shop.npc'}}];
  const translate = value => native && value?.phrase ? 'Translated ' + value.phrase : String(value || '');
  const runtime = installDungeonRuntime({name:'W', members:()=>['W'], leader:()=> 'W', ready:()=>true, now:()=>100000,
    alive:()=>true, current:()=>true, cave:()=>raw, supported:()=>false, info:async()=>({}), request:async()=>{},
    keeper:()=>undefined, text:translate, move:async()=>{}, stop:async()=>{}, read:()=>null, write(){} });
  const observed = runtime.report().cave;
  assert.equal(observed.choice.title, native ? 'Translated shop.title' : 'The Shop with One Item');
  assert.equal(observed.choice.text, native ? 'Translated shop.text' : 'Have a look.');
  assert.deepEqual(observed.choice.options.map(o=>o.label), native ? ['Translated shop.open','Translated shop.leave'] : ['Open the shop', "We don't need it"]);
  assert.equal(observed.choice.options[1].unavailable, native ? 'Translated shop.far' : 'Not nearby');
  assert.equal(observed.points[0].label, native ? 'Translated shop.npc' : 'Meda');
});

test('a dungeon route pauses for local combat, a paused Cave or a stale control', () => {
  let now=100000, ready=true;const raw=cave();
  const runtime=installDungeonRuntime({name:'W',members:()=>['W'],leader:()=> 'W',ready:()=>ready,
    now:()=>now,alive:()=>true,current:()=>true,cave:()=>raw,supported:()=>true,
    info:async()=>({}),request:async()=>{},keeper:()=>undefined,text:String,
    move:async()=>{},stop:async()=>{},read:()=>null,write:()=>{}});
  runtime.receive({owned:true,movementReady:true});assert.equal(runtime.canMove(),true);
  ready=false;assert.equal(runtime.canMove(),false,'local aggro blocks travel before next heartbeat');
  ready=true;assert.equal(runtime.canMove(),true);
  raw.paused=true;assert.equal(runtime.canMove(),false);
  raw.paused=false;now+=3001;assert.equal(runtime.canMove(),false,'stale control must hold route');
  runtime.receive({owned:true,movementReady:true});assert.equal(runtime.canMove(),true);
 });

scenarioTable('a daily dungeon entry, exit and route pause stay under the dungeon owner', fixture, [
 ['default protection blocks events; disabling waits for all members to exit', f=>{
 f.active();
  assert.equal(f.service.eventAllowed('W', 'anniversary', true), false);
  assert.equal(f.party.dailyDungeons.phase, 'active');
  f.action({ action: 'settings', protectFromEvents: false });
  assert.equal(f.service.eventAllowed('W', 'anniversary', false), false);
  assert.equal(f.party.dailyDungeons.phase, 'active');
  assert.equal(f.service.eventAllowed('W', 'anniversary', true), false);
  f.party.statuses.W.dungeon.cave = null; f.service.reconcile();
  assert.equal(f.service.eventAllowed('W', 'anniversary', true), false);
  for (const name of ['P', 'M']) f.party.statuses[name].dungeon.cave = null;
  f.service.reconcile();
  assert.equal(f.service.eventAllowed('W', 'anniversary', true), true);
 }],
 ['captured dungeon participants survive disconnect and coordinator restart', f=>{
 f.active();
  f.party.statuses.P.seenAt = 0;
  f.party.followers.P = false;
  const next = createDungeons(structuredClone(f.party), { now: () => 100000, persist() {}, cancel() {}, offline: () => false });
  assert.deepEqual(next.snapshot().members.map(m => m.name), ['W', 'P', 'M']);
  assert.equal(next.control('P').owned, true);
 }],
 ['stale or excessive participants cannot spend the daily entry', f=>{
 f.party.followers.Extra = true;
  f.party.statuses.Extra = { seenAt: 100000 };
  assert.throws(() => f.action({ action: 'enter' }), /at most two/);
  delete f.party.followers.Extra; f.advance(4000);
  assert.throws(() => f.action({ action: 'enter' }), /fresh/);
 }],
 ['storage failure prevents irreversible dispatch', async ()=>{
  const calls = [];
  const runtime = installDungeonRuntime({ name: 'W', members: () => ['W'], leader: () => 'W', ready: () => true, now: () => 1, alive: () => true, current: () => true,
    cave: () => null, supported: () => true, info: async () => ({}), request: async () => calls.push('request'),
    keeper: () => undefined, text: String, move: async () => {}, stop: async () => {},
    read: () => null, write: () => { throw Error('storage unavailable'); } });
  runtime.receive({ owned: true, command: { id: 'entry', action: 'enter' } });
  await new Promise(setImmediate); assert.deepEqual(calls, []);
 }],
 // B148: the command whose journal write failed answers failed with the reason in
 // the next observation, which the coordinator's receipt reads, so the visit climbs its repair.
 // v1.5.0 dropped the rejection, so the command neither ran nor said why.
 ['B148: a command whose journal write fails answers failed in the next report', async ()=>{
  const runtime = installDungeonRuntime({ name: 'W', members: () => ['W'], leader: () => 'W', ready: () => true, now: () => 1, alive: () => true, current: () => true,
    cave: () => null, supported: () => true, info: async () => ({}), request: async () => {},
    keeper: () => undefined, text: String, move: async () => {}, stop: async () => {},
    read: () => null, write: () => { throw Error('storage unavailable'); } });
  runtime.receive({ owned: true, command: { id: 'entry', action: 'enter' } });
  await new Promise(setImmediate);
  const action = runtime.report().action;
  assert.deepEqual([action?.id, action?.status], ['entry', 'failed']);
  assert.match(action.error, /Dungeon journal write failed: .*storage unavailable/);
 }],
 // requestCave bounds each read by the call margin and rejects a lost reply as 'timeout' (cave-request.test.cjs
 // 'cave query cleans up on timeout' covers the bound and the dropped late reply); the next report asks again.
 ['eligibility asks again on the next report after a read times out', async ()=>{
  let lose, calls = 0;
  const f = eligibilityRuntime(() => ++calls === 1 ? new Promise((_, reject) => lose = reject) : Promise.resolve({available: true, resets: 300000, server_time: 117000, home: 'II'}));
  f.runtime.report();
  lose({failed: true, reason: 'timeout'});
  await new Promise(setImmediate);
  assert.equal(f.runtime.report().visitError, 'timeout');
  await new Promise(setImmediate);
  assert.equal(f.runtime.report().visit.available, true);
  assert.equal(f.runtime.report().visitError, undefined);
  assert.equal(calls, 2);
 }],
 // B.4 (README "Bug fixes that become tests", row 07 vote; fork): the game records no vote that
 // lands after its choice resolved, so the journal and the actions settle it on rules.ts
 // `voteSettled`.
 ['a vote that lands after its choice resolved, was replaced or ended settles; an open one blocks', f=>{
  f.active();
  const choice = (id, votes, resolved) => ({ id, title: 'Fight', text: '', deadline: cave().choice.deadline, resolved, votes,
    options: [{ id: 'fight', label: 'Fight' }] });
  const show = c => { for (const name of ['W', 'P', 'M']) f.party.statuses[name].dungeon.cave.choice = structuredClone(c); };
  show(choice('c1', {}, false));
  f.action({ action: 'vote', run: f.party.dailyDungeons.run, choice: 'c1', option: 'fight' });
  show(choice('c1', { W: 'fight', P: 'fight' }, false));
  assert.throws(() => f.action({ action: 'vote', run: f.party.dailyDungeons.run, choice: 'c1', option: 'fight' }),
    /needs reconciliation/, 'an open choice without the vote of M still blocks');
  show(choice('c2', {}, false));
  f.action({ action: 'vote', run: f.party.dailyDungeons.run, choice: 'c2', option: 'fight' });
  assert.equal(f.party.dailyDungeons.commands.M.choice, 'c2', 'a replaced choice settled the late vote of M');
  const journal = createDungeonJournal(() => null, () => {});
  const gather = { id: 'g', run: 'r1', action: 'gather' };
  journal.save({ id: 'v1', run: 'r1', action: 'vote', choice: 'c1', option: 'fight' }, 'dispatched');
  journal.reconcile({ run: 'r1', floor: 0, choice: choice('c1', { A: 'fight', B: 'fight' }, true) }, 'M');
  assert.equal(journal.blocked(gather), false, 'a resolved choice settles the journal');
  journal.save({ id: 'v2', run: 'r1', action: 'vote', choice: 'c2', option: 'fight' }, 'dispatched');
  journal.reconcile({ run: 'r1', floor: 0, choice: choice('c2', {}, false) }, 'M');
  assert.equal(journal.blocked(gather), true, 'an open, unrecorded vote still blocks');
  journal.reconcile({ run: 'r1', floor: 0, choice: null }, 'M');
  assert.equal(journal.blocked(gather), false, 'a choice that is gone settles the journal');
 }],
 ['disconnect preserves ownership and manual exit can retry a lost exit reply', f=>{
 f.active(); f.advance(4000);
  f.service.reconcile(); assert.equal(f.party.dailyDungeons.phase, 'active');
  f.action({ action: 'exit' });
  const first = f.party.dailyDungeons.commands.W.id;
  f.action({ action: 'exit' });
  assert.notEqual(f.party.dailyDungeons.commands.W.id, first);
  assert.equal(f.party.dailyDungeons.phase, 'exiting');
 }],
 // A run that fights through the noted event leaves by R6's cut-off, the event's spawn plus 60 s
 // less the party's planned walk, read from the events owner's `event.schedule` for the party's
 // occurrence.
 ['a fighting run exits for a live event by R6 cut-off from its spawn and planned walk', f=>{
  f.schedules.set('party:W|goobrawl', { event: 'goobrawl', occurrence: 'party:W|goobrawl', group: 'party:W', realm: 'II',
    spawnAt: 90000, walkMs: 45000, leadMs: 45000, phase: 'live', shortWindow: false });
  f.active();
  const tick = ms => { f.advance(ms); for (const n of ['W', 'P', 'M']) f.party.statuses[n].seenAt = f.now(); f.service.reconcile(); };
  f.party.statuses.W.target = 'goo';
  f.action({ action: 'settings', protectFromEvents: false });
  f.service.eventAllowed('W', 'goobrawl', true);
  tick(4000);
  assert.equal(f.party.dailyDungeons.phase, 'active', 'before 90000 + 60000 - 45000 the fight goes on');
  tick(2000);
  assert.equal(f.party.dailyDungeons.phase, 'exiting', 'at the cut-off the run exits for the event');
 }],
 // The live Cave owner row saw the event exit start right after the warrior died inside, before the
 // game reported the revival vote that death opens.
 ['an event exit waits while a member is dead, the run is paused or a choice is unresolved', f=>{
  f.schedules.set('party:W|goobrawl', { event: 'goobrawl', occurrence: 'party:W|goobrawl', group: 'party:W', realm: 'II',
    spawnAt: 900000, walkMs: 45000, leadMs: 45000, phase: 'live', shortWindow: false });
  f.active();
  const tick = () => { f.advance(500); for (const n of ['W', 'P', 'M']) f.party.statuses[n].seenAt = f.now(); f.service.reconcile(); };
  const W = f.party.statuses.W.dungeon, choice = W.cave.choice;
  for (const n of ['W', 'P', 'M']) f.party.statuses[n].dungeon.cave.choice = null;
  W.alive = false;
  f.action({ action: 'settings', protectFromEvents: false });
  f.service.eventAllowed('W', 'goobrawl', true);
  tick();
  assert.equal(f.party.dailyDungeons.phase, 'active', 'a dead member holds the exit');
  W.alive = true; W.cave.paused = true; tick();
  assert.equal(f.party.dailyDungeons.phase, 'active', 'a paused run holds the exit');
  W.cave.paused = false; W.cave.choice = { ...choice, resolved: false }; tick();
  assert.equal(f.party.dailyDungeons.phase, 'active', 'an unresolved choice holds the exit');
  W.cave.choice.resolved = true; tick();
  assert.equal(f.party.dailyDungeons.phase, 'exiting', 'a resolved choice is between encounters');
 }],
 // v1.5.0 cut those rows with no removal line. The paid vote comes first: the maintainer's
 // goal of manual confirmation for paid actions (cave.ts's vote check).
 ['paid votes reject missing confirmation or changed currency quotes', f=>{
  f.active();
  for (const name of ['W', 'P', 'M']) {
   const choice = f.party.statuses[name].dungeon.cave.choice;
   choice.resolved = false; choice.options = [{ id: 'here', label: 'Revive here', amber: 2 }];
  }
  const vote = { action: 'vote', run: 'run-1', choice: 'choice-1', option: 'here' };
  assert.throws(() => f.action(vote), /Confirm/);
  assert.throws(() => f.action({ ...vote, confirmed: true, amber: 1 }), /cost changed/);
  f.action({ ...vote, confirmed: true, amber: 2 });
  assert.equal(Object.values(f.party.dailyDungeons.commands).filter(c => c.action === 'vote').length, 3);
 }],
 ['purchase cannot overwrite an outstanding purchase; exit remains available', f=>{
  f.active();
  f.action({ action: 'buy', run: 'run-1', choice: 'choice-1', cost: 20, confirmed: true });
  assert.throws(() => f.action({ action: 'buy', run: 'run-1', choice: 'choice-1', cost: 20, confirmed: true }), /reconciliation/);
  f.action({ action: 'exit' });
  assert.equal(f.party.dailyDungeons.phase, 'exiting');
 }],
 // The visit changes phase only through record.ts `caveStep`, along H7's edges. One visit
 // runs from entry to the release in v1.5.0's order with no step outside the table.
 ['a visit walks its phases from entry to release along H7 edges', f=>{
  const { CAVE_EDGES } = require('../../runtime/hunting/coordinator/record.ts');
  const steps = []; let phase = 'idle';
  f.party.dailyDungeons = { protectFromEvents: true, participants: [], commands: {}, operations: [] };
  Object.defineProperty(f.party.dailyDungeons, 'phase', { enumerable: true, get: () => phase, set: to => { if (to !== phase) steps.push(phase + ' -> ' + to); phase = to; } });
  const errors = [], error = console.error; console.error = message => errors.push(String(message));
  try {
   f.active();
   f.action({ action: 'exit' });
   for (const name of ['W', 'P', 'M']) f.party.statuses[name].dungeon.cave = null;
   f.service.reconcile();
  } finally { console.error = error; }
  assert.deepEqual(steps, ['idle -> gathering', 'gathering -> entering', 'entering -> active', 'active -> exiting', 'exiting -> held', 'held -> idle']);
  for (const step of steps) { const [from, to] = step.split(' -> '); assert.ok(CAVE_EDGES[to].from.includes(from), step + ' is an H7 edge'); }
  assert.deepEqual(errors, []);
 }],
 // `cave.phase` tells each step once (6 part 2). The last member out steps exiting to held and held
 // to idle in one reconcile, and the live Cave owner rows' event exit missed `held`.
 ['an exit that ends in one reconcile tells held and idle', f=>{
  const { partyHooks: hooks } = require('../../runtime/hooks/index.ts');
  const heard = [];
  const registered = hooks().register({ name: 'cave-phase-fixture', folder: 'addons', author: 'test', summary: 'Hears the Cave phase notices.',
   hooks: { 'cave.phase': payload => heard.push(payload.from + ' -> ' + payload.to) } });
  assert.ok(registered.ok, registered.message);
  hooks().configure({ 'cave-phase-fixture': { enabled: true } });
  try {
   f.active();
   f.action({ action: 'exit' });
   for (const name of ['W', 'P', 'M']) f.party.statuses[name].dungeon.cave = null;
   f.service.reconcile();
   assert.deepEqual(heard, ['idle -> gathering', 'gathering -> entering', 'entering -> active', 'active -> exiting', 'exiting -> held', 'held -> idle']);
  } finally { hooks().configure({ 'cave-phase-fixture': { enabled: false } }); }
 }],
 ['coordinator restart preserves entry identity instead of creating another entry', f=>{
  f.action({ action: 'enter' });
  for (const name of ['W', 'P', 'M']) f.party.statuses[name].dungeon.action = { id: f.party.dailyDungeons.commands[name].id, status: 'complete' };
  f.service.reconcile();
  const restored = structuredClone(f.party), id = restored.dailyDungeons.commands.W.id;
  const next = createDungeons(restored, { now: () => 100000, persist() {}, cancel() {}, offline: () => false });
  next.reconcile(); assert.equal(next.control('W').command.id, id);
  assert.equal(restored.dailyDungeons.phase, 'entering');
 }],
 ['offline leader is retained and blocks entry', f=>{
  f.party.statuses.W.seenAt = 0;
  assert.deepEqual(f.service.snapshot().members.map(m => m.name), ['W', 'P', 'M']);
  assert.throws(() => f.action({ action: 'enter' }), /fresh/);
 }],
 ['uncertain receipt survives later actions and journal reload', ()=>{
  let saved;
  const write = value => { saved = structuredClone(value); };
  const first = createDungeonJournal(() => null, write);
  first.save({ id: 'buy', action: 'buy', run: 'run-1', choice: 'choice-1', room: 'shop-1' }, 'uncertain');
  first.save({ id: 'exit', action: 'exit' }, 'complete');
  const next = createDungeonJournal(() => saved, write);
  assert.equal(next.blocked(), true);
  const observed = cave(); observed.choice.shop.sold = true;
  next.reconcile(observed, 'W');
  assert.equal(next.get('buy').status, 'complete');
 }],
 // Survival's member recovery waits while the dungeon owns the member (recovery-member.ts `blocked`).
 ['normal death recovery remains paused under dungeon ownership', async ()=>{
  const calls = [];
  const recover = createDeathRecovery({ name: () => 'W', isDead: () => true, blocked: () => true, respawn: async () => calls.push('respawn'),
   publish() {}, rejoinEvent: async () => { calls.push('event'); return { status: 'not-applicable' }; }, log() {},
   nextReport: async () => {}, task: () => null, returnToFarm: () => { calls.push('farm'); return true; } });
  await recover(); assert.deepEqual(calls, []);
 }],
 ['eligibility exposes Steam request failures and clears them after recovery', async ()=>{
  let calls = 0;
  const f = eligibilityRuntime(async () => {
   if (++calls === 1) throw { reason: 'timeout' };
   return { available: true, resets: 300000, server_time: 105000, home: 'II' };
  });
  f.runtime.report(); await new Promise(setImmediate);
  assert.equal(f.runtime.report().visitError, 'timeout');
  assert.equal(f.runtime.report().visit, undefined);
  f.advance(5000); f.runtime.report(); await new Promise(setImmediate);
  assert.equal(f.runtime.report().visitError, undefined);
  assert.equal(f.runtime.report().visit.available, true);
 }],
 ['Cave command identity is an immutable primitive snapshot and retired runtimes expose none', ()=>{
  let current=true;const calls=[];
  const runtime=installDungeonRuntime({name:'W',members:()=>['W'],leader:()=> 'W',ready:()=>true,now:()=>100000,
   alive:()=>true,current:()=>current,cave:()=>cave(),supported:()=>true,info:async()=>{calls.push('info');return {};},
   request:async()=>{calls.push('request');},keeper:()=>undefined,text:String,move:async()=>{},stop:async()=>{},read:()=>null,write:()=>{}});
  runtime.receive({owned:true,command:{id:'owned',action:'move',run:'run-1',target:{map:'main',x:0,y:0}}});
  const before=calls.length,identity=runtime.commandIdentity();
  assert.deepEqual(identity,{id:'owned',action:'move',run:'run-1'});identity.id='foreign';
  assert.equal(runtime.commandIdentity().id,'owned');assert.equal(calls.length,before);
  current=false;assert.equal(runtime.commandIdentity(),undefined);
 }],
]);

// Auto exploration on a floor whose stairs are locked offers its two required rooms. Today's
// choice is the room nearer the leader; an add-on's `cave.destination` picks the farther one, and an
// answer naming a point it was not offered leaves today's choice.
const { partyHooks: destinationHooks } = require('../../runtime/hooks/index.ts');
let destination;
destinationHooks().register({ name: 'cave-destination-fixture', folder: 'addons', author: 'test', summary: 'Orders the Cave rooms.',
  hooks: { 'cave.destination': () => destination } });
function exploring(answer) {
  destination = answer;
  destinationHooks().configure({ 'cave-destination-fixture': { enabled: true } });
  const r = fixture();
  r.active();
  const map = 'zone_run-1_0';
  const points = [{ id: 'near', label: 'Near', map, x: 820, y: 1200, required: true }, { id: 'far', label: 'Far', map, x: 1900, y: 1200, required: true },
    { id: 'stairs', label: 'Stairs', map, x: 0, y: 0, down: true, locked: true }, { id: 'exit', label: 'Exit', map, x: 10, y: 10, exit: true }];
  for (const name of ['W', 'P', 'M']) Object.assign(r.party.statuses[name], { map }).dungeon.cave.points = points;
  r.action({ action: 'progress', enabled: true });
  r.service.reconcile();
  destinationHooks().configure({});
  return r.party.dailyDungeons.progress.target;
}
scenarioTable('the Cave exploration takes the add-on\'s next room (G3)', exploring, [
  ["HN: the add-on's room order is the next exploration target", target => assert.equal(target, 'far'), 'far'],
  ['with no answer the nearer room is the target', target => assert.equal(target, 'near'), undefined],
  ['an answer naming a point not offered leaves the nearer room', target => assert.equal(target, 'near'), 'exit'],
]);

// (B.2): the dashboard's GET and a member's reply part read the visit; only the report's tick
// (`reconcile`) advances it.
scenarioTable('the Cave visit advances on the report tick only', fixture, [
 ['a GET and the control parts leave an advanceable visit where it stands', r => {
  r.action({ action: 'enter' });
  for (const name of ['W', 'P', 'M']) r.party.statuses[name].dungeon.action = { id: r.party.dailyDungeons.commands[name].id, status: 'complete' };
  const before = JSON.stringify(r.party.dailyDungeons);
  r.service.snapshot(); for (const name of ['W', 'P', 'M']) r.service.control(name);
  assert.equal(JSON.stringify(r.party.dailyDungeons), before);
  r.service.reconcile();
  assert.notEqual(JSON.stringify(r.party.dailyDungeons), before, 'the tick advances it');
 }],
]);

// A held visit ends on the report where every fresh participant stands outside with no action pending,
// and a member the game reports offline leaves the visit. The visit runs on the
// hunting owner's `createCave` with a three-member party, and the lifecycle owner's roster projection answers who is
// offline from the party's slots and worker records.
const { createCave } = require('../../runtime/hunting/coordinator/cave.ts');
const { createRosterProjection } = require('../../runtime/lifecycle/roster/roster-projection.ts');
const { ageOf } = require('../../runtime/protocol/reports.ts');
const { partyHooks } = require('../../runtime/hooks/index.ts');
const { publishTasks } = require('../../runtime/tasks/api.ts');
// An add-on that keeps a member on its own task out of the Cave, and hears every `cave.member`
// notice. It refuses only a member whose live task is its own, so the other rows run as without it.
const caveMembers = [];
partyHooks().register({ name: 'cave-rejoin-fixture', folder: 'addons', author: 'test', summary: 'Keeps its own task out of the Cave.',
  hooks: { 'cave.rejoin': ask => ask.task?.kind === 'addon:cave-rejoin-fixture' ? false : undefined,
    'cave.member': payload => caveMembers.push([payload.member, payload.change, payload.by]) } });
function heldVisit() {
  let now = 100000;
  const paused = new Set(), assignments = {}, cancelled = [];
  caveMembers.length = 0;
  partyHooks().configure({ 'cave-rejoin-fixture': { enabled: true } });
  publishTasks({ groupOf: () => 'party:W', assignment: name => assignments[name] ?? null });
  const party = { leader: 'W', followers: { P: true, M: true }, merchantCharacter: 'Bank', statuses: {}, bankbois: {},
    headlessSlots: ['W', 'P', 'M'], steamMembers: [], nativeOwner: null, lifecycle: { W: 'online', P: 'online', M: 'online' },
    dailyDungeons: { protectFromEvents: true, participants: ['W', 'P', 'M'], phase: 'active', run: 'run-1', server: 'II', commands: {}, operations: [] } };
  for (const name of ['W', 'P', 'M']) party.statuses[name] = { seenAt: now, server: 'II', rip: false, map: 'main', x: 816, y: 1200,
    dungeon: { protocol: 1, at: now, supported: true, alive: true, ready: true, members: ['W', 'P', 'M'], leader: 'W', cave: null,
      visit: { available: true, checkedAt: now, resets: now + 86400000, home: 'II' }, keeper: { map: 'main', x: 816, y: 1200 } } };
  // The Cave's ports as installHunting gets them: the lifecycle owner's `online` for the Hunt and
  // `offline` for the Cave.
  const roster = createRosterProjection(party, () => ({ characters: [] }), () => now);
  const cave = createCave(party, { now: () => now, persist() {}, cancel: names => cancelled.push(...names), online: roster.online, offline: roster.offline });
  const silent = name => party.lifecycle[name] === 'offline' && !party.steamMembers.includes(name) || paused.has(name);
  return { party, cave, roster, paused, assignments, cancelled, now: () => now, report: (ms = 1000) => { now += ms; for (const [name, s] of Object.entries(party.statuses)) if (!silent(name)) s.seenAt = now; cave.reconcile(); } };
}
scenarioTable('a held Cave visit ends when everyone is out', heldVisit, [
  ['every member reported outside with nothing pending ends the hold on that report', r => {
    r.report();
    assert.equal(r.party.dailyDungeons.phase, 'idle');
  }],
  // The roster's realm view counts a member online by protocol/reports.ts's `realm-view` reading,
  // so a report at its age is online and one past it is not.
  ['the realm view counts a member online by the realm-view reading', r => {
    r.paused.add('M');
    r.report(ageOf('realm-view'));
    assert.equal(r.roster.control().characters.find(c => c.name === 'M').online, true);
    r.report(1);
    const view = Object.fromEntries(r.roster.control().characters.map(c => [c.name, c.online]));
    assert.deepEqual(view, { W: true, P: true, M: false });
  }],
  ['an offline member leaves the visit and the others end the hold', r => {
    r.party.lifecycle.M = 'offline';
    r.report();
    assert.deepEqual(r.party.dailyDungeons.participants, ['W', 'P']);
    assert.equal(r.party.dailyDungeons.phase, 'idle');
    assert.deepEqual(caveMembers, [['M', 'dropped', 'core:hunting']]);
  }],
  // A member the lifecycle owner holds online stays in the visit while its reports pause past
  // the presence age; its stale report holds the visit.
  ['a member the lifecycle owner holds online stays while its reports pause', r => {
    r.paused.add('M');
    r.report(ageOf('presence') + 1);
    assert.deepEqual(r.party.dailyDungeons.participants, ['W', 'P', 'M']);
  }],
  // User answer A (2026-11-16): a worker that is starting or repairing keeps its member in the run.
  ['a member whose worker is starting stays while its reports pause', r => {
    r.party.lifecycle.M = 'starting';
    r.paused.add('M');
    r.report(ageOf('presence') + 1);
    assert.deepEqual(r.party.dailyDungeons.participants, ['W', 'P', 'M']);
  }],
  // The handoff to the Steam client leaves the old worker record offline; the member's own reports
  // keep it in the visit.
  ['a member handed to the Steam client stays while it reports', r => {
    Object.assign(r.party, { headlessSlots: ['W', 'P', null], steamMembers: ['M'], nativeOwner: 'M' });
    r.party.lifecycle.M = 'offline';
    r.report();
    assert.deepEqual(r.party.dailyDungeons.participants, ['W', 'P', 'M']);
  }],
  // The user's rejoin (2026-11-16): M went offline and the visit dropped it; back online outside,
  // with the game's answer that it may return to run-1 while W and P report its clock running, it
  // walks to Dorr marked `resume` and enters once there.
  ["a member back online while the run's clock runs walks to Dorr and enters the run again", r => {
    for (const name of ['W', 'P']) r.party.statuses[name].dungeon.cave = cave();
    r.party.dailyDungeons.participants = ['W', 'P'];
    r.party.statuses.M.dungeon.visit.resume = { server: 'II', run: 'run-1' };
    r.report();
    const d = r.party.dailyDungeons;
    assert.deepEqual(d.participants, ['W', 'P', 'M']);
    assert.deepEqual([d.commands.M.action, d.commands.M.resume], ['gather', true]);
    r.party.statuses.M.dungeon.action = { id: d.commands.M.id, status: 'complete' };
    r.report();
    assert.equal(d.commands.M.action, 'enter');
    assert.deepEqual(caveMembers, [['M', 'rejoined', 'core:hunting']]);
  }],
  // M is back with its run open, but its live task is the add-on's own, which refuses the rejoin.
  // M stays out of the visit with no command, its work is not cancelled, and the refusal is told once.
  ['HN24: an add-on refuses the rejoin and the member stays on its own task', r => {
    for (const name of ['W', 'P']) r.party.statuses[name].dungeon.cave = cave();
    r.party.dailyDungeons.participants = ['W', 'P'];
    r.party.statuses.M.dungeon.visit.resume = { server: 'II', run: 'run-1' };
    r.assignments.M = { kind: 'addon:cave-rejoin-fixture', owner: 'addon:cave-rejoin-fixture', tier: 'addon-task', reunion: 'no' };
    r.report();
    r.report();
    assert.deepEqual(r.party.dailyDungeons.participants, ['W', 'P']);
    assert.equal(r.party.dailyDungeons.commands.M, undefined);
    assert.deepEqual(r.cancelled, []);
    assert.deepEqual(caveMembers, [['M', 'refused', 'cave-rejoin-fixture']]);
  }],
  // M goes offline while a vote pauses the run, and its live task is the add-on's own, whose
  // answer to `drop` keeps M listed. The first report with the run unpaused drops M as before.
  ["HN: a paused run keeps the add-on's offline member until play", r => {
    for (const name of ['W', 'P']) r.party.statuses[name].dungeon.cave = { ...cave(), paused: true };
    r.assignments.M = { kind: 'addon:cave-rejoin-fixture', owner: 'addon:cave-rejoin-fixture', tier: 'addon-task', reunion: 'no' };
    r.party.lifecycle.M = 'offline';
    r.report();
    assert.deepEqual(r.party.dailyDungeons.participants, ['W', 'P', 'M']);
    for (const name of ['W', 'P']) r.party.statuses[name].dungeon.cave = cave();
    r.report();
    assert.deepEqual(r.party.dailyDungeons.participants, ['W', 'P']);
    assert.deepEqual(caveMembers, [['M', 'dropped', 'core:hunting']]);
  }],
  // Past the run's expires the game opens a new run for `enter`, so a member
  // that comes back after the clock ended stays out.
  ["a member back after the run's clock ended stays out of the visit", r => {
    for (const name of ['W', 'P']) r.party.statuses[name].dungeon.cave = { ...cave(), expires: r.now() };
    r.party.dailyDungeons.participants = ['W', 'P'];
    r.party.statuses.M.dungeon.visit.resume = { server: 'II', run: 'run-1' };
    r.report();
    assert.deepEqual(r.party.dailyDungeons.participants, ['W', 'P']);
    assert.equal(r.party.dailyDungeons.commands.M, undefined);
  }],
]);

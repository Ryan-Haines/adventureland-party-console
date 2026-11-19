const {productionFunctions} = require('./helpers/production-functions.cjs');
const {drivePositions,positionsOf} = require('./helpers/targeting-module.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createMovementContext } = require('./fixtures/movement-owner-callers.cjs');
const {runtime}=require('./fixtures/farm-reunion-scenario.cjs');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
// The delayed respawn fallback reads who holds the character from the owner's report and
// the rank table (rules.ts `farmWalkHeld`), not the movers' flags, which these rows leave
// unset. A walk at or above the farm walk keeps the character; the death recovery's own hold
// and a lower walk give it to the reunion.
scenarioTable('the delayed respawn fallback yields to a walk at or above the farm walk and takes over from a lower one', runtime, [
 ...[
  ['a party walk at the farm tier',{kind:'group-walk',owner:'walk:party:c1:1:1',tier:'farming',journey:true},true],
  ['a shared Hunt walk',{kind:'task-walk',owner:'lone-walk:hunt',tier:'farming',journey:true},true],
  ["the event return's hold",{kind:'task-walk',owner:'event-return:cycle-1',tier:'event-return',journey:false},true],
  ["the death recovery's own hold",{kind:'death-recovery',owner:'death:R:0',journey:false},false],
  ['a follow walk',{kind:'follow',owner:'follow:M',journey:true},false],
 ].map(([label,held,keeps])=>[`${keeps?'preserves':'takes over from'} ${label}`,({r,calls})=>{
  r.lastDeathInfo=null;
  r.movement={live:()=>held};
  r.beginFarmReunion();assert.equal(calls.includes('stop'),!keeps);assert.equal(!!r.reunion,!keeps);
 }]),
]);

scenarioTable('handoff recovery keeps the reunion after a success or failure and drops it for a newer intent', runtime,
 ['success', 'failure', 'manual move', 'cleared focus', 'new command', 'convoy continuation'].map(outcome=>[outcome, async ({ r }) => {
    r.lastCommand = 10;
    r.afterCombat = async action => action();
    require('./helpers/merchant-visits.cjs').installVisits(r);
    const command = { id: 10, convoyContinuation: outcome === 'convoy continuation' ? {convoyId:'return'} : null };
    const action = async () => {
      // These retained recovery scenarios model a handoff that approached the merchant.
      command.__handoffApproached = true;
      if (outcome === 'manual move') r.navigationIntent.revision++;
      if (outcome === 'cleared focus') r.partyLocation = null;
      if (outcome === 'new command') r.lastCommand++;
      if (outcome === 'failure') throw Error('GoldMajesty did not become reachable');
    };
    const promise = r.withMerchantHandoffRecovery(command, action);
    if (outcome === 'failure') await assert.rejects(promise, /reachable/); else await promise;
    assert.equal(!!r.reunion, outcome === 'success' || outcome === 'failure');
 }]));

// A monster on another party member holds the reunion through targeting's
// attacker rule, which the crossings harness hands the reunion as shared.js does
// (helpers/crossings.cjs).
test('a monster attacking a party member blocks the farm reunion',()=>{
 const {r}=runtime();
 r.lastCommand=1;r.character.map='winterland';
 assert.equal(r.reunionBlocked(),false);
 r.parent.entities={m1:{id:'m1',type:'monster',mtype:'bee',visible:true,dead:false,target:'M',x:0,y:0}};
 assert.equal(r.reunionBlocked(),true);
});

// The shared harness's free character records a loop's error, as the owner does, so a row whose loop
// fails shows it (fixtures/movement-owner-callers.cjs `every`).
test('a free character records the error its loop throws',async()=>{
 const context=createMovementContext({});
 const endFailing=context.movement.every('reunion:probe',()=>{throw Error('reunion tick failed');});
 await new Promise(resolve=>{const end=context.movement.every('reunion:after',()=>{end();resolve();});});
 endFailing();
 assert.deepEqual(context.movement.records(),[{decision:'loop-error',owner:'reunion:probe',code:'reunion tick failed'}]);
});

scenarioTable('a farm reunion yields to a holder, climbs the round of a failed walk and accepts only the Magiport it asked for', runtime, [
 // Another live walk at a rank the farm walk does not take over holds the reunion, in place of the
 // walk flags (`partyConvoyActive` and the rest) the tick read before.
 ['a live party walk at the farm tier holds the reunion before it travels', async ({ r, calls })=>{
  r.beginFarmReunion(); r.movement.live = () => ({ kind: 'group-walk', owner: 'walk:party:c1:1:1', tier: 'farming', journey: true });
  await r.farmReunionTick();
  assert.equal(calls.some(call => call.destination || call.data), false);
  assert.equal(r.reunion.phase, 'waiting-for-movement-owner');
 }],
 ['failed travel is stopped and climbs the task round when it ends, with no retry delay', async ({ r, calls })=>{
  positionsOf(r)[0].ctype = 'warrior';
  r.smart_move = async () => { throw Error('route failed'); };
  r.beginFarmReunion(); await r.farmReunionTick();
  assert.ok(!r.reunion.retryAt);
  assert.equal(r.reunion.phase, 'retry-wait');
  assert.equal(r.reunion.lastError, 'route failed');
  assert.equal(calls.at(-1), 'stop');
 }],
 ['recipient arms before accepting only its authorized mage', async ({ r, calls })=>{
  r.beginFarmReunion(); await r.farmReunionTick();
  assert.equal(r.reunion.phase, 'requesting-magiport');
  r.root.on_magiport('M'); await Promise.resolve();
  assert.equal(calls.some(call => call.accepted), false);
  await r.reunionCm('M', { type: 'farm-reunion', action: 'offer', id: r.reunion.id, realm: 'USII' });
  assert.equal(r.reunion.phase, 'accepting-magiport');
  r.root.on_magiport('stranger'); r.root.on_magiport('M');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(call => call.accepted).length, 1);
 }],
]);

scenarioTable('the reunion tick reaches the nearest survivor by Blink, a shared walk or a route', runtime, [
 ['already-respawned runtime automatically recovers authorized displacement', async ({r,calls})=>{
 drivePositions(r,[]);assert.equal(r.reunion,null);await r.farmReunionTick();
 assert.ok(r.reunion);assert.ok(calls.some(c=>c.destination?.map==='winterland'));
 }],
]);

// returns.ts `dispatch` sends `event-resume-travel` to a returning member whose saved spot is not
// the leader's, and the return ends (`event.returned`) once that member stands there. Observed live
// on the fixture add-on's Dreams return (live-events-hooks.spec.ts): the leader's manual move had
// saved its spot where Dreams stood, the priest's command threw "Waiting for event exit to release
// movement" on every delivery, and the return never ended.
test("the event return's own resume command walks its member to the saved spot", async () => {
 const task = { kind: 'event-return', owner: 'event-return:cycle-1', tier: 'event-return', reunion: 'command' };
 const { r, calls } = runtime();
 r.receiveTask({ task });
 const command = { id: 5, type: 'event-resume-travel', cycleId: 'cycle-1', navigationRevision: 1, location: { ...r.partyLocation } };
 r.beginFarmReunion(command);
 assert.equal(r.reunion?.command, command);
 await r.farmReunionTick();
 assert.ok(calls.some(call => call.destination?.map === 'winterland'));
 // The return's task starts no reunion without its command.
 const own = runtime().r;
 own.receiveTask({ task });
 own.beginFarmReunion();
 assert.equal(own.reunion, null);
});

// Observed live on the same Dreams return a run later: the priest stood in Town under the return's
// standing hold (status `movementLive` {owner 'event-return:<cycle>', tier 'event-return', journey
// false}) with its reunion at 'waiting-for-movement-owner' until the test's 300 s poll expired.
// Another return's hold and the return's own journey still hold the reunion.
scenarioTable("the event return's resume command walks out of that return's standing hold", runtime, [
 ['own standing hold', { kind: 'task-walk', owner: 'event-return:cycle-1', tier: 'event-return', journey: false }, true],
 ["another return's standing hold", { kind: 'task-walk', owner: 'event-return:cycle-0', tier: 'event-return', journey: false }, false],
 ["the return's own journey", { kind: 'task-walk', owner: 'event-return:cycle-1', tier: 'event-return', journey: true }, false],
].map(([label, held, walks]) => [label, async ({ r, calls }) => {
  r.receiveTask({ task: { kind: 'event-return', owner: 'event-return:cycle-1', tier: 'event-return', reunion: 'command' } });
  r.beginFarmReunion({ id: 5, type: 'event-resume-travel', cycleId: 'cycle-1', navigationRevision: 1, location: { ...r.partyLocation } });
  r.movement.live = () => held;
  await r.farmReunionTick();
  assert.equal(calls.some(call => call.destination?.map === 'winterland'), walks);
  assert.equal(r.reunion.phase === 'waiting-for-movement-owner', !walks);
}]));

// The movement harness builds its pieces where a test asks for them. A context the test creates
// itself holds no movement name, though this file loads the scenarios, the slice loaders and the
// harness (red while walk-state.cjs and movement-owner-callers.cjs replaced vm.createContext).
scenarioTable('a context holds movement names only once its test asks for the harness', () => null, [
 ['a bare context reads no walk state and no movement service', () => {
  const c = vm.createContext({});
  assert.equal(vm.runInContext("typeof walkState + ' ' + typeof movement", c), 'undefined undefined');
 }],
 ['a movement context reads its own variables as walk state and the free character as its service', () => {
  const c = createMovementContext({ navigationIntent: { revision: 4 } });
  assert.equal(c.walkState.intent.revision, 4);
  assert.equal(c.movement.hold(), 'granted');
 }],
]);

// B123: the reunion counts a member at the spot by the spot's farm area. v1.5.0
// counted one within 800 of the spot, so a member farming 900 out in a wide area
// was missed and one 100 out on the far side of a wall was counted.
test('B123: the reunion counts the members inside the spot\'s farm area, at any distance', () => {
 const { r } = runtime();
 r.desiredPartyMembers = ['R', 'M', 'P'];
 const spot = r.partyLocation, seenAt = r.Date.now();
 drivePositions(r, [{ name: 'M', ctype: 'mage', map: spot.map, x: spot.x + 900, y: spot.y, server: 'USII', seenAt, hp: 100 },
  { name: 'P', ctype: 'priest', map: spot.map, x: spot.x + 100, y: spot.y, server: 'USII', seenAt, hp: 100 }]);
 r.inFarmArea = member => member.name === 'M';
 assert.deepEqual(r.reunionMembers().map(member => member.name), ['M']);
});

// Observed live on the Hunt row where the priest dies at Mr. Green and the event ends before it
// respawns: the respawned priest stood under the event return, and when the return handed it to
// the party walk, the reunion took the gap between two legs of that walk for the old death and
// the walk's next leg waited behind it. A member still dead when the return ends keeps its death.
scenarioTable("a death the event return covers starts no reunion after the return", runtime, [
 ['alive under the return', false, false],
 ['dead until the return ends', true, true],
].map(([label, deadThrough, starts]) => [label, async ({ r }) => {
  r.character.map = 'winterland'; r.character.x = 400; r.character.y = -1109;
  r.lastDeathInfo = { at: 90000 };
  r.character.rip = deadThrough;
  r.receiveTask({ task: { kind: 'event-return', owner: 'event-return:cycle-1', tier: 'event-return', reunion: 'command' } });
  await r.farmReunionTick();
  assert.equal(r.reunion, null);
  r.character.rip = false;
  r.receiveTask({ task: { kind: 'farming', owner: 'farm:party:M', tier: 'farming', reunion: 'alone' } });
  await r.farmReunionTick();
  assert.equal(!!r.reunion, starts);
}]));

// Observed live on the goo walk from Town: the warrior engaged a goo inside the area from 21 to 36
// north of it (its attack range reaches in), the walk was released, and the priest's handoff
// reunion stood at the release point for minutes, phase 'travelling', waiting on a shared walk the
// fighting warrior never joined. Inside the area the member still counts at any distance.
scenarioTable('a combat handoff reunion rejoins the leader fighting within the search radius of the area', runtime, [
 ['the leader 36 north of the area', { x: 30, y: 666 }, true],
 ['the leader beyond the search radius', { x: 30, y: 200 }, false],
].map(([label, at, rejoins]) => [label, async ({ r, calls }) => {
  const spot = { map: 'main', x: -32, y: 787, shapes: [{ boundary: [-282, 702, 218, 872] }] };
  r.partyLocation = spot; r.farmRadius = 400;
  r.character.map = 'main'; r.character.x = -25; r.character.y = 552;
  drivePositions(r, [{ name: 'M', ctype: 'warrior', map: 'main', ...at, server: 'USII', seenAt: r.Date.now(), hp: 100 }]);
  r.farmingTravelTarget = () => null;
  const posts = []; r.request = async (path, options) => { posts.push([path, options.body]); return { ok: true }; };
  r.beginFarmReunion({ id: 7, type: 'event-resume-travel', convoyHandoff: 'convoy-1', navigationRevision: 1, location: { ...spot } });
  await r.farmReunionTick();
  assert.equal(posts.some(([path]) => path === '/event-resume-complete'), rejoins);
  assert.equal(calls.some(call => call.shared), !rejoins);
}]));

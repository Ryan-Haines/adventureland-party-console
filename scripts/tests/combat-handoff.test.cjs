const test=require('node:test'),assert=require('node:assert/strict');
const {createHandoffTiming}=require('../../runtime/status/character/rings.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture}=require('./fixtures/queue-client-scenario.cjs');
const {update}=require('./helpers/run-scope.cjs');
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
scenarioTable('the queue client sends reports and long polls at once, backs off on errors and never echoes', ()=>fixture, [
 ['new queue acknowledgement is sent immediately and successful long poll is rearmed', fixture=>fixture(async f=>{
 f.client.tick();f.reports()[0].resolve(f.response());await settle();
 const g={selection:'B',queueRevision:'B,C,D',target:{id:'B'},committed:true};
 f.waits()[0].resolve(f.response(g));await settle();
 assert.equal(f.reports().length,2);assert.equal(f.reports()[1].body.groupedCombat.ack,'B');
 assert.equal(f.reports()[1].body.groupedCombat.queueAck,'B,C,D');
 assert.equal(f.waits().length,2);assert.equal(f.waits()[1].body.combatRevision,'B');
 f.reports()[1].resolve(f.response(g));await settle();assert.equal(f.reports().length,2);})],
 ['report and long poll errors retain backoff despite dirty events', fixture=>fixture(async f=>{
 f.client.tick();f.client.flush();f.reports()[0].reject(Error('offline'));f.waits()[0].reject(Error('offline'));await settle();
 f.now(1999);f.client.flush();assert.equal(f.pending.length,2);
 f.now(2000);f.client.tick();assert.equal(f.reports().length,2);assert.equal(f.waits().length,2);})],
 // A native position event's report follows the game's update it lands in (run.ts, the cadence).
 ['native position events send changed range readiness once their update lands, without timestamp echo loops', fixture=>fixture(async f=>{
 f.client.tick();f.reports()[0].resolve(f.response());await settle();
 f.readiness({target:'A',selection:'s',at:1000,ready:true,confirmation:'c1'});
 f.listeners.get('player')?.({});await update();await settle();assert.equal(f.reports().length,2);
 f.reports()[1].resolve(f.response());await settle();
 f.readiness({target:'A',selection:'s',at:1001,ready:true,confirmation:'c1'});f.listeners.get('entities')?.({});await update();await settle();assert.equal(f.reports().length,2);
 f.readiness({target:'A',selection:'s',at:1001,ready:false});f.listeners.get('entities')?.({});await update();await settle();assert.equal(f.reports().length,3);
 f.client.stop();assert.equal(f.listeners.size,0);})],
 // Observed on the live console 2026-11-18: re-ticking on the reply sent one report per round trip.
 ['a change during an open report sends with the next update, not on the reply', fixture=>fixture(async f=>{
 f.client.tick();assert.equal(f.reports().length,1);
 f.readiness({target:'A',selection:'s',at:1000,ready:true,confirmation:'c1'});
 f.listeners.get('player')?.({});await update();await settle();assert.equal(f.reports().length,1,'the open report holds the change');
 f.reports()[0].resolve(f.response());await settle();assert.equal(f.reports().length,1,'the reply sends nothing');
 await update();await settle();assert.equal(f.reports().length,2,'the next update sends the change');})],
 // Positions ride with the interval's report; other changes send at once.
 ['a position-only change waits for the interval, a state change does not', fixture=>fixture(async f=>{
 f.client.tick();f.reports()[0].resolve(f.response());await settle();
 f.move({x:50,y:-20});f.listeners.get('player')?.({});await update();await settle();
 assert.equal(f.reports().length,1,'the character and its threat moved; nothing else changed');
 f.readiness({target:'A',selection:'s',at:1000,ready:true,confirmation:'c1'});f.listeners.get('player')?.({});await update();await settle();
 assert.equal(f.reports().length,2,'readiness sends at once');assert.equal(f.reports()[1].body.x,50,'the report carries the newest position');
 f.reports()[1].resolve(f.response());await settle();
 f.move({x:90,y:-20});f.now(1000000);f.client.tick();await settle();
 assert.equal(f.reports().length,3,'the interval sends the moved position');assert.equal(f.reports()[2].body.x,90);})],
 ['an unrelated death waits for the interval, a threat\'s death sends at once', fixture=>fixture(async f=>{
 f.client.tick();f.reports()[0].resolve(f.response());await settle();
 f.deaths.push({id:'other-player-kill',map:'cave',in:'cave',server:'USII',at:1000});f.listeners.get('player')?.({});await update();await settle();
 assert.equal(f.reports().length,1,'a death the party has no stake in');
 f.deaths.push({id:'M',map:'cave',in:'cave',server:'USII',at:1000});f.listeners.get('player')?.({});await update();await settle();
 assert.equal(f.reports().length,2,'the threat M died');})],
]);
test('handoff timing preserves local times, ignores old-target results, and stays bounded',()=>{
 let now=100;const entries=[],t=createHandoffTiming(entries,()=>true,()=>now);
 t.death('A');t.death('A');now=120;t.selection({selection:'B:1',target:{id:'B'},committed:true,handoffTiming:{selectedAt:99999}});
 t.attack('blocked','B',{reason:'cooldown'});t.attack('blocked','B',{reason:'cooldown'});
 now=180;t.attack('attempt','B',{cooldownReadyAt:180});t.attack('attempt','B',{});
 t.attack('accepted','A',{});t.attack('accepted','B',{});t.attack('attempt','B',{});
 assert.deepEqual(entries.map(e=>e.stage),['death','selection','committed','blocked','attempt','accepted']);
 assert.equal(entries[4].at-entries[0].at,80);
 for(let i=0;i<300;i++)t.event('timer',{sequence:i});assert.equal(entries.length,256);
 // The ring records only while a diagnostics lease names it; the same calls leave nothing with no lease.
 const idle=[];let leased=false;const g=createHandoffTiming(idle,()=>leased,()=>now);
 g.death('A');g.attack('attempt','B',{});assert.equal(idle.length,0);
 leased=true;g.death('C');assert.deepEqual(idle.map(e=>e.stage),['death']);
});

// Table A on one fake character, each row a port that records its call. The heartbeat
// half and the channel half share this setup, so they are rows of one test.
test('table A: the farming mode applies before the grouped lock, the report acts on nothing, and a held reply runs no acting row', async () => {
  const {createApply} = require('../../runtime/status/character/apply.ts');
  const {boundFired, boundsPending, boundsSent} = require('../../runtime/status/api.ts');
  const {TABLE_A} = require('../../runtime/status/rules.ts');
  let calls = [], held = false;
  const rows = Object.fromEntries(TABLE_A.map(({row}) => [row, () => { calls.push(row); return row === 'held' ? held : undefined; }]));
  const before = [];
  const apply = createApply({ farmingMode: () => before.push('farming'), deathSeen: () => before.push('death'), telemetry: () => before.push('telemetry'),
    gatheringCooldown: skill => before.push(skill), rows, snapshot: () => ({ boundsFired: boundsPending() }), request: async () => ({}) });
  // The heartbeat half: the hunting owner's farming section before targeting's lock, and the wake
  // after both.
  await apply.reply({});
  assert.ok(calls.indexOf('farming') < calls.indexOf('combat'), 'the farming mode applies before the grouped lock');
  assert.ok(calls.indexOf('combat') < calls.indexOf('party-walks'));
  // The channel half: only the channel rows run, farming first. The queue client's own combat
  // apply stands in for the combat row, and the targeting owner's priorities and the survival owner's recovery rows run around it.
  calls = [];
  let combat = 0;
  await apply.channel({}, () => { calls.push('queue-client'); combat++; });
  assert.deepEqual(calls, ['farming', 'priorities', 'queue-client', 'recovery']);
  assert.equal(combat, 1);
  // The rows before the report read and record; none of table A's acting rows runs there. The
  // bound path (bigcheck/bounds.md): a firing queued before the report rides it and leaves the
  // queue once the coordinator took the report.
  calls = [];
  boundsSent(boundsPending().length); boundFired({ bound: 'callMargin', owner: '06', state: {} });
  await apply.publish();
  assert.deepEqual(boundsPending(), [], 'the report took the queued firing');
  // The publish's reply runs the lifecycle owner's command row, since the command row drops a one-shot on that
  // delivery.
  assert.deepEqual(calls, ['command']);
  calls = [];
  // Two posts at once carry each queued firing once, in order, and leave the queue empty.
  const carried = [];
  const ordered = createApply({ farmingMode() {}, deathSeen() {}, telemetry() {}, gatheringCooldown() {}, rows,
    snapshot: () => ({ boundsFired: boundsPending() }), request: async (_path, { body }) => { carried.push(body.boundsFired.map(f => f.seq)); return {}; } });
  boundFired({ bound: 'callMargin', owner: '06', state: {} });
  const first = ordered.publish();
  boundFired({ bound: 'callMargin', owner: '06', state: {} });
  await Promise.all([first, ordered.publish()]);
  assert.equal(carried[0].length, 2, 'the first post takes its snapshot when it runs');
  assert.deepEqual(carried[1], [], 'the second post carries none of the firings the first took');
  assert.deepEqual(boundsPending(), []);
  assert.deepEqual(calls, ['command', 'command']);
  assert.deepEqual(before, ['farming', 'death', 'telemetry', 'fishing', 'mining']);
  // A held reply ends the apply at the lifecycle owner's row; only the kept rows (the status
  // owner's dashboard lease and movement's heartbeat) run after it.
  held = true;
  calls = [];
  await apply.reply({});
  const rowsTo = TABLE_A.findIndex(({row}) => row === 'held') + 1;
  assert.deepEqual(calls, [...TABLE_A.slice(0, rowsTo), ...TABLE_A.filter(row => 'kept' in row)].map(({row}) => row));
  for (const acting of ['stand-sync', 'convoy', 'navigation', 'combat', 'elixir', 'command', 'tidy', 'stock-up'])
    assert.equal(calls.includes(acting), false, `${acting} acts while held`);
});

// The events owner's exit observe is the one read of the reply's event return cycle (the transport
// copy left characters/shared.js), so a reply that ends the apply still runs it.
test('table A: a held reply still runs 06\'s exit observe', async () => {
  const {createApply} = require('../../runtime/status/character/apply.ts');
  const {TABLE_A} = require('../../runtime/status/rules.ts');
  const calls = [];
  const rows = Object.fromEntries(TABLE_A.map(({row}) => [row, () => { calls.push(row); return row === 'held'; }]));
  const apply = createApply({ farmingMode() {}, deathSeen() {}, telemetry() {}, gatheringCooldown() {}, rows, snapshot: () => ({}), request: async () => ({}) });
  await apply.reply({});
  assert.ok(calls.includes('exit-observe'));
  assert.equal(calls.includes('navigation'), false);
});

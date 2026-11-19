// Survival's steps that run on a signal: the character's death recovery, the passive pulse and the
// coordinator's escape and recovery step.
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { needsWorld, installedSurvival } = require('./fixtures/survival-needs-scenario.cjs');
const { installCoordinatorAnswers } = require('./helpers/survival-answers.cjs');
const { partyHooks } = require('../../runtime/hooks/index.ts');
const { update } = require('./helpers/run-scope.cjs');

// A priest with survival installed over a game socket and a report the row completes. `respawns`
// answers each game `respawn` call in turn.
function recoveryWorld(t, respawns) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const w = needsWorld('priest'), socket = new EventEmitter(), asked = [], farms = [];
  let report = () => {};
  globalThis.respawn = () => { asked.push(Date.now()); const answer = respawns.shift(); if (answer.ok) w.g.character.rip = false; return answer.ok ? Promise.resolve() : Promise.reject(answer); };
  globalThis.game_log = () => {};
  w.world.band = 'send';
  w.world.shared = { socket: () => socket, ownActor: id => id === w.g.character.name,
    nextReport: () => new Promise(resolve => { report = resolve; }),
    memberTask: () => ({ task: { kind: 'farming', owner: 'farm' }, at: Date.now() }), farmReturn: () => { farms.push(Date.now()); return true; } };
  const s = installedSurvival(w, w.world, globalThis);
  t.after(() => { s.stopAll(); delete globalThis.respawn; });
  return { w, s, socket, asked, farms, completeReport: () => report() };
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

// The 250 ms respawn timer asked again on its next tick after the server's wait ended.
test("the respawn asks again at the time the server's cant_respawn names", async t => {
  const r = recoveryWorld(t, [{ reason: 'cant_respawn', ms: 3100 }, { ok: true }]);
  r.w.g.character.rip = true;
  r.s.start(); await settle();
  assert.deepEqual(r.asked, [100000], 'the first step asks at once');
  t.mock.timers.tick(3099); await settle();
  assert.equal(r.asked.length, 1, 'nothing asks inside the server wait');
  t.mock.timers.tick(1); await settle();
  assert.deepEqual(r.asked, [100000, 103100], 'the next ask goes when the wait ends');
});

// A death waited up to one tick of the 250 ms timer before its recovery started.
test("the game's death packet starts the recovery", async t => {
  const r = recoveryWorld(t, [{ ok: true }]);
  r.s.start(); await settle();
  assert.deepEqual(r.asked, [], 'a living character asks nothing');
  t.mock.timers.tick(40);
  r.w.g.character.rip = true; r.socket.emit('death', { id: r.w.g.character.name }); await settle();
  assert.deepEqual(r.asked, [100040]);
});

// After the respawn the recovery waits for a report completed after it, then follows the group task.
test('a completed report runs the group task step', async t => {
  const r = recoveryWorld(t, [{ ok: true }]);
  r.w.g.character.rip = true;
  r.s.start(); await settle();
  assert.deepEqual(r.farms, [], 'the answer must come from a report completed after the respawn');
  t.mock.timers.tick(700);
  r.completeReport(); await settle(); t.mock.timers.tick(0); await settle();
  assert.deepEqual(r.farms, [100700], 'the report starts the farm return');
});

// The passive pulse ran every 500 ms whatever changed; a lost HP point waited up to half a second.
test("the pulse passes on the game's HP packet and at 03's next turn edge", async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 200000 });
  const w = needsWorld('priest'), socket = new EventEmitter(), passes = [];
  let edge = null;
  w.world.shared = { socket: () => socket };
  w.world.turns = { pass: kind => { passes.push([kind, Date.now()]); }, nextReady: () => edge };
  const s = installedSurvival(w, w.world, {});
  t.after(() => s.stopAll());
  s.half.startPulse();
  assert.deepEqual(passes, [['pulse', 200000]], 'the start passes once');
  // A packet's pass follows the game's update it lands in (run.ts, the cadence).
  t.mock.timers.tick(30); socket.emit('player', {});
  assert.equal(passes.length, 1, 'the HP packet passed before its update landed');
  await update();
  assert.deepEqual(passes.at(-1), ['pulse', 200030], 'the HP packet passes');
  edge = 200530; socket.emit('entities', {}); await update();
  edge = null; t.mock.timers.tick(499);
  assert.equal(passes.length, 3, 'nothing passes before the edge');
  t.mock.timers.tick(1);
  assert.deepEqual(passes.at(-1), ['pulse', 200530], "03's next edge passes");
});

// The game updates once per clock window: packets inside one update run one pulse, and a packet
// inside an update already pulsed runs its pulse once at the next update.
test('the pulse passes at most once per game update', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 200000 });
  const w = needsWorld('priest'), socket = new EventEmitter(), passes = [], next = [];
  let at = 1;
  w.world.shared = { socket: () => socket };
  w.world.turns = { pass: kind => { passes.push(kind); }, nextReady: () => null, update: () => at, afterNextUpdate: fn => { next.push(fn); } };
  const s = installedSurvival(w, w.world, {});
  t.after(() => s.stopAll());
  s.half.startPulse();
  assert.equal(passes.length, 1, 'the start passes once');
  for (let i = 0; i < 5; i++) { socket.emit('player', {}); socket.emit('entities', {}); await update(); }
  assert.equal(passes.length, 1, 'a packet inside the pulsed update passed again');
  at = 2; for (const fn of next.splice(0)) fn();
  assert.equal(passes.length, 2, 'the waiting packets pass once at the next update');
  assert.equal(next.length, 0);
});

// The coordinator's 250 ms clock ran the escape and the recovery between the reports they read.
test("a member's report and an escape stage change run the coordinator's step", () => {
  const party = { leader: 'W', statuses: {}, commands: {}, combatLogs: {} };
  const s = installCoordinatorAnswers(() => party), steps = [];
  s.step = () => steps.push('step');
  partyHooks().notify('status.received', { character: 'W', seq: 1, seenAt: 1, by: 'core:status' });
  partyHooks().notify('survival.escapeStage', { group: 'party:W', id: 'e1', from: 'blink', to: 'port', by: 'core:survival' });
  assert.deepEqual(steps, ['step', 'step']);
});

// Lifecycle's run scope and table P: one row per failure mode, on a frame
// whose timers this file fires by hand. Written in the lifecycle owner's build, part 3; the end run runs
// them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { runRow } = require('../../runtime/lifecycle/rules.ts');
const { createRunScope, createCoordinatorRun, RunnerScope, RetiredRunnerError } = require('../../runtime/lifecycle/character/run.ts');

// A frame whose timers run only when `advance` reaches them, in due order.
function frame() {
  let now = 0, next = 1;
  const timers = new Map();
  const add = (callback, ms, every) => { const id = next++; timers.set(id, { at: now + Math.max(0, ms || 0), callback, every }); return id; };
  return {
    setTimeout: (callback, ms) => add(callback, ms, 0), setInterval: (callback, ms) => add(callback, ms, ms),
    clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        now = timer.at;
        if (timer.every) timer.at += timer.every; else timers.delete(id);
        timer.callback();
      }
      now = end;
    },
    timers,
  };
}
function setup(hold = null) {
  const f = frame(), game = {}, notices = [], state = { hold };
  const run = createRunScope({ frame: f, game, name: () => 'W', hold: () => state.hold, notify: (hook, payload) => notices.push({ hook, ...payload }) });
  return { f, game, run, notices, state };
}
class Socket { constructor() { this.handlers = {}; } on(e, h) { (this.handlers[e] ||= []).push(h); } off(e, h) { this.handlers[e] = (this.handlers[e] || []).filter(x => x !== h); } emit(e, d) { for (const h of [...(this.handlers[e] || [])]) h(d); } }

test('table P: P2 holds until the first reply, then 01\'s hold field decides', () => {
  assert.equal(runRow({ answered: false, hold: null }), 'starting', 'a character acts before its first reply');
  assert.equal(runRow({ answered: true, hold: 'user' }), 'held', 'the console Pause lets a character act');
  assert.equal(runRow({ answered: true, hold: 'pause' }), 'held', 'Pause on a headless character lets it act');
  assert.equal(runRow({ answered: true, hold: 'manual' }), 'running', 'Manual holds the console, which 01 and 03 own');
  assert.equal(runRow({ answered: true, hold: null }), 'running');
});

// Table P's P0 row: the coordinator run fires an `act` tick from its start, and its stop ends every
// part and registration.
test('P0: the coordinator run never holds an act timer, and its stop ends each part and timer', () => {
  const f = frame(), run = createCoordinatorRun(f), acts = [], stopped = [];
  const act = run.scope('13', 'act');
  act.setTimeout(() => acts.push('restore'), 10);
  act.setInterval(() => acts.push('expire'), 20);
  run.part({ stop: () => stopped.push('roster') });
  f.advance(20);
  assert.deepEqual(acts, ['restore', 'expire'], 'the coordinator held an act timer');
  run.stop();
  f.advance(100);
  assert.deepEqual(acts, ['restore', 'expire'], 'a tick fired after the run stopped');
  assert.deepEqual(stopped, ['roster']);
  assert.equal(f.timers.size, 0, 'the stop left a frame timer');
});

test('a: a loaded character acts on no timer until a reply answers; a failed report starts nothing', () => {
  const { f, run } = setup();
  const acts = [];
  run.scope('02', 'act').setTimeout(() => acts.push('walk'), 10);
  f.advance(50);
  assert.deepEqual(acts, [], 'a starting character acted before the console answered');
  // A report whose send fails brings no reply, so the run stays starting and the one-shot stays held.
  const { CHARACTER_PICKS } = require('../../runtime/lifecycle/fields.ts');
  const sends = [];
  run.startReports(() => { sends.push('failed send'); });
  f.advance(CHARACTER_PICKS.lifecycleReportMs * 3);
  assert.equal(sends.length, 3, 'the report timer did not send each period');
  assert.equal(run.held(), true, 'a failed report released the run');
  assert.deepEqual(acts, [], 'a failed report started the held act');
  run.replied();
  assert.deepEqual(acts, ['walk'], 'the held one-shot did not fire at release');
});

test('K-B1: a held act one-shot fires at release in due order; an interval keeps one pending tick; a handler is not called', () => {
  const { f, run, state, notices } = setup();
  run.replied();
  const order = [], ticks = [], socket = new Socket(), handled = [];
  const act = run.scope('04', 'act');
  act.setInterval(() => ticks.push(1), 10);
  act.on(socket, 'hit', data => handled.push(data));
  state.hold = 'user'; run.update();
  assert.deepEqual(notices.at(-1), { hook: 'lifecycle.holdChanged', character: 'W', held: true, by: 'user' });
  act.setTimeout(() => order.push('second'), 20);
  act.setTimeout(() => order.push('first'), 5);
  f.advance(100);
  socket.emit('hit', 1);
  assert.deepEqual(order, [], 'a held one-shot acted');
  assert.deepEqual(ticks, [], 'a held interval ticked');
  assert.deepEqual(handled, [], 'a held handler was called');
  state.hold = null; run.update();
  assert.deepEqual(order, ['first', 'second'], 'the held one-shots fired out of their due order');
  assert.equal(ticks.length, 1, 'a held interval fired more than one tick at release');
  assert.equal(notices.at(-1).held, false);
});

test('observers run while held, and the report timer keeps its period with report.sent', () => {
  const { f, run, state, notices } = setup();
  run.replied(); state.hold = 'user'; run.update();
  let reports = 0;
  run.startReports(() => { reports++; });
  const seen = [];
  run.scope('12', 'observe').setTimeout(() => seen.push('sample'), 5);
  f.advance(3000);
  assert.equal(reports, 3, 'the report timer stopped while held');
  assert.deepEqual(notices.filter(n => n.hook === 'report.sent').map(n => n.sequence), [1, 2, 3], 'one notice per report, in order');
  // The published row (rows/13-lifecycle.ts) names every field the notice carries.
  const { receives } = require('../../runtime/hooks/rows/13-lifecycle.ts').HOOKS['report.sent'];
  for (const field of Object.keys(notices.find(n => n.hook === 'report.sent')).filter(key => key !== 'hook'))
    assert.match(receives, new RegExp(`\\b${field}\\b`), `report.sent's row omits ${field}`);
  assert.deepEqual(seen, ['sample'], 'an observer stopped while held');
});

test('a new generation disposes the last one\'s listeners from the game window, with no stop', () => {
  const f = frame(), game = {}, socket = new Socket(), port = { name: () => 'W', hold: () => null, notify() {} };
  const first = createRunScope({ frame: f, game, ...port });
  first.scope('07', 'act').on(socket, 'hit', () => {});
  first.scope('12', 'observe').on(socket, 'action', () => {});
  createRunScope({ frame: f, game, ...port });
  assert.equal((socket.handlers.hit || []).length + (socket.handlers.action || []).length, 0, 'an old handler survived the frame');
  assert.equal(first.current(), false, 'the replaced generation reads itself current');
});

// character/host.ts wraps the headless game in RunnerScope's facade, and the generation's run scope
// registers on that facade, so one scope records each registration and the facade only retires.
test('headless: the run scope alone records a listener on the facade, which retires the game view', () => {
  const socket = new Socket(), host = { socket, move: () => 'moved' };
  socket.on('move', () => {});
  const view = new RunnerScope(), parent = view.facade(host);
  const run = createRunScope({ frame: frame(), game: parent, name: () => 'W', hold: () => null, notify() {} });
  run.scope('12', 'observe').on(parent.socket, 'data', () => {});
  const move = parent.move;
  view.dispose();
  assert.equal(socket.handlers.data.length, 1, 'the facade removed a listener the run scope holds');
  assert.throws(() => move(), RetiredRunnerError, 'a saved game method acted after retirement');
  run.dispose();
  assert.equal(socket.handlers.data.length, 0, 'the run scope left its listener on the game socket');
  assert.equal(socket.handlers.move.length, 1, 'a game-owned listener went with the generation');
});

test('stop runs every part\'s end, then removes every timer', () => {
  const { f, run } = setup();
  run.replied();
  const ends = [];
  run.part({ start() { run.scope('05', 'act').setInterval(() => ends.push('tick'), 10); }, stop() { ends.push('survival'); } });
  run.part({ stop() { ends.push('budget'); } });
  run.start(); run.stop();
  f.advance(100);
  assert.deepEqual(ends, ['survival', 'budget'], 'a part did not end in order, or a timer outlived the stop');
});

// The draw-frame callback is a registration of the run scope, so a stop drops one the game has not
// drawn yet (the hunting owner's loot pass waits on it, loot.ts nextObservation).
test('afterDraw runs on the next draw frame, and a stop drops one not yet drawn', () => {
  const { game, run } = setup();
  const frames = [];
  game.draw_trigger = callback => frames.push(callback);
  run.replied();
  const observe = run.scope('07', 'observe'), drawn = [];
  observe.afterDraw(() => drawn.push('first'));
  frames.shift()();
  observe.afterDraw(() => drawn.push('after stop'));
  run.stop();
  frames.shift()();
  assert.deepEqual(drawn, ['first']);
});

test('K-B1: a microtask from an act handle waits for release while held', () => {
  const { run, state } = setup('user');
  run.replied();
  const fired = [];
  run.scope('02', 'act').queueMicrotask(() => fired.push('act'));
  return Promise.resolve().then(() => {
    assert.deepEqual(fired, [], 'a held wake ran');
    state.hold = null; run.update();
    assert.deepEqual(fired, ['act'], 'the wake was lost at release');
  });
});

test('L4 part 3: lifecycle.scope hands the owner a handle on the live run scope, and none without one', () => {
  const { scope } = require('../../runtime/lifecycle/character/run.ts');
  const parent = globalThis.parent;
  try {
    globalThis.parent = {};
    assert.throws(() => scope('07', 'act'), /No run scope for 07/, 'an install with no run scope got a handle');
    const { f, run, game } = setup();
    globalThis.parent = game;
    // A timer registered through the handle belongs to the live run scope: its dispose clears it.
    const fired = [];
    scope('07', 'observe').setTimeout(() => fired.push('late'), 10);
    assert.equal(f.timers.size, 1, 'the handle did not register on the live scope frame');
    run.dispose();
    assert.equal(f.timers.size, 0, 'the run scope dispose left the handle timer');
    f.advance(50);
    assert.deepEqual(fired, [], 'a timer fired after the run scope disposed');
  } finally { globalThis.parent = parent; }
});

// The lifecycle owner answers `member.holder` for the members it holds, from the acknowledgement
// and the report freshness.
test('a paused member is coming until Play; a loading one until it reloads; a lost one is let go', () => {
  const { memberHolds } = require('../../runtime/lifecycle/coordinator/lease.ts');
  const now = 1_000_000, report = (fields = {}) => ({ seenAt: now, reportIntervalMs: 1000, ...fields });
  const ask = (r, w) => memberHolds('W', { now: () => now, report: () => r, worker: () => w });
  assert.deepEqual(ask(report({ consoleMaintenance: { held: true } })), [{ owner: '13', reason: 'paused', coming: true, endsOn: 'lifecycle.holdChanged' }], 'no answer for a paused member');
  assert.deepEqual(ask(report({ consoleMaintenance: { id: 'L1', mode: 'draining' } })), [{ owner: '13', reason: 'loading', coming: true, endsOn: 'lifecycle.reloaded' }], 'no answer under a deploy lease');
  assert.deepEqual(ask(report(), { instance: {}, codeReloadRunning: true }), [{ owner: '13', reason: 'loading', coming: true, endsOn: 'lifecycle.reloaded' }], 'no answer while the CODE reload runs');
  const lost = [{ owner: '13', reason: 'runtime-lost', coming: false, endsOn: 'worker.started' }];
  assert.deepEqual(ask(report({ seenAt: now - 600_000 })), lost, 'a member whose reports stopped is waited on');
  assert.deepEqual(ask(report(), { instance: null, lastExit: { at: now, code: 1 } }), lost, 'a member whose worker exited is waited on');
  assert.deepEqual(ask(undefined), lost, 'a member with no report is waited on');
  assert.deepEqual(ask(report(), { instance: {} }), [], 'a running member 13 does not hold is held');
});

// The live party-travel walk after a coordinator restart ended before any member reported: every
// member had no report yet, so 13 let each go and the restored walk ended with no one in it.
test('after a coordinator restart a member with no report yet is let go only once a report window passes', () => {
  const { memberHolds } = require('../../runtime/lifecycle/coordinator/lease.ts');
  const startedAt = 1_000_000, lost = [{ owner: '13', reason: 'runtime-lost', coming: false, endsOn: 'worker.started' }];
  const ask = now => memberHolds('W', { now: () => now, startedAt, report: () => undefined, worker: () => ({ instance: {} }) });
  assert.deepEqual(ask(startedAt + 1000), [], 'a member the restarted coordinator has not heard from yet is waited on');
  assert.deepEqual(ask(startedAt + 60_000), lost, 'a member still silent a report window after the start is let go');
});

// Table R's character rows and the atomic boundary (drain.ts `acknowledge`, `boundary`).
function drainFixture(facts = {}) {
  // Each fixture starts from a fresh registry, so owner answers one row publishes never reach the next.
  delete globalThis.__partyHooks;
  const { partyHooks } = require('../../runtime/hooks/index.ts');
  const { createDrain } = require('../../runtime/lifecycle/character/drain.ts');
  const state = { held: false, fight: false, attackers: 0, parked: false, routing: false, ...facts,
    character: { name: 'W', ctype: 'warrior', map: 'main', x: 0, y: 0, moving: false, q: {}, ...facts.character } };
  const store = new Map(), moves = [], generation = new AbortController();
  state.current = true;
  const frame = {}, drain = createDrain({ frame, game: {}, character: () => state.character, realm: () => 'USII', current: () => state.current,
    retired: generation.signal,
    storage: () => ({ getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) }),
    held: () => state.held, markers: () => [], started: () => false, attackingParty: () => false, engaged: () => null,
    drainKey: target => target.id, drainFight: () => state.fight, attackers: () => state.attackers,
    move: async (goal, owner) => { moves.push([owner, goal]); }, parked: () => state.parked, routing: () => state.routing, log() {} });
  return { drain, frame, state, store, moves, generation, hooks: partyHooks() };
}
const safeLease = (fields = {}) => ({ id: 'L', mode: 'draining', loadMode: 'safe', phase: 'draining', ...fields });

test('A1: a held character is ready once it stands still with no boundary open and an empty game queue', () => {
  const t = drainFixture({ held: true, fight: true });
  t.drain.receive(safeLease());
  assert.equal(t.drain.acknowledge().ready, true, 'a held fight does not keep the drain waiting');
  t.state.character.moving = true;
  assert.equal(t.drain.acknowledge().ready, false, 'a moving held character is not ready');
  t.state.character.moving = false; t.state.character.q = { attack: {} };
  assert.equal(t.drain.acknowledge().ready, false, 'an action the game has not answered holds it');
  t.state.character.q = {}; t.frame.__partyConsoleAtomic = 1;
  assert.deepEqual([t.drain.acknowledge().ready, t.drain.acknowledge().boundary], [false, 1], 'an open boundary holds it and is reported');
  t.drain.receive(null); t.frame.__partyConsoleAtomic = 0;
  assert.deepEqual(t.drain.acknowledge(), { held: true, combat: false, boundary: 0, ready: true }, 'the Pause alone acknowledges held');
});

test('A2 and A2m: a running character waits for its fight, the owners, its walk and Main; the held merchant waits only for its bag', () => {
  const t = drainFixture({ fight: true });
  t.drain.receive(safeLease());
  assert.equal(t.drain.acknowledge().ready, false, 'A2: the drain fight keeps it waiting');
  t.state.fight = false; t.state.routing = true;
  assert.equal(t.drain.acknowledge().ready, false, 'A2: a route that is not parked keeps it waiting');
  t.state.parked = true;
  assert.equal(t.drain.acknowledge().ready, true);
  t.state.character.map = 'cave'; t.drain.receive(safeLease({ id: 'M', loadMode: 'main', phase: 'moving-main' }));
  assert.equal(t.drain.acknowledge().ready, false, 'A2: a Main lease waits for a fighter on main');
  // The merchant jobs owner's job answer holds a running fighter; the same answer leaves the held merchant out.
  const jobs = { name: 'core:merchant-jobs', folder: 'core', author: 'test', summary: 'a job runs', hooks: { 'lifecycle.ready': () => ({ ready: false, reason: 'job' }) } };
  const w = drainFixture();
  w.drain.receive(safeLease());
  assert.equal(w.drain.acknowledge().ready, true, 'A2: a fighter with no owner answer is ready');
  assert.equal(w.hooks.publish(jobs).ok, true, 'the job answer was not taken');
  assert.equal(w.drain.acknowledge().ready, false, 'A2: 08\'s job keeps a running fighter waiting');
  const m = drainFixture({ character: { ctype: 'merchant' } });
  m.drain.receive(safeLease());
  assert.equal(m.hooks.publish(jobs).ok, true, 'the job answer was not taken');
  assert.equal(m.drain.acknowledge().ready, true, "A2m: a lease holding the merchant leaves 08's job out");
  assert.equal(m.hooks.publish({ name: 'core:items-bag', folder: 'core', author: 'test', summary: 'the bag holder', hooks: { 'lifecycle.ready': () => ({ ready: false, reason: 'bag' }) } }).ok, true, 'the bag answer was not taken');
  assert.equal(m.drain.acknowledge().ready, false, "A2m: 10's bag holder keeps the held merchant waiting");
});

test("lifecycle.ready: an add-on hold during a drain lease keeps the member's ready false, and its readiness notice goes with the acknowledgement", () => {
  const t = drainFixture();
  const heard = [];
  // The live fixture add-on's character half reads `lifecycle.drain` on each notice it hears; the
  // live run lost the readiness notice it got inside its own `report.sent` handler.
  const read = hook => payload => { heard.push([hook, payload.waiting ?? null]); void t.hooks.askRow('lifecycle.drain', [])?.park; };
  assert.equal(t.hooks.register({ name: 'hold-fixture', folder: 'addons', author: 'test', summary: 'holds the drain',
    hooks: { 'lifecycle.ready': () => ({ ready: false, reason: 'own work' }), 'lifecycle.readiness': read('lifecycle.readiness'), 'report.sent': read('report.sent') } }).ok, true);
  t.hooks.configure({ 'hold-fixture': { enabled: true } });
  t.drain.receive(safeLease());
  t.hooks.notify('report.sent', { character: 'W', sequence: 1 });
  assert.deepEqual(heard, [['report.sent', null]], 'a read of the drain sends no readiness notice');
  assert.equal(t.drain.acknowledge().ready, false, "the add-on's hold keeps the member's ready false");
  assert.deepEqual(heard.slice(1), [['lifecycle.readiness', [{ by: 'hold-fixture', reason: 'own work' }]]], 'the acknowledgement sends the hold once');
  t.drain.acknowledge();
  assert.equal(heard.length, 2, 'an unchanged hold sends nothing more');
});

test('boundary(): a merchant held by a lease waits at the boundary until the reply that clears the lease', async () => {
  const t = drainFixture({ character: { ctype: 'merchant' } });
  t.drain.receive(safeLease());
  let settled = false;
  const waiting = t.drain.boundary().then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'the boundary holds while the lease holds the merchant');
  t.drain.receive(null);
  await waiting;
  assert.equal(settled, true, 'the reply that clears the lease settles it, with no poll');
});

test('a merchant waiting at the boundary when its generation is disposed throws as replaced', async () => {
  const t = drainFixture({ character: { ctype: 'merchant' } });
  t.drain.receive(safeLease());
  const waiting = t.drain.boundary();
  t.state.current = false; t.generation.abort();
  await assert.rejects(waiting, /Merchant continuation replaced during console loading/);
  await assert.rejects(t.drain.boundary(), /replaced/, 'a retired generation does not wait at all');
});

test('table A rows: a held reply takes the lease and parks once; the maintenance row parks a drained fighter and holds the turns', () => {
  const t = drainFixture({ held: true, character: { moving: true } });
  const parks = [];
  t.hooks.publish({ name: 'core:movement', folder: 'core', author: 'test', summary: 'park', hooks: { 'movement.park': name => { parks.push(name); } } });
  assert.equal(t.drain.heldReply({ consoleMaintenance: safeLease() }), true, 'reply-held ends the apply');
  t.drain.heldReply({ consoleMaintenance: safeLease() });
  assert.deepEqual([t.drain.lease().id, parks], ['L', ['W']], 'the held transition parks once');
  t.state.held = false;
  assert.equal(t.drain.heldReply({}), false, 'a running character goes on to the next rows');
  t.drain.leaseReply({ consoleMaintenance: safeLease({ id: 'N' }) });
  assert.equal(t.drain.lease().id, 'N');
  assert.equal(t.drain.park(), true, 'a drained character with no fight parks');
  assert.equal(t.drain.holds(), true, 'the drain holds the turns with no drain fight in sight');
  assert.equal(t.drain.maintenanceReply(), true);
  assert.deepEqual(parks, ['W', 'W']);
  t.state.fight = true;
  assert.deepEqual([t.drain.park(), t.drain.holds(), t.drain.maintenanceReply()], [false, false, false], 'a drain fight in sight runs the fight');
  t.drain.leaseReply({ consoleMaintenance: null });
  assert.equal(t.drain.maintenanceReply(), false, 'no lease applies the reply');
});

test('table A maintenance row: a ready answer that holds keeps the walk; the park comes once it clears', () => {
  const t = drainFixture({ character: { moving: true } });
  const parks = [];
  let holding = true;
  t.hooks.publish({ name: 'core:movement', folder: 'core', author: 'test', summary: 'park', hooks: { 'movement.park': name => { parks.push(name); } } });
  t.hooks.publish({ name: 'core:merchant-jobs', folder: 'core', author: 'test', summary: 'a job runs',
    hooks: { 'lifecycle.ready': () => holding ? { ready: false, reason: 'job' } : { ready: true } } });
  t.drain.receive(safeLease());
  assert.equal(t.drain.maintenanceReply(), true, 'the drain holds the reply');
  assert.deepEqual([t.drain.park(), parks], [false, []], 'the held work keeps its walk');
  holding = false;
  t.drain.maintenanceReply();
  assert.deepEqual([t.drain.park(), parks], [true, ['W']], 'the cleared hold parks the walk');
});

test('Load in Main: a fighter off main walks there once and saves its spot; the cleared lease walks it back', async () => {
  const t = drainFixture({ character: { map: 'cave', x: 5, y: 6 } });
  const main = safeLease({ id: 'M', loadMode: 'main', phase: 'moving-main' });
  t.drain.receive(main);
  assert.equal(t.drain.park(), false, 'a Main load leaves a fighter away from main free');
  assert.equal(t.drain.maintenanceReply(), true);
  t.drain.maintenanceReply();
  assert.deepEqual(t.moves, [['lifecycle:main', 'main']], 'one Main walk while it runs');
  assert.deepEqual(JSON.parse(t.store.get('party-console-return:W')), { map: 'cave', x: 5, y: 6 });
  await new Promise(resolve => setImmediate(resolve));
  t.drain.receive(null);
  assert.equal(t.drain.maintenanceReply(), true, 'the checkpoint return holds the reply');
  assert.deepEqual(t.moves[1], ['lifecycle:checkpoint', { map: 'cave', x: 5, y: 6 }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(t.store.has('party-console-return:W'), false, 'the arrival clears the checkpoint');
});

test('atomic: a native transaction counts as open while it runs; the busy reason names its owner; a reload waits on owners, not the fight', async () => {
  const t = drainFixture({ attackers: 2 });
  let open;
  await t.drain.atomic(async () => { open = t.frame.__partyConsoleAtomic; });
  assert.deepEqual([open, t.frame.__partyConsoleAtomic], [1, 0]);
  t.drain.receive(safeLease());
  assert.equal(t.drain.canReload(), true, 'the attackers term is the fight, which a reload leaves out');
  t.hooks.publish({ name: 'core:items-bag', folder: 'core', author: 'test', summary: 'the bag holder', hooks: { 'lifecycle.ready': () => ({ ready: false, reason: 'the bag is sorting' }) } });
  assert.equal(t.drain.canReload(), false);
  assert.equal(t.drain.busyReason(), 'the bag is sorting (core:items-bag)');
});

// The handle's waits and requests: an act sleep or bound due while held waits for release;
// dispose ends every request the generation started.
test('K-B1: an act sleep and an act withTimeout due while held resume at release; once fires once', async () => {
  const { f, run, state } = setup();
  run.replied();
  const act = run.scope('02', 'act'), order = [], socket = new Socket();
  act.once(socket, 'hit', data => order.push('hit:' + data));
  socket.emit('hit', 1); socket.emit('hit', 2);
  state.hold = 'user'; run.update();
  const slept = act.sleep(10).then(() => order.push('slept'));
  const bounded = act.withTimeout(new Promise(() => {}), 20, 'walk').catch(error => order.push(error.message));
  f.advance(100);
  await Promise.resolve();
  assert.deepEqual(order, ['hit:1'], 'a held sleep or bound fired');
  state.hold = null; run.update();
  await Promise.all([slept, bounded]);
  assert.deepEqual(order, ['hit:1', 'slept', 'walk timed out after 0 seconds']);
  assert.equal(run.held(), false);
});

test('dispose: a pending fetch aborts and a pending ajax request is aborted', async () => {
  const { f, run } = setup();
  const aborted = [];
  f.fetch = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => { aborted.push('fetch'); reject(init.signal.reason); }));
  f.$ = { ajax: () => ({ always() {}, abort: () => aborted.push('ajax') }) };
  const handle = run.scope('12', 'observe');
  const fetching = handle.fetch('/status', {}).catch(() => {});
  handle.ajax({ url: '/status' });
  run.dispose();
  await fetching;
  assert.deepEqual(aborted.sort(), ['ajax', 'fetch']);
  assert.equal(run.retired.aborted, true, 'the generation reads retired');
});


// A game window whose draw frames the row runs by hand. Outside a frame `draw_trigger` queues its
// callback for the next frame, inside one it runs it at once (functions.js `draw_trigger`); `draw`
// is one frame, which counts itself in `draws` (game.js `draw`) and then ends its task.
function drawing(game) {
  const queued = [];
  game.draws = 0;
  game.draw_trigger = callback => { if (game.in_draw) callback(); else queued.push(callback); };
  return async () => {
    game.in_draw = true; game.draws++;
    for (const callback of queued.splice(0)) callback();
    game.in_draw = false;
    await new Promise(resolve => setImmediate(resolve));
  };
}

// The cadence: a decision follows the game's state update, so a burst of world packets inside one
// update runs one decision, after the update lands; a listener that takes the packet records each
// one at once. Isolated: a live run cannot time packets inside one draw.
test('cadence: a packet burst runs one decision per game update, after it lands, and a packet reader runs on each', async () => {
  const { game, run } = setup();
  run.replied();
  const draw = drawing(game), socket = new Socket(), act = run.scope('03', 'act'), decided = [], read = [];
  const decide = () => decided.push(game.draws);
  for (const event of ['player', 'entities', 'action', 'hit']) act.on(socket, event, decide);
  act.on(socket, 'player', data => read.push(data.cc));
  for (let i = 1; i <= 6; i++) socket.emit(['player', 'entities', 'action'][i % 3], { cc: i });
  assert.deepEqual(decided, [], 'a decision ran before the update landed');
  assert.deepEqual(read, [3, 6], 'the packet reader missed a packet');
  await draw();
  assert.deepEqual(decided, [1], 'the burst ran more or fewer than one decision');
  // A timer's wake for the same decision joins the next update's one pass.
  socket.emit('hit', {}); act.afterUpdate(decide);
  await draw();
  assert.deepEqual(decided, [1, 2]);
  await draw();
  assert.deepEqual(decided, [1, 2], 'an update with nothing new ran a decision');
  // A disposed run drops the decision still waiting.
  act.afterUpdate(decide); run.dispose();
  await draw();
  assert.deepEqual(decided, [1, 2], 'a disposed run decided');
});

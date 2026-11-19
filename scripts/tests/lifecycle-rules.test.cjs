// Lifecycle's rule tables: one row per question, participant case, admission case and worker
// transition. Written in the lifecycle owner's build, part 2; the end run runs them. Each row names
// its failure mode.
const test = require('node:test');
const assert = require('node:assert/strict');
const { allows, waiting, participates, deployRefusal, shutdownHold, TABLE_W } = require('../../runtime/lifecycle/rules.ts');
const { createLease } = require('../../runtime/lifecycle/coordinator/lease.ts');

const NOW = 1_000_000;
const lease = (fields = {}) => ({ id: 'L', expires: NOW + 10_000, mode: 'draining', loadMode: 'safe', phase: 'draining', ...fields });

test('LF8 table D: each coordinator question is refused under the Pause and under its lease rows', () => {
  for (const question of ['merchant', 'recovery', 'pulls'])
    assert.equal(allows(question, { paused: true, lease: null }), false, question + ' acts under the Pause');
  assert.equal(allows('merchant', { paused: false, lease: null }), true);
  assert.equal(allows('merchant', { paused: false, lease: lease() }), false, 'the merchant acts under a safe lease');
  assert.equal(allows('merchant', { paused: false, lease: lease({ loadMode: 'main', phase: 'moving-main' }) }), true, 'a Main lease holds the merchant before holding');
  assert.equal(allows('merchant', { paused: false, lease: lease({ loadMode: 'main', phase: 'holding' }) }), false);
  assert.equal(allows('recovery', { paused: false, lease: lease() }), false);
  assert.equal(allows('pulls', { paused: false, lease: null, pullBlock: true }), false, "07's pull block holds the pulls");
  assert.equal(allows('reply', { paused: true, lease: null }), true, 'the Pause rides no lease, so the reply carries everything');
  assert.equal(allows('reply', { paused: false, lease: lease({ mode: undefined }) }), false, 'a lease that does not drain carries only itself');
});

test('table R: a participant waits until its fresh acknowledgement of this lease reads ready', () => {
  const ack = (fields = {}) => ({ seenAt: NOW, ctype: 'warrior', map: 'main', consoleMaintenance: { id: 'L', mode: 'draining', combat: false, ready: true, ...fields } });
  assert.equal(waiting(ack(), lease(), NOW), false);
  assert.equal(waiting({ ...ack(), seenAt: NOW - 60_000 }, lease(), NOW), true, 'R1: a stale report');
  assert.equal(waiting(ack({ id: 'other' }), lease(), NOW), true, 'R2: another lease');
  assert.equal(waiting(ack({ ready: false }), lease(), NOW), true, 'R2: not ready');
  assert.equal(waiting(ack({ combat: true }), lease(), NOW), true, 'R3: a drain fight');
  assert.equal(waiting({ ...ack(), map: 'bank' }, lease({ loadMode: 'main' }), NOW), true, 'R4: a fighter off main');
  assert.equal(waiting({ ...ack(), ctype: 'merchant', consoleMaintenance: null }, lease({ loadMode: 'main', phase: 'moving-main' }), NOW), false, 'R5: the merchant works on');
  assert.equal(participates({ seenAt: NOW - 1_000 }, NOW), true);
  assert.equal(participates({ seenAt: NOW - 60_000 }, NOW), false);
});

test('table W stop row: a stopped worker the roster no longer assigns leaves the participants until it reports again', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-lease-'));
  fs.mkdirSync(path.join(directory, 'updates'));
  fs.writeFileSync(path.join(directory, 'updates/pause.json'), JSON.stringify(lease()));
  let now = NOW;
  const book = createLease(directory, { now: () => now, paused: () => false, log: () => {}, notify: () => {} });
  // The book closes its folder watch before the folder goes, as the coordinator's shutdown does. On
  // Windows a watch left on a removed folder keeps the process from exiting.
  t.after(() => { book.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const statuses = { W: { seenAt: now }, P: { seenAt: now } };
  assert.deepEqual(book.status(statuses, ['W', 'P']).participants.sort(), ['P', 'W']);
  now += 1_000;
  book.leave('W');
  assert.deepEqual(book.status(statuses, ['P']).participants, ['P'], 'a stopped worker handed off its slot is still counted');
  // Slot handoff: an assigned stopped worker is skipped.
  assert.deepEqual(book.status(statuses, ['W', 'P']).waiting.sort(), ['P', 'W'], 'a stopped worker its slot still names is not waited on');
  now += 1_000;
  statuses.W = { seenAt: now };
  assert.deepEqual(book.status(statuses, ['P']).participants.sort(), ['P', 'W'], 'a restarted worker is not counted again');
});

// A listener that reads the lease again from inside a drain notice, as an add-on's
// `lifecycle.state` read does, gets each notice once.
test('the drain notices go out once when a listener reads the lease inside them', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-lease-'));
  fs.mkdirSync(path.join(directory, 'updates'));
  const heard = [];
  let book, depth = 0;
  book = createLease(directory, { now: () => NOW, paused: () => false, log: () => {}, notify: (hook, payload) => {
    heard.push([hook, payload.lease]);
    if (++depth > 5) throw Error('a notice sent from inside its own notice');
    try { book.current(); } finally { depth--; }
  } });
  t.after(() => { book.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(directory, 'updates/pause.json'), JSON.stringify(lease()));
  book.current();
  fs.rmSync(path.join(directory, 'updates/pause.json'));
  book.close();
  book.current();
  assert.deepEqual(heard, [['lifecycle.drainStarted', 'L'], ['lifecycle.drainEnded', 'L']]);
});

// The live BankBoi handoff row: the switch logs the merchant out seconds before the lease, so its
// last report is still fresh when the lease starts.
test('table W stop row: a worker stopped just before the lease is not waited on', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-lease-'));
  fs.mkdirSync(path.join(directory, 'updates'));
  let now = NOW;
  const book = createLease(directory, { now: () => now, paused: () => false, log: () => {}, notify: () => {} });
  t.after(() => { book.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const statuses = { M: { seenAt: now }, B: { seenAt: now } };
  book.leave('M');
  now += 1_000;
  fs.writeFileSync(path.join(directory, 'updates/pause.json'), JSON.stringify(lease()));
  const status = book.status(statuses, ['B']);
  assert.deepEqual(status.participants, ['B']);
  assert.equal(status.waiting.includes('M'), false);
});

test('and N5 table S: a safe or Main deploy waits out a Cave run, a shutdown waits out a Cave or an event', () => {
  const member = (task, map) => ({ name: 'W', task, map });
  assert.equal(deployRefusal('now', [member({ kind: 'cave', owner: 'cave' })]), null, 'Load now is never refused');
  assert.match(deployRefusal('safe', [member({ kind: 'cave', owner: 'cave' })]), /Cave/);
  assert.match(deployRefusal('main', [member(null, 'zone_0a1b_2')]), /Cave/, 'a member on a Cave map with no task yet refuses (N5)');
  assert.equal(deployRefusal('safe', [member({ kind: 'farm', owner: 'farm' }, 'main')]), null);
  assert.match(shutdownHold([member({ kind: 'event-attendance', owner: 'event:goobrawl' })]), /goobrawl/);
  assert.equal(shutdownHold([member({ kind: 'farm', owner: 'farm' })]), null);
});

test('and table W: each worker transition keeps its outcome', () => {
  assert.equal(TABLE_W.start({ realm: false, character: true }), 'realm-error');
  assert.equal(TABLE_W.start({ realm: true, character: false }), 'disable');
  assert.equal(TABLE_W.start({ realm: true, character: true }), 'start');
  assert.equal(TABLE_W.stop({ connected: false, boundaryOpen: true }), 'kill');
  assert.equal(TABLE_W.stop({ connected: true, boundaryOpen: true }), 'close-held', 'A67: a trade in flight keeps its process');
  assert.equal(TABLE_W.stop({ connected: true, boundaryOpen: false }), 'close');
  assert.equal(TABLE_W.exit({ current: false, updating: false, enabled: true }), 'ignore', "a retired worker's exit changes nothing");
  assert.equal(TABLE_W.exit({ current: true, updating: true, enabled: true }), 'update', 'a client update restarts its own worker');
  assert.equal(TABLE_W.exit({ current: true, updating: false, enabled: true }), 'restart');
  assert.equal(TABLE_W.exit({ current: true, updating: false, enabled: false }), 'offline');
  assert.equal(TABLE_W.realm({ enabled: true, running: false, resolves: false }), 'wait', 'a realm error waits for the account');
  assert.equal(TABLE_W.realm({ enabled: true, running: false, resolves: true }), 'start');
  assert.equal(TABLE_W.realm({ enabled: false, running: false, resolves: true }), 'drop');
  assert.equal(TABLE_W.update({ enabled: true, pinned: true }), false, 'a pinned client version is not updated');
  assert.equal(TABLE_W.reload({ status: 'busy' }), 'retry');
  assert.equal(TABLE_W.reload({ status: 'failed', restartRequired: true }), 'restart');
  assert.equal(TABLE_W.reload({ status: 'failed' }), 'keep');
  assert.equal(TABLE_W.reload({ status: 'ready' }), 'activated');
});

// The copy check holds only on a tree with the lifecycle owner's rules file, so each tree
// carries it.
test('the Dockerfile.node-version and dashboard/package.json name package.json engines.node', async () => {
  const { copyFindings } = await import('../../tools/copy-check.mjs');
  const sources = (docker, pinned, dashboard) => new Map([['runtime/lifecycle/rules.ts', ''],
    ['package.json', JSON.stringify({ engines: { node: '>=26.12.1' } })], ['Dockerfile', docker], ['.node-version', pinned],
    ['dashboard/package.json', JSON.stringify({ engines: { node: dashboard } })]]);
  const floor = tree => copyFindings(tree).filter(line => /R13-2/.test(line));
  assert.deepEqual(floor(sources('FROM node:26.12.1-bookworm-slim AS build\n', '26.12.1\n', '>=26.12.1')), []);
  assert.equal(floor(sources('FROM --platform=$BUILDPLATFORM node:24.14.0-bookworm-slim AS build\n', '24.14.0\n', '>=26.12.1')).length, 2);
  assert.deepEqual(floor(sources('FROM node:26.12.1-bookworm-slim AS build\n', '26.12.1\n', '>=24.14.0')).map(line => line.split(':')[0]), ['dashboard/package.json']);
});

// The command intake (character/intake.ts, table I): one fixture with every owner's door as a port.
// `deliver` hands a command over as a status reply does (`reply`) and resolves when the intake releases it,
// which every path through `receive` does.
function intakeFixture(facts = {}) {
  const log = [], frame = { __partyLastCommand: 4 }, game = { window: { location: { href: '' } } };
  let released = () => {};
  const state = { held: false, lease: null, hand: null, merchant: false, cave: false, escape: null, defers: null, fail: null, ...facts };
  const { createIntake } = require('../../runtime/lifecycle/character/intake.ts');
  const { TABLE_I } = require('../../runtime/lifecycle/rules.ts');
  const intake = createIntake({ frame, merchant: () => state.merchant, held: () => state.held, lease: () => state.lease,
    hand: () => state.hand, pinning: () => null, band: run => run(), previewing: () => false, prepare: async () => true,
    caveOwns: () => state.cave, escape: () => state.escape, eventDefers: () => state.defers, eventAccepted: () => log.push('event'),
    reunion: async () => {}, walk: async (command, defensive, run) => { log.push('walk:' + defensive); return run(); },
    takeover: async () => log.push('takeover'),
    jobs: { admit: () => true, accept: async () => true, report: (command, outcome, reason) => log.push(outcome + (reason ? ':' + reason : '')),
      release: id => { log.push('release:' + id); released(); }, job: (command, label, run) => { log.push('job:' + label); return run(); },
      afterCombat: (run, label) => { log.push('combat:' + label); return run(); } },
    accepts: {}, doors: Object.fromEntries(Object.keys(TABLE_I).map(key => [key, async () => { log.push('door:' + key); if (state.fail) throw state.fail; }])),
    game, log: message => log.push('log:' + message) });
  const deliver = command => new Promise(resolve => { released = resolve; intake.reply({ command }); });
  return { intake, deliver, log, frame, state, game };
}

test('table I: a command runs only on the running row with no lease; Manual hands items to the merchant', async () => {
  const { intakeAdmits, commandKey } = require('../../runtime/lifecycle/rules.ts');
  assert.equal(intakeAdmits({ held: true, lease: false, hand: null, type: 'travel' }), false, 'P1 and P2 hold every command');
  assert.equal(intakeAdmits({ held: false, lease: true, hand: null, type: 'travel' }), false, 'a deploy lease holds every command');
  assert.equal(intakeAdmits({ held: false, lease: false, hand: 'manual', type: 'travel' }), false);
  assert.equal(intakeAdmits({ held: false, lease: false, hand: 'manual', type: 'merchant-handoff' }), true, 'TK3');
  assert.equal(intakeAdmits({ held: false, lease: false, hand: null, type: 'travel' }), true);
  assert.equal(commandKey({ type: 'party-monster-travel', phase: 'defending' }), 'party-monster-travel:defending');
  assert.equal(commandKey({ type: 'party-monster-travel', phase: 'assemble' }), 'party-monster-travel');
});

test('the intake: owners defer or drop before the id is spent; a failed retry row hands its id back', async () => {
  let t = intakeFixture({ escape: { admits: 'escape-walk' } });
  await t.deliver({ id: 5, type: 'town-party' });
  assert.deepEqual(t.log, ['deferred:escape', 'release:5'], "05's escape defers a command it does not admit");
  assert.equal(t.intake.last(), 4);
  t = intakeFixture({ escape: {} });
  await t.deliver({ id: 5, type: 'town-party' });
  assert.deepEqual(t.log, ['deferred:escape', 'release:5'], 'an escape that admits no purpose defers a command with none');
  t = intakeFixture();
  await t.deliver({ id: 4, type: 'town-party' });
  assert.deepEqual(t.log, ['release:4'], 'a spent id runs nothing');
  t = intakeFixture({ held: true });
  await t.deliver({ id: 5, type: 'give' });
  assert.equal(t.intake.last(), 4, 'a held character leaves the id for the reply after Play');
  t = intakeFixture();
  await t.deliver({ id: 5, type: 'travel', location: { map: 'main' } });
  assert.deepEqual(t.log, ['walk:true', 'accepted', 'event', 'takeover', 'door:travel', 'release:5']);
  assert.equal(t.frame.__partyLastCommand, 5, 'the frame keeps the spent id across a hot reload');
  t = intakeFixture({ merchant: true });
  await t.deliver({ id: 5, type: 'merchant-bank-unlock' });
  assert.deepEqual(t.log.slice(-4, -1), ['job:bank unlock', 'combat:unlocking bank storage', 'door:merchant-bank-unlock']);
  t = intakeFixture();
  await t.deliver({ id: 5, type: 'merchant-bank-unlock' });
  assert.ok(!t.log.includes('door:merchant-bank-unlock'), 'a merchant row runs nothing on a fighter');
  t = intakeFixture({ fail: new Error('channel cut') });
  await t.deliver({ id: 5, type: 'town-party' });
  assert.equal(t.intake.last(), 4, 'a failed Town hands its id back');
  assert.ok(t.log.includes('log:Party command failed: channel cut'));
  t = intakeFixture({ fail: new Error('gone') });
  await t.deliver({ id: 5, type: 'give' });
  assert.equal(t.intake.last(), 5, 'a failed give keeps its id spent');
  t.intake.rollback(5);
  assert.equal(t.intake.last(), 4, 'a walk the runtime stopped hands its id to the next generation');
});

test("the reply row: the reply holds its command for the requesters; the lifecycle owner's Steam switch loads the named character", async () => {
  const t = intakeFixture();
  assert.equal(t.intake.seen(), false);
  await t.deliver({ id: 5, type: 'native-switch', character: 'Ann E' });
  assert.deepEqual(t.intake.command(), { id: 5, type: 'native-switch', character: 'Ann E' });
  assert.equal(t.intake.seen(), true);
  assert.equal(t.game.window.location.href, '/character/Ann%20E/in/US/II/', 'the switch keeps the realm the client plays');
  t.intake.reply({});
  assert.equal(t.intake.command(), null, 'a reply with no command clears the held one');
  const headless = intakeFixture();
  headless.game.caracAL = {};
  await headless.deliver({ id: 5, type: 'native-switch', character: 'Ann' });
  assert.ok(headless.log.includes('log:Party command failed: Steam switching requires the native game client'));
});

// One row per source. The rows share one setup, each reader's source file, so they are one
// table: a hidden pick is read from its declaration in fields.ts, and a progress rule waits on the
// event the design names, with the timer it replaced gone. The prepared shutdown's wait, the one
// rule with arithmetic, gets its own behaviour row below.
test('each wait reads its declaration and each progress rule waits on its event', () => {
  const fs = require('node:fs'), path = require('node:path');
  const read = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
  const fields = require('../../runtime/lifecycle/fields.ts').lifecycleSavedFields.settings;
  // [the value, its reader, what the reader must contain, what it must no longer contain]
  const rows = [
    ['1000 ms report period', 'runtime/lifecycle/character/run.ts', /CHARACTER_PICKS\.lifecycleReportMs/],
    ['250 ms Pause file cache and 60 s fake expiry', 'runtime/lifecycle/coordinator/control.ts', /let saved = directory \? readPause\(directory\) : null/, /\b(250|60_?000)\b/],
    ['20 and 8 log caps', 'runtime/lifecycle/coordinator/control.ts', /MOVEMENT_RING_SIZE/, /length > (20|8)\b/],
    ['180 s resume wait', 'runtime/coordinator/application.ts', /field: 'consoleResumeWaitMs'/],
    ['5 s prepared worker wait', 'runtime/lifecycle/coordinator/start.ts', /hiddenValue\('hostExitGraceMs'\), closing = ports\.flushMs/, /PREPARED_STOP_MS|\b5_?000\b/],
    ['15 s host forced exit', 'tools/hosting/services.ts', /hostExitGraceMs\.default/],
    ['500 ms worker close grace', 'runtime/lifecycle/coordinator/workers.ts', /await Promise\.race\(\[clock\.sleep\(fields\.workerCloseGraceMs\.default\)/],
    ['1.5 s restart after exit', 'runtime/lifecycle/coordinator/workers.ts', /fields\.workerRestartMs\.default/, /\b1_?500\b/],
    ['3 s realm error retry', 'runtime/lifecycle/coordinator/workers.ts', /ports\.refreshAccount\(\)\.then\(retryRealms/, /\b3_?000\b/],
    ['4 s restore after start', 'runtime/lifecycle/coordinator/start.ts', /hiddenValue\('slotRestoreDelayMs'\)/, /\b4_?000\b/],
    ['300 ms script save settle', 'runtime/lifecycle/coordinator/code.ts', /fields\.codeSaveSettleMs\.default/],
    ['150 ms manifest debounce', 'runtime/lifecycle/coordinator/code.ts', /clock\.later\(\(\) => \{ queued = false;/, /\b150\b/],
    ['2 s busy reload retry', 'runtime/lifecycle/coordinator/code.ts', /function reported\(name: string, report: \{ busy\?: unknown \}\)/, /\b2_?000\b/],
    ['15 s reload reply', 'runtime/lifecycle/coordinator/code.ts', /fields\.reloadReplyMs\.default/],
    ['1 s activation poll', 'runtime/lifecycle/coordinator/code.ts', /watchFolder\(directory/, /setInterval/],
    ['60 s client update wait, 250 ms poll', 'runtime/lifecycle/coordinator/workers.ts', /fields\.clientUpdateWaitMs\.default/, /\b250\b/],
    ['2 s loader poll', 'runtime/lifecycle/character/loader.ts', /picks\.loaderPollMs/],
    ['10 s missing record recheck', 'runtime/lifecycle/character/loader.ts', /picks\.loaderRecordRecheckMs/],
    ['6 s fetch timeout', 'runtime/lifecycle/character/loader.ts', /picks\[name\][\s\S]*loaderBound\('loaderFetchMs'/],
    ['3 s deployment reply timeout', 'runtime/lifecycle/character/loader.ts', /loaderBound\('loaderLeaseFetchMs'/],
    ['100 ms boundary poll', 'runtime/lifecycle/character/drain.ts', /async function boundary\(\)/, /\b100\b/],
    ['10 s lease life, 3 s clear, 500 ms poll', 'tools/console-build/safe-reload.ts', /fields\.leaseLifeMs\.default[\s\S]*fields\.leaseClearMs\.default[\s\S]*fields\.leasePollMs\.default/],
    ['120 s activation', 'tools/console-build/controller.ts', /activationMs\.default/],
    ['30 s release wait and 200 ms waits', 'tools/console-build/hosting.ts', /releaseWaitMs\.default[\s\S]*hostPollMs\.default/],
    ['120 health tries 1 s apart', 'tools/update/transaction.ts', /fields\.updateHealthMs\.default[\s\S]*fields\.hostPollMs\.default/],
    ['3 s to 60 s dashboard respawn', 'tools/console-build/dashboard.ts', /dashboardRespawnMaxMs\.default, dashboardRespawnMs\.default/],
    ['20 s stale Steam runner', 'runtime/lifecycle/roster/recovery.ts', /steamRunnerStaleMs\.default/, /\b20_?000\b/],
    ['32 verified class cache entries', 'runtime/lifecycle/coordinator/code.ts', /classes \* \(RETAIN_BUILDS \+ 2\)/, /\b32\b/],
    ['20 retained candidates', 'tools/build-store.ts', /retainedCandidates\.default/],
    ['6 h update check', 'tools/update/hosting.ts', /hiddenValue\('updateCheckMs'\)/],
    ['10 min and 5 guesses for access codes', 'tools/hosting/access.ts', /accessCodeMs\.default[\s\S]*accessCodeAttempts\.default/],
    ['1 s builder poll and settle', 'tools/console-build/watch.ts', /builderPollMs\.default/],
    ['250 ms game watch', 'tools/game/watch.mts', /gameWatchMs\.default/],
    ['30 s saved inspection reuse', 'runtime/lifecycle/coordinator/inspection.ts', /hiddenValue\('inspectionReuseMs'\)/],
    ['90 s Steam handoff phase', 'runtime/lifecycle/roster/handoff.ts', /steamHandoffExpiryMs\.default/],
    ['Steam bridge request and slot check bounds', 'runtime/lifecycle/roster/bridge.ts', /bridgeBound\('steamBridgeRequestMs'[\s\S]*bridgeBound\('steamSlotCheckMs'/],
    ['Steam roster refresh and restore waits', 'runtime/lifecycle/roster/bridge.ts', /steamRosterRefreshMs\.default[\s\S]*steamRestoreMs\.default[\s\S]*steamBridgePollMs\.default/],
    ['Steam handoff bound', 'runtime/lifecycle/roster/steam-group.ts', /steamHandoffBoundMs/],
    ['Steam connection delayed label', 'runtime/lifecycle/roster/connection-status.ts', /steamConnectionDelayedMs/],
    ['Steam handoff check', 'runtime/lifecycle/roster/routes.ts', /steamHandoffCheckMs/],
    ['Steam audio refresh', 'runtime/lifecycle/roster/switcher.ts', /steamAudioRefreshMs/],
    ['client download and data check bounds', 'runtime/lifecycle/coordinator/client-files.cjs', /fields\.clientDownloadMs\.default[\s\S]*fields\.clientDataCheckMs\.default/],
  ];
  for (const [value, file, reads, gone] of rows) {
    const text = read(file);
    assert.match(text, reads, value + ': ' + file + ' reads its source');
    if (gone) assert.doesNotMatch(text.replace(/\/\/.*$/gm, ''), gone, value + ': the replaced value is gone from ' + file);
  }
  for (const [name, field] of Object.entries(fields)) if (field.hidden) assert.ok(rows.some(([, file]) => read(file).includes(name)), name + ' has a reader');
});

// No screen shows the lifecycle owner's character picks, so fields.ts names them and no saved setting
// stands for one; the worker's idle socket bound is the coordinator server's own keep-alive, which
// Node's agent lowers by its buffer from the server's Keep-Alive header.
test('the lifecycle character picks are named picks and the worker agent follows the server keep-alive', async () => {
  const { CHARACTER_PICKS, lifecycleSavedFields } = require('../../runtime/lifecycle/fields.ts'), fields = lifecycleSavedFields.settings;
  assert.deepEqual(CHARACTER_PICKS, { lifecycleReportMs: 1000, loaderPollMs: 2000, loaderRecordRecheckMs: 10000, loaderFetchMs: 6000, loaderLeaseFetchMs: 3000 });
  for (const name of [...Object.keys(CHARACTER_PICKS), 'hostSocketIdleMs']) assert.equal(fields[name], undefined, name + ' is no saved setting');
  const http = require('node:http');
  const server = http.createServer((_req, res) => res.end('ok'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const agent = new http.Agent({ keepAlive: true, timeout: new http.Server().keepAliveTimeout });
  try {
    await new Promise(resolve => http.get({ host: '127.0.0.1', port: server.address().port, agent }, res => { res.resume(); res.on('end', resolve); }));
    await new Promise(resolve => setImmediate(resolve));
    const [socket] = Object.values(agent.freeSockets).flat();
    assert.equal(socket.timeout, server.keepAliveTimeout - agent.agentKeepAliveTimeoutBuffer);
  } finally { agent.destroy(); server.close(); }
});

test('the prepared shutdown waits for the workers until storage must close before the forced exit', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { createShutdown } = require('../../runtime/lifecycle/coordinator/start.ts');
  const grace = require('../../runtime/lifecycle/fields.ts').lifecycleSavedFields.settings.hostExitGraceMs.default;
  const order = [];
  const shutdown = createShutdown({ log: () => {}, stopCharacters: () => new Promise(() => {}), stopRun: () => order.push('stop run'),
    closeStorage: () => order.push('close'), timers: { setTimeout, clearTimeout },
    exit: () => order.push('exit'), prepared: () => true, flushMs: () => grace - 1_000 });
  const done = shutdown('SIGTERM');
  t.mock.timers.tick(999);
  await Promise.resolve();
  assert.deepEqual(order, [], 'storage stays open while a worker may still finish');
  t.mock.timers.tick(1);
  await done;
  assert.deepEqual(order, ['stop run', 'close', 'exit'], 'the wait is the forced exit less the measured flush (N7)');
});

// The BankBoi plan reads table D's `merchant` row, so an update's lease or the Pause holds the swap
// before it starts. The port is application.ts's wiring, the row itself.
test("table D: the BankBoi plan starts no transaction while the merchant row holds", async () => {
  const { createBankboiStorage } = require('../../runtime/items/coordinator/storage.ts');
  for (const facts of [{ paused: false, lease: lease() }, { paused: true, lease: null }]) {
    const state = { bankboiTransaction: null, headlessSlots: ['M'], merchantCharacter: 'M', commands: {}, bankbois: {}, statuses: {}, withdrawals: {} };
    const acted = [];
    const storage = createBankboiStorage(state, { M: { enabled: true } }, { now: () => NOW, stop: async () => acted.push('stop'),
      persistRoster: () => acted.push('roster'), persistBank: () => acted.push('bank'), collect: () => acted.push('collect'),
      log: message => acted.push('log:' + message), merchantHeld: () => !allows('merchant', facts) });
    await storage.start();
    assert.equal(state.bankboiTransaction, null, JSON.stringify(facts));
    assert.deepEqual(acted, [], 'nothing stops, saves or collects while held');
  }
});

// README "Bug fixes that become tests" row 13 dependency cache (fork): the candidate build reuses
// the image's installed tree when npm's hidden lock names the same packages.
test("the dependency cache reuses an installed tree whose packages match the lock by identity", () => {
  const { installedMatchesLock } = require('../../tools/console-build/builder.ts');
  const esbuild = { version: '0.27.3', resolved: 'r', integrity: 'i' }, peer = { ...esbuild, peer: true };
  const lock = { packages: { '': { name: 'x' }, 'node_modules/esbuild': peer,
    'node_modules/@esbuild/darwin-arm64': { ...esbuild, optional: true }, 'node_modules/@esbuild/linux-x64': { ...esbuild, optional: true } } };
  const installed = { packages: { 'node_modules/esbuild': esbuild, 'node_modules/@esbuild/linux-x64': { ...esbuild, optional: true } } };
  assert.equal(installedMatchesLock(lock, installed), true, 'lock-only flags and absent other-platform packages match');
  assert.equal(installedMatchesLock(lock, { packages: { 'node_modules/@esbuild/linux-x64': esbuild } }), false, 'a missing required package fails');
  assert.equal(installedMatchesLock(lock, { packages: { ...installed.packages, 'node_modules/esbuild': { ...esbuild, integrity: 'j' } } }), false, 'other contents fail');
  assert.equal(installedMatchesLock(lock, undefined), false);
});

// The lead's row 13 watcher (fork): the builder's poll gives the same fingerprint as a full read,
// sees an edit, an added file and a removed one, and re-reads only the files whose stat stamp
// moved.
test("the builder's source poll matches a full read and follows each change", async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { sourceFingerprint, sourcePoll } = require('../../tools/console-build/builder.ts');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-poll-'));
  try {
    fs.mkdirSync(path.join(root, 'runtime'));
    const file = name => path.join(root, 'runtime', name);
    fs.writeFileSync(file('a.ts'), 'a'); fs.writeFileSync(file('b.ts'), 'b');
    const poll = sourcePoll(root);
    assert.equal(await poll(), await sourceFingerprint(root));
    const idle = await poll();
    fs.writeFileSync(file('a.ts'), 'a2');
    assert.notEqual(await poll(), idle, 'an edit');
    assert.equal(await poll(), await sourceFingerprint(root));
    fs.writeFileSync(file('c.ts'), 'c');
    assert.equal(await poll(), await sourceFingerprint(root), 'an added file');
    fs.rmSync(file('b.ts'));
    assert.equal(await poll(), await sourceFingerprint(root), 'a removed file');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// The create dialog and the storage character create read the lifecycle owner's one name rule, and the
// card's map label the lifecycle owner's Cave map rule. The dialog enables Create on the name's length
// alone, as v1.5.0's did, so an all-digit or object-key name reaches the storage create
// and its refusal shows.
test('the create dialog enables Create from 4 characters and shows the storage create refusal', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const React = require('../../dashboard/node_modules/react'), renderer = require('../../dashboard/node_modules/react-test-renderer');
  const ts = require('../../dashboard/node_modules/typescript');
  const lifecycle = require('../../runtime/lifecycle/api.ts');
  const { createCharacterCreationAnswers } = require('../../runtime/items/coordinator/storage.ts');
  const code = ts.transpileModule(fs.readFileSync('dashboard/features/party/create-character.tsx', 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const part = tag => ({ children, ...props }) => React.createElement(tag, props, children);
  const ui = new Proxy({}, { get: (_, key) => key === 'Button' ? part('button') : key === 'Input' ? part('input') : part('div') });
  const context = { exports: {}, require(name) {
    if (name === 'react/jsx-runtime') return require('../../dashboard/node_modules/react/jsx-runtime');
    if (name.endsWith('lifecycle/api.ts')) return lifecycle;
    return ui;
  } };
  vm.runInNewContext(code, context); global.IS_REACT_ACT_ENVIRONMENT = true;
  const answers = createCharacterCreationAnswers({ headlessSlots: [] }, { classes: ['ranger'], owned: () => false });
  const typed = text => lifecycle.nameCharacters(text).slice(0, lifecycle.CHARACTER_NAME_MAX);
  assert.equal(typed('New Ranger!'), 'NewRanger');
  assert.equal(typed('abcdefghijklmnop'), 'abcdefghijkl');
  const onCreate = () => {};
  for (const [name, enabled, refused] of [['abc', false, true], ['NewRanger', true, false], ['1234', true, true], ['constructor', true, true]]) {
    let error = null;
    if (enabled && refused) error = (await answers.roster({ name, class: 'ranger' })).body.error;
    let root;
    await renderer.act(async () => { root = renderer.create(React.createElement(context.exports.CreateCharacter, {
      open: true, onOpenChange() {}, name, setName() {}, ctype: 'ranger', setCtype() {}, look: 0, setLook() {},
      appearances: [{}], classes: ['ranger'], busy: false, error, onCreate })); });
    const create = root.root.find(node => node.type === 'button' && node.props.onClick === onCreate);
    assert.equal(create.props.disabled, !enabled, name);
    if (enabled && refused) assert.equal(root.root.findByProps({ role: 'alert' }).children[0], lifecycle.CHARACTER_NAME_REFUSAL, name);
    await renderer.act(async () => root.unmount());
  }
  assert.equal(lifecycle.CHARACTER_NAME_REFUSAL, 'name must be 4-12 letters, numbers, or underscores, not only numbers');
  assert.equal(lifecycle.caveMap('zone_3fa9_2'), true);
  assert.equal(lifecycle.caveMap('main'), false);
});

// B205: the dependency lock waits while its owner's process lives and runs once the
// owner releases it. v1.5.0 gave up after 1,800 polls ("Dependency cache is busy")
// with the owner still working. Each poll's sleep runs at once here, and the owner is this process.
test('B205: the dependency lock outwaits 1,800 polls of a live owner and runs on its release', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { dependencyLocked } = require('../../tools/console-build/builder.ts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lock = path.join(dir, 'dependency-locks', 'cache');
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }));
  const sleep = globalThis.setTimeout;
  let polls = 0, outcome = 'waiting';
  globalThis.setTimeout = run => { polls++; return setImmediate(run); };
  try {
    dependencyLocked({ dependencies: path.join(dir, 'dependencies') }, 'cache', async () => 'ran')
      .then(value => { outcome = value; }, error => { outcome = error.message; });
    while (polls <= 1900 && outcome === 'waiting') await new Promise(resolve => setImmediate(resolve));
    assert.equal(outcome, 'waiting', 'a live owner holds the lock');
    fs.rmSync(lock, { recursive: true });
    while (outcome === 'waiting') await new Promise(resolve => setImmediate(resolve));
    assert.equal(outcome, 'ran');
  } finally { globalThis.setTimeout = sleep; }
});

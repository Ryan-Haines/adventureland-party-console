const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { settle, until } = require('./helpers/settle.cjs');
const { ConsoleBuildStore } = require('../../tools/console-build/store.ts');
const { ConsoleBuildController } = require('../../tools/console-build/controller.ts');
const { safeReload } = require('../../tools/console-build/safe-reload.ts');
const { createLease } = require('../../runtime/lifecycle/coordinator/lease.ts');
const { readJson } = require('../../tools/build-store.ts');
const { LEASE_FILE } = require('../../runtime/lifecycle/rules.ts');
const { lifecycleSavedFields } = require('../../runtime/lifecycle/fields.ts');

// The host's safe wait on lifecycle's default deploy fields: the drain poll (leasePollMs) and the safe
// window (leaseClearMs) are the declared defaults the driver runs on.
const { leaseClearMs, leasePollMs } = lifecycleSavedFields.settings;
const clearMs = leaseClearMs.default, pollMs = leasePollMs.default;

// The drain's timers through safeReload's `timers` port, on a mocked Date. The store's file writes
// keep the real setTimeout for their sharing retry (build-store.ts `whileShared`), which a mocked
// global setTimeout would stall while a reader holds the lease file. `advance` fires each due
// timer in order and lets its promise chain run.
function hostClock(t) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const due = [];
  const add = (fn, ms, every) => { const timer = { fn, at: Date.now() + ms, every, unref: () => timer }; due.push(timer); return timer; };
  const remove = timer => { const index = due.indexOf(timer); if (index >= 0) due.splice(index, 1); };
  const timers = { setTimeout: (fn, ms) => add(fn, ms), clearTimeout: remove, setInterval: (fn, ms) => add(fn, ms, ms), clearInterval: remove };
  async function advance(ms) {
    const end = Date.now() + ms;
    for (;;) {
      const next = due.sort((x, y) => x.at - y.at)[0];
      if (!next || next.at > end) break;
      t.mock.timers.tick(next.at - Date.now());
      if (next.every) next.at += next.every; else remove(next);
      next.fn(); await settle();
    }
    t.mock.timers.tick(end - Date.now()); await settle();
  }
  return { timers, advance };
}

test('safe reload requires fresh combat-free acknowledgements and preserves interrupted waits', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'safe-host-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { timers, advance } = hostClock(t);
  const store = new ConsoleBuildStore(root);
  const maintenance = createLease(root, { now: () => Date.now(), paused: () => false, log() {}, notify() {} });
  const ledger = [];
  let combat = true, stale = false, observed = 0, finish;
  const reload = safeReload(root, async () => {
    observed++;
    const lease = maintenance.current();
    return maintenance.status({ Fighter: { seenAt: Date.now() - (stale ? 10_000 : 0),
      consoleMaintenance: { id: lease?.id, mode: 'draining', combat, ready: !combat } } }, ['Fighter']);
  }, { timers });
  const driver = { ...reload,
    async activate(candidate) { ledger.push({ action: 'activate', target: candidate.manifest.id }); await new Promise(resolve => { finish = resolve; }); },
    async restore() { ledger.push({ action: 'restore' }); } };
  const controller = new ConsoleBuildController(store, driver);
  const holding = () => reload.lease?.phase === 'holding';
  async function stage(label) {
    const id = createHash('sha256').update(label).digest('hex'), directory = path.join(root, label);
    await mkdir(path.join(directory, 'app'), { recursive: true }); await writeFile(path.join(directory, 'app/artifact.txt'), label);
    const manifest = { schema: 1, id, sourceHash: id, createdAt: new Date().toISOString(), components: { dashboard: id, coordinator: id, characters: id }, files: { 'artifact.txt': id } };
    await store.complete(directory, manifest); return id;
  }
  const a = await stage('A'), b = await stage('B'); await store.setReferences({ active: a, latest: b });
  const cleanup = store.cleanup.bind(store);
  let finishCleanup, cleaned = false;
  store.cleanup = async () => { await new Promise(resolve => { finishCleanup = resolve; }); await cleanup(); cleaned = true; };
  try {
    const request = await controller.deploy(b, 'safe');
    await until(() => maintenance.current()?.id === request.id && observed > 0, 'the drain polls under the deploy lease');
    assert.equal((await store.journal())?.phase, 'waiting-safe');
    // In combat, then stale: neither acknowledgement is safe.
    await advance(2 * pollMs); assert.equal(holding(), false);
    combat = false; stale = true;
    await advance(2 * pollMs); assert.equal(holding(), false);
    // Fresh and clear, but combat returns one poll before the window ends, so the window starts over.
    stale = false;
    await advance(clearMs - pollMs); assert.equal(holding(), false);
    combat = true;
    await advance(pollMs); assert.equal(holding(), false);
    combat = false;
    const clearedAt = Date.now();
    await advance(clearMs - pollMs); assert.equal(holding(), false);
    // The window ends at the first poll at least clearMs after the clear acknowledgement.
    await advance(2 * pollMs);
    assert.equal(holding(), true);
    assert.ok(Date.now() - clearedAt >= clearMs, 'the activation waits the whole safe window');
    await until(() => ledger.length === 1, 'the candidate activates');
    assert.equal((await store.references()).active, a);
    assert.equal((await readJson(path.join(root, LEASE_FILE)))?.id, request.id);
    finish?.();
    await until(async () => (await store.journal())?.phase === 'complete', 'the deployment completes');
    await until(async () => (await readJson(path.join(root, LEASE_FILE))) === undefined, 'the host lease releases');
    assert.equal((await store.references()).active, b);
    await until(() => !!finishCleanup, 'cleanup starts');
    assert.equal((await store.journal())?.phase, 'complete');
    // Cleanup is still blocked, but the real host lease has already released.
    assert.equal(await readJson(path.join(root, LEASE_FILE)), undefined);
    finishCleanup?.();
    await until(() => cleaned, 'cleanup ends'); store.cleanup = cleanup;
    combat = true;
    const waiting = await controller.deploy(a, 'safe');
    await until(() => maintenance.current()?.id === waiting.id, 'the second deploy takes the lease');
    controller.stopWaiting();
    await until(async () => (await store.journal())?.phase === 'failed', 'the stopped wait fails');
    assert.equal(ledger.length, 1); assert.deepEqual(ledger[0], { action: 'activate', target: b });
    assert.equal((await store.references()).active, b);
    await until(async () => (await readJson(path.join(root, LEASE_FILE))) === undefined, 'the stopped wait releases its lease');
    await store.setJournal({ ...waiting, phase: 'waiting-safe' });
    await controller.recover();
    assert.equal((await store.journal())?.phase, 'failed'); assert.equal((await store.references()).active, b);
  } finally {
    controller.stopWaiting(); finish?.(); finishCleanup?.(); maintenance.close();
    // The failed wait starts the store's candidate cleanup (controller.ts `run`); the temp folder goes
    // after it ends.
    await controller.cleanup;
  }
});

// Moved from e2e/console-build-transaction.spec.ts: the lease renews on its interval (a third of
// leaseMs, safe-reload.ts `begin`), so an activation that outlasts several lease lives keeps it.
test('safe deployment renews its lease throughout delayed activation', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'safe-renewal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { timers, advance } = hostClock(t);
  const file = path.join(root, LEASE_FILE), leaseMs = lifecycleSavedFields.settings.leaseLifeMs.default;
  const drain = safeReload(root, async () => ({ id: (await readJson(file))?.id, ready: true }), { clearMs: 0, timers });
  const waited = drain.waitUntilSafe('long-activation', new AbortController().signal);
  await until(async () => (await readJson(file))?.phase === 'holding', 'the drain holds');
  await waited;
  const renewal = Math.max(50, Math.floor(leaseMs / 3));
  try {
    // Three lease lives of activation: each renewal moves the saved expiry a whole life past its time.
    for (let elapsed = 0; elapsed < 3 * leaseMs; elapsed += renewal) {
      await advance(renewal);
      const due = Date.now() + leaseMs;
      const lease = await until(async () => { const saved = await readJson(file); return saved?.expires === due && saved; }, 'the lease renews');
      assert.equal(lease.id, 'long-activation');
    }
  } finally { await drain.releaseSafeWait('long-activation'); }
  assert.equal(await readJson(file), undefined);
});

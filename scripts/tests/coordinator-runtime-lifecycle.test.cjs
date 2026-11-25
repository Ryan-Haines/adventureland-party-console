const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createCode } = require('../../runtime/lifecycle/coordinator/code.ts');
const { classes, digest } = require('../../tools/game/manifest.ts');
const { fixture } = require('./helpers/coordinator-workers.cjs');

// code.ts's managed generations over a real activation record: one built artifact per class, which
// verifyManifest checks by its checksum. `stopFails` makes the restart's stop reject.
function generationFixture(t, blocks, { stopFails = false } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'generations-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const entries = {};
  for (const name of classes) {
    const source = `// ${name}`, sha256 = digest(source), file = `generated/${sha256}/${name}.js`;
    mkdirSync(path.join(directory, 'generated', sha256), { recursive: true });
    writeFileSync(path.join(directory, file), source);
    entries[name] = { file, sha256, inputs: [] };
  }
  const manifest = { schema: 1, classes: entries,
    generation: digest(classes.map(name => name + ':' + entries[name].sha256).join('\n')) };
  const activation = path.join(directory, 'activation.json');
  writeFileSync(activation, JSON.stringify({ id: 'a1', manifest }));
  const f = fixture({ blocks }), stopped = [], notices = [];
  // The generation refresh is scheduled at 0 ms; every other wait is the reload's reply bound.
  const clock = { later: (callback, ms) => ms === 0 ? setImmediate(callback) : setTimeout(callback, ms),
    cancel: timer => { clearTimeout(timer); clearImmediate(timer); } };
  const code = createCode({ blocks, clock, log: f.ports.log, watching: false, hash: () => require('node:crypto').createHash('sha256'),
    read: () => new Uint8Array([1]), watch: () => ({ close() {} }), className: name => blocks[name]?.className,
    stop: async (block, reason) => { stopped.push([block.script, reason]); if (stopFails) throw Error('stop failed'); },
    notify: (hook, payload) => notices.push(payload) });
  const watcher = code.watchGenerations(directory, activation);
  t.after(() => watcher.dispose());
  return { logs: f.logs, stopped, notices, script: name => 'adventure_land/' + entries[name].file };
}
// A runner answers each reload with `reply`; null leaves it unanswered. The activation record is read
// from disk, so a row awaits `requested`, the runner's first reload request.
function runner(reply) {
  let first;
  return Object.assign(new EventEmitter(), { sent: [], requested: new Promise(resolve => { first = resolve; }), send(message, callback) {
    this.sent.push(message); callback(null); first();
    if (reply) queueMicrotask(() => this.emit('message', { type: 'code_reload_result', id: message.id, generation: message.generation, ...reply }));
  } });
}
async function drained() { await new Promise(setImmediate); }

test('a new generation reloads only enabled workers with a runner and a class', async t => {
  const blocks = { A: { enabled: true, className: 'mage', script: 'old', instance: runner({ status: 'ready' }) },
    B: { className: 'mage', script: 'old', instance: runner({ status: 'ready' }) },
    C: { enabled: true, className: 'mage', script: 'old', instance: null },
    D: { enabled: true, script: 'old', instance: runner({ status: 'ready' }) } };
  const g = generationFixture(t, blocks);
  await blocks.A.instance.requested; await drained();
  assert.equal(blocks.A.script, g.script('mage'));
  assert.deepEqual(g.notices.map(notice => notice.character), ['A']);
  assert.equal(blocks.B.instance.sent.length, 0); assert.equal(blocks.D.instance.sent.length, 0);
  assert.equal(blocks.B.script, 'old'); assert.equal(blocks.C.script, 'old'); assert.equal(blocks.D.script, 'old');
});

test('a reply from a replaced runner leaves the new runner on its script', async t => {
  const old = runner(null), blocks = { A: { enabled: true, className: 'mage', script: 'old', instance: old } };
  const g = generationFixture(t, blocks);
  await old.requested; blocks.A.instance = runner(null);
  const [request] = old.sent;
  old.emit('message', { type: 'code_reload_result', id: request.id, generation: request.generation, status: 'ready' });
  await drained();
  assert.equal(blocks.A.script, 'old'); assert.deepEqual(g.notices, []); assert.deepEqual(g.stopped, []);
});

test('a restart keeps the replacement script when stopping the runner rejects', async t => {
  const reply = { status: 'failed', error: 'lost runner', restartRequired: true };
  const blocks = { A: { enabled: true, className: 'mage', script: 'old', instance: runner(reply) } };
  const g = generationFixture(t, blocks, { stopFails: true });
  await blocks.A.instance.requested; await drained();
  assert.deepEqual(g.stopped, [[g.script('mage'), 'CODE reload recovery: lost runner']]);
  assert.equal(blocks.A.script, g.script('mage'));
  assert.ok(g.logs.some(([level, message]) => level === 'warn' && /current runners retained/.test(message)));
});

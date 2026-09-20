const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { createCoordinatorCharacterServices, coordinatorCodeDigest } = require('../../runtime/coordinator/characters/composition.ts');
const { fixture } = require('./helpers/coordinator-workers.cjs');

test('CODE digest preserves file-name/content ordering and read failures', () => {
  const reads = [], files = ['one.js', 'two.js'];
  const ports = { hash: () => crypto.createHash('sha256'), read: file => { reads.push(file); return Buffer.from(file); } };
  const expected = crypto.createHash('sha256').update('one.js').update('./CODE/one.js').update('two.js').update('./CODE/two.js').digest('hex');
  assert.equal(coordinatorCodeDigest(files, ports), expected);
  assert.deepEqual(reads, ['./CODE/one.js', './CODE/two.js']);
  assert.throws(() => coordinatorCodeDigest(files, { ...ports, read: () => { throw Error('missing'); } }), /missing/);
});

test('character composition retains receiver-bound account methods, live account state and lifecycle writes', () => {
  const f = fixture(); let lifecycle = {};
  const account = { response: { marker: 'first' },
    resolve_realm() { assert.equal(this, account); return f.ports.resolveRealm(); },
    resolve_char() { assert.equal(this, account); return f.ports.resolveCharacter(); }, updateInfo: async () => {} };
  const services = createCoordinatorCharacterServices({ ...f.ports, configuration: { enable_TYPECODE: true, web_app: { enable_minimap: true } },
    lifecycleState: () => lifecycle, accountSource: account,
    code: { hash: () => crypto.createHash('sha256'), read: () => Buffer.from(''), reload: async () => ({ status: 'ready' }), stop: async () => {}, watch() {}, warn() {} } });
  const worker = services.manager.start('W'); worker.emit('message', { type: 'process_ready' });
  assert.equal(worker.sent[0].arguments.enable_map, true);
  account.response = { marker: 'replacement' }; lifecycle = {};
  worker.emit('message', { type: 'connected' });
  assert.equal(lifecycle.W, 'online'); assert.deepEqual(worker.sent.at(-1).account, { marker: 'replacement' });
});

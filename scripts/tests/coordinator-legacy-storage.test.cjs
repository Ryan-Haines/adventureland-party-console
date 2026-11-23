const test = require('node:test'), assert = require('node:assert/strict');
const {migrateCoordinatorLegacyStorage: migrate} = require('../../runtime/coordinator/persistence/legacy-storage.ts');

function fixture(contents) {
  const calls = [], path = './localStorage/storage.json';
  const storage = {get: () => undefined, set: (key, value) => calls.push(['set', key, value])};
  const ports = {read: file => {assert.equal(file, path); return contents;},
    remove: file => calls.push(['remove', file]), info: (...args) => calls.push(['info', ...args])};
  return {calls, path, storage, ports, run: () => migrate(path, storage, ports)};
}

test('legacy storage transfers all entries in order before deletion and retains diagnostic payloads', () => {
  const t = fixture('{"first":{"value":1},"second":false}'); t.run();
  assert.deepEqual(t.calls, [
    ['set', 'first', {value: 1}], ['set', 'second', false],
    ['info', {type: 'ls_migration', path: t.path, value: 2}, 'localStorage migrated'],
    ['remove', t.path], ['info', {type: 'ls_migration_done', path: t.path}, 'old localStorage deleted'],
  ]);
});

test('missing legacy storage skips migration; unreadable storage stops startup', () => {
  const t = fixture(''); t.ports.read = () => {throw Object.assign(Error('missing'), {code:'ENOENT'});}; t.run();
  assert.deepEqual(t.calls, [['info', {type: 'ls_migration_none', path: t.path}, 'localStorage migration unnecessary']]);
  t.ports.read = () => {throw Object.assign(Error('access denied'), {code:'EACCES'});};
  assert.throws(t.run, /access denied/);
});

test('empty legacy storage is removed without a transfer log', () => {
  const t = fixture(''); t.run();
  assert.deepEqual(t.calls, [['remove', t.path], ['info', {type: 'ls_migration_done', path: t.path}, 'old localStorage deleted']]);
});

test('malformed and null legacy storage abort migration before writes or deletion', () => {
  for (const text of ['{invalid', 'null']) {
    const t = fixture(text); assert.throws(t.run); assert.deepEqual(t.calls, []);
  }
});

test('legacy write failures preserve the source file and propagate the original error', () => {
  const t = fixture('{"first":1,"second":2}'), failure = Error('disk full');
  t.storage.set = (key, value) => {t.calls.push(['set', key, value]); if (key === 'second') throw failure;};
  assert.throws(t.run, error => error === failure);
  assert.deepEqual(t.calls, [['set', 'first', 1], ['set', 'second', 2]]);
});

test('legacy deletion failures propagate without claiming deletion succeeded', () => {
  const t = fixture('{}'), failure = Error('locked');
  t.ports.remove = () => {throw failure;};
  assert.throws(t.run, error => error === failure);
  assert.deepEqual(t.calls, [['info', {type: 'ls_migration', path: t.path, value: 0}, 'localStorage migrated']]);
});

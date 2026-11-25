// The committed bundles against their sources: each build tool's `--check` builds in memory
// and fails naming every committed copy that differs. Each row builds once into .build, copies the
// fresh outputs into a temporary console folder, changes one copy and checks that folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function folderWith(copies) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-check-'));
  for (const [to, from] of Object.entries(copies)) {
    fs.mkdirSync(path.dirname(path.join(folder, to)), { recursive: true });
    fs.copyFileSync(from, path.join(folder, to));
  }
  return folder;
}
const run = (...args) => spawnSync(process.execPath, args, { encoding: 'utf8' });

test('build:runtime --check names the one character bundle that differs from its source', t => {
  assert.equal(run('tools/build-runtime.mts').status, 0);
  const names = ['steam-bridge.js', 'universal-loader.js', 'party-member.js', 'profiles.js'];
  const folder = folderWith(Object.fromEntries(names.map(name => ['characters/' + name, '.build/runtime/' + name])));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.appendFileSync(path.join(folder, 'characters/party-member.js'), '// edited\n');
  const result = run('tools/build-runtime.mts', '--check', folder);
  assert.equal(result.status, 1);
  assert.deepEqual(result.stderr.trim().split('\n').map(line => path.basename(line.split(' ')[0])), ['party-member.js']);
});

test('build:shared --check names farming-zones.js when it differs from runtime/hunting/zones.ts', t => {
  assert.equal(run('tools/build-shared.mts').status, 0);
  const folder = folderWith({ 'characters/farming-zones.js': '.build/shared/farming-zones.js',
    'runtime/hunting/farming-areas.cjs': '.build/shared/farming-areas.cjs' });
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  assert.equal(run('tools/build-shared.mts', '--check', folder).status, 0, 'fresh copies pass');
  fs.appendFileSync(path.join(folder, 'characters/farming-zones.js'), '// edited\n');
  const result = run('tools/build-shared.mts', '--check', folder);
  assert.equal(result.status, 1);
  assert.deepEqual(result.stderr.trim().split('\n').map(line => path.relative(folder, line.split(' ')[0]).replaceAll(path.sep, '/')), ['characters/farming-zones.js']);
});

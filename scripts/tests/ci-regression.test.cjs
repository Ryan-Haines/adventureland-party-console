const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkRegression } = require('../ci/check-regression.cjs');
const { restoreGameFixtures } = require('../ci/restore-game-fixtures.cjs');
const green = 'TAP version 13\nok 1 - example\n1..1\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';

test('CI accepts a complete passing TAP report with npm lifecycle output', () => {
  assert.equal(checkRegression('> pretest\nBuild complete\n' + green).tests, 1);
});

test('CI rejects failures, cancellations, skips, TODOs and incomplete reports', () => {
  for (const field of ['fail', 'cancelled', 'skipped', 'todo'])
    assert.throws(() => checkRegression(green.replace(`# ${field} 0`, `# ${field} 1`)));
  for (const output of [green.replace('# pass 1', '# pass 0'), green.replace('1..1\n', ''),
    green.replace('# todo 0\n', ''), green + '# tests 1\n', green.replace('ok 1', 'not ok 1'),
    green + 'Bail out!\n', green.replace('# tests 1', '# tests 0')])
    assert.throws(() => checkRegression(output));
});

function temporary() {
  fs.mkdirSync('.build/ci-fixture-tests', { recursive: true });
  return fs.mkdtempSync(path.resolve('.build/ci-fixture-tests/run-'));
}

test('CI restores both complete game versions offline and can repeat safely', () => {
  const target = temporary();
  assert.deepEqual(restoreGameFixtures(target), ['16846', '17083']);
  assert.deepEqual(restoreGameFixtures(target), ['16846', '17083']);
  for (const version of ['16846', '17083']) {
    const directory = path.join(target, version);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'client_scripts.json'), 'utf8'));
    for (const file of [...manifest.game, ...manifest.runner])
      assert.ok(fs.readFileSync(path.join(directory, path.posix.basename(file))).length);
  }
});

test('CI fixture restoration rejects corruption before writing any game files', () => {
  const source = temporary(), target = path.join(source, 'restored');
  fs.cpSync(path.resolve('scripts/tests/fixtures/game'), source, { recursive: true });
  fs.appendFileSync(path.join(source, '17083.json.gz'), 'corruption');
  assert.throws(() => restoreGameFixtures(target, source), /checksum mismatch/);
  assert.equal(fs.existsSync(target), false);
});

test('CI fixture restoration refuses to overwrite a different existing game cache', () => {
  const target = temporary(), file = path.join(target, '17083/data.js');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, 'different live data');
  assert.throws(() => restoreGameFixtures(target), /Existing game cache differs/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'different live data');
  assert.equal(fs.existsSync(path.join(target, '16846')), false);
});

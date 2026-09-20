const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('class generation publishes atomically, skips unchanged writes, and isolates class-only edits', async () => {
  const { buildGame } = await import('../../tools/game/build.mts');
  const { classes, verifyManifest } = await import('../../tools/game/manifest.ts');
  const base = path.resolve('.build/test-generations');
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, 'generation-'));
  const entries = path.join(directory, 'runtime/characters/entries');
  await fs.mkdir(entries, { recursive: true });
  await fs.writeFile(path.join(entries, 'common.ts'), 'export const shared = 1;');
  for (const name of classes) await fs.writeFile(path.join(entries, name + '.ts'),
    `import { shared } from './common'; globalThis.result = '${name}:' + shared + ':1';`);
  try {
    const first = await buildGame(directory, true);
    const manifestFile = path.join(directory, 'characters/manifest.json');
    const before = await fs.stat(manifestFile);
    const same = await buildGame(directory, true);
    assert.equal(same.generation, first.generation);
    assert.equal((await fs.stat(manifestFile)).mtimeMs, before.mtimeMs);
    await fs.appendFile(path.join(entries, 'mage.ts'), '\nglobalThis.mageOnly = 2;');
    const next = await buildGame(directory, true);
    assert.notEqual(next.classes.mage.sha256, first.classes.mage.sha256);
    for (const name of classes.filter(name => name !== 'mage'))
      assert.equal(next.classes[name].sha256, first.classes[name].sha256);
    await verifyManifest(path.join(directory, 'characters'), next);
    const {rollbackGame, resumeGame} = await import('../../tools/game/history.ts');
    await rollbackGame(directory, first.generation);
    await buildGame(directory, true);
    assert.equal(JSON.parse(await fs.readFile(manifestFile, 'utf8')).generation, first.generation,
      'automatic publication must not overwrite a pinned rollback');
    await resumeGame(directory);
    assert.equal(JSON.parse(await fs.readFile(manifestFile, 'utf8')).generation, next.generation);
    const accepted = await fs.readFile(manifestFile, 'utf8');
    await fs.appendFile(path.join(entries, 'mage.ts'), '\nthis is invalid {');
    await assert.rejects(buildGame(directory, true), /previous generation retained/);
    assert.equal(await fs.readFile(manifestFile, 'utf8'), accepted);
    await fs.appendFile(path.join(directory, 'characters', next.classes.mage.file), 'corrupt');
    await assert.rejects(verifyManifest(path.join(directory, 'characters'), next), /checksum mismatch/);
  } finally {
    assert.ok(path.resolve(directory).startsWith(base + path.sep));
    await fs.rm(directory, { recursive: true });
  }
});

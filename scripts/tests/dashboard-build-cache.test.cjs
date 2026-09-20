const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { fingerprint } = require('../../tools/dashboard/fingerprint.ts');

test('dashboard cache invalidates source changes but ignores generated builds and logs', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'party-build-cache-'));
  try {
    await fs.writeFile(path.join(directory, 'page.tsx'), 'first');
    const first = await fingerprint(directory);
    await fs.mkdir(path.join(directory, '.build'));
    await fs.writeFile(path.join(directory, '.build', 'generated.js'), 'changed output');
    await fs.writeFile(path.join(directory, 'server.log'), 'runtime log');
    assert.equal(await fingerprint(directory), first);
    await fs.writeFile(path.join(directory, 'page.tsx'), 'second');
    assert.notEqual(await fingerprint(directory), first);
  } finally {
    // mkdtemp creates this exact test-owned directory; never accept caller paths.
    assert.equal(path.dirname(directory), os.tmpdir());
    await fs.rm(directory, { recursive: true, force: true });
  }
});

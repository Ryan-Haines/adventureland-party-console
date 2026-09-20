const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { gunzipSync } = require('node:zlib');
const fixtureRoot = path.resolve(__dirname, '../tests/fixtures/game');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function restoreGameFixtures(destination, source = fixtureRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  // Validate every archive and existing file before writing anything. Never replace
  // a developer's live game cache with different fixture bytes.
  const pending = [];
  for (const entry of manifest.versions) {
    if (!/^\d+$/.test(entry.version)) throw new Error('Invalid fixture version');
    const archive = fs.readFileSync(path.join(source, `${entry.version}.json.gz`));
    if (hash(archive) !== entry.sha256) throw new Error(`Fixture checksum mismatch: ${entry.version}`);
    const files = JSON.parse(gunzipSync(archive, { maxOutputLength: 20 * 1024 * 1024 }).toString('utf8'));
    if (Object.keys(files).length !== entry.files) throw new Error('Fixture file count mismatch');
    for (const [name, content] of Object.entries(files)) {
      if (!/^[a-zA-Z0-9_.-]+\.(?:js|json)$/.test(name) || typeof content !== 'string')
        throw new Error(`Invalid fixture file: ${name}`);
      const target = path.join(destination, entry.version, name);
      if (fs.existsSync(target)) {
        if (fs.readFileSync(target, 'utf8') !== content)
          throw new Error(`Existing game cache differs; use an isolated checkout: ${target}`);
      } else pending.push([target, content]);
    }
  }
  for (const [target, content] of pending) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, { flag: 'wx' });
  }
  return manifest.versions.map(entry => entry.version);
}

if (require.main === module) {
  const destination = path.resolve(process.argv[2] || '.caracal/game_files');
  console.log(`Verified game fixtures: ${restoreGameFixtures(destination).join(', ')} → ${destination}`);
}
module.exports = { restoreGameFixtures };

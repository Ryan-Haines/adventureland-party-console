const fs = require('node:fs');
const crypto = require('node:crypto');
exports.prepare = async (_options, context) => {
  const manifest = JSON.parse(fs.readFileSync('.build/release/release-manifest.json', 'utf8'));
  if (manifest.version !== context.nextRelease.version) throw new Error('Release version changed while building; rebuild the artifacts');
  const asset = fs.readFileSync('.build/release/' + manifest.windows.asset);
  if (crypto.createHash('sha256').update(asset).digest('hex') !== manifest.windows.sha256) throw new Error('Release asset checksum mismatch');
  // The image path follows distribution.json's repository, as manifest.mts builds it, so a fork that
  // sets its own repository passes.
  const { repository } = JSON.parse(fs.readFileSync('distribution.json', 'utf8'));
  const image = `ghcr.io/${repository.toLowerCase()}@sha256:`;
  if (!manifest.image.startsWith(image) || !/^[a-f0-9]{64}$/.test(manifest.image.slice(image.length))) throw new Error('Missing immutable Docker image');
};

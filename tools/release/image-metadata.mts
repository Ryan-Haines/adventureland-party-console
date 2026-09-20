import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { atomic, readJson, sourceManifest } from '../update/files.ts';
import { version } from '../update/contracts.ts';
const root = fileURLToPath(new URL('../../', import.meta.url));
const tag = process.argv[2];
if (tag !== 'development') {
  version(tag);
  const config = await readJson<{ repository: string }>(path.join(root, 'distribution.json'));
  await atomic(path.join(root, 'release.json'), { version: tag, repository: config.repository, protocol: 1, dataFormat: 1,
    commit: process.argv[3] || '', files: await sourceManifest(root) });
}

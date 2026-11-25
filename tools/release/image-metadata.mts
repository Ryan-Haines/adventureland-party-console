import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sourceManifest } from '../update/files.ts';
import { requiredJson } from '../build-store.ts';
import { writeRelease } from './rules.ts';
import { version } from '../update/contracts.ts';
const root = fileURLToPath(new URL('../../', import.meta.url));
const tag = process.argv[2];
if (tag !== 'development') {
  version(tag);
  const config = await requiredJson<{ repository: string }>(path.join(root, 'distribution.json'));
  await writeRelease(path.join(root, 'release.json'), { version: tag, repository: config.repository,
    commit: process.argv[3] || '', files: await sourceManifest(root) });
}

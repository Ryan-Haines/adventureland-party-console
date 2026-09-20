import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomic, digest, readJson } from '../update/files.ts';
import { published, version } from '../update/contracts.ts';
const tag = process.argv[2], imageDigest = process.argv[3]; version(tag);
const { repository } = await readJson<{ repository: string }>('distribution.json');
const asset = `adventureland-party-console-${tag}-windows-x64.zip`;
const manifest = published({ version: tag, protocol: 1, dataFormat: 1, windows: { asset, sha256: digest(await readFile(path.join('.build/release', asset))) }, image: `ghcr.io/${repository.toLowerCase()}@${imageDigest}` }, repository, tag);
await atomic('.build/release/release-manifest.json', manifest);

import { mkdir, cp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../update/process.ts';
import { atomic, sourceManifest } from '../update/files.ts';
import { version } from '../update/contracts.ts';
import { installCaddy } from '../hosting/install-caddy.mts';
const root = fileURLToPath(new URL('../../', import.meta.url));
await installCaddy(root);
const tag = process.argv[2]; version(tag);
const destination = path.resolve(process.argv[3] || path.join(root, '.build/release/windows'));
if (!destination.startsWith(path.join(root, '.build') + path.sep)) throw new Error('Release staging must be inside .build');
await mkdir(path.join(destination, 'app'), { recursive: true });
const tracked = (await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], root)).split('\0').filter(Boolean);
for (const file of tracked) {
  if (file.endsWith('.tmp')) continue;
  if (/^(\.gitea|\.agents|\.codex)\//.test(file) || /(^|\/)(\.env[^/]*|config\.js|session\.[^/]*|secrets)(\/|$)/.test(file)) continue;
  const target = path.join(destination, 'app', file);
  await mkdir(path.dirname(target), { recursive: true }); await cp(path.join(root, file), target);
}
for (const directory of ['node_modules', 'dashboard/node_modules', '.build/runtime', '.build/shared', '.build/caddy', 'dashboard/.build/container', 'characters/generated']) {
  await cp(path.join(root, directory), path.join(destination, 'app', directory), { recursive: true });
}
for (const file of ['characters/manifest.json', 'characters/shared.js', 'characters/profiles.js', 'characters/roles.js', 'characters/party-member.js'])
  await cp(path.join(root, file), path.join(destination, 'app', file));
await cp(path.join(root, '.caracal'), path.join(destination, 'app/.caracal'), { recursive: true, filter: source => {
  const relative = path.relative(path.join(root, '.caracal'), source).replaceAll('\\', '/');
  return !/^(\.git|CODE|localStorage|game_files|logs)(\/|$)/.test(relative) && !/^(config\.js$|session\.|\.caracal-supervisor)/.test(relative);
} });
const config = JSON.parse(await readFile(path.join(root, 'distribution.json'), 'utf8'));
await atomic(path.join(destination, 'app/release.json'), { version: tag, repository: config.repository, protocol: 1, dataFormat: 1,
  commit: process.env.GITHUB_SHA || (await run('git', ['rev-parse', 'HEAD'], root)).trim(), files: await sourceManifest(path.join(destination, 'app')) });
for (const file of ['Start.ps1', 'Start.cmd', 'Develop.ps1', 'Develop.cmd']) await cp(path.join(root, 'distribution', file), path.join(destination, file));
console.log(destination);

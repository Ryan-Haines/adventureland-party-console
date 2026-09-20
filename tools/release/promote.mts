import { mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../update/process.ts';
import { contained, atomic, exists } from '../update/files.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const revision = process.argv[2], message = process.argv[3];
if (!revision || !/^(fix|feat|chore|docs|refactor|test|build|ci)(\([^\r\n]+\))?!?: [^\r\n]+/.test(message || ''))
  throw new Error('Usage: node tools/release/promote.mts <committed revision> "feat: public release summary" [--push]');
const commit = (await run('git', ['rev-parse', '--verify', `${revision}^{commit}`], root)).trim();
const publicRoot = path.join(root, '.build/public-release');
const config = JSON.parse(await readFile(path.join(root, 'distribution.json'), 'utf8'));
await mkdir(publicRoot, { recursive: true });
if (!(await exists(path.join(publicRoot, '.git')))) await run('git', ['init', '--initial-branch=main'], publicRoot);
// A nested empty directory could accidentally resolve the private parent repository.
if ((await run('git', ['rev-parse', '--show-toplevel'], publicRoot)).trim().replaceAll('\\', '/') !== publicRoot.replaceAll('\\', '/'))
  throw new Error('Initialize .build/public-release as its own repository before promotion');
if ((await run('git', ['status', '--porcelain'], publicRoot)).trim()) throw new Error('Public checkout has uncommitted work; review it before promotion');
const remote = `https://github.com/${config.repository}.git`;
try { await run('git', ['remote', 'add', 'origin', remote], publicRoot); } catch {
  if ((await run('git', ['remote', 'get-url', 'origin'], publicRoot)).trim() !== remote) throw new Error('Unexpected public remote');
}
const exported = (await run('git', ['ls-tree', '-r', '--name-only', commit], root)).trim().split('\n').filter(file => !/^\.(gitea|agents|codex)\//.test(file));
const allow = /^(README\.md|LICENSE|THIRD_PARTY_NOTICES\.md|AGENTS\.md|Dockerfile|compose\.yaml|distribution\.json|release\.config\.mjs|package(-lock)?\.json|\.gitignore|\.gitattributes|\.dockerignore|\.github\/|characters\/|dashboard\/|docs\/|patches\/|runtime\/|scripts\/|tools\/|distribution\/)/;
const files = exported.filter(file => allow.test(file) && !file.endsWith('.tmp'));
const old = (await run('git', ['ls-files', '-z'], publicRoot)).split('\0').filter(Boolean);
for (const file of old) if (!files.includes(file)) await rm(contained(publicRoot, file), { force: true });
for (const file of files) {
  if (/(^|\/)(\.env[^/]*|config\.js|session\.[^/]*|secrets)(\/|$)/.test(file)) throw new Error(`Private file in release tree: ${file}`);
  const target = contained(publicRoot, file);
  await mkdir(path.dirname(target), { recursive: true });
  // Git archive preserves binary fixtures and exact committed bytes.
}
const archive = path.join(root, '.build/public-release.tar');
await run('git', ['archive', '--format=tar', `--output=${archive}`, commit, '--', ...new Set(files.map(file => file.split('/')[0]))], root);
await run(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xf', archive, '-C', publicRoot], root);
await atomic(path.join(root, '.build/public-source.json'), { commit, message });
await run('git', ['add', '--all'], publicRoot);
console.log(await run('git', ['diff', '--cached', '--stat'], publicRoot));
if (process.argv.includes('--push')) {
  await run('git', ['commit', '-m', message], publicRoot);
  await run('git', ['push', '--set-upstream', 'origin', 'main'], publicRoot);
} else console.log('Review .build/public-release; then commit and push the staged public snapshot. Private history was not copied.');

import { mkdir, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../update/process.ts';
import { contained, exists } from '../update/files.ts';

// One-time reviewed working-tree export. Subsequent releases use promote.mts
// with an explicit committed private revision, never a force push or mirror.
const root = fileURLToPath(new URL('../../', import.meta.url));
const destination = path.join(root, '.build/public-release');
await mkdir(destination, { recursive: true });
if (await exists(path.join(destination, '.git'))) throw new Error('Public checkout already exists; use promote.mts for later releases');
const files = (await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], root)).split('\0').filter(Boolean);
const allowed = /^(README\.md|LICENSE|THIRD_PARTY_NOTICES\.md|AGENTS\.md|Dockerfile|compose\.yaml|distribution\.json|release\.config\.mjs|package(-lock)?\.json|\.gitignore|\.gitattributes|\.dockerignore|\.github\/|characters\/|dashboard\/|docs\/|patches\/|runtime\/|scripts\/|tools\/|distribution\/)/;
let count = 0;
for (const file of files.filter(file => allowed.test(file))) {
  if (file.endsWith('.tmp')) continue;
  if (/(^|\/)(\.env[^/]*|config\.js|session\.[^/]*|secrets)(\/|$)/.test(file)) throw new Error(`Private path: ${file}`);
  const source = await readFile(path.join(root, file));
  if (source.length > 100 * 1024 * 1024) throw new Error(`File exceeds GitHub source limit: ${file}`);
  if (/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/.test(source.toString('utf8')))
    throw new Error(`Potential credential must be reviewed before export: ${file}`);
  const target = contained(destination, file); await mkdir(path.dirname(target), { recursive: true }); await copyFile(path.join(root, file), target); count++;
}
await run('git', ['init', '--initial-branch=main'], destination);
console.log(`Prepared ${count} reviewed source paths in ${destination}. No private Git history or runtime data copied.`);

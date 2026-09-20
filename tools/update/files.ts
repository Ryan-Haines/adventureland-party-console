import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, readdir, lstat, chown } from 'node:fs/promises';
import path from 'node:path';

export async function atomic(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  if (process.env.AL_CONTAINER_UPDATER === '1') await chown(temporary, 1000, 1000);
  await rename(temporary, file);
}
export async function readJson<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, 'utf8')) as T; }
export const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const excluded = new Set(['node_modules', '.git', '.build', '.next', '.wrangler', 'dist']);
function ignored(prefix: string, name: string) {
  if (excluded.has(name) || name === 'release.json' || name.endsWith('.tsbuildinfo')) return true;
  const relative = prefix ? `${prefix}/${name}` : name;
  if (['characters/generated', 'characters/manifest.json', 'characters/build-history.json'].includes(relative)) return true;
  return /^\.caracal\/(CODE|localStorage|game_files|logs|config\.js|session\.[^/]*|\.caracal-supervisor\.lock)$/.test(relative);
}
export async function sourceFiles(root: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    if (ignored(prefix, entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected source link: ${relative}`);
    if (entry.isDirectory()) result.push(...await sourceFiles(root, relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result.sort();
}
export async function sourceManifest(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const file of await sourceFiles(root)) files[file] = digest(await readFile(path.join(root, file)));
  return files;
}
export async function assertUnmodified(root: string, expected: Record<string, string>) {
  const actual = await sourceManifest(root);
  const changed = [...new Set([...Object.keys(actual), ...Object.keys(expected)])].filter(file => actual[file] !== expected[file]);
  if (changed.length) throw new Error(`Local source edits prevent installation. Reconcile these files first: ${changed.slice(0, 12).join(', ')}`);
}
export function contained(root: string, relative: string) {
  const result = path.resolve(root, relative), rel = path.relative(path.resolve(root), result);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Path escapes the installation');
  return result;
}
export async function exists(file: string) { try { await lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }

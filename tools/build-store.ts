import { chown, mkdir, readFile, writeFile, rename, readdir, lstat, unlink, rmdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { lifecycleSavedFields } from '../runtime/lifecycle/fields.ts';
import type { HostBound } from './hosting/http.ts';

// The builds a history keeps, declared once (the lifecycle owner's fields.ts `retainedCandidates`).
export const RETAIN_BUILDS = lifecycleSavedFields.settings.retainedCandidates.default;
export async function readJson<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
}
// A file the caller cannot go on without: an absent one is an error that names it.
export async function requiredJson<T>(file: string): Promise<T> {
  const value = await readJson<T>(file);
  if (value === undefined) throw new Error('Missing ' + file);
  return value;
}
// Windows denies a rename or removal while a reader or antivirus holds the file. whileShared retries
// the codes its caller names under this one bound, polls every SHARING_POLL_MS and logs when the bound
// ends the retries.
const SHARING_VIOLATION: HostBound = {name: 'sharingViolationMs', ms: 1000};
const SHARING_POLL_MS = 25;
export async function whileShared<T>(what: string, codes: string[], action: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + SHARING_VIOLATION.ms;
  for (;;) {
    try { return await action(); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code || '';
      if (!codes.includes(code)) throw error;
      if (Date.now() >= deadline) {
        console.warn(`[bound] ${SHARING_VIOLATION.name} (${SHARING_VIOLATION.ms} ms) ended ${what} (${code})`);
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, SHARING_POLL_MS));
    }
  }
}
// The host programs' one JSON file writer (the builds, the deploy lease, the updater's journal and
// hold): a private file, owned by the console's user when the container updater (root) writes it.
export async function atomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), {recursive: true});
  const temporary = file + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
  if (process.env.AL_CONTAINER_UPDATER === '1') await chown(temporary, 1000, 1000);
  // A refused replacement keeps the existing valid file.
  await whileShared('the replacement of ' + file, process.platform === 'win32' ? ['EPERM', 'EACCES', 'EBUSY'] : [], () => rename(temporary, file));
}
export async function withBuildLock<T>(directory: string, action: () => Promise<T>): Promise<T> {
  await mkdir(directory, {recursive: true});
  const lock = path.join(directory, 'operation.lock');
  try { await mkdir(lock); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error('Build store is locked: ' + lock + '. Retry after the active operation finishes.');
    throw error;
  }
  try {
    await writeFile(path.join(lock, 'owner.json'), JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}));
    return await action();
  } finally { await unlink(path.join(lock, 'owner.json')).catch(() => {}); await rmdir(lock); }
}
export interface Removal { path: string; bytes: number }
// Inspect every component and descendant before deleting. Never follow a junction
// or symlink, and never remove the root itself. Unknown files are selected by callers.
export async function inspectRemoval(root: string, relative: string): Promise<Removal> {
  const base = path.resolve(root), target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) throw new Error('Cleanup escaped its root: ' + target);
  if (await realpath(base) !== base) throw new Error('Cleanup root is redirected: ' + base);
  let current = base;
  for (const component of path.relative(base, target).split(path.sep)) {
    current = path.join(current, component);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Cleanup refuses links: ' + current);
  }
  return {path: target, bytes: await treeBytes(target)};
}
async function treeBytes(file: string): Promise<number> {
  const info = await lstat(file);
  if (info.isSymbolicLink()) throw new Error('Cleanup refuses links: ' + file);
  if (!info.isDirectory()) return info.size;
  let bytes = 0;
  for (const name of await readdir(file)) bytes += await treeBytes(path.join(file, name));
  return bytes;
}
async function deleteTree(file: string): Promise<void> {
  const info = await lstat(file);
  if (info.isSymbolicLink()) throw new Error('Cleanup refuses links: ' + file);
  if (!info.isDirectory()) { await unlink(file); return; }
  for (const name of await readdir(file)) await deleteTree(path.join(file, name));
  await rmdir(file);
}
export async function applyRemovals(root: string, removals: Removal[]): Promise<void> {
  for (const removal of removals) {
    const verified = await inspectRemoval(root, path.relative(root, removal.path));
    await deleteTree(verified.path);
  }
}
export async function directoryNames(directory: string): Promise<string[]> {
  try { return await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
// A live pin names the builds a running host serves, so a prune keeps them. It holds while its
// writer's pid runs: livePins skips a pin whose pid is gone.
export async function pinLive(directory: string, name: string, ids: string[]): Promise<void> {
  await atomicJson(path.join(directory, name), {pid: process.pid, ids});
}
export async function livePins(directory: string, pattern: RegExp): Promise<string[]> {
  const pins: string[] = [];
  for (const name of await directoryNames(directory)) {
    if (!pattern.test(name)) continue;
    const pin = await readJson<{pid: number; ids: string[]}>(path.join(directory, name));
    if (!pin) continue;
    try { process.kill(pin.pid, 0); pins.push(...pin.ids); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  }
  return pins;
}

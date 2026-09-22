import path from 'node:path';
import { access } from 'node:fs/promises';
import { atomicJson, readJson, directoryNames, inspectRemoval, applyRemovals, RETAIN_BUILDS, withBuildLock } from '../build-store.ts';

interface Version { id: string; createdAt: string }
export async function dashboardHistory(root: string): Promise<Version[]> {
  return (await readJson<Version[]>(path.join(root, '.build/history.json')) || []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export async function pinDashboard(root: string, port: number, ids: string[]): Promise<void> {
  await withBuildLock(path.join(root, '.build'), () => atomicJson(path.join(root, '.build', `live-${port}.json`), {pid: process.pid, ids}));
}
async function liveReleases(root: string): Promise<string[]> {
  const ids: string[] = [];
  for (const name of await directoryNames(path.join(root, '.build'))) {
    if (!/^live-\d+\.json$/.test(name)) continue;
    const lease = await readJson<{pid: number; ids: string[]}>(path.join(root, '.build', name));
    if (!lease) continue;
    try { process.kill(lease.pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') continue; throw error; }
    ids.push(...lease.ids);
  }
  return ids;
}
export async function releasePath(root: string, id: string): Promise<string> {
  if (!/^[a-f0-9]{20}$/.test(id)) throw new Error('Invalid dashboard build ID');
  const directory = path.join(root, '.build/releases', id);
  const completed = await readJson<{generation: string}>(path.join(directory, 'complete.json'));
  if (completed?.generation !== id) throw new Error('Dashboard build is incomplete: ' + id);
  await access(path.join(directory, 'server/index.js'));
  await inspectRemoval(path.join(root, '.build'), 'releases/' + id);
  return directory;
}
export async function rememberDashboard(root: string, id: string): Promise<void> {
  await releasePath(root, id);
  const history = await dashboardHistory(root);
  if (history.some(entry => entry.id === id)) return;
  history.push({id, createdAt: new Date().toISOString()});
  await atomicJson(path.join(root, '.build/history.json'), history);
}
// Caller holds the same store lock used by dashboard builds. The supervisor
// supplies running releases; external commands may not guess which are in use.
export async function cleanDashboard(root: string, protectedIds: string[], apply: boolean) {
  protectedIds = [...protectedIds, ...await liveReleases(root)];
  const directory = path.join(root, '.build');
  const history = await dashboardHistory(root);
  const retained = history.slice(-RETAIN_BUILDS);
  for (const entry of history)
    if (protectedIds.includes(entry.id) && !retained.includes(entry)) retained.push(entry);
  const keep = new Set([...protectedIds, ...retained.map(entry => entry.id)]);
  for (const id of keep) await releasePath(root, id);
  const removals = [];
  for (const id of await directoryNames(path.join(directory, 'releases')))
    if (/^[a-f0-9]{20}$/.test(id) && !keep.has(id)) removals.push(await inspectRemoval(directory, 'releases/' + id));
  if ((await directoryNames(directory)).includes('validation')) removals.push(await inspectRemoval(directory, 'validation'));
  if (apply) {
    await applyRemovals(directory, removals);
    await atomicJson(path.join(directory, 'history.json'), retained);
  }
  return {directory, retained: [...keep], removals, bytes: removals.reduce((sum, item) => sum + item.bytes, 0)};
}

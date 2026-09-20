import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { atomicJson, readJson, directoryNames, inspectRemoval, applyRemovals, RETAIN_BUILDS, withBuildLock } from '../build-store.ts';
import { verifyManifest, type GameManifest } from './manifest.ts';

interface Version { id: string; createdAt: string; manifest: GameManifest }
export const gameStore = (root: string) => path.join(root, '.build/game');
const historyFile = (directory: string) => path.join(directory, 'build-history.json');
export async function gameHistory(directory: string): Promise<Version[]> {
  return (await readJson<Version[]>(historyFile(directory)) || []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export async function rememberGame(directory: string, manifest: GameManifest): Promise<void> {
  await verifyManifest(directory, manifest);
  const history = await gameHistory(directory);
  if (history.some(entry => entry.id === manifest.generation)) return;
  history.push({id: manifest.generation, createdAt: new Date().toISOString(), manifest});
  await atomicJson(historyFile(directory), history);
}
export async function rememberCurrent(directory: string): Promise<GameManifest | undefined> {
  const manifest = await readJson<GameManifest>(path.join(directory, 'manifest.json'));
  if (manifest) await rememberGame(directory, manifest);
  return manifest;
}
export async function cleanGame(directory: string, apply: boolean) {
  const current = await readJson<GameManifest>(path.join(directory, 'manifest.json'));
  if (!current) throw new Error('No current game manifest: ' + directory);
  await verifyManifest(directory, current);
  const history = await gameHistory(directory);
  const retained = history.slice(-RETAIN_BUILDS);
  const active = history.find(entry => entry.id === current.generation);
  if (active && !retained.includes(active)) retained.push(active);
  const manifests = [current, ...retained.map(entry => entry.manifest)];
  const protectedFiles = new Set<string>();
  for (const manifest of manifests) {
    await verifyManifest(directory, manifest);
    for (const entry of Object.values(manifest.classes)) protectedFiles.add(entry.file);
  }
  const removals = await obsoleteFiles(directory, protectedFiles);
  if (apply) {
    await applyRemovals(directory, removals);
    await removeEmptyHashes(directory);
    await atomicJson(historyFile(directory), retained);
  }
  return {directory, retained: retained.map(entry => entry.id), removals, bytes: removals.reduce((sum, item) => sum + item.bytes, 0)};
}
async function obsoleteFiles(directory: string, protectedFiles: Set<string>) {
  const removals = [];
  for (const hash of await directoryNames(path.join(directory, 'generated'))) {
    if (!/^[a-f0-9]{64}$/.test(hash)) continue;
    // Delete only known bundle files; never recursively delete an unknown hash folder.
    for (const name of await directoryNames(path.join(directory, 'generated', hash))) {
      const relative = `generated/${hash}/${name}`;
      if (!/^(warrior|paladin|rogue|ranger|mage|priest|merchant)\.js$/.test(name) || protectedFiles.has(relative)) continue;
      removals.push(await inspectRemoval(directory, relative));
    }
  }
  return removals;
}
async function removeEmptyHashes(directory: string): Promise<void> {
    // Empty hash directories are safe to remove only after verifying their paths.
    for (const hash of await directoryNames(path.join(directory, 'generated'))) {
      if (!/^[a-f0-9]{64}$/.test(hash)) continue;
      const relative = 'generated/' + hash;
      if (!(await directoryNames(path.join(directory, relative))).length)
        await applyRemovals(directory, [await inspectRemoval(directory, relative)]);
    }
}
export async function rollbackGame(root: string, id: string): Promise<void> {
  await withBuildLock(gameStore(root), async () => {
    const directory = path.join(root, 'characters');
    await rememberCurrent(directory);
    const version = (await gameHistory(directory)).find(entry => entry.id === id);
    if (!version) throw new Error('Unknown character build: ' + id);
    await verifyManifest(directory, version.manifest);
    // Pin before switching: watchers and ordinary startup must not undo rollback.
    await atomicJson(path.join(gameStore(root), 'publication.json'), {pinned: id});
    await atomicJson(path.join(directory, 'manifest.json'), version.manifest);
  });
}
export async function resumeGame(root: string): Promise<void> {
  await withBuildLock(gameStore(root), async () => {
    const directory = path.join(root, 'characters'), staged = gameStore(root);
    const manifest = await verifyManifest(staged, JSON.parse(await readFile(path.join(staged, 'manifest.json'), 'utf8')));
    const {mkdir, copyFile} = await import('node:fs/promises');
    await rememberCurrent(directory);
    for (const entry of Object.values(manifest.classes)) {
      const file = path.join(directory, entry.file);
      await mkdir(path.dirname(file), {recursive: true});
      await copyFile(path.join(staged, entry.file), file);
    }
    await rememberGame(directory, manifest);
    await atomicJson(path.join(directory, 'manifest.json'), manifest);
    await atomicJson(path.join(staged, 'publication.json'), {pinned: null});
    await cleanGame(directory, true);
  });
}

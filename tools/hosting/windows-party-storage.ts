import {createHash} from 'node:crypto';
import {copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, rmdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {processLockActive} from '../../runtime/coordinator/persistence/process-lock.ts';
import {contained} from '../update/files.ts';

const optionalInfo = (file: string) => lstat(file).catch((error: NodeJS.ErrnoException) => {
  if (error.code !== 'ENOENT') throw error;
  return undefined;
});

/** Called during stopped-host startup, before access, TLS and pairing files are opened. */
export async function migrateHostingData(root: string, parent: string) {
  await mkdir(parent, {recursive:true});
  const data = path.join(parent, 'hosting-data');
  const exists = async (directory: string) => {
    const info = await optionalInfo(directory);
    if (info && !info.isDirectory()) throw new Error('Expected a hosting data directory: ' + directory);
    return !!info;
  };
  if (await exists(data)) return data;
  const legacy = path.join(root, '.build', 'hosting-data');
  const stage = await mkdtemp(path.join(parent, 'hosting-migration-'));
  try {
    if (await exists(legacy)) await cp(legacy, stage, {
      recursive: true, filter: async source => {
        if ((await lstat(source)).isSymbolicLink()) throw new Error('Redirected legacy hosting data: ' + source);
        return true;
      },
    });
    await rename(stage, data);
  } finally {
    await rm(stage, {recursive: true, force: true});
  }
  return data;
}

/** Publish the whole legacy journal directory only after every copy succeeds. */
export async function windowsPartyStorage(root: string, localAppData: string) {
  const installation = (await realpath(root)).toLowerCase();
  const id = createHash('sha256').update(installation).digest('hex').slice(0, 16);
  const parent = path.join(localAppData, 'AdventureLandPartyConsole', 'instances', id);
  return preparePartyStorage(root, parent, true);
}

/** An older packaged updater launches the new version before it releases the startup hold. */
export async function preparePackagedStorage(root: string, data: string, home: string) {
  const transaction = path.join(data, 'updates/transaction.json');
  if (await optionalInfo(transaction)) {
    const {previous, target} = JSON.parse(await readFile(transaction, 'utf8'));
    if (previous !== target && path.relative(contained(home, target), root) === '') {
      const oldRoot = contained(home, previous);
      if (await optionalInfo(path.join(oldRoot, '.caracal/localStorage'))) await preparePartyStorage(oldRoot, data);
    }
  }
  return preparePartyStorage(root, data);
}

/** Every version uses this installation's data directory, including a replacement container. */
export async function preparePartyStorage(root: string, parent: string, previouslyAuthoritative = false) {
  const storage = path.join(parent, 'localStorage');
  await mkdir(parent, {recursive: true});
  const existing = await optionalInfo(storage);
  const journal = path.join(storage, 'caraGarage.jsonl');
  const marker = path.join(parent, 'established-journal');
  if (path.relative(parent, await realpath(parent)) || (existing && !existing.isDirectory()))
    throw new Error('Refusing redirected party storage: ' + storage);
  const current = await optionalInfo(journal);
  if (current && !current.isFile()) throw new Error('Expected a regular journal: ' + journal);
  if (previouslyAuthoritative && current?.size) {
    await writeFile(marker, 'caraGarage.jsonl\n');
    return storage;
  }
  if (await optionalInfo(marker)) {
    if (!current?.size) throw new Error('Established party journal is missing or empty. Restore it before startup: ' + journal);
    return storage;
  }
  const legacy = path.join(root, '.caracal', 'localStorage');
  const link = await optionalInfo(legacy);
  const same = link?.isSymbolicLink() && path.resolve(path.dirname(legacy), await readlink(legacy)) === storage;
  const entries = !link || same ? [] : await readdir(legacy, {withFileTypes: true});
  for (const entry of entries) {
    if (entry.name.endsWith('.writer.lock') && processLockActive(await readFile(path.join(legacy, entry.name), 'utf8')))
      throw new Error('Stop the previous coordinator before migrating its journal');
  }
  const saved = entries.filter(entry => !entry.name.endsWith('.lock') && !entry.name.endsWith('.guard'));
  const destination = existing ? await readdir(storage) : [];
  if (saved.length && destination.length) {
    // A previous copy may have completed just before the host wrote the marker.
    for (const entry of saved) {
      const file = path.join(storage, entry.name);
      if (!entry.isFile() || !(await optionalInfo(file))?.isFile() ||
          !(await readFile(file)).equals(await readFile(path.join(legacy, entry.name))))
        throw new Error('Conflicting party storage. Reconcile both directories before startup: ' + legacy + ' and ' + storage);
    }
  }
  if (!saved.length || destination.length) {
    await mkdir(storage, {recursive:true});
    if (current?.size) await writeFile(marker, 'caraGarage.jsonl\n');
    return storage;
  }
  const stage = await mkdtemp(path.join(parent, 'migration-'));
  try {
    for (const entry of entries) {
      if (entry.isSymbolicLink())
        throw new Error('Cannot migrate a redirected local storage entry: ' + entry.name);
      if (!entry.isFile()) throw new Error('Unexpected local storage entry: ' + entry.name);
      if (entry.isFile() && !entry.name.endsWith('.lock') && !entry.name.endsWith('.guard'))
        await copyFile(path.join(legacy, entry.name), path.join(stage, entry.name));
    }
    if (existing) await rmdir(storage); // Only an empty precreated destination can reach here.
    await rename(stage, storage);
    if ((await optionalInfo(journal))?.size) await writeFile(marker, 'caraGarage.jsonl\n');
  } finally {
    await rm(stage, {recursive: true, force: true});
  }
  return storage;
}

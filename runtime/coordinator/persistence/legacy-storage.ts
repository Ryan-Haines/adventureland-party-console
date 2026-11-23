import {isDeepStrictEqual} from 'node:util';

interface MigrationPorts {
  read: (path: string) => string;
  remove: (path: string) => void;
  info: (details: { type: string; path: string; value?: number }, message: string) => void;
}
interface MigrationStorage {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => unknown;
}

/** Delete the old single-file store only after every entry has been transferred. */
export function migrateCoordinatorLegacyStorage(
  path: string,
  storage: MigrationStorage,
  ports: MigrationPorts,
): void {
  let contents: string;
  try {
    contents = ports.read(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    ports.info({ type: "ls_migration_none", path }, "localStorage migration unnecessary");
    return;
  }
  if (contents.length > 0) {
    const parsed = JSON.parse(contents) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid legacy storage object: ' + path);
    const missing = [];
    for (const [key, value] of Object.entries(parsed)) {
      const current = storage.get(key);
      if (current === undefined) missing.push([key, value] as const);
      else if (!isDeepStrictEqual(current, value)) throw new Error('Legacy storage conflicts with the journal at key ' + key + ': ' + path);
    }
    for (const [key, value] of missing) storage.set(key, value);
    ports.info(
      { type: "ls_migration", path, value: Object.keys(parsed).length },
      "localStorage migrated",
    );
  }
  ports.remove(path);
  ports.info({ type: "ls_migration_done", path }, "old localStorage deleted");
}

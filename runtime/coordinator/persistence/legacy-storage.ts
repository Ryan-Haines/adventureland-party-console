interface MigrationPorts {
  read: (path: string) => string;
  remove: (path: string) => void;
  info: (details: { type: string; path: string; value?: number }, message: string) => void;
}
interface MigrationStorage {
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
  } catch {
    ports.info({ type: "ls_migration_none", path }, "localStorage migration unnecessary");
    return;
  }
  if (contents.length > 0) {
    const parsed = JSON.parse(contents) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) storage.set(key, value);
    ports.info(
      { type: "ls_migration", path, value: Object.keys(parsed).length },
      "localStorage migrated",
    );
  }
  ports.remove(path);
  ports.info({ type: "ls_migration_done", path }, "old localStorage deleted");
}

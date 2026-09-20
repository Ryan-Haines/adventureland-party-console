export interface KeyValueStorage {
  get(key: string): unknown;
  set(key: string, value: string): void;
}

export interface StoredState<T> {
  key: string;
  decode(value: unknown): T;
  empty(): T;
}

export interface PersistenceLog {
  invalid(key: string, error: unknown): void;
}

/** Serialization is explicit so runtime handles can never accidentally be saved. */
export function createJsonStore(storage: KeyValueStorage, log: PersistenceLog) {
  return {
    read<T>(state: StoredState<T>): T {
      try {
        // JSON.parse performs the legacy runtime coercion itself. This assertion
        // satisfies its string-only TypeScript signature without sanitizing values.
        return state.decode(JSON.parse((storage.get(state.key) || "{}") as string));
      } catch (error) {
        log.invalid(state.key, error);
        return state.empty();
      }
    },
    write<T>(state: Pick<StoredState<T>, "key">, snapshot: T): void {
      storage.set(state.key, JSON.stringify(snapshot));
    },
  };
}

import type { createCoordinatorCharacterServices } from "../characters/composition.ts";
import type { createRosterProjection } from "../characters/roster-projection.ts";
import type { startCoordinatorWebServices } from "../http/web-services.ts";
import type { CharacterBlock } from "../characters/types.ts";

/** JSONL storage shared with character workers; values are not restricted to strings. */
export interface CoordinatorFileStore {
  get(key: string): unknown;
  set(key: string, value: unknown): this;
  delete(key: string): boolean;
  entries(): IterableIterator<[string, unknown]>;
  close(): void;
}

export interface CoordinatorFileStoreConstructor {
  new (
    mainPath?: string,
    replacementPath?: string,
    refactorInterval?: number,
  ): CoordinatorFileStore;
}

/** Only the installed caracAL constants consumed by the coordinator. */
export interface CoordinatorConstants {
  LOCALSTORAGE_PATH: string;
  LOCALSTORAGE_ROTA_PATH: string;
  STAT_BEAT_INTERVAL: number;
}

/** Preserve caracAL's structured logger and its console facade. */
export interface CoordinatorLogging {
  log: {
    info(details: unknown, message: string): void;
    warn(details: unknown, message: string): void;
  };
  console: Pick<Console, "log" | "warn" | "error">;
  ctype_to_clid: Readonly<Record<string, number>>;
}

type CharacterServicesInput = Parameters<typeof createCoordinatorCharacterServices>[0];
type CharacterAccount = CharacterServicesInput["accountSource"];

/** caracAL account adapter; response is replaced by account refresh and creation. */
export interface CoordinatorAccount extends CharacterAccount {
  response: ReturnType<Parameters<typeof createRosterProjection>[1]>;
  add_listener: (callback: (response: unknown) => void) => void;
}

/** Supported launcher configuration after caracAL has loaded its config module. */
export interface CoordinatorConfiguration {
  merchant?: string | null;
  characters: Record<string, CharacterBlock>;
  cull_versions?: boolean;
  session?: string;
  enable_TYPECODE: boolean;
  watch_CODE: boolean;
  web_app: NonNullable<Parameters<typeof startCoordinatorWebServices>[0]>;
}

/** Filesystem game cache API used by the launcher and lazy catalog loaders. */
export interface CoordinatorGameFiles {
  ensure_latest: () => Promise<number>;
  refresh_latest?: (force?: boolean) => Promise<{version: number; revision: string}>;
  get_revision?: (version: number) => Promise<string>;
  cull_versions: (exclusions: number[]) => Promise<unknown>;
  available_versions: () => Promise<number[]>;
  locate_game_file: (resource: string, version: number | undefined) => string;
}

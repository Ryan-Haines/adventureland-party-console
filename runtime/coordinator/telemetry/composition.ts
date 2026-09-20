import { createMapStreams } from "./map-stream.ts";
import { createCombatLogRoutes, type StoredCombatLogEntry } from "./combat-log.ts";
import { createMapDefinitions } from "./maps.ts";
import { createCoordinatorGameData } from "../infrastructure/game-data.ts";

interface TelemetryPorts<Timer> {
  owned: (name: string) => unknown;
  now: () => number;
  persistHistory: () => void;
  every: (callback: () => void, milliseconds: number) => Timer;
  cancel: (timer: Timer) => void;
  data: Parameters<typeof createCoordinatorGameData>[2];
}

/** Map streams and combat history share ownership checks; game data stays lazy and cached. */
export function createCoordinatorTelemetry<Timer>(
  directory: string,
  version: string | number,
  logs: Record<string, StoredCombatLogEntry[]>,
  ports: TelemetryPorts<Timer>,
) {
  const owned = (name: string) => !!ports.owned(name);
  const maps = createMapStreams({
    owned,
    definition: (name) => definitions.get(name),
    every: ports.every,
    cancel: ports.cancel,
  });
  const combat = createCombatLogRoutes(logs, {
    owned,
    now: ports.now,
    persist: ports.persistHistory,
  });
  let definitions = createMapDefinitions(() => data.load());
  let data = createCoordinatorGameData(directory, version, ports.data);
  function prepareVersion(next: number) {
    const candidate = createCoordinatorGameData(directory, next, ports.data);
    const catalog = candidate.load();
    if (!catalog.geometry) throw Error('Candidate game data has no geometry');
    const nextDefinitions = createMapDefinitions(() => candidate.load());
    return () => { data = candidate; definitions = nextDefinitions; };
  }
  return { maps, combat, prepareVersion };
}

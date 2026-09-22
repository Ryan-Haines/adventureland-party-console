import { resolveABStrategy, type ABReport, type ABStrategy } from "./abtesting.ts";

interface Status extends ABReport {
  seenAt: number;
}
interface StrategyState {
  statuses: Record<string, Status>;
  abtestingStrategy: ABStrategy | null;
  merchantCharacter: string | null;
}

export function activeCoordinatorNames(
  statuses: Record<string, { name: string; seenAt: number }>,
  now: number,
): string[] {
  const cutoff = now - 10000;
  return Object.values(statuses)
    .filter((entry) => entry.seenAt >= cutoff)
    .map((entry) => entry.name);
}

/** Persist only changes in the resolved strategy, retaining the existing serialized equality check. */
export function updateCoordinatorABStrategy(
  state: StrategyState,
  ports: {
    activeNames: () => string[];
    enabled: (name: string, event: string) => boolean;
    now: () => number;
    persist: () => void;
  },
): ABStrategy | null {
  const previousSerialized = JSON.stringify(state.abtestingStrategy);
  const participants = ports
    .activeNames()
    .filter((name) => ports.enabled(name, "abtesting"));
  state.abtestingStrategy = resolveABStrategy(
    state.abtestingStrategy,
    participants,
    state.statuses,
    ports.now(),
  );
  if (JSON.stringify(state.abtestingStrategy) !== previousSerialized) ports.persist();
  return state.abtestingStrategy;
}

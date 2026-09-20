import { readInitialCoordinatorSnapshots } from "./persistence/initial-snapshots.ts";
import { initialHeadlessSlots } from "./characters/initial-roster.ts";
import { createInitialCoordinatorState } from "./initial-state.ts";

type InitialInput = Parameters<typeof createInitialCoordinatorState>[0];
type SavedInput = Omit<InitialInput, "initialHeadless" | "configuredRealm">;
type InitializationPorts<Merchant extends string | null> = Parameters<
  typeof createInitialCoordinatorState<Merchant>
>[1] & {
  warn: Parameters<typeof readInitialCoordinatorSnapshots>[1];
};

/** Read legacy snapshots before selecting slots and constructing state in its established evaluation order. */
export function initializeCoordinatorState<Merchant extends string | null = string>(
  storage: Parameters<typeof readInitialCoordinatorSnapshots>[0],
  workers: Parameters<typeof initialHeadlessSlots>[1],
  configuredRealm: string,
  ports: InitializationPorts<Merchant>,
) {
  // The legacy persistence boundary accepts arbitrary JSON. Domain initializers retain
  // their existing coercion/failure behavior; do not sanitize or clone snapshots here.
  const saved = readInitialCoordinatorSnapshots(storage, ports.warn) as SavedInput;
  const initialHeadless = initialHeadlessSlots(saved.persistedRoster, workers);
  const party = createInitialCoordinatorState<Merchant>(
    { ...saved, initialHeadless, configuredRealm },
    ports,
  );
  return { party, persistedSettings: saved.persistedSettings };
}

import { createFarmAreaNavigation } from "./farm-areas.ts";
import type { FarmNavigationPorts, FarmNavigationState } from "./farm-area-types.ts";
import type { Catalog } from "../../../dashboard/lib/farming-zones.ts";

interface FarmingState extends FarmNavigationState {
  monsterChoices?: Catalog | null;
}
type CompositionPorts = Omit<FarmNavigationPorts, "areas" | "resolve" | "record" | "eventOwns"> & {
  areas: (catalog: Catalog, ids: string[]) => ReturnType<FarmNavigationPorts["areas"]>;
  resolve: (
    catalog: Catalog,
    ...args: Parameters<FarmNavigationPorts["resolve"]>
  ) => ReturnType<FarmNavigationPorts["resolve"]>;
  record: (
    state: Parameters<FarmNavigationPorts["record"]>[0],
    reports: Parameters<FarmNavigationPorts["record"]>[1],
    workers: string[],
    areas: ReturnType<FarmNavigationPorts["areas"]>,
    now: number,
  ) => void;
  eventOwns: (
    hunt: Parameters<FarmNavigationPorts["eventOwns"]>[0],
    state: FarmingState,
  ) => boolean;
};

/** Resolve farming zones and observe traffic against the current catalog and worker roster. */
export function createCoordinatorFarmNavigation(
  state: FarmingState,
  workers: Record<string, unknown>,
  ports: CompositionPorts,
) {
  return createFarmAreaNavigation(state, {
    ...ports,
    areas: (ids) => ports.areas(state.monsterChoices || [], ids),
    resolve: (ids, location) => ports.resolve(state.monsterChoices || [], ids, location),
    record: (areaState, reports, areas, now) =>
      ports.record(areaState, reports, Object.keys(workers), areas, now),
    eventOwns: (hunt) => ports.eventOwns(hunt, state),
  });
}

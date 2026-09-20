import { createCoordinatorRealmSwitch } from "../characters/realm-composition.ts";
import { createRealmRoutes } from "./realms.ts";

type RealmState = Parameters<typeof createCoordinatorRealmSwitch>[0] &
  Parameters<typeof createRealmRoutes>[0];
type RealmPorts = Omit<Parameters<typeof createCoordinatorRealmSwitch>[1], "dispatchMerchant"> &
  Omit<Parameters<typeof createRealmRoutes>[1], "run">;

/** Realm HTTP controls dispatch through the same operation service and merchant resumption callback. */
export function createCoordinatorRealmActions(state: RealmState, ports: RealmPorts) {
  const switching = createCoordinatorRealmSwitch(state, {
    ...ports,
    dispatchMerchant: () => ports.dispatch(),
  });
  return createRealmRoutes(state, { ...ports, run: async (operation) => switching.run(operation) });
}

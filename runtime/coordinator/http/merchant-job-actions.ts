import { createMerchantProgressRoutes } from "./merchant-progress.ts";
import { createMarketplaceProgressRoutes } from "./marketplace-progress.ts";
import { createMerchantClusterRoutes } from "./merchant-clusters.ts";
import { createMerchantRealmRoutes } from "./merchant-realms.ts";
import { createMarketplaceLocationRoute } from "./marketplace-location.ts";

type JobState = Parameters<typeof createMerchantProgressRoutes>[0] &
  Parameters<typeof createMarketplaceProgressRoutes>[0] &
  Parameters<typeof createMerchantClusterRoutes>[0] &
  Parameters<typeof createMerchantRealmRoutes>[0] &
  Parameters<typeof createMarketplaceLocationRoute>[0] & { nextCommandId: number };
type LocationPorts = Parameters<typeof createMarketplaceLocationRoute>[1];
type RealmBlock = Parameters<Parameters<typeof createMerchantRealmRoutes>[1]["restart"]>[0];
type JobPorts<Block extends RealmBlock> = Parameters<typeof createMerchantProgressRoutes>[1] &
  Parameters<typeof createMarketplaceProgressRoutes>[1] &
  Omit<Parameters<typeof createMerchantClusterRoutes>[1], "nextCommand"> &
  Omit<Parameters<typeof createMerchantRealmRoutes<Block>>[1], "restart"> & {
    fetchMarket: (path: string) => Promise<unknown>;
    normalizePurchases: (
      records: Parameters<LocationPorts["normalize"]>[0],
    ) => ReturnType<LocationPorts["normalize"]>;
    normalizeSales: (
      records: Parameters<LocationPorts["normalize"]>[0],
    ) => ReturnType<LocationPorts["normalize"]>;
    stop: (block: Block) => Promise<unknown>;
    later: (callback: () => Promise<unknown>, milliseconds: number) => unknown;
  };

/** Bind job reports to the current merchant state, command sequence and deferred worker restart. */
export function createCoordinatorMerchantJobActions<Block extends RealmBlock>(
  state: JobState,
  ports: JobPorts<Block>,
) {
  const progress = createMerchantProgressRoutes(state, ports);
  const marketplace = createMarketplaceProgressRoutes(state, ports);
  const clusters = createMerchantClusterRoutes(state, {
    ...ports,
    nextCommand: () => state.nextCommandId++,
  });
  const realms = createMerchantRealmRoutes(state, {
    ...ports,
    restart: (block, delay) => ports.later(() => ports.stop(block), delay),
  });
  const location = createMarketplaceLocationRoute(state, {
    fetch: () => ports.fetchMarket("/merchants"),
    normalize: (records, sale) =>
      sale ? ports.normalizeSales(records) : ports.normalizePurchases(records),
    persist: () => ports.persist(),
    log: (message, level, details) => ports.log(message, level, details),
  });
  return { progress, marketplace, clusters, realms, location };
}

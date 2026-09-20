import { createAnniversaryVisitRoutes } from "./anniversary-visits.ts";
import { createAnniversaryNavigationRoutes } from "./anniversary-navigation.ts";
import { createAnniversaryCommerceRoutes } from "./anniversary-commerce.ts";
import { createAnniversarySuppliesRoute } from "./anniversary-supplies.ts";
import type { HuntCycle } from "../hunt/contracts.ts";

type VisitPorts = Parameters<typeof createAnniversaryVisitRoutes>[1];
type NavigationPorts = Parameters<typeof createAnniversaryNavigationRoutes>[1];
type CommercePorts = Parameters<typeof createAnniversaryCommerceRoutes>[1];
type SuppliesPorts = Parameters<typeof createAnniversarySuppliesRoute>[1];
type AnniversaryState = Parameters<typeof createAnniversaryVisitRoutes>[0] &
  Parameters<typeof createAnniversaryNavigationRoutes>[0] &
  Parameters<typeof createAnniversaryCommerceRoutes>[0];
type ActionState = Parameters<typeof createAnniversarySuppliesRoute>[0] & {
  anniversaryAutoChat?: boolean;
  anniversary: AnniversaryState;
  nextCommandId: number;
  leader: string | null;
  monsterHunt: HuntCycle | null;
  activeConvoy: ReturnType<NavigationPorts["convoy"]>;
  location: ReturnType<NavigationPorts["location"]>;
  statuses: Record<string, { items?: ReturnType<CommercePorts["merchantItems"]> } | undefined>;
};
type ActionPorts = Omit<
  VisitPorts & NavigationPorts & CommercePorts,
  | "merchant"
  | "leader"
  | "revision"
  | "huntOwns"
  | "convoy"
  | "location"
  | "nextCommand"
  | "merchantItems"
  | "enabled"
> & {
  enabled: (name: string, event: string) => boolean;
  intent: (name: string) => { revision: number };
  huntOwns: (hunt: HuntCycle | null) => boolean;
  counts: SuppliesPorts["counts"];
  persistBank: SuppliesPorts["persist"];
  merchantLog: SuppliesPorts["log"];
};

/** Share anniversary request dependencies while retaining current party navigation and merchant ownership. */
export function createCoordinatorAnniversaryActions(state: ActionState, ports: ActionPorts) {
  const common = {
    ...ports,
    merchant: () => state.merchantCharacter,
    revision: (name: string) => ports.intent(name).revision,
  };
  const visits = createAnniversaryVisitRoutes(state.anniversary, {
    ...common,
    enabled: (name) => ports.enabled(name, "anniversary"),
  });
  const navigation = createAnniversaryNavigationRoutes(state.anniversary, {
    ...common,
    leader: () => state.leader,
    huntOwns: () => ports.huntOwns(state.monsterHunt),
    convoy: () => state.activeConvoy,
    location: () => state.location,
  });
  const commerce = createAnniversaryCommerceRoutes(state.anniversary, {
    autoChat: () => state.anniversaryAutoChat === true,
    ...common,
    nextCommand: () => state.nextCommandId++,
    merchantItems: () => state.statuses[String(state.merchantCharacter)]?.items,
  });
  const supplies = createAnniversarySuppliesRoute(state, {
    counts: ports.counts,
    persist: ports.persistBank,
    log: ports.merchantLog,
  });
  return { visits, navigation, commerce, supplies };
}

import { createManualNavigationCommands } from "./manual-commands.ts";
import type { ManualNavigationState, ManualNavigationPorts } from "./manual-commands.ts";
import { authorizeCoordinatorFarmingRoute } from "./runtime.ts";
import type { CharacterBlock } from "../characters/types.ts";

type RecoveryState = Parameters<typeof authorizeCoordinatorFarmingRoute>[0];
type NavigationState = ManualNavigationState & RecoveryState & { nextCommandId: number };
type BasePorts = Pick<
  ManualNavigationPorts,
  "now" | "queue" | "convoy" | "block" | "realmLabel" | "log" | "persist"
>;
interface CompositionPorts extends BasePorts {
  releaseEscape: () => void;
  navigation: {
    authorize: (names: string[], location: unknown, shared?: boolean) => void;
    members: () => string[];
    invalidate: (names: string[], reason: string, shared: boolean) => void;
  };
  resolveRealm: (realm: string) => unknown;
  stop: (block: CharacterBlock) => Promise<unknown>;
  later: (callback: () => Promise<unknown>, milliseconds: number) => unknown;
}

/** Route manual commands through the same live navigation ownership and recovery reset. */
export function createCoordinatorManualNavigation(state: NavigationState, ports: CompositionPorts) {
  return createManualNavigationCommands(state, {
    now: () => ports.now(),
    nextCommand: () => state.nextCommandId++,
    queue: (names, reason) => ports.queue(names, reason),
    releaseEscape: ports.releaseEscape,
    authorize: (names, location) => ports.navigation.authorize(names, location),
    authorizeRoute: (names, location, shared) =>
      authorizeCoordinatorFarmingRoute(state, names, location, shared, {
        release: ports.releaseEscape,
        authorize: (members, destination, grouped) =>
          ports.navigation.authorize(members, destination, grouped),
      }),
    members: () => ports.navigation.members(),
    convoy: (location, label) => ports.convoy(location, label),
    invalidate: (names, reason, shared) => ports.navigation.invalidate(names, reason, shared),
    block: (name) => ports.block(name),
    realmExists: (realm) => !!ports.resolveRealm(realm),
    realmLabel: (realm) => ports.realmLabel(realm),
    restart: (block, delay) => {
      ports.later(() => ports.stop(block), delay);
    },
    log: (message, level) => ports.log(message, level),
    persist: () => ports.persist(),
  });
}

import type { NavigationIntent } from "../navigation/selection-contracts.ts";
import type { ReturnLocation, ReturnOwner, Waypoints } from "../events/return-types.ts";
import type { MerchantCommand } from "../merchant/work.ts";
import type { StoredCombatLogEntry } from "../telemetry/combat-log.ts";

type NavigationOwner = Partial<ReturnOwner>;

export interface CommandOwnershipPlatform {
  (state: {
    commands: Record<string, MerchantCommand | undefined>;
    combatLogs: Record<string, StoredCombatLogEntry[]>;
  }): {
    clear(name: string, matches: (command: MerchantCommand) => boolean): void;
  };
}

/** Return owners retain their identity; capture copies only the waypoint coordinates. */
export interface FarmingNavigation {
  intent(name: string | null): NavigationIntent;
  members(): string[];
  waypoint(name: string | null): ReturnLocation | null;
  capture(names?: string[]): Waypoints;
  location(owner: Pick<ReturnOwner, "waypoints">, name: string): ReturnLocation | null;
  at(name: string, destination: ReturnLocation | null | undefined): boolean;
  finish(owner: NavigationOwner, reason: string): void;
  releaseReturn(owner: NavigationOwner): boolean;
  invalidate(names: string[], reason: string, shared?: boolean): void;
  /** Legacy authorization copies the supplied value with object spread, without validation. */
  authorize(names: string[], destination: unknown, shared?: boolean): void;
  dispatch(owner: NavigationOwner, purpose: string, names: string[]): boolean;
  reconcile(owner: NavigationOwner, purpose: string): boolean;
  supersede(owner: NavigationOwner | null | undefined): void;
}

interface FarmingNavigationState {
  navigationIntents?: Record<string, NavigationIntent | undefined> | null;
  merchantCharacter: string | null;
  leader: string | null;
  followers: Record<string, boolean>;
  characterLocations: Record<string, ReturnLocation | undefined>;
  location: ReturnLocation | null;
  statuses: Record<string, unknown>;
  commands: Record<string, MerchantCommand | undefined>;
  nextCommandId: number;
  deferredEventReturns: Record<string, unknown>;
  eventSessions: Record<string, unknown>;
  anniversary: { eventCycle?: NavigationOwner | null };
}

export interface CreateFarmingNavigation {
  (
    state: FarmingNavigationState,
    hooks: {
      now?: () => number;
      names: () => string[];
      activeNames: () => string[];
      cancelConvoy: () => unknown;
      startConvoy: (
        destination: ReturnLocation,
        label: string,
        participants: string[],
        purpose?: string | null,
      ) => boolean;
      persist: () => void;
      log: (message: string, level: string) => void;
    },
  ): FarmingNavigation;
}

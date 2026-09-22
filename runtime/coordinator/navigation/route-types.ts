import type { ReturnLocation } from "../events/return-types.ts";
import type { StoredCombatLogEntry } from "../telemetry/combat-log.ts";
import type { HuntCycle } from "../hunt/contracts.ts";
export interface RouteConvoy {
  continuousReturn?: number;
  returnTown?: import('./return-town.ts').ReturnTownPolicy;
  disableTown?: boolean;
  townRetry?: boolean;
  townRetryAt?: number;
  huntTarget?: string;
  location?: ReturnLocation;
  routeProtocol?: number;
  id: string;
  phase: string;
  purpose?: string | null;
  participants: string[];
  completed?: string[];
  departAt?: number | null;
  failureDetails?: unknown;
}
export interface NavigationStatus {
  seenAt: number;
  x?: number;
  y?: number;
  in?: string | number;
  map?: string;
  activeEvent?: string;
  joinedEvent?: string;
  mapEvent?: string;
  target?: { target?: string } | null;
  threats?: { target?: string }[];
  combat?: { lastAttackAt?: number };
}
export interface NavigationGroup {
  ready: boolean;
  anchor?: { map?: string } | null;
  blockers: string[];
  key: string;
  selection: string | null;
  members: string[];
}
export interface NavigationRouteState {
  phoenixPatrolActive?: boolean;
  rareHuntState?: { encounter?: unknown } | null;
  eventReturn?: unknown;
  farmAreaState?: { pending?: unknown };
  anniversary?: { eventCycle?: { returnCompletedAt?: number; supersededAt?: number; combatHandoffAt?: number; endsAt?: number } | null };
  leader: string | null;
  merchantCharacter: string | null;
  activeConvoy: RouteConvoy | null;
  partyFarmingMode: string;
  farmingPolicy: string;
  monsterHunt: HuntCycle | null;
  monsterFocus: string[];
  monsterSearchRadiusByCharacter: Record<string, number | undefined>;
  statuses: Record<string, NavigationStatus | undefined>;
  location: ReturnLocation | null;
  farmingReturnRequestedAt?: number;
  combatLogs: Record<string, StoredCombatLogEntry[] | undefined>;
}
export interface NavigationRoutePorts {
  now(): number;
  owned(name: string): unknown;
  intent(name: string): { revision: number; cancelled?: boolean };
  group(): NavigationGroup | null;
  huntOwns(): boolean;
  engage(
    body: Record<string, unknown>,
    options: { revisions: Record<string, number>; radius: number; focus: string[] },
  ): boolean;
  acceptArrival(convoy: RouteConvoy, body: Record<string, unknown>, now: number): boolean;
  persist(): void;
  waypoint(name: string): ReturnLocation | null;
  contains(
    area: ReturnLocation,
    destination: ReturnLocation,
    margin: number,
    radius: number,
  ): boolean;
  start(destination: ReturnLocation, label: string, names: string[], purpose: string): boolean;
  active(): string[];
  members(): string[];
}

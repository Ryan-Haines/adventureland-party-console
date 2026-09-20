import type { HuntCycle, HuntStatus } from "../hunt/contracts.ts";
import type { ReturnLocation } from "../events/return-types.ts";
import type { RouteConvoy } from "../navigation/route-types.ts";
import type { createCoordinatorFarmNavigation } from "../navigation/farm-composition.ts";

type FarmPorts = Parameters<typeof createCoordinatorFarmNavigation>[2];

/** Shared area observations and ranking used by ordinary farming and Hunt travel. */
export type FarmAreaControlPlatform = Pick<FarmPorts, "record" | "alternatives" | "fighting">;

/** Hunt safety mutates the current mission and retains the existing resolver result. */
export interface HuntSafetyPlatform {
  missionDestination(
    hunt: HuntCycle,
    resolve: (target: string | null) => ReturnLocation | null | undefined,
  ): ReturnLocation | null | undefined;
  recordDeaths(
    hunt: HuntCycle,
    statuses: Record<string, HuntStatus | undefined>,
    now: number,
  ): string[];
  partyFighting(
    hunt: HuntCycle,
    statuses: Record<string, HuntStatus | undefined>,
    now: number,
  ): boolean;
  arrivalProtected(
    hunt: HuntCycle,
    leader: string | null,
    status: HuntStatus | undefined,
    intent: { revision: number; cancelled?: boolean },
    destination: ReturnLocation | null | undefined,
    now: number,
  ): boolean;
  acceptArrival(
    hunt: HuntCycle | null,
    convoy: RouteConvoy,
    body: Record<string, unknown>,
    now: number,
  ): boolean;
}

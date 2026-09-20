import { migratePassiveSettings, type PassiveSettings } from "./passive-settings.ts";
import type { HuntCycle, HuntTickState } from "../hunt/contracts.ts";
import type { ReturnLocation } from "../events/return-types.ts";
import type { FarmAreaState } from "./farm-area-types.ts";

import {defaultHuntSettings, migrateHuntFailures, type HuntFailureState} from "../hunt/settings.ts";
interface SavedFarming extends HuntFailureState {
  farmingProfiles?: import("../hunt/scopes.ts").FarmingProfiles;
  monsterHunt?: HuntCycle | null;
  passiveHunting?: PassiveSettings | null;
  passiveRareHunts?: Record<string, boolean> | null;
  phoenixRouteOrder?: string[] | null;
  phoenixPatrolActive?: unknown;
  phoenixPatrolCheckpoint?: import("./rare-types.ts").Checkpoint | null;
  rareHuntReturn?: unknown;
  farmAreaState?: FarmAreaState | null;
  huntBlacklist?: HuntTickState["huntBlacklist"] | null;
}

/** Restore durable Hunt/rare intent while rebuilding scatter decisions from fresh character reports. */
export function initialFarmingState(saved: SavedFarming, now: () => number) {
  return {
    farmingProfiles: saved.farmingProfiles || {},
    huntSettings: {...defaultHuntSettings, ...saved.huntSettings},
    huntFailures: migrateHuntFailures(saved),
    monsterHunt: saved.monsterHunt || null,
    passiveHunting: migratePassiveSettings(saved.passiveHunting,saved.passiveRareHunts || {}),
    passiveRareHunts: saved.passiveRareHunts || {},
    phoenixRouteOrder: saved.phoenixRouteOrder || [],
    phoenixPatrolActive: !!saved.phoenixPatrolActive,
    phoenixPatrolCheckpoint: saved.phoenixPatrolCheckpoint || null,
    rareHuntReturn: saved.rareHuntReturn || null,
    farmAreaState: saved.farmAreaState || {},
    huntBlacklist: saved.huntBlacklist || {},
    monsterHunterLocation: null as ReturnLocation | null,
    scatterMonsterTypes: [] as string[],
    scatterEpoch: now(),
    partyFarmingMode: "default",
    partyFarmingMonsterType: null as string | null,
    scatterBreakTarget: null,
    scatterPartySignature: "",
  };
}

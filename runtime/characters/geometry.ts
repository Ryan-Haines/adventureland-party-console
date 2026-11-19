import * as farmingZones from "../hunting/api.ts";
(globalThis as unknown as { partyFarmingZones: typeof farmingZones }).partyFarmingZones =
  farmingZones;

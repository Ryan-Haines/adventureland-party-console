import * as farmingZones from "../../dashboard/lib/farming-zones.ts";
(globalThis as unknown as { partyFarmingZones: typeof farmingZones }).partyFarmingZones =
  farmingZones;

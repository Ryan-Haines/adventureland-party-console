// Compatibility entry for upstream caracAL (party-member.js). The upgraded coordinator selects a
// verified class artifact directly, without these loads. caracAL loads shared.js as its own script,
// so the owners install from this bundle first and shared.js reads them when it runs.
import "./owners.ts";
// The settings owner's answer in this realm.
import { partyHooks } from "../hooks/index.ts";
import { installCharacterSettings } from "../settings/character/api.ts";
import { mage, priest, warrior, ranger, rogue, paladin, merchant } from "./turns/api.ts";
import { installRoleRunner } from "../lifecycle/character/roles.ts";
installCharacterSettings(partyHooks());

const roles = { mage, priest, warrior, ranger, rogue, paladin, merchant };
const root = globalThis as unknown as {
  parent: { caracAL: { load_scripts(files: string[]): Promise<void> } };
  __partyReady: Promise<void>;
};
root.__partyReady = root.parent.caracAL
  .load_scripts(["adventure_land/farming-zones.js", "adventure_land/shared.js", "adventure_land/profiles.js"])
  .then(() => { installRoleRunner(roles[character.ctype as keyof typeof roles]).start(); });

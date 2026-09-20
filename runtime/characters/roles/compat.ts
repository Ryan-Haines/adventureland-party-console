import { role as mage } from "../classes/mage.ts";
import { role as priest } from "../classes/priest.ts";
import { role as warrior } from "../classes/warrior.ts";
import { role as ranger } from "../classes/ranger.ts";
import { role as rogue } from "../classes/rogue.ts";
import { role as paladin } from "../classes/paladin.ts";
import { role as merchant } from "../classes/merchant.ts";
import { installRoleRunner } from "./runner.ts";

const roles = { mage, priest, warrior, ranger, rogue, paladin, merchant };
(globalThis as unknown as { partyRoles: typeof roles }).partyRoles = roles;
installRoleRunner(roles[character.ctype]);

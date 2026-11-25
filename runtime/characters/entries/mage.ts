import "../common.ts";
import { mage as role } from "../turns/api.ts";
import { installRoleRunner } from "../../lifecycle/character/roles.ts";
installRoleRunner(role).start();

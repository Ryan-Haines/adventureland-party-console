import "../common.ts";
import { rogue as role } from "../turns/api.ts";
import { installRoleRunner } from "../../lifecycle/character/roles.ts";
installRoleRunner(role).start();

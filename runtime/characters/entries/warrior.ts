import "../common.ts";
import { warrior as role } from "../turns/api.ts";
import { installRoleRunner } from "../../lifecycle/character/roles.ts";
installRoleRunner(role).start();

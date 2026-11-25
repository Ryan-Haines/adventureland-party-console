import "../common.ts";
import { priest as role } from "../turns/api.ts";
import { installRoleRunner } from "../../lifecycle/character/roles.ts";
installRoleRunner(role).start();

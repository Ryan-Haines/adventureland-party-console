import "../common.ts";
import { merchant as role } from "../turns/api.ts";
import { installRoleRunner } from "../../lifecycle/character/roles.ts";
installRoleRunner(role).start();

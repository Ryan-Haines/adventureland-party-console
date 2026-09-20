import "../common.ts";
import { role } from "../classes/warrior.ts";
import { installRoleRunner } from "../roles/runner.ts";
installRoleRunner(role).start();

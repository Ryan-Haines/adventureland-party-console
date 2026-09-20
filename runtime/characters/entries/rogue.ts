import "../common.ts";
import { role } from "../classes/rogue.ts";
import { installRoleRunner } from "../roles/runner.ts";
installRoleRunner(role).start();

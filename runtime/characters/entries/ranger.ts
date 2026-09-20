import "../common.ts";
import { role } from "../classes/ranger.ts";
import { installRoleRunner } from "../roles/runner.ts";
installRoleRunner(role).start();

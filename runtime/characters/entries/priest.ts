import "../common.ts";
import { role } from "../classes/priest.ts";
import { installRoleRunner } from "../roles/runner.ts";
installRoleRunner(role).start();

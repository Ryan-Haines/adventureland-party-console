import "../common.ts";
import { role } from "../classes/merchant.ts";
import { installRoleRunner } from "../roles/runner.ts";
installRoleRunner(role).start();

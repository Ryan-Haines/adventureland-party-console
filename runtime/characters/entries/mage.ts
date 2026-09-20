import "../common.ts";
import { role } from "../classes/mage.ts";
import { installRoleRunner } from "../roles/runner.ts";
installRoleRunner(role).start();

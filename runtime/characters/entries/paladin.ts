import "../common.ts";
import { role } from "../classes/paladin.ts";
import { installRoleRunner } from "../roles/runner.ts";
installRoleRunner(role).start();

import { mkdir, readFile, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {isCoordinatorApplicationLauncher} from "./coordinator-launcher.mts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const target = path.resolve(process.argv[2] || path.join(root, ".caracal"));
export const revision = "234af745d59807be4da49f13430b91980d3e98c9";
function run(command: string, args: string[], cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
await mkdir(target, { recursive: true });
try {
  await readFile(path.join(target, "main.js"));
} catch {
  run("git", ["clone", "https://github.com/numbereself/caracAL.git", target]);
  run("git", ["checkout", "--detach", revision], target);
}
const patch = path.join(root, "patches/caracal-current-api.patch");
const checked = spawnSync("git", ["apply", "--recount", "--check", "--ignore-whitespace", patch], {
  cwd: target,
});
if (checked.status === 0) run("git", ["apply", "--recount", "--ignore-whitespace", patch], target);
else if (!(await supportedCoordinator()))
  throw new Error(
    "Unsupported caracAL checkout: compatibility patch does not apply\n" +
      checked.stderr.toString(),
  );
async function supportedCoordinator():Promise<boolean> {
  const source=await readFile(path.join(target,"standalones/CharacterCoordinator.js"),"utf8");
  return source.includes("party_dashboard") || isCoordinatorApplicationLauncher(source);
}
run(process.execPath, [path.join(root, "tools/caracal/install.mts"), target]);
await mkdir(path.join(target, "CODE"), { recursive: true });
try {
  await symlink(
    path.join(root, "characters"),
    path.join(target, "CODE/adventure_land"),
    process.platform === "win32" ? "junction" : "dir",
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
}

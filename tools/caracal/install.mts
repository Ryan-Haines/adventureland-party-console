import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {isCoordinatorApplicationLauncher} from "./coordinator-launcher.mts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const target = path.resolve(process.argv[2] || path.join(root, ".caracal"));
const stage = path.join(root, ".build/caracal-upgrades", randomUUID());
const files = ["src/CharacterThread.js", "standalones/CharacterCoordinator.js", "game_files.js"];
const originals = new Map<string, string>();
for (const file of files) {
  const content = await readFile(path.join(target, file), "utf8");
  originals.set(file, content);
  await mkdir(path.dirname(path.join(stage, file)), { recursive: true });
  await writeFile(path.join(stage, file), content);
  await writeFile(path.join(stage, file + ".before"), content);
}
async function run(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("caracAL upgrade validation failed")),
    );
  });
}
// The coordinator is replaced wholesale by the maintained launcher. Only the
// separate character runner still needs an upstream compatibility transform.
await run([path.join(root, "tools/caracal/upgrade-runner.mts"), stage]);
// Setup builds the runtime after installation; start-caracal builds it before
// starting the supervisor. Installation itself never executes the application.
const launcher = await readFile(path.join(root, "tools/caracal/CharacterCoordinator.cjs"), "utf8");
if (!isCoordinatorApplicationLauncher(launcher)) throw new Error("Invalid coordinator launcher template");
await writeFile(path.join(stage, "standalones/CharacterCoordinator.js"), launcher);
await writeFile(path.join(stage, "game_files.js"),
  'module.exports = require("../scripts/client-files.cjs");\n');
for (const file of files) await run(["--check", path.join(stage, file)]);
for (const file of files)
  if ((await readFile(path.join(target, file), "utf8")) !== originals.get(file))
    throw new Error("caracAL changed while preparing the upgrade; no hooks installed");

// The launcher calls this only after stopping the old supervisor. All files
// have been transformed and syntax checked before any is replaced.
for (const file of files) {
  const content = await readFile(path.join(stage, file), "utf8");
  if (content === originals.get(file)) continue;
  const destination = path.join(target, file);
  const temporary = destination + "." + randomUUID() + ".tmp";
  await writeFile(temporary, content);
  await rename(temporary, destination);
}
console.log("Validated character runner and TypeScript coordinator launcher installed.");

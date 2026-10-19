// Prepares the pinned ChronAL simulator (https://github.com/MtlSnkAI/chronal) under .build/sim/chronal:
// its checkout at `revision`, its npm dependencies, and the game repositories
// it runs, each at a pinned commit. Re-running is safe; it only repairs what does not match the pins.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const target = path.join(root, ".build/sim/chronal");
const pins: Record<string, string> = JSON.parse(
  readFileSync(path.join(root, "tools/sim/pins.json"), "utf8"),
);
export const revision = pins.chronal;
/** The game ChronAL installs into runtime/app, pinned so a game update can't silently change a simulation. */
export const game = {
  adventureland_mongodb: ["https://github.com/kaansoral/adventureland_mongodb", pins.game],
  common_engine: ["https://github.com/kaansoral/common_engine", pins.common],
  adventureland_secretsandconfig: [
    "https://github.com/kaansoral/adventureland_secretsandconfig",
    pins.config,
  ],
} as const;

function run(command: string, args: string[], cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
}
function output(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `${command} failed (${result.status})`);
  return result.stdout.trim();
}
function pin(directory: string, url: string, commit: string) {
  if (!existsSync(path.join(directory, ".git"))) {
    run("git", ["init", "--quiet", directory]);
    run("git", ["remote", "add", "origin", url], directory);
  }
  if (
    output("git", ["remote", "get-url", "origin"], directory).replace(/\.git$/, "") !==
    url.replace(/\.git$/, "")
  )
    throw new Error(`Unexpected simulator dependency origin: ${directory}`);
  if (output("git", ["status", "--porcelain", "--untracked-files=no"], directory))
    throw new Error(`Refusing dirty simulator dependency: ${directory}`);
  const current = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
    windowsHide: true,
  });
  if (current.status !== 0 || current.stdout.trim() !== commit) {
    run("git", ["fetch", "--depth=1", "origin", commit], directory);
    run("git", ["checkout", "--quiet", "--detach", commit], directory);
  }
}

pin(target, "https://github.com/MtlSnkAI/chronal.git", revision);
if (Number(process.versions.node.split(".")[0]) < 24)
  throw new Error("ChronAL requires Node 24 or newer");
const npm =
  process.env.npm_execpath ||
  path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
const dependencyStamp = path.join(target, "node_modules/.party-sim-lock.sha256");
const lockHash = createHash("sha256")
  .update(readFileSync(path.join(target, "package-lock.json")))
  .digest("hex");
if (!existsSync(dependencyStamp) || readFileSync(dependencyStamp, "utf8") !== lockHash) {
  run(process.execPath, [npm, "ci", "--no-audit", "--no-fund"], target);
  writeFileSync(dependencyStamp, lockHash);
}
for (const [name, [url, commit]] of Object.entries(game))
  pin(path.join(target, "upstream", name), url, commit);
run(process.execPath, [path.join(root, "tools/sim/install.cjs")], target);
console.log("ChronAL ready:", target);

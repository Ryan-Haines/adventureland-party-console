import { build } from "esbuild";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(root, ".build/shared");
// `--check [folder]` builds in memory, publishes nothing, and exits 1 naming each published copy under
// the folder (the console root by default) that differs from its source's build.
const checkAt = process.argv.indexOf("--check");
const checkFolder = process.argv[checkAt + 1];
const checked = checkAt < 0 ? null : checkFolder && !checkFolder.startsWith("--") ? path.resolve(checkFolder) : root;
const stale: string[] = [];
// A checkout with core.autocrlf holds the copies with CRLF line ends; git stores them as the build writes them.
async function compare(file: string, content: string): Promise<void> {
  if ((await readFile(file, "utf8").catch(() => null))?.replaceAll("\r\n", "\n") !== content) stale.push(file);
}
await mkdir(destination, { recursive: true });
const names = [
  "farming-areas",
  "farming-zones",
];
const banner =
  "// Generated from TypeScript. Run npm run build:shared -- --publish; do not edit.\n";

async function publish(file: string, content: string): Promise<void> {
  try {
    if ((await readFile(file, "utf8")) === content) return;
  } catch {
    /* First build. */
  }
  await writeFile(`${file}.tmp`, content);
  await rename(`${file}.tmp`, file);
}

// The farm areas' sources are the hunting owner's zones.ts and areas.ts. The
// published copies keep their names, which the game's CODE files and the coordinator load.
function source(name: string): string {
  if (name === "farming-zones") return "runtime/hunting/zones.ts";
  return "runtime/hunting/areas.ts";
}
function published(name: string): string {
  if (name === "farming-areas") return "runtime/hunting/farming-areas.cjs";
  return `dashboard/lib/${name}.cjs`;
}

for (const name of names) {
  const result = await build({
    entryPoints: [path.join(root, source(name))],
    bundle: true,
    platform: "neutral",
    format: "cjs",
    target: "es2020",
    write: false,
    banner: { js: banner },
  });
  const content = result.outputFiles[0].text;
  if (checked) {
    if (name !== "farming-zones") await compare(path.join(checked, published(name)), content);
    continue;
  }
  await publish(path.join(destination, `${name}.cjs`), content);
  // farming-zones publishes only the browser build below: characters/farming-zones.js is the runner's
  // script and, through its footer, the coordinator's CommonJS module.
  if (process.argv.includes("--publish") && name !== "farming-zones") {
    await publish(path.join(root, published(name)), content);
  }
}

const browser = await build({
  entryPoints: [path.join(root, source("farming-zones"))],
  bundle: true,
  format: "iife",
  globalName: "partyFarmingZones",
  target: "es2020",
  write: false,
  banner: { js: banner },
  footer: {
    js: 'if (typeof module === "object" && module.exports) module.exports = partyFarmingZones; else globalThis.partyFarmingZones = partyFarmingZones;',
  },
});
if (checked) await compare(path.join(checked, "characters/farming-zones.js"), browser.outputFiles[0].text);
else await publish(path.join(destination, "farming-zones.js"), browser.outputFiles[0].text);
if (!checked && process.argv.includes("--publish")) {
  await publish(path.join(root, "characters/farming-zones.js"), browser.outputFiles[0].text);
}
if (stale.length) {
  for (const file of stale) console.error(`${file} differs from its source; run npm run build:shared -- --publish`);
  process.exitCode = 1;
} else console.log(checked ? "Published shared modules match their sources." : "Shared TypeScript modules built successfully.");

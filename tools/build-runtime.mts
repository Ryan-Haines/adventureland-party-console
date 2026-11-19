import { build } from "esbuild";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeInstalled } from "../runtime/hooks/build/installed.mts";

const root = new URL("../", import.meta.url);
// The add-on folders the bundles import.
writeInstalled(fileURLToPath(root));
const destination = new URL(".build/runtime/", root);
// `--check [folder]` builds in memory, publishes nothing, and exits 1 naming each committed bundle in
// the folder's characters/ (the console root by default) that differs from its source's build.
const checkAt = process.argv.indexOf("--check");
const checkFolder = process.argv[checkAt + 1];
const checked = checkAt < 0 ? null : checkFolder && !checkFolder.startsWith("--") ? pathToFileURL(checkFolder + "/") : root;
const stale: string[] = [];
await mkdir(destination, { recursive: true });
async function publish(output: URL, content: string): Promise<void> {
  const prior = await readFile(output, "utf8").catch(() => "");
  if (prior === content) return;
  const temporary = new URL(output.href + ".tmp");
  await writeFile(temporary, content);
  await rename(temporary, output);
}
for (const entry of [
  { source: "lifecycle/index.ts", output: "lifecycle.cjs", browser: false },
  { source: "lifecycle/roster/index.ts", output: "roster.cjs", browser: false },
  { source: "coordinator/targeting/queue.ts", output: "grouped-combat.cjs", browser: false },
  { source: "coordinator/application.ts", output: "coordinator-application.cjs", browser: false },
  { source: "movement/coordinator/planner-worker.ts", output: "movement-planner.cjs", browser: false },
  { source: "lifecycle/roster/entry.ts", output: "steam-bridge.js", browser: true },
  { source: "lifecycle/character/loader.ts", output: "universal-loader.js", browser: true },
  { source: "characters/legacy-entry.ts", output: "party-member.js", browser: true },
  { source: "characters/profiles.ts", output: "profiles.js", browser: true },
]) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("runtime/" + entry.source, root))],
    bundle: true,
    external: entry.browser ? [] : ["alpathfinder"],
    format: entry.browser ? "iife" : "cjs",
    platform: entry.browser ? "browser" : "node",
    target: entry.browser ? "es2022" : "node22",
    write: false,
    sourcemap: entry.source.startsWith("coordinator/") ? "inline" : false,
    banner: {
      js: "// Generated from TypeScript; run npm run build:runtime -- --publish. Do not edit.",
    },
  });
  const content = result.outputFiles[0].text;
  if (checked) {
    const committed = new URL("characters/" + entry.output, checked);
    // A checkout with core.autocrlf holds the copies with CRLF line ends; git stores them as the build writes them.
    const copy = (await readFile(committed, "utf8").catch(() => null))?.replaceAll("\r\n", "\n");
    if (entry.browser && copy !== content) stale.push(fileURLToPath(committed));
    continue;
  }
  await publish(new URL(entry.output, destination), content);
  if (entry.browser && process.argv.includes("--publish"))
    await publish(new URL("characters/" + entry.output, root), content);
}
if (stale.length) {
  for (const file of stale) console.error(`${file} differs from its source; run npm run build:runtime -- --publish`);
  process.exitCode = 1;
}

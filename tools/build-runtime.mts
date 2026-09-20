import { build } from "esbuild";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const destination = new URL(".build/runtime/", root);
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
  { source: "roster/index.ts", output: "roster.cjs", browser: false },
  { source: "hunt/policy.ts", output: "hunt.cjs", browser: false },
  { source: "combat/grouped.ts", output: "grouped-combat.cjs", browser: false },
  { source: "coordinator/navigation/rare-hunting.ts", output: "rare-hunting.cjs", browser: false },
  { source: "coordinator/navigation/convoy-defense.ts", output: "convoy-defense.cjs", browser: false },
  { source: "coordinator/index.ts", output: "coordinator-policies.cjs", browser: false },
  { source: "coordinator/application.ts", output: "coordinator-application.cjs", browser: false },
  { source: "coordinator/navigation/planner-worker.ts", output: "movement-planner.cjs", browser: false },
  { source: "steam/entry.ts", output: "steam-bridge.js", browser: true },
  { source: "characters/universal-loader.ts", output: "universal-loader.js", browser: true },
  { source: "characters/roles/compat.ts", output: "roles.js", browser: true },
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
  await publish(new URL(entry.output, destination), content);
  if (entry.browser && process.argv.includes("--publish"))
    await publish(new URL("characters/" + entry.output, root), content);
}

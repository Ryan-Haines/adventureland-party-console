import { build } from "esbuild";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(root, ".build/shared");
await mkdir(destination, { recursive: true });
const names = [
  "account-inventory",
  "event-policy",
  "compound-cost",
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

for (const name of names) {
  const result = await build({
    entryPoints: [path.join(root, `dashboard/lib/${name}.ts`)],
    bundle: true,
    platform: "neutral",
    format: "cjs",
    target: "es2020",
    write: false,
    banner: { js: banner },
  });
  const content = result.outputFiles[0].text;
  await publish(path.join(destination, `${name}.cjs`), content);
  if (process.argv.includes("--publish")) {
    const relative =
      name === "farming-zones" ? "characters/farming-zones.cjs" : `dashboard/lib/${name}.cjs`;
    await publish(path.join(root, relative), content);
  }
}

const browser = await build({
  entryPoints: [path.join(root, "dashboard/lib/farming-zones.ts")],
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
await publish(path.join(destination, "farming-zones.js"), browser.outputFiles[0].text);
if (process.argv.includes("--publish")) {
  await publish(path.join(root, "characters/farming-zones.js"), browser.outputFiles[0].text);
  await publish(path.join(root, "characters/farming-zones.cjs"), browser.outputFiles[0].text);
}
console.log("Shared TypeScript modules built successfully.");

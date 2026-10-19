// Listing-only allocation audit: every existing scenario must remain selected exactly once.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
type Suite = {
  file?: string;
  title: string;
  suites?: Suite[];
  specs?: Array<{ title: string; file: string; tests: Array<{ projectName: string }> }>;
};
function inventory(native: boolean) {
  const run = spawnSync(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", "--list", "--reporter=json"],
    {
      cwd: root,
      env: { ...process.env, E2E_GAMEPLAY_BACKEND: native ? "native" : "simulation" },
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (run.status !== 0) throw Error(run.stderr || run.stdout);
  const result = JSON.parse(run.stdout) as { suites: Suite[] };
  const rows: Array<{ key: string; project: string; title: string }> = [];
  function walk(s: Suite, parents: string[] = []) {
    const names = [...parents, s.title];
    for (const spec of s.specs || [])
      for (const test of spec.tests)
        rows.push({
          key: `${spec.file}:${[...names, spec.title].join(" > ")}`,
          project: test.projectName,
          title: spec.title,
        });
    for (const child of s.suites || []) walk(child, names);
  }
  for (const suite of result.suites) walk(suite);
  return rows;
}
const native = inventory(true),
  accelerated = inventory(false);
const keys = (rows: typeof native) => rows.map((row) => row.key).sort();
if (JSON.stringify(keys(native)) !== JSON.stringify(keys(accelerated)))
  throw Error("Default selection lost or duplicated existing scenarios");
const out = path.join(root, ".build/sim-validation/selection.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ pass: true, native, accelerated }, null, 2));
console.log(
  `Selection verified: ${native.length} scenarios retained exactly once; ${accelerated.filter((row) => row.project === "live").length} gameplay scenarios use the shared ChronAL fixture by default.`,
);

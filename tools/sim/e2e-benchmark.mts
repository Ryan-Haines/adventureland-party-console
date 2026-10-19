// Compare the same existing gameplay assertions plus unchanged browser/deployment journeys.
import { verifyCodeParity } from "./e2e-code-parity.mts";
import {sourceFingerprint} from '../console-build/builder.ts';
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const focused = process.argv.includes("--focused");
const selection = spawnSync(process.execPath, ["tools/sim/check-selection.mts"], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});
if (selection.status !== 0) throw Error("Full suite selection audit failed");
const inventory = JSON.parse(
  readFileSync(path.join(root, ".build/sim-validation/selection.json"), "utf8"),
) as { native: Array<{ key:string;title: string; project: string }> };
const gameplay: string[] = focused
  ? JSON.parse(readFileSync(path.join(root, "e2e/gameplay-titles.json"), "utf8"))
  : inventory.native.filter((row) => row.project === "live").map((row) => row.title);
const retained = [
  "deployed artifact hash updates below the version without moving the header",
  "reload menu confirms immediate loading and safely deploys the exact selected artifact",
];
const expected = (
  focused ? [...gameplay, ...retained] : inventory.native.map((row) => row.title)
).sort();
const expectedIdentities=focused?undefined:inventory.native.map(row=>`${row.project} > ${row.key.slice(row.key.indexOf(':')+1)}`).sort();
function scenarioIdentity(title:string){
  const parts=title.split(' > ');
  return parts.slice(1).join(' > ');
}
const grep = expected.map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const npm =
  process.env.npm_execpath ||
  path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
const out = path.join(
  root,
  ".build/e2e-benchmarks",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
mkdirSync(out, { recursive: true });
// Both measured runs use prepared dependencies and Docker layers. Otherwise a
// cold debug image build would be mistaken for a gameplay clock improvement.
const preparationStarted = performance.now();
for (const [command, args] of [
  [process.execPath, ["tools/sim/setup.mts"]],
  ...(!focused ? [["docker", ["build", "--target", "debug", "--output=type=cacheonly", "."]]] : []),
] as Array<[string, string[]]>) {
  const prepared = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    timeout: 30 * 60 * 1000,
  });
  if (prepared.status !== 0 || prepared.error)
    throw Error("Benchmark preparation failed: " + command);
}
const preparation = {
  wallMs: performance.now() - preparationStarted,
  dockerCacheWarmed: !focused,
  chronalPrepared: true,
  sourceHash:await sourceFingerprint(root),
};
type Outcome = { title: string; status: string; durationMs: number;identity?:string };
const runs: Array<{ backend: string; wallMs: number; tests: Outcome[] }> = [];
let allocation:string|undefined;
// Validate the default backend before spending hours on native parity. Both
// backends still run the entire identical inventory with the same prepared inputs.
for (const backend of ["accelerated", "native"]) {
  console.log(`[E2E benchmark] ${backend}: ${expected.length} identical journeys`);
  const started = performance.now();
  const env = {
    ...process.env,
    E2E_GAMEPLAY_BACKEND: backend === "native" ? "native" : "simulation",
  };
  const result = spawnSync(
    process.execPath,
    [
      npm,
      "test",
      "--",
      "--",
      ...(focused?["--max-failures=1"]:[]),
      ...(focused ? ["--project=live", "--project=console", "--grep", grep] : []),
    ],
    // The complete native inventory includes 45-minute Cave journeys. Keep
    // Playwright's existing per-test/fixture deadlines as the bounds; an
    // arbitrary command cap can discard an otherwise healthy full baseline.
    { cwd: root, env, stdio: "inherit", windowsHide: true },
  );
  const wallMs = performance.now() - started;
  const archive = path.join(out, backend);
  mkdirSync(path.join(archive, ".build"), { recursive: true });
  for (const directory of ["e2e-report", "e2e-results"])
    cpSync(path.join(root, ".build", directory), path.join(archive, ".build", directory), {
      recursive: true,
    });
  const manifest = JSON.parse(
    readFileSync(path.join(archive, ".build/e2e-report/manifest.json"), "utf8"),
  ) as { tests: Outcome[]; workers:number; dashboardCandidate:{sourceHash:string;components:unknown}; gamePools:unknown };
  if(manifest.dashboardCandidate.sourceHash!==preparation.sourceHash || await sourceFingerprint(root)!==preparation.sourceHash)
    throw Error(`Source changed during ${backend}; evidence retained at ${archive}`);
  const currentAllocation=JSON.stringify({workers:manifest.workers,candidate:manifest.dashboardCandidate.sourceHash,components:manifest.dashboardCandidate.components,pools:manifest.gamePools});
  if(allocation&&allocation!==currentAllocation)throw Error('Benchmark changed worker allocation or dashboard candidate between backends');
  allocation=currentAllocation;
  const tests = manifest.tests.map((test) => ({ ...test,identity:scenarioIdentity(test.title), title: test.title.split(" > ").at(-1)! }));
  runs.push({ backend, wallMs, tests });
  writeFileSync(
    path.join(out, "comparison.json"),
    JSON.stringify({ preparation, expected,expectedIdentities, runs }, null, 2),
  );
  if (result.error || result.status !== 0 || tests.some((test) => test.status !== "passed"))
    throw Error(`${backend} failed; evidence retained at ${archive}`);
  if (JSON.stringify(tests.map((test) => test.title).sort()) !== JSON.stringify(expected))
    throw Error("Benchmark selected missing or duplicate scenarios");
  if(expectedIdentities&&JSON.stringify(tests.map(test=>test.identity).sort())!==JSON.stringify(expectedIdentities))
    throw Error('Benchmark execution differs from the complete scenario identities');
  const verification = spawnSync(process.execPath, ["e2e/verify-artifacts.cjs", archive], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  if (verification.status !== 0) throw Error("E2E evidence verification failed");
}
const codeParity = verifyCodeParity(out, gameplay);
const native=runs.find(run=>run.backend==='native')!,accelerated=runs.find(run=>run.backend==='accelerated')!;
const gameplayMs = (run: typeof native) =>
  run.tests
    .filter((test) => gameplay.includes(test.title))
    .reduce((total, test) => total + test.durationMs, 0);
const summary = {
  schema: 1,
  preparation,
  codeParity,
  expected,
  expectedIdentities,
  runs,
  commandSpeedup: native.wallMs / accelerated.wallMs,
  gameplaySpeedup: gameplayMs(native) / gameplayMs(accelerated),
  pass: accelerated.wallMs < native.wallMs,
};
writeFileSync(path.join(out, "comparison.json"), JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify(
    {
      pass: summary.pass,
      commandSpeedup: summary.commandSpeedup,
      gameplaySpeedup: summary.gameplaySpeedup,
      evidence: out,
    },
    null,
    2,
  ),
);
if (!summary.pass) process.exitCode = 1;

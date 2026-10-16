// Compare the same existing gameplay assertions plus unchanged browser/deployment journeys.
import { verifyCodeParity } from "./e2e-code-parity.mts";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const gameplay: string[] = JSON.parse(
  readFileSync(path.join(root, "e2e/gameplay-titles.json"), "utf8"),
);
const retained = [
  "deployed artifact hash updates below the version without moving the header",
  "reload menu confirms immediate loading and safely deploys the exact selected artifact",
];
const expected = [...gameplay, ...retained].sort();
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
type Outcome = { title: string; status: string; durationMs: number };
const runs: Array<{ backend: string; wallMs: number; tests: Outcome[] }> = [];
for (const backend of ["native", "accelerated"]) {
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
      `--project=${backend === "native" ? "live" : "simulation"}`,
      "--project=console",
      "--grep",
      grep,
    ],
    { cwd: root, env, stdio: "inherit", windowsHide: true, timeout: 30 * 60 * 1000 },
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
  ) as { tests: Outcome[] };
  const tests = manifest.tests.map((test) => ({ ...test, title: test.title.split(" > ").at(-1)! }));
  runs.push({ backend, wallMs, tests });
  writeFileSync(path.join(out, "comparison.json"), JSON.stringify({ expected, runs }, null, 2));
  if (result.error || result.status !== 0 || tests.some((test) => test.status !== "passed"))
    throw Error(`${backend} failed; evidence retained at ${archive}`);
  if (JSON.stringify(tests.map((test) => test.title).sort()) !== JSON.stringify(expected))
    throw Error("Benchmark selected missing or duplicate scenarios");
  const verification = spawnSync(process.execPath, ["e2e/verify-artifacts.cjs", archive], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  if (verification.status !== 0) throw Error("E2E evidence verification failed");
}
const codeParity = verifyCodeParity(out, gameplay);
const [native, accelerated] = runs;
const gameplayMs = (run: typeof native) =>
  run.tests
    .filter((test) => gameplay.includes(test.title))
    .reduce((total, test) => total + test.durationMs, 0);
const summary = {
  schema: 1,
  codeParity,
  expected,
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

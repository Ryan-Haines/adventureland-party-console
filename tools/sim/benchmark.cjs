"use strict";
// End-to-end benchmark: identical native scenario, paced baseline, fast replay, traced replay.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const root = path.resolve(__dirname, "../..");
const scenario = path.resolve(
  process.argv[2] || path.join(__dirname, "scenarios/benchmark-goo.json"),
);
const out = path.join(
  root,
  ".build/sim-benchmarks",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
fs.mkdirSync(out, { recursive: true });
const results = [];
for (const mode of ["paced", "accelerated", "traced-replay"]) {
  console.log(`[benchmark] ${mode}`);
  const start = performance.now();
  const env = { ...process.env };
  delete env.SIM_TRACE;
  delete env.SIM_TRACE_RESPONSES;
  if (mode === "traced-replay")
    env.SIM_TRACE = `0-${JSON.parse(fs.readFileSync(scenario)).minutes}`;
  const run = spawnSync(
    process.execPath,
    [path.join(__dirname, "run.cjs"), scenario, ...(mode === "paced" ? ["--paced"] : [])],
    {
      cwd: root,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      windowsHide: true,
      timeout: 30 * 60 * 1000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  fs.writeFileSync(path.join(out, `${mode}.stdout.txt`), run.stdout || "");
  const directory = /results: (.+)/.exec(run.stdout || "")?.[1]?.trim();
  const report = directory
    ? JSON.parse(fs.readFileSync(path.join(directory, "report.json")))
    : null;
  results.push({
    mode,
    directory,
    exitCode: run.status,
    wallSeconds: (performance.now() - start) / 1000,
    report,
  });
  fs.writeFileSync(
    path.join(out, "benchmark.json"),
    JSON.stringify({ scenario, results }, null, 2),
  );
  if (run.error || run.status !== 0 || !report?.expect?.pass) {
    writeEvidence();
    throw new Error(`${mode} failed; evidence: ${out}; ${run.error || "see stdout and report"}`);
  }
}
const [baseline, fast, replay] = results;
const identical = [fast, replay].every(
  (r) =>
    r.report.timelineSha256 === baseline.report.timelineSha256 &&
    r.report.coordinatorSha256 === baseline.report.coordinatorSha256 &&
    r.report.codeGeneration === baseline.report.codeGeneration &&
    r.report.scenarioSha256 === baseline.report.scenarioSha256,
);
const speedup = baseline.wallSeconds / fast.wallSeconds;
const summary = {
  schema: 1,
  scenario,
  results,
  identical,
  wallSpeedup: speedup,
  pass: identical && speedup > 1,
};
fs.writeFileSync(path.join(out, "benchmark.json"), JSON.stringify(summary, null, 2));
// Independently verifiable artifact manifest, including all three complete run directories.
writeEvidence();
function writeEvidence() {
  const files = {};
  for (const directory of [out, ...results.map((r) => r.directory).filter(Boolean)])
    for (const file of fs.readdirSync(directory).sort()) {
      const full = path.join(directory, file);
      if (fs.statSync(full).isFile())
        files[path.relative(out, full).split(path.sep).join("/")] = createHash("sha256")
          .update(fs.readFileSync(full))
          .digest("hex");
    }
  fs.writeFileSync(path.join(out, "evidence.json"), JSON.stringify({ schema: 1, files }, null, 2));
}

console.log(
  JSON.stringify({ pass: summary.pass, identical, wallSpeedup: speedup, evidence: out }, null, 2),
);
if (!summary.pass) process.exitCode = 1;

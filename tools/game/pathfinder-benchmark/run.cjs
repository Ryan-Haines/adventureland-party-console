const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { fork } = require("node:child_process");
const { createNative } = require("./native.cjs");
const { corpus } = require("./corpus.cjs");
const { validate } = require("./validate.cjs");
const { measurementCounts, shouldMeasure } = require("./sampling.cjs");
const root = path.resolve(__dirname, "../../..");
const label = process.argv.find((a) => a.startsWith("--label="))?.slice(8) || "alclient-comparison";
if (!/^[a-z0-9-]+$/.test(label))
  throw Error("Benchmark label must contain lowercase letters, digits, or hyphens");
const output = path.join(root, ".build/benchmarks", label);
const source = path.join(root, ".build/benchmarks/alclient-source");
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function message(worker, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(Error("timeout"));
    }, timeout);
    function cleanup() {
      clearTimeout(timer);
      worker.off("message", receive);
      worker.off("error", fail);
      worker.off("exit", exited);
    }
    function receive(data) {
      cleanup();
      if (data.fatal) reject(Error(data.fatal));
      else resolve(data);
    }
    function fail(error) {
      cleanup();
      reject(error);
    }
    function exited(code) {
      fail(Error(`worker exited ${code}`));
    }
    worker.once("message", receive);
    worker.once("error", fail);
    worker.once("exit", exited);
  });
}
async function launch(engine, directory) {
  const worker = fork(
    path.join(__dirname, "worker.cjs"),
    [JSON.stringify({ engine, directory, bundle: path.join(source, "pathfinder.cjs") })],
    { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true },
  );
  worker.postMessage = (data) => worker.send(data);
  worker.terminate = () =>
    new Promise((resolve) => {
      if (worker.exitCode !== null || worker.signalCode !== null) return resolve();
      worker.once("exit", resolve);
      worker.kill();
    });
  try {
    return { worker, ready: await message(worker, 60000) };
  } catch (error) {
    await worker.terminate();
    throw error;
  }
}
function configuration() {
  const smoke = process.argv.includes("--smoke");
  const bounded = process.argv.includes("--bounded");
  const inputPath = path.join(root, ".build/benchmarks/config-snapshot.json");
  const snapshot = fs.existsSync(inputPath)
    ? JSON.parse(fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, ""))
    : {};
  const version =
    process.argv.find((x) => /^\d+$/.test(x)) || String(snapshot.gameVersion || "16846");
  const directory = path.join(root, ".caracal/game_files", version);
  const native = createNative(directory),
    fixtures = corpus(native, snapshot);
  filterRoutes(fixtures);
  if (process.argv.includes('--town-warps')) fixtures.routes = fixtures.routes.map(route => ({...route, town:true}));
  fs.mkdirSync(output, { recursive: true });
  const metadata = {
    startedAt: new Date().toISOString(),
    version,
    node: process.version,
    platform: process.platform,
    cpu: os.cpus()[0].model,
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    provenance: JSON.parse(fs.readFileSync(path.join(source, "provenance.json"), "utf8")),
    hashes: Object.fromEntries(
      ["data.js", "old_common_functions.js", "runner_functions.js"].map((f) => [
        f,
        hash(path.join(directory, f)),
      ]),
    ),
    lockHash: hash(path.join(__dirname, "package-lock.json")),
    wasmHash: hash(path.join(__dirname, "node_modules/alpathfinder/alpathfinder_bg.wasm")),
    snapshotHash: fs.existsSync(inputPath) ? hash(inputPath) : null,
    passes: smoke ? 1 : 30,
    warmups: smoke ? 0 : 5,
    coldRuns: smoke ? 1 : 5,
    timeoutMs: 30000,
    bounded,
    scope:
      "offline; no executor, sockets, or live character movement; native slices run back-to-back, scheduler wait excluded",
    ...fixtures,
  };
  if (bounded && !smoke) boundedPolicy(metadata, fixtures);
  metadata.harnessHashes = Object.fromEntries(
    fs
      .readdirSync(__dirname)
      .filter((f) => f.endsWith(".cjs"))
      .map((f) => [f, hash(path.join(__dirname, f))]),
  );
  return { smoke, directory, native, metadata };
}
function filterRoutes(fixtures) {
  const selected = process.argv
    .find((a) => a.startsWith("--routes="))
    ?.slice(9)
    .split(",");
  if (!selected) return;
  for (const id of selected)
    if (!fixtures.routes.some((r) => r.id === id)) throw Error(`Unknown route: ${id}`);
  fixtures.routes = fixtures.routes.filter((r) => selected.includes(r.id));
}
function boundedPolicy(metadata) {
  const pilot = JSON.parse(fs.readFileSync(path.join(output, "smoke.json"), "utf8"));
  metadata.measurementsByRoute = measurementCounts(pilot, metadata);
  metadata.pilotHash = hash(path.join(output, "smoke.json"));
}
async function coldMeasurements(engines, metadata, directory) {
  const cold = [];
  for (const engine of engines)
    for (let i = 0; i < metadata.coldRuns; i++) {
      const session = await launch(engine, directory);
      cold.push({ engine, run: i, ...session.ready });
      await session.worker.terminate();
    }
  return cold;
}
async function query(sessions, engine, route, pass, directory) {
  const session = sessions[engine];
  try {
    const pending = message(session.worker, 31000);
    session.worker.postMessage({ route, seed: 42 + Math.max(0, pass) });
    return await pending;
  } catch (error) {
    await session.worker.terminate();
    sessions[engine] = await launch(engine, directory);
    return { error: error.message, ms: 30000, path: [] };
  }
}
async function measurePass(config, sessions, engines, pass, results) {
  const { metadata, native, directory, smoke } = config;
  for (const route of metadata.routes) {
    if (!shouldMeasure(metadata, route.id, pass)) continue;
    const order = pass % 2 === 0 ? engines : [...engines].reverse();
    for (const engine of order) {
      const result = await query(sessions, engine, route, pass, directory);
      if (pass < 0) continue;
      const quality = validate(native, route, result.path);
      results.push({ engine, route: route.id, category: route.category, pass, ...result, quality });
      fs.appendFileSync(
        path.join(output, smoke ? "smoke.jsonl" : "progress.jsonl"),
        JSON.stringify(results.at(-1)) + "\n",
      );
    }
  }
}
async function main() {
  const config = configuration(),
    { smoke, directory, metadata } = config;
  const engines = ["native-visible", "native-hidden", "alclient"];
  const cold = await coldMeasurements(engines, metadata, directory),
    results = [];
  const sessions = {};
  try {
    for (const engine of engines) sessions[engine] = await launch(engine, directory);
    for (let pass = -metadata.warmups; pass < metadata.passes; pass++) {
      await measurePass(config, sessions, engines, pass, results);
      const label =
        pass < 0
          ? `Warm-up ${pass + metadata.warmups + 1}/${metadata.warmups}`
          : `Pass ${pass + 1}/${metadata.passes}`;
      console.log(`${label} complete (${results.length} measurements)`);
      fs.writeFileSync(
        path.join(output, smoke ? "smoke.json" : "results.json"),
        JSON.stringify({ metadata, cold, results }, null, 2),
      );
    }
  } finally {
    await Promise.all(Object.values(sessions).map((s) => s.worker.terminate()));
  }
  require("./report.cjs").report({ metadata, cold, results }, output, smoke ? "smoke" : "report");
}
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { message, launch };

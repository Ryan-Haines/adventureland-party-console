"use strict";
// Runs a party-console simulation: the pinned ChronAL game server and clients (tools/sim/setup.mts), the
// repository's coordinator on the same virtual clock, and every character's real CODE through the runner host.
// Usage: node tools/sim/run.cjs <scenario.json>   (scenarios: tools/sim/scenarios/)
// Output: .build/sim-results/<scenario>-<timestamp>/{report.json,timeline.jsonl,coordinator.log}
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { createHash } = require("node:crypto");
const launchedAt = performance.now();
const currentRun = { out: null, sim: null };
const hash = (value) => createHash("sha256").update(value).digest("hex");

const { observePlayer, observeMonsters } = require("./observe.cjs");
const { validateScenario, check } = require("./scenario.cjs");

const root = path.resolve(__dirname, "../..");
const chronalDir = path.join(root, ".build/sim/chronal");
const appRoot = path.join(chronalDir, "runtime/app");
if (!fs.existsSync(path.join(appRoot, "node/server.js")))
  throw new Error("ChronAL is not set up: run node tools/sim/setup.mts");

// Keep ambient ChronAL account/config paths outside this isolated host.
for (const key of Object.keys(process.env)) if (key.startsWith("CHRONAL_")) delete process.env[key];
const { createSim } = require(path.join(chronalDir, "sim/sim.js"));
const chronal = require(path.join(chronalDir, "sim/client_host.js"));
const caracal = require("./host/caracal.cjs");
const { startCoordinator } = require("./host/coordinator.cjs");
const { createTransport } = require("./host/transport.cjs");
const { workerFactory } = require("./host/character-worker.cjs");
const { clockedLifecycle } = require("./host/clocked-require.cjs");
const { threadedHost } = require("./host/threaded.cjs");

async function main() {
  const scenarioFile = path.resolve(process.argv[2] || path.join(__dirname, "scenarios/boot.json"));
  const scenario = JSON.parse(fs.readFileSync(scenarioFile, "utf8"));
  validateScenario(scenario);
  // Always stage current sources; never publish to the live CODE directory.
  for (const script of ["tools/build-shared.mts", "tools/build-runtime.mts"])
    require("node:child_process").execFileSync(process.execPath, [path.join(root, script)], {
      cwd: root,
      stdio: ["ignore", "ignore", "inherit"],
    });
  const id = `${path.basename(scenarioFile, ".json")}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const out = path.join(root, ".build/sim-results", id);
  const runDir = path.join(root, ".build/sim-runs", id);
  fs.mkdirSync(out, { recursive: true });
  currentRun.out = out;
  fs.mkdirSync(path.join(runDir, "CODE"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "localStorage"), { recursive: true });
  codeDirectory(path.join(runDir, "CODE/adventure_land"));
  const gameCache = (version, G) => {
    // caracAL's flat game cache (./game_files/<version>/<file>), read directly by the coordinator's catalogs.
    const dir = path.join(runDir, "game_files", String(version));
    fs.mkdirSync(dir, { recursive: true });
    for (const sub of ["js", "common/js"])
      for (const file of fs.readdirSync(path.join(appRoot, sub)).filter((f) => f.endsWith(".js")))
        if (!fs.existsSync(path.join(dir, file)))
          fs.copyFileSync(path.join(appRoot, sub, file), path.join(dir, file));
    fs.writeFileSync(path.join(dir, "data.js"), "var G=" + JSON.stringify(G) + ";\n"); // what /data.js serves
  };
  process.chdir(runDir); // the coordinator and runner host resolve ./CODE and ./localStorage from here

  const logFile = fs.openSync(path.join(out, "coordinator.log"), "a");
  const counts = { error: 0, warn: 0 };
  let sim = null; // set below; the log stamps virtual time once it exists
  const log = (level, message, details) => {
    if (level in counts) counts[level]++;
    const at = sim ? new Date(sim.clock.nowMs()).toISOString() : "boot";
    fs.writeSync(
      logFile,
      `${at} ${level.toUpperCase()} ${message}${details ? " " + JSON.stringify(details) : ""}\n`,
    );
  };

  sim = await createSim(simOptions(scenario));
  currentRun.sim = sim;
  const clock = sim.clock;
  clock.onError = (error) => log("error", `[sim server] ${error.stack || error}`);
  const apps = new Map();
  const [lo, hi] = sim.latencyRange;
  const transport = createTransport({ clock, apps, latency: () => lo + clock.rng() * (hi - lo) });
  // Progress on stderr every few real seconds: a stalled or runaway simulation shows here first.
  let lastEvents = 0;
  const progress = setInterval(
    () => {
      const heap = Math.round(process.memoryUsage().heapUsed / 1048576);
      process.stderr.write(
        `[sim] t=${((clock.now - clock.start) / 60000).toFixed(2)} vmin events=${clock.events} (+${clock.events - lastEvents}) heap=${heap}MB http=${transport.stats.requests} open=${transport.open}\n`,
      );
      lastEvents = clock.events;
    },
    Number(process.env.SIM_PROGRESS_MS) || 5000,
  );
  progress.unref();
  gameCache(sim.server.G.version, JSON.parse(chronal.clientInfo(sim.server).gJson));
  const realm = scenario.realm || "SR_USI";
  const characters = scenario.characters.map((c) => {
    const fx = sim.createCharacter({
      name: c.name,
      type: c.type,
      account: "party",
      over: characterSeed(c, scenario, sim.server.G),
    });
    return {
      ...c,
      id: fx.character,
      user_id: fx.user_id,
      auth: fx.auth,
      level: c.level || 50,
      version: sim.server.G.version,
    };
  });
  const credentials = new Map(characters.map((c) => [c.id, c]));

  // Threaded: one thread per character (its client and CODE), in lockstep with the server and coordinator.
  const fork = characterHost({
    scenario,
    sim,
    apps,
    transport,
    log,
    characters,
    credentials,
    clock,
  });
  const port = 924;
  const coordinator = startCoordinator({
    clock,
    root,
    runDir,
    log,
    fork,
    apps,
    account: caracal.account({ realm, characters }),
    game: caracal.gameFiles({ appRoot, version: sim.server.G.version, revision: "sim" }),
    config: caracal.config({ characters, merchant: scenario.merchant, realm, port }),
    env: {
      AL_DATA_DIR: runDir,
      PARTY_MOVEMENT_MODE: scenario.movement || "alclient",
      AL_INTERNAL_API_PORT: String(port),
      NODE_ENV: "production",
    },
  });
  coordinator.started.catch((error) =>
    log("error", "coordinator boot failed: " + ((error && error.stack) || error)),
  );

  /** The coordinator's own API, called in-process at the current virtual time. */
  const api = (method, route, body) =>
    new Promise((resolve, reject) =>
      transport.request(
        {
          method,
          url: `http://127.0.0.1:${port}/party-api${route}`,
          headers: { "content-type": "application/json", origin: `http://127.0.0.1:${port}` },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        (result) =>
          result instanceof Error
            ? reject(result)
            : resolve({ status: result.statusCode, body: safeJson(result.body) }),
      ),
    );

  // Boot reads the game cache from disk (real I/O): give it real time until the API listens.
  await bootCoordinator({ apps, port, sim, clock, log });

  // Baselines for the report, and deaths counted on the server (a rip that clears between samples still counts).
  const baseline = new Map(); // each character from when it is first on the server
  const deaths = new Map();
  const ripped = new Set();
  const deathLog = [];
  const tracked = { types: scenario.track || [], alive: new Map(), kills: [] };
  const startedAt = clock.now; // observation begins at the scenario start
  // Observe actual native kill completion; disappearance alone can be despawn/cleanup.
  const nativeKill = sim.server.kill_monster;
  sim.server.kill_monster = function (attacker, target) {
    const wasDead = target.dead;
    const result = nativeKill.apply(this, arguments);
    if (!wasDead && target.dead && tracked.types.includes(target.type)) {
      const spawn = tracked.alive.get(target.id);
      tracked.kills.push({
        id: target.id,
        type: target.type,
        map: target.map,
        killer: attacker?.name,
        minute: +((clock.now - startedAt) / 60000).toFixed(2),
        cycleMinutes: +((clock.now - (spawn?.spawnedAt ?? clock.now)) / 60000).toFixed(2),
      });
    }
    return result;
  };
  clock.timer(
    () => {
      const observation = { baseline, deaths, ripped, deathLog, sim, clock, startedAt };
      for (const p of Object.values(sim.server.players || {})) observePlayer(p, observation);
      observeMonsters(sim, tracked, clock);
    },
    1000,
    [],
    true,
    "node",
    (e) => log("error", String(e)),
  );

  // SIM_TRACE=<from>-<to> (virtual minutes): request bodies and the game server's view of each character (at most
  // every 250 ms) to trace.jsonl. It only reads, from requests the run makes anyway: a timer of its own would change
  // the clock's event order, and the traced replay would no longer be the run it investigates.
  enableTrace({ clock, out, transport, sim });

  if (process.env.SIM_E2E_IPC === "1") {
    await require("./session.cjs").serveSession({
      sim,
      api,
      waitFor,
      out,
      counts,
      transport,
      characters,
      root,
      runDir,
    });
    await sim.close();
    return;
  }
  const executeStep = async (step) => {
    if (step.action === "farm") return farm(step);
    if (step.action === "hunt") return hunt(step);
    return call(step.method || "POST", step.route, step.body);
  };
  const { realMs, virtualMs, paced } = await exercise({
    clock,
    sim,
    scenario,
    out,
    api,
    waitFor,
    executeStep,
  });
  const finalState = await waitFor(api("GET", "/state"));
  // The whole coordinator state at the end (combat logs, rare-hunt state, queues), for after-the-fact diagnosis.
  fs.writeFileSync(path.join(out, "final-state.json"), JSON.stringify(finalState.body));
  const report = makeReport({
    chronalDir,
    scenarioFile,
    root,
    runDir,
    out,
    scenario,
    sim,
    realMs,
    virtualMs,
    paced,
    counts,
    transport,
    finalState,
    characters,
    baseline,
    deaths,
    tracked,
    deathLog,
  });
  validateReport(report, scenario, virtualMs, characters, finalState);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log("results:", out);
  await sim.close(); // client threads (threaded runs) keep the process alive otherwise
  if (report.expect && !report.expect.pass) {
    console.error("[sim] expectations failed:\n  " + report.expect.failures.join("\n  "));
    process.exitCode = 1;
  }

  async function call(method, route, body) {
    const result = await waitFor(api(method, route, body));
    log(
      result.status < 400 ? "info" : "warn",
      `[scenario] ${method} ${route} -> ${result.status}`,
      result.body && result.body.error ? { error: result.body.error } : undefined,
    );
    if (result.status >= 400)
      throw new Error(
        `[sim] scenario request ${method} ${route} failed (${result.status}): ${JSON.stringify(result.body)}`,
      );
    return result;
  }
  async function farmingChoices(step) {
    const { farmingAreas } = require(path.join(root, "dashboard/lib/farming-areas.cjs"));
    let areas = [];
    for (let attempt = 0; attempt < 60 && !areas.length; attempt++) {
      const state = await waitFor(api("GET", "/state"));
      if (state.body && state.body.monsterChoices)
        areas = farmingAreas(state.body.monsterChoices, [step.monster]);
      if (!areas.length)
        await waitFor(new Promise((resolve) => clock.at(clock.now + 5000, resolve)));
    }
    if (!areas.length)
      throw new Error(`[sim] no farming area for ${step.monster} (see coordinator.log)`);
    return areas;
  }
  /** What the dashboard does to farm: formation, focus, then travel to the monster's farming area (Mainland first). */
  async function farm(step) {
    await call("POST", "/formation", { leader: step.leader });
    for (const name of step.followers || [])
      await call("POST", "/formation", { character: name, follow: true });
    await call("POST", "/farming-mode", { character: step.leader, mode: "default" });
    await call("POST", "/focus", { character: step.leader, monsterFocus: [step.monster] });
    const areas = await farmingChoices(step);
    await call("POST", "/travel", areas.find((a) => a.map === "main") || areas[0]);
  }

  /** What the dashboard does to hunt a rare monster (Phoenix): formation, then search its spawn regions in catalog order. */
  async function hunt(step) {
    await call("POST", "/formation", { leader: step.leader });
    for (const name of step.followers || [])
      await call("POST", "/formation", { character: name, follow: true });
    const { zones } = require(path.join(root, "characters/farming-zones.cjs"));
    let regions = [];
    for (let attempt = 0; attempt < 60 && !regions.length; attempt++) {
      const state = await waitFor(api("GET", "/state"));
      if (state.body && state.body.monsterChoices)
        regions = zones(state.body.monsterChoices, [step.monster]);
      if (!regions.length)
        await waitFor(new Promise((resolve) => clock.at(clock.now + 5000, resolve)));
    }
    if (!regions.length)
      throw new Error(`[sim] no spawn regions for ${step.monster} (see coordinator.log)`);
    await call("POST", "/navigate-to-monster", {
      monsterId: step.monster,
      ...(step.monster === "phoenix" && { phoenixRouteOrder: regions.map((r) => r.id) }),
    });
  }

  /** Advance the clock until a request issued through the transport has answered. */
  async function waitFor(promise) {
    const deadline = clock.now + 120000;
    let settled = false,
      value,
      error;
    promise.then(
      (v) => ((settled = true), (value = v)),
      (e) => ((settled = true), (error = e)),
    );
    while (!settled) {
      if (clock.now >= deadline) throw new Error("[sim] request exceeded 120 virtual seconds");
      if (sim.halted)
        throw new Error(
          `[sim] the simulation halted (${sim.halted}${sim.failed ? ": " + sim.failed : ""})`,
        );
      await sim.run(5, { stop: () => settled });
    }
    if (error) throw error;
    return value;
  }
}

function characterSeed(c, scenario, G) {
  const over = { level: c.level || 50, ...c.over };
  if (!scenario.initialLoadout) return over;
  const definition = scenario.initialLoadout;
  const slots = structuredClone(G.classes[c.type].base_slots || {});
  for (const item of Object.values(slots)) if (item?.name) item.level = definition.weaponLevel;
  const stat = c.type === "warrior" ? "str" : c.type === "ranger" ? "dex" : "int";
  Object.assign(slots, definition.armor, {
    amulet: { name: stat + "amulet", level: 20 },
    belt: { name: stat + "belt", level: 20 },
  });
  over.info = {
    ...over.info,
    slots,
    hp: 1e9,
    mp: 1e9,
    gold: 10000000,
    map: "main",
    in: "main",
    x: 0,
    y: 0,
    items: [
      { name: "hpot1", q: 1000 },
      { name: "mpot1", q: 1000 },
    ],
  };
  return over;
}

function characterHost({ scenario, sim, apps, transport, log, characters, credentials, clock }) {
  const threaded = scenario.threads
    ? threadedHost({ sim, apps, stats: transport.stats, log })
    : null;
  if (threaded) threaded.start(characters, { chronalDir, repoRoot: root, fps: scenario.fps });
  return threaded
    ? threaded.fork
    : workerFactory({
        sim,
        chronal,
        transport,
        log,
        fps: scenario.fps,
        lifecycle: clockedLifecycle({
          clock,
          root,
          onError: (e) => log("error", "[sim runner host] timer error: " + ((e && e.stack) || e)),
        }),
        login: (cid) => {
          const c = credentials.get(cid);
          if (!c) throw new Error("[sim] the coordinator asked for an unknown character " + cid);
          return c;
        },
      });
}

async function bootCoordinator({ apps, port, sim, clock, log }) {
  const bootDeadline = performance.now() + 120000;
  while (!apps.has(port) && performance.now() < bootDeadline && !sim.halted) {
    await sim.run(50);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!apps.has(port))
    throw new Error("[sim] the coordinator did not start its API (see coordinator.log)");
  log(
    "info",
    `[sim] coordinator API listening after ${((clock.now - clock.start) / 1000).toFixed(1)} virtual s`,
  );
}

function simOptions(scenario) {
  return {
    root: appRoot,
    seed: scenario.seed ?? 1,
    ping: scenario.ping ?? 18,
    quiet: true,
    threads: !!scenario.threads,
    seasons: scenario.seasons || [],
  };
}

function participantReady(name, report, state) {
  return !report.characters[name].offline && !!state.body?.characters?.[name]?.seenAt;
}

function validateReport(report, scenario, virtualMs, characters, finalState) {
  report.expect = check(scenario.expect || {}, report);
  if (virtualMs < scenario.minutes * 60000)
    report.expect.failures.push("incomplete virtual duration");
  for (const c of characters) {
    if (!participantReady(c.name, report, finalState))
      report.expect.failures.push(`${c.name} missing native player or coordinator heartbeat`);
  }
  if (report.http.errors) report.expect.failures.push(`transport errors: ${report.http.errors}`);
  if (Object.keys(report.http.firstFailure).length)
    report.expect.failures.push("HTTP error responses (see http.firstFailure)");
  report.expect.pass = !report.expect.failures.length;
}

function enableTrace({ clock, out, transport, sim }) {
  const windows = (process.env.SIM_TRACE || "")
    .split(",")
    .map((w) => /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(w.trim()))
    .filter(Boolean)
    .map((w) => [clock.now + w[1] * 60000, clock.now + w[2] * 60000]);
  if (windows.length) {
    const traceFile = fs.openSync(path.join(out, "trace.jsonl"), "a");
    const write = (entry) =>
      fs.writeSync(
        traceFile,
        JSON.stringify({ at: new Date(clock.now).toISOString(), ...entry }) + "\n",
      );
    let snapshotAt = 0;
    transport.stats.observe = (route, body) => {
      if (!windows.some(([from, to]) => clock.now >= from && clock.now <= to)) return;
      if (body) write({ route, body: safeJson(body) });
      if (clock.now - snapshotAt < 250) return;
      snapshotAt = clock.now;
      for (const p of Object.values(sim.server.players || {}))
        write({
          server: p.name,
          map: p.map,
          x: Math.round(p.x),
          y: Math.round(p.y),
          moving: p.moving,
          c: p.c,
          s: Object.keys(p.s || {}),
          rip: p.rip,
          hp: p.hp,
        });
    };
    // SIM_TRACE_RESPONSES=1 also records the coordinator's reply to each request in the window (large).
    if (process.env.SIM_TRACE_RESPONSES)
      transport.stats.observeResponse = (route, body, response) => {
        if (!windows.some(([from, to]) => clock.now >= from && clock.now <= to)) return;
        const request = safeJson(body);
        write({
          route,
          response: true,
          character: (request && (request.name || request.character)) || null,
          body: safeJson(response),
        });
      };
  }
}

const canAdvance = (clock, due, sim) => clock.now < due && !sim.halted;

async function exercise({ clock, sim, scenario, out, api, waitFor, executeStep }) {
  const timeline = fs.openSync(path.join(out, "timeline.jsonl"), "a");
  const startedAt = clock.now;
  const real0 = performance.now();
  const end = startedAt + scenario.minutes * 60000;
  const sampleEvery = (scenario.sampleSeconds ?? 60) * 1000;
  const steps = (scenario.steps || []).map((s) => ({
    ...s,
    at: startedAt + s.atSeconds * 1000,
    done: false,
  }));
  let nextSample = startedAt;
  const paced = process.argv.includes("--paced");
  while (clock.now < end && !sim.halted) {
    const due = Math.min(
      end,
      clock.now + 1000,
      nextSample,
      ...steps.filter((s) => !s.done).map((s) => s.at),
    );
    while (canAdvance(clock, due, sim)) {
      await sim.run(due - clock.now);
    }
    if (paced) {
      const delay = clock.now - startedAt - (performance.now() - real0);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
    for (const step of steps.filter((s) => !s.done && s.at <= clock.now)) {
      step.done = true;
      await executeStep(step);
    }
    if (clock.now >= nextSample) {
      nextSample += sampleEvery;
      const state = await waitFor(api("GET", "/state?catalog=0")).catch((error) => ({
        body: { error: String(error) },
      }));
      fs.writeSync(timeline, JSON.stringify(sample(clock.now - startedAt, state.body, sim)) + "\n");
    }
  }
  return { realMs: performance.now() - real0, virtualMs: clock.now - startedAt, paced };
}

function makeReport({
  chronalDir,
  scenarioFile,
  root,
  runDir,
  out,
  scenario,
  sim,
  realMs,
  virtualMs,
  paced,
  counts,
  transport,
  finalState,
  characters,
  baseline,
  deaths,
  tracked,
  deathLog,
}) {
  return {
    pins: {
      chronal: "e858d3f4cc941cc5ab87b94d2e471c0fb9dfd785",
      game: JSON.parse(fs.readFileSync(path.join(chronalDir, "runtime/installed.json"))),
    },
    schema: 1,
    paced,
    scenarioSha256: hash(fs.readFileSync(scenarioFile)),
    timelineSha256: hash(fs.readFileSync(path.join(out, "timeline.jsonl"))),
    coordinatorSha256: hash(
      fs.readFileSync(path.join(root, ".build/runtime/coordinator-application.cjs")),
    ),
    codeGeneration: JSON.parse(
      fs.readFileSync(path.join(runDir, "CODE/adventure_land/manifest.json")),
    ).generation,
    totalRealSeconds: +((performance.now() - launchedAt) / 1000).toFixed(3),
    scenario: path.basename(scenarioFile),
    seed: scenario.seed ?? 1,
    game: sim.server.G.version,
    virtualMinutes: +(virtualMs / 60000).toFixed(1),
    realSeconds: +(realMs / 1000).toFixed(1),
    speed: +(virtualMs / realMs).toFixed(1),
    log: counts,
    http: {
      requests: transport.stats.requests,
      errors: transport.stats.errors,
      byStatus: Object.fromEntries(transport.stats.byStatus),
      firstFailure: Object.fromEntries(transport.stats.firstFailure),
      byPath: Object.fromEntries(
        [...transport.stats.byPath].sort((a, b) => b[1] - a[1]).slice(0, 15),
      ),
    },
    final: sample(virtualMs, finalState.body, sim),
    halted: sim.halted,
    failed: sim.failed,
    threads: scenario.threads
      ? Object.fromEntries(Object.entries(sim.busy()).map(([k, v]) => [k, +(v / 1000).toFixed(1)]))
      : undefined,
    characters: Object.fromEntries(
      characters.map((c) => {
        const p = Object.values(sim.server.players || {}).find((x) => x.name === c.name),
          b = baseline.get(c.name) || {};
        return [
          c.name,
          p
            ? {
                level: p.level,
                xpGained: p.xp - (b.xp || 0) + levelXp(b.level, p.level, sim),
                goldGained: p.gold - (b.gold || 0),
                deaths: deaths.get(c.name) || 0,
              }
            : { offline: true },
        ];
      }),
    ),
    kills: tracked.types.length ? tracked.kills : undefined,
    deaths: deathLog,
  };
}

/**
 * The run's CODE: the working tree's character files, with class artifacts compiled from the working tree into a
 * staged generation (tools/game/build.mts without --publish). The coordinator runs classes from the manifest, so
 * linking characters/ would run whatever was last published there instead of the code under test, and publishing
 * would also reload any live characters watching characters/manifest.json.
 */
function codeDirectory(dir) {
  require("node:child_process").execFileSync(
    process.execPath,
    [path.join(root, "tools/game/build.mts")],
    { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
  );
  const staged = path.join(root, ".build/game"),
    characters = path.join(root, "characters");
  const manifest = JSON.parse(fs.readFileSync(path.join(staged, "manifest.json"), "utf8"));
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(characters))
    if (!["generated", "manifest.json", "build-history.json"].includes(name))
      fs.cpSync(path.join(characters, name), path.join(dir, name), { recursive: true });
  // Copies, not links: a later build may clean old generations out of .build/game while this run uses them.
  for (const { file } of Object.values(manifest.classes)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(staged, file), path.join(dir, file));
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

/**
 * scenario.expect: { minKills: { <type>: n }, maxCycleMinutes: n, maxDeaths: n, maxErrors: n }. A scenario with
 * expectations is a test: the run exits 1 and report.expect lists what failed.
 */
/** XP earned across level-ups: the game resets xp at each level, and G.levels[level] is that level's total. */
function levelXp(from, to, sim) {
  let total = 0;
  for (let level = from || 0; level < (to || 0); level++)
    total += sim.server.G.levels[String(level)] || 0;
  return total;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** What a timeline line keeps: per character, where it is and what the coordinator thinks it is doing. */
function sample(atMs, state, sim) {
  const characters = (state && state.characters) || {};
  return {
    minute: +(atMs / 60000).toFixed(2),
    characters: Object.fromEntries(
      Object.entries(characters).map(([name, c]) => [
        name,
        {
          map: c.map,
          x: Math.round(c.x || 0),
          y: Math.round(c.y || 0),
          hp: c.hp,
          rip: !!c.rip,
          level: c.level,
          navigation: c.navigationState || null,
          event: c.joinedEvent || null,
          gold: c.gold,
          seenAt: c.seenAt,
        },
      ]),
    ),
    server: Object.fromEntries(
      Object.values(sim.server.players || {}).map((p) => [
        p.name,
        { map: p.map, x: Math.round(p.x), y: Math.round(p.y), level: p.level, rip: !!p.rip },
      ]),
    ),
    // The coordinator's rare hunt (Phoenix patrol): stage, message, coverage and the last skip reason.
    rare:
      state && state.rareHuntState
        ? (({ stage, message, patrol, encounter }) => ({
            stage,
            message,
            encounter: encounter && {
              stage: encounter.stage,
              id: encounter.id,
              killedAt: encounter.killedAt,
              message: encounter.message,
            },
            patrol: patrol && {
              paused: patrol.paused,
              stage: patrol.stage,
              message: patrol.message,
              cycle: patrol.cycle,
              covered: patrol.covered,
              incomplete: patrol.incomplete,
              searchers: patrol.searchers,
              retryReason: patrol.retryReason,
            },
          }))(state.rareHuntState)
        : undefined,
    // Loot the party left on the ground: drops nobody opened yet.
    chests: Object.values(sim.server.chests || {}).reduce(
      (sum, c) => ({ count: sum.count + 1, gold: sum.gold + (Number(c.gold) || 0) }),
      { count: 0, gold: 0 },
    ),
  };
}

main().then(
  () => process.exit(process.exitCode || 0),
  async (error) => {
    if (currentRun.out) {
      fs.writeFileSync(
        path.join(currentRun.out, "failure.json"),
        JSON.stringify(
          { error: String(error.stack || error), virtualTime: currentRun.sim?.clock.now },
          null,
          2,
        ),
      );
      console.error("failure evidence:", currentRun.out);
    }
    console.error(error);
    if (currentRun.sim)
      await currentRun.sim.close().catch((closeError) => console.error(closeError));
    process.exit(1);
  },
);

const test = require("node:test");
const assert = require("node:assert/strict");
const { createNative, ENGINES } = require("../../tools/game/pathfinder-benchmark/native.cjs");
const { validate } = require("../../tools/game/pathfinder-benchmark/validate.cjs");
const { paired, summarize } = require("../../tools/game/pathfinder-benchmark/report.cjs");
const {
  measurementCounts,
  shouldMeasure,
  SLOW_ROUTE,
} = require("../../tools/game/pathfinder-benchmark/sampling.cjs");
const { checkCounts } = require("../../tools/game/pathfinder-benchmark/verify.cjs");
test("query watchdog times out and removes listeners without swallowing worker failures", async () => {
  const { EventEmitter } = require("node:events");
  const { message } = require("../../tools/game/pathfinder-benchmark/run.cjs");
  const worker = new EventEmitter();
  await assert.rejects(message(worker, 5), /timeout/);
  assert.equal(worker.listenerCount("message"), 0);
  assert.equal(worker.listenerCount("error"), 0);
  const pending = message(worker, 1000);
  worker.emit("message", { fatal: "specific planner failure" });
  await assert.rejects(pending, /specific planner failure/);
});
test("latency summaries use an ordinary median and nearest-rank p95 for small samples", () => {
  const { median, quantile } = require("../../tools/game/pathfinder-benchmark/report.cjs");
  assert.equal(median([1, 3]), 2);
  assert.equal(quantile([1, 2, 100], 0.95), 100);
  assert.equal(median([]), null);
});
test("CSV exports escape structured method counts using standard doubled quotes", () => {
  const { csvValue } = require("../../tools/game/pathfinder-benchmark/report.cjs");
  assert.equal(csvValue('{"move":2}'), '"{""move"":2}"');
  assert.equal(csvValue(null), '""');
});
test("bounded sampling uses matched pilot fixtures, paired counts, and explicit warm-ups", () => {
  const metadata = {
    version: "1",
    hashes: { game: "hash" },
    lockHash: "lock",
    provenance: { revision: "rev" },
    routes: [{ id: "fast" }, { id: "slow" }],
    passes: 30,
    warmups: 5,
    engines: ENGINES,
  };
  const results = ["fast", "slow"].flatMap((route) =>
    ENGINES.map((engine) => ({
      route,
      engine,
      ms: route === "fast" ? 10 : 2000,
    })),
  );
  const pilot = { metadata: structuredClone(metadata), results };
  metadata.measurementsByRoute = measurementCounts(pilot, metadata);
  assert.deepEqual(metadata.measurementsByRoute, { fast: { passes: 30, warmups: 5 }, slow: SLOW_ROUTE });
  assert.equal(shouldMeasure(metadata, "slow", -1), false);
  assert.equal(shouldMeasure(metadata, "fast", -5), true);
  assert.equal(shouldMeasure(metadata, "slow", 2), true);
  assert.equal(shouldMeasure(metadata, "slow", 3), false);
  assert.throws(
    () => measurementCounts(pilot, { ...metadata, routes: [{ id: "changed" }] }),
    /Pilot must match/,
  );
});
test(
  "offline native adapter uses installed planning code and forbids movement/network/timers",
  () => {
    // The fixture client 16846 (scripts/tests/fixtures/game/manifest.json); a checkout without it
    // fails with the path and the restore command.
    const { directory } = require("./helpers/installed-game.cjs").gameFiles(16846);
    const native = createNative(directory);
    const route = { from: { map: "main", x: 0, y: 0 }, to: { map: "main", x: 20, y: 0 } };
    const result = native.query(route);
    assert.equal(result.error, null);
    assert.equal(validate(native, route, result.path).valid, true);
    for (const name of ["move", "transport", "town", "fetch", "setTimeout", "setInterval"])
      assert.throws(() => native.context[name](), /Offline benchmark forbids/);
    assert.equal(native.context.smart_move_logic, undefined);
    assert.equal(native.context.require, undefined);
    assert.equal(native.context.process, undefined);
    const bank = { from: { map: "main", x: 0, y: 0 }, to: { map: "bank", x: 0, y: -100 } };
    const bankResult = native.query(bank);
    assert.equal(bankResult.error, null);
    assert.equal(validate(native, bank, bankResult.path).valid, true);
    assert.ok(bankResult.path.some((p) => p.method === "transport"));
    const corner = { from: { map: "main", x: -417, y: -72 }, to: { map: "main", x: -399, y: -91 } };
    assert.equal(validate(native, corner, [{ ...corner.to, method: "move" }]).collisions, 1);
    assert.equal(
      native.query({ from: route.from, to: { map: "spookytown", x: 0, y: 0 } }, 42, 1).error,
      "timeout",
    );
  },
);
test("route validator distinguishes collision, access, transitions and exact arrival", () => {
  const native = {
    game: {
      maps: {
        a: { spawns: [[0, 0]], doors: [], npcs: [] },
        b: { spawns: [[0, 0]], instance: true },
      },
      npcs: { transporter: { places: {} } },
    },
    canWalk: (a, b) => a.map === b.map && b.x < 50,
    context: {},
  };
  const from = { map: "a", x: 0, y: 0 },
    to = { map: "a", x: 10, y: 0 },
    route = { from, to };
  assert.equal(validate(native, route, [{ ...to, method: "move" }]).valid, true);
  assert.equal(validate(native, route, [{ ...to, x: 100, method: "move" }]).collisions, 1);
  assert.equal(
    validate(native, route, [{ map: "b", x: 0, y: 0, method: "move" }]).unverified,
    true,
  );
  assert.equal(validate(native, route, [{ ...from, method: "town" }]).invalidTransitions, 1);
  assert.equal(
    validate(native, { from, to: from, town: true }, [{ ...from, method: "town" }]).valid,
    true,
  );
  assert.equal(validate(native, route, [{ ...to, x: 5 }]).valid, false);
  assert.equal(validate(native, route, []).valid, false);
});
test("paired statistics exclude invalid fast paths and preserve failures in totals", () => {
  const rows = [
    { engine: "alclient", route: "r", pass: 0, ms: 2, quality: { valid: true, distance: 10 } },
    {
      engine: "native-visible",
      route: "r",
      pass: 0,
      ms: 20,
      quality: { valid: true, distance: 12 },
    },
    {
      engine: "alclient",
      route: "bad",
      pass: 0,
      ms: 0.001,
      error: "no path",
      quality: { valid: false },
    },
  ];
  assert.ok(Math.abs(paired(rows).speedup - 10) < 1e-10);
  assert.equal(paired(rows).pairs, 1);
  assert.equal(summarize(rows).errors, 1);
  assert.equal(summarize(rows).count, 3);
  // A failed query stays in the count and the errors and out of the latency columns.
  const timedOut = { engine: "alclient", route: "slow", pass: 0, ms: 50, error: "timeout", quality: { valid: false } };
  const summary = summarize([...rows, timedOut]);
  assert.deepEqual([summary.count, summary.errors, summary.timeouts], [4, 2, 1]);
  assert.deepEqual([summary.medianMs, summary.maxMs], [11, 20]);
  assert.equal(summarize([timedOut]).maxMs, null);
});
test("stored results hold each route's planned passes for every engine", () => {
  const metadata = { engines: ENGINES, passes: 2, routes: [{ id: "fast" }, { id: "slow" }],
    measurementsByRoute: { fast: { passes: 2, warmups: 1 }, slow: { passes: 1, warmups: 0 } } };
  const rows = (id, passes) => ENGINES.flatMap((engine) => Array.from({ length: passes }, (_, pass) => ({ route: id, engine, pass })));
  checkCounts({ metadata, results: [...rows("fast", 2), ...rows("slow", 1)] });
  assert.throws(() => checkCounts({ metadata, results: [...rows("fast", 2), ...rows("slow", 2)] }), /slow\/native-visible count/);
});

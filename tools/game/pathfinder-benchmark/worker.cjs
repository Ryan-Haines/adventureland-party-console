const workerData = JSON.parse(process.argv[2]);
const parentPort = {
  postMessage: (data) => process.send(data),
  on: (_event, callback) => process.on("message", callback),
  close: () => process.disconnect(),
};
const { performance } = require("node:perf_hooks");
const { createNative, BASE } = require("./native.cjs");
async function main() {
  const before = process.memoryUsage(),
    start = performance.now();
  const native = createNative(workerData.directory, workerData.engine === "native-hidden");
  const nativeLoadMs = performance.now() - start;
  let Pathfinder;
  const preparationStart = performance.now(),
    preparationMemory = process.memoryUsage();
  if (workerData.engine === "alclient") {
    Pathfinder = require(workerData.bundle).Pathfinder;
    await Pathfinder.prepare(native.game, { cheat: false, base: BASE });
  }
  parentPort.postMessage({
    ready: true,
    nativeLoadMs,
    preparationMs: performance.now() - preparationStart,
    preparationRssBytes: process.memoryUsage().rss - preparationMemory.rss,
    totalRssBytes: process.memoryUsage().rss - before.rss,
    heapBytes: process.memoryUsage().heapUsed - before.heapUsed,
  });
  parentPort.on("message", ({ route, seed }) => {
    if (workerData.engine !== "alclient") return parentPort.postMessage(native.query(route, seed));
    const began = performance.now();
    try {
      const steps = Pathfinder.getPath(route.from, route.to, {
        avoidTownWarps: !route.town,
        speed: 60,
      });
      parentPort.postMessage({
        ms: performance.now() - began,
        path: steps,
        error: null,
        slices: 1,
      });
    } catch (error) {
      parentPort.postMessage({
        ms: performance.now() - began,
        path: [],
        error: error.message,
        slices: 1,
      });
    }
  });
}
main().catch((error) => {
  parentPort.postMessage({ fatal: error.stack });
  parentPort.close();
});

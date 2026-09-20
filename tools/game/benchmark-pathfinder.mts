import * as pathfinder from "alpathfinder";
import type { GData, MapKey } from "typed-adventureland";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const version = process.argv[2] || "15650";
if (!/^\d+$/.test(version)) throw new Error("Expected a downloaded numeric game version");
const directory = path.join(root, ".caracal/game_files", version);
const context = vm.createContext({ console, Place: "client" });
vm.runInContext(await readFile(path.join(directory, "data.js"), "utf8"), context, {
  timeout: 5000,
});
vm.runInContext(await readFile(path.join(directory, "old_common_functions.js"), "utf8"), context, {
  timeout: 5000,
});
const game = context.G as GData;
type Segment = {
  map: MapKey;
  x: number;
  y: number;
  going_x: number;
  going_y: number;
  base?: { h: number; v: number; vn: number };
};
const native = context.can_move as (segment: Segment) => boolean;
const maps: MapKey[] = [
  "main",
  "halloween",
  "winterland",
  "desertland",
  "spookytown",
  "cave",
  "tunnel",
];
const ignored = (Object.keys(game.maps) as MapKey[]).filter((map) => !maps.includes(map));
const beforeMemory = process.memoryUsage().rss;
const preparationStart = performance.now();
pathfinder.prepare(game, ignored);
const preparationMs = performance.now() - preparationStart;
let seed = 42;
function random(): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
const samples: Segment[] = [];
for (const map of maps) {
  const spawns = game.maps[map].spawns;
  for (let index = 0; index < 1000; index++) {
    const spawn = spawns[index % spawns.length];
    const x = spawn[0] + (random() - 0.5) * 1000,
      y = spawn[1] + (random() - 0.5) * 1000;
    samples.push({
      map,
      x,
      y,
      going_x: x + (random() - 0.5) * 500,
      going_y: y + (random() - 0.5) * 500,
    });
  }
}
function measure(run: (segment: Segment) => boolean) {
  for (const sample of samples.slice(0, 200)) run(sample);
  const began = performance.now();
  const values = samples.map(run);
  return { elapsedMs: performance.now() - began, values };
}
const point = measure((sample) => native(sample));
const rectangle = measure((sample) => native({ ...sample, base: { h: 8, v: 7, vn: 2 } }));
const wasm = measure((sample) =>
  pathfinder.canWalkPath(sample.map, sample.x, sample.y, sample.going_x, sample.going_y),
);
const mismatch = (reference: boolean[]) => ({
  acceptedButNativeBlocked: wasm.values.filter((value, index) => value && !reference[index]).length,
  rejectedButNativeAllowed: wasm.values.filter((value, index) => !value && reference[index]).length,
});
const routeStart = performance.now();
const route = pathfinder.getPath("main", 0, 0, "halloween", 0, 0, { speed: 60 });
const report = {
  package: "alpathfinder@0.6.0",
  gameVersion: version,
  node: process.version,
  maps,
  sampleCount: samples.length,
  seed: 42,
  preparationMs,
  rssIncreaseBytes: process.memoryUsage().rss - beforeMemory,
  nativePointMs: point.elapsedMs,
  nativeRectangleMs: rectangle.elapsedMs,
  wasmMs: wasm.elapsedMs,
  pointComparison: mismatch(point.values),
  rectangleComparison: mismatch(rectangle.values),
  route: {
    from: "main:0,0",
    to: "halloween:0,0",
    elapsedMs: performance.now() - routeStart,
    nodes: route?.length || 0,
    methods: [...new Set(route?.map((node) => node.method) || [])],
  },
  decision:
    "Retain native collision validation. This sampled benchmark does not prove full-world path or session-access correctness.",
};
await mkdir(path.join(root, ".build/benchmarks"), { recursive: true });
await writeFile(
  path.join(root, ".build/benchmarks/pathfinder.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));

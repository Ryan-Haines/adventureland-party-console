"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const file = path.resolve(process.argv[2] || "");
const directory = path.dirname(file);
const build = path.resolve(__dirname, "../../.build");
const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
if (manifest.schema !== 1 || !Object.keys(manifest.files || {}).length)
  throw new Error("Invalid evidence manifest");
for (const [name, expected] of Object.entries(manifest.files)) {
  const full = path.resolve(directory, name);
  const relative = path.relative(build, full);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(`Evidence outside .build: ${name}`);
  const actual = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
  if (actual !== expected) throw new Error(`Evidence changed: ${name}`);
}
const benchmark = JSON.parse(fs.readFileSync(path.join(directory, "benchmark.json")));
if (!benchmark.pass) throw new Error("Evidence hashes match, but benchmark did not pass");
console.log(
  `Verified ${Object.keys(manifest.files).length} evidence files; benchmark passed at ${benchmark.wallSpeedup.toFixed(2)}x wall speedup.`,
);

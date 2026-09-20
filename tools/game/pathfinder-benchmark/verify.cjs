const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { createNative } = require("./native.cjs");
const { validate } = require("./validate.cjs");
const engines = ["native-visible", "native-hidden", "alclient"];
function checkCounts(data) {
  let expected = 0;
  for (const route of data.metadata.routes) {
    const count = data.metadata.measurementsByRoute?.[route.id] || data.metadata.passes;
    for (const engine of engines) {
      const rows = data.results.filter((r) => r.route === route.id && r.engine === engine);
      assert.equal(rows.length, count, `${route.id}/${engine} count`);
      assert.deepEqual(
        rows.map((r) => r.pass).sort((a, b) => a - b),
        Array.from({ length: count }, (_, i) => i),
        `${route.id}/${engine} exact pass indices`,
      );
      expected += count;
    }
  }
  assert.equal(data.results.length, expected, "total measurements");
}
function verify(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const directory = path.resolve(__dirname, "../../../.caracal/game_files", data.metadata.version);
  for (const [name, expected] of Object.entries(data.metadata.hashes)) {
    const actual = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(directory, name)))
      .digest("hex");
    assert.equal(actual, expected, `${name} source hash`);
  }
  checkCounts(data);
  const native = createNative(directory),
    routes = new Map(data.metadata.routes.map((r) => [r.id, r]));
  for (const row of data.results) {
    assert.ok(Number.isFinite(row.ms) && row.ms >= 0, "finite planning time");
    assert.deepEqual(
      validate(native, routes.get(row.route), row.path),
      row.quality,
      `${row.route}/${row.engine}/${row.pass} validation`,
    );
  }
  console.log(
    `Verified ${data.results.length} measurements, ${routes.size} routes, exact source hashes, and all stored route validations.`,
  );
  return data;
}
if (require.main === module)
  verify(path.resolve(process.argv[2] || ".build/benchmarks/alclient-comparison/results.json"));
module.exports = { verify, checkCounts };

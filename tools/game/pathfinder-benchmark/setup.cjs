// Network is confined to this explicit setup step. The benchmark itself is offline.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const esbuild = require("esbuild");
const revision = "853cf80279b761ecbea238c4b3acd9caab102e11";
const directory = path.resolve(__dirname, "../../../.build/benchmarks/alclient-source");
async function main() {
  await fs.mkdir(directory, { recursive: true });
  const hashes = {};
  for (const file of ["source/Pathfinder.ts", "source/Constants.ts", "package.json"]) {
    const response = await fetch(
      `https://raw.githubusercontent.com/earthiverse/ALClient/${revision}/${file}`,
    );
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    const source = await response.text();
    hashes[file] = crypto.createHash("sha256").update(source).digest("hex");
    await fs.writeFile(path.join(directory, path.basename(file)), source);
  }
  await esbuild.build({
    entryPoints: [path.join(directory, "Pathfinder.ts")],
    outfile: path.join(directory, "pathfinder.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    sourcemap: true,
    plugins: [
      {
        name: "external-wasm",
        setup(build) {
          build.onResolve({ filter: /^alpathfinder$/ }, () => ({
            path: require.resolve("alpathfinder"),
            external: true,
          }));
        },
      },
    ],
  });
  const wasm = await fs.readFile(
    path.join(__dirname, "node_modules/alpathfinder/alpathfinder_bg.wasm"),
  );
  hashes.wasm = crypto.createHash("sha256").update(wasm).digest("hex");
  await fs.writeFile(path.join(directory, "alpathfinder_bg.wasm"), wasm);
  await fs.writeFile(
    path.join(directory, "provenance.json"),
    JSON.stringify({ revision, hashes, alpathfinder: "0.6.0" }, null, 2),
  );
  console.log(`Prepared ALClient ${revision}; benchmark dependencies remain isolated.`);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

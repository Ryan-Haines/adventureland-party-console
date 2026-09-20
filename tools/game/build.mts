import { build } from "esbuild";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { classes, digest, verifyManifest, type GameManifest, type Artifact } from "./manifest.ts";
import { adaptLegacyRuntime } from "./legacy-boundary.ts";
import { withBuildLock, readJson } from '../build-store.ts';
import { gameStore, rememberCurrent, rememberGame, cleanGame } from './history.ts';
import { steamBridgeVersion } from '../../runtime/steam/connection.ts';

export async function buildGame(root: string, publish = false): Promise<GameManifest> {
  return withBuildLock(gameStore(root), () => buildLocked(root, publish));
}
async function buildLocked(root: string, publish: boolean): Promise<GameManifest> {
  const destination = path.join(root, ".build/game");
  const inputs = new Map<string, string>();
  const results = await Promise.allSettled(
    classes.map(async (name) => {
      const result = await build({
        absWorkingDir: root,
        entryPoints: [`runtime/characters/entries/${name}.ts`],
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "es2022",
        write: false,
        metafile: true,
        plugins: [
          {
            name: "shared-lifecycle-boundary",
            setup(builder) {
              builder.onLoad({ filter: /\.[cm]?[jt]s$/ }, async (args) => {
                const source = await readFile(args.path, "utf8");
                const hash = digest(source);
                if (inputs.has(args.path) && inputs.get(args.path) !== hash)
                  throw new Error("Source changed during class build: " + args.path);
                inputs.set(args.path, hash);
                return {
                  contents: /[\\/]characters[\\/]shared\.js$/.test(args.path)
                    ? adaptLegacyRuntime(source)
                    : source,
                  loader: args.path.endsWith(".ts") ? "ts" : "js",
                };
              });
            },
          },
        ],
        banner: {
          // Bridge changes must invalidate class signatures so existing native
          // loaders replace their iframe and install the new bridge as well.
          js: `// Generated class bundle. Edit runtime/characters and run npm run build:characters; do not edit.\n// Steam bridge revision: ${steamBridgeVersion}`,
        },
      });
      const content = result.outputFiles[0].text;
      const sha256 = digest(content);
      return {
        name,
        content,
        artifact: {
          file: `generated/${sha256}/${name}.js`,
          sha256,
          inputs: Object.keys(result.metafile.inputs).sort(),
        } satisfies Artifact,
      };
    }),
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      "Class build failed; previous generation retained",
    );
  const compiled = results.map((result) => {
    if (result.status !== "fulfilled") throw new Error("Missing compiled class");
    return result.value;
  });
  for (const [file, hash] of inputs)
    if (digest(await readFile(file, "utf8")) !== hash)
      throw new Error("Source changed during class build; previous generation retained: " + file);
  const manifest: GameManifest = {
    schema: 1,
    generation: digest(
      compiled.map((entry) => entry.name + ":" + entry.artifact.sha256).join("\n"),
    ),
    classes: Object.fromEntries(
      compiled.map((entry) => [entry.name, entry.artifact]),
    ) as GameManifest["classes"],
  };

  async function writeGeneration(directory: string): Promise<void> {
    await rememberCurrent(directory);
    for (const entry of compiled) {
      const file = path.join(directory, entry.artifact.file);
      await mkdir(path.dirname(file), { recursive: true });
      const previous = await readFile(file, "utf8").catch(() => null);
      if (previous !== null && previous !== entry.content)
        throw new Error("Immutable artifact was modified: " + file);
      if (previous === null) {
        try {
          await writeFile(file, entry.content, { flag: "wx" });
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== "EEXIST" ||
            (await readFile(file, "utf8")) !== entry.content
          )
            throw error;
        }
      }
    }
    await verifyManifest(directory, manifest);
    await rememberGame(directory, manifest);
    const file = path.join(directory, "manifest.json");
    const content = JSON.stringify(manifest, null, 2) + "\n";
    if ((await readFile(file, "utf8").catch(() => "")) === content) {
      await cleanGame(directory, true);
      return;
    }
    const temporary = file + "." + randomUUID() + ".tmp";
    await writeFile(temporary, content);
    await rename(temporary, file);
    await cleanGame(directory, true);
  }
  await writeGeneration(destination);
  const pinned = (await readJson<{pinned?: string}>(path.join(destination, 'publication.json')))?.pinned;
  if (publish && !pinned) await writeGeneration(path.join(root, "characters"));
  console.log(
    "Verified game generation " +
      manifest.generation.slice(0, 12) +
      (publish && !pinned ? " published." : pinned ? " staged; character rollback is pinned." : " staged."),
  );
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildGame(
    fileURLToPath(new URL("../../", import.meta.url)),
    process.argv.includes("--publish"),
  );

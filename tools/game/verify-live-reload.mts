import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { classes, digest, verifyManifest, type GameManifest, type CharacterClass } from "./manifest.ts";
import { withBuildLock } from '../build-store.ts';
import { gameStore } from './history.ts';

await withBuildLock(gameStore(fileURLToPath(new URL('../../', import.meta.url))), async () => {
const directory = fileURLToPath(new URL("../../characters/", import.meta.url));
const manifestFile = path.join(directory, "manifest.json");
const className = (process.argv[2] || "warrior") as CharacterClass;
if (!classes.includes(className)) throw new Error("Choose a compiled character class");
interface Status { name: string; ctype: string; runtime: string; codeRevision: string }
async function statuses(): Promise<Status[]> {
  const response = await fetch("http://127.0.0.1:924/party-api/state?catalog=0", { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Party API is unavailable");
  const state = await response.json() as { characters: Record<string, Status> };
  return Object.values(state.characters);
}
async function waitForRevision(name: string, revision: string): Promise<void> {
  const deadline = Date.now() + 30000;
  do {
    if ((await statuses()).find(status => status.name === name)?.codeRevision === revision) return;
    await delay(500);
  } while (Date.now() < deadline);
  throw new Error("CODE reload did not publish its expected revision within 30 seconds");
}
async function publish(manifest: GameManifest): Promise<void> {
  await verifyManifest(directory, manifest);
  const temporary = manifestFile + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(manifest, null, 2) + "\n");
  await rename(temporary, manifestFile);
}
const original = await verifyManifest(directory, JSON.parse(await readFile(manifestFile, "utf8")));
const runtime = process.argv.includes("--native") ? "native" : "headless";
const character = (await statuses()).find(status => status.ctype === className && status.runtime === runtime);
if (!character) throw new Error(`No ${runtime} character of that class is reporting`);
const source = await readFile(path.join(directory, original.classes[className].file), "utf8");
const revision = "reload-probe-" + randomUUID();
const anchor = 'codeRevision: "' + character.codeRevision + '"';
if (!source.includes(anchor)) throw new Error("Cannot locate the telemetry revision; no files changed");
// Only the reported revision changes; no movement, inventory or combat action is added.
const content = source.replace(anchor, 'codeRevision: "' + revision + '"');
const sha256 = digest(content);
const candidate = structuredClone(original);
candidate.classes[className] = { ...candidate.classes[className], sha256, file: `generated/${sha256}/${className}.js` };
candidate.generation = digest(classes.map(name => name + ":" + candidate.classes[name].sha256).join("\n"));
const artifact = path.join(directory, candidate.classes[className].file);
await mkdir(path.dirname(artifact), { recursive: true });
await writeFile(artifact, content, { flag: "wx" });
async function restore(): Promise<void> {
  const current = JSON.parse(await readFile(manifestFile, "utf8")) as GameManifest;
  if (current.generation !== candidate.generation)
    throw new Error("Another build was published during verification; it has been retained");
  await publish(original);
  await waitForRevision(character!.name, character!.codeRevision);
  console.log("Original generation restored and reporting.");
}
try {
  await publish(candidate);
  await waitForRevision(character.name, revision);
  console.log("Live CODE replacement acknowledged through " + character.name + " telemetry.");
} finally { await restore(); }
});

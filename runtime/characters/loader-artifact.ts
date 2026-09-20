import type { Artifact, GameManifest, CharacterClass } from "../../tools/game/manifest.ts";
type ReadSource = (file: string) => Promise<string>;

export async function classArtifact(read: ReadSource, name: string): Promise<Artifact> {
  const manifest = JSON.parse(await read("manifest.json")) as GameManifest;
  const entry = manifest.classes?.[name as CharacterClass];
  if (manifest.schema !== 1 || !entry || !/^generated\/[a-f0-9]{64}\/[a-z]+\.js$/.test(entry.file))
    throw new Error("Invalid compiled class manifest");
  return entry;
}
export async function compileArtifact(read: ReadSource, entry: Artifact, baseUrl: string): Promise<() => void> {
  const bundle = await read(entry.file);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bundle))))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== entry.sha256) throw new Error("Compiled class checksum mismatch");
  // Native CODE must execute in its runner realm, after verifying the local build.
  // oxlint-disable-next-line typescript/no-implied-eval
  const compiled = new Function(bundle + "\n//# sourceURL=" + baseUrl + entry.file);
  return () => { compiled(); };
}

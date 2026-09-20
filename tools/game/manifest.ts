import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const classes = [
  "warrior",
  "paladin",
  "rogue",
  "ranger",
  "mage",
  "priest",
  "merchant",
] as const;
export type CharacterClass = (typeof classes)[number];
export interface Artifact {
  file: string;
  sha256: string;
  inputs: string[];
}
export interface GameManifest {
  schema: 1;
  generation: string;
  classes: Record<CharacterClass, Artifact>;
}
export function digest(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}
async function verifyArtifact(directory: string, name: CharacterClass, entry: Artifact | undefined): Promise<void> {
  if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      entry.file !== `generated/${entry.sha256}/${name}.js`)
    throw new Error("Invalid class artifact: " + name);
  const file = path.resolve(directory, entry.file);
  if (!file.startsWith(path.resolve(directory) + path.sep))
    throw new Error("Artifact escaped the CODE directory");
  if (digest(await readFile(file)) !== entry.sha256)
    throw new Error("Artifact checksum mismatch: " + name);
}
export async function verifyManifest(directory: string, value: unknown): Promise<GameManifest> {
  if (!value || typeof value !== "object") throw new Error("Invalid game manifest");
  const manifest = value as GameManifest;
  if (manifest.schema !== 1 || typeof manifest.generation !== "string")
    throw new Error("Unsupported game manifest");
  for (const name of classes) await verifyArtifact(directory, name, manifest.classes?.[name]);
  const generation = digest(
    classes.map((name) => name + ":" + manifest.classes[name].sha256).join("\n"),
  );
  if (manifest.generation !== generation) throw new Error("Game generation checksum mismatch");
  return manifest;
}

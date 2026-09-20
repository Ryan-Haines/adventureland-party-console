import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ignored = new Set([
  "node_modules",
  ".git",
  ".next",
  ".vinext",
  ".wrangler",
  "dist",
  ".build",
  "outputs",
  "work",
]);

export async function fingerprint(directory: string): Promise<string> {
  const hash = createHash("sha256").update(process.version);
  async function visit(relative: string): Promise<void> {
    const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (
        ignored.has(entry.name) ||
        entry.name.endsWith(".tsbuildinfo") ||
        entry.name.endsWith(".log")
      )
        continue;
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) hash.update(name).update(await readFile(path.join(directory, name)));
    }
  }
  await visit("");
  return hash.digest("hex").slice(0, 20);
}

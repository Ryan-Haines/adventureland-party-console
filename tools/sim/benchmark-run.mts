// The e2e benchmarks' shared run steps: e2e-benchmark.mts and e2e-rate-benchmark.mts each run npm
// under the current Node, write into a timestamped folder and archive each run's Playwright report.
import { mkdirSync, cpSync } from "node:fs";
import path from "node:path";

export const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
export function runDirectory(root: string, folder: string): string {
  const out = path.join(root, ".build", folder, new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(out, { recursive: true });
  return out;
}
export function archiveReport(root: string, archive: string): void {
  mkdirSync(path.join(archive, ".build"), { recursive: true });
  for (const directory of ["e2e-report", "e2e-results"])
    cpSync(path.join(root, ".build", directory), path.join(archive, ".build", directory), { recursive: true });
}

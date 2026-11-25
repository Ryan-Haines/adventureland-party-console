// Playwright empties outputDir (.build/e2e-results) at each run's start, so a rerun deleted the
// failed run's dump before anyone traced it (Live B step 11: W53's run 3 dump went with run 4).
// pretest:e2e runs this first: the last run's folder moves to .build/e2e-runs/<its start>, named
// from the reporter's reproduction/run.json (e2e/artifact-reporter.cjs onBegin).
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = path.join(root, '.build/e2e-results');
if (existsSync(results) && readdirSync(results).length) {
  const run = path.join(results, 'reproduction/run.json');
  const started = existsSync(run) ? JSON.parse(readFileSync(run, 'utf8')).started : null;
  const stamp = new Date(started ?? statSync(results).mtimeMs).toISOString().replace(/[:.]/g, '-');
  const runs = path.join(root, '.build/e2e-runs');
  mkdirSync(runs, { recursive: true });
  let target = path.join(runs, stamp);
  for (let n = 2; existsSync(target); n++) target = path.join(runs, `${stamp}-${n}`);
  renameSync(results, target);
  console.log(`Kept the last e2e run's results in ${path.relative(root, target)}`);
}

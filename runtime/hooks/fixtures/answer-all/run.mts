// npm run test:addon-neutral [-- <node --test flags>] [-- <test files>]: builds the bundles and runs
// the core unit suite (scripts/tests/) with the answer-all fixture installed beside the real add-ons.
// An installed add-on starts switched off, so every core row must pass as it does without the fixture.
// Test files given here run in place of the whole suite. The installed list is written again without
// the fixture at the end; the bundles keep it until the next build, which every test run's pretest makes.
import { spawnSync } from 'node:child_process';
import { ROOT, writeInstalled } from '../../build/installed.mts';

const args = process.argv.slice(2), flags = args.filter(a => a.startsWith('-')), files = args.filter(a => !a.startsWith('-'));
const node = (...argv: string[]) => spawnSync(process.execPath, argv, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PARTY_ADDON_FIXTURE: '1' } }).status ?? 1;
let status = 0;
try {
  for (const build of ['tools/build-shared.mts', 'tools/build-runtime.mts', 'tools/game/build.mts']) if ((status = node(build))) break;
  if (!status) status = node('--test', '--test-concurrency=2', ...flags, ...files.length ? files : ['scripts/tests/*.test.cjs']);
} finally {
  writeInstalled(ROOT);
}
process.exitCode = status;

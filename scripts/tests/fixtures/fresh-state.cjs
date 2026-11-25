// Prints, as JSON, the coordinator state a fresh install loads on a commit: that commit's own
// createInitialCoordinatorState on an empty save, then its farming scopes as the start makes them
// (runtime/tasks/coordinator/groups.ts), with the start's context fixed (the clock at 100,
// realm SR_USII, four empty headless slots, no configured merchant). The settings owner's row
// (coordinator-initialization.test.cjs) compares today's fresh state with v1.5.0's.
//   node scripts/tests/fixtures/fresh-state.cjs b9b5c91e > scripts/tests/fixtures/fresh-state-b9b5c91e.json
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '../../..'), ref = process.argv[2];
fs.mkdirSync(path.join(root, '.build'), { recursive: true });
const dir = fs.mkdtempSync(path.join(root, '.build', 'fresh-state-'));
try {
  execFileSync('git', ['-C', root, 'archive', '--format=tar', '-o', path.join(dir, 'ref.tar'), ref, 'runtime', 'dashboard/lib']);
  execFileSync('tar', ['-xf', 'ref.tar'], { cwd: dir });
  const { createInitialCoordinatorState } = require(path.join(dir, 'runtime/settings/coordinator/initial.ts'));
  const state = createInitialCoordinatorState({ persistedSettings: {}, persistedSelections: {}, persistedHistory: {}, persistedBankState: {},
    persistedRoster: {}, persistedALData: {}, initialHeadless: [null, null, null, null], configuredRealm: 'SR_USII' },
  { now: () => 100, loadBankVaultDefinitions: () => [] });
  require(path.join(dir, 'runtime/tasks/coordinator/groups.ts')).createFarmingScopes(state, require(path.join(dir, 'runtime/settings/coordinator/table.ts')).coordinatorSettings().lists, () => 100);
  const commit = execFileSync('git', ['-C', root, 'rev-parse', ref], { encoding: 'utf8' }).trim();
  process.stdout.write(JSON.stringify({ commit, command: `node scripts/tests/fixtures/fresh-state.cjs ${ref}`, state }, null, 1) + '\n');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

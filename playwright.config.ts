import { defineConfig, devices } from '@playwright/test';
// Local browsers use the installed GPU; GPU-less CI retains explicit software rendering.
const browserRendering=process.env.E2E_BROWSER_RENDERING||(process.env.CI?'software':'hardware');
if(!['hardware','software'].includes(browserRendering))throw Error('E2E_BROWSER_RENDERING must be hardware or software');
const renderingArgs=browserRendering==='hardware'?['--enable-gpu']:['--use-angle=swiftshader-webgl','--enable-unsafe-swiftshader'];
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/game/setup.mjs',
  projects: [
    { name: 'debug', testMatch: ['**/debug-instance.spec.ts', '**/debug-container.spec.ts'],
      // Video and named screenshots already record every visible debug journey.
      // A second high-FPS trace screencast adds hundreds of MB and can exhaust
      // Playwright's trace-merge deadline after all lifecycle assertions pass.
      use: { trace: { mode: 'on', snapshots: true, screenshots: false, sources: true } } },
    { name: 'console', testMatch: ['**/native-graphics-diagnostic.spec.ts', '**/console.spec.ts', '**/console-image-stall.spec.ts', '**/console-october-events.spec.ts', '**/console-event-clock.spec.ts', '**/console-build*.spec.ts', '**/console-bank-automarks.spec.ts', '**/console-bankboi-offerings.spec.ts', '**/hunt.spec.ts', '**/lucky-slot-lock.spec.ts', '**/lucky-slot-elimination.spec.ts', '**/doll-markup.spec.ts', '**/merchant-bank-visit.spec.ts', '**/console-persistence.spec.ts', '**/console-field-registry.spec.ts', '**/console-reports.spec.ts', '**/console-coordinator.spec.ts', '**/console-requests.spec.ts', '**/live-settings-hooks.spec.ts'], testIgnore: ['**/console-build-addon.spec.ts'] },
    // On demand only: docs/state-field-registry.md § Speed, and the console's latency measures
    // (console-speed.spec.ts), whose bounds wait for a measured spread (QUESTIONS U8).
    { name: 'speed', testMatch: ['**/field-registry-speed.spec.ts', '**/console-speed.spec.ts'] },
    // The whole candidate build of a repo copy runs once, in the final gate's full `npm test`, not in
    // each console project run (QUESTIONS U9).
    { name: 'build', testMatch: ['**/console-build-addon.spec.ts'] },
    // The windows (test-windows DESIGN.md section 2). E2E_SKIP_CAVE leaves out the Cave windows.
    { name: 'live', fullyParallel:true, testMatch: ['**/windows/*.spec.ts'],
      testIgnore: process.env.E2E_SKIP_CAVE === '1' ? ['**/windows/W41*.spec.ts', '**/windows/W42-*.spec.ts'] : [],
      // The windows tagged @alone run in live-alone, once this project's two stacks are down.
      grepInvert: /@alone/,
      use: { trace: { mode: 'on', snapshots: false, screenshots: false, sources: true } } },
    // W01 and W02 measure kill, attack and call rates that a second stack lowers (test-windows
    // DESIGN.md 2.3 and 3.4), so they start only when every live worker has finished. e2e/game/setup.mjs
    // starts the stacks of a run's busiest phase, so `--project=live-alone --no-deps` as its own run
    // brings up one stack and a run with both phases keeps the second stack up through the alone phase.
    { name: 'live-alone', fullyParallel: true, testMatch: ['**/windows/*.spec.ts'], grep: /@alone/, workers: 1, dependencies: ['live'],
      use: { trace: { mode: 'on', snapshots: false, screenshots: false, sources: true } } },
  ],
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: '.build/e2e-results',
  reporter: [
    ['list'],
    ['./e2e/artifact-reporter.cjs'],
    // HTML clears its own folder onEnd; keep the prior evidence manifest outside.
    ['html', { outputFolder: '.build/e2e-report/html', open: 'never' }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 },
    // Keep DOM/network/source evidence plus video and screenshots below. A
    // duplicate high-FPS trace screencast can dominate canvas-heavy journeys.
    trace: { mode: 'on', snapshots: true, screenshots: false, sources: true },
    screenshot: 'on',
    video: 'on',
    launchOptions: { args: [...renderingArgs, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] },
  },
});

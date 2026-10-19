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
    { name: 'debug', testMatch: ['**/debug-instance.spec.ts', '**/debug-container.spec.ts'] },
    { name: 'console', testMatch: ['**/native-graphics-diagnostic.spec.ts', '**/console.spec.ts', '**/console-build*.spec.ts', '**/console-bank-automarks.spec.ts', '**/console-bankboi-offerings.spec.ts', '**/hunt.spec.ts', '**/lucky-slot-lock.spec.ts', '**/lucky-slot-elimination.spec.ts', '**/doll-markup.spec.ts', '**/merchant-bank-visit.spec.ts'] },
    { name: 'live', fullyParallel:true, testMatch: ['**/live-console-*.spec.ts', '**/live-halloween.spec.ts', '**/live-event-runtime-recovery.spec.ts', '**/live-event-entry-failure.spec.ts', '**/live-event-return-handoff.spec.ts', '**/live-cave.spec.ts', '**/live-game.spec.ts', '**/live-monster-safety-reach.spec.ts', '**/live-economy.spec.ts', '**/live-exchange-collection.spec.ts', '**/live-bankboi.spec.ts', '**/live-bank-staging.spec.ts', '**/live-manual-upgrade.spec.ts', '**/live-bankboi-offerings.spec.ts', '**/live-catalog.spec.ts', '**/live-franky.spec.ts', '**/live-franky-party.spec.ts', '**/live-hunt-*.spec.ts', '**/live-solo-ranger.spec.ts', '**/live-merchant-config.spec.ts', '**/live-merchant-transporter-approach.spec.ts', '**/live-stale-merchant.spec.ts', '**/live-home-realm.spec.ts', '**/live-home-connect.spec.ts', '**/live-bank-npc-sales.spec.ts', '**/live-bank-collection.spec.ts', '**/live-merchant-realm-recovery.spec.ts', '**/live-navigation-supersession.spec.ts', '**/live-merchant-anniversary-availability.spec.ts', '**/live-combat-handoff.spec.ts', '**/live-farming-handoff.spec.ts', '**/live-equipment.spec.ts', '**/live-mailbox.spec.ts', '**/live-wtb-unconfirmed-purchase.spec.ts', '**/live-stat-scroll-bank.spec.ts', '**/live-gathering-cooldown.spec.ts', '**/live-exchange-reward-bank.spec.ts'],
      testIgnore: process.env.E2E_SKIP_CAVE === '1' ? ['**/live-cave.spec.ts'] : [],
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
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    launchOptions: { args: [...renderingArgs, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] },
  },
});

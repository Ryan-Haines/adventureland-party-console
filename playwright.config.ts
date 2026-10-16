import { defineConfig, devices } from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const gameplayTitles:string[]=JSON.parse(readFileSync(path.resolve('e2e/gameplay-titles.json'),'utf8'));
const selectors=process.argv.flatMap((value,index,args)=>value.startsWith('--project=')?[value.slice(10)]:value==='--project'?[args[index+1]]:[]);
const nativeGameplay = process.env.E2E_GAMEPLAY_BACKEND === 'native' || (selectors.includes('live') && !selectors.includes('simulation'));
const migrated = new RegExp('(?:'+gameplayTitles.map(title=>title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')$');

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/game/setup.mjs',
  projects: [
    ...(!nativeGameplay ? [{name:'simulation',testMatch:['**/simulation-gameplay.spec.ts'],use:{trace:'off' as const,screenshot:'off' as const,video:'off' as const}}] : []),
    { name: 'debug', testMatch: ['**/debug-instance.spec.ts', '**/debug-container.spec.ts'] },
    { name: 'console', testMatch: ['**/native-graphics-diagnostic.spec.ts', '**/console.spec.ts', '**/console-build*.spec.ts', '**/console-bank-automarks.spec.ts', '**/console-bankboi-offerings.spec.ts', '**/hunt.spec.ts', '**/lucky-slot-lock.spec.ts', '**/lucky-slot-elimination.spec.ts', '**/doll-markup.spec.ts', '**/merchant-bank-visit.spec.ts'] },
    { name: 'live', grepInvert: nativeGameplay ? undefined : migrated, testMatch: ['**/live-console-*.spec.ts', '**/live-halloween.spec.ts', '**/live-event-runtime-recovery.spec.ts', '**/live-event-entry-failure.spec.ts', '**/live-event-return-handoff.spec.ts', '**/live-cave.spec.ts', '**/live-game.spec.ts', '**/live-monster-safety-reach.spec.ts', '**/live-economy.spec.ts', '**/live-exchange-collection.spec.ts', '**/live-bankboi.spec.ts', '**/live-bank-staging.spec.ts', '**/live-manual-upgrade.spec.ts', '**/live-bankboi-offerings.spec.ts', '**/live-catalog.spec.ts', '**/live-franky.spec.ts', '**/live-franky-party.spec.ts', '**/live-hunt-*.spec.ts', '**/live-solo-ranger.spec.ts', '**/live-merchant-config.spec.ts', '**/live-merchant-transporter-approach.spec.ts', '**/live-stale-merchant.spec.ts', '**/live-home-realm.spec.ts', '**/live-home-connect.spec.ts', '**/live-bank-npc-sales.spec.ts', '**/live-bank-collection.spec.ts', '**/live-merchant-realm-recovery.spec.ts', '**/live-navigation-supersession.spec.ts', '**/live-merchant-anniversary-availability.spec.ts', '**/live-combat-handoff.spec.ts', '**/live-farming-handoff.spec.ts', '**/live-equipment.spec.ts'],
      testIgnore: process.env.E2E_SKIP_CAVE === '1' ? ['**/live-cave.spec.ts'] : [],
      use: { trace: { mode: 'on', snapshots: false, screenshots: false, sources: true } } },
  ],
  fullyParallel: false,
  workers: 1,
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
    launchOptions: { args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] },
  },
});

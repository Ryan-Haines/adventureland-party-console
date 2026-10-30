import { defineConfig, devices } from '@playwright/test';

// Coordinator profile (docs/efficiency.md, Coordinator). It reuses the live
// fixtures and the disposable game stack; traces, screenshots and video are off
// so the browser client costs the same in every run.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/profile-coordinator.spec.ts'],
  globalSetup: './e2e/game/setup.mjs',
  projects: [{ name: 'live' }],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 900_000,
  expect: { timeout: 15_000 },
  outputDir: '.build/e2e-results',
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    launchOptions: { args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] },
  },
});

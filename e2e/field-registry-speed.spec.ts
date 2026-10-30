// Speed check for the field registry (docs/state-field-registry.md § Speed).
// It measures the same journeys on v1.4.0 and on this branch in both
// PARTY_STATE_FIELDS modes, and writes .build/field-speed/<label>.json.
// Run: PARTY_SPEED_LABEL=enforce npx playwright test --project=speed
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

test.use({ merchantDialogs: true });
test.setTimeout(600_000);
// A full `npm test` run skips it; the comparison needs a labelled run per build.
test.skip(!process.env.PARTY_SPEED_LABEL, 'set PARTY_SPEED_LABEL to measure');

const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { samples: sorted.length, median: at(0.5), p95: at(0.95) };
};
const round = (value: number) => Math.round(value * 10) / 10;

async function timed(action: () => Promise<unknown>) {
  const started = performance.now();
  await action();
  return performance.now() - started;
}

/** Returns right after the fixture's 1 s heartbeat lands, so a delivered report stays current for most of a second. */
async function afterHeartbeat(url: string) {
  const seen = async () => (await (await fetch(`${url}/party-api/state?section=fast&dashboard=1`)).json()).characters?.W?.seenAt;
  const first = await seen();
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && (await seen()) === first) await new Promise(resolve => setTimeout(resolve, 10));
}

const carried = async (page: Page) => Number(/carried: ([\d,]+)/.exec(await page.getByTitle(/carried: /).getAttribute('title') || '')?.[1].replaceAll(',', ''));

async function updateLatency(page: Page, app: { url: string; state(): Promise<any>; deliverStatus(report: unknown): Promise<unknown> }, samples: number) {
  const values: number[] = [];
  let missed = 0;
  // PartyGold (party-gold.tsx) sums the gold of the active slots; change one of them.
  const slots = (await (await fetch(`${app.url}/party-api/state?section=core&dashboard=1`)).json()).activeSlots || [];
  const name = slots.find((slot: { character?: string; state: string }) => slot.character && !['empty', 'offline', 'failed'].includes(slot.state)).character;
  await expect.poll(() => carried(page)).toBeGreaterThan(0);
  // The fixture heartbeat restores its fixed gold every second, so each sample starts from this total.
  const base = await carried(page);
  for (let index = 1; index <= samples; index++) {
    await afterHeartbeat(app.url);
    await expect.poll(() => carried(page)).toBe(base);
    const report = { ...(await app.state()).characters[name] };
    delete report.seenAt;
    delete report.inventorySeenAt;
    report.gold += index;
    const started = performance.now();
    await app.deliverStatus(report);
    try {
      await expect.poll(() => carried(page), { intervals: [5], timeout: 3000 }).toBe(base + index);
      values.push(performance.now() - started);
    } catch { missed++; }
  }
  return { ...stats(values), missed };
}

async function sectionTimes(url: string, query: string, samples: number) {
  const times: number[] = [];
  let bytes = 0;
  for (let index = 0; index < samples; index++) {
    const started = performance.now();
    const body = await (await fetch(`${url}/party-api/state?${query}`)).arrayBuffer();
    times.push(performance.now() - started);
    bytes = body.byteLength;
  }
  return { ...stats(times), bytes };
}

test('field registry speed: update latency, section response times, dashboard load and dialogs', async ({ page, app }, info) => {
  const label = process.env.PARTY_SPEED_LABEL || 'unlabelled';
  const result: Record<string, unknown> = { label, mode: process.env.PARTY_STATE_FIELDS || 'shadow' };
  const merchant = page.locator('article').filter({ has: page.getByRole('heading', { name: 'M', exact: true }) });

  // The vinext dev server compiles on the first request; an untimed load keeps that out of the samples.
  await page.goto('/');
  await expect(merchant.getByText('sword', { exact: true })).toBeVisible({ timeout: 90_000 });
  const loads: number[] = [];
  for (let index = 0; index < 5; index++)
    loads.push(await timed(async () => {
      await page.goto('/');
      await expect(merchant.getByText('sword', { exact: true })).toBeVisible();
    }));
  result.firstRender = stats(loads);

  const sword = merchant.getByLabel('Short Sword', { exact: true });
  const openDetails = async () => {
    await sword.click();
    // The fixture's slot 0 is a lucky slot, which opens a menu first (inventory-panel.tsx).
    await page.getByText('Show item details', { exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 60_000 });
  };
  const openComparison = async () => {
    await sword.click({ button: 'right' });
    await page.locator('[data-slot="context-menu-content"]').getByText('Compare with equipped').first().click();
    const submenu = page.locator('[data-slot="context-menu-sub-content"]');
    if (await submenu.isVisible()) await submenu.getByRole('menuitem').first().click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 60_000 });
  };
  const openBank = async () => {
    await page.getByRole('button', { name: 'Bank', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Bank', exact: true })).toBeVisible({ timeout: 60_000 });
  };
  const close = async () => {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };
  // One untimed open each loads the lazy panels, so the samples measure opening, not compiling.
  for (const open of [openDetails, openComparison, openBank]) { await open(); await close(); }
  const details: number[] = [], compare: number[] = [], bank: number[] = [];
  for (let index = 0; index < 10; index++) {
    details.push(await timed(openDetails));
    await close();
    compare.push(await timed(openComparison));
    await close();
    bank.push(await timed(openBank));
    await close();
  }
  Object.assign(result, { itemDetails: stats(details), comparison: stats(compare), bankDialog: stats(bank) });

  result.updateLatencyStream = await updateLatency(page, app, 20);
  // Without the live stream the dashboard falls back to section=fast polling (query-cache.tsx).
  await page.route('**/party-api/dashboard-stream**', route => route.abort());
  await page.goto('/');
  await expect(merchant.getByText('sword', { exact: true })).toBeVisible();
  result.updateLatencyFastPolling = await updateLatency(page, app, 20);

  result.sections = {};
  for (const section of ['fast', 'core', 'inventory'])
    (result.sections as Record<string, unknown>)[section] = await sectionTimes(app.url, `catalog=0&dashboard=1&section=${section}`, 50);
  (result.sections as Record<string, unknown>).full = await sectionTimes(app.url, '', 20);

  const text = JSON.stringify(result, (_key, value) => typeof value === 'number' ? round(value) : value, 1);
  const directory = path.join(process.cwd(), '.build/field-speed');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, `${label}.json`), text);
  await info.attach('field-speed', { body: text, contentType: 'application/json' });
});

// The console's latency measures (QUESTIONS U8): each reports its samples and asserts no bound,
// since a bound needs a measured spread from these runs. The wiring rows stay in the console
// project (console-persistence.spec.ts "status reports reach the dashboard without waiting for saves").
// Run: PARTY_CONSOLE_SPEED=1 npx playwright test --project=speed console-speed
import { test, expect } from './fixtures';

// A full `npm test` run skips it, as field-registry-speed.spec.ts does.
test.skip(!process.env.PARTY_CONSOLE_SPEED, 'set PARTY_CONSOLE_SPEED to measure');

function summary(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)];
  return { count: sorted.length, median: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1], samples };
}

test('status reports reach the dashboard without waiting for saves: latency', async ({ page, app }, info) => {
  // Saves never sit between a status report and the DOM. The fixture heartbeat replaces W every
  // second, so each probe repeats until the dashboard shows it; latency counts from the first send.
  await page.goto('/');
  await expect(page.getByText('1,000 / 1,000').first()).toBeVisible();
  const base = (await app.state()).characters.W;
  const latency: number[] = [], response: number[] = [];
  for (let index = 0; index < 20; index++) {
    const hp = 501 + index, target = `${hp} / 1,000`;
    await page.evaluate(text => {
      const probe = window as unknown as { probeSeenAt?: number };
      delete probe.probeSeenAt;
      const check = () => {
        if (document.body.textContent?.includes(text)) probe.probeSeenAt = Date.now();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }, target);
    const first = Date.now();
    await expect.poll(async () => {
      const sent = performance.now();
      await app.deliverStatus({ ...base, name: 'W', hp });
      response.push(performance.now() - sent);
      return await page.evaluate(() => (window as unknown as { probeSeenAt?: number }).probeSeenAt);
    }).toBeTruthy();
    latency.push(await page.evaluate(() => (window as unknown as { probeSeenAt: number }).probeSeenAt) - first);
  }
  const value = { dom: summary(latency), statusResponseMs: summary(response.map(ms => Math.round(ms * 100) / 100)) };
  console.log('console-speed', 'status-dashboard-latency', JSON.stringify(value));
  await info.attach('status-dashboard-latency', { contentType: 'application/json', body: JSON.stringify(value, null, 2) });
});

// Waits in the page for `selector` to satisfy `state`, timed from the moment before `act` runs.
async function timed(page: import('@playwright/test').Page, selector: string, state: string, act: () => Promise<unknown>) {
  await page.evaluate(([selector, state]) => {
    const test = () => {
      const element = document.querySelector(selector);
      if (state === 'present') return !!element;
      if (!element) return false;
      if (state.startsWith('class:')) return element.className.includes(state.slice(6));
      if (state.startsWith('!class:')) return !element.className.includes(state.slice(7));
      if (state.startsWith('text:')) return (element.textContent || '').includes(state.slice(5));
      if (state.startsWith('!text:')) return !(element.textContent || '').includes(state.slice(6));
      return false;
    };
    const started = performance.now();
    (window as any).__partyTimed = new Promise<number>(resolve => {
      const check = () => { if (test()) { observer.disconnect(); resolve(performance.now() - started); } };
      const observer = new MutationObserver(check);
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      check();
    });
  }, [selector, state]);
  await act();
  return Math.round(await page.evaluate(() => (window as any).__partyTimed));
}

test('the bank tab and the first render: latency', async ({ page, app }, info) => {
  // The wiring rows are console-requests.spec.ts "bank tab shows marks, unmarks, withdrawals, rules and
  // bank changes" and "game log capture reaches the open log sidebar".
  const initial = await app.state();
  const sword = initial.characters.M.items.find((entry: any) => entry?.item?.name === 'sword');
  const catalog = (name: string) => initial.merchantCatalog.allItems.find((entry: any) => entry.id === name);
  const bank = (extra: string[]) => ({ gold: 100000, packs: { items0: [{ ...sword, slot: 0, item: { ...sword.item, level: 0 } },
    ...extra.map((name, index) => ({ slot: index + 1, item: { name, q: 1 }, meta: catalog(name).meta }))] } });
  const checkpoint = (extra: string[]) => page.request.post(`${app.url}/party-api/bankboi/checkpoint`, { headers: { Origin: app.url }, data: { character: 'M', bank: bank(extra) } });
  expect((await checkpoint([])).ok()).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'M', exact: true })).toBeVisible();
  // The first render, over warm reloads.
  const firstRender: number[] = [];
  for (let index = 0; index < 3; index++) {
    const started = Date.now();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'M', exact: true })).toBeVisible();
    firstRender.push(Date.now() - started);
  }
  await page.getByRole('button', { name: 'Bank', exact: true }).click();
  const pane = page.getByRole('dialog', { name: 'Bank', exact: true });
  const label = sword.meta.definition.name || 'sword';
  await expect(pane.getByLabel(label, { exact: true })).toBeVisible();
  const tile = `[role="dialog"] [aria-label="${label}"]`;
  const menu = page.locator('[data-slot="context-menu-content"]');
  const choose = async (name: string) => {
    await pane.getByLabel(label, { exact: true }).click({ button: 'right' });
    await menu.getByRole('menuitem', { name, exact: true }).click();
  };
  const confirm = (name: string) => page.getByRole('dialog').last().getByRole('button', { name, exact: true }).click();
  const latency: Record<string, number[]> = { markWithdrawal: [], unmarkWithdrawal: [], markNpcSale: [], clearMarks: [], bankChange: [] };
  for (let round = 0; round < 3; round++) {
    latency.markWithdrawal.push(await timed(page, tile, 'class:border-amber-400', () => choose('Mark for withdrawal')));
    latency.unmarkWithdrawal.push(await timed(page, tile, '!class:border-amber-400', () => choose('Unmark withdrawal')));
    await choose('Sell to NPC…');
    latency.markNpcSale.push(await timed(page, tile, 'text:NPC sale', () => confirm('Sell to NPC')));
    latency.clearMarks.push(await timed(page, tile, '!text:NPC sale', () => choose('Clear all marks')));
  }
  // Each change lands at a different point of the bank poll (STATUS_PICKS.dashboardPolls.bank).
  const extras = ['coat', 'helmet', 'shoes', 'gloves', 'pants'];
  for (let index = 0; index < extras.length; index++) {
    await page.waitForTimeout(index * 400);
    const name = catalog(extras[index]).meta.definition.name || extras[index];
    latency.bankChange.push(await timed(page, `[role="dialog"] [aria-label="${name}"]`, 'present', () => checkpoint(extras.slice(0, index + 1))));
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show logs', exact: true }).click();
  // Each line lands at a different point of the logs poll.
  const capture: number[] = [];
  for (let index = 0; index < 6; index++) {
    await page.waitForTimeout(index * 170);
    const message = `Latency probe ${index}`;
    capture.push(await timed(page, '[aria-label="Live logs"]', `text:${message}`, () =>
      fetch(`${app.url}/party-api/game-logs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url },
        body: JSON.stringify({ character: 'W', events: [{ session: 'latency', seq: index + 1, at: Date.now(), message, color: 'white' }] }) })));
  }
  const value = { firstRender: summary(firstRender), ...Object.fromEntries(Object.entries(latency).map(([name, samples]) => [name, summary(samples)])), logCapture: summary(capture) };
  console.log('console-speed', 'bank-and-render-latency', JSON.stringify(value));
  await info.attach('bank-and-render-latency', { contentType: 'application/json', body: JSON.stringify(value, null, 2) });
});

import { test, expect } from './fixtures';

// Request efficiency (docs/efficiency.md § Requests and logs) against the real
// coordinator behind the hosting gateway.

test('readiness route answers without building the state payload', async ({ app }, info) => {
  const started = performance.now();
  const response = await fetch(`${app.url}/party-api/ready`);
  const body = await response.text();
  const elapsed = performance.now() - started;
  await info.attach('ready-response', { body: JSON.stringify({ status: response.status, body, bytes: body.length, ms: elapsed }), contentType: 'application/json' });
  expect(response.status).toBe(200);
  expect(JSON.parse(body)).toEqual({ ready: true });
});

test('unknown state sections answer 400 and the dashboard requests only known sections', async ({ page, app }, info) => {
  const known = ['fast', 'inventory', 'logs', 'bank', 'market', 'catalog', 'config', 'core'];
  const unknown = await fetch(`${app.url}/party-api/state?section=mail`);
  const body = await unknown.json();
  expect(unknown.status).toBe(400);
  expect(body.characters).toBeUndefined();
  expect(body.sections).toEqual(expect.arrayContaining(known));
  const full = await fetch(`${app.url}/party-api/state?catalog=0`);
  expect(full.status).toBe(200);
  expect(Object.keys((await full.json()).characters)).toEqual(expect.arrayContaining(['M', 'P', 'W']));
  const requested: { section: string | null; status: number }[] = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.endsWith('/party-api/state')) requested.push({ section: url.searchParams.get('section'), status: response.status() });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'M', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bank', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Bank', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Market', exact: true }).click();
  await expect.poll(() => new Set(requested.map(entry => entry.section)).size).toBeGreaterThanOrEqual(5);
  await info.attach('dashboard-state-requests', { body: JSON.stringify(requested), contentType: 'application/json' });
  for (const entry of requested) {
    expect(known).toContain(entry.section);
    expect([200, 304]).toContain(entry.status);
  }
});

// Waits in the page for `selector` (inside the open Bank dialog) to satisfy
// `state`, timed from the moment before `act` runs.
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

test('bank tab shows marks, unmarks, withdrawals, rules and bank changes as fast as before', async ({ page, app }, info) => {
  const initial = await app.state();
  const sword = initial.characters.M.items.find((entry: any) => entry?.item?.name === 'sword');
  const catalog = (name: string) => initial.merchantCatalog.allItems.find((entry: any) => entry.id === name);
  const bank = (extra: string[]) => ({ gold: 100000, packs: { items0: [{ ...sword, slot: 0, item: { ...sword.item, level: 0 } },
    ...extra.map((name, index) => ({ slot: index + 1, item: { name, q: 1 }, meta: catalog(name).meta }))] } });
  const checkpoint = (extra: string[]) => page.request.post(`${app.url}/party-api/bankboi/checkpoint`, { headers: { Origin: app.url }, data: { character: 'M', bank: bank(extra) } });
  expect((await checkpoint([])).ok()).toBe(true);
  const sections: { section: string | null; status: number }[] = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.endsWith('/party-api/state')) sections.push({ section: url.searchParams.get('section'), status: response.status() });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'M', exact: true })).toBeVisible();
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
  // Each change lands at a different point of the 2 s bank poll.
  const extras = ['coat', 'helmet', 'shoes', 'gloves', 'pants'];
  for (let index = 0; index < extras.length; index++) {
    await page.waitForTimeout(index * 400);
    const name = catalog(extras[index]).meta.definition.name || extras[index];
    latency.bankChange.push(await timed(page, `[role="dialog"] [aria-label="${name}"]`, 'present', () => checkpoint(extras.slice(0, index + 1))));
  }
  await choose('Auto sell to NPC…');
  const rule = page.getByRole('dialog').last();
  await info.attach('auto-npc-dialog', { body: await rule.innerText(), contentType: 'text/plain' });
  const enable = rule.getByRole('button').filter({ hasNotText: /^(Cancel|Close)$/ }).last();
  latency.autoNpcRule = [await timed(page, tile, 'text:Auto NPC', () => enable.click())];
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = Object.fromEntries(Object.entries(latency).map(([name, values]) => [name, { median: median(values), max: Math.max(...values), values }]));
  const bankReads = sections.filter(entry => entry.section === 'bank');
  await info.attach('bank-tab-latency', { body: JSON.stringify({ summary, bankReads: { total: bankReads.length, notModified: bankReads.filter(entry => entry.status === 304).length } }, null, 1), contentType: 'application/json' });
  console.log('bank-tab-latency', JSON.stringify({ summary, bankReads: { total: bankReads.length, notModified: bankReads.filter(entry => entry.status === 304).length } }));
  // Unchanged polls answer 304 and keep the shown bank.
  expect(bankReads.filter(entry => entry.status === 304).length).toBeGreaterThan(0);
  // The bank section polls every 2 s; a change shows within one poll plus the request.
  for (const value of latency.bankChange) expect(value).toBeLessThan(4000);
});

test('console deployment reports the missing activation record the loader would get a 404 for', async ({ app }, info) => {
  const control = await (await fetch(`${app.url}/party-api/console-deployment`)).json();
  const record = await fetch(`${app.url}/CODE/adventure_land/activation.json`);
  await info.attach('console-deployment', { body: JSON.stringify({ control, record: record.status }), contentType: 'application/json' });
  expect(control).toEqual(expect.objectContaining({ activation: null, consoleMaintenance: null }));
  expect(record.status).toBe(404);
});

// H4 failure modes: a display-only timer keeps requesting while the tab is
// hidden; a tab that becomes visible shows a stale view until the next tick;
// a timer that drives a flow stops.
test('display-only dashboard timers pause while the tab is hidden and read at once on return', async ({ page }, info) => {
  const requests: { path: string; at: number }[] = [], previews: unknown[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/upgrade-preview')) previews.push(request.postDataJSON());
    if (['/console-update', '/console-build', '/console-debug'].includes(path) || path.endsWith('/upgrade-preview')) requests.push({ path: path.replace(/^.*\/upgrade-preview$/, '/upgrade-preview'), at: Date.now() });
  });
  const count = (path: string) => requests.filter(entry => entry.path === path).length;
  const setHidden = (hidden: boolean) => page.evaluate(hidden => {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: hidden ? 'hidden' : 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await page.goto('/');
  const merchant = page.locator('article').filter({ has: page.getByRole('heading', { name: 'M', exact: true }) });
  await merchant.getByText('sword', { exact: true }).click({ button: 'right' });
  await page.locator('[data-slot="context-menu-content"]').getByRole('menuitem', { name: 'Mark for upgrade', exact: true }).hover();
  await expect(page.getByRole('region', { name: 'Upgrade chances' })).toBeVisible();
  await page.waitForTimeout(4500);
  const visible = { update: count('/console-update'), preview: count('/upgrade-preview'), build: count('/console-build') };
  expect(visible.update).toBeGreaterThan(0);
  expect(visible.preview).toBeGreaterThan(1);
  await setHidden(true);
  await page.waitForTimeout(500);
  const hiddenAt = { update: count('/console-update'), preview: count('/upgrade-preview'), build: count('/console-build') };
  await page.waitForTimeout(7000);
  const hidden = { update: count('/console-update') - hiddenAt.update, preview: count('/upgrade-preview') - hiddenAt.preview, build: count('/console-build') - hiddenAt.build };
  const shownAt = Date.now();
  await setHidden(false);
  await expect.poll(() => count('/console-update') > hiddenAt.update + hidden.update && count('/upgrade-preview') > hiddenAt.preview + hidden.preview, { timeout: 5000 }).toBe(true);
  const firstAfter = (path: string) => requests.find(entry => entry.path === path && entry.at >= shownAt)!.at - shownAt;
  const returned = { update: firstAfter('/console-update'), preview: firstAfter('/upgrade-preview') };
  await info.attach('hidden-tab-timers', { body: JSON.stringify({ visible, hidden, returned }, null, 1), contentType: 'application/json' });
  console.log('hidden-tab-timers', JSON.stringify({ visible, hidden, returned }));
  expect(hidden).toEqual({ update: 0, preview: 0, build: 0 });
  expect(returned.update).toBeLessThan(500);
  expect(returned.preview).toBeLessThan(500);
  // Returning to the tab reads the stored preview; it never queues one.
  for (const body of previews) expect(body).toMatchObject({ refresh: false });
});

test('first render and game log capture reach the dashboard as fast as before', async ({ page, app }, info) => {
  // The first load also compiles the dev dashboard; time the warm reloads.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'M', exact: true })).toBeVisible();
  const renders: number[] = [];
  for (let index = 0; index < 3; index++) {
    const started = Date.now();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'M', exact: true })).toBeVisible();
    renders.push(Date.now() - started);
  }
  const firstRender = [...renders].sort((a, b) => a - b)[1];
  const opened = Date.now();
  await page.getByRole('button', { name: 'Show logs', exact: true }).click();
  const sidebar = page.getByRole('complementary', { name: 'Live logs' });
  await expect(sidebar).toBeVisible();
  const logsOpen = Date.now() - opened;
  // Each line lands at a different point of the 1 s logs poll.
  const capture: number[] = [];
  for (let index = 0; index < 6; index++) {
    await page.waitForTimeout(index * 170);
    const message = `Latency probe ${index}`;
    capture.push(await timed(page, '[aria-label="Live logs"]', `text:${message}`, () =>
      fetch(`${app.url}/party-api/game-logs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url },
        body: JSON.stringify({ character: 'W', events: [{ session: 'latency', seq: index + 1, at: Date.now(), message, color: "white" }] }) })));
  }
  const median = [...capture].sort((a, b) => a - b)[Math.floor(capture.length / 2)];
  const result = { firstRender, logsOpen, capture: { median, max: Math.max(...capture), values: capture } };
  await info.attach('dashboard-latency', { body: JSON.stringify(result, null, 1), contentType: 'application/json' });
  console.log('dashboard-latency', JSON.stringify(result));
  for (const value of capture) expect(value).toBeLessThan(2500);
});

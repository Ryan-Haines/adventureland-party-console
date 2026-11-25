import { test, expect } from './fixtures';
import { setHidden } from './fixtures/component-harness';
import { STATUS_PICKS } from '../runtime/status/rules';

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

// The bank tab's marks, rules and bank changes reach the open Bank dialog, and an unchanged bank poll
// answers 304. Their latencies are console-speed.spec.ts "the bank tab and the first render: latency"
// (QUESTIONS U8).
test('bank tab shows marks, unmarks, withdrawals, rules and bank changes', async ({ page, app }) => {
  const initial = await app.state();
  const sword = initial.characters.M.items.find((entry: any) => entry?.item?.name === 'sword');
  const catalog = (name: string) => initial.merchantCatalog.allItems.find((entry: any) => entry.id === name);
  const bank = (extra: string[]) => ({ gold: 100000, packs: { items0: [{ ...sword, slot: 0, item: { ...sword.item, level: 0 } },
    ...extra.map((name, index) => ({ slot: index + 1, item: { name, q: 1 }, meta: catalog(name).meta }))] } });
  const checkpoint = (extra: string[]) => page.request.post(`${app.url}/party-api/bankboi/checkpoint`, { headers: { Origin: app.url }, data: { character: 'M', bank: bank(extra) } });
  expect((await checkpoint([])).ok()).toBe(true);
  const bankReads: number[] = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.endsWith('/party-api/state') && url.searchParams.get('section') === 'bank') bankReads.push(response.status());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'M', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bank', exact: true }).click();
  const pane = page.getByRole('dialog', { name: 'Bank', exact: true });
  const label = sword.meta.definition.name || 'sword';
  const tile = pane.getByLabel(label, { exact: true });
  await expect(tile).toBeVisible();
  const menu = page.locator('[data-slot="context-menu-content"]');
  const open = () => tile.click({ button: 'right' });
  const choose = async (name: string) => { await open(); await menu.getByRole('menuitem', { name, exact: true }).click(); };
  // The tile's menu names the mark it shows: Unmark once the withdrawal mark is shown, Mark once it is gone.
  await choose('Mark for withdrawal');
  await choose('Unmark withdrawal');
  await open();
  await expect(menu.getByRole('menuitem', { name: 'Mark for withdrawal', exact: true })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Sell to NPC…', exact: true }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Sell to NPC', exact: true }).click();
  await expect(tile).toContainText('NPC sale');
  await choose('Clear all marks');
  await expect(tile).not.toContainText('NPC sale');
  // A bank checkpoint shows its new item at the next bank poll.
  expect((await checkpoint(['coat'])).ok()).toBe(true);
  await expect(pane.getByLabel(catalog('coat').meta.definition.name || 'coat', { exact: true })).toBeVisible();
  await choose('Auto sell to NPC…');
  await page.getByRole('dialog').last().getByRole('button').filter({ hasNotText: /^(Cancel|Close)$/ }).last().click();
  await expect(tile).toContainText('Auto NPC');
  // Unchanged polls answer 304 and keep the shown bank.
  await expect.poll(() => bankReads.filter(status => status === 304).length).toBeGreaterThan(0);
  expect(bankReads.every(status => status === 200 || status === 304)).toBe(true);
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
  // The page runs on Playwright's clock, so the row steps the dashboard's poll timers instead of
  // sleeping through them. The longest display poll is the update service's (dashboardPolls).
  const longest = Math.max(...['updates', 'build', 'debug'].map(name => STATUS_PICKS.dashboardPolls[name].interval!));
  await page.clock.install();
  await page.goto('/');
  const merchant = page.locator('article').filter({ has: page.getByRole('heading', { name: 'M', exact: true }) });
  await merchant.getByText('sword', { exact: true }).click({ button: 'right' });
  await page.locator('[data-slot="context-menu-content"]').getByRole('menuitem', { name: 'Mark for upgrade', exact: true }).hover();
  await expect(page.getByRole('region', { name: 'Upgrade chances' })).toBeVisible();
  await page.clock.runFor(longest);
  await expect.poll(() => count('/console-update')).toBeGreaterThan(0);
  // The open panel reads the stored preview once, then again only when the core read's preview
  // signal or the merchant's bag changes (upgrade-preview-panel.tsx `previewSignal`).
  await expect.poll(() => count('/upgrade-preview')).toBeGreaterThan(0);
  const visible = { update: count('/console-update'), preview: count('/upgrade-preview'), build: count('/console-build') };
  await setHidden(page,true);
  const hiddenAt = { update: count('/console-update'), preview: count('/upgrade-preview'), build: count('/console-build') };
  // Three of the longest intervals hidden, each display timer firing at least three times if it ran.
  // The last one ends with the clock paused, so once the tab returns no interval can fire: a read
  // then is the return's own.
  await page.clock.runFor(2 * longest);
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + longest);
  const hidden = { update: count('/console-update') - hiddenAt.update, preview: count('/upgrade-preview') - hiddenAt.preview, build: count('/console-build') - hiddenAt.build };
  await setHidden(page,false);
  await expect.poll(() => count('/console-update') > hiddenAt.update + hidden.update && count('/upgrade-preview') > hiddenAt.preview + hidden.preview).toBe(true);
  await info.attach('hidden-tab-timers', { body: JSON.stringify({ visible, hidden }, null, 1), contentType: 'application/json' });
  expect(hidden).toEqual({ update: 0, preview: 0, build: 0 });
  // Returning to the tab reads the stored preview; it never queues one.
  for (const body of previews) expect(body).toMatchObject({ refresh: false });
});

// A game log line reaches the open log sidebar. Its latency and the first render's are
// console-speed.spec.ts "the bank tab and the first render: latency" (QUESTIONS U8).
test('game log capture reaches the open log sidebar', async ({ page, app }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'M', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show logs', exact: true }).click();
  const sidebar = page.getByRole('complementary', { name: 'Live logs' });
  await expect(sidebar).toBeVisible();
  const message = 'Capture probe';
  const sent = await fetch(`${app.url}/party-api/game-logs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url },
    body: JSON.stringify({ character: 'W', events: [{ session: 'capture', seq: 1, at: Date.now(), message, color: 'white' }] }) });
  expect(sent.ok).toBe(true);
  await expect(sidebar).toContainText(message);
});

import {test, expect, type App} from './fixtures';
import type {Page, TestInfo} from '@playwright/test';
import {rows} from '../.build/addons/tests';
import {build} from 'esbuild';
import path from 'node:path';

// Add-ons on the real dashboard and coordinator. Failure list first, in
// e2e/movement-owner-failures.md "Step 9b" items 22 to 24. The add-on switches are the
// player's own (POST /party-api/addons), the dashboard and the coordinator are the console's.
const addon=(page:import('@playwright/test').Page,url:string,name:string,enabled:boolean)=>
  page.request.post(url+'/party-api/addons',{data:{name,enabled},headers:{Origin:url}});

// The "card and top bar" change: the fork's card layout and top bar are the
// dashboard's own, with one "Pin top bar" setting. One row per failure mode.
test.describe('the character card and the top bar', () => {
  test.use({ statusConditions: true });
  test('the card shows the icon row and the bottom combat log; Pin top bar off sticks nothing, on pins the header and the name strip together', async ({ page, app }, info) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.goto(app.url);
    const header = page.locator('[data-party-header]'), strip = page.locator('[data-card-name-strip="W"]');
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'W', exact: true }) });
    const inventory = card.getByRole('button', { name: /^Inventory/ });
    // Scroll until W's name line is well above the viewport's top edge.
    const scrollPastName = async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      const name = (await card.getByRole('heading', { name: 'W', exact: true }).boundingBox())!;
      await page.evaluate(y => window.scrollTo(0, y), name.y + name.height + 300);
    };
    const rows: Record<string, unknown> = {};
    // Row 1: the statuses are one icon row with the details in the label, and the combat log sits
    // at the card's bottom, after the inventory.
    await expect(card.getByRole('heading', { name: 'Active status' })).toHaveCount(0);
    await expect(card.locator('[data-status-row]').getByRole('button', { name: /^War Cry, / })).toBeVisible();
    const log = (await card.getByRole('button', { name: 'Combat log', exact: true }).boundingBox())!, bag = (await inventory.boundingBox())!;
    expect(log.y).toBeGreaterThan(bag.y);
    rows.layout = { log, bag };
    // Row 2: the header buttons sit beside the title in two rows, data views on top and game
    // actions below, with Pause, shutdown and interface settings on the title's line.
    const title = (await header.getByRole('heading', { name: 'Party Console' }).boundingBox())!;
    for (const label of ['Pause all automated actions', 'Clean shutdown', 'Interface settings']) {
      const icon = (await header.getByRole('button', { name: label, exact: true }).boundingBox())!;
      expect(icon.y + icon.height / 2).toBeGreaterThan(title.y);
      expect(icon.y + icon.height / 2).toBeLessThan(title.y + title.height);
    }
    const views = (await header.locator('[data-header-row="views"]').getByRole('button', { name: 'Metrics' }).boundingBox())!;
    const actions = (await header.locator('[data-header-row="actions"]').getByRole('button', { name: 'Bank', exact: true }).boundingBox())!;
    expect(actions.y).toBeGreaterThan(views.y + views.height - 1);
    expect(views.x).toBeGreaterThan(title.x + title.width);
    rows.header = { title, views, actions };
    // The Pause, Play and clean shutdown icons call their routes, and the Paused badge
    // follows the coordinator.
    const route = (action: string) => page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/party-api/console-control/' + action));
    const pausing = route('pause');
    await header.getByRole('button', { name: 'Pause all automated actions', exact: true }).click();
    await pausing;
    await expect(header.locator('[data-console-paused]')).toHaveText('Paused');
    await expect.poll(async () => (await app.state()).consoleControl?.paused).toBe(true);
    const playing = route('play');
    await header.getByRole('button', { name: 'Play: resume automated actions', exact: true }).click();
    await playing;
    await expect(header.locator('[data-console-paused]')).toBeHidden();
    await expect.poll(async () => (await app.state()).consoleControl?.paused).toBe(false);
    await header.getByRole('button', { name: 'Clean shutdown', exact: true }).click();
    const shutdownDialog = page.getByRole('dialog', { name: 'Clean shutdown' });
    const shutting = route('shutdown');
    await shutdownDialog.getByRole('button', { name: 'Start clean shutdown' }).click();
    await shutting;
    await expect.poll(async () => (await app.state()).consoleControl?.shutdown?.phase).toMatch(/^(deferred|draining|safe)$/);
    const cancelling = route('cancel-shutdown');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel shutdown' }).click();
    await cancelling;
    await expect.poll(async () => (await app.state()).consoleControl).toMatchObject({ paused: false, shutdown: null });
    await expect(page.getByRole('dialog')).toBeHidden();
    // Row 3: Pin top bar is off by default, and nothing sticks.
    await scrollPastName();
    const away = (await header.boundingBox())!;
    expect(away.y + away.height).toBeLessThanOrEqual(0);
    await expect(page.locator('[data-card-name-strip]')).toHaveCount(0);
    rows.off = { header: away };
    await info.attach('pin-top-bar-off', { body: await page.screenshot(), contentType: 'image/png' });
    // Row 4: on, the header stays at the top and W's name strip pins directly under it, with the
    // name and the card's activity line.
    await page.evaluate(() => window.scrollTo(0, 0));
    await header.getByRole('button', { name: 'Interface settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Interface settings' });
    await settings.getByRole('checkbox', { name: 'Pin top bar' }).check();
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await scrollPastName();
    await expect(strip).toBeVisible();
    await expect.poll(async () => (await header.boundingBox())!.y).toBe(0);
    const pinned = (await header.boundingBox())!;
    await expect.poll(async () => Math.abs((await strip.boundingBox())!.y - (pinned.y + pinned.height))).toBeLessThanOrEqual(1);
    await expect(strip).toContainText('W');
    const activity = await card.getByTestId('character-activity').textContent().catch(() => null);
    if (activity) await expect(strip.locator('[data-card-activity]')).toHaveText(activity.replace(/\s+$/, ''));
    rows.on = { header: pinned, strip: await strip.boundingBox() };
    await info.attach('pin-top-bar-on', { body: await page.screenshot(), contentType: 'image/png' });
    // One live map per character. Opened from the pinned strip it draws in the
    // strip's dock with one map stream, and the card shows no second copy.
    const streams: string[] = [];
    page.on('request', request => { if (request.url().includes('/map-stream/W')) streams.push(request.url()); });
    await strip.getByRole('button', { name: 'Expand live map', exact: true }).click();
    const dock = page.getByLabel('W docked map', { exact: true });
    await expect(dock.locator('canvas')).toHaveCount(1);
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect.poll(() => streams.length).toBe(1);
    rows.map = { streams };
    await strip.getByRole('button', { name: 'Collapse live map', exact: true }).click();
    await expect(dock.locator('canvas')).toHaveCount(0);
    // The choice survives a reload, and turning it off unpins both again.
    await page.reload();
    await page.evaluate(() => window.scrollTo(0, 0));
    await header.getByRole('button', { name: 'Interface settings', exact: true }).click();
    await expect(settings.getByRole('checkbox', { name: 'Pin top bar' })).toBeChecked();
    await settings.getByRole('checkbox', { name: 'Pin top bar' }).uncheck();
    await page.keyboard.press('Escape');
    await scrollPastName();
    await expect(page.locator('[data-card-name-strip]')).toHaveCount(0);
    const again = (await header.boundingBox())!;
    expect(again.y + again.height).toBeLessThanOrEqual(0);
    await info.attach('card-and-top-bar-rows', { body: Buffer.from(JSON.stringify(rows, null, 2)), contentType: 'application/json' });
  });
});

// The mode rows: row 1 holds the
// combat modes and sends `combatMode` only, row 2 the target modes and sends `targetMode` only, each
// button from its slot entry's declared data, with one button pressed in each row.
test('the mode rows: the combat modes in row 1 and the target modes in row 2, each sending its own field, one pressed per row', async ({ page, app }) => {
  const post = (endpoint: string, data: unknown) => page.request.post(app.url + '/party-api' + endpoint, { data, headers: { Origin: app.url } });
  const pair = async () => { const p = (await app.state()).farmingProfiles?.W ?? {}; return [p.combatMode, p.targetMode]; };
  // W starts on Default with Hunt, the pair a Hunt press leaves after its setup.
  expect((await post('/settings', { changes: [{ field: 'combatMode', character: 'W', value: 'default' }, { field: 'targetMode', character: 'W', value: 'hunt' }] })).status()).toBe(200);
  await page.goto(app.url);
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'W', exact: true }) });
  await card.locator('button[aria-expanded]').filter({ hasText: 'Farming settings' }).click();
  const combat = card.getByRole('group', { name: 'Combat mode' }), target = card.getByRole('group', { name: 'Target mode' });
  // Today's labels and colours, and FARMING beside HUNT.
  await expect(combat.getByRole('button')).toHaveText(['Auto', 'Default', 'Scatter']);
  await expect(target.getByRole('button')).toHaveText(['Farming', 'Hunt']);
  for (const [row, label, color] of [[combat, 'Auto', 'cyan'], [combat, 'Default', 'emerald'], [combat, 'Scatter', 'violet'], [target, 'Farming', 'sky'], [target, 'Hunt', 'amber']] as const)
    await expect(row.getByRole('button', { name: label, exact: true })).toHaveClass(new RegExp(`border-${color}-600 bg-${color}-950`));
  const pressed = async () => [await combat.locator('[aria-pressed="true"]').allTextContents(), await target.locator('[aria-pressed="true"]').allTextContents()];
  await expect.poll(pressed).toEqual([['Default'], ['Hunt']]);
  // SCATTER while hunting changes only the formation.
  await combat.getByRole('button', { name: 'Scatter', exact: true }).click();
  await expect.poll(pair).toEqual(['scatter', 'hunt']);
  await expect.poll(pressed).toEqual([['Scatter'], ['Hunt']]);
  // FARMING leaves Hunt and keeps the combat mode.
  await target.getByRole('button', { name: 'Farming', exact: true }).click();
  await expect.poll(pair).toEqual(['scatter', 'farming']);
  await expect.poll(pressed).toEqual([['Scatter'], ['Farming']]);
});

// A settings control stays locked until the dashboard's
// first config read; a select's keyboard typeahead changes nothing; a write refused as
// out of date shows the console's notice. The card's combat lines are the settings control here.
test('the settings controls: locked before the config read, no typeahead writes, the out-of-date notice', async ({ page, app }) => {
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/party-api/settings')) writes.push(request.postData() || ''); });
  // The config read held, the box is locked and nothing writes.
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/party-api\/state\?.*section=config/, async route => { await held; await route.continue(); });
  await page.goto(app.url);
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'W', exact: true }) });
  const heal = card.getByLabel('Heal first below (% HP) for W', { exact: true });
  await expect(heal).toBeDisabled();
  expect(writes).toEqual([]);
  release();
  await expect(heal).toBeEnabled();
  await page.unroute(/\/party-api\/state\?.*section=config/);
  // Another writer saves the field after the page read its basis; the page's write is refused
  // and the notice says the change was not saved.
  const other = await page.request.post(app.url + '/party-api/settings', { data: { changes: [{ field: 'healFirstBelow', character: 'W', value: 70 }] }, headers: { Origin: app.url } });
  expect(other.status()).toBe(200);
  await heal.fill('55');
  await heal.press('Enter');
  await expect(card.getByRole('alert')).toContainText('was not saved: the page was out of date');
  const saved = (await (await page.request.get(app.url + '/party-api/settings')).json()).settings.find((entry: any) => entry.field === 'healFirstBelow')?.value?.W;
  expect(saved).toBe(70);
});

test('Path A: a select hands on a value only when an item is chosen', async ({ page, app }) => {
  const bundle = await build({
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', tsconfig: path.resolve('dashboard/tsconfig.json'),
    stdin: { resolveDir: path.resolve('dashboard'), loader: 'tsx', contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {SettingSelect as Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
      window.changes=[];
      createRoot(document.getElementById('root')).render(<Select defaultValue="goo" onValueChange={value=>window.changes.push(value)}>
        <SelectTrigger aria-label="Monster"><SelectValue/></SelectTrigger>
        <SelectContent>{['goo','bee','crab'].map(id=><SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent></Select>);
    ` },
  });
  await page.route('**/select-harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body><div id="root"></div></body>' }));
  await page.goto(app.url + '/select-harness');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const trigger = page.getByRole('combobox', { name: 'Monster' });
  await trigger.focus();
  await page.keyboard.type('b');
  await page.keyboard.type('c');
  expect(await page.evaluate(() => (window as any).changes)).toEqual([]);
  await trigger.click();
  await page.getByRole('option', { name: 'bee' }).click();
  expect(await page.evaluate(() => (window as any).changes)).toEqual(['bee']);
});

// The installed add-ons' console journeys: each add-on's
// tests/rows.ts adds its rows to this table, so this file names no add-on.
type JourneyRow = [title: string, run: (fixtures: { page: Page; app: App }, info: TestInfo) => Promise<void>];
for (const [title, run] of rows<JourneyRow>('add-on console journeys')) test(title, ({ page, app }, info) => run({ page, app }, info));

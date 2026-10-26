import { test, expect } from './fixtures';
import { fetchFullState } from './state-route';
import path from 'node:path';
type Page = import('@playwright/test').Page;

// Failure inventory for the card layout: the status icon row
// leaves its slot between the XP bar and the location, shortens either of
// them, overflows the card, hides a status without a "+N" count, takes space
// with no statuses, crops the square game icons, or shows no details on
// hover or tap.

// Screenshots for review go to STRIP_SCREENSHOTS when it is set.
const shots = process.env.STRIP_SCREENSHOTS;
async function shoot(page: Page, info: import('@playwright/test').TestInfo, name: string, target: Page | import('@playwright/test').Locator = page) {
  const body = await target.screenshot({ animations: 'disabled' });
  await info.attach(name, { body, contentType: 'image/png' });
  if (shots) await target.screenshot({ animations: 'disabled', path: path.join(shots, `${name}.png`) });
}
const card = (page: Page, name: string) => page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });

// Five conditions copied from a live fast-section sample on 2026-10-25, plus
// Burned and Poisoned with the same shape: 7 statuses is the realistic maximum
// seen in play.
const skills = { url: 'https://adventure.land/images/tiles/items/skills_20v6.png', tileSize: 20, columns: 16, rows: 13 };
const items = { url: 'https://adventure.land/images/tiles/items/pack_20vt8.png', tileSize: 20, columns: 16, rows: 64 };
const raw = { url: 'https://adventure.land/images/tiles/items/raw_items.png?v=36', tileSize: 20, columns: 20, rows: 40 };
const condition = (id: string, name: string, remainingMs: number, sprite: object, stacks: number | null = null) =>
  ({ id, name, explanation: '', remainingMs, stacks, source: null, definition: { name }, live: { ms: remainingMs }, sprite });
const seven = [
  condition('mluck', 'Good Luck', 3214361, { ...skills, x: 0, y: 9 }),
  condition('encouragement_new', 'New Player', 84769768, { ...raw, x: 14, y: 3 }),
  condition('newcomersblessing', "Newcomers' Blessing", 1796241, { ...skills, x: 3, y: 9 }),
  condition('halloween2', 'Halloween Spirit', 27851081, { ...skills, x: 0, y: 12 }),
  condition('elixir:elixirluck', 'Liquid Luck', 5634465, { ...items, x: 15, y: 31 }),
  condition('burned', 'Burned', 4200, { ...skills, x: 5, y: 2 }, 3),
  condition('poisoned', 'Poisoned', 9000, { ...skills, x: 7, y: 2 }),
];

/** Serves the dashboard's own polls with W's conditions, XP and location replaced, and a local sprite sheet. */
async function statusFixture(page: Page, conditions: object[], position = { map: 'winter_cave', x: 199, y: -248 }) {
  // Game sprite sheets come from a canvas drawn in the page, so icons never depend on adventure.land.
  await page.route('https://adventure.land/images/**', async route => {
    const sheet = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 1280;
      const context = canvas.getContext('2d')!;
      for (let y = 0; y < 64; y++) for (let x = 0; x < 20; x++) {
        // Each tile fills its whole square cell with a darker frame, so a crop or round mask would show.
        context.fillStyle = `hsl(${(x * 47 + y * 29) % 360} 70% 30%)`; context.fillRect(x * 20, y * 20, 20, 20);
        context.fillStyle = `hsl(${(x * 47 + y * 29) % 360} 70% 60%)`; context.fillRect(x * 20 + 3, y * 20 + 3, 14, 14);
      }
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await route.fulfill({ contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: Buffer.from(sheet, 'base64') });
  });
  await page.route('**/party-api/dashboard-stream**', route => route.abort());
  await page.route(url => url.pathname.endsWith('/party-api/state'), async route => {
    if (new URL(route.request().url()).searchParams.get('section') !== 'fast') return route.continue();
    const response = await fetchFullState(route);
    const body = await response.json();
    Object.assign(body.characters.W, { conditions, xp: 345_600_000, max_xp: 1_040_000_000, ...position });
    await route.fulfill({ response, json: body });
  });
}
async function headerGeometry(page: Page) {
  return card(page, 'W').evaluate(article => {
    const rect = (element: Element | null | undefined) => element ? element.getBoundingClientRect().toJSON() as DOMRect : null;
    // An ellipsis or clipped text shows as text wider than its own box.
    const whole = (element: Element | null | undefined) => {
      if (!element) return false;
      const range = document.createRange(); range.selectNodeContents(element);
      return range.getBoundingClientRect().width <= element.getBoundingClientRect().width + 0.01;
    };
    const row = article.querySelector('[data-status-row]');
    const xpLabel = [...article.querySelectorAll('div')].find(element => element.firstElementChild?.textContent === 'XP');
    const location = [...article.querySelectorAll('button')].find(button => /live map/.test(button.getAttribute('aria-label') || '') && button.getBoundingClientRect().height > 0)?.nextElementSibling;
    const content = article.querySelector('h2')!.closest('.p-5')!;
    const padding = parseFloat(getComputedStyle(content).paddingLeft);
    const numbers = xpLabel?.lastElementChild;
    return { card: rect(article), row: rect(row), xp: rect(xpLabel?.parentElement), location: rect(location),
      locationText: location?.textContent?.trim(), locationWhole: whole(location),
      xpText: numbers?.textContent, xpWhole: whole(numbers) && rect(numbers)!.right <= rect(xpLabel)!.right + 0.5,
      contentLeft: rect(content)!.left + padding, contentRight: rect(content)!.right - padding,
      icons: row ? [...row.querySelectorAll('button')].map(button => rect(button)!) : [],
      radius: row?.querySelector('button') ? parseFloat(getComputedStyle(row.querySelector('button')!).borderTopLeftRadius) : null,
      sprite: rect(row?.querySelector('button [aria-hidden="true"]')) };
  });
}
async function expectHeaderRow(page: Page, icons: number) {
  await expect(card(page, 'W').locator('[data-status-row] button')).toHaveCount(icons);
  const geometry = await headerGeometry(page);
  for (const icon of geometry.icons.slice(0, -1)) { expect(icon.width).toBe(16); expect(icon.height).toBe(16); }
  // Square game icons: a small corner radius at most, and the whole sprite cell inside the 1 px border.
  expect(geometry.radius).toBeLessThanOrEqual(2);
  expect(geometry.sprite).toMatchObject({ width: 14, height: 14 });
  const row = geometry.row!;
  expect(row.top, 'The row sits below the XP bar').toBeGreaterThanOrEqual(geometry.xp!.bottom);
  expect(row.bottom, 'and above the location line').toBeLessThanOrEqual(geometry.location!.top);
  expect(Math.abs(row.left - geometry.contentLeft), 'The row spans the card content').toBeLessThan(1);
  expect(Math.abs(row.right - geometry.contentRight)).toBeLessThan(1);
  expect(geometry.xpWhole, `The XP numbers "${geometry.xpText}" are not truncated`).toBe(true);
  return geometry;
}
const header = (page: Page) => card(page, 'W').locator('[data-status-row]').locator('xpath=ancestor::div[contains(@class,"p-5")][1]');
const many = Array.from({ length: 16 }, (_, index) => condition(`fixture${index}`, `Status ${index + 1}`, 60000 + index, { ...skills, x: index % 16, y: 3 }));

test('the active statuses show as one icon row between the XP bar and the location', async ({ page }, info) => {
  await statusFixture(page, seven);
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.goto('/');
  const warrior = card(page, 'W');
  await expect(warrior.locator('[data-status-row] button')).toHaveCount(7, { timeout: 60_000 });
  await expect(warrior.getByRole('button', { name: /^Active status/ })).toHaveCount(0);
  const wide = await expectHeaderRow(page, 7);
  expect(wide.locationText).toBe('winter_cave [199, -248]');
  expect(wide.locationWhole, 'The full location shows at 1460 px').toBe(true);
  // Hover shows the details the old section listed; a click opens the condition details.
  await warrior.locator('[data-status="burned"]').hover();
  const tip = page.locator('[data-slot="tooltip-content"]');
  await expect(tip).toContainText('Burned');
  await expect(tip).toContainText('3 stacks');
  await shoot(page, info, 'card-layout-desktop');
  await warrior.locator('[data-status="mluck"]').click();
  await expect(page.getByRole('dialog')).toContainText('Good Luck');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Focus returns to the icon and reopens its tooltip; clear it for the review screenshots.
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
  await shoot(page, info, 'status-row-desktop', header(page));
  // The narrowest desktop card: four columns at the 80rem container breakpoint.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(async () => (await headerGeometry(page)).card!.width).toBeLessThan(300);
  const narrow = await expectHeaderRow(page, 7);
  await info.attach('narrow-location', { body: JSON.stringify({ text: narrow.locationText, whole: narrow.locationWhole }), contentType: 'application/json' });
  await shoot(page, info, 'status-row-narrow', header(page));
});

test('more statuses than the row fits end with a +N cell that lists the rest', async ({ page }) => {
  await statusFixture(page, many);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const row = card(page, 'W').locator('[data-status-row]');
  await expect(row.getByRole('button', { name: /more statuses$/ })).toBeVisible({ timeout: 60_000 });
  const geometry = await headerGeometry(page);
  const fit = Math.floor((geometry.row!.width + 4) / 20);
  await expect(row.locator('button')).toHaveCount(fit);
  const more = row.getByRole('button', { name: `${16 - fit + 1} more statuses` });
  await expect(more).toHaveText(`+${16 - fit + 1}`);
  expect(geometry.icons.at(-1)!.right, 'The +N cell stays inside the row').toBeLessThanOrEqual(geometry.row!.right + 0.5);
  await more.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText('Status 16');
});

test('without active statuses the row takes no space', async ({ page }) => {
  await statusFixture(page, []);
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.goto('/');
  const warrior = card(page, 'W');
  await expect(warrior.getByRole('heading', { name: 'W', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await headerGeometry(page)).xpText).toContain('345.600m');
  await expect(warrior.locator('[data-status-row]')).toHaveCount(0);
});

test.describe('on a touch phone', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('a tap shows the status tooltip and the location stays whole', async ({ page }, info) => {
    await statusFixture(page, seven);
    await page.goto('/');
    const warrior = card(page, 'W');
    await expect(warrior.locator('[data-status-row] button')).toHaveCount(7, { timeout: 60_000 });
    const geometry = await expectHeaderRow(page, 7);
    expect(geometry.locationWhole).toBe(true);
    await warrior.locator('[data-status="elixir:elixirluck"]').tap();
    await expect(page.locator('[data-slot="tooltip-content"]')).toContainText('Liquid Luck');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await shoot(page, info, 'card-layout-phone');
  });
});

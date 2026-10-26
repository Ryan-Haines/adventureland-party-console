import { test, expect } from './fixtures';

// Failure inventory: the header scrolls away; it covers an open dialog or
// popover; at phone width it fills the screen or scrolls the page sideways;
// Pause shows no indicator or Play leaves it behind.
async function headerTop(page: import('@playwright/test').Page) {
  return page.locator('[data-party-header]').evaluate(element => {
    const box = element.getBoundingClientRect();
    return { top: box.top, height: box.height, scrollY: window.scrollY, viewport: window.innerHeight,
      sideways: document.scrollingElement!.scrollWidth - window.innerWidth };
  });
}
for (const viewport of [{ name: 'desktop', width: 1460, height: 900 }, { name: 'phone', width: 390, height: 844 }])
  test(`the party header stays pinned at the top while the page scrolls (${viewport.name})`, async ({ page }, info) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    const header = page.locator('[data-party-header]');
    await expect(header.getByRole('heading', { name: 'Party Console' })).toBeVisible({ timeout: 60_000 });
    // The Pause icon renders from the client poll, so hydration has finished before the spacer goes in.
    await expect(header.getByRole('button', { name: 'Pause all automated actions' })).toBeVisible({ timeout: 60_000 });
    // The fixture party is short; padding guarantees a scrollable page.
    await page.evaluate(() => { const spacer = document.createElement('div'); spacer.style.height = '4000px'; document.querySelector('[data-party-console-root]')!.append(spacer); });
    // The console restores each view's scroll position shortly after mount, so scroll until it holds.
    await expect(async () => {
      await page.evaluate(() => window.scrollTo({ top: 1500, behavior: 'instant' }));
      expect((await headerTop(page)).scrollY).toBeGreaterThan(1000);
    }).toPass({ timeout: 15_000 });
    const pinned = await headerTop(page);
    expect(pinned.top).toBe(0);
    await expect(header.getByRole('button', { name: 'Pause all automated actions' })).toBeInViewport();
    if (viewport.name === 'desktop') {
      // The two button rows sit beside the title; a wrapped header puts them below it.
      const [title, buttons] = await header.locator(':scope > div > div').evaluateAll(blocks => blocks.map(block => block.getBoundingClientRect()));
      expect(buttons.top, 'The button rows sit beside the title').toBeLessThan(title.bottom);
      await expect(header.getByRole('button', { name: 'Pause all automated actions' })).toBeVisible();
    }
    if (viewport.name === 'phone') {
      expect(pinned.height, 'The pinned header must stay short at phone width').toBeLessThan(viewport.height * 0.25);
      expect(pinned.sideways, 'The page must not scroll sideways').toBeLessThanOrEqual(0);
    }
    await info.attach(`pinned-header-${viewport.name}`, { body: await page.screenshot(), contentType: 'image/png' });
    // Dialogs open above the pinned header.
    await header.getByRole('button', { name: 'Clean shutdown' }).click();
    const dialog = page.getByRole('dialog', { name: 'Clean shutdown' });
    await expect(dialog).toBeVisible();
    const covering = await page.evaluate(() => {
      const box = document.querySelector('[data-party-header]')!.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return !!top && !top.closest('[data-party-header]');
    });
    expect(covering, 'The dialog layer must sit above the pinned header').toBe(true);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });

test('Pause shows the header indicator and Play removes it', async ({ page, app }) => {
  await page.goto('/');
  const header = page.locator('[data-party-header]');
  await header.getByRole('button', { name: 'Pause all automated actions' }).click({ timeout: 60_000 });
  await expect(header.locator('[data-console-paused]')).toHaveText('Paused');
  await expect.poll(async () => (await app.state()).consoleControl?.paused).toBe(true);
  await page.reload();
  await expect(header.locator('[data-console-paused]')).toHaveText('Paused', { timeout: 60_000 });
  await header.getByRole('button', { name: 'Play: resume automated actions' }).click();
  await expect(header.locator('[data-console-paused]')).toBeHidden();
  await expect(header.getByRole('button', { name: 'Pause all automated actions' })).toBeVisible();
  expect((await app.state()).consoleControl?.paused).toBe(false);
});

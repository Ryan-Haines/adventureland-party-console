import { test, expect } from './fixtures';

test('lucky slot lock persists and unlock restores discovery', async ({page, app}, info) => {
  // Failure modes: menu missing, lock not durable, unlock leaves the position pinned.
  await page.goto('/');
  const slot = page.getByRole('button', {name:/slot 0\. Open lucky slot options/});
  await slot.click();
  await expect(page.getByRole('menuitem', {name:'Show lucky slot data',exact:true})).toBeVisible();
  await page.getByRole('menuitem', {name:'Lock lucky slot position',exact:true}).click();
  await expect.poll(async () => (await app.state()).luckySlotLocks?.M).toBe(0);
  await expect(page.getByRole('button', {name:/Locked lucky upgrade position, slot 0/})).toBeVisible();
  await app.restartCoordinator();
  await page.reload();
  await page.getByRole('button', {name:/slot 0\. Open lucky slot options/}).click();
  await page.getByRole('menuitem', {name:'Unlock lucky slot position',exact:true}).click();
  await expect.poll(async () => (await app.state()).luckySlotLocks?.M ?? null).toBeNull();
  await expect(page.getByRole('button', {name:/slot 1\. Open lucky slot options/})).toBeVisible();
  await info.attach('lucky-slot-unlocked', {body:await page.screenshot(),contentType:'image/png'});
});

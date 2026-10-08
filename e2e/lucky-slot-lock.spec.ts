import { test, expect } from './fixtures';

test('lucky slot lock persists and unlock restores discovery', async ({page, app}, info) => {
  // Failure modes: menu missing, lock not durable, unlock leaves the position pinned.
  await page.goto('/');
  const merchant = page.locator('article').filter({has:page.getByRole('heading',{name:'M',exact:true})});
  const slot = merchant.getByLabel('Short Sword',{exact:true});
  await slot.click();
  await expect(page.getByRole('menuitem', {name:'Show lucky slot data',exact:true})).toBeVisible();
  await page.getByRole('menuitem', {name:'Lock lucky slot position',exact:true}).click();
  await expect.poll(async () => (await app.state()).luckySlotLocks?.M).toBe(0);
  await slot.hover();
  await expect(page.getByRole('tooltip').getByText('Locked lucky upgrade position · slot 0. Click for options.',{exact:true})).toBeVisible();
  await app.restartCoordinator();
  await page.reload();
  await slot.click();
  await page.getByRole('menuitem', {name:'Unlock lucky slot position',exact:true}).click();
  await expect.poll(async () => (await app.state()).luckySlotLocks?.M ?? null).toBeNull();
  const next = merchant.getByLabel('Raw Emerald',{exact:true});
  await next.hover();
  await expect(page.getByRole('tooltip').getByText('Next upgrade will test for lucky upgrade · slot 1. Click for options.',{exact:true})).toBeVisible();
  await next.click();
  await expect(page.getByRole('menuitem',{name:'Show lucky slot data',exact:true})).toBeVisible();
  await expect(page.getByRole('menuitem',{name:'Lock lucky slot position',exact:true})).toBeVisible();
  await info.attach('lucky-slot-unlocked', {body:await page.screenshot(),contentType:'image/png'});
});

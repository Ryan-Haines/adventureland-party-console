import {test, expect} from './fixtures';

// Failure inventory: docs/testing-character-sections.md. Test the rendered
// dashboard, real policy mutation/persistence and independent disclosure state.
test('character sections collapse independently and retain inventory equipment restock order', async ({page, app}, info) => {
  await page.goto(app.url);
  const card=(name:string)=>page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})});
  const merchant=card('M'), warrior=card('W');
  const combat=warrior.getByRole('button',{name:'Combat log',exact:true});
  await expect(combat).toBeVisible();
  // The combat log is the card's last section, below the inventory panel's sections.
  const last=async()=>warrior.evaluate(card=>{
    const sections=[...card.querySelectorAll('button[aria-expanded]')].filter(button=>button.getBoundingClientRect().height>0);
    return sections.sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top).at(-1)?.textContent?.trim();
  });
  expect(await last()).toBe('Combat log');
  await page.setViewportSize({width:800,height:1000});
  expect(await last()).toBe('Combat log');
  await info.attach('combat-log-last',{body:await warrior.screenshot(),contentType:'image/png'});
  await page.setViewportSize({width:1440,height:1000});
  const inventory=merchant.getByRole('button',{name:/^Inventory/});
  const equipped=merchant.getByRole('button',{name:'Equipped',exact:true});
  const restock=merchant.getByRole('button',{name:'Merchant restock',exact:true});
  for(const button of [inventory,equipped,restock]) await expect(button).toBeVisible();
  await expect(inventory).toHaveAttribute('aria-expanded','true');
  await expect(equipped).toHaveAttribute('aria-expanded','true');
  await expect(restock).toHaveAttribute('aria-expanded','false');
  const positions=await Promise.all([inventory,equipped,restock].map(b=>b.boundingBox()));
  expect(positions[0]!.y).toBeLessThan(positions[1]!.y);expect(positions[1]!.y).toBeLessThan(positions[2]!.y);
  for(const button of [inventory,equipped]) if(await button.getAttribute('aria-expanded')==='true')await button.click();
  await expect(inventory).toHaveAttribute('aria-expanded','false');await expect(inventory).toContainText('/42');
  const bag=merchant.locator(`[id="${await inventory.getAttribute('aria-controls')}"]`);
  await expect(bag.getByText('sword',{exact:true})).toBeHidden();
  const other=warrior.getByRole('button',{name:/^Inventory/}),before=await other.getAttribute('aria-expanded');
  await inventory.focus();await page.keyboard.press('Enter');await expect(inventory).toHaveAttribute('aria-expanded','true');await expect(bag.getByText('sword',{exact:true})).toBeVisible();
  await expect(other).toHaveAttribute('aria-expanded',before!);
  await equipped.click();await expect(equipped).toHaveAttribute('aria-expanded','true');
  const gear=merchant.locator(`[id="${await equipped.getAttribute('aria-controls')}"]`);await expect(gear.getByText(/^helmet$/i)).toBeVisible();
  const log=merchant.getByRole('button',{name:'Combat log',exact:true});
  await log.click();await expect(merchant.getByText('No combat events yet',{exact:true})).toBeVisible();
  await expect(merchant.getByRole('button',{name:'Combat log',exact:true})).toHaveCount(1);
  await log.click();await expect(merchant.getByText('No combat events yet',{exact:true})).toBeHidden();
  if(await restock.getAttribute('aria-expanded')!=='true')await restock.click();
  const hp=merchant.getByRole('textbox',{name:'HP min',exact:true});await hp.fill('17');
  await restock.click();await expect(hp).toBeHidden();await restock.click();await expect(hp).toHaveValue('17');
  await merchant.getByRole('button',{name:'Save restock',exact:true}).click();
  await expect.poll(async()=>(await app.state()).restockPolicies.M.hp.min).toBe(17);
  await restock.click();await inventory.click();await equipped.click();
  await expect(gear.getByText(/^helmet$/i)).toBeHidden();
  await page.reload();
  await expect(merchant.getByRole('button',{name:'Merchant restock',exact:true})).toHaveAttribute('aria-expanded','false');
  await expect(merchant.getByRole('button',{name:/^Inventory/})).toHaveAttribute('aria-expanded','false');
  await expect(merchant.getByRole('button',{name:'Equipped',exact:true})).toHaveAttribute('aria-expanded','false');
  await page.setViewportSize({width:800,height:1000});
  await info.attach('character-sections-collapsed',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  await app.restartCoordinator();await expect.poll(async()=>(await app.state()).restockPolicies.M.hp.min).toBe(17);
  await info.attach('character-section-order-and-policy',{body:JSON.stringify({positions,restock:(await app.state()).restockPolicies.M}),contentType:'application/json'});
});

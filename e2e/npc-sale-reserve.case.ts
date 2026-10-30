import {test, expect} from './fixtures';
import {automaticCommerceRuleKey} from '../runtime/coordinator/inventory/item-identity';

test.describe('automatic NPC reserve controls', () => {
  const item = {name:'sword',level:0}, key = automaticCommerceRuleKey(item);
  test.use({merchantDialogs:true, savedRecords:[{party_dashboard_settings_state_v1:{
    autoNpcSales:{[key]:{item,createdAt:1}}, merchantAutomations:{'auto npc sales':false},
    npcSaleMarks:[{id:'old-zero-reserve-sale',source:'merchant',slot:0,item,quantity:1,
      auto:true,autoRuleKey:key,state:'queued',queuedAt:1}],
  }}]});
  test('legacy zero reserve, cancel, validation and inline edits survive restart', async ({page,app},info) => {
    await page.goto('/');
    const card=page.locator('article').filter({has:page.getByRole('heading',{name:'M',exact:true})});
    await expect(card.getByRole('button',{name:'Short Sword',exact:true})).toBeVisible();
    await card.getByRole('button',{name:'Short Sword',exact:true}).click({button:'right'});
    await page.getByRole('menuitem',{name:/Update auto sell to NPC/}).click();
    const dialog=page.getByRole('dialog',{name:'Automatically sell to NPC?'});
    await expect(dialog.getByLabel('Number to keep reserved')).toHaveValue('0');
    await dialog.getByLabel('Number to keep reserved').fill('17');
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    expect((await app.state()).autoNpcSales[key].keep).toBe(0);
    expect((await app.state()).npcSaleMarks.some((mark:any)=>mark.id==='old-zero-reserve-sale')).toBe(true);
    for(const keep of [-1,1.5,Number.MAX_SAFE_INTEGER+1,true,null]) {
      const response=await page.request.post(`${app.url}/party-api/merchant/auto-npc-sale`,{data:{item,keep},headers:{Origin:app.url}});
      expect(response.status()).toBe(400);
    }
    await card.getByRole('button',{name:/^Auto NPC sales/}).click();
    await card.getByRole('button',{name:'Keep 0',exact:true}).click();
    await card.getByRole('textbox',{name:/New reserve for/}).fill('17');
    await card.getByRole('button',{name:/Save reserve for/}).click();
    await expect.poll(async()=>(await app.state()).autoNpcSales[key].keep).toBe(17);
    expect((await app.state()).npcSaleMarks.some((mark:any)=>mark.id==='old-zero-reserve-sale')).toBe(false);
    await expect(card.getByRole('button',{name:'Keep 17',exact:true})).toBeVisible();
    await info.attach('inline-reserve-editor',{body:await card.screenshot(),contentType:'image/png'});
    await app.restartCoordinator();
    await expect.poll(async()=>(await app.state()).autoNpcSales[key].keep).toBe(17);
    await page.reload();
    await page.getByRole('button',{name:'Bank',exact:true}).click();
    const bank=page.getByRole('dialog',{name:'Bank',exact:true});
    await bank.getByLabel('The Bank Key',{exact:true}).click({button:'right'});
    await page.getByRole('menuitem',{name:/Auto sell to NPC/}).click();
    await expect(dialog.getByLabel('Number to keep reserved')).toHaveValue('0');
    await dialog.getByLabel('Number to keep reserved').fill('4');
    await dialog.getByRole('button',{name:'Enable auto sale',exact:true}).click();
    const bankKey=automaticCommerceRuleKey({name:'bkey'});
    await expect.poll(async()=>(await app.state()).autoNpcSales[bankKey]?.keep).toBe(4);
    expect((await app.state()).autoNpcSales[bankKey].character).toBeUndefined();
    await info.attach('reserve-controls-state',{body:JSON.stringify(await app.state()),contentType:'application/json'});
  });
});

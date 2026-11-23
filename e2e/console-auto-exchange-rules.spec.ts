import {test,expect} from './fixtures';

test.use({savedRecords:[{party_dashboard_settings_state_v1:{
  autoExchanges:{'gem0@0':{name:'gem0',level:0},'gem0@1':{name:'gem0',level:1},'seashell@0':{name:'seashell',level:0}},
  merchantAutomations:{'automatic exchange':true},
  merchantQueue:[{id:'automatic-rule-fixture',target:'M',reason:'exchange',routine:'automatic exchange',retryAt:Date.now()+86400000,autoExchangeKeys:['gem0@0','gem0@1','seashell@0'],exchanges:[{id:'gem0',level:0,quantity:2},{id:'gem0',level:1,quantity:2},{id:'seashell',level:0,quantity:2}],queuedAt:1},
    {id:'manual-rule-fixture',target:'M',reason:'exchange',routine:'manual exchange',exchanges:[{id:'gem0',level:0,quantity:1}],retryAt:Date.now()+86400000,queuedAt:2}],
}}]});

test('merchant auto exchange rules show absent stock and support confirmed durable removal',async({page,app},info)=>{
  // Failure inventory: no manager for absent stock; level rules collapse;
  // removing a rule enables it again; clear skips entries; manual orders lost;
  // queued automatic stock survives removal; restart restores deleted rules.
  const initial=await app.state(),ruby=initial.merchantCatalog.allItems.find((entry:any)=>entry.id==='gem0').name;
  expect(initial.merchantQueue.some((job:any)=>job.id==='automatic-rule-fixture')).toBe(true);
  await page.goto('/');
  const merchant=page.locator('article').filter({has:page.getByRole('heading',{name:'M',exact:true})});
  const toggle=merchant.getByRole('button',{name:/^Auto exchanges/});
  await expect(toggle).toContainText('3');await toggle.click();
  await expect(merchant.getByRole('button',{name:`View ${ruby}`,exact:true})).toBeVisible();
  await merchant.getByRole('button',{name:`View ${ruby} +1`,exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText(ruby);await page.keyboard.press('Escape');
  for(const name of ['W','P'])await expect(page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})}).getByRole('button',{name:/^Auto exchanges/})).toHaveCount(0);
  await merchant.getByRole('button',{name:`Remove ${ruby} +1`,exact:true}).click();
  expect((await app.state()).autoExchanges['gem0@1']).toBeTruthy();
  await merchant.getByRole('button',{name:`Really remove ${ruby} +1`,exact:true}).click();
  await expect.poll(async()=>(await app.state()).autoExchanges['gem0@1']).toBeUndefined();
  let state=await app.state();
  expect(Object.keys(state.autoExchanges).sort()).toEqual(['gem0@0','seashell@0']);
  expect(state.merchantQueue.find((job:any)=>job.id==='automatic-rule-fixture').autoExchangeKeys).toEqual(['gem0@0','seashell@0']);
  await app.restartCoordinator();await page.reload();
  await expect(toggle).toContainText('2');await toggle.click();
  await info.attach('merchant-auto-exchange-rules',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  await merchant.getByRole('button',{name:'Clear all Auto exchanges',exact:true}).click();
  expect(Object.keys((await app.state()).autoExchanges)).toHaveLength(2);
  await merchant.getByRole('button',{name:'Really clear all Auto exchanges',exact:true}).click();
  await expect.poll(async()=>Object.keys((await app.state()).autoExchanges)).toEqual([]);
  const repeated=await page.request.post(app.url+'/party-api/command',{headers:{Origin:app.url},data:{character:'M',type:'auto-exchange',slot:-1,item:{name:'gem0',level:0},remove:true}});
  expect(repeated.ok()).toBe(true);
  await app.restartCoordinator();state=await app.state();
  expect(state.autoExchanges).toEqual({});
  expect(state.merchantQueue.some((job:any)=>job.id==='automatic-rule-fixture')).toBe(false);
  expect(state.merchantQueue.find((job:any)=>job.id==='manual-rule-fixture').exchanges).toEqual([{id:'gem0',level:0,quantity:1}]);
  await page.reload();await expect(toggle).toContainText('0');
  await expect(merchant.getByRole('button',{name:'Clear all Auto exchanges',exact:true})).toBeDisabled();
  await info.attach('auto-exchange-rule-removal-state',{body:JSON.stringify(state),contentType:'application/json'});
});

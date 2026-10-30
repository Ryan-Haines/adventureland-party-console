import {test,expect} from './fixtures';

test('elixir restock defaults, searchable type and opt-ins persist independently of potion settings',async({page,app},info)=>{
  await page.goto('/');
  const card=page.locator('article').filter({has:page.getByRole('heading',{name:'W',exact:true})});
  await card.getByRole('button',{name:'Merchant restock',exact:true}).click();
  await expect(card.getByLabel('Elixir min')).toHaveValue('1');
  await expect(card.getByLabel('Elixir max')).toHaveValue('2');
  await expect(card.getByRole('checkbox',{name:'Automatically consume elixirs'})).toBeChecked();
  await expect(card.getByRole('checkbox',{name:'Buy or craft elixir when out of stock'})).not.toBeChecked();
  await card.getByRole('button',{name:'Select elixir type',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Select elixir type search'})).toBeVisible();
  await page.getByRole('combobox',{name:'Select elixir type search'}).fill('luck');
  await page.getByRole('option',{name:/Liquid Luck/}).click();
  await card.getByLabel('Elixir min').fill('3');
  await card.getByLabel('Elixir max').fill('4');
  await card.getByRole('checkbox',{name:'Buy or craft elixir when out of stock'}).check();
  await card.getByRole('button',{name:'Save restock'}).click();
  await expect.poll(async()=>(await app.state()).restockPolicies.W.elixir).toEqual({item:'elixirluck',min:3,max:4,autoConsume:true,autoAcquire:true});
  expect((await app.state()).restockPolicies.W.hp).toEqual({item:'hpot1',min:5,max:20});
  await app.restartCoordinator();
  await page.reload();
  await expect(card.getByRole('button',{name:'Select elixir type'})).toContainText('Liquid Luck');
  await expect(card.getByLabel('Elixir min')).toHaveValue('3');
  const invalid=await page.request.post(app.url+'/party-api/restock',{data:{character:'W',elixir:{item:'sword',min:1,max:2}},headers:{Origin:app.url}});
  expect(invalid.status()).toBe(400);
  await info.attach('elixir-restock-controls',{body:await card.screenshot(),contentType:'image/png'});
});

test('gold history defaults to confirmed consumable costs without double charging purchases',async({page,app},info)=>{
  const at=Math.floor((Date.now()-20000)/10000)*10000;
  const first={at:at+1,gold:1000,goldMovement:0,consumableCost:0,consumablePurchases:0};
  const last={at:at+9000,gold:1400,goldMovement:0,consumableCost:100,consumablePurchases:20};
  // Declared metrics read boundary; live consumption is verified in the native journey.
  const history={startedAt:at-1,from:at,to:at+10000,resolutionMs:10000,characters:['W'],points:[{at,values:[{character:'W',server:'USII',first,last}]}]};
  await page.route('**/party-api/metrics?sinceReset=gold*',route=>route.fulfill({json:history}));
  await page.goto('/');
  await page.getByRole('button',{name:'View metrics'}).click();
  await expect(page.getByLabel('Net gold gained since reset')).toContainText('320');
  await page.getByRole('button',{name:'Gold history options'}).click();
  const toggle=page.getByRole('checkbox',{name:'Account for potion and elixir use'});
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.getByLabel('Net gold gained since reset')).toContainText('400');
  await toggle.check();
  await expect(page.getByLabel('Net gold gained since reset')).toContainText('320');
  await info.attach('consumable-gold-toggle',{body:await page.screenshot(),contentType:'image/png'});
});

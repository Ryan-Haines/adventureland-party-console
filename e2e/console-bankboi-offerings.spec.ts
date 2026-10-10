import {test,expect} from './fixtures';

test.use({merchantManaged:true,bankboiOfferings:true});

test('BankBoi deleted outside the console can be forgotten despite stale storage and stays removed after restart',async({page,app},info)=>{
  // Declared external account roster excludes this historical storage worker.
  // The real coordinator must reconcile it without calling the game mutation
  // transport, which this fixture rejects. Stale items must not disable the UI.
  const name='E2EOfferingBank',before=await app.state();
  expect(before.bankbois.find((entry:any)=>entry.name===name).items.length).toBe(3);
  expect(before.upgradeOfferingStock.offeringp).toBe(2);
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'M',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Inspect bank',exact:true}).click();
  const bank=page.getByRole('dialog',{name:'Bank',exact:true});
  await expect(bank).toBeVisible();
  await expect(bank.getByText(name,{exact:true})).toBeVisible();
  const remove=bank.getByRole('button',{name:'Delete',exact:true});
  await expect(remove).toBeEnabled();
  await info.attach('stale-bankboi-delete-enabled',{body:await bank.screenshot(),contentType:'image/png'});
  await remove.click();
  const reply=page.waitForResponse(response=>response.url().endsWith(`/bankbois/${name}/delete`)&&response.request().method()==='POST');
  await bank.getByRole('button',{name:'Really? ×',exact:true}).click();
  const response=await reply,body=await response.json();
  expect(response.status()).toBe(200);expect(body).toEqual({ok:true,alreadyDeleted:true});
  await expect(bank.getByText(name,{exact:true})).toHaveCount(0);
  await app.restartCoordinator();
  const after=await app.state();
  expect(after.bankbois.some((entry:any)=>entry.name===name)).toBe(false);
  expect(after.upgradeOfferingStock.offeringp).toBe(0);
  await page.reload();
  await expect(page.getByRole('heading',{name:'M',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Inspect bank',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Bank',exact:true}).getByText(name,{exact:true})).toHaveCount(0);
  await info.attach('stale-bankboi-removal-after-restart',{body:await page.screenshot(),contentType:'image/png'});
  await info.attach('stale-bankboi-deletion-ledger',{body:JSON.stringify({name,before,response:{status:response.status(),body},after}),contentType:'application/json'});
});

test('BankBoi-only boosters enable upgrade choices and manual confirmation',async({page,app},info)=>{
  // Failure modes: storage worker stock is omitted; availability is duplicated
  // from a stale online worker; menu enables but confirmation rejects the same
  // stock; the selected booster is lost when the real mark command is persisted.
  // Commands must target the configured, owned merchant; observed unmanaged
  // fixture characters are not valid command recipients.
  await page.goto('/');
  const card=page.locator('article').filter({has:page.getByRole('heading',{name:'M',exact:true})});
  const evidence:unknown[]=[];
  for(const [id,label] of [['offering','Primordial Essence'],['offeringx','Primordial X'],['offeringp','Primling']]){
    await expect.poll(async()=>(await app.state()).upgradeOfferingStock?.[id]).toBe(2);
    await card.getByText('sword',{exact:true}).click({button:'right'});
    await page.getByRole('menuitem',{name:'Mark for upgrade',exact:true}).hover();
    const choice=page.getByRole('menuitem',{name:`Upgrade with ${label}`,exact:true});
    await expect(choice).toBeEnabled();
    await choice.click();
    const confirm=page.getByRole('dialog',{name:'Confirm upgrade',exact:true});
    await expect(confirm.getByText(new RegExp(`Use ${label} to upgrade`))).toBeVisible();
    await expect(confirm.getByRole('button',{name:'Confirm',exact:true})).toBeEnabled();
    evidence.push({id,stock:(await app.state()).upgradeOfferingStock});
    await info.attach(`bankboi-${id}-confirmation`,{body:await page.screenshot(),contentType:'image/png'});
    if(id!=='offeringp')await confirm.getByRole('button',{name:'Cancel',exact:true}).click();
    else{
      const response=page.waitForResponse(r=>r.url().endsWith('/party-api/command')&&r.request().method()==='POST');
      await confirm.getByRole('button',{name:'Confirm',exact:true}).click();
      const saved=await response;
      expect(saved.ok()).toBe(true);
      expect(saved.request().postDataJSON()).toMatchObject({character:'M',type:'upgrade-mark',offering:'offeringp'});
      await expect(confirm).not.toBeVisible();
      evidence.push({command:saved.request().postDataJSON(),response:await saved.json(),state:await app.state()});
    }
  }
  await info.attach('bankboi-derived-offering-availability',{body:JSON.stringify(evidence),contentType:'application/json'});
});

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
  await page.getByRole('button',{name:'Bank',exact:true}).click();
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
  await page.getByRole('button',{name:'Bank',exact:true}).click();
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


test('ordinary upgrade menus label only the destination offering step and scroll price',async({page,app,request},info)=>{
  const browserErrors:string[]=[];
  page.on('pageerror',error=>browserErrors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'M',exact:true})).toBeVisible();
  expect((await request.post(app.url+'/party-api/command',{headers:{Origin:app.url},data:{character:'M',type:'upgrade-offering-rule',rule:{name:'sword',floor:0,ceiling:1,offering:'offeringp',required:true}}})).ok()).toBe(true);
  expect((await request.post(app.url+'/party-api/command',{headers:{Origin:app.url},data:{character:'M',type:'upgrade-offering-rule',rule:{name:'sword',floor:1,ceiling:2,offering:'offering',required:false}}})).ok()).toBe(true);
  await page.goto('/');
  const card=page.locator('article').filter({has:page.getByRole('heading',{name:'M',exact:true})});
  for(const menu of ['Mark for upgrade','Auto mark for upgrade']){
    await card.getByText('sword',{exact:true}).click({button:'right'});
    await page.getByRole('menuitem',{name:menu,exact:true}).hover();
    const row=page.getByRole('menuitem').filter({hasText:'+0 → +2'});
    await expect(row.getByRole('img',{name:'Primling',exact:true})).toHaveCount(0);
    await expect(page.getByRole('menuitem').filter({hasText:'+0 → +1'}).getByRole('img',{name:'Primling',exact:true})).toBeVisible();
    await expect(page.getByRole('menuitem').filter({hasText:'+0 → +3'}).getByRole('img')).toHaveCount(0);
    await expect(row.getByRole('img',{name:'Primordial Essence',exact:true})).toBeVisible();
    for(const name of ['Primordial Essence']) expect(await row.getByRole('img',{name,exact:true}).evaluate(async root=>{
      const sheet=root.querySelector<HTMLElement>('[style*="background-image"]');
      if(!sheet) return false;
      const url=JSON.parse(sheet.style.backgroundImage.slice(4,-1));
      const image=new Image();image.src=url;await image.decode();return image.naturalWidth>0;
    })).toBe(true);
    await expect(row).not.toContainText('·');
    await expect(row.locator('[title="Scroll cost"]')).toHaveText('80,000g');
    await expect(row).toContainText('(');
    await expect(row).toContainText(')');
    await info.attach(menu+'-offering-steps',{body:await page.screenshot(),contentType:'image/png'});
    await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  }
  expect(browserErrors).toEqual([]);
  await info.attach('offering-menu-rules',{body:JSON.stringify({state:await app.state(),browserErrors}),contentType:'application/json'});
});


for(const automatic of [false,true]) test(`offering supply authorizes ${automatic?'automatic':'ordinary manual'} batch demand and retains blocked work across restart`,async({page,app,request},info)=>{
  await page.goto('/');await expect(page.getByRole('heading',{name:'M',exact:true})).toBeVisible();
  const initial=await app.state(),enabled=Object.fromEntries(Object.keys(initial.merchantAutomations).map(name=>[name,['manual upgrades','auto upgrade','manual bank exchange','withdrawals'].includes(name)]));
  expect((await request.post(app.url+'/party-api/merchant/routine-priorities',{headers:{Origin:app.url},data:{priorities:{},enabled}})).ok()).toBe(true);
  const previous=(await app.state()).merchantCurrent;
  if(previous) await app.deliverMerchantCompletion({jobId:previous.id,commandId:previous.commandId,success:true});
  const post=async(body:unknown)=>request.post(app.url+'/party-api/command',{headers:{Origin:app.url},data:body});
  expect((await post({character:'M',type:'upgrade-offering-rule',rule:{name:'sword',floor:0,ceiling:2,offering:'offeringp',required:true}})).ok()).toBe(true);
  expect((await post({character:'M',type:automatic?'auto-upgrade-mark':'upgrade-mark',slot:0,item:{name:'sword',level:0},tiers:2})).ok()).toBe(true);
  await expect.poll(async()=>(await app.state()).merchantCurrent?.reason).toBe(automatic?'auto upgrade':'manual upgrades');
  const before=await app.state(),job=before.merchantCurrent,mark=before.upgrades.M[0];
  const body={jobId:job.id,commandId:job.commandId,offering:'offeringp',item:{name:'sword',level:0},mark};
  const supply=async(value:unknown)=>request.post(app.url+'/party-api/merchant/offering-supply',{headers:{Origin:app.url},data:value});
  const response=await supply(body),result=await response.json();
  expect(response.ok()).toBe(true);expect(result).toMatchObject({pending:true,state:'pending',outstanding:2});expect(result.blockingReason).toBeTruthy();
  expect((await supply(body)).ok()).toBe(true);
  expect((await supply({...body,mark:{...mark,tiers:3}})).status()).toBe(409);
  expect((await supply({...body,offering:'offeringx'})).status()).toBe(409);
  const pending=await app.state();expect(pending.withdrawals.M).toHaveLength(1);
  // The order runner yields to the BankBoi with the uncertain-upgrade failure code (runtime/items/character/production.ts), and
  // the row reads the code, not the text (ec58740c9).
  await app.deliverMerchantCompletion({jobId:job.id,commandId:job.commandId,success:false,code:'bankboi_pending',error:'bankboi_pending'});
  await app.restartCoordinator();
  const recovered=await app.state();
  expect(recovered.withdrawals.M).toHaveLength(1);
  expect(recovered.upgrades.M[0]).toMatchObject({item:{name:'sword',level:0},tiers:2});
  expect(recovered.merchantQueue.some((job:any)=>job.offeringSupply?.offering==='offeringp')).toBe(true);
  expect(recovered.merchantCurrent?.reason).not.toBe('manual bank exchange');
  await info.attach('blocked-offering-demand-ledger',{body:JSON.stringify({automatic,before,body,result,pending,recovered}),contentType:'application/json'});
});

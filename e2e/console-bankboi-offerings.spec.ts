import {test,expect} from './fixtures';

test.use({merchantManaged:true,bankboiOfferings:true});

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

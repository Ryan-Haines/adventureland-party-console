import { test, expect } from './fixtures';

test('October event settings persist monster exclusions and cipher policy', async ({page,app},info) => {
  await page.goto('/');
  const warrior=page.locator('article').filter({has:page.getByRole('heading',{name:'W',exact:true})});
  await warrior.getByRole('button',{name:/^Events \(/}).click();
  await expect(page.getByText('Headless Horseman —',{exact:false})).toBeVisible();
  await expect(page.getByText('Trick or Treat —',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Graveyard Rising settings',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'Graveyard Rising settings',exact:true});
  for(const name of ['Zombie','Ghoul','Gargoyle'])await expect(dialog.getByRole('checkbox',{name,exact:true})).toBeChecked();
  await dialog.getByRole('checkbox',{name:'Gargoyle',exact:true}).uncheck();
  await dialog.getByRole('button',{name:'Save event settings'}).click();
  await expect.poll(async()=>(await app.state()).eventLimitsByCharacter?.W?.graveyard?.monsters).toEqual(['zombie','ghoul']);
  await page.getByRole('button',{name:"Witch's Cipher settings",exact:true}).click();
  dialog=page.getByRole('dialog',{name:"Witch's Cipher settings",exact:true});
  await expect(dialog.getByRole('spinbutton',{name:'Gather ingredients (minutes)',exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('region',{name:'Shared realm board',exact:true})).toBeVisible();
  await dialog.getByRole('spinbutton',{name:'Minimum clues',exact:true}).fill('4');
  await dialog.getByRole('checkbox',{name:'Automatically try solutions',exact:true}).uncheck();
  await expect(dialog.getByRole('button',{name:'Manually enter solution',exact:true})).toBeVisible();
  await info.attach('october-cipher-settings',{body:await page.screenshot(),contentType:'image/png'});
  await dialog.getByRole('button',{name:'Save event settings'}).click();
  await app.restartCoordinator();
  await expect.poll(async()=> (await app.state()).eventLimitsByCharacter?.W?.witchcipher?.cipher).toMatchObject({minClues:4,automatic:false});
  await info.attach('october-event-persistence',{body:JSON.stringify((await app.state()).eventLimitsByCharacter),contentType:'application/json'});
});

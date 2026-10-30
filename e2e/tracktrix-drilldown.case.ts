import { test, expect } from './fixtures';
import { fetchFullState } from './state-route';

// Failure inventory: closing the Bestiary drops diagnostic subscriptions; item
// drilldowns recompute an empty score map; deeper trails and Back lose the owner.
// Declared catalog/diagnostic read boundaries; all navigation uses the real UI.
test('Bestiary item drilldown retains Tracktrix scores through deeper trails', async ({page,app},info) => {
  const scores={prat:{score:125,owner:'W'},targetron:{score:321,owner:'W'}};
  await info.attach('tracktrix-declared-read-boundary',{body:JSON.stringify({scores,
    trail:['Prat','Platinum Nugget','Targetron','Platinum Nugget','Targetron','Back','Back']}),contentType:'application/json'});
  await page.route('**/party-api/dashboard-stream', route => route.abort());
  await page.route('**/party-api/state*', async route => {
    const response=await fetchFullState(route),state=await response.json();
    const catalog=state.merchantCatalog;
    if(catalog) catalog.allItems=catalog.allItems.map((item:any)=>item.id==='platinumnugget'
      ? {...item,meta:{...item.meta,world:{...item.meta?.world,drops:[{monsterId:'targetron',monsterName:'Targetron',rate:0.1,quantity:1}]}}}:item);
    if(state.bestiaryCatalog) state.bestiaryCatalog=state.bestiaryCatalog.map((monster:any)=>
      ['prat','targetron'].includes(monster.id)?{...monster,name:monster.id==='prat'?'Prat':'Targetron',
        definition:{...monster.definition,achievements:[[100,'stat','dex',1]]},
        drops:[{id:'platinumnugget',name:'Platinum Nugget',rate:0.1,quantity:1}]}:monster);
    if(state.characterDetails?.W) state.characterDetails.W={...state.characterDetails.W,
      monsterAchievements:scores};
    await route.fulfill({response,json:state});
  });
  await page.goto(app.url);
  await expect(page.getByRole('heading',{name:'W',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Bestiary',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:/^Prat /}).click();
  let dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Prat',exact:true})});
  await expect(dialog).toContainText('125 score');
  await dialog.getByRole('button',{name:/Platinum Nugget/}).click();
  dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Platinum Nugget',exact:true})});
  await dialog.getByRole('button',{name:/Targetron/}).click();
  dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Targetron',exact:true})});
  await expect(dialog).toContainText('321 score');
  await expect(dialog).toContainText('1/1 unlocked');
  await expect(dialog).not.toContainText('Tracktrix data unavailable');
  await info.attach('tracktrix-targetron-drilldown',{body:await page.screenshot(),contentType:'image/png'});
  await dialog.getByRole('button',{name:/Platinum Nugget/}).click();
  dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Platinum Nugget',exact:true})});
  await dialog.getByRole('button',{name:/Targetron/}).click();
  dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Targetron',exact:true})});
  await expect(dialog).toContainText('321 score');
  await dialog.getByRole('button',{name:'Back',exact:true}).click();
  dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Platinum Nugget',exact:true})});
  await dialog.getByRole('button',{name:'Back',exact:true}).click();
  dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Targetron',exact:true})});
  await expect(dialog).toContainText('321 score');
  await info.attach('tracktrix-drilldown-back',{body:await page.screenshot(),contentType:'image/png'});
});

import {test, expect} from './fixtures';

test('lucky discovery rules out ordinary slots and recomputes after new evidence', async ({page,app},info) => {
  await page.goto('/');
  const merchant=page.locator('article').filter({has:page.getByRole('heading',{name:'M',exact:true})});
  await merchant.getByLabel('Short Sword',{exact:true}).click();
  await page.getByRole('menuitem',{name:'Show lucky slot data',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Lucky slots · M',exact:true});
  const ledger={version:1,streamId:'e2e-elimination',slots:Object.fromEntries(Array.from({length:42},(_,slot)=>[slot,{
    totalRolls:slot===0?99:100,sumRolls:slot===0?60:50,rollsAbove96_3:slot===0?20:3,perfectRolls:0,
  }]))};
  const receipts:unknown[]=[];
  const deliver=async()=>{
    const state=await app.state(),id=state.roster.find((entry:{name:string})=>entry.name==='M').id;
    receipts.push(await app.deliverStatus({...state.characters.M,name:'M',luckySlotCharacterId:id,luckySlotTracking:ledger}));
  };
  await deliver();
  await expect(dialog.getByText('0/42 slots ruled out.',{exact:true})).toBeVisible();
  await expect(dialog.getByText(/Next upgrade will test for lucky upgrade · slot 0/)).toBeVisible();
  ledger.slots[0].totalRolls=100;
  await deliver();
  await expect(dialog.getByText('1/42 slots ruled out.',{exact:true})).toBeVisible();
  const zero=dialog.getByRole('row').filter({has:page.getByRole('button',{name:'Lock lucky slot position · slot 0',exact:true})});
  await expect(zero).toContainText('Ruled out');
  await expect(dialog.getByText(/Next upgrade will test for lucky upgrade · slot 1/)).toBeVisible();
  await info.attach('ordinary-slot-eliminated',{body:await dialog.screenshot(),contentType:'image/png'});
  // Cumulative evidence weakens all competing candidates; elimination is not sticky.
  for(let slot=1;slot<42;slot++)ledger.slots[slot]={totalRolls:10000,sumRolls:6000,rollsAbove96_3:4000,perfectRolls:0};
  await deliver();
  await expect(zero).not.toContainText('Ruled out');
  await expect(dialog.getByText('41/42 slots ruled out.',{exact:true})).toBeVisible();
  await expect(dialog.getByText(/Next upgrade will test for lucky upgrade · slot 0/)).toBeVisible();
  await app.restartCoordinator(); await page.reload();
  await merchant.getByLabel('Short Sword',{exact:true}).click();
  await page.getByRole('menuitem',{name:'Show lucky slot data',exact:true}).click();
  await expect(dialog.getByText('41/42 slots ruled out.',{exact:true})).toBeVisible();
  await info.attach('elimination-observation-ledger',{body:JSON.stringify({ledger,receipts,state:await app.state()}),contentType:'application/json'});
  await info.attach('elimination-recomputed-after-restart',{body:await dialog.screenshot(),contentType:'image/png'});
});

test('unlocked lucky inference overrides cursor and lapsing confidence resumes sequential discovery', async ({page,app},info) => {
  await page.goto('/');
  const merchant=page.locator('article').filter({has:page.getByRole('heading',{name:'M',exact:true})});
  await merchant.getByLabel('Short Sword',{exact:true}).click();
  await page.getByRole('menuitem',{name:'Show lucky slot data',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Lucky slots · M',exact:true});
  // Declared cumulative observation boundary; native receipts are covered separately.
  const ledger={version:1,streamId:'e2e-inference',cursor:{slot:41,at:Date.now(),rolls:4200},
    slots:Object.fromEntries(Array.from({length:42},(_,slot)=>[slot,{
      totalRolls:100,sumRolls:50,rollsAbove96_3:slot===19?0:4,perfectRolls:slot===19?5:0,
    }]))};
  const receipts:unknown[]=[];
  const deliver=async()=>{
    const state=await app.state(),id=state.roster.find((entry:{name:string})=>entry.name==='M').id;
    receipts.push(await app.deliverStatus({...state.characters.M,name:'M',luckySlotCharacterId:id,luckySlotTracking:ledger}));
  };
  await deliver();
  await expect(dialog.getByText(/Statistically inferred: slot 19/)).toBeVisible();
  await expect(dialog.getByText(/Next upgrade will test for lucky upgrade · slot 19/)).toBeVisible();
  await info.attach('unlocked-inferred-selection',{body:await dialog.screenshot(),contentType:'image/png'});
  ledger.slots[19]={totalRolls:10000,sumRolls:6000,rollsAbove96_3:4000,perfectRolls:5};
  ledger.slots[41]={totalRolls:10000,sumRolls:6000,rollsAbove96_3:4000,perfectRolls:0};
  ledger.slots[0]={totalRolls:10000,sumRolls:6000,rollsAbove96_3:4000,perfectRolls:0};
  await deliver();
  await expect(dialog.getByText(/Leading candidate:/)).toBeVisible();
  await expect(dialog.getByText(/Next upgrade will test for lucky upgrade · slot 1/)).toBeVisible();
  await app.restartCoordinator(); await page.reload();
  const next=merchant.getByLabel('Raw Emerald',{exact:true});
  // A parallel page or post-reload layout change can retire a one-shot hover.
  // Repeat the actual pointer entry and exact visible result in the same budget.
  await expect(async()=>{
    await page.bringToFront();
    await page.mouse.move(0,0);
    await next.hover({timeout:1000});
    await expect(page.getByText('Next upgrade will test for lucky upgrade · slot 1. Click for options.',{exact:true})).toBeVisible({timeout:1000});
  }).toPass({timeout:15_000,intervals:[100,250]});
  await info.attach('resumed-sequential-discovery-tooltip',{body:await page.screenshot(),contentType:'image/png'});
  await next.click();
  await page.getByRole('menuitem',{name:'Show lucky slot data',exact:true}).click();
  await expect(dialog.getByText(/Next upgrade will test for lucky upgrade · slot 1/)).toBeVisible();
  await info.attach('inference-lapse-ledger',{body:JSON.stringify({ledger,receipts,state:await app.state()}),contentType:'application/json'});
  await info.attach('resumed-sequential-discovery',{body:await dialog.screenshot(),contentType:'image/png'});
});

import { test, expect } from './live-fixtures';

// Failure inventory: e2e/wtb-unconfirmed-purchase-failures.md. Historical boundary: a
// Spider Silk WTB and a pending purchase left by a merchant job that no longer exists
// (the live case from 2026-10-11), plus an unrelated Leather WTB. Resolution goes
// through the dashboard and the coordinator's native-stand route.
const stale = 'merchant-1791749596518-1791748423642';
const key = `${stale}:MtlSnk:EU:IV:trade1:spidersilk:0:117600`;
const seed = () => ({
  standBids: { spidersilk: { price: 150000, quantity: 45, minimumQuality: 0, useStandSlot: false, revision: 1 },
    leather: { price: 1000, quantity: 3, minimumQuality: 0, useStandSlot: false, revision: 1 } },
  nativeStand: { sequence: 0, offers: {}, problems: {}, purchases: {
    [key]: { item: { name: 'spidersilk', q: 1, price: 117600, rid: 'g2uO' }, quantity: 1, jobId: stale } } },
});

for (const bought of [false, true]) {
  test(`a stale unconfirmed WTB purchase is resolved as ${bought ? 'bought' : 'not bought'} from the dashboard`, async ({ live, page }, info) => {
    test.setTimeout(180_000);
    await live.restoreHistoricalSettings(seed);
    await expect.poll(async () => Object.keys((await live.state()).nativeStand?.purchases || {}), { timeout: 60_000 }).toEqual([key]);
    // An unknown purchase is refused. (4, an in-flight job, is guarded in the route only.)
    await expect(live.post('/merchant/native-stand', { action: 'resolve-purchase', id: 'missing', bought: false })).rejects.toThrow(/no longer pending/i);
    await page.goto(live.url);
    const active = page.getByRole('button', { name: /^Active WTB orders/ });
    // The market panel loads on demand; retry the click until it has rendered.
    await expect(async () => {
      if (!await active.isVisible()) await page.getByRole('button', { name: 'Market', exact: true }).click();
      await expect(active).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 90_000 });
    if (await active.getAttribute('aria-expanded') !== 'true') await active.click();
    // 1, 2: the stuck item shows the problem and a choice.
    const row = page.getByRole('group', { name: 'Unconfirmed purchase of Spider Silk' });
    await expect(row).toContainText('Purchase outcome unconfirmed');
    await expect(row).toContainText('1 × Spider Silk at 117,600');
    await info.attach('wtb-unconfirmed-before', { body: await page.screenshot(), contentType: 'image/png' });
    await row.getByRole('button', { name: bought ? 'It was bought' : "It wasn't bought", exact: true }).click();
    await expect(row).toBeHidden({ timeout: 15_000 });
    await expect.poll(async()=>{const state=await live.state();return {purchases:state.nativeStand.purchases,silk:state.standBids.spidersilk.quantity,leather:state.standBids.leather.quantity};},{timeout:15_000}).toEqual({purchases:{},silk:bought?44:45,leather:3});
    const state = await live.state();
    // 3, 5: the purchase is gone, counted once only when bought, and Leather is untouched.
    expect(state.nativeStand.purchases).toEqual({});
    expect(state.standBids.spidersilk.quantity).toBe(bought ? 44 : 45);
    expect(state.standBids.leather.quantity).toBe(3);
    await expect(live.post('/merchant/native-stand',{action:'resolve-purchase',id:key,bought})).rejects.toThrow(/no longer pending/i);
    await live.restartCoordinator();
    await expect.poll(async()=>{const state=await live.state();return {purchases:state.nativeStand.purchases,silk:state.standBids.spidersilk.quantity,leather:state.standBids.leather.quantity};},{timeout:30_000}).toEqual({purchases:{},silk:bought?44:45,leather:3});
    await info.attach('wtb-unconfirmed-after', { body: JSON.stringify({ purchases: state.nativeStand.purchases, bids: state.standBids }), contentType: 'application/json' });
  });
}

test('unconfirmed WTB resolution refuses a still queued purchase job',async({live},info)=>{
 test.setTimeout(180_000);
 await live.post('/merchant/force-stand',{enabled:true});
 await live.restoreHistoricalSettings(()=>({...seed(),merchantQueue:[{id:stale,target:'E2EMerchant',reason:'stand purchases',queuedAt:Date.now(),listings:[]}]}));
 await expect.poll(async()=>{const state=await live.state();return state.merchantQueue.some((job:any)=>job.id===stale)&&!!state.nativeStand?.purchases?.[key];},{timeout:30_000}).toBe(true);
 for(const bought of [false,true])await expect(live.post('/merchant/native-stand',{action:'resolve-purchase',id:key,bought})).rejects.toThrow(/still in progress/i);
 let state=await live.state();expect(Object.keys(state.nativeStand.purchases)).toEqual([key]);expect(state.standBids.spidersilk.quantity).toBe(45);expect(state.standBids.leather.quantity).toBe(3);
 await live.post('/merchant/job/cancel',{id:stale});
 await live.post('/merchant/native-stand',{action:'resolve-purchase',id:key,bought:true});
 await expect.poll(async()=>{const state=await live.state();return {purchases:state.nativeStand.purchases,silk:state.standBids.spidersilk.quantity,leather:state.standBids.leather.quantity};},{timeout:15_000}).toEqual({purchases:{},silk:44,leather:3});
 state=await live.state();await info.attach('wtb-in-progress-resolution-guard',{body:JSON.stringify({nativeStand:state.nativeStand,bids:state.standBids,queue:state.merchantQueue}),contentType:'application/json'});
});

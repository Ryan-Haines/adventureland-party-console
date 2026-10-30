import {waitForGameplay} from './network-clock';
import {test,expect} from './live-fixtures';

for (const automatic of [false,true]) {
  test(`party ${automatic ? 'Auto exchange' : 'Exchange'} hands selected native stock to the merchant`,async({live,page},info)=>{
    test.setTimeout(360_000);
    // Failure modes: missing party menus, fighter executes exchange, automatic
    // routine gating ignored, locked/unrelated stock collected, premature manual
    // exchange consumes merchant stock, pickup intent lost across restart.
    const fighter='E2EWarrior',merchant='E2EMerchant',checkpoints:any[]=[];
    live.clients[merchant].page.on('response',async response=>{if(new URL(response.url()).pathname.endsWith('/exchange-progress')){try{checkpoints.push(response.request().postDataJSON());}catch{}}});
    await expect.poll(async()=>(await live.state(true)).merchantCatalog?.exchangeable?.some((line:any)=>line.id==='armorbox'),{timeout:120_000}).toBe(true);
    await live.post('/config',{itemCollectionThreshold:1});
    await live.post('/merchant/force-stand',{enabled:true});
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'party collection':true,'automatic exchange':false,'auto compound':false}});
    await live.admin(`output=(()=>{const p=get_player('${fighter}');for(const [slot,item] of [[20,{name:'armorbox',q:1}],[21,{name:'armorbox',q:1,l:'l'}],[22,{name:'beewings',q:2}]]){if(p.items[slot])throw Error('Occupied fixture slot');p.items[slot]=item;}cache_player_items(p);resend(p,'reopen+cid');return p.items;})()`);
    await expect.poll(async()=>(await live.state()).characters[fighter]?.items?.find((entry:any)=>entry?.slot===20)?.item?.name,{timeout:30_000}).toBe('armorbox');
    await page.goto(live.url);
    const card=page.locator('article').filter({has:page.getByRole('heading',{name:fighter,exact:true})});
    const tile=card.getByLabel('Armor Box',{exact:true}).first();
    await tile.click({button:'right'});
    await expect(page.getByRole('menuitem',{name:'Exchange',exact:true})).toBeVisible();
    await expect(page.getByRole('menuitem',{name:'Auto exchange',exact:true})).toBeVisible();
    await page.getByRole('menuitem',{name:automatic?'Auto exchange':'Exchange',exact:true}).click();
    let pending=await live.state();
    if(automatic){
      await expect(tile).toContainText('Auto exchange');
      await live.post('/merchant/force-stand',{enabled:false});
      await waitForGameplay(10_000);
      expect((await live.clients[fighter].snapshot()).items[20]?.q).toBe(1);
      await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'automatic exchange':true}});
    }else{
      const matchingPickup=(state:any,exchangeId?:string,pickupId?:string)=>{
        const jobs=[...state.merchantQueue,...(state.merchantCurrent?[state.merchantCurrent]:[])];
        const exchange=jobs.find((job:any)=>job.reason==='exchange'&&job.exchangePickupId&&(!exchangeId||job.id===exchangeId));
        return exchange&&(!pickupId||exchange.exchangePickupId===pickupId)&&jobs.some((job:any)=>job.id===exchange.exchangePickupId&&job.exchangeDeliveryId===exchange.id);
      };
      await expect.poll(async()=>{pending=await live.state();return !!matchingPickup(pending);},{timeout:30_000}).toBe(true);
      const exchange=pending.merchantQueue.find((job:any)=>job.reason==='exchange'&&job.exchangePickupId)??pending.merchantCurrent;
      await live.restartCoordinator();
      await expect.poll(async()=>!!matchingPickup(await live.state(),exchange.id,exchange.exchangePickupId),{timeout:30_000}).toBe(true);
      await live.post('/merchant/force-stand',{enabled:false});
    }
    await expect.poll(async()=>(await live.clients[fighter].snapshot()).items.filter((item:any)=>item?.name==='armorbox'&&!item.l).length,{timeout:180_000}).toBe(0);
    await expect.poll(async()=>(await live.clients[merchant].snapshot()).items.filter((item:any)=>item?.name==='armorbox').length,{timeout:180_000}).toBe(0);
    await expect.poll(()=>checkpoints.some(checkpoint=>checkpoint.rewards?.length>0),{timeout:120_000}).toBe(true);
    const after=await live.clients[fighter].snapshot();
    expect(after.items[21]).toMatchObject({name:'armorbox',q:1,l:'l'});
    expect(after.items[22]).toMatchObject({name:'beewings',q:2});
    await live.post('/merchant/force-stand',{enabled:true});
    await live.admin(`output=(()=>{const p=get_player('${fighter}');if(p.items[20])throw Error('Occupied follow-up slot');p.items[20]={name:'armorbox',q:1};cache_player_items(p);resend(p,'reopen+cid');return p.items;})()`);
    await expect.poll(async()=>(await live.state()).characters[fighter]?.items?.find((entry:any)=>entry?.slot===20)?.item?.q,{timeout:30_000}).toBe(1);
    if(automatic){
      await tile.click({button:'right'});
      await page.getByRole('menuitem',{name:'Auto mark for merchant',exact:true}).click();
      await expect.poll(async()=>(await live.state()).autoExchanges?.['armorbox@0']).toBeUndefined();
    }
    await live.post('/merchant/force-stand',{enabled:false});
    if(automatic){
      await expect.poll(async()=>(await live.clients[merchant].snapshot()).items.filter((item:any)=>item?.name==='armorbox').length,{timeout:120_000}).toBe(1);
      await waitForGameplay(10_000);
      expect((await live.clients[merchant].snapshot()).items.filter((item:any)=>item?.name==='armorbox')).toHaveLength(1);
    }else{
      await waitForGameplay(10_000);
      expect((await live.clients[fighter].snapshot()).items[20]).toMatchObject({name:'armorbox',q:1});
    }
    expect((await live.clients[fighter].events()).filter((event:any)=>event.event==='game_response'&&event.data?.place==='exchange')).toHaveLength(0);
    await info.attach('party-exchange-native',{body:JSON.stringify({automatic,pending,after,checkpoints,state:await live.state(),merchantEvents:await live.clients[merchant].events(),fighterEvents:await live.clients[fighter].events()}),contentType:'application/json'});
    await info.attach('party-exchange-dashboard',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  });
}

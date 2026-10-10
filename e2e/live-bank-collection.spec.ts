import {test,expect} from './live-fixtures';

// Failure modes: auto rules never materialize withdrawals; toggling always-on
// loses existing marks; always-off suppresses threshold trips; duplicate visits
// or locked-stock sales. Native bank moves and NPC receipts prove completion.
for(const scenario of ['toggle','already enabled','threshold'] as const){
  test(`bank automatic NPC collection runs with ${scenario}`,async({live,page},info)=>{
    test.setTimeout(300_000);
    const merchant='E2EMerchant',count=scenario==='threshold'?5:2;
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{withdrawals:scenario==='already enabled','auto npc sales':false,'party collection':true}});
    await live.post('/config',{itemCollectionThreshold:4});
    await live.admin(`output=(async()=>{const p=get_player('${merchant}'),patch=Object.fromEntries(Array.from({length:${count}},(_,i)=>['info.items0.'+i,{name:'helmet',level:0}]));patch['info.items0.${count}']={name:'helmet',level:0,l:'l'};await db.collection('user').updateOne({_id:p.owner},{$set:patch});return true})()`);
    await live.post('/command',{character:merchant,type:'bank'});
    await expect.poll(async()=>(await live.state()).bank?.packs?.items0?.[count]?.item?.l,{timeout:90_000}).toBe('l');
    await expect.poll(async()=>(await live.state()).merchantCurrent,{timeout:90_000}).toBeNull();
    await live.post('/merchant/force-stand',{enabled:true});
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':true}});
    await page.goto(live.url);
    await expect(page.getByRole('heading',{name:merchant,exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Inspect bank',exact:true}).click();
    const bank=page.getByRole('dialog',{name:'Bank',exact:true});
    await bank.getByLabel('Helmet',{exact:true}).first().click({button:'right'});
    await page.getByRole('menuitem',{name:'Auto sell to NPC…',exact:true}).click();
    const confirm=page.getByRole('dialog',{name:'Automatically sell to NPC?',exact:true});
    await confirm.getByRole('button',{name:'Enable auto sale',exact:true}).click();
    await expect.poll(async()=>(await live.state()).withdrawals?.[merchant]?.length).toBe(count);
    const pending=await live.state();
    if(scenario==='toggle'){
      expect(pending.merchantQueue.some((job:any)=>['withdrawals','bank collection','manual bank exchange'].includes(job.reason))).toBe(false);
      await live.post('/merchant/routine-priorities',{priorities:{},enabled:{withdrawals:true}});
    }
    await expect.poll(async()=>(await live.state()).merchantQueue.some((job:any)=>job.reason===(scenario==='threshold'?'bank collection':'withdrawals'))).toBe(true);
    await info.attach('bank-marked-collection-queued',{body:JSON.stringify({scenario,pending,state:await live.state()}),contentType:'application/json'});
    await page.keyboard.press('Escape');
    await live.post('/merchant/force-stand',{enabled:false});
    await expect.poll(async()=>(await live.clients[merchant].events()).filter(entry=>entry.event==='game_response'&&entry.data?.place==='sell'&&entry.data.success===true&&entry.data.item?.name==='helmet').length,{timeout:180_000}).toBe(count);
    const after=await live.state();
    expect(Object.values(after.bank.packs).flat().filter((entry:any)=>entry?.item?.name==='helmet'&&entry.item.l==='l')).toHaveLength(1);
    await info.attach('bank-marked-collection-native',{body:JSON.stringify({after,events:await live.clients[merchant].events()}),contentType:'application/json'});
    await info.attach('bank-marked-collection-dashboard',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  });
}

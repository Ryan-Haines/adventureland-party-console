import {test,expect} from './live-fixtures';

for(const recovery of [false,true]) test(`bank popup sort completes ${recovery?'legacy recovery':'native merchant-luck swaps'} and permits departure`,async({live,page},info)=>{
  test.setTimeout(300_000);
  const merchant='E2EMerchant';
  await live.post('/merchant/bank-sort',{mode:'request'});
  await live.admin(`output=(async()=>{const p=get_player('${merchant}');await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0':[{name:'shoes',level:2,m:'E2EWarrior',l:'l'},{name:'helmet',level:1}]}});return true})()`);
  if(recovery){
    // Historical persisted input: the native deposit completed, but the old
    // runner still expected merchant-luck attribution to survive storage.
    await live.admin(`output=(async()=>{const p=get_player('${merchant}');await db.collection('user').updateOne({_id:p.owner},{$unset:{'info.items0.0.m':''}});return true})()`);
    await live.clients[merchant].run(`(()=>{const identity=JSON.stringify(['shoes',2,null,null,null,null,null,'E2EWarrior','l']);const journal=[{slot:41,floor:'bank',identities:[identity],pending:{pack:'items0',slot:0,inventory:'null',bank:JSON.stringify([identity,1])}}];globalThis.__partyBankSortJournal=journal;localStorage.setItem('party-bank-sort-buffer:${merchant}',JSON.stringify(journal));return true})()`);
  }
  await page.goto(live.url);
  await page.getByRole('button',{name:'Bank',exact:true}).click();
  const bank=page.getByRole('dialog',{name:'Bank',exact:true});
  await bank.getByRole('button',{name:'Sort on next visit · Off',exact:true}).click();
  await expect.poll(async()=>(await live.state()).bankSortRequest?.status).toBe('queued');
  await live.post('/command',{character:merchant,type:'bank'});
  await expect.poll(async()=>{
    const state=await live.state();
    return state.bankSortRequest===null&&state.bank?.packs?.items0?.[0]?.item?.name==='helmet'&&
      state.bank?.packs?.items0?.[1]?.item?.name==='shoes';
  },{timeout:180_000}).toBe(true);
  await expect.poll(async()=>{
    const client=await live.clients[merchant].snapshot();
    return client.map==='main'&&!client.items.some((item:any)=>item?.name==='shoes');
  },{timeout:90_000}).toBe(true);
  const native=await live.admin(`output=(async()=>{const p=get_player('${merchant}'),u=await db.collection('user').findOne({_id:p.owner});return {items:u.info.items0.filter(Boolean),inventory:p.items}})()`);
  expect(native.items).toHaveLength(2);
  expect(native.items[0]).toMatchObject({name:'helmet',level:1});
  expect(native.items[1]).toMatchObject({name:'shoes',level:2,l:'l'});
  expect(native.items[1].m).toBeUndefined();
  await info.attach('native-bank-sort-conservation',{body:JSON.stringify({native,state:await live.state(),client:await live.clients[merchant].snapshot(),journal:await live.clients[merchant].run(`localStorage.getItem('party-bank-sort-buffer:${merchant}')`)}),contentType:'application/json'});
  await info.attach('bank-popup-sort-completed',{body:await page.screenshot(),contentType:'image/png'});
});

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
    await page.getByRole('button',{name:'Bank',exact:true}).click();
    const bank=page.getByRole('dialog',{name:'Bank',exact:true});
    await bank.getByLabel('Helmet',{exact:true}).first().click({button:'right'});
    await page.getByRole('menuitem',{name:'Auto sell to NPC…',exact:true}).click();
    const confirm=page.getByRole('dialog',{name:'Automatically sell to NPC?',exact:true});
    await confirm.getByRole('button',{name:'Enable auto sale',exact:true}).click();
    await expect.poll(async()=>(await live.state()).withdrawals?.[merchant]?.length).toBe(count);
    const pending=await live.state();
    if(scenario==='toggle'){
      expect(pending.merchantQueue.some((job:any)=>job.reason==='auto npc withdrawals')).toBe(true);
      await live.post('/merchant/routine-priorities',{priorities:{},enabled:{withdrawals:true}});
    }
    await expect.poll(async()=>(await live.state()).merchantQueue.some((job:any)=>job.reason===(scenario==='threshold'?'auto npc withdrawals':'withdrawals'))).toBe(true);
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


// Failure modes: idle-only admission starves behind collection; the first
// over-limit pair hides small piles; partial fills lose stock; bank sorting
// swaps incompatible properties or leaves compatible piles split.
test('merchant compresses five candy piles and bank sort consolidates compatible silk',async({live},info)=>{
  test.setTimeout(300_000);
  const merchant='E2EMerchant';
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/merchant/bank-sort',{mode:'request',enabled:true});
  await live.admin(`output=(async()=>{const p=get_player('${merchant}');
    [6450,31,9999,4083,15].forEach((q,i)=>{p.items[20+i]={name:'candy0',q};});
    p.items[25]={name:'spidersilk',q:5,p:'cavefound'};
    await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0':[{name:'spidersilk',q:39},{name:'spidersilk',q:26,p:'cavefound'},{name:'spidersilk',q:7,p:'shiny'}]}});
    cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
  await expect.poll(async()=>{
    const c=await live.clients[merchant].snapshot();return c.items.filter((i:any)=>i?.name==='candy0').map((i:any)=>i.q).sort((a:number,b:number)=>b-a);
  },{timeout:90_000}).toEqual([9999,9999,580]);
  await live.post('/merchant/force-stand',{enabled:false});
  await live.post('/command',{character:merchant,type:'mark',slot:25,item:{name:'spidersilk',q:5,p:'cavefound'}});
  await live.post('/command',{character:merchant,type:'bank'});
  await expect.poll(async()=>{
    const s=await live.state();return s.bankSortRequest===null&&s.bank?.packs?.items0?.filter((e:any)=>e?.item?.name==='spidersilk').map((e:any)=>e.item).sort((a:any,b:any)=>(b.q||1)-(a.q||1));
  },{timeout:180_000}).toEqual([{name:'spidersilk',q:70},{name:'spidersilk',q:7,p:'shiny'}]);
  await info.attach('native-stack-compression',{body:JSON.stringify({state:await live.state(),client:await live.clients[merchant].snapshot(),events:await live.clients[merchant].events()}),contentType:'application/json'});
});

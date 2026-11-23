import {test,expect} from './live-fixtures';
import {automaticCommerceRuleKey} from '../runtime/coordinator/inventory/item-identity';

const merchant='E2EMerchant';
test('merchant capacity sells before higher priority upgrades when only the lucky slot is empty',async({live},info)=>{
  // Failure inventory: optional lucky tidying blocks the sale that frees its
  // buffer; higher priority upgrades starve cleanup; full-bag native purchases;
  // dropped upgrade intent or replay after cleanup. Native sale/upgrade receipts
  // and fresh coordinator observations are separate completion milestones.
  test.setTimeout(300_000);
  await live.post('/merchant/force-stand',{enabled:true});
  await live.admin(`output=(()=>{const p=get_player('${merchant}');p.items=Array.from({length:42},()=>({name:'helmet',level:0,l:'l'}));
    p.items[0]={name:'stand0',l:'l'};p.items[1]={name:'hpot1',q:9999,l:'l'};p.items[2]={name:'mpot1',q:9999,l:'l'};
    p.items[5]={name:'coat',level:0};p.items[6]={name:'broom',level:0};p.items[7]=null;
    p.items[20]={name:'scroll0',q:100,l:'l'};p.items[41]={name:'tracker',l:'l'};
    cache_player_items(p);resend(p,'reopen+cid');return true})()`);
  await expect.poll(async()=>(await live.clients[merchant].snapshot()).items.filter((i:any)=>!i).length).toBe(1);
  await live.restoreHistoricalSettings(()=>({luckySlotLocks:{[merchant]:7},
    autoUpgradeMarks:{[merchant]:{'broom@+0':{tiers:1,quantity:1}}},
    autoNpcSales:{[automaticCommerceRuleKey({name:'coat',level:0})]:{item:{name:'coat',level:0},keep:0,createdAt:Date.now()}}}));
  await live.post('/merchant/routine-priorities',{priorities:{'auto upgrade':100,'auto npc sales':1},enabled:{'auto upgrade':true,'auto npc sales':true,'inventory cleanout':false}});
  const before=await live.state();
  await live.post('/merchant/force-stand',{enabled:false});
  try{
    await expect.poll(async()=>{
      const s=await live.state(),items=(await live.clients[merchant].snapshot()).items;
      return !items.some((i:any)=>i?.name==='coat') && !(s.upgrades[merchant]||[]).length &&
        ![s.merchantCurrent,...s.merchantQueue].some((j:any)=>j&&['auto upgrade','auto npc sales'].includes(j.reason)) &&
        !s.characters[merchant]?.items.some((entry:any)=>entry?.item?.name==='coat');
    },{timeout:240_000}).toBe(true);
    const events=await live.clients[merchant].events(),after=await live.state();
    const upgrades=events.filter((e:any)=>e.event==='game_response'&&['upgrade_success','upgrade_fail'].includes(e.data?.response));
    const sales=events.filter((e:any)=>e.event==='game_response'&&e.data?.place==='sell'&&e.data?.item?.name==='coat'&&e.data?.success);
    expect(upgrades).toHaveLength(1);expect(sales).toHaveLength(1);
    expect(sales[0].data.gold).toBeGreaterThan(0);expect(sales[0].sequence).toBeLessThan(upgrades[0].sequence);
    const sale=after.merchantActivity.findIndex((e:any)=>/^Sold 1 × coat to NPC for [\d,]+ gold$/.test(e.message));
    const upgrade=after.merchantActivity.findIndex((e:any)=>e.message==='Merchant dispatched for automatic upgrades');
    expect(sale).toBeGreaterThanOrEqual(0);expect(upgrade).toBeGreaterThan(sale);
    expect(after.merchantActivity.filter((e:any)=>/no spare slot|cant_space|inventory_full|Couldn't use lucky slot/.test(JSON.stringify(e)))).toHaveLength(0);
  }finally{
    await info.attach('merchant-capacity-sale-before-production',{body:JSON.stringify({before,after:await live.state(),items:(await live.clients[merchant].snapshot()).items,events:await live.clients[merchant].events()}),contentType:'application/json'});
  }
});

for(const mode of ['bank','protected','automatic'])test(`exchange capacity ${mode==='automatic'?'reserves three cells for automatic rewards':mode==='protected'?'preserves protected rewards and resumes after space changes':'banks rewards mid-order and resumes across restart'}`,async({live},info)=>{
  // Failure inventory: split into a full bag; rewards banked only at order end;
  // duplicate/lost consumption after restart; banked protected gear; dropped
  // manual intent or an immediate retry loop when no safe deposit exists.
  test.setTimeout(480_000);
  const automatic=mode==='automatic', protectedRewards=mode!=='bank', locked=automatic?36:39;
  const checkpoints:any[]=[];
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'automatic exchange':false,'auto upgrade':false,'inventory cleanout':false}});
  if(protectedRewards)await live.restoreHistoricalSettings(()=>({autoUpgradeMarks:{[merchant]:{'jacko@+0':{tiers:1,quantity:-1}}}}));
  await expect.poll(async()=>(await live.state(true)).merchantCatalog?.exchangeable?.some((entry:any)=>entry.id==='candy0'),{timeout:120_000}).toBe(true);
  const seeded=await live.admin(`output=(()=>{const p=get_player('${merchant}');
    if(p.isize!==42)throw Error('Scenario requires the reported 42-slot inventory');
    globalThis.__capacityCandyDrops=D.drops.candy0;D.drops.candy0=[[1,'jacko',1]];
    p.items=Array(42).fill(null);for(let i=0;i<${locked};i++)p.items[i]={name:'helmet',level:0,l:'l'};
    p.items[0]={name:'stand0',l:'l'};p.items[1]={name:'hpot1',q:9999,l:'l'};p.items[2]={name:'mpot1',q:9999,l:'l'};
    p.items[${locked}]={name:'candy0',q:6};cache_player_items(p);resend(p,'reopen+cid');
    return {items:p.items,exchanges:p.p.stats.exchanges.candy0||0,table:D.drops.candy0};})()`);
  const native=()=>live.admin(`output=(async()=>{const p=get_player('${merchant}'),u=p.user||(await db.collection('user').findOne({_id:p.owner})).info;
    const bank=Object.entries(u).filter(([k,v])=>/^items[0-9]+$/.test(k)&&Array.isArray(v)).flatMap(([,v])=>v);
    const count=(list,name)=>list.filter(i=>i?.name===name).reduce((n,i)=>n+(i.q||1),0);
    return {candy:count(p.items,'candy0'),jacko:count(p.items,'jacko'),bankJacko:count(bank,'jacko'),
      locked:p.items.filter(i=>i?.l).length,exchanges:p.p.stats.exchanges.candy0||0,map:p.map,free:p.items.filter(i=>!i).length};})()`);
  const before=await native();
  await expect.poll(async()=>(await live.state()).characters[merchant]?.items?.filter((entry:any)=>entry?.item).length).toBe(locked+1);
  await live.clients[merchant].page.context().route('**/party-api/merchant/exchange-progress',async route=>{
    const body=route.request().postDataJSON(),response=await route.fetch();
    checkpoints.push({at:Date.now(),body,status:response.status()});
    await route.fulfill({response});
  });
  let order:any;
  try{
    if(automatic){
      await live.post('/command',{character:merchant,type:'auto-exchange',slot:-1,item:{name:'candy0',level:0}});
      order=await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'automatic exchange':true}});
    }else order=await live.post('/merchant/exchange-order',{exchanges:[{id:'candy0',level:0,quantity:6}]});
    if(protectedRewards){
      await expect.poll(async()=>{
        const s=await live.state();
        if(s.merchantActivity.some((a:any)=>a.message==='Exchange paused until inventory or bank contents change'))return 'blocked';
        return s.merchantActivity.some((a:any)=>a.message==='Exchange failed')?'failed':'waiting';
      },{timeout:180_000,message:'A full protected bag must preserve the unfinished exchange behind a capacity block'}).toBe('blocked');
      const blocked=await live.state(),physical=await native();
      const pending=blocked.merchantQueue.filter((job:any)=>job.reason==='exchange');
      expect(pending).toHaveLength(1);expect(pending[0].exchanges).toEqual([{id:'candy0',level:0,quantity:4}]);
      expect(typeof pending[0].exchangeCapacitySignature).toBe('string');
      expect(physical).toMatchObject({candy:4,jacko:2,bankJacko:before.bankJacko,exchanges:before.exchanges+2,locked,free:automatic?3:0});
      await live.restartCoordinator();
      await expect.poll(async()=>{
        const s=await live.state(),job=s.merchantQueue.find((entry:any)=>entry.reason==='exchange');
        return s.merchantCurrent?.reason!=='exchange'&&job?.exchangeCapacitySignature===pending[0].exchangeCapacitySignature;
      },{timeout:30_000,message:'The capacity fence must remain on the same unfinished order after restart'}).toBe(true);
      const unchanged=await native();expect(unchanged.exchanges).toBe(physical.exchanges);
      await info.attach('protected-exchange-capacity-block',{body:JSON.stringify({blocked,physical,unchanged}),contentType:'application/json'});
      await live.admin(`output=(()=>{const p=get_player('${merchant}');for(let i=3;i<7;i++){if(p.items[i]?.name!=='helmet'||!p.items[i].l)throw Error('Owned fixture filler changed');p.items[i]=null;}cache_player_items(p);resend(p,'reopen+cid');return true})()`);
    }else{
      await expect.poll(()=>checkpoints.filter(c=>c.body.remaining?.[0]?.quantity===4).length,{timeout:180_000,message:'Capacity banking must checkpoint the same four remaining candies before leaving the NPC'}).toBeGreaterThanOrEqual(2);
      const previous=checkpoints[0].body;
      expect(Number.isSafeInteger(previous.commandId)).toBe(true);
      await live.restartCoordinator();
      await expect.poll(async()=>{
        const current=(await live.state()).merchantCurrent;
        return current?.reason==='exchange'&&current.commandId!==previous.commandId;
      },{timeout:30_000}).toBe(true);
      // A recovered order retains its job ID but has a new worker command.
      // Delayed reports from the old worker must not fail or rewind it.
      await expect(live.post('/merchant/complete',{jobId:previous.jobId,commandId:previous.commandId,success:false,error:'Unattributed movement stop'})).rejects.toThrow(/409/);
      await expect(live.post('/merchant/exchange-progress',previous)).rejects.toThrow(/409/);
    }
    await expect.poll(async()=>{
      const s=await live.state(),n=await native();
      if(s.merchantActivity.some((a:any)=>a.message==='Exchange failed'))return 'failed';
      return n.candy===0&&![s.merchantCurrent,...s.merchantQueue].some((job:any)=>job?.reason==='exchange')?'completed':'waiting';
    },{timeout:300_000,message:'The original six native exchanges must finish without another order or toggle'}).toBe('completed');
    const after=await native();
    expect(after.exchanges-before.exchanges).toBe(6);
    expect(after.jacko+after.bankJacko-before.jacko-before.bankJacko).toBe(6);
    expect(after.locked).toBe(protectedRewards?locked-4:locked);
    if(protectedRewards){expect(after.jacko).toBe(6);expect(after.bankJacko).toBe(before.bankJacko);}
    else{expect(after.jacko).toBe(0);expect(after.bankJacko-before.bankJacko).toBe(6);}
  }finally{
    await live.clients[merchant].page.context().unrouteAll({behavior:'ignoreErrors'});
    await info.attach('native-exchange-capacity-ledger',{body:JSON.stringify({seeded,before,order,checkpoints,after:await native(),state:await live.state()}),contentType:'application/json'});
    await live.admin('D.drops.candy0=globalThis.__capacityCandyDrops;delete globalThis.__capacityCandyDrops;output=true');
  }
});

test('BankBoi creation takes a banked merchant outside and confirms one new character',async({live},info)=>{
  test.setTimeout(240_000);
  const prefix='ExitVault';
  await live.post('/dashboard-preferences',{bankboiPrefix:prefix});
  const spawn=await live.admin('output=G.maps.bank.spawns[0]');
  await live.post('/command',{character:merchant,type:'character-travel',location:{map:'bank',x:spawn[0],y:spawn[1]}});
  await expect.poll(async()=>(await live.state()).characters[merchant]?.map,{timeout:90_000}).toBe('bank');
  const before=await live.state();
  expect(await live.admin(`output=!!get_player('${merchant}').user`)).toBe(true);
  const result=await live.post('/bankbois/create',{});
  expect(result.bankboi.name).toMatch(/^ExitVault[0-9]+$/);
  const after=await live.state();
  expect(after.characters[merchant].map).not.toMatch(/^bank(?:_b|_u)?$/);
  expect(after.bankbois.filter((b:any)=>b.name===result.bankboi.name)).toHaveLength(1);
  const owned=await live.admin(`output=(async()=>{const p=get_player('${merchant}'),u=await db.collection('user').findOne({_id:p.owner});return u.info.characters.map(c=>c.name)})()`);
  expect(owned.filter((name:string)=>name===result.bankboi.name)).toHaveLength(1);
  await info.attach('bank-exit-and-creation',{body:JSON.stringify({before:before.characters[merchant].map,after:after.characters[merchant].map,result,owned}),contentType:'application/json'});
});

test('marked withdrawal waits at the three-slot reserve and resumes after capacity changes',async({live},info)=>{
  test.setTimeout(240_000);
  await live.admin(`output=(async()=>{const p=get_player('${merchant}');const pack=Array.from({length:42},()=>({name:'coat',level:0}));const first=pack.slice();first[0]={name:'leather',q:13};await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0':first,'info.items1':pack}});return true})()`);
  await live.post('/command',{character:merchant,type:'bank'});
  const leather=(s:any)=>Object.entries(s.bank?.packs||{}).flatMap(([pack,entries])=>
    (entries as any[]).filter(entry=>entry?.item?.name==='leather').map(entry=>({pack,...entry})))[0];
  // The first bank snapshot precedes cosmetic sorting. Do not mark a slot
  // until the setup visit has finished and telemetry agrees with native stock.
  await expect.poll(async()=>{
    const s=await live.state(), source=leather(s);
    if(s.merchantCurrent || !s.merchantActivity.some((a:any)=>a.message==='Merchant job completed for '+merchant) || source?.item.q!==13) return false;
    return live.admin(`output=(async()=>{const u=await db.collection('user').findOne({_id:get_player('${merchant}').owner});const item=u.info[${JSON.stringify(source.pack)}]?.[${Number(source.slot)}];return item?.name==='leather'&&item.q===13})()`);
  },{timeout:90_000}).toBe(true);
  const source=leather(await live.state());
  await live.admin(`output=(()=>{const p=get_player('${merchant}');p.items[35]={name:'jacko',level:0};for(let i=0;i<39;i++)if(!p.items[i])p.items[i]={name:'helmet',level:0,l:'l'};cache_player_items(p);resend(p,'reopen+cid');return true})()`);
  await expect.poll(async()=>(await live.state()).characters[merchant].items.filter((e:any)=>e?.item).length).toBeGreaterThanOrEqual(39);
  await live.post('/command',{character:merchant,type:'mark',slot:35,item:{name:'jacko',level:0}});
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{withdrawals:true}});
  await live.post('/command',{character:merchant,type:'withdraw',pack:source.pack,slot:source.slot,item:source.item});
  const fullTrips=(s:any)=>s.merchantActivity.filter((a:any)=>a.message.startsWith('Bank full; deferred deposit of jacko'));
  await expect.poll(async()=>fullTrips(await live.state()).length,{timeout:90_000}).toBe(1);
  const blocked=await live.state(),start=blocked.characters[merchant].seenAt;
  const dispatches=(s:any)=>s.merchantActivity.filter((a:any)=>a.message==='Merchant dispatched to retrieve marked bank withdrawals');
  await expect.poll(async()=>{
    const s=await live.state();
    expect(fullTrips(s)).toHaveLength(1);
    expect(dispatches(s)).toHaveLength(0);
    expect(s.withdrawals[merchant]).toHaveLength(1);
    return s.characters[merchant].seenAt-start;
  },{timeout:100_000}).toBeGreaterThan(70_000);
  await live.admin(`output=(()=>{const p=get_player('${merchant}');for(let i=0,n=0;i<39&&n<6;i++)if(p.items[i]?.name==='helmet'&&p.items[i].l){p.items[i]=null;n++}cache_player_items(p);resend(p,'reopen+cid');return true})()`);
  await expect.poll(async()=>{
    const s=await live.state();
    return !s.withdrawals[merchant]?.length && s.characters[merchant].items.some((e:any)=>e?.item?.name==='leather'&&e.item.q===13) && dispatches(s).length===1;
  },{timeout:90_000}).toBe(true);
  await info.attach('withdrawal-reserve-recovery',{body:JSON.stringify({blocked,after:await live.state()}),contentType:'application/json'});
});

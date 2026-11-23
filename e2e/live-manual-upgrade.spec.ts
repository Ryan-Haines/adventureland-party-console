import {test,expect} from './live-fixtures';

test('displaced identical manual upgrades share available copies and allow unrelated gear to finish',async({live},info)=>{
  // Failure inventory: multiple unfinished duplicates block the whole batch;
  // completed copies satisfy unrelated requests; one copy receives two marks;
  // locked/stat variants are substituted; restart resets targets or replays rolls.
  test.setTimeout(240_000);const merchant='E2EMerchant';
  await live.post('/merchant/force-stand',{enabled:true});
  await live.admin(`output=(()=>{const p=get_player('${merchant}');
    for(const slot of [7,8,9])p.items[slot]={name:'wcap',level:0};
    for(const slot of [10,11,12])p.items[slot]=null;
    p.items[13]={name:'wcap',level:0,l:'l'};p.items[14]={name:'wcap',level:0,stat_type:'int'};
    p.items[15]={name:'wcap',level:1};p.items[16]={name:'coat',level:0};p.items[20]={name:'scroll0',q:100};
    cache_player_items(p);resend(p,'reopen+cid');return true})()`);
  await expect.poll(async()=>(await live.clients[merchant].snapshot()).items[7]?.name).toBe('wcap');
  for(const slot of [7,8,9])await live.post('/command',{character:merchant,type:'upgrade-mark',slot,item:{name:'wcap',level:0},tiers:1});
  await live.post('/command',{character:merchant,type:'upgrade-mark',slot:16,item:{name:'coat',level:0},tiers:1});
  await live.clients[merchant].run('(async()=>{await swap(7,10);await swap(8,11);await swap(9,12);return true})()');
  await expect.poll(async()=>(await live.clients[merchant].snapshot()).items[12]?.name).toBe('wcap');
  await live.restartCoordinator();
  const before=await live.state();expect(before.upgrades[merchant]).toHaveLength(4);
  await live.post('/merchant/force-stand',{enabled:false});
  try{
    await expect.poll(async()=>{
      const s=await live.state();return !(s.upgrades[merchant]||[]).length && !s.merchantCurrent &&
        !s.merchantQueue.some((j:any)=>j.reason==='manual upgrades') &&
        !s.characters[merchant].items.some((e:any)=>e?.item?.name==='coat'&&e.item.level===0);
    },{timeout:180_000}).toBe(true);
    const items=(await live.clients[merchant].snapshot()).items,events=await live.clients[merchant].events();
    expect(events.filter((e:any)=>e.event==='game_response'&&['upgrade_success','upgrade_fail'].includes(e.data?.response))).toHaveLength(4);
    expect(items.filter((i:any)=>i?.name==='scroll0').reduce((n:number,i:any)=>n+i.q,0)).toBe(96);
    expect(items.filter((i:any)=>i?.name==='wcap'&&i.l)).toEqual([{name:'wcap',level:0,l:'l'}]);
    expect(items.filter((i:any)=>i?.name==='wcap'&&i.stat_type)).toEqual([{name:'wcap',level:0,stat_type:'int'}]);
    expect(items.filter((i:any)=>i?.name==='wcap'&&!i.l&&!i.stat_type&&i.level===0)).toHaveLength(0);
    expect(items.filter((i:any)=>i?.name==='wcap'&&i.level===1).length).toBeGreaterThanOrEqual(1);
    expect((await live.state()).merchantActivity.filter((e:any)=>/recovery ambiguous|recovery paused/.test(JSON.stringify(e)))).toHaveLength(0);
    await live.restartCoordinator();
    expect((await live.state()).upgrades[merchant]||[]).toHaveLength(0);
  }finally{
    await info.attach('interchangeable-manual-upgrade-ledger',{body:JSON.stringify({before,after:await live.state(),items:(await live.clients[merchant].snapshot()).items,events:await live.clients[merchant].events()}),contentType:'application/json'});
  }
});

test('interrupted automatic broom resumes from +2 until +7 or native destruction',async({live},info)=>{
  // Failure modes: lost relocation, reset target (+9), replay after restart,
  // completed stock claimed as the survivor, or queue/telemetry preceding native completion.
  test.setTimeout(300_000);const merchant='E2EMerchant';
  await live.post('/merchant/force-stand',{enabled:true});
  await live.admin(`output=(()=>{const p=get_player('${merchant}');p.items[7]=null;p.items[10]={name:'broom',level:2};p.items[11]={name:'broom',level:7};p.items[20]={name:'scroll0',q:100};p.items[21]={name:'scroll1',q:100};p.items[22]={name:'scroll2',q:100};cache_player_items(p);resend(p,'reopen+cid');return true})()`);
  await expect.poll(async()=>(await live.clients[merchant].snapshot()).items[10]?.level).toBe(2);
  await live.restoreHistoricalSettings(()=>({autoUpgradeMarks:{[merchant]:{'broom@+0':{tiers:7,quantity:-1}}},upgrades:{[merchant]:[{slot:7,liveSlot:7,item:{name:'broom',level:0},liveItem:{name:'broom',level:2},tiers:7,auto:true,passId:'historical-native-broom'}]}}));
  const before=await live.state();
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto upgrade':true}});
  await live.post('/merchant/force-stand',{enabled:false});
  await expect.poll(async()=>{
    const state=await live.state(),items=(await live.clients[merchant].snapshot()).items;
    const brooms=items.filter((item:any)=>item?.name==='broom');
    return !(state.upgrades[merchant]||[]).length && !state.merchantCurrent && !state.merchantQueue.some((job:any)=>job.reason==='auto upgrade') &&
      brooms.length>=1 && brooms.length<=2 && brooms.every((item:any)=>item.level===7) &&
      (state.characters[merchant]?.items||[]).filter((entry:any)=>entry?.item?.name==='broom').length===brooms.length;
  },{timeout:210_000}).toBe(true);
  const events=await live.clients[merchant].events();
  expect(events.some((event:any)=>event.event==='game_response'&&['upgrade_success','upgrade_fail'].includes(event.data?.response))).toBe(true);
  const completed=(await live.clients[merchant].snapshot()).items.filter((item:any)=>item?.name==='broom');
  await live.restartCoordinator();
  expect((await live.state()).upgrades[merchant]||[]).toHaveLength(0);
  expect((await live.clients[merchant].snapshot()).items.filter((item:any)=>item?.name==='broom')).toEqual(completed);
  await info.attach('native-interrupted-broom-terminal-outcome',{body:JSON.stringify({before,completed,events,after:await live.state()}),contentType:'application/json'});
});

test('displaced manual upgrade recovers unfinished inventory among completed duplicates',async({live},info)=>{
 test.setTimeout(180_000);const merchant='E2EMerchant';
 await live.post('/merchant/force-stand',{enabled:true});
 await live.admin(`output=(()=>{const p=get_player('${merchant}');p.items[7]={name:'wcap',level:0};p.items[9]={name:'wcap',level:1};p.items[12]={name:'wcap',level:1};p.items[10]=null;cache_player_items(p);resend(p,'reopen+cid');return true})()`);
 await expect.poll(async()=>(await live.clients[merchant].snapshot()).items[7]?.name).toBe('wcap');
 await live.post('/command',{character:merchant,type:'upgrade-mark',slot:7,item:{name:'wcap',level:0},tiers:1});
 await live.clients[merchant].run(`(async()=>{await swap(7,10);return true})()`);
 await expect.poll(async()=>(await live.clients[merchant].snapshot()).items[10]?.name).toBe('wcap');
 const before=await live.state();expect(before.upgrades[merchant]).toHaveLength(1);
 await info.attach('displaced-manual-upgrade-before',{body:JSON.stringify({marks:before.upgrades[merchant],items:(await live.clients[merchant].snapshot()).items}),contentType:'application/json'});
 await live.post('/merchant/force-stand',{enabled:false});
 await expect.poll(async()=>(await live.state()).upgrades[merchant]?.length||0,{timeout:120_000}).toBe(0);
 const after=await live.state(),events=await live.clients[merchant].events(),items=(await live.clients[merchant].snapshot()).items;
 expect(events.some((e:any)=>e.event==='game_response'&&['upgrade_success','upgrade_fail'].includes(e.data?.response))).toBe(true);
 expect(items.filter((item:any)=>item?.name==='wcap'&&item.level===1).length).toBeGreaterThanOrEqual(2);
 expect(after.merchantActivity.filter((e:any)=>JSON.stringify(e).includes('survivor is ambiguous'))).toHaveLength(0);
 await info.attach('displaced-manual-upgrade-recovered',{body:JSON.stringify({after,events,items}),contentType:'application/json'});
});

test('withdrawn manual shield and inventory shield finish one mixed upgrade batch',async({live},info)=>{
  test.setTimeout(240_000);
  const merchant='E2EMerchant';
  await live.post('/merchant/force-stand',{enabled:true});
  await live.admin(`output=(async()=>{const p=get_player('${merchant}');p.items[9]={name:'sshield',level:0};cache_player_items(p);resend(p,'reopen+cid');await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0.0':{name:'sshield',level:0}}});return true})()`);
  await expect.poll(async()=>(await live.clients[merchant].snapshot()).items[9]?.name).toBe('sshield');
  await live.post('/command',{character:merchant,type:'bank'});
  await live.post('/merchant/force-stand',{enabled:false});
  await expect.poll(async()=>(await live.state()).bank?.packs?.items0?.some((entry:any)=>entry?.item?.name==='sshield'),{timeout:90_000}).toBe(true);
  await expect.poll(async()=>(await live.state()).merchantCurrent,{timeout:90_000}).toBeNull();
  await live.post('/merchant/force-stand',{enabled:true});
  const bank=(await live.state()).bank.packs.items0.find((entry:any)=>entry?.item?.name==='sshield');
  const withdrawal=await live.post('/command',{character:merchant,type:'withdraw',pack:'items0',slot:bank.slot,item:bank.item,upgradeTiers:4});
  await live.post('/command',{character:merchant,type:'upgrade-mark',slot:9,item:{name:'sshield',level:0},tiers:4});
  const before=await live.state();
  await info.attach('withdrawn-upgrade-intents',{body:JSON.stringify({withdrawal,before}),contentType:'application/json'});
  expect(before.upgrades[merchant]).toHaveLength(2);
  expect(new Set(before.upgrades[merchant].map((mark:any)=>mark.requestId)).size).toBe(2);
  expect(before.upgrades[merchant].every((mark:any)=>typeof mark.requestId==='string'&&mark.tiers===4&&!mark.auto)).toBe(true);
  await live.post('/merchant/force-stand',{enabled:false});
  await expect.poll(async()=>{
    const state=await live.state();
    const errors=state.merchantActivity.filter((entry:any)=>JSON.stringify(entry).includes('Manual upgrade continuation changed'));
    expect(errors).toHaveLength(0);
    return state.upgrades[merchant]?.length||0;
  },{timeout:150_000}).toBe(0);
  const after=await live.state(),events=await live.clients[merchant].events();
  expect(events.filter((event:any)=>event.event==='game_response'&&['upgrade_success','upgrade_fail'].includes(event.data?.response)).length).toBeGreaterThanOrEqual(2);
  await live.restartCoordinator();
  expect((await live.state()).upgrades[merchant]||[]).toHaveLength(0);
  await info.attach('native-manual-upgrade-results',{body:JSON.stringify({after,events,restarted:await live.state()}),contentType:'application/json'});
});

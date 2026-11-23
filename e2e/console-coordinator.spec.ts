import { test, expect } from './fixtures';

test.describe('reserved bank compound recovery',()=>{
  test.use({merchantManaged:true,savedRecords:[{party_dashboard_settings_state_v1:{
    merchantQueue:[{id:'historical-compound',target:'M',reason:'manual compounds',queuedAt:1,priority:101}],
    compounds:{M:[{id:'group-1',name:'Group 1',items:[0,1,2].map(slot=>({slot,item:{name:'talkingskull',level:3},storage:{pack:'items1',slot:35+slot},storageReceived:true}))}]},
  }}]});
  test('missing reserved compound inputs pause instead of immediately dispatching again',async({app},info)=>{
    // Declared historical marks and worker failure reproduce stale withdrawal
    // receipts. The real coordinator must retain intent and reject re-admission
    // across fresh heartbeat pulses; no native compound outcome is fabricated.
    const initial=await app.state();
    const configured=await fetch(app.url+'/party-api/merchant/routine-priorities',{method:'POST',headers:{'Content-Type':'application/json',Origin:app.url},body:JSON.stringify({priorities:{},enabled:Object.fromEntries(Object.keys(initial.merchantAutomations).filter(name=>name!=='manual compounds').map(name=>[name,false]))})});
    expect(configured.ok).toBe(true);
    if(initial.merchantCurrent && initial.merchantCurrent.reason!=='manual compounds')
      await app.deliverMerchantCompletion({jobId:initial.merchantCurrent.id,commandId:initial.merchantCurrent.commandId,success:true});
    await expect.poll(async()=>(await app.state()).merchantCurrent?.reason).toBe('manual compounds');
    const before=await app.state(),job=before.merchantCurrent;
    const error='Reserved bank compound input moved before production';
    await app.deliverMerchantCompletion({jobId:job.id,commandId:job.commandId,success:false,error});
    const samples:any[]=[];
    await expect.poll(async()=>{
      const s=await app.state();samples.push({at:Date.now(),current:s.merchantCurrent,queue:s.merchantQueue,activity:s.merchantActivity});
      return s.merchantActivity.some((entry:any)=>entry.message==='Compound recovery paused; waiting for matching inventory or compound intent to change');
    }).toBe(true);
    const seenAt=(await app.state()).characters.M.seenAt;
    await expect.poll(async()=>{
      const s=await app.state();
      expect(s.merchantCurrent?.reason).not.toBe('manual compounds');
      expect(s.merchantQueue.filter((j:any)=>j.reason==='manual compounds')).toHaveLength(0);
      expect(s.compounds.M).toEqual(before.compounds.M);
      return s.characters.M.seenAt>=seenAt+3000;
    }).toBe(true);
    await info.attach('reserved-compound-recovery-ledger',{body:JSON.stringify({before,samples,after:await app.state()}),contentType:'application/json'});
  });
});

// Coordinator hot paths through the real coordinator (docs/efficiency.md, Coordinator).

test.describe('Hunt event realm ownership',()=>{
  test.use({savedRecords:[{party_dashboard_settings_state_v1:{leader:'W',eventSelectionsByCharacter:{W:['crabxx'],M:['crabxx']}}}]});
test('Crab event hints stay on their observed realm across coordinator restart',async({app},info)=>{
  // Failure inventory: another realm's live Crab revives an ended local event;
  // same-realm hints must survive, including after restart.
  const base=(await app.state()).characters.W;
  const reports:any[]=[];
  const status=async(name:string,server:string|undefined,events:string[])=>{
    const report={...base,name,ctype:name==='M'?'merchant':'warrior',server,
      activeEvent:null,joinedEvent:null,serverLiveEvents:events.map(name=>({name})),
      runtimeId:base.runtimeId,clientInstance:base.clientInstance};
    for(const key of ['seenAt','inventorySeenAt','statusSequence'])delete report[key];
    const response:any=await app.deliverStatus(report);reports.push({report,response});return response;
  };
  for(const restart of [false,true]){
    if(restart)await app.restartCoordinator();
    await status('M','USI',['crabxx']);
    const foreign=await status('W','USII',[]);
    expect(foreign.partyEventHint,'A live Crab on US I must not revive an ended US II event').toBeNull();
    await status('M','USII',['crabxx']);
    const local=await status('W','USII',[]);
    expect(local.partyEventHint,'Fresh same-realm hints still support event admission').toBe('crabxx');
    await status('M','USII',[]);
    expect((await status('W','USII',[])).partyEventHint).toBeNull();
  }
  await info.attach('crab-realm-hint-restart-evidence',{body:JSON.stringify(reports),contentType:'application/json'});
});
});

test.describe('interrupted automatic upgrade relocation',()=>{
  // Failure modes: stale liveSlot masks candidate slots; a completed duplicate
  // steals the pass; reconciliation deletes intent; restart loses relocation.
  test.use({merchantConnected:false,savedRecords:[{party_dashboard_settings_state_v1:{merchantCharacter:'M',autoUpgradeMarks:{M:{'broom@+0':{tiers:7,quantity:-1}}},upgrades:{M:[{slot:7,liveSlot:7,item:{name:'broom',level:0},liveItem:{name:'broom',level:2},tiers:7,auto:true,passId:'interrupted-broom'}]}}}]});
  test('relocated +2 broom keeps its original +7 target across coordinator restart',async({app},info)=>{
    const initial=await app.state(),base=initial.characters.W;
    const report={...base,name:'M',ctype:'merchant',runtimeId:'e2e-relocated-M',clientInstance:'e2e-relocated-M',statusSequence:1,slots:{},items:[{slot:10,item:{name:'broom',level:2}},{slot:11,item:{name:'broom',level:7}}]};
    for(const key of ['seenAt','inventorySeenAt']) delete report[key];
    await app.deliverStatus(report);
    await app.deliverStatus({...report,statusSequence:2});
    await expect.poll(async()=>(await app.state()).upgrades.M).toMatchObject([{passId:'interrupted-broom',slot:10,liveSlot:10,item:{name:'broom',level:0},tiers:7}]);
    const relocated=await app.state();
    await app.restartCoordinator();
    await app.deliverStatus({...report,statusSequence:3});
    await app.deliverStatus({...report,statusSequence:4});
    const restarted=await app.state();
    expect(restarted.upgrades.M).toMatchObject([{passId:'interrupted-broom',liveSlot:10,item:{name:'broom',level:0},tiers:7}]);
    const admitted=await fetch(app.url+'/party-api/merchant/production',{method:'POST',headers:{'Content-Type':'application/json',Origin:app.url},body:JSON.stringify({character:'M',id:'relocated-next-roll',kind:'upgrade',item:{name:'broom',level:2},automatic:{family:'upgrade',key:'broom@+0',mark:{...restarted.upgrades.M[0],slot:10,liveSlot:7}}})});
    expect(admitted.ok).toBe(true);
    expect((await app.state()).upgrades.M[0]).toMatchObject({liveSlot:10,liveItem:{name:'broom',level:2},tiers:7});
    await info.attach('interrupted-broom-relocation',{body:JSON.stringify({report,relocated,restarted}),contentType:'application/json'});
  });
  test('two displaced +2 survivors retain the unresolved +7 intent',async({app},info)=>{
    const base=(await app.state()).characters.W;
    const report={...base,name:'M',ctype:'merchant',runtimeId:'e2e-ambiguous-M',clientInstance:'e2e-ambiguous-M',statusSequence:1,slots:{},items:[10,11].map(slot=>({slot,item:{name:'broom',level:2}}))};
    for(const key of ['seenAt','inventorySeenAt']) delete report[key];
    await app.deliverStatus(report);
    await app.deliverStatus({...report,statusSequence:2});
    const state=await app.state();
    expect(state.upgrades.M).toMatchObject([{passId:'interrupted-broom',item:{name:'broom',level:0},tiers:7}]);
    await info.attach('ambiguous-broom-intent-retained',{body:JSON.stringify({report,state}),contentType:'application/json'});
  });
});

test('stand price history takes the level of the first listing at the lowest price', async ({ page, app }, info) => {
  const merchant = { ...(await app.state()).characters.M };
  for (const field of ['seenAt', 'inventorySeenAt']) delete merchant[field];
  const listing = (name: string, level: number, price: number, slot: number) =>
    ({ key: `e2e-stand-${slot}`, seller: 'Seller' + slot, item: { name, level }, price, quantity: 1, seenAt: Date.now(), slot: 'trade' + slot, map: 'main', x: 0, y: 0 });
  // Two helmets share the lowest price; a zero-priced coat supplies no price.
  await app.deliverStatus({ ...merchant, nearbyStandListings: [listing('helmet', 7, 900, 1), listing('helmet', 3, 500, 2),
    listing('helmet', 5, 500, 3), listing('coat', 2, 0, 4)] });
  const market = async () => (await (await page.request.get(`${app.url}/party-api/state?section=market&dashboard=1`)).json()).standPriceHistory;
  await expect.poll(async () => (await market())?.helmet?.lowest).toBe(500);
  const history = await market();
  await info.attach('stand-price-history', { body: JSON.stringify(history), contentType: 'application/json' });
  expect(history.helmet).toMatchObject({ lowest: 500, lowestLevel: 3, recent: 500, recentLevel: 3 });
  expect(history.coat).toBeUndefined();
});

import { test, expect } from './fixtures';

// Coordinator hot paths through the real coordinator (docs/efficiency.md, Coordinator).

test.describe('interrupted automatic upgrade relocation',()=>{
  // Failure modes: stale liveSlot masks candidate slots; a completed duplicate
  // steals the pass; reconciliation deletes intent; restart loses relocation.
  test.use({merchantConnected:false,savedRecords:[{party_dashboard_settings_state_v1:{merchantCharacter:'M',autoUpgradeMarks:{M:{'broom@+0':{tiers:7,quantity:-1}}},upgrades:{M:[{slot:7,liveSlot:7,item:{name:'broom',level:0},liveItem:{name:'broom',level:2},tiers:7,auto:true,passId:'interrupted-broom'}]}}}]});
  test('relocated +2 broom keeps its original +7 target across coordinator restart',async({app},info)=>{
    const initial=await app.state(),base=initial.characters.W;
    const report={...base,name:'M',ctype:'merchant',runtimeId:'e2e-relocated-M',clientInstance:'e2e-relocated-M',statusSequence:1,slots:{},items:[{slot:10,item:{name:'broom',level:2}},{slot:11,item:{name:'broom',level:7}}]};
    for(const key of ['seenAt','inventorySeenAt']) delete report[key];
    // Two displaced +2 survivors leave the +7 intent unresolved; the report with one +2 and the +7
    // then places it.
    const ambiguous={...report,items:[10,11].map(slot=>({slot,item:{name:'broom',level:2}}))};
    await app.deliverStatus(ambiguous);
    await app.deliverStatus({...ambiguous,statusSequence:2});
    const unresolved=await app.state();
    expect(unresolved.upgrades.M).toMatchObject([{passId:'interrupted-broom',item:{name:'broom',level:0},tiers:7}]);
    await app.deliverStatus({...report,statusSequence:3});
    await app.deliverStatus({...report,statusSequence:4});
    await expect.poll(async()=>(await app.state()).upgrades.M).toMatchObject([{passId:'interrupted-broom',slot:10,liveSlot:10,item:{name:'broom',level:0},tiers:7}]);
    const relocated=await app.state();
    await app.restartCoordinator();
    await app.deliverStatus({...report,statusSequence:5});
    await app.deliverStatus({...report,statusSequence:6});
    const restarted=await app.state();
    expect(restarted.upgrades.M).toMatchObject([{passId:'interrupted-broom',liveSlot:10,item:{name:'broom',level:0},tiers:7}]);
    const admitted=await fetch(app.url+'/party-api/merchant/production',{method:'POST',headers:{'Content-Type':'application/json',Origin:app.url},body:JSON.stringify({character:'M',id:'relocated-next-roll',kind:'upgrade',item:{name:'broom',level:2},automatic:{family:'upgrade',key:'broom@+0',mark:{...restarted.upgrades.M[0],slot:10,liveSlot:7}}})});
    expect(admitted.ok).toBe(true);
    expect((await app.state()).upgrades.M[0]).toMatchObject({liveSlot:10,liveItem:{name:'broom',level:2},tiers:7});
    await info.attach('interrupted-broom-relocation',{body:JSON.stringify({report,unresolved,relocated,restarted}),contentType:'application/json'});
  });
});


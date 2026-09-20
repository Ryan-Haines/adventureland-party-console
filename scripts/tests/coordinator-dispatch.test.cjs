const test=require('node:test');
const assert=require('node:assert/strict');
const {dispatchRuntime,sampleJob}=require('./helpers/coordinator-dispatch.cjs');
const contracts=require('./fixtures/merchant-command-contracts.json');
const wire=value=>JSON.parse(JSON.stringify(value));

test('all own and party merchant commands preserve the pre-extraction wire contracts',()=>{
  for(const fixture of contracts){
    const r=dispatchRuntime({merchantQueue:[sampleJob(fixture.reason,fixture.target)]});
    r.dispatchMerchant();
    const command=wire(r.party.commands.M);
    if(command.type==='merchant-service'){assert.equal(command.targetRealm,'USII');delete command.targetRealm;}
    const expected = structuredClone(fixture.command);
    const routine = fixture.reason === 'upgrades and compounds' ? 'manual upgrades' : fixture.reason === 'merchant commerce' ? 'manual buying' : fixture.reason;
    const allowed = {upgrades: routine === 'manual upgrades', compounds: routine === 'manual compounds', purchases: routine === 'manual buying', autoCompounds: routine === 'auto compound', statScrolls: routine === 'manual upgrades', preloadStatScrolls: routine === 'manual upgrades', npcSales: routine === 'npc sales'};
    for (const [key, enabled] of Object.entries(allowed)) if (!enabled && key in expected) expected[key] = [];
    if (routine === 'auto compound' && fixture.target === 'M') expected.processingRoutine = 'auto compound';
    if (fixture.target !== 'M' && fixture.reason === 'auto compound') {expected.autoCompounds=[];expected.collectionOnly=true;expected.expandMarkedCluster=true;}
    if (fixture.target !== 'M' && ['marked items','inventory cleanout'].includes(fixture.reason)) expected.collectionOnly=true;
    for (const rule of expected.autoCompounds || []) delete rule.existingTargetQuantity;
    assert.deepEqual(command,expected,fixture.target+': '+fixture.reason);
    assert.deepEqual(wire(r.effects.filter(effect => effect?.message !== "Discarded empty manual compound job")),fixture.effects.map(effect => fixture.target !== 'M' && fixture.reason === 'auto compound' && effect?.details?.reason === 'auto compound' ? {...effect,details:{...effect.details,reason:'marked items'}} : fixture.reason === "upgrades and compounds" && effect?.message === "Merchant dispatched for its own upgrades and compounds" ? {...effect,message:"Merchant dispatched for manual upgrades"} : effect?.details?.reason === "upgrades and compounds" ? {...effect,details:{...effect.details,reason:"manual upgrades"}} : effect),fixture.target+': '+fixture.reason);
  }
});

test('storage ownership blocks new jobs and stale targets are requeued without assigning work',async()=>{
  const r=dispatchRuntime({merchantQueue:[sampleJob('restock')]});
  r.bankboiService.busy=()=>true;r.dispatchMerchant();await Promise.resolve();
  assert.equal(r.party.merchantCurrent,null);assert.deepEqual(r.effects,['storage']);
  r.bankboiService.busy=()=>false;r.party.statuses.M.seenAt=1;r.dispatchMerchant();
  assert.equal(r.party.merchantQueue.length,1);assert.equal(r.party.merchantCurrent,null);
  assert.equal(r.party.commands.M,undefined);
});

test('gathering wins only at a strictly higher priority and waits for the home realm',()=>{
  const r=dispatchRuntime({merchantQueue:[sampleJob('restock')],gatheringModes:['fishing']});
  r.merchantRoutinePriority=()=>60;r.ensureMerchantHome=()=>false;r.dispatchMerchant();
  assert.equal(r.party.merchantQueue.length,1);assert.equal(r.party.commands.M,undefined);
  r.ensureMerchantHome=()=>true;r.dispatchMerchant();assert.equal(r.party.commands.M.type,'merchant-gather');
  r.merchantRoutinePriority=()=>50;r.dispatchMerchant();assert.equal(r.party.commands.M.type,'merchant-self-restock');
});

test('marketplace batching retains other sellers and tags each listing with its original bid',()=>{
  const selected=sampleJob('ALData marketplace purchases');selected.bidItemId='first';
  const queued=sampleJob('ALData marketplace purchases');queued.id='other';queued.bidItemId='second';
  queued.listings=[{...queued.listings[0],key:'second'}, {...queued.listings[0],key:'third',seller:'other-seller'}];
  const r=dispatchRuntime({merchantQueue:[selected,queued]});r.dispatchMerchant();
  assert.deepEqual(r.party.commands.M.listings.map(l=>[l.key,l.bidItemId]),[['listing','first'],['second','second']]);
  assert.deepEqual(r.party.merchantQueue[0].listings.map(l=>l.key),['third']);
});

test('new merchant commands carry only runnable NPC sale reservations',()=>{
  const r=dispatchRuntime({merchantQueue:[sampleJob('npc sales')],npcSaleMarks:[
    {id:'ready',retryAt:99999},{id:'future',retryAt:100001},{id:'blocked',state:'blocked'}]});
  r.dispatchMerchant();assert.deepEqual(r.party.commands.M.npcSales.map(mark=>mark.id),['ready']);
});

test('pending manual equipment commands retain ownership before storage or queued work',()=>{
  for(const type of ['equip','unequip']){
    const command={id:17,type};const r=dispatchRuntime({merchantQueue:[sampleJob('restock')],commands:{M:command}});
    r.bankboiService.busy=()=>true;r.dispatchMerchant();
    assert.equal(r.party.commands.M,command);assert.equal(r.party.merchantCurrent,null);assert.deepEqual(r.effects,[]);
  }
});
test('legacy and already-split empty manual compound jobs never dispatch a merchant visit',()=>{
 for(const reason of ['upgrades and compounds','manual compounds']) {
  const r=dispatchRuntime({merchantQueue:[sampleJob(reason,'F')],compounds:{F:[]}});
  r.dispatchMerchant();
  assert.ok(!r.party.merchantQueue.some(j=>j.reason==='manual compounds'));
  assert.notEqual(r.party.merchantCurrent?.reason,'manual compounds');
  assert.ok(r.effects.some(e=>e.message==='Discarded empty manual compound job'));
 }
});

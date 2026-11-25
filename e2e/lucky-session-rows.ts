import type {TestInfo} from '@playwright/test';
import {expect, reloadCode, type LiveGame} from './live-fixtures';
import {gateNativeAjaxInput} from './native-ajax-input';
import {catalog, economy, jobFinished, quantity, record, seed, type Economy} from './stand-session-rows';

// W53's one merchant under lucky slot faults (test-windows DESIGN.md 2.2 W53). The rounds run on
// one boot, each planting its own fault into the merchant's next order:
//  1. the priest sends seashells into the lucky slot while it is prepared and restored (A43);
//  2. the second restoration swap is lost and the local journals go missing across a restart (A46);
//  3. production journal writes echo an older attempt (A36);
//  4. lucky journal removals echo back and the merchant reconnects onto a stale journal (A42);
//  5. a completed upgrade's response is lost and the CODE reloads with no local journal (A32);
//  6. the lucky slot's cargo moves under the restoration and the CODE and coordinator restart, with
//     the slot open (A40) and then locked (A41).
// Between rounds the round's cargo leaves the bag and a fresh CODE drops the round's patched
// natives (DEVIATIONS.md "Live B" W53). The bodies are the old tests' (live-economy.spec.ts at
// 21fe30a2b).
const merchant = 'E2EMerchant';

export async function luckySessionPlay(live: LiveGame, info: TestInfo) {
  await partyDeliveryRound(live, info);
  await nextRound(live);
  await restorationFailureRound(live, info);
  await nextRound(live);
  await storageEchoRound(live, info);
  await nextRound(live);
  await delayedJournalEchoRound(live, info);
  await nextRound(live);
  await lostCompletionRound(live, info);
  await nextRound(live);
  await luckyRestorationRound(live, info, false);
  await nextRound(live);
  await luckyRestorationRound(live, info, true);
}

// The rounds count their helmets, shoes and seashells as the old tests did, from a bag that holds
// none, and seed() refuses an occupied cell. So the round's cargo leaves the bag, and a reloaded
// CODE drops the Storage and swap wrappers the round planted, which no global record holds.
async function nextRound(live: LiveGame) {
  await jobFinished(live);
  await live.admin(`output=(()=>{const p=get_player('${merchant}');
    p.items=p.items.map(i=>i&&['helmet','shoes','seashell','scroll0'].includes(i.name)?null:i);
    cache_player_items(p);resend(p,'reopen+cid');return true})()`);
  await expect.poll(async()=>(await live.clients[merchant].snapshot()).items.some((i:any)=>['helmet','shoes','seashell','scroll0'].includes(i?.name)),
    {message:"The round's cargo leaves the merchant's bag"}).toBe(false);
  const runtime=(await live.state()).characters[merchant].dashboardRuntime;
  await reloadCode(live,merchant);
  await expect.poll(async()=>{
    const current=(await live.state()).characters[merchant]?.dashboardRuntime;
    return !!current&&current!==runtime;
  },{timeout:60_000,message:'The next round starts on a fresh merchant CODE'}).toBe(true);
}

async function restartAndObserve(live: LiveGame) {
  const startedAt = Date.now();
  await live.restartCoordinator();
  await expect.poll(async () => (await live.state()).characters[merchant]?.seenAt,
    { timeout: 30_000, message: 'Replay assertions require a native heartbeat accepted after restart' }).toBeGreaterThan(startedAt);
  await jobFinished(live);
}

export async function lostCompletionRound(live: LiveGame, info: TestInfo) {
  await catalog(live,'helmet');
  const before=await economy(live),context=live.clients[merchant].page.context();
  let journal:any,receipt:any,relocation:any,progress:any,held=false,release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const faults:any[]=[];
  const checkpoints:any[]=[];
  await context.route('**/party-api/merchant/checkpoint',async route=>{
    const body=route.request().postDataJSON();
    if(body.state&&typeof body.state==='object'){progress=body.state;checkpoints.push(body.state);}
    await route.continue();
  });
  await context.route('**/party-api/merchant/production',async route=>{
    const body=route.request().postDataJSON();
    if(body.action==='checkpoint'&&body.journal?.phase==='complete'&&body.journal.success===true&&body.journal.commerce)journal=body.journal;
    const response=await route.fetch();
    if(body.action==='complete'&&journal?.id===body.id&&!held){
      receipt=await response.json();faults.push({at:Date.now(),action:'held-real-completed-receipt',id:body.id});
      held=true; // Publish only after the authoritative receipt has been parsed.
      await gate;
      await route.abort('failed').catch(()=>{});return;
    }
    await route.fulfill({response});
  });
  try{
    const order=await live.post('/merchant/order',{buys:[{id:'helmet',quantity:1,level:1}],crafts:[]});
    await expect.poll(()=>held,{timeout:120_000}).toBe(true);
    expect(receipt.attempt.completed).toBe(true);expect(receipt.attempt.success).toBe(true);
    // The survivor stays at the cell its receipt names: a commerce order reads each owned copy at
    // its recorded cell (production.ts `settleUpgrade`), so a moved survivor holds for review.
    relocation=null;
    // Declared persistence fault: the completion response was lost and the
    // replacement CODE has no local production journal. Paid commerce state
    // remains intact; only authoritative receipt evidence can restore it.
    await live.clients[merchant].run(`localStorage.removeItem('party-production:'+character.name)`);
    faults.push({at:Date.now(),action:'lost-local-production-journal-before-code-replacement'});
    const oldRuntime=(await live.state()).characters[merchant].dashboardRuntime;
    const replacedAt=Date.now();
    await reloadCode(live,merchant);
    faults.push({at:replacedAt,action:'abrupt-native-code-replacement',oldRuntime});
    release();
    await expect.poll(async()=>{const c=(await live.state()).characters[merchant];return c?.dashboardRuntime&&c.dashboardRuntime!==oldRuntime&&c.seenAt>=replacedAt;},{timeout:60_000}).toBeTruthy();
    expect((await live.clients[merchant].snapshot()).connected).toBe(true);
    await expect.poll(async()=>{const s=await live.state();return ![s.merchantCurrent,...s.merchantQueue].some((j:any)=>j?.commerceOrderId===order.jobId);},{timeout:120_000}).toBe(true);
    const after=await economy(live);
    const count=(v:Economy)=>v.characters[merchant].items.filter(i=>i?.name==='helmet'&&i.level===1).length;
    expect(count(after)-count(before)).toBe(1);
    expect(Math.max(...checkpoints.map(state=>Number(state.spent)||0))).toBe(journal.commerce.state.spent);
    expect(Math.max(...checkpoints.map(state=>Number(state.attempts)||0))).toBe(journal.commerce.state.attempts);
    expect(progress.pendingUpgrade).toBeUndefined();
    await record(live,info,'completed-commerce-receipt-recovery',before,{order,journal,receipt,relocation,faults,checkpoints,progress,after});
  }finally{
    release();await context.unrouteAll({behavior:'ignoreErrors'});
    await info.attach('completed-commerce-receipt-faults',{body:JSON.stringify({journal,receipt,relocation,faults,final:await live.state()}),contentType:'application/json'});
  }
}

export async function storageEchoRound(live: LiveGame, info: TestInfo) {
  await live.restoreHistoricalSettings(()=>({luckyUpgradeSlots:{[merchant]:30}}));
  await catalog(live,'helmet');
  const before=await economy(live);
  await live.post('/merchant/force-stand',{enabled:true});
  const cycleCost=await live.clients[merchant].run('Number(G.items.helmet.g)+3*Number(G.items.scroll0.g)');
  expect(cycleCost).toBeGreaterThan(0);
  await live.clients[merchant].run(`(()=>{
    const key='party-production:'+character.name,set=Storage.prototype.setItem;
    let older=null;globalThis.__e2eProductionEchoes=0;
    Storage.prototype.setItem=function(k,value){
      set.call(this,k,value);
      if(k!==key)return;
      const current=JSON.parse(value);
      if(!older&&current.phase==='complete')older=JSON.stringify({...current,phase:'running'});
      else if(older&&current.id!==JSON.parse(older).id){
        set.call(this,k,older);globalThis.__e2eProductionEchoes++;
      }
    };return true;
  })()`);
  const order=await live.post('/merchant/order',{buys:[{id:'helmet',quantity:2,level:3}],crafts:[]});
  let initialAllowance:any;
  await live.restoreHistoricalSettings(settings=>{
    if(settings.merchantCurrent?.id===order.jobId)throw Error('Storage echo allowance must precede native order admission');
    const queued=settings.merchantQueue.find((job:any)=>job.id===order.jobId);
    if(!queued||queued.resumeState||queued.order?.buys?.length!==1)throw Error('Exact initial storage echo order unavailable');
    const line=queued.order.buys[0];
    if(line.id!=='helmet'||line.quantity!==2||line.level!==3)throw Error('Storage echo initial order identity changed');
    initialAllowance={jobId:queued.id,original:{...line},declaredCycles:10,cycleCost,budget:cycleCost*10};
    return {merchantQueue:settings.merchantQueue.map((job:any)=>job.id===order.jobId?{...job,order:{...job.order,buys:[{...line,attempts:10,budget:cycleCost*10}]}}:job)};
  });
  await info.attach('declared-storage-echo-initial-order-allowance',{body:JSON.stringify(initialAllowance),contentType:'application/json'});
  await live.post('/merchant/force-stand',{enabled:false});
  await expect.poll(async()=>{
    const state=await live.state();
    return ![state.merchantCurrent,...state.merchantQueue].some((job:any)=>job?.id===order.jobId||job?.commerceOrderId===order.jobId);
  },{timeout:300_000}).toBe(true);
  expect(await live.clients[merchant].run('globalThis.__e2eProductionEchoes')).toBeGreaterThan(0);
  const after=await economy(live);
  const results=(value:Economy)=>value.characters[merchant].items.filter(item=>item?.name==='helmet'&&item.level===3).length;
  expect(results(after)-results(before)).toBe(2);
  const nativeSuccesses=(await live.clients[merchant].events()).filter(event=>event.event==='game_response'&&event.data?.response==='upgrade_success');
  expect(nativeSuccesses.filter(event=>[1,2,3].includes(Number(event.data.level))).length).toBeGreaterThanOrEqual(6);
  const pending=await live.post('/merchant/production',{character:merchant,action:'pending'});
  expect(pending.pending).toEqual([]);
  await restartAndObserve(live);
  expect(results(await economy(live))).toBe(results(after));
  await record(live,info,'production-storage-echo-ownership',before,{order,after,pending,echoes:await live.clients[merchant].run('globalThis.__e2eProductionEchoes')});
}

export async function luckyRestorationRound(live: LiveGame, info: TestInfo, locked: boolean) {
  const slot=5,movedSlot=27,checkpoints:any[]=[];
  let changed=false;
  await live.clients[merchant].frame.evaluate(()=>{
    const game=window as any;
    game.__e2eLuckyRollPackets=[];
    game.__e2eLuckyRollObserver=(data:unknown)=>{
      game.__e2eLuckyRollPackets.push({at:Date.now(),data:JSON.parse(JSON.stringify(data))});
      if(game.__e2eLuckyRollPackets.length>256)game.__e2eLuckyRollPackets.shift();
    };
    game.socket.on('q_data',game.__e2eLuckyRollObserver);
  });
  const rolls=(state:any,index:number)=>Object.values(state.luckySlotTracking?.[merchant]||{}).reduce((total:number,stream:any)=>total+Number(stream.slots?.[index]?.totalRolls||0),0);
  const finish=async(jobId:string)=>expect.poll(async()=>{
    const state=await live.state();
    return ![state.merchantCurrent,...state.merchantQueue].some((job:any)=>job?.id===jobId||job?.commerceOrderId===jobId);
  },{timeout:150_000,message:'Changed lucky layout must not fence completed or unrelated merchant work'}).toBe(true);
  try {
    await live.restoreHistoricalSettings(()=>({luckyUpgradeSlots:{},luckySlotResume:{[merchant]:{slot,rolls:0}},luckySlotLocks:locked?{[merchant]:slot}:{}}));
    await catalog(live,'helmet');
    // The idle tidy keeps the lucky slot empty (production.ts `tidyReply`), and a merchant with no
    // stand now idles with no command (the stand-less return and departure fixes), so cargo seeded
    // into the lucky slot moved out before the order. The seashell sits in the first cell past the
    // potions, which the tidy leaves, and the preparation checkpoint below moves it into the lucky
    // slot while the job holds the bag. The game puts a purchase in the first empty cell, and the
    // tidy packs the bag into the cells before the lucky slot (production.ts lucky `tidy`), so with
    // the lucky slot at 4 a bought scroll took cell 3 and the helmet the empty lucky slot, where the
    // upgrade ran in place with no preparation and no restoration. Both rows own their scroll in
    // cell 3, where the tidy packs it, and use lucky slot 5, so the helmet lands in cell 4 and the
    // job prepares the lucky slot.
    await seed(live,{2:{name:'seashell',q:3},3:{name:'scroll0',q:1}});
    const rollSetup=await live.admin(`output=(()=>{
      const p=get_player('${merchant}'),skills=['massproduction','massproductionpp'].map(name=>({name,level:Number(G.skills[name].level)}));
      const requirement=Math.min(...skills.map(skill=>skill.level));
      if(!Number.isFinite(requirement)||requirement<=1)throw Error('Native mass-production level requirements unavailable');
      if(p.s.massproduction||p.s.massproductionpp)throw Error('Roll fixture unexpectedly has an active native mass buff');
      p.level=requirement-1;resend(p,'reopen+cid');return {level:p.level,skills};
    })()`);
    await expect.poll(async()=>live.clients[merchant].run('character.level')).toBe(rollSetup.level);
    checkpoints.push({rollSetup});
    await live.admin(`output=(()=>{const p=get_player('E2EPriest');if(p.items[10])throw Error('Fixture slot occupied');p.items[10]={name:'seashell',q:1};cache_player_items(p);resend(p,'reopen+cid');return true})()`);
    await expect.poll(async()=>(await live.clients.E2EPriest.snapshot()).items[10]?.q).toBe(1);
    await live.clients[merchant].run(`(()=>{const native=swap;globalThis.__e2eChangedLuckyLayout=false;globalThis.__e2eForbiddenRestoreSwaps=[];
      swap=function(a,b){const journal=JSON.parse(localStorage.getItem('party-lucky-upgrade:'+character.name)||'null');
        if(globalThis.__e2eChangedLuckyLayout&&journal?.phase==='restoring'&&
          (a===journal.from&&b===journal.to||a===journal.to&&b===journal.from))
          globalThis.__e2eForbiddenRestoreSwaps.push({a,b,journal,items:character.items.map(i=>i&&({...i}))});
        return native(a,b)};return true})()`);
    const before=await economy(live),initial=await live.state();
    await live.clients[merchant].run(`(()=>{
      const generation=globalThis.__partyRuntimeGeneration;
      const owns=()=>globalThis.__partyRuntimeGeneration===generation&&parent.document.getElementById('maincode')?.contentWindow===globalThis;
      const waitFor=async(check,description)=>{const deadline=Date.now()+30000;while(!check()){
        if(!owns())throw Error('Native lucky input CODE ownership changed');
        if(Date.now()>=deadline)throw Error('Native lucky input timed out: '+description);
        await new Promise(resolve=>setTimeout(resolve,100));
      }};
      globalThis.__e2eLuckyInput=null;globalThis.__e2eLuckyInputError=null;
      globalThis.__e2ePrepareCheckpointAjax=(${gateNativeAjaxInput.toString()})(globalThis,options=>{
        if(!String(options?.url).endsWith('/merchant/production'))return false;
        const body=typeof options.data==='string'?JSON.parse(options.data):null;
        return body?.character===character.name&&body.action==='checkpoint'&&body.journal?.lucky?.phase==='preparing'&&body.journal.lucky.to===${slot};
      },async()=>{
        try{
          const from=character.items.findIndex(item=>item?.name==='seashell');
          if(from<0||character.items[${slot}])throw Error('Native lucky cargo unavailable for the lucky slot');
          await swap(from,${slot});
          await waitFor(()=>character.items[${slot}]?.name==='seashell','native lucky cargo swap');
        }catch(error){globalThis.__e2eLuckyInputError=String(error);throw error;}
      },owns);
      globalThis.__e2eRestoreCheckpointAjax=(${gateNativeAjaxInput.toString()})(globalThis,options=>{
        if(!String(options?.url).endsWith('/merchant/production'))return false;
        const body=typeof options.data==='string'?JSON.parse(options.data):null,journal=body?.journal?.lucky;
        const matches=body?.character===character.name&&body.action==='checkpoint'&&typeof body.id==='string'&&body.id===body.journal.id&&journal?.phase==='restoring';
        if(matches)globalThis.__e2eLuckyInputCheckpoint=body;return matches;
      },async()=>{
        try{
          const body=globalThis.__e2eLuckyInputCheckpoint,journal=body.journal.lucky;
          const local=JSON.parse(localStorage.getItem('party-lucky-upgrade:'+character.name)||'null');
          if(local?.from!==journal.from||local.to!==journal.to||local.phase!==journal.phase)throw Error('Native lucky checkpoint ownership mismatch');
          if(journal?.to!==${slot}||journal.phase!=='restoring')throw Error('Actual restoring lucky checkpoint changed');
          const original={items:character.items.map(item=>item&&({...item}))};
          if(original.items[${slot}]?.name!=='helmet'||original.items[${slot}]?.level!==1||original.items[journal.from]?.name!=='seashell')throw Error('Native lucky checkpoint input inventory mismatch');
          const priestGame=parent.parent.document.getElementById('ichare2epriest')?.contentWindow;
          const priest=priestGame?.document.getElementById('maincode')?.contentWindow;
          if(priest?.character?.name!=='E2EPriest'||typeof priest.send_item!=='function')throw Error('Missing actual Priest CODE for native lucky input');
          await priest.send_item(character.name,10,1);
          await waitFor(()=>character.items[journal.from]?.q===4,'native delivery merge');
          if(character.items[${movedSlot}])throw Error('Native lucky input destination occupied');
          await swap(${slot},${movedSlot});
          await waitFor(()=>character.items[${movedSlot}]?.name==='helmet'&&character.items[${movedSlot}]?.level===1,'native cargo swap');
          globalThis.__e2eChangedLuckyLayout=true;
          globalThis.__e2eLuckyInput={journal,original,changed:{items:character.items.map(item=>item&&({...item}))}};
        }catch(error){globalThis.__e2eLuckyInputError=String(error);throw error;}
      },owns);return true;
    })()`);
    const first=await live.post('/merchant/order',{buys:[{id:'helmet',quantity:1,level:1}],crafts:[]});
    await expect.poll(async()=>{
      const input=await live.clients[merchant].run('({result:globalThis.__e2eLuckyInput,error:globalThis.__e2eLuckyInputError})');
      if(input.error)throw Error(input.error);
      if(input.result){changed=true;checkpoints.push(input.result);return true;}return false;
    },{timeout:150_000}).toBe(true);
    await finish(first.jobId);
    await live.clients[merchant].run('globalThis.__e2eRestoreCheckpointAjax();globalThis.__e2ePrepareCheckpointAjax()');
    const after=await economy(live);
    expect(quantity(after.characters[merchant].items,'seashell')-quantity(before.characters[merchant].items,'seashell')).toBe(1);
    expect(after.characters[merchant].items.filter(item=>item?.name==='helmet'&&item.level===1)).toHaveLength(1);
    await expect.poll(async()=>rolls(await live.state(),slot)-rolls(initial,slot)).toBe(1);
    expect(await live.clients[merchant].run(`localStorage.getItem('party-lucky-upgrade:'+character.name)`)).toBeNull();
    const restorationSwaps=await live.clients[merchant].run('globalThis.__e2eForbiddenRestoreSwaps');
    expect(restorationSwaps).toEqual([]);
    checkpoints.push({restorationSwaps,retiredInventory:await live.clients[merchant].snapshot()});
    const runtime=(await live.state()).characters[merchant].dashboardRuntime;
    await reloadCode(live,merchant);
    // Creating an iframe does not mean its loader has finished fetching from
    // the coordinator that the next operation deliberately stops.
    await expect.poll(async()=>{
      const current=(await live.state()).characters[merchant]?.dashboardRuntime;
      return !!current&&current!==runtime;
    },{timeout:60_000,message:'Replacement native CODE must publish before its host restarts'}).toBe(true);
    await live.restartCoordinator();
    await expect.poll(async()=>{
      const current=(await live.state()).characters[merchant]?.dashboardRuntime;
      return !!current&&current!==runtime;
    },{timeout:60_000}).toBe(true);
    await catalog(live,'shoes');
    const shoesBefore=quantity((await economy(live)).characters[merchant].items,'shoes');
    const purchase=await live.post('/merchant/order',{buys:[{id:'shoes',quantity:1,level:0}],crafts:[]});
    await finish(purchase.jobId);
    expect(quantity((await economy(live)).characters[merchant].items,'shoes')-shoesBefore).toBe(1);
    await catalog(live,'helmet');
    const second=await live.post('/merchant/order',{buys:[{id:'helmet',quantity:1,level:1}],crafts:[]});
    await finish(second.jobId);
    // Queue completion and lucky-roll status publication are separate requests.
    // Require both exact counts in one fresh snapshot, including the locked case.
    const rollPublication:any[]=[];
    try{
      await expect.poll(async()=>{
        const state=await live.state();
        const counts=[rolls(state,slot)-rolls(initial,slot),rolls(state,slot+1)-rolls(initial,slot+1)];
        rollPublication.push({at:Date.now(),counts});
        if(rollPublication.length>32)rollPublication.splice(1,1);
        return counts;
      },{timeout:15_000,message:'Completed native upgrades must publish exact lucky-slot roll totals'}).toEqual(locked?[2,0]:[1,1]);
    }finally{checkpoints.push({rollPublication});}
    const final=await live.state(),inventory=await economy(live);
    expect(rolls(final,slot)-rolls(initial,slot)).toBe(locked?2:1);
    expect(rolls(final,slot+1)-rolls(initial,slot+1)).toBe(locked?0:1);
    if(locked) expect(final.luckySlotLocks[merchant]).toBe(slot);
    expect(inventory.characters[merchant].items.filter(item=>item?.name==='helmet'&&item.level===1)).toHaveLength(2);
    expect(quantity(inventory.characters[merchant].items,'seashell')).toBe(4);
  } finally {
    const cleanup=await live.clients[merchant].frame.evaluate(()=>{const runner=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;runner?.__e2eRestoreCheckpointAjax?.();return {restored:true};})
      .catch(error=>({captureError:String(error)}));
    await info.attach('lucky-best-effort-native-evidence',{body:JSON.stringify({locked,changed,checkpoints,cleanup,
      tracking:await live.clients[merchant].frame.evaluate(()=>{
        const game=window as any,stored:Record<string,unknown>={};
        for(let i=0;i<localStorage.length;i++){
          const key=localStorage.key(i)!;
          if(key.startsWith('party-lucky-slot-tracking:'))stored[key]=JSON.parse(localStorage.getItem(key)||'null');
        }
        game.socket.off('q_data',game.__e2eLuckyRollObserver);
        return {packets:game.__e2eLuckyRollPackets,stored};
      }).catch(error=>({captureError:String(error)})),
      state:await live.state().catch(error=>({captureError:String(error)})),
      inventory:await economy(live).catch(error=>({captureError:String(error)})),
      events:await live.clients[merchant].events().catch(error=>({captureError:String(error)}))}),contentType:'application/json'});
  }
}

export async function delayedJournalEchoRound(live: LiveGame, info: TestInfo) {
  // Failure modes: IPC echoes resurrect a cleared lucky journal, move the next
  // owned item during recovery, and strand the durable order in receipt review.
  // Reconnect can also reject a missing companion as already_running when the
  // native account roster still says online; its AFK refresh takes about 90s.
  // Observe authoritative native roster refreshes without changing online flags.
  await live.restoreHistoricalSettings(() => ({ luckyUpgradeSlots: { [merchant]: 30 } }));
  await catalog(live, 'helmet');
  // Purchase orders use their native retry allowance, independently of manual
  // upgrade offering rules. Declare enough initial cycles for this journal case.
  const cycleCost=await live.clients[merchant].run('Number(G.items.helmet.g)+3*Number(G.items.scroll0.g)');
  expect(cycleCost).toBeGreaterThan(0);
  await live.post('/merchant/force-stand',{enabled:true});
  const before = await economy(live);
  await live.clients[merchant].run(`(()=>{const key='party-lucky-upgrade:'+character.name;
    const remove=Storage.prototype.removeItem, set=Storage.prototype.setItem, get=Storage.prototype.getItem;
    globalThis.__e2eStorageEchoes=0;
    Storage.prototype.removeItem=function(k){const old=get.call(this,k);remove.call(this,k);
      if(k===key&&old){set.call(this,k,old);globalThis.__e2eStorageEchoes++;}}
    return true})()`);
  const order = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 1, level: 3 }], crafts: [] });
  let initialAllowance:any;
  await live.restoreHistoricalSettings(settings=>{
    if(settings.merchantCurrent?.id===order.jobId)throw Error('Storage echo allowance must precede native order admission');
    const queued=settings.merchantQueue.find((job:any)=>job.id===order.jobId);
    if(!queued?.order||queued.order.buys.length!==1)throw Error('Exact initial storage echo order unavailable');
    const line=queued.order.buys[0];
    if(line.id!=='helmet'||line.quantity!==1||line.level!==3)throw Error('Storage echo initial order identity changed');
    initialAllowance={jobId:queued.id,original:{...line},declaredCycles:10,cycleCost,budget:cycleCost*10};
    return {merchantQueue:settings.merchantQueue.map((job:any)=>job.id===order.jobId?{...job,order:{...job.order,buys:[{...line,attempts:10,budget:cycleCost*10}]}}:job)};
  });
  await info.attach('declared-lucky-echo-initial-order-allowance',{body:JSON.stringify(initialAllowance),contentType:'application/json'});
  await live.post('/merchant/force-stand',{enabled:false});
  await jobFinished(live, order.jobId);
  const after = await economy(live);
  expect(after.characters[merchant].items.filter(item => item?.name === 'helmet' && item.level === 3)).toHaveLength(1);
  const echoes = await live.clients[merchant].run('globalThis.__e2eStorageEchoes');
  expect(echoes).toBeGreaterThan(0);
  // A reconnect discards the runtime cache while persistence can still contain
  // a running journal from a completed receipt. Move the finished gear natively
  // so recovery cannot rely on its old source cell or old intermediate level.
  await live.clients[merchant].run(`(()=>{const key='party-lucky-upgrade:'+character.name;
    const j=JSON.parse(localStorage.getItem(key));if(!j)throw Error('Missing echoed journal');
    j.phase='running';delete j.result;j.item.level=0;
    const target=character.items.findIndex((i,n)=>n!==j.from&&n!==j.to&&!i);
    swap(j.from,target);localStorage.setItem(key,JSON.stringify(j));return true})()`);
  const nativeReconnectRoster = () => live.clients.E2EWarrior.frame.evaluate(() => {
    const game = window as any;
    return { at: Date.now(), active: game.get_active_characters(),
      roster: game.X.characters.map((entry: any) => ({ name: entry.name,
        online: entry.online, server: entry.server })),
      frames: Array.from(document.querySelectorAll('iframe')).map(frame => frame.id) };
  });
  const reconnectBefore = await nativeReconnectRoster(), rosterRefreshes: number[] = [];
  const observeRosterRefresh = (request: import('@playwright/test').Request) => {
    if (request.postData()?.includes('servers_and_characters')) rosterRefreshes.push(Date.now());
  };
  live.clients.E2EWarrior.page.on('request', observeRosterRefresh);
  try { await live.reconnectClient(merchant); }
  finally {
    live.clients.E2EWarrior.page.off('request', observeRosterRefresh);
    await info.attach('native-companion-reconnect-roster', { body: JSON.stringify({
      before: reconnectBefore, after: await nativeReconnectRoster(), rosterRefreshes,
      coordinator: (await live.state()).characterConnections,
    }), contentType: 'application/json' });
  }
  await expect.poll(async () => (await live.state()).characters[merchant]?.upgradeInventoryBusy,
    { timeout: 30_000, message: 'Idle recovery must clear the inventory gate before another job is dispatched' }).toBe(false);
  const followup = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 1, level: 1 }], crafts: [] });
  await jobFinished(live, followup.jobId);
  const recovered = await economy(live);
  expect(recovered.characters[merchant].items.filter(item => item?.name === 'helmet' && item.level === 3)).toHaveLength(1);
  expect(recovered.characters[merchant].items.filter(item => item?.name === 'helmet' && item.level === 1)).toHaveLength(1);
  await record(live, info, 'lucky-journal-storage-echo', before, { order, echoes, after, followup, recovered });
}

export async function partyDeliveryRound(live: LiveGame, info: TestInfo) {
  // Failure modes: a preparing checkpoint leaves an empty-slot assumption stale;
  // stack quantity changes after restoration is persisted permanently fence
  // recovery; restarting replays the upgrade or loses the received cargo.
  await live.restoreHistoricalSettings(() => ({ luckyUpgradeSlots: { [merchant]: 4 } }));
  await catalog(live, 'helmet');
  await live.admin(`output=(()=>{const p=get_player('E2EPriest');if(p.items[10])throw Error('Fixture slot occupied');p.items[10]={name:'seashell',q:4};cache_player_items(p);resend(p,'reopen+cid');return true})()`);
  await expect.poll(async () => (await live.clients.E2EPriest.snapshot()).items[10]?.q).toBe(4);
  await live.clients[merchant].run(`(()=>{const native=swap;globalThis.__e2eDeliveryRestoreFault=false;
    swap=function(a,b){const j=JSON.parse(localStorage.getItem('party-lucky-upgrade:'+character.name)||'null');
      if(j?.phase==='restoring'&&!globalThis.__e2eDeliveryRestoreFault){globalThis.__e2eDeliveryRestoreFault=true;throw Error('Injected interruption before return swap');}
      return native(a,b)};return true})()`);
  const before = await economy(live), context = live.clients[merchant].page.context();
  let preparingDelivery = false, restoringDelivery = false;
  const checkpoints: unknown[] = [];
  await context.route('**/merchant/production', async route => {
    const body = route.request().postDataJSON(), j = body.journal?.lucky;
    if (body.action === 'checkpoint' && j?.phase === 'preparing' && !preparingDelivery) {
      preparingDelivery = true;
      expect((await live.clients[merchant].snapshot()).items[j.to]).toBeNull();
      await live.clients.E2EPriest.run(`send_item('${merchant}',10,3).then(()=>true)`);
      await expect.poll(async () => (await live.clients[merchant].snapshot()).items[j.to]?.q).toBe(3);
      checkpoints.push({ phase: 'preparing', journal: j, inventory: await economy(live) });
    }
    if (body.action === 'checkpoint' && j?.phase === 'restoring' && !restoringDelivery) {
      restoringDelivery = true;
      await live.clients.E2EPriest.run(`send_item('${merchant}',10,1).then(()=>true)`);
      await expect.poll(async () => (await live.clients[merchant].snapshot()).items[j.from]?.q).toBe(4);
      checkpoints.push({ phase: 'restoring', journal: j, inventory: await economy(live) });
    }
    await route.continue();
  });
  try {
    const order = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 1, level: 1 }], crafts: [] });
    await expect.poll(() => restoringDelivery, { timeout: 150_000 }).toBe(true);
    await expect.poll(async () => ![(await live.state()).merchantCurrent, ...(await live.state()).merchantQueue]
      .some((job:any)=>job?.id===order.jobId||job?.commerceOrderId===order.jobId),{timeout:90_000}).toBe(true);
    await live.restartCoordinator();
    await expect.poll(async () => ![(await live.state()).merchantCurrent, ...(await live.state()).merchantQueue]
      .some((job: any) => job?.commerceOrderId === order.jobId), { timeout: 90_000 }).toBe(true);
    const after = await economy(live);
    expect(quantity(after.characters[merchant].items, 'seashell') - quantity(before.characters[merchant].items, 'seashell')).toBe(4);
    expect(after.characters[merchant].items.filter(item => item?.name === 'helmet' && item.level === 1)).toHaveLength(1);
    expect(await live.clients[merchant].run(`localStorage.getItem('party-lucky-upgrade:'+character.name)`)).toBeNull();
    await restartAndObserve(live);
    expect(quantity((await economy(live)).characters[merchant].items, 'seashell')).toBe(4);
    await record(live, info, 'lucky-party-delivery-restart', before, { order, checkpoints, after });
  } finally { await context.unroute('**/merchant/production'); }
}

export async function restorationFailureRound(live: LiveGame, info: TestInfo) {
  // Failure inventory: restore errors drop the order; a lost local receipt
  // holds all work; replay duplicates purchases/results or resets spend/attempts.
  // A completed older local journal must not fence a newer mirrored receipt.
  let completedJournal: Record<string, unknown> | undefined;
  await live.restoreHistoricalSettings(() => ({ luckyUpgradeSlots: { [merchant]: 30 } }));
  await catalog(live, 'helmet');
  const context = live.clients[merchant].page.context();
  await live.clients[merchant].run(`(()=>{
    const nativeSwap=swap;globalThis.__e2eLuckyRestoreFault=false;globalThis.__e2eLuckyRestores=0;
    swap=function(a,b){const j=JSON.parse(localStorage.getItem('party-lucky-upgrade:'+character.name)||'null');
      if(j?.phase==='restoring'&&!globalThis.__e2eLuckyRestoreFault&&++globalThis.__e2eLuckyRestores===2){globalThis.__e2eLuckyRestoreFault=true;throw Error('Injected lost lucky restoration swap');}
      return nativeSwap(a,b);};return true;
  })()`);
  // Best-effort swapback does not hold production recovery. Observe only the
  // actual checkpoint packet; never delay its route while reading a CODE frame.
  const checkpointObserved=async(route:import('@playwright/test').Route)=>{
    const body=route.request().postDataJSON();
    if(body.character===merchant&&body.action==='checkpoint'&&body.id===body.journal?.id&&body.journal?.phase==='complete')completedJournal=body.journal;
    await route.continue();
  };
  await context.route('**/merchant/production',checkpointObserved);
  const before = await economy(live);
  const order = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 2, level: 1 }], crafts: [] });
  await expect.poll(() => live.clients[merchant].run('!!globalThis.__e2eLuckyRestoreFault'), { timeout: 300_000 }).toBe(true);
  await expect.poll(async () => {
    const state=await live.state();
    return ![state.merchantCurrent,...state.merchantQueue].some((job:any)=>job?.id===order.jobId||job?.commerceOrderId===order.jobId);
  },{timeout:180_000,message:'Best-effort swapback must preserve real results without failing completed commerce'}).toBe(true);
  const held = await live.state();
  expect(completedJournal).toBeDefined();
  await live.clients[merchant].run(`(()=>{localStorage.setItem('party-production:'+character.name,${JSON.stringify(JSON.stringify({...completedJournal, phase: 'running'}))});localStorage.removeItem('party-lucky-upgrade:'+character.name);localStorage.removeItem('party-commerce:${order.jobId}');return true})()`);
  await live.restartCoordinator();
  await expect.poll(async () => {
    const state = await live.state();
    return ![state.merchantCurrent, ...state.merchantQueue].some((job: any) => job?.commerceOrderId === order.jobId);
  }, { timeout: 180_000, message: 'Mirrored receipt recovery must restore inventory and finish the original order' }).toBe(true);
  const after = await economy(live);
  const results = (value: Economy) => value.characters[merchant].items.filter(item => item?.name === 'helmet' && item.level === 1).length;
  expect(results(after) - results(before)).toBe(2);
  // Reconciliation runs before subsequent production; idle has no production
  // mutation to execute merely because this old local receipt was restored.
  await catalog(live,'shoes');
  const upgradedShoes=(value:Economy)=>value.characters[merchant].items.filter(item=>item?.name==='shoes'&&item.level===1).length;
  const shoesBefore=upgradedShoes(await economy(live));
  const followup=await live.post('/merchant/order',{buys:[{id:'shoes',quantity:1,level:1}],crafts:[]});
  await expect.poll(async()=>{
    const state=await live.state();return ![state.merchantCurrent,...state.merchantQueue].some((job:any)=>job?.id===followup.jobId||job?.commerceOrderId===followup.jobId);
  },{timeout:180_000}).toBe(true);
  expect(upgradedShoes(await economy(live))-shoesBefore).toBe(1);
  await expect.poll(() => live.clients[merchant].run(`localStorage.getItem('party-production:'+character.name)`)).toBeNull();
  await context.unroute('**/merchant/production',checkpointObserved);
  await restartAndObserve(live);
  expect(results(await economy(live))).toBe(results(after));
  await record(live, info, 'buy-upgrade-lucky-journal-recovery', before, { order, held, after, followup });
}

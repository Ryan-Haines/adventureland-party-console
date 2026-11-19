import { test, expect } from './live-fixtures';

test('Steam merchant realm hop redispatches saved work and returns home natively',async({live},info)=>{
  // Failure modes: native page never changes; CODE does not reconnect; saved
  // work stays current forever; idle stand return strands the merchant away.
  // Seed an interrupted Ponty itinerary whose one listing is on US II and gone
  // from Ponty there. No purchase is made: this journey verifies real realm
  // login, redispatch and return.
  test.setTimeout(420_000);
  const merchant='E2EMerchant',id='steam-realm-86';
  const before=await live.state();
  const completionCount=before.merchantActivity.filter((entry:any)=>entry.message===`Merchant job completed for ${merchant}`).length;
  expect(before.characters[merchant].runtime).toBe('native');
  await live.admin("const m=get_player('E2EMerchant');m.items[10]={name:'stand0'};cache_player_items(m);resend(m,'reopen+cid');output=m.items[10]");
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'manual marketplace purchases':true}});
  await live.restoreHistoricalSettings(()=>({merchantCurrent:null,merchantQueue:[{
    id,reason:'Ponty purchases',target:merchant,queuedAt:Date.now(),priority:100,
    listings:[goneUSIIListing(id)],completedListingKeys:[],
  }]}));
  let nativeAway:any=null;
  await expect.poll(async()=>{
    nativeAway=await live.adminRealm('USII',"output=(()=>{const p=get_player('E2EMerchant');return p?{name:p.name,map:p.map,x:p.x,y:p.y}:null})()");
    return !!nativeAway;
  },{timeout:120_000,intervals:[100]}).toBe(true);
  // Force stand sends the away Steam merchant home at once, with no arrival window
  // first; releasing it lets the paused Ponty job redispatch and hop again.
  const forcedAt=Date.now();
  await live.post('/merchant/force-stand',{enabled:true});
  await expect.poll(async()=>(await live.state()).characters[merchant]?.server,{timeout:45_000,intervals:[250]}).toBe(before.characters[merchant].server);
  const forcedHome=Date.now()-forcedAt;
  expect(forcedHome).toBeLessThan(60_000);
  await live.post('/merchant/force-stand',{enabled:false});
  const arrived=await live.state();
  await expect.poll(async()=>{
    const state=await live.state();
    return ![state.merchantCurrent,...state.merchantQueue].some((job:any)=>job?.id===id)
      && state.merchantActivity.filter((entry:any)=>entry.message===`Merchant job completed for ${merchant}`).length>completionCount;
  },{timeout:120_000}).toBe(true);
  await expect.poll(async()=>{
    const frame=live.clients[merchant].page.frames().find(frame=>frame.url().includes('/character/'+merchant+'/'));
    if(!frame)return false;
    try{return await frame.evaluate(()=>!!(window as any).character?.stand);}
    catch(error){if(/Execution context was destroyed|Cannot find context|Frame was detached/.test(String(error)))return false;throw error;}
  },{timeout:120_000}).toBe(true);
  await expect.poll(async()=>(await live.state()).characters[merchant]?.standOpen,{timeout:20_000}).toBe(true);
  const after=await live.state();
  expect(after.characters[merchant].runtime).toBe('native');
  expect(after.characters[merchant].server).toEqual(before.characters[merchant].server);
  await info.attach('native-steam-merchant-realm-redispatch',{body:JSON.stringify({before,arrived,nativeAway,forcedHome,after}),contentType:'application/json'});
});

// A Ponty job hops to its open listing's realm, and its home is the party realm when its command is
// built, so a job's saved homeRealm moves nothing. A listing on US II whose rid Ponty does not hold
// takes the merchant there, and the runner skips it and completes with no purchase.
function goneUSIIListing(key:string){
  return goneListing(key,'USII');
}
// A Ponty listing gone from `server` (a bare server name such as USI): the merchant hops there, finds
// it gone and buys nothing.
function goneListing(key:string,server:string){
  return {key,serverRegion:server.slice(0,2),serverIdentifier:server.slice(2),rid:'e2e-gone-'+key,item:{name:'leather'},quantity:1,price:0,unitPrice:0};
}

async function logoutMerchant(live:import('./live-fixtures').LiveGame, merchant:string) {
  await live.post('/steam/action',{character:merchant,action:'logout'});
  await expect.poll(async()=>{
    const state=await live.state();
    return !state.activeSlots.some((slot:any)=>slot.character===merchant) &&
      (!state.steamSwitch || state.steamSwitch.phase==='complete');
  },{timeout:90_000}).toBe(true);
  await expect.poll(async()=>await live.admin(`output=!!get_player('${merchant}')`),{timeout:30_000}).toBe(false);
}

async function prepareCrossRealmCollection(live:import('./live-fixtures').LiveGame) {
  const merchant='E2EMerchant',fighter='E2EWarrior';
  await logoutMerchant(live,merchant);
  const requested=await live.post('/realm/switch',{realm:'SR_USII',setHome:false});
  await expect.poll(async()=>{
    const state=await live.state();
    if(state.steamSwitch?.phase==='awaiting-realm-choice')
      await live.post('/steam/realm-choice',{operationId:state.steamSwitch.id,choice:'stay'});
    return state.realmControl.operation.id===requested.operation.id
      && state.realmControl.operation.phase==='complete'
      && (!state.steamSwitch || state.steamSwitch.phase==='complete');
  },{timeout:120_000,intervals:[250],message:'The requested realm arrivals and native Steam handoff must both finish before admitting merchant spawn'}).toBe(true);
  await expect.poll(async()=>await live.adminRealm('USII',`output=!!get_player('${fighter}')`),{timeout:30_000}).toBe(true);
  await live.adminRealm('USII',`output=(()=>{const p=get_player('${fighter}');p.items[10]={name:'leather',q:7};cache_player_items(p);resend(p,'reopen+cid');return true})()`);
  await expect.poll(async()=>(await live.state()).characters[fighter].items.some((entry:any)=>entry?.item?.name==='leather')).toBe(true);
  await live.post('/command',{character:fighter,type:'merchant-mark',slot:10,item:{name:'leather',q:7}});
  await live.post('/bank-party',{group:fighter});
  await live.post('/slots/1/spawn',{character:merchant});
}

async function nativeLeather(live:import('./live-fixtures').LiveGame) {
  const inventories=[];
  for(const realm of ['USI','USII'] as const)
    inventories.push(await live.adminRealm(realm,`output=(()=>{const count=items=>items.reduce((n,i)=>n+(i?.name==='leather'?i.q||1:0),0);return ['E2EWarrior','E2EPriest','E2EMerchant'].reduce((n,name)=>n+count(get_player(name)?.items||[]),0)})()`));
  const bank=await live.admin(`output=(async()=>{const user=await db.collection('user').findOne({'info.email':'e2e@example.test'});return Object.entries(user.info).filter(([k,v])=>/^items[0-9]+$/.test(k)&&Array.isArray(v)).reduce((n,[,v])=>n+v.reduce((n,i)=>n+(i?.name==='leather'?i.q||1:0),0),0)})()`);
  return {inventories,bank,total:inventories.reduce((n,value)=>n+value,0)+bank};
}

test.describe('merchant destination ownership', () => {
  test.use({liveHeadless:true});
  test('party realm transition keeps its own sixty second timeout during missing arrival reports',async({live},info)=>{
    test.setTimeout(600_000);
    await prepareCrossRealmCollection(live);
    let admitted:any;
    await expect.poll(async()=>{
      const current=(await live.state()).merchantCurrent;
      if(current?.phase==='switching party realm') admitted=current;
      return !!admitted;
    },{timeout:90_000,intervals:[100]}).toBe(true);
    const started=admitted.realmStartedAt;
    live.holdMerchantStatus(true);
    try {
      await expect.poll(async()=>await live.adminRealm('USII',"output=!!get_player('E2EMerchant')"),{timeout:50_000}).toBe(true);
      await expect.poll(async()=>Date.now()-started,{timeout:15_000}).toBeGreaterThan(5000);
      const waiting=await live.state();
      expect(waiting.merchantCurrent).toMatchObject({id:admitted.id,phase:'switching party realm',realmStartedAt:started});
      await expect.poll(async()=>(await live.state()).merchantActivity.some((entry:any)=>entry.message==='Merchant realm switch timed out'),{timeout:65_000}).toBe(true);
      const expired=await live.state(), elapsed=Date.now()-started;
      expect(expired.merchantQueue.find((job:any)=>job.id===admitted.id)).toMatchObject({realmAttempts:1,realmStartedAt:started});
      expect(elapsed).toBeGreaterThanOrEqual(60_000);
      expect(elapsed).toBeLessThan(70_000);
      expect(expired.merchantActivity.some((entry:any)=>entry.message?.startsWith('Merchant stopped reporting'))).toBe(false);
      expect((await nativeLeather(live)).total).toBe(7);
      await info.attach('party-realm-owned-timeout',{body:JSON.stringify({admitted,waiting,expired,elapsed,nativeArrivalRealm:'USII',nativeArrival:await live.adminRealm('USII',"output=(()=>{const p=get_player('E2EMerchant');return {name:p.name,items:p.items}})()")}),contentType:'application/json'});
    } finally {live.holdMerchantStatus(false);}
    // A party switch whose merchant login makes no progress (its reports
    // held) retries the stragglers, then rolls every participant back to the realm it left. The
    // switch route refuses a participant with no report in the presence window, and the merchant's
    // last one is a minute old from the hold above, so the row waits for a fresh one first.
    await expect.poll(async()=>Date.now()-Number((await live.state()).characters.E2EMerchant?.seenAt),{timeout:60_000,intervals:[250]}).toBeLessThan(5_000);
    const left=(await live.state()).realmControl.activeRealm;
    live.holdMerchantStatus(true);
    try {
      const requested=await live.post('/realm/switch',{realm:left==='SR_USII'?'SR_USI':'SR_USII',setHome:false});
      await expect.poll(async()=>{
        const operation=(await live.state()).realmControl.operation;
        return operation.id===requested.operation.id&&!['switching','retrying','rolling-back'].includes(operation.phase)?operation.phase:null;
      },{timeout:240_000,intervals:[500]}).toBe('failed');
      const rolled=await live.state();
      expect(rolled.realmControl.operation.error||rolled.realmControl.operation.message).toMatch(/E2EMerchant/);
      expect(rolled.realmControl.activeRealm).toBe(left);
      // A Steam member the bridge restores during the rollback goes back to the realm left with no
      // Switch/Stay prompt, so every participant is on that realm (decision 2026-11-17).
      // Each sample names where every participant is on both realms and what it reports, so a
      // participant that does not come back is named with its realm, its worker, its report and the
      // Steam switch's phase.
      const names=['E2EWarrior','E2EPriest','E2EMerchant'],returns:any[]=[];
      const presence=async()=>{
        const online=Object.fromEntries(await Promise.all((['USI','USII'] as const).map(async realm=>[realm,
          await live.adminRealm(realm,`output=${JSON.stringify(names)}.filter(name=>!!get_player(name))`)])));
        const state=await live.state();
        returns.push({at:Date.now(),online,reports:Object.fromEntries(names.map(name=>[name,{server:state.characters[name]?.server,
          seenAt:state.characters[name]?.seenAt,runtime:state.characters[name]?.runtime}])),slots:state.activeSlots,steamSwitch:state.steamSwitch??null});
        if(returns.length>64)returns.splice(1,1);
        return names.filter(name=>!online[left.replace(/^SR_/,'')].includes(name));
      };
      try{await expect.poll(presence,{timeout:60_000,intervals:[1000]}).toEqual([]);}
      finally{await info.attach('party-switch-rollback',{body:JSON.stringify({realmControl:rolled.realmControl,returns}),contentType:'application/json'});}
    } finally {live.holdMerchantStatus(false);}
  });
  // A request saved as exhausted by an earlier version holds
  // no home job, and Retry runs that job at once. It replaces the row that checked the 3-attempt cap
  // removed since. Retry clears the saved request and the merchant spawns on its home realm, so
  // it needs no return; the climb itself is realm-owner.test.cjs "a saved exhausted home return
  // climbs again, and Retry clears it".
  test('MJ42: a saved exhausted home return holds no home job, and Retry runs it at once',async({live},info)=>{
    test.setTimeout(240_000);
    const merchant='E2EMerchant',id='third-home-return';
    await logoutMerchant(live,merchant);
    await live.restoreHistoricalSettings(()=>({
      merchantRealmRequests:{[merchant]:{realm:'SR_USI',owner:'home',requestedAt:Date.now()-61_000,attempts:3,exhausted:true}},
      merchantQueue:[{id,target:merchant,reason:'manual bank exchange',queuedAt:Date.now()}],
    }));
    await live.restartCoordinator();
    const loaded=await live.state();
    expect(loaded.merchantQueue.some((job:any)=>job.id===id)).toBe(true);
    await live.post('/merchant/job/retry',{id});
    await live.post('/slots/1/spawn',{character:merchant});
    await expect.poll(async()=>{
      const state=await live.state();
      return state.characters[merchant]?.map==='bank' && ![state.merchantCurrent,...state.merchantQueue].some((job:any)=>job?.id===id);
    },{timeout:150_000}).toBe(true);
    const after=await live.state();
    expect(after.merchantActivity.some((entry:any)=>/failed after 3 attempts|manual retry required/.test(entry.message||''))).toBe(false);
    await info.attach('saved-exhausted-home-return-climbs',{body:JSON.stringify({loaded,after}),contentType:'application/json'});
  });
  test('cross realm merchant collection reconnects before transferring real cargo',async({live},info)=>{
    test.setTimeout(300_000);
    const merchant='E2EMerchant',fighter='E2EWarrior';
    await prepareCrossRealmCollection(live);
    const observations:any[]=[];
    let admitted:any;
    await expect.poll(async()=>{
      const state=await live.state();
      observations.push({at:Date.now(),merchant:state.characters[merchant]?.server,current:state.merchantCurrent,queue:state.merchantQueue});
      if(state.merchantCurrent?.phase==='switching party realm') admitted=state.merchantCurrent;
      return !!admitted;
    },{timeout:90_000,intervals:[100],message:'A real US I to US II transition must be admitted before collection'}).toBe(true);
    expect(admitted.destinationRealm).toBe('SR_USII');
    // The merchant group's task is realm-hold from the write of the
    // destination until the merchant reports from it, so an event cannot take it mid-login. realm-hold
    // shares lifecycle's rank 88 and whichever holds the merchant first keeps it, so a lifecycle
    // task over the login's worker restart holds it as well.
    const holds:any[]=[];
    await expect.poll(async()=>{
      const [state,tasks]=await Promise.all([live.state(),live.tasks()]);
      const group=tasks.groups.find((g:any)=>g.id==='merchant:'+merchant);
      holds.push({at:Date.now(),server:state.characters[merchant]?.server,live:group?.live?.kind,owner:group?.live?.owner});
      return state.characters[merchant]?.server==='USII';
    },{timeout:120_000,intervals:[100]}).toBe(true);
    // The samples go with the row before the check, so a sample that holds no login names its task.
    await info.attach('cross-realm-hold-samples',{body:JSON.stringify(holds),contentType:'application/json'});
    expect(holds.filter(hold=>hold.server!=='USII'&&!['realm-hold','lifecycle'].includes(hold.live))).toEqual([]);
    await expect.poll(async()=>{
      const state=await live.state();
      observations.push({at:Date.now(),merchant:state.characters[merchant]?.server,current:state.merchantCurrent,queue:state.merchantQueue});
      return !state.characters[fighter].items.some((entry:any)=>entry?.item?.name==='leather');
    },{timeout:180_000,intervals:[250,500,1000]}).toBe(true);
    const after=await live.state();
    expect(after.merchantActivity.some((entry:any)=>entry.message?.startsWith('Merchant stopped reporting'))).toBe(false);
    await expect.poll(async()=>(await nativeLeather(live)).total,{timeout:30_000}).toBe(7);
    const total=await nativeLeather(live);
    await info.attach('cross-realm-native-collection',{body:JSON.stringify({admitted,observations,holds,after,total,events:await live.clients[fighter].events()}),contentType:'application/json'});
  });
  test('merchant reconnect completes bank work off its native home', async ({ live }, info) => {
    test.setTimeout(240_000);
    const name = 'E2EMerchant';
    await live.admin(`output=(async()=>{for(const name of ['E2EWarrior','E2EPriest','E2EMerchant']){const p=get_player(name);p.p.home='USII';await db.collection('character').updateOne({'info.name':name},{$set:{'info.p.home':'USII'}});}return true})()`);
    await live.post('/realm/switch', {realm:'SR_USI',setHome:false});
    await expect.poll(async () => (await live.state()).realmControl.operation.phase, {timeout:120_000}).toBe('complete');
    await logoutMerchant(live,name);
    await live.restartCoordinator();
    await live.post('/slots/1/spawn', {character:name});
    await expect.poll(async () => (await live.state()).characters[name]?.server, {timeout:90_000}).toBe('USII');
    await live.post('/command', {character:name,type:'bank'});
    await expect.poll(async () => {
      const s=await live.state();
      return s.characters[name]?.server==='USI' && s.characters[name]?.map==='bank';
    }, {timeout:120_000}).toBe(true);
    const after=await live.state();
    expect(await live.admin(`output=get_player('${name}').p.home`)).toBe('USII');
    expect(after.merchantActivity.filter((entry:any)=>entry.message?.startsWith('Returning '+name)).length).toBeLessThanOrEqual(3);
    await info.attach('merchant-nonhome-reconnect-bank', {body:JSON.stringify({after,native:await live.admin(`output=(()=>{const p=get_player('${name}');return {home:p.p.home,map:p.map,items:p.items,gold:p.gold}})()`)}),contentType:'application/json'});
  });
});

// IT20: after a job on another realm ends, the merchant stays there while a
// ready job on that realm is as urgent as home's, and hops home when home's is more urgent. Two
// realms: the native home and USII. A Ponty job runs on its listing's realm
// (merchant-jobs/coordinator/dispatch.ts `jobRealm`), so home's job carries a listing on home; a
// Ponty job with no listing has nothing to buy and runs wherever the merchant stands.
for(const homeFirst of [false,true])test(`IT20: the realm stay ${homeFirst?'gives way to a more urgent home job':'holds for an equal job on its realm'}`,async({live},info)=>{
  test.setTimeout(420_000);
  const merchant='E2EMerchant',home=(await live.state()).characters[merchant].server;
  await live.admin("const m=get_player('E2EMerchant');m.items[10]={name:'stand0'};cache_player_items(m);resend(m,'reopen+cid');output=m.items[10]");
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'manual marketplace purchases':true}});
  // A job's own urgency is its priorityOverride (rules.ts `merchantJobPriority`); every job here has
  // one reason, so its routine priority alone cannot order them.
  const job=(id:string,server:string,priority:number)=>({id,reason:'Ponty purchases',target:merchant,queuedAt:Date.now(),priorityOverride:priority,
    listings:[goneListing(id,server)],completedListingKeys:[]});
  await live.restoreHistoricalSettings(()=>({merchantCurrent:null,merchantQueue:[job('it20-away','USII',100),
    job('it20-away-next','USII',50),job('it20-home',home,homeFirst?90:50)]}));
  await expect.poll(async()=>(await live.state()).characters[merchant]?.server,{timeout:120_000,intervals:[250]}).not.toBe(home);
  await expect.poll(async()=>{
    const state=await live.state();
    return ![state.merchantCurrent,...state.merchantQueue].some((entry:any)=>entry?.id==='it20-away');
  },{timeout:120_000}).toBe(true);
  // Each job counts once, at the realm the merchant last reported from while it ran: a job's listing
  // hop happens inside the job, after it starts.
  const order:string[]=[];let running:{id:string;realm:string}|null=null;
  await expect.poll(async()=>{
    const state=await live.state(),current=state.merchantCurrent?.id,realm=state.characters[merchant]?.server===home?'home':'away';
    if(running&&running.id!==current){order.push(running.id+'@'+running.realm);running=null;}
    if(current&&!order.some(entry=>entry.startsWith(current+'@')))running={id:current,realm};
    return order.length;
  },{timeout:180_000,intervals:[250]}).toBeGreaterThanOrEqual(2);
  expect(order.slice(0,2)).toEqual(homeFirst?['it20-home@home','it20-away-next@away']:['it20-away-next@away','it20-home@home']);
  await info.attach('IT20 order',{body:JSON.stringify(order),contentType:'application/json'});
});

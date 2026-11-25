import type {Page, TestInfo} from '@playwright/test';
import {expect, headlessMerchant, logoutNative, type LiveGame} from './live-fixtures';
import {fresh, REPORT_AGE_DEFAULTS} from '../runtime/protocol/reports.ts';
import {ARRIVAL_WINDOW_MS} from '../runtime/merchant-realm/rules.ts';
import {AT_STAND} from '../runtime/merchant-jobs/rules.ts';

// W49's one realm session (test-windows DESIGN.md 2.2 W49). The merchant is offline at the start,
// and each round reads the realms the round before it left:
//  1. the fighters walk a convoy on Main and the player switches the party to US II mid-walk; C20
//     reads the convoy it retires and M44 the switch's arrivals and Steam handoff;
//  2. the merchant logs in on its home and joins US II to collect the warrior's leather (M44);
//  3. a second collection login with the merchant's reports held runs out the switch's own timer,
//     then a party switch with the reports held rolls everyone back (M42);
//  4. with every home on US II, a merchant respawn on US II banks on US I (M45);
//  5. the offline merchant logs in to set US I as home and logs out again (M28);
//  6. a saved exhausted home return holds no home job and Retry runs it (M43);
//  7. the merchant goes headless on its home despite the stale worker realm (M26), the player sets
//     US I as home from the dashboard, and the game's 36 h set_home refusal rolls the party back
//     (M27); a coordinator restart keeps the headless merchant on US I (M26).
// The bodies are the old tests' (live-navigation-supersession.spec.ts, live-merchant-realm-
// recovery.spec.ts, live-home-realm.spec.ts, live-home-connect.spec.ts), all at 21fe30a2b. Rounds 2
// and 3 are two logins because M44 reads the merchant held until it reports from US II and M42
// reads a login that never reports (DEVIATIONS.md "Live B" W49).
const W='E2EWarrior',P='E2EPriest';

export async function realmSessionPlay(live: LiveGame, page: Page, info: TestInfo) {
  await realmDepartureRound(live, info);
  await crossRealmCollectionRound(live, info);
  await realmTimeoutRound(live, info);
  await bankOffHomeRound(live, info);
  await offlineHomeRound(live, info);
  await exhaustedReturnRound(live, info);
  await homeRealmRound(live, page, info);
}

async function logoutMerchant(live:import('./live-fixtures').LiveGame, merchant:string) {
  await live.post('/steam/action',{character:merchant,action:'logout'});
  await expect.poll(async()=>{
    const state=await live.state();
    return !state.activeSlots.some((slot:any)=>slot.character===merchant) &&
      (!state.steamSwitch || state.steamSwitch.phase==='complete');
  },{timeout:90_000}).toBe(true);
  // The merchant logs out on the party's realm, which can be either one.
  await expect.poll(async()=>(await Promise.all((['USI','USII'] as const).map(realm=>live.adminRealm(realm,`output=!!get_player('${merchant}')`)))).some(Boolean),
    {timeout:30_000,message:'The merchant leaves both realms'}).toBe(false);
  // The job dispatch counts a merchant whose last report is under the `presence` reading
  // (merchant-jobs dispatch.ts merchantAlive), so a job queued 0.5 s after the logout went to it,
  // came back as "Merchant went offline; retry scheduled", and the home want moved the merchant
  // before the retry, with no job realm switch (liveb-step10-run8.log, M42's admission).
  await expect.poll(async()=>fresh((await live.state()).characters[merchant]?.seenAt,Date.now(),'presence'),
    {timeout:30_000,message:"The merchant's last report passes the dispatch's presence reading"}).toBe(false);
}

// The merchant leaves the game once its jobs are done; a character that is already out stays as it
// is. A logout in the middle of the party collection requeued the priest's job, whose realm move
// then refused the next round's spawn for its 60 s window (merchant-realm owner.ts `moving`;
// liveb-step10-run3.log: 502 "Wait for E2EMerchant"). The bound is one party collection's, as
// crossRealmCollectionRound waits for the warrior's.
async function offline(live: LiveGame, merchant = 'E2EMerchant', beforeLogout?: () => Promise<void>) {
  const state = await live.state();
  if (state.activeSlots.some((slot: any) => slot.character === merchant) || await live.admin(`output=!!get_player('${merchant}')`)) {
    // The merchant's work ends at its stand on the party's realm: after a collection on another
    // realm it banks, then a realm move takes it back, and a logout during that move left a home
    // request that refused the next spawn (liveb-step10-run6.log). An idle task alone read true in
    // the 1 s between the last job and that move.
    await expect.poll(async () => {
      const [s, tasks] = await Promise.all([live.state(), live.tasks()]);
      return !s.merchantCurrent && !s.merchantQueue.length && tasks.groups.find((g: any) => g.id === 'merchant:' + merchant)?.live?.kind === 'idle'
        // At its stand by the market's own reach (market.ts AT_STAND): a merchant already there
        // when its last job ends writes no "At stand" line (liveb-step11-run1.log, M45's logout).
        && atStand(s, merchant)
        // The stand it reaches after the bank can be on the bank's realm, and the move to the
        // party's realm follows 1 s later (liveb-step10-run7.log), so the merchant also reports
        // from the party's realm.
        && s.characters[merchant]?.server === String(s.realmControl.activeRealm).replace(/^SR_/, '');
    }, {timeout: 180_000, message: 'The merchant finishes its jobs at its stand before it logs out'}).toBe(true);
    await beforeLogout?.();
    await logoutMerchant(live, merchant);
  }
}

const atStand = (s: any, merchant: string) => {
  const at = s.characters[merchant], point = s.merchantStandLocation;
  return !!at && !!point && at.map === point.map && Math.hypot(Number(at.x) - point.x, Number(at.y) - point.y) <= AT_STAND;
};

// The activity lines a round wrote itself: the session keeps every earlier round's lines.
const since = (entries: any[], at: number) => entries.filter(entry => !(Number(entry.at) < at));

async function nativeLeather(live:import('./live-fixtures').LiveGame) {
  const inventories=[];
  for(const realm of ['USI','USII'] as const)
    inventories.push(await live.adminRealm(realm,`output=(()=>{const count=items=>items.reduce((n,i)=>n+(i?.name==='leather'?i.q||1:0),0);return ['E2EWarrior','E2EPriest','E2EMerchant'].reduce((n,name)=>n+count(get_player(name)?.items||[]),0)})()`));
  const bank=await live.admin(`output=(async()=>{const user=await db.collection('user').findOne({'info.email':'e2e@example.test'});return Object.entries(user.info).filter(([k,v])=>/^items[0-9]+$/.test(k)&&Array.isArray(v)).reduce((n,[,v])=>n+v.reduce((n,i)=>n+(i?.name==='leather'?i.q||1:0),0),0)})()`);
  return {inventories,bank,total:inventories.reduce((n,value)=>n+value,0)+bank};
}

// Round 3 counts its own 7 from an empty bank.
async function clearBankedLeather(live: LiveGame) {
  await live.admin(`output=(async()=>{const user=await db.collection('user').findOne({'info.email':'e2e@example.test'});const set={};
    for(const [k,v] of Object.entries(user.info))if(/^items[0-9]+$/.test(k)&&Array.isArray(v))set['info.'+k]=v.map(i=>i?.name==='leather'?null:i);
    await db.collection('user').updateOne({_id:user._id},{$set:set});return true})()`);
}

async function freshParticipants(live: LiveGame, names: string[]) {
  await expect.poll(async () => {
    const state = await live.state();
    return names.every(name => state.characters[name]?.seenAt >= Date.now() - 5000);
  }, {timeout:90_000,message:'Every realm participant must report fresh native status after restart'}).toBe(true);
}

// C20 (live-navigation-supersession.spec.ts 'realm departure retires an old native convoy before
// destination arrival'). The merchant is offline (DESIGN.md W49 setup), so the walk's readiness
// reads the two fighters, and the switch is the one M44's collection starts from.
async function realmDepartureRound(live: LiveGame, info: TestInfo) {
  // Automatic party collection stays off for the session: the fighters' seeded gold queued a new
  // collection 1.5 s after the manual ones ended, and the logout between them requeued it
  // (liveb-step10-run5.log). The rounds' /bank-party jobs are manual and run with it off
  // (merchant-jobs/rules.ts routineEnabled).
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'merchant idle':false,'stand maintenance':false,'party collection':false}});
  await offline(live);
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  const ready=async()=>{
    const state=await live.state();
    // The merchant's logout leaves no Steam switch (W49 run 1: steamSwitch null), the form the
    // logout's own poll reads.
    return (!state.steamSwitch||state.steamSwitch.phase==='complete')&&[W,P].every(name=>{
      const report=state.characters[name];
      return report?.runtime==='native'&&report.server==='USI'&&Date.now()-report.seenAt<3000;
    });
  };
  await expect.poll(ready,{timeout:30_000}).toBe(true);
  const destination=await live.admin(`output=(()=>{const members=['${W}','${P}'].map(name=>get_player(name)),p=members[0];for(let i=0;i<16;i++){const a=i*Math.PI/8,x=p.x+600*Math.cos(a),y=p.y+600*Math.sin(a);if(members.every(member=>can_move({map:member.map,x:member.x,y:member.y,going_x:x,going_y:y,base:member.base})))return {map:p.map,x,y};}throw Error('No native collision-free convoy destination')})()`);
  await info.attach('native-reachable-realm-convoy-destination',{body:JSON.stringify(destination),contentType:'application/json'});
  await live.post('/travel',destination);
  await expect.poll(async()=>(await live.state()).activeConvoy?.id,{timeout:30_000}).toBeTruthy();
  await expect.poll(ready,{timeout:15_000}).toBe(true);
  const before=await live.state(),old=before.activeConvoy;
  const requested=await live.post('/realm/switch',{realm:'SR_USII',setHome:false});
  await expect.poll(async()=>{
    const state=await live.state();
    if(state.steamSwitch?.phase==='awaiting-realm-choice')
      await live.post('/steam/realm-choice',{operationId:state.steamSwitch.id,choice:'stay'});
    return state.realmControl.operation.phase;
  },{timeout:120_000}).toBe('complete');
  await expect.poll(async()=>{
    const state=await live.state();
    if(state.steamSwitch?.phase==='awaiting-realm-choice')
      await live.post('/steam/realm-choice',{operationId:state.steamSwitch.id,choice:'stay'});
    return state.realmControl.operation.id===requested.operation.id
      && state.realmControl.operation.phase==='complete'
      && (!state.steamSwitch || state.steamSwitch.phase==='complete');
  },{timeout:120_000,intervals:[250],message:'The requested realm arrivals and native Steam handoff must both finish before admitting merchant spawn'}).toBe(true);
  await expect.poll(async()=>(await live.state()).activeConvoy?.id || null).not.toBe(old.id);
  await expect.poll(async()=>await live.adminRealm('USII',`output=!!get_player('${W}')&&!!get_player('${P}')`)).toBe(true);
  const after=await live.state();
  expect(after.combatLogs[W].some((entry:any)=>entry.details?.convoyId===old.id&&entry.message==='Convoy cancelled')).toBe(true);
  await info.attach('native-realm-convoy-retirement',{body:JSON.stringify({before,after}),contentType:'application/json'});
}

// The warrior on US II carries 7 leather for the merchant, which spawns on its home, US I.
async function plantCollection(live: LiveGame) {
  const merchant='E2EMerchant',fighter='E2EWarrior';
  await expect.poll(async()=>await live.adminRealm('USII',`output=!!get_player('${fighter}')`),{timeout:30_000}).toBe(true);
  await live.adminRealm('USII',`output=(()=>{const p=get_player('${fighter}');p.items[10]={name:'leather',q:7};cache_player_items(p);resend(p,'reopen+cid');return true})()`);
  await expect.poll(async()=>(await live.state()).characters[fighter].items.some((entry:any)=>entry?.item?.name==='leather')).toBe(true);
  await live.post('/command',{character:fighter,type:'merchant-mark',slot:10,item:{name:'leather',q:7}});
  await live.post('/bank-party',{group:fighter});
  // An earlier round's home move to the party's realm stays saved while the merchant is offline,
  // and its next login starts on that move's realm (merchant-realm worker-setup.ts realmTarget),
  // so the collection needs no realm switch (liveb-step10-run9.log: "starting E2EMerchant ... in
  // SR_USII"). The dashboard Retry on the queued job clears the saved move (owner.ts `retry`), so
  // the login starts on the merchant's native home, US I.
  const queued=(await live.state()).merchantQueue.find((job:any)=>job.target===fighter);
  expect(queued,'The collection job is queued before the merchant logs in').toBeTruthy();
  await live.post('/merchant/job/retry',{id:queued.id});
  await live.post('/slots/1/spawn',{character:merchant});
}

// M44 (live-merchant-realm-recovery.spec.ts 'cross realm merchant collection reconnects before
// transferring real cargo').
async function crossRealmCollectionRound(live: LiveGame, info: TestInfo) {
    const merchant='E2EMerchant',fighter='E2EWarrior';
    await plantCollection(live);
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
}

// M42 (the same spec's 'party realm transition keeps its own sixty second timeout during missing
// arrival reports').
async function realmTimeoutRound(live: LiveGame, info: TestInfo) {
    // Round 2's collection leaves its 7 leather carried by the merchant (liveb-step10-run10.log:
    // inventories [0,7], bank 0), so the round counts its own 7 above what the merchant carries once
    // its jobs end, read before the logout takes its bag out of the realms' players.
    let carried=0;
    await offline(live,'E2EMerchant',async()=>{carried=(await nativeLeather(live)).inventories.reduce((n,v)=>n+v,0);});
    await clearBankedLeather(live);
    await plantCollection(live);
    let admitted:any;
    await expect.poll(async()=>{
      const current=(await live.state()).merchantCurrent;
      if(current?.phase==='switching party realm') admitted=current;
      return !!admitted;
    },{timeout:90_000,intervals:[100]}).toBe(true);
    const started=admitted.realmStartedAt;
    // DESIGN.md W49 M42 reads the timeout between the arrival window (merchant-realm rules.ts
    // ARRIVAL_WINDOW_MS) and 10 s past it, so every wait in the round ends on that window.
    const timeoutBy=started+ARRIVAL_WINDOW_MS+10_000;
    live.holdMerchantStatus(true);
    try {
      await expect.poll(async()=>await live.adminRealm('USII',"output=!!get_player('E2EMerchant')"),{timeout:ARRIVAL_WINDOW_MS}).toBe(true);
      await expect.poll(async()=>Date.now()-started,{timeout:15_000}).toBeGreaterThan(5000);
      const waiting=await live.state();
      expect(waiting.merchantCurrent).toMatchObject({id:admitted.id,phase:'switching party realm',realmStartedAt:started});
      await expect.poll(async()=>(await live.state()).merchantActivity.some((entry:any)=>entry.message==='Merchant realm switch timed out'),{timeout:Math.max(0,timeoutBy-Date.now())}).toBe(true);
      const expired=await live.state(), elapsed=Date.now()-started;
      expect(expired.merchantQueue.find((job:any)=>job.id===admitted.id)).toMatchObject({realmAttempts:1,realmStartedAt:started});
      expect(elapsed).toBeGreaterThanOrEqual(ARRIVAL_WINDOW_MS);
      expect(elapsed).toBeLessThan(ARRIVAL_WINDOW_MS+10_000);
      expect(expired.merchantActivity.some((entry:any)=>entry.message?.startsWith('Merchant stopped reporting'))).toBe(false);
      expect((await nativeLeather(live)).total).toBe(carried+7);
      await info.attach('party-realm-owned-timeout',{body:JSON.stringify({admitted,waiting,expired,elapsed,nativeArrivalRealm:'USII',nativeArrival:await live.adminRealm('USII',"output=(()=>{const p=get_player('E2EMerchant');return {name:p.name,items:p.items}})()")}),contentType:'application/json'});
    } finally {live.holdMerchantStatus(false);}
    // A party switch whose merchant login makes no progress (its reports
    // held) retries the stragglers, then rolls every participant back to the realm it left. The
    // switch route refuses a participant with no report in the presence window, and the merchant's
    // last one is a minute old from the hold above, so the row waits for a fresh one first.
    await merchantReports(live);
    const left=(await live.state()).realmControl.activeRealm;
    live.holdMerchantStatus(true);
    try {
      const requested=await live.post('/realm/switch',{realm:left==='SR_USII'?'SR_USI':'SR_USII',setHome:false});
      // With no progress from the merchant, the switch's arrival window and the rollback's each end
      // their phase (party-switch.ts awaitArrival), 120.0 s in liveb-step10-run11.log; the presence
      // window covers the report the last pass reads.
      await expect.poll(async()=>{
        const operation=(await live.state()).realmControl.operation;
        return operation.id===requested.operation.id&&!['switching','retrying','rolling-back'].includes(operation.phase)?operation.phase:null;
      },{timeout:2*ARRIVAL_WINDOW_MS+REPORT_AGE_DEFAULTS.reportPresenceMs,intervals:[500]}).toBe('failed');
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
      // The rollback's own window has ended, so a participant still away is a login the window
      // already gave up on; one presence window covers a restore that is mid report.
      try{await expect.poll(presence,{timeout:REPORT_AGE_DEFAULTS.reportPresenceMs,intervals:[1000]}).toEqual([]);}
      finally{await info.attach('party-switch-rollback',{body:JSON.stringify({realmControl:rolled.realmControl,returns}),contentType:'application/json'});}
    } finally {live.holdMerchantStatus(false);}
    // The next round's switch refuses a merchant with no report in the presence window, and the
    // rollback above held its reports (liveb-step10-run11.log: 409 "every active character must be
    // connected" 0 ms after the hold ended, merchant seenAt 120 s old).
    await merchantReports(live);
}

// The merchant's next report once the row stops holding them. A connected headless merchant reports
// inside the dispatch's presence reading (protocol/reports.ts), so that reading bounds the wait.
async function merchantReports(live: LiveGame) {
  const released=Date.now();
  await expect.poll(async()=>Number((await live.state()).characters.E2EMerchant?.seenAt)>released,
    {timeout:REPORT_AGE_DEFAULTS.reportPresenceMs,intervals:[250],message:'The merchant reports once its reports are no longer held'}).toBe(true);
}

// M45 (the same spec's 'merchant reconnect completes bank work off its native home').
async function bankOffHomeRound(live: LiveGame, info: TestInfo) {
    const roundAt = Date.now();
    const name = 'E2EMerchant';
    // Round 3 leaves the party on US II, and a realm saves its live players to the DB when they leave
    // it, so the seed sets the live home on both realms: a US I-only seed was overwritten by US II's
    // save at the switch (liveb-step11-run2.log, every login reported home USI).
    const seed=`output=(async()=>{for(const name of ['E2EWarrior','E2EPriest','E2EMerchant']){const p=get_player(name);if(p)p.p.home='USII';await db.collection('character').updateOne({'info.name':name},{$set:{'info.p.home':'USII'}});}return true})()`;
    for (const realm of ['USI','USII'] as const) await live.adminRealm(realm, seed);
    await live.post('/realm/switch', {realm:'SR_USI',setHome:false});
    await expect.poll(async () => (await live.state()).realmControl.operation.phase, {timeout:120_000}).toBe('complete');
    await offline(live,name);
    await live.restartCoordinator();
    await live.post('/slots/1/spawn', {character:name});
    // The merchant ends on the party's realm, not its native home. The login takes a saved realm request,
    // else the native home (worker-setup.ts connectionRealm); then the realm owner's home want, the
    // party's active realm, moves it to US I (08-09-merchant-design.md R1). With no saved request the
    // login was on US II and a worker restart moved it 4.3 s later (liveb-step12-run3, DEVIATIONS.md
    // "W49 M45"), so the read holds either way.
    await expect.poll(async () => (await live.state()).characters[name]?.server, {timeout:90_000}).toBe('USI');
    await live.post('/command', {character:name,type:'bank'});
    await expect.poll(async () => {
      const s=await live.state();
      return s.characters[name]?.server==='USI' && s.characters[name]?.map==='bank';
    }, {timeout:120_000}).toBe(true);
    const state=await live.state(),after={...state,merchantActivity:since(state.merchantActivity,roundAt)};
    expect(await live.admin(`output=get_player('${name}').p.home`)).toBe('USII');
    expect(after.merchantActivity.filter((entry:any)=>entry.message?.startsWith('Returning '+name)).length).toBeLessThanOrEqual(3);
    await info.attach('merchant-nonhome-reconnect-bank', {body:JSON.stringify({after,native:await live.admin(`output=(()=>{const p=get_player('${name}');return {home:p.p.home,map:p.map,items:p.items,gold:p.gold}})()`)}),contentType:'application/json'});
}

// M28 (live-home-realm.spec.ts 'offline merchant logs in to set home and returns offline without
// changing slots'). Round 4 left the fighters' homes on US II, so the switch sets every home.
async function offlineHomeRound(live: LiveGame, info: TestInfo) {
      await offline(live,'E2EMerchant');
      const seeded = await live.admin("output=db.collection('character').updateOne({'info.name':'E2EMerchant'},{$set:{'info.p.home':'USII'},$unset:{'info.p.dt.last_homeset':''}})");
      expect(seeded.matchedCount).toBe(1);
      await live.restartCoordinator();
      await expect.poll(async () => (await live.state()).realmControl?.homeCharacters?.find((entry:any)=>entry.name==='E2EMerchant')?.home).toBe('SR_USII');
      await freshParticipants(live, ['E2EWarrior','E2EPriest']);
      const before = await live.state();
      const result = await live.post('/realm/switch', {realm:'SR_USI',setHome:true});
      expect(result.operation.homeTargets).toContain('E2EMerchant');
      await expect.poll(async () => (await live.state()).realmControl?.operation?.phase, {timeout:150_000}).toBe('complete');
      await expect.poll(async () => await live.admin("output=!!get_player('E2EMerchant')"), {timeout:30_000}).toBe(false);
      const after = await live.state();
      expect(after.realmControl.homeCharacters.every((entry:any)=>entry.home==='SR_USI')).toBe(true);
      expect(after.activeSlots.map((entry:any)=>({index:entry.index,kind:entry.kind,character:entry.character}))).toEqual(before.activeSlots.map((entry:any)=>({index:entry.index,kind:entry.kind,character:entry.character})));
      const storedHome = await live.admin("output=db.collection('character').findOne({'info.name':'E2EMerchant'}).then(c=>c.info.p.home)");
      expect(storedHome).toBe('USI');
      await info.attach('offline-character-native-home-and-slot-restoration', {body:JSON.stringify({before,after,storedHome}),contentType:'application/json'});
}

// M43 (live-merchant-realm-recovery.spec.ts 'MJ42'): a request saved as exhausted by an earlier
// version holds no home job, and Retry runs that job at once; the climb itself is
// realm-owner.test.cjs "a saved exhausted home return climbs again, and Retry clears it".
async function exhaustedReturnRound(live: LiveGame, info: TestInfo) {
    const merchant='E2EMerchant',id='third-home-return';
    await offline(live,merchant);
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
}

// M26 (live-home-connect.spec.ts): the window's fixture sets the stale worker realm (US II) that the
// headless spawn and the restart must not follow.
async function m26Spawn(live: LiveGame) {
  await expect.poll(async () => await live.admin("output=get_player('E2EMerchant')?.p.home || null"), {timeout:90_000}).toBe('USI');
  await expect.poll(async () => (await live.state()).characters.E2EMerchant?.server, {timeout:90_000}).toBe('USI');
  const before = await live.state();
  expect(before.characters.E2EMerchant.s?.hopsickness).toBeFalsy();
}
async function m26Restart(live: LiveGame, info: TestInfo) {
  const before = await live.state();
  await live.restartCoordinator();
  await expect.poll(async () => (await live.state()).characters.E2EMerchant?.server, {timeout:90_000}).toBe('USI');
  const after = await live.state();
  expect(after.characters.E2EMerchant.s?.hopsickness).toBeFalsy();
  await info.attach('native-home-realm-spawn-restart', {body:JSON.stringify({before,after,staleWorkerRealm:'SR_USII'}),contentType:'application/json'});
}

// M27 (live-home-realm.spec.ts 'home realm change confirms every active character including
// merchant'), with M26's reads around it.
async function homeRealmRound(live: LiveGame, page: Page, info: TestInfo) {
  page.setDefaultTimeout(20_000);
  const pageErrors: string[] = [];
  const reads:Array<{at:number;url:string;status?:number;failure?:string}>=[];
  page.on('response',response=>{if(response.url().includes('/party-api/state')&&reads.length<128)reads.push({at:Date.now(),url:response.url(),status:response.status()});});
  page.on('requestfailed',request=>{if(request.url().includes('/party-api/')&&reads.length<128)reads.push({at:Date.now(),url:request.url(),failure:request.failure()?.errorText});});
  page.on('pageerror', error => pageErrors.push(error.message));
  const names = ['E2EWarrior', 'E2EPriest', 'E2EMerchant'];
  const accountNames = [...names, 'E2EBankBoi'];
  const homePlanning: unknown[] = [];
  let guardedPage: typeof page | undefined;
  try {
    // Native admission permits only one merchant. A managed merchant can be
    // paused and restored while the offline storage merchant changes its home.
    await headlessMerchant(live);
    await m26Spawn(live);
    await expect.poll(async () => (await live.state()).characters.E2EMerchant?.runtime, {timeout:90_000}).toBe('headless');
    const seeded = await live.admin(`output=(async()=>{let matched=0;for(const name of ${JSON.stringify(accountNames)}) {
      const p=get_player(name); if(p){p.p.home='USII'; delete p.p.dt.last_homeset;}
      const result=await db.collection('character').updateOne({'info.name':name},{$set:{'info.p.home':'USII'},$unset:{'info.p.dt.last_homeset':''}});
      matched+=result.matchedCount;
    } return matched;})()`);
    expect(seeded).toBe(accountNames.length);
    // The server seed changes native player/DB state, but existing clients retain
    // their previous home until a real login sends a fresh character snapshot.
    // That login reports home US II while the party stands on US I, so the Steam
    // restore asks Switch or Stay; the row stays, and the home change below moves it.
    await live.reconnectClient('E2EWarrior', { realmChoice: 'stay' });
    await live.restartCoordinator();
    await expect.poll(async () => (await live.state()).realmControl?.homeRealm, {timeout:30_000}).toBe('SR_USII');
    await freshParticipants(live, names);
    // Failure inventory: native set_home has no location prerequisite. A route
    // outage must not fail account home changes or replay the cooldown mutation.
    // Reject only this participant's planning during the current home operation;
    // keep native home receipts, status and persistence completely unmodified.
    guardedPage = live.clients.E2EPriest.page;
    await guardedPage.route('**/party-api/movement-plan', async route => {
      const body = route.request().postDataJSON();
      const operation = (await live.state()).realmControl?.operation;
      if (body.character === 'E2EPriest' && operation?.phase === 'setting-home' &&
          operation.homeExecutors?.includes('E2EPriest')) {
        homePlanning.push({at:Date.now(),operation:operation.id,request:body});
        await route.abort('timedout');
      } else await route.continue();
    });
    await page.goto(live.url);
    // The real dashboard deliberately pauses queries while hidden. Interact
    // with its foreground page, as a user does after the native clients open.
    await page.bringToFront();
    // SSR buttons can appear before the React event handlers hydrate. Repeating
    // this idempotent open action verifies the dialog rather than losing a click.
    await expect(async () => {
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      if (!await settings.isVisible()) await page.getByRole('button', {name:'Interface settings',exact:true}).click();
      await expect(settings).toBeVisible({timeout:1000});
    }).toPass({timeout:20_000});
    await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('tab', { name: 'Realm', exact: true }).click();
    const destination=page.getByRole('option', {name:/US I \(/});
    const picker=page.getByLabel('Change realm', {exact:true});
    await expect(async()=>{
      // A late client/data update can close the popup between observation and
      // click. Retry only this idempotent UI selection, before any realm action.
      if(!/\bSR_USI\b/.test(await picker.textContent()||'')){
        await page.bringToFront();
        if(!await destination.isVisible())await picker.click();
        await destination.click({timeout:1000});
      }
      await expect(picker).toContainText(/\bSR_USI\b/,{timeout:1000});
    }).toPass({timeout:20_000});
    await page.getByRole('button', {name:'Change realm',exact:true}).click();
    await page.getByText('Set as home realm', {exact:true}).click();
    const modal = page.getByRole('dialog', {name:'Change home realm?',exact:true});
    await expect(modal).toContainText('This will change for all characters in the account including characters not currently logged in.');
    await expect(modal.getByRole('button', {name:'Cancel',exact:true})).toBeVisible();
    await info.attach('account-home-confirmation', {body:await page.screenshot(),contentType:'image/png'});
    // Set home goes from where the character stands, so the
    // merchant makes no walk before `set_home`. The headless merchant stands on its home realm, US II,
    // while the party is on US I, so the change can move it between realms by a fresh login, which is
    // no walk. Its walk record is its own reports up to its confirmed home: two reports in a row on
    // one realm and map stand on one spot.
    const walk: {at:number;server?:string;map?:string;x:number;y:number;confirmed:boolean}[] = [];
    const sample = async () => {
      const state = await live.state(), merchant = state.characters.E2EMerchant;
      const entry = state.realmControl?.operation?.characters?.find((character:any)=>character.name==='E2EMerchant');
      walk.push({at:Date.now(),server:merchant?.server,map:merchant?.map,x:Math.round(Number(merchant?.x)),y:Math.round(Number(merchant?.y)),confirmed:!!entry?.homeConfirmed});
      return state.realmControl?.operation?.phase;
    };
    await sample();
    await modal.getByRole('button', {name:'Change home realm',exact:true}).click();
    await expect.poll(sample, {timeout:120_000, intervals:[250]}).toBe('complete');
    await info.attach('merchant-walk-before-set-home', {body:JSON.stringify(walk),contentType:'application/json'});
    const beforeHome = walk.slice(0, Math.max(1, walk.findIndex(entry=>entry.confirmed)));
    const steps = beforeHome.slice(1).filter((entry, index) => entry.server && entry.server === beforeHome[index]!.server &&
      entry.map === beforeHome[index]!.map && Math.hypot(entry.x - beforeHome[index]!.x, entry.y - beforeHome[index]!.y) > 10);
    expect(steps, 'The merchant walks nowhere before its set_home').toEqual([]);
    const state = await live.state();
    expect(state.realmControl.operation.characters.filter((entry:any)=>entry.homeConfirmed).map((entry:any)=>entry.name).sort()).toEqual([...accountNames].sort());
    const native = await live.admin(`output=Object.fromEntries(${JSON.stringify(names)}.map(name=>[name,get_player(name).p.home]))`);
    expect(native).toEqual(Object.fromEntries(names.map(name=>[name,'USI'])));
    expect(state.realmControl.homeCharacters.every((entry:any)=>entry.home==='SR_USI')).toBe(true);
    const database = await live.admin(`output=(async()=>{const homes={};for(const name of ['E2EBankBoi']){
      const record=await db.collection('character').findOne({'info.name':name});homes[name]=record.info.p.home;
    }return homes;})()`);
    expect(database).toEqual({E2EBankBoi:'USI'});
    expect(homePlanning, 'Native home setting must not depend on a walking route').toEqual([]);
    const homeReceipts = async () => Promise.all(['E2EWarrior','E2EPriest'].map(async name => ({
      name, receipts:(await live.clients[name].events()).filter((event:any) =>
        event.at >= state.realmControl.operation.startedAt && event.event === 'game_response' && event.data?.place === 'set_home'),
    })));
    await expect.poll(async () => (await homeReceipts()).map(entry => entry.receipts.map((event:any) => event.data)),
      {timeout:15_000,message:'Each native participant must receive exactly one successful home mutation receipt'})
      .toEqual(['E2EWarrior','E2EPriest'].map(() => [{home:'USI',success:true,response:'home_set',place:'set_home'}]));
    await info.attach('native-home-mutation-receipts', {body:JSON.stringify(await homeReceipts()),contentType:'application/json'});
    await info.attach('native-account-home-realms', {body:JSON.stringify({native,database,state:state.realmControl}),contentType:'application/json'});
    // A set home the game refuses sets the party's realm
    // back. The game refuses `set_home` for 36 h after the last one (server.js `sh_time`), so the
    // merchant's refusal is the game's, not planted in the console.
    await live.admin(`output=(async()=>{const p=get_player('E2EMerchant');p.p.dt.last_homeset=new Date();
      await db.collection('character').updateOne({'info.name':'E2EMerchant'},{$set:{'info.p.dt.last_homeset':new Date()}});return true})()`);
    const refused = await live.post('/realm/switch', {realm:'SR_USII',setHome:true});
    await expect.poll(async () => {
      const operation = (await live.state()).realmControl?.operation;
      return operation?.id === refused.operation.id && ['failed', 'complete'].includes(operation.phase) ? operation.phase : null;
    }, {timeout:180_000}).toBe('failed');
    const failed = await live.state();
    expect(failed.realmControl.activeRealm).toBe('SR_USI');
    expect(await live.admin(`output=get_player('E2EMerchant').p.home`)).toBe('USI');
    await info.attach('failed-set-home-rolls-back', {body:JSON.stringify(failed.realmControl),contentType:'application/json'});
    await m26Restart(live,info);
  } catch (error) {
    await info.attach('home-realm-dashboard-readiness',{body:JSON.stringify({reads,browser:await page.evaluate(()=>{
      const clock=(window as any).__e2eChronalClock;
      return {hidden:document.hidden,visibility:document.visibilityState,at:Date.now(),clock:clock&&{now:clock.now(),state:clock.state,join:clock.join,errors:clock.errors}};
    }).catch(String)}),contentType:'application/json'});
    const screenshot = await page.screenshot({timeout:10_000}).catch(()=>null);
    if (screenshot) await info.attach('home-realm-dashboard-failure', {body:screenshot,contentType:'image/png'}).catch(()=>{});
    throw error;
  } finally {
    await guardedPage?.unrouteAll({behavior:'wait'});
    await info.attach('home-realm-planner-dependency', {body:JSON.stringify(homePlanning),contentType:'application/json'});
    await info.attach('home-realm-dashboard-errors', {body:JSON.stringify(pageErrors),contentType:'application/json'});
  }
}

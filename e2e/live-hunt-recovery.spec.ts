import { test, expect } from './live-fixtures';
import { warrior as W, priest as P, fighters, world, tokens, profile, party, quests, start, artifact } from './game/hunt-lifecycle';

test('native Hunt fallback arrival releases farming instead of repeatedly restarting travel',async({live},info)=>{
  test.setTimeout(240_000);
  await party(live);
  await quests(live,info,{[W]:{count:100},[P]:{count:100}});
  await live.clients[W].run(`(()=>{
    const generation=globalThis.__partyRuntimeGeneration;
    const excludedConvoy=sharedRoutine.combatTraceSnapshot().convoy;
    const fault=globalThis.__e2eFallbackStop={generation,issued:0,receipt:null,timeout:setTimeout,drift:null,boundary:null,
      detailDescriptor:Object.getOwnPropertyDescriptor(globalThis,'__partyNavigationDetail'),detailValue:globalThis.__partyNavigationDetail};
    // An already stopped actor can skip settlement entirely. At this owned
    // rendezvous boundary, send a real zero-distance native move: the native
    // client marks it moving until physics settles, without changing position.
    // This guarantees the wait exists; no character flag or report is fabricated.
    Object.defineProperty(globalThis,'__partyNavigationDetail',{configurable:true,enumerable:true,
      get(){return fault.detailValue;},set(value){
        fault.detailValue=value;
        if(value!=='rendezvous'||fault.boundary||!fault.receipt||globalThis.__partyRuntimeGeneration!==generation)return;
        const convoy=sharedRoutine.combatTraceSnapshot();
        if(convoy.convoy===fault.receipt.owner.convoyId||convoy.convoyPhase!=='rendezvous'||convoy.cancelled)return;
        const boundary=fault.boundary={convoy:convoy.convoy,epoch:convoy.convoyEpoch,wasMoving:!!character.moving,
          from:{map:character.map,x:character.real_x,y:character.real_y}};
        try{
          Promise.resolve(move(character.real_x,character.real_y)).then(result=>{boundary.result=result;},error=>{boundary.result={error:String(error?.reason||error)};});
          boundary.pending=!!character.moving;
        }catch(error){boundary.error=String(error);}
      }});
    // A native position update can arrive after the leader's initial origin
    // check, while rendezvous waits for movement/cruise speed to settle. Deliver
    // one real walk during that owned wait; leave status and other timers live.
    fault.wrappedTimeout=function(callback,delay,...args){
      const convoy=sharedRoutine.combatTraceSnapshot();
      if(delay!==80||fault.drift||!fault.receipt||globalThis.__partyRuntimeGeneration!==generation||
          convoy.convoy===fault.receipt.owner.convoyId||convoy.convoyPhase!=='rendezvous')
        return fault.timeout.call(globalThis,callback,delay,...args);
      const drift=fault.drift={convoy:convoy.convoy,epoch:convoy.convoyEpoch};
      return fault.timeout.call(globalThis,async()=>{
        const current=sharedRoutine.combatTraceSnapshot();
        if(globalThis.__partyRuntimeGeneration!==generation||current.convoy!==drift.convoy||current.convoyEpoch!==drift.epoch){
          drift.error='Rendezvous owner changed before native walk';return callback(...args);
        }
        drift.from={map:character.map,x:character.x,y:character.y};
        const to={x:character.x,y:character.y+80};
        if(!can_move_to(to.x,to.y)){drift.error='Native drift destination is unwalkable';return callback(...args);}
        try{await xmove(to.x,to.y);drift.arrived={map:character.map,x:character.x,y:character.y};}
        catch(error){drift.error=String(error);}
        callback(...args);
      },delay);
    };
    globalThis.setTimeout=fault.wrappedTimeout;
    fault.timer=setInterval(()=>{
      if(fault.issued || globalThis.__partyRuntimeGeneration!==generation)return;
      const service=globalThis.__partyMovement,journey=service?.report(),owner=journey?.owner;
      const convoy=sharedRoutine.combatTraceSnapshot();
      const revision=globalThis.__partyNavigationIntent?.revision;
      if(convoy.convoy===excludedConvoy || !journey || !owner || !Number.isFinite(owner.commandId) || !Number.isFinite(owner.navigationRevision) || !service.state.moving || !character.moving || character.c?.town || parent.transporting ||
          convoy.convoyPhase!=='travelling' || owner.convoyId!==convoy.convoy || owner.epoch!==convoy.convoyEpoch ||
          owner.navigationRevision!==revision || convoy.cancelled)return;
      const runtime=sharedRoutine.queueReport().combatSelection.runtimeId;
      if(!journey.id.startsWith(character.name+':'+runtime+':'))return;
      fault.issued=1;clearInterval(fault.timer);
      fault.receipt={at:Date.now(),map:character.map,x:character.x,y:character.y,
        smartMoving:service.state.moving,moving:character.moving,transporting:!!parent.transporting,
        generation,runtime,journeyId:journey.id,owner:{...owner},phase:convoy.convoyPhase,excludedConvoy};
      try{Promise.resolve(stop('smart')).then(()=>{fault.receipt.stopCompletedAt=Date.now();},error=>{fault.receipt.stopError=String(error);});}
      catch(error){fault.receipt.stopError=String(error);}
    },50);
  })()`);
  try{
    await start(live);
    await expect.poll(async()=>await live.clients[W].run('globalThis.__e2eFallbackStop?.issued===1'),
      {timeout:90_000,intervals:[50,100],message:'Interrupt a genuine native Hunt walking route'}).toBe(true);
    const interrupted=await live.clients[W].run('globalThis.__e2eFallbackStop.receipt');
    expect(interrupted.smartMoving).toBe(true);expect(interrupted.moving).toBe(true);
    expect(interrupted.transporting).toBe(false);expect(interrupted.phase).toBe('travelling');
    expect(interrupted.stopError).toBeUndefined();
    await info.attach('native-route-stop',{body:JSON.stringify(interrupted),contentType:'application/json'});
  await expect.poll(async()=>Object.values(profile(await live.state()).monsterHunt?.routeRecovery||{}).some((entry:any)=>entry.phase==='native'),
    {timeout:30_000,message:'The real route interruption must activate the bounded native fallback'}).toBe(true);
  const recovering=profile(await live.state()).monsterHunt;
  await expect.poll(async()=>(await world(live))[W].quest?.c,
    {timeout:120_000,message:'Successful fallback arrival must release actual Hunt combat'}).toBeLessThan(100);
  const firstKills=await world(live);
  await expect.poll(async()=>(await world(live))[W].quest?.c,
    {timeout:30_000,message:'Farming must continue after the first kills without restarting the completed route'}).toBeLessThan(firstKills[W].quest.c);
  const finalState=await live.state(), finalHunt=profile(finalState).monsterHunt;
  expect(finalHunt.cycleId).toBe(recovering.cycleId);
  expect(finalHunt.routeRecovery,'Successful arrival must retain the spent retry budget').toEqual(recovering.routeRecovery);
  const {drift,boundary}=await live.clients[W].run('({drift:globalThis.__e2eFallbackStop.drift,boundary:globalThis.__e2eFallbackStop.boundary})');
  expect(drift).toBeTruthy();expect(drift.error).toBeUndefined();
  expect(boundary.pending).toBe(true);expect(boundary.error).toBeUndefined();
  expect({convoy:boundary.convoy,epoch:boundary.epoch}).toEqual({convoy:drift.convoy,epoch:drift.epoch});
  expect(drift.arrived.map).toBe(drift.from.map);
  expect(Math.hypot(drift.arrived.x-drift.from.x,drift.arrived.y-drift.from.y)).toBeGreaterThan(55);
  await artifact(live,info,'native-fallback-arrival-and-continuing-kills',{interrupted,recovering,firstKills});
  }finally{
    const fault=await live.clients[W].run(`(()=>{const fault=globalThis.__e2eFallbackStop;if(fault){clearInterval(fault.timer);if(globalThis.setTimeout===fault.wrappedTimeout)globalThis.setTimeout=fault.timeout;
      if(fault.detailDescriptor)Object.defineProperty(globalThis,'__partyNavigationDetail',{...fault.detailDescriptor,value:fault.detailValue});
      else{delete globalThis.__partyNavigationDetail;globalThis.__partyNavigationDetail=fault.detailValue;}}
      return fault?{generation:fault.generation,issued:fault.issued,receipt:fault.receipt,drift:fault.drift,boundary:fault.boundary}:null;})()`);
    await info.attach('native-fallback-stop-ledger',{body:JSON.stringify(fault),contentType:'application/json'});
  }
});

// Faults exercise the actual browser transport; no status, route or acknowledgement is fabricated.
for (const fault of ['completion-request', 'completion-response', 'follower-reconnect'] as const) {
  test(`native Hunt survives ${fault} loss and both owners receive exactly one Daisy reward`, async ({ live }, info) => {
    test.setTimeout(300_000);
    await party(live);
    const questCount = fault === 'follower-reconnect' ? 12 : 3;
    // Disconnected characters do not receive native party kill credit. Keep the
    // follower's initial quest complete in the reconnect scenario so it tests
    // ownership recovery and both turn-ins, not credit for kills while offline.
    await quests(live, info, { [W]: { count: questCount }, [P]: { count: fault==='follower-reconnect'?0:questCount } });
    const before = await world(live);
    const faults: unknown[] = [];
    let intercepted = false;
    const context = live.clients[W].page.context();
    const rendezvousReports: unknown[] = [];
    const inspectStatus = (request: import('@playwright/test').Request) => {
      if (fault !== 'follower-reconnect' || request.method() !== 'POST' || !request.url().endsWith('/party-api/status')) return;
      const body = request.postDataJSON();
      if (body.name === P && body.convoyNavigation?.phase === 'rendezvous') rendezvousReports.push({ at: Date.now(), report: body.convoyNavigation });
    };
    context.on('request', inspectStatus);
    if (fault !== 'follower-reconnect') {
      await context.route('**/party-api/convoy-complete', async route => {
        const packet = route.request().postDataJSON();
        if (intercepted || packet.character !== P) return route.fallback();
        intercepted = true;
        if (fault === 'completion-response') {
          const response = await route.fetch();
          faults.push({ fault, packet, acceptedResponse: await response.json() });
        } else faults.push({ fault, packet });
        await route.abort('connectionreset');
      });
    }
    await start(live);
    await expect.poll(async () => profile(await live.state()).monsterHunt?.cycleId).toBeTruthy();
    const cycle = profile(await live.state()).monsterHunt.cycleId;
    if (fault === 'follower-reconnect') {
      let travelling: unknown;
      await expect.poll(async () => {
        const state = await live.state(), hunt = profile(state).monsterHunt, convoy = profile(state).activeConvoy;
        const member = state.characters[P], report = member?.convoyNavigation;
        const owned = hunt?.cycleId === cycle && hunt.stage === 'mission-travel' && convoy?.id === hunt.convoyId &&
          convoy.phase === 'travel' && member.moving && report?.phase === 'travelling' && report.id === convoy.id &&
          report.epoch === convoy.epoch && report.runtimeId === member.combatSelection?.runtimeId;
        if (owned) travelling = { at: Date.now(), convoy: convoy.id, epoch: convoy.epoch, report };
        return !!owned;
      }, {timeout:120_000,message:'Reconnect must interrupt the follower’s current native Hunt route'}).toBe(true);
      const beforeReconnect = await world(live);
      const previousRuntime = (await live.state()).characters[P]?.combatSelection?.runtimeId;
      expect(previousRuntime).toBeTruthy();
      expect(beforeReconnect[W].quest?.c, 'Disconnect must interrupt an unfinished native Hunt').toBeGreaterThan(0);
      faults.push({ fault, beforeReconnect, travelling });
      await live.reconnectClient(P);
      expect((await live.clients[P].snapshot()).name).toBe(P);
      await expect.poll(async () => {
        const runtime = (await live.state()).characters[P]?.combatSelection?.runtimeId;
        return !!runtime && runtime !== previousRuntime;
      }, {timeout:30_000,message:'The coordinator must observe the reconnected follower runtime'}).toBe(true);
      await expect.poll(async () => (await world(live))[W].quest?.c, { timeout: 120_000 }).toBeLessThan(questCount);
    } else await expect.poll(() => intercepted, { timeout: 120_000 }).toBe(true);
    await expect.poll(async () => {
      const current = await world(live);
      return fighters.every(name => tokens(current[name]) === tokens(before[name]) + 1);
    }, { timeout: 180_000 }).toBe(true);
    if (fault === 'follower-reconnect') {
      // A follower still at the group can recover directly without a rendezvous
      // leg. When it does need that leg, its actual reports must identify it.
      expect(rendezvousReports.every((entry: any) => entry.report.routeVersion > 0), 'Rendezvous must publish its issued route version before awaiting native travel').toBe(true);
    }
    await live.post('/farming-mode', { character: W, mode: 'default' });
    await live.restartCoordinator();
    const after = await world(live);
    for (const name of fighters) expect(tokens(after[name])).toBe(tokens(before[name]) + 1);
    context.off('request', inspectStatus);
    await artifact(live, info, 'hunt-native-communication-recovery', { cycle, before, faults, rendezvousReports });
  });
}

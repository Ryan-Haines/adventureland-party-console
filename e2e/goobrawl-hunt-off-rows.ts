// The Hunt-off Goobrawl plays of e2e/live-game.spec.ts at 21fe30a2b (C11, C12). The Goobrawl
// windows run them (test-windows DESIGN.md 2.2 W34, W35).
import { expect, type LiveGame } from './live-fixtures';
import type { TestInfo } from '@playwright/test';
import { seedSmallGoobrawl } from './game/event-scenario';
import { warrior as W, priest as P, observed, evidence, party, seedQuest, start, hunt } from './game/hunt-lifecycle';

export async function huntOffEventPlay({ live }: {live: LiveGame}, info: TestInfo, joining: boolean){
    const encounter = await seedSmallGoobrawl(live);
    await info.attach('goobrawl-initial-encounter', { body: JSON.stringify(encounter), contentType: 'application/json' });
    await party(live);
    await seedQuest(live, 'goo', 30);
    await start(live);
    await live.post('/formation', { character: W, eventSelections: ['goobrawl'] });
    await live.admin(`events.goobrawl=true;delete timers.goobrawl;output=true`);
    await expect.poll(async () => { const state=await observed(live);return (joining ? [W] : [W,P]).every(name=>state[name].map==='goobrawl'); }, { timeout: 90_000 }).toBe(true);
    const atCancellation = await observed(live);
    await live.post('/farming-mode', { character: W, mode: 'default' });
    // Cancelling Hunt must preserve the already-authorized party event entry.
    await expect.poll(async () => { const state=await observed(live);return [W,P].every(name=>state[name].map==='goobrawl'); }, { timeout: 90_000 }).toBe(true);
    const remainingArenaIds:string[]=await live.admin(`output=Object.values(instances.goobrawl.monsters).filter(m=>!m.dead&&m.hp>0).map(m=>String(m.id))`);
    await live.admin(`timers.goobrawl=new Date(0);output=true`);
    // Failure inventory: timer expiry does not remove native survivors. Their
    // real combat can consume the evacuation budget before return is admitted.
    // Observe completion of that distinct native phase before timing transport.
    await expect.poll(async()=>({monsters:await live.admin(`output=Object.values(instances.goobrawl.monsters).filter(m=>!m.dead&&m.hp>0).length`),huntActive:!!hunt(await live.state())}),
      {timeout:120_000,message:'Hunt cancellation must retain native event combat until the remaining arena monsters die'}).toEqual({monsters:0,huntActive:false});
    const nativeCombat=(await Promise.all([W,P].map(name=>live.clients[name].events()))).flat();
    if(remainingArenaIds.length)expect(nativeCombat.some((event:any)=>remainingArenaIds.includes(String(event.data?.id))&&
      (event.event==='death'||event.event==='hit'&&event.data?.kill)),
      'Cancelled Hunt must still kill an observed surviving event monster').toBe(true);
    await info.attach('hunt-off-native-survivor-completion',{body:JSON.stringify({remainingArenaIds,hunt:hunt(await live.state())||null}),contentType:'application/json'});
    await expect.poll(async () => { const state=await observed(live);return [W,P].every(name=>state[name].map==='main'); }, { timeout: 120_000 }).toBe(true);
    expect(hunt(await live.state())).toBeFalsy();
    await evidence(live, info, 'event-exit-with-hunt-off', { joining, atCancellation });
  }

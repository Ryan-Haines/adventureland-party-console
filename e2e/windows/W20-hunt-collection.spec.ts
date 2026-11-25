import {expect, type LiveGame} from '../live-fixtures';
import {liveWindow, type LiveWorld} from '../windows';
import {prepareHunt, start} from '../game/hunt-lifecycle';
import {W, P, M, fighters, hunt, observed, reward, seedCargo, totalLeather, evidence, quantity, killNativeCharacter} from '../hunt-interruption-helpers';
import {taskTrail} from '../task-records';

// W20 Hunt with merchant collection and merchant death (test-windows DESIGN.md 2.2 W20). One play:
// the merchant stands at the market, the party Hunts armadillo with a marked leather stack on the
// warrior, and the player asks the merchant to collect; the visit queues behind the stand; the
// stand is lifted, the merchant's job interrupts the Hunt walk, and the merchant is killed on its
// way; it respawns and the coordinator restarts while the job is still live; the merchant
// collects and the Hunt rewards. Then the party walks east to (700, 0) with marked leather on both
// fighters, the walk record is replaced with an exhausted failed walk, the merchant collects from
// both, and the coordinator restarts.
// T31's queued job and T32's active job share the one merchant death (catalog T31: "run the death
// once while the job is live"). The restart after the respawn is T30's restart during a live
// collection, and the restart at the end is the "further restart" T30-T32 read the totals across.
// H14's failed walk comes after the Hunt rewards: a failed record written over the Hunt's own walk
// would end the walk the merchant's job interrupts for T30 and T32.
// Failure modes: T30, a restart during a collection loses or doubles the cargo or the trip; T31, a
// queued visit is lost when the merchant dies; T32, a merchant killed on its way does not come
// back and finish; T30-T32, the merchant joins a party walk or its job is not a merchant task;
// H14, an exhausted failed walk stops the collection or the collection restarts that walk.
// Each check's assertions are its old test's, with their messages, so the coverage ledger matches
// them. A failed step records its message under each check it serves and the play goes on.
const failed: Record<string, string> = {}, reads: Record<string, any> = {};
const step = async (ids: string[], run: () => Promise<unknown>) => {
  try { await run(); } catch (error) { for (const id of ids) failed[id] ??= String((error as Error)?.message ?? error).slice(0, 2000); }
};
const standing = (live: LiveGame, enabled: boolean) => live.post('/merchant/force-stand', {enabled});
// seedCargo's fixed cell 10 may hold Hunt loot by the second collection, so the loot moves to a
// free cell of the same bag first and every count stays whole.
const freeCell = (live: LiveGame, name: string, cell: number) => live.admin(`output=(()=>{const p=get_player(${JSON.stringify(name)});if(!p.items[${cell}])return true;
  const to=p.items.findIndex((i,n)=>!i&&n!==${cell}&&n<p.isize-1);if(to<0)throw Error('no free cell for '+${cell});p.items[to]=p.items[${cell}];p.items[${cell}]=null;cache_player_items(p);resend(p,'reopen+cid');return true;})()`);

async function huntCollection({live, info}: LiveWorld) {
  // The stand holds the visit in the queue (T31) until the play lifts it.
  await standing(live, true);
  live.undo('the merchant force stand', () => standing(live, false));
  const setup={...await prepareHunt(live,{monster:'armadillo',count:1}),before:await observed(live)};await seedCargo(live);
  const total=await totalLeather(live);
  reads.total = total;
  await start(live,W,setup.monster,setup.location);
  await expect.poll(async()=>{const s=await live.state();return hunt(s)?.stage==='mission-travel'&&!!s.activeConvoy;},{timeout:90000}).toBe(true);
  const cycle=hunt(await live.state()).cycleId;
  reads.cycle = cycle;
  await live.post('/bank-party',{});
  await step(['T31'], async () => {
    await expect.poll(async()=>(await live.state()).merchantQueue.length,{timeout:20000}).toBeGreaterThan(0);
  });
  await standing(live, false);
  await step(['T30', 'T32'], async () => {
    await expect.poll(async()=>!!(await live.state()).merchantCurrent,{timeout:90000}).toBe(true);
    await expect.poll(async()=>{const s=await live.state();return !!s.activeConvoy?.merchantInterruption||s.commands?.[W]?.type==='merchant-handoff';},
      {timeout:90000,intervals:[100,250],message:'Native collection must actually interrupt the owned Hunt convoy before fault injection'}).toBe(true);
  });
  await evidence(live,info,'hunt-merchant-owned-before-fault',{total,cycle,destination:setup.location});
  // The merchant dies on its way to the warrior, with the job live.
  await step(['T31', 'T32'], async () => {
    const death=await killNativeCharacter(live,M);
    await info.attach('native-merchant-death',{body:JSON.stringify(death,null,2),contentType:'application/json'});
    await expect.poll(async()=>(await observed(live))[M].rip,{timeout:15000}).toBe(true);
    await expect.poll(async()=>{const m=(await observed(live))[M];return !m.rip&&m.hp>0;},{timeout:120000}).toBe(true);
  });
  // T30's restart lands while the collection is still to do: a job is held and the warrior keeps
  // its stack.
  const before = await live.state();
  reads.restartDuring = {job: before.merchantCurrent?.id ?? before.merchantQueue?.[0]?.id ?? null, leather: quantity((await observed(live))[W].items, 'leather')};
  await live.restartCoordinator();
  await step(['T30'], async () => {
    expect(reads.restartDuring.job, 'the restart lands while the merchant job is live').toBeTruthy();
    expect(reads.restartDuring.leather, 'the restart lands before the merchant collects').toBeGreaterThan(0);
  });
  await step(['T30', 'T31', 'T32'], async () => {
    // The stand and the death can outlast this one-quest Hunt, so a new cycle passes only when both
    // owners were rewarded.
    const continued=hunt(await live.state());
    if(continued?.cycleId!==cycle) {
      const completed=await observed(live);
      expect(fighters.every(name=>quantity(completed[name].items,'monstertoken')===quantity(setup.before[name].items,'monstertoken')+1),
        'A queued merchant may outlive this Hunt only after both original owners actually received their rewards').toBe(true);
      await live.post('/farming-mode',{character:W,mode:'default'});
    } else expect(continued?.cycleId).toBe(cycle);
  });
  // The merchant is never in a party convoy, and its job is the merchant group's own task. The
  // rendezvous samples are T32's trace of the walk back to the warrior.
  const rendezvousSamples:any[]=[];let lastRendezvousSample=0;
  const merchantInConvoy:any[]=[];let jobTask=false;
  await step(['T30', 'T31', 'T32'], async () => {
    try{await expect.poll(async()=>{
      const native=await observed(live),coordinator=await live.state();
      if(coordinator.activeConvoy?.participants?.includes(M))merchantInConvoy.push({at:Date.now(),convoy:coordinator.activeConvoy.purpose});
      jobTask||=(await taskTrail(live,`merchant:${M}`,0)).trail.some(([,k])=>k==='merchant-job');
      if(Date.now()-lastRendezvousSample>=1000){
        lastRendezvousSample=Date.now();let client:any;
        try{client=await live.clients[M].run(`(()=>{const t=get_player('E2EWarrior');
          return {character:{map:character.map,in:character.in,x:character.real_x,y:character.real_y,rip:character.rip,moving:character.moving},
            target:t&&{map:t.map,in:t.in,x:t.real_x??t.x,y:t.real_y??t.y,rip:t.rip,visible:t.visible},
            distance:t?Math.hypot((t.real_x??t.x)-character.real_x,(t.real_y??t.y)-character.real_y):null,
            commandId:globalThis.__partyLastCommand,activeJob:globalThis.__merchantHolder,navigationIntent:globalThis.__partyNavigationIntent};})()`);}
        catch(error){client={observationError:String(error)};}
        if(rendezvousSamples.length===96)rendezvousSamples.splice(64,1);
        rendezvousSamples.push({at:lastRendezvousSample,server:Object.fromEntries([W,M].map(name=>[name,{...native[name],items:undefined}])),client});
      }
      return quantity(native[W].items,'leather');
    },{timeout:180000,message:'The native merchant must actually collect the marked stack'}).toBe(0);}
    finally{await info.attach('native-merchant-recovery-rendezvous-samples',{body:JSON.stringify({cycle,total,rendezvousSamples}),contentType:'application/json'});}
    expect(merchantInConvoy,'the merchant in a party convoy').toEqual([]);
    expect(jobTask,'the collection is a merchant group job task').toBe(true);
    await expect.poll(async()=>{const s=await live.state();return !s.merchantCurrent&&!s.merchantQueue.length&&!s.merchantMarked?.[W]?.length;},{timeout:180000}).toBe(true);
    expect(await totalLeather(live)).toBe(total);
    await reward(live,setup.before);
  });

  // H14: a walk east, its record replaced with an exhausted failed walk, then a collection from
  // both fighters. The stand keeps the merchant from leaving before the record is planted.
  await standing(live, true);
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  for (const name of fighters) await freeCell(live, name, 10);
  await seedCargo(live,W);
  await seedCargo(live,P);
  const failure='Declared exhausted native travel';
  {
    const total=await totalLeather(live);
    reads.h14Total = total;
    await live.post('/travel',{map:'main',x:700,y:0});
    await expect.poll(async()=>!!(await live.state()).activeConvoy,{timeout:15000}).toBe(true);
    const convoy=structuredClone((await live.state()).activeConvoy);
    await live.restoreHistoricalSettings(settings=>{
      const failed={...convoy,phase:'failed',failure,failureCode:'route-failed',retryExhausted:true,
        purpose:'shared-walk',label:'event walking leg',walkingActivity:'event',walkingEvent:'mrgreen',
        walkingParents:Object.fromEntries(fighters.map(name=>[name,{revision:convoy.expected[name].revision,parentId:0}])),
        recoveryAttempts:3,failedAt:Date.now(),departAt:null};
      return {activeConvoy:failed,farmingProfiles:{...settings.farmingProfiles,
        [W]:{...settings.farmingProfiles[W],activeConvoy:failed}}};
    });
    await expect.poll(async()=>{const s=await live.state();return s.activeConvoy?.phase==='failed'&&
      fighters.every(name=>s.characters[name]?.seenAt>Date.now()-3000&&!s.characters[name]?.moving);},{timeout:20000}).toBe(true);
    await evidence(live,info,'failed-convoy-before-collection',{total,convoy});
    await live.post('/bank-party',{group:W});
    await standing(live, false);
    await step(['H14'], async () => {
      await expect.poll(async()=>{const players=await observed(live);return fighters.every(name=>quantity(players[name].items,'leather')===0);},
        {timeout:90000,message:'Both native marked stacks must transfer despite exhausted travel'}).toBe(true);
      await expect.poll(async()=>{const s=await live.state();return !s.merchantCurrent&&!s.merchantQueue.length&&!s.activeConvoy?.merchantInterruption;},{timeout:90000}).toBe(true);
      const state=await live.state();
      // The collection leaves the exhausted walk failed: it never starts the travel again.
      expect(state.activeConvoy.phase).toBe('failed');
      expect(await totalLeather(live)).toBe(total);
      expect(state.merchantActivity.filter((entry:any)=>entry.level==='error'&&String(entry.details).includes('convoy merchant pause'))).toEqual([]);
    });
    await live.restartCoordinator();
    await step(['H14'], async () => {
      const restarted=await live.state();
      expect(restarted.activeConvoy.phase).toBe('failed');
    });
    // The account's leather is the Hunt's stack plus the two seeded here, so this one count is
    // also T30-T32's total across the further restart.
    await step(['H14', 'T30', 'T31', 'T32'], async () => { expect(await totalLeather(live)).toBe(total); });
    await evidence(live,info,'failed-convoy-collected-and-restarted',{total,events:await Promise.all([W,P,M].map(name=>live.clients[name].events()))});
  }
}

const own = (id: string) => ({
  owner: id === 'H14' ? 'movement' : 'merchant', behaviours: [], start() {}, reads: () => ({failed: failed[id] ?? null, reads}),
  verdict() { expect(failed[id], `${id}: every step of the play passes`).toBeUndefined(); },
});

liveWindow({
  id: 'W20', name: 'Hunt with merchant collection and merchant death',
  // The old bounds of the steps the play runs (hunt-rows.ts merchantCollection): 90 s mission
  // travel, 20 s queue, 90 s job, 90 s interruption, 15 s + 15 s + 120 s death and respawn, 180 s
  // stack, 180 s queue drain, 240 s reward; then H14's 240 s test
  // (live-hunt-failed-collection.spec.ts:5 at 21fe30a2b).
  timeoutMs: 1_280_000,
  play: huntCollection,
  observers: [{id: 'T30', ...own('T30')}, {id: 'T31', ...own('T31')}, {id: 'T32', ...own('T32')}, {id: 'H14', ...own('H14')}],
});

import {expect, type LiveGame} from '../live-fixtures';
import type {Response, Route} from '@playwright/test';
import {liveWindow, type LiveWorld} from '../windows';
import {poll, gameplayNow} from '../gameplay-clock';
import {warrior as W, priest as P, fighters, world, tokens, profile, party, quests, start, artifact} from '../game/hunt-lifecycle';

// W15 Boo Boo Hunt through map doors (test-windows DESIGN.md 2.2 W15). One play from the default
// fixture's start: both report the native party, both take a one-kill Boo Boo quest, and the party
// Hunts Boo Boo through the map doors (H17's outbound). Once the kills set up the return checkpoint,
// both fighters' Town goes on a 600 s cooldown and one historical settings write (a coordinator
// start) declares the return walking-only; when the walk moves, both report channels drop until
// the walk holds, then come back inside the 20 s stale bound and the same walk resumes on its
// cached remainder (H18). The party walks on to Daisy, where the warrior claims its token.
// Failure modes: H17, the Hunt never crosses the doors, the kill does not count, or the warrior
// never reaches Daisy or claims; H18, the hold drops a member or does not stop the walk, the
// resumed walk searches a new route or takes a Town step, or the cycle changes across the hold.
// H18 starts on the default fixture rather than at the Boo Boo spawn (its old initialMonsterSpawn),
// so its return leg is H17's: the outbound through the doors is H17's own check.
// Each check's assertions are its old test's, with their messages, so the coverage ledger matches
// them. A failed step records its message under its check and the play goes on.
const failed: Record<string, string> = {}, reads: Record<string, any> = {};
const step = async (id: string, run: () => Promise<unknown>) => {
  try { await run(); return true; } catch (error) { failed[id] ??= String((error as Error)?.message ?? error).slice(0, 2000); return false; }
};

async function booBooPlay({live, info}: LiveWorld) {
  // H17's overall bound (gameplay-scenarios.ts booBoo, 600 s).
  const overallDeadline = gameplayNow(live) + 600_000;
  const remaining = (cap: number) =>
    Math.max(1, Math.min(cap, overallDeadline - gameplayNow(live)));
  await step('H18', async () => {
    const initialClearance=await live.admin(`output=${JSON.stringify(fighters)}.map(name=>{const p=get_player(name);return {name,map:p.map,x:p.x,y:p.y,base:p.base,
      selfClear:can_move({map:p.map,x:p.x,y:p.y,going_x:p.x,going_y:p.y,base:p.base})};})`);
    expect(initialClearance.every((p:any)=>p.selfClear)).toBe(true);
    await info.attach('native-booboo-initial-clearance',{body:JSON.stringify(initialClearance),contentType:'application/json'});
  });
  // The start: the native party, then both one-kill quests. A failure here leaves no Hunt to
  // observe, so it fails the play.
  await party(live);
  let nativeParty:any;
  try {
    await expect.poll(async()=>{
      nativeParty=await live.admin(`output=({at:Date.now(),members:(parties[${JSON.stringify(W)}]||[]).slice(),
        players:${JSON.stringify(fighters)}.map(name=>{const p=get_player(name);return p&&{name,party:p.party,map:p.map,in:p.in,rip:!!p.rip};})})`);
      return nativeParty.members.length===fighters.length&&fighters.every(name=>nativeParty.members.includes(name))&&
        nativeParty.players.every((p:any)=>p&&!p.rip&&p.party===W);
    },{timeout:30_000,message:'Both native party memberships must acknowledge before seeding shared one-kill quests'}).toBe(true);
  } finally {
    await info.attach('native-booboo-party-admission',{body:JSON.stringify(nativeParty??null),contentType:'application/json'});
  }
  await quests(live, info, { [W]: { id: "booboo", count: 1 }, [P]: { id: "booboo", count: 1 } });
  const before = await world(live);
  const destination = await start(live, W, "booboo");
  reads.start = {before: fighters.map(name => ({name, tokens: tokens(before[name])})), destination};

  // H17's progress ring, attached at its reward step.
  const progress: any[] = [];
  const observe = async (phase: string) => {
    const native = await world(live);
    if (progress.length >= 64) progress.shift();
    progress.push({
      at: gameplayNow(live),
      phase,
      participants: Object.fromEntries(
        fighters.map((name) => [
          name,
          {
            map: native[name].map,
            x: native[name].x,
            y: native[name].y,
            quest: native[name].quest,
            tokens: tokens(native[name]),
          },
        ]),
      ),
    });
    return native;
  };
  await step('H17', async () => {
    await poll(live, async () => (await observe("native door arrival"))[W].map, {
      timeout: remaining(240_000),
    }).toBe(destination.map);
  });

  // H18: the kills set up the return checkpoint while the warrior is still on the Boo Boo map.
  const preparation:any[]=[];
  const observeReturn=(s:any)=>{
    preparation.push({at:Date.now(),stage:profile(s).monsterHunt?.stage,message:profile(s).monsterHunt?.message,
      convoy:s.activeConvoy&&{id:s.activeConvoy.id,phase:s.activeConvoy.phase,returnRouting:s.activeConvoy.returnRouting},
      participants:Object.fromEntries(fighters.map(name=>{const c=s.characters[name];return [name,{map:c?.map,x:c?.x,y:c?.y,
        count:c?.monsterHunt?.count,lastAttackAt:c?.combat?.lastAttackAt,lastAttackTarget:c?.combat?.lastAttackTarget}];}))});
    if(preparation.length>64)preparation.splice(32,1);
  };
  const prepared = await step('H18', async () => {
    try{
      await expect.poll(async()=>{
        const current=await world(live),s=await live.state();observeReturn(s);
        return fighters.every(name=>current[name].quest?.c===0)&&profile(s).monsterHunt?.stage==='returning'&&
          s.activeConvoy?.returnRouting&&s.characters[W].map===destination.map;
      },{timeout:300_000,intervals:[100],message:'Real Boo Boo kills must establish the existing return checkpoint'}).toBe(true);
    }finally{
      await info.attach('native-booboo-return-preparation',{body:JSON.stringify({before,destination,preparation,native:await world(live)}),contentType:'application/json'});
    }
  });
  // H17: both quests are still complete, as the party has not reached Daisy yet.
  await step('H17', async () => {
    await poll(
      live,
      async () => {
        const native = await observe("native quest completion");
        return fighters.every((name) => native[name].quest?.c === 0);
      },
      {
        timeout: remaining(300_000),
        message: "Both actual native Boo Boo quests must complete before timing the Daisy return",
      },
    ).toBe(true);
  });

  // H18: the walking return, its communication hold and the resume on the cached remainder.
  let cycle: string | undefined;
  if (prepared) await step('H18', () => walkingReturnHold(live, info, destination, (c) => { cycle = c; }));

  // The reward at Daisy, which both checks read.
  await step('H17', async () => {
    try {
      // The existing reward budget measures the return leg after real kills;
      // native combat cannot consume that budget before return begins.
      await poll(live, async () => tokens((await observe("native Daisy reward"))[W]), {
        timeout: remaining(300_000),
      }).toBe(tokens(before[W]) + 1);
      const events = await live.clients[W].events();
      expect(events.some((entry: any) => entry.event === "hit" && entry.data?.kill)).toBe(true);
      expect((await world(live))[W].map).toBe("main");
    } finally {
      await artifact(live, info, "booboo-native-door-combat-reward", {
        before,
        destination,
        progress,
        overallDeadline,
        loadout: "god",
      });
    }
  });
  await step('H18', async () => {
    await expect.poll(async()=>tokens((await world(live))[W]),{timeout:300_000}).toBe(tokens(before[W])+1);
    expect((await live.clients[W].events()).some((e:any)=>e.event==='hit'&&e.data?.kill)).toBe(true);
    expect((await world(live))[W].map).toBe('main');
    await artifact(live,info,'native-walking-return-cache-reward',{before,destination,cycle,hold:reads.H18??null});
  });
}

// H18's fault block (live-hunt-lifecycle.spec.ts at 21fe30a2b, native Boo Boo walking-return cache). Its
// route and its intercept come off in the finally, so a failed hold never blocks the reward steps.
async function walkingReturnHold(live: LiveGame, info: LiveWorld['info'], destination: {map: string}, setCycle: (cycle: string) => void) {
    const cycle=profile(await live.state()).monsterHunt.cycleId;
    setCycle(cycle);
    // Declared initial client cooldown, using the same native setter as PvP
    // Town delays. This models client unavailability, not a server rejection;
    // it is never refreshed during walking, the fault, recovery or reward.
    const townCooldown=await Promise.all(fighters.map(name=>live.clients[name].run("(()=>{parent.skill_timeout_singular('use_town',600000);return {until:+parent.next_skill.use_town,now:Date.now()};})()")));
    // The cooldown lives on the client page, which the next window may reuse.
    live.undo('the planted Town cooldown', async () => { for (const name of fighters) await live.clients[name].run('(delete parent.next_skill.use_town,true)').catch(() => null); });
    expect(townCooldown.every(value=>Number.isFinite(value.until)&&value.until-value.now>=590000)).toBe(true);
    await info.attach('declared-native-town-cooldown',{body:JSON.stringify(townCooldown),contentType:'application/json'});
    const townReadiness=await Promise.all(fighters.map(name=>live.clients[name].run("can_use('use_town')&&!is_on_cooldown('use_town')")));
    expect(townReadiness.every(ready=>ready===false),'The declared walking recovery starts with verified native Town cooldown').toBe(true);
    await live.restoreHistoricalSettings(settings=>{
      const owner=settings.farmingProfiles[W],hunt=owner.monsterHunt,convoy=owner.activeConvoy||settings.activeConvoy;
      expect(hunt.cycleId).toBe(cycle);expect(convoy.returnRouting).toBe(true);
      expect(convoy.location.map).toBe('main');
      const policy={map:destination.map,interruptions:0,walking:true,blockedReadiness:townReadiness.join(':')};
      hunt.returnDisableTown=true;hunt.returnTown=policy;
      convoy.disableTown=true;convoy.returnTown=policy;convoy.nativeFallback=false;
      return {farmingProfiles:{...settings.farmingProfiles,[W]:owner},monsterHunt:hunt,activeConvoy:convoy};
    });
    let original:any,held:any,resumed:any,blocking=false,interceptInstalled=false;
    const faults:any[]=[],context=live.clients[W].page.context();
    const walkingAdmission:any[]=[],issuedCommands:any[]=[],responseTasks=new Set<Promise<void>>();
    let lastAdmissionAt=0;
    const retain=(entries:any[],entry:any)=>{if(entries.length===128)entries.splice(64,1);entries.push(entry);};
    const responseObserved=(response:Response)=>{
      const request=response.request();
      if(new URL(request.url()).pathname!=='/party-api/status'||request.method()!=='POST')return;
      const report=request.postDataJSON();if(!fighters.includes(report?.name))return;
      const task=response.json().then(body=>{
        const command=body.command;
        if(command?.type!=='party-monster-travel')return;
        retain(issuedCommands,{at:Date.now(),name:report.name,status:response.status(),
          command:{id:command.id,convoyId:command.convoyId,epoch:command.epoch,phase:command.phase,
            navigationRevision:command.navigationRevision,routeVersion:command.routeVersion,
            disableTown:command.disableTown,returnWalking:command.returnWalking,continuousReturn:command.continuousReturn}});
      }).catch(error=>{retain(issuedCommands,{at:Date.now(),name:report.name,error:String(error)});});
      responseTasks.add(task);void task.finally(()=>responseTasks.delete(task));
    };
    context.on('response',responseObserved);
    const intercept=async(route:Route)=>{
      const request=route.request(),body=request.method()==='POST'?request.postDataJSON():null;
      if(blocking&&fighters.includes(body?.name)&&body.combatWait!==true){
        faults.push({at:Date.now(),name:body.name,fast:!!body.combatOnly,sequence:body.travelSample?.sequence});
        await route.abort('failed');return;
      }
      await route.continue();
    };
    const native=()=>Promise.all(fighters.map(name=>live.clients[name].frame.evaluate(()=>{
      const w=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      return {name:w.character.name,map:w.character.map,in:w.character.in,x:w.character.real_x,y:w.character.real_y,
        moving:!!w.character.moving,navigation:w.partyMovement?.convoyNavigationReport?.(),cache:w.__partySharedRouteRemainder,
        townReady:w.can_use('use_town')&&!w.is_on_cooldown('use_town')};
    })));
    try{
      await expect.poll(async()=>{
        const s=await live.state(),c=s.activeConvoy;
        if(Date.now()-lastAdmissionAt>=1000){
          lastAdmissionAt=Date.now();
          retain(walkingAdmission,{at:lastAdmissionAt,convoy:c&&{id:c.id,epoch:c.epoch,phase:c.phase,
            routeVersion:c.routeVersion,disableTown:c.disableTown,returnTown:c.returnTown,expected:c.expected},
            native:await native(),reportedTownReady:Object.fromEntries(fighters.map(name=>[name,s.characters[name]?.returnTownReady]))});
        }
        if(c?.returnRouting&&c.disableTown&&c.phase==='travel'&&fighters.some(name=>s.characters[name]?.moving)){
          original={convoy:c,native:await native()};return true;
        }
        return false;
      },{timeout:180_000,intervals:[100],message:'Declared walking return must install and actually move before the communication fault'}).toBe(true);
      // Both members fall silent at once, so the walk holds them in its communication hold until 13
      // judges them lost on its stale bound (steamRunnerStaleMs, 20 s; the user's decision of
      // 2026-11-17). The channels come back within that bound, so the same walk resumes.
      blocking=true;await context.route('**/party-api/status',intercept);interceptInstalled=true;
      const silentAt=Date.now();
      await expect.poll(async()=>{
        const s=await live.state(),positions=await native();
        if(s.activeConvoy?.phase==='communication-hold'&&positions.every(p=>!p.moving)){
          held={convoy:s.activeConvoy,native:positions};return true;
        }
        return false;
      },{timeout:20_000,message:'Dropping both real report channels must hold and stop native travel'}).toBe(true);
      expect([...held.convoy.participants].sort(),'The hold keeps every silent member').toEqual([...original.convoy.participants].sort());
      expect(Date.now()-silentAt,'The channels return inside the stale bound').toBeLessThan(20_000);
      blocking=false;await context.unroute('**/party-api/status',intercept);interceptInstalled=false;
      await expect.poll(async()=>{
        const s=await live.state(),c=s.activeConvoy;
        if(c?.id!==original.convoy.id||c.phase!=='travel')return false;
        const leader=s.characters[c.leader]?.convoyNavigation;
        if(leader?.reusedRoutes!==1||leader.routeSource!=='remainder')return false;
        resumed={convoy:c,native:await native()};return true;
      },{timeout:120_000,message:'Fresh owned recovery must reuse the validated walking remainder'}).toBe(true);
      const cache=resumed.native.find((p:any)=>p.name===W).cache;
      expect(cache.plot.some((step:any)=>step.town),'Reused walking checkpoint must not contain a Town action').toBe(false);
      expect(profile(await live.state()).monsterHunt.cycleId).toBe(cycle);
      reads.H18 = {cycle, original: original?.convoy?.id, held: held?.convoy?.phase, resumed: resumed?.convoy?.id, faults: faults.length};
    }finally{
      blocking=false;if(interceptInstalled)await context.unroute('**/party-api/status',intercept);
      context.off('response',responseObserved);await Promise.allSettled([...responseTasks]);
      await info.attach('native-walking-return-cache-fault-ledger',{body:JSON.stringify({cycle,original,held,resumed,faults,walkingAdmission,issuedCommands}),contentType:'application/json'});
    }
}

const own = (id: string, owner: string) => ({
  owner, behaviours: [], start() {}, reads: () => ({failed: failed[id] ?? null, reads: id === 'H18' ? reads.H18 ?? null : reads.start ?? null}),
  verdict() { expect(failed[id], `${id}: every step of the play passes`).toBeUndefined(); },
});

liveWindow({
  id: 'W15', name: 'Boo Boo Hunt through map doors',
  // H18's old test bound, 900 s, which holds H17's 600 s overall deadline (gameplay-scenarios.ts).
  timeoutMs: 900_000,
  play: booBooPlay,
  observers: [{id: 'H17', ...own('H17', 'hunting')}, {id: 'H18', ...own('H18', 'movement')}],
});

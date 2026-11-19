import {expect,type LiveGame} from './live-fixtures';
import type {TestInfo} from '@playwright/test';
import type {Route} from '@playwright/test';
import {killNativeCharacter} from './hunt-interruption-helpers';
import {taskDeathBaseline,expectTaskDeath,taskTrail} from './task-records';
import {W,P,fighters,peacefulWorld,seedBoss,endEvent,installProbe,harvest,respawnedAt,idleRuns,routeMs,attach,partyReady,hitBy,inZone,answers,expectInvariants,stuckNamed,FARM_MONSTER} from './event-death-helpers';
import {location} from './game/hunt-lifecycle';
import {bandsRead,survivalWaits,type BandsRead} from './call-budget-rows';
import {deathRecordHolds,escapeSpendProbe,escapeSpendRead,sv26Holds} from './survival-rows';

// CB21: no survival question of either fighter
// waits in an UP-1 row, on the socket it starts with or on any it gets after.
const budgetRead=async(live:LiveGame)=>Object.fromEntries(await Promise.all(fighters.map(async n=>[n,await bandsRead(live,n)]))) as Record<string,BandsRead>;
function noSurvivalWaits(before:Record<string,BandsRead>,after:Record<string,BandsRead>){
  const waits=Object.fromEntries(fighters.map(n=>[n,survivalWaits(before[n]!,after[n]!)]));
  console.log('CALL-BUDGET-UP-1 '+JSON.stringify(waits));
  for(const n of fighters)expect(waits[n],`CB21: ${n}'s survival questions answered not-now`).toBe(0);
}

// UP-1: a party death
// during an event, then no way back to the event. Step 7 of the movement owner
// migration. Failure inventory: e2e/movement-owner-failures.md, "Step 7".
//
// Gaps: ambient monsters are peaceful and the boss neither hurts nor dies, so the only
// death is the scripted one; no other players; events without a walk path (Slenderman's
// search) are left out.
// The UP-1 rows run as steps of live-movement-owner.spec.ts's table of rows that start from the
// default fixture.

// A coordinator answer that the party's earlier walk to the same event failed. The stub keeps
// that harder case, so the respawned follower's rejoin ladder must climb past it.
const RETAINED={ok:true,phase:'failed',reason:'Event walking retries exhausted'};

// The owner is the only mode since step 10; the titles keep the names the catalog links.
const owner='on';

export const up1Row=(type:'mrgreen'|'horseman')=>async(live:LiveGame,info:TestInfo)=>{
      await partyReady(live);
      await peacefulWorld(live);
      await live.post('/formation',{leader:W});
      await live.post('/formation',{character:P,follow:true});
      const boss=await seedBoss(live,type);
      const selectedAt=Date.now();
      await live.post('/formation',{character:W,eventSelections:[type]});
      await expect.poll(async()=>(await Promise.all(fighters.map(n=>hitBy(live,n,boss,selectedAt)))).every(Boolean),
        {timeout:300_000,message:'Both fighters must damage the boss before the death'}).toBe(true);
      for(const name of fighters)await installProbe(live,name);
      const budgetFrom=await budgetRead(live);
      // The fault answers each of the priest's event walk requests the way the
      // coordinator does while it keeps an earlier failed walk to this event.
      const answered:any[]=[];
      const context=live.clients[P].page.context();
      const retained=async(route:Route)=>{
        let body:any;try{body=route.request().postDataJSON();}catch{return route.fallback();}
        if(body?.character!==P||body.activity!=='event'||body.cancel)return route.fallback();
        answered.push({at:Date.now(),key:body.key,token:body.token});
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(RETAINED)});
      };
      await context.route('**/party-api/shared-travel',retained);
      let result:any;
      try{
        const deathBase=await taskDeathBaseline(live,P);
        // The priest's death record, its notice, its respawns.
        await live.clients[P].run(escapeSpendProbe);
        const death=await killNativeCharacter(live,P);
        await expectTaskDeath(live,P,deathBase);
        // Back in boss range while the event lives, with nobody stepping in.
        // A hit counts from the respawn on: an attack in flight can land after the death.
        let back:number|null=null;
        await expect.poll(async()=>{const spawned=respawnedAt(await live.clients[P].run(harvest),death.at);
          return !!spawned&&(back=await hitBy(live,P,boss,spawned))!==null;},
          {timeout:600_000,intervals:[1000],message:'The respawned priest must damage the boss again'}).toBe(true);
        const h=await live.clients[P].run(harvest),spawned=respawnedAt(h,death.at)!;
        const idle=idleRuns(h,spawned,back!);
        result={owner,type,boss,death,answered,respawnedAt:spawned,backAt:back,backAfterMs:back!-spawned,routeMs:routeMs(h,spawned,back!),idle,
          trying:[...new Set(h.samples.filter((s:any)=>s.at>=spawned&&s.at<=back!).map((s:any)=>s.trying).filter(Boolean))],
          // A started journey also keeps where it began, its destination, its planned walking
          // distance and its detours around idle aggro, so a longer route names the leg
          // that grew and why (13.4d item 2).
          journeys:h.records.filter((r:any)=>r.at>=spawned&&r.at<=back!&&['started','ended','refused','waiting'].includes(r.decision)).map((r:any)=>[r.at-spawned,r.decision,r.kind,String(r.owner??'').split(':')[0],r.code??'',
            ...(r.decision==='started'?[r.from?[r.from.map,Math.round(r.from.x),Math.round(r.from.y)]:null,r.destination?[r.destination.map,Math.round(r.destination.x),Math.round(r.destination.y)]:null,Math.round(Number(h.journeys[r.journeyId]?.walking)||0),h.journeys[r.journeyId]?.detours??null]:[])])};
        result.answers=answers(h,spawned);
        result.towns=(await live.clients[W].run(harvest)).towns.filter((t:any)=>t.at>=death.at&&t.map===boss.map);
        expect(idle.longest,'longest stand with nothing holding the priest').toBeLessThanOrEqual(idle.bound);
        expect(result.trying.length,'the recovery state names what it tries').toBeGreaterThan(0);
        // Items 4 and 5: answers come from after the respawn; nobody Towns out of the event.
        expect(result.answers.stale,'answers from before the respawn').toBe(0);
        expect(result.answers.kinds,'the group task names the event').toContain('event-attendance');
        expect(result.towns,'Town casts on the event map').toEqual([]);
        // A death at an event starts no party death recovery. The task
        // half: the party's live task stays the occurrence's attendance while it lives; the
        // heartbeat half joins in step 4, when the heartbeat carries the assignment.
        const tasks=await taskTrail(live,deathBase.group,deathBase.seq);
        result.tasks=tasks;
        expect(tasks.trail.filter(([d,k])=>d==='granted'&&k==='death-recovery'),'party death recovery for an event death').toEqual([]);
        expect(tasks.live,'the party attends the live occurrence').toBe('event-attendance');
        // The audit stays clean and the rejoin ranks, with no wait on a flag.
        // A rejoin rung with no progress writes a stuck record (the move onto b9b5c91e).
        for(const name of fighters)expectInvariants(await live.clients[name].run(harvest),name);
        {
          const read=await escapeSpendRead(live,[P]);
          const record=await deathRecordHolds(live,P,death.at,'UP-1');sv26Holds(read,P,'UP-1');
          console.log('SURVIVAL-UP1 '+JSON.stringify({respawns:read.respawns[P],notices:record.notices.length}));
        }
        expect(stuckNamed(h,spawned),'a stuck record names the rung, its activity and the time without progress').toBe(true);
        expect(h.records.some((r:any)=>r.at>=spawned&&r.decision==='held'&&r.kind==='death-recovery'),'the rejoin holds as death recovery').toBe(true);
        // The rejoin takes the priest by rank, and never waits behind a lower journey. The follow
        // runs only under the member's farming tasks, so under the event
        // task the respawn starts no follow journey; one that runs ends `replaced:death-recovery`.
        expect(result.journeys.filter((j:any[])=>j[1]==='ended'&&j[2]==='follow').every((j:any[])=>j[4]==='replaced:death-recovery'),'a lower journey ends replaced by death recovery').toBe(true);
        expect(result.journeys.filter((j:any[])=>j[1]==='waiting'&&j[2]==='death-recovery'),'rejoins waiting behind a journey').toEqual([]);
        noSurvivalWaits(budgetFrom,await budgetRead(live));
      }finally{
        await context.unroute('**/party-api/shared-travel',retained);
        if(result)console.log('UP-1 '+JSON.stringify({...result,journeys:result.journeys?.length,legs:result.journeys?.filter((j:any)=>j[1]==='started')}));
        await attach(info,'up1-event-death-rejoin',result??{owner,type,boss,answered,state:await live.state(),probe:await live.clients[P].run(harvest).catch(String)});
        await live.post('/formation',{character:W,eventSelections:[]}).catch(()=>{});
        await endEvent(live,type).catch(()=>{});
      }
};

  // A join the game refuses with `cant_join` is final for the occurrence. The
  // server answers `cant_join` when the event's flag is off (node/server.js `join`), so
  // the fixture publishes the Ice Golem as live in E with its flag off.
export async function cantJoinRow(live:LiveGame,info:TestInfo){
    await partyReady(live);
    await peacefulWorld(live);
    await live.post('/formation',{leader:W});
    await live.post('/formation',{character:P,follow:true});
    const farm=await location(live,FARM_MONSTER);
    await live.post('/navigate-to-monster',{monsterId:FARM_MONSTER,location:farm});
    await live.post('/focus',{monsterFocus:[FARM_MONSTER],monsterPriorities:{},monsterSearchRadius:400});
    await expect.poll(async()=>{const s=await live.state();return fighters.every(n=>inZone(s.characters[n],farm));},
      {timeout:180_000,message:'Both fighters must farm'}).toBe(true);
    for(const name of fighters)await installProbe(live,name);
    const budgetFrom=await budgetRead(live);
    const golem=await live.admin(`output=(()=>{if(events.icegolem)throw Error('Ice Golem flag must stay off');
      E.icegolem={live:true,map:'winterland',x:820,y:425};broadcast_e();return {at:Date.now()};})()`);
    let result:any;
    try{
      await live.post('/formation',{character:W,eventSelections:['icegolem']});
      // The first refusal is the round's answer: `cant_join` ends the group's attendance at once
      //, so a follower that had not asked yet never asks (the run that failed here: the
      // warrior's refusal, no ask from the priest). No fighter joins after it (checked below).
      await expect.poll(async()=>(await Promise.all(fighters.map(async n=>(await live.clients[n].run(harvest)).replies.length))).some(c=>c>0),
        {timeout:120_000,message:'A fighter must ask to join and be refused'}).toBe(true);
      const death=await killNativeCharacter(live,P);
      const joins=async()=>Object.fromEntries(await Promise.all(fighters.map(async n=>{const x=await live.clients[n].run(harvest),first=x.replies[0]?.at??Infinity;
        return [n,{refusals:x.replies.length,joinsAfterRefusal:x.joins.filter((j:any)=>j.at>first&&j.name==='icegolem').length}];})));
      let h:any,spawned:number|null=null;
      // The coordinator's owners of the respawned priest, sampled every 250 ms: the event
      // return that the round's end starts (it lists the priest, as in UP-3), and the
      // party's death recovery for a death away from an event.
      const recoveries:{at:number;owns:boolean}[]=[];
      await expect.poll(async()=>{h=await live.clients[P].run(harvest);spawned=respawnedAt(h,death.at);
        const s=await live.state(),r=s.combatRecovery;
        recoveries.push({at:Date.now(),owns:!!r?.names?.includes(P)&&!['complete','cancelled'].includes(r.phase)||!!s.eventReturn?.participants?.includes(P)});
        return !!spawned&&inZone(s.characters[P],farm);},
        {timeout:600_000,intervals:[250],message:'The respawned priest must go back to the farm'}).toBe(true);
      const recovering=(at:number)=>!![...recoveries].reverse().find(x=>x.at<=at)?.owns;
      const after=await joins();
      h=await live.clients[P].run(harvest);
      const back=h.samples.find((s:any)=>s.at>=spawned!&&inZone(s,farm))?.at??Date.now();
      result={owner,golem,death,respawnedAt:spawned,after,backAfterMs:back-spawned!,routeMs:routeMs(h,spawned!,back),idle:idleRuns(h,spawned!,back,recovering),owned:recoveries.some(x=>x.owns),
        window:h.samples.filter((x:any)=>x.at>=spawned!-1000&&x.at<=back),records:h.records.filter((r:any)=>r.at>=spawned!-1000&&r.at<=back)};
      for(const name of fighters)expect(after[name].joinsAfterRefusal,`${name} joins after the refusal`).toBe(0);
      expect(result.idle.longest,'longest stand with nothing holding the priest').toBeLessThanOrEqual(result.idle.bound);
      for(const name of fighters)expectInvariants(await live.clients[name].run(harvest),name);
      noSurvivalWaits(budgetFrom,await budgetRead(live));
    }finally{
      if(result)console.log('UP-1 '+JSON.stringify({...result,window:undefined,records:undefined}));
      // Each fighter's join replies and joins, so a run that fails before the result names who asked.
      const asked=await Promise.all(fighters.map(n=>live.clients[n].run(harvest).then((x:any)=>({name:n,replies:x.replies,joins:x.joins})).catch(String)));
      const st=await live.state();
      await attach(info,'up1-cant-join',result?{...result,asked}:{owner,asked,state:st,convoy:st.activeConvoy??null,walks:st.sharedWalks??st.eventWalks??null,commands:st.commands??null});
      await live.post('/formation',{character:W,eventSelections:[]}).catch(()=>{});
      await live.admin('delete E.icegolem;broadcast_e();output=true').catch(()=>{});
    }
}

// The UP-1 and UP-3 rows each seed their own event and kill the priest. Each row ends its event and clears the event selection; the reset
// waits until both fighters stand alive with no party recovery live and brings the party back to
// Main. Each row's probes come undone as the row ends (installProbe), so the next row reads only
// its own records.
export async function deathReset(live:LiveGame){
  await live.post('/formation',{character:W,eventSelections:[]});
  for(const type of ['mrgreen','horseman','icegolem'])await endEvent(live,type).catch(()=>{});
  await live.admin('delete E.icegolem;broadcast_e();output=true').catch(()=>{});
  await expect.poll(async()=>{const s=await live.state();return fighters.every(n=>s.characters[n]&&!s.characters[n].rip)&&(!s.combatRecovery||s.combatRecovery.phase==='complete');},
    {timeout:240_000,message:'Both fighters must stand alive with no party recovery before the next row'}).toBe(true);
  // Every row starts on Main, where the fixture puts the party, wherever the last event left it.
  await live.admin(`output=(()=>{for(const n of ${JSON.stringify(['E2EWarrior','E2EPriest'])}){const p=get_player(n);transport_player_to(p,'main');resend(p,'u+cid');}return true;})()`);
  await expect.poll(async()=>{const s=await live.state();return fighters.every(n=>s.characters[n]?.map==='main');},{timeout:60_000}).toBe(true);
}

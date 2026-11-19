import {expect,type LiveGame} from './live-fixtures';
import type {TestInfo} from '@playwright/test';
import {killNativeCharacter} from './hunt-interruption-helpers';
import {taskSeq,taskTrail} from './task-records';
import {W,P,fighters,peacefulWorld,seedBoss,endEvent,probe,harvest,respawnedAt,idleRuns,routeMs,attach,partyReady,hitBy,inZone,answers,expectInvariants,FARM_MONSTER} from './event-death-helpers';
import {location,prepareHunt,start,cycle as huntCycle} from './game/hunt-lifecycle';
import {deathRecordHolds,escapeSpendProbe,escapeSpendRead,sv26Holds} from './survival-rows';

// UP-3: after a
// respawn, a character does not go back to its activity. The priest dies at Mr. Green
// and the event ends before it respawns. Step 7 of the movement owner migration.
// Failure inventory: e2e/movement-owner-failures.md, "Step 7".
//
// Gaps: ambient monsters are peaceful and the boss does not hurt, so the only death is
// the scripted one; no other players. Whether the priest is in the event return's
// participant list is not set by the scenario (design § 3.3 UP-3 step 4 is an inference);
// the row requires it, because the return's wait is what step 8a item 12 checks.

export const up3Row=(mode:'farm'|'hunt')=>async(live:LiveGame,info:TestInfo)=>{
      await partyReady(live);
      await peacefulWorld(live);
      const goal=await location(live,FARM_MONSTER);
      let cycle:string|null=null;
      if(mode==='hunt'){await prepareHunt(live,{monster:FARM_MONSTER,count:500,location:goal});await start(live,W,FARM_MONSTER,goal);cycle=await huntCycle(live);}
      if(mode==='farm'){
        await live.post('/formation',{leader:W});
        await live.post('/formation',{character:P,follow:true});
        await live.post('/navigate-to-monster',{monsterId:FARM_MONSTER,location:goal});
        await live.post('/focus',{monsterFocus:[FARM_MONSTER],monsterPriorities:{},monsterSearchRadius:400});
      }
      const policy=(await live.state()).farmingPolicy;
      await expect.poll(async()=>{const s=await live.state();return fighters.every(n=>inZone(s.characters[n],goal));},
        {timeout:240_000,message:`Both fighters must reach the ${mode}`}).toBe(true);
      const boss=await seedBoss(live,'mrgreen');
      const selectedAt=Date.now();
      await live.post('/formation',{character:W,eventSelections:['mrgreen']});
      let result:any,samples:any[]=[];
      try{
        await expect.poll(async()=>(await Promise.all(fighters.map(n=>hitBy(live,n,boss,selectedAt)))).every(Boolean),
          {timeout:300_000,message:'Both fighters must damage Mr. Green'}).toBe(true);
        for(const name of fighters)await live.clients[name].run(probe);
        // The priest's respawns, their asks and the
        // server's replies.
        await live.clients[P].run(escapeSpendProbe);
        const tasksFrom=await taskSeq(live,`party:${W}`);
        const death=await killNativeCharacter(live,P);
        // The event ends while the priest is still dead.
        const endedAt=await endEvent(live,'mrgreen');
        const sample=async()=>{const s=await live.state();samples.push({at:Date.now(),eventReturn:s.eventReturn&&{event:s.eventReturn.event,phase:s.eventReturn.phase,participants:s.eventReturn.participants,pending:s.eventReturn.pending},
          hunt:s.monsterHunt&&{stage:s.monsterHunt.stage,message:s.monsterHunt.message},convoy:s.activeConvoy&&{purpose:s.activeConvoy.purpose,phase:s.activeConvoy.phase,participants:s.activeConvoy.participants},
          recovery:s.combatRecovery&&{phase:s.combatRecovery.phase,reason:s.combatRecovery.reason},
          characters:Object.fromEntries(fighters.map(n=>{const c=s.characters[n];return [n,c&&{map:c.map,x:Math.round(c.x),y:Math.round(c.y),rip:!!c.rip,recovery:c.recovery&&{status:c.recovery.status,phase:c.recovery.phase,trying:c.recovery.trying??null}}];}))});
          if(samples.length>900)samples.splice(1,1);return s;};
        {
          // Step 8a item 12: while the event return holds the waiting priest, the hold lends it
          // to a combat step and outlasts it. One step of the items owner units, from the CODE frame, the first
          // time a sample finds the hold.
          let lent:any=null;
          const lend=`(()=>{const m=__partyMovement,l=m.live();if(!l||l.journey||l.kind!=='task-walk'||!/^event-return:./.test(String(l.owner)))return null;
            const c=character;for(let i=0;i<16;i++){const t=i*Math.PI/8,p={x:c.real_x+10*Math.cos(t),y:c.real_y+10*Math.sin(t)};
              if(can_move({map:c.map,x:c.real_x,y:c.real_y,going_x:p.x,going_y:p.y,base:c.base})){const status=m.step(p,'e2e-return-step').status;m.letGo();
                const after=m.live();return {owner:l.owner,status,kept:!!after&&after.owner===l.owner};}}return null;})()`;
          await expect.poll(async()=>{if(!lent)lent=await live.clients[P].run(lend);return inZone((await sample()).characters[P],goal);},
            {timeout:900_000,intervals:[1000],message:`The respawned priest must go back to the ${mode}`}).toBe(true);
          const h=await live.clients[P].run(harvest),spawned=respawnedAt(h,death.at)!;
          const back=h.samples.find((s:any)=>s.at>=spawned&&inZone(s,goal))?.at??Date.now();
          // Step 8a item 12: the event return's wait is a hold on the priest, so the idle
          // measure needs no exemption for it.
          const idle=idleRuns(h,spawned,back);
          const returnHold=(s:any)=>!!s.live&&!s.live.journey&&s.live.kind==='task-walk'&&String(s.live.owner).startsWith('event-return:');
          result={mode,goal,death,endedAt,respawnedAt:spawned,backAt:back,backAfterMs:back-spawned,routeMs:routeMs(h,spawned,back),idle,
            trying:[...new Set(h.samples.filter((s:any)=>s.at>=spawned&&s.at<=back).map((s:any)=>s.trying).filter(Boolean))],
            listed:samples.some(s=>s.eventReturn?.participants?.includes(P)),
            returnHeld:h.samples.filter((s:any)=>s.at>=spawned&&s.at<=back&&returnHold(s)).length,
            heldAfterBack:h.samples.filter((s:any)=>s.at>back&&returnHold(s)).length,
            // What the priest did around its longest stand, for a failed idle bound.
            idleWindow:idle.longestAt===null?null:{samples:h.samples.filter((s:any)=>s.at>=idle.longestAt!-1000&&s.at<=idle.longestAt!+idle.longest+1000),
              records:h.records.filter((r:any)=>r.at>=idle.longestAt!-3000&&r.at<=idle.longestAt!+idle.longest+1000)}};
          expect(idle.longest,'longest stand with nothing holding the priest').toBeLessThanOrEqual(idle.bound);
          // The priest is listed in every run so far (step 11 and the separate check), so the
          // return's wait is checked, not skipped.
          expect(result.listed,'precondition: the event return lists the priest').toBe(true);
          expect(result.returnHeld,'samples where the event return holds the waiting priest').toBeGreaterThan(0);
          result.lent=lent;
          expect(lent,'the event return hold, named event-return:<cycle>, lends the priest to a combat step and keeps it').toMatchObject({owner:expect.stringMatching(/^event-return:.+/),status:'sent',kept:true});
          expect(result.heldAfterBack,'event return holds after the priest is back').toBe(0);
          // Step 8b item 16: a walk for the priest never waits behind the event return's hold;
          // the hold is a standing hold, so the walk ends it when it asks (8a correction 4).
          expect(h.records.filter((r:any)=>r.at>=spawned&&r.decision==='waiting'&&r.kind==='group-walk').length,'walks waiting behind a hold').toBe(0);
          // The walk starts from where the leader stands inside
          // the rally range, so the rally never fails on a leader that drifted from its planning origin.
          // Written in the leftovers pass; the end run runs it first.
          expect(h.records.filter((r:any)=>r.at>=spawned&&/planning origin|leader origin/.test(JSON.stringify(r))).length,'rally failures on a drifted leader').toBe(0);
          for(const name of fighters)expectInvariants(await live.clients[name].run(harvest),name);
          {
            const read=await escapeSpendRead(live,[P]);
            result.death=await deathRecordHolds(live,P,death.at,'UP-3');
            sv26Holds(read,P,'UP-3');
            // SV28: a respawn the server refused inside its wait (`cant_respawn` with `ms`) asks again
            // only once `ms` has passed, and within one respawn tick (250 ms, the runner's timer) and
            // one round trip of it.
            const refused=read.replies[P]!.filter(r=>r.place==='respawn'&&r.response==='cant_respawn'&&Number.isFinite(Number(r.ms)));
            const sends=read.respawns[P]!,rtt=await live.clients[P].run('Math.max(0,...(parent.pings||[]))') as number;
            result.sv28={refused,sends,rtt,next:refused.map(r=>{const next=sends.find(s=>s.at>r.at);return next?{waitedMs:next.at-r.at,ms:Number(r.ms)}:null;})};
            for(const n of result.sv28.next)if(n){
              expect.soft(n.waitedMs,'SV28: the next respawn waits out the server\'s ms').toBeGreaterThanOrEqual(n.ms-rtt);
              expect.soft(n.waitedMs,'SV28: the next respawn goes within one respawn tick of the ms').toBeLessThanOrEqual(n.ms+250+rtt);
            }
            console.log('SURVIVAL-UP3 '+JSON.stringify({sends:sends.length,refused:refused.length,next:result.sv28.next,notice:result.death.notices.length}));
          }
          result.answers=answers(h,spawned);
          expect(result.answers.stale,'answers from before the respawn').toBe(0);
          // The event return that lists the priest moves it there too (spec 01 § 4.4 UP-3).
          expect(result.answers.kinds.some((kind:string)=>(mode==='farm'?['farming']:['hunt-mission','hunt-turn-in']).includes(kind)||kind==='event-return'),'the group task names the activity').toBe(true);
          // Item 6: the recovery keeps the farming mode and, for Hunt, its cycle.
          const after=await live.state();
          expect(after.farmingPolicy).toBe(policy);
          if(cycle)expect(after.monsterHunt?.cycleId).toBe(cycle);
          // The task half: the event's end is a task end, `event-over`, then the
          // event return, which ends once the party is back; no attendance outlives the event.
          const tasks=await taskTrail(live,`party:${W}`,tasksFrom);
          result.tasks=tasks;
          expect(tasks.trail.some(([d,k,c])=>d==='ended'&&k==='event-attendance'&&c==='event-over'),'the attendance ends event-over').toBe(true);
          expect(tasks.trail.some(([d,k])=>d==='granted'&&k==='event-return'),'the event return takes the party').toBe(true);
          expect(tasks.live,'no attendance after the event').not.toBe('event-attendance');
        }
      }finally{
        if(result)console.log('UP-3 '+JSON.stringify(result));
        await attach(info,'up3-event-death-after-end',{result,samples});
        await live.post('/formation',{character:W,eventSelections:[]}).catch(()=>{});
        await endEvent(live,'mrgreen').catch(()=>{});
      }
};

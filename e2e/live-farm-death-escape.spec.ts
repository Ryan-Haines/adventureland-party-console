import {test,expect,arenaReset,restoreArena,arenaPositions,callMeasures,plantVitals,waitForGameplay,type CallSample} from './live-fixtures';
import {reloadRows} from './console-reload-rows';
import {addonSwitches} from './fixtures/turns-hooks-addon';
import {liveScenarioTable} from './scenario-table';
import type {LiveGame} from './live-fixtures';
import type {TestInfo} from '@playwright/test';
import {killNativeCharacter} from './hunt-interruption-helpers';
import {red} from './turns-rows';
import {taskSeq,taskTrail} from './task-records';
import {quests,start,profile} from './game/hunt-lifecycle';
import {bandsHold,bandsRead,CB20_P95,chargesHold,mageCosts,meterOf} from './call-budget-rows';
import {cb20Windows,CB20_TURNS_BEFORE} from './call-budget-cb20';
import {caseASpendsHold,deathRecordHolds,escapeSpendProbe,escapeSpendRead,sv16Holds,sv26Holds,survivalHitProbe} from './survival-rows';

// UP-2, ledger bug 5 and queue D7: step 3 of the movement owner migration.
// Failure inventory: e2e/movement-owner-failures.md, "Step 3".
const W='E2EWarrior',P='E2EPriest',B='E2EBankBoi';
// The movement owner counts a walk as arrived within ARRIVAL_TOLERANCE (runtime/protocol/ladder.ts).
import {ARRIVAL_TOLERANCE} from '../runtime/protocol/ladder.ts';
// b9b5c91e's escape pulse, 100 ms (shared.js `__partyEscapeTimer`). The escape's step now runs on
// the role loop's events (runtime/characters/survival/escape.ts), and the pulse check
// holds it to this bound after the event that allows a move; after a lost event the report timer,
// one report interval, is its backstop.
const ESCAPE_PULSE_MS=100;
const positions=arenaPositions;

// Counts native moves beside the service, as e2e/live-movement-owner.spec.ts does,
// and records every heartbeat the character completes.
const instrument=`(()=>{if(globalThis.__e2eSurvival)return;const s=globalThis.__e2eSurvival={moves:[],reports:[],cc:0,records:new Map(),journeys:new Map()};
  const original=globalThis.move;globalThis.move=function(x,y){s.moves.push(Date.now());return original(x,y);};
  let seen=globalThis.__partyStatusSuccessAt;setInterval(()=>{const at=globalThis.__partyStatusSuccessAt;if(at!==seen){seen=at;s.reports.push(at);}
    s.cc=Math.max(s.cc,Number(character.cc)||0);for(const r of __partyMovement.records())s.records.set(r.seq,r);
    const last=__partyMovement.last();if(last?.id)s.journeys.set(last.id,{walking:last.walkingDistance??0,end:last.end});},25);})()`;
const harvest=`(()=>{const s=globalThis.__e2eSurvival,m=s.moves;let worst=0;for(let i=0,j=0;i<m.length;i++){while(m[i]-m[j]>4000)j++;worst=Math.max(worst,i-j+1);}
  return {records:[...s.records.values()].sort((a,b)=>a.seq-b.seq),journeys:Object.fromEntries(s.journeys),reports:s.reports,maxMovesPer4s:worst,maxCallCost:s.cc,speed:character.speed,
    invariants:__partyMovement.ownerReport().invariants??null};})()`;

// Records each death the warrior captures (shared.js `lastDeathInfo`) and each rip
// change, sampled every 25 ms, to tell one capture from two.
const deathProbe=`(()=>{const p=globalThis.__e2eDeathProbe={captures:[],rip:[]};let at=globalThis.__partyLastDeathInfo?.at,rip=!!character.rip;
  setInterval(()=>{const now=globalThis.__partyLastDeathInfo?.at;if(now!==at){at=now;p.captures.push({at:now,seenAt:Date.now(),rip:!!character.rip});}
    if(!!character.rip!==rip){rip=!!character.rip;p.rip.push({rip,at:Date.now()});}},25);})()`;

// Marks the priest's first walk home (a journey toward Main started after arming,
// walking in the Arena) as soon as it starts. With `block`, the priest's door
// packets (`transport`) are dropped until four walks toward Main have ended without
// arriving, more than the survival ladder's walk rungs before its first relocation,
// and then pass again. The fault targets only the walk home. The movement executor pushes the
// game's `transport` deferred before it emits (movement-executor.ts `sendTransport`), and the
// game resolves the oldest deferred of a name on each reply (old_common_functions.js
// `resolve_deferred`), so a dropped packet's deferred left in the queue took the next door's
// reply: the death recovery's door step never read its own and failed 12 s later (13.4d item
// 3). The drop takes its own deferred out of the queue, and its promise never settles, as a
// lost packet's does.
// A walk counts toward the four only when the fault dropped its door packet. A walk that ended
// before the door (one superseded at its start, or ended by the death recovery's fight) used to
// count too, so four runs from layer 6 to 13.6 waited two door cycles (74.75 to 75.25 s) where
// twelve waited four (147.5 to 148.75 s), and the row's home time measured that count.
// `uncounted` keeps the walks home that failed with no packet dropped.
const FAILED_WALKS=4;
// Red plants of the count's check: `up2count` counts every failed walk home, as before the fix, and
// `up2early` adds one walk home that started and failed at the arming with no packet dropped, the
// the shape of an earlier run's superseded first walk.
// A new arming stops the last one's timer and drop, so a row's reading is its own: before this, a
// row armed after another kept the earlier row's timer writing the same reading (one run armed case C
// without a drop, then UP-2's reading showed its 6 failed walks and 0 dropped).
const armWalkHome=(block:boolean)=>`(()=>{clearInterval(globalThis.__e2eWalkHomeTimer);if(globalThis.__e2eWalkHomeEmit){parent.socket.emit=globalThis.__e2eWalkHomeEmit;delete globalThis.__e2eWalkHomeEmit;}
  const armedAt=Date.now(),failed=new Set(),uncounted=new Set(),dropIds=new Set();globalThis.__e2eWalkHome=null;
  const early=${red('up2early')}?[{decision:'started',journeyId:'e2e-early',kind:'escape',at:armedAt},{decision:'ended',journeyId:'e2e-early',kind:'escape',code:'superseded',at:armedAt}]:[];
  const home=r=>r.at>=armedAt&&(r.kind==='escape'||r.destination?.map==='main');
  // The drop holds only while the live journey is the escape's own walk home, so the death
  // recovery's farm return after it is never the walk the fault fails.
  if(${block}){const socket=parent.socket,emit=socket.emit;globalThis.__e2eWalkHomeEmit=emit;globalThis.__e2eDropped=0;
    socket.emit=function(event,...rest){if(event==='transport'&&failed.size<${FAILED_WALKS}&&globalThis.__e2eWalkHome&&__partyMovement.live()?.kind==='escape'){globalThis.__e2eDropped++;dropIds.add(__partyMovement.report()?.id);const queue=parent.deferreds.transport;if(queue&&queue.length){queue.pop();if(!queue.length)delete parent.deferreds.transport;}return socket;}return emit.call(this,event,...rest);};}
  globalThis.__e2eWalkHomeTimer=setInterval(()=>{const records=[...early,...__partyMovement.records()];
    for(const r of records)if(r.decision==='ended'&&home(r)&&r.code!=='arrived'&&records.some(x=>x.decision==='started'&&x.journeyId===r.journeyId&&home(x)))(!${block}||${red('up2count')}||dropIds.has(r.journeyId)?failed:uncounted).add(r.journeyId);
    if(globalThis.__e2eWalkHome){globalThis.__e2eWalkHome.failed=failed.size;globalThis.__e2eWalkHome.uncounted=uncounted.size;
      globalThis.__e2eWalkHome.droppedWalks=[...failed,...uncounted].filter(id=>dropIds.has(id)).length;if(failed.size>=${FAILED_WALKS}&&!globalThis.__e2eWalkHome.liftedAt)globalThis.__e2eWalkHome.liftedAt=Date.now();return;}
    const id=__partyMovement.report()?.id;if(!id||!character.moving||character.map!=='arena')return;
    const started=records.find(r=>r.decision==='started'&&r.journeyId===id&&home(r));
    if(started)globalThis.__e2eWalkHome={journey:id,kind:started.kind,at:Date.now(),failed:0};},25);})()`;

// hold takes the Arena's respawns and live monsters off the server, only `type`'s when the row
// names one. The held respawns add to any already held, and restoreArena (live-fixtures.ts) puts
// them all back.
async function hold(live:LiveGame,type?:string){
  return live.admin(`output=(()=>{const type=${JSON.stringify(type??null)},held=globalThis.__e2eArenaRespawns=globalThis.__e2eArenaRespawns||[];
    for(let i=monster_respawns.length-1;i>=0;i--)if(monster_respawns[i][0]?.map==='arena'&&(!type||monster_respawns[i][0]?.type===type))
      held.push(monster_respawns.splice(i,1)[0]);
    for(const m of Object.values(instances.arena.monsters))if(!type||m.type===type)remove_monster(m,{method:'disappear',nospawn:true});
    return held.length;})()`);
}
// The game server's own respawn rule (node/server.js `respawn`), with the regroup kept
// in Main: the death map's `on_death`, else Main's, else spawn 0.
async function expectedHome(live:LiveGame,map:string){
  const spawn=await live.admin(`output=(()=>{const place=[G.maps[${JSON.stringify(map)}]?.on_death,G.maps.main.on_death].find(p=>p&&p[0]==='main')||['main',0];
    const s=G.maps.main.spawns[place[1]]||G.maps.main.spawns[0];return {x:s[0],y:s[1],size:s[3]||0};})()`);
  return {map:'main',x:spawn.x,y:spawn.y,radius:Math.max(ARRIVAL_TOLERANCE,Math.hypot(spawn.size/2,spawn.size/2))};
}
const atHome=(s:any,home:{map:string;x:number;y:number;radius:number})=>!!s&&s.map===home.map&&Math.hypot(s.x-home.x,s.y-home.y)<=home.radius;
const escapeRead=async(live:LiveGame)=>(await (await fetch(live.url+'/party-api/escape')).json()).escape;

async function farmArena(live:LiveGame,names:string[]){
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'merchant idle':false,'stand maintenance':false}});
  await live.post('/formation',{leader:W});
  for(const name of names.filter(n=>n!==W))await live.post('/formation',{character:name,follow:true});
  await expect.poll(async()=>(await live.state(true)).monsterChoices?.some((m:any)=>m.id==='cgoo'),{timeout:120_000}).toBe(true);
  const location=(await live.state(true)).monsterChoices.find((m:any)=>m.id==='cgoo').locations.find((l:any)=>l.map==='arena');
  await live.post('/navigate-to-monster',{monsterId:'cgoo',location});
  await live.post('/focus',{monsterFocus:['cgoo'],monsterPriorities:{},monsterSearchRadius:400});
  await expect.poll(async()=>{const s=await live.state();return names.every(n=>s.characters[n]?.map==='arena'&&Date.now()-s.characters[n].seenAt<3000);},
    {timeout:120_000,message:'Every fighter must farm in the Arena'}).toBe(true);
  for(const name of names)await live.clients[name].run(instrument);
  return location;
}

interface Run {
  live:LiveGame; info:TestInfo; names:string[]; survival:boolean;
  // Runs once after the priest's first walk home starts (armWalkHome).
  // The run then waits for the block to lift before `until` can end it.
  fault?:(walk:{journey:string;kind:string;at:number})=>Promise<void>;
  until:(s:{state:any;escape:any})=>boolean;
  interval?:number;
}
// Samples the coordinator once per virtual second from the death until `until` holds.
async function observe(run:Run,death:{at:number}){
  const {live,names}=run,samples:any[]=[];let faulted=false;
  try{
  await expect.poll(async()=>{
    const state=await live.state(),escape=await escapeRead(live);
    samples.push({at:Date.now(),escape:escape&&{id:escape.id,stage:escape.stage,home:escape.home??null,destination:escape.destination??null,convoyId:escape.convoyId??null,
        ported:escape.ported??null,walk:escape.walk??null,dropped:escape.dropped??null,
        trying:Object.fromEntries(names.map(n=>[n,escape.progress?.[n]?.trying??null])),recoveryFailed:Object.fromEntries(names.map(n=>[n,!!escape.progress?.[n]?.recoveryFailed]))},
      recovery:state.combatRecovery&&{id:state.combatRecovery.id,phase:state.combatRecovery.phase,home:state.combatRecovery.home??null,reason:state.combatRecovery.reason,returnConvoyId:state.combatRecovery.returnConvoyId??null,returnFailedAt:state.combatRecovery.returnFailedAt??null},activeConvoy:state.activeConvoy&&{id:state.activeConvoy.id,phase:state.activeConvoy.phase,failure:state.activeConvoy.failure??null},
      // The walk the party's convoy runs for, to see that no farm-area move starts.
      convoy:state.activeConvoy?.purpose??null,
      // The climber's report the card reads: activity, rung and stuck notice (movementClimb).
      activity:Object.fromEntries(names.map(n=>[n,state.characters[n]?.movementClimb??null])),
      characters:Object.fromEntries(names.map(n=>{const c=state.characters[n];return [n,c&&{map:c.map,in:c.in,x:c.x,y:c.y,rip:!!c.rip,hp:c.hp,moving:!!c.moving}];}))});
    if(run.fault&&!faulted){
      const walk=await live.clients[P].run('globalThis.__e2eWalkHome');
      if(walk){faulted=true;await run.fault(walk);samples.at(-1).fault={observedAt:Date.now(),...walk};}
    }
    return run.until({state,escape});
  },{timeout:480_000,intervals:[run.interval??1000],message:'The party must reach its goal without anyone stepping in'}).toBe(true);
  }catch(error){
    await run.info.attach('farm-death-escape-failed',{body:JSON.stringify({death,samples,records:Object.fromEntries(await Promise.all(names.map(async n=>[n,await live.clients[n].run(harvest).catch(String)])))},null,1),contentType:'application/json'});
    throw error;
  }
  return samples;
}

// Measures the run (inventory items 3 and the reported values) from the samples and the ring.
async function measure(run:Run,death:{at:number;name:string},samples:any[],home:any){
  const result:Record<string,any>={};
  const recovering=samples.filter(s=>s.escape?.stage==='recovering');
  for(const name of run.names){
    const h=await run.live.clients[name].run(harvest);
    const escapes=h.records.filter((r:any)=>(r.kind==='escape'||r.kind==='death-recovery')&&r.at>=death.at);
    const journeys=new Map<string,{started?:number;ended?:number;code?:string;kind?:string;owner?:string}>();
    for(const r of escapes){const j=journeys.get(r.journeyId)||{};j.kind=r.kind;j.owner??=r.owner;if(r.decision==='started')j.started=r.at;if(r.decision==='ended'){j.ended=r.at;j.code=r.code;}journeys.set(r.journeyId,j);}
    const ordered=[...journeys.values()].filter(j=>j.started).sort((a,b)=>a.started!-b.started!);
    // Gaps between attempts: an attempt that arrived ends the walk home. From step 8b the
    // party's farm return convoy after it is a `death-recovery` request too (its tier), and the
    // member waits for it at home, not off home.
    // The rule reads the walk home, the escape's own journeys. A farm return that did not arrive
    // asks again on the next report of every member (the tasks owner's T5), and the
    // coordinator's new convoy reaches the member with the reply to its next report after that.
    // The farm return check reads its own new ask: a journey of another convoy after one that did not
    // arrive. A leg the same convoy starts again is the convoy's own ladder (the movement and tasks owners' recovery,
    // runtime/movement/coordinator/walk.ts `hold` and `recover`), which UP-2's walk
    // rows check; two earlier runs read 2498 and 3178 ms there, with one convoy id.
    // A convoy leg's owner names its convoy and the leg's own walk (`walk:party:<leader>:convoy-<id>:<walk>:<member>`),
    // so a leg the same convoy starts again after its hold and prepare stages carries a new owner
    // and the same convoy id (one trace: 3138 ms on one convoy, `shared-hold` then `shared-prepare`).
    const convoyOf=(owner?:string)=>owner?.match(/convoy-[^:]+/)?.[0]??owner;
    const gapsOf=(list:typeof ordered,newConvoy=false)=>list.slice(1).flatMap((j,i)=>list[i]!.code==='arrived'||newConvoy&&convoyOf(j.owner)===convoyOf(list[i]!.owner)?[]:[j.started!-(list[i]!.ended??j.started!)]);
    const gaps=gapsOf(ordered.filter(j=>j.kind==='escape')),farmGaps=gapsOf(ordered.filter(j=>j.kind==='death-recovery'),true);
    let reportGap=0;for(let i=1;i<h.reports.length;i++)reportGap=Math.max(reportGap,h.reports[i]-h.reports[i-1]);
    const homeAt=samples.find(s=>atHome(s.characters[name],home)&&!s.characters[name].rip)?.at;
    const deaths=samples.filter((s,i)=>i>0&&s.characters[name]?.rip&&!samples[i-1].characters[name]?.rip).length;
    // The escape's start after the death (13.5a item 2): the death recovery finishes weakened
    // attackers before the escape (phase `finishing`), which layer 7 step 4's run GB held 7.05 s where
    // the runs before read 0.3 to 1.05 s, so the home time also reads from the escape's start.
    const escapeAt=ordered.find(j=>j.kind==='escape')?.started;
    const finishingMs=samples.filter(s=>s.at>=death.at&&s.recovery?.phase==='finishing').length?Math.max(...samples.filter(s=>s.at>=death.at&&s.recovery?.phase==='finishing').map(s=>s.at))-death.at:0;
    result[name]={journeys:ordered,gaps,farmGaps,farmBound:2*reportGap+ESCAPE_PULSE_MS,reportGap,bound:reportGap+ESCAPE_PULSE_MS,homeAfterMs:homeAt?homeAt-death.at:null,
      escapeAfterDeathMs:escapeAt?escapeAt-death.at:null,homeAfterEscapeMs:homeAt&&escapeAt?homeAt-escapeAt:null,finishingMs,
      speed:h.speed,maxMovesPer4s:h.maxMovesPer4s,maxCallCost:h.maxCallCost,deathsAfterFault:name===death.name?Math.max(0,deaths-1):deaths,
      trying:[...new Set(recovering.map(s=>s.escape.trying[name]).filter(Boolean))],
      // Route time: the planned walking distance of its escape journeys at its speed.
      routeMs:[...journeys.keys()].reduce((sum,id)=>sum+(h.journeys[id]?.walking||0),0)/h.speed*1000};
  }
  await run.info.attach('farm-death-escape',{body:JSON.stringify({survival:run.survival,death,home,result,samples},null,1),contentType:'application/json'});
  console.log('FARM-DEATH-ESCAPE '+JSON.stringify({survival:run.survival,result:Object.fromEntries(Object.entries(result).map(([n,r])=>[n,{...r,journeys:r.journeys.length}]))}));
  return result;
}

const resumed=(s:{state:any})=>s.state.combatRecovery?.phase==='complete';

// Survival is the only path since step 10; the titles keep the names the catalog links.
const survival=true;
{
  test.describe('survival on, owner on',()=>{

    test.describe('case A: the trio lands off home',()=>{
      test.use({loadout:'combat-range',extraFighter:'mage',initialPositions:positions([W,P,B])});
      // The dashboard's Escape from an Arena farm runs the coordinated trio escape with
      // every member alive. A death does not reach it reliably: a death captured twice
      // (shared.js death listener and snapshot) counts again and ends the finishing
      // window while the warrior is still dead, so that escape falls to independent
      // recovery (case B's path).
      test(`bug 5 closed: the trio escape lands in the Arena`,async({live},info)=>{
        test.setTimeout(900_000);
        const names=[W,P,B];
        await hold(live,'skeletor');
        try{
          await farmArena(live,names);
          const home=await expectedHome(live,'arena');
          for(const n of names)await live.clients[n].run(escapeSpendProbe);
          // A monster planted on the living warrior and the priest; for Scare,
          // the warrior holds a jacko, put in its bag and equipped by its
          // own client, as the turns row equips the basher.
          const orb=await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)}),i=p.items.findIndex(x=>!x);p.items[i]={name:'jacko',level:0};p.citems[i]=cache_item(p.items[i]);p.esize--;resend(p,'u+cid+reopen');return i;})()`) as number;
          await expect.poll(()=>live.clients[W].run(`character.items[${orb}]?.name==='jacko'`),{timeout:10_000,message:'the jacko in the bag'}).toBe(true);
          await live.clients[W].run(`(equip(${orb}),true)`);
          await expect.poll(()=>live.clients[W].run(`!!(character.slots.orb&&character.slots.orb.name==='jacko')`),{timeout:15_000,message:'the warrior holds the jacko'}).toBe(true);
          for(const n of [W,P])await plantMonster(live,n,{hp:1_000_000,attack:1});
          const started={at:Date.now()};
          await live.post('/escape',{});
          // Scare sends the first monster away before it lands a blow (server.js:10711-10734,
          // `stop_pursuit`), and the next Scare, 5 s later, sends away the next monster that has not
          // reached the dashing warrior. The shield cycle check needs a monster
          // that stays on the warrior: a second one, immune, which Scare does not move
          // (`target.immune`, the server's `skill_immune` reply), planted once the Scare has gone, and
          // twice the warrior's speed, since a cgoo never caught the dashing warrior (one run: three Scares,
          // no blow).
          await expect.poll(()=>live.clients[W].run(`(globalThis.__e2eEscapeSpends||[]).some(s=>s.skill==='scare')`),{timeout:15_000,intervals:[50],message:'SV22: the Scare before the second plant'}).toBe(true);
          await plantMonster(live,W,{hp:1_000_000,attack:1,immune:true,chase:true});
          const run:Run={live,info,names,survival,
            until:({escape})=>escape?.stage==='home'};
          const samples=await observe(run,started);
          const result=await measure(run,{...started,name:''},samples,home);
          // Every escape spend asked the call budget and the potion
          // family had one flight; the shield, heal and Scare checks read the same probe.
          const sv16=await escapeSpendRead(live,names);
          await info.attach('sv16-escape-spends',{body:JSON.stringify(sv16,null,1),contentType:'application/json'});
          const caseA=caseASpendsHold(sv16,W,P,started.at,await live.clients[W].run('__partyMovement.records()') as any[]);
          console.log('SV16-READING '+JSON.stringify({...sv16,caseA}));
          sv16Holds(sv16,'case A');
          expect(samples.some(s=>s.escape?.destination?.map==='arena'),'The trio escape must land in the Arena').toBe(true);
          const completeOffHome=samples.filter(s=>s.escape?.stage==='complete'&&names.some(n=>!atHome(s.characters[n],home))).length;
          // Item 2: a landing off home is not an end state; the hold starts with everyone home.
          // Step 8a item 11: that hold is the home stage, not a failure.
          expect(completeOffHome).toBe(0);
          expect(samples.some(s=>s.escape?.stage==='failed-hold'),'an escape home that reads failed').toBe(false);
          const held=samples.at(-1)!;
          for(const name of names)expect(atHome(held.characters[name],home),name+' home at the hold').toBe(true);
          expect(held.escape.home).toMatchObject({map:home.map,x:home.x,y:home.y,radius:home.radius});
          // Step 8c item 3: the recovery convoy ran before the home stage; it is not dropped.
          expect(held.escape.convoyId,'the recovery convoy that gathered the party').toBeTruthy();
          for(const name of names)for(const gap of result[name].gaps)expect(gap,`${name} idle gap`).toBeLessThanOrEqual(result[name].bound);
          // SV56: each escape move goes within b9b5c91e's pulse of the report
          // reply that allows it, or within one report interval more after a lost event; the end run
          // reads the same gaps on b9b5c91e's checkout beside these.
          for(const name of names)for(const gap of result[name].gaps)expect.soft(gap,`SV56: ${name} escape move after its reply`).toBeLessThanOrEqual(result[name].bound+result[name].reportGap);
          // The mage's Blink, its Magiport
          // cast and the priest's accept, each call's server entries against its ledger. This is
          // the table with a mage, so the escape pulse's calls are checked here.
          chargesHold(await mageCosts(live,info,B,P));
        }finally{await restoreArena(live);}
      });
    });
  });
}

async function caseBRow(live:LiveGame,info:TestInfo){
        const names=[W,P];
        await hold(live,'skeletor');
        // The call budget's sampler from the death plant to the resume: each
        // fighter's server sum, its peak and 95th percentile, and CB1's bound.
        let sampler:{stop():Promise<CallSample[]>}|undefined,budgetFrom=0;
        try{
          // The hit probe starts before the warrior meets the arena's goos, and the farm runs
          // until it has held 15 s, so it holds every hit of the 15 s before the death plant
          // (survival-rows.ts `survivalHitProbe`). farmArena places the party at once: one run
          // started the probe 1000 ms before the plant. Its red plant starts it at the plant, as
          // an earlier run did.
          if(!red('sv24'))await live.clients[W].run(survivalHitProbe);
          await farmArena(live,names);
          if(!red('sv24'))await waitForGameplay(Math.max(0,15_000-(await live.clients[W].run('Date.now()-globalThis.__e2eSurvivalHitsFrom') as number)));
          // CB11 and CB21: every question the priest asks, with
          // the kind of the journey that holds it, from the farm to the resume.
          budgetFrom=await live.clients[P].run(`(()=>{const calls=globalThis.__partyHooks.calls,band=calls.band,log=globalThis.__e2eBands=[];
            calls.band=q=>{const a=band(q);log.push({at:Date.now(),band:q.band,method:q.method,kind:__partyMovement.live()?.kind??null,answer:a});return a;};return Date.now();})()`) as number;
          const home=await expectedHome(live,'arena');
          await live.clients[P].run(armWalkHome(true));
          for(const n of names)await live.clients[n].run(escapeSpendProbe);
          const tasksFrom=await taskSeq(live,`party:${W}`);
          // K1's check: no page
          // error on any member from the death to the resume. The death recovery's role loop hold
          // (shared.js `isOccupied`) threw out of every turns pass when it read a record that can be
          // null beside the assignment, and only a page error shows that.
          const errorsFrom=Object.fromEntries(names.map(n=>[n,live.clients[n].errors.length]));
          // The live half: the priest's queue client hears one
          // death for the warrior's death. The wrap logs each queue death on the priest. The red plant
          // adds b9b5c91e's second report to a `death` packet; an earlier run read no `death` packet for a
          // member, so the turns row's goo deaths carry this red plant.
          await live.clients[P].run(`(()=>{const q=globalThis.partyQueueClient,log=globalThis.__e2eQueueDeaths=[];if(!q||!q.death)return false;const d=q.death;
            q.death=function(id,...rest){log.push({at:Date.now(),id:String(id)});return d.call(this,id,...rest);};
            if(${red('tg21')})parent.socket.on('death',x=>{if(x&&x.id&&x.id!==character.name)globalThis.partyQueueClient.death(x.id);});return true;})()`);
          if(red('sv24'))await live.clients[W].run(survivalHitProbe);
          // The sampler starts at the death plant, after the 15 s farm, so its windows hold the
          // death and the escape as in the runs that recorded UP-2's executor figure.
          sampler=live.sampleCalls(names);
          const death=await killNativeCharacter(live,W);
          const hitsFrom=await live.clients[W].run('globalThis.__e2eSurvivalHitsFrom??null') as number|null;
          console.log('SURVIVAL-SV24-UP2 '+JSON.stringify({hitsFrom,deathAt:death.at,coveredMs:hitsFrom===null?null:death.at-hitsFrom}));
          expect.soft(hitsFrom!==null&&death.at-hitsFrom>=15_000,"SV24 (UP-2): the hit probe holds the 15 s before the warrior's death").toBe(true);
          let faultAt=0;
          const run:Run={live,info,names,survival,
            fault:async walk=>{faultAt=walk.at;},
            until:resumed};
          const samples=await observe(run,death);
          // The row's fault: four walks home, each failed at a door packet the fault dropped.
          const walkHome=await live.clients[P].run('globalThis.__e2eWalkHome') as {failed:number;uncounted:number;droppedWalks:number}|null;
          console.log('UP2-DOOR-FAULT '+JSON.stringify({walkHome,dropped:await live.clients[P].run('globalThis.__e2eDropped??0')}));
          expect.soft(walkHome?.droppedWalks,'UP-2: the fault fails four walks home, each at a door packet it dropped').toBe(FAILED_WALKS);
          const queueDeaths=await live.clients[P].run(`(globalThis.__e2eQueueDeaths||[]).filter(e=>e.id===${JSON.stringify(W)}).length`);
          console.log('TARGETING-TG21-UP2 '+JSON.stringify({queueDeaths}));
          expect.soft(queueDeaths,"TG21: the priest's queue deaths for the warrior's one death").toBe(1);
          const result=await measure(run,{...death,name:W},samples,home);
          // The escape check as in case A; for the warrior's death: its
          // killer and trip, one survival.died notice, and its respawns each asked, one in flight.
          const sv16=await escapeSpendRead(live,names);
          await info.attach('sv16-escape-spends',{body:JSON.stringify(sv16,null,1),contentType:'application/json'});
          // The death message names the last monster the warrior's client saw hit it in the 15 s
          // before the death (death.ts `message`); deathRecordHolds reads which from the probe.
          const deathRecord=await deathRecordHolds(live,W,death.at,'UP-2');
          console.log('SV16-READING '+JSON.stringify({...sv16,deathRecord}));
          sv16Holds(sv16,'UP-2');sv26Holds(sv16,W,'UP-2');
          expect(faultAt,'The fault must replace a live escape walk').toBeGreaterThan(0);
          for(const name of names)expect(live.clients[name].errors.slice(errorsFrom[name]),`K1: ${name} page errors during the death recovery`).toEqual([]);
          // Item 4: one goal for escape and death recovery, the game's respawn point.
          const escapeHome=samples.find(s=>s.escape?.home)?.escape.home,recoveryHome=samples.find(s=>s.recovery?.home)?.recovery.home;
          expect(escapeHome).toEqual(recoveryHome);
          expect(escapeHome).toMatchObject({map:home.map,x:home.x,y:home.y,radius:home.radius});
          // Item 3: no living member stands still off home between attempts.
          for(const name of names)for(const gap of result[name].gaps)expect(gap,`${name} idle gap`).toBeLessThanOrEqual(result[name].bound);
          // SV35: a farm return that did not arrive goes again on the next report, not after a series.
          for(const name of names)for(const gap of result[name].farmGaps)expect.soft(gap,`SV35: ${name}'s farm return retry`).toBeLessThanOrEqual(result[name].farmBound);
          // Item 5: the priest's walk names its ladder step.
          expect(result[P].trying.length).toBeGreaterThan(0);
          // One report brings the stage to the priest and the next brings its first rung
          // back, so a read within two report intervals of the stage start may lack it.
          const firstRecovering=samples.find(s=>s.escape?.stage==='recovering')!.at;
          const offHome=samples.filter(s=>s.escape?.stage==='recovering'&&s.at>firstRecovering+2*result[P].reportGap+ESCAPE_PULSE_MS&&!s.characters[P]?.rip&&!atHome(s.characters[P],home));
          expect(offHome.length).toBeGreaterThan(0);
          for(const s of offHome){expect(s.escape.trying[P],'trying while off home').toBeTruthy();
            expect(s.activity?.[P]?.activity,'card activity while off home').toBe('Regrouping after escape');expect(s.activity?.[P]?.trying,'card rung while off home').toBeTruthy();}
          // The failed walks at the door are stuck moments: each writes a stuck record with its
          // lead-up, and the card's activity never reads as stuck.
          const incidents=await live.clients[P].run('__partyMovement.incidents()');
          await info.attach('priest-incidents',{body:JSON.stringify(incidents),contentType:'application/json'});
          const stuck=incidents.filter((r:any)=>r.kind==='stuck'&&r.owner===`escape:${samples.find(s=>s.escape?.stage==='recovering')!.escape.id}`);
          expect(stuck.length,'stuck records for the failed walks home').toBeGreaterThan(0);
          for(const r of stuck){expect(r.leadUp.some((e:any)=>e.decision==='climbing'),`${r.id} lead-up starts at the climb`).toBe(true);
            expect(r.activity).toBe('Regrouping after escape');expect(Number.isFinite(r.noProgressMs)).toBe(true);}
          for(const s of offHome)expect(String(s.activity?.[P]?.activity),'the activity never reads stuck').not.toMatch(/stuck/i);
          // No farm-area move starts while death recovery is live.
          expect(samples.filter(s=>s.recovery&&!['complete','cancelled'].includes(s.recovery.phase)&&s.convoy==='farm-relocation'),'a farm-area move during death recovery').toEqual([]);
          // Death recovery holds the party, its escape suspends it, and once the escape is home
          // the recovery ends with its record complete, so the party's task returns to what it was.
          await expect.poll(async()=>(await taskTrail(live,`party:${W}`,tasksFrom)).trail.some(([d,k])=>d==='ended'&&k==='death-recovery'),
            {timeout:30_000,message:'The death recovery task ends once its record completes'}).toBe(true);
          const tasks=await taskTrail(live,`party:${W}`,tasksFrom);
          await info.attach('farm-death-escape-tasks',{body:JSON.stringify(tasks,null,1),contentType:'application/json'});
          const at=(d:string,k:string,code?:string)=>tasks.trail.findIndex(([x,y,z])=>x===d&&y===k&&(code===undefined||z===code));
          expect(at('granted','death-recovery'),'death recovery takes the party').toBeGreaterThanOrEqual(0);
          expect(at('granted','escape'),'its escape takes the party after it').toBeGreaterThan(at('granted','death-recovery'));
          expect(at('suspended','death-recovery','escape'),'the escape suspends death recovery').toBeGreaterThan(at('granted','death-recovery'));
          expect(at('ended','escape','escaped'),'the escape ends home').toBeGreaterThan(at('granted','escape'));
          expect(at('ended','death-recovery','recovered'),'death recovery ends with its record').toBeGreaterThan(at('granted','death-recovery'));
          expect(['escape','death-recovery']).not.toContain(tasks.live);
          // CB11: every send of the priest's escape asks survival; CB21: no survival question waits.
          const asks=await live.clients[P].run('globalThis.__e2eBands') as any[];
          const escape=asks.filter(a=>a.kind==='escape'&&['move','transport','leave','town','skill','magiport','stop'].includes(a.method));
          const bands=Object.fromEntries(await Promise.all(names.map(async n=>[n,await bandsRead(live,n)])));
          await info.attach('up2-call-bands',{body:JSON.stringify({asks,views:bands}),contentType:'application/json'});
          console.log('CALL-BUDGET-UP-2 '+JSON.stringify({escape:escape.length,bands:escape.reduce((sum:any,a:any)=>{sum[a.band]=(sum[a.band]||0)+1;return sum;},{}),
            survivalNotNow:asks.filter(a=>a.band==='survival'&&a.answer!=='send').length,meter:Object.fromEntries(names.map(n=>[n,meterOf(bands[n])]))}));
          expect(escape.length,"CB11: the priest's escape sends ask").toBeGreaterThan(0);
          expect(escape.filter(a=>a.band!=='survival'),'CB11: an escape send asks survival').toEqual([]);
          expect(asks.filter(a=>a.band==='survival'&&a.answer!=='send'),'CB21: survival questions answered not-now').toEqual([]);
          // The fault drops the priest's transports above the layer (armWalkHome), after the
          // budget admitted each, so each dropped one is an admission no emit matched.
          const dropped=await live.clients[P].run('globalThis.__e2eDropped??0') as number;
          for(const n of names)bandsHold(n,bands[n],budgetFrom,budgetFrom,n===P?{transport:dropped}:{});
        }finally{
          if(sampler){
            const samples=await sampler.stop(),calls=Object.fromEntries(names.map(n=>[n,callMeasures(samples,n)]));
            // Each window above the 95th percentile bound broken into its calls, the turns
            // executor's (attack, heal, skill, equip, use) apart from the rest.
            const turnsMethods=['attack','heal','skill','equip','use'];
            for(const n of names){const over=samples.filter(s=>(s.server[n]??0)>CB20_P95.up2[n]!&&s.calls?.[n]);
              const sum=(test:(m:string)=>boolean)=>over.map(s=>Math.round(s.calls![n]!.filter(([,m])=>test(m)).reduce((a,[, ,c])=>a+c,0)*10)/10);
              console.log('UP2-CB20-WINDOWS '+JSON.stringify({name:n,bound:CB20_P95.up2[n],windows:over.length,server:over.map(s=>s.server[n]),turns:sum(m=>turnsMethods.includes(m)),
                byMethod:over.reduce((acc:any,s)=>{for(const [,m,c] of s.calls![n]!)acc[m]=Math.round(((acc[m]??0)+c)*10)/10;return acc;},{})}));
              console.log('UP2-CB20-CALLS '+JSON.stringify({name:n,windows:over.map(s=>[s.at,s.server[n],s.calls![n]!.map(([t,m,c])=>[t,m,c])]).slice(0,30),
                records:((await live.clients[n].run('__partyMovement.records()')) as any[]).filter(r=>r.at>=over[0]?.at-8000&&r.at<=(over.at(-1)?.at??0)+1000&&['started','ended','crossing','refused'].includes(r.decision)).map(r=>[r.at,r.decision,r.kind,String(r.owner??'').slice(0,40),r.code??'',r.destination&&[r.destination.map,Math.round(r.destination.x),Math.round(r.destination.y)]]).slice(0,80)}).slice(0,20000));}
            // CB1's reading: every ledger entry each read held within 600 ms of an above sample's
            // server entries, with the reads' margins, so a call the ledger did not hold is told
            // apart from one it held and let go.
            for(const n of names)for(const a of calls[n]!.above??[]){
              const near=(t:number)=>samples.flatMap(s=>s.used[n]?(s.used[n]!.ledger??[]).filter(e=>Math.abs(e.at-t)<=600).map(e=>[s.used[n]!.at,e.at,e.method,e.cost]):[]);
              console.log('CB1-READING '+JSON.stringify({name:n,sample:a.at,calls:a.calls,near:(a.calls??[]).map(([t,m])=>({t,m,ledger:[...new Set(near(t).map(x=>JSON.stringify(x.slice(1))))]})),
                reads:samples.filter(s=>s.used[n]&&Math.abs(s.used[n]!.at-a.at)<=600).map(s=>[s.used[n]!.at,s.used[n]!.used,s.used[n]!.margin,s.used[n]!.latest])}).slice(0,6000));}
            await info.attach('up2-call-samples',{body:JSON.stringify({calls,samples}),contentType:'application/json'});
            console.log('CALL-SAMPLES '+JSON.stringify({label:'UP-2',calls:Object.fromEntries(Object.entries(calls).map(([n,m])=>[n,{...m,above:m.above?.length??null}]))}));
            for(const n of names){expect.soft(calls[n]!.usedSamples,`CB1: ${n}'s budget answers the sampler`).toBeGreaterThan(0);expect.soft(calls[n]!.above,`CB1: ${n}'s server sum above its used`).toEqual([]);
              // CB20: above its bound, the 95th percentile fails only where the turns
              // executor's own calls in a window above it rose against the before runs' figure.
              const cb20=cb20Windows(samples,n,CB20_P95.up2[n]!,CB20_TURNS_BEFORE.up2[n]!,samples[0]?.at??0);
              if((calls[n]!.p95??0)>CB20_P95.up2[n]!)expect.soft(cb20.rose,`CB20: ${n}'s windows above ${CB20_P95.up2[n]} whose executor calls rose above ${CB20_TURNS_BEFORE.up2[n]}`).toEqual([]);}
          }
          await restoreArena(live);
        }
}

async function caseCRow(live:LiveGame,info:TestInfo){
  const owner='on';
    const names=[W,P];
    await hold(live,'skeletor');
    try{
      await farmArena(live,names);
      await live.clients[P].run(armWalkHome(false));
      await live.clients[W].run(deathProbe);
      const death=await killNativeCharacter(live,W);
      const destination={map:'main',x:168,y:-134};
      let commandAt=0;
      const run:Run={live,info,names,survival:true,interval:100,
        fault:async()=>{commandAt=Date.now();await live.post('/command',{character:P,type:'character-travel',location:destination,label:'Player command during escape'});},
        until:({escape})=>commandAt>0&&(!escape||escape.stage==='released')};
      const samples=await observe(run,death);
      expect(commandAt).toBeGreaterThan(0);
      const records=async()=>(await live.clients[P].run(harvest)).records as any[];
      try{
        // The priest stands where the player sent it. Today the farm reunion that follows
        // the cancelled death recovery stops the command's own journey and walks the
        // priest to the same place as a group walk (reported, not a pass mark).
        await expect.poll(async()=>{const c=(await live.state()).characters[P];return !!c&&!c.moving&&c.map===destination.map&&Math.hypot(c.x-destination.x,c.y-destination.y)<=ARRIVAL_TOLERANCE;},
          {timeout:240_000,message:'The priest must reach the commanded destination'}).toBe(true);
      }catch(error){
        await info.attach('player-command-failed',{body:JSON.stringify({commandAt,records:await records(),samples,state:await live.state()},null,1),contentType:'application/json'});
        throw error;
      }
      const after=(await records()).filter(r=>r.at>=commandAt);
      const manualStart=after.find(r=>r.decision==='started'&&r.kind==='manual');
      expect(manualStart).toBeTruthy();
      expect(after.filter(r=>r.decision==='started'&&r.kind==='escape'&&r.at>=manualStart.at)).toEqual([]);
      const captures=await live.clients[W].run('globalThis.__e2eDeathProbe');
      await info.attach('player-command-during-escape',{body:JSON.stringify({commandAt,destination,after,samples,captures},null,1),contentType:'application/json'});
      // Reported, no pass mark: the warrior's death captures and the death recovery
      // phases the coordinator saw (the double capture of step 3 item 2).
      console.log('DEATH-CAPTURES '+JSON.stringify({owner,captures,recovery:samples.map(s=>s.recovery&&[s.at,s.recovery.id,s.recovery.phase,s.recovery.reason]).filter(Boolean)}));
      {
        // Step 4 item 7: the farm reunion never ends the command's own journey, which arrives.
        // Since step 13 the delayed respawn fallback asks the owner first (shared.js
        // `farmWalkHeld`) and does not begin under the command's walk, which outranks a farm
        // walk, so it sends no stop for the owner to refuse (the step 13 gate read 0 refused stops
        // here). The journey's end, `arrived` and not `stopped:`, and no task walk started before
        // it are the checks.
        const commanded=manualStart.journeyId;
        // The journey's end record and the coordinator's view of the priest standing still
        // are separate milestones; read the end with a bounded poll of the live ring.
        const ending=async()=>[...(await records()),...(await live.clients[P].run('__partyMovement.records()') as any[])].find(r=>r.decision==='ended'&&r.journeyId===commanded);
        await expect.poll(async()=>(await ending())?.code,{timeout:15_000}).toBe('arrived');
        const arrivedAt=(await ending()).at;
        expect(after.filter(r=>r.decision==='started'&&['escape','group-walk','task-walk'].includes(r.kind)&&r.at>=manualStart.at&&r.at<arrivedAt)).toEqual([]);
        // Reported, no pass mark: what moves the priest once the command's walk has arrived. A
        // timeout logs that nothing started in the window.
        const moved=await expect.poll(async()=>(await records()).some(r=>r.decision==='started'&&r.at>=arrivedAt),{timeout:30_000}).toBe(true).then(()=>true,()=>false);
        if(!moved)console.log('AFTER-COMMAND no walk started within 30 s of arrival');
        console.log('AFTER-COMMAND '+JSON.stringify((await records()).filter(r=>r.at>=arrivedAt).map(r=>[r.at-arrivedAt,r.decision,r.kind,String(r.owner??'').split(':')[0],r.code??'',r.destination&&[r.destination.map,Math.round(r.destination.x),Math.round(r.destination.y)]])));
      }
    }finally{await restoreArena(live);}
}

// A Hunt turn-in that comes due during the escape walk home
// waits below the escape and the party's death recovery. Neither walk ends for it, and the hand-in
// takes the party once the recovery is over. The table's escape setup, under Hunt mode on the
// Arena's Irradiated Goo.
async function turnInRow(live:LiveGame,info:TestInfo){
  const names=[W,P];
  await hold(live,'skeletor');
  try{
    await farmArena(live,names);
    await quests(live,info,{[W]:{id:'cgoo',count:30},[P]:{id:'cgoo',count:30}});
    await start(live,W,'cgoo');
    await expect.poll(async()=>profile(await live.state()).monsterHunt?.stage,{timeout:180_000,message:'The Hunt must farm its Arena mission'}).toBe('farming');
    await live.clients[P].run(armWalkHome(false));
    const tasksFrom=await taskSeq(live,`party:${W}`);
    const death=await killNativeCharacter(live,W);
    let dueAt=0;
    const run:Run={live,info,names,survival,
      fault:async()=>{dueAt=Date.now();await quests(live,info,{[W]:{id:'cgoo',count:0},[P]:{id:'cgoo',count:0}});},
      until:resumed};
    const samples=await observe(run,death);
    expect(dueAt,'The turn-in must come due during the walk home').toBeGreaterThan(0);
    const records=(await live.clients[P].run(harvest)).records as any[];
    expect(records.filter(r=>r.at>=dueAt&&r.decision==='ended'&&r.kind==='escape'&&/^replaced:/.test(String(r.code))),'an escape walk ended for the turn-in').toEqual([]);
    const tasks=await taskTrail(live,`party:${W}`,tasksFrom);
    const at=(d:string,k:string,code?:string)=>tasks.trail.findIndex(([x,y,z])=>x===d&&y===k&&(code===undefined||z===code));
    const recovered=at('ended','death-recovery','recovered');
    expect(recovered,'death recovery ends with its record').toBeGreaterThan(at('granted','death-recovery'));
    expect(tasks.trail.slice(at('granted','death-recovery'),recovered).filter(([d,k])=>d==='granted'&&k==='hunt-turn-in'),'a turn-in granted under death recovery').toEqual([]);
    await expect.poll(async()=>(await taskTrail(live,`party:${W}`,tasksFrom)).trail.some(([d,k])=>d==='granted'&&k==='hunt-turn-in'),
      {timeout:120_000,message:'The hand-in takes the party once the recovery is over'}).toBe(true);
    await info.attach('turn-in-during-escape',{body:JSON.stringify({dueAt,samples:samples.length,trail:(await taskTrail(live,`party:${W}`,tasksFrom)).trail},null,1),contentType:'application/json'});
  }finally{
    await live.post('/farming-mode',{character:W,mode:'default'}).catch(()=>{});
    await restoreArena(live);
  }
}

// The survival owner's cases D, E and F. Each plants its monsters with `live.admin`'s `new_monster`, as console-reload-rows.ts does,
// marked `e2eHunt` so restoreArena removes them, and holds the Arena's own spawns so a planted
// monster is the only foe.
// A monster beside `target` that attacks it, with the HP and attack given. The server recomputes a
// monster's attack from its zone stats (server.js:1818 `calculate_monster_stats`), so a set attack
// goes into its own zone stats.
async function plantMonster(live:LiveGame,target:string,stats:{hp:number;attack?:number;type?:string;immune?:boolean;chase?:boolean}){
  const attack=stats.attack===undefined?'':`m.zone_stats=Object.assign({},G.monsters[m.type],{attack:${Math.round(stats.attack)}});`;
  return live.admin(`output=(()=>{const p=get_player(${JSON.stringify(target)}),m=new_monster(p.in,{type:${JSON.stringify(stats.type??'cgoo')},position:[p.x+20,p.y],radius:0,count:1},{temp:1});
    m.e2eHunt=true;m.hp=m.max_hp=${Math.round(stats.hp)};${attack}target_player(m,p);calculate_monster_stats(m);${stats.immune?'m.immune=true;':''}${stats.chase?'m.speed=2*Math.max(m.speed,p.speed);':''}m.u=true;return {id:String(m.id),hp:m.hp,attack:m.attack};})()`) as Promise<{id:string;hp:number;attack:number}>;
}
const monsterAlive=(live:LiveGame,id:string)=>live.admin(`output=!!instances.arena.monsters[${JSON.stringify(id)}]`) as Promise<boolean>;
// The priest's damage per second, its attack at its frequency, the numbers the game's own fight
// model reads (hold-check.ts).
const priestDps=(live:LiveGame)=>live.clients[P].run('Math.max(1,(Number(character.attack)||0)*(Number(character.frequency)||1))') as Promise<number>;

// Case F: after the warrior's planted death the priest survives alone with one
// planted monster on it. (1) A monster the priest's damage clears long before its HP runs out: the
// party finishes (`finishing` holds) and kills it, through a burst planted mid-window and a
// second monster planted mid-window. A monster the priest cannot outlast: `escaping`.
const caseFRow=(winnable:boolean)=>async(live:LiveGame,info:TestInfo)=>{
  const names=[W,P];
  await hold(live,'skeletor');
  try{
    await farmArena(live,names);
    await hold(live);
    const dps=await priestDps(live),priest=await live.admin(`output=(()=>{const p=get_player('${P}');return {hp:p.hp,max:p.max_hp};})()`) as {hp:number;max:number};
    // (1): ten seconds of the priest's damage and an attack of 1.
    // (2): the game-data monster with no abilities whose damage per second on the priest, after the
    // priest's defence for its damage type (the server's `damage_multiplier`), outruns the priest's
    // heals the most, so the game-data model the verdict reads before a trend and the
    // fight agree; its planted attack makes the fight's blows twice the heals. An Ent read 216 a
    // second against 535 of heals (`armor` 2488 holds a physical blow to 5%), so the model finished
    // it and the verdict decided on the trend alone, which needs the party's damage to show.
    const losing=winnable?null:await live.admin(`output=(()=>{const p=get_player('${P}'),heal=p.attack*p.frequency;
      const rows=Object.entries(G.monsters).filter(([,m])=>!m.abilities&&!m.peaceful&&m.attack>0&&m.frequency>0).map(([type,m])=>{
        const mult=m.damage_type==='pure'?1:damage_multiplier(m.damage_type==='magical'?p.resistance:p.armor);
        return {type,mult,frequency:m.frequency,dps:m.attack*m.frequency*mult};}).sort((a,b)=>b.dps-a.dps);
      return {heal,best:rows[0]};})()`) as {heal:number;best:{type:string;mult:number;frequency:number;dps:number}};
    if(losing)expect(losing.best.dps,'F (2): a game-data monster outruns the heals of the priest').toBeGreaterThan(losing.heal);
    const first=await plantMonster(live,P,winnable?{hp:10*dps,attack:1}:
      {hp:10_000_000,type:losing!.best.type,attack:2*losing!.heal/(losing!.best.frequency*losing!.best.mult)});
    await expect.poll(()=>live.clients[P].run(`Object.values(parent.entities).some(e=>String(e.id)===${JSON.stringify(first.id)}&&e.target===${JSON.stringify(P)})`),
      {timeout:15_000,message:'F: the priest sees the planted monster on it'}).toBe(true);
    // Only the recovery this death starts counts: an earlier row's record has another id.
    const earlier=(await live.state()).combatRecovery?.id??null;
    const death=await killNativeCharacter(live,W);
    const samples:any[]=[],planted:any={first,dps,losing};let burstAt=0,secondAt=0;
    await expect.poll(async()=>{
      const state=await live.state(),r=state.combatRecovery?.id&&state.combatRecovery.id!==earlier?state.combatRecovery:null;
      samples.push({id:r?.id??null,at:Date.now()-death.at,phase:r?.phase??null,reason:r?.reason??null,verdicts:r?.verdicts??null,priestHp:state.characters[P]?.hp,
        alive:await monsterAlive(live,first.id),second:planted.second?await monsterAlive(live,planted.second.id):null,
        // Each planted monster's target on the server: one that dropped its target is no attacker
        // left to finish (3.6's foes are the monsters on the party).
        on:await live.admin(`output=${JSON.stringify([first.id,planted.second?.id??null])}.map(id=>{const m=id&&instances.arena.monsters[id];return !!m&&${JSON.stringify([W,P])}.includes(m.target);})`),
        // The first monster's HP on the server and in the recovery's targets, and the priest's
        // view of it, so a verdict that never reads a falling foe shows which side stood still.
        foeHp:{server:await live.admin(`output=(()=>{const m=instances.arena.monsters[${JSON.stringify(first.id)}];return m?m.hp:null;})()`),
          targets:(state.combatRecovery?.targets??[]).map((t:any)=>[t.id,t.hp]),
          priest:await live.clients[P].run(`(()=>{const e=parent.entities[${JSON.stringify(first.id)}];return {hp:e?e.hp:null,target:character.target||null};})()`).catch(()=>null)}});
      const last=samples.at(-1);
      if(winnable&&last.phase==='finishing'){
        // SV31: one burst mid-window, above the floor (the monster's next blows are 1 HP each).
        if(!burstAt&&last.at>=3000){burstAt=last.at;planted.burst=await plantVitals(live,P,{hp:0.3});}
        // SV32: a second attacker mid-window restarts the window.
        if(!secondAt&&last.at>=6000){secondAt=last.at;planted.second=await plantMonster(live,P,{hp:5*dps,attack:1});}
      }
      if(['escaping','recovering','returning-to-farm','complete'].includes(last.phase))return true;
      return winnable&&!last.alive&&secondAt>0&&last.second===false;
    },{timeout:120_000,intervals:[500],message:'F: the verdict decides'}).toBe(true);
    const leaving=(s:any)=>s.phase==='escaping'||s.phase==='recovering';
    // SV30: an escape while a planted monster is still on the party leaves a won fight; once no
    // foe is left the recovery walks home to regroup, as today's "completed encounter" does.
    const result={winnable,planted,phases:[...new Set(samples.map(s=>s.phase))],escaped:samples.some(leaving),
      escapedEarly:samples.filter(leaving).some(s=>(s.on??[]).some(Boolean)),
      firstKilled:samples.some(s=>s.alive===false),secondKilled:samples.some(s=>s.second===false),burstAt,secondAt,samples};
    await info.attach(`case-f-${winnable?'1':'2'}`,{body:JSON.stringify(result,null,1),contentType:'application/json'});
    console.log('SURVIVAL-CASE-F '+JSON.stringify({...result,samples:samples.length}));
    if(winnable){
      expect.soft(result.escapedEarly,'SV30: a fight the trend says the party wins ends in an escape while a foe is on the party').toBe(false);
      expect.soft(result.firstKilled,'SV30: the party kills the planted monster').toBe(true);
      expect.soft(burstAt>0,'SV31: the burst lands inside the finishing window').toBe(true);
      // SV32: the verdict's ring restarts its window at the second aggro.
      expect.soft((samples.at(-1)?.verdicts??[]).some((v:any)=>v.restart==='attacker'),'SV32: the window restarts at the new attacker').toBe(true);
    }else expect.soft(result.escaped,'SV30: a fight the survivor cannot outlast escapes').toBe(true);
  }finally{await restoreArena(live);}
};

// The group anchor in play: the
// coordinator asks `group.anchor` when it evaluates the group (runtime/coordinator/targeting/queue.ts
// `evaluateGroup`), and the formation centres on the member an add-on names, the healing anchor
// otherwise. The fixture add-on (scripts/tests/fixtures/anchor-addon.ts) joins the live
// coordinator's registry (e2e/live-coordinator.cjs) and the player's add-on switch turns it on.
async function anchorRow(live:LiveGame,info:TestInfo){
  const names=[W,P],anchorOf=async()=>{const s=await live.state();
    return names.map(n=>{const g=s.characters[n]?.groupedCombat;return (g?.state??g)?.anchor?.name??null;});};
  await hold(live,'skeletor');
  // The player's saved switches, as the warrior's registry holds them (the turns row reads them so).
  const saved=await live.clients[W].run(addonSwitches(false)) as Record<string,unknown>;
  try{
    await farmArena(live,names);
    await expect.poll(anchorOf,{timeout:30_000,message:'S9.11: with no add-on answer the formation centres on the priest'}).toEqual([P,P]);
    const registered=await live.post('/e2e-anchor-addon',{});
    await live.post('/settings',{changes:[{field:'addons',value:{...saved,[registered.name]:{enabled:true,settings:{member:W}}}}]});
    await expect.poll(anchorOf,{timeout:30_000,message:'S9.11: the add-on centres the formation on the warrior'}).toEqual([W,W]);
    await live.post('/settings',{changes:[{field:'addons',value:{...saved,[registered.name]:{enabled:false,settings:{member:W}}}}]});
    await expect.poll(anchorOf,{timeout:30_000,message:'S9.11: switched off, the formation centres on the priest again'}).toEqual([P,P]);
    await info.attach('s9-11-anchor',{body:JSON.stringify({registered,anchors:await anchorOf()}),contentType:'application/json'});
  }finally{await live.post('/settings',{changes:[{field:'addons',value:saved}]}).catch(()=>{});await restoreArena(live);}
}

// Case E: a party with no mage, the warrior and the priest, takes the Escape button; both
// walk to home and the escape reaches its `home` stage with no member standing still off home
// between attempts, the table's idle gap rule (case B's item 3). The time home is recorded beside
// the route time of the escape journeys, which counts only part of a walk that crosses a door
//.
async function caseERow(live:LiveGame,info:TestInfo){
  const names=[W,P];
  await hold(live,'skeletor');
  try{
    await farmArena(live,names);
    for(const n of names)await live.clients[n].run(escapeSpendProbe);
    const home=await expectedHome(live,'arena'),started={at:Date.now()};
    await live.post('/escape',{});
    const samples=await observe({live,info,names,survival,until:({escape})=>escape?.stage==='home'},started);
    const result=await measure({live,info,names,survival,until:()=>true},{...started,name:''},samples,home);
    const stages=[...new Set(samples.map(s=>s.escape?.stage).filter(Boolean))];
    // SV22's other half: without a jacko, no Scare.
    const spends=await escapeSpendRead(live,names);
    expect.soft(spends.spends[W]!.filter(s=>s.skill==='scare').length,'SV22: no Scare without a jacko').toBe(0);
    console.log('SURVIVAL-CASE-E '+JSON.stringify({stages,result:Object.fromEntries(names.map(n=>[n,{homeAfterMs:result[n].homeAfterMs,routeMs:result[n].routeMs,reportGap:result[n].reportGap}]))}));
    expect.soft(stages.at(-1),'SV21: the escape reaches its home stage').toBe('home');
    for(const n of names){
      expect.soft(result[n].homeAfterMs,`SV21: ${n} reaches home`).not.toBeNull();
      for(const gap of result[n].gaps)expect.soft(gap,`SV21: ${n} idle gap between attempts`).toBeLessThanOrEqual(result[n].bound);
    }
  }finally{await restoreArena(live);}
}

// Cases B and C share one game run: both farm the Arena with the warrior and the priest on the
// same loadout, and each kills the warrior. The reset is arenaReset (live-fixtures.ts).
test.describe('cases B and C: a blocked walk home, then a player command during it',()=>{
  test.use({loadout:'combat-range',initialPositions:positions([W,P])});
  liveScenarioTable('UP-2 and D7: the walk home climbs past blocked doors, and a player command ends it',3_600_000,arenaReset,[
    ['D7: a travel command ends the escape and the priest walks it (owner on)',caseCRow],
    ['UP-2 recovers: a farming death, the first four walks home fail at the door',caseBRow],
    ['a Hunt turn-in comes due during the escape walk home',turnInRow],
    // The survival owner's cases share this table's setup.
    ['case E: a party with no mage walks home',caseERow],
    ['case F (1): after a death the party finishes a fight it wins',caseFRow(true)],
    ['case F (2): after a death the party leaves a fight it cannot outlast',caseFRow(false)],
    // The movement owner's S9.11 in play shares the Arena farm.
    ['S9.11: a fixture add-on centres the formation on the member it names',anchorRow],
    // 01 step 8 (the test cut): the console reload rows log in on the same loadout.
    ...reloadRows,
  ]);
});

// Case D: a party with a mage that is not the warrior, mage and priest
// trio. The fixture's warrior slot logs in as a ranger, so the party is a ranger, a priest and a
// mage; a monster is planted on each before the Escape button. (1) The mage Blinks and ports both
// while its MP covers two Magiports. (2) The mage planted to its Blink and one Magiport's MP ports
// one member, and the other walks home. (3) The priest planted dead after the Blink: the ranger is
// still ported, and the priest respawns through its own death recovery and reaches the same home.
const portStage=(name:string)=>`port:${name}`;
async function trioReset(live:LiveGame){
  const names=[W,P,B];
  await restoreArena(live);
  // Case D (2) plants the mage to one Magiport's MP; each case starts with every member's own MP.
  await live.admin(`output=(()=>{for(const n of ${JSON.stringify(names)}){const p=get_player(n);p.mp=p.max_mp;resend(p,'u');}return true;})()`);
  await expect.poll(async()=>{const state=await live.state(),escape=await escapeRead(live);
    return names.every(n=>state.characters[n]&&!state.characters[n].rip)&&(!escape||['complete','home','released','failed-hold'].includes(escape.stage))&&
      (!state.combatRecovery||['complete','cancelled'].includes(state.combatRecovery.phase));},
    {timeout:240_000,message:'The party must be at rest before the next case'}).toBe(true);
  const start=arenaPositions(names) as Record<string,{map:string;x:number;y:number}>;
  await live.admin(`output=(()=>{for(const [n,at] of Object.entries(${JSON.stringify(Object.fromEntries(names.map(n=>[n,start[n]])))})){const p=get_player(n);transport_player_to(p,at.map,[at.x,at.y]);}return true;})()`);
  for(const name of names)await expect.poll(async()=>live.clients[name].run(`character.map==='arena'&&Math.hypot(character.real_x-(${start[name]!.x}),character.real_y-(${start[name]!.y}))<=20`),
    {timeout:60_000,message:'Every fighter must stand on the farm for the next case'}).toBe(true);
}
const caseDRow=(variant:'ports'|'one-port'|'dead')=>async(live:LiveGame,info:TestInfo)=>{
  const names=[W,P,B];
  await hold(live,'skeletor');
  let potions:any=null;
  try{
    await farmArena(live,names);
    await hold(live);
    for(const n of names)await plantMonster(live,n,{hp:1_000_000,attack:1});
    let planted:any=null;
    if(variant==='one-port'){
      // (2) The mage's MP covers its Blink and one Magiport and no second: its MP potions leave the
      // bag for the case, since the escape's row 2 drinks MP every potion cooldown and two potions
      // refill a Magiport between the Blink and the second port. The server plants the MP as the
      // mage's Blink packet arrives: the escape record names no landing a sample can wait for
      // between the Blink and the first port, and the mage fights until its next report reply hands
      // it the escape (one run's `cburst` spent 1373 of the MP planted before the Escape).
      potions=await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(B)}),kept=[];p.items.forEach((x,i)=>{if(x&&G.items[x.name]&&(G.items[x.name].gives||[]).some(g=>g[0]==='mp')){kept.push([i,x]);p.items[i]=null;}});
        cache_player_items(p);resend(p,'u+cid+reopen');return kept;})()`);
      const mp=await live.clients[B].run('(()=>{const r=(100-(Number(character.mp_reduction)||0))/100;return {blink:Math.ceil((Number(G.skills.blink.mp)||0)*r),port:Math.ceil((Number(G.skills.magiport.mp)||0)*r)};})()') as {blink:number;port:number};
      await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(B)}),mpAt=${mp.blink+Math.ceil(1.5*mp.port)};delete globalThis.__e2eBlinkPlanted;
        const plant=globalThis.__e2eBlinkPlant=data=>{if(data&&data.name==='blink'&&!globalThis.__e2eBlinkPlanted){p.mp=mpAt;globalThis.__e2eBlinkPlanted={at:Date.now(),mp:p.mp};}};
        p.socket.prependListener('skill',plant);return true;})()`);
      planted={stage:null,at:Date.now(),costs:mp};
    }
    const home=await expectedHome(live,'arena'),started={at:Date.now()};
    await live.post('/escape',{});
    const samples=await observe({live,info,names,survival,interval:250,
      fault:undefined,
      until:({state,escape})=>{
        // (2) plants the mage's MP once its Blink has landed, before its first port goes, so the
        // planted MP covers one Magiport; (3) kills the priest once a port stage runs.
        const due=variant==='dead'&&!!escape&&!['blink','recovering','recovery-convoy','home','failed-hold','released'].includes(escape.stage);
        if(!planted&&due){
          planted={stage:escape.stage,at:Date.now()};
          killNativeCharacter(live,P).then(r=>{planted.result=r;},e=>{planted.error=String(e).slice(0,200);});
        }
        // A member killed mid-escape starts the party's death recovery, which releases the escape
        // once every member is home (runtime/coordinator/survival/recovery.ts `recover`).
        return escape?.stage==='home'||escape?.stage==='failed-hold'||escape?.stage==='released'&&!!state.combatRecovery&&['returning-to-farm','complete'].includes(state.combatRecovery.phase);
      }},started);
    if(variant==='one-port')planted.result=await live.admin('output=globalThis.__e2eBlinkPlanted??null');
    const result=await measure({live,info,names,survival,until:()=>true},{...started,name:''},samples,home);
    const stages=samples.map(s=>s.escape?.stage).filter((v,i,a)=>v&&v!==a[i-1]);
    const firstWalk=stages.indexOf('recovering');
    // A member is ported once the escape records it beside the mage (its `ported` flag); a port stage
    // the mage's MP cannot cover ends at once and sends that member to the walk (`walk`).
    const last=samples.filter(s=>s.escape?.ported).at(-1)?.escape??{ported:[],walk:[]};
    const ported=(n:string)=>(last.ported??[]).includes(n)&&(firstWalk<0||stages.indexOf(portStage(n))<firstWalk||variant!=='ports');
    console.log('SURVIVAL-CASE-D '+JSON.stringify({variant,stages,planted,home:Object.fromEntries(names.map(n=>[n,result[n].homeAfterMs]))}));
    await info.attach(`case-d-${variant}`,{body:JSON.stringify({variant,stages,planted,samples},null,1),contentType:'application/json'});
    expect.soft(stages[0],'SV19: the mage Blinks first').toBe('blink');
    if(variant==='ports'){
      for(const n of [W,P])expect.soft(ported(n),`SV19: the mage ports ${n} before anyone walks`).toBe(true);
    }else if(variant==='one-port'){
      expect.soft(planted?.result?.mp,'SV20: the mage planted to its Blink and one Magiport').toBe(planted?.costs?(planted.costs.blink+Math.ceil(1.5*planted.costs.port)):-1);
      expect.soft([W,P].filter(n=>(last.ported??[]).includes(n)).length,'SV20: one port within the planted MP').toBe(1);
      expect.soft([W,P].filter(n=>(last.walk??[]).includes(n)).length,'SV20: the member the MP cannot cover walks').toBe(1);
    }else{
      expect.soft(planted,'SV45: the priest planted dead after the Blink').not.toBeNull();
      expect.soft((last.ported??[]).includes(W),'SV45: the ranger is still ported').toBe(true);
      // A crossing stage ends on its reply; the dead member's stage does not wait for it: it
      // ends within the next report and one escape pulse of the death.
      const afterDeath=samples.find(s=>planted&&s.at>=planted.at&&s.escape?.stage!==portStage(P));
      expect.soft(afterDeath&&planted?afterDeath.at-planted.at:null,'SV23: the dead priest\'s port stage ends at its next report').not.toBeNull();
      if(afterDeath&&planted)expect.soft(afterDeath.at-planted.at,'SV23: the dead priest\'s port stage ends at its next report').toBeLessThanOrEqual(2*result[P].reportGap+ESCAPE_PULSE_MS);
    }
    for(const n of names)expect.soft(result[n].homeAfterMs,`SV19 to SV45: ${n} reaches the same home`).not.toBeNull();
  }finally{
    if(variant==='one-port')await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(B)});if(p&&globalThis.__e2eBlinkPlant)p.socket.off('skill',globalThis.__e2eBlinkPlant);
      delete globalThis.__e2eBlinkPlant;delete globalThis.__e2eBlinkPlanted;return true;})()`);
    if(potions?.length)await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(B)});for(const [i,x] of ${JSON.stringify(potions)}){const j=p.items[i]?p.items.findIndex(y=>!y):i;if(j>=0)p.items[j]=x;}
      cache_player_items(p);resend(p,'u+cid+reopen');return true;})()`);
    await restoreArena(live);}
};
test.describe('case D: a party with a mage that is not the trio',()=>{
  test.use({loadout:'combat-range',primaryClass:'ranger',extraFighter:'mage',initialPositions:positions([W,P,B])});
  liveScenarioTable('case D: the mage leads the escape of a ranger, a priest and a mage',3_600_000,trioReset,[
    ['case D (1): the mage ports both members',caseDRow('ports')],
    ['case D (2): the mage ports whom its MP covers, the other walks',caseDRow('one-port')],
    ['case D (3): a member dead after the Blink leaves to its own recovery',caseDRow('dead')],
  ]);
});

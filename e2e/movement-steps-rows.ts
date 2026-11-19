import {expect,callMeasures,type LiveGame} from './live-fixtures';
import {answered,bandsHold,bandsRead,CB20_P95,meterOf,survivalWaits} from './call-budget-rows';
import {cb20Windows,CB20_TURNS_BEFORE} from './call-budget-cb20';
import type {TestInfo} from '@playwright/test';
import {spendLog,a36Casts,red} from './turns-rows';
import {COMBAT,fightersReady,windowStart,turnsWindow,clock as clockOf} from './movement-owner-helpers';
import {fighters,location,party,travel} from './game/hunt-lifecycle';
import {bounds,contains} from '../runtime/hunting/zones';
import {windowsOpen,type PositionSample} from './steps-windows';
import {MOVEMENT_TICK_MS} from '../runtime/movement/rules';

// Step 5 of the movement owner migration: combat steps from real combat, measured on
// the step 4 Goo setup. Failure inventory: e2e/movement-owner-failures.md, "Step 5", items 10
// to 13. Six farming windows, so a measure's spread between windows can be told apart from a
// change between steps (the step 4 carry over).
// The rows run as steps of live-movement-owner.spec.ts's table of rows that start from the
// default fixture.
const WINDOWS=6, WINDOW_MS=120_000;
// Design § 2.4 rule 5: a combat pause outlives combat once its last step's window (`live().stepMs`,
// the step's walking time plus one movement tick, steps.ts stepWindowMs) and the owner's next pass
// (MOVEMENT_TICK_MS) have gone by with no new step or hold.
const instrument=`(()=>{if(globalThis.__e2eSteps)return true;const s=globalThis.__e2eSteps={moves:[],stale:[],deaths:[],failed:[],records:new Map(),
  since:Math.max(0,...__partyMovement.records().map(r=>r.seq)),lastId:__partyMovement.last()?.id},original=globalThis.move,combat=${COMBAT};
  globalThis.move=function(x,y){s.moves.push({at:Date.now(),stop:Math.hypot(x-character.real_x,y-character.real_y)<1,
    combat:combat.test(String(new Error().stack)),cc:Number(character.cc)||0});return original(x,y);};
  let dead=!!character.rip;setInterval(()=>{for(const r of __partyMovement.records())if(r.seq>s.since)s.records.set(r.seq,r);
    // Step 6 item 8: each failed journey's own failure text, so a run of failures names its cause.
    const last=__partyMovement.last();if(last&&last.id!==s.lastId){s.lastId=last.id;if(!last.done)s.failed.push({at:Date.now(),id:last.id,end:last.end,
      reason:last.reason,engine:last.engine,searches:last.searches,retries:last.retries,stage:last.failureContext?.recoveryStage,firstIssue:last.failureContext?.firstIssue?.reason});}
    const live=__partyMovement.live();if(live&&live.paused&&Date.now()-live.stepAt>=live.stepMs+${MOVEMENT_TICK_MS})s.stale.push({at:Date.now(),live});
    if(character.rip&&!dead)s.deaths.push({at:Date.now(),cause:globalThis.__partyLastDeathInfo?.message??null});dead=!!character.rip;},250);return true;})()`;
const windowReport=(from:number,to:number)=>`(()=>{const s=globalThis.__e2eSteps,inside=x=>x.at>=${from}&&x.at<${to},m=s.moves.filter(inside);
  let worst=0;for(let i=0,j=0;i<m.length;i++){while(m[i].at-m[j].at>4000)j++;worst=Math.max(worst,i-j+1);}
  const records=[...s.records.values()].filter(inside),count=test=>records.filter(test).length;
  return {moves:m.length,maxPer4s:worst,maxCallCost:Math.max(0,...m.map(x=>x.cc)),stops:m.filter(x=>x.stop).length,
    combatMoves:m.filter(x=>x.combat&&!x.stop).length,combatStops:m.filter(x=>x.combat&&x.stop).length,
    deaths:s.deaths.filter(inside),stale:s.stale.filter(inside),failed:s.failed.filter(inside),
    recovery:{failed:count(r=>r.decision==='ended'&&String(r.code).startsWith('failed:')),replaced:count(r=>r.decision==='ended'&&String(r.code).startsWith('replaced:')),
      refused:count(r=>r.decision==='refused'),refusedStops:count(r=>r.decision==='refused-stop'),stepRefused:count(r=>r.decision==='step-refused')},
    // Each failed end by kind, end code and cause, to name what a recovery step was.
    failures:records.filter(r=>r.decision==='ended'&&String(r.code).startsWith('failed:')).reduce((sum,r)=>{const key=[r.kind,r.code,r.cause??''].join('|');sum[key]=(sum[key]||0)+1;return sum;},{}),
    started:count(r=>r.decision==='started'),pauses:count(r=>r.decision==='paused'&&r.cause==='combat'),
    resumes:records.filter(r=>r.decision==='resumed').reduce((sum,r)=>{sum[r.cause]=(sum[r.cause]||0)+1;return sum;},{})};})()`;

// The party's Auto combat mode scatters on a learned goo, which spreads the fighters past the farm
// box the windows open in, so the row runs on Default (no record names the measured mode) and puts
// each fighter's previous mode back.
export async function gooWindowsRow(live:LiveGame,info:TestInfo){
  const state=await live.state();
  const before=Object.fromEntries(fighters.map(n=>[n,String(state.farmingProfiles?.[n]?.combatMode??'auto')]));
  for(const n of fighters)await live.post('/farming-mode',{character:n,combatMode:'default'});
  try{await gooWindows(live,info);}
  finally{for(const n of fighters)await live.post('/farming-mode',{character:n,combatMode:before[n]});}
}
async function gooWindows(live:LiveGame,info:TestInfo){
    await fightersReady(live);
    for(const name of fighters){await live.clients[name].run(instrument);await live.clients[name].run(spendLog);}
    await party(live);
    // The call budget's callers: each fighter's band answers
    // from the walk to the goo field to the windows' end.
    const budgetFrom=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,{at:await live.clients[n].run('Date.now()') as number,
      bands:await bandsRead(live,n),owner:await live.clients[n].run('__partyMovement.ownerReport()')}])));
    const farm=await location(live,'goo');
    await live.post('/navigate-to-monster',{monsterId:'goo',location:farm});
    await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{},monsterSearchRadius:400});
    const clock=(name:string)=>clockOf(live,name);
    // The first window opens at the first kill after both fighters
    // stand inside the farm area, so it measures the farming and not the walk in.
    const positions:PositionSample[]=[],openFrom=Date.now();
    // The warrior engages goo at range from outside the box, so both fighters travel to the box's
    // centre first. Each sample taken while they walk in feeds the same positions the opening reads,
    // so the first both-inside sample stays the opening's standing time if farming pulls them out again.
    const [x0,y0,x1,y1]=bounds(farm) as [number,number,number,number],centre={map:farm.map,x:Math.round((x0+x1)/2),y:Math.round((y0+y1)/2)};
    for(const name of fighters)await travel(live,name,centre);
    await expect.poll(async()=>{
      const state=await live.state();
      for(const name of fighters){const s=state.characters[name];if(s)positions.push({at:Date.now(),name,map:s.map,in:s.in,x:Number(s.x),y:Number(s.y)});}
      return fighters.every(n=>{const s=state.characters[n];return !!s&&contains(farm,{x:Number(s.x),y:Number(s.y)},0);});
    },{timeout:120_000,intervals:[500]}).toBe(true);
    await expect.poll(async()=>{
      const state=await live.state();
      for(const name of fighters){const s=state.characters[name];if(s)positions.push({at:Date.now(),name,map:s.map,in:s.in,x:Number(s.x),y:Number(s.y)});}
      const kills=(await Promise.all(fighters.map(n=>live.clients[n]!.events()))).flat()
        .filter((e:any)=>e.event==='hit'&&(e.data?.kill||e.data?.dead)&&fighters.includes(e.data?.hid)&&Number(e.at)>=openFrom).map((e:any)=>Number(e.at));
      return windowsOpen(positions,kills,fighters,p=>contains(farm,p,0));
    },{timeout:180_000,intervals:[1_000]}).not.toBeNull();
    const windows:any[]=[];
    const a36From=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,await clock(n)])));
    // The call budget's sampler over the six windows: each fighter's
    // server sum, its peak and 95th percentile, and CB1's bound.
    const sampler=live.sampleCalls([...fighters]);
    // TC33's red plant: each fighter's attack call leaves 400 ms after the executor sends it.
    if(red('tc33'))for(const n of fighters)await live.clients[n].run('(()=>{const a=globalThis.attack;globalThis.attack=t=>new Promise(r=>setTimeout(()=>r(a(t)),400));return true;})()');
    let calls:Record<string,ReturnType<typeof callMeasures>>={},samples:Awaited<ReturnType<typeof sampler.stop>>=[];
    try{
    for(let index=0;index<WINDOWS;index++){
      const start=await windowStart(live);
      // The goos' levels and HP on the server as the window starts: a goo's HP sets how many hits
      // it takes.
      const goos=await live.admin(`output=(()=>{const out={};for(const m of Object.values(instances.main.monsters))if(m.type==='goo'){const k=(m.level||1)+':'+m.max_hp;out[k]=(out[k]||0)+1;}return out;})()`).catch(()=>null);
      const startedAt=Date.now();
      await expect.poll(async()=>Date.now()-startedAt,{timeout:WINDOW_MS+30_000,intervals:[5_000]}).toBeGreaterThan(WINDOW_MS);
      const result=Object.fromEntries(await Promise.all(fighters.map(async name=>{
        const end=await clock(name),events=(await live.clients[name].events()).filter((event:any)=>Number(event.sequence)>start[name]!.event&&event.event==='hit'&&event.data?.hid===name);
        const turns=await turnsWindow(live,name,start[name]!,end);
        return [name,{windowMs:end-start[name]!.at,hits:events.length,kills:events.filter((hit:any)=>hit.data.kill||hit.data.dead).length,
          hitIds:events.map((hit:any)=>[String(hit.data.id),!!(hit.data.kill||hit.data.dead)]),
          // The hit's damage and the fighter's own attack and level, for the kills a hit makes.
          damage:Math.round(events.reduce((s:number,hit:any)=>s+(Number(hit.data.damage)||0),0)/Math.max(1,events.length)),
          stats:await live.clients[name].run('({level:character.level,attack:character.attack,frequency:character.frequency})'),turns,
          native:await live.clients[name].run(windowReport(start[name]!.at,end)),
          owner:{before:start[name]!.owner,after:await live.clients[name].run('__partyMovement.ownerReport()')}}];
      })));
      // Which goo each fighter's hits land on. A priest hit kills only a goo
      // the warrior did not finish, so the priest's kills per window follow its hits on goos the
      // warrior also hit.
      const [warrior,priest]=fighters.map(n=>(result[n] as any).hitIds as [string,boolean][]);
      const warriorIds=new Set(warrior!.map(([id])=>id));
      (result as any).goos=goos;
      // TG16: a fighter's hits on a goo its own earlier hit in the
      // window already killed, the attack the overkill skip removes.
      const ownDead=(hits:[string,boolean][])=>{const killed=new Set<string>();let n=0;for(const [id,k] of hits){if(killed.has(id))n++;if(k)killed.add(id);}return n;};
      (result as any).sharedHits={priestHits:priest!.length,onWarriorGoos:priest!.filter(([id])=>warriorIds.has(id)).length,
        priestKills:priest!.filter(([,k])=>k).length,priestGoos:new Set(priest!.map(([id])=>id)).size,
        priestOwnDead:ownDead(priest!),warriorOwnDead:ownDead(warrior!)};
      for(const n of fighters)delete (result[n] as any).hitIds;
      windows.push(result);
      console.log('MOVEMENT-STEPS-WINDOW '+JSON.stringify({index,result}));
    }
    }finally{
      samples=await sampler.stop();
      calls=Object.fromEntries(fighters.map(n=>[n,callMeasures(samples,n)]));
      await info.attach('steps-call-samples',{body:JSON.stringify({calls,samples}),contentType:'application/json'});
      console.log('CALL-SAMPLES '+JSON.stringify({label:'steps windows',calls:Object.fromEntries(Object.entries(calls).map(([n,m])=>[n,{...m,above:m.above?.length??null}]))}));
      // Decided 2026-11-09: each
      // fighter's server call cost per party kill over the windows, the cost of the play itself,
      // from the sampler's server entries (each counted once) and the windows' kills.
      {const partyKills=windows.reduce((a,w)=>a+fighters.reduce((b,n)=>b+(w[n]?.kills??0),0),0),windowMs=windows.reduce((a,w)=>a+(w[fighters[0]!]?.windowMs??0),0)/Math.max(1,windows.length);
        const perKill=Object.fromEntries(fighters.map(n=>{const seen=new Map<string,[number,string,number]>();for(const x of samples)for(const e of (x.calls?.[n]??[]))seen.set(e.join('|'),e);
          const all=[...seen.values()],span=all.length?Math.max(...all.map(e=>e[0]))-Math.min(...all.map(e=>e[0])):0,cost=all.reduce((a,e)=>a+e[2],0);
          const perWindow=span?cost/span*windowMs:null;return [n,{perWindow:perWindow===null?null:Math.round(perWindow*10)/10,perPartyKill:perWindow===null||!partyKills?null:Math.round(perWindow/(partyKills/Math.max(1,windows.length))*100)/100}];}));
        console.log('TG33-PER-KILL '+JSON.stringify({partyKillsPerWindow:Math.round(partyKills/Math.max(1,windows.length)*10)/10,perKill}));}
      // TC4, TC11: one attack call per edge, a resend only at the
      // server's own time left, every call answered but the one in flight, no send before its
      // family's edge and no ready attack family left waiting past one pass.
      // TG16: the priest never attacks a goo its own hit in flight already killed.
      for(const [i,w] of windows.entries())expect.soft(w.sharedHits.priestOwnDead,`TG16: window ${i}'s priest hits on a goo its own earlier hit killed`).toBe(0);
      for(const w of windows)for(const n of fighters){const t=w[n]!.turns;
        expect.soft(t.earlyResends,`TC4: ${n}'s attack resends before the cooldown reply's ms`).toBe(0);
        expect.soft(t.unanswered,`TC4: ${n}'s attack calls with no reply beyond the one in flight`).toBeLessThanOrEqual(1);
        expect.soft(t.tc11.sendsBeforeEdge,`TC11: ${n}'s sends before their family's edge`).toEqual([]);
        expect.soft(t.tc11.waitsWithoutNotNow,`TC11: ${n}'s ready attack family waiting past one pass with no not-now`).toEqual([]);}
      // TC33: each fighter's accepted attacks a second over the six windows
      // stay at or above step 1's spread on the steps windows (13.2: warrior 0.76 to 0.81, priest 0.83
      // to 0.84, each a run's mean).
      const STEP1_LOW:Record<string,number>={[fighters[0]!]:0.76,[fighters[1]!]:0.83};
      // Decided 2026-11-09: the rate leaves out the time the overkill skip held a
      // ready family (spendWindow `tc33PerSecond`); `accepted` keeps the raw rate as a reading.
      for(const n of fighters){const rates=windows.map(w=>w[n]!.turns.tc33PerSecond as number),mean=rates.reduce((s,v)=>s+v,0)/rates.length;
        const raw=windows.map(w=>w[n]!.turns.acceptedPerSecond as number);
        console.log('TURNS-TC33 '+JSON.stringify({name:n,mean:Math.round(mean*1000)/1000,rates,accepted:Math.round(raw.reduce((s,v)=>s+v,0)/raw.length*1000)/1000,acceptedRates:raw,skipHeldMs:windows.map(w=>w[n]!.turns.skipHeldMs)}));
        expect.soft(mean,`TC33: ${n}'s accepted attacks a second against step 1's spread`).toBeGreaterThanOrEqual(STEP1_LOW[n]!);}
      // TRN-Q24: no spend of either fighter counts lost in the windows, the Dash case of step 4.
      for(const n of fighters){const ring=await live.clients[n]!.run('globalThis.__partyTurns?.records?.()??null') as any[]|null;
        const lost=(ring??[]).map((r,i)=>[r,i] as const).filter(([r])=>r.kind==='lost');
        // A lost reply's time against the windows and the ring entries beside it, for its trace.
        // The fighter's sends and replies from a second before the lost spend's send to 1.5 s
        // after its count, each relative to that send, show when its reply came.
        const calls=async(at:number,waited:number)=>live.clients[n]!.run(`(()=>{const l=parent.__e2eTurns,s=${at-waited},f=s-1000,t=${at}+1500,w=x=>x.at>=f&&x.at<=t;
          return l?{spends:l.spends.filter(w).map(x=>[x.at-s,x.method,x.name??x.item??null]),replies:l.replies.filter(w).map(x=>[x.at-s,x.place,x.failed?x.reason:'ok'])}:null;})()`);
        if(lost.length)console.log('TURNS-TRNQ24 '+JSON.stringify({name:n,from:a36From[n],to:await clock(n),oldest:ring?.[0]?.at??null,
          lost:await Promise.all(lost.map(async([r,i])=>({...r,around:(ring??[]).slice(Math.max(0,i-4),i+3),calls:await calls(r.at,Number(r.waitedMs)||0)})))}).slice(0,12000));
        expect.soft(ring,`TRN-Q24: ${n} has the turns ring`).not.toBeNull();
        // The ring also keeps the rows before the windows in a merged run (one held a Dash lost in UP-1),
        // so the check reads the spends counted lost from the windows' start.
        // Decided 2026-11-09: a spend counted lost whose own reply came
        // within one test-clock step after the count is the stack's (ChronAL's 250 ms step,
        // e2e/call-budget-rows.ts:21); each is recorded, and every other lost
        // spend, a reply that never came included, fails.
        const STEP=250,inWindows=lost.filter(([r])=>r.at>=a36From[n]!),stack:unknown[]=[],other:string[]=[];
        for(const [r] of inWindows){const waited=Number(r.waitedMs)||0,c=await calls(r.at,waited) as {replies:[number,string,string][]}|null;
          const reply=c?.replies.find(([at,place])=>place===r.skill&&at>waited&&at<=waited+STEP);
          if(reply)stack.push({skill:r.skill,at:r.at,waitedMs:waited,replyAfterCountMs:reply[0]-waited});else other.push(r.skill);}
        if(stack.length)console.log('TURNS-TRNQ33 '+JSON.stringify({name:n,stack}));
        expect.soft(other,`TRN-Q24: ${n}'s lost replies in the windows`).toEqual([]);}
      // TC17: the warrior's Dash and the priest's Curse are the A36 casts the
      // goo field reaches (no basher, no mage: 13.2 "Before measures").
      const a36=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,await a36Casts(live,n,a36From[n]!)])));
      console.log('TURNS-TC17 '+JSON.stringify(a36));
      const [W17,P17]=fighters;
      expect.soft(a36[W17!]!.casts.dash??0,'TC17: the warrior Dashes').toBeGreaterThan(0);
      // The priest's Curse goes where its setup allows it: a Curse decision
      // the class reserve, the cooldown or the range refuses is the engine's rule, not a stopped cast
      //. TRN-Q-DPS's ranking replaced the sustained damage
      // budget's refusal.
      const curseRefusals=a36[P17!]!.curseDiags.filter((d:any)=>d.status!=='accepted'&&d.status!=='selected');
      expect.soft(curseRefusals.filter((d:any)=>!['survival MP reserved','cooldown','out of range'].includes(d.reason)),
        "TC17: the priest's Curse decisions refused for a reason other than the reserve or the cooldown").toEqual([]);
      // A window with no Curse decision is one the setup did not reach; the count is a reading.
      console.log('TURNS-TC17-CURSE '+JSON.stringify({casts:a36[P17!]!.casts.curse??0,refusals:curseRefusals.length}));
      for(const n of fighters)expect.soft(a36[n]!.belowReserve,`TC17: ${n}'s A36 casts that leave MP below the class reserve`).toEqual([]);
      expect.soft(a36[P17!]!.curseDiags.filter((d:any)=>d.category!=='damage'),"TC17: the priest's Curse goes through the engine as damage (W3)").toEqual([]);
      expect.soft(a36[P17!]!.curseDiags.length>=(a36[P17!]!.casts.curse??0),"TC17: each Curse sent has the engine's diagnostic (W3)").toBe(true);
      // CB1: each fighter's server sum stays within its budget's used.
      for(const n of fighters){expect.soft(calls[n]!.usedSamples,`CB1: ${n}'s budget answers the sampler`).toBeGreaterThan(0);expect.soft(calls[n]!.above,`CB1: ${n}'s server sum above its used`).toEqual([]);}
    }
    const budgetTo=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,{bands:await bandsRead(live,n),owner:await live.clients[n].run('__partyMovement.ownerReport()')}])));
    const budget=Object.fromEntries(fighters.map(n=>{const a=budgetFrom[n]!,b=budgetTo[n]!;return [n,{
      combatSteps:(b.owner.steps?.sent??0)-(a.owner.steps?.sent??0),heldSteps:(b.owner.steps?.budget??0)-(a.owner.steps?.budget??0),
      survivalMove:answered(a.bands,b.bands,'survival','move'),jobMove:answered(a.bands,b.bands,'job','move'),survivalWaits:survivalWaits(a.bands,b.bands),
      room:b.bands.view?.room,peak:b.bands.view?.peak,p95:calls[n]?.p95??null,meter:meterOf(b.bands)}];}));
    await info.attach('steps-call-bands',{body:JSON.stringify({budget,views:Object.fromEntries(fighters.map(n=>[n,budgetTo[n]!.bands]))}),contentType:'application/json'});
    console.log('CALL-BUDGET-STEPS '+JSON.stringify(budget));
    for(const n of fighters){
      const r=budget[n]!;
      // CB11: combat steps ask survival, the walk's travel moves job.
      expect(r.survivalMove.send,`CB11: ${n}'s combat steps ask survival`).toBeGreaterThanOrEqual(r.combatSteps);
      expect(r.jobMove.send,`CB11: ${n}'s travel moves ask job`).toBeGreaterThan(0);
      // CB21: no survival question waits in the windows.
      expect(r.survivalWaits,`CB21: ${n}'s survival questions answered not-now`).toBe(0);
      expect(r.heldSteps,`CB21: ${n}'s combat steps the budget held`).toBe(0);
      bandsHold(n,budgetTo[n]!.bands,budgetFrom[n]!.at);
    }
    // CB20: each fighter's 95th percentile within its recorded before spread (call-budget-rows.ts
    // `CB20_P95`).
    // Above its bound it fails only where the turns executor's own calls in a window above it rose
    // against the before runs' figure.
    for(const n of fighters){const cb20=cb20Windows(samples,n,CB20_P95.steps[n]!,CB20_TURNS_BEFORE.steps[n]!);
      console.log('STEPS-CB20-WINDOWS '+JSON.stringify({name:n,bound:CB20_P95.steps[n],p95:budget[n]!.p95,windows:cb20.windows,turns:cb20.turns}));
      if((budget[n]!.p95??0)>CB20_P95.steps[n]!)expect.soft(cb20.rose,`CB20: ${n}'s windows above ${CB20_P95.steps[n]} whose executor calls rose above ${CB20_TURNS_BEFORE.steps[n]}`).toEqual([]);}
    // Item 11: a hold refuses real combat steps until it is released.
    let hold:any=null;
    const W=fighters[0]!;
    // The hold and its start time come from one CDP call: a combat step sent between two
    // calls is not a step during the hold (found on the step 6 gate).
    const held=await live.clients[W].run(`(()=>({at:Date.now(),status:__partyMovement.hold({kind:'town',owner:'e2e-steps-hold'})}))()`) as {at:number;status:string};
    expect(held.status).toBe('granted');
    const heldAt=held.at;
    await expect.poll(async()=>await clock(W)-heldAt,{timeout:30_000}).toBeGreaterThanOrEqual(3_000);
    const released=await live.clients[W].run(`(()=>({at:Date.now(),ok:__partyMovement.release('e2e-steps-hold')}))()`) as {at:number;ok:boolean};
    expect(released.ok).toBe(true);
    const releasedAt=released.at;
    const during=await live.clients[W].run(windowReport(heldAt,releasedAt));
    await expect.poll(async()=>(await live.clients[W].run(windowReport(releasedAt,Number.MAX_SAFE_INTEGER))).combatMoves,{timeout:60_000}).toBeGreaterThan(0);
    hold={heldAt,releasedAt,during};
    expect(during.combatMoves,'combat moves during a hold').toBe(0);
    // Step 8c item 1: the chase re-aims of each fighter's independent approach.
    const reaims=Object.fromEntries(await Promise.all(fighters.map(async name=>[name,await live.clients[name].run('globalThis.partyQueueClient?.independent?.reaims?.() ?? null')])));
    const measured={windows,hold,reaims};
    await info.attach('movement-steps',{body:JSON.stringify(measured),contentType:'application/json'});
    console.log('MOVEMENT-STEPS '+JSON.stringify({hold}));
    for(const window of windows)for(const name of fighters){
      const {native,owner}=window[name];
      // The counters last the runtime, which the table's rows share; a window reads its change.
      expect((owner.after.errors??0)-(owner.before.errors??0)).toBe(0);
      // Step 6 item 8: every failed journey in the window names its failure text and planner.
      for(const failed of native.failed)expect(failed.reason&&failed.engine,`${name} failed journey ${failed.id} names its cause`).toBeTruthy();
      // Item 10: a combat pause never outlives combat.
      expect(native.stale,'combat pauses that outlived their last step window').toEqual([]);
      // Step 8c item 6: the cost per call reads a real clock on virtual time.
      if((owner.after.calls??0)>(owner.before.calls??0))expect(owner.after.totalMs,'cost per call on a real clock').toBeGreaterThan(owner.before.totalMs??0);
    }
    // Step 8c item 1: with the owner on a re-aim on a clear line moves the journey in place. A
    // missing count would pass the check without a reading, so it fails here.
    for(const name of fighters){expect(reaims[name],name+' re-aim counts').toBeTruthy();expect(reaims[name].relaunchedClear,name+' re-aims on a clear line that relaunched').toBe(0);}
}

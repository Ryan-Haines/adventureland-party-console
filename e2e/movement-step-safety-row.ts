import {expect,type LiveGame} from './live-fixtures';
import type {TestInfo} from '@playwright/test';
import {spendLog} from './turns-rows';
import {COMBAT,fightersReady,windowStart,turnsWindow,clock} from './movement-owner-helpers';
import {fighters,location,party} from './game/hunt-lifecycle';
import {sv12StompRows} from './survival-rows';
import {reflectListRow} from './targeting-rows';

// Step safety on the Main bee field, where every bee but the selected one is an idle monster in the server's
// aggro grid (bee `aggro` 1, design/monsters.js). Failure inventory:
// e2e/movement-owner-failures.md, "Step 6". Six farming windows, so a measure's spread between
// windows can be told apart from a change between steps.
const WINDOWS=6, WINDOW_MS=120_000;
// The test's own copy of the server's grid (node/server_functions.js ghash and
// get_nearby_ghash): a monster in cell (cx, cy) checks players in cells cx - 1 to cx + 1.
// The segment is walked every half unit, which no step crosses a 32-unit cell between.
const instrument=`(()=>{if(globalThis.__e2eSafety)return true;const s=globalThis.__e2eSafety={moves:[],samples:[],stuck:[],pulls:[],deaths:[],failed:[],
  records:new Map(),attacked:new Set(),idle:new Map(),since:Math.max(0,...__partyMovement.records().map(r=>r.seq)),lastId:__partyMovement.last()?.id};
  const original=globalThis.move,combat=${COMBAT},cell=v=>Math.floor(v/32);
  const pos=e=>({x:Number.isFinite(e.real_x)?e.real_x:e.x,y:Number.isFinite(e.real_y)?e.real_y:e.y});
  const inBlock=(p,m)=>Math.abs(cell(p.x)-cell(m.x))<=1&&Math.abs(cell(p.y)-cell(m.y))<=1;
  const monsters=()=>Object.values(parent.entities||{}).filter(e=>e&&e.type==='monster'&&e.visible!==false&&!e.dead);
  const targets=()=>new Set([character.target,globalThis.partyCombatPosition?.target].filter(Boolean).map(String));
  // A fight: a monster targets the character, or its target stands within its range.
  const fightingNow=(from,list,mine)=>list.some(m=>m.target===character.name)||list.some(m=>mine.has(m.id)&&Math.hypot(m.x-from.x,m.y-from.y)<=Number(character.range));
  // The snapshot is taken at the call. The step's own target is read a microtask later,
  // because sendCombatMove names it in partyCombatPosition after the owner sends the move.
  globalThis.move=function(x,y){const from=pos(character),to={x,y},stop=Math.hypot(x-from.x,y-from.y)<1;
    const list=monsters().map(e=>({id:String(e.id),mtype:e.mtype,target:e.target,range:e.range,...pos(e)}));
    const entry={at:Date.now(),stop,combat:combat.test(String(new Error().stack)),cc:Number(character.cc)||0,from,to,enters:[],closes:[],
      fighting:false,journey:!!__partyMovement.live()?.journey};
    s.moves.push(entry);
    queueMicrotask(()=>{const mine=targets();entry.fighting=fightingNow(from,list,mine);if(stop)return;
      const n=Math.max(1,Math.ceil(Math.hypot(x-from.x,y-from.y)*2));
      for(const m of list){
        if(m.target===character.name&&!mine.has(m.id)){const range=Number(m.range)||20;
          if(Math.hypot(x-m.x,y-m.y)<Math.min(Math.hypot(from.x-m.x,from.y-m.y),range)-1)entry.closes.push(m.id);}
        if(m.target||mine.has(m.id)||!(Number(G.monsters[m.mtype]?.aggro)>0)||inBlock(from,m))continue;
        for(let i=0;i<=n;i++)if(inBlock({x:from.x+(x-from.x)*i/n,y:from.y+(y-from.y)*i/n},m)){entry.enters.push(m.id);break;}}});
    return original(x,y);};
  let dead=!!character.rip,stuckFrom=null;
  setInterval(()=>{const now=Date.now();
    for(const r of __partyMovement.records())if(r.seq>s.since)s.records.set(r.seq,r);
    const last=__partyMovement.last();
    if(last&&last.id!==s.lastId){s.lastId=last.id;
      if(!last.done)s.failed.push({at:now,id:last.id,end:last.end,reason:last.reason,engine:last.engine,searches:last.searches,retries:last.retries,
        stage:last.failureContext?.recoveryStage,firstIssue:last.firstIssue?.reason??last.failureContext?.firstIssue?.reason});}
    if(character.rip&&!dead)s.deaths.push({at:now,cause:globalThis.__partyLastDeathInfo?.message??null});dead=!!character.rip;
    const list=monsters(),mine=targets(),here=pos(character);
    // A monster seen idle that now targets this character without having been its target.
    // Its own retarget at the character comes after, so the check reads the earlier targets.
    for(const e of list){const id=String(e.id);
      if(e.target===character.name&&s.idle.has(id)&&!s.attacked.has(id)){
        const step=s.moves.filter(m=>m.at>=now-1000&&m.enters.includes(id)).at(-1);
        s.pulls.push({at:now,id,mtype:e.mtype,cause:!step?'standing':!step.combat?'travel':step.fighting?'step':'least-risk step'});}
      if(!e.target&&Number(G.monsters[e.mtype]?.aggro)>0)s.idle.set(id,now);else s.idle.delete(id);}
    for(const id of mine)s.attacked.add(id);
    // Stuck: a target out of range, nothing on the character, no move and no journey.
    const target=list.find(e=>mine.has(String(e.id))),live=__partyMovement.live();
    const stuck=!character.rip&&target&&Math.hypot(pos(target).x-here.x,pos(target).y-here.y)>Number(character.range)&&
      !list.some(e=>e.target===character.name)&&!character.moving&&!live?.journey;
    if(stuck&&stuckFrom===null)stuckFrom=now;
    if(!stuck&&stuckFrom!==null){s.stuck.push({from:stuckFrom,to:now});stuckFrom=null;}
  },250);return true;})()`;
const windowReport=(from:number,to:number)=>`(()=>{const s=globalThis.__e2eSafety,inside=x=>x.at>=${from}&&x.at<${to},m=s.moves.filter(inside);
  let worst=0;for(let i=0,j=0;i<m.length;i++){while(m[i].at-m[j].at>4000)j++;worst=Math.max(worst,i-j+1);}
  const records=[...s.records.values()].filter(inside),count=test=>records.filter(test).length,steps=m.filter(x=>x.combat&&!x.stop);
  const runs=s.stuck.filter(r=>r.to>${from}&&r.from<${to}).map(r=>Math.min(r.to,${to})-Math.max(r.from,${from}));
  return {moves:m.length,maxPer4s:worst,maxCallCost:Math.max(0,...m.map(x=>x.cc)),stops:m.filter(x=>x.stop).length,
    combatMoves:steps.length,combatStops:m.filter(x=>x.combat&&x.stop).length,
    idleWhileFighting:steps.filter(x=>x.enters.length&&x.fighting).length,idleWhileFree:steps.filter(x=>x.enters.length&&!x.fighting).length,
    travelIdle:m.filter(x=>!x.combat&&!x.stop&&x.enters.length).length,closes:steps.filter(x=>x.closes.length).length,
    unsafeSamples:steps.filter(x=>x.enters.length&&x.fighting||x.closes.length).slice(0,5),
    stuckMaxMs:Math.max(0,...runs),stuckMs:runs.reduce((a,b)=>a+b,0),
    pulls:s.pulls.filter(inside).reduce((sum,p)=>{sum[p.cause]=(sum[p.cause]||0)+1;return sum;},{}),
    deaths:s.deaths.filter(inside),failed:s.failed.filter(inside),
    recovery:{failed:count(r=>r.decision==='ended'&&String(r.code).startsWith('failed:')),replaced:count(r=>r.decision==='ended'&&String(r.code).startsWith('replaced:')),
      refused:count(r=>r.decision==='refused'),refusedStops:count(r=>r.decision==='refused-stop'),stepRefused:count(r=>r.decision==='step-refused')},
    started:count(r=>r.decision==='started'),pauses:count(r=>r.decision==='paused'&&r.cause==='combat')};})()`;

export async function beeFieldRow(live:LiveGame,info:TestInfo){
    await fightersReady(live);
    await party(live);
    const farm=await location(live,'bee');
    await live.post('/navigate-to-monster',{monsterId:'bee',location:farm});
    await live.post('/focus',{monsterFocus:['bee'],monsterPriorities:{},monsterSearchRadius:400});
    // Measure from the farm, not the walk there: the first window starts once a bee is selected.
    await expect.poll(async()=>(await Promise.all(fighters.map(name=>live.clients[name].run(
      `!!(parent.entities[character.target]&&parent.entities[character.target].mtype==='bee')`)))).some(Boolean),{timeout:180_000}).toBe(true);
    for(const name of fighters){await live.clients[name].run(instrument);await live.clients[name].run(spendLog);}
    const windows:any[]=[];
    for(let index=0;index<WINDOWS;index++){
      const start=await windowStart(live);
      const startedAt=Date.now();
      await expect.poll(async()=>Date.now()-startedAt,{timeout:WINDOW_MS+30_000,intervals:[5_000]}).toBeGreaterThan(WINDOW_MS);
      const result=Object.fromEntries(await Promise.all(fighters.map(async name=>{
        const end=await clock(live,name),events=(await live.clients[name].events()).filter((event:any)=>Number(event.sequence)>start[name]!.event&&event.event==='hit'&&event.data?.hid===name);
        const turns=await turnsWindow(live,name,start[name]!,end);
        // What each accepted attack with no hit of its own met (the bee field's
        // kills): its target killed by the other fighter, killed earlier by its own hit, or neither.
        // The target is the last `attack` send's at or before the reply.
        const log=await live.clients[name].run(`(()=>{const l=parent.__e2eTurns;return {spends:l.spends.filter(s=>s.method==='attack'&&s.at<${end}).map(s=>[s.at,s.id]),
          replies:l.replies.filter(r=>r.place==='attack'&&!r.failed&&r.at>=${start[name]!.at}&&r.at<${end}).map(r=>r.at)};})()`) as {spends:[number,string][];replies:number[]};
        const allHits=(await Promise.all(fighters.map(async n=>(await live.clients[n].events()).filter((e:any)=>e.event==='hit'&&e.data?.hid===n)))).flat();
        const noHit={count:0,killedByOther:0,killedByOwnBefore:0,neither:0};
        for(const at of log.replies){
          const id=log.spends.filter(([sent])=>sent<=at).at(-1)?.[1];
          if(allHits.some((e:any)=>e.data.hid===name&&String(e.data.id)===id&&e.at>=at-500&&e.at<=at+3000))continue;
          noHit.count++;
          if(allHits.some((e:any)=>e.data.hid!==name&&String(e.data.id)===id&&(e.data.kill||e.data.dead)&&e.at<=at+3000))noHit.killedByOther++;
          else if(allHits.some((e:any)=>e.data.hid===name&&String(e.data.id)===id&&(e.data.kill||e.data.dead)&&e.at<at-500))noHit.killedByOwnBefore++;
          else noHit.neither++;
        }
        return [name,{windowMs:end-start[name]!.at,hits:events.length,kills:events.filter((hit:any)=>hit.data.kill||hit.data.dead).length,noHit,turns,
          native:await live.clients[name].run(windowReport(start[name]!.at,end)),
          owner:{before:start[name]!.owner,after:await live.clients[name].run('__partyMovement.ownerReport()')}}];
      })));
      windows.push(result);
      console.log('MOVEMENT-SAFETY-WINDOW '+JSON.stringify({index,result}));
    }
    await info.attach('movement-step-safety',{body:JSON.stringify({windows}),contentType:'application/json'});
    // The reflect list on a planted sparkbot, after the
    // measured windows so their figures keep their meaning.
    await reflectListRow(live,info);
    for(const window of windows)for(const name of fighters){
      const {native,owner}=window[name];
      // The counters last the runtime, which the table's rows share; a window reads its change.
      expect((owner.after.errors??0)-(owner.before.errors??0)).toBe(0);
      // Items 1, 2 and 5: no combat step pulls an idle monster while the character fights,
      // and none closes on an attacker.
      expect(native.idleWhileFighting,`${name} combat steps into an idle block while fighting`).toBe(0);
      expect(native.closes,`${name} combat steps closing on an attacker`).toBe(0);
      expect(native.pulls.step??0,`${name} idle monsters pulled by a combat step while fighting`).toBe(0);
    }
    // The emergency Stomp on the same field, after the windows.
    await sv12StompRows(live,info);
}

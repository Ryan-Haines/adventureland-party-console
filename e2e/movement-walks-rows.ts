import {expect,plantVitals,type LiveGame} from './live-fixtures';
import type {TestInfo} from '@playwright/test';
import {fighters,location,party} from './game/hunt-lifecycle';
import {settleNavigation} from './movement-owner-helpers';
import {spendLog,spendsSince,red} from './turns-rows';
import {stockPotions,wrongWhileLow} from './survival-rows';

// Step 8b of the movement owner migration: the coordinator walk rule, records on disk and
// the activity line. Failure inventory: e2e/movement-owner-failures.md, "Step 8b".
// The records and the recovery line extend live-movement-owner's stuck-record test. The
// idle-aggro detour is route-aggro.test.cjs's row: its boundary cases need fixed monster spots.
// The rows run as steps of live-movement-owner.spec.ts's table of rows that start from the
// default fixture.
// The owner's counters last the character's runtime, which the table's rows share, so a row
// reads the change since it began.
const counters='(()=>{const r=__partyMovement.ownerReport();return {untimed:r.invariants?.untimed??0,errors:r.errors??0};})()';
async function ready(live:any){
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'merchant idle':false,'stand maintenance':false}});
  await expect.poll(async()=>{const state=await live.state();
    return fighters.every(name=>state.characters[name]?.runtime==='native'&&Date.now()-state.characters[name].seenAt<3000);},{timeout:30_000}).toBe(true);
}
// Every ring record after the call, by sequence number, gathered every 250 ms on the character.
const watch=`(()=>{if(globalThis.__e2eWalks)return true;const w=globalThis.__e2eWalks={records:new Map(),live:[],since:Math.max(0,...__partyMovement.records().map(r=>r.seq))};
  setInterval(()=>{for(const r of __partyMovement.records())if(r.seq>w.since)w.records.set(r.seq,r);
    const live=__partyMovement.live();w.live.push({at:Date.now(),kind:live?.kind??null,owner:live?.owner??null,tier:live?.tier??null,journey:!!live?.journey,deadline:live?.deadline??null,moving:!!character.moving});},250);return true;})()`;
const walkRecords=`[...globalThis.__e2eWalks.records.values()]`;

export async function farmWalkRow(live:LiveGame,info:TestInfo){
    await ready(live);
    await party(live);
    for(const name of fighters){await settleNavigation(live.clients[name],name);await live.clients[name].run(watch);await live.clients[name].run(spendLog);}
    const base=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,await live.clients[n].run(counters)])));
    const farm=await location(live,'goo');
    // Step 8b item 7: a follow journey is live on the priest when the walk starts.
    const P=fighters[1]!;
    await live.clients[P].run(`(()=>{const c=character;for(let i=0;i<16;i++){const t=i*Math.PI/8,p={map:c.map,x:c.real_x+300*Math.cos(t),y:c.real_y+300*Math.sin(t)};
      if(can_move({map:c.map,x:c.real_x,y:c.real_y,going_x:p.x,going_y:p.y,base:c.base})){smart_move(p,undefined,{request:{kind:'follow',owner:'follow'}}).catch(()=>{});return true;}}throw Error('No clear point');})()`);
    await expect.poll(async()=>(await live.clients[P].run('__partyMovement.live()'))?.kind,{timeout:15_000}).toBe('follow');
    await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{},monsterSearchRadius:400});
    const walkFrom=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,await live.clients[n].run('Date.now()') as number])));
    // The cruise pace: the walk starts with the warrior under
    // Hard Shell, which sets its speed to the condition's `set_speed` for the condition's duration.
    const shell=await live.clients[fighters[0]!].run(`(()=>{const p=G.conditions.hardshell.set_speed;use_skill('hardshell');return p;})()`) as number;
    await expect.poll(async()=>live.clients[fighters[0]!].run('!!character.s.hardshell'),{timeout:5_000}).toBe(true);
    await live.post('/navigate-to-monster',{monsterId:'goo',location:farm});
    // The priest planted to want both potions (45% HP, 15% MP), below its lines. Survival's potions
    // go in the walk (decided 2026-11-05), and the role loop's hold still stops buffs and class casts.
    // The red run turns the role loop's hold off on both fighters.
    // The row reads the hold itself: a wrapper keeps
    // each fighter's last isOccupied answer, which the spend log copies at a skill's send. A fighter
    // that arrives before the convoy ends, or that a convoy defence releases, casts with the hold
    // off, as its role loop allows. The red run returns false while
    // still keeping the real answer, so a cast under the real hold reads as one.
    for(const n of fighters)await live.clients[n].run(`(()=>{const s=__partyHooks.skills,o=s.allows,off=${red('tc19')};globalThis.__e2eOccupied=o;
      s.allows=function(ask){const v=o.apply(this,arguments);if(!ask||!ask.occupied)return v;globalThis.__e2eHeld={held:!!v,at:Date.now()};return off?undefined:v;};return true;})()`);
    await stockPotions(live,P);
    await plantVitals(live,fighters[1]!,{hp:0.45,mp:0.15});
    // The buff half needs a buff the warrior wants in the walk: its Warcry effect and cooldown
    // planted gone, as the priest's vitals are for the potion half, so the role loop asks for
    // Warcry at once and only the hold stops it (an earlier run read no cast with the hold off).
    const W=fighters[0]!;
    await live.admin(`output=(()=>{const p=get_player('${W}');delete p.s.warcry;if(p.last)delete p.last.warcry;p.u=true;resend(p,'u+cid');return true;})()`);
    await live.clients[W].run('(parent.next_skill&&delete parent.next_skill.warcry,true)');
    // Item 15: the first state poll after the walk starts names its purpose.
    const first=await live.state();
    const convoy=first.activeConvoy;
    await info.attach('walk-first-poll',{body:JSON.stringify({convoy,activity:Object.fromEntries(fighters.map(n=>[n,first.characters[n]?.activity]))}),contentType:'application/json'});
    expect(convoy?.purpose).toBe('manual-monster-override');
    for(const name of convoy.participants){
      const text=String(first.characters[name]?.activity?.text);
      expect(text,`${name} first poll`).toMatch(/farm - Goo$/);
    }
    // The walk reaches the farm, then every poll over a window of farming reads "Farming (Auto): Fighting Goo",
    // the farm line with both modes on the fixture's default modes.
    // TC19 and SV15: while the walk's convoy
    // lasts the role loop holds, so neither fighter casts a buff or a class skill; partyheal is a
    // survival heal, and the pulse's regeneration and top-off heals may go.
    // RR13: while the walk travels, each member's reported speed is the walk's pace, and the pace is
    // the party's own, not the warrior's speed under Hard Shell (red on e51dc474: the walk cruises
    // at the shell's speed).
    const paces:any[]=[],walkEnds=Date.now()+240_000;
    for(;;){const state=await live.state(),c=state.activeConvoy;if(!c)break;
      expect(Date.now(),'The walk to the farm ends').toBeLessThan(walkEnds);
      if(c.phase==='travel')paces.push({pace:c.slowestSpeed,speeds:Object.fromEntries(c.participants.map((n:string)=>[n,state.characters[n]?.speed]))});
      await new Promise(resolve=>setTimeout(resolve,250));}
    await info.attach('walk-pace',{body:JSON.stringify({shell,paces}),contentType:'application/json'});
    expect(paces.length,'travel samples').toBeGreaterThan(0);
    expect.soft(paces.filter(p=>!(p.pace>shell)),'RR13: travel samples paced at the Hard Shell speed').toEqual([]);
    expect.soft(paces.filter(p=>Object.values(p.speeds).some((v:any)=>!(Math.abs(Number(v)-p.pace)<=0.1))),
      'RR13: travel samples with a member off the pace of the walk').toEqual([]);
    for(const n of fighters)await live.clients[n].run('(__partyHooks.skills.allows=globalThis.__e2eOccupied,delete globalThis.__e2eHeld,true)');
    const walkTo=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,await live.clients[n].run('Date.now()') as number])));
    const walkSpends=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,(await spendsSince(live,n,walkFrom[n]!)).spends.filter((s:any)=>s.at<=walkTo[n]!)])));
    console.log('TURNS-TC19 '+JSON.stringify(Object.fromEntries(fighters.map(n=>[n,walkSpends[n]!.map((s:any)=>[s.at-walkFrom[n]!,s.method,s.name??s.item??null,s.walk??null,s.held??null,s.heldAt!=null?s.at-s.heldAt:null])]))));
    for(const n of fighters)expect.soft(walkSpends[n]!.filter((s:any)=>s.method==='skill'&&s.name!=='partyheal'&&s.held!==false).map((s:any)=>[s.method,s.name,s.held??null]),
      `TC19, SV15: ${n}'s buffs and class casts while its hold holds`).toEqual([]);
    // The priest below both lines drinks in the walk. Its
    // own heal can lift its HP above the line before the potion cooldown frees (21,189 HP a heal on a
    // 92,176 HP priest in the fixture), so the HP half reads the failure itself: no potion family
    // send but `use_hp` while its HP at the send reads below the line (decided 2026-11-05).
    const family=walkSpends[P]!.filter((s:any)=>s.method==='equip'||s.method==='use');
    const potions:string[]=family.filter((s:any)=>s.method==='equip').map((s:any)=>String(s.item));
    const missed=wrongWhileLow(walkSpends[P]!,P).map(([at,...r])=>[Number(at)-walkFrom[P]!,...r]);
    console.log('SURVIVAL-SV14 '+JSON.stringify({family:family.map((s:any)=>[s.at-walkFrom[P]!,s.method,s.item??null,s.party?.[P]?Math.round(s.party[P].hp/s.party[P].max*100):null]),missed}));
    expect.soft(missed,"SV14: the priest's potion family sends other than use_hp while its HP reads below the line").toEqual([]);
    expect.soft(potions.some((item:string)=>/^mpot/.test(item)),"SV14: the priest's MP potion during the walk").toBe(true);
    await expect.poll(async()=>{const state=await live.state();return !state.activeConvoy&&fighters.every(n=>state.characters[n]?.activity?.text==='Farming (Auto): Fighting Goo');},{timeout:240_000}).toBe(true);
    const texts=new Map<string,Set<string>>(fighters.map(n=>[n,new Set<string>()]));
    for(const n of fighters)await live.clients[n].run(`(()=>{let c=0;const o=globalThis.move;globalThis.__e2eWalkMoves=()=>c;globalThis.move=function(x,y){c++;return o(x,y);};return true;})()`);
    // The owner is the group line's one writer. Every card carries its copy, and
    // over a window with no live task or label change the owner writes the line no more.
    const group=`party:${fighters[0]}`,owned=async()=>(await live.tasks()).groups.find((g:any)=>g.id===group);
    // The trip is the party's manual task, which ends one task tick after its walk arrives; the
    // window starts after it (the table run on 02fc7613 read the trip's line in its first poll).
    await expect.poll(async()=>(await owned())?.live?.kind,{timeout:30_000,message:'The trip task must end before the window'}).not.toBe('manual');
    const writesBefore=(await owned()).statusWrites,lines=new Set<string>();
    const startedAt=Date.now();
    while(Date.now()-startedAt<60_000){
      const state=await live.state();
      for(const n of fighters){texts.get(n)!.add(String(state.characters[n]?.activity?.text));lines.add(JSON.stringify(state.characters[n]?.activity?.group??null));}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    const after=await owned();
    expect([...lines],'every card carries the owner\'s one group line').toEqual([JSON.stringify(after.status)]);
    expect(after.statusWrites-writesBefore,'status writes with no live task or label change').toBe(0);
    const walked=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,await live.clients[n].run('globalThis.__e2eWalkMoves()')])));
    await info.attach('walk-farm-window',{body:JSON.stringify({texts:Object.fromEntries([...texts].map(([n,s])=>[n,[...s]])),walked}),contentType:'application/json'});
    for(const n of fighters){
      expect([...texts.get(n)!],`${n} labels while farming`).toEqual(['Farming (Auto): Fighting Goo']);
      // The window held repositioning: members walked between spawns while the label held still.
      expect(Number(walked[n]),`${n} native moves while farming`).toBeGreaterThan(0);
    }
    let standingSamples=0;
    for(const name of fighters){
      const records=await live.clients[name].run(walkRecords) as any[];
      const samples=await live.clients[name].run('globalThis.__e2eWalks.live') as any[];
      await info.attach(`walk-records-${name}`,{body:JSON.stringify({records,samples}),contentType:'application/json'});
      const walkOwner=(r:any)=>/^walk:/.test(String(r.owner??''));
      // Item 6: the walk never takes over its own journey; a phase end it causes reads `released`.
      expect(records.filter(r=>r.decision==='ended'&&walkOwner(r)&&r.code==='replaced:group-walk'&&r.by?.owner===r.owner).length,`${name} self takeovers`).toBe(0);
      // Item 7: no convoy takeover cancel; the walk's rank ends the follow.
      expect(records.filter(r=>r.cause==='convoy-takeover').length,`${name} convoy takeover cancels`).toBe(0);
      if(name===P)expect(records.filter(r=>r.decision==='ended'&&r.kind==='follow').map(r=>r.code),'the live follow ends replaced by the walk').toContain('replaced:group-walk');
      // Item 8: while the member stands for the walk it holds as the walk, with a deadline.
      const standing=samples.filter(s=>walkOwner(s)&&!s.journey);
      standingSamples+=standing.length;
      expect(standing.every(s=>Number.isFinite(s.deadline)),`${name} walk holds with a deadline`).toBe(true);
      const now=await live.clients[name].run(counters) as any;
      expect(now.untimed-base[name].untimed,`${name} untimed holds`).toBe(0);
      expect(now.errors-base[name].errors).toBe(0);
    }
    // A member that stood for the walk at all held as the walk (a follower can walk the whole time).
    expect(standingSamples,'samples of a member standing for the walk').toBeGreaterThan(0);
}

// A party travel to a point
// past the map's edge can never arrive. The walk climbs its own ladder on each failure (re-plan,
// the other route, a rebuild at the leader, and so on); it never ends as "retries exhausted", the
// card names what it tries while the party regroups, and every member that stands for the walk
// holds as the walk.
export async function walkLadderRow(live:LiveGame,info:TestInfo){
    await ready(live);
    await party(live);
    for(const name of fighters){await settleNavigation(live.clients[name],name);await live.clients[name].run(watch);}
    const base=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,await live.clients[n].run(counters)])));
    // main's geometry ends at x 2320 (data.js 17175), so nothing walks to x 2600.
    await live.post('/travel',{map:'main',x:2600,y:0});
    const samples:any[]=[],group=`party:${fighters[0]}`;
    await expect.poll(async()=>{
      const state=await live.state(),c=state.activeConvoy,owned=(await live.tasks()).groups.find((g:any)=>g.id===group);
      samples.push({at:Date.now(),phase:c?.phase??null,rung:c?.ladderRung??null,trying:c?.ladderTrying??null,exhausted:!!c?.retryExhausted,failure:c?.failure??null,
        activity:Object.fromEntries(fighters.map(n=>[n,state.characters[n]?.activity?.text??null])),
        task:owned&&{kind:owned.live.kind,deadline:owned.live.deadline??null,walk:owned.live.walk??null,step:owned.ladder.rung,source:owned.live.source??null,due:owned.ladder.nextAt??null,status:owned.status},
        messages:[state.monsterHunt?.message,state.farmAreaState?.message].filter(Boolean)});
      return new Set(samples.map(s=>s.rung).filter(Boolean)).size;
    },{timeout:780_000,intervals:[2_000]}).toBeGreaterThanOrEqual(3);
    await info.attach('walk-ladder',{body:JSON.stringify(samples),contentType:'application/json'});
    // No dead-end hold text reaches the group's line or the Hunt and farm
    // messages, and the group's live task always has a deadline, a walk or a due ladder step.
    const deadEnd=/No reachable|select a farming area to retry|request Retry return|retry a queued job/;
    for(const s of samples){
      const texts=[s.task?.status?.label,...(s.task?.status?.reasons??[]).map((r:any)=>r.label),...s.messages,...Object.values(s.activity)].map(String);
      expect(texts.filter(t=>deadEnd.test(t)),'dead-end hold text').toEqual([]);
      expect(!!s.task&&(s.task.source!==null||s.task.deadline!==null||s.task.walk!==null||s.task.due!==null),'a live task with a source, a due step or a walk').toBe(true);
    }
    // The walk's own failures are T0, so the trip's task ladder stays on step 0 while the
    // walk climbs; a task failure moves it one step (a trip has no alternative of its own, so T2,
    // then T3 with its snapshot), and progress returns it to T0.
    expect(samples.filter(s=>s.task?.kind==='manual').every(s=>s.task.step==='walk'),'the trip stays on its walk rung while its walk climbs').toBe(true);
    const owned=(await live.tasks()).groups.find((g:any)=>g.id===group),trip={id:owned.live.id,group};
    expect(owned.live.kind,'precondition: the trip holds the party').toBe('manual');
    const safePoints=async()=>((await live.tasks()).snapshots[group]??[]).filter((s:any)=>s.trigger==='safe-point').length,safeBefore=await safePoints();
    const steps=await live.taskOps([{op:'fail',args:[trip,'e2e-route']},{op:'fail',args:[trip,'e2e-route']},{op:'progress',args:[trip]},{op:'rung',args:[trip]}]);
    expect(steps.map((s:any)=>s?.rung??s),'regroup, safe point, progress, then the rung').toEqual(['regroup','safe-point',true,'walk']);
    expect(await safePoints()-safeBefore,'the safe point step saves one snapshot').toBe(1);
    const rungs=[...new Set(samples.map(s=>s.rung).filter(Boolean))];
    expect(rungs.slice(0,3),'the first rungs in the ladder order').toEqual(['replan','other-route','rebuild']);
    expect(samples.some(s=>s.phase==='failed'&&s.exhausted),'a walk that ends as retries exhausted').toBe(false);
    expect(samples.some(s=>Object.values(s.activity).some(text=>/regrouping for travel .* - (re-planning the shared route|trying the other route|regrouping at the leader)/i.test(String(text)))),
      'the card names what the walk tries').toBe(true);
    for(const name of fighters){
      const now=await live.clients[name].run(counters) as any;
      expect(now.untimed-base[name].untimed,`${name} untimed holds`).toBe(0);
      expect(now.errors-base[name].errors,`${name} owner errors`).toBe(0);
    }
    // The trip past the map's edge never ends by itself, and its walk regroups the members at the
    // leader, so it walks them off the points planted below. A party travel to the town square
    // replaces it, as the fixture reset does, and the assembly half starts from no walk.
    await live.post('/travel',{map:'main',x:0,y:0});
    await expect.poll(async()=>!(await live.state()).activeConvoy,{timeout:180_000,message:'The travel past the edge must end before the assembly half'}).toBe(true);
    await expect.poll(async()=>(await live.tasks()).groups.find((g:any)=>g.id===group)?.live?.kind,{timeout:30_000,message:'The trip task must end before the assembly half'}).not.toBe('manual');
    // A walk never judges a member from silence, rounds or timers: an assembly waiting on a stunned member that
    // still reports stays in its assemble phase and names the member, and neither fails nor climbs. Both members stand
    // on Main spawn points (data.maps.main.spawns) away from every monster spawn, so no defense takes the walk. The
    // leader stands 495 from Town, so the travel to (0, 0) casts Town first and assembles at the leader through
    // walk.ts's barrier step. The priest stands outside the rally, stunned for 90 s, past the 30 s the old
    // assembly timeout allowed.
    const quiet={[fighters[0]!]:{map:'main',x:-472,y:149},[fighters[1]!]:{map:'main',x:168,y:-134}};
    await live.admin(`output=(()=>{for(const [n,at] of Object.entries(${JSON.stringify(quiet)})){const p=get_player(n);transport_player_to(p,at.map,[at.x,at.y]);resend(p,'u+cid');}return true;})()`);
    await expect.poll(async()=>{const c=(await live.state()).characters;
      return fighters.every(n=>c[n]?.map==='main'&&Math.hypot(c[n].x-quiet[n]!.x,c[n].y-quiet[n]!.y)<10);},{timeout:30_000}).toBe(true);
    await live.admin(`output=(()=>{const p=get_player('${fighters[1]}');p.s.stunned={ms:90000};resend(p,'u+cid');return true;})()`);
    const sentAt=Date.now();
    await live.post('/travel',{map:'main',x:0,y:0});
    const assembly:any[]=[];
    const climbed=async()=>((await live.state()).combatLogs?.[fighters[0]!]??[]).find((e:any)=>e.at>=sentAt&&e.message==='Convoy climbing');
    const sample=async()=>{const c=(await live.state()).activeConvoy;assembly.push({at:Date.now(),phase:c?.phase??null,townFirst:c?.townFirst??null,code:c?.failureCode??null,failure:c?.failure??null,blockers:c?.blockerSummary??null});};
    await expect.poll(async()=>{await sample();return assembly.at(-1).phase==='assemble';},{timeout:90_000,intervals:[1_000]}).toBe(true);
    const waitFrom=Date.now();
    while(Date.now()-waitFrom<35_000){await sample();await new Promise(r=>setTimeout(r,500));}
    await info.attach('walk-ladder-assembly',{body:JSON.stringify({climb:await climbed(),assembly}),contentType:'application/json'});
    expect(assembly[0]?.townFirst,'precondition: the travel casts Town first').toBe(true);
    expect(assembly.filter(s=>s.phase==='failed'),'samples where the stalled assembly ended the walk').toEqual([]);
    expect(await climbed(),'a climb with the stunned member still reporting').toBeUndefined();
    expect(assembly.at(-1).phase,'the assembly still waits').toBe('assemble');
    expect(String(assembly.at(-1).blockers),'the card names the member it waits on').toContain(fighters[1]);
    // The stun ends and the party walks to Town, so the table's next row starts from no walk.
    await live.admin(`output=(()=>{const p=get_player('${fighters[1]}');delete p.s.stunned;resend(p,'u+cid');return true;})()`);
    await expect.poll(async()=>!(await live.state()).activeConvoy,{timeout:180_000,message:'The travel must end after the stun'}).toBe(true);
}

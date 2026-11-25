import {expect,plantVitals,type LiveGame} from './live-fixtures';
import type {TestInfo} from '@playwright/test';
import {fighters,location,party} from './game/hunt-lifecycle';
import {settleNavigation} from './movement-owner-helpers';
import {ARRIVAL_TOLERANCE} from '../runtime/protocol/ladder.ts';
import {spendLog,spendsSince,red} from './turns-rows';
import {stockPotions,wrongWhileLow} from './survival-rows';

// Step 8b of the movement owner migration: the coordinator walk rule, records on disk and
// the activity line. Failure inventory: e2e/movement-owner-failures.md, "Step 8b".
// The records and the recovery line extend live-movement-owner's stuck-record test at 21fe30a2b. The
// idle-aggro detour is route-aggro.test.cjs's row: its boundary cases need fixed monster spots.
// W01 plays `farmWalkPlay`. W10c plays `walkLadderPlay`.
// The owner's counters last the character's runtime, which a window's plays share, so a row
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

// The walk in to goo and the first minute of farming (play window W01, T11). farmWalkPlay plants
// the walk's start (the priest's follow journey and low vitals, the warrior's Hard Shell and spent
// Warcry), walks the party to the farm and farms 60 s, keeping every reading in the record;
// farmWalkVerdict holds the expects.
export type FarmWalkRecord={convoy:any;firstTexts:Record<string,string>;shell:number;paces:any[];walkSpends:Record<string,any[]>;walkFrom:Record<string,number>;
  missed:unknown[];potions:string[];lines:string[];status:unknown;statusWrites:number;texts:Record<string,string[]>;walked:Record<string,unknown>;
  members:Record<string,{records:any[];samples:any[];now:{untimed:number;errors:number};base:{untimed:number;errors:number}}>};
export const farmWalkRecord=():FarmWalkRecord=>({convoy:null,firstTexts:{},shell:0,paces:[],walkSpends:{},walkFrom:{},missed:[],potions:[],lines:[],status:null,statusWrites:0,texts:{},walked:{},members:{}});
export async function farmWalkPlay(live:LiveGame,info:TestInfo,record:FarmWalkRecord){
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
    // The cruise pace: the walk starts with the warrior under
    // Hard Shell, which sets its speed to the condition's `set_speed` for the condition's duration.
    const shell=record.shell=await live.clients[fighters[0]!].run(`(()=>{const p=G.conditions.hardshell.set_speed;use_skill('hardshell');return p;})()`) as number;
    await expect.poll(async()=>live.clients[fighters[0]!].run('!!character.s.hardshell'),{timeout:5_000}).toBe(true);
    // The walk's spends start after the row's own Hard Shell. The gameplay clock moves in 250 ms
    // steps, so that cast can share walkFrom's reading; TC19 leaves it out (the end run on 367447e73
    // and PR #159's final run each failed on it).
    const walkFrom=record.walkFrom=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,await live.clients[n].run('Date.now()') as number])));
    await live.post('/navigate-to-monster',{monsterId:'goo',location:farm});
    // The priest planted to want both potions (45% HP, 15% MP), below its lines. Survival's potions
    // go in the walk (decided 2026-11-05), and the role loop's hold still stops buffs and class casts.
    // The red run turns the role loop's hold off on both fighters.
    // The row reads the hold itself: the spend log asks the kept original `skills.allows` at a
    // skill's send, which answers from the sending pass's spend table read. A fighter
    // that arrives before the convoy ends, or that a convoy defence releases, casts with the hold
    // off, as its role loop allows. The red run returns false while
    // still keeping the real answer, so a cast under the real hold reads as one.
    for(const n of fighters)await live.clients[n].run(`(()=>{const s=__partyHooks.skills,o=s.allows,off=${red('tc19')};globalThis.__e2eOccupied=o;
      s.allows=function(ask){const v=o.apply(this,arguments);return ask&&ask.occupied&&off?undefined:v;};return true;})()`);
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
    const convoy=record.convoy=first.activeConvoy;
    await info.attach('walk-first-poll',{body:JSON.stringify({convoy,activity:Object.fromEntries(fighters.map(n=>[n,first.characters[n]?.activity]))}),contentType:'application/json'});
    for(const name of convoy?.participants??[])record.firstTexts[name]=String(first.characters[name]?.activity?.text);
    // The walk reaches the farm, then every poll over a window of farming reads "Farming (Auto): Fighting Goo",
    // the farm line with both modes on the fixture's default modes.
    // TC19 and SV15: while the walk's convoy
    // lasts the role loop holds, so neither fighter casts a buff or a class skill; partyheal is a
    // survival heal, and the pulse's regeneration and top-off heals may go.
    // RR13: while the walk travels, each member's reported speed is the walk's pace, and the pace is
    // the party's own, not the warrior's speed under Hard Shell (red on e51dc474: the walk cruises
    // at the shell's speed).
    const paces=record.paces,walkEnds=Date.now()+240_000;
    for(;;){const state=await live.state(),c=state.activeConvoy;if(!c)break;
      expect(Date.now(),'The walk to the farm ends').toBeLessThan(walkEnds);
      if(c.phase==='travel')paces.push({pace:c.slowestSpeed,speeds:Object.fromEntries(c.participants.map((n:string)=>[n,state.characters[n]?.speed]))});
      await new Promise(resolve=>setTimeout(resolve,250));}
    await info.attach('walk-pace',{body:JSON.stringify({shell,paces}),contentType:'application/json'});
    // The walk's window ends before the hold's read goes, so every spend in it carries `held`: in
    // final-gate-closing12's alone rerun a Warcry sent after the convoy ended, between the restore and
    // this clock read, carried held null and read as cast under the hold.
    const walkTo=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,await live.clients[n].run('Date.now()') as number])));
    for(const n of fighters)await live.clients[n].run('(__partyHooks.skills.allows=globalThis.__e2eOccupied,delete globalThis.__e2eOccupied,true)');
    const walkSpends=record.walkSpends=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,(await spendsSince(live,n,walkFrom[n]!)).spends.filter((s:any)=>s.at<=walkTo[n]!)])));
    console.log('TURNS-TC19 '+JSON.stringify(Object.fromEntries(fighters.map(n=>[n,walkSpends[n]!.map((s:any)=>[s.at-walkFrom[n]!,s.method,s.name??s.item??null,s.walk??null,s.held??null,s.heldAt!=null?s.at-s.heldAt:null])]))));
    // The priest below both lines drinks in the walk. Its
    // own heal can lift its HP above the line before the potion cooldown frees (21,189 HP a heal on a
    // 92,176 HP priest in the fixture), so the HP half reads the failure itself: no potion family
    // send but `use_hp` while its HP at the send reads below the line (decided 2026-11-05).
    const family=walkSpends[P]!.filter((s:any)=>s.method==='equip'||s.method==='use');
    const potions:string[]=record.potions=family.filter((s:any)=>s.method==='equip').map((s:any)=>String(s.item));
    const missed=record.missed=wrongWhileLow(walkSpends[P]!,P).map(([at,...r])=>[Number(at)-walkFrom[P]!,...r]);
    console.log('SURVIVAL-SV14 '+JSON.stringify({family:family.map((s:any)=>[s.at-walkFrom[P]!,s.method,s.item??null,s.party?.[P]?Math.round(s.party[P].hp/s.party[P].max*100):null]),missed}));
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
    record.lines=[...lines];record.status=after.status;record.statusWrites=after.statusWrites-writesBefore;
    const walked=record.walked=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,await live.clients[n].run('globalThis.__e2eWalkMoves()')])));
    record.texts=Object.fromEntries([...texts].map(([n,s])=>[n,[...s]]));
    await info.attach('walk-farm-window',{body:JSON.stringify({texts:record.texts,walked}),contentType:'application/json'});
    for(const name of fighters){
      const records=await live.clients[name].run(walkRecords) as any[];
      const samples=await live.clients[name].run('globalThis.__e2eWalks.live') as any[];
      await info.attach(`walk-records-${name}`,{body:JSON.stringify({records,samples}),contentType:'application/json'});
      const now=await live.clients[name].run(counters) as any;
      record.members[name]={records,samples,now,base:base[name]};
    }
}
export function farmWalkVerdict(record:FarmWalkRecord){
    const {convoy,shell,paces,walkSpends,walkFrom,missed,potions,walked}=record,P=fighters[1]!;
    expect(convoy?.purpose).toBe('manual-monster-override');
    for(const name of convoy?.participants??[])expect(record.firstTexts[name],`${name} first poll`).toMatch(/farm - Goo$/);
    expect(paces.length,'travel samples').toBeGreaterThan(0);
    expect.soft(paces.filter(p=>!(p.pace>shell)),'RR13: travel samples paced at the Hard Shell speed').toEqual([]);
    expect.soft(paces.filter(p=>Object.values(p.speeds).some((v:any)=>!(Math.abs(Number(v)-p.pace)<=0.1))),
      'RR13: travel samples with a member off the pace of the walk').toEqual([]);
    const ownShell=(n:string,s:any)=>n===fighters[0]&&s.name==='hardshell'&&s.at<=walkFrom[n]!;
    for(const n of fighters)expect.soft(walkSpends[n]!.filter((s:any)=>s.method==='skill'&&s.name!=='partyheal'&&s.held!==false&&!ownShell(n,s)).map((s:any)=>[s.method,s.name,s.held??null]),
      `TC19, SV15: ${n}'s buffs and class casts while its hold holds`).toEqual([]);
    expect.soft(missed,"SV14: the priest's potion family sends other than use_hp while its HP reads below the line").toEqual([]);
    expect.soft(potions.some((item:string)=>/^mpot/.test(item)),"SV14: the priest's MP potion during the walk").toBe(true);
    expect(record.lines,"every card carries the owner's one group line").toEqual([JSON.stringify(record.status)]);
    expect(record.statusWrites,'status writes with no live task or label change').toBe(0);
    for(const n of fighters){
      expect(record.texts[n],`${n} labels while farming`).toEqual(['Farming (Auto): Fighting Goo']);
      // The window held repositioning: members walked between spawns while the label held still.
      expect(Number(walked[n]),`${n} native moves while farming`).toBeGreaterThan(0);
    }
    let standingSamples=0;
    for(const name of fighters){
      const {records,samples,now}=record.members[name]!,base={[name]:record.members[name]!.base};
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
      expect(now.untimed-base[name].untimed,`${name} untimed holds`).toBe(0);
      expect(now.errors-base[name].errors).toBe(0);
    }
    // A member that stood for the walk at all held as the walk (a follower can walk the whole time).
    expect(standingSamples,'samples of a member standing for the walk').toBeGreaterThan(0);
}

// W10c plays the ladder without the trip's task ladder steps: they are planted taskOps calls, which
// move to the movement-rules unit rows (test-windows DESIGN.md 4.3, T12; ledger moves:step12).
// The old default table's row (at 21fe30a2b) passed `taskSteps` true; no window does.
export async function walkLadderPlay(live:LiveGame,info:TestInfo,taskSteps:boolean){
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
    if(taskSteps)await tripTaskSteps(live,group);
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
    // A walk never judges a member from silence, rounds or timers: an assembly waiting on a stunned member that
    // still reports stays in its assemble phase and names the member, and neither fails nor climbs. Both members stand
    // on Main spawn points (data.maps.main.spawns) away from every monster spawn, so no defense takes the walk. The
    // leader stands 495 from Town, so the travel to (0, 0) casts Town first and assembles at the leader through
    // walk.ts's barrier step. The priest stands outside the rally, stunned for 90 s, past the 30 s the old
    // assembly timeout allowed.
    const quiet={[fighters[0]!]:{map:'main',x:-472,y:149},[fighters[1]!]:{map:'main',x:168,y:-134}};
    // The trip past the map's edge never ends by itself, and its walk regroups the members at the
    // leader. A party travel to the leader's point replaces it and makes that point the party's farm
    // location. The farm approach walks a member that stands outside the farm's search radius of that
    // location back into it: in the confirming table run on fdc770fc6, and in its rerun of rows 10
    // and 11, the row teleported the leader 495 from the town square the trip had made the location,
    // and the leader walked to 383 from it before the start check read it.
    await live.post('/travel',quiet[fighters[0]!]);
    await expect.poll(async()=>!(await live.state()).activeConvoy,{timeout:180_000,message:'The travel past the edge must end before the assembly half'}).toBe(true);
    await expect.poll(async()=>(await live.tasks()).groups.find((g:any)=>g.id===group)?.live?.kind,{timeout:30_000,message:'The trip task must end before the assembly half'}).not.toBe('manual');
    // The priest lands stunned, so no farm approach walks it back from outside the radius.
    await live.admin(`output=(()=>{const p=get_player('${fighters[1]}'),at=${JSON.stringify(quiet[fighters[1]!])};transport_player_to(p,at.map,[at.x,at.y]);p.s.stunned={ms:90000};resend(p,'u+cid');return true;})()`);
    // The leader stands within the walk's arrival tolerance of its point, the priest on its own.
    await expect.poll(async()=>{const c=(await live.state()).characters;
      return fighters.every(n=>c[n]?.map==='main'&&Math.hypot(c[n].x-quiet[n]!.x,c[n].y-quiet[n]!.y)<=ARRIVAL_TOLERANCE);},{timeout:30_000,message:'Both members stand on their points'}).toBe(true);
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

// The trip's task ladder steps, planted through taskOps on the trip that holds the party.
async function tripTaskSteps(live:LiveGame,group:string){
    const owned=(await live.tasks()).groups.find((g:any)=>g.id===group),trip={id:owned.live.id,group};
    expect(owned.live.kind,'precondition: the trip holds the party').toBe('manual');
    const safePoints=async()=>((await live.tasks()).snapshots[group]??[]).filter((s:any)=>s.trigger==='safe-point').length,safeBefore=await safePoints();
    const steps=await live.taskOps([{op:'fail',args:[trip,'e2e-route']},{op:'fail',args:[trip,'e2e-route']},{op:'progress',args:[trip]},{op:'rung',args:[trip]}]);
    expect(steps.map((s:any)=>s?.rung??s),'regroup, safe point, progress, then the rung').toEqual(['regroup','safe-point',true,'walk']);
    expect(await safePoints()-safeBefore,'the safe point step saves one snapshot').toBe(1);
}

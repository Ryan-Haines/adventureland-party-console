import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {test,expect,type LiveGame} from './live-fixtures';
import {waitForGameplay} from './network-clock';
import {warrior as W,priest as P,party,quests,start,profile,artifact} from './game/hunt-lifecycle';

// Failure inventory: Pause lets a character take a new target or keep walking;
// the hold blocks defence; Play or the automatic resume resets the policy,
// focus or Hunt target; a restart drops the pause; a clean shutdown leaves
// state.jsonl.writer.lock behind or resumes twice.
const M='E2EMerchant',names=[W,P,M];
const pauseFile=(live:LiveGame)=>path.join(live.deploymentPaths.directory,'updates/console-pause.json');
const control=(live:LiveGame,action:string,body={})=>live.post('/console-control/'+action,body);
/** The choices Play must leave exactly as they were when Pause ran. */
function choices(state:any){
  const pick=(name:string)=>{const p=profile(state,name);return {policy:p.farmingPolicy,focus:p.monsterFocus,location:p.location,
    hunt:p.monsterHunt&&{id:p.monsterHunt.id,cycleId:p.monsterHunt.cycleId,owner:p.monsterHunt.owner},huntSettings:p.huntSettings};};
  return {[W]:pick(W),[P]:pick(P),focusByCharacter:state.monsterFocusByCharacter,priorities:state.monsterPrioritiesByCharacter,
    events:state.eventSelectionsByCharacter,merchantAutomations:state.merchantAutomations};
}
async function huntRunning(live:LiveGame,info:import('@playwright/test').TestInfo){
  await party(live);
  await quests(live,info,{[W]:{count:200},[P]:{count:200}});
  await start(live);
  await expect.poll(async()=>(await live.clients[W].events()).some((e:any)=>e.event==='hit'&&e.data?.hid===W&&e.data?.damage>0),
    {timeout:120_000,message:'The Hunt must be fighting before Pause runs'}).toBe(true);
}
async function held(live:LiveGame,id:string){
  await expect.poll(async()=>{const state=await live.state();return names.every(n=>state.characters[n]?.consoleMaintenance?.id===id&&state.characters[n].consoleMaintenance.ready===true);},
    {timeout:60_000,message:'Every character must acknowledge the console Pause and hold still'}).toBe(true);
}
const positions=(live:LiveGame)=>live.admin(`output=Object.fromEntries(${JSON.stringify(names)}.map(n=>{const p=get_player(n);return [n,{map:p.map,x:p.x,y:p.y,moving:!!p.moving}]}))`);

test('Pause holds every character still mid-hunt, an attacked fighter defends, and Play restores the hunt unchanged',async({live},info)=>{
  test.setTimeout(300_000);
  let threat:string|undefined;
  try{
    await huntRunning(live,info);
    const before=choices(await live.state());
    const paused=await control(live,'pause');
    expect(paused.paused).toBe(true);
    expect(JSON.parse(readFileSync(pauseFile(live),'utf8')).record.profiles[W].farmingPolicy).toBe('hunt');
    await expect.poll(async()=>(await live.state()).consoleControl?.paused).toBe(true);
    await held(live,paused.leaseId);
    const still=await positions(live),attacksAt=Date.now();
    await waitForGameplay(8000);
    const after=await positions(live);
    for(const n of names){
      expect(after[n].moving,`${n} must not move while paused`).toBe(false);
      expect(Math.hypot(after[n].x-still[n].x,after[n].y-still[n].y),`${n} must stay in place while paused`).toBeLessThan(1);
    }
    const idleHits=(await live.clients[W].events()).filter((e:any)=>e.at>=attacksAt&&e.event==='hit'&&e.data?.hid===W);
    expect(idleHits,'No new target may be attacked while paused').toHaveLength(0);
    threat=await live.admin(`output=(()=>{const p=get_player('${W}'),m=new_monster(p.in,{type:'bee',position:[p.x+20,p.y],radius:0,count:1},{temp:1});m.hp=m.max_hp=15000;target_player(m,p);return String(m.id);})()`);
    await expect.poll(async()=>(await live.clients[W].events()).some((e:any)=>e.event==='hit'&&e.data?.hid===W&&String(e.data?.id)===threat),
      {timeout:30_000,message:'An attacked character must still defend itself while paused'}).toBe(true);
    await live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(threat)}];if(m)remove_monster(m,{method:'disappear',nospawn:true});return true;})()`);
    expect(choices(await live.state())).toEqual(before);
    const played=await control(live,'play');
    expect(played.paused).toBe(false);
    expect(existsSync(pauseFile(live))).toBe(false);
    await expect.poll(async()=>{const state=await live.state();return names.every(n=>!state.characters[n]?.consoleMaintenance);},{timeout:15_000}).toBe(true);
    expect(choices(await live.state())).toEqual(before);
    const resumedAt=Date.now();
    await expect.poll(async()=>(await live.clients[W].events()).some((e:any)=>e.at>=resumedAt&&e.event==='hit'&&e.data?.hid===W&&String(e.data?.id)!==threat),
      {timeout:90_000,message:'The Hunt must fight again after Play'}).toBe(true);
    expect(choices(await live.state())).toEqual(before);
    await artifact(live,info,'console-pause-mid-hunt',{before,still,after,threat,paused,played});
  }finally{
    if(existsSync(pauseFile(live)))await control(live,'play').catch(()=>undefined);
    if(threat)await live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(threat)}];if(m)remove_monster(m,{method:'disappear',nospawn:true});return true;})()`);
  }
});

test('Pause survives a coordinator restart until Play',async({live},info)=>{
  test.setTimeout(240_000);
  try{
    await party(live);
    await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{goo:999},monsterSearchRadius:300});
    await live.post('/farming-mode',{character:W,mode:'default'});
    const before=choices(await live.state());
    const paused=await control(live,'pause');
    await held(live,paused.leaseId);
    await live.restartCoordinator();
    const restarted=(await live.state()).consoleControl;
    expect(restarted.paused).toBe(true);
    expect(restarted.leaseId).toBe(paused.leaseId);
    expect(restarted.resume).toBeNull();
    await held(live,paused.leaseId);
    expect(choices(await live.state())).toEqual(before);
    await control(live,'play');
    await expect.poll(async()=>{const state=await live.state();return names.every(n=>!state.characters[n]?.consoleMaintenance);},{timeout:15_000}).toBe(true);
    expect(choices(await live.state())).toEqual(before);
    await artifact(live,info,'console-pause-restart',{before,paused,restarted});
  }finally{ if(existsSync(pauseFile(live)))await control(live,'play').catch(()=>undefined); }
});

test('clean shutdown leaves no writer lock and resumes the exact state once after restart',async({live},info)=>{
  test.setTimeout(300_000);
  const lock=path.join(live.deploymentPaths.directory,'state.jsonl.writer.lock');
  const observed:any[]=[];
  try{
    await huntRunning(live,info);
    const before=choices(await live.state());
    expect(existsSync(lock),'The running coordinator owns the writer lock').toBe(true);
    const requested=await control(live,'shutdown');
    expect(['draining','safe']).toContain(requested.shutdown?.phase);
    await expect.poll(async()=>{const c=(await live.state()).consoleControl;observed.push({at:Date.now(),c});return c?.shutdown?.phase;},
      {timeout:90_000,message:'The clean shutdown must reach Safe to stop'}).toBe('safe');
    const safe=(await live.state()).consoleControl;
    expect(safe.shutdown.command).toBe('docker compose stop party-console');
    expect(JSON.parse(readFileSync(pauseFile(live),'utf8')).safeAt).toBeGreaterThan(0);
    let stopped:any;
    await live.restartCoordinator(()=>{stopped={lock:existsSync(lock),pause:JSON.parse(readFileSync(pauseFile(live),'utf8'))};});
    expect(stopped.lock,'The stopped coordinator must leave no writer lock').toBe(false);
    expect(stopped.pause.safeAt).toBeGreaterThan(0);
    await expect.poll(async()=>{const c=(await live.state()).consoleControl;observed.push({at:Date.now(),c});return c?.paused;},
      {timeout:200_000,message:'The console must resume automatically once the characters connect'}).toBe(false);
    const resumed=(await live.state()).consoleControl;
    expect(resumed.log.map((entry:any)=>entry.message)).toContain('Automatic resume: resumed automated actions');
    expect(existsSync(pauseFile(live)),'The resume record is consumed').toBe(false);
    expect(choices(await live.state())).toEqual(before);
    await expect.poll(async()=>{const state=await live.state();return names.every(n=>!state.characters[n]?.consoleMaintenance);},{timeout:15_000}).toBe(true);
    const resumedAt=Date.now();
    await expect.poll(async()=>(await live.clients[W].events()).some((e:any)=>e.at>=resumedAt&&e.event==='hit'&&e.data?.hid===W),
      {timeout:90_000,message:'The resumed Hunt must fight again'}).toBe(true);
    await live.restartCoordinator();
    expect((await live.state()).consoleControl.paused,'A second restart must not replay the record').toBe(false);
    await artifact(live,info,'console-clean-shutdown',{before,stopped,safe,resumed,observed:observed.slice(-12)});
  }finally{ if(existsSync(pauseFile(live)))await control(live,'play').catch(()=>undefined); }
});

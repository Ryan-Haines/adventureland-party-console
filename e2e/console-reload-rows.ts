import {waitForGameplay} from './network-clock';
import {codeReloadReads} from './call-budget-rows';
import {expect,type LiveGame,reloadCode} from './live-fixtures';
import type {TestInfo} from '@playwright/test';
import type {Row} from './scenario-table';
import {W,P,M,evidence,killNativeCharacter} from './hunt-interruption-helpers';
import {holdHalloweenSeason} from './game/hunt-events';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';

// The console reload rows, moved from live-console-safe-reload.spec.ts
// into the Arena table (live-farm-death-escape.spec.ts), which logs in on the same combat-range
// loadout. Each row first puts the trio where that file's fixture logged them in, and makes the
// spot both fighters' saved point with a party travel there: the player-trip row saves the
// priest's own point elsewhere, and in the first merged run the priest walked back to it, so the
// warrior's formation waited and never reached the next goo.
const reloadSpot={map:'main',x:1260,y:-70};
// Hunt cancellation returns to the configured native Goo farm, so the turnover row seeds its
// fight there and the successor stays observable after the mode turnover (aac30d45).
const gooFarmSpot={map:'main',x:0,y:787};
export async function toReloadSpot(live:LiveGame,spot=reloadSpot){
  await live.post('/focus',{monsterFocus:[],monsterPriorities:{},monsterSearchRadius:300});
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  await live.admin(`output=(()=>{for(const n of ${JSON.stringify([W,P,M])}){const p=get_player(n);transport_player_to(p,'${spot.map}',[${spot.x},${spot.y}]);}return true;})()`);
  for(const name of [W,P])await expect.poll(async()=>live.clients[name].run(`character.map==='${spot.map}'`),
    {timeout:60_000,message:'Both fighters must reach Main'}).toBe(true);
  await live.post('/travel',spot);
  await expect.poll(async()=>{const s=await live.state();return !s.activeConvoy&&[W,P].every(n=>s.characters[n]?.map===spot.map&&
    Math.hypot(s.characters[n].x-spot.x,s.characters[n].y-spot.y)<=20);},{timeout:120_000,message:'Both fighters must stand on the reload spot'}).toBe(true);
  await expect.poll(async()=>(await live.tasks()).groups.find((g:any)=>g.id===`party:${W}`)?.live?.kind,{timeout:30_000,message:'The trip task must end before the row'}).not.toBe('manual');
}

// e2e/live-lifecycle-hooks.spec.ts runs this row with lifecycle's fixture add-on registered.
// The turnover variant switches W to Hunt and an unjoined Trick or Treat selection during the
// drain (docs/testing-safe-console-reload.md) and leaves the Pause rows to the plain variant.
export async function safeReloadRow(live:LiveGame,info:TestInfo,turnover=false){
  // Failure inventory: docs/testing-safe-console-reload.md, the console Pause rows
  // among them. The Pause rows run here because they need the same farming party and the same
  // lease readers as the safe reload.
  const pauseFile=path.join(live.deploymentPaths.directory,'updates/console-pause.json');
  const control=(action:string,body={})=>live.post('/console-control/'+action,body);
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{goo:999},monsterSearchRadius:300});
  await live.post('/farming-mode',{character:W,mode:'default'});
  await live.post('/checkpoint',{});
  const seeded=await live.admin(`output=(()=>{
    const p=get_player('${W}'),saved=[];
    for(const m of Object.values(instances.main.monsters))if(Math.hypot(m.x-p.x,m.y-p.y)<800){saved.push(m.id);remove_monster(m,{method:'disappear',nospawn:true});}
    const a=new_monster('main',{type:'goo',position:[p.x+30,p.y],radius:0,count:1},{temp:1});
    a.hp=a.max_hp=15000;
    return {first:String(a.id),next:null,map:p.map,x:p.x,y:p.y,removed:saved};
  })()`);
  const hit=(events:any[],id:string)=>events.filter(e=>e.event==='hit'&&String(e.data?.id)===id&&e.data?.hid===W&&e.data?.source==='attack');
  const pauseSeeds:string[]=[];
  const spawn=async(type:string,attack:boolean)=>{
    const id:string=await live.admin(`output=(()=>{const p=get_player('${W}'),m=new_monster(p.in,{type:'${type}',position:[p.x+${attack?20:-40},p.y],radius:0,count:1},{temp:1});
      m.hp=m.max_hp=15000;${attack?'target_player(m,p);':''}return String(m.id);})()`);
    pauseSeeds.push(id);return id;
  };
  const remove=(id:string|null)=>live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(id)}];if(m)remove_monster(m,{method:'disappear',nospawn:true});return true;})()`);
  const anyHit=async(id:string,after=0)=>(await live.clients[W].events()).some((e:any)=>e.at>=after&&e.event==='hit'&&e.data?.hid===W&&String(e.data?.id)===id);
  const positions=()=>live.admin(`output=Object.fromEntries(${JSON.stringify([W,P])}.map(n=>{const p=get_player(n);return [n,{map:p.map,x:p.x,y:p.y,moving:!!p.moving}]}))`);
  // The Pause rides no lease, so a paused
  // character acknowledges `held` and names no lease id (runtime/lifecycle/character/drain.ts `acknowledge`).
  const held=(message:string)=>expect.poll(async()=>{const state=await live.state();return [W,P,M].every(n=>{const ack=state.characters[n]?.consoleMaintenance;
    return ack?.held===true&&ack.ready===true&&ack.id===undefined;});},
    {timeout:60000,message}).toBe(true);
  const released=()=>expect.poll(async()=>{const state=await live.state();return [W,P,M].every(n=>!state.characters[n]?.consoleMaintenance);},{timeout:15000,
    message:'Play must release every character'}).toBe(true);
  // The console Pause.
  async function pauseRows(){
    const rows:Record<string,unknown>={};
    const focus={monsterFocus:['goo','bee'],monsterPriorities:{goo:999},monsterSearchRadius:300};
    const paused=await control('pause');
    expect(paused.paused).toBe(true);
    await held('Every character must acknowledge the console Pause and hold still');
    // The Pause is the task owner's user hold on every group.
    await expect.poll(async()=>(await live.tasks()).groups.every((g:any)=>g.holds.some((h:any)=>h.by==='user'&&!h.member)),
      {timeout:15000,message:'The Pause must hold every group'}).toBe(true);
    // PP1: no new target and no walk while paused.
    const idle=await spawn('goo',false),still=await positions(),idleAt=Date.now();
    await waitForGameplay(4000);
    const after=await positions();
    for(const n of [W,P]){
      expect(after[n].moving,`${n} must not move while paused`).toBe(false);
      expect(Math.hypot(after[n].x-still[n].x,after[n].y-still[n].y),`${n} must stay in place while paused`).toBeLessThan(1);
    }
    expect(await anyHit(idle,idleAt),'No new target may be attacked while paused').toBe(false);
    rows.PP1={still,after};
    // Nothing acts while paused, so a monster that attacks the party is not answered (user,
    // 2026-10-29: "a pause means pause all code").
    const threat=await spawn('bee',true),threatAt=Date.now();
    await waitForGameplay(6000);
    expect(await anyHit(threat,threatAt),'A paused character must not attack, even what attacks it').toBe(false);
    await remove(threat);
    // PP3: nothing acts while paused: an injured character drinks and regenerates nothing, and a
    // dead one stays dead until Play.
    const injuredAt:number=await live.admin(`output=(()=>{const p=get_player('${W}');p.hp=Math.floor(p.max_hp*.3);resend(p,'u+cid');return Date.now();})()`);
    await waitForGameplay(6000);
    expect(await live.clients[W].run(`Math.max(+(parent.next_skill.regen_hp||0),+(parent.next_skill.use_hp||0))`),
      'A paused character must not recover').toBeLessThan(injuredAt);
    const killed=await killNativeCharacter(live,W);
    await waitForGameplay(6000);
    expect((await live.admin(`output=!!get_player('${W}').rip`)),'A dead character stays dead while paused').toBe(true);
    rows.PP3={injuredAt,killed};
    // A deploy lease while paused keeps the deploy's id and the Pause's flags, so nothing acts during the deploy.
    live.consoleDrainLease('deploy-while-paused');
    // The lease reaches W as it is, and the hold field `user` keeps W held.
    await expect.poll(()=>live.clients[W].run('({id:globalThis.__partyConsoleMaintenance?.id,held:__partyHooks.askRow("lifecycle.held",[])})'),
      {timeout:15000,message:'A deploy while paused must leave the Pause holding'}).toEqual({id:'deploy-while-paused',held:true});
    live.consoleDrainLease(null);
    await held('The Pause must hold again once the deploy lease goes');
    // First half: a setting changed while paused.
    await live.post('/focus',focus);
    // The Pause survives a coordinator restart.
    await live.restartCoordinator();
    const restarted=(await live.state()).consoleControl;
    expect(restarted).toMatchObject({paused:true,leaseId:paused.leaseId,resume:null});
    await held('The characters must hold the same Pause after the restart');
    expect(await anyHit(idle,idleAt),'No new target may be attacked across the restart').toBe(false);
    // Play releases every character, keeps the setting, and farming resumes.
    const played=await control('play');
    expect(played.paused).toBe(false);
    expect(existsSync(pauseFile)).toBe(false);
    await released();
    expect((await live.tasks()).groups.some((g:any)=>g.holds.some((h:any)=>h.by==='user')),'Play must lift every group hold').toBe(false);
    await expect.poll(()=>live.admin(`output=!get_player('${W}').rip`),{timeout:60000,message:'Play must let the dead character respawn'}).toBe(true);
    expect((await live.state()).monsterFocus,'Play must keep a setting changed while paused').toEqual(focus.monsterFocus);
    await expect.poll(()=>anyHit(idle),{timeout:60000,message:'Farming must take the waiting goo after Play'}).toBe(true);
    await remove(idle);
    // The clean shutdown saves its state and leaves no writer lock.
    const lock=path.join(live.deploymentPaths.directory,'state.jsonl.writer.lock');
    expect(existsSync(lock),'The running coordinator owns the writer lock').toBe(true);
    // The resume wait is a saved setting, so
    // the start after the shutdown uses the value written now, not an environment value.
    const savedWait=(await live.state()).consoleControl.resumeWaitMs,resumeWaitMs=savedWait+10_000;
    await live.post('/settings',{changes:[{field:'consoleResumeWaitMs',value:resumeWaitMs}]});
    const requested=await control('shutdown');
    expect(['draining','safe']).toContain(requested.shutdown?.phase);
    await expect.poll(async()=>(await live.state()).consoleControl?.shutdown?.phase,{timeout:90000,message:'The clean shutdown must reach Safe to stop'}).toBe('safe');
    expect((await live.state()).consoleControl.shutdown.command).toBe('docker compose stop party-console');
    let stopped:any;
    await live.restartCoordinator(()=>{stopped={lock:existsSync(lock),pause:JSON.parse(readFileSync(pauseFile,'utf8'))};});
    expect(stopped.lock,'The stopped coordinator must leave no writer lock').toBe(false);
    expect(stopped.pause.safeAt).toBeGreaterThan(0);
    // The next start resumes once, after the characters connect.
    await expect.poll(async()=>(await live.state()).consoleControl?.paused,{timeout:200000,message:'The console must resume once the characters connect'}).toBe(false);
    const resumed=(await live.state()).consoleControl;
    expect(resumed.log.map((entry:any)=>entry.message)).toContain('Automatic resume: resumed automated actions');
    expect(resumed.resumeWaitMs,'The automatic resume uses the saved wait').toBe(resumeWaitMs);
    await live.post('/settings',{changes:[{field:'consoleResumeWaitMs',value:savedWait}]});
    expect(existsSync(pauseFile),'The automatic resume consumes the record').toBe(false);
    await released();
    expect((await live.state()).monsterFocus,'The automatic resume keeps the settings').toEqual(focus.monsterFocus);
    await live.restartCoordinator();
    expect((await live.state()).consoleControl.paused,'A second restart must not pause or resume again').toBe(false);
    // After a CODE reload, the call budget's
    // reads run once per socket.
    await codeReloadReads(live,info);
    await evidence(live,info,'console-pause-rows',{...rows,paused,restarted,played,stopped,resumed});
  }
  const samples:any[]=[];
  let holdFull=true,delayedFull=0;
  const releases:Array<()=>void>=[];
  await live.clients[W].run(`(()=>{
    globalThis.__safeDrainControls=[];
    $(document).on('ajaxComplete.safeDrainObservation',function(_event,xhr,settings){
      if(!String(settings.url).endsWith('/status'))return;
      const value=xhr.responseJSON;
      globalThis.__safeDrainControls.push({at:Date.now(),status:xhr.status,serverNow:value?.serverNow,
        maintenance:value?.consoleMaintenance,kind:typeof settings.data==='string'&&settings.data.includes('"combatWait":true')?'wait':
          typeof settings.data==='string'&&settings.data.includes('"combatOnly":true')?'report':'full'});
      if(globalThis.__safeDrainControls.length>32)globalThis.__safeDrainControls.shift();
    });
    return true;
  })()`);
  const observerElement=await live.clients[W].frame.$('#maincode');
  const observerFrame=await observerElement?.contentFrame();
  await observerElement?.dispose();
  const delayedStatus=async(route:any)=>{
    const body=route.request().postDataJSON();
    if(!holdFull || body?.combatOnly || body?.combatWait)return route.continue();
    const response=await route.fetch();delayedFull++;
    if(holdFull)await new Promise<void>(resolve=>releases.push(resolve));
    // Native AJAX can abort a deliberately delayed full report at its deadline.
    // Preserve that transport failure without masking the behavior assertion.
    try{await route.fulfill({response});}catch(error){
      if(!route.request().failure())throw error;
      samples.push({at:Date.now(),delayedFullAborted:route.request().failure()});
    }
  };
  // The turnover's Hunt mode and event selection end with the row, pass or fail: a row that failed
  // inside the turnover left the warrior on Hunt, and the next rows' goo farm never started.
  let turnedOver=false,cleared=false,endSeason:(()=>Promise<unknown>)|null=null,mark=0;
  const partyRing=async()=>((await live.tasks()).groups.find((g:any)=>g.id===`party:${W}`)?.ring??[]) as any[];
  const clearTurnover=async()=>{if(!turnedOver||cleared)return;cleared=true;
    await live.post('/formation',{character:W,eventSelections:[]});
    await live.post('/farming-mode',{character:W,mode:'default'});};
  // The attendance ends only with the season, and the season's end starts the event return the next
  // row's farming waits behind. The row ends the season itself and ends once that return ended and
  // the coordinator holds no return record; the record alone is absent until the return starts.
  const endTurnover=async()=>{if(!turnedOver)return;await clearTurnover();turnedOver=false;
    await endSeason?.();
    await expect.poll(async()=>{const after=(await partyRing()).filter(e=>e.seq>mark&&e.decision==='ended');
      return {attendance:after.some(e=>e.kind==='event-attendance'),returned:after.some(e=>e.kind==='event-return'),
        record:!!(await live.state()).eventReturn};},{timeout:90000,
      message:'The event return must finish before the next row starts'}).toEqual({attendance:true,returned:true,record:false});};
  try{
    await expect.poll(async()=>hit(await live.clients[W].events(),seeded.first).length,{timeout:45000}).toBeGreaterThan(0);
    const before=hit(await live.clients[W].events(),seeded.first).length;
    seeded.next=await live.admin(`output=(()=>{const m=new_monster('main',{type:'goo',position:[${seeded.x+85},${seeded.y}],radius:0,count:1},{temp:1});m.hp=m.max_hp=15000;return String(m.id);})()`);
    await expect.poll(()=>live.clients[W].run(`partyStatus.character.queueMarkers().some(m=>m.id===${JSON.stringify(seeded.next)}&&m.role==='next')`),{timeout:15000}).toBe(true);
    await live.clients[W].page.route('**/status',delayedStatus);
    await expect.poll(()=>delayedFull,{timeout:15000}).toBeGreaterThan(0);
    live.consoleDrainLease('native-safe-reload');
    samples.push({phase:'lease-written',at:Date.now(),lease:JSON.parse(readFileSync(path.join(live.deploymentPaths.directory,'updates/pause.json'),'utf8'))});
    await expect.poll(async()=>{
      const native=await live.clients[W].run(`({maintenance:globalThis.__partyConsoleMaintenance,at:globalThis.__partyConsoleMaintenanceAt,
        parentMaintenance:parent.__partyConsoleMaintenance,parentAt:parent.__partyConsoleMaintenanceAt,
        generation:globalThis.__partyRuntimeGeneration,transport:globalThis.__partyTravelTransport,controls:globalThis.__safeDrainControls})`);
      samples.push({phase:'acknowledgement',at:Date.now(),native});
      return native.maintenance?.id;
    },{timeout:5000,
      message:'Fast combat responses must apply the hold while full status is delayed'}).toBe('native-safe-reload');
    holdFull=false;releases.splice(0).forEach(release=>release());
    await waitForGameplay(500);
    expect(await live.clients[W].run('globalThis.__partyConsoleMaintenance?.id')).toBe('native-safe-reload');
    await expect.poll(async()=>{const state=await live.state();return [W,P,M].every(name=>state.characters[name]?.consoleMaintenance?.id==='native-safe-reload');},{timeout:15000}).toBe(true);
    if(turnover){
      // Trick or Treat needs the season live; the row's end undoes the hold.
      endSeason=await holdHalloweenSeason(live);
      await live.admin(`output=(()=>{for(const name of ['${W}','${P}']){const p=get_player(name);p.p.trickortreat=null;p.trickortreat=trick_or_treat_status(p);resend(p,'u+reopen+cid');}return true;})()`);
      mark=Math.max(0,...(await partyRing()).map(e=>Number(e.seq)||0));
      turnedOver=true;
      await live.post('/formation',{character:W,eventSelections:['trickortreat']});
      await live.post('/farming-mode',{character:W,mode:'hunt'});
      await expect.poll(async()=>{const s=await live.state();return {event:s.characters[W]?.activeEvent,joined:s.characters[W]?.joinedEvent||null};},{timeout:15000}).toEqual({event:'trickortreat',joined:null});
      // The Hunt's status line rides its task's label (the hunting owner's `huntMessage`), so the row reads
      // it from the party's task status, where a Hunt task the attendance suspends still names it.
      await expect.poll(async()=>{const status=(await live.tasks()).groups.find((g:any)=>g.id===`party:${W}`)?.status;
        return [...(status?.phase?.startsWith('hunt')?[status.label]:[]),...(status?.reasons??[]).filter((r:any)=>String(r.kind).startsWith('hunt')).map((r:any)=>r.label)].join('; ');},
        {timeout:15000,message:"The Hunt's status line must say it waits for the console load"}).toContain('console load');
    }
    await expect.poll(async()=>hit(await live.clients[W].events(),seeded.first).length,{timeout:15000,
      message:'Native attacks must continue after the acquisition hold'}).toBeGreaterThan(before);
    await expect.poll(async()=>{
      const state=await live.state();
      const report=state.characters[W];
      samples.push({at:Date.now(),maintenance:report?.consoleMaintenance,target:report?.combatSelection?.id,position:report?.activeCombatTarget});
      return (await live.clients[W].events()).some((event:any)=>event.event==='death'&&String(event.data?.id)===seeded.first);
    },{timeout:90000,intervals:[250,500]}).toBe(true);
    await expect.poll(async()=>{const state=await live.state();return [W,P,M].every(name=>state.characters[name]?.consoleMaintenance?.ready===true);},
      {timeout:15000,message:'Fresh participants must report the finished fight as safe'}).toBe(true);
    await waitForGameplay(1500);
    expect(hit(await live.clients[W].events(),seeded.next),'The pending reload must not acquire the next monster').toHaveLength(0);
    expect(await live.clients[W].run('partyStatus.character.queueMarkers().filter(m=>m.role==="current"&&m.visible).length')).toBe(0);
    if(!turnover)expect(await live.clients[W].run(`partyStatus.character.queueMarkers().some(m=>m.id===${JSON.stringify(seeded.next)}&&m.role==='next'&&m.visible)`)).toBe(true);
    await evidence(live,info,'safe-reload-native-combat-drain',{seeded,samples,firstHits:hit(await live.clients[W].events(),seeded.first),nextHits:hit(await live.clients[W].events(),seeded.next)});
    await info.attach('safe-reload-no-red-circle',{body:await live.clients[W].page.screenshot(),contentType:'image/png'});
    await clearTurnover();
    live.consoleDrainLease('native-safe-reload',Date.now()-1);
    await expect.poll(async()=>hit(await live.clients[W].events(),seeded.next).length,{timeout:30000,
      message:'An expired host hold must restore normal acquisition'}).toBeGreaterThan(0);
    live.consoleDrainLease(null);
    await remove(seeded.next);
    await endTurnover();
    if(!turnover)await pauseRows();
  }finally{holdFull=false;releases.splice(0).forEach(release=>release());await live.clients[W].page.unrouteAll({behavior:'wait'});await evidence(live,info,'safe-reload-final-state',{seeded,samples});await clearTurnover();if(observerFrame&&!observerFrame.isDetached())await observerFrame.evaluate(()=>{const host=window as any;host.$(document).off('.safeDrainObservation');});live.consoleDrainLease(null);if(existsSync(pauseFile))await control('play').catch(()=>undefined);await live.admin(`output=(()=>{for(const id of ${JSON.stringify([seeded.first,seeded.next,...pauseSeeds])}){const m=instances.main.monsters[id];if(m)remove_monster(m,{method:'disappear',nospawn:true});}return true;})()`);await endTurnover();}
}

async function reloadResumes(live:LiveGame,info:TestInfo,mode:'safe'|'now'){
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:false,eventSelections:[]});
  await live.post('/formation',{character:W,eventSelections:[]});
  await live.post('/focus',{monsterFocus:[],monsterPriorities:{},monsterSearchRadius:300});
  await live.post('/checkpoint',{});
  await live.admin(`output=(()=>{const p=get_player('${W}');for(const m of Object.values(instances.main.monsters))if(Math.hypot(m.x-p.x,m.y-p.y)<800)remove_monster(m,{method:'disappear',nospawn:true});return true;})()`);
  const samples:any[]=[];
  const destination=await live.clients[W].run(`(()=>{
    const p=character,delta=[[260,0],[-260,0],[0,260],[0,-260]].find(([x,y])=>can_move_to(p.x+x,p.y+y));
    if(!delta)throw Error('No collision-safe walking probe');
    const goal={map:p.map,x:p.x+delta[0],y:p.y+delta[1]};
    return goal;
  })()`);
  await live.post('/travel',destination);
  const seeded:string[]=[];
  try{
    if(mode==='safe'){
      let admission:any;
      await expect.poll(async()=>{
        admission=await live.clients[W].frame.evaluate(goal=>{
          const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
          const service=runner?.__partyMovement,report=service?.report(),state=service?.state,character=game.character;
          return {id:report?.id,owner:report?.owner,name:character?.name,map:character?.map,moving:!!character?.moving,
            goalMatch:state?.map===goal.map&&state?.x===goal.x&&state?.y===goal.y};
        },destination);
        return !!admission.id&&admission.name===W&&admission.map===destination.map&&admission.moving&&admission.goalMatch;
      },{timeout:30000,intervals:[50,100],message:'The native character and active owned journey must be walking toward the requested probe together'}).toBe(true);
      const journey=admission.id;
      live.consoleDrainLease('reload-walk');
      await expect.poll(()=>live.clients[W].run('globalThis.__partyConsoleMaintenance?.id'),{timeout:10000}).toBe('reload-walk');
      await expect.poll(()=>live.admin(`output=!!get_player('${W}').moving`),{timeout:10000}).toBe(false);
      await waitForGameplay(3500);
      expect(await live.clients[W].run('globalThis.__partyMovement.report()?.id')).toBe(journey);
      expect(await live.clients[W].run('sharedRoutine.canReload()')).toBe(true);
      samples.push({phase:'parked',journey,admission,position:await live.clients[W].snapshot()});
      live.consoleDrainLease(null);
    }else await expect.poll(()=>live.admin(`output=!!get_player('${W}').moving`),{timeout:30000}).toBe(true);
    await expect.poll(async()=>{const p=await live.clients[W].snapshot();return Math.hypot(p.x-destination.x,p.y-destination.y)<10;},{timeout:30000}).toBe(true);
    const arrived=await live.clients[W].snapshot();
    expect(Math.hypot(arrived.x-destination.x,arrived.y-destination.y)).toBeLessThan(10);
    await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{goo:999},monsterSearchRadius:300});
    await live.post('/checkpoint',{});
    if(mode==='safe'){
      live.consoleDrainLease('reload-combat');
      await expect.poll(async()=>{const s=await live.state();return s.characters[W]?.consoleMaintenance?.ready;},{timeout:15000}).toBe(true);
      await waitForGameplay(3200);
      expect(await live.clients[W].run('sharedRoutine.canReload()')).toBe(true);
    }
    const runtime=(await live.state()).characters[W].dashboardRuntime;
    await reloadCode(live,W);
    await expect.poll(async()=>{const s=await live.state();return s.characters[W]?.dashboardRuntime!==runtime&&s.characters[W]?.seenAt>Date.now()-5000;},{timeout:30000}).toBe(true);
    live.consoleDrainLease(null);
    samples.push({phase:'final',diagnostics:await live.clients[W].run('({movement:globalThis.__partyMovement.report(),last:globalThis.__partyMovement.last(),combat:globalThis.partyCombatState,maintenance:globalThis.__partyConsoleMaintenance})')});
    expect((await live.state()).monsterFocus).toEqual(['goo']);
    const farm=await live.admin(`output=(()=>{const p=get_player('${W}'),m=new_monster(p.in,{type:'goo',position:[p.x+30,p.y],radius:0,count:1},{temp:1});m.hp=m.max_hp=15000;return String(m.id);})()`);
    seeded.push(farm);
    const attacked=async(id:string)=>(await live.clients[W].events()).some(e=>e.event==='hit'&&String(e.data?.id)===id&&e.data?.hid===W);
    await expect.poll(()=>attacked(farm),{timeout:30000,message:'Configured farming resumes after actual CODE replacement'}).toBe(true);
    await live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(farm)}];if(m)remove_monster(m,{method:'disappear',nospawn:true});return true;})()`);
    const threat=await live.admin(`output=(()=>{const p=get_player('${W}'),m=new_monster(p.in,{type:'bee',position:[p.x+20,p.y],radius:0,count:1},{temp:1});m.hp=m.max_hp=15000;target_player(m,p);return String(m.id);})()`);
    seeded.push(threat);
    await expect.poll(()=>attacked(threat),{timeout:30000,message:'A non-focus native roaming attacker receives a defensive response'}).toBe(true);
    samples.push({phase:'resumed',mode,focus:(await live.state()).monsterFocus,position:await live.clients[W].snapshot()});
  }finally{
    live.consoleDrainLease(null);
    samples.push({phase:'before-target-cleanup',at:Date.now(),native:await live.clients[W].run(`(()=>{
      const ids=${JSON.stringify(seeded)},clock=globalThis.__e2eChronalClock;
      return {at:Date.now(),runtime:globalThis.__partyRuntimeGeneration,clock:clock&&{now:clock.now(),join:clock.join,state:clock.state},
        combat:globalThis.partyCombatState,trace:partyStatus.character.combatTraceSnapshot(),
        targets:ids.map(id=>{const target=get_entity(id);return {id,target:target&&{id:target.id,map:target.map,x:target.x,y:target.y,hp:target.hp,visible:target.visible,target:target.target},canAttack:!!target&&can_attack(target)};})};
    })()`).catch(String)});
    await evidence(live,info,'reload-activity-resumption-'+mode,{destination,samples,seeded});
    await live.admin(`output=(()=>{for(const id of ${JSON.stringify(seeded)}){const m=instances.main.monsters[id];if(m)remove_monster(m,{method:'disappear',nospawn:true});}return true;})()`);
  }
}

export const reloadRows:Row[]=[
  ['safe console reload finishes the native fight without acquiring the next target; the console Pause holds through a deploy and restarts until Play',async(live,info)=>{await toReloadSpot(live);await safeReloadRow(live,info);}],
  ['safe console reload finishes the native fight without acquiring the next target after Hunt and unjoined event selection turnover',async(live,info)=>{await toReloadSpot(live,gooFarmSpot);await safeReloadRow(live,info,true);}],
  ...(['safe','now'] as const).map((mode):Row=>[`console reload resumes native farming and roaming defense in ${mode} mode`,async(live,info)=>{await toReloadSpot(live);await reloadResumes(live,info,mode);}]),
];

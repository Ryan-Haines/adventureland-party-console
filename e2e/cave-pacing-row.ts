import {expect,type LiveGame} from './live-fixtures';
import type {Page,TestInfo} from '@playwright/test';
import {taskSeq,taskTrail} from './task-records';
import {killNativeCharacter} from './hunt-interruption-helpers';
import {caveView,caveAct,voteAndSettle} from './cave-harness';

// The Cave pacing row, moved in the tasks owner step 8 (the test cut) from live-cave.spec.ts into the default
// fixture's table, last, because it narrows the Cave's encounters (G.events.dreams) for the rest
// of the run. It first moves the trio to the spot live-cave.spec.ts's fixture logs them in at.
const caveSpot={map:'main',x:816,y:1180};
export async function cavePacingRow(live:LiveGame,info:TestInfo,page:Page){
  const names=['E2EWarrior','E2EPriest','E2EMerchant'];
  await live.admin(`output=(()=>{for(const n of ${JSON.stringify(names)}){const p=get_player(n);transport_player_to(p,'${caveSpot.map}',[${caveSpot.x},${caveSpot.y}]);}return true;})()`);
  for(const name of names)await expect.poll(async()=>live.clients[name].run(`character.map==='${caveSpot.map}'&&Math.hypot(character.real_x-(${caveSpot.x}),character.real_y-(${caveSpot.y}))<=20`),
    {timeout:60_000,message:'The trio must stand at the Cave spot'}).toBe(true);
  await live.admin("Dev=true;Prod=false;G.events.dreams.disabled=false;G.events.dreams.encounters=G.events.dreams.encounters.filter(e=>['e11','e20','e31','e50'].includes(e.id));output=true");
  await live.post('/formation',{leader:'E2EWarrior'});
  await live.post('/formation',{character:'E2EPriest',follow:true});
  const view=caveView(live,page),act=caveAct(live);
  await expect.poll(async()=>{
    const v=await view();
    return v.members.length===2&&v.members.every((m:any)=>m.fresh&&m.observation?.ready&&m.observation?.visit?.available&&m.observation.members.length===2&&m.observation.leader==='E2EWarrior');
  },{timeout:60_000}).toBe(true);
  // The task the party goes back to once the visit ends.
  const taskBefore=(await taskTrail(live,'party:E2EWarrior',0)).live;
  expect(['idle','cave',undefined],'precondition: the party has a task before the visit').not.toContain(taskBefore);
  await act({action:'enter'});
  await expect.poll(async()=>(await view()).state.phase,{timeout:60_000}).toBe('active');
  await voteAndSettle(view,act);
  const initial=await live.state(),cave=(await view()).members[0].observation.cave;
  const target=cave.points.filter((p:any)=>p.kind==='farm'&&!p.done).sort((a:any,b:any)=>Math.hypot(a.x-initial.characters.E2EWarrior.x,a.y-initial.characters.E2EWarrior.y)-Math.hypot(b.x-initial.characters.E2EWarrior.x,b.y-initial.characters.E2EWarrior.y))[0];
  await act({action:'move',run:cave.run,target:target.id});
  const preparation:any[]=[];let sampledAt=0;
  try{
    await expect.poll(async()=>{
      const v=await view();
      if(await voteAndSettle(view,act,v.members[0]?.observation?.cave)){await act({action:'move',run:cave.run,target:target.id});return false;}
      if(Date.now()-sampledAt>=5000){
        sampledAt=Date.now();
        const native=await live.clients.E2EWarrior.run('({at:Date.now(),searching:smart.searching,found:smart.found,index:typeof start==="number"?start:null,queued:typeof queue!=="undefined"?queue.length:null})');
        preparation.push({at:sampledAt,native,travel:v.members.map((m:any)=>({name:m.name,travel:m.observation?.travel,action:m.observation?.action}))});
      }
      return v.members.every((m:any)=>{
        const command=v.state.commands[m.name];
        return command?.action==='move'&&command.target?.id===target.id&&command.run===cave.run&&
          m.observation?.travel?.id===command.id&&m.observation.travel.prepared;
      });
    },{timeout:270_000,message:'The owned Cave routes must prepare within the progressive native planning allowance'}).toBe(true);
  }finally{await info.attach('native-cave-pacing-route-preparation',{body:JSON.stringify(preparation),contentType:'application/json'});}
  let evidence:any;
  await expect.poll(async()=>{
    const v=await view();
    if(await voteAndSettle(view,act,v.members[0]?.observation?.cave)){await act({action:'move',run:cave.run,target:target.id});return false;}
    const s=await live.state(),w=s.characters.E2EWarrior,p=s.characters.E2EPriest;
    evidence={view:v,characters:{E2EWarrior:w,E2EPriest:p},gap:Math.hypot(w.x-p.x,w.y-p.y)};
    return v.members.every((m:any)=>m.observation.travel?.prepared)&&p.movement?.engine==='cave-convoy'&&
      Math.min(Math.hypot(w.x-initial.characters.E2EWarrior.x,w.y-initial.characters.E2EWarrior.y),Math.hypot(p.x-initial.characters.E2EPriest.x,p.y-initial.characters.E2EPriest.y))>100;
  },{timeout:60_000}).toBe(true);
  expect(evidence.gap).toBeLessThan(220);
  const cruise=await live.admin("output=['E2EWarrior','E2EPriest'].map(n=>({name:n,cruise:get_player(n).cruise}));");
  expect(cruise[0].cruise).toBeGreaterThan(0);expect(cruise[0].cruise).toBe(cruise[1].cruise);
  await info.attach('native-cave-shared-pacing',{body:JSON.stringify({initial,target,cruise,...evidence}),contentType:'application/json'});
  await act({action:'progress',enabled:false});
  expect(Object.values((await view()).state.commands).some((c:any)=>['move','gather'].includes(c.action))).toBe(false);
  for(const name of ['E2EWarrior','E2EPriest'])await expect.poll(async()=>live.clients[name].frame.evaluate(()=>{
    const w=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
    return !!w.__partyMovement.state.moving;
  }),{timeout:10_000}).toBe(false);
  const dashboardReady=page.waitForResponse(response=>response.request().method()==='GET'&&
    new URL(response.url()).pathname==='/party-api/daily-dungeons'&&response.ok(),{timeout:60_000});
  await Promise.all([dashboardReady,page.goto(live.url)]);
  // Walking can reveal a fresh encounter even after travel is stopped. Its
  // native modal correctly hides background controls until the party answers.
  await voteAndSettle(view,act);
  await expect(page.getByRole('region',{name:'Cave of Many Dreams controls'})).toBeVisible();
  await info.attach('native-cave-stopped-pacing',{body:await page.getByRole('region',{name:'Cave of Many Dreams controls'}).screenshot(),contentType:'image/png'});
  // The Cave task. The run above shares its setup.
  const group='party:E2EWarrior',reports=async(n:number)=>{const at=Date.now();
    await expect.poll(async()=>(await live.state()).characters.E2EWarrior.seenAt>at+n*1000,{timeout:60_000}).toBe(true);};
  const visit=(await view()).state.run;
  // The Cave holds the party, and no escape or death recovery asks while every member is inside.
  expect((await taskTrail(live,group,0)).live).toBe('cave');
  expect((await taskTrail(live,group,0)).trail.filter(([,k])=>['escape','death-recovery'].includes(k))).toEqual([]);
  // The priest goes solo mid-visit (Follow applies at once) and stays the visit's: its
  // own Hunt and farming wait, so it stays in the run and takes no farming command.
  await live.post('/formation',{character:'E2EPriest',follow:false});
  await expect.poll(async()=>(await live.tasks()).groups.some((g:any)=>g.id==='solo:E2EPriest'),{timeout:30_000}).toBe(true);
  await reports(3);
  {const v=await view(),priest=v.members.find((m:any)=>m.name==='E2EPriest');
    expect(priest.observation?.cave?.run,'the solo priest stays in the run').toBe(visit);
    expect((await live.state()).commands?.E2EPriest?.type??null,'no solo farming command').toBeNull();}
  await live.post('/formation',{character:'E2EPriest',follow:true});
  await expect.poll(async()=>(await live.tasks()).groups.some((g:any)=>g.id==='solo:E2EPriest'),{timeout:30_000}).toBe(false);
  // With "After a run" on stay the party holds outside, a user hold.
  await act({action:'settings',afterRun:'stay'});
  await act({action:'exit'});
  await expect.poll(async()=>(await view()).state.phase,{timeout:60_000}).toBe('held');
  await reports(3);
  expect((await view()).state.phase,'stay keeps the party outside').toBe('held');
  expect((await taskTrail(live,group,0)).live).toBe('cave');
  {const held=(await live.tasks()).groups.find((g:any)=>g.id===group);
    expect(held.holds.some((h:any)=>h.by==='cave-hold'&&!h.member),'F58: stay is a user hold on the visit group').toBe(true);
    expect(held.status.label,'F58: the hold needs the player').toMatch(/needs your action$/);}
  // F23: a member that dies outside the cave after the run respawns, and death recovery runs
  // under stay.
  const from=await taskSeq(live,group);
  await killNativeCharacter(live,'E2EPriest');
  await expect.poll(async()=>{const c=(await live.state()).characters.E2EPriest;return !!c&&!c.rip&&c.hp>0;},{timeout:120_000,message:'The priest respawns outside the cave'}).toBe(true);
  // The death recovery starts from the first full report that shows the death, which can be the
  // report after the respawn, so the check waits for that report. Reading the trail at the
  // respawn gave an empty trail with no recovery record yet.
  await expect.poll(async()=>(await taskTrail(live,group,from)).trail.some(([d,k])=>d==='granted'&&k==='death-recovery'),{timeout:30_000}).toBe(true).catch(()=>{});
  const after=await taskTrail(live,group,from),recovery=(await live.state()).combatRecovery,read=(await live.tasks()).groups.find((g:any)=>g.id===group);
  console.log('F23 diagnostics '+JSON.stringify({from,ring:read?.ring?.slice(-12),waiting:read?.waiting?.map((w:any)=>[w.kind,w.owner]),groups:(await live.tasks()).groups.map((g:any)=>[g.id,g.members,g.live?.kind])}));
  expect(after.trail.some(([d,k])=>d==='granted'&&k==='death-recovery'),'death recovery runs outside after the run: '+JSON.stringify({trail:after.trail,live:after.live,recovery:recovery&&{phase:recovery.phase,names:recovery.names,reason:recovery.reason}})).toBe(true);
  // HN23: the held visit owns no member outside, so the
  // death recovery finishes while stay still holds the visit. On b9b5c91e the held visit owned both
  // members and the recovery waited at "Waiting for respawn and safe regroup" (01 design, the Cave
  // row's stuck recovery).
  const caveState=async(name:string)=>(await live.post('/e2e-hunting-hooks',{op:'ask',hook:'cave.state',args:[name]})).answer;
  for(const name of ['E2EWarrior','E2EPriest'])
    expect(await caveState(name),`HN23: ${name} outside is not the held visit's`).toMatchObject({inside:false,owned:false});
  await expect.poll(async()=>(await taskTrail(live,group,from)).trail.some(([d,k])=>d==='ended'&&k==='death-recovery'),
    {timeout:120_000,message:'HN23: the death recovery finishes outside while the visit is held'}).toBe(true);
  expect((await view()).state.phase,'HN23: stay still holds the visit').toBe('held');
  // Switching to go back retires the visit with no Release once everyone is out.
  await act({action:'settings',afterRun:'go-back'});
  await expect.poll(async()=>(await view()).state.phase,{timeout:60_000}).toBe('idle');
  await expect.poll(async()=>(await taskTrail(live,group,0)).trail.some(([d,k,c])=>d==='ended'&&k==='cave'&&c==='visit-ended'),{timeout:30_000}).toBe(true);
  // Once the Hold is gone the party goes back to the task it had before the visit: the
  // visit's end leaves that task live, or waiting under a task above it. The priest's death
  // above starts a party escape and a death recovery, which hold the party first.
  {const read=(await live.tasks()).groups.find((g:any)=>g.id===group);
    expect([read.live.kind,...read.waiting.map((t:any)=>t.kind)],'the party goes back to its task after the run').toContain(taskBefore);
    expect(read.live.kind==='cave'||read.waiting.some((t:any)=>t.kind==='cave'),'no Cave task outlives the visit').toBe(false);}
  await expect.poll(async()=>(await live.tasks()).groups.find((g:any)=>g.id===group).holds.some((h:any)=>h.by==='cave-hold'),{timeout:30_000,message:'F58: the visit end lifts the hold'}).toBe(false);
  await info.attach('native-cave-tasks',{body:JSON.stringify(await taskTrail(live,group,0),null,1),contentType:'application/json'});
}

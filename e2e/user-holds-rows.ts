import {expect,type LiveGame} from './live-fixtures';
import type {TestInfo} from '@playwright/test';
import {waitForGameplay} from './network-clock';
import {W,P,fighters,peacefulWorld,seedBoss,endEvent,partyReady,hitBy,attach} from './event-death-helpers';
import {taskSeq,taskTrail} from './task-records';
import {headlessBound,holdTracktrix} from './call-budget-rows';

// The user holds. Both rows run as steps of live-movement-owner.spec.ts's
// table of rows that start from the default fixture: the Escape row needs a live event, as the UP-1 rows do,
// and M2 the same warrior and priest party.
//
// Pause is the hold of a headless character. Its row runs last in the table: it logs the priest
// out of its game client and starts it headless, so no later row has the priest's client.

const group=`party:${W}`;
const press=(live:LiveGame,path:string,shown:string)=>fetch(live.url+'/party-api'+path,{method:'POST',
  headers:{'Content-Type':'application/json',Origin:live.url},body:JSON.stringify({shown})});
const button=async(live:LiveGame)=>(await (await fetch(live.url+'/party-api/escape')).json()).button as string;
// The escape record travels only on GET /party-api/escape, not in the dashboard state.
const escapeOf=async(live:LiveGame)=>(await (await fetch(live.url+'/party-api/escape')).json()).escape as any;
const positions=(live:LiveGame)=>live.admin(`output=Object.fromEntries(${JSON.stringify(fighters)}.map(n=>{const p=get_player(n);
  return [n,{map:p.map,x:p.x,y:p.y,rip:!!p.rip}]}))`);
const groupRead=async(live:LiveGame)=>(await live.tasks()).groups.find((g:any)=>g.id===group);
// A temporary goo beside `name` with `hp`, and the priest planted at 30% of its HP.
const goo=async(live:LiveGame,name:string,hp=15000)=>live.admin(`output=(()=>{const p=get_player('${name}'),m=new_monster(p.in,{type:'goo',position:[p.x+30,p.y],radius:0,count:1},{temp:1});
  m.hp=m.max_hp=${hp};return String(m.id);})()`) as Promise<string>;
const injure=(live:LiveGame)=>live.admin(`output=(()=>{const p=get_player('${P}');p.hp=Math.floor(p.max_hp*.3);resend(p,'u+cid');return Date.now();})()`) as Promise<number>;
// A party Town moves the warrior, never the held priest. standAway puts both fighters at `x`
// beside each other on Main's row `y`, away from the town square where a Town lands, and returns
// their positions once both stand below `below`; the row then presses Town and waits, and
// townLeftHeld compares the positions.
async function standAway(live:LiveGame,[w,p]:[number,number],y:number,below:number){
  await live.admin(`output=(()=>{for(const [n,x] of [['${W}',${w}],['${P}',${p}]]){const p=get_player(n);transport_player_to(p,'main',[x,${y}]);resend(p,'u+cid');}return true;})()`);
  await expect.poll(async()=>{const at=await positions(live);return [W,P].every(n=>at[n].map==='main'&&at[n].y>below);},{timeout:30_000,message:'precondition: both stand away from the town square'}).toBe(true);
  return positions(live);
}
async function townLeftHeld(live:LiveGame,before:any,held:string){
  const after=await positions(live);
  expect(after[W].map!==before[W].map||Math.hypot(after[W].x-before[W].x,after[W].y-before[W].y)>=1,'precondition: the party Town moves the warrior').toBe(true);
  expect(after[P].map,`${held} takes no Town`).toBe(before[P].map);
  expect(Math.hypot(after[P].x-before[P].x,after[P].y-before[P].y),`${held} stays where it is`).toBeLessThan(1);
  return after;
}

// One button, presses that name the state they saw, the Resume lockout, and Resume
// rejoining the live event with the attendance task the escape suspended. The lockout is the tasks owner's saved setting, written through the settings route
// before the escape and read at the press, so the refusal names the written length, not the 5 s
// default.
const LOCKOUT_MS=8000;
const lockoutSetting=async(live:LiveGame)=>((await (await fetch(live.url+'/party-api/settings')).json()).settings as {field:string;value:unknown}[])
  .find(s=>s.field==='escapeResumeLockoutMs')!.value as number;
export async function e1Row(live:LiveGame,info:TestInfo){
  await partyReady(live);
  await peacefulWorld(live);
  const savedLockout=await lockoutSetting(live);
  await live.post('/settings',{changes:[{field:'escapeResumeLockoutMs',value:LOCKOUT_MS}]});
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  const boss=await seedBoss(live,'mrgreen'),selectedAt=Date.now();
  await live.post('/formation',{character:W,eventSelections:['mrgreen']});
  try{
    await expect.poll(async()=>(await Promise.all(fighters.map(n=>hitBy(live,n,boss,selectedAt)))).every(Boolean),
      {timeout:300_000,message:'Both fighters attend the event before the escape'}).toBe(true);
    expect(await button(live),'the button reads Escape before the press').toBe('escape');
    const from=await taskSeq(live,group);
    expect((await press(live,'/escape','escape')).status).toBe(200);
    const escapeId=(await escapeOf(live))?.id;
    // While Escaping a Resume press is refused and an Escape press starts nothing. The escape walks
    // every member home, so the first read after the press is Escaping; a run that reads anything
    // else fails here with the read, so the three checks never pass unrun.
    expect(await button(live),'the first read after the press is Escaping').toBe('escaping');
    expect((await press(live,'/escape/resume','resume')).status,'a Resume press while Escaping').toBe(409);
    expect((await press(live,'/escape','escape')).status,'an Escape press while Escaping').toBe(200);
    expect((await escapeOf(live))?.id,'an Escape press while Escaping starts nothing').toBe(escapeId);
    await expect.poll(()=>button(live),{timeout:300_000,intervals:[100],message:'The escape holds the party until Resume'}).toBe('resume');
    const heldAt=Date.now();
    const locked=await press(live,'/escape/resume','resume');
    expect(locked.status,'Resume inside the lockout').toBe(409);
    expect((await locked.json()).error,'the saved lockout decides the press').toBe(`Resume is locked for ${LOCKOUT_MS/1000} s after an escape`);
    expect((await press(live,'/escape','escape')).status,'an Escape press while Resume shows').toBe(409);
    expect((await escapeOf(live))?.id,'the refused Escape press started nothing').toBe(escapeId);
    const held=await groupRead(live);
    expect(held.holds.some((h:any)=>h.by==='escape'&&!h.member),'the escape is a user hold on the party').toBe(true);
    expect(held.status.label).toMatch(/needs your action$/);
    await expect.poll(async()=>(await press(live,'/escape/resume','resume')).status,{timeout:60_000,intervals:[1000],
      message:'Resume works once the lockout passed'}).toBe(200);
    for(const name of fighters)expect(await hitBy(live,name,boss,heldAt),`${name} stays off the event under the hold`).toBeNull();
    const resumedAt=Date.now();
    await expect.poll(async()=>(await Promise.all(fighters.map(n=>hitBy(live,n,boss,resumedAt)))).every(Boolean),
      {timeout:300_000,message:'Resume rejoins the live event'}).toBe(true);
    const trail=(await taskTrail(live,group,from)).trail;
    expect(trail.some(([d,k,by])=>d==='suspended'&&k==='event-attendance'&&by==='escape'),'the escape suspends the attendance').toBe(true);
    expect(trail.some(([d,k,c])=>d==='ended'&&k==='event-attendance'&&c==='event-over'),'the escape does not count as leaving the round').toBe(false);
    await attach(info,'e1-escape-resume',{trail,escapeId});
  }finally{
    await endEvent(live,'mrgreen');
    await live.post('/formation',{character:W,eventSelections:[]});
    await live.post('/settings',{changes:[{field:'escapeResumeLockoutMs',value:savedLockout}]});
  }
}

// The priest on Manual with Follows me, then its switches, then off.
export async function m2Row(live:LiveGame,info:TestInfo){
  await partyReady(live);
  await peacefulWorld(live);
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  const hitsOn=async(name:string,id:string,since:number)=>(await live.clients[name].events()).some((e:any)=>e.at>=since&&e.event==='hit'&&e.data?.hid===name&&String(e.data?.id)===id);
  // next_skill holds when each skill is ready again, so a cast moves it; a cooldown left from an
  // earlier cast reads as no change.
  const cooldowns=()=>live.clients[P].run(`Math.max(+(parent.next_skill.regen_hp||0),+(parent.next_skill.use_hp||0))`) as Promise<number>;
  const cooldown=(skill:string)=>live.clients[P].run(`+(parent.next_skill.${skill}||0)`) as Promise<number>;
  const recovered=async(since:number)=>await cooldowns()>since;
  const seeds:string[]=[];
  const despawn=(id:string)=>live.admin(`output=(()=>{const m=instances.main.monsters['${id}'];if(m)remove_monster(m,{method:'disappear',nospawn:true});return true;})()`);
  try{
    await live.post('/formation',{character:P,handControl:{on:true}});
    // F57: the hold starts in the toggle's own request (13.5, 2.2 `manual` row: a user command acts
    // at once), so the first read after the reply holds the priest.
    expect((await groupRead(live))?.holds.find((h:any)=>h.member===P)?.by,'F57: the toggle holds the priest in its own request').toBe('manual');
    await expect.poll(async()=>{const g=await groupRead(live);return [g?.holds.find((h:any)=>h.member===P)?.by,g?.live?.owner];},
      {timeout:30_000,message:'Manual holds the priest and the party follows it'}).toEqual(['manual',`follow-me:${P}`]);
    expect((await live.state()).handControlByCharacter[P],'the defaults: both switches on, Follows me').toEqual({on:true,usePotions:true,combat:true,party:'follows-me'});
    // A party Town moves the warrior, never the priest on Manual. The reset leaves the party
    // on the town square, where a Town lands, so both first stand away from it, beside Main's
    // respawn at (-87, 673), which walks to the square. The headless row's spot at y 450 does
    // not: from there the warrior found no route to the priest's walk below.
    const square=await positions(live);
    const before=await standAway(live,[-127,-47],673,600);
    await live.post('/town-party',{});
    await waitForGameplay(8000);
    const after=await townLeftHeld(live,before,'the priest on Manual');
    // The player walks the priest; the warrior follows it in formation. The priest goes to
    // the spot it went to from the square before the Town check stood it away.
    await live.admin(`output=(()=>{const p=get_player('${P}');transport_player_to(p,'main',[${square[P].x}+300,${square[P].y}+120]);resend(p,'u+cid');return true;})()`);
    const follow=()=>live.clients[W].run(`({follows:partyTasks.holds.followsManual(),should:partyTasks.holds.shouldFollowLeader(),occupied:!!__partyHooks.skills.allows({rank:'damage',occupied:true}),
      rejection:partyCombatState?.targetRejection,moving:character.moving,live:__partyMovement.live?.(),last:__partyMovement.last?.()})`);
    try{await expect.poll(async()=>{const at=await positions(live);return at[W].map===at[P].map&&Math.hypot(at[W].x-at[P].x,at[W].y-at[P].y)<=160;},
      {timeout:180_000,message:'Follows me keeps the warrior with the priest'}).toBe(true);}
    catch(error){await attach(info,'m2-follow-diagnostics',{follow:await follow(),positions:await positions(live)});throw error;}
    // An event does not take the party from the player.
    const boss=await seedBoss(live,'mrgreen'),eventAt=Date.now();
    await live.post('/formation',{character:W,eventSelections:['mrgreen']});
    await waitForGameplay(20_000);
    expect(await hitBy(live,W,boss,eventAt),'the warrior stays with the player, not the event').toBeNull();
    expect((await groupRead(live)).live.owner,'Follows me outranks the event').toBe(`follow-me:${P}`);
    await endEvent(live,'mrgreen');
    await live.post('/formation',{character:W,eventSelections:[]});
    await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{goo:999},monsterSearchRadius:300});
    // "Use potions" on: the priest recovers.
    const hurtAt=await injure(live);
    await expect.poll(()=>recovered(hurtAt),{timeout:30_000,message:'Use potions on: the priest recovers'}).toBe(true);
    // The party fights what is around the player: a goo beside the priest is the
    // warrior's grouped pull while the party follows the priest. M2b (decided 2026-11-01): with
    // Combat on, the priest on Manual attacks its own pick while it is in range.
    const firstAt=Date.now(),first=await goo(live,P);seeds.push(first);
    const fight=()=>live.clients[W].run(`({nomination:__partyNomination,intent:globalThis.__partyNavigationIntent,follows:partyTasks.holds.followsManual(),
      grouped:__partyGroupedCombat&&{phase:__partyGroupedCombat.phase,blockers:__partyGroupedCombat.blockers,target:__partyGroupedCombat.target,members:__partyGroupedCombat.members,
      committed:__partyGroupedCombat.committed,ready:__partyGroupedCombat.ready,recovering:__partyGroupedCombat.recovering}})`);
    try{await expect.poll(()=>hitsOn(W,first,firstAt),{timeout:60_000,message:'Follows me: the warrior fights the goo beside the priest'}).toBe(true);}
    catch(error){await attach(info,'m2-follow-fight-diagnostics',{fight:await fight(),group:await groupRead(live),positions:await positions(live)});throw error;}
    // M2b's goo lives long enough for the priest to pick it while the warrior fights it too.
    const ownAt=Date.now(),ownGoo=await goo(live,P,5_000_000);seeds.push(ownGoo);
    const own=()=>live.clients[P].run(`({combat:partyCombatState&&{selected:partyCombatState.selectedTarget,rejection:partyCombatState.targetRejection,error:partyCombatState.error},occupied:!!__partyHooks.skills.allows({rank:'damage',occupied:true}),hand:partyTasks.holds.handControl(),target:character.target,leader:partyHunting.farm.grouped()})`);
    try{await expect.poll(()=>hitsOn(P,ownGoo,ownAt),{timeout:60_000,message:'M2b: Combat on, the priest on Manual attacks its own pick in range'}).toBe(true);}
    catch(error){await attach(info,'m2b-diagnostics',{own:await own(),positions:await positions(live)});throw error;}
    // M2b: the target the player picked in the client comes first.
    await despawn(ownGoo);
    const pickedAt=Date.now(),picked=await goo(live,P,5_000_000);seeds.push(picked);
    await live.clients[P].run(`(()=>{const e=parent.entities['${picked}'];if(e)change_target(e);return !!e;})()`);
    await expect.poll(()=>hitsOn(P,picked,pickedAt),{timeout:60_000,message:"M2b: the player's client target comes first"}).toBe(true);
    await despawn(first);await despawn(picked);
    // Both off: no potion and no attack; M2a (decided 2026-11-01): the free regeneration goes on.
    await live.post('/formation',{character:P,handControl:{usePotions:false,combat:false}});
    await expect.poll(()=>live.clients[P].run('globalThis.partyTasks.holds.handControl()?.combat'),{timeout:15_000}).toBe(false);
    const quietAt=await injure(live),second=await goo(live,P),potion=await cooldown('use_hp');seeds.push(second);
    await expect.poll(async()=>await cooldown('regen_hp')>quietAt,{timeout:30_000,message:'M2a: Use potions off keeps regen_hp'}).toBe(true);
    expect(await cooldown('use_hp'),'Use potions off: no potion').toBe(potion);
    expect(await hitsOn(P,second,quietAt),'Combat off: no attack').toBe(false);
    // F57: the hold stands until the toggle, and the line says so.
    const standing=await groupRead(live);
    expect(standing.holds.some((h:any)=>h.member===P&&h.by==='manual'),'the hold never ends on its own').toBe(true);
    expect(standing.status.label).toBe(`${P}: On Manual - needs your action`);
    // Its own Escape press still walks the priest home.
    await live.post('/escape',{shown:'escape'});
    await expect.poll(async()=>(await escapeOf(live))?.stage,{timeout:300_000,message:'The escape the player pressed reaches home with the priest'}).toBe('home');
    expect((await escapeOf(live)).participants).toContain(P);
    await expect.poll(async()=>(await press(live,'/escape/resume','resume')).status,{timeout:60_000,intervals:[1000]}).toBe(200);
    // Off: the hold and Follows me end. F57: the hold ends in the toggle's own request.
    await live.post('/formation',{character:P,handControl:{on:false}});
    expect((await groupRead(live)).holds.some((h:any)=>h.member===P),'F57: the toggle lifts the hold in its own request').toBe(false);
    await expect.poll(async()=>{const g=await groupRead(live);return [g.holds.some((h:any)=>h.member===P),g.live.owner===`follow-me:${P}`];},
      {timeout:30_000,message:'The toggle lifts the hold'}).toEqual([false,false]);
    await attach(info,'m2-hand-control',{ring:(await groupRead(live)).ring.slice(-40)});
  }finally{
    await live.post('/formation',{character:P,handControl:{on:false,usePotions:true,combat:true,party:'follows-me'}});
    await live.post('/focus',{monsterFocus:[]});
    await live.admin(`output=(()=>{for(const id of ${JSON.stringify(seeds)}){const m=instances.main.monsters[id];if(m)remove_monster(m,{method:'disappear',nospawn:true});}
      const p=get_player('${P}');p.hp=p.max_hp;resend(p,'u+cid');return true;})()`);
  }
}

// The headless halves: the priest runs headless and is on Pause. The
// console moves it for no party walk; it runs no console code, so it drinks nothing,
// regenerates nothing and never attacks (user, 2026-10-29: "a pause means pause all code");
// and a Pause always carries on, so Follows me never applies to it.
export async function pauseHeadlessRow(live:LiveGame,info:TestInfo){
  await partyReady(live);
  await peacefulWorld(live);
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  await live.post('/steam/action',{character:P,action:'logout'});
  await expect.poll(async()=>!(await live.state()).activeSlots.some((slot:any)=>slot.character===P),{timeout:90_000,message:'The priest leaves its game client'}).toBe(true);
  await expect.poll(async()=>{const op=(await live.state()).steamSwitch;return !op||op.phase==='complete';},{timeout:90_000}).toBe(true);
  await live.post('/slots/1/spawn',{character:P});
  await expect.poll(async()=>{const c=(await live.state()).characters[P];return c?.runtime==='headless'&&Date.now()-c.seenAt<3000;},
    {timeout:90_000,message:'The priest runs headless'}).toBe(true);
  // CB16 headless: caracAL runs the Tracktrix read
  // too, so a Tracktrix planted in the headless priest's bag puts one tracker charge on its socket.
  const plantedAt=await live.admin('output=Date.now()') as number;
  await holdTracktrix(live,P,false);
  const trackerCharges=()=>live.admin(`output=get_player('${P}').socket.calls.filter(c=>c[1]==='tracker'&&+c[0]>=${plantedAt}).map(c=>[+c[0]-${plantedAt},c[2]])`) as Promise<[number,number][]>;
  let charges:[number,number][]=[];
  await expect.poll(async()=>(charges=await trackerCharges()).length,{timeout:15_000,intervals:[250],message:'CB16: the headless priest asks for its Tracktrix data'}).toBeGreaterThan(0);
  await attach(info,'cb16-headless',{plantedAt,charges});
  expect(charges,"CB16: one tracker charge of 50 on the headless priest's socket").toEqual([[charges[0]![0],50]]);
  // The budget bound on the headless priest before its Pause starts: its server sum stays within the budget's used that its status reports carry.
  await headlessBound(live,info,P,30_000);
  const seeds:string[]=[];
  try{
    await live.post('/formation',{character:P,handControl:{on:true,party:'follows-me'}});
    await expect.poll(async()=>(await groupRead(live))?.holds.find((h:any)=>h.member===P)?.by,{timeout:30_000,message:'Pause holds the headless priest'}).toBe('pause');
    // A Pause carries on, even when the player chose Follows me.
    const paused=await groupRead(live);
    expect(paused.holds.find((h:any)=>h.member===P).party,'a headless Pause carries on').toBe('carries-on');
    expect(paused.live.owner,'Follows me never applies to a headless Pause').not.toBe(`follow-me:${P}`);
    // A party Town moves the warrior, never the paused priest. The reset leaves the party
    // on the town square, where a Town lands, so both first stand away from it.
    const before=await standAway(live,[-40,40],450,400);
    await live.post('/town-party',{});
    await waitForGameplay(8000);
    const after=await townLeftHeld(live,before,'the paused priest');
    // Hurt, with a goo beside it, the paused priest drinks and regenerates nothing (the
    // server's `last.potion` moves for both) and never attacks (`last.attack`).
    const last=()=>live.admin(`output=(()=>{const p=get_player('${P}');return {potion:+(p.last.potion||0),attack:+(p.last.attack||0),hp:p.hp};})()`);
    seeds.push(await goo(live,P));
    const quiet=await last();
    await injure(live);
    await waitForGameplay(8000);
    const still=await last();
    expect(still.potion,'the paused priest drinks and regenerates nothing').toBe(quiet.potion);
    expect(still.attack,'the paused priest never attacks').toBe(quiet.attack);
    // Play: the toggle lifts the Pause, and the console's code runs for the priest again.
    await live.post('/formation',{character:P,handControl:{on:false}});
    await expect.poll(async()=>(await groupRead(live)).holds.some((h:any)=>h.member===P),{timeout:30_000,message:'The toggle lifts the Pause'}).toBe(false);
    await expect.poll(async()=>(await last()).potion,{timeout:30_000,message:'After the Pause the hurt priest recovers'}).toBeGreaterThan(quiet.potion);
    // SV27: `survival.respawn` refuses under Pause, so
    // a priest that dies paused stays dead past the server's respawn wait (`B.rip_time`), and
    // respawns once Play lifts the Pause. The death is Rime Shatter, as killNativeCharacter's, read
    // on the server since the headless priest has no page.
    await live.post('/formation',{character:P,handControl:{on:true,party:'follows-me'}});
    await expect.poll(async()=>(await groupRead(live))?.holds.find((h:any)=>h.member===P)?.by,{timeout:30_000,message:'SV27: Pause holds the headless priest again'}).toBe('pause');
    const ripWait=await live.admin('output=B.rip_time') as number;
    const death=await live.admin(`output=(()=>{const p=get_player('${P}'),w=get_player('${W}'),wHp=w.hp,m=new_monster(p.in,{type:'rimedjinn',position:[p.x,p.y],radius:0,count:1},{temp:1});
      try{for(let i=0;i<512&&!p.rip;i++)commence_attack(m,p,'rimeshatter');return {rip:!!p.rip,warrior:w.hp===wHp&&!w.rip};}finally{if(instances[m.in]?.monsters[m.id])remove_monster(m,{method:'disappear'});}})()`) as {rip:boolean;warrior:boolean};
    expect(death,'precondition: the paused priest dies and the warrior takes no hit').toEqual({rip:true,warrior:true});
    await waitForGameplay(2*ripWait);
    const dead=await live.admin(`output=!!get_player('${P}').rip`);
    await live.post('/formation',{character:P,handControl:{on:false}});
    expect(dead,'SV27: the paused priest stays dead past the respawn wait').toBe(true);
    await expect.poll(()=>live.admin(`output=!get_player('${P}').rip`),{timeout:2*ripWait+30_000,message:'SV27: after Play the priest respawns'}).toBe(true);
    await attach(info,'m2-pause-headless',{ring:(await groupRead(live)).ring.slice(-30),before,after,ripWait});
  }finally{
    await live.post('/formation',{character:P,handControl:{on:false,usePotions:true,combat:true,party:'follows-me'}});
    await live.admin(`output=(()=>{for(const id of ${JSON.stringify(seeds)}){const m=instances.main.monsters[id];if(m)remove_monster(m,{method:'disappear',nospawn:true});}
      const p=get_player('${P}');if(p){p.hp=p.max_hp;resend(p,'u+cid');}return true;})()`);
  }
}

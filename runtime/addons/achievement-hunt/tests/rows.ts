import {expect,trackerReplyAge,type LiveGame} from '../../../../e2e/live-fixtures';
import {holdTracktrix} from '../../../../e2e/call-budget-rows';
import type {Page,TestInfo} from '@playwright/test';
import type {App} from '../../../../e2e/fixtures';
import {fighters,warrior as W,location,party} from '../../../../e2e/game/hunt-lifecycle';
import {contains,distance} from '../../../hunting/zones';
import {CALL_WINDOW_MS,READ_PICKS} from '../../../characters/call-budget-limits';
import {taskTrail} from '../../../../e2e/task-records';

// "Achievement Hunt in play": the add-on switched on and its target mode entry chosen over the
// API (POST /party-api/farming-mode: the card's mode menu is the status owner's), then the party
// plays it with no one stepping in. It reaches the owners only through its registration: its
// target mode entry (`target.mode`, `target.settings`), which names the group's task, its zone
// and walk hooks, its status report, its setting writes through the ports the coordinator hands
// it, and its store. The row reads each owner's answer and never calls the add-on. Stand-ins:
// (targeting's avoided-boss and pull rules; goo's ground has no boss, so nothing in the row waits
// on them). Its pass marks are the row's.
const NAME='achievement-hunt', WINDOW_MS=120_000;
const store=(state:any)=>(state.farmingProfiles?.[W]?.addonFarming??state.addonFarming)?.[NAME];
const slots=(state:any)=>{const p=state.farmingProfiles?.[W]??state;return {combatMode:p.combatMode,targetMode:p.targetMode};};
// Each fighter's deaths with the cause its CODE recorded, and its journeys with their planned
// walking distance, so the time limit is the route at walk speed. Each native `move` keeps
// its point, the character's place and the calling frames, so a fighter that walks off with no
// journey names the code that sent it (13.5b: on an earlier build the priest walked 250 north of
// the spawn box between journeys).
const probe=`(()=>{if(globalThis.__e2eAchievement)return true;const s=globalThis.__e2eAchievement={deaths:[],journeys:{},segments:[],moves:[]};let dead=!!character.rip;
  const sent=globalThis.move;if(typeof sent==='function')globalThis.move=function(x,y){
    s.moves.push({at:Date.now(),to:[Math.round(x),Math.round(y)],from:[Math.round(character.real_x),Math.round(character.real_y)],
      by:String(new Error().stack||'').split(String.fromCharCode(10)).slice(2,9).map(l=>{l=l.trim().replace(/^at /,'');const cut=Math.max(l.lastIndexOf('/'),l.lastIndexOf(String.fromCharCode(92)));return cut<0?l:l.slice(0,l.indexOf('(')+1)+l.slice(cut+1);}).join(' < ')});
    if(s.moves.length>400)s.moves.shift();return sent.apply(this,arguments);};
  // The walk's phases as the executor reports them, merged into segments, so an idle stretch
  // inside a walk names what the character stood in.
  setInterval(()=>{const r=__partyMovement.report(),p=r?.progress,key=r?[p?.phase,__partyMovement.live()?.kind??null,!!character.moving].join('|'):'none',last=s.segments.at(-1);
    if(last&&last.key===key){last.ms=Date.now()-last.at;return;}s.segments.push({key,at:Date.now(),ms:0,x:Math.round(character.real_x),y:Math.round(character.real_y),step:p?.step??null,remaining:r?.remaining??null});
    if(s.segments.length>600)s.segments.shift();},100);
  setInterval(()=>{const l=__partyMovement.last();if(l?.id&&!s.journeys[l.id])s.journeys[l.id]={endAt:Date.now(),elapsedMs:l.elapsedMs,plannerMs:l.plannerMs,walking:Number(l.walkingDistance)||0,idleMs:Number(l.progress?.durations?.idle)||0,end:l.end};
    if(character.rip&&!dead)s.deaths.push({at:Date.now(),cause:globalThis.__partyLastDeathInfo?.message??null});dead=!!character.rip;},250);return true;})()`;
// The journeys a fighter started between two of its own clock readings, with their planned walk.
const harvest=(from=0,to=Number.MAX_SAFE_INTEGER)=>`(()=>{const s=globalThis.__e2eAchievement,inside=r=>r.at>=${from}&&r.at<=${to};
  const records=__partyMovement.records().filter(inside);
  const started=records.filter(r=>r.decision==='started').map(r=>({at:r.at,id:r.journeyId,kind:r.kind,owner:r.owner,...s.journeys[r.journeyId]}));
  // The time each walk lent to fights on the way: from each pause to its resume.
  let pausedMs=0,from=null;for(const r of records){if(r.decision==='paused'&&from===null)from=r.at;if(r.decision==='resumed'&&from!==null){pausedMs+=r.at-from;from=null;}}
  const segments=s.segments.filter(inside);
  return {deaths:s.deaths,started,pausedMs,segments,moves:s.moves.filter(inside),speed:character.speed,now:Date.now(),live:__partyMovement.live()?.owner??null};})()`;
// The server's own kill count of a monster type for each fighter (the tracker's source).
const kills=(live:LiveGame,type:string)=>live.admin(`output=Object.fromEntries(${JSON.stringify(fighters)}.map(n=>{const s=get_player(n).p.stats||{};
  return [n,(Number(s.monsters?.[${JSON.stringify(type)}])||0)+(Number(s.monsters_diff?.[${JSON.stringify(type)}])||0)]}))`) as Promise<Record<string,number>>;
const sum=(a:Record<string,number>)=>Object.values(a).reduce((x,y)=>x+y,0);

async function achievementHuntRow(live:LiveGame,info:TestInfo){
  const result:any={};
  try{
    // From the call budget's step 1 on, the warrior holds a Tracktrix, the add-on's progress
    // source.
    await holdTracktrix(live,W);
    await party(live);
    for(const name of fighters)await live.clients[name].run(probe);
    // The mode the party is in before Achievements: Farming, with a combat mode other than the
    // add-on's start (Auto), so a combat mode change at the end shows.
    await live.post('/farming-mode',{character:W,combatMode:'default',targetMode:'farming'});
    const before=slots(await live.state());
    expect(before).toEqual({combatMode:'default',targetMode:'farming'});
    const area=await location(live,'goo');
    await live.post('/addons',{name:NAME,enabled:true});
    await live.post('/addon-farming',{name:NAME,character:W,settings:{monsters:['goo']}});
    const switchedAt=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,await live.clients[n].run('Date.now()') as number])));
    const switchedAtTest=Date.now();
    await live.post('/farming-mode',{character:W,targetMode:'achievements'});
    // The add-on picks its target: goo's next milestone, the only monster chosen. A miss names the
    // add-on's own message and the group's live task, the readings its trace needs (the old miss kept
    // neither).
    await expect.poll(async()=>store(await live.state())?.achievementTarget?.id,{timeout:60_000,message:'Achievement Hunt picks its target'}).toBe('goo')
      .catch(async error=>{const state=await live.state();throw Error(`${String((error as Error).message)}; message: ${JSON.stringify(store(state)?.achievementMessage)}; task: ${JSON.stringify((state as any).tasks?.live??(state as any).groupTasks??null)}`);});
    result.target=store(await live.state()).achievementTarget;
    expect(slots(await live.state()),'Achievements keeps the combat mode').toEqual({combatMode:'default',targetMode:'achievements'});
    // The add-on's task is the group's live task, and each member's CODE holds it.
    const group=`party:${W}`,seq=Math.max(0,...((await live.tasks()).groups.find((g:any)=>g.id===group)?.ring??[]).map((e:any)=>e.seq));
    await expect.poll(async()=>{const g=(await live.tasks()).groups.find((x:any)=>x.id===group);return g&&[g.live.kind,g.live.owner];},
      {timeout:30_000,message:"The add-on's task is the group's live task"}).toEqual(['farming',`farm:achievements:${W}`]);
    await expect.poll(async()=>Promise.all(fighters.map(n=>live.clients[n].run('(()=>{const t=globalThis.partyTasks.assignment.memberTask();return t&&t.task?t.task.owner:null;})()'))),
      {timeout:30_000,message:"Each member's assignment is the add-on's task"}).toEqual(fighters.map(()=>`farm:achievements:${W}`));
    // The walk readings since the switch, taken on the pass and on the miss path alike.
    const readReach=async()=>{
      const state=await live.state(),interval=Math.max(...fighters.map(n=>Number(state.characters[n]?.reportIntervalMs)||0));
      result.reach=Object.fromEntries(await Promise.all(fighters.map(async n=>{const h=await live.clients[n].run(harvest(switchedAt[n]));
        const walking=h.started.reduce((t:number,j:any)=>t+(j.walking||0),0),planner=h.started.reduce((t:number,j:any)=>t+(Number(j.plannerMs)||0),0),
          idle=h.started.reduce((t:number,j:any)=>t+(j.idleMs||0),0);
        return [n,{pausedMs:h.pausedMs,idleMs:idle,firstWalkAfterMs:h.started[0]?h.started[0].at-switchedAt[n]!:null,routeMs:Math.round(walking/h.speed*1000),plannerMs:Math.round(planner),
          walking:Math.round(walking),speed:h.speed,journeys:h.started.map((j:any)=>[j.at-switchedAt[n]!,j.kind,String(j.owner??'').split(':')[0],Math.round(j.walking||0),j.elapsedMs??null,j.end??null]),
          segments:h.segments.map((g:any)=>[g.at-switchedAt[n]!,g.ms,g.key,g.x,g.y,g.step,g.remaining]),
          moves:h.moves.map((m:any)=>[m.at-switchedAt[n]!,m.from,m.to,m.by])}];})));
      // The leader's navigation log since the switch (13.5a item 1): the convoy's history and the
      // farming engagement with its position age, so a second group walk names whether the
      // engagement found the party arrived (hunting/coordinator/farm.ts `arrivedForCombat`) or defended
      // and regrouped (movement/coordinator/defense.ts `finishDefense`).
      result.navigation=((state.combatLogs?.[W]||[]) as any[]).filter(l=>l.type==='navigation')
        .map(l=>[l.at-switchedAtTest,l.message,l.details&&{phase:l.details.phase,epoch:l.details.epoch,purpose:l.details.purpose,positionAgeMs:l.details.positionAgeMs,x:l.details.x,y:l.details.y}]).slice(-30);
      result.settleMs=2*interval;
    };
    // The party reaches the target's spawn; the time limit is checked at the end. Each poll keeps
    // both fighters' server positions and their distance to the spawn box, so a miss names where
    // each one stood (13.5a's miss kept none).
    result.positions=[];
    await expect.poll(async()=>{const players=await live.admin(`output=${JSON.stringify(fighters)}.map(n=>{const p=get_player(n);return {name:n,map:p.map,x:p.x,y:p.y,rip:!!p.rip}})`);
      result.positions.push([Date.now()-switchedAtTest,...players.map((p:any)=>[p.name,p.map,Math.round(p.x),Math.round(p.y),p.rip,p.map===area.map?Math.round(distance(area,p)):null])]);
      return players.every((p:any)=>!p.rip&&contains(area,p,150,500));},{timeout:300_000,intervals:[1000],message:'Both fighters reach the goo spawn'}).toBe(true)
      .catch(async error=>{await readReach().catch(e=>{result.reachError=String(e);});
        console.log('ACHIEVEMENT-HUNT-MISS '+JSON.stringify({area:{map:area.map,x:area.x,y:area.y},positions:result.positions,navigation:result.navigation,reach:result.reach,reachError:result.reachError}));
        throw error;});
    const reachedMs=Date.now()-switchedAtTest;
    await readReach();
    // The party walks as one group at its slowest member's pace.
    const pace=Math.min(...fighters.map(n=>result.reach[n].speed));
    result.reachMs=reachedMs;
    result.limitMs=Math.round(Math.max(...fighters.map(n=>result.reach[n].walking))/pace*1000+result.settleMs+1000);
    // The party kills the target over one window, with the add-on still holding the group.
    const start=await kills(live,'goo');
    const clientStart=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,await live.clients[n].run('Date.now()') as number])));
    const windowStart=Date.now();
    // Every 5 s, the server's own goo count and the add-on's progress in the warrior's status report
    // (`monsterAchievementKills.goo`), so the progress can be read against the server's count of 30
    // s plus two windows earlier.
    const progress:{at:number;server:number;status:number|null}[]=[];
    await expect.poll(async()=>{
      const [count,state]=await Promise.all([kills(live,'goo'),live.state()]);
      progress.push({at:Date.now(),server:count[W]!,status:Number.isFinite(state.characters[W]?.monsterAchievementKills?.goo)?state.characters[W].monsterAchievementKills.goo:null});
      return Date.now()-windowStart;
    },{timeout:WINDOW_MS+30_000,intervals:[5_000]}).toBeGreaterThan(WINDOW_MS);
    const end=await kills(live,'goo');
    const clientEnd=await live.clients[W].run('Date.now()') as number,margin=await live.clients[W].run('globalThis.__partyCalls?.view?.().margin ?? null') as number|null;
    expect(margin,"the warrior's call budget view carries its margin").not.toBeNull();
    const bound=READ_PICKS.callTrackerRefreshMs+2*(CALL_WINDOW_MS+margin!);
    result.tracker={bound,age:await trackerReplyAge(live,W,clientStart[W]!,clientEnd),
      behind:progress.filter(p=>p.status===null||p.status<Math.max(0,...progress.filter(q=>q.at<=p.at-bound).map(q=>q.server))),progress};
    console.log('ACHIEVEMENT-HUNT-TRACKER '+JSON.stringify({bound,age:result.tracker.age,behind:result.tracker.behind.length,samples:progress.length}));
    // Each fighter's killing blows, from its own hit packets, and the server's kill credit, which
    // shares a party kill between the members.
    const blows=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,(await live.clients[n].events()).filter((e:any)=>e.at>=clientStart[n]!&&e.event==='hit'&&e.data?.hid===n&&(e.data.kill||e.data.dead)).length])));
    result.window={ms:Date.now()-windowStart,blows,credit:Object.fromEntries(fighters.map(n=>[n,Math.round((end[n]!-start[n]!)*10)/10]))};
    expect(sum(end)-sum(start),'goo kills over the window').toBeGreaterThan(0);
    // The warrior's tracker reply is at most 30 s plus two windows old over the goo window, and the
    // add-on's progress never trails the server's count of that long before.
    expect(result.tracker.age.largest,'the tracker reply age over the goo window').toBeLessThanOrEqual(bound);
    expect(result.tracker.behind,'the add-on progress behind the server count of one bound earlier').toEqual([]);
    expect(store(await live.state())?.achievementTarget?.id,'the target holds through the window').toBe('goo');
    expect((await live.tasks()).groups.find((g:any)=>g.id===group)?.live?.owner).toBe(`farm:achievements:${W}`);
    // addon.off: the switch ends the add-on's task and any walk it holds, and the party goes back
    // to Farming in the combat mode it had; the add-on lets go of its target.
    await live.post('/addons',{name:NAME,enabled:false});
    await expect.poll(async()=>(await live.tasks()).groups.find((g:any)=>g.id===group)?.live?.owner,
      {timeout:30_000,message:"Switching it off ends the add-on's task"}).toBe(`farm:farming:${W}`);
    const trail=await taskTrail(live,group,seq);
    result.trail=trail;
    const ring=(await live.tasks()).groups.find((g:any)=>g.id===group).ring;
    expect(ring.filter((e:any)=>e.seq>seq&&e.decision==='ended'&&e.owner===`farm:achievements:${W}`).map((e:any)=>e.code),'the task ends once').toEqual(['replaced:farming']);
    for(const name of fighters)expect(String((await live.clients[name].run(harvest())).live??''),`${name} keeps no walk of the add-on`).not.toContain(NAME);
    await expect.poll(async()=>slots(await live.state()),{timeout:30_000,message:'The party goes back to the mode it was in'}).toEqual(before);
    expect(store(await live.state())?.achievementTarget??null,'the add-on lets go of its target').toBeNull();
    // Every death has a cause.
    const fighterDeaths=await Promise.all(fighters.map(async n=>({name:n,deaths:(await live.clients[n].run(harvest())).deaths})));
    result.deaths=fighterDeaths;
    for(const {name,deaths} of fighterDeaths)for(const d of deaths)expect(d.cause,`${name}'s death at ${d.at} names its cause`).toBeTruthy();
    console.log('ACHIEVEMENT-HUNT-PLAY '+JSON.stringify({reachMs:result.reachMs,limitMs:result.limitMs,navigation:result.navigation,reach:result.reach,settleMs:result.settleMs,window:result.window,deaths:result.deaths}));
    // The party reaches the spawn within its route at the slowest member's walk speed, the
    // add-on's settle (README F: a switch settles once every member has reported since it, two
    // report intervals) and the arrival poll's 1 s interval. The walk departs at once, so the
    // limit holds no departure allowance. Checked last, so a slow arrival still runs the
    // switch-off checks.
    expect(result.reachMs,'time to reach the target').toBeLessThanOrEqual(result.limitMs);
  }finally{
    // A failed row leaves the switch off for the next row; the reset puts back the slots. A failed
    // switch-off joins the attachment, so the next row's start reads why the add-on still runs.
    await live.post('/addons',{name:NAME,enabled:false}).catch(e=>{result.switchOffError=String(e);});
    await info.attach('achievement-hunt-play',{body:JSON.stringify(result,null,1),contentType:'application/json'});
  }
}

// The add-on's switch, as the player turns it on and off (POST /party-api/addons).
const addon=(page:Page,url:string,name:string,enabled:boolean)=>page.request.post(url+'/party-api/addons',{data:{name,enabled},headers:{Origin:url}});
// The fork's console journey on the add-on. The fixture has no party leader, so W and P are
// independent farming scopes; W runs Achievement Hunt and P stays untouched. The add-on runs through the API
// because the card's mode menu that lists an add-on's target mode is the status owner's and not
// built, so the mode is chosen and the add-on's task read over the API; the menu-click checks
// moved to the status owner's failure list.
async function consoleJourney({ page, app }: { page: Page; app: App }, testInfo: TestInfo) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  const post = (endpoint: string, data: unknown) => page.request.post(app.url + '/party-api' + endpoint, { data, headers: { Origin: app.url } });
  const store = (state: any, name: string) => state.farmingProfiles?.[name]?.addonFarming?.['achievement-hunt'];
  const tasksOf = async () => (await (await fetch(app.url + '/party-api/tasks')).json()).groups.find((g: any) => g.members.includes('W'));
  await page.goto(app.url);
  // Off, the mode does not exist.
  expect((await post('/farming-mode', { character: 'W', mode: 'achievements' })).ok()).toBe(false);
  expect((await addon(page, app.url, 'achievement-hunt', true)).ok()).toBe(true);
  // The add-on's entry joins row 2 after its switch turns on, with its declared data.
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'W', exact: true }) });
  const targetRow = card.getByRole('group', { name: 'Target mode' });
  await page.reload();
  await card.locator('button[aria-expanded]').filter({ hasText: 'Farming settings' }).click();
  await expect(targetRow.getByRole('button')).toHaveText(['Farming', 'Hunt', 'Achievements']);
  await expect(targetRow.getByRole('button', { name: 'Achievements', exact: true })).toHaveClass(/border-rose-600 bg-rose-950/);
  // Nothing selected: the coordinator refuses the mode with the add-on's reason.
  const refused = await post('/farming-mode', { character: 'W', mode: 'achievements' });
  expect(refused.status()).toBe(409);
  expect(JSON.stringify(await refused.json())).toContain('choose at least one monster for Achievement Hunt');
  expect((await post('/addon-farming', { name: 'achievement-hunt', character: 'W', settings: { monsters: ['goo'] } })).status()).toBe(200);
  await expect.poll(async () => store(await app.state(), 'W')?.achievementHunt?.monsters).toEqual(['goo']);
  // The boss toggle shares the minutes' line: on by default with the minutes shown; off saves to the
  // scope store and hides the minutes (user, 2026-11-09).
  const pBefore = store(await app.state(), 'P') ?? null;
  await card.getByRole('button', { name: 'Farming settings', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Farming settings · W', exact: true }).getByRole('region', { name: 'Achievement Hunt settings' });
  const leave = panel.getByRole('checkbox', { name: 'Leave the target when a boss attacks' });
  const minutes = panel.getByRole('spinbutton', { name: 'Minutes before checking a boss-held target again' });
  await expect(leave).toBeChecked();
  await expect(minutes).toHaveValue('10');
  // A number outside its range is refused in words with the range settings.ts declares, and nothing
  // is saved.
  const deaths = panel.getByRole('spinbutton', { name: 'Achievement Hunt deaths before blacklisting' });
  await deaths.fill('0');
  await deaths.blur();
  await expect(panel.getByRole('alert')).toHaveText('The death threshold must be a whole number from 1 to 100.');
  await minutes.fill('121');
  await minutes.blur();
  await expect(panel.getByRole('alert')).toHaveText('The boss recheck time must be a whole number of minutes from 1 to 120.');
  expect(store(await app.state(), 'W')?.achievementHunt).toMatchObject({ deathThreshold: 6, bossRecheckMinutes: 10 });
  await minutes.fill('10');
  // Up to here selects the regular monsters through that row and keeps the special picks.
  await panel.getByRole('button', { name: /^Monsters \(/ }).click();
  const list = page.getByRole('dialog', { name: 'Achievement Hunt monsters' });
  const specialPicks = () => list.getByRole('region', { name: 'Special monsters' }).getByRole('checkbox', { checked: true }).count();
  const specials = await specialPicks();
  await list.getByRole('region', { name: 'Regular monsters' }).getByRole('button', { name: 'Up to here' }).first().click();
  await expect.poll(async () => store(await app.state(), 'W')?.achievementHunt?.monsters?.length).toBe(1 + specials);
  expect(await specialPicks()).toBe(specials);
  await page.keyboard.press('Escape');
  expect((await post('/addon-farming', { name: 'achievement-hunt', character: 'W', settings: { monsters: ['goo'] } })).status()).toBe(200);
  await expect.poll(async () => store(await app.state(), 'W')?.achievementHunt?.monsters).toEqual(['goo']);
  // A blacklisted monster shows in the section, and Clear all empties the blacklist.
  expect((await post('/addon-farming', { name: 'achievement-hunt', character: 'W', blacklist: { action: 'add', monsterId: 'goo' } })).status()).toBe(200);
  await panel.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect.poll(async () => store(await app.state(), 'W')?.achievementBlacklist).toEqual({});
  await leave.click();
  await expect.poll(async () => store(await app.state(), 'W')?.achievementHunt?.leaveOnBossAttack).toBe(false);
  await expect(leave).not.toBeChecked();
  await expect(minutes).toHaveCount(0);
  // W's save left P's scope store as it was (the fixture has no leader, so P is its own scope).
  expect(store(await app.state(), 'P') ?? null).toEqual(pBefore);
  await page.keyboard.press('Escape');
  expect((await post('/farming-mode', { character: 'W', mode: 'achievements' })).status()).toBe(200);
  // The coordinator picks Goo's first milestone and keeps the mode; P's scope is untouched.
  await expect.poll(async () => store(await app.state(), 'W')?.achievementTarget?.id).toBe('goo');
  const farming = await app.state();
  expect(farming.farmingProfiles.W).toMatchObject({ targetMode: 'achievements', combatMode: 'auto', farmingPolicy: 'achievements', monsterFocus: ['goo'] });
  expect(farming.farmingProfiles.P.targetMode).not.toBe('achievements');
  expect(store(farming, 'P')?.achievementTarget ?? null).toBeNull();
  // Achievements is a target mode entry, so its task is `farming`, named by the entry, and the
  // group's status line carries it.
  await expect.poll(async () => { const g = await tasksOf(); return g && [g.live.kind, g.live.owner]; }, { timeout: 30_000 }).toEqual(['farming', 'farm:achievements:W']);
  const status = /^Farming Goo: 0 \/ [\d,]+ kills \(step 1\)$/;
  await expect.poll(async () => store(await app.state(), 'W')?.achievementMessage).toMatch(status);
  // The status block shows the declared title and the store's field, in the entry's colour.
  const block = card.locator('div').filter({ has: page.getByText('Achievement Hunt status', { exact: true }) }).last();
  await expect(block.locator('p').last()).toHaveText(status);
  await expect(block).toHaveClass(/border-rose-900\/70/);
  expect((await tasksOf()).status?.phase ?? '').toMatch(/^farming/);
  await app.restartCoordinator();
  const restored = await app.state();
  expect(restored.farmingProfiles.W.targetMode).toBe('achievements');
  expect(store(restored, 'W')).toMatchObject({ achievementHunt: { monsters: ['goo'], leaveOnBossAttack: false }, achievementTarget: { id: 'goo' } });
  // A target mode change ends the old entry's task `replaced:farming`.
  expect((await post('/farming-mode', { character: 'W', mode: 'default' })).status()).toBe(200);
  // Choosing Default ends the entry's task and the add-on lets go of its target.
  await expect.poll(async () => store(await app.state(), 'W')?.achievementTarget ?? null, { timeout: 30_000 }).toBeNull();
  await expect.poll(async () => (await tasksOf())?.ring.some((e: any) => e.decision === 'ended' && e.owner === 'farm:achievements:W' && e.code === 'replaced:farming'),
    { timeout: 30_000 }).toBe(true);
  expect(store(await app.state(), 'W')?.achievementHunt?.monsters).toEqual(['goo']);
  // After Default no add-on mode stays pressed; row 2 presses Farming. A press of the add-on's
  // button on the card sends `targetMode` alone.
  await page.reload();
  await card.locator('button[aria-expanded]').filter({ hasText: 'Farming settings' }).click();
  await expect.poll(() => targetRow.locator('[aria-pressed="true"]').allTextContents()).toEqual(['Farming']);
  const press = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/party-api/farming-mode'));
  await targetRow.getByRole('button', { name: 'Achievements', exact: true }).click();
  expect((await press).postDataJSON()).toEqual({ targetMode: 'achievements', character: 'W' });
  await expect.poll(async () => (await app.state()).farmingProfiles.W.targetMode).toBe('achievements');
  await expect.poll(() => targetRow.locator('[aria-pressed="true"]').allTextContents()).toEqual(['Achievements']);
  expect((await post('/farming-mode', { character: 'W', mode: 'default' })).status()).toBe(200);
  await expect.poll(() => targetRow.locator('[aria-pressed="true"]').allTextContents()).toEqual(['Farming']);
  // Achievement Hunt's end, here a monster focus changed by hand, switches the target to Farming,
  // leaves the Scatter the player chose and writes one line naming the add-on.
  expect((await post('/farming-mode', { character: 'W', combatMode: 'scatter' })).status()).toBe(200);
  expect((await post('/farming-mode', { character: 'W', mode: 'achievements' })).status()).toBe(200);
  await expect.poll(async () => store(await app.state(), 'W')?.achievementTarget?.id, { timeout: 30_000 }).toBe('goo');
  const linesBefore = (await app.state()).settingsChanges.length;
  expect((await post('/focus', { character: 'W', monsterFocus: ['bee'] })).status()).toBe(200);
  await expect.poll(async () => (await app.state()).farmingProfiles.W.targetMode, { timeout: 30_000, message: 'Achievement Hunt ends to Farming' }).toBe('farming');
  const ended = await app.state();
  expect(ended.farmingProfiles.W.combatMode, 'the combat mode stays Scatter').toBe('scatter');
  expect(ended.settingsChanges.slice(linesBefore).filter((l: any) => l.field === 'targetMode' || l.field === 'combatMode').map((l: any) => [l.field, l.character, l.old, l.new, l.by]))
    .toEqual([['targetMode', 'W', 'achievements', 'farming', 'addon:achievement-hunt']]);
  // addon.off: with the entry live again, switching the add-on off ends its task.
  expect((await post('/farming-mode', { character: 'W', mode: 'achievements' })).status()).toBe(200);
  await expect.poll(async () => (await tasksOf())?.live?.owner, { timeout: 30_000 }).toBe('farm:achievements:W');
  // A follower's section gets no save: with W leading and P following, P's section is read only.
  expect((await post('/settings', { changes: [{ field: 'leader', value: 'W' }, { field: 'followers', character: 'P', value: true }] })).status()).toBe(200);
  const follower = page.locator('article').filter({ has: page.getByRole('heading', { name: 'P', exact: true }) });
  await follower.getByRole('button', { name: 'Farming settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Farming settings · W', exact: true }).getByRole('region', { name: 'Achievement Hunt settings' })
    .getByRole('checkbox', { name: 'Leave the target when a boss attacks' })).toBeDisabled();
  await page.keyboard.press('Escape');
  expect((await post('/settings', { changes: [{ field: 'leader', value: null }, { field: 'followers', character: 'P', value: false }] })).status()).toBe(200);
  expect((await addon(page, app.url, 'achievement-hunt', false)).ok()).toBe(true);
  await expect.poll(async () => (await tasksOf())?.live?.owner, { timeout: 30_000 }).not.toBe('farm:achievements:W');
  // The entry leaves row 2 after the switch-off.
  await page.reload();
  await card.locator('button[aria-expanded]').filter({ hasText: 'Farming settings' }).click();
  await expect(targetRow.getByRole('button')).toHaveText(['Farming', 'Hunt']);
  expect(errors, 'The browser must not crash during Achievement Hunt controls').toEqual([]);
  await testInfo.attach('achievement-hunt-state', { body: Buffer.from(JSON.stringify({ farming, restored }, null, 2)), contentType: 'application/json' });
}

// This add-on's rows of the shared tables its tests join: in the live movement table, and the
// console journey in the console fixture's add-on table (e2e/addon-console.case.ts). The
// generated.build/addons/tests.ts lists them by table, so the shared specs name no add-on.
export const rows={
  'movement owner: the rows that start from the default fixture':[
    ['Achievement Hunt in play: the add-on picks goo, its task holds the party to the kills, and its switch-off returns the mode',achievementHuntRow]],
  'add-on console journeys':[
    ['Achievement Hunt adds its farming mode, refuses it with no monster chosen, and keeps its choices in the scope store',consoleJourney]],
} as const;

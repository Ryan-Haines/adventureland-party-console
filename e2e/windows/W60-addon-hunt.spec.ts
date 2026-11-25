import {expect, trackerReplyAge, type LiveGame} from '../live-fixtures';
import type {TestInfo} from '@playwright/test';
import {liveWindow, type LiveWorld} from '../windows';
import {holdTracktrix} from '../call-budget-rows';
import {fighters, warrior as W, priest as P, location, party, quests, start} from '../game/hunt-lifecycle';
import {addonSwitches as switches, type Heard} from '../fixtures/hunting-hooks-addon';
import {distance} from '../../runtime/hunting/zones';
import {standsAt} from '../../runtime/hunting/rules';
import {CALL_WINDOW_MS, READ_PICKS} from '../../runtime/characters/call-budget-limits';
import {taskTrail} from '../task-records';

// W60 Add-on driven Hunt (test-windows DESIGN.md 2.2 W60). One play with the hunting-hooks fixture
// add-on registered and switched on throughout: the warrior holds a Tracktrix; the party, in
// Farming with the combat mode Default, switches to Achievement Hunt; the add-on picks goo, the
// party walks to the goo spawn and farms it for one 120 s window; the add-on is switched off and
// the mode returns; the player sets the combat mode Auto and picks goo, and Auto learns goo's
// scatter; the warrior gets a planted bee quest and the priest a goo quest, the hooks add-on
// refuses the bee quest, the Hunt takes the goo quest and the party turns in at Daisy.
// T38 runs first because its walk to the goo spawn is one of its reads (the reach time against the
// route), and the party stands in town only at the window's start. H54's Auto farm runs after it:
// T38 starts from the combat mode Default, so its switch-off shows a combat mode change, and Auto
// is the mode H54's scatter needs. H54 hears the focus change to goo from the play's start, so
// either the add-on's goo pick or the player's goo pick serves it.
// H54's relocation step (live-hunting-hooks.spec.ts:76-84) leaves the play: it asserted a count of
// at least 0 and passed with no relocation (DESIGN.md 4.3 H54).
// Failure modes: T38, the add-on picks no target, its task is not the live task, the walk is slower
// than its route, the tracker reply ages past its bound, or the switch-off leaves its task, walk,
// mode or target behind; H54, a hunting notice or read is not heard, Auto does not scatter, or the
// Hunt takes the quest the add-on refuses or does not turn in.
// Each check's assertions are its old test's, with their messages, so the coverage ledger matches
// them. A failed step records its message under its check and the play goes on.
// Every old spec this window cites is at 21fe30a2b.
const failed: Record<string, string> = {}, reads: Record<string, any> = {};
const step = async (id: string, run: () => Promise<unknown>) => {
  try { await run(); } catch (error) { failed[id] ??= String((error as Error)?.message ?? error).slice(0, 2000); }
};

// The hunting-hooks fixture add-on (e2e/fixtures/hunting-hooks-addon.ts) on the coordinator.
const fixture = async (live: LiveGame, body: Record<string, unknown>) => await live.post('/e2e-hunting-hooks', body);
const heard = async (live: LiveGame, since: number) => await fixture(live, { op: 'heard', since }) as Heard[];
const of = (list: Heard[], hook: string) => list.filter(h => h.hook === hook);

// T38's reads (runtime/addons/achievement-hunt/tests/rows.ts at 21fe30a2b).
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
    if(last&&last.key===key){last.ms=Date.now()-last.at;return;}s.segments.push({key,at:Date.now(),ms:0,x:Math.round(character.real_x),y:Math.round(character.real_y),step:p?.step??null,remaining:r?.remaining??null,speed:character.speed});
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

// T38: the player switches the add-on on and picks its target mode entry over the API, and the
// party plays it with no one stepping in.
async function achievementHunt(live:LiveGame,info:TestInfo,result:any){
  // From the call budget's step 1 on, the warrior holds a Tracktrix, the add-on's progress
  // source.
  await holdTracktrix(live,W);
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
        segments:h.segments.map((g:any)=>[g.at-switchedAt[n]!,g.ms,g.key,g.x,g.y,g.step,g.remaining,g.speed]),
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
  // A fighter has reached it once it stands inside the area plus its own attack range, the farm's
  // arrival rule (hunting/rules.ts `standsAt`, which the farm engagement reads to end the walk).
  // The confirming table run on fdc770fc6 read a fixed 150 margin: the walk handed the warrior to
  // its fight 169 from the area, inside its 179 range, and the row read it as still walking.
  result.positions=[];
  await expect.poll(async()=>{const players=await live.admin(`output=${JSON.stringify(fighters)}.map(n=>{const p=get_player(n);return {name:n,map:p.map,x:p.x,y:p.y,range:p.range,rip:!!p.rip}})`);
    result.positions.push([Date.now()-switchedAtTest,...players.map((p:any)=>[p.name,p.map,Math.round(p.x),Math.round(p.y),p.rip,p.map===area.map?Math.round(distance(area,p)):null,p.range])]);
    return players.every((p:any)=>!p.rip&&standsAt(area,p,500));},{timeout:300_000,intervals:[1000],message:'Both fighters reach the goo spawn'}).toBe(true)
    .catch(async error=>{await readReach().catch(e=>{result.reachError=String(e);});
      console.log('ACHIEVEMENT-HUNT-MISS '+JSON.stringify({area:{map:area.map,x:area.x,y:area.y},positions:result.positions,navigation:result.navigation,reach:result.reach,reachError:result.reachError}));
      throw error;});
  const reachedMs=Date.now()-switchedAtTest;
  await readReach();
  // The party walks as one group at its walk's pace, which every member's speed reads while the
  // walk travels (RR13). fix3-surv's run3 read the speeds after the walk as 117 and 99, against
  // 97 and 79 in the other runs, and that limit came out 227 ms under its reach.
  const paces=fighters.flatMap(n=>result.reach[n].segments.filter((g:any)=>/^walking\|group-walk\|/.test(g[2])).map((g:any)=>Number(g[7])));
  expect(paces.length,'segments the walk travelled in').toBeGreaterThan(0);
  const pace=Math.min(...paces);
  // The reach clock starts when the last fighter's group walk starts travelling. Before that the
  // convoy prepares and assembles its members (the walk's idle segment, 1.9 s in the closing-3
  // pair run), which the walk-progress rule bounds (e2e/walk-progress.ts, from the first walking
  // sample, as executor.ts starts its stall clock at its issued step).
  result.departMs=Math.max(...fighters.map(n=>Number(result.reach[n].segments.find((g:any)=>/^walking\|group-walk\|/.test(g[2]))?.[0])));
  result.reachMs=reachedMs-result.departMs;
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
  console.log('ACHIEVEMENT-HUNT-PLAY '+JSON.stringify({reachMs:result.reachMs,departMs:result.departMs,limitMs:result.limitMs,navigation:result.navigation,reach:result.reach,settleMs:result.settleMs,window:result.window,deaths:result.deaths}));
  // The party reaches the spawn within its route at the slowest member's walk speed, the
  // add-on's settle (README F: a switch settles once every member has reported since it, two
  // report intervals) and the arrival poll's 1 s interval, counted from the walk's departure.
  // Checked last, so a slow arrival still runs the switch-off checks.
  expect(result.reachMs,'time to reach the target').toBeLessThanOrEqual(result.limitMs);
}

// H54's farm with Auto: the focus change, the learned type and the mode answer.
async function autoFarm(live: LiveGame, since: number) {
  const goo = await location(live, 'goo');
  await live.post('/farming-mode', { character: W, combatMode: 'auto' });
  await live.post('/navigate-to-monster', { monsterId: 'goo', location: goo });
  await step('H54', async () => {
    await expect.poll(async () => of(await heard(live, since), 'farming.focusChanged').some(h => JSON.stringify(h.payload.focus) === '["goo"]'),
      { timeout: 60_000, intervals: [500] }).toBe(true);
  });
  // Auto scatters on a learned goo.
  await step('H54', async () => {
    await expect.poll(async () => of(await heard(live, since), 'scatter.learned').some(h => h.payload.type === 'goo'),
      { timeout: 240_000, intervals: [1000] }).toBe(true);
    await expect.poll(async () => of(await heard(live, since), 'farming.mode').some(h => h.payload.mode === 'scatter'),
      { timeout: 60_000, intervals: [1000] }).toBe(true);
  });
  // The add-on reads the focus, the area and the Hunt target.
  await step('H54', async () => {
    const read = of(await heard(live, since), 'farming.mode').at(-1)!.reads.focus!;
    expect(read.focus).toEqual(['goo']);
    expect(read.area?.map).toBe(goo.map);
    expect(read.huntTarget).toBeNull();
  });
  // The add-on reads the goo's passive rule and the Fairy's priority.
  await step('H54', async () => {
    const reads = of(await heard(live, since), 'farming.focusChanged')[0]!.reads;
    expect(reads.goo.corePriority).toBe(false);
    expect(reads.tinyp.corePriority).toBe(true);
    expect(reads.tinyp.default.priority).toBe(101);
  });
}

// H54's Hunt: a planted quest the add-on refuses first, then the cycle takes the next one.
// The party still farms goos here, so the priest's goo quest leaves room for the kills its next
// report may already count (run on a4884e05f: 2 went to 0 before the report).
async function refusedQuestHunt(live: LiveGame, info: TestInfo) {
  await quests(live, info, { [W]: { id: 'bee', count: 3 }, [P]: { id: 'goo', count: 10 } });
  await fixture(live, { op: 'set', refuseQuest: 'bee' });
  const hunt = Date.now();
  await start(live, W, 'goo');
  // The add-on refuses the planted quest, and the cycle backs up.
  await step('H54', async () => {
    await expect.poll(async () => of(await heard(live, hunt), 'hunt.stage').some(h => h.reads.hunt?.target === 'goo'),
      { timeout: 180_000, intervals: [1000] }).toBe(true);
    expect(of(await heard(live, hunt), 'hunt.stage').some(h => h.reads.hunt?.target === 'bee')).toBe(false);
  });
  // The cycle goes to Daisy, takes the quest and travels.
  await step('H54', async () => {
    const stages = of(await heard(live, hunt), 'hunt.stage').map(h => h.payload.to);
    expect(stages).toContain('mission-travel');
    expect(of(await heard(live, hunt), 'hunt.stage').at(-1)!.reads.hunt?.stage).toBeTruthy();
  });
  // The add-on's status line shows under the Hunt status.
  await step('H54', async () => {
    const view = of(await heard(live, hunt), 'hunt.stage').at(-1)!.reads.hunt!;
    expect(typeof view.label).toBe('string');
  });
  // The planted quest is turned in.
  await step('H54', async () => {
    await expect.poll(async () => of(await heard(live, hunt), 'hunt.questChanged').some(h => h.payload.change === 'turnedIn'),
      { timeout: 600_000, intervals: [2000] }).toBe(true);
  });
}

async function addonHuntPlay({live, info}: LiveWorld) {
  const result: any = {};
  await party(live);
  try {
    await step('H54', async () => {
      expect(await fixture(live, { op: 'register' }), 'the coordinator half registers').toEqual({ ok: true });
    });
    await live.post('/settings', { changes: [{ field: 'addons', value: await live.clients[W]!.run(switches(true)) }] });
    const since = Date.now();
    try { await step('T38', () => achievementHunt(live, info, result)); }
    finally {
      // A failed step leaves the switch off for the rest of the play. A failed switch-off joins the
      // reads, so the dump shows why the add-on still runs.
      await live.post('/addons', {name: NAME, enabled: false}).catch(e => { result.switchOffError = String(e); });
      reads.T38 = result;
    }
    await autoFarm(live, since);
    await refusedQuestHunt(live, info);
  } finally {
    await fixture(live, { op: 'set' });
    await live.post('/settings', { changes: [{ field: 'addons', value: await live.clients[W]!.run(switches(false)) }] });
  }
}

const own = (id: string) => ({
  owner: 'hunting', behaviours: [], start() {}, reads: () => ({failed: failed[id] ?? null, reads: id === 'T38' ? reads.T38 ?? null : null}),
  verdict() { expect(failed[id], `${id}: every step of the play passes`).toBeUndefined(); },
});

liveWindow({
  id: 'W60', name: 'Add-on driven Hunt (Achievement Hunt and the hunting-hooks add-on)',
  // The old bounds: H54's test 900 s (live-hunting-hooks.spec.ts:18) plus T38's waits, 60 + 30 +
  // 30 + 300 + 150 + 30 + 30 = 630 s (achievement-hunt/tests/rows.ts:74-167 at 21fe30a2b).
  timeoutMs: 1_530_000,
  play: addonHuntPlay,
  observers: [{id: 'T38', ...own('T38')}, {id: 'H54', ...own('H54')}],
});

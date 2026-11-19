import {test,expect,type LiveGame} from './live-fixtures';
import {liveScenarioTable,type Row} from './scenario-table';
import {settleNavigation} from './movement-owner-helpers';
import {fighters,location,party} from './game/hunt-lifecycle';
import {MOVEMENT_HOOKS_ADDON,addonSwitches,characterAnswers,characterSeen,registerCharacterHalf,type Seen} from './fixtures/movement-hooks-addon';
// The movement owner's hooks table: one fixture add-on registers every movement hook and
// notice, and each `HOOKS` row whose `fixture` names this file has one row here, titled as the
// registry names it. Every row shares one run, built once: the default fixture's party walk to the
// goo farm, the fight there, a Pause and Play under a travel, and the party's Town, the crossing.
// The rows the run cannot reach are unit rows, which their `fixture` names.
void test;
const [W,P]=[fighters[0]!,fighters[1]!];
type Run={group:string;since:number};
const runs=new WeakMap<LiveGame,Promise<Run>>();
const coordinator=async(live:LiveGame,body:Record<string,unknown>)=>await live.post('/e2e-movement-hooks',body);
const seenC=async(live:LiveGame)=>await coordinator(live,{op:'seen'}) as Seen[];
const seenW=async(live:LiveGame,since=0)=>await live.clients[W]!.run(characterSeen(since)) as Seen[];
const askC=async(live:LiveGame,hook:string,...args:unknown[])=>(await coordinator(live,{op:'ask',hook,args})).answer;
const askW=async(live:LiveGame,hook:string,...args:unknown[])=>await live.clients[W]!.run(`globalThis.__partyHooks.ask(${JSON.stringify(hook)},...${JSON.stringify(args)})`);
const heard=(seen:Seen[],hook:string)=>seen.filter(s=>s.hook===hook).map(s=>s.payload as Record<string,unknown>);
const at=async(live:LiveGame,name:string)=>await live.clients[name]!.run('({map:character.map,in:character.in,x:character.real_x,y:character.real_y})') as {map:string;in:string;x:number;y:number};

// The one run every row reads.
function shared(live:LiveGame):Promise<Run>{
  if(!runs.has(live))runs.set(live,(async()=>{
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'merchant idle':false,'stand maintenance':false}});
    await party(live);
    // The shipped tank-hold add-on answers group.anchor, a one-answer hook; switched off in the
    // add-on manager it leaves the hook to the fixture.
    await live.post('/addons',{name:'tank-hold',enabled:false});
    for(const name of fighters){await settleNavigation(live.clients[name]!,name);expect(await live.clients[name]!.run(registerCharacterHalf)).toEqual({ok:true});}
    expect(await coordinator(live,{op:'register'})).toEqual({ok:true});
    await live.post('/settings',{changes:[{field:'addons',value:await live.clients[W]!.run(addonSwitches(true))}]});
    for(const name of fighters)await expect.poll(async()=>live.clients[name]!.run(`globalThis.__partyHooks.enabled(${JSON.stringify(MOVEMENT_HOOKS_ADDON)})`),{timeout:15_000}).toBe(true);
    const since=await live.clients[W]!.run('Date.now()') as number;
    // The party walk and the fight.
    const farm=await location(live,'goo');
    await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{},monsterSearchRadius:400});
    await live.post('/navigate-to-monster',{monsterId:'goo',location:farm});
    await expect.poll(async()=>heard(await seenC(live),'walk.ended').length,{timeout:180_000}).toBeGreaterThan(0);
    await expect.poll(async()=>heard(await seenW(live,since),'step.sent').length,{timeout:120_000}).toBeGreaterThan(0);
    const group=String(heard(await seenC(live),'walk.formed')[0]?.group);
    // A Pause and Play under a travel: the pause source pauses the journey and Play resumes it.
    // The travel's group walk holds the warrior before its journey starts, and a hold has no
    // journey to pause. The walk's assemble phase then sends the warrior to the rally point, its
    // own spot, and that journey ends arrived within 600 ms. The Pause waits for the travel's
    // journey away from that spot, while it is live. The travel goes to the map's first spawn,
    // which the party walked from to reach the fight; a point 300 east of the goo fight on main
    // is walled off from it.
    await live.post('/focus',{monsterFocus:[]});
    const here=await at(live,W);
    const [x,y]=await live.clients[W]!.run(`G.maps[${JSON.stringify(here.map)}].spawns[0]`) as number[];
    const travelled=await live.clients[W]!.run('Date.now()') as number;
    await live.post('/travel',{map:here.map,x,y});
    const away=(d:unknown)=>{const p=d as {x?:number;y?:number}|undefined;return !!p&&Math.hypot(Number(p.x)-here.x,Number(p.y)-here.y)>50;};
    await expect.poll(async()=>heard(await seenW(live,travelled),'journey.started').some(j=>away(j.destination))&&
      (await askW(live,'movement.live') as {journey?:boolean}|null)?.journey===true,{timeout:30_000}).toBe(true);
    await live.post('/console-control/pause',{});
    await expect.poll(async()=>heard(await seenW(live,since),'journey.paused').length,{timeout:30_000}).toBeGreaterThan(0);
    await live.post('/console-control/play',{});
    await expect.poll(async()=>heard(await seenW(live,since),'journey.resumed').length,{timeout:30_000}).toBeGreaterThan(0);
    // The crossing: the party's Town.
    await live.post('/town-party',{});
    await expect.poll(async()=>heard(await seenW(live,since),'crossing.ended').length,{timeout:60_000}).toBeGreaterThan(0);
    // The focus cleared above cancelled each member's farming destination, and a group walk takes
    // only members that have one. The goo focus and its navigation give it back, and the walk to
    // the farm ends before a row asks for a walk of its own.
    const walked=heard(await seenC(live),'walk.ended').length;
    await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{},monsterSearchRadius:400});
    await live.post('/navigate-to-monster',{monsterId:'goo',location:farm});
    await expect.poll(async()=>heard(await seenC(live),'walk.ended').length,{timeout:180_000}).toBeGreaterThan(walked);
    for(const name of fighters)await settleNavigation(live.clients[name]!,name);
    return {group,since};
  })());
  return runs.get(live)!;
}

const rows:Row[]=[
  ['movement.request: holds, steps or walks the character at its add-on tier',async live=>{
    await shared(live);
    await live.clients[W]!.run(characterAnswers({hold:'hooks table hold'}));
    // An add-on's hold is a combat hold: the movement tick stops the character's own step and names
    // the add-on in its combat position. `movement.live` names only journeys and request holds, so
    // it never shows this hold. The registry weighs the answer at its registration's tier.
    const position=`(()=>{const p=globalThis.partyCombatPosition;return [p?.movementOwner??null,p?.reason??null];})()`;
    try{
      await expect.poll(()=>live.clients[W]!.run(position),{timeout:30_000}).toEqual([`addon:${MOVEMENT_HOOKS_ADDON}`,'hooks table hold']);
      expect(await live.clients[W]!.run(`(()=>{const a=globalThis.__partyHooks.moverAnswer({});return a&&[a.registration,a.mover.tier,a.answer.kind];})()`)).toEqual([MOVEMENT_HOOKS_ADDON,'addon-task','hold']);
    }finally{await live.clients[W]!.run(characterAnswers({hold:null}));}
    await expect.poll(async()=>(await live.clients[W]!.run(position) as unknown[])[0],{timeout:30_000}).not.toBe(`addon:${MOVEMENT_HOOKS_ADDON}`);
  }],
  ['group.anchor: the group record asks it with its members in a fight',async live=>{
    await shared(live);
    const asked=heard(await seenC(live),'group.anchor');
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.some(a=>[W,P].every(name=>(a.members as string[]).includes(name)))).toBe(true);
  }],
  ['step.safety: refuses a step that ends inside its zone',async live=>{
    await shared(live);
    const here=await at(live,W),to={x:here.x+12,y:here.y};
    await live.clients[W]!.run(characterAnswers({refuseSteps:'inside the hooks table zone'}));
    try{
      const result=await askW(live,'movement.step',to,'hooks-table') as {status:string;reason?:string};
      expect(result.status).toBe('refused');expect(String(result.reason)).toContain('inside the hooks table zone');
    }finally{await live.clients[W]!.run(characterAnswers({refuseSteps:null}));}
    expect(heard(await seenW(live),'step.safety').some(a=>JSON.stringify(a.to)===JSON.stringify(to))).toBe(true);
  }],
  ['journey.started: fires when a request is granted, kept, retargeted or resumed',async live=>{
    const {since}=await shared(live);
    expect(heard(await seenW(live,since),'journey.started').length).toBeGreaterThan(0);
  }],
  ['journey.paused: fires when a pause source, a click or a combat step pauses the journey',async live=>{
    const {since}=await shared(live);
    expect(heard(await seenW(live,since),'journey.paused').length).toBeGreaterThan(0);
  }],
  ['journey.resumed: fires when the pause ends',async live=>{
    const {since}=await shared(live);
    expect(heard(await seenW(live,since),'journey.resumed').length).toBeGreaterThan(0);
  }],
  ['journey.ended: fires once with its end code',async live=>{
    const {since}=await shared(live);
    const ended=heard(await seenW(live,since),'journey.ended');
    expect(ended.length).toBeGreaterThan(0);
    // A navigation revision change ends the live journey `superseded`; the run's Town after the
    // resumed travel does that.
    const codes=['arrived','failed','replaced','cancelled','expired','stale','released','returned-to-safe','superseded'];
    for(const e of ended)expect(codes.some(code=>String(e.code).startsWith(code)),String(e.code)).toBe(true);
  }],
  ['movement.followIfFar: a member inside the distance does not walk',async live=>{
    await shared(live);
    const answer=await live.clients[P]!.run(`globalThis.__partyHooks.ask('movement.followIfFar',{character:${JSON.stringify(P)}})`);
    expect(answer,'no walk inside the distance').toBe(false);
  }],
  ["walks.end: ends the group's walk with the asker's code",async live=>{
    const {group}=await shared(live);
    const here=await at(live,W);
    expect(await askC(live,'walks.request',group,{kind:'hooks-table',destination:{map:here.map,x:here.x+200,y:here.y},members:[W,P],tier:'farming',label:'hooks table'})).toBe(true);
    // A named member leaves the walk alone and the walk goes on for its leader: walks.end answers
    // false and tells walk.member 'left' (Follow off for a follower, d5dccc495).
    expect((await coordinator(live,{op:'walks',hook:'walks.end',args:[group,'realm-switch',P]})).answer,'the walk goes on without the leaver').toBe(false);
    await expect.poll(async()=>heard(await seenC(live),'walk.member').some(m=>m.member===P&&m.change==='left'),{timeout:30_000}).toBe(true);
    expect((await coordinator(live,{op:'walks',hook:'walks.end',args:[group,'realm-switch']})).answer).toBe(true);
    await expect.poll(async()=>heard(await seenC(live),'walk.ended').some(e=>e.group===group&&e.code==='realm-switch'),{timeout:30_000}).toBe(true);
  }],
  ['walk.formed: fires once when a group walk is created',async live=>{
    await shared(live);
    const formed=heard(await seenC(live),'walk.formed');
    expect(formed.length).toBeGreaterThan(0);
    const walks=formed.map(f=>f.walk);expect(new Set(walks).size,'once per walk').toBe(walks.length);
  }],
  ['walk.phase: fires on each phase change of the walk',async live=>{
    await shared(live);
    const phases=heard(await seenC(live),'walk.phase');
    expect(phases.length).toBeGreaterThan(0);
    for(const p of phases)expect(p.phase,'a change, not a repeat').not.toBe(p.from);
  }],
  ['walk.member: fires when a member completes or leaves the walk',async live=>{
    await shared(live);
    const members=heard(await seenC(live),'walk.member');
    expect(members.length).toBeGreaterThan(0);
    // A member that left a walk for silence rejoins it on its next report (fa3a9134d).
    for(const m of members)expect(['completed','left','rejoined']).toContain(m.change);
  }],
  ['walk.ended: fires once with the end code',async live=>{
    await shared(live);
    const ended=heard(await seenC(live),'walk.ended');
    expect(ended.length).toBeGreaterThan(0);
    const walks=ended.map(e=>e.walk);expect(new Set(walks).size,'once per walk').toBe(walks.length);
    for(const e of ended)expect(String(e.code).length).toBeGreaterThan(0);
  }],
  ["walks.request: starts the group's walk at the asker's tier, and a lower ask is refused",async live=>{
    const {group}=await shared(live);
    const here=await at(live,W),ask=(tier:string,dx:number)=>({kind:'hooks-table',destination:{map:here.map,x:here.x+dx,y:here.y},members:[W,P],tier,label:'hooks table'});
    try{
      expect(await askC(live,'walks.request',group,ask('hunt-mission',220))).toBe(true);
      await expect.poll(async()=>heard(await seenC(live),'walk.formed').some(f=>f.group===group&&f.tier==='hunt-mission'),{timeout:30_000}).toBe(true);
      // The walk gives way to a second ask of its own task at any tier, so the lower ask comes from
      // another task, at farming, the task tier below hunt-mission.
      expect(await askC(live,'walks.request',group,{...ask('farming',-220),kind:'hooks-table-lower'}),'a lower ask while the walk holds').toBe(false);
    }finally{await coordinator(live,{op:'walks',hook:'walks.end',args:[group,'cancelled']});}
  }],
  ["movement.step: one step through step safety at the asker's turn",async live=>{
    await shared(live);
    const here=await at(live,W),to={x:here.x+10,y:here.y};
    const result=await askW(live,'movement.step',to,'hooks-table') as {status:string};
    expect(['sent','kept']).toContain(result.status);
    expect(heard(await seenW(live),'step.safety').some(a=>JSON.stringify(a.to)===JSON.stringify(to)),'step safety judged it').toBe(true);
  }],
  ['movement.live: names who holds movement',async live=>{
    await shared(live);
    expect(await askW(live,'movement.live')).toEqual(await live.clients[W]!.run('__partyMovement.live()'));
  }],
  ['reports.fresh: answers the one freshness rule for a reading',async live=>{
    await shared(live);
    const now=await live.clients[W]!.run('Date.now()') as number;
    expect(await askW(live,'reports.fresh',now,now)).toBe(true);
    expect(await askW(live,'reports.fresh',now-3_600_000,now)).toBe(false);
  }],
  ["movement.climbing: names the live climb's rung and try",async live=>{
    await shared(live);
    expect(await askW(live,'movement.climbing')).toEqual(await live.clients[W]!.run('__partyMovement.climbing()'));
  }],
  ["movement.records: answers the character's ring",async live=>{
    await shared(live);
    const [asked,own]=await live.clients[W]!.run(`[globalThis.__partyHooks.ask('movement.records').length,__partyMovement.records().length]`) as number[];
    expect(asked).toBeGreaterThan(0);expect(asked).toBe(own);
  }],
  ["movement.incidents: answers the character's stuck and caught-error records",async live=>{
    await shared(live);
    const [asked,own]=await live.clients[W]!.run(`[globalThis.__partyHooks.ask('movement.incidents').length,__partyMovement.incidents().length]`) as number[];
    expect(asked).toBe(own);
  }],
  ["movement.formationRecovery: answers the group's terrain recovery round",async live=>{
    await shared(live);
    expect(await askC(live,'movement.formationRecovery',null,[],null,'hooks-table',0,false,160,'')).toBeNull();
  }],
  ['movement.independentApproach: answers whether every member approaches on its own',async live=>{
    await shared(live);
    expect(await askC(live,'movement.independentApproach',[],0)).toBe(false);
  }],
  ["movement.independentReadiness: answers each member's readiness report",async live=>{
    await shared(live);
    expect(await askC(live,'movement.independentReadiness',[])).toEqual({});
  }],
  ['movement.confirmIndependentApproach: issues and settles the confirmation round',async live=>{
    await shared(live);
    expect(await askC(live,'movement.confirmIndependentApproach',null,[],null,'t',0)).toEqual({revision:0,ready:false});
  }],
  ['route.avoid: the planner asks it for every route it plans',async live=>{
    await shared(live);
    const asked=heard(await seenC(live),'route.avoid');
    expect(asked.length,'the planner asked it for its plans').toBeGreaterThan(0);
    for(const a of asked)expect(a.from&&a.to).toBeTruthy();
  }],
  ['crossing.allows: refuses a crossing in plain words, and the crossing ends refused',async live=>{
    const {since}=await shared(live);
    expect(heard(await seenW(live,since),'crossing.allows').length,'asked before the Town').toBeGreaterThan(0);
    const from=await live.clients[W]!.run('Date.now()') as number;
    await live.clients[W]!.run(characterAnswers({refuseCrossing:'the hooks table refuses this crossing'}));
    try{
      await live.post('/town-party',{});
      await expect.poll(async()=>heard(await seenW(live,from),'crossing.ended').some(e=>e.code==='refused'),{timeout:30_000}).toBe(true);
    }finally{await live.clients[W]!.run(characterAnswers({refuseCrossing:null}));}
  }],
  ["step.point: offers this character's step point, which step safety judges",async live=>{
    await shared(live);
    // A request hold refuses every step before step safety reads it. The crossing row's party Town
    // holds the warrior until its cast lands, since its refused crossings retry once the refusal clears.
    await expect.poll(()=>askW(live,'movement.live'),{timeout:180_000}).toBeNull();
    const here=await at(live,W),offered={x:Math.round(here.x)+8,y:Math.round(here.y)};
    await live.clients[W]!.run(characterAnswers({point:offered}));
    try{
      await askW(live,'movement.step',{x:here.x-8,y:here.y},'hooks-table');
      const w=await seenW(live);
      expect(heard(w,'step.point').some(a=>a.mover==='hooks-table')).toBe(true);
      expect(heard(w,'step.safety').some(a=>JSON.stringify(a.to)===JSON.stringify(offered)),'step safety judged the offered point').toBe(true);
    }finally{await live.clients[W]!.run(characterAnswers({point:null}));}
  }],
  ['crossing.started: fires when a crossing is sent',async live=>{
    const {since}=await shared(live);
    expect(heard(await seenW(live,since),'crossing.started').length).toBeGreaterThan(0);
  }],
  ['crossing.ended: fires once when a crossing lands, is refused, interrupted or times out',async live=>{
    const {since}=await shared(live);
    const ended=heard(await seenW(live,since),'crossing.ended');
    expect(ended.length).toBeGreaterThan(0);
    for(const e of ended)expect(['landed','refused','interrupted','timed-out']).toContain(e.code);
  }],
  ['step.sent: fires when a combat step is sent, with its mover and point',async live=>{
    const {since}=await shared(live);
    const sent=heard(await seenW(live,since),'step.sent');
    expect(sent.length).toBeGreaterThan(0);
    for(const s of sent)expect(typeof s.mover==='string'&&!!s.point).toBe(true);
  }],
  ['formation.moved: fires when a formation step is sent',async live=>{
    const {since}=await shared(live);
    await expect.poll(async()=>heard(await seenW(live,since),'formation.moved').length,{timeout:60_000}).toBeGreaterThan(0);
  }],
];

liveScenarioTable('movement hooks: one fixture add-on registers every hook and event',900_000,async()=>{},rows);

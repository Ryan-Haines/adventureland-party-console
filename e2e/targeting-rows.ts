import {expect,waitForGameplay,type LiveGame,reloadCode} from './live-fixtures';
import type {TestInfo} from '@playwright/test';
import {fighters,party} from './game/hunt-lifecycle';
import {farmingAreas} from '../runtime/hunting/areas';
import {spendLog,red} from './turns-rows';
import {W,P} from './hunt-interruption-helpers';
import {peacefulMonsters} from './event-death-helpers';
import {targetingSavedFields} from '../runtime/characters/targeting/saved-fields';

// The failed-approach mark's length, targeting's `setAsideMs` (rules.ts reads it through `pick`).
const SET_ASIDE_MS=targetingSavedFields.settings.setAsideMs.default;

// The targeting owner's row "targeting: retire and skip", in the default table after the survival potions row. Step 1 writes
// its first case, the planned case on the bee field: a planted monster on walkable ground that has
// no path from the party and lies farther than the warrior's range from any point the warrior can
// reach, found on the warrior's client at run time. The plant is a pinkgoo, a passive monster with
// no spawn in Main, with the focus set to it alone, so the farm candidates hold only the plant
// (shared.js `selectFarmCandidates` falls back to the search radius) and the leader's nomination
// picks it. It stands still: a drift box in an earlier run let the server move it onto reachable ground.
// SIGHT keeps the plant within the clients' view of the bee field (the base run's plant 805 units
// off never reached the clients' entities); RADIUS is the farm's search radius while the plant
// stands, so the farm candidates reach it.
// DEEP is the deep closed-in ground north of the bee field in Main's geometry (about 552, 416).
const SIGHT=350,RADIUS=900,DEEP={x:552,y:416},OBSERVE_MS=90_000;
// Each fighter's approach and selection every 50 ms: the approach's id, level, radius and phase
// (runtime/movement/character/approach.ts `createIndependentApproachClient` `report`), the combat position it publishes, the
// grouped lock target and the character's own target. Written for both trees, so it reads only
// what b9b5c91e also has.
const instrument=(id:string)=>`(()=>{const s=globalThis.__e2eG1={id:${JSON.stringify(id)},samples:[],ids:new Map(),unreachableAt:null,started:Date.now()};
  let last='';s.timer=setInterval(()=>{const q=globalThis.partyQueueClient,r=q&&q.independent&&q.independent.report&&q.independent.report(),p=globalThis.partyCombatPosition||{};
    const g=globalThis.__partyGroupedCombat,lock=g&&g.target&&String(g.target.id)||null,own=character.target?String(character.target):null;
    const row={at:Date.now(),approach:r?{id:r.id,target:r.target,level:r.level,radius:r.radius,phase:r.phase,pending:r.pending}:null,
      position:{mode:p.mode||null,id:p.approachId||null,phase:p.phase||null,target:p.target!=null?String(p.target):null},lock,own,
      dead:!!(globalThis.partyRoleRunner&&globalThis.partyRoleRunner.isKnownDead&&globalThis.partyRoleRunner.isKnownDead(s.id))};
    const ids=[r&&r.target===s.id?r.id:null,p.target!=null&&String(p.target)===s.id?p.approachId:null].filter(Boolean);
    for(const a of ids){if(!s.ids.has(a))s.ids.set(a,{first:row.at,level:-1});if(r&&r.id===a)s.ids.get(a).level=Math.max(s.ids.get(a).level,r.level);}
    if(s.unreachableAt===null&&((r&&r.target===s.id&&r.phase==='unreachable')||(p.target!=null&&String(p.target)===s.id&&p.phase==='unreachable')))s.unreachableAt=row.at;
    // The failed-approach mark's own expiry, from the retire's notice; b9b5c91e has none.
    const t=globalThis.__partyTargeting&&globalThis.__partyTargeting.retire,notice=t&&t.report?t.report().find(e=>String(e.id)===s.id):null;
    if(s.markUntil==null&&notice&&typeof notice.until==='number')s.markUntil=notice.until;
    const key=JSON.stringify([row.approach,row.position,lock,own,row.dead]);if(key!==last){last=key;s.samples.push(row);if(s.samples.length>4000)s.samples.shift();}},50);return true;})()`;
const report=`(()=>{const s=globalThis.__e2eG1;if(!s)return null;clearInterval(s.timer);
  const mine=s.samples.filter(r=>r.lock===s.id||r.own===s.id||r.approach&&r.approach.target===s.id||r.position.target===s.id);
  return {id:s.id,observedMs:Date.now()-s.started,approaches:[...s.ids.entries()].map(([id,v])=>({id,first:v.first-s.started,level:v.level})),
    unreachableAt:s.unreachableAt===null?null:s.unreachableAt-s.started,markUntil:s.markUntil==null?null:s.markUntil-s.started,approachesAfterUnreachable:s.unreachableAt===null?null:[...s.ids.values()].filter(v=>v.first>s.unreachableAt).length,
    perMinute:Math.round(s.ids.size*60000/Math.max(1,Date.now()-s.started)*10)/10,
    maxLevel:Math.max(-1,...mine.map(r=>r.approach&&r.approach.target===s.id?r.approach.level:-1)),
    heldMs:mine.length?mine.at(-1).at-mine[0].at:0,lastLock:s.samples.at(-1)?.lock??null,lastOwn:s.samples.at(-1)?.own??null,
    knownDead:s.samples.some(r=>r.dead),nomination:globalThis.__partyNomination||null,
    phases:mine.reduce((a,r)=>{const k=(r.approach&&r.approach.target===s.id?r.approach.phase:r.position.phase)||'none';a[k]=(a[k]||0)+1;return a;},{}),
    samples:s.samples.slice(0,60).concat(s.samples.slice(-30)).map(r=>({...r,at:r.at-s.started}))};})()`;

export async function targetingRetireRow(live:LiveGame,info:TestInfo){
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'merchant idle':false,'stand maintenance':false}});
  await party(live);
  // The bee field: an earlier run found no point deep enough near the goo field, and the deep closed-in
  // ground north of the bee field (about 552, 416) is within the clients' sight of it. Every
  // monster is peaceful for the row, so the bees take no target and the plant is the only fight.
  await peacefulMonsters(live);
  // Of Main's bee areas, the one nearest that ground (the first listed, at 152, 1487, has
  // no ground deep enough within sight).
  await expect.poll(async()=>(await live.state(true)).monsterChoices?.some((entry:any)=>entry.id==='bee'),{timeout:90_000}).toBe(true);
  const farm=farmingAreas((await live.state(true)).monsterChoices,['bee']).filter((a:any)=>a.map==='main')
    .sort((a:any,b:any)=>Math.hypot(centre(a).x-DEEP.x,centre(a).y-DEEP.y)-Math.hypot(centre(b).x-DEEP.x,centre(b).y-DEEP.y))[0];
  await live.post('/navigate-to-monster',{monsterId:'bee',location:farm});
  await live.post('/focus',{monsterFocus:['bee'],monsterPriorities:{},monsterSearchRadius:400});
  const FIELD=centre(farm);
  const SEARCH=[FIELD.x-900,FIELD.y-900,FIELD.x+900,FIELD.y+900];
  const [W]=fighters;
  // The party farms the field before the plant, so the plant meets a fight in progress.
  // The client's event buffer is bounded, so a kill counts by its sequence after the row's start.
  const lastSeq=async(name:string)=>Math.max(0,...(await live.clients[name]!.events()).map((e:any)=>Number(e.sequence)||0));
  const killsAfter=async(name:string,seq:number)=>(await live.clients[name]!.events()).filter((e:any)=>Number(e.sequence)>seq&&e.event==='hit'&&e.data?.hid===name&&(e.data.kill||e.data.dead)).length;
  const before=await lastSeq(W!);
  await expect.poll(async()=>await killsAfter(W!,before),{timeout:180_000,message:'G1: the party farms the bee field before the plant'}).toBeGreaterThan(0);
  // The plant's point is walkable and has no path from the warrior, and lies farther than the
  // warrior's range from every point it can reach (a plant 169 units in let the warrior,
  // range 179 in this fixture, attack it from the shore; no such point lies within 380
  // units of the field). The warrior's client floods an 8-unit grid of SEARCH from its own cell
  // with the game's own `can_move`, floods again from every reached cell through the rest to
  // read each cell's distance from reachable ground (8 neighbours, so the reading never exceeds
  // the true distance), and takes the deepest walkable unreached cell within RADIUS of the field,
  // kept the warrior's range and 50 units from the box's edge. The reading names what the floods found.
  const geometry=await live.clients[W!]!.run(`(()=>{const [x1,y1,x2,y2]=${JSON.stringify(SEARCH)},S=8,b=character.base,key=(i,j)=>i+','+j;
    const ok=(x,y)=>can_move({map:'main',x,y,going_x:x,going_y:y,base:b}),step=(ax,ay,bx,by)=>can_move({map:'main',x:ax,y:ay,going_x:bx,going_y:by,base:b});
    const inside=(i,j)=>i*S>=x1&&i*S<=x2&&j*S>=y1&&j*S<=y2;
    // The flood starts from the grid cells the warrior can step to from where it stands. Run G of
    // 13.4 rounded the warrior at (301.6, 881.6) to the cell (304, 880), which \`can_move\` refuses to
    // leave; the flood reached that one cell, so the Hunt case moved both fighters onto it and the
    // priest's every walk failed with "collisions detected".
    const i0=Math.round(character.real_x/S),j0=Math.round(character.real_y/S),seen=new Set(),q=[];
    for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){const a=i0+di,c=j0+dj;if(ok(a*S,c*S)&&step(character.real_x,character.real_y,a*S,c*S)){seen.add(key(a,c));q.push([a,c]);}}
    while(q.length){const [i,j]=q.pop();for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){const a=i+di,c=j+dj,k=key(a,c);
      if(seen.has(k)||!inside(a,c))continue;if(!step(i*S,j*S,a*S,c*S))continue;seen.add(k);q.push([a,c]);}}
    const dist=new Map([...seen].map(k=>[k,0]));let front=[...seen].map(k=>k.split(',').map(Number));
    for(let d=1;front.length;d++){const next=[];for(const [i,j] of front)for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){const a=i+di,c=j+dj,k=key(a,c);
      if(dist.has(k)||!inside(a,c))continue;dist.set(k,d);next.push([a,c]);}front=next;}
    const range=Number(character.range),M=range+50;let best=null,unreached=0;
    for(let i=Math.ceil((x1+M)/S);i*S<=x2-M;i++)for(let j=Math.ceil((y1+M)/S);j*S<=y2-M;j++){const k=key(i,j);if(seen.has(k)||Math.hypot(i*S-(${FIELD.x}),j*S-(${FIELD.y}))>${SIGHT}||!ok(i*S,j*S))continue;unreached++;
      const shore=(dist.get(k)||0)*S;if(!best||shore>best.shore)best={x:i*S,y:j*S,shore};}
    let shore=null;if(best)for(const k of seen){const [i,j]=k.split(',').map(Number),d=Math.hypot(i*S-best.x,j*S-best.y);if(!shore||d<shore.d)shore={x:i*S,y:j*S,d:Math.round(d)};}
    // The Hunt case's drift: the deepest other unreached walkable cell 24 to 48 units from the
    // point, so a monster walking between the two moves more than the approach's 12 units.
    let drift=null;if(best)for(const k of dist.keys()){if(seen.has(k))continue;const [i,j]=k.split(',').map(Number),d=Math.hypot(i*S-best.x,j*S-best.y),shore=(dist.get(k)||0)*S;
      if(d<24||d>48||shore<=range+10||!ok(i*S,j*S))continue;if(!drift||shore>drift.shore)drift={x:i*S,y:j*S,shore};}
    return {field:${JSON.stringify(FIELD)},reached:seen.size,unreached,range,point:best&&best.shore>range+10?best:null,best,drift,shore,from:{x:character.real_x,y:character.real_y}};})()`);
  expect(geometry.reached,'G1: the flood reaches the ground around the warrior '+JSON.stringify(geometry)).toBeGreaterThan(1);
  expect(geometry.point,"G1: a walkable point farther than the warrior's range from any point it can reach "+JSON.stringify(geometry)).not.toBeNull();
  const P=geometry.point as {x:number;y:number};
  const id=String(await live.admin(`output=(()=>{const m=new_monster('main',{type:'pinkgoo',position:[${P.x},${P.y}],radius:0,count:1},{temp:1});m.hp=m.max_hp=2000000;return m.id;})()`));
  const planted=await live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(id)}];return m?{x:m.x,y:m.y}:null;})()`);
  try{
    // Both fighters start on the shore cell nearest the plant, as the Hunt case does: the priest's
    // range covers the plant from there and the warrior's does not.
    const shore=geometry.shore as {x:number;y:number};
    await live.admin(`output=(()=>{for(const n of ${JSON.stringify(fighters)})transport_player_to(get_player(n),'main',[${shore.x},${shore.y}]);return true;})()`);
    for(const n of fighters)await live.clients[n]!.run(instrument(id));
    await live.post('/focus',{monsterFocus:['pinkgoo'],monsterPriorities:{},monsterSearchRadius:RADIUS});
    const started=Date.now();
    await expect.poll(async()=>Date.now()-started,{timeout:OBSERVE_MS+30_000,intervals:[5_000]}).toBeGreaterThan(OBSERVE_MS);
    const readings=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,await live.clients[n]!.run(report)])));
    const plant=await live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(id)}];return m?{x:m.x,y:m.y,hp:m.hp,target:m.target||null}:null;})()`);
    const tg41=await targetingNonLeaderNotice(live,shore,id);
    console.log('TARGETING-G1 '+JSON.stringify({id,geometry,planted,plant,readings,tg41}).slice(0,60_000));
    await info.attach('targeting-g1',{body:JSON.stringify({id,geometry,planted,plant,readings,tg41}),contentType:'application/json'});
    const w=readings[W!];
    expect(w,'G1: the warrior reports its approach').toBeTruthy();
    // The bee case is a reading: its approach reaches its last level in
    // some runs and not in others. Where it does, the mark holds the plant for its 10 s and the
    // finder may pick it again after (one run saw the next approach 10.0 s after the last
    // level), so only an approach inside the mark counts.
    const markEnds=w.markUntil??(w.unreachableAt===null?null:w.unreachableAt+SET_ASIDE_MS);
    const inMark=w.unreachableAt===null?[]:(w.approaches as {first:number}[]).filter(a=>a.first>w.unreachableAt&&a.first<markEnds);
    expect.soft(inMark,'G1: approaches to the still plant inside its mark').toEqual([]);
    expect.soft(w.knownDead,'TG13: the plant is on the killed list').toBe(false);
    expect.soft(tg41.ownRetires,"TG41's premise: neither fighter's own approach to the reachable plant ends unreachable").toEqual({[W!]:0,[fighters[1]!]:0});
    expect.soft(tg41.lockAtNotice,'TG41: the plant is the grouped lock target at the notice').toBe(tg41.id);
    expect.soft(tg41.retired,"TG41: the priest's retire records the notice").toBe(1);
    expect.soft(tg41.keeps?.kept,'TG41: the non-leader keeps the marked lock target').toBe(true);
    expect.soft(tg41.knownDead,"TG41: the retire puts the marked lock target on the priest's killed list").toBe(false);
  }finally{
    await live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(id)}];if(m)remove_monster(m,{method:'disappear',nospawn:true});return true;})()`).catch(()=>{});
    await live.post('/focus',{monsterFocus:['bee'],monsterPriorities:{},monsterSearchRadius:400}).catch(()=>{});
  }
  await targetingHuntCase(live,info,geometry);
}

// TG41: the non-leader's own notice on its grouped lock target. The row sends the notice the
// priest's approach would send. The retire marks the plant and drops it as the priest's selection;
// the priest keeps the lock, and the plant never reaches its killed list. The red plant puts the
// plant on the killed list at the notice.
// The row plants its own goo on the shore cell, which both fighters reach. On the G1 plant the
// leader's own notice at its last level retires the lock for its mark's 10 s, and two runs saw that
// retire land between the priest's notice and the keep's read (the lock gone 250 ms after the
// warrior's last level both times). Here neither approach ends unreachable, so only the priest's
// notice is in play, and the leader's retire count is the premise that shows it.
async function targetingNonLeaderNotice(live:LiveGame,shore:{x:number;y:number},first:string){
  const [WR,PR]=fighters;
  await live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(first)}];if(m)remove_monster(m,{method:'disappear',nospawn:true});return true;})()`);
  await live.admin(`output=(()=>{for(const n of ${JSON.stringify(fighters)})transport_player_to(get_player(n),'main',[${shore.x},${shore.y}]);return true;})()`);
  const id=String(await live.admin(`output=(()=>{const m=new_monster('main',{type:'pinkgoo',position:[${shore.x},${shore.y}],radius:0,count:1},{temp:1});m.hp=m.max_hp=2000000;return m.id;})()`));
  const retiredOf=`(globalThis.__partyTargeting.records()||[]).filter(e=>e.kind==='retired'&&e.target===${JSON.stringify(id)}).length`;
  try{
    const lockNow=`(()=>{const q=globalThis.__partyGroupedCombat;return q&&q.target?String(q.target.id):null;})()`;
    await expect.poll(()=>live.clients[PR!]!.run(lockNow),{timeout:30_000,intervals:[250],message:"TG41: the plant becomes the priest's grouped lock"}).toBe(id).catch(()=>undefined);
    const tg41:any={id,lockAtNotice:await live.clients[PR!]!.run(lockNow)};
    tg41.sent=await live.clients[PR!]!.run(`(()=>{const id=${JSON.stringify(id)};if(${red('tg41')}){const r=globalThis.__partyTargeting.retire,n=r.notice;r.notice=function(v){n.call(this,v);partyRoleRunner.invalidateTarget(id);};}
      globalThis.__partyHooks.notify('targeting.unreachable',{character:character.name,target:id,why:'approach'});return Date.now();})()`);
    // The keep reads after the queue's next reply has reached the priest: two of its report intervals.
    const gap=Math.max(1000,...Object.values((await live.state()).characters as Record<string,any>).map(c=>Number(c?.reportIntervalMs)||0));
    await waitForGameplay(2*gap);
    tg41.keeps=await live.clients[PR!]!.run(`(()=>{const id=${JSON.stringify(id)},q=globalThis.__partyGroupedCombat;return {lock:q&&q.target?String(q.target.id):null,own:character.target?String(character.target):null,kept:(q&&q.target&&String(q.target.id)===id)||String(character.target)===id};})()`);
    tg41.retired=await live.clients[PR!]!.run(retiredOf);
    tg41.ownRetires={[WR!]:await live.clients[WR!]!.run(retiredOf),[PR!]:tg41.retired-1};
    tg41.knownDead=await live.clients[PR!]!.run(`!!(globalThis.partyRoleRunner&&globalThis.partyRoleRunner.isKnownDead&&globalThis.partyRoleRunner.isKnownDead(${JSON.stringify(id)}))`);
    return tg41;
  }finally{
    await live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(id)}];if(m)remove_monster(m,{method:'disappear',nospawn:true});return true;})()`).catch(()=>{});
  }
}

// The Hunt case: the live finding of 2026-11-01 in
// the form this table can plant. The plant, a bee, stands on the same deep ground and walks between
// the point and its drift cell every 1.5 s, as the ghost drifted through the forest's collision
// lines. Both fighters hold a bee quest and the Hunt starts from the bee field, whose own bees are
// gone for the case, so the plant is the Hunt's one nearby hunt monster (a pinkgoo quest has
// no Hunt destination, so the Hunt skipped its mission). The warrior's client counts every
// `smart_move` whose goal lies within 250 units of the plant: the live finding's 80 to 154 a minute
// were those requests. The retire is built only if this case re-approaches.
const MOVES=`(()=>{const h=globalThis;if(!h.__e2eG1mWrap){h.__e2eG1mWrap=h.smart_move;h.smart_move=function(d,...rest){
  try{const q=h.__e2eG1m,m=q&&parent.entities[q.id];if(q&&m&&d&&typeof d==='object'&&Number.isFinite(Number(d.x))&&Math.hypot(Number(d.x)-m.x,Number(d.y)-m.y)<=250)q.calls.push(Date.now());}catch(e){}
  return h.__e2eG1mWrap.call(this,d,...rest);};}return true;})()`;
const movesReport=`(()=>{const q=globalThis.__e2eG1m;if(!q)return null;const c=q.calls,span=Math.max(1,Date.now()-q.started);let burst=0;
  for(let i=0;i<c.length;i++){let j=i;while(j<c.length&&c[j]-c[i]<10000)j++;burst=Math.max(burst,j-i);}
  return {requests:c.length,perMinute:Math.round(c.length*60000/span*10)/10,maxPer10s:burst,first:c.length?c[0]-q.started:null,last:c.length?c.at(-1)-q.started:null};})()`;
const centre=(a:any)=>a.boundary?{x:(a.boundary[0]+a.boundary[2])/2,y:(a.boundary[1]+a.boundary[3])/2}:{x:Number(a.x),y:Number(a.y)};
async function targetingHuntCase(live:LiveGame,info:TestInfo,geometry:any){
  const P=geometry.point as {x:number;y:number},D=(geometry.drift||geometry.point) as {x:number;y:number};
  const [W]=fighters;
  const field=geometry.field as {x:number;y:number};
  const removed=await live.admin(`output=(()=>{let n=0;for(const m of Object.values(instances.main.monsters))if(m.type==='bee'&&Math.hypot(m.x-${field.x},m.y-${field.y})<=900){remove_monster(m,{method:'disappear',nospawn:true});n++;}return n;})()`);
  const id=String(await live.admin(`output=(()=>{const m=new_monster('main',{type:'bee',position:[${P.x},${P.y}],radius:0,count:1},{temp:1});m.hp=m.max_hp=2000000;m.aggro=0;m.peaceful=true;
    const a={x:${P.x},y:${P.y}},b={x:${D.x},y:${D.y}};let to=b;globalThis.__e2eDrift=setInterval(()=>{if(m.dead||!instances.main.monsters[m.id])return clearInterval(globalThis.__e2eDrift);
      m.going_x=to.x;m.going_y=to.y;start_moving_element(m);to=to===a?b:a;},1500);return m.id;})()`));
  const result:any={id,point:P,drift:D,removed};
  try{
    for(const n of fighters){await live.clients[n]!.run(instrument(id));await live.clients[n]!.run(`(globalThis.__e2eG1m={id:${JSON.stringify(id)},calls:[],started:Date.now()},true)`);await live.clients[n]!.run(MOVES);}
    await live.post('/focus',{monsterFocus:['bee'],monsterPriorities:{},monsterSearchRadius:RADIUS});
    await live.admin(`output=${JSON.stringify(fighters)}.map(name=>{const p=get_player(name);p.s.monsterhunt={sn:region+' '+server_name,id:'bee',c:500,ms:1800000};resend(p,'u+cid+reopen');return p.s.monsterhunt})`);
    await expect.poll(async()=>{const s=await live.state();return fighters.every(n=>s.characters[n]?.monsterHunt?.id==='bee');},{timeout:30_000,message:'G1 Hunt: both quests reach the console'}).toBe(true);
    // The fighters start the Hunt from the reachable cell nearest the plant, so the plant is in
    // their view when the Hunt's travel starts (from the field centre the travel once reached its
    // spawn with the plant out of view, and nothing engaged it).
    const near=geometry.shore as {x:number;y:number};
    await live.admin(`output=(()=>{for(const n of ${JSON.stringify(fighters)})transport_player_to(get_player(n),'main',[${near.x},${near.y}]);return true;})()`);
    await expect.poll(()=>live.clients[W!]!.run(`!!parent.entities[${JSON.stringify(id)}]`),{timeout:20_000,message:'G1 Hunt: the warrior sees the plant'}).toBe(true);
    const location=farmingAreas((await live.state(true)).monsterChoices,['bee']).filter((a:any)=>a.map==='main')
      .sort((a:any,b:any)=>Math.hypot(centre(a).x-field.x,centre(a).y-field.y)-Math.hypot(centre(b).x-field.x,centre(b).y-field.y))[0];
    result.hunt=await live.post('/farming-mode',{character:W,mode:'hunt',backup:{monsterFocus:['bee'],location}}).then(r=>r.status?.()??r).catch((e:unknown)=>String(e));
    const started=Date.now();
    await expect.poll(async()=>Date.now()-started,{timeout:OBSERVE_MS+30_000,intervals:[5_000]}).toBeGreaterThan(OBSERVE_MS);
    result.retired=await live.clients[W!]!.run(`(globalThis.__partyTargeting?.records?.()||[]).filter(e=>e.kind==='retired'&&e.target===${JSON.stringify(id)}&&e.why==='approach').length`);
    // The queue's lost targets as the warrior's last reply delivered them.
    result.lost=await live.clients[W!]!.run(`(globalThis.__partyGroupedCombat?.lostTargets||[]).filter(t=>String(t.id)===${JSON.stringify(id)}).map(t=>t.reason)`);
    result.readings=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,{approach:await live.clients[n]!.run(report),moves:await live.clients[n]!.run(movesReport)}])));
    const state=await live.state();
    result.logs=Object.fromEntries(fighters.map(n=>[n,(state.combatLogs?.[n]||[]).slice(-25).map((l:any)=>[l.at-started,l.type,l.message])]));
    result.plant=await live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(id)}];return m?{x:m.x,y:m.y,hp:m.hp,target:m.target||null}:null;})()`);
    result.monsterHunt=state.monsterHunt??null;
  }catch(error){result.error=String(error).slice(0,400);}
  finally{
    await live.admin(`output=(()=>{clearInterval(globalThis.__e2eDrift);const m=instances.main.monsters[${JSON.stringify(id)}];if(m)remove_monster(m,{method:'disappear',nospawn:true});
      for(const name of ${JSON.stringify(fighters)}){const p=get_player(name);delete p.s.monsterhunt;resend(p,'u+cid+reopen');}return true;})()`).catch(()=>{});
    await live.post('/farming-mode',{character:W,combatMode:'default',targetMode:'farming'}).catch(()=>{});
    await live.post('/focus',{monsterFocus:['bee'],monsterPriorities:{},monsterSearchRadius:400}).catch(()=>{});
  }
  console.log('TARGETING-G1-HUNT '+JSON.stringify(result).slice(0,60_000));
  await info.attach('targeting-g1-hunt',{body:JSON.stringify(result),contentType:'application/json'});
  expect.soft(result.error,'G1 Hunt: the readings ran').toBeUndefined();
  // The live finding's case: the approach climbs to its last level and its notice
  // reaches targeting, with no killed-list entry. The plant is the grouped lock, whose finder reads
  // no mark; on b9b5c91e the warrior re-approached it 77 times after the last
  // level, 56 on 765be219 and 71 on the step 3 build.
  const w=result.readings?.[W!]?.approach,p=result.readings?.[fighters[1]!]?.approach;
  // The re-approach half (decided 2026-11-09): the leader's notice retires the lock
  // as a lost target with the reason "unreachable", and its failed-approach mark keeps the plant out
  // of its nominations for 10 s, so no approach to the plant starts inside the mark after the last
  // level. A later approach, once the mark lapses, is today's 10 s window.
  // The mark ends at its own expiry, which the leader's notice carries: the 50 ms sampler reads the
  // unreachable phase up to one sample after the mark starts, so an approach at the expiry fell
  // inside a window counted from that reading (in one run the mark was set at 9501 ms, read at
  // 9502, the next approach at 19501). With no notice read, the window is 10 s from the reading.
  const markEnds=w?.markUntil??(w?.unreachableAt==null?null:w.unreachableAt+SET_ASIDE_MS);
  const inMark=w?.unreachableAt==null?null:(w.approaches||[]).filter((a:any)=>a.first>w.unreachableAt&&a.first<markEnds).length;
  expect.soft(result.lost??[],'TG13: the queue retires the unreachable lock').toContain('unreachable');
  expect.soft(inMark,'TG13: no approach to the plant inside the mark after the last level').toBe(0);
  expect.soft(w?.unreachableAt??null,"TG13: the warrior's approach to the plant reaches its last level").not.toBeNull();
  expect.soft(result.retired??0,"TG13: the approach's notice reaches the warrior's retire").toBeGreaterThan(0);
  expect.soft(w?.knownDead,'TG13: the retire puts the plant on the killed list').toBe(false);
  // A marked target comes back. The plant stays the Hunt's monster,
  // so once its mark lapses the warrior approaches it again (one run saw 54 approaches in the 82 s
  // after the last level).
  const afterMark=w?.unreachableAt==null?null:(w.approaches||[]).filter((a:any)=>a.first>=markEnds).length;
  expect.soft(afterMark,'TG15: approaches to the plant once its mark lapses').toBeGreaterThan(0);
  // TG41's live half: the plant never reaches the priest's killed list either.
  expect.soft(p?.knownDead,"TG41: the plant is on the priest's killed list").toBe(false);
}

// TG11 and TG39, at the bee field after its windows: a
// sparkbot planted on the priest, the table's magical fighter. With no list entry the priest
// basic-attacks it, as today. Once its "Don't hit with magic" list gains sparkbot, no priest basic
// attack goes to it from the reply that delivers the list, and the turns ring names the refusal
//. After a CODE reload the list still blocks it. With sparkbot off the list again the
// attacks resume. The plant's attack is 1, so the reflected hits are the priest's own damage.
const REFUSAL='Monster reflection: magical basic attacks disabled',HOLD_MS=8_000;
const priestAttacks=(id:string,from:number)=>`(()=>{const l=parent.__e2eTurns;return l?l.spends.filter(s=>s.method==='attack'&&String(s.id)===${JSON.stringify(id)}&&s.at>=${from}).length:-1;})()`;
export async function reflectListRow(live:LiveGame,info:TestInfo){
  const result:any={};
  const clock=()=>live.clients[P]!.run('Date.now()') as Promise<number>;
  const lists=()=>live.clients[P]!.run('globalThis.__partyTargeting?globalThis.__partyTargeting.reflect():null') as Promise<{magic:string[];physical:string[]}|null>;
  const write=(value:unknown,character?:string)=>live.post('/settings',{changes:[{field:'reflectMagicByCharacter',value,...(character?{character}:{})}]});
  const id=await live.admin(`output=(()=>{const p=get_player('${P}'),m=new_monster(p.in,{type:'sparkbot',position:[p.x+60,p.y],radius:0,count:1},{temp:1});
    m.hp=m.max_hp=100000000;m.attack=1;target_player(m,p);return String(m.id);})()`) as string;
  const plant=()=>live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(id)}];return m?{hp:m.hp,target:m.target||null}:null;})()`).catch(()=>null);
  try{
    result.defaults=await lists();
    let from=await clock();
    await expect.poll(()=>live.clients[P]!.run(priestAttacks(id,from)),{timeout:60_000,message:'TG11: with no entry the priest attacks the sparkbot'}).toBeGreaterThan(0);
    await write(['sparkbot'],P);
    await expect.poll(async()=>(await lists())?.magic??[],{timeout:20_000,message:'TG11: the next reply delivers the list'}).toEqual(['sparkbot']);
    from=await clock();
    await new Promise(r=>setTimeout(r,HOLD_MS));
    result.blocked={attacks:await live.clients[P]!.run(priestAttacks(id,from)),plant:await plant(),
      refusals:await live.clients[P]!.run(`(globalThis.__partyTurns?.records?.()??[]).filter(r=>r.kind==='refusal'&&r.reason===${JSON.stringify(REFUSAL)}).length`)};
    // TG39: a CODE reload of the priest keeps the edited list.
    const runtime=(await live.state()).characters[P]?.dashboardRuntime;
    await reloadCode(live,P);
    await expect.poll(async()=>{const s=await live.state();return s.characters[P]?.dashboardRuntime!==runtime&&s.characters[P]?.seenAt>Date.now()-5000;},
      {timeout:60_000,message:'TG39: the priest runs its reloaded CODE'}).toBe(true);
    await live.clients[P]!.run('(delete parent.__e2eTurns,true)');await live.clients[P]!.run(spendLog);
    await expect.poll(async()=>(await lists())?.magic??[],{timeout:20_000,message:'TG39: the reloaded runtime reads the edited list'}).toEqual(['sparkbot']);
    from=await clock();
    await new Promise(r=>setTimeout(r,HOLD_MS));
    result.reloaded={attacks:await live.clients[P]!.run(priestAttacks(id,from)),plant:await plant()};
    // Off the list again (the defaults' three monsters), the attacks resume.
    await write(['slenderman','tiger','goblin'],P);
    await expect.poll(async()=>(await lists())?.magic??[],{timeout:20_000}).toEqual(['slenderman','tiger','goblin']);
    from=await clock();
    await expect.poll(()=>live.clients[P]!.run(priestAttacks(id,from)),{timeout:60_000,message:'TG11: off the list the attacks resume'}).toBeGreaterThan(0);
    result.resumed=true;result.resumedPlant=await plant();
  }catch(error){result.error=String(error).slice(0,400);}
  finally{
    await write({}).catch(()=>{});
    await live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(id)}];if(m)remove_monster(m,{method:'disappear',nospawn:true});return true;})()`).catch(()=>{});
  }
  await info.attach('targeting-reflect-list',{body:JSON.stringify(result,null,2),contentType:'application/json'});
  console.log('TARGETING-REFLECT '+JSON.stringify(result));
  expect.soft(result.error,'TG11: the reflect list readings ran').toBeUndefined();
  expect.soft(result.defaults,"TG9: the priest's defaults are today's monsters").toEqual({magic:['slenderman','tiger','goblin'],physical:['porcupine']});
  expect.soft(result.blocked?.plant?.hp??0,'TG11: the sparkbot lives through the blocked reading').toBeGreaterThan(0);
  expect.soft(result.reloaded?.plant?.hp??0,'TG39: the sparkbot lives through the reloaded reading').toBeGreaterThan(0);
  expect.soft(result.blocked?.attacks,'TG11: no priest basic attack on the sparkbot once its list holds it').toBe(0);
  expect.soft(result.blocked?.refusals,'TG11 (WP2): the turns ring names the reflection refusal').toBeGreaterThan(0);
  expect.soft(result.reloaded?.attacks,'TG39: after a CODE reload the edited list still blocks it').toBe(0);
  expect.soft(result.resumed,'TG11: off the list the attacks resume').toBe(true);
}

// A porcupine selected by the warrior, a melee class,
// sends its `change_target` only after the call budget's survival question. The warrior's client
// logs each band question and each `target` emit for the one selection.
export async function porcupineTargetCall(live:LiveGame){
  const id=await live.admin(`output=(()=>{const p=get_player('${W}'),m=new_monster(p.in,{type:'porcupine',position:[p.x+30,p.y],radius:0,count:1},{temp:1});
    m.attack=1;return String(m.id);})()`) as string;
  try{
    await expect.poll(()=>live.clients[W]!.run(`!!parent.entities[${JSON.stringify(id)}]`),{timeout:20_000,message:'TG8: the warrior sees the porcupine'}).toBe(true);
    const log=await live.clients[W]!.run(`(()=>{const h=globalThis.__partyHooks,s=parent.socket,log=[],band=h.calls.band,emit=s.emit;
      h.calls.band=function(q){const a=band.call(this,q);log.push(['band',q.band,q.method,q.data&&q.data.id,a]);return a;};
      s.emit=function(method,...rest){if(method==='target')log.push(['emit',method,rest[0]&&rest[0].id]);return emit.call(this,method,...rest);};
      try{sharedRoutine.targeting.setCombatTarget(parent.entities[${JSON.stringify(id)}]);}finally{h.calls.band=band;s.emit=emit;}
      return log;})()`) as unknown[][];
    console.log('TARGETING-TG8 '+JSON.stringify(log));
    expect(log.filter(e=>e[0]==='emit'||e[2]==='target'),'TG8: the target call asks the survival band, then sends').toEqual([['band','survival','target',id,'send'],['emit','target',id]]);
  }finally{
    await live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(id)}];if(m)remove_monster(m,{method:'disappear',nospawn:true});return true;})()`).catch(()=>{});
  }
}

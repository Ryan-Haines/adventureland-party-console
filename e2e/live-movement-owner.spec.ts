import {test,expect,defaultFixtureReset,type LiveGame} from './live-fixtures';
import type {TestInfo} from '@playwright/test';
import {liveScenarioTable} from './scenario-table';
import {rowSetup,settleNavigation} from './movement-owner-helpers';
import {fighters} from './game/hunt-lifecycle';
import {farmWalkRow,walkLadderRow} from './movement-walks-rows';
import {gooWindowsRow} from './movement-steps-rows';
import {beeFieldRow} from './movement-step-safety-row';
import {up1Row,cantJoinRow,deathReset} from './event-death-rejoin-rows';
import {up3Row} from './movement-death-after-end-rows';
import {e1Row,m2Row,pauseHeadlessRow} from './user-holds-rows';
import {taskRecords} from './task-records';
import {handoffRows,rendezvousRows} from './event-checkpoint-rows';
import {convoyInterruptionRow,goobrawlRows} from './live-game-rows';
import {controlsRow,interruptionRows,merchantRows} from './hunt-rows';
import {cavePacingRow} from './cave-pacing-row';
import {rows as addonRows} from '../.build/addons/tests';
import {burstsRow,survivalRow,forcedLimitdcRow,rowUndoRow} from './call-budget-rows';
import {turnsSlotRow,turnsPotionRow,spendLog} from './turns-rows';
import {survivalNeedsRow} from './survival-rows';
import {targetingRetireRow} from './targeting-rows';
// The movement records (design section 7), merged here in the step 8c prune from
// live-movement-records.spec.ts and moved onto the owner in step 10, when the off and compare
// cases went: a typed call names its call site, every end code is one of the fixed list, the
// ring keeps its bound of 128 in sequence, records() hands out copies, and no status body
// carries the ring. Failure inventory: e2e/movement-owner-failures.md "Step 1" and "Step 10".
const W='E2EWarrior';
// The farming window that measured the owner's cost per call here (steps 2 and 4) is
// merged into the Goo windows row (movement-steps-rows.ts), whose windows measure the same goo farm with the
// cost per call, moves and errors (step 8c prune, duplicate).
async function recordsRow(live:LiveGame,info:TestInfo){
  const client=await rowSetup(live,W);
  const statusBodies:unknown[]=[],statusReplies:string[]=[];
  await client.page.route('**/party-api/status',async route=>{const body=route.request().postDataJSON();if(body?.name===W)statusBodies.push(body);await route.continue();});
  // The heartbeat replies, read beside the route: a second handler of the same request fails it.
  const reply=async(response:import('@playwright/test').Response)=>{if(!response.url().endsWith('/party-api/status'))return;
    try{if(response.request().postDataJSON()?.name===W)statusReplies.push(await response.text());}catch{/* A reply with no body. */}};
  client.page.on('response',reply);
  live.undo(`the status route and reply listener on ${W}`,async()=>{client.page.off('response',reply);await client.page.unroute('**/party-api/status');});
  const points=await client.run(`(()=>{const c=character,found=[];for(let i=0;i<16&&found.length<2;i++){const a=i*Math.PI/8,x=c.real_x+250*Math.cos(a),y=c.real_y+250*Math.sin(a);if(can_move({map:c.map,x:c.real_x,y:c.real_y,going_x:x,going_y:y,base:c.base}))found.push({map:c.map,x,y});}if(found.length<2)throw Error('No two clear points');return found;})()`);
  const [a,b]=points as {map:string;x:number;y:number}[];
  await info.attach('declared-points',{body:JSON.stringify(points),contentType:'application/json'});
  const walking=async()=>await client.run('!!character.moving');
  const records=async()=>await client.run('__partyMovement.records()') as any[];
  // A follow walk, then code typed in the game client: it names no requester and ranks as the
  // player's command (step 4 correction 9), so it replaces the follow walk, and the record
  // names its call site. (A dashboard travel shares the player's identity, so a typed call
  // retargets it in place instead, design section 2.3.)
  // Both calls go in one evaluation: on virtual time the 250-unit follow walk can arrive between
  // two CDP calls, and an arrived journey has nothing left to replace (step 11 found it as the
  // records case's rerun-only pass).
  const first=await client.run(`(()=>{smart_move(${JSON.stringify(a)},undefined,{request:{kind:'follow',owner:'follow'}}).catch(()=>{});
    const id=__partyMovement.report().id;smart_move(${JSON.stringify(b)}).catch(()=>{});return id;})()`) as string;
  await expect.poll(walking,{timeout:15_000}).toBe(true);
  const ended=async(id:string)=>(await records()).find(entry=>entry.decision==='ended'&&entry.journeyId===id);
  await expect.poll(async()=>(await ended(first))?.code,{timeout:15_000}).toBe('replaced:manual');
  const replaced=await ended(first);
  expect(replaced.by.kind).toBe('manual');expect(String(replaced.by.site).length).toBeGreaterThan(0);
  // Step 1 item 1: every journey has one started entry and, once it ends, one ended entry. The
  // check reads the ring before the fill below pushes these entries out.
  const early=await records();
  const count=(id:string,decision:string)=>early.filter(entry=>entry.journeyId===id&&entry.decision===decision).length;
  const journeys=[...new Set(early.filter(entry=>entry.decision==='started').map(entry=>entry.journeyId))];
  expect(journeys,'journeys started in the case').toContain(first);
  for(const id of journeys){expect(count(id,'started'),id+' started').toBe(1);expect(count(id,'ended'),id+' ended').toBeLessThanOrEqual(1);}
  expect(count(first,'ended'),'the replaced journey ended').toBe(1);
  // 150 lower-ranked asks fill the decision ring to its bound of 128, in sequence.
  await client.run(`(()=>{const a=${JSON.stringify(a)},b=${JSON.stringify(b)};for(let i=0;i<150;i++)smart_move(i%2?a:b,undefined,{request:{kind:'follow',owner:'fill:'+i}}).catch(()=>{});return true;})()`);
  const bounded=await records();
  await info.attach('service-records',{body:JSON.stringify(bounded),contentType:'application/json'});
  expect(bounded).toHaveLength(128);
  bounded.forEach((entry,index)=>{if(index)expect(entry.seq).toBe(bounded[index-1].seq+1);});
  for(const entry of [replaced,...bounded.filter(entry=>entry.decision==='ended')])
    expect(entry.code).toMatch(/^(arrived|released|superseded|runtime-replaced|expired|stale|(replaced|stopped):[a-z-]+(:[a-z0-9-]+)?|failed:[a-z0-9-]+)$/);
  expect(await client.run(`(()=>{const copy=__partyMovement.records();copy[0].code='mutated';copy.length=0;return __partyMovement.records()[0].code;})()`)).toBe(bounded[0].code);
  await expect.poll(()=>statusBodies.length,{timeout:15_000}).toBeGreaterThan(0);
  const keys=(value:unknown,found:Set<string>)=>{if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){found.add(key);keys(child,found);}return found;};
  const fields=keys(statusBodies,new Set());
  expect(fields.has('ring')).toBe(false);expect(fields.has('records')).toBe(false);
  // Groups and tasks step 2: the group ring's bound, its
  // snapshot triggers and its absence from the heartbeat and the state, on the same leader.
  await taskRecords(live,W,()=>statusReplies);
  await client.run('stop()');
}

// Step 4: the owner on for journeys. Failure inventory: e2e/movement-owner-failures.md,
// "Step 4". The movement owner counts a walk as arrived within ARRIVAL_TOLERANCE
// (runtime/protocol/ladder.ts).
import {ARRIVAL_TOLERANCE} from '../runtime/protocol/ladder.ts';
// Counts native stop packets: a move to where the character already stands (runner `stop`).
const stopPackets=`(()=>{if(!globalThis.__e2eStops){const s=globalThis.__e2eStops={count:0},original=globalThis.move;
  globalThis.move=function(x,y){if(Math.hypot(x-character.real_x,y-character.real_y)<1)s.count++;return original(x,y);};}return globalThis.__e2eStops.count;})()`;
async function rankedRow(live:LiveGame,info:TestInfo){
    const client=await rowSetup(live,W);
    await client.run(stopPackets);
    const stops=async()=>await client.run('globalThis.__e2eStops.count') as number;
    // Three points with clear straight lines between every pair, for the retarget case.
    const {o,a,b}=await client.run(`(()=>{const c=character,clear=(p,q)=>can_move({map:c.map,x:p.x,y:p.y,going_x:q.x,going_y:q.y,base:c.base});
      const o={map:c.map,x:c.real_x,y:c.real_y},found=[];
      for(let i=0;i<16&&found.length<2;i++){const t=i*Math.PI/8,p={map:c.map,x:o.x+250*Math.cos(t),y:o.y+250*Math.sin(t)};
        if(clear(o,p)&&clear(p,o)&&found.every(q=>clear(q,p)&&clear(p,q)))found.push(p);}
      if(found.length<2)throw Error('No three pairwise clear points');return {o,a:found[0],b:found[1]};})()`) as Record<'o'|'a'|'b',{map:string;x:number;y:number}>;
    await info.attach('declared-points',{body:JSON.stringify({o,a,b}),contentType:'application/json'});
    const journey=async()=>await client.run('__partyMovement.report()?.id ?? null') as string|null;
    const walking=async()=>await client.run('!!character.moving');
    const records=async()=>await client.run('__partyMovement.records()') as any[];
    const ended=async(id:string)=>(await records()).find(entry=>entry.decision==='ended'&&entry.journeyId===id);
    const code=async(id:string)=>(await ended(id))?.code;
    // Asks from the CODE frame and keeps the promise outcome: `arrived` or the rejection's code.
    // `gated` gives the walk a convoy gate that rides on its own journey.
    const ask=async(destination:unknown,request?:Record<string,unknown>,gated=false)=>await client.run(`(()=>{const id='ask'+Math.random(),asks=globalThis.__e2eAsk||={};asks[id]='pending';
      smart_move(${JSON.stringify(destination)},undefined,${request?`{request:${JSON.stringify(request)}${gated?',gate:{tick(){__partyMovement.tick();}}':''}}`:'undefined'}).then(()=>asks[id]='arrived',e=>asks[id]=e&&e.code||String(e&&e.message||e));
      return {id,journey:__partyMovement.report()?.id??null};})()`) as {id:string;journey:string|null};
    const outcome=async(id:string)=>await client.run(`globalThis.__e2eAsk[${JSON.stringify(id)}]`);
    const travel=async(location:unknown)=>{
      const prior=await journey();
      await live.post('/command',{character:W,type:'character-travel',location,label:'Movement owner on'});
      await expect.poll(async()=>{const id=await journey();return id&&id!==prior?id:null;},{timeout:15_000}).toBeTruthy();
      return (await journey())!;
    };
    const near=async(p:{x:number;y:number})=>await client.run(`Math.hypot(character.real_x-(${p.x}),character.real_y-(${p.y}))`) as number;
    const reached=async(p:{x:number;y:number})=>{await expect.poll(async()=>!(await walking())&&await near(p)<=ARRIVAL_TOLERANCE,{timeout:60_000}).toBe(true);};

    // Items 1 and 2: lower requests and foreign stops leave the dashboard travel walking.
    const first=await travel(a);
    await expect.poll(walking,{timeout:15_000}).toBe(true);
    const beforeStops=await stops();
    const approach=await ask(b,{kind:'approach',owner:'approach:e2e'});
    const follow=await ask(b,{kind:'follow',owner:'follow'});
    await client.run(`stop(undefined,undefined,{kind:'follow',owner:'follow'})`);
    await client.run(`stop('smart',undefined,{kind:'approach',owner:'approach:e2e'})`);
    expect(await stops(),'stop packets for refused requests and stops').toBe(beforeStops);
    expect(await journey()).toBe(first);
    await expect.poll(async()=>[await outcome(approach.id),await outcome(follow.id)]).toEqual(['refused','refused']);
    await expect.poll(async()=>await code(first),{timeout:60_000}).toBe('arrived');
    const onFirst=(await records()).filter(entry=>entry.journeyId===first&&['refused','refused-stop'].includes(entry.decision));
    expect(onFirst.map(entry=>[entry.decision,entry.by?.kind])).toEqual([['refused','approach'],['refused','follow'],['refused-stop','follow'],['refused-stop','approach']]);
    await reached(a);

    // Item 3: the same owner asking for the same place keeps its journey.
    const request={kind:'manual',owner:'e2e-owner'};
    const keep1=await ask(b,request);
    await expect.poll(walking,{timeout:15_000}).toBe(true);
    const keptStops=await stops();
    const keep2=await ask(b,request);
    expect(keep2.journey).toBe(keep1.journey);
    expect(await stops()).toBe(keptStops);
    await expect.poll(async()=>[await outcome(keep1.id),await outcome(keep2.id)],{timeout:60_000}).toEqual(['arrived','arrived']);
    expect((await records()).filter(entry=>entry.journeyId===keep1.journey).map(entry=>entry.decision)).toEqual(['started','kept','ended']);
    await reached(b);

    // Item 4: the same owner's new point on a clear line retargets the live journey.
    const retarget1=await ask(a,request);
    await expect.poll(walking,{timeout:15_000}).toBe(true);
    const retargetStops=await stops();
    const retarget=await client.run(`(()=>{const c=character,o=${JSON.stringify(o)};
      const clear=can_move({map:c.map,x:c.real_x,y:c.real_y,going_x:o.x,going_y:o.y,base:c.base});
      const id='ask'+Math.random(),asks=globalThis.__e2eAsk;asks[id]='pending';
      smart_move(o,undefined,{request:${JSON.stringify(request)}}).then(()=>asks[id]='arrived',e=>asks[id]=e&&e.code||String(e&&e.message||e));
      return {clear,id,journey:__partyMovement.report()?.id??null};})()`);
    expect(retarget.clear,'precondition: the line to the new point is clear').toBe(true);
    expect(retarget.journey).toBe(retarget1.journey);
    expect(await stops()).toBe(retargetStops);
    await expect.poll(async()=>[await outcome(retarget1.id),await outcome(retarget.id)],{timeout:60_000}).toEqual(['arrived','arrived']);
    await reached(o);
    expect((await records()).filter(entry=>entry.journeyId===retarget1.journey).map(entry=>entry.decision)).toEqual(['started','retargeted','ended']);

    // Item 5: a group walk asked below a dashboard travel waits and starts where the travel ended.
    const manual=await travel(b);
    await expect.poll(walking,{timeout:15_000}).toBe(true);
    // A convoy's gate rides on its walk's journey, so the travel keeps its scheduler while
    // the walk waits (the shared slot once took it).
    const walk=await ask(a,{kind:'group-walk',owner:'walk:e2e:1',tier:'hunt-mission'},true);
    expect(walk.journey).toBe(manual);
    expect((await records()).some(entry=>entry.decision==='waiting'&&entry.owner==='walk:e2e:1')).toBe(true);
    await expect.poll(async()=>await code(manual),{timeout:60_000}).toBe('arrived');
    await expect.poll(async()=>await outcome(walk.id),{timeout:60_000}).toBe('arrived');
    const manualEnd=(await ended(manual))!;
    const resumed=(await records()).find(entry=>entry.decision==='started'&&entry.owner==='walk:e2e:1');
    expect(resumed.at).toBeGreaterThanOrEqual(manualEnd.at);
    expect(Math.hypot(resumed.from.x-b.x,resumed.from.y-b.y),'the waiting walk starts where the travel ended').toBeLessThanOrEqual(ARRIVAL_TOLERANCE);
    await reached(a);
    // A waiting walk whose navigation revision changes expires before it starts.
    await travel(b);
    await expect.poll(walking,{timeout:15_000}).toBe(true);
    const stale=await ask(o,{kind:'group-walk',owner:'walk:e2e:2',tier:'hunt-mission'});
    // A second dashboard travel changes the navigation revision.
    const next=await travel(o);
    await expect.poll(async()=>await outcome(stale.id),{timeout:15_000}).toBe('expired');
    expect((await records()).filter(entry=>entry.owner==='walk:e2e:2').map(entry=>entry.decision)).toEqual(['waiting','expired']);
    await expect.poll(async()=>await code(next),{timeout:60_000}).toBe('arrived');
    await reached(o);

    // Item 6: a hold refuses lower requests until it is released.
    expect(await client.run(`__partyMovement.hold({kind:'town',owner:'e2e-town'})`)).toBe('granted');
    const held=await ask(b,{kind:'follow',owner:'follow'});
    await expect.poll(async()=>await outcome(held.id)).toBe('refused');
    expect(await client.run(`__partyMovement.release('e2e-town')`)).toBe(true);
    const freed=await ask(b,{kind:'follow',owner:'follow'});
    expect(freed.journey).toBeTruthy();
    await expect.poll(walking,{timeout:15_000}).toBe(true);
    await client.run(`stop(undefined,undefined,{kind:'follow',owner:'follow'})`);
    await expect.poll(async()=>await code(freed.journey!)).toBe('released');

    // Item 8 (step 4 correction 9, step 10): every console caller names its requester, so a
    // call with none is code the player typed, and it ranks as the player's command. It
    // replaces a lower walk, a newer typed call replaces the older, and its stop is the holder's.
    const lower=await ask(a,{kind:'follow',owner:'follow'});
    await expect.poll(walking,{timeout:15_000}).toBe(true);
    const typed1=await ask(b);
    expect(typed1.journey).not.toBe(lower.journey);
    await expect.poll(async()=>await code(lower.journey!)).toBe('replaced:manual');
    const typed2=await ask(a);
    expect(typed2.journey).not.toBe(typed1.journey);
    await expect.poll(async()=>await code(typed1.journey!)).toBe('replaced:manual');
    await client.run('stop()');
    await expect.poll(async()=>await code(typed2.journey!)).toBe('released');
    // The maintainer's goal "nothing dropped silently": a replaced or failed request
    // hears its end with the cause; a refused one hears it above.
    // The replaced journey ends `replaced:manual` (above) and its caller hears the replacement.
    expect([await outcome(lower.id),await outcome(typed1.id)],'replaced requests hear their cause').toEqual(['Movement replaced by a new destination','Movement replaced by a new destination']);
    // main's geometry ends at x 2320 (data.js 17175), so no route reaches x 2600.
    const lost=await ask({map:'main',x:2600,y:0},{kind:'manual',owner:'e2e-unreachable'});
    await expect.poll(async()=>await outcome(lost.id),{timeout:60_000}).not.toBe('pending');
    expect(String(await outcome(lost.id)),'the failed request hears a cause').not.toMatch(/^(|arrived|undefined)$/);
    const lostEnd=(await records()).find((e:any)=>e.decision==='ended'&&e.owner==='e2e-unreachable');
    expect(String(lostEnd?.code),'the failed journey end names its failure').toMatch(/^failed:[a-z0-9-]+$/);
    await expect.poll(walking,{timeout:15_000}).toBe(false);
    await info.attach('service-records',{body:JSON.stringify(await records()),contentType:'application/json'});
    expect((await client.run('__partyMovement.ownerReport()')).errors).toBe(0);

    await clicks({live,client,travel,ask,outcome,records,code,walking,reached,near,a,o});
    await deadlines({client,travel,ask,outcome,records,code,walking,reached,a,b,o});

    await combatSteps({client,info,travel,ask,outcome,records,code,walking,reached,stops,a,b,o});
}

// A click to walk in the game client is the player's command.
// The headless client draws no map, so a click runs map_click's two steps (js/game.js): it
// calls the code page's on_map_click, as call_code_function does, and unless that answers true
// it walks with the game's own move packet.
async function clicks(t:any){
  const {live,client,travel,ask,outcome,records,code,walking,reached,near,a,o}=t;
  const click=async(p:{x:number;y:number})=>await client.run(`(()=>{const g=parent,c=g.character,x=${p.x},y=${p.y};
    if(typeof on_map_click==='function'&&on_map_click(x,y))return false;
    const m=typeof g.calculate_move==='function'?g.calculate_move(c,x,y):{x,y};
    c.from_x=c.real_x;c.from_y=c.real_y;c.going_x=m.x;c.going_y=m.y;c.moving=true;if(typeof g.calculate_vxy==='function')g.calculate_vxy(c);
    g.socket.emit('move',{x:c.real_x,y:c.real_y,going_x:c.going_x,going_y:c.going_y,m:c.m});return true;})()`);
  const clicking=async()=>await client.run('__partyMovement.clicking()') as {walking:boolean;remainingMs:number|null}|null;
  // The follow below ranks under the travel, so the travel must have ended, not only stopped
  // at o: a typed stop can leave the warrior standing on o, and that travel's journey then
  // lives until the owner sees it arrive (one run asked 141 ms before that and was refused).
  const home=await travel(o);await expect.poll(async()=>await code(home),{timeout:60_000}).toBe('arrived');await reached(o);
  // Item 9: the click pauses the lower walk, and its own walk is not fought.
  const follow=await ask(a,{kind:'follow',owner:'follow'});
  await expect.poll(async()=>await near(o),{timeout:15_000}).toBeGreaterThan(60);
  await click(o);
  // Lower requests wait for the click to finish.
  const lower=await ask(a,{kind:'approach',owner:'approach:click'});
  await expect.poll(async()=>await outcome(lower.id)).toBe('refused');
  await expect.poll(async()=>(await records()).some((e:any)=>e.decision==='paused'&&e.journeyId===follow.journey&&e.cause==='click')).toBe(true);
  // Item 11: after the walk the card counts down, then the paused walk resumes by itself. The
  // countdown runs on the game's clock, so the polls look often.
  const often={timeout:15_000,intervals:[50]};
  await expect.poll(async()=>(await clicking())?.walking,often).toBe(false);
  expect(await near(o),'the click walk reached its point').toBeLessThanOrEqual(ARRIVAL_TOLERANCE);
  await expect.poll(async()=>(await live.state()).characters.E2EWarrior?.activity?.text ?? '',often).toMatch(/^Your click - taking over in \d+ s$/);
  await expect.poll(async()=>(await records()).some((e:any)=>e.decision==='resumed'&&e.journeyId===follow.journey&&e.cause==='click'),{timeout:30_000}).toBe(true);
  expect(await clicking()).toBe(null);
  const ended=(await records()).find((e:any)=>e.decision==='ended'&&e.owner==='click');
  expect(ended?.code,'the countdown ends the click, never an open-ended pause').toBe('elapsed');
  await expect.poll(async()=>await code(follow.journey),{timeout:60_000}).toBe('arrived');
  await reached(a);
  expect(await walking()).toBe(false);
  // Item 17 (user, 2026-10-29): a click breaks the console's Town channel. The cast's hold ends
  // `interrupted:click`, the card says Town comes again, and after the countdown the same Town
  // request casts again by itself and lands.
  await live.post('/town-party',{});
  await expect.poll(async()=>await client.run('!!(character.c&&character.c.town)'),often).toBe(true);
  await click(o);
  await expect.poll(async()=>(await records()).some((e:any)=>e.decision==='ended'&&e.code==='interrupted:click'&&/^town:/.test(String(e.owner))),often).toBe(true);
  await expect.poll(async()=>(await live.state()).characters.E2EWarrior?.activity?.text ?? '',often).toMatch(/^Your click - casting Town again in \d+ s$/);
  // Landed is the server's word: its player has no Town channel and stands in the spawn's
  // scatter, and the client shows it there with the cast's hold released. The client drops its
  // own c.town when the channel's time runs out, before the server's teleport arrives, so the
  // client alone reads landed while it still stands where the click left it.
  // The click stood the warrior on o, inside the scatter, so the landing counts only after the cast again.
  await expect.poll(async()=>{const r=await records(),cut=r.findLastIndex((e:any)=>e.decision==='ended'&&e.code==='interrupted:click');
    return cut>=0&&r.slice(cut+1).some((e:any)=>e.decision==='crossing'&&e.code==='town'&&e.owner===r[cut].owner);},{timeout:30_000}).toBe(true);
  const server=async()=>await live.admin(`output=(()=>{const p=get_player('${W}'),s=G.maps.main.spawns[0];return {map:p.map,x:p.x,y:p.y,town:!!(p.c&&p.c.town),radius:Math.hypot(s[3]/2,s[3]/2),sx:s[0],sy:s[1]};})()`) as any;
  await expect.poll(async()=>{const p=await server();if(p.map!=='main'||p.town||Math.hypot(p.x-p.sx,p.y-p.sy)>Math.max(ARRIVAL_TOLERANCE,p.radius))return false;
    // A cast that keeps Town held after it lands is the requester casting again (endCode read
    // the click's end after the recast released, step the status owner's first build).
    return await client.run(`!character.moving&&__partyMovement.live()?.kind!=='town'&&Math.hypot(character.real_x-(${p.x}),character.real_y-(${p.y}))<=${ARRIVAL_TOLERANCE}`);},{timeout:60_000}).toBe(true);
  // The ring keeps its last 128 records, so a count of casts falls when an old one leaves it; the
  // check reads the casts after the landing's last one by sequence number.
  const townCasts=async()=>(await records()).filter((e:any)=>e.decision==='crossing'&&e.code==='town');
  const landedSeq=Math.max(0,...(await townCasts()).map((e:any)=>e.seq));
  // The state carries no Town cycle; a member's Town command of the cycle leaves the fast state's pending
  // commands when that member's membership ends, so the cycle is over once none is left.
  await expect.poll(async()=>{const pending=(await live.state('fast')).pendingCommands;expect(pending,'the fast state publishes pendingCommands').toBeDefined();
    return Object.values(pending).filter((c:any)=>c?.type==='town-party').length;},{timeout:30_000}).toBe(0);
  // The deadline rows start with a walk to a; Town lands at Main's spawn, which can be o itself.
  if(await near(o)>ARRIVAL_TOLERANCE)await travel(o);
  await reached(o);
  expect((await townCasts()).filter((e:any)=>e.seq>landedSeq),'no Town cast after the landing').toEqual([]);
}

// Step 8a items 5 to 7: e2e/movement-owner-failures.md "Step 8a". Deadlines, stale
// requests and the per-tick invariants, on the service clock the ring stamps.
// The movement tick (runtime/movement/rules.ts MOVEMENT_TICK_MS), which audits the owner.
import {MOVEMENT_TICK_MS as RUNNER_TICK_MS} from '../runtime/movement/rules.ts';
// The audit runs on each tick, so a deadline that falls after one is seen on the next.
const AUDIT_BOUND_MS=2*RUNNER_TICK_MS;
async function deadlines(t:any){
  const {client,travel,ask,outcome,records,code,walking,reached,a,b,o}=t;
  const now=async()=>await client.run('Date.now()') as number;
  const service=async(expression:string)=>await client.run(`__partyMovement.${expression}`);
  const entry=async(owner:string,decision:string)=>(await records()).find((r:any)=>r.owner===owner&&r.decision===decision);
  const invariants=async()=>(await service('ownerReport()')).invariants as {unowned:number;untimed:number;expired:number;stale:number};

  // Item 5: a hold ends at its deadline, and asking again moves the deadline.
  const t0=await now();
  expect(await service(`hold({kind:'death-recovery',owner:'e2e-hold',deadline:${t0+1000}})`)).toBe('granted');
  expect(await service(`hold({kind:'death-recovery',owner:'e2e-hold',deadline:${t0+2000}})`)).toBe('kept');
  await expect.poll(async()=>(await entry('e2e-hold','ended'))?.code,{timeout:15_000}).toBe('expired');
  const expired=(await entry('e2e-hold','ended')).at;
  expect(expired,'the renewed deadline holds').toBeGreaterThanOrEqual(t0+2000);
  expect(expired-(t0+2000),'ms from the deadline to the expiry').toBeLessThanOrEqual(AUDIT_BOUND_MS);
  expect(await service('live()')).toBe(null);
  // A waiting request with a deadline expires the same way.
  const travelling=await travel(a);
  await expect.poll(walking,{timeout:15_000}).toBe(true);
  const waitUntil=(await now())+1000;
  const late=await ask(b,{kind:'group-walk',owner:'walk:e2e:8a',tier:'hunt-mission',deadline:waitUntil});
  await expect.poll(async()=>await outcome(late.id),{timeout:15_000}).toBe('expired');
  const lateEnd=await entry('walk:e2e:8a','expired');
  expect(lateEnd.at-waitUntil,'ms from the waiting deadline to the expiry').toBeLessThanOrEqual(AUDIT_BOUND_MS);
  expect(lateEnd.at).toBeGreaterThanOrEqual(waitUntil);
  await expect.poll(async()=>await code(travelling),{timeout:60_000}).toBe('arrived');
  await reached(a);

  // Step 8c item 12: a holder asking again for its live journey, kept or retargeted, takes
  // the new deadline and the new currency test. Each ask names its own currency flag, so a
  // journey that still read the first ask's test would end `stale` when that flag drops.
  const renewAsk=async(p:unknown,deadline:number,flag:string)=>await client.run(`(()=>{globalThis[${JSON.stringify(flag)}]=true;const id='ask'+Math.random(),asks=globalThis.__e2eAsk;asks[id]='pending';
    smart_move(${JSON.stringify(p)},undefined,{request:{kind:'manual',owner:'e2e-renew',deadline:${deadline},current:()=>globalThis[${JSON.stringify(flag)}]}})
      .then(()=>asks[id]='arrived',e=>asks[id]=e&&e.code||String(e&&e.message||e));
    return {id,journey:__partyMovement.report()?.id??null};})()`) as {id:string;journey:string};
  const drop=async(flag:string)=>{await client.run(`globalThis[${JSON.stringify(flag)}]=false`);const at=await now();
    await expect.poll(async()=>await now()-at,{timeout:5_000}).toBeGreaterThanOrEqual(AUDIT_BOUND_MS);};
  const renewAt=await now(),first=await renewAsk(b,renewAt+60_000,'__e2eRenew1');
  await expect.poll(walking,{timeout:15_000}).toBe(true);
  const again=await renewAsk(b,renewAt+120_000,'__e2eRenew2');
  expect(again.journey).toBe(first.journey);
  expect((await service('live()')).deadline,'the kept journey carries the new deadline').toBe(renewAt+120_000);
  await drop('__e2eRenew1');
  expect((await service('live()'))?.owner,'the kept journey reads the new currency test').toBe('e2e-renew');
  await expect.poll(async()=>[await outcome(first.id),await outcome(again.id)],{timeout:60_000}).toEqual(['arrived','arrived']);
  expect((await records()).filter((r:any)=>r.journeyId===first.journey).map((r:any)=>[r.decision,r.code??null]))
    .toEqual([['started',null],['kept',null],['ended','arrived']]);
  await reached(b);
  // The retargeted journey: from b toward a, then a new point on a clear line, o.
  const toA=await renewAsk(a,(await now())+60_000,'__e2eRenew3');
  await expect.poll(walking,{timeout:15_000}).toBe(true);
  const clear=await client.run(`can_move({map:character.map,x:character.real_x,y:character.real_y,going_x:${o.x},going_y:${o.y},base:character.base})`);
  expect(clear,'precondition: the line to the new point is clear').toBe(true);
  const retargetAt=await now(),toO=await renewAsk(o,retargetAt+90_000,'__e2eRenew4');
  expect(toO.journey).toBe(toA.journey);
  expect((await service('live()')).deadline,'the retargeted journey carries the new deadline').toBe(retargetAt+90_000);
  await drop('__e2eRenew3');
  expect((await service('live()'))?.owner,'the retargeted journey reads the new currency test').toBe('e2e-renew');
  await client.run(`globalThis.__e2eRenew4=false`);
  await expect.poll(async()=>await code(toA.journey),{timeout:15_000}).toBe('stale');
  expect((await records()).filter((r:any)=>r.journeyId===toA.journey).map((r:any)=>r.decision)).toEqual(['started','retargeted','ended']);
  await expect.poll(walking,{timeout:15_000}).toBe(false);
  // Back to a, where the next case starts.
  const renewBack=await ask(a,{kind:'manual',owner:'e2e-renew'});
  await expect.poll(async()=>await outcome(renewBack.id),{timeout:60_000}).toBe('arrived');
  await reached(a);

  // Item 6: a journey whose request goes stale ends at once, and its caller hears it.
  const stale=await client.run(`(()=>{globalThis.__e2eStale=false;const id='ask'+Math.random(),asks=globalThis.__e2eAsk;asks[id]='pending';
    smart_move(${JSON.stringify(b)},undefined,{request:{kind:'death-recovery',owner:'e2e-stale',current:()=>!globalThis.__e2eStale}})
      .then(()=>asks[id]='arrived',e=>asks[id]=e&&e.code||String(e&&e.message||e));
    return {id,journey:__partyMovement.report()?.id??null};})()`) as {id:string;journey:string};
  await expect.poll(walking,{timeout:15_000}).toBe(true);
  const staleAt=await client.run('(()=>{globalThis.__e2eStale=true;return Date.now();})()') as number;
  await expect.poll(async()=>await code(stale.journey),{timeout:15_000}).toBe('stale');
  expect((await entry('e2e-stale','ended')).at-staleAt,'ms from going stale to the end').toBeLessThanOrEqual(AUDIT_BOUND_MS);
  await expect.poll(async()=>await outcome(stale.id)).toBe('stale');
  await expect.poll(walking,{timeout:15_000}).toBe(false);

  // Item 7: a climber that holds nothing across two ticks, and a hold with no deadline,
  // each count once and write one ring entry.
  const before=await invariants();
  await service(`climb('e2e-climber',partySurvival.rejoinRound(false))`);
  await expect.poll(async()=>(await invariants()).unowned,{timeout:5_000}).toBe(before.unowned+1);
  expect(await service('hold({kind:\'town\',owner:\'e2e-untimed\'})')).toBe('granted');
  await expect.poll(async()=>(await invariants()).untimed,{timeout:5_000}).toBe(before.untimed+1);
  // Both stay counted once while they last.
  const settled=(await now())+5*RUNNER_TICK_MS;
  await expect.poll(async()=>await now()>=settled,{timeout:5_000}).toBe(true);
  expect(await invariants()).toMatchObject({unowned:before.unowned+1,untimed:before.untimed+1});
  expect((await records()).filter((r:any)=>r.decision==='invariant').map((r:any)=>[r.owner,r.cause]))
    .toEqual(expect.arrayContaining([['e2e-climber','unowned'],['e2e-untimed','untimed']]));
  expect(await service(`release('e2e-untimed')`)).toBe(true);
  await service(`endClimb('e2e-climber')`);
  expect((await service('live()'))).toBe(null);
  // A standing hold marks who owns a still character and gives way to any request.
  expect(await service(`hold({kind:'death-recovery',owner:'e2e-standing',yields:true,deadline:Date.now()+60000})`)).toBe('granted');
  const follower=await ask(b,{kind:'follow',owner:'follow'});
  expect(follower.journey,'a follow request starts over a standing death recovery hold').toBeTruthy();
  expect((await entry('e2e-standing','ended'))?.code).toBe('replaced:follow');
  await client.run(`stop(undefined,undefined,{kind:'follow',owner:'follow'})`);
  await expect.poll(async()=>await code(follower.journey!)).toBe('released');
  // The stale walk stopped near `a`, where the combat step cases start their first travel.
  const back=await travel(b);
  await expect.poll(async()=>await code(back),{timeout:60_000}).toBe('arrived');
  await reached(b);
}

// Step 5: combat steps pause travel. Failure inventory: e2e/movement-owner-failures.md,
// "Step 5". The CODE frame sends the steps the role runner sends in combat
// (`sendCombatMove`, `holdFormation`, `resetCombatMovement`), so each case sets its own
// timing; the Goo and bee field windows below run them from real combat.
// Records every native move with its target and whether it is a stop packet.
const moveLog=`(()=>{if(!globalThis.__e2eMoveLog){const log=globalThis.__e2eMoveLog=[],original=globalThis.move;
  globalThis.move=function(x,y){log.push({at:Date.now(),x,y,stop:Math.hypot(x-character.real_x,y-character.real_y)<1});return original(x,y);};}return globalThis.__e2eMoveLog.length;})()`;
async function combatSteps(t:any){
  const {client,info,travel,ask,outcome,records,code,walking,reached,stops,a,b,o}=t;
  await client.run(moveLog);
  const moves=async(since:number)=>(await client.run('globalThis.__e2eMoveLog') as any[]).slice(since);
  const mark=async()=>await client.run('globalThis.__e2eMoveLog.length') as number;
  const service=async(expression:string)=>await client.run(`__partyMovement.${expression}`);
  // A clear point to the side of the character, for a combat step. A long step outlasts
  // the calls a case makes while the character still walks it. With `toward`, the line from
  // the step to that point is clear too, so the paused route still holds after the step.
  const side=async(length=40,offset=0,toward?:{x:number;y:number})=>await client.run(`(()=>{const c=character;for(let i=0;i<16;i++){const t=i*Math.PI/8,p={x:c.real_x+${length}*Math.cos(t)+${offset},y:c.real_y+${length}*Math.sin(t)};
    const q=${JSON.stringify(toward??null)};
    if(can_move({map:c.map,x:c.real_x,y:c.real_y,going_x:p.x,going_y:p.y,base:c.base})&&(!q||can_move({map:c.map,x:p.x,y:p.y,going_x:q.x,going_y:q.y,base:c.base})))return p;}throw Error('No clear step');})()`) as {x:number;y:number};
  const step=async(p:{x:number;y:number})=>(await service(`step(${JSON.stringify(p)},'e2e-step').status`)) as string;
  const entries=async(id:string,decision:string)=>(await records()).filter((entry:any)=>entry.journeyId===id&&entry.decision===decision);

  // Items 1 to 5: steps pause a dashboard travel, repeats send nothing, and letting go
  // resumes it with no stop packet and no new plan.
  const first=await travel(a);
  await expect.poll(walking,{timeout:15_000}).toBe(true);
  await expect.poll(async()=>(await service('report()'))?.remaining>0,{timeout:15_000}).toBe(true);
  const searches=(await service('report()')).searches;
  const p=await side(150,0,a);
  // One CODE frame call, as combat sends them within one tick: a round trip under virtual
  // time can outlast the walk of the step (the first run). The let go goes out in the
  // same call. The idle role runner lets go on every movement tick (resetCombatMovement).
  // In the 2 failed runs of 8 on the step 6 code, its let go resumed the travel within
  // 52 ms of the step, so the travel move left before the test's own let go counted moves.
  const burst=await client.run(`(()=>{const p=${JSON.stringify(p)},m=__partyMovement,first=m.step(p,'e2e-step').status,paused=m.live().paused;
    const walking=!!character.moving&&Math.hypot(character.going_x-p.x,character.going_y-p.y)<2,from=__e2eMoveLog.length;
    const repeats=[0,0.5,-0.5,1,-1].map(d=>m.step({x:p.x+d,y:p.y-d},'e2e-step').status),moves=__e2eMoveLog.slice(from);
    const held=m.live().paused,letGoFrom=__e2eMoveLog.length,letGoStops=__e2eStops.count;m.letGo();
    return {first,paused,walking,repeats,moves,held,letGoFrom,letGoStops,resumed:!m.live().paused};})()`);
  expect(burst.first).toBe('sent');
  expect(burst.paused,'the first step pauses the travel').toBe(true);
  expect(burst.walking,'precondition: the character walks the step').toBe(true);
  expect(burst.repeats,'steps to the point being walked are kept').toEqual(['kept','kept','kept','kept','kept']);
  expect(burst.moves,'native moves for repeated steps').toEqual([]);
  expect(burst.held,'precondition: the travel is still paused when combat lets go').toBe(true);
  expect(burst.resumed,'letting go resumes the travel').toBe(true);
  const {letGoFrom,letGoStops}=burst as {letGoFrom:number;letGoStops:number};
  expect((await service('live()')).paused).toBe(false);
  expect((await entries(first,'resumed')).map((entry:any)=>entry.cause)).toEqual(['let-go']);
  try{await expect.poll(async()=>(await moves(letGoFrom)).length,{timeout:5_000}).toBeGreaterThan(0);}
  catch(error){
    // What the service did after letting go, when no travel move followed (one run in
    // three on the step 5 and step 6 code alike).
    await info.attach('let-go-without-move',{body:JSON.stringify(await client.run(`(()=>({records:__partyMovement.records().slice(-12),report:__partyMovement.report(),
      live:__partyMovement.live(),last:__partyMovement.last(),moving:character.moving,going:[character.going_x,character.going_y],at:[character.real_x,character.real_y],
      step:${JSON.stringify(p)},moves:__e2eMoveLog.slice(${letGoFrom})}))()`)),contentType:'application/json'});
    throw error;
  }
  expect((await moves(letGoFrom))[0].stop,'the first move after letting go is travel, not a stop').toBe(false);
  expect(await stops(),'stop packets from letting go of a paused journey').toBe(letGoStops);
  await expect.poll(async()=>await code(first),{timeout:60_000}).toBe('arrived');
  expect((await service('last()')).searches,'planner searches across the pause').toBe(searches);
  expect((await records()).filter((entry:any)=>entry.journeyId===first).map((entry:any)=>entry.decision)).toEqual(['started','paused','resumed','ended']);
  await reached(a);

  // Item 2: a step and no let go resumes the journey after the idle window. The idle role
  // runner lets go on every movement tick (resetCombatMovement), so the fault injector
  // silences its let go for this case: combat that steps once and then neither steps nor
  // lets go (the first run).
  const second=await travel(b);
  let stepWindow=0;
  await expect.poll(walking,{timeout:15_000}).toBe(true);
  await client.run('(()=>{const r=partyMovement;r.__e2eReset=r.resetCombatMovement;r.resetCombatMovement=()=>{};})()');
  try{
    const target=await side(40,0,b);
    // The window the owner holds the pause for: the walk to the step plus a tick, read in the call that steps.
    const sent=await client.run(`(()=>{const m=__partyMovement,status=m.step(${JSON.stringify(target)},'e2e-step').status;return {status,window:m.live().stepMs};})()`) as {status:string;window:number};
    expect(sent.status).toBe('sent');
    stepWindow=sent.window;
    await expect.poll(async()=>(await entries(second,'resumed')).length,{timeout:10_000}).toBe(1);
  }finally{await client.run('(()=>{const r=partyMovement;r.resetCombatMovement=r.__e2eReset;delete r.__e2eReset;})()');}
  const [paused]=await entries(second,'paused'),[resumed]=await entries(second,'resumed');
  expect(resumed.cause).toBe('idle');
  expect(stepWindow,'precondition: the step window is the walk to the step, not a fixed time').toBeGreaterThan(0);
  expect(resumed.at-paused.at,'seconds from the last step to travel resuming').toBeGreaterThanOrEqual(stepWindow);
  expect(resumed.at-paused.at).toBeLessThan(stepWindow+100);
  await expect.poll(async()=>await code(second),{timeout:60_000}).toBe('arrived');
  await reached(b);

  // Item 6: a group walk's row says no, and a hold refuses steps.
  const walk=await ask(o,{kind:'group-walk',owner:'walk:e2e:3',tier:'hunt-mission'});
  await expect.poll(walking,{timeout:15_000}).toBe(true);
  const refusedFrom=await mark();
  expect([await step(await side()),await step(await side(40,5))]).toEqual(['refused','refused']);
  expect(await moves(refusedFrom),'native moves for refused steps').toEqual([]);
  expect((await entries(walk.journey,'step-refused')).length,'one refusal entry per holder').toBe(1);
  await expect.poll(async()=>await outcome(walk.id),{timeout:60_000}).toBe('arrived');
  await reached(o);

  // Items 7 and 8: a hold stops a combat step that walks and refuses steps until release;
  // with no journey, letting go stops the character's own step.
  const held=await client.run(`(()=>{const m=__partyMovement,first=m.step(${JSON.stringify(await side(150))},'e2e-step').status,before=__e2eStops.count;
    return {first,hold:m.hold({kind:'town',owner:'e2e-town-steps'}),stops:__e2eStops.count-before};})()`);
  expect([held.first,held.hold]).toEqual(['sent','granted']);
  expect(held.stops,'a hold stops the walking step once').toBe(1);
  const heldFrom=await mark();
  expect(await step(await side())).toBe('refused');
  expect(await moves(heldFrom)).toEqual([]);
  expect(await service(`release('e2e-town-steps')`)).toBe(true);
  const own=await client.run(`(()=>{const m=__partyMovement,first=m.step(${JSON.stringify(await side(150))},'e2e-step').status,before=__e2eStops.count;
    m.letGo();return {first,stops:__e2eStops.count-before};})()`);
  expect(own.first,'steps return on release').toBe('sent');
  expect(own.stops,'letting go with no journey stops the own step').toBe(1);
  await expect.poll(walking,{timeout:5_000}).toBe(false);

  // Item 8: with no pause, a hold or a let go leaves a journey's own move alone.
  const third=await travel(a);
  await expect.poll(walking,{timeout:15_000}).toBe(true);
  const journeyStops=await stops();
  await service('holdStep()');await service('letGo()');
  expect(await stops(),'stop packets from a hold or let go on a walking journey').toBe(journeyStops);
  await expect.poll(async()=>await code(third),{timeout:60_000}).toBe('arrived');
  await reached(a);

  // Item 9: a dashboard travel during a combat pause takes the character at once.
  const fourth=await travel(b);
  await expect.poll(walking,{timeout:15_000}).toBe(true);
  expect(await step(await side())).toBe('sent');
  const fifth=await travel(o);
  expect((await service('live()')).paused,'the pause ends with the journey it paused').toBe(false);
  expect(await code(fourth)).toBe('superseded');
  await expect.poll(async()=>await code(fifth),{timeout:60_000}).toBe('arrived');
  await reached(o);
  await info.attach('combat-step-records',{body:JSON.stringify(await records()),contentType:'application/json'});
  const report=await service('ownerReport()');
  await info.attach('combat-step-report',{body:JSON.stringify(report),contentType:'application/json'});
  expect(report.errors).toBe(0);
}

// The move onto b9b5c91e (e2e/movement-owner-failures.md, "stuck records and the notice"):
// a rung that ends with no progress is a moment the console logs and recovers from.
async function stuckRow(live:LiveGame,info:TestInfo){
    const client=await rowSetup(live,W,{keepRoutines:true});
    // A scripted round of two rungs; the test reports each rung's outcome itself.
    await client.run(`(()=>{const rung=(name,trying)=>({name,toward:true,attempt:()=>({trying,options:{}})});
      const at=()=>({map:character.map,in:character.in,x:character.real_x,y:character.real_y});
      const ladder=__partyMovement.climb('e2e:stuck',[rung('first','walking to the first point'),rung('second','walking around the test wall')],'Testing a blocked rung');
      globalThis.__e2eStuck={ladder,at,first:ladder.next(at()).rung};return true;})()`);
    const run=async(code:string)=>await client.run(code);
    const incidents=async(kind:string)=>(await run('__partyMovement.incidents()') as any[]).filter(r=>r.kind===kind&&r.owner==='e2e:stuck');
    const card=async()=>(await live.state()).characters[W]?.movementClimb??null;
    expect(await run('globalThis.__e2eStuck.first')).toBe('first');
    // The rung's own walk ends without arriving, so the record names the end that blocked it.
    await run(`(()=>{const c=character;for(let i=0;i<16;i++){const t=i*Math.PI/8,p={map:c.map,x:c.real_x+80*Math.cos(t),y:c.real_y+80*Math.sin(t)};
      if(can_move({map:c.map,x:c.real_x,y:c.real_y,going_x:p.x,going_y:p.y,base:c.base})){smart_move(p,undefined,{request:{kind:'follow',owner:'e2e:blocked'}}).catch(()=>{});return true;}}throw Error('No clear point');})()`);
    await expect.poll(async()=>await run('!!character.moving'),{timeout:15_000}).toBe(true);
    await run(`stop(undefined,undefined,{kind:'follow',owner:'e2e:blocked'})`);
    await expect.poll(async()=>await run('!!character.moving'),{timeout:15_000}).toBe(false);
    // Items 1 to 5: the forced rung writes exactly one stuck record, and the next rung starts at once.
    expect(await run(`globalThis.__e2eStuck.ladder.result({arrived:false,at:globalThis.__e2eStuck.at()})`)).toBe('failed');
    const [stuck,...extra]=await incidents('stuck');
    expect(extra.length,'stuck records for one rung').toBe(0);
    expect(stuck).toMatchObject({character:W,activity:'Testing a blocked rung',rung:'first',trying:'walking to the first point',position:{map:expect.any(String)},
      blocked:{code:'released',kind:'follow',owner:'e2e:blocked'}});
    expect([stuck.position.x,stuck.position.y,stuck.noProgressMs].every(Number.isFinite),'position and time without progress').toBe(true);
    expect(stuck.leadUp.some((r:any)=>r.decision==='climbing'&&r.owner==='e2e:stuck'),'the lead-up starts at the climb').toBe(true);
    const climbSeq=stuck.leadUp.find((r:any)=>r.decision==='climbing'&&r.owner==='e2e:stuck').seq;
    expect(stuck.leadUp.every((r:any)=>r.seq>=climbSeq),'the lead-up holds nothing from before the climb').toBe(true);
    expect(await run(`__partyMovement.incident(${JSON.stringify(stuck.id)})`),'the id resolves to the record').toEqual(stuck);
    expect((await run('__partyMovement.records()') as any[]).filter(r=>r.decision==='stuck'&&r.cause===stuck.id).length,'ring decisions naming the record').toBe(1);
    expect(await run(`globalThis.__e2eStuck.ladder.next(globalThis.__e2eStuck.at()).rung`),'the next rung starts').toBe('second');
    // Step 8c item 11 (design section 7 `ladderStep`): each rung start and result is a ring entry with its index.
    expect((await run('__partyMovement.records()') as any[]).filter(r=>r.cause==='ladder'&&r.owner==='e2e:stuck'&&/^rung/.test(r.decision)).map(r=>[r.decision,r.code,r.ladderStep]))
      .toEqual([['rung','first',0],['rung-failed','first',0],['rung','second',1]]);
    // Items 6 and 7: the card shows the notice, then the activity and rung once the rung progresses.
    await expect.poll(card,{timeout:15_000}).toMatchObject({activity:'Testing a blocked rung',trying:'walking around the test wall',notice:'Stuck - trying walking around the test wall',incident:stuck.id});
    // Step 8b item 15: the coordinator's activity line reads "<activity> - <trying>" and
    // carries the notice while the climber reports one, with no time and no "Stuck N min".
    const line=async()=>(await live.state()).characters[W]?.activity??null;
    await expect.poll(line,{timeout:15_000}).toMatchObject({text:'Testing a blocked rung - walking around the test wall',notice:'Stuck - trying walking around the test wall',incident:stuck.id});
    expect(String((await line()).text)).not.toMatch(/stuck|\d+ ?min/i);
    // Step 8b item 13: the stuck record saved one snapshot that names it, and a read of the
    // diagnostics lease brings the record over after the next report, never in the status.
    const records=async()=>{const response=await fetch(live.url+`/party-api/diagnostics/records?character=${W}&rings=movement`);return response.json();};
    await expect.poll(async()=>(await records()).snapshots.filter((x:any)=>x.trigger==='stuck'&&x.incident===stuck.id).length,{timeout:15_000}).toBe(1);
    const saved=(await records()).snapshots.find((x:any)=>x.incident===stuck.id);
    const full=await (await fetch(live.url+`/party-api/movement/snapshot?character=${W}&id=${encodeURIComponent(saved.id)}`)).json();
    expect(full.records.some((r:any)=>r.decision==='stuck'&&r.cause===stuck.id)).toBe(true);
    await expect.poll(async()=>(await records()).live?.movement?.incidents?.some((r:any)=>r.id===stuck.id)??false,{timeout:15_000}).toBe(true);
    expect(Object.keys((await live.state()).characters[W]).filter(key=>/^(ring|records|incidents|comparison)$/.test(key))).toEqual([]);
    expect(await run(`globalThis.__e2eStuck.ladder.result({arrived:false,at:{...globalThis.__e2eStuck.at(),map:'e2e-new-map'}})`)).toBe('progress');
    await expect.poll(card,{timeout:15_000}).toMatchObject({activity:'Testing a blocked rung',notice:null,incident:null});
    await expect.poll(async()=>(await line())?.notice??null,{timeout:15_000}).toBeNull();
    expect((await line()).text).toBe('Testing a blocked rung - walking around the test wall');
    expect(String((await card()).activity)).not.toMatch(/stuck/i);
    // Item 6: without progress the notice ends at its deadline, two report intervals here.
    expect(await run(`globalThis.__e2eStuck.ladder.result({arrived:false,at:globalThis.__e2eStuck.at()})`)).toBe('failed');
    expect((await incidents('stuck')).length).toBe(2);
    await run(`globalThis.__e2eStuck.ladder.next(globalThis.__e2eStuck.at())`);
    expect((await run('__partyMovement.climbing()')).notice?.text).toMatch(/^Stuck - trying /);
    await expect.poll(async()=>(await run('__partyMovement.climbing()')).notice??null,{timeout:30_000}).toBeNull();
    // Item 8: an error the owner catches writes a caught-error record and moves the ladder on.
    const before=(await run('__partyMovement.climbing()')).rung;
    await run(`__partyMovement.hold({get kind(){throw Error('e2e: forced owner error');},owner:'e2e:broken'})`);
    const [caught]=await incidents('caught-error');
    expect(caught?.error).toMatch(/forced owner error/);
    expect(caught.leadUp.some((r:any)=>r.decision==='climbing'&&r.owner==='e2e:stuck')).toBe(true);
    expect(await run(`__partyMovement.incident(${JSON.stringify(caught.id)})`)).toEqual(caught);
    expect((await run('__partyMovement.climbing()')).rung,'the ladder tries its next rung').not.toBe(before);
    await info.attach('stuck-incidents',{body:JSON.stringify(await run('__partyMovement.incidents()')),contentType:'application/json'});
    await run(`__partyMovement.endClimb('e2e:stuck')`);
    // Step 8b item 13, churn: ten refusals inside ten seconds save one snapshot.
    const churned=async()=>(await records()).snapshots.filter((x:any)=>x.trigger==='churn').length,churnedBefore=await churned();
    await run(`(()=>{__partyMovement.hold({kind:'cave',owner:'e2e:churn',deadline:Date.now()+20000});
      for(let i=0;i<10;i++)Promise.resolve(smart_move({map:character.map,x:character.real_x+5+i,y:character.real_y},undefined)).catch(()=>{});return true;})()`);
    await expect.poll(churned,{timeout:15_000}).toBe(churnedBefore+1);
    await run(`__partyMovement.release('e2e:churn')`);
    // The group's farming task climbs to its wait rung (farming
    // has nothing to fall back to, so T2, T3, then T5). T5 writes one stuck record and saves one
    // snapshot, and the line reads "Stuck - trying <rung>". It runs no timer: with the party
    // standing still it stays on T5, and the first report that shows a move starts a new round.
    const group=`party:${W}`,owned=async()=>(await live.tasks()).groups.find((g:any)=>g.id===group);
    for(const name of fighters)await settleNavigation(live.clients[name],name);
    const farming=await owned();
    expect(farming.live.kind,'precondition: the party farms').toBe('farming');
    const handle={id:farming.live.id,group},stuckSnapshots=async()=>((await live.tasks()).snapshots[group]??[]).filter((s:any)=>s.trigger==='stuck').length;
    const snapshotsBefore=await stuckSnapshots(),seqBefore=Math.max(0,...farming.ring.map((r:any)=>r.seq));
    const climbed=await live.taskOps([1,2,3].map(()=>({op:'fail',args:[handle,'e2e-farm',{trying:'the walk to the saved farm point'}]})));
    expect(climbed.map((s:any)=>s.rung),'regroup, safe point, wait').toEqual(['regroup','safe-point','wait']);
    const atWait=await owned();
    expect(atWait.status).toMatchObject({phase:'farming:stuck',label:'Stuck - trying the walk to the saved farm point'});
    expect(atWait.ring.filter((r:any)=>r.seq>seqBefore&&r.decision==='stuck').map((r:any)=>r.ladderStep),'one stuck record').toEqual([5]);
    expect(await stuckSnapshots()-snapshotsBefore,'one stuck snapshot').toBe(1);
    const reports=async()=>(await live.state()).characters[W]?.seenAt??0,from=await reports();
    await expect.poll(async()=>(await reports())>from+4_000,{timeout:30_000,message:'Reports keep arriving while the party stands still'}).toBe(true);
    const still=await owned();
    expect(still.ladder.rung,'the wait rung waits while no report shows a change').toBe('wait');
    expect(still.ring.filter((r:any)=>r.seq>seqBefore&&r.decision==='ladder').length,'no ladder step runs on a timer').toBe(3);
    await run(`(()=>{const c=character;for(let i=0;i<16;i++){const t=i*Math.PI/8,p={map:c.map,x:c.real_x+60*Math.cos(t),y:c.real_y+60*Math.sin(t)};
      if(can_move({map:c.map,x:c.real_x,y:c.real_y,going_x:p.x,going_y:p.y,base:c.base})){smart_move(p,undefined,{request:{kind:'follow',owner:'e2e:t5'}}).catch(()=>{});return true;}}throw Error('No clear point');})()`);
    await expect.poll(async()=>(await owned()).ladder.rung,{timeout:30_000,message:'A report that shows a move starts a new round'}).toBe('walk');
    const round=await owned();
    expect(round.ring.filter((r:any)=>r.seq>seqBefore&&r.decision==='ladder').map((r:any)=>[r.ladderStep,r.code]).at(-1)).toEqual([0,'waited']);
    expect(round.status.label).not.toMatch(/^Stuck/);
    for(const name of fighters)await settleNavigation(live.clients[name],name);
}

// Each row starts with the fighters' spend log (the
// turns rows' `spendLog`, which keeps once installed), so a reply the turns owner counts lost in any
// row names whether and when it came; the steps windows' lost-spend log reads it.
function withSpendLog(rows:[string,(live:LiveGame,info:TestInfo,page:any)=>Promise<void>][]){
  return rows.map(([name,run]):[string,(live:LiveGame,info:TestInfo,page:any)=>Promise<void>]=>[name,async(live,info,page)=>{
    for(const n of fighters)await live.clients[n]!.run(spendLog);return run(live,info,page);}]);
}
// The last row starts the priest headless (M2's Pause), so the fixture allows a headless launch.
test.use({liveHeadless:true});
liveScenarioTable('movement owner: the rows that start from the default fixture', 10_800_000, defaultFixtureReset, withSpendLog([
  ['UP-1 cant_join: one refused join ends the round and the respawned priest goes back to the farm',cantJoinRow],
  ['UP-1 horseman: the respawned follower walks back while the coordinator keeps the failed walk',up1Row('horseman')],
  ['UP-1 mrgreen: the respawned follower walks back while the coordinator keeps the failed walk',up1Row('mrgreen')],
  ['UP-3 farm: the priest respawns after the event ended and goes back to its farm',up3Row('farm')],
  ['UP-3 hunt: the priest respawns after the event ended and goes back to its hunt',up3Row('hunt')],
  ['E1: an escape during a live event, then Resume',e1Row],
  ['M2: a character on Manual, then Pause headless',m2Row],
  ['movement owner on: ranked requests, the stop rule, kept and retargeted journeys, waits and holds',rankedRow],
  ['movement owner on: a rung with no progress logs one stuck record',stuckRow],
  ['movement records: typed calls name their site, end codes, a bounded ring of copies, none in the heartbeat',recordsRow],
  ['movement owner on: a walk names its tier, and the card names the trip from its first poll and stays still while farming',farmWalkRow],
  ['movement owner on: a party travel that cannot arrive climbs the walk ladder and never fails for good',walkLadderRow],
  ['combat steps, owner on: six farming windows',gooWindowsRow],
  ['step safety, owner on: six windows on the bee field',beeFieldRow],
  // 01 step 8 (the test cut): the rows of the other tests that start from this fixture, after the
  // measured rows so their windows keep the order they were measured in.
  ['coordinator interruption during a convoy recovers the actual destination',convoyInterruptionRow],
  ...handoffRows,
  ...rendezvousRows,
  // The Hunt rows: each seeds its own quests and starts its own Hunt.
  ['saved follower Hunt preferences and cleared backup focus preserve the active leader quest through real reward',controlsRow],
  ...interruptionRows,
  ...merchantRows,
  ...goobrawlRows,
  // The installed add-ons' rows of this table, from each
  // add-on's tests/rows.ts, from the fixture's party at the town square.
  ...addonRows<[string,(live:LiveGame,info:TestInfo)=>Promise<void>]>('movement owner: the rows that start from the default fixture'),
  ['Cave shared-route pacing keeps the party together and stops the selected route',cavePacingRow],
  // The call budget's rows, after the measured rows; row C last of the
  // three, because it disconnects the merchant, and it ends when the merchant reports again.
  ["call budget: the merchant's bursts stay under the limit",burstsRow],
  ['call budget: survival goes first while jobs fill the window',survivalRow],
  ['call budget: a row end puts back the calls.band and socket.emit it wrapped',rowUndoRow],
  // The turns owner's rows, after row B and before row C, which disconnects
  // the merchant.
  ["turns: the priest's slot at the edge",turnsSlotRow],
  ['turns: one potion in flight',turnsPotionRow],
  // The survival owner's row, after the turns potion row with the same plants.
  ['survival: potions and regeneration per class',survivalNeedsRow],
  // The targeting owner's row, after the survival row.
  ['targeting: retire and skip',targetingRetireRow],
  ['call budget: a forced limitdc saves one snapshot',forcedLimitdcRow],
  // Last: it logs the priest out of its game client, so no later row has the priest's client.
  ['M2: the priest headless on Pause',pauseHeadlessRow],
]));

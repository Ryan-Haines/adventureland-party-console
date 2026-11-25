import {expect,callMeasures,trackerReplyAge,type LiveGame,type CallSample,reloadCode} from './live-fixtures';
import type {TestInfo} from '@playwright/test';
import {fighters,party} from './game/hunt-lifecycle';
import {waitForGameplay} from './network-clock';
import {CALL_LIMIT as LIMIT,CALL_WINDOW_MS as WINDOW_MS,bandLimits,READ_PICKS} from '../runtime/characters/call-budget-limits.ts';

// The call budget's rows, which W05, W14, W19 and W60 play from: row A, the merchant's bursts and its
// Tracktrix read; row B, survival first while jobs fill the window; row C, a forced limitdc. Each checks
// its failure modes by number after the row's measures, so a row on a tree without the budget still
// measures.
const M='E2EMerchant',W='E2EWarrior',P='E2EPriest';
// The server's window (server_functions.js:5481) and limit (server.js:262).
// The Tracktrix read's waits (runtime/characters/call-budget-reads.ts): a reply schedules the next
// request after the hidden `callTrackerRefreshMs`, 30 s; a request with no reply asks again one
// margin later, once, then waits the refresh.
export const TRACKER_REFRESH_MS=READ_PICKS.callTrackerRefreshMs;
// ChronAL's virtual clock moves timers in 250 ms steps; a due read asks on its timer's turn.
export const STEP_MS=250;
// CB20's bounds live in call-budget-cb20.ts, which the unit row loads without the live fixtures.
export {CB20_P95} from './call-budget-cb20';
const budgetView=(live:LiveGame,name:string)=>live.clients[name]!.run('globalThis.__partyCalls?.view?.() ?? null');
const attach=(info:TestInfo,name:string,body:unknown)=>info.attach(name,{body:JSON.stringify(body,null,1),contentType:'application/json'});

// A Tracktrix in the character's bag, the tracker read's condition (3.7). A headless character has
// no page (`page` false), so the server's packet alone gives it. The default fixture turns the
// merchant's inventory cleanout off, so a fighter's loot fills its bag over a long table: the
// confirming table at fdc770fc6 reached the M2 row with the priest's 42 cells full. A bag with no
// empty cell gives its last cell to the Tracktrix, and the helper returns the item it took out.
export async function holdTracktrix(live:LiveGame,name:string,page=true){
  const displaced=await live.admin(`output=(()=>{const p=get_player('${name}');if(p.items.some(i=>i&&i.name==='tracker'))return null;
    const free=p.items.findIndex((i,k)=>!i&&k<p.isize),slot=free<0?p.isize-1:free,taken=p.items[slot]||null;p.items[slot]={name:'tracker'};
    cache_player_items(p);resend(p,'reopen+cid');return taken;})()`);
  if(page)await expect.poll(()=>live.clients[name]!.run(`character.items.some(i=>i&&i.name==='tracker')`),{timeout:15_000}).toBe(true);
  return displaced;
}

// The sampler's measures and CB1's bound for each sampled character, attached and logged.
export async function sampled(info:TestInfo,label:string,samples:CallSample[],names:string[]){
  const measures=Object.fromEntries(names.map(n=>[n,callMeasures(samples,n)]));
  await attach(info,label+'-call-samples',{measures,samples});
  console.log('CALL-SAMPLES '+JSON.stringify({label,measures:Object.fromEntries(Object.entries(measures).map(([n,m])=>[n,{...m,above:m.above?.length??null}]))}));
  return measures;
}
// CB1: each server sample is at most the largest `used` the character held within one margin of it.
export function boundHolds(measures:Record<string,ReturnType<typeof callMeasures>>,names:string[]){
  for(const n of names){
    expect(measures[n]!.usedSamples,`CB1: ${n}'s budget answers the sampler`).toBeGreaterThan(0);
    expect(measures[n]!.above,`CB1: ${n}'s server sum above its used`).toEqual([]);
  }
}

// CB4: one call, its server entries against the ledger's. Each check starts from a quiet window:
// no live entry on the merchant's socket and no ledger entry within one margin, so no charge is in
// flight across the two baselines: an admin read takes 0.5 to 1.5 s (13.2 correction 5), so an
// emit sent between two baselines read one after the other counts at one side only.
// A crossing first places the merchant at its door (`prepare`), whose own 8 is in both baselines.
// Merged entries grow in place (server_functions.js:5443-5447), so a server entry counts by how
// much it grew, and each check ends within the window, so no grown entry ages out before it is
// read. Only the entries of the call's own method, and the door's `transport`, are compared: the
// merchant's background reads (`players`, `secondhands`, the tracker) run during the checks and
// are each their own entry. The merchant's routines are held during the checks (13.2, Gates).
const serverCalls=(live:LiveGame,name:string)=>live.admin(`output=(()=>{const now=Date.now();return {now,calls:get_player('${name}').socket.calls.filter(c=>now-c[0]<=${WINDOW_MS}).map(c=>[+c[0],c[1],c[2]])};})()`) as Promise<{now:number;calls:[number,string,number][]}>;
async function quiet(live:LiveGame,name:string,label:string){
  let read:any={};
  await expect.poll(async()=>{
    const server=await serverCalls(live,name),view=await budgetView(live,name),now=await live.clients[name]!.run('Date.now()') as number;
    read={server:server.calls,recent:(view?.ledger??[]).filter((e:any)=>e.at>now-(view?.margin??WINDOW_MS))};
    return server.calls.length===0&&read.recent.length===0;
  },{timeout:30_000,intervals:[250],message:`CB4: a quiet window before ${label}: ${JSON.stringify(read)}`}).toBe(true);
}
// The ledger entries a later read holds beyond an earlier one, matched by value: on ChronAL's
// virtual clock several entries share one millisecond, so a time cut misses some.
const key=(e:any)=>[e.at,e.method,e.cost].join('|');
export function newEntries(before:any[],after:any[]){
  const left=new Map<string,number>();
  for(const e of before)left.set(key(e),(left.get(key(e))??0)+1);
  return after.filter(e=>{const n=left.get(key(e))??0;if(n>0){left.set(key(e),n-1);return false;}return true;});
}
// The server's entries only grow at the end within the window: the baseline's entries keep their
// places, its last one may grow by a merge, and new ones follow. They are matched by place, since
// ChronAL's virtual clock dates several entries one millisecond.
type ServerCalls=Awaited<ReturnType<typeof serverCalls>>;
function growth(before:ServerCalls,after:ServerCalls,labels:Set<string>){
  return after.calls.map(([,method,num],i):[string,number]=>[method,num-(i<before.calls.length&&before.calls[i]![1]===method?before.calls[i]![2]:0)]).filter(([method,num])=>num>0&&labels.has(method));
}
// One raw emit from the page, through the budget's wrapper and around the game's own checks.
const emitCall=(method:string,data:unknown)=>`(parent.socket.emit(${JSON.stringify(method)},${JSON.stringify(data)}),true)`;
export async function oneCall(live:LiveGame,name:string,label:string,method:string,call:string,settled:string='true',prepare?:()=>Promise<void>){
  await quiet(live,name,label);
  if(prepare)await prepare();
  // A bank floor's own charge carries the label `bank` (server.js:5978, 5989); a door's 8 carries `transport`.
  const labels=new Set([method,'transport',...(method==='transport'?['bank']:[])]);
  const before=await serverCalls(live,name),view=await budgetView(live,name);
  const baseLedger=view?.ledger??[];
  const sentAt=await live.clients[name]!.run('Date.now()') as number;
  await live.clients[name]!.run(call);
  let result:any={label};
  await expect.poll(async()=>{
    const after=await serverCalls(live,name),now=await budgetView(live,name);
    const grown=growth(before,after,labels);
    const ledger=newEntries(baseLedger,now?.ledger??[]).filter((e:any)=>labels.has(e.method));
    result={label,server:sum(grown),ledger:Math.round(ledger.reduce((sum:number,e:any)=>sum+e.cost,0)*100)/100,
      refused:(await live.clients[name]!.events()).filter((e:any)=>e.at>=sentAt&&e.event==='game_response'&&(e.data?.failed||e.data?.success===false)).map((e:any)=>e.data),
      entries:grown,ledgerEntries:ledger.map((e:any)=>[e.method,e.cost,e.at-sentAt]),others:after.calls.filter(([,method])=>!labels.has(method)).map(([,method,num])=>[method,num]),
      serverAll:after.calls.map(([at,method,num])=>[method,num,at-sentAt]),baseline:before.calls.map(([at,method,num])=>[method,num,at-sentAt]),
      newMaps:(await live.clients[name]!.events()).filter((e:any)=>e.event==='new_map'&&e.at>=sentAt-5000).map((e:any)=>[e.at-sentAt,e.data?.name??null])};
    // The call's own entry must be in the ledger, so an earlier unrelated charge cannot end the wait.
    const booked=ledger.some((e:any)=>e.method===method);
    return result.server>0&&booked&&await live.clients[name]!.run(settled)&&result.server===result.ledger;
  },{timeout:3_500,intervals:[100],message:`CB4: ${label} booked at the server's charge`}).toBe(true).catch(()=>{});
  return result;
}
export async function perCallCosts(live:LiveGame,info:TestInfo){
  const doors=await live.admin(`output=(()=>{const doors=G.maps.main.doors,bank=doors.find(d=>d[4]==='bank'),
    plain=doors.find(d=>G.maps[d[4]]&&!G.maps[d[4]].mount&&!G.maps[d[4]].instance&&!G.maps[d[4]].irregular&&G.maps[d[4]].doors.some(b=>b[4]==='main'));
    const back=m=>G.maps[m].doors.find(d=>d[4]==='main');
    return {bank:{to:'bank',s:bank[5],at:G.maps.main.spawns[bank[6]]},bankOut:{to:'main',s:back('bank')[5]},
      plain:{to:plain[4],s:plain[5],at:G.maps.main.spawns[plain[6]]},plainBack:{to:'main',s:back(plain[4])[5],at:G.maps[plain[4]].spawns[back(plain[4])[6]]}};})()`);
  // The placement's own door is in both baselines: the server charges it at once, and the poll
  // waits for the merchant's budget to book it on `new_map`.
  const place=async(map:string,at:number[])=>{
    const before=(await budgetView(live,M))?.ledger??[];
    await live.admin(`output=(()=>{transport_player_to(get_player('${M}'),'${map}',[${at[0]},${at[1]}]);return true;})()`);
    await expect.poll(async()=>await live.clients[M]!.run(`character.map==='${map}'&&Math.hypot(character.real_x-(${at[0]}),character.real_y-(${at[1]}))<5`)&&
      newEntries(before,(await budgetView(live,M))?.ledger??[]).some((e:any)=>e.method==='transport'),{timeout:15_000}).toBe(true);
  };
  // The merchant's own routines would charge its socket during the checks (13.2, Gates): its Town
  // back from a door it was placed at, its stand calls and an equip all ran during them, so the
  // merchant is on Pause, which runs none of the console's code for it, until the checks end.
  await live.post('/formation',{character:M,handControl:{on:true}});
  const results:any[]=[];
  try{
  // A merchant's open stand refuses every crossing (server.js `can_walk`), so it closes first.
  await live.clients[M]!.run('character.stand?close_stand().then(()=>true,()=>true):true');
  await expect.poll(()=>live.clients[M]!.run('!character.stand'),{timeout:15_000}).toBe(true);
  const emit=emitCall;
  results.push(await oneCall(live,M,'players','players',emit('players',{})));
  results.push(await oneCall(live,M,'tracker','tracker',emit('tracker',undefined)));
  results.push(await oneCall(live,M,'move','move',`(parent.move(character.real_x+8,character.real_y),true)`));
  // A move that cancels a channel (3.5) needs a fishing or mining channel, the conditions with no
  // `can_move` (design/conditions.js); Town's channel can move (can_move: true), so a move leaves it.
  // Town's door lands after its 3000 ms channel (server.js:6214, 15072), so the call waits it out.
  results.push(await oneCall(live,M,'town to its landing (the door on new_map)','town',`new Promise(r=>{parent.socket.emit('town');let seen=false;const t=setInterval(()=>{const c=!!(character.c&&character.c.town);seen||=c;if(seen&&!c){clearInterval(t);r(true);}},20);})`));
  results.push(await oneCall(live,M,'transport into a bank floor (32, the door on new_map)','transport',emit('transport',{to:doors.bank.to,s:doors.bank.s}),`character.map==='bank'`,()=>place('main',doors.bank.at)));
  results.push(await oneCall(live,M,'transport out of a bank floor (16, the door on new_map)','transport',emit('transport',doors.bankOut),`character.map==='main'`));
  results.push(await oneCall(live,M,`transport to ${doors.plain.to} (the door with its call)`,'transport',emit('transport',{to:doors.plain.to,s:doors.plain.s}),`character.map===${JSON.stringify(doors.plain.to)}`,()=>place('main',doors.plain.at)));
  results.push(await oneCall(live,M,'transport back to main','transport',emit('transport',{to:doors.plainBack.to,s:doors.plainBack.s}),`character.map==='main'`));
  // `leave` crosses only out of jail, cyberland or a solo instance (server.js:5824-5831), so the
  // merchant is placed in jail first. Its door is inside the handler, as a plain map's.
  const jail=await live.admin(`output=G.maps.jail.spawns[0]`) as number[];
  results.push(await oneCall(live,M,'leave from jail (the door with its call)','leave','(parent.socket.emit("leave"),true)',`character.map==='main'`,()=>place('jail',jail)));
  }finally{await live.post('/formation',{character:M,handControl:{on:false}}).catch(()=>{});}
  results.push(...await partyCosts(live));
  // The table's CC and limit against the running server.
  const server=await live.admin(`output=({CC:{move:CC.move,players:CC.players,secondhands:CC.secondhands,tracker:CC.tracker,equip:CC.equip,unequip:CC.unequip,send_updates:CC.send_updates,auth:CC.auth,friend:CC.friend,cruise:CC.cruise},calls:limits.calls})`);
  await attach(info,'cb4-per-call',{results,server});
  console.log('CALL-BUDGET-CB4 '+JSON.stringify(results.map(r=>[r.label,r.server,r.ledger])));
  return {results,server};
}
// The party calls of the tasks owner's membership: the priest leaves the warrior's party, and the two
// characters' own membership forms it again within a second, by the warrior's invite and the
// priest's accept or by the priest's request and the warrior's raccept (the first try found the
// priest asking to join under the card's hold, so the rejoin is theirs). Each socket's `party`
// entries are compared with its ledger's; call-budget.ts `price` books a leave 1, an accept or
// raccept 2, and an invite or a request 0.
async function partyCosts(live:LiveGame){
  await party(live);
  const together=`character.party==='${W}'`;
  await expect.poll(()=>live.clients[P]!.run(together),{timeout:60_000,message:"The priest is in the warrior's party"}).toBe(true);
  for(const n of [P,W])await quiet(live,n,'the party leave');
  const read=async(n:string)=>({server:await serverCalls(live,n),ledger:(await budgetView(live,n))?.ledger??[]});
  const before:Record<string,Awaited<ReturnType<typeof read>>>={[P]:await read(P),[W]:await read(W)};
  await live.clients[P]!.run(emitCall('party',{event:'leave'}));
  let results:any[]=[],kept:any[]|undefined;
  const reads:any[]=[];
  await expect.poll(async()=>{
    const formed=await live.clients[P]!.run(together);
    results=await Promise.all([[P,'party: the priest leaves and rejoins'],[W,'party: the warrior in the rejoin']].map(async([n,label])=>{
      const after=await read(n!),grown=growth(before[n!]!.server,after.server,new Set(['party']));
      const ledger=newEntries(before[n!]!.ledger,after.ledger).filter((e:any)=>e.method==='party');
      return {label,server:sum(grown),ledger:sum(ledger.map((e:any)=>['party',e.cost])),entries:grown,ledgerEntries:ledger.map((e:any)=>[e.method,e.cost])};
    }));
    // An invite or a request costs its sender nothing, so only the priest's side must have entries.
    // The read with the most on the priest's side is the result: both ledgers and the server's
    // window forget an entry after 4 s, so a later read holds less.
    reads.push({formed,results:results.map(r=>[r.label,r.server,r.ledger])});
    const most=(r:any[]|undefined)=>r?r[0].server+r[0].ledger:-1;
    if(most(results)>=most(kept))kept=results;
    return formed&&results[0].ledgerEntries.length>0&&results.every(r=>r.server===r.ledger);
  },{timeout:15_000,intervals:[100],message:"CB4: the party leave and its rejoin booked at the server's charge"}).toBe(true).catch(()=>{});
  console.log('CALL-BUDGET-CB4-PARTY '+JSON.stringify(reads));
  await party(live);
  return kept??results;
}
const sum=(entries:[string,number][])=>Math.round(entries.reduce((s,[,num])=>s+num,0)*100)/100;
// The mage's Blink and Magiport (MOV-036's escape pulse, MOV-058's reunion), from the table whose
// fixture has a mage. Both mage and target are on Pause, so their own calls stay out of the checks.
// Each spends MP, so the server fills the mage's first. A Blink and an accepted Magiport each land
// after the call, with the door's 8 on `new_map` (server.js:14779-14784; server_functions.js:4097).
export async function mageCosts(live:LiveGame,info:TestInfo,mage:string,target:string){
  const results:any[]=[];
  // The game client's own `new_map` handler runs first on each socket (js/game.js:1663). For the
  // `blink` and `magiport` effects alone it calls `restore_dimensions` (game.js:1706-1718), which
  // reads `sprite.texture` with no `no_graphics` guard (js/functions.js:4489-4492). The probe
  // records, in each character's game frame, what that call does on this client and every error
  // the frame raises during the calls, so a handler that throws before the budget's listener shows.
  const probe=(n:string)=>live.clients[n]!.frame.evaluate(()=>{
    const w=window as any;
    if(!w.__e2eFrameErrors){w.__e2eFrameErrors=[];w.addEventListener('error',(e:ErrorEvent)=>w.__e2eFrameErrors.push({at:Date.now(),message:String(e.message),file:e.filename,line:e.lineno}));}
    let restore:string|null=null;
    try{w.restore_dimensions({texture:w.character?.texture,cscale:w.character?.cscale,mscale:w.character?.mscale});}catch(error){restore=String(error);}
    return {noGraphics:!!w.no_graphics,texture:!!w.character?.texture,newMapListeners:w.socket.listeners('new_map').length,restore};
  });
  const probes:any={before:{[mage]:await probe(mage),[target]:await probe(target)}};
  // CB1 on the mage, whose sum no other row samples: the door's 8 of each landing is in it.
  const sampler=live.sampleCalls([mage]);
  for(const n of [mage,target])await live.post('/formation',{character:n,handControl:{on:true}});
  try{
    await live.admin(`output=(()=>{const p=get_player('${mage}');p.mp=p.max_mp;return true;})()`);
    const from=await live.clients[mage]!.run('[character.real_x,character.real_y]') as number[];
    results.push(await oneCall(live,mage,'blink (the door on new_map)','skill',emitCall('skill',{name:'blink',x:from[0]!+40,y:from[1]}),
      `Math.hypot(character.real_x-(${from[0]}),character.real_y-(${from[1]}))>20`));
    results.push(await oneCall(live,mage,'magiport cast','skill',emitCall('skill',{name:'magiport',id:target})));
    await expect.poll(()=>live.admin(`output=!!(magiportations['${mage}']&&magiportations['${mage}']['${target}'])`),{timeout:15_000,message:'The Magiport offer stands'}).toBe(true);
    // The target stands 200 away first, so its arrival at the mage shows the Magiport landed; the
    // gate's first run read the accept's 2 alone, from a target already beside the mage.
    const at=await live.clients[mage]!.run('[character.real_x,character.real_y,character.map]') as [number,number,string];
    const away=async()=>{
      await live.admin(`output=(()=>{transport_player_to(get_player('${target}'),'${at[2]}',[${at[0]+200},${at[1]}]);return true;})()`);
      await expect.poll(()=>live.clients[target]!.run(`Math.hypot(character.real_x-(${at[0]}),character.real_y-(${at[1]}))>150`),{timeout:15_000,message:'The target stands away from the mage'}).toBe(true);
    };
    results.push(await oneCall(live,target,'magiport accept (the door on new_map)','magiport',emitCall('magiport',{name:mage}),
      `Math.hypot(character.real_x-(${at[0]}),character.real_y-(${at[1]}))<30`,away));
  }finally{for(const n of [mage,target])await live.post('/formation',{character:n,handControl:{on:false}}).catch(()=>{});}
  const samples=await sampler.stop();
  probes.after={[mage]:await probe(mage),[target]:await probe(target)};
  probes.errors=Object.fromEntries(await Promise.all([mage,target].map(async n=>[n,await live.clients[n]!.frame.evaluate(()=>(window as any).__e2eFrameErrors)])));
  await attach(info,'cb4-mage-calls',{results,probes});
  console.log('CALL-BUDGET-CB4 '+JSON.stringify(results.map(r=>[r.label,r.server,r.ledger])));
  console.log('CALL-BUDGET-NEW-MAP-PROBE '+JSON.stringify(probes));
  // Soft, so CB4's per-call checks after it still run.
  const measures=await sampled(info,'case-a-mage',samples,[mage]);
  expect.soft(measures[mage]!.usedSamples,`CB1: ${mage}'s budget answers the sampler`).toBeGreaterThan(0);
  expect.soft(measures[mage]!.above,`CB1: ${mage}'s server sum above its used`).toEqual([]);
  return results;
}
// CB4's checks, after the row's measures, so a row on a tree with no budget still measures its bursts.
export function costsHold({results,server}:Awaited<ReturnType<typeof perCallCosts>>){
  expect(server,"CB4: the table's CC and limit are the running server's").toEqual({CC:{move:1.5,players:12,secondhands:16,tracker:50,equip:3,unequip:6,send_updates:12,auth:2,friend:24,cruise:10},calls:200});
  chargesHold(results);
}
export function chargesHold(results:any[]){
  for(const r of results)expect([r.label,r.ledger],`CB4: ${r.label} entries ${JSON.stringify(r.entries)} ledger ${JSON.stringify(r.ledgerEntries)} refused ${JSON.stringify(r.refused)}`).toEqual([r.label,r.server]);
}

// The bands' own checks on one character's budget: CB7 no band
// admitted above its limit; CB8 the hold queue empty and each held emit gone within the window and
// the margin; CB10 the limits from the survival band's spend in the window; CB22 no
// unmatched admission or emit. `answers` counts each band's answers by method since the record
// began; `meter` is the budget's own cost (7.3).
export async function bandsRead(live:LiveGame,name:string){
  const view=await budgetView(live,name),ring=(await live.clients[name]!.run('globalThis.__partyCalls?.records?.() ?? []')) as any[];
  return {view,ring};
}
export type BandsRead=Awaited<ReturnType<typeof bandsRead>>;
// `heldFrom` leaves out the emits held before it: a row that plants a figure in every packet
// holds them until the plant goes. `dropped` counts, by method, the admitted emits a row's own
// fault drops above the layer, which no emit can match.
export function bandsHold(name:string,{view,ring}:BandsRead,from=0,heldFrom=from,dropped:Record<string,number>={}){
  expect(view,`${name}: the budget answers`).toBeTruthy();
  for(const band of ['survival','job','background'])expect(view.excess[band]??0,`CB7: ${name}'s ${band} band admitted above its limit`).toBeLessThanOrEqual(0);
  expect(view.held,`CB8: ${name}'s hold queue is empty`).toBe(0);
  // Each held entry keeps the margin the budget held when the emit was held and the server figure
  // it went under, so a long wait names its cause. Its bound is the window and that margin: the
  // drain runs on the first timer turn after an entry leaves (+1 ms), and ChronAL's virtual clock
  // moves timers in 250 ms steps.
  const held=ring.filter(r=>r.at-r.waitedMs>=heldFrom&&r.decision==='held');
  expect(held.filter(r=>!Number.isFinite(r.margin)),`CB8: ${name}'s held entries keep their margin at the hold`).toEqual([]);
  // The bound takes the larger of the margin at the hold and at the send. In pass 2's run D a
  // `secondhands` held 4998 ms with a margin of 449 at its
  // hold, while the round trips of the merchant's burst raised it to 948 by the row's stop.
  expect(held.filter(r=>r.waitedMs>WINDOW_MS+Math.max(r.margin,r.sentMargin??r.margin)+1+2*STEP_MS),`CB8: ${name}'s held emits went within the window and the margin`).toEqual([]);
  expect(view.limits,`CB10: ${name}'s limits follow its survival spend ${view.spent.survival} in the window`).toEqual(bandLimits(view.spent.survival));
  const left={...dropped};
  expect(ring.filter(r=>r.at>=from&&r.decision==='unmatched'&&!((left[r.method]??0)>0&&left[r.method]--)),`CB22: ${name}'s unmatched admissions and emits`).toEqual([]);
}
// The change in one band's answers between two reads of one record.
export function answered(before:BandsRead|null,after:BandsRead|null,band:string,method:string){
  const a=after?.view?.answers?.[band]?.[method]??{send:0,notNow:0},b=before?.view?.answers?.[band]?.[method]??{send:0,notNow:0};
  return {send:a.send-b.send,notNow:a.notNow-b.notNow};
}
// The survival questions answered `not-now` between two reads. A read whose counts are
// below the first one's is a new socket's record, which counts from its own start.
export function survivalWaits(before:BandsRead|null,after:BandsRead|null){
  const now=after?.view?.answers?.survival??{},then=before?.view?.answers?.survival??{};
  const fresh=Object.entries(then).some(([method,a]:[string,any])=>(now[method]?.send??0)<a.send||(now[method]?.notNow??0)<a.notNow);
  return Object.entries(now).reduce((sum,[method,a]:[string,any])=>sum+a.notNow-(fresh?0:then[method]?.notNow??0),0);
}
// The budget's own cost (7.3): microseconds per question and per emit.
export function meterOf(read:BandsRead){
  const m=read.view?.meter;
  return m&&{question:{n:m.questions.n,meanUs:m.questions.n?Math.round(m.questions.totalUs/m.questions.n*10)/10:null,maxUs:Math.round(m.questions.maxUs)},
    emit:{n:m.emits.n,meanUs:m.emits.n?Math.round(m.emits.totalUs/m.emits.n*10)/10:null,maxUs:Math.round(m.emits.maxUs)}};
}

// The budget's bound on a headless character: each status report
// carries the budget's largest `used` from the last report to this one, with the interval and the
// margin, on the character's own clock (`calls`, call-budget.ts `sample`). The server and the
// reports are read on two loops of their own, so the admin read's 0.5 to 1.5 s does not slow the
// reports' reads. Each server sample is at most the largest `used` of the intervals within one
// margin of it; an interval starts from the `used` the last one ended on. A report lost on its way
// loses its interval, so a sample no read interval covers is not judged.
export async function headlessBound(live:LiveGame,info:TestInfo,name:string,ms:number){
  const samples:{at:number;server:number;calls?:unknown}[]=[],intervals=new Map<number,{from:number;to:number;used:number}>(),reports:{seenAt:number;from:number;to:number}[]=[];
  let margin=0;
  const end=Date.now()+ms,pause=()=>new Promise(r=>setTimeout(r,250));
  await Promise.all([(async()=>{while(Date.now()<end){
    const server=await live.admin(`output=(()=>{const now=Date.now(),p=get_player('${name}');return {at:now,server:p&&p.socket?p.socket.calls.reduce((s,c)=>now-c[0]<=${WINDOW_MS}?s+c[2]:s,0):null,calls:p&&p.socket?p.socket.calls.filter(c=>now-c[0]<=${WINDOW_MS}).map(c=>[now-c[0],c[1],c[2]]):null};})()`);
    if(Number.isFinite(server.server))samples.push(server);
    await pause();
  }})(),(async()=>{while(Date.now()<end){
    const c=(await live.state()).characters[name],calls=c?.calls;
    if(calls&&Number.isFinite(calls.used)&&!intervals.has(calls.from)){
      reports.push({seenAt:c.seenAt,from:calls.from,to:calls.to});
      intervals.set(calls.from,{from:calls.from,to:calls.to,used:calls.used});
      margin=Math.max(margin,Number(calls.margin)||0);
    }
    await pause();
  }})()]);
  const read=[...intervals.values()];
  const covering=(s:{at:number})=>read.filter(r=>r.to>=s.at-margin&&r.from<=s.at+margin);
  // A sample is judged when the read intervals cover the whole range within one margin of it.
  const covered=(s:{at:number})=>{const list=covering(s).sort((a,b)=>a.from-b.from);let reach=s.at-margin;
    for(const r of list){if(r.from>reach)return false;reach=Math.max(reach,r.to);}return reach>=s.at+margin;};
  const judged=samples.filter(covered);
  const above=judged.flatMap(s=>{
    const most=Math.max(0,...covering(s).map(r=>r.used));
    return s.server>most?[{at:s.at,server:s.server,used:most,calls:s.calls}]:[];
  });
  const result={samples:samples.length,judged:judged.length,reports:reports.length,intervals:read.length,margin,peak:Math.max(0,...samples.map(s=>s.server)),above};
  await attach(info,'cb1-headless-'+name,{...result,samples,reports,intervals:read});
  console.log('CALL-BUDGET-CB1-HEADLESS '+JSON.stringify({...result,above:above.length}));
  expect(result.reports,`CB1: ${name}'s status reports carry its budget's largest used per report`).toBeGreaterThan(0);
  expect(result.judged,`CB1: ${name}'s server samples judged against its reports`).toBeGreaterThan(0);
  expect(above,`CB1: ${name}'s server sum above its reported used`).toEqual([]);
  return result;
}

// The merchant comes back after a disconnect when its status report is fresh again.
export async function merchantReporting(live:LiveGame){
  await expect.poll(async()=>{const c=(await live.state()).characters[M];return !!c&&c.runtime==='native'&&Date.now()-c.seenAt<3000;},
    {timeout:180_000,message:'The merchant reports again'}).toBe(true);
  await expect.poll(()=>live.admin(`output=!!get_player('${M}')`),{timeout:60_000,message:'The merchant is on the server again'}).toBe(true);
}

// T40's Ponty burst: 13 planted listings at Ponty, read while the dashboard's market watch is open
// and bought in one manual order, to the order's end.
export async function pontyBurst(live:LiveGame,result:any){
  // The merchant reads Ponty only while a reader needs the listings, so the row holds the
  // dashboard's market watch open, as a viewer with the market panel open does.
  const watch=new AbortController();
  live.undo('the market watch of the Ponty burst',()=>watch.abort());
  const watching=await fetch(live.deploymentPaths.apiUrl+'/party-api/market-watch',{signal:watch.signal});
  expect(watching.ok,'The market watch opens').toBe(true);
  await live.admin(`output=(()=>{const p=get_player('${M}');p.gold=Math.max(p.gold,2e9);resend(p,'u+cid');
    for(let i=0;i<13;i++)csold.push({name:'staff',level:0,rid:'e2ecb'+i});return true;})()`);
  await live.clients[M]!.run(`smart_move(find_npc('secondhands'),undefined,{request:{kind:'errand',owner:'e2e:call-budget'}}).then(()=>true,()=>false)`);
  let listings:any[]=[];
  await expect.poll(async()=>{listings=((await live.state(true)).ponty?.listings??[]).filter((l:any)=>String(l.key).includes(':e2ecb'));return listings.length;},
    {timeout:60_000,message:'The merchant reads the 13 planted listings'}).toBe(13);
  const order=await live.post('/merchant/ponty-order',{keys:listings.map(l=>l.key),quantity:13,unitPrice:listings[0].unitPrice});
  result.ponty={order};
  await expect.poll(async()=>{const s=await live.state();return [s.merchantCurrent,...(s.merchantQueue??[])].some((j:any)=>j&&order.jobIds.includes(j.id));},
    {timeout:180_000,intervals:[1000],message:'The Ponty job runs to its end'}).toBe(false);
  watch.abort();
  await merchantReporting(live);
}
// T40's stand burst: 16 unlisted trade slots the reconcile takes down, beside the login requests.
export async function standBurst(live:LiveGame,result:any){
  // The stand burst as at login (13.2 correction 4): 16 trade slots no listing names, which the
  // reconcile takes down one by one, and the requests that landed beside it at login, sent from
  // the page the moment the first slot comes down: a tracker request, the player list and the
  // background Ponty read away from Ponty (1.4, bug 8). On b9b5c91e the server's own report
  // summed 224 there, with one merged unequip entry of 128.
  // The page watches the seeded slots from before the seed lands, and sends the login requests
  // on the first tick that shows fewer than the most it has seen, so a reconcile that starts as
  // soon as the slots land is caught too.
  const beside=live.clients[M]!.run(`new Promise(r=>{let most=0;const t=setInterval(()=>{const n=[...Array(16)].filter((_,i)=>character.slots['trade'+(i+1)]?.price===100000+i+1).length;
    most=Math.max(most,n);if(most>0&&n<most){clearInterval(t);parent.socket.emit('tracker');parent.socket.emit('players',{});parent.socket.emit('secondhands');r({at:Date.now(),most});}},10);
    setTimeout(()=>{clearInterval(t);r(null);},180000);})`);
  await live.admin(`output=(()=>{const p=get_player('${M}');if(!p.items.some(i=>i&&i.name==='stand0')){const k=p.items.findIndex((i,n)=>!i&&n<p.isize);p.items[k]={name:'stand0'};}
    for(let i=1;i<=16;i++)p.slots['trade'+i]={name:'feather0',q:1,price:100000+i,rid:'e2ecbt'+i};cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
  await live.post('/merchant/force-stand',{enabled:true});
  await expect.poll(()=>live.admin(`output=(()=>{const p=get_player('${M}');return !p||[...Array(16)].every((_,i)=>!p.slots['trade'+(i+1)]||p.slots['trade'+(i+1)].rid!=='e2ecbt'+(i+1));})()`),
    {timeout:180_000,intervals:[1000],message:'The reconcile takes the 16 slots down'}).toBe(true);
  result.besideAt=await beside.catch(error=>String(error));
  await live.post('/merchant/force-stand',{enabled:false});
  await merchantReporting(live);
}

// CB3: the merchant's server sum never passes the limit, at which the server disconnects the socket
// (server.js:5022-5026), and no limitdc.
export function burstsHold(result:any,measures:Record<string,ReturnType<typeof callMeasures>>,limitdcs:any[]){
  expect(result.besideAt?.most,'CB3: the login requests went beside the reconcile').toBeGreaterThan(0);
  expect(measures[M]!.peak,"CB3: the merchant's peak server sum per 4 s").toBeLessThanOrEqual(LIMIT);
  expect(limitdcs.filter((e:any)=>e.event==='limitdcreport'),'CB3: no limitdc in the bursts').toEqual([]);
}
// CB6: the test client asks job `players` reads while the warrior fights; survival never waits.
export async function cb6Play(live:LiveGame,info:TestInfo,result:any){
  const before6=await bandsRead(live,W),from6=await live.clients[W]!.run('Date.now()') as number;
  // Each survival question answered not-now, with the budget's view at the answer.
  await live.clients[W]!.run(`(()=>{const calls=globalThis.__partyHooks.calls,budget=globalThis.__partyCalls,band=calls.__e2eBand??=calls.band,log=globalThis.__e2eSurvival=[];
    calls.band=q=>{const a=band(q);if(q.band==='survival'&&a!=='send'){const v=budget.view();log.push({at:Date.now(),method:q.method,used:v.used,cc:v.cc,ccAge:v.ccAge,margin:v.margin,held:v.held,heldHead:v.heldHead,limits:v.limits,
      ledger:v.ledger.filter(e=>e.at>Date.now()-6000).map(e=>[e.at-Date.now(),e.method,e.cost])});}return a;};return true;})()`);
  // CB22: the warrior's own Dash in a fight (characters/shared.js `dashToward`) leaves it unable
  // to walk (old_common_functions.js:782), and the game's `move` then refuses with no emit
  // (runner_functions.js:1409-1412). The page holds the Dash state for the first 6 s of the fight,
  // so a movement step sent in it shows as an admission no emit took.
  await live.clients[W]!.run(`(()=>{const end=Date.now()+6000,t=setInterval(()=>{if(Date.now()>end){clearInterval(t);delete character.s.dash;return;}character.s.dash={ms:150};},50);return true;})()`);
  const asked=await live.clients[W]!.run(`(async()=>{const out={send:0,notNow:0,none:0};const end=Date.now()+20000;
    while(Date.now()<end){const a=globalThis.__partyCalls?.band?.({band:'job',method:'players',data:{}});
      if(a==='send'){out.send++;parent.socket.emit('players',{});}else if(a==='not-now')out.notNow++;else out.none++;
      await new Promise(r=>setTimeout(r,250));}return out;})()`);
  const after6=await bandsRead(live,W);
  result.cb6={before:before6,after:after6};
  result.asked=asked;
  result.survivalNotNow=await live.clients[W]!.run(`(()=>{const calls=globalThis.__partyHooks.calls;if(calls.__e2eBand){calls.band=calls.__e2eBand;delete calls.__e2eBand;}return globalThis.__e2eSurvival;})()`);
  result.ring6=after6.ring.filter((r:any)=>r.at>=from6);
  await attach(info,'call-budget-row-b-cb6',{asked,survivalNotNow:result.survivalNotNow,ring:result.ring6,before:before6.view,after:after6.view});
  const waits6=result.survivalNotNow as any[];
  console.log('CALL-BUDGET-CB6 '+JSON.stringify({asked,survivalNotNow:waits6.length,heldHeads:waits6.map(w=>w.heldHead)}));
}
export function cb6Hold(result:any){
  const {asked,cb6:{before:before6,after:after6}}=result,waits6=result.survivalNotNow as any[];
  expect(asked.none,'CB6: calls.band answers the job questions').toBe(0);
  expect(asked.send,'CB6: job reads go while the warrior fights').toBeGreaterThan(0);
  expect(answered(before6,after6,'survival','move').send,'CB6: combat steps go while jobs fill the window').toBeGreaterThan(0);
  // The console's own tracker request and player list ask the background band (3.7), so no held
  // read holds a survival question: every survival wait is CB6's failure.
  expect(waits6,'CB6: survival questions answered not-now').toEqual([]);
}
// CB24's age half on the warrior, which holds a Tracktrix and fights goo: `from` is the window
// start and `unplanted` the end of its last planted figure.
export async function trackerAgePlay(live:LiveGame,from:number,unplanted:number,result:any){
  // CB24: the Tracktrix holder's reply age in the fight. A planted figure shuts every band by
  // construction, so the age is read after the last plant: from the first reply a window after
  // it to the next one, while the warrior keeps farming goo.
  const margin=(await budgetView(live,W))?.margin??WINDOW_MS,bound=TRACKER_REFRESH_MS+2*(WINDOW_MS+margin);
  const arrivals=async()=>(await live.clients[W]!.events()).filter((e:any)=>e.event==='tracker-arrived').map((e:any)=>Number(e.at));
  const after=unplanted+WINDOW_MS+margin;
  let first=0,next=0;
  await expect.poll(async()=>(first=(await arrivals()).find(at=>at>=after)??0),{timeout:TRACKER_REFRESH_MS+30_000,intervals:[500],message:'CB24: a reply after the last plant'}).toBeGreaterThan(0).catch(()=>{});
  if(first)await expect.poll(async()=>(next=(await arrivals()).find(at=>at>first)??0),{timeout:bound+10_000,intervals:[500],message:'CB24: the next reply in the fight'}).toBeGreaterThan(0).catch(()=>{});
  const to=await live.clients[W]!.run('Date.now()') as number;
  result.trackerAge={...await trackerReplyAge(live,W,from,to),first,next,age:next&&first?next-first:null,bound,
    kills:(await live.clients[W]!.events()).filter((e:any)=>e.event==='hit'&&e.data?.hid===W&&(e.data.kill||e.data.dead)&&e.at>=first).length,
    // What the tracker read did after the plant: the Tracktrix in the bag on both sides, the call
    // ring's tracker answers and the figure the budget reads, so a missing reply names its side.
    read:await live.clients[W]!.run(`({holds:character.items.some(i=>i&&i.name==='tracker'),cc:__partyCalls.view().cc??null,
      calls:__partyCalls.records().filter(r=>r.method==='tracker'&&r.at>=${unplanted-60_000}).slice(-12),
      probe:globalThis.__e2eTrackerProbe?{emits:__e2eTrackerProbe.emits.slice(-12),received:(__e2eTrackerProbe.received||[]).slice(-12),answers:__e2eTrackerProbe.answers.slice(-20),count:__e2eTrackerProbe.count}:null,arrivals:${JSON.stringify((await arrivals()).filter(at=>at>=unplanted-60_000))}})`),
    page:await live.clients[W]!.run(`({sid:parent.socket.id,connected:parent.socket.connected,buffered:parent.socket.sendBuffer?.length??null,trackerListeners:parent.socket.listeners('tracker').length})`),
    server:await live.admin(`output=(()=>{const p=get_player('${W}'),log=globalThis.__e2eTrackerServer;return {tracker:p.tracker??null,holds:p.items.some(i=>i&&i.name==='tracker'),sid:p.socket.id,
      listeners:p.socket.listeners('tracker').length,probe:log?{sid:log.sid,received:log.received.slice(-12),sent:log.sent.slice(-12)}:null};})()`)};
}
export function trackerAgeHold(result:any){
  expect(result.trackerAge.age,`CB24: the reply age in the fight: ${JSON.stringify(result.trackerAge)}`).not.toBeNull();
  expect(result.trackerAge.age,'CB24: the reply age in the fight').toBeLessThanOrEqual(result.trackerAge.bound);
  expect(result.trackerAge.kills,'CB24: the warrior fights while the age is read').toBeGreaterThan(0);
}
// Row B, "call budget: survival goes first while jobs fill the window": the warrior walks to goo
// and fights it with a Tracktrix in its bag. CB1, CB5, CB6, CB7, CB8, CB9, CB10, CB22, CB23, CB24.
// The plant raises only the warrior's packet figure; the server's limit check keeps
// the real sum (11, "the plant").
// The fixture's row undo (live-fixtures.ts `undo`, F-02686): a row that wraps calls.band and
// socket.emit, as survivalRow's send log does, registers their undo, and the row's end leaves both
// as the client built them for the next row, whether the row passed or threw.
export async function rowUndoRow(live:LiveGame){
  const client=live.clients[W]!;
  await client.run(`(()=>{const calls=globalThis.__partyHooks.calls,socket=parent.socket;globalThis.__e2eBuilt={band:calls.band,emit:socket.emit};
    const band=calls.band,emit=socket.emit;calls.band=q=>band(q);socket.emit=function(){return emit.apply(this,arguments);};
    globalThis.__e2eUndoProbe=()=>{calls.band=band;socket.emit=emit;};return calls.band!==globalThis.__e2eBuilt.band;})()`);
  live.undo(`the undo row's calls.band and socket.emit on ${W}`,()=>client.run('globalThis.__e2eUndoProbe()'));
  await live.undoRow();
  expect(await client.run(`(()=>{const b=globalThis.__e2eBuilt;delete globalThis.__e2eBuilt;delete globalThis.__e2eUndoProbe;
    return {band:globalThis.__partyHooks.calls.band===b.band,emit:parent.socket.emit===b.emit};})()`),'the row end puts back both as the client built them').toEqual({band:true,emit:true});
}

export async function forcedLimitdcPlay(live:LiveGame,info:TestInfo){
  await merchantReporting(live);
  const key='party-call-budget-limitdc:'+M;
  const records=async()=>((await (await fetch(`${live.url}/party-api/diagnostics/records?character=${M}&rings=movement`)).json()).snapshots??[]).filter((s:any)=>s.trigger==='limitdc');
  const full=async(id:string)=>(await fetch(`${live.url}/party-api/movement/snapshot?character=${M}&id=${encodeURIComponent(id)}`)).json();
  const prior=new Set((await records()).map((s:any)=>s.id));
  const planted={id:`${M}:e2e-planted`,character:M,trigger:'limitdc',records:[{part:'calls',decision:'limitdc',method:'limitdc',cost:0,used:0,e2e:'planted'}],incidents:[]};
  await live.clients[M]!.run(`(()=>{const list=JSON.parse(localStorage.getItem(${JSON.stringify(key)})||'[]');list.push(${JSON.stringify(planted)});localStorage.setItem(${JSON.stringify(key)},JSON.stringify(list));return true;})()`);
  live.declareLimitdc(M);
  const before=live.clients[M]!.limitdcs().length;
  await live.clients[M]!.run(`(()=>{const emit=parent.__partyCallBudget?.emit??parent.socket.emit;for(let i=0;i<5;i++)emit.call(parent.socket,'tracker');return true;})()`).catch(()=>null);
  await expect.poll(()=>live.clients[M]!.limitdcs().slice(before).filter(e=>e.event==='limitdcreport').length,{timeout:30_000,message:'The fault disconnects the merchant'}).toBe(1);
  await merchantReporting(live);
  let fresh:any[]=[],left:any=null;
  await expect.poll(async()=>{fresh=(await records()).filter((s:any)=>!prior.has(s.id));left=await live.clients[M]!.run(`localStorage.getItem(${JSON.stringify(key)})`).catch(()=>'unread');
    return fresh.length>=2&&(left===null||left==='[]');},{timeout:60_000,intervals:[500],message:'CB18: the snapshot and the planted copy reach the coordinator'}).toBe(true).catch(()=>{});
  const bodies=await Promise.all(fresh.map((s:any)=>full(s.id)));
  const entry=(b:any)=>(b.records??[]).find((r:any)=>r.part==='calls'&&r.decision==='limitdc');
  const real=bodies.filter(b=>entry(b)&&!entry(b).e2e),copy=bodies.filter(b=>entry(b)?.e2e==='planted');
  const report=live.clients[M]!.limitdcs().slice(before).find(e=>e.event==='limitdcreport')?.data as any;
  await attach(info,'call-budget-row-c',{limitdcs:live.clients[M]!.limitdcs().slice(before),snapshots:bodies,left});
  console.log('CALL-BUDGET-ROW-C '+JSON.stringify({snapshots:fresh.length,real:real.length,planted:copy.length,left,reportCalls:entry(real[0]??{})?.report?.calls?.length??null}));
  return {real,copy,left,report,saved:entry(real[0]??{})};
}
export function forcedLimitdcHold({real,copy,left,report,saved}:Awaited<ReturnType<typeof forcedLimitdcPlay>>){
  expect(real.length,'CB18: one limitdc snapshot at the coordinator').toBe(1);
  expect(saved.report,"CB18: the snapshot holds the server's report").toEqual(report);
  expect(Array.isArray(saved.ledger),'CB18: the snapshot holds the ledger').toBe(true);
  expect((real[0].records??[]).every((r:any)=>r.part==='calls'),'CB18: the snapshot holds the call ring').toBe(true);
  expect(copy.length,'CB18: the copy left in local storage is posted by the next install').toBe(1);
  expect(left===null||left==='[]','CB18: no local copy is left').toBe(true);
}

// CB17, after a CODE reload on every native client: the new install keeps one record per
// socket with a live install, the socket keeps the listener count it had before (the old runtime's
// `tracker`, `player` and `players` listeners left with it), and the server sees exactly one
// `players` charge of the status owner per 10 s tick: a doubled read would show two charges within one tick (or
// one merged entry of 24), a stopped one a gap past the tick and the read's wait bound.
export async function codeReloadReads(live:LiveGame,info:TestInfo){
  const names=Object.keys(live.clients),events=['tracker','player','players','new_map','limitdcreport','disconnect_reason'];
  const listeners=(n:string)=>live.clients[n]!.run(`(()=>{const s=parent.socket;return Object.fromEntries(${JSON.stringify(events)}.map(e=>[e,typeof s.listeners==='function'?s.listeners(e).length:null]));})()`);
  const before=Object.fromEntries(await Promise.all(names.map(async n=>[n,await listeners(n)])));
  const runtimes=Object.fromEntries(names.map(n=>[n,null as unknown]));
  const state=await live.state();
  for(const n of names)runtimes[n]=state.characters[n]?.dashboardRuntime;
  for(const n of names)await reloadCode(live,n);
  await expect.poll(async()=>{const s=await live.state();return names.every(n=>s.characters[n]?.dashboardRuntime!==runtimes[n]&&s.characters[n]?.seenAt>Date.now()-5000);},
    {timeout:60_000,message:'CB17: every native client runs its reloaded CODE'}).toBe(true);
  // Each install the page sees, marked on the install object at first sight: a second install after
  // the reload (a CODE load of the console's own) starts its own reads, and the window starts after
  // it, so each install's start read is not taken for a doubled tick.
  const installs=Object.fromEntries(names.map(n=>[n,new Set<number>()]));
  const seeInstalls=async()=>{for(const n of names){const m=await live.clients[n]!.run('(()=>{const i=parent.__partyCallBudget?.install;return i?(i.__e2eSeen??=Date.now()):null;})()').catch(()=>null);if(m)installs[n]!.add(m as number);}};
  await seeInstalls();
  await waitForGameplay(5000);
  await seeInstalls();
  const settled=Object.fromEntries(names.map(n=>[n,installs[n]!.size]));
  const after=Object.fromEntries(await Promise.all(names.map(async n=>[n,await listeners(n)])));
  const records=Object.fromEntries(await Promise.all(names.map(async n=>[n,await live.clients[n]!.run(`(()=>{const r=parent.__partyCallBudget;return {record:!!r,same:!!r&&r.socket===parent.socket,live:!!r?.install&&!r.install.retired,margin:globalThis.__partyCalls?.view?.().margin??null};})()`)])));
  // The server's `players` entries on each socket for 31 s, each kept at its largest amount.
  const seen=Object.fromEntries(names.map(n=>[n,new Map<string,{at:number;num:number}>()]));
  const end=Date.now()+31_000;
  while(Date.now()<end){
    const read=await live.admin(`output=Object.fromEntries(${JSON.stringify(names)}.map(n=>{const p=get_player(n);return [n,p?p.socket.calls.filter(c=>c[1]==='players').map(c=>[+c[0],c[2]]):[]];}))`) as Record<string,[number,number][]>;
    for(const n of names)for(const [at,num] of read[n]??[]){const k=String(at),was=seen[n]!.get(k);seen[n]!.set(k,{at,num:Math.max(num,was?.num??0)});}
    await seeInstalls();
    await waitForGameplay(500);
  }
  const ticks=Object.fromEntries(names.map(n=>{const list=[...seen[n]!.values()].sort((a,b)=>a.at-b.at);return [n,{list,gaps:list.slice(1).map((e,i)=>e.at-list[i]!.at)}];}));
  const installsSeen=Object.fromEntries(names.map(n=>[n,{settled:settled[n],all:[...installs[n]!]}]));
  await attach(info,'cb17-code-reload',{before,after,records,ticks,installsSeen});
  console.log('CALL-BUDGET-CB17 '+JSON.stringify({installsSeen,records,ticks:Object.fromEntries(names.map(n=>[n,{n:ticks[n].list.length,nums:ticks[n].list.map((e:any)=>e.num),gaps:ticks[n].gaps}]))}));
  for(const n of names){
    expect(records[n],`CB17: ${n} keeps one budget record on its socket with a live install`).toMatchObject({record:true,same:true,live:true});
    expect(after[n],`CB17: ${n}'s socket listeners after the reload`).toEqual(before[n]);
    expect(installs[n]!.size,`CB17: no install of ${n} during the 31 s window`).toBe(settled[n]);
    const {list,gaps}=ticks[n],bound=WINDOW_MS+(records[n].margin??WINDOW_MS);
    expect(list.length,`CB17: ${n}'s players charges in 31 s`).toBeGreaterThanOrEqual(3);
    expect(list.map((e:any)=>e.num),`CB17: each of ${n}'s players charges is one read of 12`).toEqual(list.map(()=>12));
    for(const gap of gaps)expect(Math.abs(gap-10_000),`CB17: ${n}'s players charges one 10 s tick apart: ${JSON.stringify(gaps)}`).toBeLessThanOrEqual(bound);
  }
}

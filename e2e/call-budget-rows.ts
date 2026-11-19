import {expect,callMeasures,trackerReplyAge,plantVitals,type LiveGame,type CallSample,reloadCode} from './live-fixtures';
import type {TestInfo} from '@playwright/test';
import {fighters,location,party} from './game/hunt-lifecycle';
import {waitForGameplay} from './network-clock';
import {spendLog,spendsSince,red} from './turns-rows';
import {killNativeCharacter} from './hunt-interruption-helpers';
import {CALL_LIMIT as LIMIT,CALL_WINDOW_MS as WINDOW_MS,bandLimits,READ_PICKS} from '../runtime/characters/call-budget-limits.ts';

// The call budget's rows of the default table: row A, the merchant's bursts and its Tracktrix read;
// row B, survival first while jobs fill the window; row C, a forced limitdc. Each checks its failure
// modes by number after the row's measures, so a row on a tree without the budget still measures.
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
// no page (`page` false), so the server's packet alone gives it.
export async function holdTracktrix(live:LiveGame,name:string,page=true){
  await live.admin(`output=(()=>{const p=get_player('${name}');if(p.items.some(i=>i&&i.name==='tracker'))return true;
    const slot=p.items.findIndex((i,k)=>!i&&k<p.isize);if(slot<0)throw Error('No free slot for the Tracktrix');p.items[slot]={name:'tracker'};
    cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
  if(page)await expect.poll(()=>live.clients[name]!.run(`character.items.some(i=>i&&i.name==='tracker')`),{timeout:15_000}).toBe(true);
}
// The Tracktrix taken from the bag, as banking it would.
async function dropTracktrix(live:LiveGame,name:string){
  await live.admin(`output=(()=>{const p=get_player('${name}');p.items=p.items.map(i=>i&&i.name==='tracker'?null:i);cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
  await expect.poll(()=>live.clients[name]!.run(`!character.items.some(i=>i&&i.name==='tracker')`),{timeout:15_000}).toBe(true);
}

// CB15 and CB16 on the merchant's native client. The page logs each `tracker` emit at the
// top of the socket's emit chain and each tracker window the game draws (`render_tracker` draws it
// with `show_modal`, js/html.js:3212), so the checks read the game's own calls, not the read's
// state. Lost replies come from the server's own `tracker` listener taken off the merchant's
// socket, and put back after.
async function trackerChecks(live:LiveGame){
  const page=live.clients[M]!,now=()=>page.run('Date.now()') as Promise<number>;
  await page.run(`(()=>{const s=parent.socket,emit=s.emit,show=parent.show_modal,log=globalThis.__e2eTracker={asks:[],windows:[],emit,show};
    s.emit=log.mine=function(method,...rest){if(method==='tracker')log.asks.push(Date.now());return emit.apply(this,[method,...rest]);};
    if(typeof show==='function')parent.show_modal=log.mineShow=function(html,...rest){if(String(html).includes('trackerm'))log.windows.push(Date.now());return show.apply(this,[html,...rest]);};
    return {render:typeof parent.render_tracker,show:typeof show};})()`);
  const log=()=>page.run('({asks:globalThis.__e2eTracker.asks,windows:globalThis.__e2eTracker.windows})') as Promise<{asks:number[];windows:number[]}>;
  const replies=async(from:number)=>(await page.events()).filter((e:any)=>e.event==='tracker-arrived'&&e.at>=from).length;
  const out:any={};
  try{
    // CB16: a lost Tracktrix asks nothing.
    await dropTracktrix(live,M);
    const goneAt=await now();
    await waitForGameplay(5000);
    out.whileGone=(await log()).asks.filter(at=>at>goneAt);
    // CB16 and CB15: a gained Tracktrix asks at once, and its automatic reply opens no window.
    const gainFrom=await now();
    await holdTracktrix(live,M);
    const gainedAt=await now();
    await expect.poll(async()=>replies(gainFrom),{timeout:15_000,message:'CB15: the automatic request is answered'}).toBeGreaterThan(0).catch(()=>{});
    await waitForGameplay(1000);
    out.gain={gainFrom,gainedAt,asks:(await log()).asks.filter(at=>at>=gainFrom),windows:(await log()).windows.filter(at=>at>=gainFrom),replies:await replies(gainFrom)};
    // CB15: the player's own request (an untagged emit from the page) opens the next window.
    const manualFrom=await now();
    await page.run(`(parent.socket.emit('tracker'),true)`);
    await expect.poll(async()=>replies(manualFrom),{timeout:15_000,message:'CB15: the manual request is answered'}).toBeGreaterThan(0).catch(()=>{});
    await expect.poll(async()=>(await log()).windows.filter(at=>at>=manualFrom).length,{timeout:5_000,message:'CB15: the manual request shows the tracker window'}).toBeGreaterThan(0).catch(()=>{});
    out.manual={manualFrom,windows:(await log()).windows.filter(at=>at>=manualFrom),replies:await replies(manualFrom)};
    await page.run('(parent.hide_modal?.(),true)').catch(()=>null);
    // CB16 and CB30: with replies lost, a gained Tracktrix asks at once, again one margin later,
    // then at the 30 s refresh.
    await dropTracktrix(live,M);
    await live.admin(`output=(()=>{const s=get_player('${M}').socket;globalThis.__e2eTrackerListeners=s.listeners('tracker');s.removeAllListeners('tracker');return globalThis.__e2eTrackerListeners.length;})()`);
    try{
      const lostFrom=await now();
      await holdTracktrix(live,M);
      // The window runs from the first request, past the third's due time by a few seconds.
      let first=0;
      await expect.poll(async()=>(first=(await log()).asks.find(at=>at>=lostFrom)??0),{timeout:15_000,message:'CB16: the gained Tracktrix asks'}).toBeGreaterThan(0).catch(()=>{});
      const margin=Number(await page.run('globalThis.__partyCalls?.view?.().margin ?? 0'))||0;
      await waitForGameplay(Math.max(0,first+margin+TRACKER_REFRESH_MS+WINDOW_MS-await now()));
      out.lost={lostFrom,margin,asks:(await log()).asks.filter(at=>at>=lostFrom),replies:await replies(lostFrom)};
    }finally{
      await live.admin(`output=(()=>{const s=get_player('${M}').socket;for(const l of globalThis.__e2eTrackerListeners||[])s.on('tracker',l);delete globalThis.__e2eTrackerListeners;return s.listeners('tracker').length;})()`);
    }
    // CB30: a `kill_credit` raises its monster's count by 1 on the reply the game client holds as
    // its `tracker`, with no read. The server sends the packet to the credited socket as its kill
    // paths do (server.js:2778), here for a goo.
    const creditFrom=await now();
    await page.run(`(parent.socket.emit('tracker'),true)`);
    await expect.poll(async()=>replies(creditFrom),{timeout:15_000,message:'CB30: a reply arrives before the credit'}).toBeGreaterThan(0).catch(()=>{});
    const count=()=>page.run('Number(parent.tracker?.monsters?.goo)||0') as Promise<number>;
    const before=await count(),asksBefore=(await log()).asks.length;
    await live.admin(`output=(get_player('${M}').socket.emit('kill_credit',{mtype:'goo'}),true)`);
    await expect.poll(count,{timeout:5_000,message:'CB30: the credit raises the count'}).toBe(before+1).catch(()=>{});
    out.credit={before,after:await count(),asks:(await log()).asks.length-asksBefore};
    out.ring=((await page.run('globalThis.__partyCalls?.records?.() ?? []')) as any[]).filter(r=>r.method==='tracker'&&r.decision==='read-job');
  }finally{
    await page.run(`(()=>{const log=globalThis.__e2eTracker;if(!log)return true;if(parent.socket.emit===log.mine)parent.socket.emit=log.emit;if(log.mineShow&&parent.show_modal===log.mineShow)parent.show_modal=log.show;delete globalThis.__e2eTracker;return true;})()`).catch(()=>null);
    await holdTracktrix(live,M).catch(()=>{});
  }
  return out;
}
function trackerHolds(t:any){
  expect(t,'CB15, CB16: the Tracktrix checks ran').toBeTruthy();
  expect(t.whileGone,'CB16: a lost Tracktrix asks nothing').toEqual([]);
  expect(t.gain.asks.length,`CB16: a gained Tracktrix asks: ${JSON.stringify(t.gain)}`).toBeGreaterThan(0);
  expect(t.gain.asks[0]-t.gain.gainedAt,'CB16: a gained Tracktrix asks at once').toBeLessThanOrEqual(2*STEP_MS);
  expect(t.gain.replies,'CB15: the automatic request is answered').toBeGreaterThan(0);
  expect(t.gain.windows,'CB15: an automatic reply opens no tracker window').toEqual([]);
  expect(t.manual.windows.length,`CB15: a manual request shows the tracker window: ${JSON.stringify(t.manual)}`).toBeGreaterThan(0);
  const asks=t.lost.asks as number[],gaps=asks.slice(1).map((at,i)=>at-asks[i]!);
  expect(t.lost.replies,'CB16: the server answers no request while its listener is off').toBe(0);
  expect(asks.length,`CB16: requests at 0, one margin and the refresh with replies lost: ${JSON.stringify(asks.map(a=>a-t.lost.lostFrom))}`).toBe(3);
  expect(gaps[0],`CB30: a lost reply is asked again one margin (${t.lost.margin} ms) after the request`).toBeLessThanOrEqual(t.lost.margin+2*STEP_MS);
  expect(gaps[1],'CB16: the next lost reply waits the 30 s refresh').toBeGreaterThanOrEqual(TRACKER_REFRESH_MS);
  expect(gaps[1],'CB16: the next lost reply waits the 30 s refresh').toBeLessThanOrEqual(TRACKER_REFRESH_MS+2*STEP_MS);
  expect(t.credit.after,'CB30: a kill_credit raises its count on the game client tracker by 1').toBe(t.credit.before+1);
  expect(t.credit.asks,'CB30: with no tracker read').toBe(0);
  expect(t.ring,'CB30: no tracker read in the job band').toEqual([]);
}
// The sampler's measures and CB1's bound for each sampled character, attached and logged.
async function sampled(info:TestInfo,label:string,samples:CallSample[],names:string[]){
  const measures=Object.fromEntries(names.map(n=>[n,callMeasures(samples,n)]));
  await attach(info,label+'-call-samples',{measures,samples});
  console.log('CALL-SAMPLES '+JSON.stringify({label,measures:Object.fromEntries(Object.entries(measures).map(([n,m])=>[n,{...m,above:m.above?.length??null}]))}));
  return measures;
}
// CB1: each server sample is at most the largest `used` the character held within one margin of it.
function boundHolds(measures:Record<string,ReturnType<typeof callMeasures>>,names:string[]){
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
async function perCallCosts(live:LiveGame,info:TestInfo){
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
  await expect.poll(()=>live.clients[P]!.run(together),{timeout:60_000,message:'The priest is in the warrior\'s party'}).toBe(true);
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
  },{timeout:15_000,intervals:[100],message:'CB4: the party leave and its rejoin booked at the server\'s charge'}).toBe(true).catch(()=>{});
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
function costsHold({results,server}:Awaited<ReturnType<typeof perCallCosts>>){
  expect(server,'CB4: the table\'s CC and limit are the running server\'s').toEqual({CC:{move:1.5,players:12,secondhands:16,tracker:50,equip:3,unequip:6,send_updates:12,auth:2,friend:24,cruise:10},calls:200});
  chargesHold(results);
}
export function chargesHold(results:any[]){
  for(const r of results)expect([r.label,r.ledger],`CB4: ${r.label} entries ${JSON.stringify(r.entries)} ledger ${JSON.stringify(r.ledgerEntries)} refused ${JSON.stringify(r.refused)}`).toEqual([r.label,r.server]);
}

// The bands' own checks on one character's budget: CB7 no band
// admitted above its limit; CB8 the hold queue empty and each held emit gone within the window and
// the margin; CB10 the room at max(12, peak), capped at 110, and the limits from it; CB22 no
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
  expect(view.room,`CB10: ${name}'s room follows its survival peak ${view.peak}`).toBe(bandLimits(view.peak).room);
  expect(view.limits,`CB10: ${name}'s limits follow the room`).toEqual(bandLimits(view.peak));
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

// CB26: a runtime stop with no next install, the player's Disengage, retires the install
// and drains its held emits as the window frees. The plant holds an untagged `players` read in
// the merchant's hold queue; the game's own `stop_runner` removes the CODE frame, whose `stop`
// runs on its pagehide (runtime/lifecycle/character/loader.ts `dispose`). The stop key a Disengage writes
// (runtime/lifecycle/roster/recovery.ts) keeps the Steam recovery from starting the next install until the
// check ends, so the drain runs from the record's timer on the game window alone. Then the key
// goes and the page starts the CODE again, as CB17's reload does.
async function stopRetires(live:LiveGame){
  const frame=live.clients[M]!.frame,key='party-code-stopped:'+M;
  const margin=(await budgetView(live,M))?.margin??WINDOW_MS;
  await live.plantCallCost(M,199);
  await live.admin(`output=(()=>{resend(get_player('${M}'),'u');return true;})()`);
  await expect.poll(()=>live.clients[M]!.run('(__partyCalls.view().cc??0)>=199'),{timeout:10_000,message:'CB26: the planted figure arrives'}).toBe(true);
  let stopped:any;
  try{
    stopped=await frame.evaluate((key:string)=>{
      const w=window as any,record=w.__partyCallBudget,install=record.install,socket=w.socket;
      // The run scope puts its own wrapper of each listener on the socket, so the row counts the
      // socket's listeners per event, as CB17 does: the stop takes off as many as the install owns.
      const own:Record<string,number>={};
      for(const [event] of install.listeners as [string,unknown][])own[event]=(own[event]??0)+1;
      const count=()=>Object.fromEntries(Object.keys(own).map(event=>[event,socket.listeners(event).length]));
      w.localStorage.setItem(key,'1');
      socket.emit('players',{});
      const held=record.held.length,at=Date.now(),before=count();
      w.stop_runner();
      const after=count();
      return {at,held,installAfter:record.install===undefined?null:'live',retired:install.retired,before,after,
        listenersLeft:Object.keys(own).filter(event=>after[event]!==before[event]-own[event]),
        wrapperOnTop:socket.emit===install.wrapper};
    },key);
  }finally{await live.plantCallCost(M,0);}
  let drained:any=null;
  await expect.poll(async()=>(drained=await frame.evaluate(()=>{const w=window as any,r=w.__partyCallBudget;
    return {at:Date.now(),held:r.held.length,install:r.install===undefined?null:'live',ring:r.ring.entries.filter((e:any)=>e.decision==='held').slice(-1)};})).held,
    {timeout:2*WINDOW_MS+10_000,intervals:[100],message:'CB26: the held emit goes with no install'}).toBe(0).catch(()=>{});
  const charged=(await serverCalls(live,M)).calls.filter(([,method])=>method==='players');
  await frame.evaluate((key:string)=>{(window as any).localStorage.removeItem(key);},key);
  await reloadCode(live,M);
  await merchantReporting(live);
  console.log('CALL-BUDGET-CB26 '+JSON.stringify({stopped,drained,charged}));
  return {stopped:{...stopped,margin},drained,charged};
}
function stopHolds({stopped,drained,charged}:Awaited<ReturnType<typeof stopRetires>>){
  expect(stopped.held,'CB26: the planted figure holds the players read').toBeGreaterThan(0);
  expect(stopped.installAfter,'CB26: the stop retires the install').toBeNull();
  expect(stopped.retired,'CB26: the stopped wrapper passes every emit on').toBe(true);
  expect(stopped.listenersLeft,'CB26: the stopped install\'s listeners leave the socket').toEqual([]);
  expect(stopped.wrapperOnTop,'CB26: the stopped wrapper is not the socket\'s emit').toBe(false);
  expect(drained?.held,'CB26: the held emit goes after the stop').toBe(0);
  expect(drained?.install,'CB26: it goes with no install').toBeNull();
  expect(drained.at-stopped.at,'CB26: within one window and the margin of the stop').toBeLessThanOrEqual(WINDOW_MS+stopped.margin+1+2*STEP_MS);
  expect(charged.map(([,,num])=>num),'CB26: the server charges the held players read').toContain(12);
}

// The merchant comes back after a disconnect when its status report is fresh again.
async function merchantReporting(live:LiveGame){
  await expect.poll(async()=>{const c=(await live.state()).characters[M];return !!c&&c.runtime==='native'&&Date.now()-c.seenAt<3000;},
    {timeout:180_000,message:'The merchant reports again'}).toBe(true);
  await expect.poll(()=>live.admin(`output=!!get_player('${M}')`),{timeout:60_000,message:'The merchant is on the server again'}).toBe(true);
}

// Row A, "call budget: the merchant's bursts stay under the limit": 13 Ponty reads at Ponty (13
// listings planted in the server's `csold`, a manual Ponty order for all of them, INV-015) and a
// 16-slot stand reconcile (unlisted items seeded in trade1 to trade16, INV-099) beside the requests
// that land with it at login, while the merchant holds a Tracktrix; then the Tracktrix read's render
// half and its waits, and a runtime stop with no next install. CB1, CB3, CB4, CB7, CB8, CB10,
// CB15, CB16, CB22, CB26.
export async function burstsRow(live:LiveGame,info:TestInfo){
  const names=[M,W,P],result:any={};
  await merchantReporting(live);
  await holdTracktrix(live,M);
  const sampler=live.sampleCalls(names);
  const limitdcsBefore=live.clients[M]!.limitdcs().length,from=await live.clients[M]!.run('Date.now()') as number;
  let samples:CallSample[]=[],costs:Awaited<ReturnType<typeof perCallCosts>>|undefined;
  try{
    // The Ponty burst. The merchant reads Ponty only while a reader needs the listings, so the row
    // holds the dashboard's market watch open, as a viewer with the market panel open does.
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
    costs=await perCallCosts(live,info);
    result.tracker=await trackerChecks(live);
    result.stop=await stopRetires(live);
  }catch(error){
    // A row that stops keeps its server samples and the merchant's ledger reads: a limitdc run
    // lost them once, and its trace had only the server's report.
    samples=await sampler.stop();
    await sampled(info,'row-a',samples,names).catch(()=>{});
    throw error;
  }finally{
    if(!samples.length)samples=await sampler.stop();
    await live.post('/merchant/force-stand',{enabled:false}).catch(()=>{});
    await live.admin(`output=(()=>{for(let i=csold.length-1;i>=0;i--)if(String(csold[i].rid).startsWith('e2ecb'))csold.splice(i,1);return true;})()`).catch(()=>{});
    // A seeded trade slot the reconcile left would be the next login's burst.
    await live.admin(`output=(()=>{const p=get_player('${M}');if(!p)return false;for(let i=1;i<=16;i++)if(p.slots['trade'+i]&&String(p.slots['trade'+i].rid).startsWith('e2ecbt'))p.slots['trade'+i]=null;resend(p,'reopen+cid');return true;})()`).catch(()=>{});
  }
  const measures=await sampled(info,'row-a',samples,names);
  const limitdcs=live.clients[M]!.limitdcs().slice(limitdcsBefore),bands=await bandsRead(live,M);
  result.measures=measures;result.limitdcs=limitdcs;result.bands={view:bands.view,ring:bands.ring,meter:meterOf(bands)};
  await attach(info,'call-budget-row-a',result);
  console.log('CALL-BUDGET-ROW-A '+JSON.stringify({merchant:{peak:measures[M]!.peak,p95:measures[M]!.p95},limitdc:limitdcs.filter((e:any)=>e.event==='limitdcreport').length,
    besideAt:result.besideAt,held:bands.ring.filter((r:any)=>r.decision==='held').length,room:bands.view?.room,peak:bands.view?.peak,meter:meterOf(bands)}));
  boundHolds(measures,names.filter(n=>live.clients[n]));
  costsHold(costs!);
  trackerHolds(result.tracker);
  stopHolds(result.stop);
  // CB3: the merchant's server sum never passes the limit, at which the server disconnects the socket
  // (server.js:5022-5026), and no limitdc.
  expect(result.besideAt?.most,'CB3: the login requests went beside the reconcile').toBeGreaterThan(0);
  expect(measures[M]!.peak,'CB3: the merchant\'s peak server sum per 4 s').toBeLessThanOrEqual(LIMIT);
  expect(limitdcs.filter((e:any)=>e.event==='limitdcreport'),'CB3: no limitdc in the bursts').toEqual([]);
  bandsHold(M,bands,from);
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
export async function survivalRow(live:LiveGame,info:TestInfo){
  const names=[W,P],result:any={};
  await holdTracktrix(live,W);
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'merchant idle':false,'stand maintenance':false}});
  await party(live);
  const sampler=live.sampleCalls(names);
  let samples:CallSample[]=[];
  const clock=()=>live.clients[W]!.run('Date.now()') as Promise<number>;
  const packet=()=>live.admin(`output=(()=>{resend(get_player('${W}'),'u');return true;})()`);
  const from=await clock(),start=await bandsRead(live,W);
  let unplanted=from;
  // Each question answered `send`, with the frames that asked it, so an unmatched admission names
  // its asker.
  // The page's socket also logs each emit above the layer, in one sequence with the sends and the
  // end of each send's turn, so a send with no emit of its method before its turn ends shows.
  await live.clients[W]!.run(`(()=>{const calls=globalThis.__partyHooks.calls,band=calls.band,log=globalThis.__e2eSends=[];let seq=0;
    calls.band=q=>{const a=band(q);if(a==='send'){const id=++seq;log.push({seq:id,at:Date.now(),kind:'send',band:q.band,method:q.method,site:String(new Error().stack).split(String.fromCharCode(10)).slice(2,10).map(l=>l.trim())});
      queueMicrotask(()=>log.push({seq:++seq,kind:'turn',of:id}));if(log.length>600)log.splice(0,100);}return a;};
    const socket=parent.socket,emit=socket.emit;socket.emit=function(method,...rest){log.push({seq:++seq,at:Date.now(),kind:'emit',method});return emit.call(this,method,...rest);};
    globalThis.__e2eSendsUndo=()=>{calls.band=band;socket.emit=emit;delete globalThis.__e2eSendsUndo;};return true;})()`);
  live.undo(`the send log's calls.band and socket.emit on ${W}`,()=>live.clients[W]!.run('globalThis.__e2eSendsUndo?.()'));
  try{
    // CB23: a fresh figure of 190 holds the warrior's travel moves to the goo field, and the walk
    // still arrives with no stall and no stuck record.
    const farm=await location(live,'goo');
    const walkFrom=await clock();
    await live.post('/navigate-to-monster',{monsterId:'goo',location:farm});
    await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{},monsterSearchRadius:400});
    await expect.poll(()=>live.clients[W]!.run('!!(__partyMovement.live()?.journey&&character.moving)'),{timeout:60_000,message:'The warrior walks to the goo field'}).toBe(true);
    // A figure of 190 in every packet, and a stop from the page's own client (a move to where the
    // warrior stands, as a click sends): the walk's step stops, its reissue asks the job band, and
    // the planted figure holds it. Packets come only when something changes, so each poll sends one.
    await live.plantCallCost(W,190);
    await packet();
    await expect.poll(()=>live.clients[W]!.run('(__partyCalls.view().cc??0)>=190'),{timeout:10_000,intervals:[50],message:'CB23: the planted figure arrives'}).toBe(true);
    await live.clients[W]!.run('(parent.move(character.real_x,character.real_y),true)');
    // The walk's first send can be its Town or a door as well as a move.
    const travel=['move','town','transport','leave'];
    let held23:any=null;
    await expect.poll(async()=>{await packet();const read=await bandsRead(live,W);
      held23={answers:read.view?.answers,used:read.view?.used,cc:read.view?.cc,ccAge:read.view?.ccAge,held:read.view?.held,limits:read.view?.limits,
        live:await live.clients[W]!.run('({live:__partyMovement.live(),moving:character.moving,map:character.map,x:character.real_x,y:character.real_y})')};
      return travel.reduce((sum,method)=>sum+answered(start,read,'job',method).notNow,0);},
      {timeout:15_000,intervals:[250],message:'CB23: a fresh figure of 190 holds a travel send'}).toBeGreaterThan(0).catch(async error=>{await attach(info,'cb23-held',held23);throw error;});
    result.held23=held23;
    await live.plantCallCost(W,0);
    await packet();
    unplanted=await clock();
    await expect.poll(async()=>{const c=(await live.state()).characters[W];return c?.map===farm.map&&Math.hypot(c.x-farm.x,c.y-farm.y)<400;},
      {timeout:120_000,message:'The warrior reaches the goo field'}).toBe(true);
    // The movement owner writes a stall as a 'stuck' incident (runtime/movement/character/owner.ts
    // incident), never as a ring record decision.
    const walk=((await live.clients[W]!.run('__partyMovement.records()')) as any[]).filter(r=>r.at>=walkFrom&&r.decision==='ended');
    const stuck=((await live.clients[W]!.run('__partyMovement.incidents()')) as any[]).filter(i=>i.at>=walkFrom&&i.kind==='stuck');
    result.walk=walk;result.stuck=stuck;
    expect(walk.filter(r=>String(r.code).startsWith('failed:')),'CB23: the held walk ends with no failed journey').toEqual([]);
    expect(stuck,'CB23: the held walk records no stuck incident').toEqual([]);
    // CB6: the test client asks job `players` reads while the warrior fights; survival never waits.
    const before6=await bandsRead(live,W),from6=await clock();
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
    result.asked=asked;
    result.survivalNotNow=await live.clients[W]!.run(`(()=>{const calls=globalThis.__partyHooks.calls;if(calls.__e2eBand){calls.band=calls.__e2eBand;delete calls.__e2eBand;}return globalThis.__e2eSurvival;})()`);
    result.ring6=after6.ring.filter((r:any)=>r.at>=from6);
    await attach(info,'call-budget-row-b-cb6',{asked,survivalNotNow:result.survivalNotNow,ring:result.ring6,before:before6.view,after:after6.view});
    expect(asked.none,'CB6: calls.band answers the job questions').toBe(0);
    expect(asked.send,'CB6: job reads go while the warrior fights').toBeGreaterThan(0);
    expect(answered(before6,after6,'survival','move').send,'CB6: combat steps go while jobs fill the window').toBeGreaterThan(0);
    // The console's own tracker request and player list ask the background band (3.7), so no held
    // read holds a survival question: every survival wait is CB6's failure.
    const waits6=result.survivalNotNow as any[];
    console.log('CALL-BUDGET-CB6 '+JSON.stringify({asked,survivalNotNow:waits6.length,heldHeads:waits6.map(w=>w.heldHead)}));
    expect(waits6,'CB6: survival questions answered not-now').toEqual([]);
    // CB5: a figure of 199 in one player packet holds survival questions until a newer packet
    // arrives or 4000 ms pass, and job questions while it is fresh.
    await live.plantCallCost(W,199);
    await packet();
    await expect.poll(()=>live.clients[W]!.run('(__partyCalls.view().cc??0)>=199'),{timeout:10_000,message:'CB5: the planted figure arrives'}).toBe(true);
    await live.plantCallCost(W,0);
    const cb5=await live.clients[W]!.run(`(async()=>{const first=__partyCalls.view(),arrived=Date.now()-first.ccAge,out={margin:first.margin,job:[],survival:null};
      const ask=band=>{const a=__partyCalls.band({band,method:'players',data:{}});if(a==='send')parent.socket.emit('players',{});return a;};
      while(Date.now()-arrived<8000){const v=__partyCalls.view(),planted=v.cc>=199&&v.ccAge<4000;
        out.job.push({ms:Date.now()-arrived,planted,answer:ask('job')});
        const s=ask('survival');if(s==='send'){const after=__partyCalls.view();out.survival={ms:Date.now()-arrived,planted,cc:after.cc};break;}
        await new Promise(r=>setTimeout(r,50));}return out;})()`);
    result.cb5=cb5;
    expect(cb5.survival,'CB5: a survival question goes once the figure is newer or old').toBeTruthy();
    expect(cb5.survival.planted,'CB5: no survival question goes while the planted figure is the fresh one').toBe(false);
    expect(cb5.survival.ms,'CB5: the longest survival wait').toBeLessThanOrEqual(WINDOW_MS+cb5.margin);
    expect(cb5.job.filter((j:any)=>j.planted&&j.answer!=='not-now'),'CB5: job questions while the planted figure is fresh').toEqual([]);
    // TC14: a figure of 199 on the priest holds its attacks and heals, which
    // ask the survival band: none reaches the server while the figure is fresh, each family's wait
    // closes with its send in the turns ring, and the priest attacks again within one window.
    try{
      await live.clients[P]!.run(spendLog);
      // Every question the priest asks the call budget, with its answer and the figure it read,
      // for the reading of a send inside the hold.
      await live.clients[P]!.run(`(()=>{const calls=globalThis.__partyHooks.calls,budget=globalThis.__partyCalls;if(calls.__e2eBand14)return true;const band=calls.band,log=globalThis.__e2eBands14=[];
        calls.__e2eBand14=true;calls.band=q=>{const v=budget.view(),a=band(q);log.push({at:Date.now(),band:q.band,method:q.method,answer:a,cc:v.cc,ccAge:v.ccAge,used:v.used});if(log.length>400)log.shift();return a;};
        globalThis.__e2eBand14Undo=()=>{calls.band=band;delete calls.__e2eBand14;delete globalThis.__e2eBand14Undo;};return true;})()`);
      live.undo(`CB14's calls.band log on ${P}`,()=>live.clients[P]!.run('globalThis.__e2eBand14Undo?.()'));
      const before14=await live.clients[P]!.run('(globalThis.__partyTurns?.records?.()??[]).at(-1)?.seq??0') as number;
      // The figure holds every survival question, the priest's moves included, so a priest
      // whose goo died with no other goo in range asks no attack until the hold ends (13.4b's run
      // G: its own hit killed its goo 750 ms after the plant, and it stood 470 units from the next
      // one for 12 s). The priest at 60% HP asks a heal on itself, which needs no move, so the
      // hold always holds a spend. The red plant is that run's case: the priest in town, out of
      // every goo's range, at full HP.
      if(red('tc14'))await live.admin(`output=(()=>{transport_player_to(get_player('${P}'),'main',[0,0]);return true;})()`);
      else await plantVitals(live,P,{hp:0.6});
      await live.plantCallCost(P,199);
      await live.admin(`output=(()=>{resend(get_player('${P}'),'u');return true;})()`);
      await expect.poll(()=>live.clients[P]!.run('(__partyCalls.view().cc??0)>=199'),{timeout:10_000,intervals:[50],message:'TC14: the planted figure arrives'}).toBe(true);
      // The figure stays in every packet until the priest's budget has answered one attack or
      // heal question `not-now`, so the hold holds a real spend; the page reads when it ends.
      const from14=await live.clients[P]!.run('Date.now()-__partyCalls.view().ccAge') as number;
      const asked=(v:any)=>['attack','heal'].reduce((n,m)=>n+(v?.answers?.survival?.[m]?.notNow??0),0);
      const base14=asked(await live.clients[P]!.run('__partyCalls.view()'));
      await expect.poll(async()=>asked(await live.clients[P]!.run('__partyCalls.view()')),{timeout:WINDOW_MS*3,intervals:[50],message:'TC14: an attack or heal waits on the figure'}).toBeGreaterThan(base14);
      await live.plantCallCost(P,0);
      const hold=await live.clients[P]!.run(`(async()=>{while(__partyCalls.view().cc>=199&&__partyCalls.view().ccAge<4000)await new Promise(r=>setTimeout(r,20));return {from:${from14},to:Date.now()};})()`) as {from:number;to:number};
      await waitForGameplay(WINDOW_MS*2);
      const log=await spendsSince(live,P,hold.from);
      const ring=(await live.clients[P]!.run('globalThis.__partyTurns?.records?.()??[]') as any[]).filter(r=>r.seq>before14);
      // The hold ends at the budget's first survival send after a wait (its `waited` record); the
      // page's poll reads the end up to one poll later, when the waited send has already gone.
      const released=(await live.clients[P]!.run('__partyCalls.records()') as any[]).find(r=>r.decision==='waited'&&r.band==='survival'&&r.at>=hold.from)?.at??hold.to;
      // A held send is an attack or heal the budget let go while the planted figure was the fresh
      // one, read from the band log's own view at each question. The budget's records keep the game
      // window's clock, which after a CODE reload runs a gameplay clock step from the page's (TC14
      // in step 3's gate: its waited record at 1500 ms for the send the page logged at 1250 ms).
      const bandLog=await live.clients[P]!.run('globalThis.__e2eBands14??[]') as any[];
      const heldSends=bandLog.filter(q=>q.at>=hold.from&&q.answer==='send'&&['attack','heal'].includes(q.method)&&q.cc>=199&&q.ccAge<4000);
      const held=heldSends.map(q=>({at:q.at,method:q.method,id:undefined}));
      const next=log.spends.find(s=>s.at>=hold.to&&s.method==='attack');
      // The budget's own records around the hold and each held send's time, for a failure's reading.
      const budgetRing=(await live.clients[P]!.run('__partyCalls.records()') as any[]).filter(r=>r.at>=hold.from-500&&r.at<=hold.to+500);
      const bands14=(await live.clients[P]!.run('globalThis.__e2eBands14??[]') as any[]).filter(q=>q.at>=hold.from-500&&q.at<=released+500).map(q=>[q.at-hold.from,q.band,q.method,q.answer,q.cc,q.ccAge,q.used]);
      result.tc14={hold,released,held:held.map(s=>[s.at-hold.from,s.method,s.id]),ring,budgetRing,bands:bands14,nextAfterMs:next?next.at-hold.to:null};
      if(held.length)console.log('TURNS-TC14-BANDS '+JSON.stringify(bands14).slice(0,3000));
      console.log('TURNS-TC14 '+JSON.stringify({holdMs:hold.to-hold.from,releasedMs:released-hold.from,held:result.tc14.held,waits:ring.filter(r=>r.kind==='wait'),budgetRing:budgetRing.map((r:any)=>[r.at-hold.from,r.decision,r.method,r.band,r.used,r.limit,r.waitedMs]),nextAfterMs:result.tc14.nextAfterMs}));
      expect.soft(hold.to-hold.from,'TC14: the planted figure holds survival before a newer packet').toBeGreaterThan(0);
      expect.soft(held.map(s=>s.method),"TC14: the priest's attacks and heals sent while the figure holds survival").toEqual([]);
      // A wait ends with its send, or with no record when its family asks nothing more (its target
      // died or its member healed), so the ring's waits are each closed within one window.
      expect.soft(ring.filter(r=>r.kind==='wait'&&!(r.waitedMs<=WINDOW_MS)).map(r=>r.waitedMs),'TC14: a turns wait left open past one window').toEqual([]);
      expect.soft(result.tc14.nextAfterMs,'TC14: the next attack within one window after the hold').not.toBeNull();
      if(result.tc14.nextAfterMs!==null)expect.soft(result.tc14.nextAfterMs,'TC14: the next attack within one window after the hold').toBeLessThanOrEqual(WINDOW_MS);
    }finally{
      // A plant left on a throw holds the priest's moves, and the next row's reset convoy then
      // never ends (13.4b's run G).
      await live.plantCallCost(P,0).catch(()=>{});
      await plantVitals(live,P,{hp:1}).catch(()=>{});
    }
    // CB9: with the figure at 199, two untagged potion uses wait in the hold queue, and movement's
    // survival stop asked after them waits too; each goes in the order it was made, so each use's
    // promise takes its own reply and the server walks no point the client left.
    await live.plantCallCost(W,199);
    await packet();
    await expect.poll(()=>live.clients[W]!.run('(__partyCalls.view().cc??0)>=199&&__partyCalls.view().ccAge<1000'),{timeout:10_000,message:'CB9: the planted figure arrives'}).toBe(true);
    const plantedAt=await clock();
    const queued=await live.clients[W]!.run(`(()=>{const s=globalThis.__e2eCb9={};const settle=p=>Promise.resolve(p).then(v=>({ok:v}),e=>({failed:e&&(e.reason||e.message)||String(e)}));
      const madeAt=Date.now(),margin=__partyCalls.view().margin,before=__partyCalls.view().held;s.uses=Promise.all([settle(use('hp')),settle(use('mp'))]).then(v=>s.usesDone=v);const held=__partyCalls.view().held-before;
      s.stop=settle(stop()).then(v=>{s.stopDone={at:Date.now(),v};});return {held,before,heldHead:__partyCalls.view().heldHead,after:__partyCalls.view().held,madeAt,margin};})()`);
    await live.plantCallCost(W,0);
    await packet();
    await expect.poll(()=>live.clients[W]!.run('!!(globalThis.__e2eCb9?.usesDone&&globalThis.__e2eCb9?.stopDone)'),{timeout:15_000,message:'CB9: the held uses and the owed stop go'}).toBe(true);
    const cb9=await live.clients[W]!.run('({uses:globalThis.__e2eCb9.usesDone,stop:globalThis.__e2eCb9.stopDone})');
    const server=await live.admin(`output=get_player('${W}').socket.calls.filter(c=>+c[0]>=${plantedAt}).map(c=>[+c[0],c[1],c[2]])`) as [number,string,number][];
    let going:any=null;
    await expect.poll(async()=>{
      const [client,serverGoing]=await Promise.all([live.clients[W]!.run('({x:character.going_x,y:character.going_y})'),live.admin(`output=(()=>{const p=get_player('${W}');return {x:p.going_x,y:p.going_y};})()`)]);
      going={client,server:serverGoing};return Math.hypot(client.x-serverGoing.x,client.y-serverGoing.y)<1;
    },{timeout:5_000,intervals:[100],message:'CB9: the server walks to the point the client holds'}).toBe(true).catch(()=>{});
    result.cb9={queued,...cb9,server,going};
    // The game client's own ping (`ping_trig`, untagged) can wait in the queue ahead of the uses
    // while the figure is fresh (the budget's ring records it `held`), so the check counts what
    // the two uses add, read in their own synchronous turn.
    expect(queued.held,'CB9: the two uses wait in the hold queue').toBe(2);
    expect(cb9.uses.length,'CB9: each use settles with its reply').toBe(2);
    const firstEquip=server.findIndex(([,method])=>method==='equip');
    expect(firstEquip,'CB9: the held uses reach the server').toBeGreaterThanOrEqual(0);
    // A move the server dates more than one round trip after the uses were made was made after
    // them, so it must reach the server after them.
    expect(server.slice(0,firstEquip).filter(([at,method])=>method==='move'&&at>queued.madeAt+queued.margin),'CB9: no move reaches the server ahead of the uses made before it').toEqual([]);
    expect(Math.hypot(going.client.x-going.server.x,going.client.y-going.server.y),'CB9: the server\'s going point is the client\'s').toBeLessThan(1);
    // CB24's band half: a figure of 199 in every packet holds every band, so a background
    // question waits from its first ask. It asks for a Ponty read (`secondhands`, 16), a method
    // the budget's own reads never ask, since a wait is kept per band and method and the player
    // list's own read would share and end it. Once it has waited one window and the margin it is judged
    // in the job band; the plant goes, and the question goes with a `read-job` ring entry. The
    // figure stays fresh while the server sends packets, so each poll sends one. The plant goes
    // half a second past the margin the budget holds then, since a later ping can raise it.
    await live.plantCallCost(W,199);
    await packet();
    await expect.poll(()=>live.clients[W]!.run('(__partyCalls.view().cc??0)>=199'),{timeout:10_000,message:'CB24: the planted figure arrives'}).toBe(true);
    await live.clients[W]!.run(`(()=>{const out=globalThis.__e2eRise={first:null,sent:null,margin:__partyCalls.view().margin};const end=Date.now()+30000;
      (async()=>{while(Date.now()<end){const a=__partyCalls.band({band:'background',method:'secondhands'});if(a==='send'){parent.socket.emit('secondhands');out.sent=Date.now();break;}
        out.first??=Date.now();await new Promise(r=>setTimeout(r,100));}out.ring=__partyCalls.records().filter(r=>r.decision==='read-job'&&r.method==='secondhands'&&r.at>=(out.first??0));out.done=true;})();return true;})()`);
    await expect.poll(async()=>{await packet();return live.clients[W]!.run(`(()=>{const r=globalThis.__e2eRise;return !!r.first&&Date.now()-r.first>=${WINDOW_MS}+__partyCalls.view().margin+500;})()`);},
      {timeout:30_000,intervals:[250],message:'CB24: the background question waits one window under the figure'}).toBe(true);
    // The figure drops to 45 under the job limit: room for the Ponty read, the player list's own
    // read that rose to the job band under the same figure (12), and the fight's own calls in
    // flight, while the background limit sits the largest job call (40) below the job limit, so
    // only the job band can take the question, whichever margin the budget holds when it asks; each
    // poll keeps the figure fresh. At 30 under, the list's read took the room in the gate run.
    const held=await budgetView(live,W),lower=Math.max(0,Math.round(held.limits.job-45-(held.used-199)));
    await live.plantCallCost(W,lower);
    await expect.poll(async()=>{await packet();return live.clients[W]!.run('!!globalThis.__e2eRise.done');},{timeout:30_000,intervals:[250],message:'CB24: the risen question ends'}).toBe(true);
    await live.plantCallCost(W,0);
    await packet();
    const rise=await live.clients[W]!.run('globalThis.__e2eRise');
    unplanted=await clock();
    result.rise=rise;
    await attach(info,'call-budget-row-b-cb24',{rise,held,lower,view:await budgetView(live,W)});
    expect(rise.first,'CB24: a background question waits under the planted figure').toEqual(expect.any(Number));
    expect(rise.sent,'CB24: the waiting background question goes in the job band').toEqual(expect.any(Number));
    expect(rise.sent-rise.first,'CB24: it rises after one window').toBeGreaterThanOrEqual(WINDOW_MS);
    expect(rise.ring.length,`CB24: the rise writes a read-job entry: ${JSON.stringify(rise)}`).toBe(1);
    // CB24: the Tracktrix holder's reply age in the fight. A planted figure shuts every band by
    // construction, so the age is read after the last plant: from the first reply a window after
    // it to the next one, while the warrior keeps farming goo.
    const margin=(await budgetView(live,W))?.margin??WINDOW_MS,bound=TRACKER_REFRESH_MS+2*(WINDOW_MS+margin);
    const arrivals=async()=>(await live.clients[W]!.events()).filter((e:any)=>e.event==='tracker-arrived').map((e:any)=>Number(e.at));
    const after=unplanted+WINDOW_MS+margin;
    let first=0,next=0;
    await expect.poll(async()=>(first=(await arrivals()).find(at=>at>=after)??0),{timeout:TRACKER_REFRESH_MS+30_000,intervals:[500],message:'CB24: a reply after the last plant'}).toBeGreaterThan(0).catch(()=>{});
    if(first)await expect.poll(async()=>(next=(await arrivals()).find(at=>at>first)??0),{timeout:bound+10_000,intervals:[500],message:'CB24: the next reply in the fight'}).toBeGreaterThan(0).catch(()=>{});
    const to=await clock();
    result.trackerAge={...await trackerReplyAge(live,W,from,to),first,next,age:next&&first?next-first:null,bound,
      kills:(await live.clients[W]!.events()).filter((e:any)=>e.event==='hit'&&e.data?.hid===W&&(e.data.kill||e.data.dead)&&e.at>=first).length};
    expect(result.trackerAge.age,`CB24: the reply age in the fight: ${JSON.stringify(result.trackerAge)}`).not.toBeNull();
    expect(result.trackerAge.age,'CB24: the reply age in the fight').toBeLessThanOrEqual(bound);
    expect(result.trackerAge.kills,'CB24: the warrior fights while the age is read').toBeGreaterThan(0);
    // A planted death and one respawn through survival's
    // hook; the budget books the respawn at its price (call-budget.ts, `CROSSING + 2`) and the
    // server's entries charge the same. The death recovery's own ask goes through the same hook, so
    // every respawn entry is survival's. Last in the row: the warrior respawns in Main. The death
    // comes before CB4's quiet window: the fighting warrior sends a call in every 4 s window, and a
    // dead one sends none until its respawn, `rip_time` later.
    await killNativeCharacter(live,W);
    result.sv46=await oneCall(live,W,'respawn (survival)','respawn',`globalThis.__partySurvival.death.respawnWhenAllowed('sv46').then(()=>true,()=>false)`,'!character.rip');
    console.log('SURVIVAL-SV46 '+JSON.stringify(result.sv46));
    chargesHold([result.sv46]);
  }finally{
    await live.plantCallCost(W,0).catch(()=>{});
    await live.plantCallCost(P,0).catch(()=>{});
    samples=await sampler.stop();
  }
  const measures=await sampled(info,'row-b',samples,names),end=await bandsRead(live,W);
  const sends=await live.clients[W]!.run('globalThis.__e2eSends') as any[],unmatched=end.ring.filter((r:any)=>r.at>=from&&r.decision==='unmatched');
  // A send whose turn ended with no emit of its method after it.
  const lone=sends.filter(x=>x.kind==='send'&&!sends.some(e=>e.kind==='emit'&&e.method===x.method&&e.seq>x.seq&&e.seq<(sends.find(t=>t.kind==='turn'&&t.of===x.seq)?.seq??Infinity)));
  await attach(info,'call-budget-row-b-unmatched',{unmatched,lone,around:lone.map(x=>sends.filter(e=>e.seq>=x.seq-3&&e.seq<=x.seq+6))});
  result.measures=measures;result.bands={view:end.view,ring:end.ring,meter:meterOf(end)};
  await attach(info,'call-budget-row-b',result);
  console.log('CALL-BUDGET-ROW-B '+JSON.stringify({asked:result.asked,cb5:{survival:result.cb5?.survival},cb9:{queued:result.cb9?.queued},room:end.view?.room,peak:end.view?.peak,meter:meterOf(end)}));
  boundHolds(measures,names);
  bandsHold(W,end,from,unplanted);
}

// Row C, "call budget: a forced limitdc saves one snapshot": five `tracker` emits through the
// record's stored game emit, past the layer, as a fault. It declares its one limitdc and ends
// when the merchant reports again. CB18: one snapshot with the trigger `limitdc` at the coordinator,
// holding the server's report, the ledger and the ring, and no local copy left; a copy planted in
// the merchant's local storage before the console's own relog is posted by the next install (3.8).
export async function forcedLimitdcRow(live:LiveGame,info:TestInfo){
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
  expect(real.length,'CB18: one limitdc snapshot at the coordinator').toBe(1);
  const saved=entry(real[0]);
  expect(saved.report,'CB18: the snapshot holds the server\'s report').toEqual(report);
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

import {expect,plantVitals,waitForGameplay,writeDelivered,type LiveGame} from './live-fixtures';
import type {TestInfo} from '@playwright/test';
import {fighters} from './game/hunt-lifecycle';
import {clock,fightingAtGoo,needsSince,plantView,red,spendLog,spendsSince,timing} from './turns-rows';
import {replyStep} from './turns-tc11';
import {W,P} from './hunt-interruption-helpers';
import {A9_LINE,POTION_DEFAULTS} from '../runtime/characters/survival/lines';
import {switches as addonSwitches} from './fixtures/hooks-fixture-kit';

// The survival owner's potions row of the default table: potions and regeneration per class, planted with
// `live.admin` writes of `hp` and `mp` as the turns rows plant them. Each failure mode is read
// from the spend log after the row's plants, so a row on a tree without the survival owner still
// measures, and each check is soft so the row runs to its end.
// The defaults of "HP potion below" and "MP potion below" (decided 2026-11-05), as
// shares of the maximum.
export const HP_LINE=POTION_DEFAULTS.hp/100;
const MP_LINE=POTION_DEFAULTS.mp/100;

type Spend={at:number;method:string;item?:string;mp:number;maxMp:number;party:Record<string,{hp:number;max:number}>;fight?:unknown};
// A potion is an `equip` of an HP or MP potion; regeneration is the `use` emit whose item is "hp"
// or "mp" (server.js:12041, the potion group, 7807-7811).
const potion=(s:Spend)=>s.method==='equip'&&/^hpot/.test(String(s.item))?'use_hp':s.method==='equip'&&/^mpot/.test(String(s.item))?'use_mp':null;
const regen=(s:Spend)=>s.method==='use'&&/^(hp|mp)$/.test(String(s.item))?'regen_'+s.item:null;
// Regeneration holds the potion group for 4000 ms (server.js:12047, `future_ms(4000)`); game data
// gives regen_hp no cooldown of its own.
const REGEN_COOLDOWN_MS=4000;
const family=(s:Spend)=>potion(s)??regen(s);

// Every fighter carries HP and MP potions, so a missing potion is never the reason none goes.
export async function stockPotions(live:LiveGame,name:string){
  return live.admin(`output=(()=>{const p=get_player(${JSON.stringify(name)}),added=[];
    for(const item of ['hpot1','mpot1']){if(p.items.some(x=>x&&x.name===item))continue;const i=p.items.findIndex(x=>!x);if(i<0)continue;
      p.items[i]={name:item,q:200};p.citems[i]=cache_item(p.items[i]);p.esize--;added.push(item);}
    resend(p,'u+cid+reopen');return added;})()`) as Promise<string[]>;
}
// One potion cooldown on the gameplay clock: the potion group's cooldown from game data, one round
// trip (the character's median ping) and the clock's reply step.
async function potionWindow(live:LiveGame,name:string,skill='use_hp'){
  const t=await timing(live,name);
  const cooldown=await live.clients[name]!.run(`Number(G.skills[${JSON.stringify(skill)}].cooldown)||0`) as number;
  return {cooldown,rtt:t.rtt};
}
// A plant on one fighter, held until its own client shows it: its HP and MP at or below the plant.
// The client keeps each change of its own HP and MP with its time, from each `player` packet and a
// 25 ms watcher, since a heal can lift the HP again before the poll reads it: the priest's own, or
// the priest's heal on the warrior, which only the warrior's HP shows (the turns row's `plantSeen` reads
// the priest's side). `seenAt` is the client's first read of the plant. The poll runs on the
// gameplay clock between test-side reads, so it returns later than that read, and later still on
// a loaded machine (once the warrior's `use_mp` went 249 ms before the poll returned, and the MP row read
// none); `polledAt` keeps the poll's own time for the reading.
async function plantOwn(live:LiveGame,name:string,vitals:{hp?:number;mp?:number;transport?:[string,number,number]}){
  await live.clients[name]!.run(`(()=>{clearInterval(globalThis.__e2eLowTimer);const w=globalThis.__e2eLow={hist:[[Date.now(),character.hp,character.mp]]};
    w.read=(hp,mp)=>{const last=w.hist[w.hist.length-1];if(last[1]!==hp||last[2]!==mp)w.hist.push([Date.now(),hp,mp]);if(w.hist.length>4000)w.hist.splice(1,1000);};
    if(!globalThis.__e2eLowListen){globalThis.__e2eLowListen=true;
      parent.socket.on('player',d=>{const w=globalThis.__e2eLow;if(w&&d)w.read(typeof d.hp==='number'?d.hp:character.hp,typeof d.mp==='number'?d.mp:character.mp);});}
    globalThis.__e2eLowTimer=setInterval(()=>w.read(character.hp,character.mp),25);return true;})()`);
  const planted=await plantVitals(live,name,vitals);
  const first=`(()=>{const h=globalThis.__e2eLow.hist.find(([,hp,mp])=>(${vitals.hp===undefined}||hp<=${planted.hp}+1)&&(${vitals.mp===undefined}||mp<=${planted.mp}+1));return h?h[0]:null;})()`;
  await expect.poll(()=>live.clients[name]!.run(`${first}!==null`),
    {timeout:10_000,intervals:[50],message:`${name} sees its own plant`}).toBe(true).catch(async error=>{
      // A miss's reading: the HP and MP changes the client kept, the member's own packets, HP
      // samples, sends and replies from the plant on, and the server's side of its own view.
      const l=await spendsSince(live,name,planted.at-1000);
      console.log('SURVIVAL-PLANT-VIEW '+JSON.stringify({name,planted,hist:await live.clients[name]!.run(`globalThis.__e2eLow.hist.filter(h=>h[0]>=${planted.at}-1000).map(h=>[h[0]-${planted.at},h[1],h[2]])`),now:await clock(live,name),
        view:await plantView(live,name,name,planted.at-1000),samples:(l.samples as any[]).map(x=>[x.at-planted.at,x.party[name]?.hp??null]),
        spends:(l.spends as Spend[]).map(s=>[s.at-planted.at,s.method,(s as any).name??s.item??(s as any).id]),replies:(l.replies as any[]).map(r=>[r.at-planted.at,r.place,r.response])}).slice(0,12000));
      throw error;});
  const polledAt=await clock(live,name);
  return {...planted,seenAt:await live.clients[name]!.run(first) as number,polledAt};
}
// When the potion family is free after a plant: the plant itself, or the end of the potion group's
// lock from the family's last send before it, 2000 ms for a potion and 4000 ms for regeneration
// (server.js:12042-12048). In a fight regeneration may run until a fighter reads below 80%
//, so a plant that lands inside its lock waits for it; the potion's window starts
// when the family frees.
async function familyFree(live:LiveGame,name:string,seenAt:number,potionCooldown:number){
  const before=((await spendsSince(live,name,seenAt-REGEN_COOLDOWN_MS)).spends as Spend[]).filter(s=>s.at<seenAt&&family(s)).at(-1);
  if(!before)return seenAt;
  return Math.max(seenAt,before.at+(regen(before)?REGEN_COOLDOWN_MS:potionCooldown));
}
// The member's own HP share as its client read it at `at`, from the spend log's 100 ms samples. A
// heal can lift a planted fighter above its line before the potion family frees, and then no HP
// potion is due.
async function shareAt(live:LiveGame,name:string,at:number){
  const l=await spendsSince(live,name,at-500),s=l.samples.filter(x=>x.at<=at).at(-1)??l.samples[0],m=s?.party?.[name];
  return m?m.hp/m.max:null;
}
// The potion family's sends while the member's own HP reads below the HP line, other than `use_hp`:
// the failure itself, at any HP pool and heal size (the reading of the Taunt-reserve row).
export const wrongWhileLow=(list:Spend[],name:string)=>list.filter(s=>family(s)&&potion(s)!=='use_hp'&&s.party?.[name]&&s.party[name]!.hp/s.party[name]!.max<HP_LINE)
  .map(s=>[s.at,family(s),Math.round(s.party[name]!.hp/s.party[name]!.max*100)]);
const restore=async(live:LiveGame)=>{for(const n of fighters)await plantVitals(live,n,{hp:1,mp:1});};

// Row V1: SV1, SV2, SV3, SV5, SV6, SV11 and SV13.
export async function survivalNeedsRow(live:LiveGame,info:TestInfo){
  const result:any={stocked:{}};
  for(const n of fighters)result.stocked[n]=await stockPotions(live,n);
  await fightingAtGoo(live);
  const step=async(name:string,from:number)=>{const r=replyStep((await spendsSince(live,name,from)).replies);return Number.isFinite(r)?r:0;};
  const windows:Record<string,{cooldown:number;rtt:number}>={};
  for(const n of fighters)windows[n]=await potionWindow(live,n);
  const rowFrom=Math.min(...await Promise.all(fighters.map(n=>clock(live,n))));
  const bound=async(name:string)=>windows[name]!.cooldown+windows[name]!.rtt+await step(name,rowFrom);
  const sends=async(name:string,from:number,to=Infinity)=>((await spendsSince(live,name,from)).spends as Spend[]).filter(s=>s.at<to);

  // SV1: each fighter planted to 40% HP in the fight drinks `use_hp` within one potion cooldown.
  result.sv1={};
  for(const n of fighters){
    const planted=await plantOwn(live,n,{hp:0.4}),limit=await bound(n);
    await waitForGameplay(REGEN_COOLDOWN_MS+limit+500);
    const first=(await sends(n,planted.seenAt)).find(s=>potion(s)==='use_hp'),free=await familyFree(live,n,planted.seenAt,windows[n]!.cooldown);
    const list=await sends(n,planted.seenAt),share=await shareAt(live,n,free);
    result.sv1[n]={planted:planted.hp,max:planted.max_hp,limit,pollLagMs:planted.polledAt-planted.seenAt,freeAfterMs:free-planted.seenAt,afterMs:first?first.at-free:null,
      shareAtFree:share,due:share===null||share<HP_LINE,wrong:wrongWhileLow(list,n).map(([at,...r])=>[Number(at)-planted.seenAt,...r])};
    await restore(live);await waitForGameplay(2_500);
  }
  // SV3: MP planted to 15% drinks `use_mp` within one potion cooldown.
  result.sv3={};
  for(const n of fighters){
    const planted=await plantOwn(live,n,{mp:0.15}),limit=await bound(n);
    await waitForGameplay(REGEN_COOLDOWN_MS+limit+500);
    const first=(await sends(n,planted.seenAt)).find(s=>potion(s)==='use_mp'),free=await familyFree(live,n,planted.seenAt,windows[n]!.cooldown);
    result.sv3[n]={planted:planted.mp,max:planted.max_mp,limit,pollLagMs:planted.polledAt-planted.seenAt,freeAfterMs:free-planted.seenAt,afterMs:first?first.at-free:null};
    await restore(live);await waitForGameplay(2_500);
  }
  // SV6: both needs open on the priest, the first potion family entry is `use_hp`.
  {const planted=await plantOwn(live,P,{hp:0.4,mp:0.15}),limit=await bound(P);
    await waitForGameplay(REGEN_COOLDOWN_MS+limit+500);
    const list=await sends(P,planted.seenAt),first=list.find(s=>family(s));
    // SV6's failure: a regeneration goes before a due HP potion, so no potion family send but
    // `use_hp` while the priest's HP reads below its line.
    result.sv6={first:first?family(first):null,afterMs:first?first.at-planted.seenAt:null,limit,wrong:wrongWhileLow(list,P).map(([at,...r])=>[Number(at)-planted.seenAt,...r])};
    await restore(live);await waitForGameplay(2_500);}
  // The warrior planted to 20% HP with its MP under its Taunt reserve: no `use_mp` while its own
  // HP at the send reads below the HP line, and its first potion is `use_hp` (2026-11-02).
  {const planted=await plantOwn(live,W,{hp:0.2,mp:0.05}),limit=await bound(W);
    await waitForGameplay(2*limit+500);
    const list=(await sends(W,planted.seenAt)).filter(s=>family(s));
    const hp=(s:Spend)=>s.party[W]?s.party[W]!.hp/s.party[W]!.max:1;
    result.sv2={first:list[0]?family(list[0]):null,potions:list.map(s=>[s.at-planted.seenAt,family(s),Math.round(hp(s)*100)]),
      mpBelowLine:list.filter(s=>potion(s)==='use_mp'&&hp(s)<HP_LINE).length,limit};
    await restore(live);await waitForGameplay(2_500);}
  // SV5, in the fight: the priest planted to 60% MP and the warrior to 75% HP, both above their potion
  // lines and the warrior below A9's 80%: no regeneration while the fight goes on.
  {const from=Math.min(await clock(live,W),await clock(live,P));
    // The priest reads the warrior's drop only with the warrior in its view, which the independent
    // approach does not keep (the turns row's `plantSeen`), so the plant waits for it.
    await expect.poll(()=>live.clients[P]!.run(`!!parent.entities[${JSON.stringify(W)}]`),{timeout:60_000,intervals:[50],message:"SV5: the warrior in the priest's view before the plant"}).toBe(true);
    await plantOwn(live,P,{mp:0.6});await plantOwn(live,W,{hp:0.75});
    // The gap between two kills: once each fighter's client reads
    // the warrior below the line, every monster on a fighter and each fighter's own target leave at
    // once, as at a kill, so for a moment no monster targets the party and no fighter holds a
    // target, while the farm's other monsters stay.
    await expect.poll(async()=>(await Promise.all(fighters.map(async n=>(await spendsSince(live,n,from)).samples
      .some((x:any)=>x.party[W]&&x.party[W].hp/x.party[W].max<A9_LINE)))).every(Boolean),{timeout:10_000,intervals:[50],message:'SV5: each fighter reads the warrior below 80%'}).toBe(true)
      .catch(async error=>{
        // What each fighter's client read of the warrior from the plants on, with its heals.
        for(const n of fighters){const l=await spendsSince(live,n,from);
          console.log('SURVIVAL-SV5-DROP '+JSON.stringify({name:n,samples:(l.samples as any[]).map(x=>[x.at-from,x.party[W]?Math.round(x.party[W].hp/x.party[W].max*1000)/10:null,x.party[W]?Math.round(x.party[W].dist):null]),
            replies:(l.replies as any[]).filter(r=>r.place==='heal'||r.place==='partyheal').map(r=>[r.at-from,r.place,r.response]),
            view:await plantView(live,n,W,from)}).slice(0,9000));}
        throw error;});
    // A fighter between two targets holds nothing to remove, so the plant waits for one.
    let removed:string[]=[],gapAt=0;
    await expect.poll(async()=>{const held=await Promise.all(fighters.map(n=>live.clients[n]!.run('parent.ctarget&&!parent.ctarget.dead?String(parent.ctarget.id):null') as Promise<string|null>));
      gapAt=Math.min(await clock(live,W),await clock(live,P));
      removed=await live.admin(`output=(()=>{const names=${JSON.stringify(fighters)},held=${JSON.stringify(held)},out=[];
        for(const m of Object.values(instances.main.monsters))if(names.includes(m.target)||held.includes(String(m.id))){out.push(String(m.id));remove_monster(m,{method:'disappear'});}return out;})()`) as string[];
      return removed.length;},{timeout:10_000,intervals:[100],message:'SV5: a monster on a fighter, or a target a fighter holds, to remove'}).toBeGreaterThan(0);
    await waitForGameplay(10_000);
    const to=Math.min(await clock(live,W),await clock(live,P));
    const fighting=(await spendsSince(live,P,from)).samples.filter(s=>s.at<to&&s.target).length;
    // A9 holds a fighter's regeneration from the first time its own client read a fighter below
    // the line in the fight, so each fighter's count starts at the first
    // of its 100 ms samples that reads one. A regeneration before that, while the plants are still
    // on their way, is the design's "before any fighter drops below 80%".
    const dropAt:Record<string,number|null>=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,(await spendsSince(live,n,from)).samples
      .find(s=>s.at<to&&Object.values(s.party).some(m=>m.max>0&&m.hp/m.max<A9_LINE))?.at??null])));
    const all:Record<string,[number,string,unknown][]>=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,(await sends(n,from,to)).filter(s=>regen(s)).map(s=>[s.at-from,regen(s),s.fight] as [number,string,unknown])])));
    const after=(n:string)=>{const at=dropAt[n];return at===null||at===undefined?null:at-from;};
    // A regeneration after a drop: the needs' answers on that fighter over the window, for its reading.
    for(const n of fighters){const d=after(n);if(d!==null&&all[n]!.some(([at])=>at>=d))
      console.log('SURVIVAL-SV5-VIEW '+JSON.stringify({name:n,dropAfterMs:d,needs:((await needsSince(live,n,from)) as any)?.calls?.filter((c:any[])=>c[1]==='regeneration'&&c[0]<to-from),
        samples:((await spendsSince(live,n,from)).samples as any[]).filter(s=>s.at<to).map(s=>[s.at-from,s.target?1:0,...Object.values(s.party).map((m:any)=>Math.round(m.hp/m.max*1000)/10)])}));}
    // Each fighter's farm fact over the window: its share of passes that read the
    // character at its farm, and its saved spot and position at the window's end.
    const farm=Object.fromEntries(await Promise.all(fighters.map(async n=>{const calls=(((await needsSince(live,n,from)) as any)?.calls??[]).filter((c:any[])=>c[1]==='regeneration'&&c[0]<to-from);
      return [n,{passes:calls.length,atFarm:calls.filter((c:any[])=>Array.isArray(c[7])&&c[7][2]===1).length,
        ...await live.clients[n]!.run('({spot:partyHunting.farm.spot()??null,x:Math.round(character.x),y:Math.round(character.y),map:character.map})') as object}];})));
    result.sv5fight={gapAfterMs:gapAt-from,removed,farm,windowMs:to-from,fightingSamples:fighting,line:A9_LINE,dropAfterMs:Object.fromEntries(fighters.map(n=>[n,after(n)])),all,
      regens:Object.fromEntries(fighters.map(n=>{const d=after(n);return [n,d===null?[]:all[n]!.filter(([at])=>at>=d)];}))};
    await restore(live);}
  // "HP potion below" written to 30 mid-fight with the warrior at 40%: no `use_hp` from the next
  // reply; back to 50: `use_hp`. A write reaches the character with its next
  // report reply, so each half starts once the warrior reads the written value.
  const setting=(value:number)=>writeDelivered(live,'hpPotionBelow',W,value,'globalThis.__partySurvival?.lines?.().hp??null','SV13');
  result.sv13={written30:await setting(30)};
  if(result.sv13.written30===true){
    const at=await plantOwn(live,W,{hp:0.4}),limit=await bound(W);await waitForGameplay(limit+500);
    result.sv13.potionsAt30=(await sends(W,at.seenAt)).filter(s=>potion(s)==='use_hp').length;
    result.sv13.written50=await setting(50);
    const back=await plantOwn(live,W,{hp:0.4});await waitForGameplay(REGEN_COOLDOWN_MS+limit+500);
    const free=await familyFree(live,W,back.seenAt,windows[W]!.cooldown),share=await shareAt(live,W,free);
    result.sv13.potionAt50=(await sends(W,back.seenAt)).some(s=>potion(s)==='use_hp');result.sv13.dueAt50=share===null||share<HP_LINE;
    // A miss's reading: from the 30 half on, the warrior's sends, replies, executor records, its own
    // HP samples and the potion and regeneration needs' answers.
    if(result.sv13.dueAt50&&!result.sv13.potionAt50){const from=at.seenAt,l=await spendsSince(live,W,from);
      console.log('SURVIVAL-SV13-VIEW '+JSON.stringify({back:back.seenAt-from,free:free-from,
        spends:(l.spends as Spend[]).map(s=>[s.at-from,s.method,(s as any).name??s.item??(s as any).id,s.party[W]?Math.round(s.party[W]!.hp/s.party[W]!.max*1000)/10:null]),
        replies:l.replies.map((r:any)=>[r.at-from,r.place,r.response,r.failed]),ring:l.ring.map((r:any)=>[r.at-from,r.kind,r.family,r.skill,r.reason??r.waitedMs??null]),
        samples:l.samples.filter((_:unknown,i:number)=>i%3===0).map((s:any)=>[s.at-from,s.party[W]?Math.round(s.party[W].hp/s.party[W].max*1000)/10:null]),
        needs:((await needsSince(live,W,from)) as any)?.calls?.filter((c:any[])=>c[1]!=='heal')}));}
    await restore(live);
  }
  // SV11: a party Town with the priest planted below both
  // lines once its channel shows: no potion and no heal leaves during the channel, since each ends
  // it (server.js:7657, 3519); regeneration leaves it, so the pulse's regeneration goes on. The row
  // sits here, where the default table's plants and spend log already run (13.3).
  {const townFrom=await clock(live,P),answer=await live.post('/town-party',{}).catch((error:Error)=>String(error.message).slice(0,300));
    // A miss's reading (13.5a item 3: run G's channel never showed and the log held nothing of the
    // priest): the route's answer, the priest's state, its game replies and turns ring since the post,
    // and its town skill's cooldown.
    await expect.poll(()=>live.clients[P]!.run('!!(character.c&&character.c.town)'),{timeout:30_000,intervals:[50],message:"SV11: the priest's Town channel"}).toBe(true)
      .catch(async error=>{const l=await spendsSince(live,P,townFrom);
        console.log('SURVIVAL-SV11-VIEW '+JSON.stringify({answer,replies:l.replies.map((r:any)=>[r.at-townFrom,r.place,r.response,r.failed,r.reason]),
          ring:l.ring.map((r:any)=>[r.at-townFrom,r.kind,r.family,r.skill,r.reason??r.waitedMs??null]),
          priest:await live.clients[P]!.run(`({rip:!!character.rip,map:character.map,at:[Math.round(character.real_x),Math.round(character.real_y)],c:Object.keys(character.c||{}),party:character.party??null,
            moving:!!character.moving,townReady:parent.next_skill&&parent.next_skill.town?+parent.next_skill.town-Date.now():null,hand:partyTasks.holds.handControl()??null,
            occupied:!!__partyHooks.skills.allows({rank:'damage',occupied:true}),held:__partyHooks.ask('lifecycle.held')??null,live:globalThis.__partyMovement?.live?.()?.owner??null,
            command:(()=>{try{const c=partyTasks.convoyState().command;return c?JSON.stringify(c).slice(0,400):null;}catch(e){return String(e).slice(0,100);}})()})`),
          tasks:((await live.tasks()).groups??[]).map((g:any)=>[g.id,g.members,g.live?.kind??null,g.live?.owner??null])}).slice(0,8000));
        throw error;});
    const planted=await plantOwn(live,P,{hp:0.4,mp:0.15});
    await expect.poll(()=>live.clients[P]!.run('!(character.c&&character.c.town)'),{timeout:30_000,intervals:[50],message:"SV11: the priest's Town channel ends"}).toBe(true);
    const list=(await sends(P,planted.seenAt)).filter(s=>(s as Spend&{town?:boolean}).town);
    result.sv11={channelMs:(await clock(live,P))-planted.seenAt,potions:list.filter(s=>potion(s)).map(s=>[s.at-planted.seenAt,potion(s)]),
      heals:list.filter(s=>s.method==='heal'||s.method==='skill'&&(s as Spend&{name?:string}).name==='partyheal').map(s=>s.at-planted.seenAt),
      regens:list.filter(s=>regen(s)).map(s=>[s.at-planted.seenAt,regen(s)]),regenWindow:REGEN_COOLDOWN_MS+windows[P]!.rtt};
    await restore(live);
    // The party Town ends with the fighters in town; SV5's out-of-fight half starts from the fight.
    await fightingAtGoo(live);}
  // Out of a fight: both fighters sent north of the town square walk back to the goo field with
  // no monster on them, and the warrior, planted to 70% HP with the transport, regenerates within one
  // regeneration cooldown. The potion family starts free: a regeneration sent before the transport
  // locks it for 4 s (server.js:12047). The plant rides the transport, so the need's first pick on the
  // walk is `regen_hp` (needs.ts `regenerationOrder` reads HP before MP above half): in an earlier run
  // the warrior, set full at the transport, cast Warcry as the walk began (MP 1050 to 730), the need
  // sent `regen_mp`, its lock ran to the plant, and by then the walk had reached the farm, where the regeneration
  // hold starts once a fighter reads below 80%. The walk starts at Main's spawn 9
  // (-85, -389), about 990 from the goo field where spawn 0 is 600, so a lock from a regeneration sent
  // shortly before the transport ends before the walk reaches the farm.
  // Red plants of this setup: `sv5lock` sends a `regen_mp` as the walk begins, the potion group's
  // lock of that earlier run, and `sv5old` keeps the setup before the fix: both fighters full at Main's
  // spawn 0 and the plant once the family frees on the walk.
  {const lock=async()=>{if(!red('sv5lock'))return;await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});p.mp=Math.round(p.max_mp*0.7);resend(p,'u+cid');return true;})()`);
      await expect.poll(()=>live.clients[W]!.run('character.mp<character.max_mp'),{timeout:10_000,intervals:[50]}).toBe(true);
      await live.clients[W]!.run(`parent.socket.emit('use',{item:'mp'})`);};
    await expect.poll(()=>live.clients[W]!.run(`!(parent.next_skill&&['use_hp','use_mp','regen_hp','regen_mp'].some(k=>+parent.next_skill[k]>Date.now()))`),
      {timeout:15_000,intervals:[100],message:"SV5: the warrior's potion family is free before the walk"}).toBe(true);
    let planted:Awaited<ReturnType<typeof plantOwn>>;
    if(red('sv5old')){
      await live.admin(`output=(()=>{for(const n of ${JSON.stringify(fighters)}){const p=get_player(n);p.hp=p.max_hp;p.mp=p.max_mp;transport_player_to(p,'main',[0,0]);}return true;})()`);
      await expect.poll(()=>live.clients[W]!.run('!!character.moving&&character.map==="main"'),{timeout:60_000,message:'SV5: the warrior walks back'}).toBe(true);
      await lock();
      await expect.poll(()=>live.clients[W]!.run(`!(parent.next_skill&&['use_hp','use_mp','regen_hp','regen_mp'].some(k=>+parent.next_skill[k]>Date.now()))`),
        {timeout:15_000,intervals:[100],message:"SV5: the warrior's potion family is free before the plant"}).toBe(true);
      planted=await plantOwn(live,W,{hp:0.7});
    }else{
      await lock();
      await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(P)});p.hp=p.max_hp;p.mp=p.max_mp;transport_player_to(p,'main',[-85,-389]);return true;})()`);
      planted=await plantOwn(live,W,{hp:0.7,mp:1,transport:['main',-85,-389]});
    }
    const limit=REGEN_COOLDOWN_MS+windows[W]!.rtt+await step(W,rowFrom);
    await waitForGameplay(limit+500);
    const list=await sends(W,planted.seenAt);
    const first=list.find(s=>regen(s)==='regen_hp');
    const threatened=await live.clients[W]!.run(`Object.values(parent.entities).some(e=>e.type==='monster'&&[${JSON.stringify(W)},${JSON.stringify(P)}].includes(e.target))`);
    result.sv5out={limit,afterMs:first?first.at-planted.seenAt:null,threatened,family:list.filter(s=>family(s)).map(s=>[s.at-planted.seenAt,family(s)])};
    // The needs' times read from 3000 ms before the plant (`needsFrom`); an earlier run read them as from the plant.
    console.log('SURVIVAL-SV5-OUT '+JSON.stringify({planted,needsFrom:-3000,needs:((await needsSince(live,W,planted.seenAt-3000)) as any)?.calls?.filter((c:any[])=>c[1]!=='heal').slice(0,120),
      before:(await sends(W,planted.seenAt-5000)).filter(s=>family(s)).map(s=>[s.at-planted.seenAt,family(s)]),
      at:await live.clients[W]!.run('({x:character.real_x,y:character.real_y,map:character.map,moving:character.moving,hp:character.hp,max:character.max_hp,ns:parent.next_skill&&{use_hp:+parent.next_skill.use_hp||0,regen_hp:+parent.next_skill.regen_hp||0,now:Date.now()}})')}));
    await restore(live);}
  await info.attach('survival-v1',{body:JSON.stringify(result,null,1),contentType:'application/json'});
  console.log('SURVIVAL-V1 '+JSON.stringify(result));
  for(const n of fighters){
    expect.soft(result.sv1[n].wrong,`SV1: ${n}'s potion family sends other than use_hp while its HP reads below the line`).toEqual([]);
    if(result.sv1[n].due)expect.soft(result.sv1[n].afterMs,`SV1: ${n} at 40% drinks use_hp within one potion cooldown`).not.toBeNull();
    if(result.sv1[n].afterMs!==null)expect.soft(result.sv1[n].afterMs,`SV1: ${n}'s use_hp within ${result.sv1[n].limit} ms`).toBeLessThanOrEqual(result.sv1[n].limit);
    expect.soft(result.sv3[n].afterMs,`SV3: ${n} at 15% MP drinks use_mp within one potion cooldown`).not.toBeNull();
    if(result.sv3[n].afterMs!==null)expect.soft(result.sv3[n].afterMs,`SV3: ${n}'s use_mp within ${result.sv3[n].limit} ms`).toBeLessThanOrEqual(result.sv3[n].limit);
  }
  expect.soft(result.sv6.first,'SV6: a potion family entry with both needs open').not.toBeNull();
  expect.soft(result.sv6.wrong,'SV6: potion family sends other than use_hp while the HP reads below the line').toEqual([]);
  expect.soft(result.sv2.first,'SV2: the warrior at 20% HP and low MP drinks use_hp first').toBe('use_hp');
  expect.soft(result.sv2.mpBelowLine,'SV2: MP potions while HP reads below the HP line').toBe(0);
  // The warrior's plant at 75% must reach each fighter's client, or the count below reads nothing.
  for(const n of fighters)expect.soft(result.sv5fight.dropAfterMs[n],`SV5: ${n}'s client reads a fighter below 80%`).not.toBeNull();
  for(const n of fighters)expect.soft(result.sv5fight.regens[n],`SV5: ${n}'s regeneration in a fight after a fighter read below 80%`).toEqual([]);
  expect.soft(result.sv5out.afterMs,'SV5: out of a fight the warrior at 70% regenerates within one regeneration cooldown').not.toBeNull();
  if(result.sv5out.afterMs!==null)expect.soft(result.sv5out.afterMs,`SV5: regeneration within ${result.sv5out.limit} ms`).toBeLessThanOrEqual(result.sv5out.limit);
  expect.soft(result.sv11.potions,'SV11: potions during the Town channel').toEqual([]);
  expect.soft(result.sv11.heals,'SV11: heals during the Town channel').toEqual([]);
  // A channel shorter than one regeneration cooldown can fall wholly inside the last one's wait.
  if(result.sv11.channelMs>=result.sv11.regenWindow)expect.soft(result.sv11.regens.length,'SV11: regeneration goes on during the Town channel').toBeGreaterThan(0);
  expect.soft(result.sv13.written30,'SV13: "HP potion below" takes a write (step 2)').toBe(true);
  if(result.sv13.written30===true){expect.soft(result.sv13.potionsAt30,'SV13: at 30 the warrior at 40% drinks no use_hp').toBe(0);
    if(result.sv13.dueAt50)expect.soft(result.sv13.potionAt50,'SV13: back at 50 it drinks use_hp').toBe(true);}
  // The character half (decided 2026-11-06): a page
  // add-on with one registration and no core edit asks `survival.verdict({character})` on each
  // turns pass and keeps the answers; the farming warrior's own fight reads `fight`. The
  // coordinator's half (the walk verdict and `survival.died`) is covered in hook-registry.test.cjs.
  {
    const name='survival-reader-fixture';
    await live.clients[W]!.run(`(()=>{const hooks=globalThis.__partyHooks;globalThis.__e2eSurvivalReader=[];
      if(hooks.registrations().some(r=>r.name==='${name}'))return true;
      return hooks.register({name:'${name}',folder:'addons',author:'e2e',summary:'Reads the survival verdict.',
        hooks:{'skills.request':[{name:'reader',rank:'task',answer(view){const me=view&&view.character;if(me)globalThis.__e2eSurvivalReader.push(hooks.survival.verdict({character:me.name}));
          if(globalThis.__e2eSurvivalReader.length>200)globalThis.__e2eSurvivalReader.splice(0,100);return undefined;}}]}}).ok;})()`);
    const switches=(on:boolean)=>live.clients[W]!.run(addonSwitches(name,on));
    await live.post('/settings',{changes:[{field:'addons',value:await switches(true)}]});
    await expect.poll(()=>live.clients[W]!.run('(globalThis.__e2eSurvivalReader||[]).length'),{timeout:30_000,message:'SV41: the add-on reads the verdict'}).toBeGreaterThan(0).catch(()=>{});
    result.sv41=[...new Set(await live.clients[W]!.run('globalThis.__e2eSurvivalReader||[]') as string[])];
    await live.post('/settings',{changes:[{field:'addons',value:await switches(false)}]});
    console.log('SURVIVAL-SV41 '+JSON.stringify(result.sv41));
    expect.soft(result.sv41,"SV41: the add-on's verdict answers on the farming warrior").toEqual(['fight']);
  }
}

// The escape check: every survival spend a character makes while its escape
// owns it, with whether the call budget was asked in the same synchronous turn. The turns executor
// asks `calls.band` and makes the call in one turn, so a spend with no
// ask in its turn went around the budget. Blink and Magiport are movement's crossings, which ask
// the band already, so the probe leaves them out. It also keeps the replies of the potion
// family and the heal (two potion family spends in flight read `not_ready`; the heal check reads a heal
// that landed), each `respawn` with its ask and whether one was in flight, and the native
// moves (the Scare check reads Scare before the first).
// The hit probe: each hit on this character with the attacker's monster name when its entity is
// on the client at the hit, else null (the game's hit packet carries the attacker's id only), and
// the time it started. It also keeps the server's `defeated_by_a_monster` responses with the
// monster's name, and this character's own deaths. A row whose character can be hit before its
// death plant starts the probe 15 s before it: UP-2's arena goos hit the warrior before its plant.
// The UP-1 and UP-3 rows run in a peaceful world, where escapeSpendProbe starts it at the plant.
export const survivalHitProbe=`(()=>{const g=globalThis;if(g.__e2eSurvivalHits)return true;const hits=g.__e2eSurvivalHits=[],killers=g.__e2eSurvivalKillers=[],deaths=g.__e2eSurvivalDeaths=[];g.__e2eSurvivalHitsFrom=Date.now();
  parent.socket.on('hit',d=>{if(!d||d.id!==character.name||!(Number(d.damage)>0))return;const e=d.hid&&get_entity(String(d.hid));
    hits.push({at:Date.now(),hid:d.hid??null,source:d.source??null,name:e&&e.type==='monster'?(G.monsters[e.mtype]?.name||String(e.mtype)):null});});
  parent.socket.on('game_response',d=>{if(d&&d.response==='defeated_by_a_monster'&&d.monster)killers.push({at:Date.now(),monster:String(d.monster),name:G.monsters[d.monster]?.name||String(d.monster)});});
  parent.socket.on('death',d=>{if(d&&(d.id||d.name)===character.name)deaths.push(Date.now());});
  return true;})()`;
const ESCAPE_SPENDS=['use_hp','use_mp','hardshell','charge','dash','stomp','curse','heal','partyheal','scare'];
export const escapeSpendProbe=`(()=>{if(globalThis.__e2eEscapeSpends)return true;const g=globalThis,log=g.__e2eEscapeSpends=[];let asked=null;
  const replies=g.__e2eEscapeReplies=[],respawns=g.__e2eRespawns=[],moves=g.__e2eEscapeMoves=[];let flying=false;
  const calls=g.__partyHooks.calls,band=calls.band;calls.band=function(q){const a=band.apply(this,arguments);asked={method:q.method,answer:a};queueMicrotask(()=>{asked=null;});return a;};
  const escaping=()=>!!g.__partyHooks.survival.escaping(character.name);
  const wrap=(name,skillOf)=>{const f=g[name];g[name]=function(){const skill=skillOf(arguments);
    if(escaping()&&${JSON.stringify(ESCAPE_SPENDS)}.includes(skill))log.push({at:Date.now(),skill,asked:asked?asked.answer:null});
    return f.apply(this,arguments);};};
  wrap('use_skill',a=>String(a[0]));wrap('heal',()=>'heal');
  const respawn=g.respawn;g.respawn=function(){respawns.push({at:Date.now(),asked:asked&&asked.method==='respawn'?asked.answer:null,inFlight:flying,rip:!!character.rip});flying=true;
    return Promise.resolve(respawn.apply(this,arguments)).finally(()=>{flying=false;});};
  const move=g.move;g.move=function(){if(escaping())moves.push(Date.now());return move.apply(this,arguments);};
  parent.socket.on('game_response',d=>{if(d&&typeof d==='object'&&['equip','use','heal','partyheal','respawn','curse'].includes(d.place))replies.push({at:Date.now(),place:d.place,response:d.response||null,failed:!!d.failed,ms:d.ms});});
  ${survivalHitProbe};
  return true;})()`;
export async function escapeSpendRead(live:LiveGame,names:readonly string[]){
  const out:Record<string,{at:number;skill:string;asked:string|null}[]>={},replies:Record<string,any[]>={},respawns:Record<string,any[]>={},moves:Record<string,number[]>={};
  for(const n of names){out[n]=await live.clients[n]!.run('globalThis.__e2eEscapeSpends??[]') as any;replies[n]=await live.clients[n]!.run('globalThis.__e2eEscapeReplies??[]') as any;
    respawns[n]=await live.clients[n]!.run('globalThis.__e2eRespawns??[]') as any;moves[n]=await live.clients[n]!.run('globalThis.__e2eEscapeMoves??[]') as any;}
  const unasked=Object.fromEntries(names.map(n=>[n,out[n]!.filter(s=>s.asked===null).length]));
  const notReady=Object.fromEntries(names.map(n=>[n,replies[n]!.filter(r=>['equip','use'].includes(r.place)&&r.response==='not_ready').length]));
  return {spends:out,unasked,total:Object.values(out).reduce((a,l)=>a+l.length,0),unaskedTotal:Object.values(unasked).reduce((a,b)=>a+b,0),
    notReady,notReadyTotal:Object.values(notReady).reduce((a,b)=>a+b,0),replies,respawns,moves};
}
// SV16: every escape spend asked the band, and the potion family never had two in flight.
export function sv16Holds(read:Awaited<ReturnType<typeof escapeSpendRead>>,label:string){
  expect.soft(read.total,`SV16 (${label}): the escape made survival spends`).toBeGreaterThan(0);
  expect.soft(read.unaskedTotal,`SV16 (${label}): escape spends without a calls.band ask`).toBe(0);
  expect.soft(read.notReadyTotal,`SV16 (${label}): potion family not_ready replies`).toBe(0);
}
// The emergency Stomp on the bee field: the warrior with the basher the turns row
// equips and two bees planted on it. Survival's emergency Stomp goes as a `survival` request of the
// stomp family through the turns executor, each send with its `calls.band` ask in the same turn,
// and the tick that sends it goes on to its support part (the warrior's next spend is read; the
// order inside one tick is role-loop-order.test.cjs's row, which no live row can plant). Auto
// farms bees in Scatter, where today's rule holds the emergency Stomp (shared.js
// `emergencyStompHeld`), so the plant runs with the warrior's combat mode on Default, away from
// other monsters. The class has no scatter Stomp. The requester is survival's own booking, called
// in the send's turn (executor.ts `send`): a class spend in the same pass overwrites the card's
// diagnostic before a microtask reads it.
export async function sv12StompRows(live:LiveGame,info:TestInfo){
  const own=await live.clients[W]!.run('character.slots.mainhand?.name??null') as string|null;
  const slot=await live.admin(`output=(()=>{const p=get_player('${W}'),i=p.items.findIndex(x=>!x);p.items[i]={name:'basher',level:0};p.citems[i]=cache_item(p.items[i]);p.esize--;resend(p,'u+cid+reopen');return i;})()`) as number;
  const result:any={};
  try{
    await expect.poll(()=>live.clients[W]!.run(`character.items[${slot}]?.name==='basher'`),{timeout:10_000,message:'SV12: the basher in the bag'}).toBe(true);
    await live.clients[W]!.run(`(equip(${slot}),true)`);
    await expect.poll(()=>live.clients[W]!.run(`character.slots.mainhand?.name==='basher'`),{timeout:10_000,message:'SV12: the warrior holds a basher'}).toBe(true);
    await live.post('/farming-mode',{character:W,combatMode:'default'});
    await expect.poll(()=>live.clients[W]!.run('globalThis.partyHunting.farm.mode()'),{timeout:15_000,message:'SV12: the warrior farms on Default'}).toBe('default');
    // A Stomp cast before the plant (the emergency Stomp on the field's bees) leaves Stomp's 24 s
    // cooldown (game data), which would outlast the plant, whose two bees the basher kills within a
    // second. The plant waits for the cooldown's end, and the row records whether it waited.
    // With the bee field's farm focus the warrior keeps its farm: its combat approach toward a
    // bee it had picked walked on from the spot after the transport (in one run it stood 60 off the spot
    // 1.5 s later, its approach headed for the field), and the coordinator's convoy
    // takes a leader away from its farm back to it (4 s after the transport in one run). With no farm
    // focus, as the table's reset leaves the party (live-fixtures.ts `defaultFixtureReset`), the
    // warrior stays where the transport puts it and fights only what attacks the party.
    await live.post('/focus',{monsterFocus:[]});
    const cooling=await live.clients[W]!.run(`[Date.now(),is_on_cooldown('stomp')?1:0]`) as [number,number];
    await expect.poll(()=>live.clients[W]!.run(`!is_on_cooldown('stomp')`),{timeout:30_000,message:'SV12: Stomp off its cooldown before the plant'}).toBe(true);
    result.cooldown={onCooldown:cooling[1],waitedMs:(await live.clients[W]!.run('Date.now()') as number)-cooling[0]};
    await live.clients[W]!.run(`(()=>{const g=globalThis;if(g.__e2eStomps)return true;const log=g.__e2eStomps=[],sends=g.__e2eWarriorSends=[];let asked=null;
      const calls=g.__partyHooks.calls,band=calls.band;calls.band=function(q){const a=band.apply(this,arguments);asked=a;queueMicrotask(()=>{asked=null;});return a;};
      const f=g.use_skill;g.use_skill=function(skill){const at=Date.now();sends.push([at,String(skill)]);
        // The executor names the requester in its diagnostic right after the call (executor.ts \`send\`).
        const entry=skill==='stomp'?{at,asked,by:null,survival:false}:null;if(entry){log.push(entry);queueMicrotask(()=>{entry.by=globalThis.partyCombatState?.skill?.by??null;});}
        return f.apply(this,arguments);};
      const s=g.__partySurvival,need=s.needs.stomp,trace=g.__e2eStompNeeds=[];s.needs.stomp=v=>{const out=need(v);
        trace.push([Date.now(),[character.map,Math.round(character.real_x),Math.round(character.real_y)],v.kind,v.roleLoop?1:0,v.chain?1:0,out?1:0,s.needs.stompHeld(400)?1:0,g.partyHunting.farm.mode(),character.mp,Object.values(parent.entities).filter(e=>e.type==='monster'&&!e.dead&&e.target===character.name).length,
          // The leader lock the hold reads (shared.js emergencyStompHeld): the group's fights, its target and each monster in Stomp's range with whether it is that target.
          (()=>{const gc=g.__partyGroupedCombat;return [gc&&gc.fights?gc.fights.map(f=>String(f.id)):null,gc&&gc.target?String(gc.target.id):null,Object.values(parent.entities).filter(e=>e.type==='monster'&&e.visible&&!e.dead&&Math.hypot(e.x-character.x,e.y-character.y)<=400).map(e=>[String(e.id),e.target||null,gc&&gc.target&&String(gc.target.id)===String(e.id)?1:0])];})()]);if(trace.length>400)trace.splice(0,100);
        if(out)out.book={sent(){const last=log[log.length-1];if(last&&last.at===Date.now())last.survival=true;}};return out;};return true;})()`);
    // The emergency Stomp's hold also holds while a fight is unfinished and a neutral monster stands
    // in Stomp's range (shared.js `emergencyStompHeld`): one that is not the group's lock target and
    // targets no party member (decided 2026-11-06), which every idle bee on
    // the field is. The plant goes where no other monster stands. The training targets stand within
    // Stomp's range of the town square, and the hens' and rooster's boundary within 176 of
    // (150, -400).
    // The spot is (300, 75) on Main, east of the town square: 408 from the spiders' boundary, 439
    // from the phoenix's and 444 from the hens', the nearest spawns in game data's Main. The spot
    // must lie on the server's walkable grid (server_functions.js `is_xy_safe` over `smap_data`):
    // the server reads a move whose start is off that grid as a line violation, defeats the
    // character and sends it to the jail (server.js socket "move", `transport_player_to(player,
    // "jail")`). (400, -600) and (300, -750) lie off Main's grid, so the warrior's first move from
    // either landed it in the jail beside its jrats.
    // The check holds over one status report after the transport, so the client's view of the spot
    // has arrived.
    const SPOT=[300,75] as const;
    expect(await live.admin(`output=is_xy_safe('main',${SPOT[0]},${SPOT[1]})`),'SV12: the spot lies on the walkable grid of Main the server holds').toBe(true);
    // Movement's request ring from the transport on: each journey's decision, kind, owner and
    // requester (movement-records.ts `MovementRecord`), with where the warrior stood, so a walk off
    // the spot names the owner that asked for it.
    const movedFrom=await live.clients[W]!.run('Date.now()') as number;
    await live.admin(`output=(()=>{transport_player_to(get_player('${W}'),'main',[${SPOT[0]},${SPOT[1]}]);return true;})()`);
    // The plant needs no neutral monster in Stomp's range of the warrior where it stands; the spot's
    // own distance counts only for the transport's arrival. A combat approach live at the transport
    // walks on until its release, about 20 units in one run, so the second check reads the range
    // alone.
    const neutralFree=`character.map==='main'&&!Object.values(parent.entities).some(e=>e.type==='monster'&&!e.dead&&!['${W}','${P}'].includes(e.target)&&Math.hypot(e.x-character.x,e.y-character.y)<=(Number(G.skills.stomp.range)||400))`;
    const clear=`Math.hypot(character.real_x-${SPOT[0]},character.real_y-${SPOT[1]})<=20&&${neutralFree}`;
    await expect.poll(()=>live.clients[W]!.run(clear),{timeout:30_000,intervals:[50],message:'SV12: the warrior at its spot east of the town square'}).toBe(true);
    const seen=Number((await live.state()).characters[W]?.seenAt)||0;
    await expect.poll(async()=>Number((await live.state()).characters[W]?.seenAt)||0,{timeout:15_000,message:'SV12: one status report from the spot'}).toBeGreaterThan(seen);
    // Monsters still reach the spot: one run read one in Stomp's range after the report. The server
    // takes away each monster within Stomp's range of the warrior that targets no party member (they
    // respawn at their own spawn), and the row records them, so only the plant stands there.
    result.cleared=await live.admin(`output=(()=>{const p=get_player('${W}'),out=[];for(const m of Object.values(instances[p.in].monsters||{}))
      if(!m.dead&&Math.hypot(m.x-p.x,m.y-p.y)<=(Number(G.skills.stomp.range)||400)+50&&!['${W}','${P}'].includes(m.target)){out.push([String(m.id),m.type,Math.round(m.x),Math.round(m.y),m.target||null]);remove_monster(m,{method:'disappear'});}return out;})()`);
    const moves=async()=>((await live.clients[W]!.run('__partyMovement.records()')) as any[]).filter(r=>r.at>=movedFrom)
      .map(r=>[r.at-movedFrom,r.decision,r.kind??null,r.owner??null,r.by?[r.by.kind,r.by.owner??null,r.by.site??null]:null,r.destination?[r.destination.map,Math.round(r.destination.x),Math.round(r.destination.y)]:null,r.from?[Math.round(r.from.x),Math.round(r.from.y)]:null,r.code??null,r.cause??null]);
    // The first failed checks keep what the client held then: its position and each monster in
    // Stomp's range that targets no party member.
    const views:unknown[]=[];
    const view=`[character.map,Math.round(character.real_x),Math.round(character.real_y),Object.values(parent.entities).filter(e=>e.type==='monster'&&!e.dead&&!['${W}','${P}'].includes(e.target)&&Math.hypot(e.x-character.x,e.y-character.y)<=(Number(G.skills.stomp.range)||400)).map(e=>[String(e.id),e.mtype,Math.round(e.x),Math.round(e.y)])]`;
    await expect.poll(async()=>{if(await live.clients[W]!.run(neutralFree))return true;if(views.length<3)views.push(await live.clients[W]!.run(view));return false;},{timeout:30_000,intervals:[50],message:'SV12: no neutral monster in Stomp range of the warrior'}).toBe(true)
      .catch(async error=>{console.log('SV12-VIEW '+JSON.stringify(views));console.log('SV12-MOVES '+JSON.stringify(await moves()));console.log('SV12-SPOT '+JSON.stringify({cleared:result.cleared,seen:await live.clients[W]!.run(`Object.values(parent.entities).filter(e=>e.type==='monster'&&!e.dead&&Math.hypot(e.x-character.x,e.y-character.y)<=450).map(e=>[String(e.id),e.mtype,Math.round(e.x),Math.round(e.y),e.target||null])`)}));throw error;});
    const from=await live.clients[W]!.run('Date.now()') as number;
    const planted=await live.admin(`output=(()=>{const p=get_player('${W}'),out=[];for(let i=0;i<2;i++){const m=new_monster(p.in,{type:'bee',position:[p.x+10+i*5,p.y],radius:0,count:1},{temp:1});
      m.e2eHunt=true;target_player(m,p);m.u=true;out.push(String(m.id));}return out;})()`);
    await expect.poll(()=>live.clients[W]!.run('(globalThis.__e2eStomps||[]).length'),{timeout:30_000,message:'SV12: the emergency Stomp goes'}).toBeGreaterThan(0).catch(()=>{});
    const stomps=await live.clients[W]!.run('globalThis.__e2eStomps') as any[],sends=await live.clients[W]!.run('globalThis.__e2eWarriorSends') as [number,string][];
    result.moves=await moves();
    Object.assign(result,{planted,stomps,next:stomps.map(s=>sends.find(([at,skill])=>at>s.at&&skill!=='stomp')?.map((v,i)=>i===0?Number(v)-s.at:v)??null),from,
      sameMs:stomps.map(s=>sends.filter(([at])=>at===s.at).map(([,k])=>k)),
      needs:((await live.clients[W]!.run('globalThis.__e2eStompNeeds')) as any[]).filter(x=>x[0]>=from).map(x=>[x[0]-from,...x.slice(1)]).filter((x,i,a)=>i===0||JSON.stringify(x.slice(1))!==JSON.stringify(a[i-1].slice(1))).slice(0,80),
      ring:((await live.clients[W]!.run('globalThis.__partyTurns.records()')) as any[]).filter(r=>r.at>=from&&r.skill==='stomp').slice(0,30)});
    await live.admin(`output=(()=>{for(const id of ${JSON.stringify(planted)})for(const i of Object.values(instances)){const m=i.monsters&&i.monsters[id];if(m)remove_monster(m,{method:'disappear'});}return true;})()`);
  }finally{
    if(own)await live.clients[W]!.run(`(()=>{const i=character.items.findIndex(x=>x&&x.name===${JSON.stringify(own)});if(i>=0)equip(i);return true;})()`);
    await live.post('/farming-mode',{character:W,combatMode:'auto'});
  }
  await info.attach('survival-sv12',{body:JSON.stringify(result,null,1),contentType:'application/json'});
  console.log('SURVIVAL-SV12 '+JSON.stringify(result));
  expect.soft(result.stomps?.length??0,'SV12: the emergency Stomp goes with two monsters on the warrior').toBeGreaterThan(0);
  expect.soft((result.stomps??[]).filter((s:any)=>s.asked!=='send'),'SV12: a Stomp without a calls.band ask').toEqual([]);
  expect.soft((result.stomps??[]).filter((s:any)=>!s.survival),'SV12: a Stomp that is not survival\'s request').toEqual([]);
  return result;
}
// SV17, SV18 and SV22 in case A: the warrior's shield cycle under a
// planted monster, the priest's Curse only after a heal that did not land, and the jacko's Scare
// before the warrior's first move of the escape.
export function caseASpendsHold(read:Awaited<ReturnType<typeof escapeSpendRead>>,warrior:string,priest:string,startedAt:number,records:any[]=[]){
  const w=read.spends[warrior]??[],p=read.spends[priest]??[],count=(l:any[],s:string)=>l.filter(x=>x.skill===s).length;
  expect.soft(count(w,'hardshell'),'SV17: the warrior casts Hardshell once the planted monster hits it').toBeGreaterThan(0);
  expect.soft(count(w,'charge')+count(w,'dash'),'SV17: the warrior Charges or Dashes on its retreat').toBeGreaterThan(0);
  expect.soft(count(w,'charge'),'SV17: one Charge per shield cycle').toBeLessThanOrEqual(count(w,'hardshell')+1);
  const landed=(read.replies[priest]??[]).filter(r=>['heal','partyheal'].includes(r.place)&&!r.failed);
  const afterLanded=p.filter(s=>s.skill==='curse'&&landed.some(r=>r.at<=s.at&&s.at-r.at<=100));
  expect.soft(afterLanded,'SV18: an escape Curse right after a heal that landed').toEqual([]);
  // The first escape movement: the warrior's first escape journey, retreat step or crossing in
  // movement's ring (a stop in place when the escape takes the character is no movement).
  const firstMove=records.filter(r=>r.at>=startedAt&&r.kind==='escape'&&(['started','crossing'].includes(r.decision)||r.code==='escape-retreat'&&r.decision==='step')).map(r=>r.at as number).sort((a,b)=>a-b)[0];
  const scare=w.filter(s=>s.skill==='scare');
  expect.soft(scare.length,'SV22: the warrior holding a jacko Scares before leaving').toBeGreaterThan(0);
  if(scare.length&&firstMove!==undefined)expect.soft(scare[0]!.at,'SV22: the Scare goes before the first escape move').toBeLessThan(firstMove);
  return {hardshell:count(w,'hardshell'),charge:count(w,'charge'),dash:count(w,'dash'),curse:count(p,'curse'),scare:scare.length,firstMove,landed:landed.length};
}
// SV26 on one character: every respawn asked the survival band, and none went with one in flight.
export function sv26Holds(read:Awaited<ReturnType<typeof escapeSpendRead>>,name:string,label:string){
  const sends=read.respawns[name]??[];
  expect.soft(sends.filter(s=>s.asked!=='send'),`SV26 (${label}): ${name}'s respawns without a survival band ask`).toEqual([]);
  expect.soft(sends.filter(s=>s.inFlight),`SV26 (${label}): ${name}'s respawn while one was in flight`).toEqual([]);
}
// SV24 and SV25 for one death: the character's record names its killer, and the coordinator's ring
// holds one `survival.died` entry for it. The killer is the monster the server names in its
// `defeated_by_a_monster` response before the death, else the last monster whose entity this client
// held when it hit the character in this life (death.ts `message`), read from the probe. The death
// plant's Rime Djinn lives for one server turn (hunt-interruption-helpers.ts `killNativeCharacter`),
// so its hits name no monster, and the server's response names it.
export async function deathRecordHolds(live:LiveGame,name:string,since:number,label:string){
  const record=await live.clients[name]!.run('globalThis.__partyLastDeathInfo') as any;
  const hits=await live.clients[name]!.run('globalThis.__e2eSurvivalHits??null') as {at:number;hid:string|null;source:string|null;name:string|null}[]|null;
  expect(hits,`SV24 (${label}): the hit probe ran on ${name}`).not.toBeNull();
  const killers=await live.clients[name]!.run('globalThis.__e2eSurvivalKillers??[]') as {at:number;monster:string;name:string}[];
  const deaths=await live.clients[name]!.run('globalThis.__e2eSurvivalDeaths??[]') as number[];
  const deathAt=Number(record?.at)||since,lifeFrom=deaths.filter(at=>at<since).at(-1)??0;
  const server=killers.filter(k=>k.at>=since&&k.at<=deathAt).at(-1),named=hits!.filter(h=>h.name&&h.at>lifeFrom&&h.at<=deathAt).at(-1);
  const killer=server?server.name:named?named.name:'unknown monster';
  expect.soft(String(record?.message),`SV24 (${label}): ${name}'s death names its killer (${JSON.stringify({server:killers.slice(-2),hits:hits!.slice(-4)})})`).toBe(`Killed by ${killer}`);
  expect.soft(!!record&&'eventTrip' in record,`SV24 (${label}): ${name}'s death carries the Hunt trip stamp`).toBe(true);
  const state=await live.state();
  const notices=Object.values(state.combatLogs??{}).flat().filter((e:any)=>e?.type==='survival'&&e.details?.name===name&&Number(e.at)>=since-1000);
  expect.soft(notices.length,`SV25 (${label}): one survival.died notice for ${name}'s death`).toBe(1);
  return {record,notices};
}

// The HP and MP potion rows on the solo ranger (the live finding of 2026-11-01: a ranger
// died with HP potions in its bags): in its own fight, planted to 40% HP it drinks `use_hp`, and
// planted to 15% MP `use_mp`, each within one potion cooldown. The ranger fights alone, so no heal
// lifts its HP first.
export async function rangerNeedsRows(live:LiveGame,info:TestInfo){
  const R=W,result:any={stocked:await stockPotions(live,R)};
  await live.clients[R]!.run(spendLog);
  const from=await clock(live,R),window=await potionWindow(live,R);
  await expect.poll(async()=>(await spendsSince(live,R,from)).replies.filter(r=>r.place==='attack'&&!r.failed).length,
    {timeout:60_000,message:'The ranger fights goo'}).toBeGreaterThanOrEqual(2);
  const limit=async()=>{const r=replyStep((await spendsSince(live,R,from)).replies);return window.cooldown+window.rtt+(Number.isFinite(r)?r:0);};
  for(const [key,vitals,skill] of [['sv1',{hp:0.4},'use_hp'],['sv3',{mp:0.15},'use_mp']] as const){
    const planted=await plantOwn(live,R,vitals),bound=await limit();
    await waitForGameplay(REGEN_COOLDOWN_MS+bound+500);
    const first=((await spendsSince(live,R,planted.seenAt)).spends as Spend[]).find(s=>potion(s)===skill),free=await familyFree(live,R,planted.seenAt,window.cooldown);
    // The potion family's sends around the plant, for the reading of a late potion.
    const around=((await spendsSince(live,R,planted.seenAt-5000)).spends as Spend[]).filter(s=>family(s)).map(s=>[s.at-planted.seenAt,family(s)]);
    result[key]={bound,freeAfterMs:free-planted.seenAt,pollLagMs:planted.polledAt-planted.seenAt,afterMs:first?first.at-free:null,planted:vitals,family:around};
    await plantVitals(live,R,{hp:1,mp:1});await waitForGameplay(2_500);
  }
  await info.attach('survival-ranger',{body:JSON.stringify(result,null,1),contentType:'application/json'});
  console.log('SURVIVAL-RANGER '+JSON.stringify(result));
  for(const key of ['sv1','sv3']){
    expect.soft(result[key].afterMs,`${key.toUpperCase()}: the ranger drinks within one potion cooldown`).not.toBeNull();
    if(result[key].afterMs!==null)expect.soft(result[key].afterMs,`${key.toUpperCase()}: within ${result[key].bound} ms`).toBeLessThanOrEqual(result[key].bound);
  }
}

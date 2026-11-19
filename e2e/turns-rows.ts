import {expect,plantVitals,serverView,waitForGameplay,writeDelivered,type LiveGame} from './live-fixtures';
import type {TestInfo} from '@playwright/test';
import {fighters,location,party} from './game/hunt-lifecycle';
import {oneCall} from './call-budget-rows';
import {tc11,replyStep,below,HEAL_FIRST_BELOW,skipStretch,SELECTION_MS,type SkipRecord} from './turns-tc11';
import {tc2} from './turns-tc2';
import {addonSwitches,registerTurnsChargeAddon,TURNS_CHARGE_ADDON} from './fixtures/turns-hooks-addon';
import {porcupineTargetCall} from './targeting-rows';
import {W,P,M} from './hunt-interruption-helpers';
import {HEALTHY_SHARE} from '../runtime/characters/survival/lines';
import {HEAL_FIRST_BELOW as HEAL_FIRST_BELOW_PERCENT} from '../runtime/characters/turns/saved-fields';

// The turns owner's rows of the default table: the priest's slot at the attack edge, and one potion in flight. Each
// checks its failure modes by number after the row's measures, so a row on a tree without the
// executor still measures. The modes later steps build are soft checks, so each row runs to its
// end. The steps windows and the bee field read the same spend log for their measures.
// The potion group: the server keeps one `player.last.potion` for all four (server.js:7807-7811,
// 7856, 12042-12048).
const POTION_SKILLS=['use_hp','use_mp','regen_hp','regen_mp'];
// A red run plants the break each named check exists to catch (E2E_TURNS_RED=tc1,tc5,...), so the
// check is shown failing; a gate run plants none.
export const red=(check:string)=>(process.env.E2E_TURNS_RED??'').split(',').includes(check);
const attach=(info:TestInfo,name:string,body:unknown)=>info.attach(name,{body:JSON.stringify(body,null,1),contentType:'application/json'});

// The spend log, on the game window so a CODE reload keeps it: every `attack`, `heal`, `skill`,
// potion `equip` and regeneration `use` the character sends, with its MP, its target and each
// member's HP and distance as it sees them at the send; every `game_response` reply; the console's
// "Recovery failed" and "Potion failed" lines; and a 100 ms sample of the target and the members'
// HP. `resetOnAttack` resets targeting right after the next `attack` send, and `notes`
// records each `noteAttack` target. A skill's send also keeps the reserve and cost the turns owner
// answers for it (skills.ready), and diags keeps each new turns diagnostic. Each send
// keeps its family's `next_skill` edge as the game client held it at the send, and each
// sample whether the target is in range.
// The log installs once per CODE run. A CODE reload stops the old run's sampler and listeners
// while the log stays on the game window, so the next install replaces a log an older run made.
// Its own shots and hits come from the turns owner's notices, so a lost socket listener shows as
// the tracker's loss against the server's count, never as the log's.
export const spendLog=`(()=>{const g=parent,code=globalThis;if(g.__e2eTurns&&g.__e2eTurns.code===code)return true;
  const log=g.__e2eTurns={spends:[],replies:[],lines:[],samples:[],notes:[],resets:[],diags:[],ring:[],ringSeq:0,status:[],statusSeq:0},names=${JSON.stringify([W,P])};
  Object.defineProperty(log,'code',{value:code});
  const socket=g.socket,emit=socket.emit;
  const on=(event,handler)=>socket.on(event,handler);
  const keep=(list,entry)=>{list.push(entry);if(list.length>8000)list.splice(0,1000);};
  // Each status reply as it arrives, numbered, with the grouped lock and the farming and combat
  // modes it carries: the wrapper's own done handler runs before shared.js's, so a send's
  // \`reply\` names the newest reply the client has received.
  const jq=code.$;if(jq&&jq.ajax&&!jq.ajax.__e2eStatus){const ajax=jq.ajax,wrapped=function(o){const x=ajax.apply(this,arguments);
    if(o&&/\\/status$/.test(String(o.url))&&x&&x.done)x.done(v=>{log.statusSeq++;keep(log.status,{seq:log.statusSeq,at:Date.now(),
      lock:v&&v.groupedCombat&&v.groupedCombat.target?String(v.groupedCombat.target.id):null,mode:v?v.partyFarmingMode??null:null,combatMode:v?v.combatMode??null:null});});
    return x;};wrapped.__e2eStatus=true;jq.ajax=wrapped;}
  const party=()=>{const me=g.character,out={};for(const n of names){const e=n===me.name?me:g.entities[n];if(!e)continue;
    out[n]={hp:e.hp,max:e.max_hp,dist:n===me.name?0:Math.hypot((e.real_x??e.x)-me.real_x,(e.real_y??e.y)-me.real_y)};}return out;};
  const target=()=>{const t=g.ctarget;return !!(t&&!t.dead&&t.type==='monster');};
  socket.emit=function(method,data,...rest){
    if(['attack','heal','skill','equip','use'].includes(method)){const me=g.character;
      const key=method==='attack'?'attack':method==='heal'||method==='skill'?((code.__partyTurns&&code.__partyTurns.readyKey)?code.__partyTurns.readyKey(method==='heal'?'heal':data&&data.name):null):'use_hp';
      keep(log.spends,{at:Date.now(),method,name:data&&data.name,id:data&&data.id!=null?String(data.id):undefined,edge:key&&g.next_skill?Number(g.next_skill[key])||0:0,
        item:method==='equip'?((me.items[data&&data.num]||{}).name):data&&data.item,mp:me.mp,maxMp:me.max_mp,range:me.range,target:target(),party:party(),
        // A Town channel at the send and the priest's own heal amount.
        town:!!(me.c&&me.c.town),...(method==='heal'?{healOut:Number(me.heal)||0}:{}),
        // A potion family send's view of the fight that the regeneration hold reads:
        // a monster in view on a party member, a party member's target alive in view, the character
        // at its farm, and its own selection with its rejection.
        ...(method==='use'||method==='equip'?{fight:(()=>{try{const r=code.sharedRoutine,s=code.partyCombatState||{};
          return {attacked:Object.values(g.entities||{}).some(e=>e&&e.type==='monster'&&e.visible&&!e.dead&&r.targeting.isAttackingPartyMember(e)),
            partyTarget:!!(r.targeting.getNearestPartyTarget&&r.targeting.getNearestPartyTarget()),farm:!!r.survival.atFarm(),selected:s.selectedTarget??null,rejection:s.targetRejection??null,view:{me:[Math.round(me.real_x),Math.round(me.real_y),me.map],members:(r.survival.shared.roster()||[]).filter(n=>n!==me.name).map(n=>{const e=code.get_player(n);return [n,e?Math.round(e.x):null,e?Math.round(e.y):null,e?!!e.rip:null];})}};}catch(e){return String(e);}})()}:{}),
        ...(method==='skill'?(()=>{try{const r=code.__partyTurns&&code.__partyTurns.ready(data.name);return r?{reserve:r.reserve,cost:r.cost}:{};}catch(e){return {};}})():{}),
        // The character's own walk and the hold's last answer at a skill's send.
        // isOccupied has side effects, so the log reads the answer the farm walk row's wrapper
        // kept from the character's own last call, never calling it.
        ...(method==='skill'?(()=>{try{const h=code.__e2eHeld;return {walk:(code.__partyMovement&&code.__partyMovement.live&&code.__partyMovement.live()||{}).kind||null,
          held:h?h.held:null,heldAt:h?h.at:null};}catch(e){return {};}})():{}),
        // What the heal choice asks at an attack's send: the HP share of the member it would heal, or
        // null, from the survival owner's choice.
        // The grouped lock target at an attack's send and whether the attacked monster targets a
        // party member.
        ...(method==='attack'?{lock:(()=>{const q=code.__partyGroupedCombat;return q&&q.target?String(q.target.id):null;})(),
          threat:(()=>{const e=data&&g.entities[data.id];return !!(e&&names.includes(e.target));})()}:{}),
        // The attack gate's inputs at the send: whether the grouped
        // rule applies (groupedFarming()), the farming mode the client holds, the passing target
        // the gate exempts, and the newest status reply the client has received.
        ...(method==='attack'?(()=>{try{const r=code.sharedRoutine,p=r.targeting.passingTarget&&r.targeting.passingTarget();
          return {grouped:!!code.partyHunting.farm.grouped(),mode:code.partyHunting.farm.mode(),passing:p?String(p.id):null,reply:log.statusSeq};}catch(e){return {grouped:String(e)};}})():{}),
        ...(method==='attack'?{healAsk:(()=>{try{const s=code.__partySurvival,line=Number(code.partyTurns.healFirstBelow.read())||${HEAL_FIRST_BELOW_PERCENT};
          const c=s.healChoice({healFirstBelow:line,regularOnly:false});return c?c.ratio:null;}catch(e){return null;}})()}:{})});}
    const out=emit.apply(this,[method,data,...rest]);
    if(method==='attack'&&log.resetOnAttack){log.resetOnAttack=false;const old=data&&String(data.id);
      queueMicrotask(()=>{code.partyRoleRunner.resetTargeting();log.resets.push({at:Date.now(),old});});}
    return out;};
  on('game_response',d=>{if(!d||typeof d!=='object')return;
    keep(log.replies,{at:Date.now(),place:d.place??null,response:d.response??null,failed:!!d.failed,reason:d.reason??null,ms:d.ms??null,id:d.id!=null?String(d.id):undefined,target:d.target!=null?String(d.target):undefined});});
  // The character's own projectiles: each \`skills.shot\` it fires, with its pid and
  // target, and each \`skills.landed\` it lands, with whether it killed or missed, heard through the
  // log's own registration on the character's registry. It writes to the log of the moment, so a
  // log a row deletes and installs again keeps hearing them.
  log.actions=[];log.hits=[];
  const hooks=code.__partyHooks,own=n=>n&&n.attacker===g.character.name,id=v=>v!=null?String(v):null;
  if(hooks&&!hooks.registrations().some(r=>r.name==='core:e2e-spend-log'))hooks.register({name:'core:e2e-spend-log',folder:'core',author:'e2e',
    summary:"The spend log's own shots and hits.",hooks:{
      'skills.shot'(n){if(own(n)&&g.__e2eTurns)keep(g.__e2eTurns.actions,{at:Date.now(),pid:id(n.projectile),target:id(n.target)});},
      'skills.landed'(n){if(own(n)&&g.__e2eTurns)keep(g.__e2eTurns.hits,{at:Date.now(),pid:id(n.projectile),id:id(n.target),kill:!!n.kill,miss:!!n.miss});}}});
  // A call on a monster that died answers with the monster's \`disappear\` or \`death\` naming the
  // call (js/game.js \`reject_deferred\`), not a game_response.
  for(const event of ['disappear','death'])on(event,d=>{if(d&&d.place)keep(log.replies,{at:Date.now(),place:d.place,response:'not_found',failed:true,reason:d.reason||'not_found',ms:null,id:d.id!=null?String(d.id):undefined});});
  // Each packet that carries a member's HP to this client, for a failed plant's reading: the
  // character's own \`player\` packets, the other members' entries in \`entities\` (js/game.js
  // decode_entities rebuilds a delta into the full entry before this handler runs) and a member's
  // \`disappear\`. So a plant the client never shows names whether the packet came.
  log.packets=[];
  on('player',d=>{if(d&&typeof d.hp==='number')keep(log.packets,{at:Date.now(),event:'player',name:g.character&&g.character.name,hp:d.hp});});
  on('entities',d=>{if(!d||typeof d!=='object')return;for(const e of d.players||[])if(e&&names.includes(e.id))keep(log.packets,{at:Date.now(),event:'entities',type:d.type,name:e.id,hp:e.hp});});
  on('disappear',d=>{if(d&&names.includes(d.id))keep(log.packets,{at:Date.now(),event:'disappear',name:d.id,reason:d.reason??(d.outside?'outside':null)});});
  const add=g.add_log;g.add_log=function(message,...rest){if(/Recovery failed|Potion failed/.test(String(message)))keep(log.lines,{at:Date.now(),line:String(message)});return add.apply(this,[message,...rest]);};
  const note=code.sharedRoutine&&code.sharedRoutine.targeting.noteAttack;if(note)code.sharedRoutine.targeting.noteAttack=function(t,...rest){keep(log.notes,{at:Date.now(),id:t&&String(t.id)});return note.apply(this,[t,...rest]);};
  // Every write of the diagnostic, through a setter on the combat state the runner keeps; the
  // sampler installs it again when the runner replaces that state.
  let watched=null;const watch=()=>{const s=code.partyCombatState;if(!s||s===watched)return;watched=s;let value=s.skill;
    Object.defineProperty(s,'skill',{configurable:true,enumerable:true,get(){return value;},set(d){value=d;
      if(d)keep(log.diags,{at:Date.now(),skill:d.skill,category:d.category,status:d.status,reason:d.reason,by:d.by??null,rank:d.rank??null,reserve:d.reserve,mp:code.character&&code.character.mp});}});};
  // The executor's ring holds 64 records, so the sampler copies each new one as it comes.
  const copyRing=()=>{const rec=code.__partyTurns&&code.__partyTurns.records?code.__partyTurns.records():[];
    if(rec.length&&rec[rec.length-1].seq<log.ringSeq)log.ringSeq=0;
    for(const e of rec)if(e.seq>log.ringSeq){keep(log.ring,{...e});log.ringSeq=e.seq;}};
  watch();setInterval(()=>{watch();copyRing();const t=g.ctarget;const me=g.character,f=code.__partyTurns&&code.__partyTurns.forecast?code.__partyTurns.forecast():null;
    const tid=target()?String(t.id):null,skip=tid&&code.__partyTargeting&&code.__partyTargeting.skip&&code.__partyTargeting.skip.held?code.__partyTargeting.skip.held(tid):null;
    keep(log.samples,{at:Date.now(),cooldown:1000/(Number(me.frequency)||1),target:target(),inRange:!!(target()&&typeof is_in_range==='function'&&is_in_range(t)),mpAttacks:f==null||me.mp-f>=(me.mp_cost||0),party:party(),
      tid,skip:skip?{target:skip.target,damage:skip.damage,hp:skip.hp,last:skip.last}:null,lock:(()=>{const q=code.__partyGroupedCombat;return q&&q.target?String(q.target.id):null;})()});},100);
  return true;})()`;
type Spend={lock?:string|null;threat?:boolean;grouped?:boolean|string|null;mode?:string|null;passing?:string|null;reply?:number;at:number;method:string;name?:string;id?:string;edge?:number;item?:string;mp:number;maxMp:number;range:number;target:boolean;party:Record<string,{hp:number;max:number;dist:number}>;reserve?:number;cost?:number;healAsk?:number|null;town?:boolean;healOut?:number;fight?:unknown};
type Diag={at:number;skill:string;category:string;status:string;by:string|null;rank:string|null;reserve:number};
type Reply={at:number;place:string|null;response:string|null;failed:boolean;reason:string|null;ms:number|null;id?:string;target?:string};
type Packet={at:number;event:string;type?:string;name:string;hp?:number;reason?:string|null};
type Shot={at:number;pid:string|null;target:string|null};type Landed={at:number;pid:string|null;id:string|null;kill:boolean;miss:boolean};
type Log={actions:Shot[];hits:Landed[];ring:{at:number;kind:string;family:string;waitedMs?:number}[];spends:Spend[];replies:Reply[];lines:{at:number;line:string}[];samples:{at:number;cooldown?:number;target:boolean;inRange?:boolean;mpAttacks?:boolean;party:Spend['party'];tid?:string|null;skip?:SkipRecord|null}[];notes:{at:number;id:string}[];resets:{at:number;old:string}[];diags:Diag[];packets:Packet[]};
const readLog=(live:LiveGame,name:string,from=0)=>live.clients[name]!.run(`(()=>{const l=parent.__e2eTurns,f=${from},i=x=>x.at>=f;
  return {actions:(l.actions||[]).filter(i),hits:(l.hits||[]).filter(i),ring:(l.ring||[]).filter(i),spends:l.spends.filter(i),replies:l.replies.filter(i),lines:l.lines.filter(i),samples:l.samples.filter(i),notes:l.notes.filter(i),resets:l.resets.filter(i),diags:(l.diags||[]).filter(i),packets:(l.packets||[]).filter(i)};})()`) as Promise<Log>;
// A failed plant's reading of one member on one client: the packets that carried the member's HP
// from `from` on, and the server's side of that view (live-fixtures.ts `serverView`).
export async function plantView(live:LiveGame,observer:string,member:string,from:number){
  const l=await readLog(live,observer,from);
  return {packets:l.packets.filter(p=>p.name===member).map(p=>[p.at-from,p.event,p.type??p.reason??null,p.hp??null]),server:await serverView(live,observer,member)};
}
// The survival owner's answers on each pass, for a failed row's reading:
// each call of the potion, regeneration and heal needs with the pass's kind and holds, the escape
// stage, three of the fight facts, the pass's target and the answer.
// It wraps the installed module's needs, so a reinstall drops it; `installs` counts its installs.
export const needsLog=`(()=>{const code=globalThis,g=parent,s=code.__partySurvival;if(!s)return false;if(s.needs.__e2eLogged)return true;
  const log=g.__e2eNeeds=g.__e2eNeeds||{calls:[],installs:0};log.installs++;const keep=e=>{log.calls.push(e);if(log.calls.length>8000)log.calls.splice(0,1000);};
  const fight=()=>{try{const r=code.sharedRoutine;return [Object.values(g.entities||{}).some(e=>e&&e.type==='monster'&&e.visible&&!e.dead&&r.targeting.isAttackingPartyMember(e))?1:0,
    r.targeting.getNearestPartyTarget&&r.targeting.getNearestPartyTarget()?1:0,r.survival.atFarm()?1:0];}catch(e){return String(e);}};
  for(const name of ['potion','regeneration','heal']){const f=s.needs[name];s.needs[name]=v=>{const out=f(v),list=out?(Array.isArray(out)?out:[out]):[];
    keep([Date.now(),name,v.kind,v.chain?1:0,v.roleLoop?1:0,v.pulse?1:0,code.__partyHooks.survival.escaping(character.name)?.stage??null,
      fight(),v.target&&v.target.target?(v.target.passing?'passing':String(v.target.target.id)):null,list.map(a=>a.skill+'@'+a.rank+(a.targets&&a.targets[0]?':'+(a.targets[0].name||a.targets[0].id):'')).join(',')]);return out;};}
  s.needs.__e2eLogged=true;return true;})()`;
export const needsSince=(live:LiveGame,name:string,from:number)=>live.clients[name]!.run(`(()=>{const l=parent.__e2eNeeds;return l?{installs:l.installs,calls:l.calls.filter(x=>x[0]>=${from}).map(x=>[x[0]-${from},...x.slice(1)])}:null;})()`);
export const clock=(live:LiveGame,name:string)=>live.clients[name]!.run('Date.now()') as Promise<number>;
// The spend log from a time on, for rows outside this file (UP-2).
export const spendsSince=(live:LiveGame,name:string,from:number)=>readLog(live,name,from);
// The game's own numbers on the character: the attack cooldown from its frequency
// (functions.js:5486) and one round trip, the median of the client's own pings.
export const timing=(live:LiveGame,name:string)=>live.clients[name]!.run(`(()=>{const p=(parent.pings||[]).filter(Number.isFinite).sort((a,b)=>a-b);
  return {cooldown:1000/(Number(character.frequency)||1),rtt:p.length?p[Math.floor(p.length/2)]:0,minRtt:p.length?p[0]:0,mpCost:character.mp_cost,range:character.range};})()`) as Promise<{cooldown:number;rtt:number;minRtt:number;mpCost:number;range:number}>;
const inRange=(s:Spend,name:string)=>{const m=s.party[name];return !!m&&m.dist<=s.range;};
const accepted=(r:Reply,place:string)=>r.place===place&&!r.failed;

// 7.3's measures of one window, from the spend log: accepted attacks per second, `attack` calls
// per accepted attack, `cooldown` rejections per minute, casts per minute by skill, and the page's
// script time per minute (the support tick has no meter of its own before the executor's).
export async function spendWindow(live:LiveGame,name:string,from:number,to:number,script:{from:number;to:number}){
  const rtt=await live.clients[name]!.run('Math.min(...(parent.pings||[]).filter(Number.isFinite))') as number;
  const log=await readLog(live,name,from),inside=<T extends {at:number}>(x:T)=>x.at<to,minutes=(to-from)/60_000;
  const spends=log.spends.filter(inside),replies=log.replies.filter(inside);
  const attacks=spends.filter(s=>s.method==='attack').length,acceptedAttacks=replies.filter(r=>accepted(r,'attack')).length;
  const casts:Record<string,number>={};
  for(const s of spends){const key=s.method==='skill'?String(s.name):s.method==='heal'?'heal':null;if(key)casts[key]=(casts[key]??0)+1;}
  // A resend of the attack family that leaves
  // before the server's edge, its `cooldown` reply's `ms` less one round trip after the reply, and
  // attack calls with no reply beyond the one in flight at the window's end.
  const attackSends=spends.filter(s=>s.method==='attack'),attackReplies=replies.filter(r=>r.place==='attack');
  const earlyResends=attackReplies.filter(r=>r.response==='cooldown'&&Number.isFinite(r.ms)).filter(r=>{
    const next=attackSends.find(s=>s.at>r.at);return !!next&&next.at<r.at+Number(r.ms)-rtt;}).length;
  const t11=tc11(log,from,to,replyStep(replies),(await timing(live,name)).cooldown,rtt,name===P);
  await tc11View(live,name,'window',log,from,t11.waitsWithoutNotNow);
  return {windowMs:to-from,attacks,acceptedAttacks,cooldownReplies:attackReplies.filter(r=>r.response==='cooldown').length,
    unanswered:attacks-attackReplies.length,earlyResends,acceptedPerSecond:Math.round(acceptedAttacks/((to-from)/1000)*1000)/1000,
    // The attack rate (decided 2026-11-09): the time the overkill skip held a ready
    // family leaves the window, so a skipped edge is no fault and every other empty edge still is.
    tc33PerSecond:Math.round(acceptedAttacks/((to-from-t11.skipHeldMs)/1000)*1000)/1000,skipHeldMs:Math.round(t11.skipHeldMs),

    callsPerAccepted:acceptedAttacks?Math.round(attacks/acceptedAttacks*1000)/1000:null,
    cooldownPerMinute:Math.round(replies.filter(r=>r.place==='attack'&&r.response==='cooldown').length/minutes*10)/10,
    castsPerMinute:Object.fromEntries(Object.entries(casts).map(([k,n])=>[k,Math.round(n/minutes*10)/10])),
    scriptMsPerMinute:Math.round((script.to-script.from)*1000/minutes),
    // Potions drunk per hour per fighter on the steps windows (the potion line defaults raise it).
    potionsPerHour:Math.round(spends.filter(s=>s.method==='equip'&&/^[hm]pot/.test(String(s.item))).length/(minutes/60)*10)/10,tc11:t11};
}
// The four casts brought under the class reserve. Each one
// a fighter's setup reaches goes at least once, none leaves MP below the class reserve the turns
// owner answers at its send, and the priest's Curse goes through the skill engine with category
// damage, so its diagnostic names it.
export const A36_SKILLS=['stomp','dash','energize','curse'];
export async function a36Casts(live:LiveGame,name:string,from:number){
  const l=await readLog(live,name,from),casts=l.spends.filter(s=>s.method==='skill'&&A36_SKILLS.includes(String(s.name)));
  return {casts:casts.reduce((sum:Record<string,number>,s)=>{sum[s.name!]=(sum[s.name!]??0)+1;return sum;},{}),
    belowReserve:casts.filter(s=>s.reserve===undefined||s.mp-(s.cost??0)<s.reserve).map(s=>({at:s.at-from,skill:s.name,mp:s.mp,cost:s.cost,reserve:s.reserve})),
    curseDiags:l.diags.filter(d=>d.skill==='curse').map(d=>({category:d.category,status:d.status,reason:(d as any).reason,mp:(d as any).mp,by:d.by}))};
}
// The turns executor's own meter: its passes, their time and
// its sends over a window.
export const TURNS_METER='globalThis.__partyTurns?.meter?.()??null';
type Meter={passes:number;totalMs:number;maxMs:number;sends:number}|null;
export const meterDelta=(from:Meter,to:Meter)=>from&&to?{passes:to.passes-from.passes,ms:Math.round((to.totalMs-from.totalMs)*10)/10,
  msPerPass:to.passes>from.passes?Math.round((to.totalMs-from.totalMs)/(to.passes-from.passes)*1000)/1000:null,sends:to.sends-from.sends,maxMs:to.maxMs}:null;
// The page's script time (Chrome's `ScriptDuration`, seconds), read through the DevTools protocol.
// The metric counts from `Performance.enable`, so each page keeps one session.
const sessions=new WeakMap<object,Promise<any>>();
export async function scriptSeconds(live:LiveGame,name:string){
  const page=live.clients[name]!.page;
  if(!sessions.has(page))sessions.set(page,page.context().newCDPSession(page).then(async s=>{await s.send('Performance.enable');return s;}));
  const {metrics}=await (await sessions.get(page)!).send('Performance.getMetrics') as {metrics:{name:string;value:number}[]};
  return metrics.find(m=>m.name==='ScriptDuration')?.value??0;
}

export async function fightingAtGoo(live:LiveGame){
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'merchant idle':false,'stand maintenance':false}});
  await party(live);
  for(const n of fighters){await live.clients[n]!.run(spendLog);await live.clients[n]!.run(needsLog);}
  const farm=await location(live,'goo');
  await live.post('/navigate-to-monster',{monsterId:'goo',location:farm});
  await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{},monsterSearchRadius:400});
  const from=await clock(live,P);
  await expect.poll(async()=>(await readLog(live,P,from)).replies.filter(r=>accepted(r,'attack')).length,{timeout:180_000,message:'The priest fights goo beside the warrior'}).toBeGreaterThanOrEqual(3);
}
// The plant on one member, held until the priest's own client shows it: its view of the member's
// HP at or below the plant, a packet that carried it there (the spend log's `packets`), or a heal it
// landed after the plant. A heal or the member's own gain can follow the packet before the poll,
// which runs between test-side reads, reads the view.
// The plant waits until the priest's client holds the member in its heal range. The independent
// approach lets each fighter walk to its own target with no healer regroup (docs/testing-independent-
// approach-coordinator.md: "Only cohort healer visibility/distance regroup and one-mover control are
// removed for that mode"), so the warrior can farm outside the priest's view: a3 planted it 703 away
// on y against a vision of 500, and the priest never saw the plant. A heal can only reach a member
// in view and in range, the case each plant checks.
async function plantSeen(live:LiveGame,name:string,vitals:{hp?:number;mp?:number;mpAt?:number}){
  if(name!==P)await expect.poll(()=>live.clients[P]!.run(`(()=>{const e=parent.entities[${JSON.stringify(name)}];
    return !!e&&!e.rip&&Math.hypot(e.real_x-character.real_x,e.real_y-character.real_y)<=character.range;})()`),
    {timeout:60_000,intervals:[50],message:`${name} in the priest's view and heal range before the plant`}).toBe(true);
  const sentAt=await clock(live,P),planted=await plantVitals(live,name,vitals);
  const want=vitals.hp!==undefined?planted.hp:null;
  await expect.poll(()=>live.clients[P]!.run(`(()=>{const e=${JSON.stringify(name)}===character.name?character:parent.entities[${JSON.stringify(name)}];
    const healed=parent.__e2eTurns.replies.some(r=>r.at>=${sentAt}&&!r.failed&&(r.place==='heal'||r.place==='partyheal'));
    const packet=parent.__e2eTurns.packets.some(p=>p.at>=${sentAt}&&p.name===${JSON.stringify(name)}&&typeof p.hp==='number'&&p.hp<=${want}+1);
    return !!e&&(${want}===null||e.hp<=${want}+1||packet||healed);})()`),
    {timeout:10_000,intervals:[50],message:`The priest sees the plant on ${name}`}).toBe(true).catch(async error=>{
      // What the priest saw, for the failure's reading.
      console.log('TURNS-PLANT '+JSON.stringify({name,want,planted,view:await live.clients[P]!.run(`(()=>{const e=${JSON.stringify(name)}===character.name?character:parent.entities[${JSON.stringify(name)}];
        return {seen:!!e,hp:e&&e.hp,max:e&&e.max_hp,rip:character.rip,map:character.map,dist:e?Math.hypot(e.real_x-character.real_x,e.real_y-character.real_y):null,
          replies:parent.__e2eTurns.replies.filter(r=>r.at>=${sentAt}).map(r=>[r.at-${sentAt},r.place,r.response])};})()`),
        // Where each fighter stands by its own client, with its target, and the priest's samples of
        // the member from 20 s before the plant.
        at:Object.fromEntries(await Promise.all(fighters.map(async n=>[n,await live.clients[n]!.run(`(()=>({map:character.map,x:Math.round(character.real_x),y:Math.round(character.real_y),
          target:parent.ctarget?String(parent.ctarget.id)+':'+parent.ctarget.mtype:null,moving:!!character.moving}))()`)]))),
        samples:(await readLog(live,P,sentAt-20_000)).samples.filter((_,i)=>i%5===0).map(s=>[s.at-sentAt,s.target?1:0,s.party[name]?Math.round(s.party[name]!.dist):null]),
        // The member's own client from 1 s before the plant: its HP samples, sends and replies, so a
        // rise before the priest read the plant names its source.
        own:await (async()=>{const o=await readLog(live,name,sentAt-1000);return {hp:o.samples.map(s=>[s.at-sentAt,s.party[name]?.hp??null]),
          spends:o.spends.map(s=>[s.at-sentAt,s.method,s.name??s.item??s.id]),replies:o.replies.map(r=>[r.at-sentAt,r.place,r.response])};})(),
        // The packets that carried the member's HP to the priest and to the member itself, with the
        // server's side of each view.
        priestView:await plantView(live,P,name,sentAt-1000),ownView:await plantView(live,name,name,sentAt-1000)}).slice(0,12000));throw error;});
  return {...planted,seenAt:sentAt};
}

// A TC11 wait's reading: around each wait, from 1.5 s before its edge to
// 500 ms after the send that ended it, the character's sends, replies, executor records, samples
// (target, in range, MP for the attack, each member's HP share) and the needs' answers.
async function tc11View(live:LiveGame,name:string,row:string,log:Log,from:number,waits:{at:number;gap:number}[]){
  if(!waits.length)return;
  const needs=((await needsSince(live,name,from)) as any)?.calls??[];
  for(const w of waits){const a=from+w.at-1500,b=from+w.at+w.gap+500,inside=(x:{at:number})=>x.at>=a&&x.at<=b,rel=(at:number)=>at-from-w.at;
    console.log('TURNS-TC11-VIEW '+JSON.stringify({row,name,wait:w,
      spends:log.spends.filter(inside).map(s=>[rel(s.at),s.method,s.name??s.id??s.item,s.edge?rel(s.edge):null]),
      replies:log.replies.filter(inside).map(r=>[rel(r.at),r.place,r.response,r.ms]),ring:log.ring.filter(inside).map((r:any)=>[rel(r.at),r.kind,r.family,r.skill,r.reason??r.waitedMs??null]),
      // Each sample's target id, the skip's record on it (target, damage, HP, ms since its last
      // pass) and the grouped lock, for a wait the skip did not cover (13.4a).
      samples:log.samples.filter(inside).map(s=>[rel(s.at),s.target?1:0,s.inRange?1:0,s.mpAttacks===false?0:1,...Object.values(s.party).map(m=>Math.round(m.hp/m.max*1000)/10),
        s.tid??null,s.skip?[s.skip.target,s.skip.damage,s.skip.hp,Math.round(s.at-s.skip.last)]:null,(s as {lock?:string|null}).lock??null]),
      needs:needs.filter((c:any[])=>c[0]+from>=a&&c[0]+from<=b).map((c:any[])=>[rel(c[0]+from),...c.slice(1)])}).slice(0,12000));}
}

// TG16: the long flights of a window, each of the character's own
// shots whose `hit` packet landed more than one pass after its `action` packet, the moment the
// reply frees the family, and killed its target. The skip holds such a target until the hit lands,
// so no attack of the character goes to it between the two packets. The check fires only where
// the window holds long flights, so the row also asserts that it does.
export function longFlights(log:Pick<Log,'actions'|'hits'|'spends'>,from:number,to:number,pass:number){
  const flights=log.actions.filter(a=>a.at>=from&&a.at<to&&a.pid&&a.target).flatMap(a=>{
    const hit=log.hits.find(h=>h.pid===a.pid&&h.at>=a.at);
    return hit&&hit.kill&&hit.at-a.at>pass?[{target:a.target!,shot:a.at,landed:hit.at}]:[];});
  const second=flights.flatMap(f=>log.spends.filter(s=>s.method==='attack'&&s.id===f.target&&s.at>f.shot&&s.at<f.landed).map(s=>({target:f.target,at:s.at-from,shot:f.shot-from,landed:f.landed-from})));
  return {flights:flights.length,second};
}
// TG18: in a grouped fight the priest's attacks go to the lock target, or its successor once
// the lock moves to it. A goo that targets a party member gets no exception: shared.js
// `groupedAttackAllowed` refuses every target but the lock once `groupedFarming()` holds. Each
// entry keeps the gate's inputs at the send.
export const offLock=(spends:Spend[],from:number,to:number,zero=from)=>spends.filter(s=>s.method==='attack'&&s.at>=from&&s.at<to&&s.lock&&s.id!==s.lock)
  .map(s=>({at:s.at-zero,id:s.id,lock:s.lock,threat:!!s.threat,grouped:s.grouped??null,mode:s.mode??null,passing:s.passing??null,reply:s.reply??null}));

// Row T1: the priest's slot at the edge (TC1 to TC3, TC5, TC18, TC21, TC32, TC38).
export async function turnsSlotRow(live:LiveGame,info:TestInfo){
  const result:any={};
  await fightingAtGoo(live);
  const t=result.timing=await timing(live,P),margin=t.cooldown+t.rtt;
  // TC1, TC2: the warrior planted to 70% five times over 60 s.
  // TC1's red plant: the priest reads "Heal first below" as 1%, so its heal asks below the attack.
  if(red('tc1'))await live.clients[P]!.run('(globalThis.__e2eLine=partyTurns.healFirstBelow.read(),partyTurns.healFirstBelow.reply({healFirstBelow:{[character.name]:1}}),true)');
  const from=await clock(live,P),plants:any[]=[];
  // The last plant
  // leaves the warrior below "Heal first below" but missing less than the priest's own heal
  // output, halfway between the two lines, where the warrior's maximum HP allows it; otherwise it
  // stays at 70%, recorded.
  const sv8=result.sv8Plant=await live.clients[P]!.run(`(()=>{const w=parent.entities['${W}'];if(!w)return null;const heal=Number(character.heal)||0,max=w.max_hp;
    const least=1-heal/max;return {heal,max,ratio:least<${HEAL_FIRST_BELOW}?Math.round((least+${HEAL_FIRST_BELOW})/2*1000)/1000:null};})()`);
  // SV7's reading of a failed plant: every pass's requests of the attack family on the priest, with
  // the pass kind, so an edge that sends an attack with no heal request shows which pass asked what.
  await live.clients[P]!.run(`(()=>{const h=globalThis.__partyHooks,f=h.skillRequests.bind(h),log=globalThis.__e2ePasses=[];
    h.skillRequests=v=>{const out=f(v);const fam=out.filter(x=>['attack','heal','partyheal'].includes(x.answer.skill)).map(x=>x.registration+'/'+x.requester.name+':'+x.answer.skill+'@'+x.answer.rank);
      log.push([Date.now(),v.kind,v.chain,v.roleLoop,fam.join(',')]);if(log.length>4000)log.splice(0,1000);return out;};return true;})()`);
  // SV7: the coordinator's heartbeat HP of the warrior when the priest's client first sees each plant.
  const heartbeat:any[]=result.sv7Heartbeat=[];
  // TG21's live half: each goo the party kills in the window
  // reaches the priest's queue client as one `death`. The wrap logs each queue death; the red
  // plant adds b9b5c91e's second report of a `death` packet.
  await live.clients[P]!.run(`(()=>{const q=globalThis.partyQueueClient,log=globalThis.__e2eQueueDeaths=[];if(!q||!q.death)return false;const d=q.death;
    q.death=function(id,...rest){log.push({at:Date.now(),id:String(id)});return d.call(this,id,...rest);};
    if(${red('tg21')})parent.socket.on('death',x=>{if(x&&x.id&&x.id!==character.name)globalThis.partyQueueClient.death(x.id);});return true;})()`);
  for(let i=0;i<5;i++){
    plants.push(await plantSeen(live,W,{hp:i===4&&sv8?.ratio?sv8.ratio:0.7}));
    {const c=(await live.state()).characters?.[W];heartbeat.push(c?{hp:c.hp,max:c.max_hp??null}:null);}
    await waitForGameplay(12_000);
    // TC11's red plants, once the plant's heal is done: a raw attack the moment an attack is
    // accepted (a send before its edge); then, at the family's next accepted attack or heal, the
    // client's attack edge held 2.5 s past the server's (a ready family that waits), which the
    // game's own later write does not move.
    // TG16's red plant: the priest's skip passes nothing over for the first two plants.
    if(red('tg16')&&i===0)await live.clients[P]!.run('(()=>{const k=globalThis.__partyTargeting.skip;globalThis.__e2eCovers=k.covers;k.covers=()=>false;return true;})()');
    if(red('tg16')&&i===2)await live.clients[P]!.run('(globalThis.__partyTargeting.skip.covers=globalThis.__e2eCovers,true)');
    if(red('tc11')&&i===1)await live.clients[P]!.run(`(()=>{const s=parent.socket,on=d=>{if(d&&d.place==='attack'&&!d.failed){s.off('game_response',on);attack(parent.ctarget);}};s.on('game_response',on);return true;})()`);
    if(red('tc11')&&i===3)await live.clients[P]!.run(`(()=>{const s=parent.socket,on=d=>{if(d&&(d.place==='attack'||d.place==='heal')&&!d.failed){s.off('game_response',on);
      const ns=parent.next_skill,until=new Date(Date.now()+2500);Object.defineProperty(ns,'attack',{configurable:true,enumerable:true,get:()=>until,set:()=>{}});
      globalThis.__e2eHeldEdge={at:Date.now(),place:d.place,reads:[]};const read=()=>globalThis.__e2eHeldEdge.reads.push([Date.now(),Number(parent.next_skill.attack),__partyTurns.ready('attack').ready]);
      setTimeout(read,500);setTimeout(read,1500);setTimeout(()=>{delete ns.attack;ns.attack=new Date(0);},2500);}};s.on('game_response',on);return true;})()`);
  }
  if(red('tc1'))await live.clients[P]!.run('(partyTurns.healFirstBelow.reply({healFirstBelow:{[character.name]:globalThis.__e2eLine}}),true)');
  const to=await clock(live,P),log=await readLog(live,P,from);
  const spends=log.spends.filter(s=>s.at<to),replies=log.replies.filter(r=>r.at<to);
  const healReplies=replies.filter(r=>accepted(r,'heal')),attackReplies=replies.filter(r=>accepted(r,'attack'));
  // The gameplay clock delivers replies on a step, read from the
  // row's own replies as the smallest gap between two of them, and an edge's slot ends one step later.
  const step=result.step=replyStep(replies);
  const slot=margin+(Number.isFinite(step)?step:0);
  // A plant reaches the priest with the server's next packet, one more step.
  const healSlot=slot+(Number.isFinite(step)?step:0);
  // TC1: an attack sent while the stand-in's heal choice asks to
  // heal a member below the line breaks owner the turns owner's rank rule. Attacks while the heartbeat has not
  // yet carried a hit to the choice (`attacksBelowInRange`) are owner the survival owner's case, kept as a reading.
  result.tc1={attacksWhileHealAsked:spends.filter(s=>s.method==='attack'&&s.healAsk!=null&&s.healAsk<HEAL_FIRST_BELOW).map(s=>({at:s.at-from,healAsk:s.healAsk})),
    attacksBelowInRange:spends.filter(s=>s.method==='attack'&&below(s,W,HEAL_FIRST_BELOW)&&inRange(s,W)).map(s=>({at:s.at-from,hp:s.party[W]})),
    attacks:spends.filter(s=>s.method==='attack').length,heals:spends.filter(s=>s.method==='heal').length,
    healed:plants.map(p=>{const h=healReplies.find(r=>r.at>=p.seenAt);return h?h.at-p.seenAt:null;}),slot:healSlot};
  // No `heal` on a member whose client HP at
  // the send is above the heal line, which is "Heal first below" or missing less
  // than the priest's own heal.
  result.sv9=spends.filter(s=>s.method==='heal'&&s.id&&s.party[s.id]).filter(s=>{const m=s.party[s.id!]!;
    return m.hp/m.max>=HEAL_FIRST_BELOW&&m.max-m.hp<(s.healOut??0);}).map(s=>({at:s.at-from,id:s.id,hp:s.party[s.id!],healOut:s.healOut}));
  // The priest's Curse waits while its own client reads a
  // member below survival's healthy share, whatever the heartbeat says.
  result.sv47=spends.filter(s=>s.method==='skill'&&s.name==='curse'&&Object.values(s.party).some(m=>m.hp/m.max<HEALTHY_SHARE))
    .map(s=>({at:s.at-from,party:s.party}));
  // SV7: after each plant, the first attack family send at which the
  // priest's own client reads the warrior below "Heal first below" is a heal, not an attack.
  {const passes=await live.clients[P]!.run('globalThis.__e2ePasses??[]') as any[];
    result.passes=plants.map(p=>passes.filter(x=>x[0]>=p.seenAt&&x[0]<p.seenAt+3000).map(x=>[x[0]-p.seenAt,...x.slice(1)]));}
  result.sv7=plants.map((p,i)=>{const next=i+1<plants.length?plants[i+1].seenAt:to;
    const first=spends.find(s=>s.at>=p.seenAt&&s.at<next&&(s.method==='attack'||s.method==='heal')&&below(s,W,HEAL_FIRST_BELOW));
    return first?{at:first.at-p.seenAt,method:first.method,heartbeat:heartbeat[i]}:{at:null,method:null,heartbeat:heartbeat[i]};});
  const actions=[from,...[...healReplies,...attackReplies].map(r=>r.at).sort((a,b)=>a-b),to];
  result.tc2={...tc2({actions,samples:log.samples,replies,spends,cooldown:t.cooldown,rtt:t.rtt,step,busy:s=>s.target||below(s,W,HEAL_FIRST_BELOW),from}),actions:actions.length-2};
  // The party's spread over the window as the priest's samples read it, for a failed row's reading:
  // samples with the warrior out of the priest's view, beyond its range, and the largest distance.
  {const w=log.samples.filter(s=>s.at<to),d=w.map(s=>s.party[W]?.dist??null);
    result.spread={samples:w.length,unseen:d.filter(x=>x===null).length,beyondRange:d.filter(x=>x!==null&&x>t.range).length,max:Math.round(Math.max(0,...d.filter((x):x is number=>x!==null)))};}
  result.tc11=tc11(log,from,to,step,t.cooldown,t.minRtt,true);
  // A pass is the clock step alone, as in tc11 (turns-tc11.ts).
  result.tg16=longFlights(log,from,to,Number.isFinite(step)?step:0);
  {const deaths=await live.clients[P]!.run(`(globalThis.__e2eQueueDeaths||[]).filter(e=>e.at>=${from}&&e.at<${to}).map(e=>e.id)`) as string[],per:Record<string,number>={};
    for(const id of deaths)per[id]=(per[id]??0)+1;
    result.tg21={deaths:Object.keys(per).length,twice:Object.entries(per).filter(([,n])=>n>1)};}
  // The window's targeting readings, logged before the later plants so a later failure keeps them.
  result.shots=await live.clients[P]!.run('(()=>{const l=parent.__e2eTurns,last=a=>a.length?a[a.length-1].at:null;return {actions:l.actions.length,lastAction:last(l.actions),hits:l.hits.length,lastHit:last(l.hits),hitListeners:parent.socket.listeners?parent.socket.listeners("hit").length:null};})()');
  console.log('TARGETING-T1 '+JSON.stringify({shots:result.shots,tg16:result.tg16,tg21:result.tg21,tc2:result.tc2.missed,tc2Skipped:result.tc2.skipped?.length,tc11:result.tc11.waitsWithoutNotNow.length,tc11Skipped:result.tc11.skipped?.length}));
  await tc11View(live,P,'T1',log,from,result.tc11.waitsWithoutNotNow);
  if(red('tc11'))result.heldEdge=await live.clients[P]!.run('globalThis.__e2eHeldEdge??null');
  // The attack family's sends and replies over the window, for the reading of TC2 and TC11.
  result.attackTrace={sends:spends.filter(s=>s.method==='attack'||s.method==='heal').map(s=>[s.at-from,s.method,s.id,s.edge?s.edge-from:null]),
    replies:replies.filter(r=>r.place==='attack'||r.place==='heal').map(r=>[r.at-from,r.place,r.response,r.target??r.id??null])};
  // TC3: at 85%, above the line, the priest keeps attacking at its steps windows rate and tops off
  // only on edges with no target.
  const above=await clock(live,P);
  for(let i=0;i<7;i++){await plantSeen(live,W,{hp:0.85});await waitForGameplay(3_000);}
  const aboveTo=await clock(live,P),aboveLog=await readLog(live,P,above);
  const sampleAt=(at:number)=>aboveLog.samples.filter(s=>s.at<=at).at(-1);
  // TC3's rate half: the gaps between accepted attacks while the priest held a target the whole
  // gap (every page sample between them), so time with no target never counts, and a rate at most
  // one per cooldown.
  const acceptedAbove=aboveLog.replies.filter(r=>r.at<aboveTo&&accepted(r,'attack')).map(r=>r.at);
  const pass=Number.isFinite(result.step)?result.step:0,tc3Skipped:any[]=[];
  const gaps=acceptedAbove.slice(1).map((at,n)=>[acceptedAbove[n]!,at] as const).filter(([a,b])=>{
    const inside=aboveLog.samples.filter(s=>s.at>a&&s.at<b);if(!(inside.length>0&&inside.every(s=>s.target)))return false;
    // Decided 2026-11-09: a gap longer than one cooldown, round trip and pass, which the
    // overkill skip held from within a pass of the attack's cooldown to within a pass of the next
    // send, is no fault, and is recorded.
    const skip=skipStretch(inside,SELECTION_MS+(Number.isFinite(result.step)?result.step:0));
    if(skip&&b-a>margin+pass&&skip.first.at-(a+t.cooldown)<=pass&&b-skip.last.at<=pass+margin){tc3Skipped.push({at:a-above,gap:b-a,target:skip.first.skip!.target,damage:skip.first.skip!.damage,hp:skip.first.skip!.hp});return false;}
    return true;}).map(([a,b])=>b-a);
  const gapMs=gaps.reduce((s,g)=>s+g,0);
  result.tc3={acceptedPerSecond:acceptedAbove.length/((aboveTo-above)/1000),windowSeconds:(aboveTo-above)/1000,
    perTargetSecond:gapMs?gaps.length/(gapMs/1000):null,gaps:gaps.length,skipped:tc3Skipped,
    healsWithTarget:aboveLog.replies.filter(r=>r.at<aboveTo&&accepted(r,'heal')&&sampleAt(r.at)?.target).length};
  await plantVitals(live,P,{hp:1});await plantVitals(live,W,{hp:1});
  // The warrior and the priest each planted to miss more than partyheal's output at the priest's level.
  // Partyheal goes when the HP it restores across the members, each one's missing HP up to that
  // output, is at least one heal (`character.heal`), or when two members are below "Heal first
  // below" (80% here), whatever the heal; otherwise the single heal goes. The fixture's priest heals
  // 21189 against two outputs of 800, so the plant at 85% (above the line, where neither member
  // misses a whole heal) reads no partyheal, and the plant at 70% (both below it) reads
  // partyheal; the unit rows in survival-needs.test.cjs read the restored-HP half.
  {const out=await live.clients[P]!.run(`(()=>{const d=G.skills.partyheal||{};let o=Number(d.output)||0;for(const [l,v] of d.levels||[])if(character.level>=l)o=v;return o;})()`) as number;
    const heal=await live.clients[P]!.run('Number(character.heal)||0') as number;
    // Both members are planted in one server call: planted one after the other, the priest's heal
    // choice saw one member below the line and healed it before the second plant (one run: six
    // heals and no partyheal at 70%), so two members were never below the line together. The one
    // call still reaches the priest's client in two packets: its own HP in the `player` packet at
    // once (server.js:4670, `resend`), the warrior's in the next instance update, at most every 75
    // ms. A heal pass between them read one member below the line and healed it (another run:
    // five heals, no partyheal at 70%), so the plant goes in under the
    // console Pause, and Play follows once the priest's client reads both members planted.
    const held=(on:boolean)=>expect.poll(()=>live.clients[P]!.run('!!__partyHooks.ask("lifecycle.held")'),{timeout:60_000,message:`SV10: the console Pause ${on?'holds':'releases'} the priest`}).toBe(on);
    const plant=async(ratio:number)=>{
      await expect.poll(()=>live.clients[P]!.run(`(()=>{const e=parent.entities[${JSON.stringify(W)}];return !!e&&!e.rip&&Math.hypot(e.real_x-character.real_x,e.real_y-character.real_y)<=character.range;})()`),
        {timeout:60_000,intervals:[50],message:`${W} in the priest's view and heal range before the SV10 plant`}).toBe(true);
      const at=await clock(live,P);
      await live.post('/console-control/pause',{});await held(true);
      await live.admin(`output=(()=>{for(const n of ${JSON.stringify([P,W])}){const p=get_player(n);p.hp=Math.max(1,Math.round(p.max_hp*${ratio}));resend(p,'u+cid');}return true;})()`);
      await expect.poll(()=>live.clients[P]!.run(`(()=>{const e=parent.entities[${JSON.stringify(W)}];return !!e&&e.hp<=e.max_hp*${ratio}+1&&character.hp<=character.max_hp*${ratio}+1;})()`),
        {timeout:15_000,intervals:[50],message:"SV10: the priest's client reads both members planted"}).toBe(true);
      await live.post('/console-control/play',{});await held(false);
      await waitForGameplay(Math.ceil(3*margin));
      const l=await readLog(live,P,at);
      const read={ratio,partyheals:l.spends.filter(s=>s.method==='skill'&&s.name==='partyheal').length,
        heals:l.spends.filter(s=>s.name==='heal'||s.method==='heal').length,
        first:(()=>{const s=l.spends.find(x=>x.method==='skill'&&x.name==='partyheal');return s?{at:s.at-at,party:s.party}:null;})()};
      await plantVitals(live,P,{hp:1});await plantVitals(live,W,{hp:1});return read;};
    result.sv10={output:out,heal,restores:2*out,above:await plant(0.85),below:await plant(0.7)};}
  // TC5: the server drops one accepted `attack` reply of the priest and holds that reply's target
  // alive, before the attack's projectile lands, so neither its `death` nor its `disappear` frees
  // the family and only the lost-reply rule can. The red run frees the family another way: a
  // `disappear` naming the attack as the drop happens.
  // Each goo the priest targets is made unkillable as it becomes the target, and the drop takes the
  // first accepted attack on one made unkillable at least a second before, once the priest's client
  // holds that HP. A goo with its old HP is covered by the dropped attack's damage in flight, so the
  // overkill skip passed over it and the executor dropped the flight on the selection change
  // (13.4 run G read no lost reply); TC5 checks the lost-reply rule alone.
  await live.admin(`output=(()=>{const p=get_player('${P}'),s=p.socket,emit=s.emit,planted=globalThis.__e2eTc5Planted={};globalThis.__e2eDropped=null;
    const find=id=>{for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))if(String(m.id)===String(id))return m;return null;};
    globalThis.__e2eTc5=setInterval(()=>{const m=p.target&&find(p.target);if(m&&!planted[m.id]){m.hp=m.max_hp=10000000;m.u=true;planted[m.id]=Date.now();}},100);
    s.emit=function(event,data){if(event==='game_response'&&data&&data.place==='attack'&&!data.failed&&!globalThis.__e2eDropped&&planted[data.target]&&Date.now()-planted[data.target]>=1000){
      globalThis.__e2eDropped=String(data.target);clearInterval(globalThis.__e2eTc5);s.emit=emit;return true;}return emit.apply(this,arguments);};return true;})()`);
  await expect.poll(()=>live.admin('output=globalThis.__e2eDropped'),{timeout:30_000,message:'TC5: one attack reply is dropped'}).toBeTruthy();
  const held=await live.admin('output=globalThis.__e2eDropped') as string;
  const mortal=(hp:string)=>live.admin(`output=(()=>{for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))if(String(m.id)===${JSON.stringify(held)}){${hp};m.u=true;return true;}return false;})()`);
  if(red('tc5'))await live.clients[P]!.run(`(()=>{for(const fn of parent.socket.listeners('disappear'))fn({id:${JSON.stringify(held)},place:'attack',reason:'not_found'});return true;})()`);
  const droppedAt=await clock(live,P);
  await waitForGameplay(Math.ceil(4*t.cooldown)+2000);
  const next=(await readLog(live,P,droppedAt)).replies.find(r=>accepted(r,'attack'));
  // The family is free once the cooldown and the margin, the largest round trip of the last 4 s,
  // have passed, and the next reply takes one more round trip.
  const largest=await live.clients[P]!.run('Math.max(0,...(parent.pings||[]).filter(Number.isFinite))') as number;
  // The bound is the executor's own lost-reply time from its ring (the cooldown and the margin it
  // read then), then the next reply's round trip, at most the largest the game measured (the
  // margin's own bound, 3.4), and the clock's step.
  const lost=(await live.clients[P]!.run('globalThis.__partyTurns?.records?.()??[]') as any[]).find(r=>r.kind==='lost'&&r.at>=droppedAt-2000);
  await mortal('m.hp=1');
  // Every other goo the plant made unkillable dies at its next hit.
  await live.admin(`output=(()=>{clearInterval(globalThis.__e2eTc5);const planted=globalThis.__e2eTc5Planted||{};
    for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))if(planted[m.id]){m.hp=1;m.u=true;}return true;})()`);
  // TG17: a goo the priest's shot covers lives through the hit.
  // The server raises the target's HP as the attack's reply goes, after the `action` packet, so the
  // priest's damage in flight covers the HP its client holds; the hit lands and the goo lives. The
  // skip ends at that hit, so the priest attacks the goo again after it. The red plant keeps the
  // skip passing over the goo after the hit.
  {await live.admin(`output=(()=>{const s=get_player('${P}').socket,emit=s.emit;globalThis.__e2eLived=null;
      s.emit=function(event,data){if(event==='game_response'&&data&&data.place==='attack'&&!data.failed&&!globalThis.__e2eLived){
        for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))if(String(m.id)===String(data.target)&&m.hp<=1000){m.hp=m.max_hp=10000000;m.u=true;globalThis.__e2eLived=String(m.id);s.emit=emit;}}
        return emit.apply(this,arguments);};return true;})()`);
    const livedFrom=await clock(live,P);
    await expect.poll(()=>live.admin('output=globalThis.__e2eLived'),{timeout:30_000,message:'TG17: a covered goo lives through the hit'}).toBeTruthy();
    const lived=await live.admin('output=globalThis.__e2eLived') as string;
    if(red('tg17'))await live.clients[P]!.run(`(()=>{const k=globalThis.__partyTargeting.skip,c=k.covers;globalThis.__e2eCovers=c;k.covers=t=>String(t.id)===${JSON.stringify(lived)}||c(t);return true;})()`);
    await waitForGameplay(Math.ceil(3*t.cooldown)+2000);
    const l=await readLog(live,P,livedFrom),first=l.hits.find(h=>h.id===lived);
    result.tg17={id:lived,hits:l.hits.filter(h=>h.id===lived).map(h=>[h.at-livedFrom,h.kill,h.miss]),
      attacks:l.spends.filter(s=>s.method==='attack'&&s.id===lived).map(s=>s.at-livedFrom),
      afterHit:first?l.spends.filter(s=>s.method==='attack'&&s.id===lived&&s.at>first.at).length:null,
      skipped:(await live.clients[P]!.run('globalThis.__partyTargeting?.records?.()??[]') as any[]).filter(e=>e.kind==='skipped'&&e.target===lived).length};
    if(red('tg17'))await live.clients[P]!.run('(globalThis.__partyTargeting.skip.covers=globalThis.__e2eCovers,true)');
    console.log('TARGETING-T1-TG17 '+JSON.stringify(result.tg17));
    await live.admin(`output=(()=>{for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))if(String(m.id)===${JSON.stringify(lived)}){m.hp=1;m.u=true;}return true;})()`);}
  result.tc5={held,nextAfterMs:next?next.at-droppedAt:null,lostAfterMs:lost?lost.at-droppedAt:null,
    bound:(lost?Math.max(0,lost.at-droppedAt):t.cooldown+largest)+largest+(Number.isFinite(result.step)?result.step:0)};
  // TC32: a target reset with an attack in flight and its reply held one round trip.
  await live.admin(`output=(()=>{const s=get_player('${P}').socket,emit=s.emit;globalThis.__e2eHeld=null;
    s.emit=function(event,data){if(event==='game_response'&&data&&data.place==='attack'&&!globalThis.__e2eHeld){globalThis.__e2eHeld=Date.now();s.emit=emit;const args=arguments;setTimeout(()=>emit.apply(s,args),${Math.max(50,Math.round(t.rtt))});return true;}return emit.apply(this,arguments);};return true;})()`);
  const resetFrom=await clock(live,P);
  await live.clients[P]!.run('(parent.__e2eTurns.resetOnAttack=true,true)');
  await expect.poll(async()=>(await readLog(live,P,resetFrom)).resets.length,{timeout:15_000,message:'TC32: a reset with an attack in flight'}).toBe(1);
  await waitForGameplay(Math.ceil(2*margin)+1000);
  const resetLog=await readLog(live,P,resetFrom),reset=resetLog.resets[0]!;
  // A later selection may pick the old monster again; only a note before the first attack sent
  // to it after the reset is the held reply's.
  const again=resetLog.spends.find(s=>s.at>reset.at&&s.method==='attack'&&s.id===reset.old);
  const near=(x:{at:number})=>x.at>=reset.at-2000&&x.at<=reset.at+3000;
  result.tc32trace={reset:reset.at,sends:resetLog.spends.filter(s=>s.method==='attack'&&near(s)).map(s=>[s.at-reset.at,s.id]),
    replies:resetLog.replies.filter(r=>r.place==='attack'&&near(r)).map(r=>[r.at-reset.at,r.response,r.failed,r.target??r.id??null]),
    notes:resetLog.notes.filter(near).map(n=>[n.at-reset.at,n.id])};
  result.tc32={old:reset.old,notesOfOld:resetLog.notes.filter(n=>n.at>reset.at&&n.id===reset.old&&n.at<(again?.at??Infinity)).length,
    engaged:await live.clients[P]!.run('partyRoleRunner.engagedTargetId()'),again:!!again};
  // TC18: the priest's MP planted to the forecast plus half an attack's cost.
  const forecast=await live.clients[P]!.run('globalThis.__partyTurns?.forecast?.() ?? null') as number|null;
  result.tc18={forecast};
  if(forecast!==null){
    const at=await clock(live,P);
    await plantVitals(live,P,{mpAt:forecast+t.mpCost/2});
    await waitForGameplay(5000);
    const l=await readLog(live,P,at);
    result.tc18.attacksBelow=l.spends.filter(s=>s.method==='attack'&&s.mp<forecast+t.mpCost).length;
    result.tc18.resumed=l.spends.some(s=>s.method==='attack'&&s.mp>=forecast+t.mpCost);
  }
  // TC38: "Heal first below" written to 60 mid-fight with the warrior at 70%, then back to 80.
  // A write reaches the priest with its next report reply, so each part of
  // TC38 starts once the priest reads the written value.
  const setting=(value:number)=>writeDelivered(live,'healFirstBelow',P,value,'partyTurns.healFirstBelow.read()','TC38');
  result.tc38={written60:await setting(60)};
  if(result.tc38.written60===true){
    const at=await clock(live,P);await plantSeen(live,W,{hp:0.7});await waitForGameplay(Math.ceil(3*margin));
    result.tc38.attacksAt70=(await readLog(live,P,at)).spends.filter(s=>s.method==='attack'&&below(s,W,0.75)&&inRange(s,W)).length;
    result.tc38.written80=await setting(80);
    const back=await clock(live,P);await plantSeen(live,W,{hp:0.7});await waitForGameplay(Math.ceil(margin)+500);
    const l=await readLog(live,P,back);
    result.tc38.healedAt80=l.replies.some(r=>accepted(r,'heal'));
    result.tc38.attacksAt80=l.spends.filter(s=>s.method==='attack'&&below(s,W,HEAL_FIRST_BELOW)&&inRange(s,W)).length;
    // A miss's reading: from the 60 half on, the priest's sends, replies, executor records, samples
    // of the warrior and the heal need's answers.
    if(!result.tc38.healedAt80){const all=await readLog(live,P,at);
      console.log('TURNS-TC38-VIEW '+JSON.stringify({back:back-at,end:(await clock(live,P))-at,
        spends:all.spends.map(s=>[s.at-at,s.method,s.name??s.id??s.item,s.party[W]?Math.round(s.party[W]!.hp/s.party[W]!.max*1000)/10:null,s.party[W]?Math.round(s.party[W]!.dist):null]),
        replies:all.replies.map(r=>[r.at-at,r.place,r.response,r.failed]),ring:all.ring.map((r:any)=>[r.at-at,r.kind,r.family,r.skill,r.reason??r.waitedMs??null]),
        samples:all.samples.filter((_,i)=>i%2===0).map(s=>[s.at-at,s.target?1:0,s.party[W]?Math.round(s.party[W]!.hp/s.party[W]!.max*1000)/10:null,s.party[W]?Math.round(s.party[W]!.dist):null]),
        needs:((await needsSince(live,P,at)) as any)?.calls?.filter((c:any[])=>c[1]==='heal')}));}
  }
  await plantVitals(live,W,{hp:1});
  // TC21: the fixture add-on asks the warrior's Charge at `task` while its
  // target is out of weapon range; its diagnostic names the add-on. One registration, switched on
  // through the saved add-on settings, and no core edit.
  const chargeFrom=await clock(live,W);
  result.tc21={registered:await live.clients[W]!.run(registerTurnsChargeAddon)};
  const addonsOn=await live.clients[W]!.run(addonSwitches(true));
  await live.post('/settings',{changes:[{field:'addons',value:addonsOn}]});
  try{
    await expect.poll(async()=>(await readLog(live,W,chargeFrom)).diags.filter(d=>d.skill==='charge'&&d.status==='accepted').length,
      {timeout:90_000,intervals:[1000],message:"TC21: the fixture add-on's Charge is accepted"}).toBeGreaterThan(0);
  }catch(error){result.tc21.error=String(error).slice(0,200);}
  const chargeLog=await readLog(live,W,chargeFrom);
  result.tc21.charge=chargeLog.diags.filter(d=>d.skill==='charge').map(d=>({status:d.status,by:d.by,rank:d.rank}));
  result.tc21.sends=chargeLog.spends.filter(s=>s.method==='skill'&&s.name==='charge').length;
  await live.post('/settings',{changes:[{field:'addons',value:await live.clients[W]!.run(addonSwitches(false))}]});
  // The priest's turns ring, for the reading of any failed row.
  // The default table fights on Auto, where each fighter
  // picks its own goo (in one run the priest held no grouped lock in the window), so the row ends
  // with a grouped window on Default at the same goos: the priest attacks the lock target or its
  // successor and no other goo while its skip passes over the lock. The red plant sends one raw
  // attack on another goo while a lock holds.
  {const switchAt=await clock(live,P);
    for(const name of [W,P])await live.post('/farming-mode',{character:name,combatMode:'default',targetMode:'farming'});
    await expect.poll(()=>live.clients[P]!.run('(()=>{const q=globalThis.__partyGroupedCombat;return !!(q&&q.target);})()'),{timeout:60_000,message:'TG18: the priest holds a grouped lock'}).toBe(true);
    const lockFrom=await clock(live,P);
    if(red('tg18'))result.tg18Plant=await live.clients[P]!.run(`(()=>{const q=globalThis.__partyGroupedCombat,lock=q&&q.target?String(q.target.id):null,me=parent.character;
      const other=Object.values(parent.entities).filter(e=>e&&e.type==='monster'&&!e.dead&&String(e.id)!==lock&&!${JSON.stringify([W,P])}.includes(e.target))
        .sort((a,b)=>Math.hypot(a.x-me.real_x,a.y-me.real_y)-Math.hypot(b.x-me.real_x,b.y-me.real_y))[0];
      if(!lock||!other)return null;parent.socket.emit('attack',{id:other.id});return {id:String(other.id),lock};})()`);
    await waitForGameplay(20_000);
    // The check reads from the switch, so an attack under a lock before the window's first lock
    // read counts too; its `at` is then negative.
    const lockTo=await clock(live,P),l=await readLog(live,P,switchAt),attacks=l.spends.filter(s=>s.method==='attack'&&s.at>=lockFrom&&s.at<lockTo);
    result.tg18={attacks:attacks.length,withLock:attacks.filter(s=>s.lock).length,offLock:offLock(l.spends,switchAt,lockTo,lockFrom),
      skipped:(await live.clients[P]!.run('globalThis.__partyTargeting?.records?.()??[]') as any[]).filter(e=>e.kind==='skipped'&&e.at>=lockFrom).length,plant:result.tg18Plant??null};
    // The gate reading: every status reply from the switch to Default to the window's end, the reply
    // that first carried a lock and the one that first carried the Default mode, and at each
    // attack the gate's inputs, so an attack off the lock names which input let it through.
    const status=(await live.clients[P]!.run(`(parent.__e2eTurns.status||[]).filter(s=>s.at>=${switchAt}&&s.at<${lockTo})`) as any[]).map(s=>({...s,at:s.at-lockFrom}));
    result.tg18.reading={switchAt:switchAt-lockFrom,status,lockReply:status.find(s=>s.lock)?.seq??null,modeReply:status.find(s=>s.mode==='default')?.seq??null,
      attacks:attacks.slice(0,12).map(s=>({at:s.at-lockFrom,id:s.id,lock:s.lock,grouped:s.grouped,mode:s.mode,passing:s.passing,reply:s.reply}))};
    console.log('TARGETING-T1-TG18 '+JSON.stringify(result.tg18));
    for(const name of [W,P])await live.post('/farming-mode',{character:name,combatMode:'auto',targetMode:'farming'});}
  result.ring=await live.clients[P]!.run('globalThis.__partyTurns?.records?.()??null');
  await attach(info,'turns-t1',result);
  console.log('TURNS-T1 '+JSON.stringify(result));
  expect.soft(result.tc1.attacksWhileHealAsked,"TC1: priest attacks while the stand-in's heal choice asks to heal below 80%").toEqual([]);
  // SV7 and SV8: owner the survival owner's half of TC1's case.
  for(const [i,p] of result.sv7.entries())expect.soft(p.method,`SV7: plant ${i+1}, the first send once the priest's client sees the warrior below 80%`).toBe('heal');
  expect.soft(result.tc1.attacksBelowInRange,"SV8: priest attacks while its client sees the warrior below 80% in heal range").toEqual([]);
  expect.soft(result.sv9,'SV9: heals on a member the client sees above the heal line').toEqual([]);
  expect.soft(result.sv47,'SV47: priest Curses while its client sees a member below 90%').toEqual([]);
  if(result.sv10.restores>=result.sv10.heal)expect.soft(result.sv10.above.partyheals,'SV10: partyheal for two members each missing its output, restoring at least a heal').toBeGreaterThanOrEqual(1);
  else expect.soft(result.sv10.above.partyheals,'SV10: no partyheal above the line that restores less than one heal (SRV-Q40 (b))').toBe(0);
  expect.soft(result.sv10.below.partyheals,'SV10: partyheal for two members below "Heal first below", whatever the heal (SRV-Q43 (c))').toBeGreaterThanOrEqual(1);
  for(const [i,ms] of result.tc1.healed.entries())expect.soft(ms,`TC1: plant ${i+1} healed`).not.toBeNull();
  expect.soft(result.tc2.missed,'TC2: attack edges with neither an attack nor a heal').toBe(0);
  // TG16's long flights, TG17's lived goo and TG18's lock.
  expect.soft(result.tg16.flights,'TG16: the window holds long flights, so the check fires').toBeGreaterThan(0);
  expect.soft(result.tg16.second,"TG16: priest attacks on a goo between its own killing shot's action and hit packets").toEqual([]);
  expect.soft(result.tg18.withLock,'TG18: priest attacks under a grouped lock, so the check fires').toBeGreaterThan(0);
  expect.soft(result.tg18.offLock,'TG18: priest attacks on a goo other than the lock target').toEqual([]);
  expect.soft(result.tg21.deaths,'TG21: goo deaths reach the priest\'s queue client in the window').toBeGreaterThan(0);
  expect.soft(result.tg21.twice,"TG21: a goo's death reaching the priest's queue client more than once").toEqual([]);
  expect.soft(result.tg17.skipped,'TG17: the skip passed over the covered goo before its hit').toBeGreaterThan(0);
  expect.soft(result.tg17.afterHit,'TG17: the priest attacks the goo that lived after its hit lands').toBeGreaterThan(0);
  expect.soft(result.tc11.sendsBeforeEdge,"TC11: sends before their family's edge").toEqual([]);
  expect.soft(result.tc11.waitsWithoutNotNow,'TC11: a ready attack family that waits more than one pass with no not-now').toEqual([]);
  expect.soft(result.tc3.healsWithTarget,'TC3: top-off heals on edges with a target').toBe(0);
  // Step 1's priest spread on the steps windows: 0.83 to 0.84 a second.
  expect.soft(result.tc3.perTargetSecond,'TC3: accepted attacks a second with a target, at 85%').toBeGreaterThanOrEqual(0.83);
  expect.soft(result.tc5.lostAfterMs,'TC5: the executor counts the dropped reply lost').not.toBeNull();
  expect.soft(result.tc5.nextAfterMs,'TC5: an accepted attack after the lost reply').not.toBeNull();
  if(result.tc5.nextAfterMs!==null)expect.soft(result.tc5.nextAfterMs,'TC5: the next accepted attack within the cooldown and two round trips').toBeLessThanOrEqual(result.tc5.bound);
  expect.soft(result.tc32.notesOfOld,'TC32: noteAttack names the old target after the reset').toBe(0);
  if(!result.tc32.again)expect.soft(result.tc32.engaged,'TC32: the stale reply books no attack on the old target').not.toBe(result.tc32.old);
  expect.soft(result.tc18.forecast,'TC18: the A8 forecast (step 3a)').not.toBeNull();
  if(forecast!==null){expect.soft(result.tc18.attacksBelow,'TC18: attacks below the forecast plus a cost').toBe(0);expect.soft(result.tc18.resumed,'TC18: attacks resume').toBe(true);}
  expect.soft(result.tc38.written60,'TC38: "Heal first below" takes a write (step 2)').toBe(true);
  if(result.tc38.written60===true){expect.soft(result.tc38.attacksAt70,'TC38: at 60 the priest attacks at 70%').toBeGreaterThan(0);
    expect.soft(result.tc38.healedAt80,'TC38: back at 80 it heals').toBe(true);expect.soft(result.tc38.attacksAt80,'TC38: back at 80 no attack below it').toBe(0);}
  expect.soft(result.tc21.charge.filter((d:any)=>d.status==='accepted').map((d:any)=>[d.by,d.rank])[0],"TC21: the fixture add-on's Charge, accepted, by the add-on at task (step 3b)")
    .toEqual([TURNS_CHARGE_ADDON+'/charge','task']);
}

// One spend each of the turns executor's
// methods, pushed through `__partyTurns.spend` while the console Pause holds both fighters, its
// server entries against the call budget's ledger. The executor's own call budget question books
// each, so a question whose method or data differs from the call's shows here.
const push=(ask:string)=>`(globalThis.__e2eTc15=globalThis.__e2eTc15||[],globalThis.__partyTurns.spend({rank:'survival',category:'survival',reason:'TC15',by:'e2e:TC15',...${ask}}).then(()=>__e2eTc15.push('accepted'),e=>__e2eTc15.push(e&&(e.reason||e.response)||String(e))),true)`;
async function turnsCallCosts(live:LiveGame){
  const results:any[]=[];
  const report=async()=>console.log('TURNS-TC15 '+JSON.stringify({calls:results.map(r=>[r.label,r.server,r.ledger,r.refused]),answers:await live.clients[W]!.run('globalThis.__e2eTc15??null'),priest:await live.clients[P]!.run('globalThis.__e2eTc15??null'),ring:await live.clients[W]!.run('(globalThis.__partyTurns?.records?.()??[]).slice(-6)')}));
  results.push(await oneCall(live,P,'heal (the executor)','heal',push(`{skill:'heal',targets:[parent.entities['${W}']]}`)));
  results.push(await oneCall(live,P,'potion equip (the executor)','equip',push(`{skill:'use_mp'}`)));
  results.push(await oneCall(live,P,'regeneration use (the executor)','use',push(`{skill:'regen_hp'}`),'true',async()=>{await waitForGameplay(2500);}));
  const ready=(name:string,skill:string)=>expect.poll(()=>live.clients[name]!.run(`globalThis.__partyTurns.ready('${skill}').ready`),{timeout:120_000,message:`TC15: ${skill} is ready`}).toBe(true);
  // Warcry's reach: the server counts a player
  // by the gap between the two boxes, and the game client keeps no entity outside its 700 by 500
  // view. The priest stands 610 east of the warrior, in view and 584 from its box; the merchant
  // 560 north, out of view and 524 from its box. Both are in Warcry's 600, so the server charges
  // 0.3. The plant ends with both back where they stood.
  const stood=await live.admin(`output=(()=>{const at=n=>{const p=get_player(n);return {map:p.map,x:p.x,y:p.y};};return {w:at('${W}'),p:at('${P}'),m:at('${M}')};})()`) as Record<'w'|'p'|'m',{map:string;x:number;y:number}>;
  const place=(name:string,to:{map:string;x:number;y:number})=>live.admin(`output=(()=>{transport_player_to(get_player('${name}'),${JSON.stringify(to.map)},[${to.x},${to.y}]);return true;})()`);
  try{results.push(await oneCall(live,W,'Warcry (the executor)','skill',push(`{skill:'warcry'}`),'true',async()=>{
    await ready(W,'warcry');
    await place(P,{...stood.w,x:stood.w.x+610});await place(M,{...stood.w,y:stood.w.y-560});
    await expect.poll(()=>live.clients[W]!.run(`(()=>{const p=parent.entities['${P}'];return !!p&&Math.abs(p.real_x-character.real_x-610)<1&&Math.abs(p.real_y-character.real_y)<1&&!parent.entities['${M}'];})()`),
      {timeout:15_000,message:'TC15: the priest in view 610 east, the merchant out of view 560 north'}).toBe(true);}));}
  finally{await place(P,stood.p);await place(M,stood.m);}
  // Stomp needs a basher (game data 18285): the warrior equips one for the call, then its own weapon.
  const own=await live.clients[W]!.run('character.slots.mainhand?.name??null') as string|null;
  const slot=await live.admin(`output=(()=>{const p=get_player('${W}'),i=p.items.findIndex(x=>!x);p.items[i]={name:'basher',level:0};p.citems[i]=cache_item(p.items[i]);p.esize--;resend(p,'u+cid+reopen');return i;})()`) as number;
  try{results.push(await oneCall(live,W,'Stomp (the executor)','skill',push(`{skill:'stomp'}`),'true',async()=>{
    await expect.poll(()=>live.clients[W]!.run(`character.items[${slot}]?.name==='basher'`),{timeout:10_000,message:'TC15: the basher in the bag'}).toBe(true);
    await live.clients[W]!.run(`(equip(${slot}),true)`);
    await expect.poll(()=>live.clients[W]!.run(`character.slots.mainhand?.name==='basher'`),{timeout:10_000,message:'TC15: the warrior holds a basher'}).toBe(true);
    await ready(W,'stomp');}));}
  finally{if(own)await live.clients[W]!.run(`(()=>{const i=character.items.findIndex(x=>x&&x.name===${JSON.stringify(own)});if(i>=0)equip(i);return true;})()`);await report();}
  return results;
}

// TC15's attack row runs after the Play: the console Pause refuses every new pull (shared.js
// `consoleDrainAllows`). The warrior is on Manual, whose "Combat" lets the console attack its
// own pick in range, so the executor sends the attack on a goo seeded beside it.
async function attackCallCost(live:LiveGame){
  let goo='';
  // The row sets the state the table left it. Run alone, the warrior read "no
  // selected target" with the seeded goo in range: the default fixture starts
  // with no focus, so no finder named the goo, and with goo focused the eligibility check refused
  // it as "group target lock", since a party leader in grouped farming attacks only the
  // coordinator's grouped lock (shared.js `leaderLockAllows`) and the lone row has no farm spot
  // for the queue to lock in. The table reached the row with goo focused and a lock from the rows
  // before it. The call's price does not depend on the party, so the warrior leads no party for
  // the call and the row puts the party back after it.
  await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{},monsterSearchRadius:400});
  await live.post('/formation',{leader:null});
  await live.post('/formation',{character:W,handControl:{on:true}});
  // The attack's own resend runs when the hit lands (server.js:3520 `to_resend`, 4535 in
  // complete_attack, from the projectile loop), and add_call_cost books it on the socket and the
  // method the server handled last (server_functions.js:5421-5446), whoever sent it. A call from
  // any character between the attack and its landing takes the attack's second unit: the warrior's
  // loot `open_chest` (r2, r10), or another character's call (r13: the attack entry 1, and no other
  // entry of the warrior's grew by it). The row holds every other call of the three characters
  // until its reading ends, the warrior's `attack` and the `target` its client sends before it
  // excepted, so the attack's entry is the attack's whole charge. The warrior's held calls go
  // after the reading; the others' are dropped, as a lost packet, since a late heal or move would
  // act on a stale view.
  for(const n of Object.keys(live.clients))await live.clients[n]!.run(`(()=>{const s=parent.socket,emit=s.emit,held=[],own=${JSON.stringify(n===W)};
    s.emit=function(method,...rest){if(own&&(method==='attack'||method==='target'))return emit.apply(this,[method,...rest]);if(own)held.push([method,...rest]);return s;};
    parent.__e2eCallRelease=()=>{s.emit=emit;for(const call of held.splice(0))emit.apply(s,call);return true;};return true;})()`);
  try{
    const result=await oneCall(live,W,'attack (the executor, on Manual)','attack','true',`globalThis.partyCombatState?.attackTiming?.accepted>0`,async()=>{
      goo=await live.admin(`output=(()=>{const p=get_player('${W}'),m=new_monster(p.in,{type:'goo',position:[p.x+20,p.y],radius:0,count:1},{temp:1});
        m.hp=m.max_hp=15000;target_player(m,p);return String(m.id);})()`) as string;});
    // The warrior's own view when the attack row reads no attack: its turns ring, its selection with
    // its reasons, the goo's own target, its vitals and the executor's passes over one second, for
    // the reading of a row that waits.
    if(!result.server){const passes=await live.clients[W]!.run('globalThis.__partyTurns?.meter?.().passes??null') as number|null;
    await waitForGameplay(1000);
    console.log('TURNS-TC15-ATTACK-VIEW '+JSON.stringify(await live.clients[W]!.run(`({goo:${JSON.stringify(goo)},passesInOneSecond:(globalThis.__partyTurns?.meter?.().passes??0)-${Number(passes)},
      gooEntity:(()=>{const m=parent.entities[${JSON.stringify(goo)}];return m?{target:m.target,dead:!!m.dead,inRange:is_in_range(m),hp:m.hp}:null;})(),characterTarget:character.target??null,
      combat:(({targetRejection,skippedAttack,selectedTarget})=>({targetRejection,skippedAttack,selectedTarget}))(globalThis.partyCombatState??{}),
      lead:sharedRoutine.targeting.isLeader?.()??null,followsManual:partyTasks.holds.followsManual()??null,grouped:partyHunting.farm.grouped(),
      ready:globalThis.__partyTurns?.ready?.('attack')??null,flight:globalThis.__partyTurns?.attackFlight?.()??null,abtesting:globalThis.__partyEventFacts.abtestingMode()??null,
      ring:(globalThis.__partyTurns?.records?.()??[]).slice(-12),
      target:parent.ctarget&&{id:parent.ctarget.id,mtype:parent.ctarget.mtype},selected:globalThis.partyRoleRunner?.engagedTargetId?.()??null,hp:character.hp,maxHp:character.max_hp,
      mp:character.mp,maxMp:character.max_mp,rip:character.rip,hand:partyTasks.holds.handControl()??null,skill:globalThis.partyCombatState?.skill??null,timing:globalThis.partyCombatState?.attackTiming??null,
      meter:globalThis.__partyTurns?.meter?.()??null,errors:globalThis.__partyHooks?.noticeErrors?.()??null,combatError:globalThis.partyCombatState?.error??null,stage:globalThis.partyCombatState?.stage??null,
      occupied:!!__partyHooks.skills.allows({rank:'damage',occupied:true}),held:__partyHooks.ask('lifecycle.held')??null,
      finders:(()=>{const id=f=>{try{const t=f();return t?String(t.id):null;}catch(e){return 'threw '+String(e).slice(0,80);}},m=parent.entities[${JSON.stringify(goo)}];
        return {focus:partyHunting.farm.focus().slice(),spot:partyHunting.farm.spot()??null,at:[character.map,Math.round(character.real_x),Math.round(character.real_y)],
          mode:partyHunting.farm.mode(),followLeader:partyTasks.holds.shouldFollowLeader(),grouped:id(()=>sharedRoutine.targeting.getGroupedTarget()),
          event:id(()=>sharedRoutine.targeting.nearestEventTarget()),preferred:id(()=>sharedRoutine.targeting.getPreferredTarget()),focused:id(()=>sharedRoutine.targeting.getNearestFocusedMonster()),
          allows:m?(()=>{const d={};const ok=sharedRoutine.targeting.isAllowedTarget?.(m,undefined,d);return {ok,reason:d.reason??null};})():null,nomination:globalThis.__partyNomination??null};})()})`)).slice(0,8000));}
    return result;
  }finally{
    for(const n of Object.keys(live.clients))await live.clients[n]!.run('parent.__e2eCallRelease?.()??false');
    if(goo)await live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(goo)}];if(m)remove_monster(m,{method:'disappear',nospawn:true});return true;})()`);
    await live.post('/formation',{character:W,handControl:{on:false}}).catch(()=>{});
    await party(live);
  }
}

// Row T2: one potion in flight.
export async function turnsPotionRow(live:LiveGame,info:TestInfo){
  const result:any={};
  for(const n of fighters)await live.clients[n]!.run(spendLog);
  // TC9's first half: game data puts the four potion skills in one group, and the executor's
  // family table names them one family.
  result.families=await live.clients[P]!.run(`(()=>{const k=${JSON.stringify(POTION_SKILLS)};
    return {data:k.map(s=>G.skills[s].cooldown_group??G.skills[s].share??s),table:globalThis.__partyTurns?.family?k.map(s=>__partyTurns.family(s)):null};})()`);
  // TC13: the server's heal rule, live: the paused priest planted below `mp_cost` heals the warrior
  // once (server.js:3354-3356 heals with no MP check; consume_mp floors MP at 0).
  await party(live);
  // The console Pause runs no `act` registration of the priest (the lifecycle owner's run scope), so neither a
  // potion nor regeneration raises the planted MP before the heal.
  try{
    await live.post('/console-control/pause',{});
    await expect.poll(()=>live.clients[P]!.run('!!__partyHooks.ask("lifecycle.held")'),{timeout:30_000,message:'TC13: the console Pause holds the priest'}).toBe(true);
    const t=await timing(live,P);
    await live.clients[P]!.run(`(()=>{const w=parent.entities['${W}'];if(w&&Math.hypot(w.real_x-character.real_x,w.real_y-character.real_y)>character.range*0.8)move(w.real_x,w.real_y);return true;})()`);
    await expect.poll(()=>live.clients[P]!.run(`(()=>{const w=parent.entities['${W}'];return !!w&&!character.moving&&Math.hypot(w.real_x-character.real_x,w.real_y-character.real_y)<=character.range;})()`),{timeout:20_000,message:'TC13: the warrior in heal range'}).toBe(true);
    // TC13's red plant: the warrior at full HP, so the heal heals nothing.
    await plantVitals(live,W,{hp:red('tc13')?1:0.6});
    const planted=await plantVitals(live,P,{mpAt:Math.floor(t.mpCost/2)});
    await expect.poll(()=>live.clients[P]!.run(`character.mp<character.mp_cost&&(${red('tc13')}||parent.entities['${W}'].hp<parent.entities['${W}'].max_hp)`),{timeout:10_000,intervals:[50],message:'TC13: the plant arrives'}).toBe(true);
    // TC13's red plant for its `accepted` half: the priest stunned, which the server's skill handler
    // refuses as "disabled" (server.js:9785-9786 at the pin).
    if(red('tc13a'))await live.admin(`output=(()=>{const p=get_player('${P}');p.s.stunned={ms:5000};p.u=true;resend(p,'u+cid');return true;})()`);
    const before=await live.admin(`output=(()=>{const w=get_player('${W}'),p=get_player('${P}');return {w:w.hp,p:p.mp,cost:p.mp_cost};})()`);
    const answer=await live.clients[P]!.run(`heal(parent.entities['${W}']).then(r=>({accepted:true,reply:r&&{response:r.response,place:r.place}}),e=>({accepted:false,reason:e&&(e.reason||e.response||e.message)}))`);
    const after=await live.admin(`output=(()=>{const w=get_player('${W}'),p=get_player('${P}');return {w:w.hp,p:p.mp};})()`);
    result.tc13={planted:{mp:planted.mp,mp_cost:planted.mp_cost},before,answer,after,healed:after.w>before.w,mpAfter:after.p};
    await plantVitals(live,P,{hp:0.9,mp:0.8});await plantVitals(live,W,{hp:0.6,mp:0.8});
    try{result.tc15=await turnsCallCosts(live);}catch(error){result.tc15error=String(error).slice(0,300);console.log('TURNS-TC15-ERROR '+result.tc15error);}
  }catch(error){result.tc13={error:String(error).slice(0,400)};console.log('TURNS-T2-TC13 '+result.tc13.error);}
  finally{
    await live.post('/console-control/play',{}).catch(()=>{});
    await expect.poll(()=>live.clients[P]!.run('!__partyHooks.ask("lifecycle.held")'),{timeout:60_000,message:'Play releases the priest'}).toBe(true).catch(()=>{});
    await plantVitals(live,P,{hp:1,mp:1});await plantVitals(live,W,{hp:1});
  }
  try{(result.tc15??=[]).unshift(await attackCallCost(live));}catch(error){result.tc15error=String(error).slice(0,300);console.log('TURNS-TC15-ERROR '+result.tc15error);}
  console.log('TURNS-TC15-ATTACK '+JSON.stringify(result.tc15?.[0]&&[result.tc15[0].label,result.tc15[0].server,result.tc15[0].ledger]));
  // TC9: MP at 15% and HP at 45% while the priest walks to the goo field and fights.
  const from=await clock(live,P),plantAts:number[]=[];
  const farm=await location(live,'goo');
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'merchant idle':false,'stand maintenance':false}});
  await live.post('/navigate-to-monster',{monsterId:'goo',location:farm});
  await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{},monsterSearchRadius:400});
  await expect.poll(()=>live.clients[P]!.run('!!character.moving'),{timeout:60_000,message:'The priest walks'}).toBe(true);
  // Two plants while it walks (the pulse's regeneration is eligible), four while it fights (the
  // role loop's class potion runs; the role loop stops it in travel).
  for(let i=0;i<2;i++){await plantVitals(live,P,{hp:0.45,mp:0.15});plantAts.push(await clock(live,P));await waitForGameplay(10_000);}
  await expect.poll(async()=>(await readLog(live,P,from)).replies.filter(r=>accepted(r,'attack')).length,{timeout:120_000,message:'The priest fights goo'}).toBeGreaterThanOrEqual(2);
  const fightFrom=plantAts.length;
  for(let i=0;i<4;i++){await plantVitals(live,P,{hp:0.45,mp:0.15});plantAts.push(await clock(live,P));await waitForGameplay(10_000);}
  const to=await clock(live,P),log=await readLog(live,P,from);
  const family=(s:Spend)=>s.method==='use'||(s.method==='equip'&&/^[hm]pot/.test(String(s.item)));
  const firsts=plantAts.map(at=>log.spends.find(s=>s.at>=at&&family(s))).map(s=>s?{method:s.method,item:s.item,at:s.at,hp:s.party[P]?.hp,max:s.party[P]?.max,mp:s.mp,maxMp:s.maxMp}:null);
  result.tc9={notReady:log.replies.filter(r=>r.at<to&&(r.response==='not_ready'||r.reason==='not_ready')&&['equip','use'].includes(String(r.place))),
    lines:log.lines.filter(l=>l.at<to),potionCalls:log.spends.filter(s=>s.at<to&&family(s)).length,firsts,fightFrom};
  const t2=await timing(live,P);
  result.tc11=tc11(log,from,to,replyStep(log.replies.filter(r=>r.at<to)),t2.cooldown,t2.minRtt,true);
  await tc11View(live,P,'T2',log,from,result.tc11.waitsWithoutNotNow);
  await plantVitals(live,P,{hp:1,mp:1});
  // The porcupine's target call asks the call budget first.
  await porcupineTargetCall(live);
  await attach(info,'turns-t2',result);
  console.log('TURNS-T2 '+JSON.stringify(result));
  expect(result.families.data,'TC9: game data puts the four potion skills in one group').toEqual(POTION_SKILLS.map(()=>'potion'));
  expect(result.families.table,"TC9: the executor's family table names the four potion skills one family").toEqual(POTION_SKILLS.map(()=>'potion'));
  expect.soft(result.tc13.answer?.accepted,`TC13: the server accepts the heal below mp_cost: ${JSON.stringify(result.tc13)}`).toBe(true);
  expect.soft(result.tc13.healed,'TC13: the heal below mp_cost heals the warrior').toBe(true);
  expect.soft(result.tc9.notReady,'TC9: potion family calls refused not_ready').toEqual([]);
  expect.soft(result.tc11.sendsBeforeEdge,"TC11: sends before their family's edge").toEqual([]);
  expect.soft(result.tc11.waitsWithoutNotNow,'TC11: a ready attack family that waits more than one pass with no not-now').toEqual([]);
  expect.soft(result.tc9.lines,'TC9: "Recovery failed" and "Potion failed" lines').toEqual([]);
  for(const r of result.tc15??[])expect.soft([r.label,r.ledger],`TC15: ${r.label} entries ${JSON.stringify(r.entries)} ledger ${JSON.stringify(r.ledgerEntries)} refused ${JSON.stringify(r.refused)}`).toEqual([r.label,r.server]);
  // A regeneration `use` costs nothing on the server, so its reach is the executor's answer.
  for(const r of result.tc15??[])if(!/regeneration/.test(r.label))expect.soft(r.server,`TC15: ${r.label} reached the server`).toBeGreaterThan(0);
  expect.soft(result.tc15error,'TC15: every call ran').toBeUndefined();
}

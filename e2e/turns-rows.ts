import {expect,plantVitals,serverView,waitForGameplay,type LiveGame} from './live-fixtures';
import {fighters,location,party} from './game/hunt-lifecycle';
import {oneCall} from './call-budget-rows';
import {tc11,replyStep,below,HEAL_FIRST_BELOW,type SkipRecord} from './turns-tc11';
import {tc2} from './turns-tc2';
import {W,P,M} from './hunt-interruption-helpers';
import {HEAL_FIRST_BELOW as HEAL_FIRST_BELOW_PERCENT} from '../runtime/characters/turns/saved-fields';

// The turns owner's rows, which W01, W04, W06a and W08c play from: the priest's slot at the attack edge,
// and one potion in flight. Each checks its failure modes by number after the row's measures, so a row on
// a tree without the executor still measures. The modes later steps build are soft checks, so each row
// runs to its end. The steps windows and the bee field read the same spend log for their measures.
// A red run plants the break each named check exists to catch (E2E_TURNS_RED=tc1,tc5,...), so the
// check is shown failing; a gate run plants none.
export const red=(check:string)=>(process.env.E2E_TURNS_RED??'').split(',').includes(check);

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
        // The character's own walk and the hold the skill went out under. A console skill goes out
        // inside a turns pass, where \`skills.allows\` answers from that pass's spend table read and
        // reads no fact again, so the log asks the original the farm walk row keeps
        // (\`__e2eOccupied\`). The status report asks it once a report, so its last answer is up to one
        // report old: the end run on 367447e73 read a Warcry as held from an answer 998 ms before it.
        ...(method==='skill'?(()=>{try{const o=code.__e2eOccupied;return {walk:(code.__partyMovement&&code.__partyMovement.live&&code.__partyMovement.live()||{}).kind||null,
          held:o?!!o.call(code.__partyHooks.skills,{rank:'damage',occupied:true}):null,heldAt:o?Date.now():null};}catch(e){return {};}})():{}),
        // What the heal choice asks at an attack's send: the HP share of the member it would heal, or
        // null, from the survival owner's choice.
        // The grouped lock target at an attack's send and whether the attacked monster targets a
        // party member.
        ...(method==='attack'?{lock:(()=>{const q=code.__partyGroupedCombat;return q&&q.target?String(q.target.id):null;})(),
          threat:(()=>{const e=data&&g.entities[data.id];return !!(e&&names.includes(e.target));})(),
          // Whether this character's own "Don't hit with magic" list holds the attacked monster at the send (TG11).
          magicListed:(()=>{try{const e=data&&g.entities[data.id],t=code.__partyTargeting;return e&&t?t.reflect().magic.includes(e.mtype):null;}catch(e){return null;}})()}:{}),
        // The attack gate's inputs at the send: whether the grouped
        // rule applies (groupedFarming()), the farming mode the client holds, the passing target
        // the gate exempts, and the newest status reply the client has received.
        ...(method==='attack'?(()=>{try{const r=code.sharedRoutine,p=r.targeting.passingTarget&&r.targeting.passingTarget();
          return {grouped:!!code.partyHunting.farm.grouped(),mode:code.partyHunting.farm.mode(),passing:p?String(p.id):null,reply:log.statusSeq};}catch(e){return {grouped:String(e)};}})():{}),
        // TC38 also keeps the "Heal first below" line an attack or a heal went out under.
        ...(method==='attack'||method==='heal'?(()=>{let line=null;try{line=Number(code.partyTurns.healFirstBelow.read())||${HEAL_FIRST_BELOW_PERCENT};}catch(e){}
          return method==='heal'?{line}:{line,healAsk:line===null?null:(()=>{try{const c=code.__partySurvival.healChoice({healFirstBelow:line,regularOnly:false});return c?c.ratio:null;}catch(e){return null;}})()};})():{})});}
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
type Spend={lock?:string|null;threat?:boolean;magicListed?:boolean|null;grouped?:boolean|string|null;mode?:string|null;passing?:string|null;reply?:number;at:number;method:string;name?:string;id?:string;edge?:number;item?:string;mp:number;maxMp:number;range:number;target:boolean;party:Record<string,{hp:number;max:number;dist:number}>;reserve?:number;cost?:number;healAsk?:number|null;line?:number|null;town?:boolean;healOut?:number;fight?:unknown};
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

// T43's plain half (play window W01): the priest's slot read over the measured goo windows, with no
// plant. TC2, TC11, TG16, TG18, TG21 and SV9 judge ordinary farming, so they read W01's play; the
// planted checks stay in turnsSlotRow until W04 and W05 take them. slotPlainStart wraps the queue
// client's death before the play, as TG21's live half in the row does.
export const slotPlainStart=(live:LiveGame)=>live.clients[P]!.run(`(()=>{const q=globalThis.partyQueueClient,log=globalThis.__e2eQueueDeaths=[];if(!q||!q.death)return false;const d=q.death;
    q.death=function(id,...rest){log.push({at:Date.now(),id:String(id)});return d.call(this,id,...rest);};return true;})()`);
export async function slotPlainRead(live:LiveGame,from:number,to:number){
  const t=await timing(live,P),log=await readLog(live,P,from);
  const spends=log.spends.filter(s=>s.at<to),replies=log.replies.filter(r=>r.at<to),step=replyStep(replies);
  const actions=[from,...replies.filter(r=>accepted(r,'heal')||accepted(r,'attack')).map(r=>r.at).sort((a,b)=>a-b),to];
  const deaths=await live.clients[P]!.run(`(globalThis.__e2eQueueDeaths||[]).filter(e=>e.at>=${from}&&e.at<${to}).map(e=>e.id)`) as string[],per:Record<string,number>={};
  for(const id of deaths)per[id]=(per[id]??0)+1;
  const attacks=spends.filter(s=>s.method==='attack');
  return {from,to,step,timing:t,
    tc2:tc2({actions,samples:log.samples,replies,spends,cooldown:t.cooldown,rtt:t.rtt,step,busy:s=>s.target||below(s,W,HEAL_FIRST_BELOW),from}),
    tc11:tc11(log,from,to,step,t.cooldown,t.minRtt,true),
    tg16:longFlights(log,from,to,Number.isFinite(step)?step:0),
    tg18:{attacks:attacks.length,withLock:attacks.filter(s=>s.lock).length,offLock:offLock(spends,from,to)},
    tg21:{deaths:Object.keys(per).length,twice:Object.entries(per).filter(([,n])=>n>1)},
    sv9:spends.filter(s=>s.method==='heal'&&s.id&&s.party[s.id]).filter(s=>{const m=s.party[s.id!]!;
      return m.hp/m.max>=HEAL_FIRST_BELOW&&m.max-m.hp<(s.healOut??0);}).map(s=>({at:s.at-from,id:s.id,hp:s.party[s.id!],healOut:s.healOut}))};
}
export function slotPlainVerdict(result:Awaited<ReturnType<typeof slotPlainRead>>){
  expect.soft(result.sv9,'SV9: heals on a member the client sees above the heal line').toEqual([]);
  expect.soft(result.tc2.missed,'TC2: attack edges with neither an attack nor a heal').toBe(0);
  expect.soft(result.tg16.flights,'TG16: the window holds long flights, so the check fires').toBeGreaterThan(0);
  expect.soft(result.tg16.second,"TG16: priest attacks on a goo between its own killing shot's action and hit packets").toEqual([]);
  expect.soft(result.tg18.withLock,'TG18: priest attacks under a grouped lock, so the check fires').toBeGreaterThan(0);
  expect.soft(result.tg18.offLock,'TG18: priest attacks on a goo other than the lock target').toEqual([]);
  expect.soft(result.tg21.deaths,"TG21: goo deaths reach the priest's queue client in the window").toBeGreaterThan(0);
  expect.soft(result.tg21.twice,"TG21: a goo's death reaching the priest's queue client more than once").toEqual([]);
  expect.soft(result.tc11.sendsBeforeEdge,"TC11: sends before their family's edge").toEqual([]);
  expect.soft(result.tc11.waitsWithoutNotNow,'TC11: a ready attack family that waits more than one pass with no not-now').toEqual([]);
}

// One spend each of the turns executor's
// methods, pushed through `__partyTurns.spend` while both fighters stand on Manual with Combat and
// Use potions on, its server entries against the call budget's ledger. The executor's own call
// budget question books each, so a question whose method or data differs from the call's shows
// here. The console Pause refuses every spend, a push included, since a Pause stops all console
// code (13-lifecycle-design LF1): its hold field carries Combat and Use potions off (runtime/tasks/
// coordinator/holds.ts `response`). Manual moves nobody, and in the town square with no focus and
// full vitals the console's only spend of its own is the warrior's Warcry upkeep, which a plant
// holds off (below), so each call's quiet window holds.
// A refused push keeps what the executor read at its answer: the family's readiness, the game's
// potion edge, the time since the last draw (executor.ts `update`) and the call ring's last answers,
// so a `waiting` names its cause.
const push=(ask:string)=>`(globalThis.__e2eTc15=globalThis.__e2eTc15||[],globalThis.__e2eTc15Why=globalThis.__e2eTc15Why||[],globalThis.__partyTurns.spend({rank:'survival',category:'survival',reason:'TC15',by:'e2e:TC15',...${ask}}).then(()=>__e2eTc15.push('accepted'),e=>{const t=globalThis.__partyTurns,now=Date.now();
  __e2eTc15.push(e&&(e.reason||e.response)||String(e));__e2eTc15Why.push({at:now,mp:[character.mp,character.max_mp],ready:t.ready('use_mp'),edge:+(parent.next_skill.use_hp||0)-now,draw:now-(+parent.last_draw),
    turns:t.records().slice(-6),calls:(globalThis.__partyCalls?.records?.()??[]).slice(-6)});}),true)`;
// The heal's target resend runs when the plight lands (server.js complete_attack `resend(target,'u+cid')`),
// and add_call_cost books each of its charges on `current_socket`. The heal handler lands an eta-0
// plight itself (commence_attack `projectiles_loop()`), so the priest's socket holds them. A plight in
// flight lands in the projectile tick, where `current_socket` is false_socket (server.js:5054), and
// the charges reach no player. The record keeps, for each landing of the priest's heal on the
// warrior, where it ran and each charge it booked, so TC15 prices the heal whichever way it landed.
const healLanding=(on:boolean)=>on?`output=(()=>{const g=globalThis;if(g.__e2eHealLanding)return true;
  const list=[],land=complete_attack,charge=add_call_cost,priest=get_player('${P}').socket;let open=null;
  add_call_cost=function(socket,num){if(open){const to=is_number(socket)||!socket?current_socket:socket.socket||socket;
    open.charges.push({n:is_number(socket)?socket:num||1,on:to===false_socket?'none':to===priest?'${P}':'other'});}return charge.apply(this,arguments);};
  complete_attack=function(attacker,target,info){if(open||!(attacker&&attacker.name==='${P}'&&target&&target.name==='${W}'&&info&&info.heal))return land.apply(this,arguments);
    open={where:current_socket===false_socket?'tick':current_socket===priest?'handler':'other',charges:[]};
    try{return land.apply(this,arguments);}finally{list.push(open);open=null;}};
  g.__e2eHealLanding={off:()=>{add_call_cost=charge;complete_attack=land;delete g.__e2eHealLanding;return list;}};return true;})()`
  :`output=globalThis.__e2eHealLanding?globalThis.__e2eHealLanding.off():null`;
// The heal handler runs under the call modifier 1 (server.js:4982 names no `heal`), so each charge of
// the landing counts 1 at the heal's own modifier, whatever modifier the tick keeps from the last handler.
const HEAL_MODIFIER=1;
// The heal's largest charge, which the ledger books (call-budget.ts `price`, a heal on another
// player): the priest's entry, plus the landing's charges when the tick booked them on no player.
function healLargest(r:{server:number;landings?:{where:string;charges:unknown[]}[]|null}){
  const ticked=(r.landings??[]).filter(l=>l.where==='tick').reduce((sum,l)=>sum+l.charges.length*HEAL_MODIFIER,0);
  return Math.round((r.server+ticked)*100)/100;
}
async function turnsCallCosts(live:LiveGame){
  const manual=async(on:boolean)=>{for(const n of [W,P]){await live.post('/formation',{character:n,handControl:{on}});
    await expect.poll(()=>live.clients[n]!.run(`partyTasks.holds.handControl()?.by??null`),{timeout:30_000,message:`TC15: ${n} ${on?'on':'off'} Manual`}).toBe(on?'manual':null);}};
  await manual(true);
  try{return await callCosts(live);}finally{await manual(false);}
}
async function callCosts(live:LiveGame){
  const results:any[]=[];
  const report=async()=>console.log('TURNS-TC15 '+JSON.stringify({calls:results.map(r=>[r.label,r.server,r.ledger,r.refused,r.landings??null]),answers:await live.clients[W]!.run('globalThis.__e2eTc15??null'),priest:await live.clients[P]!.run('globalThis.__e2eTc15??null'),why:await live.clients[P]!.run('globalThis.__e2eTc15Why??null'),ring:await live.clients[W]!.run('(globalThis.__partyTurns?.records?.()??[]).slice(-6)')}));
  await live.admin(healLanding(true));
  try{const heal=await oneCall(live,P,'heal (the executor)','heal',push(`{skill:'heal',targets:[parent.entities['${W}']]}`));
    results.push({...heal,landings:await live.admin(healLanding(false))});}
  finally{await live.admin(healLanding(false));}
  // A skill that never readies leaves its last answer, the server's next_skill edge, the
  // character's MP against the skill's cost and the turns ring's last sends of it in the log, so
  // the reading names why.
  const ready=async(name:string,skill:string)=>{let last:unknown=null;
    try{await expect.poll(async()=>!!((last=await live.clients[name]!.run(`({answer:globalThis.__partyTurns.ready('${skill}'),edge:+(parent.next_skill['${skill}']||0),now:Date.now(),mp:character.mp,cost:G.skills['${skill}'].mp??null,sends:(globalThis.__partyTurns?.records?.()??[]).filter(r=>JSON.stringify(r).includes('${skill}')).slice(-4)})`)) as {answer?:{ready?:boolean}}).answer?.ready,{timeout:120_000,message:`TC15: ${skill} is ready`}).toBe(true);}
    catch(error){console.log('TURNS-TC15-READY '+JSON.stringify({name,skill,last}));throw error;}};
  // The heal spends the priest's MP, and the console's regeneration drinks regen_mp while MP is
  // below its max (survival/needs.ts `regenerationOrder`). That drink holds the potion family for
  // regen_mp's 4 s (use_mp's cooldown times regen_mp's cooldown_multiplier), the same span as the
  // call window, so the quiet window ends on that edge: W06a's run of 2026-11-24 pushed both potion
  // calls into it and each answered `waiting`. The priest's MP back at its max ends the
  // regeneration, and each push waits for the family to be ready.
  await plantVitals(live,P,{mp:1});
  results.push(await oneCall(live,P,'potion equip (the executor)','equip',push(`{skill:'use_mp'}`),'true',()=>ready(P,'use_mp')));
  results.push(await oneCall(live,P,'regeneration use (the executor)','use',push(`{skill:'regen_hp'}`),'true',()=>ready(P,'regen_hp')));
  // Warcry's reach: the server counts a player
  // by the gap between the two boxes, and the game client keeps no entity outside its 700 by 500
  // view. The priest stands 610 east of the warrior, in view and 584 from its box; the merchant
  // 560 north, out of view and 524 from its box. Both are in Warcry's 600, so the server charges
  // 0.3. The plant ends with both back where they stood.
  const stood=await live.admin(`output=(()=>{const at=n=>{const p=get_player(n);return {map:p.map,x:p.x,y:p.y};};return {w:at('${W}'),p:at('${P}'),m:at('${M}')};})()`) as Record<'w'|'p'|'m',{map:string;x:number;y:number}>;
  const place=(name:string,to:{map:string;x:number;y:number})=>live.admin(`output=(()=>{transport_player_to(get_player('${name}'),${JSON.stringify(to.map)},[${to.x},${to.y}]);return true;})()`);
  // The warrior's console keeps Warcry up on every pass while Combat is on, target or not
  // (skills/protection.ts `combatBuffSupport`, as b9b5c91e's warrior.ts `beforeTarget`), so it casts
  // the skill as soon as it readies: W06a's run of 2026-11-24 read the edge 42 s ahead after a
  // 120 s wait. A planted Warcry effect on the warrior leaves its upkeep nothing to refresh until
  // the push. It lasts the quiet window (30 s), one Warcry cooldown (game data) and the placement
  // (15 s), the three waits before the push.
  await live.admin(`output=(()=>{const p=get_player('${W}');p.s.warcry={ms:45000+G.skills.warcry.cooldown,f:'${W}'};resend(p,'u+cid');return true;})()`);
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

// TC13's heal under a console Pause that already holds the priest: the paused priest planted
// below `mp_cost` heals the warrior once (server.js:3354-3356 heals with no MP check; consume_mp
// floors MP at 0). turnsPotionRow presses its own Pause first; W06a runs it inside E64's Pause.
export async function tc13Heal(live:LiveGame,result:any){
  try{
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
    const answer=await live.clients[P]!.run(`heal(parent.entities['${W}']).then(r=>({accepted:true,reply:r&&{response:r.response,place:r.place,eta:r.eta??0}}),e=>({accepted:false,reason:e&&(e.reason||e.response||e.message)}))`) as {accepted:boolean;reply?:{eta:number}};
    // The heal lands when its plight does: the reply carries the flight's `eta` (server.js
    // commence_attack), and an eta of 0 lands inside the handler. The read waits that flight and
    // one call margin for the landing's packet, so a heal in the air is not read as no heal.
    const read=()=>live.admin(`output=(()=>{const w=get_player('${W}'),p=get_player('${P}');return {w:w.hp,p:p.mp};})()`) as Promise<{w:number;p:number}>;
    const margin=Number(await live.clients[P]!.run('__partyCalls.view().margin??0'));
    let after=await read();
    if(answer.accepted)await expect.poll(async()=>(after=await read()).w>before.w,{timeout:(answer.reply?.eta??0)+margin,intervals:[50]}).toBe(true).catch(()=>{});
    result.tc13={planted:{mp:planted.mp,mp_cost:planted.mp_cost},before,answer,after,healed:after.w>before.w,mpAfter:after.p};
  }catch(error){result.tc13={error:String(error).slice(0,400)};console.log('TURNS-T2-TC13 '+result.tc13.error);}
}
// TC15: one spend of each executor method against the call budget's ledger, then the attack's.
export async function tc15Play(live:LiveGame,result:any){
  try{result.tc15=await turnsCallCosts(live);}catch(error){result.tc15error=String(error).slice(0,300);console.log('TURNS-TC15-ERROR '+result.tc15error);}
  try{(result.tc15??=[]).unshift(await attackCallCost(live));}catch(error){result.tc15error=String(error).slice(0,300);console.log('TURNS-TC15-ERROR '+result.tc15error);}
  console.log('TURNS-TC15-ATTACK '+JSON.stringify(result.tc15?.[0]&&[result.tc15[0].label,result.tc15[0].server,result.tc15[0].ledger]));
}
export function tc13tc15Verdict(result:any){
  expect.soft(result.tc13.answer?.accepted,`TC13: the server accepts the heal below mp_cost: ${JSON.stringify(result.tc13)}`).toBe(true);
  expect.soft(result.tc13.healed,'TC13: the heal below mp_cost heals the warrior').toBe(true);
  for(const r of result.tc15??[])if(!r.landings)expect.soft([r.label,r.ledger],`TC15: ${r.label} entries ${JSON.stringify(r.entries)} ledger ${JSON.stringify(r.ledgerEntries)} refused ${JSON.stringify(r.refused)}`).toEqual([r.label,r.server]);
  // The heal: one landing, in the priest's handler or in the projectile tick, never on another
  // player's socket, and the ledger at its largest charge.
  for(const r of (result.tc15??[]).filter((r:any)=>r.landings)){
    expect.soft(r.landings.map((l:any)=>l.where),`TC15: ${r.label} lands once, in the priest's handler or the projectile tick: ${JSON.stringify(r.landings)}`).toEqual([expect.stringMatching(/^(handler|tick)$/)]);
    expect.soft([r.label,r.ledger],`TC15: ${r.label} entries ${JSON.stringify(r.entries)} landings ${JSON.stringify(r.landings)} ledger ${JSON.stringify(r.ledgerEntries)} refused ${JSON.stringify(r.refused)}`).toEqual([r.label,healLargest(r)]);}
  // A regeneration `use` costs nothing on the server, so its reach is the executor's answer.
  for(const r of result.tc15??[])if(!/regeneration/.test(r.label))expect.soft(r.server,`TC15: ${r.label} reached the server`).toBeGreaterThan(0);
  expect.soft(result.tc15error,'TC15: every call ran').toBeUndefined();
}

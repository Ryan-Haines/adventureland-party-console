import {expect,type LiveGame} from './live-fixtures';
import type {TestInfo} from '@playwright/test';

// Step 7 of the movement owner migration: respawn to activity (UP-1, UP-3).
// Failure inventory: e2e/movement-owner-failures.md, "Step 7".
import {W,P,fighters} from './hunt-interruption-helpers';
export {W,P,fighters};
// The movement owner counts a walk as arrived within ARRIVAL_TOLERANCE (runtime/protocol/ladder.ts).
export {ARRIVAL_TOLERANCE} from '../runtime/protocol/ladder.ts';
// Survival's recovery tick runs death recovery (runtime/characters/survival/install.ts).
// The game's own zone test for "at the saved farm" (runtime/coordinator/survival/recovery.ts
// returnToFarm, characters/farming-zones.cjs contains with a 400 margin).
export const FARM_MARGIN=400;

export interface Boss{id:string;type:string;map:string;x:number;y:number}
// Each placement names the boss type it seeds. The Halloween checkpoint rows
// (event-checkpoint-rows.ts) seed Mr. Green and Mr. Pumpkin side by side near the checkpoint.
export const bosses={
  mrgreen:{type:'mrgreen',map:'spookytown',x:636,y:995},
  horseman:{type:'horseman',map:'halloween',x:-405,y:-1640},
  checkpointGreen:{type:'mrgreen',map:'halloween',x:-495,y:650},
  checkpointPumpkin:{type:'mrpumpkin',map:'halloween',x:-495,y:685},
} as const;

// Every ambient monster turns peaceful, so the only death is the scripted one. The
// fixture's reset() restores aggro and peaceful before the next test (e2e/game/bootstrap.cjs),
// and the default table's row reset before its next row (live-fixtures.ts defaultFixtureReset).
// The server's own event lineup stays off for the scenario, so only the events it seeds go live
// (an Ice Golem the lineup started during one step 11 run kept a cant_join seed from running);
// the live fixture's teardown turns it back on. A pursuit ends through reduce_targets: a bare
// m.target=null leaves the player's targets count raised, and above 5 the server refuses Town and
// every door (node/server.js "cant_escape").
// It keeps the catalog's own aggro and peaceful before the first change and registers their restore
// on the catalog and on every live monster, so a later row or scenario in the same game pool seeds
// monsters that take a target (node/server.js target_player returns for a peaceful monster).
export async function peacefulWorld(live:LiveGame){
  await live.admin(`output=(()=>{if(!globalThis.__e2eLineup){globalThis.__e2eLineup=event_schedule_tick;event_schedule_tick=function(){};}return true;})()`);
  return peacefulMonsters(live);
}
// Every catalog monster and every live one peaceful with no aggro, with the restore registered.
export async function peacefulMonsters(live:LiveGame){
  live.undo('the aggro and peaceful of the catalog and live monsters',()=>live.admin(catalogBehaviourRestore));
  return live.admin(`output=(()=>{globalThis.__e2eMonsterBehaviour||=Object.fromEntries(Object.entries(G.monsters).map(([type,d])=>[type,{aggro:d.aggro,peaceful:d.peaceful}]));
    for(const type of Object.keys(G.monsters)){G.monsters[type].aggro=0;G.monsters[type].peaceful=true;}
    for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{})){m.aggro=0;m.peaceful=true;
      if(m.target){const p=players[name_to_id[m.target]];m.target=null;if(p)reduce_targets(p,m);}}return true;})()`);
}
const catalogBehaviourRestore=`output=(()=>{const kept=globalThis.__e2eMonsterBehaviour;if(!kept)return 0;let restored=0;
    for(const [type,own] of Object.entries(kept)){const d=G.monsters[type];if(!d)continue;
      for(const key of ['aggro','peaceful']){if(own[key]===undefined){if(key in d){delete d[key];restored++;}}else if(d[key]!==own[key]){d[key]=own[key];restored++;}}}
    for(const instance of Object.values(instances))for(const m of Object.values(instance.monsters||{})){const own=kept[m.type];if(!own)continue;
      if(m.peaceful!==own.peaceful){if(own.peaceful===undefined)delete m.peaceful;else m.peaceful=own.peaceful;restored++;}
      if(own.aggro!==undefined&&m.aggro!==own.aggro){m.aggro=own.aggro;restored++;}}
    return restored;})()`;
// An event boss that neither dies nor hurts: it holds the occurrence open until the
// scenario ends it. Its server status entry (E) is what the console reads as live.
export async function seedBoss(live:LiveGame,placement:keyof typeof bosses):Promise<Boss>{
  const at=bosses[placement];
  return live.admin(`output=(()=>{const type=${JSON.stringify(at.type)},original=G.monsters[type];
    const configured={...original,hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,rage:0,peaceful:true,spawns:[]};
    try{G.monsters[type]=configured;
      const m=new_monster(${JSON.stringify(at.map)},{type,count:1,boundary:[${at.x},${at.y},${at.x},${at.y}]},{temp:1});
      m.e2eBoss=true;m.zone_stats={...configured};
      E[type]={live:true,id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();
      return {id:String(m.id),type,map:m.map,x:m.x,y:m.y};
    }finally{G.monsters[type]=original;}})()`);
}
// The occurrence ends the way the server ends it: the boss goes and its status entry with
// it. During Halloween the server announces the next Mr. Green as soon as none lives
// (node/server_functions.js eventmap: E.mrgreen = {live: false, spawn} 120 s ahead), and
// the console stages for that announced round. The fixture holds the next round's timer an
// hour out, so the occurrence ends.
export async function endEvent(live:LiveGame,type:string){
  return live.admin(`output=(()=>{const type=${JSON.stringify(type)};for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))
    if(m.e2eBoss&&m.type===type)remove_monster(m,{silent:true});
    if(typeof timers!=='undefined')timers[type]=future_s(3600);delete E[type];broadcast_e();return Date.now();})()`);
}

// Records, on one character, every movement ring entry, every completed heartbeat,
// every join packet and join refusal, and a 250 ms sample of what holds it.
export const probe=`(()=>{if(globalThis.__e2eRejoin)return true;const s=globalThis.__e2eRejoin={records:new Map(),journeys:new Map(),reports:[],samples:[],joins:[],replies:[],towns:[],base:{...(__partyMovement.ownerReport().invariants||{})}};
  const socket=parent.socket,emit=socket.emit;
  socket.emit=function(event,data,...rest){if(event==='join')s.joins.push({at:Date.now(),name:data&&data.name});
    if(event==='town')s.towns.push({at:Date.now(),map:character.map});return emit.call(this,event,data,...rest);};
  const onResponse=r=>{const response=typeof r==='string'?r:r&&r.response;
    if(['cant_join','join_too_late','cant_when_sick','cant_in_bank'].includes(response))s.replies.push({at:Date.now(),response});};
  socket.on('game_response',onResponse);
  let seen=globalThis.__partyStatusSuccessAt;
  const timer=setInterval(()=>{const at=globalThis.__partyStatusSuccessAt;if(at!==seen){seen=at;s.reports.push(at);}
    for(const r of __partyMovement.records())s.records.set(r.seq,r);
    const last=__partyMovement.last();if(last?.id)s.journeys.set(last.id,{walking:last.walkingDistance??0,end:last.end,engine:last.engine,detours:last.routeAggro?.detours??0});
    const live=__partyMovement.live(),state=globalThis.partyCombatState||{},recovery=state.recovery||{};
    s.samples.push({at:Date.now(),rip:!!character.rip,map:character.map,x:character.real_x,y:character.real_y,moving:!!character.moving,
      live:live&&{kind:live.kind,owner:live.owner,journey:live.journey,paused:live.paused},stage:state.stage??null,phase:recovery.phase??null,trying:recovery.trying??null,climb:__partyMovement.climbing?.()?.activity??null,error:recovery.lastError??null,answer:recovery.answer??null,answeredAt:recovery.answeredAt??null,reunion:globalThis.__partyReunion?.phase??null});
    if(s.samples.length>6000)s.samples.shift();},250);
  s.undo=()=>{socket.emit=emit;socket.off('game_response',onResponse);clearInterval(timer);delete globalThis.__e2eRejoin;};return true;})()`;
// Installs the probe on one character and registers its undo, so the row's end puts back the
// socket's emit, its listener and the sampler.
export async function installProbe(live:LiveGame,name:string){
  await live.clients[name]!.run(probe);
  live.undo(`the rejoin probe on ${name}`,()=>live.clients[name]!.run('globalThis.__e2eRejoin?.undo()'));
}
export const harvest=`(()=>{const s=globalThis.__e2eRejoin;return {records:[...s.records.values()].sort((a,b)=>a.seq-b.seq),journeys:Object.fromEntries(s.journeys),reports:s.reports,samples:s.samples,joins:s.joins,replies:s.replies,towns:s.towns,speed:character.speed,
  invariants:(()=>{const now=__partyMovement.ownerReport().invariants;return now&&Object.fromEntries(Object.entries(now).map(([k,v])=>[k,v-(s.base[k]||0)]));})(),incidents:__partyMovement.incidents?.()??[]};})()`;

export const near=(c:any,p:{map:string;x:number;y:number},radius:number)=>!!c&&!c.rip&&c.map===p.map&&Math.hypot(c.x-p.x,c.y-p.y)<=radius;
// Inside a farm location's boundary grown by the margin, as `farming-zones.cjs` contains
// tests it; a location with no boundary is its point.
export function inZone(c:any,p:{map:string;x:number;y:number;boundary?:number[]},margin=FARM_MARGIN){
  if(!c||c.rip||c.map!==p.map)return false;
  const b=p.boundary;
  return b?c.x>=b[0]-margin&&c.x<=b[2]+margin&&c.y>=b[1]-margin&&c.y<=b[3]+margin:Math.hypot(c.x-p.x,c.y-p.y)<=margin;
}
// The farm of these scenarios: Main's Crabs, far enough from the respawn point
// (G.maps.main.on_death, spawn 5 at (-87, 673)) that standing at the spawn is not
// standing at the farm. Main's Goos lie within the margin of that spawn.
export const FARM_MONSTER='crab';
// The first time the character stands alive again after the death, from its own samples.
export function respawnedAt(h:any,deathAt:number){
  const deadAt=h.samples.find((s:any)=>s.at>=deathAt&&s.rip)?.at??deathAt;
  return h.samples.find((s:any)=>s.at>deadAt&&!s.rip)?.at??null;
}
// The longest run of samples, between `from` and `until`, where the living character
// stands with nothing that holds it: no journey, no hold, no combat pause, and no
// death recovery rung that waits for the next report. The bound is the largest
// report gap of the same run: the recovery steps on each completed report (step 3 item 3).
// `owned` marks the times another owner holds the member without a journey, such as the
// coordinator's event return waiting for its checkpoint walk.
export function idleRuns(h:any,from:number,until:number,owned:(at:number)=>boolean=()=>false){
  let longest=0,longestAt:number|null=null,start:number|null=null,reportGap=0;
  for(let i=1;i<h.reports.length;i++)reportGap=Math.max(reportGap,h.reports[i]-h.reports[i-1]);
  for(const s of h.samples.filter((s:any)=>s.at>=from&&s.at<=until)){
    // A running farm reunion (runtime/tasks/character/assignment.ts farmReunionTick) owns the member between its walks.
    const reunion=!!s.reunion&&!['complete','cancelled'].includes(s.reunion);
    const held=s.rip||s.moving||s.live||reunion||/waiting for the next report/.test(String(s.trying??''))||owned(s.at);
    if(held){start=null;continue;}
    const since:number=start??s.at;start=since;
    if(s.at-since>longest){longest=s.at-since;longestAt=since;}
  }
  return {longest,longestAt,reportGap,bound:reportGap};
}
// Step 8a item 7: the owner's per-tick invariants on one character, read from its own
// report as the change since the probe was installed: the counts last the runtime, which the
// owner table's rows share.
export function expectInvariants(h:any,name:string){
  expect(h.invariants,`${name} invariants`).toMatchObject({unowned:0,untimed:0});
}
// A rung that made no progress after `from` wrote a stuck record that names the rung,
// its activity and the time without progress, with its lead-up; the climb's activity
// in the samples never reads as stuck (Corrections from the move onto b9b5c91e).
export function stuckNamed(h:any,from:number){
  const stuck=h.incidents.filter((r:any)=>r.kind==='stuck'&&r.leadUp?.some((e:any)=>e.at>=from));
  return stuck.length>0&&stuck.every((r:any)=>!!r.rung&&!!r.trying&&!!r.activity&&Number.isFinite(r.noProgressMs)&&r.leadUp.some((e:any)=>e.decision==='climbing'))&&
    !h.samples.some((s:any)=>s.at>=from&&/stuck/i.test(String(s.climb??'')));
}
// Items 4 and 7 of the inventory, from one character's samples after `from`: the group
// task answers it acted on, and whether any death recovery state named a rung.
export function answers(h:any,from:number){
  const acted=h.samples.filter((s:any)=>s.at>=from&&s.answeredAt);
  return {stale:acted.filter((s:any)=>s.answeredAt<=from).length,kinds:[...new Set(acted.map((s:any)=>s.answer))],
    trying:h.samples.some((s:any)=>s.at>=from&&s.trying)};
}
// Route time: the planned walking distance of the journeys started in the window, at
// the character's speed (a time limit comes from route length at walk speed).
export function routeMs(h:any,from:number,until:number){
  const walking=h.records.filter((r:any)=>r.decision==='started'&&r.at>=from&&r.at<=until).reduce((sum:number,r:any)=>sum+(Number(h.journeys[r.journeyId]?.walking)||0),0);
  return walking/h.speed*1000;
}
export async function attach(info:TestInfo,name:string,body:unknown){
  await info.attach(name,{body:JSON.stringify(body,null,1),contentType:'application/json'});
}
// Fresh reports from both fighters, as every scenario's first step.
export async function partyReady(live:LiveGame){
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'merchant idle':false,'stand maintenance':false}});
  await expect.poll(async()=>{const s=await live.state();return fighters.every(n=>s.characters[n]?.runtime==='native'&&Date.now()-s.characters[n].seenAt<3000);},
    {timeout:60_000,message:'Both fighters must report'}).toBe(true);
}
// Both fighters deal damage to the boss, read from the client's own hit packets after `since`.
export async function hitBy(live:LiveGame,name:string,boss:Boss,since:number){
  return (await live.clients[name].events()).find((e:any)=>e.at>=since&&e.event==='hit'&&String(e.data?.id)===boss.id&&e.data?.hid===name&&e.data?.damage>0)?.at??null;
}

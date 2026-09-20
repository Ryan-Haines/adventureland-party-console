import type {Fight, Group, Member} from './grouped.ts';
import {targetIdentity} from './lost-target.ts';
import {resumeApproach, retryDestination} from './formation-recovery-progress.ts';
export interface RecoveryPoint {x:number;y:number}
export interface FormationRecoveryReport {
  target:string; at:number; goals?:RecoveryPoint[]; ack?:string;
  attempt?:number; outcome?:'arrived'|'failed'; reason?:string;
  remaining?:number;
  approachReady?:boolean;
}
export interface FormationRecovery {
  id:string; key:string; target:string; mover:string; goals:RecoveryPoint[];
  phase:'pausing'|'routing'|'retry'|'regrouping'|'failed';
  attempt:number; startedAt:number; phaseAt:number; retryAt?:number; coveredAt?:number;
  reason?:string;
  goal?:RecoveryPoint; failedGoals?:RecoveryPoint[]; resumeSince?:number;
}
function fresh(at:number|undefined,now:number):boolean {return at!==undefined && now-at<=3000 && at<=now+500;}
function samePlace(m:Member,t:Fight):boolean {
  const s=m.status;return !!s && s.map===t.map && s.in===t.in && s.server===t.server;
}
function unoccupied(m:Member):boolean {
  const s=m.status,g=s?.groupedCombat;
  return !!s && !!g && !s.activeEvent && !s.joinedEvent && !s.mapEvent && !g.travelCommand && !g.lootPending;
}
function peaceful(m:Member,now:number):boolean {
  const g=m.status?.groupedCombat;
  return !!g && fresh(g.currentAttackersAt,now) && !(g.currentAttackers||[]).length &&
    !(g.threats||[]).length && !(g.evidence||[]).some(e=>e.state==='pending');
}
function safeMember(m:Member,t:Fight,now:number):boolean {
  const s=m.status;
  return !!s && !m.cancelled && !s.rip && s.hp>0 && fresh(s.seenAt,now) && samePlace(m,t) && unoccupied(m) && peaceful(m,now);
}
function report(m:Member,r:FormationRecovery,now:number):FormationRecoveryReport|undefined {
  const p=m.status?.groupedCombat?.formationRecovery;
  return p?.ack===r.id && p.target===r.target && p.at>=r.startedAt && now-p.at<=3000 && p.at<=now+500 ? p:undefined;
}
function proposal(m:Member,t:Fight,now:number):RecoveryPoint[]|undefined {
  const p=m.status?.groupedCombat?.formationRecovery;
  if(p?.ack||p?.target!==targetIdentity(t)||!fresh(p.at,now))return;
  return validGoals(p.goals);
}
function validGoals(input:RecoveryPoint[]|undefined):RecoveryPoint[]|undefined {
  const goals=input?.filter(g=>Number.isFinite(g.x)&&Number.isFinite(g.y)).slice(0,16);
  return goals?.length?goals:undefined;
}
function retry(r:FormationRecovery,now:number,reason:string):FormationRecovery {
  return {...r,phase:r.attempt>=3?'failed':'retry',phaseAt:now,reason,
    failedGoals:[...(r.failedGoals||[]),r.goal || r.goals[(r.attempt-1)%r.goals.length]!],
    retryAt:now+(r.attempt===1?5000:15000)};
}
function begin(members:Member[],target:Fight,key:string,now:number):FormationRecovery|undefined {
  const mover=[...members].sort((a,b)=>Number(b.ctype==='priest')-Number(a.ctype==='priest')||a.name.localeCompare(b.name)).find(m=>proposal(m,target,now));
  if(!mover)return;
  return {id:JSON.stringify([key,targetIdentity(target),now]),key,target:targetIdentity(target),mover:mover.name,
    goals:proposal(mover,target,now)!,goal:proposal(mover,target,now)![0],phase:'pausing',attempt:1,startedAt:now,phaseAt:now};
}
function routing(r:FormationRecovery,members:Member[],now:number):FormationRecovery {
  const p=report(members.find(m=>m.name===r.mover)!,r,now);
  if(p?.attempt===r.attempt && p.outcome==='arrived')return {...r,phase:'regrouping',phaseAt:now};
  if(p?.attempt===r.attempt && p.outcome==='failed')return retry(r,now,p.reason||'route failed');
  return now-r.phaseAt>=30000 ? retry(r,now,'route timeout'):r;
}
function regroup(r:FormationRecovery,members:Member[],now:number,range:number):FormationRecovery|undefined {
  const anchor=members.find(m=>m.ctype==='priest')||members.find(m=>m.name===r.mover)!;
  const covered=members.every(m=>Math.hypot(m.status!.x-anchor.status!.x,m.status!.y-anchor.status!.y)<=Math.max(10,range-10));
  if(!covered)delete r.coveredAt;else r.coveredAt??=now;
  if(r.coveredAt!==undefined && now-r.coveredAt>=500)return;
  return now-r.phaseAt>=30000 ? {...r,phase:'failed',reason:'regroup timeout'}:r;
}
function advance(r:FormationRecovery,members:Member[],now:number,range:number):FormationRecovery|undefined {
  if(r.phase==='routing')return routing(r,members,now);
  if(r.phase==='regrouping')return regroup(r,members,now,range);
  if(r.phase==='pausing'){
    if(members.every(m=>report(m,r,now)?.ack===r.id))return {...r,phase:'routing',phaseAt:now};
    if(now-r.phaseAt>=30000)return {...r,phase:'failed',reason:'recovery pause acknowledgement timeout'};
  }
  if(r.phase==='retry' && now>=r.retryAt!)return retryDestination(r,report(members.find(m=>m.name===r.mover)!,r,now),now);
  return r;
}
/** Acknowledged pre-pull movement ownership; no attack may start while this exists. */
export function formationRecovery(previous:Group|null,members:Member[],target:Fight|null,key:string,now:number,paused:boolean,range:number):FormationRecovery|undefined {
  if(paused||!target||target.state!=='planned'||!members.length||!members.every(m=>safeMember(m,target,now)))return;
  const r=previous?.formationRecovery;
  if(!r || r.key!==key || r.target!==targetIdentity(target))return begin(members,target,key,now);
  return continueRecovery(r,members,now,range);
}
function continueRecovery(r:FormationRecovery,members:Member[],now:number,range:number):FormationRecovery|undefined {
  const current={...r};
  if(resumeApproach(current,members.map(m=>report(m,current,now)),now))return;
  return advance(current,members,now,range);
}

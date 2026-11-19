// The terrain recovery round on the coordinator,
// moved out of character/formation.ts so the character bundles carry only the member's recovery
// client. core:movement (runtime.ts) answers `movement.formationRecovery` with it on the coordinator,
// where targeting's queue (runtime/coordinator/targeting/queue.ts) asks it.
import type { Fight, Group, Member } from '../../coordinator/targeting/api.ts';
import type { FormationRecovery, FormationRecoveryReport, RecoveryPoint } from '../geometry/contracts.ts';
import { fresh, reportClockError, type WalkReading } from '../../protocol/reports.ts';
import { createOwnerLadder, type LadderState, type Rung } from '../../protocol/ladder.ts';

// The round's tries climb the one climber
// (runtime/protocol/ladder.ts `createOwnerLadder`): each untried staging
// goal is one rung, and `release`, the last, hands the target back to the queue. A try ends on its
// members' reports, never on a clock (CF4 W rows formation-recovery.ts:116,:125 and
// formation-recovery-client.ts:92): the mover's route end, whose journey's walking try ends a walk
// that stalls, or followers that report the cover out of reach.
type Recovery = FormationRecovery & { ladder?: LadderState };
// The round's rungs. A goal within 8 units of a failed one is not tried again in this round.
function recoveryRound(goals:RecoveryPoint[],failed:RecoveryPoint[]):Rung[] {
  const untried=(g:RecoveryPoint)=>Number.isFinite(g.x)&&Number.isFinite(g.y)&&!failed.some(f=>Math.hypot(f.x-g.x,f.y-g.y)<8);
  return [...goals.slice(0,16).map((goal,i):Rung=>({name:'goal-'+i,toward:true,
    attempt:at=>untried(goal)?{trying:'routing the mover to a staging goal',destination:{map:at.map,x:goal.x,y:goal.y},options:{}}:undefined})),
    {name:'release',toward:true,attempt:()=>({trying:'letting the queue pick another target',options:{}})}];
}
// Where the mover stands and how far it is from the target, as the climber reads progress.
function moverAt(m:Member|undefined,target:Fight){
  return {at:{map:m?.status?.map ?? target.map,x:Number(m?.status?.x),y:Number(m?.status?.y)},remaining:{transitions:0,walking:targetDistance(m,target)}};
}
function samePlace(m:Member,t:Fight):boolean {
  const s=m.status;return !!s && s.map===t.map && s.in===t.in && s.server===t.server;
}
function unoccupied(m:Member):boolean {
  const s=m.status,g=s?.groupedCombat;
  return !!s && !!g && !s.presence && !g.travelCommand && !g.lootPending;
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
  return p?.ack===r.id && p.target===r.target && p.at>=r.startedAt && fresh(p.at,now,'report',reportClockError(m.status)) ? p:undefined;
}
function proposal(m:Member,identity:string,now:number):RecoveryPoint[]|undefined {
  const p=m.status?.groupedCombat?.formationRecovery;
  if(p?.ack||p?.target!==identity||!fresh(p.at,now,'report',reportClockError(m.status)))return;
  return validGoals(p.goals);
}
function validGoals(input:RecoveryPoint[]|undefined):RecoveryPoint[]|undefined {
  const goals=input?.filter(g=>Number.isFinite(g.x)&&Number.isFinite(g.y)).slice(0,16);
  return goals?.length?goals:undefined;
}
function targetDistance(m:Member|undefined,t:{x:number;y:number}):number {
  return m?.status ? Math.hypot(m.status.x-t.x,m.status.y-t.y) : Infinity;
}
// A failed try, judged by the climber: a mover that got closer to the target, or onto a new map,
// starts the round again with every goal but the one that failed; otherwise that goal is left out
// of this round. The next goal is chosen from the mover's next report (retryDestination), which
// carries refreshed goals.
function tryFailed(r:Recovery,members:Member[],target:Fight,now:number,reason:string):Recovery {
  const failed=r.goal || r.goals[(r.attempt-1)%r.goals.length]!;
  const {at,remaining}=moverAt(members.find(m=>m.name===r.mover),target);
  const ladder=createOwnerLadder(recoveryRound(r.goals,r.failedGoals||[]),()=>now,r.ladder);
  const outcome=ladder.result({arrived:false,at,remaining});
  return {...r,phase:'retry',phaseAt:now,reason,ladder:ladder.state(),
    failedGoals:outcome==='progress'?[failed]:[...(r.failedGoals||[]),failed],trying:'choosing the next staging goal after: '+reason};
}
function begin(members:Member[],target:Fight,identity:string,key:string,now:number):Recovery|undefined {
  const mover=[...members].sort((a,b)=>Number(b.ctype==='priest')-Number(a.ctype==='priest')||a.name.localeCompare(b.name)).find(m=>proposal(m,identity,now));
  if(!mover)return;
  const {at,remaining}=moverAt(mover,target);
  return {id:JSON.stringify([key,identity,now]),key,target:identity,mover:mover.name,
    goals:proposal(mover,identity,now)!,goal:proposal(mover,identity,now)![0],phase:'pausing',attempt:1,startedAt:now,phaseAt:now,
    ladder:{index:0,rounds:0,failures:0,progressAt:now,nearest:remaining,visited:[at.map]},
    trying:'pausing attacks until every member acknowledges'};
}
function unreachableCoverage(r:FormationRecovery,members:Member[],now:number):boolean {
  const reports=members.map(m=>report(m,r,now));
  if(!members.every((m,i)=>m.status?.moving===false && reports[i]?.attempt===r.attempt &&
    reports[i]!.at>=r.phaseAt && reports[i]!.approachReady!==true &&
    !['planning','routing'].includes(reports[i]!.followerRoute||'')))return false;
  const mover=members.findIndex(m=>m.name===r.mover);
  return mover>=0 && reports[mover]?.coverageBlocked===true &&
    reports.every((p,i)=>i===mover || p?.followerRoute==='arrived' || p?.followerRoute==='unreachable') &&
    reports.some((p,i)=>i!==mover && p?.followerRoute==='unreachable');
}
function routing(r:Recovery,members:Member[],target:Fight,now:number):Recovery {
  const mover=members.find(m=>m.name===r.mover)!,p=report(mover,r,now);
  if(p?.attempt===r.attempt && p.outcome==='arrived')
    return {...r,phase:'regrouping',phaseAt:now,trying:'regrouping the members at the staging goal'};
  if(p?.attempt===r.attempt && p.outcome==='failed')return tryFailed(r,members,target,now,p.reason||'route failed');
  if(unreachableCoverage(r,members,now))return tryFailed(r,members,target,now,'coverage follower route unreachable');
  return r;
}
// The regroup stalls when every member's report since the regroup began shows it standing with its
// follow route ended (arrived or unreachable) and the cover still open: no member walks toward it.
function regroupStalled(r:Recovery,members:Member[],now:number):boolean {
  return members.every(m=>{const p=report(m,r,now);
    return m.status?.moving===false && p?.attempt===r.attempt && p.at>r.phaseAt && !['planning','routing'].includes(p.followerRoute||'');});
}
// The cover holds once each member's next report after the cover was first seen still shows it
// (CF4 W row formation-recovery.ts:116: the next fresh report carries it).
function regroup(r:Recovery,members:Member[],target:Fight,now:number,range:number):Recovery|undefined {
  const anchor=members.find(m=>m.ctype==='priest')||members.find(m=>m.name===r.mover)!;
  const gaps=members.map(m=>Math.hypot(m.status!.x-anchor.status!.x,m.status!.y-anchor.status!.y));
  const covered=gaps.every(g=>g<=Math.max(10,range-10));
  if(!covered)delete r.coveredAt;else r.coveredAt??=now;
  if(r.coveredAt!==undefined && members.every(m=>Number(m.status!.seenAt)>r.coveredAt!))return;
  return !covered && regroupStalled(r,members,now) ? tryFailed(r,members,target,now,'the members made no progress toward the anchor'):r;
}
// A member's acknowledgement of the pause is missed once it has reported for two of its report
// intervals since the pause began (A20's `walk` reading) without it.
function ackMissed(m:Member,r:Recovery,now:number):boolean {
  const s=m.status;
  return !!s && report(m,r,now)?.ack!==r.id && !fresh(r.phaseAt,Number(s.seenAt),walkReading(s));
}
const walkReading=(s:object):WalkReading=>({reading:'walk',attackerKnown:false,intervalMs:(s as {reportIntervalMs?:unknown}).reportIntervalMs});
function advance(r:Recovery,members:Member[],target:Fight,now:number,range:number):Recovery|undefined {
  if(r.phase==='routing')return routing(r,members,target,now);
  if(r.phase==='regrouping')return regroup(r,members,target,now,range);
  if(r.phase==='pausing'){
    if(members.every(m=>report(m,r,now)?.ack===r.id))return {...r,phase:'routing',phaseAt:now,trying:'routing the mover to a staging goal'};
    if(members.some(m=>ackMissed(m,r,now)))return {...r,phase:'failed',reason:'recovery pause acknowledgement missed'};
  }
  // The mover's next report after the failure chooses the next goal: the report-driven wait.
  const p=r.phase==='retry' ? report(members.find(m=>m.name===r.mover)!,r,now):undefined;
  if(p && p.at>r.phaseAt)return retryDestination(r,p,members,target,now);
  return r;
}
/** Acknowledged pre-pull movement ownership; no attack may start while this exists. */
export function formationRecovery(previous:Group|null,members:Member[],target:Fight|null,key:string,now:number,paused:boolean,range:number,identity:string):FormationRecovery|undefined {
  if(paused||!target||target.state!=='planned'||!members.length||!members.every(m=>safeMember(m,target,now)))return;
  const r=previous?.formationRecovery;
  if(!r || r.key!==key || r.target!==identity)return begin(members,target,identity,key,now);
  return continueRecovery(r,members,target,now,range);
}
function continueRecovery(r:Recovery,members:Member[],target:Fight,now:number,range:number):Recovery|undefined {
  const current={...r};
  if(resumeApproach(current,members.map(m=>report(m,current,now))))return;
  return advance(current,members,target,now,range);
}
// The recovery round's progress: the resume check and the next goal after a failed try.
// The approach resumes on the reports that acknowledge the current try with every member ready
// (CF4 W row formation-recovery.ts:116: the next fresh report carries the acknowledgement).
function resumeApproach(r:FormationRecovery,reports:(FormationRecoveryReport|undefined)[]):boolean {
  if(r.phase==='failed')return false;
  return reports.length>0 && reports.every(p=>p?.approachReady===true && p.attempt===r.attempt);
}

// The climber's next rung from the mover's refreshed goals: a goal to route to, or `release`, which
// lets the queue pick another target (queue.ts).
function retryDestination(r:Recovery,p:FormationRecoveryReport|undefined,members:Member[],target:Fight,now:number):Recovery {
  const goals=validGoals(p?.goals) || r.goals;
  const ladder=createOwnerLadder(recoveryRound(goals,r.failedGoals||[]),()=>now,r.ladder);
  const attempt=ladder.next(moverAt(members.find(m=>m.name===r.mover),target).at);
  if(attempt.rung==='release')return {...r,ladder:ladder.state(),phase:'failed',phaseAt:now,reason:'no untried safe recovery destination',trying:attempt.trying};
  const goal={x:attempt.destination!.x,y:attempt.destination!.y};
  return {...r,ladder:ladder.state(),goal,goals:goals.slice(0,16),phase:'routing',attempt:r.attempt+1,phaseAt:now,
    trying:'routing the mover to another staging goal'};
}
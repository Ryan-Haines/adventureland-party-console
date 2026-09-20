import type {FormationRecovery,FormationRecoveryReport,RecoveryPoint} from './formation-recovery.ts';

export function resumeApproach(r:FormationRecovery,reports:(FormationRecoveryReport|undefined)[],now:number):boolean {
  if(r.phase==='failed')return false;
  const ready=reports.length>0 && reports.every(p=>p?.approachReady===true && p.attempt===r.attempt);
  if(!ready){delete r.resumeSince;return false;}
  r.resumeSince??=now;
  return now-r.resumeSince>=500;
}

export function retryDestination(r:FormationRecovery,p:FormationRecoveryReport|undefined,now:number):FormationRecovery {
  const candidates=p?.goals || r.goals;
  const valid=(g:RecoveryPoint)=>Number.isFinite(g.x)&&Number.isFinite(g.y) &&
    !(r.failedGoals||[]).some(f=>Math.hypot(f.x-g.x,f.y-g.y)<8);
  const goal=candidates.find(valid);
  if(!goal)return {...r,phase:'failed',phaseAt:now,reason:'no untried safe recovery destination'};
  return {...r,goal,goals:candidates.slice(0,16),phase:'routing',attempt:r.attempt+1,phaseAt:now};
}

import type { SharedState, SharedConvoy, RoutePoint } from './shared-route-types.ts';
import { reportMatches } from './shared-route-types.ts';
import { recordConvoyHistory } from './convoy-history.ts';
import { classifyTravelDefense } from './travel-defense.ts';

export interface ReturnTownPolicy {
  map: string;
  interruptions: number;
  walking: boolean;
  lastRound?: string;
  sawAggro?: boolean;
  blockedReadiness?: string;
}
export interface ReturnTownAttempt {
  round: string;
  map: string;
  state: 'casting' | 'interrupted' | 'complete' | 'unavailable';
  destination: RoutePoint;
}
export function returnWalking(c: { returnTown?: ReturnTownPolicy }, map?: string): boolean {
  return !!c.returnTown?.walking && (!map || c.returnTown.map === map);
}
/** Called only after the enclosing command/runtime/route identity is validated. */
export function recordTownAttempt(c: Pick<SharedConvoy, 'continuousReturn' | 'returnTown' | 'disableTown' | 'townRetry' | 'townRetryAt'>, attempt: ReturnTownAttempt, now: number): void {
  if (!c.continuousReturn || !['interrupted','unavailable'].includes(attempt.state)) return;
  const policy = c.returnTown ||= { map: attempt.map, interruptions: 0, walking: false };
  if (policy.map !== attempt.map || policy.lastRound === attempt.round) return;
  policy.lastRound = attempt.round;
  if(attempt.state==='interrupted')policy.interruptions++;
  policy.walking = true;
  c.disableTown = policy.walking;
  c.townRetry = true;
  c.townRetryAt = now;
}
export function observeReturnTown(state: SharedState, c: SharedConvoy, now: number): boolean {
  if (!c.continuousReturn || !state.statuses[c.leader]) return false;
  const lead = state.statuses[c.leader]!;
  c.returnTown ||= {map:lead.map,interruptions:0,walking:!!c.disableTown};
  const before = c.returnTown.walking;
  observeAttempts(state,c,now);
  updateTownPolicy(state,c,now);
  c.disableTown = c.returnTown.walking;
  if(c.purpose==='monster-hunt' && state.monsterHunt)state.monsterHunt.returnTown=c.returnTown;
  if(before===c.returnTown.walking && !c.townRetry)return false;
  c.returnTown.blockedReadiness ||= readiness(state,c);
  c.townRetry=false;
  recordConvoyHistory(state,c,c.disableTown?'Walking home while defending':'Aggro clear; Town eligible',now);
  return true;
}
function readiness(state:SharedState,c:SharedConvoy):string {
  return c.participants.map(n=>String(state.statuses[n]?.returnTownReady)).join(':');
}
function townUsable(state:SharedState,c:SharedConvoy,name:string):boolean {
  if(state.statuses[name]?.returnTownReady===true)return true;
  return returnReportMatches(state,c,name) && ['casting','complete'].includes(state.statuses[name]?.convoyNavigation?.townAttempt?.state || '');
}
function updateTownPolicy(state:SharedState,c:SharedConvoy,now:number):void {
  const policy=c.returnTown!, lead=state.statuses[c.leader]!;
  const observed=classifyTravelDefense(state,c.participants,now);
  if(observed.state==='waiting-for-observations')return;
  const changedMap=newMapReady(state,c,lead.map,lead.server,now);
  if(changedMap){policy.map=lead.map;policy.interruptions=0;}
  if(observed.state==='defending') {
    policy.sawAggro=true;policy.walking=true;
  } else if(!c.participants.every(n=>townUsable(state,c,n))) {
    policy.walking=true;policy.blockedReadiness ||= readiness(state,c);
  } else resumeTown(state,c,changedMap);
}
function resumeTown(state:SharedState,c:SharedConvoy,changedMap:boolean):void {
  const policy=c.returnTown!;
  const changedReady=!!policy.blockedReadiness && policy.blockedReadiness!==readiness(state,c);
  if(!changedMap && !policy.sawAggro && !changedReady)return;
  // Process a failed round before reconsidering its replacement.
  if(c.townRetry)return;
  policy.walking=false;policy.sawAggro=false;
  delete policy.blockedReadiness;
}

function returnReportMatches(state: SharedState,c: SharedConvoy,name: string): boolean {
  if(reportMatches(state,name))return true;
  const n=state.statuses[name]?.convoyNavigation, expected=c.expected?.[name];
  return !!n && !!expected && n.id===c.id && n.epoch===c.epoch && n.commandId===expected.commandId &&
    n.runtimeId===expected.runtimeId && n.navigationRevision===expected.revision;
}

function observeAttempts(state: SharedState,c: SharedConvoy,now:number): void {
  const before=c.returnTown!.interruptions;
  for(const name of c.participants) {
    if(!freshReturnMember(state,name,now))continue;
    if(!returnReportMatches(state,c,name))continue;
    const attempt=state.statuses[name]?.convoyNavigation?.townAttempt;
    if(attempt)recordTownAttempt(c,attempt,now);

  }
  if(c.townRetry)captureTownRally(state,c);
  if(before!==c.returnTown!.interruptions)recordConvoyHistory(state,c,'Town interrupted',now,{...c.returnTown});
}
function newMapReady(state:SharedState,c:SharedConvoy,map:string,server:string|undefined,now:number):boolean {
  return map!==c.returnTown!.map && c.participants.every(name=>{
    const s=state.statuses[name];
    return s && now-s.seenAt<3000 && !s.rip && s.map===map && s.server===server &&
      (c.phase==='assemble' || s.convoyNavigation?.transitionMap===map);
  });
}

function freshReturnMember(state:SharedState,name:string,now:number):boolean {
  const s=state.statuses[name];return !!s && now-s.seenAt<=3000 && now>=s.seenAt-500;
}

function captureTownRally(state:SharedState,c:SharedConvoy):void {
  for(const name of c.participants) {
    if(!returnReportMatches(state,c,name))continue;
    const attempt=state.statuses[name]?.convoyNavigation?.townAttempt;
    if(attempt?.destination)c.returnTownRally=attempt.destination;
  }
}

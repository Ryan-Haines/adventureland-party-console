import type { SharedState, SharedConvoy, RoutePoint } from './shared-route-types.ts';
import { reportMatches } from './shared-route-types.ts';
import { recordConvoyHistory } from './convoy-history.ts';
import { classifyTravelDefense } from './travel-defense.ts';

export interface ReturnTownPolicy {
  map: string;
  interruptions: number;
  walking: boolean;
  lastRound?: string;
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
  if (!c.continuousReturn) return false;
  const lead = state.statuses[c.leader];
  if (!lead) return false;
  c.returnTown ||= { map: lead.map, interruptions: c.disableTown ? 3 : 0, walking: !!c.disableTown };
  observeAttempts(state,c,now);
  avoidTownUnderFire(state,c,now);
  if (state.monsterHunt) state.monsterHunt.returnTown = c.returnTown;
  // Never reset on a Town warp, an epoch change, or a partially crossed door.
  if (!newMapReady(state,c,lead.map,lead.server,now))return false;
  const wasWalking = c.returnTown.walking;
  c.returnTown = { map: lead.map, interruptions: 0, walking: false };
  c.disableTown = false;
  delete c.returnTownRally;
  if (state.monsterHunt) state.monsterHunt.returnTown = c.returnTown;
  if (wasWalking) recordConvoyHistory(state, c, 'Town eligible on new map', now, { map: lead.map });
  return wasWalking;
}
function avoidTownUnderFire(state: SharedState,c: SharedConvoy,now:number): void {
  if (c.returnTown!.walking || classifyTravelDefense(state,c.participants,now).state !== 'defending') return;
  c.returnTown!.walking=true;c.disableTown=true;c.townRetry=true;c.townRetryAt=now;
  recordConvoyHistory(state,c,'Continuing Hunt return on foot under attack',now,{map:c.returnTown!.map});
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
    return s && now-s.seenAt<3000 && !s.rip && !s.moving && s.map===map && s.server===server &&
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
    if(attempt?.state==='complete')c.returnTownRally=attempt.destination;
  }
}
export function townOutcomesReady(state:SharedState,c:SharedConvoy,now:number):boolean {
  return c.participants.every(name=>{
    const s=state.statuses[name];
    return s && s.seenAt>=(c.townRetryAt || 0) && freshReturnMember(state,name,now) &&
      returnReportMatches(state,c,name) && s.convoyNavigation?.townAttempt?.state!=='casting';
  });
}

// Hunt travel's encounters: the observed attackers, the passive stops, the
// retirements and releases and the passing proposal, and updateHuntTravel, which runs them for one walk.
// The queue and the snapshot call it here, and movement's travel defense asks it through api.ts.
import { collectPassing, huntSwitchAllows, passingIdentity, passiveStopRequired, type PassiveTravelSettings } from '../../characters/targeting/api.ts';
import type { Fight, HuntTravelControl, HuntTravelConvoy, Member } from './api.ts';
import { huntDefense, outboundHunt } from '../../movement/api/coordinator.ts';
import type { WalkView } from '../../protocol/records.ts';
import { recoverLostTargets } from './unseen.ts';
import { fresh } from '../../protocol/reports.ts';
import { LIST_BOUNDS } from '../../characters/targeting/rules.ts';

export function stopCandidates(members: Member[], settings: PassiveTravelSettings | undefined, now: number): Fight[] {
  const fresh=observations(members,now).filter(m=>sampled(m,now)), names=members.map(m=>m.name);
  const candidates=fresh.flatMap(m=>(m.status?.groupedCombat?.travelCandidates||[]).filter(t=>
    t.map===m.status!.map && String(t.in??t.map)===String(m.status!.in??m.status!.map) && t.hp!==0 && (!t.target || names.includes(t.target)))
    .map(t=>({...t,server:m.status!.server,fighter:m.name,startedAt:now,state:'engaged' as const})));
  const dead=new Set(fresh.flatMap(m=>m.status?.groupedCombat?.deaths||[]).map(passingIdentity));
  return [...huntAttackers(members,now),...candidates].filter(t=>passiveStopRequired(settings,t.mtype) && !dead.has(passingIdentity(t)))
    .sort((a,b)=>(settings?.rules[b.mtype]?.priority||0)-(settings?.rules[a.mtype]?.priority||0)||passingIdentity(a).localeCompare(passingIdentity(b)));
}
function sampled(m: Member, now: number): boolean {
  const at=m.status?.groupedCombat?.currentAttackersAt;
  // The coordinator stamps the attackers' time on receipt (movement/coordinator/routes.ts `acceptTravelReport`), so it is never ahead.
  return !!at && fresh(at, now);
}
function observedAttackers(m: Member, names: string[], now: number): Fight[] {
  const s=m.status!;
  return (s.groupedCombat?.currentAttackers||[]).filter(t=>names.includes(t.target) && t.hp!==0 &&
    t.map===s.map && String(t.in??t.map)===String(s.in??s.map))
    .map(t=>({...t,server:s.server,fighter:m.name,startedAt:now,state:'engaged'}));
}
function unique(fights: Fight[]): Fight[] {
  return [...new Map(fights.map(t=>[passingIdentity(t),t])).values()];
}
function deaths(members: Member[]): string[] {
  return members.flatMap(m=>[...(m.status?.groupedCombat?.deaths||[]),...(m.status?.groupedCombat?.state?.deaths||[])]).map(passingIdentity);
}
export function huntAttackers(members: Member[], now: number): Fight[] {
  const fresh=observations(members,now), names=members.map(m=>m.name), dead=new Set(deaths(fresh));
  const passing=new Set(collectPassing(fresh,[],now).filter(t=>t.keepMoving).map(passingIdentity));
  return unique(fresh.filter(m=>sampled(m,now)).flatMap(m=>observedAttackers(m,names,now))).filter(t=>!dead.has(passingIdentity(t)) && !passing.has(passingIdentity(t)));
}
export type TravelState = NonNullable<HuntTravelConvoy['huntTravel']>;
export function freshAttackerObservations(members: Member[], now: number): boolean {
  return members.length > 0 && observations(members,now).length === members.length &&
    members.every(m=>sampled(m,now) && Array.isArray(m.status?.groupedCombat?.currentAttackers));
}
// A rare 07 rejected stops the walk under way as any passing monster does, as the earlier
// console's walk did (nothing wrote its huntTravel.rejected; pm-04 answer A).
export function liveAfterRelease(t: Pick<Fight,'id'|'server'|'map'|'in'>, state: TravelState, members: Member[]): boolean {
  const key=passingIdentity(t), after=state.released?.[key];
  if(state.retired?.includes(key))return false;
  if(after===undefined)return true;
  return members.some(m=> {
    const g=m.status?.groupedCombat;
    return (g?.currentAttackersAt||0)>after && [...(g?.currentAttackers||[]),...(g?.travelCandidates||[])]
      .some(e=>e.hp!==0 && passingIdentity({...e,server:m.status!.server})===key);
  });
}
function retainedEncounters(state: TravelState): Fight[] {
  return unique([...(state.committed||[]),...(state.primary?[state.primary]:[])]);
}
export function reconcileRetirements(state: TravelState, members: Member[], now: number): void {
  const fresh=observations(members,now);
  // The walk keeps the newest deaths up to the queue's tombstone bound, the list they come from. The
  // union alone kept every death of the walk, and the list rides on every status reply.
  state.retired=[...new Set([...(state.retired||[]),...deaths(fresh)])].slice(-LIST_BOUNDS.tombstones);
  const retired=new Set(state.retired);
  const retained=retainedEncounters(state).filter(t=>!retired.has(passingIdentity(t)));
  const recovery=recoverLostTargets(retained,members,state.searches,now);
  state.searches=recovery.searches;
  const lost=fresh.flatMap(m=>m.status?.groupedCombat?.state?.lostTargets||[]);
  for(const t of [...lost,...recovery.lost]) {
    const key=passingIdentity(t), released=state.released||={};
    released[key]=Math.max(released[key]||0,t.retiredAt);
  }
}
export function releaseIncidental(state: TravelState, members: Member[], now: number): void {
  const primary=state.primary;
  if(!primary || state.committed?.some(t=>passingIdentity(t)===passingIdentity(primary)))return;
  if(!freshAttackerObservations(members,now))return;
  if(huntAttackers(members,now).some(t=>passingIdentity(t)===passingIdentity(primary)))return;
  (state.released||={})[passingIdentity(primary)]=now;state.primary=null;
}
export function commitStop(state: TravelState, stops: Fight[], settings: PassiveTravelSettings | undefined): void {
  const stop=stops[0] || (state.primary && passiveStopRequired(settings,state.primary.mtype) ? state.primary : null);
  if(stop)state.committed=unique([...(state.committed||[]),stop]);
  if(state.committed?.length)state.reason='passive-setting';
}
export function passingProposal(state: TravelState, members: Member[], now: number, scope?: string): Fight | null {
  if(!scope)return null;
  const proposals=collectPassing(members,[],now).filter(t=>!t.keepMoving && t.admission?.scope===scope && liveAfterRelease({...t,server:t.server},state,members))
    .sort((a,b)=>(a.startedAt??a.at)-(b.startedAt??b.at)||passingIdentity(a).localeCompare(passingIdentity(b)));
  const first=proposals[0];
  return first ? {...first,server:first.server,fighter:members[0]?.name||'',startedAt:first.startedAt||now,state:'engaged'} : null;
}
// The fresh members, and the encounter reconcile in its three steps.
export function observations(members: Member[], now: number): Member[] {
  return members.filter(m=>!m.cancelled && m.status && !m.status.rip && m.status.hp>0 &&
    fresh(m.status.seenAt, now));
}
export function reconcileEncounters(state: TravelState, members: Member[], now: number, defending: boolean): void {
  reconcileRetirements(state,members,now);
  const fresh=observations(members,now), keep=(t:Fight)=>liveAfterRelease(t,state,fresh);
  state.committed=(state.committed||[]).filter(keep);
  if(state.primary && !keep(state.primary))state.primary=null;
  if(defending)releaseIncidental(state,members,now);
  if(!state.committed.length)delete state.reason;
}
export function reconcileStops(c:HuntTravelConvoy,state:TravelState,members:Member[],fresh:Member[],settings:PassiveTravelSettings|undefined,now:number):void {
  if(c.purpose==='anniversary-return') {
    state.committed=[];state.primary=huntAttackers(members,now)[0]||null;delete state.reason;
    return;
  }
  const stops=stopCandidates(members,settings,now).filter(t=>liveAfterRelease(t,state,fresh) && huntSwitchAllows(c,settings,t.mtype));
  commitStop(state,stops,settings);
}
export function selectPrimary(c: HuntTravelConvoy, state: TravelState, members: Member[], now: number, scope?: string): void {
  const attacker=huntAttackers(members,now).find(t=>liveAfterRelease(t,state,members));
  if(huntDefense(c) && attacker){state.primary=attacker;return;}
  state.primary ||= attacker || state.committed?.[0] || null;
  if(!state.primary && !huntDefense(c))state.primary=passingProposal(state,members,now,scope);
}
export function updateHuntTravel(c: HuntTravelConvoy, members: Member[], now: number, scope: string | undefined, settings: PassiveTravelSettings | undefined, passing: (walk: WalkView) => boolean): HuntTravelControl | undefined {
  // Targeting's passing column (`targeting.passing`) decides whether a passive stop or a second
  // attacker may stop this walk. The caller hands it in, since this module has no hook bus.
  if(!passing(c) || c.huntArrival)return undefined;
  const state=c.huntTravel ||= {primary:null,searches:{}};
  reconcileEncounters(state,members,now,huntDefense(c) || c.phase==='communication-hold');
  const fresh=observations(members,now);
  reconcileStops(c,state,members,fresh,settings,now);
  if(!outboundHunt(c) && !state.primary && !state.committed?.length)return undefined;
  selectPrimary(c,state,fresh,now,scope);
  return {id:c.id,epoch:c.epoch,primary:state.primary,defending:huntDefense(c),committed:state.committed,reason:state.reason};
}

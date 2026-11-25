import { collectPassing, passingIdentity } from '../../characters/targeting/api.ts';
// The grouped queue on the coordinator: the queue's
// reconcile and its parts, the group and its healing anchor, the locked pair, the nominations and
// their retentions, the claims, the fight's reset, the pursuit, the successor grant, the passing
// merge and the passing control. Each part kept its body when it moved here from its own file under
// runtime/combat/; the queue's types live in api.ts and the lost and unseen targets in unseen.ts.
import type { Death, Fight, Group, Member, Target } from './api.ts';
import { MONSTER_PRIORITY, pick } from '../../characters/targeting/saved-fields.ts';
import { passingAllows } from '../../characters/targeting/passing.ts';
import { passiveStopRequired, type PassiveTravelSettings } from '../../characters/targeting/api.ts';
import { partyHooks } from '../../hooks/index.ts';
import { boundFired } from '../../status/coordinator/api.ts';
import { fresh, memberView, notAhead, reportClockError, reportInterval } from '../../protocol/reports.ts';
import { samePlace } from '../../protocol/place.ts';
import { passiveLevelAllowed } from '../../hunting/api.ts';
import type { HuntTravelConvoy, HuntTravelControl } from './api.ts';
import { memberAvailable, recoverLostTargets, releaseUnseenPrimary, type LostTarget } from './unseen.ts';
import { updateHuntTravel } from './hunt-travel.ts';
import { GROUP_RANGE, LIST_BOUNDS, PURSUIT_PROGRESS, QUEUE_DEPTH, queueNominees, targetIdentity } from '../../characters/targeting/rules.ts';
import { QUEUE_PROTOCOL, currentQueue, restorableQueue } from '../../protocol/reports.ts';

export interface Candidate extends Target {priority?: number; passiveRare?: boolean}
export interface Evidence extends Target {server: string|undefined; at: number; startedAt?: number; action: string; state: 'pending' | 'engaged' | 'rejected'}
// `rejections` are the rares 07 rejected (`farming.focus`): each stays out of the queue until its
// time, and evidence started before its rejection stays dropped while 07 remembers it.
export type RareRejections = NonNullable<Group['rareRejections']>;
export function reconcileQueue(old: Group | undefined | null, members: Member[], leader: string, now: number, key: string, resetAt=0, pullsPaused=false, huntTarget: string | null = null, rejections: RareRejections = []) {
  const huntDefense=members.some(m=>m.status && fresh(m.status.seenAt,now) && m.status.groupedCombat?.huntDefense);
  const defending = new Set(members.flatMap(m => m.status && fresh(m.status.seenAt,now) && m.status.groupedCombat?.returnDefense
    ? (m.status.groupedCombat.currentAttackers || []).map(t => passingIdentity({...t,server:m.status!.server})) : []));
  // A farming Hunt takes ownership of its target, including attacks made en route.
  // Drop cached peer reports too: their normal expiry can otherwise block the pull.
  // Members pass more than LIST_BOUNDS.passing monsters in one passing memory only by a fault, so
  // each overflow reports.
  const passingEncounters=collectPassing(members,old?.passingEncounters||[],now,count=>boundFired({bound:'LIST_BOUNDS.passing',owner:'04',subject:key,state:{count}}))
    .filter(t=>(t.keepMoving || !huntDefense) && t.mtype!==huntTarget && (t.keepMoving || !defending.has(passingIdentity(t))));
  const passing=new Set(passingEncounters.map(passingIdentity));
  const failedRecovery=old?.formationRecovery;
  if(old && failedRecovery?.phase==='failed' && members.every(m=>m.status && fresh(m.status.seenAt,now) && m.status.groupedCombat?.formationRecovery?.ack===failedRecovery.id))
    old={...old,pursuitExclusions:[...(old.pursuitExclusions||[]),{identity:failedRecovery.target,until:now+pick('setAsideMs')}]};
  const memberFresh = (m: Member) => !!m.status && fresh(m.status.seenAt,now);
  const reports=members.filter(m=>memberFresh(m)&&(m.status!.groupedCombat?.epoch||0)>=resetAt);
  const rareRejections=rejections.filter(t=>(t.expiresAt??t.until)>now);
  // The checks below run once per evidence record and fight, so the rejections are indexed by
  // identity once per evaluation. Matching each record against the list re-serialized every
  // rejection and held the coordinator at a full core on the live console (2026-11-18).
  const rejectionsBy=new Map<string,RareRejections>();
  for(const r of rareRejections){const k=targetIdentity(r),list=rejectionsBy.get(k);if(list)list.push(r);else rejectionsBy.set(k,[r]);}
  const rejectionsFor=(t:Parameters<typeof targetIdentity>[0])=>rejectionsBy.size ? rejectionsBy.get(targetIdentity(t)) : undefined;
  const rejected=(t:Target & {server:string|undefined})=>!!rejectionsFor(t)?.some(r=>r.until>now);
  // A rejected rare's engaged fight and evidence stay for one report round after the rejection: every
  // fresh member reports its attackers once after it. The round's reports drop the fight unless one
  // of them shows the rare attacking a member; a fight kept stays while a member's latest attackers
  // report shows it.
  const droppedAtRejection=(t:Target & {server:string|undefined})=>!!rejectionsFor(t)?.some(r=>{
    const since=members.filter(memberFresh).map(m=>({m,g:m.status!.groupedCombat})).filter(({g})=>(g?.currentAttackersAt||0)>r.rejectedAt);
    return since.length>0 && since.length===members.filter(memberFresh).length && !since.some(({m,g})=>
      (g?.currentAttackers||[]).some(a=>passingIdentity({...a,server:m.status!.server})===passingIdentity(t)));
  });
  const abandoned=(e:Evidence)=>!!rejectionsFor(e)?.some(r=>(e.startedAt??e.at)<=r.rejectedAt) &&
    !old?.fights.some(f=>targetIdentity(f)===targetIdentity(e)&&f.state==='engaged'&&!droppedAtRejection(f));
  // A member's death report counts once it is no further ahead than the member's clock difference.
  const deaths: Death[]=[...(old?.deaths||[]).filter(d=>notAhead(d.at,now)),
    ...reports.flatMap(m=>(m.status!.groupedCombat?.deaths||[]).filter(d=>notAhead(d.at,now,reportClockError(m.status))))];
  // A member reports a kill with no monster type (shared.js `reportFightDeath`), so each tombstone
  // takes the type its target had in the queue or a fresh report, and keeps it while it stays:
  // survival's bad-luck record reads the type of each kill.
  const types=new Map<string,string>();
  for(const t of [...(old?.queue||[]),...(old?.fights||[]),...(old?.target?[old.target as Target & {server?:string}]:[]),
    ...members.filter(memberFresh).flatMap(m=>[...(m.status!.groupedCombat?.threats||[]),...(m.status!.groupedCombat?.sightings||[])].map(t=>({...t,server:m.status!.server}))),
    ...(old?.deaths||[])])if(t.mtype)types.set(targetIdentity(t),t.mtype);
  const typed=(d: Death): Death=>d.mtype||!types.has(targetIdentity(d))?d:{...d,mtype:types.get(targetIdentity(d))!};
  const tombstones=[...new Map(deaths.map(d=>[targetIdentity(d),typed(d)])).values()].slice(-LIST_BOUNDS.tombstones);
  const tombstoneIds = new Set(tombstones.map(targetIdentity));
  const lostTargets=[...((old?.lostTargets||[]).filter(t=>t.retiredAt>=resetAt))];
  const retired=(t:Target & {server:string|undefined},at?:number)=>lostTargets.some(l=>targetIdentity(l)===targetIdentity(t)&&(at===undefined||at<=l.retiredAt));
  const dead=(t: Target & {server:string|undefined})=>passing.has(passingIdentity(t)) || tombstoneIds.has(targetIdentity(t));
  const claims=releaseResetFights(old?.fights||[],reports,reconcileClaims(old?.claims||[],reports,now,resetAt),now).filter(c=>!tombstoneIds.has(targetIdentity(c)));
  const claimFor=(t: Target & {server:string|undefined})=>claims.find(c=>targetIdentity(c)===targetIdentity(t));
  const excluded=(t: Target & {server:string|undefined},at?:number)=>{
    const c=claimFor(t);return dead(t) || retired(t,at) || !!c && (c.external || at!==undefined && c.releasedAt!==undefined && at<=c.releasedAt);
  };
  // On a Hunt a member nominates the Hunt's monsters with no mark of its own, so an unreachable lock
  // waits out the leader's failed-approach mark in every nomination. The leader's notice carries the
  // mark's expiry (runtime/characters/targeting/retire.ts's unreachable lock, whose `until` is
  // install.ts `setAsideFor`'s set-aside), so the window has one source.
  const unreachable=(t:Target & {server:string|undefined})=>lostTargets.some(l=>l.reason==='unreachable'&&targetIdentity(l)===targetIdentity(t)&&l.until!==undefined&&now<l.until);
  const events=new Map((old?.evidence||[]).filter(e=>(e.startedAt??e.at)>=resetAt).map(e=>[e.action,e]));
  for(const m of reports) for(const e of m.status!.groupedCombat?.evidence||[]) {
    if(e.server!==m.status!.server || e.map!==m.status!.map || e.in!==m.status!.in || !notAhead(e.at,now,reportClockError(m.status)) || (e.startedAt??e.at)<resetAt)continue;
    const prior=events.get(e.action);
    if(!prior || e.at>prior.at || e.at===prior.at && prior.state==='pending')events.set(e.action,e);
  }
  const evidence=[...events.values()].filter(e=>!excluded(e,e.startedAt??e.at)&&!abandoned(e)&&(!rejected(e)||e.state==='engaged'&&!droppedAtRejection(e)));
  const fights=(old?.fights||[]).filter(f=>!excluded(f,f.startedAt)&&(!rejected(f)||f.state==='engaged'&&!droppedAtRejection(f))).map(f=>({...f,state:f.state||'engaged' as const}));
  for(const e of evidence) {
    let f=fights.find(f=>targetIdentity(f)===targetIdentity(e));
    if(e.state==='rejected')continue;
    if(!f) {f={...e,fighter:leader,startedAt:old?.queue?.find(t=>targetIdentity(t)===targetIdentity(e))?.startedAt??e.at,state:e.state};fights.push(f);}
    if(e.state==='engaged')f.state='engaged';
  }
  for(let i=fights.length-1;i>=0;i--) if(fights[i].state==='pending' && !evidence.some(e=>targetIdentity(e)===targetIdentity(fights[i]) && e.state!=='rejected'))fights.splice(i,1);
  for(const m of reports) for(const t of m.status!.groupedCombat?.threats||[]) {
    if(t.map!==m.status!.map || t.in!==m.status!.in)continue;
    const f={...t,server:m.status!.server,fighter:m.name,startedAt:old?.queue?.find(c=>targetIdentity(c)===targetIdentity({...t,server:m.status!.server}))?.startedAt??now,state:'engaged' as const};
    if(excluded(f,now) || claimFor(f)?.releasedAt!==undefined && !(m.status!.groupedCombat?.claims||[]).some(c=>targetIdentity(c)===targetIdentity(f)&&!c.external&&c.at>claimFor(f)!.releasedAt!))continue;
    const prior=fights.find(p=>targetIdentity(p)===targetIdentity(f));
    if(prior){prior.state='engaged';prior.x=t.x;prior.y=t.y;} else fights.push(f);
  }
  for(const m of reports) for(const t of m.status!.groupedCombat?.sightings||[]) {
    const f=fights.find(f=>targetIdentity(f)===targetIdentity({...t,server:m.status!.server}));
    if(f){f.x=t.x;f.y=t.y;f.fighter=leader;}
  }
  const selectedPlan=old?.queue?.find(t=>t.state==='planned' && old.target && targetIdentity(t)===targetIdentity(old.target as Fight) &&
    t.startedAt>=resetAt && !excluded(t,t.startedAt) && !fights.some(f=>targetIdentity(f)===targetIdentity(t)));
  const recovery=recoverLostTargets(selectedPlan?[...fights,selectedPlan]:fights,members,old?.searches||{},now);
  lostTargets.push(...recovery.lost);
  for(let i=fights.length-1;i>=0;i--)if(recovery.lost.some(t=>targetIdentity(t)===targetIdentity(fights[i])))fights.splice(i,1);
  // The leader's notice that it cannot reach its own lock target retires the lock the way a lost
  // target retires, once per notice made after the lock started. Another member's notice retires
  // nothing.
  const lock=old?.target?old.queue?.find(t=>targetIdentity(t)===targetIdentity({...(old.target as Target),server:(old.target as Fight).server??t.server})):undefined;
  const leaderReport=reports.find(m=>m.name===leader);
  const notice=lock&&leaderReport&&(leaderReport.status!.groupedCombat?.unreachable||[]).find(u=>u.id===lock.id&&u.map===lock.map&&u.in===lock.in&&u.at>=lock.startedAt);
  if(lock&&notice&&!lostTargets.some(l=>targetIdentity(l)===targetIdentity(lock)&&l.retiredAt>=notice.at)){
    lostTargets.push({...lock,retiredAt:now,reason:'unreachable',...(notice.until!==undefined?{until:notice.until}:{})});
    for(let i=fights.length-1;i>=0;i--)if(targetIdentity(fights[i])===targetIdentity(lock))fights.splice(i,1);
  }
  const selector=members.find(m=>m.name===leader);
  const s=selector?.status;
  const score=(t:Target)=>s ? Math.hypot(s.x-t.x,s.y-t.y) : Infinity;
  const reported = reports.flatMap(m => (m.status!.groupedCombat?.candidates || [])
    .filter(t => m.name === leader || t.passiveRare === true || t.mtype === huntTarget)
    .filter(t => m.status!.server === s?.server && t.map === m.status!.map && t.in === m.status!.in));
  const retained=retainNominations((old?.queue||[]).filter(t=>t.startedAt>=resetAt),members,now,old?.target);
  const unique:Candidate[] = s ? [...new Map<string,Candidate>([...reported,...retained].map(t => [targetIdentity({...t,server:s.server}),t])).values()] : [];
  const hookView={character:s,entities:{},party:members.map(m=>m.name),nomination:old?.target??null,event:null};
  const candidates=queueNominees((selector&&memberFresh(selector)?unique:[])
    .filter(t=>t.map===s?.map&&t.in===s?.in&&!excluded({...t,server:s!.server},now)&&!unreachable({...t,server:s!.server})&&!rejected({...t,server:s!.server})&&!(old?.pursuitExclusions||[]).some(e=>e.until>now&&e.identity===targetIdentity({...t,server:s!.server}))&&!fights.some(f=>targetIdentity(f)===targetIdentity({...t,server:s!.server})))
    .map(t=>({...t,server:s!.server,fighter:leader,startedAt:old?.queue?.find(c=>c.id===t.id&&c.map===t.map&&c.in===t.in)?.startedAt??now,state:'planned' as const,score:score(t)})),
    // The coordinator holds no game entities; the leader's report stands for the character.
    partyHooks().targeting,hookView);
  const released = releaseUnseenPrimary(old?.target, fights, candidates, members, recovery.searches, now, pullsPaused);
  if (released) {
    lostTargets.push(released);
    fights.splice(fights.findIndex(f => targetIdentity(f) === targetIdentity(released)), 1);
    delete recovery.searches[targetIdentity(released)];
  }
  const visibleThreat=(f:Fight)=>reports.some(m=>m.status!.server===f.server&&(m.status!.groupedCombat?.threats||[]).some(t=>t.id===f.id&&t.map===f.map&&t.in===f.in));
  const missingHead=old?.target && recovery.searches[targetIdentity(old.target as Fight)];
  const attacking=new Set(reports.filter(m=>fresh(m.status!.groupedCombat?.currentAttackersAt||0,now))
    .flatMap(m=>(m.status!.groupedCombat?.currentAttackers||[]).map(t=>passingIdentity({...t,server:m.status!.server}))));
  const defense=huntDefense ? fights.find(f=>attacking.has(passingIdentity(f))) : missingHead&&fights.find(visibleThreat);
  const priorFight=defense||fights.find(f=>old?.target && targetIdentity(f)===targetIdentity(old.target as Fight));
  const ordered=[...(priorFight?[priorFight]:[]),...fights.filter(f=>f!==priorFight).sort((a,b)=>a.startedAt-b.startedAt||a.id.localeCompare(b.id))];
  const held=old?.target && !ordered.length ? candidates.find(c=>targetIdentity(c)===targetIdentity(old.target as Fight)) : null;
  // A planned pull is the queue's own choice, not a fight, so an add-on's preference
  // (`targeting.prefers`) moves it to the preferred nominee of its M priority. An add-on that
  // answers nothing keeps the planned pull.
  const band=held ? candidates.filter(c=>(c.priority??MONSTER_PRIORITY.unset)===(held.priority??MONSTER_PRIORITY.unset)) : [];
  const preferred=band.length>1 && partyHooks().targeting.orders() ? partyHooks().targeting.prefers({...hookView,candidates:band}) : band;
  const planned=preferred!==band ? preferred[0]??held : held;
  const promoted=!planned && !ordered.length && old?.pairRevision && old.key===key ? old.queue.slice(1,QUEUE_DEPTH).map(t=>candidates.find(c=>targetIdentity(c)===targetIdentity(t))).find(Boolean) : null;
  const higherRare = planned && candidates.find(c=>c.passiveRare && (c.priority??MONSTER_PRIORITY.unset)>(planned.priority??MONSTER_PRIORITY.unset));
  let target=ordered[0]||higherRare||planned||promoted||candidates[0]||null;
  const pursuitResult=trackPursuit(old,target,candidates,members,now,key,pullsPaused,huntTarget);
  if(pursuitResult.replacement)target=candidates.find(c=>targetIdentity(c)===targetIdentity(pursuitResult.replacement!))||target;
  const queue=lockedQueue(old,target,ordered,candidates.filter(c=>!pursuitResult.pursuitExclusions.some(e=>e.identity===targetIdentity(c))),key);
  const revision=JSON.stringify([key,queue.map(t=>targetIdentity(t))]);
  // Evidence leaves on its target's reported death (a tombstone or a passing kill) or its retirement
  // as lost, both in `excluded` above, or on a reset. A target that dies where no member sees it
  // sends neither, so LIST_BOUNDS.events caps the list and each overflow reports.
  const kept=evidence.filter(e=>!retired(e,e.startedAt??e.at));
  if(kept.length>LIST_BOUNDS.events)boundFired({bound:'LIST_BOUNDS.events',owner:'04',subject:key,state:{count:kept.length}});
  return {passingEncounters,pursuit:pursuitResult.pursuit,pursuitExclusions:pursuitResult.pursuitExclusions,claims,rareRejections,lostTargets,searches:recovery.searches,fights:ordered,queue,target,queueRevision:revision,deaths:tombstones,evidence:kept.slice(-LIST_BOUNDS.events),
    threats:ordered.filter(f=>reports.some(m=>(m.status!.groupedCombat?.threats||[]).some(t=>targetIdentity({...t,server:m.status!.server})===targetIdentity(f))))};
}

// `scope` is the group's farming scope, whose placed add-on values `group.anchor` answers with.
export function evaluateGroup(previous: Group | null, members: Member[], leader: string, now: number, resetAt = 0, pullsPaused = false, huntTarget: string | null = null,
  rejections: RareRejections = [], scope?: unknown): Group {
  pullsPaused ||= members.some(m=>m.status && fresh(m.status.seenAt, now) && m.status.groupedCombat?.lootPending);
  // The independent approach's rules are movement's, asked through its published reads.
  const independentApproach=partyHooks().movement.independentApproach(members,now);
  const priest = healingAnchor(members, now, previous?.priest);
  // The `group.anchor` hook (runtime/hooks/registry.ts) may centre the formation on another
  // member; the spacing stays the healer's range, measured from that member. Each member carries its
  // last report.
  const answer = partyHooks().anchor(members.map(m => ({ ...memberView(m.name, m.ctype, m.status), ctype: m.ctype, available: available(m, now),
    positioning: m.status?.combat?.positioning })), scope);
  const anchorMember = members.find(m => m.name === answer && available(m, now)) || priest || members.find(m => m.name === leader);
  const anchor = anchorMember?.status, healer = priest?.status;
  const key = JSON.stringify(members.map(m=>[m.name,m.revision,m.cancelled, m.status?.combatSelection?.runtimeId]));
  const same = previous?.key === key;
  const range = priest ? Math.max(0, (healer?.range || 0) - Math.min(GROUP_RANGE.insetMax,Math.max(GROUP_RANGE.insetMin,(healer?.range || 0)*GROUP_RANGE.insetShare))) : GROUP_RANGE.noHealer;
  const blockers: string[] = [];
  const memberFresh = (s: Member['status']) => !!s && fresh(s.seenAt, now);
  const participating: string[] = [], recovering: string[] = [];
  const recoverySince: Record<string, number> = {};
  const anchorAvailable = !!anchor && memberFresh(anchor) && !anchor.rip && anchor.hp > 0 && !anchorMember?.cancelled &&
    !anchor.presence;
  for (const member of members) {
    const s = member.status;
    const hard = member.cancelled ? 'manual navigation' : !memberFresh(s) ? 'stale or missing report' :
      !s || s.rip || s.hp <= 0 ? 'dead' : !currentQueue(s.groupedCombat) ? 'waiting for updated combat runtime' :
      s.presence ? 'event owns character' :
      !anchorAvailable ? 'anchor unavailable' : !range ? 'healing range unavailable' : null;
    if (hard || !s || !anchor) { blockers.push(member.name + ': ' + hard); continue; }
    const together = s.server === anchor.server && samePlace(s, anchor);
    const gap = together ? Math.hypot(s.x-anchor.x,s.y-anchor.y) : Infinity;
    const visible = member.name === anchorMember?.name || s.groupedCombat?.anchorVisible === true;
    const separated = !together || !independentApproach && !visible && gap > range;
    const wasRecovering = !independentApproach && same && previous.recovering?.includes(member.name);
    if (separated || wasRecovering) {
      const covered = together && visible && gap <= Math.max(GROUP_RANGE.rejoinInset, range - GROUP_RANGE.rejoinInset);
      if (covered) recoverySince[member.name] = previous?.recoverySince?.[member.name] ?? now;
      const stable = covered && now - recoverySince[member.name]! >= pick('groupReadyMs');
      const acknowledged = !previous?.selection || s.groupedCombat?.ack === previous.selection;
      if (!stable || !acknowledged) { recovering.push(member.name); continue; }
    }
    participating.push(member.name);
  }
  const readySince = blockers.length ? null : same && previous.readySince !== null ? previous.readySince : now;
  const ready = readySince !== null && now-readySince >= pick('groupReadyMs');
  // Runtime/formation changes invalidate acknowledgements, never unfinished fights.
  // Reports retain the last coordinator state so a process restart can recover it.
  resetAt=Math.max(resetAt,previous?.resetAt||0,...members.map(m=>m.status?.groupedCombat?.state?.resetAt||0));
  const restored = (previous && (previous.resetAt||0)>=resetAt ? previous : null) || members.map(m=>m.status?.groupedCombat?.state)
    .find(g=>restorableQueue(g) && g.leader === leader && (g.resetAt||0)>=resetAt);
  const targetLeader = leader;
  const lostByIdentity=new Map<string,LostTarget>();
  for(const g of [restored,...members.map(m=>m.status?.groupedCombat?.state)])for(const t of g?.lostTargets||[])
    if(t.retiredAt>=resetAt && (!lostByIdentity.has(targetIdentity(t))||lostByIdentity.get(targetIdentity(t))!.retiredAt<t.retiredAt))lostByIdentity.set(targetIdentity(t),t);
  const recoveryState=restored?{...restored,lostTargets:[...lostByIdentity.values()]}:null;
  const result = reconcileQueue(recoveryState?.leader===leader ? recoveryState : null, members, leader, now, key, resetAt, pullsPaused || !ready || recovering.length > 0, huntTarget, rejections);
  const {passingEncounters, target, fights, threats, queue, queueRevision, deaths, evidence, claims, rareRejections, lostTargets, searches, pursuit, pursuitExclusions} = result;
  const fighterStatus = target && members.find(m=>m.name===target.fighter)?.status;
  const fighter = target && fighterStatus && memberFresh(fighterStatus) && !fighterStatus.rip && fighterStatus.hp>0 &&
    fighterStatus.server===target.server && fighterStatus.map===target.map && fighterStatus.in===target.in ?
    {name:target.fighter,map:target.map,in:target.in,server:target.server,x:fighterStatus.x,y:fighterStatus.y}:null;
  const selection = target ? fightSelection(key, target) : null;
  const observers=members.filter(m=>memberFresh(m.status)&&!m.status!.rip&&m.status!.hp>0&&m.status!.server===target?.server&&m.status!.map===target.map&&m.status!.in===target.in&&
    m.status!.groupedCombat?.sightings?.some(t=>t.id===target.id&&t.map===target.map&&t.in===target.in))
    .map(m=>({name:m.name,map:m.status!.map,in:m.status!.in,server:m.status!.server,x:m.status!.x,y:m.status!.y,seenAt:m.status!.seenAt}));
  const acknowledged = !!selection && participating.length > 0 && members.filter(m=>participating.includes(m.name)).every(m=>memberFresh(m.status) && m.status?.groupedCombat?.ack===selection);
  const pairAcknowledged = !!previous?.pairRevision && members.length>0 && members.every(m=>memberFresh(m.status) && m.status?.groupedCombat?.handoff?.pairAck===previous.pairRevision) && previous.queue.slice(0,2).some(t=>t.id===target?.id && t.server===(target as Fight)?.server && t.map===target?.map && t.in===target?.in);
  const preack = pairAcknowledged || !!previous?.queueRevision && members.length>0 && members.every(m=>memberFresh(m.status) && m.status?.groupedCombat?.queueAck===previous.queueRevision) && previous.queue.some(t=>t.id===target?.id && t.server===(target as Fight)?.server);
  // The terrain recovery round is movement's, asked through its published read with the target's
  // identity.
  const terrainRecovery=independentApproach?undefined:partyHooks().movement.formationRecovery(same ? previous : null,members,target,key,now,pullsPaused,range,target?targetIdentity(target):'');
  const confirmation=independentApproach && target?.state==='planned'?partyHooks().movement.confirmIndependentApproach(previous||undefined,members,selection,target.id,now):undefined;
  const approachReady=!independentApproach || target?.state!=='planned' || confirmation?.ready===true;
  const committed = approachReady && !terrainRecovery && !pursuit?.revoking && !!selection && (target?.state!=='planned' || !pullsPaused) && (target?.state==='engaged' || ready && recovering.length===0 &&
    (same && previous.selection===selection && previous.committed || acknowledged || preack));
  if(!approachReady)blockers.push('waiting for every fighter to confirm native attack range');
  if (!blockers.length && !ready) blockers.push('waiting for stable formation');
  const priorTiming=previous?.selection===selection ? previous.handoffTiming : undefined;
  const handoffTiming=selection ? {selectedAt:priorTiming?.selectedAt??now,committedAt:committed ? priorTiming?.committedAt??now : null} : undefined;
  if (selection && !acknowledged && !committed) for (const m of members.filter(m=>participating.includes(m.name)))
    if (m.status?.groupedCombat?.ack!==selection) blockers.push(m.name+': awaiting target revision');
  if (pursuit?.reason) blockers.push(pursuit.reason);
  const transitionTrace=(restored?.transitionTrace||[]).slice(-LIST_BOUNDS.queueTrace);
  for(const prior of restored?.queue||[])if(prior.state==='planned'&&!queue.some(t=>targetIdentity(t)===targetIdentity(prior))) {
    const rejection=members.flatMap(m=>m.status?.groupedCombat?.retentions||[]).find(t=>t.id===prior.id&&!t.eligible);
    transitionTrace.push({at:now,target:prior.id,reason:'Nomination removed: '+(rejection?.reason||'queue priority, reset, or report eligibility changed')});
  }
  if(restored?.target?.id!==target?.id||lostTargets.length!==(restored?.lostTargets||[]).length)
    transitionTrace.push({at:now,target:target?.id||null,reason:lostTargets.length>(restored?.lostTargets||[]).length?'target retired as lost':'queue target changed'});
  return {independentConfirmation:confirmation?.confirmation,independentConfirmationRevision:confirmation?.revision??previous?.independentConfirmationRevision,independentReadiness:independentApproach?partyHooks().movement.independentReadiness(members):undefined,independentApproach,pairRevision:members.every(m=>m.status?.groupedCombat?.handoff?.capability===1)?pairRevision(key,resetAt,queue):null,passingEncounters,protocol:QUEUE_PROTOCOL, formationRecovery:terrainRecovery, pursuit, pursuitExclusions, lostTargets, searches, transitionTrace, resetAt, claims, rareRejections, observers, queue, queueRevision, deaths, evidence, fights, threats, fighter, targetLeader, participating, recovering, recoverySince, key,phase:!ready?'regrouping':!target?'ready':target.state==='engaged'?'engaged':target.state==='pending'?'attack-pending':committed?'approaching':'selecting',leader,
    handoffTiming,members:members.map(m=>m.name),priest:priest?.name || null,
    anchor:anchor && anchorMember && memberFresh(anchor) && !anchor.rip && anchor.hp>0 ?
      {name:anchorMember.name,map:anchor.map,in:anchor.in,server:anchor.server,x:anchor.x,y:anchor.y}:null,
    range,ready,readySince,seenAt:now,target,selection,committed,blockers};
}

// A member the group can centre on now: alive, fresh, owned by no event, with a range.
export function available(member: Member, now: number): boolean {
  const s = member.status;
  if (!s || member.cancelled || s.rip || s.hp <= 0) return false;
  if (s.presence) return false;
  return fresh(s.seenAt, now) && Number(s.range) > 0;
}
export function healingAnchor(members: Member[], now: number, previous?: string | null): Member | undefined {
  return members.filter(m => m.ctype === 'priest' && available(m, now))
    .sort((a, b) => Number(b.name === previous) - Number(a.name === previous) || a.name.localeCompare(b.name))[0];
}

const fightIdentity = (t: Fight) => JSON.stringify([targetIdentity(t), t.startedAt]);
export const fightSelection = (key: string, t: Fight) => JSON.stringify([key,t.id,t.server,t.map,t.in,t.startedAt]);
export function pairRevision(key: string, reset: number, queue: Fight[]): string | null {
  return queue.length >= 2 ? JSON.stringify([key,reset,queue.slice(0,2).map(fightIdentity)]) : null;
}
/** Lock two identities; observations and the third candidate remain live. */
function lockedQueue(old: Group | null | undefined, target: Fight | null, ordered: Fight[], candidates: Fight[], key: string): Fight[] {
  if (!target) return [];
  if(!old?.pairRevision)return [target,...ordered.filter(t=>t!==target),...candidates.filter(t=>t!==target)].slice(0,Math.max(QUEUE_DEPTH,ordered.length));
  const available = [...ordered,...candidates].filter(t=>targetIdentity(t)!==targetIdentity(target));
  const previous = old?.key===key ? old.queue : [];
  const next = previous.find(t=>targetIdentity(t)!==targetIdentity(target) &&
    available.some(c=>fightIdentity(c)===fightIdentity(t)));
  const retained = next && available.find(t=>fightIdentity(t)===fightIdentity(next));
  // Existing engaged fights and higher-priority rare encounters retain priority.
  const urgent = available.find(t=>t.state!=='planned' || (t as Fight & {passiveRare?:boolean}).passiveRare &&
    ((t as Fight & {priority?:number}).priority??MONSTER_PRIORITY.unset)>((retained as Fight & {priority?:number}|undefined)?.priority??MONSTER_PRIORITY.unset));
  const successor=urgent||retained||available[0];
  return [target,...(successor?[successor]:[]),...available.filter(t=>t!==successor)].slice(0,Math.max(QUEUE_DEPTH,ordered.length));
}

export interface Retention extends Target {eligible:boolean;reason?:string;at:number}

/** Absence needs every member's fresh observation; positive party sight wins. */
export function retainNominations(queue:Fight[],members:Member[],now:number,selected?:Target|null):Fight[] {
  const memberFresh=(m:Member)=>!!m.status && fresh(m.status.seenAt,now);
  if(members.some(m=>memberFresh(m)&&m.status!.groupedCombat?.retentionPaused))return [];
  return queue.filter(t=>t.state==='planned').flatMap(t=>{
    const votes=members.map(m=>{
      const s=m.status;if(!s||!memberFresh(m)||s.server!==t.server||s.map!==t.map||s.in!==t.in)return undefined;
      return s.groupedCombat?.retentions?.find(v=>v.id===t.id&&v.map===t.map&&v.in===t.in&&fresh(v.at,now,'report',reportClockError(s))&&v.at>=t.startedAt);
    });
    const positive=votes.filter(v=>v?.eligible).sort((a,b)=>b!.at-a!.at)[0];
    if(positive)return [{...t,...positive}];
    if(votes.some(v=>v&&v.reason!=='not visible'))return [];
    // The active approach already owns this last known position. Only a local
    // absence search (or explicit invalidation above) may retire its selection.
    if(selected && targetIdentity(t)===targetIdentity(selected))return [t];
    if(votes.every(Boolean))return [];
    // Legacy clients cannot establish retention; upgraded missing observers hold it.
    return members.some(m=>m.status?.groupedCombat?.retentions)?[t]:[];
  });
}

export interface ClaimObservation extends Death {external: boolean}
export interface ClaimState extends ClaimObservation {releasedAt?: number}
function reconcileClaims(previous: ClaimState[], members: Member[], now: number, resetAt: number) {
  const states = new Map(previous.map(c=>[targetIdentity(c),{...c}]));
  for (const member of members) {
    const s=member.status;
    if (!s || s.rip || s.hp<=0 || !fresh(s.seenAt, now) || s.presence) continue;
    const restored=s.groupedCombat?.state;
    if (restored && restored.seenAt>=resetAt && notAhead(restored.seenAt,now,reportClockError(s))) for(const c of restored.claims||[]) {
      if(c.at<resetAt || !notAhead(c.at,now,reportClockError(s)))continue;
      const id=targetIdentity(c), prior=states.get(id);
      const latest=!prior || c.at>prior.at || c.at===prior.at && c.external ? c : prior;
      states.set(id,{...latest,releasedAt:Math.max(c.releasedAt||0,prior?.releasedAt||0)||undefined});
    }
  }
  for (const member of members) {
    const s=member.status;
    if (!s || s.rip || s.hp<=0 || !fresh(s.seenAt, now) || s.presence) continue;
    for (const observation of s.groupedCombat?.claims || []) {
      if (observation.server!==s.server || observation.map!==s.map || observation.in!==s.in ||
          observation.at<resetAt || !fresh(observation.at, now, 'report', reportClockError(s))) continue;
      const id=targetIdentity(observation), prior=states.get(id);
      if (!prior && !observation.external) continue;
      if (prior && (prior.at>observation.at || prior.at===observation.at && prior.external)) continue;
      states.set(id,{...observation,releasedAt:observation.external ? Math.max(prior?.releasedAt||0,observation.at) : prior?.releasedAt});
    }
  }
  return [...states.values()];
}

function reports(members: Member[], fight: Fight, now: number): Member[] {
  return members.filter(m => m.status && !m.status.rip && m.status.hp > 0 && fresh(m.status.seenAt, now) &&
    m.status.server === fight.server && m.status.map === fight.map && m.status.in === fight.in);
}
function same(target: Target, fight: Fight): boolean {return target.id === fight.id && target.map === fight.map && target.in === fight.in;}
function active(member: Member, fight: Fight, now: number): boolean {
  const g = member.status!.groupedCombat;
  return !!g?.threats?.some(t => same(t,fight)) || !!g?.currentAttackers?.some(t => same(t,fight)) ||
    !!g?.evidence?.some(e => targetIdentity(e) === targetIdentity(fight) && (e.state === 'pending' || e.state === 'engaged' && now-e.at < pick('attackStallMs')));
}
// A won Cave practice trainer stays neutral at 1 HP, and the Cave server refuses every attack on a
// neutral actor (logic/cave_of_many_dreams.js `cave_hostile`, fork), so a neutral Cave side ends
// the fight without the refill.
function reset(sight: Target): boolean {
  if (sight.target !== null || !(Number(sight.hp) > 0)) return false;
  return sight.caveSide === 'neutral' || Number(sight.max_hp) > 0 && sight.hp === sight.max_hp;
}
/** An untargeting monster that is healed, or a neutral Cave actor, is no longer an unfinished fight. */
function releaseResetFights(fights: Fight[], members: Member[], claims: ClaimState[], now: number): ClaimState[] {
  const result = claims.slice();
  for (const fight of fights) {
    if (fight.state !== 'engaged' || now-fight.startedAt < pick('attackStallMs')) continue;
    const live = reports(members,fight,now);
    if (!live.length || live.some(m => active(m,fight,now))) continue;
    const sightings = live.flatMap(m => m.status!.groupedCombat?.sightings || []).filter(t => same(t,fight));
    if (![sightings.length > 0, sightings.every(reset)].every(Boolean)) continue;
    const index = result.findIndex(c => targetIdentity(c) === targetIdentity(fight));
    if (index >= 0 && result[index]!.external) continue;
    const release: ClaimState = {id:fight.id,map:fight.map,in:fight.in,server:fight.server!,at:now,external:false,releasedAt:now};
    if (index >= 0) result[index] = release; else result.push(release);
  }
  return result;
}

export interface ApproachReport {
  target: string; at: number; active: boolean; visible: boolean;
  intent: 'approach' | 'hold'; moving: boolean; displacement: number;
  deficit: number; coverage: number; blocked?: string | null;
  waypoint?: {key: string; remaining: number};
  destination?: {x: number; y: number} | null; issuedAt?: number;
}
interface Sample {x: number; y: number; deficit: number; coverage: number; visible: boolean; waypoint?: ApproachReport['waypoint']}
export interface Pursuit {
  identity: string; key: string; lastAt: number; idleMs: number;
  samples: Record<string, Sample>; revoking?: string; revokingAt?: number;
  reason?: string;
  replacementKind?: 'closer-hunt' | 'closer-target';
}
export interface PursuitExclusion {identity: string; until: number}

function usable(m: Member, current: Fight, now: number): boolean {
  const s = m.status, a = s?.groupedCombat?.approach;
  if (!memberAvailable(m) || !s || !a) return false;
  if (!sameServerPlace(s,current)) return false;
  return fresh(s.seenAt,now) && fresh(a.at,now,'report',reportClockError(s)) && a.target === targetIdentity(current) && a.active;
}
function sameServerPlace(s: NonNullable<Member['status']>, t: Fight): boolean {return s.server===t.server && samePlace(s,t);}
function samples(members: Member[]): Record<string, Sample> {
  return Object.fromEntries(members.map(m => {
    const s = m.status!, a = s.groupedCombat!.approach!;
    return [m.name, {x:s.x, y:s.y, deficit:a.deficit, coverage:a.coverage, visible:a.visible, waypoint:a.waypoint}];
  }));
}
function improved(before: Sample, after: Sample): boolean {
  if (!before.visible && after.visible) return true;
  if (Math.hypot(after.x-before.x, after.y-before.y) < PURSUIT_PROGRESS.move) return false;
  if (before.deficit-after.deficit >= PURSUIT_PROGRESS.close || before.coverage-after.coverage >= PURSUIT_PROGRESS.close) return true;
  return !!before.waypoint && before.waypoint.key === after.waypoint?.key &&
    before.waypoint.remaining-after.waypoint.remaining >= PURSUIT_PROGRESS.close;
}
function alternative(candidates: Fight[], current: Fight, exclusions: PursuitExclusion[]): Fight | undefined {
  return candidates.find(c => targetIdentity(c) !== targetIdentity(current) &&
    !exclusions.some(e => e.identity === targetIdentity(c)));
}

interface Result {pursuit?: Pursuit; pursuitExclusions: PursuitExclusion[]; replacement?: Fight}
function updateProgress(p: Pursuit, members: Member[], now: number, lastAt: number) {
  const snapshot = samples(members);
  const progress = members.some(m => !p.samples[m.name] || improved(p.samples[m.name], snapshot[m.name]));
  if (progress) {p.samples=snapshot; p.idleMs=0; if (!p.revoking) delete p.reason;}
  else p.idleMs += Math.min(Math.max(...members.map(m => reportInterval(m.status))), Math.max(0, now-lastAt));
}
function resolveRevocation(p: Pursuit, next: Fight | undefined, members: Member[], now: number, result: Result) {
  const acknowledged = members.every(m => m.status!.seenAt >= p.revokingAt! &&
    m.status!.groupedCombat?.pursuitAck === p.revoking);
  if (!acknowledged) return;
  if (!next) {delete p.revoking; delete p.revokingAt; delete p.replacementKind; delete p.reason; return;}
  if (!p.replacementKind) result.pursuitExclusions.push({identity:p.identity, until:now+pick('setAsideMs')});
  result.replacement=next;
  delete result.pursuit;
}
function considerReplacement(p: Pursuit, next: Fight | undefined, members: Member[], now: number, result: Result) {
  if (p.revoking) {resolveRevocation(p,next,members,now,result); return;}
  if (p.idleMs < pick('pursuitStallMs')) return;
  p.reason = next ? 'stalled pursuit; revoking pull authorization' : 'stalled pursuit; no eligible alternative';
  if (next) {p.revoking=JSON.stringify([p.key, p.identity, now]); p.revokingAt=now;}
}
function ordinary(current: Fight | null): current is Fight {
  return !!current && current.state === 'planned' && !(current as Fight & {passiveRare?:boolean}).passiveRare;
}
function previousPursuit(old: Group | null | undefined, identity: string, key: string): Pursuit | undefined {
  const p=old?.pursuit;
  return p?.identity===identity && p.key===key ? p : undefined;
}
function closerHunt(current: Fight, candidates: Fight[], members: Member[], leader: string, huntTarget: string | null): Fight | undefined {
  if (huntTarget && current.mtype !== huntTarget) return;
  const origin = members.find(m => m.name === leader)?.status;
  if (!origin) return;
  const distance = (t: Fight) => Math.hypot(t.x-origin.x,t.y-origin.y);
  return candidates.filter(t => (!huntTarget || t.mtype === huntTarget) && t.id !== current.id &&
    priority(t) >= priority(current) && distance(t) < distance(current) - (huntTarget ? 0 : PURSUIT_PROGRESS.closer))
    .sort((a,b) => distance(a)-distance(b))[0];
}
function priority(target: Fight): number {return (target as Fight & {priority?:number}).priority ?? MONSTER_PRIORITY.unset;}
function partyReady(members:Member[],current:Fight,now:number,paused:boolean):boolean {
  return !paused && members.length>0 && members.every(m=>memberAvailable(m) && !!m.status && fresh(m.status.seenAt,now) && sameServerPlace(m.status,current));
}
function huntReplacement(p: Pursuit, current: Fight, candidates: Fight[], members: Member[], old: Group | null | undefined,
  huntTarget: string | null, now: number, result: Result): boolean {
  const next = closerHunt(current,candidates,members,old?.leader || current.fighter,huntTarget);
  if (p.replacementKind) {resolveRevocation(p,next,members,now,result);return true;}
  if (!next || p.revoking) return false;
  p.replacementKind=huntTarget?'closer-hunt':'closer-target';p.reason='closer eligible monster; revoking pull authorization';
  p.revoking=JSON.stringify([p.key,p.identity,now]);p.revokingAt=now;
  return true;
}
/** Revocation is acknowledged with the same report that carries pending attack evidence. */
export function trackPursuit(old: Group | null | undefined, current: Fight | null, candidates: Fight[],
  members: Member[], now: number, key: string, paused: boolean, huntTarget: string | null = null): Result {
  const exclusions = currentExclusions(old,now);
  const result: Result = {pursuitExclusions:exclusions};
  if (!ordinary(current)) return result;
  const identity = targetIdentity(current), prior = previousPursuit(old,identity,key);
  const p: Pursuit = prior ? {...prior,lastAt:now} : {identity,key,lastAt:now,idleMs:0,samples:{}};
  result.pursuit = p;
  // A replacement already under way (its kind set) completes in the tick the locked pair forms; with
  // none under way, a locked pair keeps blocking a new one.
  if ((!old?.pairRevision || p.replacementKind) && partyReady(members,current,now,paused) && huntReplacement(p,current,candidates,members,old,huntTarget,now,result)) return result;
  if(recovering(old,current))return result;
  progressPursuit(p,prior,current,candidates,members,now,paused,result);
  return result;
}
function currentExclusions(old:Group|null|undefined,now:number):PursuitExclusion[] {return (old?.pursuitExclusions || []).filter(e=>e.until>now);}
function recovering(old:Group|null|undefined,current:Fight):boolean {return old?.formationRecovery?.target===targetIdentity(current);}
function progressPursuit(p:Pursuit,prior:Pursuit|undefined,current:Fight,candidates:Fight[],members:Member[],now:number,paused:boolean,result:Result):void {
  const active = !paused && members.length > 0 && members.every(m => usable(m, current, now));
  if (!active) {p.idleMs=0; p.samples={}; return;}
  updateProgress(p,members,now,prior?.lastAt ?? now);
  considerReplacement(p,alternative(candidates,current,result.pursuitExclusions),members,now,result);
}

export interface HandoffReport {
  capability: 1; pairAck: string | null; revokedAck?: string | null; consumed?: string | null;
}
export interface SuccessorGrant {
  id: string; recipients:{name:string;runtimeId:string}[]; pair: string; key: string; resetAt: number; predecessor: Fight; successor: Fight;
  selection: string; issuedAt: number; expiresAt: number; revoking?: boolean;
  hunt?: {owner: string; quest: string; count: number};
}
export interface HandoffPolicy { allowed: boolean; hunt?: {owner:string; quest:string; count:number; fresh:boolean} }
interface Ledger {grant?:SuccessorGrant;serial:number;boot:string; budgetKey?:string; count?:number; deaths?:Set<string>; debt?:number}
const ledgers = new WeakMap<object,Ledger>();
let bootSerial=0;
function liveAndFresh(m:Member,now:number):boolean {
  return !!m.status && fresh(m.status.seenAt,now) && !m.cancelled && !m.status.rip && m.status.hp>0;
}
function eligible(group:Group,members:Member[],policy:HandoffPolicy,now:number):boolean {
  if(!policy.allowed || !group.pairRevision || !group.ready || !group.committed || group.recovering.length || group.formationRecovery || group.pursuit?.revoking)return false;
  return members.length>0 && members.every(m=>liveAndFresh(m,now) && m.status?.groupedCombat?.handoff?.capability===1 &&
    m.status.groupedCombat.handoff.pairAck===group.pairRevision);
}
function budget(group:Group,policy:HandoffPolicy):boolean {
  const h=policy.hunt;
  if(!h)return true;
  if(!h.fresh || group.queue[0]?.mtype!==h.quest || group.queue[1]?.mtype!==h.quest)return false;
  const reserved=new Set([group.queue[0],...group.fights].filter(t=>t?.mtype===h.quest).map(targetIdentity));
  return h.count>reserved.size;
}
function promoted(grant:SuccessorGrant,group:Group):boolean {
  return group.key===grant.key && (group.resetAt||0)===grant.resetAt && !!group.target && fightIdentity(group.target as Fight)===fightIdentity(grant.successor) &&
    group.deaths.some(d=>targetIdentity(d)===targetIdentity(grant.predecessor));
}
function revoked(grant:SuccessorGrant,members:Member[],now:number):boolean {
  return now>=grant.expiresAt || grant.recipients.every(recipient=>members.some(m=>m.name===recipient.name && m.status?.combatSelection?.runtimeId===recipient.runtimeId && liveAndFresh(m,now) && m.status?.groupedCombat?.handoff?.revokedAck===grant.id));
}

function reserveObservedDeaths(ledger:Ledger,group:Group,policy:HandoffPolicy):HandoffPolicy {
  const h=policy.hunt;if(!h)return policy;
  const key=JSON.stringify([group.key,group.resetAt,h.owner,h.quest]);
  const deaths=new Set(group.deaths.map(targetIdentity));
  if(ledger.budgetKey!==key){ledger.budgetKey=key;ledger.count=h.count;ledger.deaths=deaths;ledger.debt=0;}
  const added=[...deaths].filter(id=>!ledger.deaths?.has(id)).length;
  const credited=Math.max(0,(ledger.count??h.count)-h.count);
  ledger.debt=Math.max(0,(ledger.debt||0)+added-credited);
  ledger.count=h.count;ledger.deaths=deaths;
  return {...policy,hunt:{...h,count:Math.max(0,h.count-ledger.debt)}};
}

// The grant notices (part 2): `targeting.granted` when a grant is issued and `targeting.revoked`
// when its revoke starts, each with the pair and the reason.
export type GrantNotice = (hook: 'targeting.granted' | 'targeting.revoked', payload: { group: string; predecessor: string; successor: string; reason: string }) => void;
/** Process-local grants are never resurrected from persisted/client group snapshots. */
export function authorizeSuccessor(scope:object,group:Group,members:Member[],policy:HandoffPolicy,now:number,tell:GrantNotice=()=>{}):void {
  let ledger=ledgers.get(scope);
  if(!ledger){ledger={serial:0,boot:JSON.stringify([now,++bootSerial])};ledgers.set(scope,ledger);}
  if(group.pairRevision)group.pairRevision=JSON.stringify([group.pairRevision,ledger.boot]);
  policy=reserveObservedDeaths(ledger,group,policy);
  delete group.successorGrant;
  if(reconcileGrant(ledger,group,members,policy,now,tell))return;
  if(!eligible(group,members,policy,now) || !budget(group,policy))return;
  issue(ledger,group,members,policy,now,tell);
}
function mustRevoke(grant:SuccessorGrant,group:Group,members:Member[],policy:HandoffPolicy,now:number):boolean {
  return !!grant.revoking || grant.pair!==group.pairRevision || !eligible(group,members,policy,now) || !budget(group,policy);
}
// Why a grant's revoke starts, in mustRevoke's order.
function revokeReason(grant:SuccessorGrant,group:Group,members:Member[],policy:HandoffPolicy,now:number):string {
  return grant.pair!==group.pairRevision ? 'pair changed' : !eligible(group,members,policy,now) ? 'not eligible' : 'kill budget spent';
}
function reconcileGrant(ledger:Ledger,group:Group,members:Member[],policy:HandoffPolicy,now:number,tell:GrantNotice):boolean {
  const grant=ledger.grant;
  if(grant && promoted(grant,group)) {
    // Death promotion is compatible with the previously authorized identity.
    ledger.grant=undefined;
  } else if(grant && mustRevoke(grant,group,members,policy,now)) {
    if(!grant.revoking)tell('targeting.revoked',{group:group.key,predecessor:grant.predecessor.id,successor:grant.successor.id,reason:revokeReason(grant,group,members,policy,now)});
    grant.revoking=true;
    if(!revoked(grant,members,now)) {
      group.successorGrant={...grant};
      if(group.target && !group.fights.some(t=>t.id===group.target!.id && t.state==='engaged'))group.committed=false;
      group.blockers.push('revoking successor authorization');return true;
    }
    ledger.grant=undefined;
  }
  return false;
}
function issue(ledger:Ledger,group:Group,members:Member[],policy:HandoffPolicy,now:number,tell:GrantNotice):void {
  const [predecessor,successor]=group.queue;
  if(!predecessor || !successor || successor.state!=='planned')return;
  // Renew only while the exact pair and its kill reservation are still eligible.
  const expiresAt=now+pick('successorGrantMs');
  if(!ledger.grant)tell('targeting.granted',{group:group.key,predecessor:predecessor.id,successor:successor.id,reason:'the pair and its kill reservation are eligible'});
  if(!ledger.grant)ledger.grant={recipients:members.map(m=>({name:m.name,runtimeId:m.status!.combatSelection!.runtimeId})),id:JSON.stringify([group.key,now,++ledger.serial]),pair:group.pairRevision!,key:group.key,
    resetAt:group.resetAt||0,predecessor:{...predecessor},successor:{...successor},selection:fightSelection(group.key,successor),issuedAt:now,expiresAt,
    ...(policy.hunt?{hunt:{owner:policy.hunt.owner,quest:policy.hunt.quest,count:policy.hunt.count}}:{})};
  ledger.grant.expiresAt=expiresAt;
  group.successorGrant={...ledger.grant};
}


export interface PassingControl {
  scope: string;
  ready: boolean;
  admitted: string[];
  hunt?: HuntTravelControl;
}
export interface PassingAcknowledgement { scope: string; tokens: string[]; at: number }

function memberReady(m:Member,scope:string,now:number):boolean {
  const s=m.status;
  if(!s || m.cancelled || s.rip || s.hp<=0)return false;
  const ack=s.groupedCombat?.passingAcknowledgement;
  if(!ack || !fresh(ack.at,now,'report',reportClockError(s),true))return false;
  return [!!s.combatSelection?.runtimeId,fresh(s.seenAt,now,'report',0,true),
    ack?.scope===scope].every(Boolean);
}

/** Reservations precede the game attack. Every participant must have installed
 * the exact encounter before the sender may fire; this never gates movement. */
export function passingControl(members: Member[], convoy: unknown, now: number, huntConvoy: HuntTravelConvoy | null, settings: PassiveTravelSettings | undefined): PassingControl {
  const ordered = [...members].sort((a, b) => a.name.localeCompare(b.name));
  const scope = JSON.stringify([convoy, ordered.map(m => [m.name, m.revision,
    m.status?.combatSelection?.runtimeId, m.status?.server, m.status?.map, m.status?.in])]);
  const ready = ordered.length > 0 && ordered.every(m => memberReady(m,scope,now));
  const encounters = collectPassing(ordered, [], now);
  // Targeting's own passing column (characters/targeting/passing.ts): this file is targeting's.
  const hunt=huntConvoy ? updateHuntTravel(huntConvoy,ordered,now,scope,settings,walk=>passingAllows(walk,'passive')) : undefined;
  const admitted = ready ? encounters.filter(e => e.admission?.scope === scope &&
    (e.keepMoving && settings?.rules[e.mtype]?.enabled && settings.rules[e.mtype].keepMoving && passiveLevelAllowed(settings.rules[e.mtype],e.level) ||
      !hunt || !hunt.reason && !passiveStopRequired(settings,e.mtype) && !hunt.defending && !!hunt.primary && passingIdentity(e)===passingIdentity(hunt.primary)) &&
    ordered.every(m => m.status?.groupedCombat?.passingAcknowledgement?.tokens.includes(e.admission!.token)))
    .map(e => e.admission!.token) : [];
  return { scope, ready, admitted, ...(hunt ? {hunt} : {}) };
}

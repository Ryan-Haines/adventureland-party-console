// The grouped queue's client on the character (queue-client.ts): the report the character
// sends, the reply it applies, the attack evidence and its retirement, the successor grant's
// client, the entity snapshot refresh and the passing admission's proposals.
import { eventFacts } from '../../events/api.ts';
import { ownClockError, reportInterval } from '../../protocol/reports.ts';
import { pick } from './saved-fields.ts';
import { type HandoffReport, type Evidence, type SuccessorGrant, type PassingAcknowledgement, type PassingControl } from '../../coordinator/targeting/queue.ts';
import { passingIdentity, type PassingEncounter } from './api.ts';
import type { Death, Group } from '../../coordinator/targeting/api.ts';
import { ENGAGED_MARGIN, LIST_BOUNDS, targetIdentity } from './rules.ts';
import { QUEUE_PROTOCOL } from '../../protocol/reports.ts';
import type { IndependentReady } from '../../movement/api/character.ts';
import type { Target } from '../turns/api.ts';
import type { TargetingMap, TargetingPorts, TargetingState } from './install.ts';
import type { ScopeHandle } from '../../lifecycle/api.ts';

/** Small adapter around the game globals; lifecycle belongs to the role runner, which hands it the
 * hook bus's notice. */
// `scope` is targeting's run scope handle, `act`: the queue tick and the position wake (claimed by the targeting owner) hold with
// the character, and a tick due while held runs once at release.
export function installQueueClient(root:any, shared:any, scope:ScopeHandle, notify?:(hook:'targeting.unreachable',payload:Record<string,unknown>)=>void) {
  root.partyQueueClient?.stop();
  let active=true,busy=false,waiting=false,dirty=false,signature='',sentAt=0,retryAt=0,revision='',serial=0;
  let sentAcknowledgement='';
  type Ready=IndependentReady;
  const readySignature=(ready?:Ready)=>[ready?.selection,ready?.target,ready?.ready,ready?.confirmation];
  const acknowledgement=(report:{groupedCombat?:{independentReady?:Ready;ack?:string|null;queueAck?:string|null;handoff?:HandoffReport}})=>JSON.stringify([report.groupedCombat?.ack,report.groupedCombat?.queueAck,report.groupedCombat?.handoff,readySignature(report.groupedCombat?.independentReady)]);
  // The status owner's character door (shared.js `partyStatus.character`): the handoff timing
  // (status/character/rings.ts), which records while the diagnostics lease names its ring, and the channel
  // reply's table A rows.
  const timing=root.partyStatus.character.handoffTiming;
  // Movement's character door (movement/character/install.ts): its coordinator clock, convoy and the
  // member's three recovery clients.
  const movement=root.partyMovement;
  const handoff=createSuccessorClient({now:()=>Date.now(),monotonic:()=>performance.now(),serverNow:()=>movement.coordinatorNow(),
    allowed:g=>!!shared.targeting.successorAllowed?.(g),live:g=>!!shared.targeting.successorVisible?.(g),trace:(stage,details)=>timing.event(stage,details)});
  const enabled=()=>!!(movement.convoyActive() || root.partyHunting.farm.grouped() || shared.targeting.passingEncounterReport?.().length || shared.targeting.passingTarget?.() || root.partyTasks.partyList().length);
  const independent=movement.independentApproachClient();
  const formation=movement.terrainRecoveryClient();
  const host=parent as any;
  // One report interval of this character: movement's measured gap, never below 1 s.
  const interval=()=>reportInterval({reportIntervalMs:root.__partyMovement?.reportInterval?.()});
  const passing=createPassingAdmission({now:()=>Date.now(),interval,reserve:(target,admission)=>shared.targeting.beginPassingAttack(target,admission,true)});
  const events:Evidence[]=host.__partyQueueEvidence||[];
  let claims:any[]=[];
  // The member's three recovery clients are movement's; the queue client builds each from
  // movement's own ports through its door, ticks it and stops it.
  const sight=movement.queueSightRecovery((id:string)=>{notify?.('targeting.unreachable',{character:character.name,target:id,why:'sight'});});
  host.__partyQueueEvidence=events;
  function trace(event:Evidence,reason:string){
    const entries=root.__partyQueueEvidenceTrace ||= [];
    entries.push({at:movement.coordinatorNow(),id:event.id,map:event.map,in:event.in,server:event.server,
      action:event.action,state:event.state,mode:root.partyHunting.farm.mode(),reason});
    if(entries.length>LIST_BOUNDS.clientTrace)entries.splice(0,entries.length-LIST_BOUNDS.clientTrace);
  }
  function reportEvidence(deaths:Death[]=root.__partyFightDeaths||[]){
    for(let i=events.length-1;i>=0;i--)if(shared.targeting.isPassingEncounter?.(events[i]))events.splice(i,1);
    retireDeadEvidence(events,deaths,event=>trace(event,'confirmed local death'));
    return events;
  }
  reportEvidence();
  function flush(){dirty=true;signature='';sentAt=0;tick();}
  function evidence(target:any,state:Evidence['state'],action?:string){
    if(!active||!target||shared.targeting.isPassingEncounter?.(target))return null;
    reportEvidence();
    const old=action ? events.findIndex(e=>e.action===action) : -1;
    if(action && old<0)return null; // Never recreate an invalidated action.
    if(!action && !root.partyHunting.farm.grouped())return null;
    if(old>=0){
      const previous=events[old];
      events[old]={...previous,state,at:movement.coordinatorNow(),startedAt:previous.startedAt??previous.at};
      trace(events[old],'action settled');
      flush();return action;
    }
    const report=shared.targeting.queueReport();
    const event:Evidence={id:target.id,mtype:target.mtype,map:character.map,in:character.in,server:report.server,x:target.x,y:target.y,
      action:action||character.name+':'+Date.now()+':'+(++serial),state,at:movement.coordinatorNow()};
    if((report.groupedCombat.deaths||[]).some((death:Death)=>sameEvidenceTarget(event,death)))return null;
    event.startedAt=event.at;
    events.push(event);
    while(events.length>LIST_BOUNDS.events){const i=events.findIndex(e=>e.state!=='pending');if(i<0)break;events.splice(i,1);}
    flush();return event.action;
  }
  function hit(data:any){
    const names=root.partyTasks.partyList();
    if(!data||!names.includes(String(data.hid||data.actor||'')))return;
    const target=get_entity(data.id);
    if(!target||target.type!=='monster')return;
    const report=shared.targeting.queueReport();
    const identity={id:target.id,map:character.map,in:character.in,server:report.server};
    const pending=reportEvidence().filter(e=>sameEvidenceTarget(e,identity)&&e.state==='pending');
    if(!pending.length && shared.targeting.sharedTargetId()!==target.id)return;
    if(!pending.length && (shared.targeting.queueReport().groupedCombat.epoch||0)>0)return;
    if(!pending.length && claims.some(c=>c.id===target.id&&c.map===character.map&&c.in===character.in&&c.releasedAt!==undefined))return;
    if(pending.length)pending.forEach(e=>evidence(target,'engaged',e.action));else evidence(target,'engaged');
  }
  let receivedRangeCommit='';
  function traceRangeCommit(group:Pick<Group,'selection'|'target'|'committed'|'independentConfirmation'>|null|undefined){
    const confirmation=group?.independentConfirmation;
    if(!group?.committed||!confirmation){receivedRangeCommit='';return;}
    const key=JSON.stringify([group.selection,confirmation.id]);if(key===receivedRangeCommit)return;
    receivedRangeCommit=key;timing.event('range-commit-received',{target:group.target?.id,selection:group.selection,confirmation:confirmation.id,
      serverAt:movement.coordinatorNow(),monotonic:performance.now()});
  }
  function apply(data:any){
    if(!active)return;
    shared.targeting.acceptCombatControl?.(data);
    passing.apply(data.passingControl,(data.passingEncounters||[]).filter((e:Target)=>shared.targeting.isPassingEncounter?.(e)),data.serverNow||0);
    const group=data.groupedCombat;
    claims=group?.claims||claims;
    for(let i=events.length-1;i>=0;i--)if(group?.lostTargets?.some((d:any)=>d.id===events[i].id&&d.map===events[i].map&&d.in===events[i].in&&d.server===events[i].server&&(events[i].startedAt??events[i].at)<=d.retiredAt)||group?.rareRejections?.some((d:any)=>events[i].state==='pending'&&d.id===events[i].id&&d.map===events[i].map&&d.in===events[i].in&&d.server===events[i].server)||group?.deaths?.some((d:any)=>d.id===events[i].id&&d.map===events[i].map&&d.in===events[i].in&&d.server===events[i].server)||
      group?.claims?.some((c:any)=>c.id===events[i].id&&c.map===events[i].map&&c.in===events[i].in&&c.server===events[i].server&&
        (c.external||c.releasedAt>=(events[i].startedAt??events[i].at))))events.splice(i,1);
    if(shared.targeting.sharedTargetId()!==group?.target?.id)sight?.reset();
    revision=data.combatRevision||revision;shared.targeting.acceptQueue(group);
    timing.selection(root.__partyGroupedCombat ?? group);traceRangeCommit(root.__partyGroupedCombat ?? group);root.partyRoleRunner?.wake();
    // A received selection/queue must not wait for the next reporting interval.
    if(acknowledgement(shared.targeting.queueAcknowledgement())!==sentAcknowledgement)flush();
  }
  // The channel's reply goes through the status owner's table A: the hunting owner's farming
  // section applies first, so this apply takes the lock under the reply's mode.
  const channelReply=(data:any)=>root.partyStatus.character.applyChannel(data,apply);
  function wait(){
    if(!active||!enabled()||waiting||Date.now()<retryAt)return;
    waiting=true;
    shared.targeting.queueRequest({combatWait:true,combatRevision:revision}).then(channelReply)
      .catch(()=>{retryAt=Date.now()+interval();})
      .finally(()=>{waiting=false;wait();});
  }
  let ticking=false;
  function tick(){
    // Reserving a passing encounter calls flush synchronously. The outer tick
    // publishes that fresh reservation; an in-flight report retains dirty until
    // its completion. Re-entering preparation here can reserve recursively.
    if(ticking){dirty=true;return;}
    ticking=true;
    try{tickOnce();}finally{ticking=false;}
  }
  function tickOnce(){
    if(!active||Date.now()<retryAt)return;
    if(!enabled())return;
    independent?.tick();
    if(independent?.report())formation?.stop();else formation?.tick();
    // Admission needs round trips through every participant. Start that exchange
    // while an eligible passing monster is still ahead; this never attacks it.
    const passingTarget=shared.targeting.walkingPassiveTarget?.(true);
    if(passingTarget)preparePassing(passingTarget,true);
    const id=shared.targeting.sharedTargetId(),entity=id&&get_entity(id);
    if(id)sight?.observe(id,character,!!(entity&&entity.visible&&!entity.dead));
    wait();
    if(busy)return;
    dirty=false;
    const report=shared.targeting.queueReport();report.groupedCombat.evidence=reportEvidence(report.groupedCombat.deaths).filter(e=>e.server===report.server&&e.map===character.map&&e.in===character.in);
    // A change to anything but a position sends at once. Positions, the character's own and each
    // listed monster's, ride with the next report the interval sends, since they
    // move every frame while anything walks, which sent about 23 reports a second per character.
    const still=(list:any)=>Array.isArray(list)?list.map((entry:any)=>entry&&typeof entry==='object'?{...entry,x:undefined,y:undefined}:entry):list;
    // A death sends at once only for a monster the party has a stake in: its target, its queue and
    // fights, and the claims, candidates, threats, sightings, attackers, passing encounters and
    // evidence this report carries. The list also holds every other death the character sees, other
    // players' kills among them, which arrived several times a second in the live cave.
    const gc=report.groupedCombat,group=root.__partyGroupedCombat;
    const stake=new Set<string>([shared.targeting.sharedTargetId(),group?.target?.id,...[group?.queue,group?.fights,gc.claims,gc.candidates,gc.threats,gc.sightings,gc.currentAttackers,gc.travelCandidates,gc.passingEncounters,gc.evidence]
      .flatMap((list:any)=>Array.isArray(list)?list.map((entry:any)=>entry?.id):[])].filter(Boolean).map(String));
    const deathsAtOnce=(gc.deaths||[]).filter((d:any)=>stake.has(String(d.id)));
    // The Hunt's countdown and the acknowledgement's build time move on every report, so the
    // signature compares them without those clocks; the report still carries both.
    const hunt=report.monsterHunt&&typeof report.monsterHunt==='object'?{...report.monsterHunt,remainingMs:undefined}:report.monsterHunt;
    const passingAck=gc.passingAcknowledgement&&typeof gc.passingAcknowledgement==='object'?{...gc.passingAcknowledgement,at:undefined}:gc.passingAcknowledgement;
    const next=JSON.stringify([report.hp,report.rip,report.lastDeath,report.groupedCombat.epoch,readySignature(report.groupedCombat.independentReady),still(report.groupedCombat.currentAttackers),still(report.groupedCombat.travelCandidates),report.groupedCombat.huntDefense,passingAck,still(report.groupedCombat.passingEncounters),report.groupedCombat.formationRecovery,report.groupedCombat.pursuitAck,report.groupedCombat.lootPending,report.groupedCombat.claims?.map((c:any)=>[c.id,c.map,c.in,c.server,c.external]),still(report.groupedCombat.candidates),still(report.groupedCombat.threats),still(report.groupedCombat.sightings),still(report.groupedCombat.evidence),deathsAtOnce,report.groupedCombat.queueAck,report.groupedCombat.ack,report.groupedCombat.handoff,hunt]);
    if(next===signature&&Date.now()-sentAt<interval())return;
    signature=next;sentAt=Date.now();busy=true;sentAcknowledgement=acknowledgement(report);
    const started=performance.now(),body={...report,combatOnly:true};
    // The shared transport stamps the atomic sample synchronously at send time.
    const pending:Promise<{combatReportReceipt?:unknown}>=shared.targeting.queueRequest(body);
    const sequence=body.travelSample?.sequence;
    timing.report({sequence,deaths:(report.groupedCombat.deaths||[]).map((d:Death)=>d.id),ack:report.groupedCombat.ack});
    pending.then(data=>{
      if(!active)return;
      timing.response({sequence,roundTripMs:Math.max(0,performance.now()-started),coordinator:data.combatReportReceipt});return channelReply(data);
    }).catch(()=>{signature='';retryAt=Date.now()+interval();})
      // A change that came while the report was out sends with the next game update (run.ts
      // `afterUpdate`), the cadence the position wake already keeps. Re-ticking on the reply sent one
      // report per round trip while a character moved: about 22 a second per character, 66 KB each,
      // on the live console (2026-11-18).
      .finally(()=>{busy=false;if(dirty)scope.afterUpdate(()=>{if(active&&dirty)tick();});});
  }
  const socket=host.socket;let wakeQueued=false;
  function nativePositionChanged(){
    if(!active||wakeQueued)return;wakeQueued=true;dirty=true;
    scope.queueMicrotask(()=>{wakeQueued=false;if(active)tick();});
  }
  scope.on(socket,'player',nativePositionChanged);scope.on(socket,'entities',nativePositionChanged);
  const timer=scope.setInterval(tick,pick('queueTickMs'));
  function preparePassing(target:Target,reserveOnly=false) {
    if(target.type!=='monster')return false;
    if(shared.targeting.convoyHoldDefenseTarget?.()?.id===target.id)return true;
    const report=shared.targeting.queueReport();
    const identity={...target,map:report.map,in:report.in,server:report.server,at:movement.coordinatorNow(),
      keepMoving:shared.targeting.walkingPassiveTarget?.(reserveOnly)?.id===target.id};
    if(!passing.prepare(identity,report.groupedCombat.passingEncounters))return false;
    if(!reserveOnly)shared.targeting.beginPassingAttack(target);
    return true;
  }
  const api={tick,flush,hit,evidence,events,reportEvidence,sight,formation,independent,timing,handoff,
    death(id:string){const next=handoff.death(id);if(next){shared.targeting.acceptQueue(next);timing.selection(next);root.partyRoleRunner?.wake();}flush();},preparePassing,passingAcknowledgement:passing.report,reset(){handoff.reset();events.length=0;sight?.reset();signature='';sentAt=0;},stop(){independent?.stop();formation?.stop();active=false;scope.off(socket,'player',nativePositionChanged);scope.off(socket,'entities',nativePositionChanged);scope.clearInterval(timer);}};
  // targeting's own reads take the client from the module's state; other owners still read
  // root.partyQueueClient.
  root.partyQueueClient=api;shared.targeting.state.queueClient=api;return api;
}

interface SuccessorPorts {
  now():number; monotonic():number; serverNow():number;
  allowed(grant:SuccessorGrant):boolean;
  live(grant:SuccessorGrant):boolean;
  trace(stage:string,details:Record<string,unknown>):void;
}
/** One death-gated promotion per grant; authoritative snapshots remain separate. */
export function createSuccessorClient(ports:SuccessorPorts) {
  let snapshot:Group|null=null,grant:SuccessorGrant|undefined,deadline=0,receipt=0;
  let consumed:string|null=null,revokedAck:string|null=null,promoted:Group|null=null;
  const valid=()=>!!grant && !grant.revoking && ports.monotonic()<deadline && ports.allowed(grant);
  function accept(next:Group|null):Group|null {
    if(next && snapshot && next.seenAt<snapshot.seenAt)return effective();
    if(next===promoted)return promoted;
    snapshot=next;
    if(!sameScope(next))promoted=null;
    const incoming=next?.successorGrant;
    if(incoming?.revoking) {
      revokedAck=incoming.id;promoted=null;grant=undefined;
      ports.trace('grant-revoked',{grant:incoming.id});return next;
    }
    receive(next);
    reconcilePromotion(next,incoming);
    return effective();
  }
  function sameScope(next:Group|null):boolean {
    return !!next && next.key===grant?.key && (next.resetAt||0)===grant?.resetAt;
  }
  function receive(next:Group|null):void {
    const incoming=next?.successorGrant;if(!incoming || !next)return;
    if(incoming.id!==consumed && next.seenAt>receipt) {
      const changed=grant?.id!==incoming.id;receipt=next.seenAt;grant=incoming;
      // The coordinator's clock may run ahead of this estimate by the measured clock difference,
      // so the grant ends that much earlier here and never outlives the coordinator's.
      deadline=ports.monotonic()+Math.max(0,Math.min(pick('successorGrantMs'),incoming.expiresAt-ports.serverNow()-ownClockError()));
      if(changed)ports.trace('grant-received',{grant:incoming.id,target:incoming.successor.id,expiresAt:incoming.expiresAt});
    }
  }
  function reconcilePromotion(next:Group|null,incoming:SuccessorGrant|undefined):void {
    if(promoted && next?.selection===promoted.selection) {
      promoted=null;grant=undefined;ports.trace('promotion-reconciled',{grant:consumed,target:next.target?.id});
    } else if(!incoming || incoming.id!==grant?.id) {promoted=null;grant=undefined;}
  }
  function effective():Group|null {
    if(!promoted)return snapshot;
    return valid() ? promoted : {...promoted,committed:false};
  }
  function death(id:string):Group|null {
    if(!snapshot || !grant || grant.id===consumed || id!==grant.predecessor.id)return null;
    if(!valid() || !ports.live(grant)) {
      ports.trace('promotion-blocked',{grant:grant.id,target:grant.successor.id,reason:!valid()?'expired or activity blocked':'successor unavailable'});return null;
    }
    if(!snapshot.target || targetIdentity(snapshot.target as SuccessorGrant['predecessor'])!==targetIdentity(grant.predecessor))return null;
    consumed=grant.id;
    const successor={...grant.successor};
    promoted={...snapshot,target:successor,selection:grant.selection,committed:!snapshot.independentApproach,pursuit:undefined,formationRecovery:undefined,
      queue:[successor,...snapshot.queue.filter(t=>t.id!==id && t.id!==successor.id)],
      handoffTiming:undefined,successorGrant:undefined};
    ports.trace('local-promotion',{grant:grant.id,target:successor.id,predecessor:id});
    return promoted;
  }
  function report():HandoffReport {
    return {capability:1,pairAck:snapshot?.pairRevision||null,revokedAck,consumed};
  }
  return {accept,death,report,effective,valid,reset(){snapshot=null;grant=undefined;promoted=null;deadline=0;receipt=0;consumed=null;revokedAck=null;}};
}

export interface EntityRefreshSample {
  enabled: boolean;
  context: string;
  target: string | null;
  // Coordinator selection is a reconciliation hint, never attack authorization.
  retainedTarget?: string | null;
  accepted: number;
}
export interface EntityRefreshDiagnostic {
  at: number;
  target: string;
  requests: number;
  reason: string;
}
interface RefreshPorts {
  now(): number;
  request(): boolean;
  report(diagnostic: EntityRefreshDiagnostic): void;
}

/** Reconcile cached sprites through the game's full snapshot; never infer death from age. */
export function createEntityRefresh(ports: RefreshPorts) {
  let context = '', accepted = 0, stalledAt: number | null = null;
  let requestedAt = -Infinity, requests = 0;
  function tick(sample: EntityRefreshSample): void {
    const now = ports.now();
    const target=sample.target || sample.retainedTarget;
    if (!sample.enabled || !target) { stalledAt = null; return; }
    if (context !== sample.context || accepted !== sample.accepted || stalledAt === null) {
      context = sample.context; accepted = sample.accepted; stalledAt = now;
    }
    // Target churn must not keep renewing the grace period for a phantom blocker.
    if (now - stalledAt < pick('attackStallMs') || now - requestedAt < pick('snapshotGapMs')) return;
    requestedAt = now;
    if (!ports.request()) return;
    ports.report({ at: now, target, requests: ++requests,
      reason: 'no accepted basic attack within the attack stall window; requested full entity snapshot' });
  }
  return { tick };
}

export function sameEvidenceTarget(a: Pick<Evidence, 'id' | 'map' | 'in' | 'server'>, b: Pick<Evidence, 'id' | 'map' | 'in' | 'server'>): boolean {
  return String(a.id) === String(b.id) && a.map === b.map && a.in === b.in && a.server === b.server;
}

/** Death cleanup runs even when scatter has stopped the grouped polling channel. */
export function retireDeadEvidence(events: Evidence[], deaths: Death[], retired: (event: Evidence) => void): void {
  for (let i = events.length - 1; i >= 0; i--) {
    if (!deaths.some(death => sameEvidenceTarget(events[i], death))) continue;
    retired(events[i]);
    events.splice(i, 1);
  }
}

export function createPassingAdmission(ports: {
  now(): number;
  // One report interval of this character.
  interval(): number;
  reserve(target: PassingEncounter, admission: NonNullable<PassingEncounter['admission']>): void;
}) {
  let control: PassingControl | null = null, receivedAt = 0, serial = 0, serverAt = -Infinity;
  let acknowledgement: PassingAcknowledgement | undefined;
  const proposals = new Map<string, { scope: string; token: string }>();
  const freshControl = () => !!control?.ready && ports.now()-receivedAt<ports.interval();
  function apply(next: PassingControl | undefined, encounters: PassingEncounter[], at: number) {
    if (!next || at < serverAt) return;
    serverAt = at; receivedAt = ports.now(); control = next;
    acknowledgement = { scope: next.scope, at, tokens: encounters.filter(e =>
      e.admission?.scope === next.scope && at - e.at < pick('passingMemoryMs')).map(e => e.admission!.token) };
  }
  function prepare(target: PassingEncounter, present?: PassingEncounter[]): boolean {
    if (!control || !freshControl()) return false;
    const key = passingIdentity(target);
    if(!target.keepMoving && control.hunt && (control.hunt.defending || control.hunt.reason || control.hunt.primary && passingIdentity(control.hunt.primary)!==key))return false;
    let proposal = proposals.get(key);
    const token=proposal?.token;
    if (!proposal || proposal.scope !== control.scope || present && !present.some(e=>e.admission?.token===token)) {
      proposal = { scope: control.scope, token: JSON.stringify([control.scope, key, ports.now(), ++serial]) };
      proposals.set(key, proposal);
      if (proposals.size > LIST_BOUNDS.proposals) proposals.delete(proposals.keys().next().value!);
      ports.reserve(target, proposal);
      return false;
    }
    return control.ready && control.admitted.includes(proposal.token);
  }
  return { apply, prepare, report: () => ports.now()-receivedAt<ports.interval() ? acknowledgement : undefined };
}

// The queue report's builders, the reply's acceptance, the evidence and the successor
// reads, moved from shared.js.
export function createQueueClient(t: TargetingMap, p: TargetingPorts, s: TargetingState) {
  function groupedFresh() {
    if ((character as any).cave && s.groupedCombat?.caveScope !== (character as any).cave.run + ':' + (character as any).cave.floor) return false;
    return s.groupedCombat && ((character as any).cave || s.groupedCombat.leader === p.tasks.membership.leader()) && s.groupedCombat.members.indexOf(character.name) >= 0 &&
      p.movement.fresh(s.groupedCombat.seenAt, Date.now() + p.walkState.clockOffset) &&
      s.groupedCombat.key.indexOf(JSON.stringify(p.walkState.runtimeId)) >= 0;
    }
  function groupedEntityReport(e: any) { return {id:e.id,mtype:e.mtype,level:e.level,map:character.map,in:character.in,x:e.x,y:e.y,hp:e.hp,max_hp:e.max_hp}; }
  function groupedThreatReports() {
    if (!t.view().groupedFarming) return [];
    var threats=Object.values(parent.entities || {}).filter(function(e: any) {
      return e && e.type==='monster' && e.visible && !e.dead && t.isAttackingPartyMember(e);
    }).map(t.groupedEntityReport);
    var hit=p.root.__partyDefensiveHit;
    if(hit && !t.isPassingEncounter(hit.target) && p.movement.fresh(hit.at,Date.now(),'report',0,true) && !s.fightDeaths.some(function(d: any){return d.id===hit.target.id;}))threats.push(hit.target);
    return threats;
    }
  function groupedSightings() {
    var current=s.groupedCombat && s.groupedCombat.target && get_entity(s.groupedCombat.target.id);
    if(current && current.visible && !current.dead)p.root.__partyTargetLastVisible={id:current.id,map:character.map,in:character.in,x:character.x,y:character.y,at:Date.now()};
    var observed=(s.groupedCombat && s.groupedCombat.queue || []).slice(), travel=typeof p.hunting.hunt.control === 'function' && p.hunting.hunt.control();
    if(travel)observed=observed.concat(travel.committed||[],travel.primary?[travel.primary]:[],t.travelStopCandidates());
    return observed.map(function(f: any) {return get_entity(f.id);})
      .filter(function(e: any) {return e && e.visible && !e.dead;}).map(function(e: any){return Object.assign(t.groupedEntityReport(e),{target:e.target || null},e.cave ? {caveSide:e.cave.side} : {});});
    }
  function unfinishedFight() { return t.view().groupedFarming && s.groupedCombat && s.groupedCombat.fights && s.groupedCombat.fights.length>0; }
  function groupedDefensiveTarget() {
    if(!t.view().groupedFarming || !s.groupedCombat || !s.groupedCombat.target)return null;
    var e=get_entity(s.groupedCombat.target.id);
    return e && e.visible && !e.dead && t.isAttackingPartyMember(e) ? e : null;
    }
  function groupedDefensePending() {
    if (!t.view().groupedFarming) return false;
    return !!t.groupedDefensiveTarget() || !!(t.groupedFresh() && s.groupedCombat.threats && s.groupedCombat.threats.length);
    }
  function engagedCombatTarget(){
    var id=p.root.partyRoleRunner&&p.root.partyRoleRunner.engagedTargetId&&p.root.partyRoleRunner.engagedTargetId(),entity=id&&get_entity(id);
    return entity&&entity.visible&&!entity.dead&&entity.hp>0?{id:String(id),map:character.map,in:character.in,server:t.view().reunionRealm,at:Date.now()+p.walkState.clockOffset}:null;
    }
  function activeCombatTarget() {
    var id=p.root.partyCombatState && p.root.partyCombatState.selectedTarget;
    var e=id && get_entity(id);
    return !character.rip && e && e.type==='monster' && e.visible && !e.dead && e.hp>0 ?
      {id:String(e.id),map:character.map,in:character.in,server:t.view().reunionRealm,at:Date.now()+p.walkState.clockOffset} : null;
    }
  function queueCandidates() {
    if ((character as any).cave) return (character as any).cave.paused ? [] : Object.values(parent.entities || {}).filter(t.dungeonCombatThreat)
      .map(function(e: any) { return Object.assign(t.groupedEntityReport(e), {priority: t.monsterPriority(e)}); });
    var diagnostic: any=p.root.__partyNomination={focus:t.view().monsterFocusNow.slice(),area:typeof p.walkState.partyLocation!=='undefined'&&p.walkState.partyLocation&&p.walkState.partyLocation.id,revision:p.walkState.intent.revision,rejected:{},eligible:[]};
    var encounter=p.root.__partyFarmingEngagement;
    if(encounter && !encounter.finished && !p.walkState.intent.cancelled) {
      var nominated=get_entity(encounter.target.id);
      return character.name===p.tasks.membership.leader() && nominated && nominated.visible && !nominated.dead && nominated.hp!==0 && !t.isExternallyClaimedMonster(nominated)
        ? [Object.assign(t.groupedEntityReport(nominated),{priority:t.monsterPriority(nominated),passiveRare:false})] : [];
    }
    var blocked=(typeof p.walks.localTravelCommand==='function' && p.walks.localTravelCommand()) || p.root.__partyTravelCombat && !p.walkState.intent.cancelled && p.root.__partyTravelCombat.revision >= (p.walkState.intent.revision || 0)?'travel intent':t.view().huntPending?'departure loot':
      p.walkState.convoyDefense?'convoy defense':p.walkState.convoyActive?'convoy travel':!t.view().groupedFarming?'event or independent combat':
      p.walkState.intent.cancelled?'manual navigation':p.tasks.assignment.combatRecoveryHolds()?'death recovery':null;
    if(blocked){diagnostic.blocked=blocked;return [];}
    var eligible=Object.values(parent.entities||{}).filter(function(e: any){return e && e.type==='monster' && e.visible && !e.dead &&
      !t.isKnownDead(e.id) && e.mtype!=='fieldgen0' &&
      !t.isExternallyClaimedMonster(e) && !t.isPassingEncounter(e) && (p.hunting.facts.focus.rare.candidate(e) || (character.name===p.tasks.membership.leader() || e.mtype===t.view().huntCombatTargetNow) && e.mtype!=='tinyp' &&
      (t.view().monsterFocusNow.indexOf('all')>=0 || t.view().monsterFocusNow.indexOf(e.mtype)>=0) &&
      !(s.setAside[e.id]>Date.now()));
    });
    var normal=p.hunting.farm.select(eligible.filter(function(e: any){return !p.hunting.facts.focus.rare.candidate(e);}));
    Object.values(parent.entities||{}).filter(function(e: any){return e && e.type==='monster' && e.visible && !e.dead;}).forEach(function(e: any){
      var reason=t.isExternallyClaimedMonster(e)?'external claim':s.setAside[e.id]>Date.now()?'failed approach':
        !p.hunting.facts.focus.rare.candidate(e)&&t.view().monsterFocusNow.indexOf('all')<0&&t.view().monsterFocusNow.indexOf(e.mtype)<0?'focus':
        !p.hunting.facts.focus.rare.candidate(e)&&character.name!==p.tasks.membership.leader()&&!(e.mtype===t.view().huntCombatTargetNow)?'follower':
        !p.hunting.facts.focus.rare.candidate(e)&&normal.indexOf(e)<0?'zone or target eligibility':null;
      if(reason)diagnostic.rejected[e.id]=reason;else diagnostic.eligible.push(e.id);
    });
    return eligible.filter(function(e: any){return p.hunting.facts.focus.rare.candidate(e) || normal.indexOf(e)>=0;})
      .map(function(e: any){return Object.assign(t.groupedEntityReport(e),{priority:t.monsterPriority(e),passiveRare:p.hunting.facts.focus.rare.candidate(e)});});
    }
  function queueRetentions() {
    if ((character as any).cave) return (s.groupedCombat?.queue || []).map(function(tgt: any) {
      var e = get_entity(tgt.id);
      return Object.assign({}, tgt, {at: p.root.__partyEntitiesObservedAt || 0, eligible: t.dungeonTargetAllowed(e), reason: t.dungeonTargetAllowed(e) ? null : 'no visible hostile'});
    });
    var at=p.root.__partyEntitiesObservedAt||0;
    return (s.groupedCombat&&s.groupedCombat.queue||[]).filter(function(tgt: any){return tgt.state==='planned'&&tgt.map===character.map&&tgt.in===character.in&&tgt.server===t.view().reunionRealm;}).map(function(tgt: any){
      var e=get_entity(tgt.id),reason=null;
      if(p.root.__partyNomination&&p.root.__partyNomination.blocked)reason='activity changed';
      else if(!e||!e.visible)reason='not visible';
      else if(e.dead||t.isKnownDead(e.id))reason='confirmed death';
      else if(t.isExternallyClaimedMonster(e))reason='external claim';
      else if(s.setAside[tgt.id]>Date.now())reason='failed approach';
      else if(!(e.type==="monster" && p.hunting.facts.focus.rare.candidate(e))&&t.view().monsterFocusNow.indexOf('all')<0&&t.view().monsterFocusNow.indexOf(e.mtype)<0)reason='focus changed';
      else if(!(e.mtype===t.view().huntCombatTargetNow && Math.hypot(e.x-character.x,e.y-character.y)<=p.hunting.farm.radius()) &&
        !(p.root.__partyFarmingEngagement && p.root.__partyFarmingEngagement.target.id===tgt.id) && !(e.type==="monster" && p.hunting.facts.focus.rare.candidate(e))&&!p.hunting.facts.focus.contains(e,t.view().targetScope,ENGAGED_MARGIN)&&
        !((!e.map||e.map===t.view().targetScope.map)&&Math.hypot(e.x-t.view().targetScope.x,e.y-t.view().targetScope.y)<=p.hunting.farm.radius()+ENGAGED_MARGIN))reason='retention boundary';
      return Object.assign({},tgt,e&&e.visible?t.groupedEntityReport(e):{},{at:at,eligible:!reason,reason:reason});
    });
    }
  function queueReport() {
    return {name:character.name,monsterHunt:p.hunting.hunt.status(),rareObservation:p.hunting.rares.observation(),map:character.map,in:character.in,server:t.view().reunionRealm,x:character.x,y:character.y,hp:character.hp,max_hp:character.max_hp,lastDeath:p.lifecycle.telemetry.lastDeath(),rip:!!character.rip,
      combatSelection:Object.assign({},s.combatSelection,{runtimeId:p.walkState.runtimeId,target:t.groupedNomination()}),
      groupedCombat:{independentReady:s.queueClient && s.queueClient.independent ? s.queueClient.independent.readiness():undefined,independentApproach:s.queueClient && s.queueClient.independent && !t.view().dungeonOwned ? true:undefined,formationRecovery:s.queueClient && s.queueClient.formation ? s.queueClient.formation.report() : undefined,approach:p.walks.groupedApproachReport(),pursuitAck:s.groupedCombat && s.groupedCombat.pursuit && s.groupedCombat.pursuit.revoking || null,lootPending:t.view().huntPending,reportedAt:Date.now()+p.walkState.clockOffset,protocol:QUEUE_PROTOCOL,observationAt:p.root.__partyEntitiesObservedAt||0,passingEncounters:t.passingEncounterReport(),passingAcknowledgement:s.queueClient && s.queueClient.passingAcknowledgement && s.queueClient.passingAcknowledgement(),huntDefense:p.hunting.hunt.defense(),returnDefense:t.view().returnCombatActive || t.returnDepartureDefense(),currentAttackers:p.walks.currentTravelAttackers(),travelCandidates:t.view().returnCombatActive?[]:t.travelStopCandidates(),currentAttackersAt:p.walks.travelObservationAt(),travelCommand:p.walks.localTravelCommand(),epoch:p.root.__partyCombatResetAt||0,claims:t.view().returnCombatActive?[]:t.queueClaims(),candidates:t.view().returnCombatActive?[]:t.queueCandidates(),retentions:t.view().returnCombatActive?[]:t.queueRetentions(),evidence:s.queueClient ? s.queueClient.reportEvidence(s.fightDeaths) : [],deaths:s.fightDeaths,unreachable:t.targetingUnreachableReport(),
        threats:t.groupedThreatReports(),sightings:t.groupedSightings(),ack:t.groupedAcknowledgement(),handoff:s.queueClient && s.queueClient.handoff && s.queueClient.handoff.report(),queueAck:s.groupedCombat && s.groupedCombat.queueRevision,
        anchorVisible:t.groupedAnchorVisible(),state:s.groupedCombat}};
    }
  function queueClaims() {
    if (!t.view().groupedFarming) return [];
    var watched=(s.groupedCombat && s.groupedCombat.queue || []).concat(s.groupedCombat && s.groupedCombat.claims || []);
    return Object.values(parent.entities || {}).filter(function(e: any) {
      return e && e.type==='monster' && e.visible && !e.dead && e.hp>0 && watched.some(function(tgt: any) {
        return tgt.id===String(e.id) && tgt.map===character.map && tgt.in===character.in && tgt.server===t.view().reunionRealm;
      });
    }).map(function(e: any) {
      return {id:String(e.id),map:character.map,in:character.in,server:t.view().reunionRealm,
        at:Date.now()+p.walkState.clockOffset,external:t.isExternallyClaimedMonster(e)};
    });
    }
  function groupedNomination() {
    var target = s.combatSelection.id && get_entity(s.combatSelection.id);
    return target && target.visible && !target.dead && !t.isExternallyClaimedMonster(target) ?
      { id: target.id, mtype: target.mtype, map: character.map, in: character.in, x: target.x, y: target.y } : null;
    }
  function groupedAcknowledgement() {
    if (!t.view().groupedFarming || !t.groupedFresh() || !s.groupedCombat.selection || !s.groupedCombat.target) return null;
    // Acknowledge receipt of the lock, not visibility of its entity.
    return t.currentQueue() ? s.groupedCombat.selection : null;
    }
  function groupedAnchorVisible() {
    if (!s.groupedCombat || !s.groupedCombat.anchor) return false;
    if (s.groupedCombat.anchor.name === character.name) return true;
    var anchor = get_player(s.groupedCombat.anchor.name);
    return !!(anchor && anchor.visible && anchor.map === character.map && anchor.in === character.in);
    }
  function queueRequest(body: any){body.name=character.name;return p.lifecycle.request('/status',{method:'POST',body:body});}
  function queueAcknowledgement() {
      return {groupedCombat:{independentReady:s.queueClient && s.queueClient.independent ? s.queueClient.independent.readiness():undefined,independentApproach:s.queueClient && s.queueClient.independent && !t.view().dungeonOwned ? true:undefined,ack:t.groupedAcknowledgement(),queueAck:s.groupedCombat && s.groupedCombat.queueRevision,handoff:s.queueClient && s.queueClient.handoff && s.queueClient.handoff.report()}};
    }
  function independentPullActive(target: any){return !!(s.groupedCombat && s.groupedCombat.independentApproach && s.groupedCombat.target && s.groupedCombat.target.state==='planned' && s.groupedCombat.target.id===target.id);}
  function acceptQueue(next: any) {
    if(s.queueClient && s.queueClient.handoff)next=s.queueClient.handoff.accept(next);
    if(next && !next.caveScope && Number(next.resetAt||0)<Number(p.root.__partyCombatResetAt||0))return;
    if(next && s.groupedCombat && Number(next.seenAt)<Number(s.groupedCombat.seenAt))return;
    var before=s.groupedCombat && s.groupedCombat.target, after=next && next.target;
    if (before && after && before.id!==after.id && s.groupedCombat.pursuit && s.groupedCombat.pursuit.replacementKind==='closer-hunt') {
      p.walks.cancelFarmApproach('Closer hunt monster'); p.walks.cancelGroupRoute(); p.walks.resetCombatMovement();
    }
    if(before && (!after || t.passingKey(before)!==t.passingKey(after))) {
      p.walks.cancelFarmApproach('Travel encounter retired');p.walks.cancelGroupRoute();p.walks.resetCombatMovement();
      s.combatTargetId=null;
      if(p.root.partyRoleRunner){if(p.root.partyRoleRunner.advanceTarget)p.root.partyRoleRunner.advanceTarget();else p.root.partyRoleRunner.resetTargeting();}
    }
    if(after && (!before || before.id!==after.id)) {
      p.walks.cancelGroupRoute(); p.walks.resetCombatMovement();
      var death=before && (next.deaths||[]).find(function(d: any){return d.id===before.id && d.map===before.map && d.in===before.in && d.server===before.server;});
      p.root.__partyQueueTiming={target:after.id,promotedAt:Date.now(),deathAt:death ? death.at-p.walkState.clockOffset : null,firstAttackAt:null};
    }
    s.groupedCombat=p.root.__partyGroupedCombat=next || null;
    if(s.queueClient && s.queueClient.formation)s.queueClient.formation.accept(next && next.formationRecovery);
    }
  function acceptCombatControl(state: any) {
    if ('consoleMaintenance' in state) p.lifecycle.drain.receive(state.consoleMaintenance || null, state.serverNow);
    if(state.passingControl && (!state.serverNow || state.serverNow>=(p.root.__partyHuntTravelAt||0))) {
      var beforeHunt=p.root.__partyHuntTravel, nextHunt=state.passingControl.hunt || null;
      if(nextHunt && nextHunt.primary && (!beforeHunt || !beforeHunt.primary || t.passingKey(beforeHunt.primary)!==t.passingKey(nextHunt.primary)) && typeof game_log==='function')
        game_log('Travel encounter: '+nextHunt.primary.mtype+' '+nextHunt.primary.id,'#51D2E1');
      if(beforeHunt && beforeHunt.defending && nextHunt && !nextHunt.defending && nextHunt.id===beforeHunt.id && nextHunt.epoch>beforeHunt.epoch && typeof game_log==='function')
        game_log('Hunt travel: defense cleared; resuming original destination','#51D2E1');
      p.root.__partyHuntTravel=nextHunt;
      p.root.__partyHuntTravelAt=state.serverNow||0;
      // When this client last received a Hunt travel control, on its own clock.
      s.huntControlSeenAt=Date.now();
      if(nextHunt && nextHunt.reason==='passive-setting' && t.passiveTravelInterruptible() &&
        state.convoySignal && p.walks.groupWalk.travel && state.convoySignal.commandId===p.walks.groupWalk.travel.commandId &&
        state.convoySignal.navigationRevision===p.walks.groupWalk.travel.navigationRevision)p.walks.interruptConvoyForDefense(nextHunt.id,nextHunt.epoch);
    }
    if (Array.isArray(state.passingEncounters) && (!state.serverNow || state.serverNow >= (p.root.__partyPassingControlAt || 0))) {
      p.root.__partyPassingControlAt = state.serverNow || 0;
      var passingNow = Date.now() + p.walkState.clockOffset;
      var retainedPassing: any = {};
      s.peerPassingEncounters.concat(state.passingEncounters).forEach(function(e: any) {
        var key = t.passingKey(e), old = retainedPassing[key];
        if (passingNow-e.at<pick('passingMemoryMs') && (!old || old.at<=e.at)) retainedPassing[key]=e;
      });
      s.peerPassingEncounters = (parent as any).__partyPeerPassingEncounters = Object.values(retainedPassing).slice(-LIST_BOUNDS.passing);
    }
    if (typeof p.hunting.rares.acceptCombat === 'function') p.hunting.rares.acceptCombat(state);
    if(!state.serverNow || state.serverNow >= (p.root.__partyTravelCombatAt || 0))
      p.root.__partyFarmingEngagement=state.convoySignal && state.convoySignal.farmingEngagement || null;
    if (Object.prototype.hasOwnProperty.call(state, "travelCombat") &&
        (!state.serverNow || state.serverNow >= (p.root.__partyTravelCombatAt || 0))) {
      var beforeTravel = p.root.__partyTravelCombat;
      p.root.__partyTravelCombat = state.travelCombat;
      p.root.__partyTravelCombatAt = state.serverNow || p.root.__partyTravelCombatAt || 0;
      if (state.travelCombat && (!beforeTravel || beforeTravel.id !== state.travelCombat.id || beforeTravel.revision !== state.travelCombat.revision)) {
        s.combatTargetId = null;
        if (p.root.partyRoleRunner) p.root.partyRoleRunner.resetTargeting();
        p.walks.cancelFarmApproach("Travel owns destination"); p.walks.cancelGroupRoute();
      }
    }
    if(state.convoySignal && state.convoySignal.phase==='defending' && p.walks.groupWalk.travel &&
      state.convoySignal.commandId===p.walks.groupWalk.travel.commandId && state.convoySignal.navigationRevision===p.walks.groupWalk.travel.navigationRevision)p.walks.interruptConvoyForDefense(state.convoySignal.id,state.convoySignal.epoch);
    var at=Math.max(Number(state.combatResetAt || state.combatResetByCharacter && state.combatResetByCharacter[character.name] || 0),
      Number(state.groupedCombat && state.groupedCombat.resetAt || 0));
    if(at<Number(p.root.__partyCombatResetAt||0))return;
    if (at>Number(p.root.__partyCombatResetAt||0)) {
      p.root.__partyCombatResetAt=at;
      s.groupedCombat=p.root.__partyGroupedCombat=null;
      s.combatTargetId=null;t.publishCombatSelection(null,true);
      if(p.root.partyRoleRunner && p.root.partyRoleRunner.resetTargeting)p.root.partyRoleRunner.resetTargeting();
      p.walks.cancelFarmApproach('Targeting queue reset');p.walks.cancelGroupRoute();
      t.clearSetAside();
    }
    }
  function reportFightDeath(id: any) {
    if (!id) return;
    if(s.queueClient && s.queueClient.timing)s.queueClient.timing.death(id);
    if(s.groupedCombat && s.groupedCombat.target && s.groupedCombat.target.id===id)p.root.__partyQueueLastDeath={id:id,at:Date.now()};
    // The passing check (passing.ts isPassingEncounter) is a death's longest reader and counts it for
    // the passing memory, so the list keeps a death that long.
    s.fightDeaths = p.root.__partyFightDeaths = s.fightDeaths.filter(function (d: any) { return Date.now()-d.at<pick('passingMemoryMs'); });
    // A monster's death comes as a `death` packet and a lethal `disappear`, and each listener
    // reports it, so only the first report of a monster's death reaches the queue. A character's
    // name outlives its death, and its one report per death is the killing hit, so every report of
    // a character's death reaches the queue.
    const recorded = s.fightDeaths.some(function (d: any) { return d.id===id && d.map===character.map && d.in===character.in && d.server===t.view().reunionRealm; });
    if (recorded && !get_player(id)) return;
    if (!recorded) s.fightDeaths.push({id:id,map:character.map,in:character.in,server:t.view().reunionRealm,at:Date.now()+p.walkState.clockOffset});
    if(s.queueClient) { s.queueClient.reportEvidence(s.fightDeaths); if(s.queueClient.death)s.queueClient.death(id);else s.queueClient.flush(); }
    }
  function queueEvidence(target: any,state: any,action: any){return s.queueClient && s.queueClient.evidence(target,state,action);}
  function successorAllowed(grant: any) {
      if(t.view().drain)return false;
      if(!t.view().groupedFarming || !t.groupedFresh() || p.walkState.intent.cancelled || character.rip || p.walkState.convoyActive || p.walks.groupWalk.travel ||
          eventFacts().travellingEventName() || t.view().joinedEventNow || t.view().eventTargetTypesNow.length || p.tasks.assignment.combatRecoveryHolds() || t.view().travelCombatActive ||
          t.view().huntPending)return false;
      if(!s.groupedCombat || s.groupedCombat.key!==grant.key || (p.root.__partyCombatResetAt||0)!==grant.resetAt)return false;
      if(grant.hunt && grant.hunt.owner===character.name) {
        var quest=p.hunting.hunt.status();if(!quest || quest.id!==grant.hunt.quest || quest.count<=0 || (quest.remainingMs??0)<=0)return false;
      }
      return true;
    }
  function successorVisible(grant: any) {
      var tgt=grant.successor,e=get_entity(tgt.id);
      return !!(e && e.visible && !e.dead && e.hp>0 && tgt.map===character.map && tgt.in===character.in && tgt.server===t.view().reunionRealm && !t.isExternallyClaimedMonster(e));
    }
  return { groupedFresh, groupedEntityReport, groupedThreatReports, groupedSightings, unfinishedFight, groupedDefensiveTarget, groupedDefensePending, engagedCombatTarget, activeCombatTarget, queueCandidates, queueRetentions, queueReport, queueClaims, groupedNomination, groupedAcknowledgement, groupedAnchorVisible, queueRequest, queueAcknowledgement, independentPullActive, acceptQueue, acceptCombatControl, reportFightDeath, queueEvidence, successorAllowed, successorVisible };
}

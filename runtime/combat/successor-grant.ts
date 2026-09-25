import type {Fight, Group, Member} from './grouped.ts';
import {fightIdentity, fightSelection} from './locked-pair.ts';
import {targetIdentity} from './lost-target.ts';

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
function fresh(m:Member,now:number):boolean {
  return !!m.status && now-m.status.seenAt<=3000 && m.status.seenAt<=now+500 && !m.cancelled && !m.status.rip && m.status.hp>0;
}
function eligible(group:Group,members:Member[],policy:HandoffPolicy,now:number):boolean {
  if(!policy.allowed || !group.pairRevision || !group.ready || !group.committed || group.recovering.length || group.formationRecovery || group.pursuit?.revoking)return false;
  return members.length>0 && members.every(m=>fresh(m,now) && m.status?.groupedCombat?.handoff?.capability===1 &&
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
  return now>=grant.expiresAt || grant.recipients.every(recipient=>members.some(m=>m.name===recipient.name && m.status?.combatSelection?.runtimeId===recipient.runtimeId && fresh(m,now) && m.status?.groupedCombat?.handoff?.revokedAck===grant.id));
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

/** Process-local grants are never resurrected from persisted/client group snapshots. */
export function authorizeSuccessor(scope:object,group:Group,members:Member[],policy:HandoffPolicy,now:number):void {
  let ledger=ledgers.get(scope);
  if(!ledger){ledger={serial:0,boot:JSON.stringify([now,++bootSerial])};ledgers.set(scope,ledger);}
  if(group.pairRevision)group.pairRevision=JSON.stringify([group.pairRevision,ledger.boot]);
  policy=reserveObservedDeaths(ledger,group,policy);
  delete group.successorGrant;
  if(reconcileGrant(ledger,group,members,policy,now))return;
  if(!eligible(group,members,policy,now) || !budget(group,policy))return;
  issue(ledger,group,members,policy,now);
}
function mustRevoke(grant:SuccessorGrant,group:Group,members:Member[],policy:HandoffPolicy,now:number):boolean {
  return !!grant.revoking || grant.pair!==group.pairRevision || !eligible(group,members,policy,now) || !budget(group,policy);
}
function reconcileGrant(ledger:Ledger,group:Group,members:Member[],policy:HandoffPolicy,now:number):boolean {
  const grant=ledger.grant;
  if(grant && promoted(grant,group)) {
    // Death promotion is compatible with the previously authorized identity.
    ledger.grant=undefined;
  } else if(grant && mustRevoke(grant,group,members,policy,now)) {
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
function issue(ledger:Ledger,group:Group,members:Member[],policy:HandoffPolicy,now:number):void {
  const [predecessor,successor]=group.queue;
  if(!predecessor || !successor || successor.state!=='planned')return;
  if(!ledger.grant)ledger.grant={recipients:members.map(m=>({name:m.name,runtimeId:m.status!.combatSelection!.runtimeId})),id:JSON.stringify([group.key,now,++ledger.serial]),pair:group.pairRevision!,key:group.key,
    resetAt:group.resetAt||0,predecessor:{...predecessor},successor:{...successor},selection:fightSelection(group.key,successor),issuedAt:now,expiresAt:now+3000,
    ...(policy.hunt?{hunt:{owner:policy.hunt.owner,quest:policy.hunt.quest,count:policy.hunt.count}}:{})};
  // Renew only while the exact pair and its kill reservation are still eligible.
  ledger.grant.expiresAt=now+3000;
  group.successorGrant={...ledger.grant};
}

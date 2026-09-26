import type {Group} from './grouped.ts';
import type {HandoffReport,SuccessorGrant} from './successor-grant.ts';
import {targetIdentity} from './lost-target.ts';
interface Ports {
  now():number; monotonic():number; serverNow():number;
  allowed(grant:SuccessorGrant):boolean;
  live(grant:SuccessorGrant):boolean;
  trace(stage:string,details:Record<string,unknown>):void;
}
/** One death-gated promotion per grant; authoritative snapshots remain separate. */
export function createSuccessorClient(ports:Ports) {
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
      deadline=ports.monotonic()+Math.max(0,Math.min(3000,incoming.expiresAt-ports.serverNow()));
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
    promoted={...snapshot,target:successor,selection:grant.selection,committed:true,pursuit:undefined,formationRecovery:undefined,
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

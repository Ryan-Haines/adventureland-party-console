import * as policy from "../../hunt/policy.ts";
import type { HuntConvoy, HuntCycle, HuntTickPorts, HuntTickState } from "./contracts.ts";
import { expiredAnniversaryCanYield, supersedeExpiredAnniversary } from "./expired-anniversary.ts";
import { requestObject } from '../http/contracts.ts';

function protectedActivity(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): boolean {
  if (state.eventReturn || state.farmAreaState?.paused || state.farmAreaState?.pending) return true;
  if (state.escape && state.escape.stage !== "released") return true;
  return anniversaryActive(state) && !expiredAnniversaryCanYield(hunt, state, ports);
}
function anniversaryActive(state: HuntTickState): boolean {
  const cycle = state.anniversary?.eventCycle;
  return !!cycle && !cycle.returnCompletedAt && !cycle.supersededAt && !cycle.combatHandoffAt;
}
function ownsWalk(hunt: HuntCycle, convoy: HuntConvoy, state: HuntTickState, ports: HuntTickPorts): boolean {
  const names = convoy.participants;
  if (!names?.length || convoy.nonPreemptible) return false;
  return names.every(name => hunt.participants.includes(name) &&
    convoy.walkingParents?.[name]?.revision === ports.intent(name).revision &&
    convoy.walkingParents?.[name]?.revision !== undefined &&
    (!state.commands[name] || state.commands[name]?.convoyId === convoy.id));
}
function memberBusy(name: string, state: HuntTickState, ports: HuntTickPorts, convoy: HuntConvoy): boolean {
  const s = state.statuses[name], command = state.commands[name];
  if (!s || s.rip || s.hp === 0 || ports.intent(name).cancelled) return true;
  return !!(s.activeEvent || s.joinedEvent || (command && command.convoyId !== convoy.id));
}

/** A farming walk is subordinate to its Hunt deadline; a failed walk is no longer an event owner. */
export function recoverHuntFarmWalk(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): boolean {
  recoverOrphanedRelocation(hunt,state,ports);
  const convoy = state.activeConvoy;
  if (!convoy || !recoverable(hunt, convoy, state, ports)) return false;
  const due = policy.shouldReturn(hunt, state.leader!, state.statuses);
  if (!due && convoy.phase !== "failed") return false;
  ports.cancelConvoy();
  hunt.convoyId = null;
  resume(hunt);
  log(hunt, state, ports, convoy, due);
  if (due) {
    supersedeExpiredAnniversary(hunt, state, ports);
    hunt.waitForExpiry = !!policy.quest(hunt, state.leader!, state.statuses)?.count;
    ports.returnToDaisy(hunt);
  }
  ports.persist();
  return due;
}

function recoverOrphanedRelocation(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): void {
  if (orphanBlocked(hunt,state,ports)) return;
  const pending = requestObject(state.farmAreaState!.pending), destination=requestObject(pending.destination);
  const mission=ports.destination(hunt), revisions=requestObject(pending.revisions);
  if (!mission || destination.map!==mission.map || destination.x!==mission.x || destination.y!==mission.y) return;
  if (typeof pending.reason!=='string' || !pending.reason.startsWith('Travel failed:')) return;
  if (!hunt.participants.every(n=>orphanMemberReady(n,state,ports,revisions))) return;
  if (state.activeConvoy) ports.cancelConvoy();
  supersedeExpiredAnniversary(hunt,state,ports,true);
  state.farmAreaState!.pending=null; state.farmAreaState!.message=null;
  hunt.convoyId=null; delete hunt.originArrivedAt;
  hunt.stage='mission-travel'; delete hunt.resumeStage;
  hunt.message='Resuming Hunt after failed farming travel';
  logRelocationRecovery(hunt,state,ports,revisions);
  ports.persist();
}
function logRelocationRecovery(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts, revisions: Record<string,unknown>): void {
  if (state.combatLogs) (state.combatLogs[String(state.leader)] ||= []).push({at:ports.now(),type:'navigation',
    message:hunt.message!,details:{cycleId:hunt.cycleId,revisions}});
}
function orphanBlocked(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): boolean {
  if (!state.farmAreaState?.pending) return true;
  if (state.eventReturn || state.farmAreaState?.paused || orphanConvoyBlocked(hunt,state,ports)) return true;
  return orphanActivityBlocked(hunt,state,ports);
}
function orphanActivityBlocked(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): boolean {
  if (anniversaryActive(state) && !expiredAnniversaryCanYield(hunt,state,ports,true)) return true;
  if (state.escape && state.escape.stage !== 'released') return true;
  return hunt.stage !== 'paused-event' || !ports.fresh(hunt);
}
function orphanConvoyBlocked(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): boolean {
  const c=state.activeConvoy;
  if (!c) return false;
  return c.phase!=='failed' || c.purpose!=='shared-walk' || c.walkingActivity!=='farm-recovery' ||
    c.failureCode==='geometry-mismatch' || !ownsWalk(hunt,c,state,ports);
}
function orphanMemberReady(name: string, state: HuntTickState, ports: HuntTickPorts, revisions: Record<string,unknown>): boolean {
  const s=state.statuses[name], intent=ports.intent(name);
  if (orphanCommandBlocked(name,state)) return false;
  return !!s && !s.rip && s.hp!==0 && ports.now()-s.seenAt<=3000 && s.seenAt<=ports.now()+500 &&
    !s.activeEvent && !s.joinedEvent && !intent.cancelled && revisions[name]===intent.revision;
}
function orphanCommandBlocked(name: string, state: HuntTickState): boolean {
  const command=state.commands[name];
  return !!command && (!state.activeConvoy || command.convoyId!==state.activeConvoy.id);
}
function recoverable(hunt: HuntCycle, convoy: HuntConvoy, state: HuntTickState, ports: HuntTickPorts): boolean {
  if (convoy.geometryRepair?.phase === 'waiting' || convoy.failureCode === 'geometry-mismatch') return false;
  if (convoy.purpose !== "shared-walk" || convoy.walkingActivity !== "farm-recovery") return false;
  if (!["farming", "mission-travel", "paused-event"].includes(hunt.stage)) return false;
  if (protectedActivity(hunt, state, ports) || !ports.fresh(hunt)) return false;
  return ownsWalk(hunt, convoy, state, ports) && !hunt.participants.some(n => memberBusy(n, state, ports, convoy));
}
function resume(hunt: HuntCycle): void {
  if (hunt.stage === "paused-event") hunt.stage = hunt.resumeStage === "mission-travel" ? "mission-travel" : "farming";
  delete hunt.resumeStage;
}
function log(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts, convoy: HuntConvoy, due: boolean): void {
  if (!state.combatLogs) return;
  (state.combatLogs[String(state.leader)] ||= []).push({ at:ports.now(), type:"navigation",
    message:due ? "Hunt return due; released farming walk for Daisy" : "Released failed Hunt farming walk",
    details:{cycleId:hunt.cycleId, convoyId:convoy.id, phase:convoy.phase} });
}

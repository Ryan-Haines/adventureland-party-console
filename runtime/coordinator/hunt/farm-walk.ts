import * as policy from "../../hunt/policy.ts";
import type { HuntConvoy, HuntCycle, HuntTickPorts, HuntTickState } from "./contracts.ts";
import { expiredAnniversaryCanYield, supersedeExpiredAnniversary } from "./expired-anniversary.ts";

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
function recoverable(hunt: HuntCycle, convoy: HuntConvoy, state: HuntTickState, ports: HuntTickPorts): boolean {
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

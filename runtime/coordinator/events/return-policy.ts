import type { EventRecovery, EventReturnPorts } from "./return-types.ts";
import { recoveryConvoy } from "./return-guards.ts";

/** Explicit policy changes replace only this recovery's checkpoint continuation. */
export function applyReturnPolicy(r: EventRecovery, ports: EventReturnPorts): void {
  if (ports.huntHandoffPending?.()) return;
  if (r.postExitLocation === undefined || r.pending.length) return;
  const convoy = ports.convoy(), current = ports.capture(r.participants);
  if (!canReplace(r, ports, current)) return;
  if (convoy) ports.cancelConvoy();
  retargetMembers(r, ports, current);
  r.returnDispatchedAt = null;
  r.returnRoutes = null;
  r.convoyId = null;
  delete r.postExitLocation;
  ports.persist();
}

function retargetMembers(r: EventRecovery, ports: EventReturnPorts, current: ReturnType<EventReturnPorts["capture"]>): void {
  for (const name of r.participants) {
    const saved = r.waypoints?.[name], command = ports.commands()[name];
    if (!saved || saved.revision !== current[name]?.revision) continue;
    saved.location = r.postExitLocation || null;
    if (command?.cycleId === r.cycleId) ports.clearCommand(name);
  }
}

function canReplace(r: EventRecovery, ports: EventReturnPorts, current: ReturnType<EventReturnPorts["capture"]>): boolean {
  const convoy = ports.convoy();
  if (!convoy) return true;
  if (!recoveryConvoy(r, convoy) || convoy.nonPreemptible || convoy.merchantInterruption) return false;
  return convoy.participants.every(n => current[n]?.revision === r.waypoints?.[n]?.revision);
}

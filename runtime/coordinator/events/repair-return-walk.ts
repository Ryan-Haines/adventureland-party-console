import type { EventRecovery, EventReturnPorts, ReturnConvoy } from "./return-types.ts";

export function isRecoveryWalk(recovery: EventRecovery, convoy: ReturnConvoy): boolean {
  return convoy.purpose === "shared-walk-return" && convoy.walkingActivity === "event-return" &&
    convoy.participants.length > 0 && convoy.participants.every(name =>
      convoy.walkingParents?.[name]?.command?.cycleId === recovery.cycleId);
}

/** Exit walking predates checkpoint dispatch and need not have recovery.convoyId. */
export function repairReturnWalk(recovery: EventRecovery, ports: EventReturnPorts): void {
  const c = ports.convoy();
  if (!c || c.phase !== "failed" || c.nonPreemptible || c.merchantInterruption || !isRecoveryWalk(recovery, c)) return;
  const current = ports.capture(c.participants), commands = ports.commands();
  // Let an in-flight merchant acknowledgement finish; never clear its cargo work.
  if (c.participants.some(name => commands[name]?.type.startsWith("merchant-"))) return;
  const eligible = c.participants.filter(name => {
    const parent = c.walkingParents![name]!;
    const command = commands[name];
    return current[name]?.revision === parent.revision && recovery.waypoints?.[name]?.revision === parent.revision &&
      (!command || command.convoyId === c.id || command.cycleId === recovery.cycleId);
  });
  if (eligible.some(name => !fresh(ports, name))) return;
  ports.cancelConvoy();
  restoreParticipants(recovery, ports, c, eligible);
  ports.persist();
}
function fresh(ports: EventReturnPorts, name: string): boolean {
  const status = ports.statuses()[name];
  return !!status && Number(status.seenAt) >= ports.now() - 3000 && !status.rip;
}
function restoreParticipants(recovery: EventRecovery, ports: EventReturnPorts, c: ReturnConvoy, eligible: string[]): void {
  const commands = ports.commands();
  for (const name of c.participants) {
    if (commands[name]?.convoyId === c.id) ports.clearCommand(name);
    if (!eligible.includes(name)) {
      recovery.participants = recovery.participants.filter(n => n !== name);
      recovery.pending = recovery.pending.filter(n => n !== name);
      continue;
    }
    if (ports.statuses()[name]?.map === "main") {
      recovery.pending = recovery.pending.filter(n => n !== name);
    } else {
      if (!recovery.pending.includes(name)) recovery.pending.push(name);
      ports.town(name, recovery);
    }
  }
}

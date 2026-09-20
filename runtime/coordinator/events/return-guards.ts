import type {
  AnniversaryReturnCycle,
  EventRecovery,
  EventReturnPorts,
  ReturnConvoy,
} from "./return-types.ts";
import { isRecoveryWalk } from "./repair-return-walk.ts";

export function recoveryConvoy(recovery: EventRecovery, convoy: ReturnConvoy | null): boolean {
  return !!convoy && ([recovery.convoyId, recovery.exitConvoyId].includes(convoy.id) || isRecoveryWalk(recovery, convoy));
}

export function goobrawlStillFighting(ports: EventReturnPorts): boolean {
  const cutoff = ports.now() - 10_000;
  return Object.values(ports.statuses()).some(
    (status) =>
      !!status &&
      Number(status.seenAt) >= cutoff &&
      status.map === "goobrawl" &&
      status.goobrawlCombat === true &&
      !status.rip,
  );
}

function includesTarget(
  participants: readonly unknown[],
  target: AnniversaryReturnCycle["target"],
): boolean {
  return participants.includes(target);
}

export function anniversaryHolding(
  cycle: AnniversaryReturnCycle | null | undefined,
  ports: EventReturnPorts,
): boolean {
  return (
    !!cycle &&
    !cycle.abortedAt &&
    !cycle.combatHandoffAt && !cycle.returnCompletedAt && !cycle.supersededAt &&
    includesTarget(ports.anniversaryParticipants(), cycle.target) &&
    ports.now() < Number(cycle.endsAt)
  );
}

export function newAnniversaryRound(
  cycle: AnniversaryReturnCycle | null | undefined,
  recovery: EventRecovery,
  ports: EventReturnPorts,
): cycle is AnniversaryReturnCycle {
  return (
    !!cycle &&
    !cycle.abortedAt &&
    !cycle.combatHandoffAt && !cycle.returnCompletedAt && !cycle.supersededAt &&
    includesTarget(ports.anniversaryParticipants(), cycle.target) &&
    Number(cycle.stagedAt) > recovery.startedAt &&
    recovery.anniversaryRound !== cycle.id
  );
}

function eventStillReported(event: string, ports: EventReturnPorts): boolean {
  if (ports.sessions().some((session) => session.event === event)) return true;
  return Object.values(ports.statuses()).some((status) =>
    status?.serverLiveEvents?.some((live) => live.name === event),
  );
}

export function lostCombatHandoff(
  cycle: AnniversaryReturnCycle | null | undefined,
  ports: EventReturnPorts,
): cycle is AnniversaryReturnCycle & { combatEvent: string } {
  if (!cycle?.combatHandoffAt || cycle.returnDispatchedAt || !cycle.combatEvent) return false;
  if (!(cycle.abortedAt || ports.now() >= Number(cycle.endsAt))) return false;
  return !ports.convoy() && !eventStillReported(cycle.combatEvent, ports);
}

export function returnedFromDeferred(
  name: string,
  recovery: EventRecovery,
  ports: EventReturnPorts,
): boolean {
  if (!ports.activeNames().includes(name)) return false;
  const returned = ports.statuses()[name]?.eventRecovery;
  return (
    !!returned &&
    returned.cycleId === recovery.cycleId &&
    ["town-ready", "deferred-town-ready"].includes(returned.phase)
  );
}

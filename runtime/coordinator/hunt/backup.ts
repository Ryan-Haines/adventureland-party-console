import * as policy from "../../hunt/policy.ts";
import type { HuntCycle, HuntTickState, HuntTickPorts, HuntStatus } from "./contracts.ts";
import type { ReturnLocation } from "../events/return-types.ts";

type BackupMember = NonNullable<HuntCycle["backup"]>["members"][string];
function freshMember(
  status: HuntStatus | undefined,
  lead: HuntStatus | undefined,
  now: number,
): boolean {
  return (
    !!status &&
    now - status.seenAt <= 10000 &&
    !status.rip &&
    status.server === lead?.server &&
    status.region === lead?.region
  );
}
function memberSnapshot(
  status: HuntStatus | undefined,
  lead: HuntStatus | undefined,
  now: number,
): BackupMember {
  const quest = status?.monsterHunt,
    fresh = freshMember(status, lead, now);
  return {
    target: quest?.id || null,
    remainingMs: Math.max(0, quest?.remainingMs || 0),
    fresh,
    ready: fresh && (!quest || quest.remainingMs <= 0),
  };
}
function recoveryActive(state: HuntTickState): boolean {
  return !!(
    (state.escape && state.escape.stage !== "released") ||
    (state.combatRecovery && !["complete", "cancelled"].includes(state.combatRecovery.phase))
  );
}
function eventActive(hunt: HuntCycle, state: HuntTickState): boolean {
  return (
    policy.eventOwnsTravel(hunt, state) ||
    hunt.participants.some((n) => state.statuses[n]?.activeEvent || state.statuses[n]?.joinedEvent)
  );
}
function eventPauseMessage(state: HuntTickState): string {
  const recovery = state.eventReturn as { event?: string } | null;
  const convoy = state.activeConvoy;
  const event = recovery?.event || "event";
  if (convoy?.phase === "failed")
    return "Backup Hunt waiting for " + event + " recovery: " +
      (convoy.purpose || "travel") + " blocked by " + (convoy.failure || "failed convoy");
  return recovery ? "Backup Hunt waiting for " + event + " recovery" : "Backup Hunt paused for event travel";
}
function pauseBackup(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): boolean {
  if (hunt.participants.some((n) => ports.intent(n).cancelled)) {
    hunt.message = "Hunt movement paused by manual navigation";
    return true;
  }
  if (recoveryActive(state)) {
    hunt.message = "Backup Hunt waiting for party recovery";
    return true;
  }
  if (!eventActive(hunt, state)) return false;
  if (hunt.stage !== "paused-event") hunt.resumeStage = hunt.stage;
  hunt.stage = "paused-event";
  hunt.message = eventPauseMessage(state);
  return true;
}
function hasEligibleQuest(hunt: HuntCycle, state: HuntTickState): boolean {
  return hunt.participants.some((n) => {
    const q = state.statuses[n]?.monsterHunt;
    return q && q.remainingMs > 0 && (q.count === 0 || !state.huntBlacklist?.[q.id]);
  });
}
function resumeAssignments(hunt: HuntCycle, eligible: boolean, ports: HuntTickPorts): void {
  ports.cancelHuntConvoy();
  hunt.convoyId = null;
  delete hunt.backup;
  hunt.batchPickup = !eligible;
  if (hunt.batchPickup) {
    hunt.missionRevision = (hunt.missionRevision || 0) + 1;
    delete hunt.loot;
    hunt.stage = "batch-loot";
  } else {
    hunt.stage = "checking-quests";
    ports.prepare(hunt);
  }
  ports.persist();
}
function arrivedAtFarm(
  hunt: HuntCycle,
  state: HuntTickState,
  ports: HuntTickPorts,
  destination: ReturnLocation,
): boolean {
  return hunt.participants.every((n) => {
    const s = state.statuses[n]!;
    return (
      s.map === destination.map &&
      ports.contains(destination, s, 150, Number(state.monsterSearchRadiusByCharacter[n]) || 400)
    );
  });
}
function finishArrival(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): void {
  const changed = hunt.stage !== "backup-farming";
  if (state.activeConvoy) ports.cancelHuntConvoy();
  hunt.stage = "backup-farming";
  hunt.convoyId = null;
  if (changed) ports.persist();
}
function hasRecentCombat(hunt: HuntCycle, state: HuntTickState, now: number): boolean {
  return hunt.participants.some((n) => {
    const s = state.statuses[n];
    return (
      s &&
      now - s.seenAt <= 3000 &&
      (s.activeCombatTarget ||
        s.groupedCombat?.candidates?.length ||
        s.groupedCombat?.retentions?.some((t) => t.eligible))
    );
  });
}
function startBackupTravel(
  hunt: HuntCycle,
  state: HuntTickState,
  ports: HuntTickPorts,
  destination: ReturnLocation,
  now: number,
): void {
  // Boundary crossings while kiting or pursuing do not authorize a new trip.
  if (
    hunt.stage === "backup-farming" &&
    (ports.partyFighting(hunt) || hasRecentCombat(hunt, state, now))
  )
    return;
  if (state.farmAreaState?.paused || state.farmAreaState?.pending) {
    hunt.message = "Backup travel waiting for farming route recovery";
    return;
  }
  hunt.convoyId = null;
  ports.start(hunt, destination, "Backup farming while blacklisted Hunts expire", "backup-travel");
  ports.persist();
}
function maintainBackupTravel(
  hunt: HuntCycle,
  state: HuntTickState,
  ports: HuntTickPorts,
  now: number,
): void {
  if (hunt.stage === "paused-event") {
    hunt.stage = "backup-travel";
    hunt.convoyId = null;
  }
  const destination = ports.backupDestination
    ? ports.backupDestination(hunt)
    : hunt.returnLocation;
  if (!destination) {
    hunt.message = "Backup Hunt waiting for configured farming location";
    return;
  }
  const arrived = arrivedAtFarm(hunt, state, ports, destination);
  if (
    state.activeConvoy &&
    (state.activeConvoy.id !== hunt.convoyId || state.activeConvoy.phase === "defending")
  )
    return;
  if (arrived) {
    finishArrival(hunt, state, ports);
    return;
  }
  if (state.activeConvoy) return;
  startBackupTravel(hunt, state, ports, destination, now);
}

/** Backup farming retains Hunt intent and waits for the entire assignment batch. */
export function stepHuntBackup(
  hunt: HuntCycle,
  state: HuntTickState,
  ports: HuntTickPorts,
): boolean {
  if (!hunt.backup) return false;
  hunt.participants = hunt.participants.filter((n) => n === state.leader || state.followers[n]);
  if (!hunt.participants.includes(state.leader!)) hunt.participants.unshift(state.leader!);
  const now = ports.now(),
    lead = state.statuses[String(state.leader)];
  hunt.backup.members = Object.fromEntries(
    hunt.participants.map((name) => [name, memberSnapshot(state.statuses[name], lead, now)]),
  );
  const members = Object.values(hunt.backup.members),
    ready = members.filter((m) => m.ready).length;
  hunt.message = `Backup farming: waiting for all blacklisted quests to expire (${ready}/${members.length} ready)`;
  if (pauseBackup(hunt, state, ports)) return true;
  if (!members.every((m) => m.fresh)) {
    hunt.message =
      "Backup Hunt waiting for fresh status from " +
      Object.entries(hunt.backup.members)
        .filter(([, m]) => !m.fresh)
        .map(([n]) => n)
        .join(", ");
    return true;
  }
  const eligible = hasEligibleQuest(hunt, state);
  if (eligible || ready === members.length) {
    resumeAssignments(hunt, eligible, ports);
    return true;
  }
  maintainBackupTravel(hunt, state, ports, now);
  return true;
}

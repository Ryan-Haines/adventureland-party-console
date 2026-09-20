import type {
  HuntCycle,
  HuntTickPorts,
  HuntTickState,
  HuntCommand,
  HuntStatus,
} from "./contracts.ts";

function interactionComplete(
  command: HuntCommand | undefined,
  live: HuntStatus["monsterHunt"],
  cycleId: string,
): boolean {
  return (
    command?.type === "monster-hunt-interact" &&
    command.cycleId === cycleId &&
    !!((command.action === "assign" && live) || (command.action === "claim" && !live))
  );
}

export function createHuntParticipants(state: HuntTickState, ports: HuntTickPorts) {
  function acknowledgeInteractions(hunt: HuntCycle): void {
    for (const name of hunt.participants) {
      const command = state.commands[name],
        live = state.statuses[name]?.monsterHunt;
      if (hunt.batchPickup && command?.issuedAt && state.statuses[name]!.seenAt <= command.issuedAt)
        continue;
      if (interactionComplete(command, live, hunt.cycleId)) delete state.commands[name];
    }
  }

  function includeFollowers(hunt: HuntCycle): void {
    if (ports.ownsTravel(hunt)) return;
    hunt.participants = hunt.participants.filter(
      (name) => name === state.leader || state.followers[name],
    );
    if (!hunt.participants.includes(state.leader!)) hunt.participants.unshift(state.leader!);
  }

  function reconcileLateMembers(hunt: HuntCycle): boolean {
    const late = ports.ownsTravel(hunt)
      ? []
      : ports.participants().filter((name) => !hunt.participants.includes(name));
    if (hunt.policyVersion === 3) {
      hunt.participants.push(...late);
      return false;
    }
    const owners = late.filter((name) =>
      (hunt.missions || []).some((mission) => (mission.owners || []).includes(name)),
    );
    if (owners.length) hunt.participants.push(...owners);
    const unassigned = late.filter((name) => !owners.includes(name));
    const untouched =
      Number(hunt.currentIndex) <= 0 && !(hunt.missions || []).some((mission) => mission.skipped);
    if (!unassigned.length || !untouched) return false;
    ports.cancelHuntConvoy();
    hunt.participants.push(...unassigned);
    hunt.participants.sort((a, b) =>
      a === state.leader ? -1 : b === state.leader ? 1 : a.localeCompare(b),
    );
    hunt.missions = [];
    hunt.currentIndex = -1;
    hunt.target = null;
    hunt.stage = "checking-quests";
    ports.prepare(hunt);
    return true;
  }

  function repairOldAssignment(hunt: HuntCycle): void {
    const reported = hunt.participants.filter((name) => state.statuses[name]?.monsterHunt);
    if (
      hunt.version === 2 ||
      hunt.stage !== "waiting-expiry" ||
      (hunt.missions || []).length ||
      reported.length !== 1 ||
      reported[0] !== state.leader!
    )
      return;
    hunt.version = 2;
    hunt.stage = "assigning";
    hunt.message = "Assigning Monster Hunts";
  }

  function reconcile(hunt: HuntCycle): boolean {
    acknowledgeInteractions(hunt);
    const leader = state.statuses[String(state.leader)];
    if (!leader || leader.seenAt < ports.now() - 10000) return false;
    includeFollowers(hunt);
    if (state.activeConvoy && state.activeConvoy.purpose !== "monster-hunt") {
      ports.cancelConvoy();
      hunt.convoyId = null;
    }
    if (reconcileLateMembers(hunt)) return false;
    repairOldAssignment(hunt);
    return true;
  }
  return { reconcile };
}

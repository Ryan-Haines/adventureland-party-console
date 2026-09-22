import type {
  HuntCycle,
  HuntTickState,
  HuntTickPorts,
  HuntStatus,
  LootProgress,
} from "./contracts.ts";
import { huntLootId } from "../../hunt/loot-identity.ts";
import { encounterNavigationBlocked } from "./encounter-ownership.ts";

function eventOwnsLoot(hunt: HuntCycle, state: HuntTickState): boolean {
  return (
    !["farming", "mission-travel", "paused-event", "batch-loot"].includes(hunt.stage) ||
    !!state.eventReturn ||
    hunt.participants.some((n) => state.statuses[n]?.activeEvent || state.statuses[n]?.joinedEvent)
  );
}
function memberUnavailable(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): boolean {
  return hunt.participants.some(
    (n) => ports.intent(n).cancelled || state.statuses[n]?.rip || state.statuses[n]?.hp === 0,
  );
}
function ownersFinished(
  mission: HuntCycle["missions"][number],
  state: HuntTickState,
  ports: HuntTickPorts,
): boolean {
  return mission.owners.every((n) => {
    const s = state.statuses[n];
    return (
      s &&
      ports.now() - s.seenAt <= 3000 &&
      s.monsterHunt?.id === mission.target &&
      s.monsterHunt.count === 0
    );
  });
}
function matchingProgress(
  progress: LootProgress | undefined,
  loot: NonNullable<HuntCycle["loot"]>,
  lead: HuntStatus,
  id: string,
): progress is LootProgress {
  return (
    progress?.id === id &&
    progress.observedAt > loot.after &&
    progress.realm === loot.realm &&
    progress.map === loot.map &&
    String(progress.in) === loot.in &&
    Math.hypot(lead.x - loot.x, lead.y - loot.y) <= 180
  );
}
function createBarrier(
  id: string,
  lead: HuntStatus,
  ports: HuntTickPorts,
): NonNullable<HuntCycle["loot"]> {
  return {
    id,
    after: ports.now(),
    map: lead.map,
    in: String(lead.in ?? lead.map),
    realm: `${lead.region || ""}:${lead.server || ""}`,
    x: lead.x,
    y: lead.y,
    complete: false,
  };
}
function observeBarrier(
  hunt: HuntCycle,
  lead: HuntStatus,
  id: string,
  ports: HuntTickPorts,
): boolean {
  if (hunt.loot?.id !== id) hunt.loot = createBarrier(id, lead, ports);
  const progress = lead.huntLoot,
    loot = hunt.loot;
  if (matchingProgress(progress, loot, lead, id)) {
    loot.progress = progress;
    loot.complete = progress.complete;
  }
  if (loot.complete) return false;
  ports.cancelHuntConvoy();
  hunt.convoyId = null;
  hunt.message =
    "Pending Hunt loot" +
    (loot.progress?.error ? ": " + loot.progress.error : ": collecting final kill drops");
  return true;
}
function unfinishedBarrier(hunt: HuntCycle, id: string): boolean {
  return hunt.loot?.id === id && !hunt.loot.complete;
}
function freshLeader(lead: HuntStatus | undefined, ports: HuntTickPorts): lead is HuntStatus {
  return !!lead && !(ports.now() - lead.seenAt > 3000) && !lead.rip;
}

export function encounterLootPending(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): boolean {
  const lead = state.statuses[String(state.leader)];
  if (!freshLeader(lead, ports)) return true;
  return observeBarrier(hunt, lead, huntLootId(hunt) + ":encounter:" + hunt.encounter!.convoyId, ports);
}
function collectorAtLoot(lead: HuntStatus, loot: NonNullable<HuntCycle["loot"]>): boolean {
  return `${lead.region || ""}:${lead.server || ""}` === loot.realm &&
    lead.map === loot.map && String(lead.in ?? lead.map) === loot.in &&
    Math.hypot(lead.x - loot.x, lead.y - loot.y) <= 180;
}
function existingBarrier(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): boolean | null {
  if (!hunt.loot || hunt.loot.complete || state.eventReturn || memberUnavailable(hunt, state, ports)) return null;
  const collector = state.statuses[String(state.leader)];
  if (!freshLeader(collector, ports)) { hunt.message = "Waiting for the Hunt loot collector"; return true; }
  // The client intentionally cannot acknowledge loot after leaving its location.
  // Retire that ownership rather than carry an impossible wait into a new hunt.
  if (!collectorAtLoot(collector, hunt.loot)) {
    delete hunt.loot;
    ports.persist();
    return null;
  }
  return observeBarrier(hunt, collector, hunt.loot.id, ports);
}

/** A departure barrier, acknowledged only by an awaited client loot pass. */
export function huntLootPending(
  hunt: HuntCycle,
  state: HuntTickState,
  ports: HuntTickPorts,
): boolean {
  if (hunt.encounter && encounterNavigationBlocked(hunt, state, ports, hunt.encounter.revisions)) return false;
  return missionLootPending(hunt, state, ports);
}

function missionLootPending(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): boolean {
  const existing = existingBarrier(hunt, state, ports);
  if (existing !== null) return existing;
  if (eventOwnsLoot(hunt, state)) return false;
  const mission = hunt.missions[hunt.currentIndex],
    lead = state.statuses[String(state.leader)];
  const batch = hunt.stage === "batch-loot";
  if ((!mission && !batch) || !freshLeader(lead, ports) || memberUnavailable(hunt, state, ports))
    return false;
  const finished = batch || ownersFinished(mission!, state, ports);
  const id = huntLootId(hunt);
  if (!finished && !unfinishedBarrier(hunt, id)) return false;
  return observeBarrier(hunt, lead, id, ports);
}

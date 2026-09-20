import type { HuntCycle, HuntTickState, HuntStatus } from "./contracts.ts";
import { recordHuntFailure } from "./settings.ts";
export interface HuntExpiryAttempt {
  target: string;
  owner: string;
  revision: number;
  deadline: number;
  done?: boolean;
}
function fresh(status: HuntStatus | undefined, now: number): status is HuntStatus {
  return !!status && now - status.seenAt <= 3000 && "monsterHunt" in status;
}
function currentMission(state: HuntTickState, hunt: HuntCycle) {
  const mission = hunt.missions[hunt.currentIndex];
  return mission &&
    !mission.skipped &&
    ["mission-travel", "farming"].includes(hunt.stage) &&
    !state.huntBlacklist?.[mission.target]
    ? mission
    : null;
}
function register(
  state: HuntTickState,
  hunt: HuntCycle,
  owner: string,
  target: string,
  now: number,
): boolean {
  const status = state.statuses[owner],
    quest = status?.monsterHunt;
  const revision = hunt.missionRevision || 0,
    key = `${revision}:${owner}:${target}`,
    attempts = hunt.expiryAttempts!;
  if (!fresh(status, now) || !quest || quest.id !== target || quest.count <= 0 || attempts[key])
    return false;
  const existing = Object.values(attempts).find(
    (a) => !a.done && a.owner === owner && a.target === target,
  );
  if (existing) {
    const changed = existing.revision !== revision;
    existing.revision = revision;
    return changed;
  }
  attempts[key] = { target, owner, revision, deadline: status.seenAt + quest.remainingMs };
  return true;
}
/** Track attempted quests through travel/events and consume a fresh expiry exactly once. */
export function observeHuntExpiry(state: HuntTickState, hunt: HuntCycle, now: number): boolean {
  let changed = false;
  const attempts = (hunt.expiryAttempts ||= {}),
    mission = currentMission(state, hunt);
  if (mission)
    for (const owner of mission.owners)
      changed = register(state, hunt, owner, mission.target, now) || changed;
  for (const attempt of Object.values(attempts)) changed = consume(state, attempt, now) || changed;
  return changed;
}
function disposition(
  status: HuntStatus,
  attempt: HuntExpiryAttempt,
): "complete" | "expired" | "waiting" {
  const quest = status.monsterHunt;
  if (quest?.id === attempt.target) {
    if (quest.count === 0) return "complete";
    if (quest.remainingMs > 0) return "waiting";
  }
  return status.seenAt >= attempt.deadline ? "expired" : "waiting";
}
function consume(state: HuntTickState, attempt: HuntExpiryAttempt, now: number): boolean {
  const status = state.statuses[attempt.owner];
  if (attempt.done || !fresh(status, now)) return false;
  const result = disposition(status, attempt);
  if (result === "waiting") return false;
  attempt.done = true;
  if (result === "expired" && !state.huntBlacklist?.[attempt.target])
    recordHuntFailure(state, attempt.target, "expirations", 1, now);
  return true;
}

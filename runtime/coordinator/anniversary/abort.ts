import type { AnniversaryCycle } from "./contracts.ts";
import type {
  AnniversaryFailure,
  AnniversaryRecoveryPorts,
  AnniversaryRecoveryState,
} from "./return-contracts.ts";

export function createAnniversaryAbort(
  state: AnniversaryRecoveryState,
  ports: AnniversaryRecoveryPorts,
  dispatch: () => void,
) {
  function deferAbsent(cycle: AnniversaryCycle): void {
    if (cycle.combatHandoffAt) return;
    for (const member of cycle.participants || []) {
      const location = ports.location(cycle, member);
      if (location && !ports.activeNames().includes(member))
        ports.defer(member, {
          cycleId: cycle.id,
          event: "anniversary",
          checkpoint: location,
          navigationRevision: ports.intent(member).revision,
          deferredAt: ports.now(),
          phase: "awaiting-reconnect",
        });
    }
  }

  function finish(
    cycle: AnniversaryCycle,
    round: string,
    target: string | null | undefined,
    name: string,
    reason: string,
  ) {
    const abort = {
      at: ports.now(),
      round,
      startsAt: cycle.startsAt,
      target,
      reporter: name,
      reason,
    };
    state.abortedRounds ||= {};
    state.abortedRounds[round] = abort;
    cycle.abortedAt = abort.at;
    cycle.abortReason = reason;
    state.partyHold = null;
    deferAbsent(cycle);
    ports.log(
      "Skipping anniversary round for " +
        target +
        ": " +
        reason +
        " reported by " +
        name +
        "; releasing the anniversary hold and returning to saved farming waypoints",
      "info",
    );
    ports.persist();
    dispatch();
    return { aborted: true };
  }

  function staleRound(
    cycle: AnniversaryCycle | null | undefined,
    body: AnniversaryFailure,
    name: string,
    round: string,
  ): boolean {
    return (
      !cycle ||
      !!cycle.supersededAt ||
      ![String(cycle.id), String(cycle.liveRound)].includes(round) ||
      !body.target ||
      body.target !== cycle.target ||
      ports.now() < Number(cycle.startsAt) ||
      Number(body.navigationRevision) !== ports.intent(name).revision ||
      (name !== ports.merchant() && !(cycle.participants || []).includes(name))
    );
  }

  function staleNavigation(cycle: AnniversaryCycle, name: string): boolean {
    if (name === ports.merchant()) return false;
    const intent = ports.intent(name);
    return (
      !!intent.cancelled ||
      !cycle.waypoints?.[name] ||
      cycle.waypoints[name].revision !== intent.revision
    );
  }

  function abort(body: AnniversaryFailure) {
    const cycle = state.eventCycle,
      name = String(body.character || ""),
      round = String(body.round || "");
    if (
      !(Number(body.attempt) >= 2) ||
      !["target-missing", "target-unreachable", "kiss-timeout", "kiss-unconfirmed"].includes(
        body.failureReason || "",
      )
    )
      return { aborted: false };
    if (staleRound(cycle, body, name, round)) return { aborted: false, stale: true };
    if (cycle!.abortedAt) return { aborted: true, duplicate: true };
    if (staleNavigation(cycle!, name)) return { aborted: false, stale: true };
    return finish(cycle!, round, body.target, name, body.failureReason!);
  }

  return { abort, finish };
}

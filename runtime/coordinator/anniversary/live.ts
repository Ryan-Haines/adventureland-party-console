import type {
  AnniversaryCycle,
  AnniversarySchedule,
  AnniversarySnapshotPorts,
  AnniversaryState,
} from "./contracts.ts";

export function createAnniversaryLive(state: AnniversaryState, ports: AnniversarySnapshotPorts) {
  function schedule(): AnniversarySchedule | null {
    const leader = ports.statuses()[String(ports.leader())];
    return (
      Object.values(ports.statuses())
        .filter(
          (status) =>
            status &&
            status.anniversaryServer &&
            ports.now() - status.seenAt < 15000 &&
            (!leader?.server || status.server === leader.server),
        )
        .sort((a, b) => Number(b!.eventFeedAt || 0) - Number(a!.eventFeedAt || 0))
        .map((status) => status!.anniversaryServer)
        .find((event) => event?.active) || null
    );
  }

  function roundKey(live: AnniversarySchedule, cycle: AnniversaryCycle): string {
    return String(live.round || live.id || live.target || cycle.id);
  }

  function synchronize(live: AnniversarySchedule | null): void {
    const cycle = state.eventCycle;
    if (
      !live ||
      !cycle ||
      cycle.abortedAt ||
      cycle.returnDispatchedAt ||
      !(Number(live.expires) > ports.now())
    )
      return;
    if (cycle.liveRound === roundKey(live, cycle) && cycle.endsAt === Number(live.expires)) return;
    updateCycle(live, cycle);
  }

  function updateCycle(live: AnniversarySchedule, cycle: AnniversaryCycle): void {
    cycle.liveRound = roundKey(live, cycle);
    cycle.target = live.target || null;
    cycle.endsAt = Number(live.expires);
    cycle.updatedAt = ports.now();
    if (live.target && cycle.selectionLoggedRound !== cycle.liveRound) {
      cycle.selectionLoggedRound = cycle.liveRound;
      ports.log(
        live.target + " was selected for the anniversary kiss",
        ports.owned(live.target) ? "featured" : "info",
      );
    }
    ports.persist();
  }

  function featured(live: AnniversarySchedule | null): boolean {
    if (
      !live ||
      state.abortedRounds[String(live.round)] ||
      !live.target ||
      !ports.enabled(live.target) ||
      live.target === ports.merchant()
    )
      return false;
    return live.target === ports.leader() || ports.follower(live.target);
  }

  function hold(live: AnniversarySchedule | null): void {
    if (!featured(live)) {
      state.partyHold = null;
      return;
    }
    const event = live!;
    const round = String(event.round || event.expires || event.target);
    if (state.partyHold?.round === round) return;
    state.partyHold = { target: event.target, round, expires: event.expires || null };
    ports.persist();
  }

  function observe() {
    const current = schedule();
    const live = current?.live ? current : null;
    synchronize(live);
    hold(live);
    return { schedule: current, live };
  }
  return { observe };
}

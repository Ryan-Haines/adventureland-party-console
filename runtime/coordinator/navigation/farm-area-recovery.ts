import type { HuntCycle } from "../hunt/contracts.ts";
import type {
  FarmingArea,
  FarmAreaState,
  FarmConvoy,
  FarmNavigationPorts,
  FarmRelocation,
} from "./farm-area-types.ts";

export function relocation(
  ports: FarmNavigationPorts,
  names: string[],
  destination: FarmingArea,
  at: number,
  reason: string,
): FarmRelocation {
  return {
    destination,
    revisions: Object.fromEntries(names.map((name) => [name, ports.intent(name).revision])),
    at,
    reason,
  };
}

export function createFarmAreaRecovery(ports: FarmNavigationPorts) {
  function staleFallback(convoy: FarmConvoy, names: string[]): boolean {
    if (convoy.purpose !== "empty-spawn-recovery") return false;
    return !convoy.participants?.length || convoy.participants.some(name =>
      !names.includes(name) || ports.intent(name).cancelled ||
      convoy.expected?.[name]?.revision !== ports.intent(name).revision);
  }
  function noDestination(state: FarmAreaState, hunt: HuntCycle | null): void {
    if (hunt?.stage === "mission-travel") {
      const mission = hunt.missions[hunt.currentIndex];
      if (mission) {
        mission.skipped = true;
        mission.skipReason = "all zone routes failed";
      }
      state.pending = null;
      ports.advanceHunt(hunt);
    } else {
      state.paused = true;
      state.message = "Farming travel paused: no reachable zone; select a farming area to retry";
    }
  }

  function alternative(
    state: FarmAreaState,
    areas: FarmingArea[],
    failed: FarmingArea,
    hunt: HuntCycle | null,
    now: number,
  ): FarmingArea | null {
    if (hunt && !hunt.target) return null;
    const failures = state.failures!;
    return (
      ports.alternatives(
        state,
        areas,
        failed,
        now,
        Object.keys(failures).filter((key) => failures[key]! > 1),
      )[0] || null
    );
  }

  function recordFailure(state: FarmAreaState, convoy: FarmConvoy, ids: string[], now: number) {
    const failures = (state.failures ||= {});
    const area = ports.resolve(ids, convoy.location)!;
    const key = area.id || ports.areaId(area);
    const transient =
      /geometry|restarted|interrupted|runtime|owner|unavailable|dead|formation|cruise|command lost|prepared route lost|movement lock/i.test(
        String(convoy.failure || ""),
      );
    if (!transient) failures[key] = (failures[key] || 0) + 1;
    state.lastFailure = {
      reason: convoy.failure,
      at: now,
      transient,
      details: convoy.failureDetails || null,
    };
    state.message = "Travel failed: " + convoy.failure;
    return { area, key, transient, failures };
  }

  function failed(
    state: FarmAreaState,
    convoy: FarmConvoy,
    hunt: HuntCycle | null,
    ids: string[],
    names: string[],
    areas: FarmingArea[],
    now: number,
  ): void {
    if (staleFallback(convoy, names)) { ports.cancelConvoy(); ports.persist(); return; }
    const { area, key, transient, failures } = recordFailure(state, convoy, ids, now);
    if (convoy.failureCode === 'geometry-mismatch') {
      state.pending=null; state.paused=true; ports.persist(); return;
    }
    ports.cancelConvoy();
    if (hunt) hunt.convoyId = null;
    const destination =
      !transient && failures[key]! > 1 ? alternative(state, areas, area, hunt, now) : area;
    if (destination)
      state.pending = relocation(
        ports,
        names,
        destination,
        now + (transient ? 10000 : 2000),
        state.message!,
      );
    else noDestination(state, hunt);
    if (state.pending && convoy.cause) state.pending.cause = convoy.cause;
    ports.persist();
  }
  return { failed };
}

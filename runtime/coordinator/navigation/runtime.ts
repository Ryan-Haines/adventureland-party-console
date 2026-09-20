interface FarmRecovery {
  paused?: boolean;
  pending?: unknown;
  failures?: Record<string, unknown>;
  message?: string | null;
  recoveryVersion?: number;
}
interface Waypoint {
  map?: unknown;
  x?: unknown;
  y?: unknown;
  label?: string | null;
}

/** Release Escape before resetting the current farming recovery and authorizing the requested route. */
export function authorizeCoordinatorFarmingRoute<Location>(
  state: { farmAreaState?: FarmRecovery | null },
  names: string[],
  destination: Location,
  shared: boolean,
  ports: {
    release: () => void;
    authorize: (names: string[], destination: Location, shared: boolean) => void;
  },
): void {
  ports.release();
  const recovery = (state.farmAreaState ||= {});
  recovery.paused = false;
  recovery.pending = null;
  recovery.failures = {};
  recovery.message = null;
  recovery.recoveryVersion = 2;
  ports.authorize(names, destination, shared);
}

/** Return a normalized checkpoint only from the leader's current navigation waypoint. */
export function coordinatorEventCheckpoint(
  state: { leader: string | null },
  waypoint: (name: string | null) => Waypoint | null | undefined,
) {
  const source = waypoint(state.leader);
  if (
    !source ||
    typeof source.map !== "string" ||
    !Number.isFinite(Number(source.x)) ||
    !Number.isFinite(Number(source.y))
  )
    return null;
  return {
    map: source.map,
    x: Number(source.x),
    y: Number(source.y),
    label: source.label || "the saved party checkpoint",
  };
}

interface TravelClockPorts<Timer> {
  convoyStep: () => unknown;
  persist: () => void;
  escapeStep: () => void;
  disengagementTick: () => void;
  rareTick: () => void;
  eventReturn: () => void;
  anniversaryTick: () => void;
  dispatchAnniversary: (force: boolean) => void;
  every: (callback: () => void, milliseconds: number) => unknown;
  later: (callback: () => void, milliseconds: number) => Timer;
  cancel: (timer: Timer | null) => void;
}

/** Separate timer installation preserves startup order; every callback reads current travel ownership. */
export function createCoordinatorTravelClock<Timer>(
  state: { activeConvoy?: unknown },
  ports: TravelClockPorts<Timer>,
) {
  let anniversaryTimer: Timer | null = null;
  function startTravel(): void {
    ports.every(() => {
      if (ports.convoyStep()) ports.persist();
      ports.escapeStep();
      ports.disengagementTick();
      ports.rareTick();
    }, 250);
  }
  function startReturns(): void {
    ports.every(() => {
      ports.eventReturn();
      ports.anniversaryTick();
    }, 1000);
  }
  function scheduleAnniversary(): void {
    ports.cancel(anniversaryTimer);
    anniversaryTimer = ports.later(() => {
      anniversaryTimer = null;
      if (state.activeConvoy) return scheduleAnniversary();
      ports.dispatchAnniversary(false);
    }, 2500);
  }
  return { startTravel, startReturns, scheduleAnniversary };
}

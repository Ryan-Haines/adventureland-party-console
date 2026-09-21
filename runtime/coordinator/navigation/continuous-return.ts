import type { SharedState, SharedConvoy } from "./shared-route-types.ts";
export interface HuntTravelCheckpoint {
  at: number;
  convoyId: string;
  epoch: number;
  routeVersion: number;
  stage?: string;
  destination: { map: string; x: number; y: number };
  revisions: Record<string, number>;
  positions: Record<
    string,
    { map: string; x: number; y: number; server?: string; runtimeId?: string; progress?: unknown }
  >;
  interruption?: { at: number; reason: string };
  completedAt?: number;
}

/** Persist the obligation and observed positions, never ephemeral barrier readiness. */
export function checkpointContinuousReturn(state: SharedState, now: number): boolean {
  const c = state.activeConvoy,
    hunt = state.monsterHunt;
  if (!c?.continuousReturn || !hunt || now - (hunt.travelCheckpoint?.at || 0) < 1000) return false;
  hunt.travelCheckpoint = {
    at: now,
    convoyId: c.id,
    epoch: c.epoch,
    routeVersion: c.routeVersion || 0,
    stage: hunt.stage,
    destination: { ...c.location },
    revisions: Object.fromEntries(
      c.participants.map((n) => [n, state.navigationIntents?.[n]?.revision || 0]),
    ),
    positions: Object.fromEntries(
      c.participants.flatMap((n) => {
        const s = state.statuses[n];
        return s
          ? [
              [
                n,
                {
                  map: s.map,
                  x: s.x,
                  y: s.y,
                  server: s.server,
                  runtimeId: s.convoyNavigation?.runtimeId,
                  progress: s.movement?.progress,
                },
              ],
            ]
          : [];
      }),
    ),
  };
  return true;
}

/** Upgrade only at a stopped assembly boundary; never change an executing route. */
export function prepareContinuousReturn(state: SharedState, c: SharedConvoy): boolean {
  if (c.purpose !== "monster-hunt" || !c.returnRouting || c.phase !== "assemble") return false;
  if (c.participants.some((n) => state.statuses[n]?.huntReturnProtocol !== 2)) {
    c.failure = "Waiting for Hunt return protocol 2 on every participant";
    return true;
  }
  c.continuousReturn = 1;
  c.location = c.finalLocation || c.location;
  delete c.returnLegs;
  c.townFirst = false;
  c.failure = undefined;
  return false;
}

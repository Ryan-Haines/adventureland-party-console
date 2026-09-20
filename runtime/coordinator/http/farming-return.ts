import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type {
  NavigationRouteState,
  NavigationRoutePorts,
  NavigationStatus,
} from "../navigation/route-types.ts";
import type { ReturnLocation } from "../events/return-types.ts";

export function createFarmingReturnRoute(state: NavigationRouteState, ports: NavigationRoutePorts) {
  function inside(status: NavigationStatus, location: ReturnLocation): boolean {
    if (location.in != null && String(status.in ?? status.map) !== String(location.in))
      return false;
    return (
      status.map === location.map &&
      ports.contains(
        location,
        { map: status.map, x: status.x!, y: status.y! },
        0,
        Number(state.monsterSearchRadiusByCharacter[String(state.leader)]) || 400,
      )
    );
  }
  function validPosition(status: NavigationStatus): boolean {
    return Number.isFinite(status.x) && Number.isFinite(status.y);
  }
  function hasCombatTarget(): boolean {
    return ports
      .active()
      .some((name) => name !== state.merchantCharacter && state.statuses[name]?.target);
  }
  function requestRecovery(location: ReturnLocation, res: HttpResponse): unknown {
    if (hasCombatTarget())
      return res.status(409).json({ error: "the party still has a combat target" });
    if (ports.now() - Number(state.farmingReturnRequestedAt || 0) < 10000)
      return res.status(409).json({ error: "farming recovery already requested" });
    return start(location, res);
  }
  function blocked(status: NavigationStatus): boolean {
    // Called only after the request's string character matches the selected leader.
    return (
      !!state.activeConvoy ||
      workflowOwns() ||
      state.partyFarmingMode === "scatter" ||
      !!ports.intent(state.leader!).cancelled ||
      !!status.activeEvent ||
      !!status.joinedEvent ||
      !!status.mapEvent
    );
  }
  function workflowOwns(): boolean {
    if (state.phoenixPatrolActive || state.rareHuntState?.encounter) return true;
    if (state.eventReturn || state.farmAreaState?.pending) return true;
    if (state.farmingPolicy === "hunt" && state.monsterHunt) return true;
    return anniversaryOwns();
  }
  function anniversaryOwns(): boolean {
    const cycle = state.anniversary?.eventCycle;
    return !!cycle && !cycle.returnCompletedAt && !cycle.supersededAt && !cycle.combatHandoffAt;
  }
  function start(location: ReturnLocation, res: HttpResponse): unknown {
    const participants = ports.members();
    state.farmingReturnRequestedAt = ports.now();
    if (!ports.start(location, "saved farming spawn", participants, "empty-spawn-recovery"))
      return res.status(409).json({ error: "the farming recovery convoy could not be started" });
    (state.combatLogs[String(state.leader)] ||= []).push({
      at: ports.now(),
      type: "navigation",
      message:
        "Outside authorized farming area without a target; recovering to the saved spawn point",
      details: {
        location,
        position: {
          map: state.statuses[String(state.leader)]?.map,
          x: state.statuses[String(state.leader)]?.x,
          y: state.statuses[String(state.leader)]?.y,
        },
        radius: Number(state.monsterSearchRadiusByCharacter[String(state.leader)]) || 400,
      },
    });
    ports.persist();
    return res.json({ ok: true, location, participants });
  }
  return function farmingReturn(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character),
      location = state.location;
    if (name !== state.leader || !ports.owned(name))
      return res.status(403).json({ error: "only the party leader may recover the farming spawn" });
    const status = state.statuses[state.leader];
    if (!status || status.seenAt < ports.now() - 10000 || !location)
      return res.status(409).json({ error: "farming waypoint or online leader unavailable" });
    if (blocked(status))
      return res.status(409).json({ error: "farming recovery is currently blocked" });
    if (!validPosition(status))
      return res.status(409).json({ error: "leader position unavailable" });
    if (inside(status, location))
      return res.json({ ok: true, skipped: true, reason: "already-in-farming-area" });
    return requestRecovery(location, res);
  };
}

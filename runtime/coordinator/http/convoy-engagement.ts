import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type {
  NavigationRouteState,
  NavigationRoutePorts,
  RouteConvoy,
  NavigationGroup,
} from "../navigation/route-types.ts";
import type { ReturnLocation } from "../events/return-types.ts";

export function createConvoyEngagementRoutes(
  state: NavigationRouteState,
  ports: NavigationRoutePorts,
) {
  function focus(): string[] {
    return state.farmingPolicy === "hunt" && state.monsterHunt?.target
      ? [state.monsterHunt.target]
      : state.monsterFocus || [];
  }
  function recordEngagement(
    name: string,
    active: RouteConvoy,
    body: Record<string, unknown>,
  ): void {
    const accepted = ports.acceptArrival(active, body, ports.now()),
      status = state.statuses[name];
    (state.combatLogs[name] ||= []).push({
      at: ports.now(),
      type: "navigation",
      message: active.huntTarget ? "Hunt convoy handed off to a nearby hunt monster" : "Farming route paused to engage a nearby configured monster",
      details: {
        ...requestObject(body.target),
        convoyId: active.id,
        huntArrivalAccepted: accepted,
        positionAgeMs: status ? ports.now() - status.seenAt : null,
        reportedMap: status?.map,
      },
    });
    ports.persist();
  }
  function accept(
    name: string,
    active: RouteConvoy,
    body: Record<string, unknown>,
    res: HttpResponse,
  ): unknown {
    const revisions = Object.fromEntries(
      active.participants.map((name) => [name, ports.intent(name).revision]),
    );
    const group = ports.group();
    if (group && (!group.ready || group.anchor?.map !== requestObject(body.target).map))
      return res
        .status(409)
        .json({ error: "Waiting for grouped arrival: " + group.blockers.join("; ") });
    if (
      !ports.engage(body, {
        revisions,
        radius: Number(state.monsterSearchRadiusByCharacter[state.leader || name]) || 400,
        focus: focus(),
      })
    )
      return res
        .status(409)
        .json({ error: "stale convoy or target outside destination hunt area" });
    recordEngagement(name, active, body);
    return res.json({ ok: true, ...(active.huntTarget ? { location: active.location, serverNow: ports.now() } : {}) });
  }
  function engage(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character);
    if (!ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    const active = state.activeConvoy,
      intent = ports.intent(name);
    if (!active || intent.cancelled)
      return res.status(409).json({ error: "inactive farming convoy" });
    if (state.partyFarmingMode !== "scatter" && name !== state.leader)
      return res
        .status(409)
        .json({ error: "only the leader may nominate a grouped farming target" });
    return accept(name, active, body, res);
  }
  function groupReady(
    body: Record<string, unknown>,
    group: NavigationGroup | null,
  ): group is NavigationGroup {
    return (
      body.character === state.leader &&
      !!group &&
      group.ready &&
      body.key === group.key &&
      body.selection === group.selection &&
      Number(body.navigationRevision) === ports.intent(requestText(body.character)).revision &&
      !state.activeConvoy &&
      !ports.huntOwns()
    );
  }
  function insideArea(name: string, destination: unknown): destination is ReturnLocation {
    const area = ports.waypoint(name),
      point = requestObject(destination);
    return (
      !!area &&
      point.map === area.map &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      ports.contains(
        area,
        point as unknown as ReturnLocation,
        150,
        Number(state.monsterSearchRadiusByCharacter[String(state.leader)]) || 400,
      )
    );
  }
  function fighting(group: NavigationGroup): boolean {
    const members: readonly unknown[] = group.members;
    return group.members.some((name) => {
      const status = state.statuses[name]!;
      return (
        (status.threats || []).some((threat) => members.includes(threat.target)) ||
        (!!status.target &&
          (group.members.includes(status.target.target!) ||
            ports.now() - Number(status.combat?.lastAttackAt || 0) < 3000))
      );
    });
  }
  function approach(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      group = ports.group(),
      destination = body.location;
    if (!groupReady(body, group))
      return res.status(409).json({ error: "group is not ready for travel" });
    if (!insideArea(requestText(body.character), destination))
      return res.status(409).json({ error: "approach is outside the farming area" });
    if (fighting(group))
      return res.status(409).json({ error: "finish the current fight before group travel" });
    if (!ports.start(destination, "grouped farming approach", group.members, "grouped-approach"))
      return res.status(409).json({ error: "could not start grouped approach" });
    return res.json({ ok: true });
  }
  return { engage, approach };
}

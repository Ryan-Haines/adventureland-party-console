import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { AnniversaryCycle } from "../anniversary/contracts.ts";
import type { Waypoints } from "../events/return-types.ts";

interface EventSession {
  event?: string;
  participants?: string[];
  waypoints?: Waypoints;
}
interface RecoveryState {
  leader: string | null;
  eventReturn: { event: string } | null;
  anniversary: { eventCycle?: AnniversaryCycle | null };
  eventSessions: Record<string, EventSession | undefined>;
  statuses: Record<string, { serverLiveEvents?: { name: string }[] } | undefined>;
}
interface RecoveryPorts {
  owned(name: string): unknown;
  enabled(name: string, event?: string): boolean;
  participants(): string[];
  active(): string[];
  abort(
    cycle: AnniversaryCycle,
    round: string,
    target: string | null | undefined,
    name: string,
    reason: string,
  ): void;
  begin(
    event: string,
    session?: EventSession,
    forced?: boolean,
  ): { cycleId: string; pending: string[] } | null;
  snapshot(): unknown;
}

export function createEventRecoveryRoutes(state: RecoveryState, ports: RecoveryPorts) {
  function disableAnniversary(name: string): void {
    const cycle = state.anniversary.eventCycle;
    if (
      !cycle ||
      cycle.returnDispatchedAt ||
      cycle.abortedAt ||
      !(cycle.participants || []).includes(name)
    )
      return;
    if (name === state.leader || !ports.participants().length)
      ports.abort(cycle, String(cycle.liveRound || cycle.id), cycle.target, name, "event-disabled");
    else {
      ports.begin("anniversary", { participants: [name], waypoints: cycle.waypoints }, true);
      cycle.participants = cycle.participants!.filter((member) => member !== name);
    }
  }
  function disableCombat(name: string, event: string): void {
    const session = state.eventSessions[name];
    if (!session || session.event !== event) return;
    const participants = (session.participants || [name]).filter(
      (member) => !ports.enabled(member, event),
    );
    if (!participants.includes(name)) participants.push(name);
    ports.begin(event, { ...session, participants }, true);
    for (const member of participants) delete state.eventSessions[member];
  }
  function disabled(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character),
      event = requestText(body.event);
    if (state.eventReturn && state.eventReturn.event !== event)
      return res.status(409).json({ error: "another return is in progress" });
    if (!ports.owned(name) || ports.enabled(name, event))
      return res.status(409).json({ error: "event remains enabled" });
    if (event === "anniversary") disableAnniversary(name);
    else disableCombat(name, event);
    return res.json({ ok: true, anniversary: ports.snapshot() });
  }
  function stillInside(event: string): boolean {
    return ports.active().some((name) => {
      const status = state.statuses[name];
      return (
        ports.enabled(name, event) &&
        Array.isArray(status?.serverLiveEvents) &&
        status.serverLiveEvents.some((entry) => entry?.name === event)
      );
    });
  }
  function ended(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character),
      event = requestText(body.event);
    if (!ports.owned(name) || !ports.enabled(name))
      return res.status(400).json({ error: "event recovery requires an opted-in character" });
    if ((Number(body.missingFor) || 0) < 10000)
      return res.status(409).json({ error: "event absence has not been sustained" });
    if (stillInside(event))
      return res.status(409).json({ error: "an opted-in party member is still inside the event" });
    const eventName = requestText(body.event || "event");
    const session = Object.values(state.eventSessions).find((entry) => entry?.event === eventName);
    const recovery = ports.begin(eventName, session);
    return res.json({
      ok: true,
      cycleId: recovery?.cycleId || null,
      pending: recovery ? recovery.pending : [],
    });
  }
  return { disabled, ended };
}

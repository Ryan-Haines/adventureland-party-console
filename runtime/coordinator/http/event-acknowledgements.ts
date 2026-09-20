import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import {
  createDeferredAcknowledgements,
  type AcknowledgementState,
  type ReturnCommand,
  type ReturnIntent,
} from "../events/acknowledgements.ts";
import type { ReturnLocation, ReturnRoute } from "../events/return-types.ts";
import { createReturnProgressRoute, type ReturnProgressState } from "./return-progress.ts";

interface EngagementTarget extends ReturnLocation {
  id: string;
}
interface EngagementOwner {
  returnRoutes?: Record<string, ReturnRoute | undefined> | null;
}
interface AcknowledgementRouteState extends AcknowledgementState, Omit<ReturnProgressState, "deferredEventReturns"> {
  leader: string | null;
  partyFarmingMode: string;
  monsterSearchRadiusByCharacter: Record<string, number | undefined>;
  townCycle: { id: string; pending: string[] } | null;
  eventReturn: (EngagementOwner & { cycleId: string; event: string; pending: string[] }) | null;
  anniversary: { eventCycle?: EngagementOwner | null };
  eventSessions: Record<string, EngagementOwner | undefined>;
  statuses: Record<
    string,
    | {
        map?: string;
        x?: number;
        y?: number;
        seenAt: number;
        combatSelection?: { id: string | null; map: string | null };
      }
    | undefined
  >;
}
interface AcknowledgementRoutePorts {
  now(): number;
  owned(name: string): unknown;
  intent(name: string): ReturnIntent;
  nextCommand(): number;
  persist(): void;
  selectedDestination(name: string | null): unknown;
  finishReturn(): void;
  contains(
    location: ReturnLocation,
    target: EngagementTarget,
    margin: number,
    radius: number,
  ): boolean;
}

export function createEventAcknowledgementRoutes(
  state: AcknowledgementRouteState,
  ports: AcknowledgementRoutePorts,
) {
  const deferred = createDeferredAcknowledgements(state, {
    intent: (name) => ports.intent(name),
    nextCommand: () => ports.nextCommand(),
  });
  function townComplete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character);
    if (!ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    const command = state.commands[name];
    if (command?.type !== "town-party" || command.id !== Number(body.commandId) || state.townCycle?.id !== body.cycleId)
      return res.json({ok:true,stale:true});
    if (!atMain(name)) return res.status(409).json({error:"waiting for fresh Main town arrival"});
    delete state.commands[name];
    if (state.townCycle) {
      state.townCycle.pending = state.townCycle.pending.filter((member) => member !== name);
      if (!state.townCycle.pending.length) state.townCycle = null;
    }
    ports.persist();
    return res.json({ ok: true });
  }
  function atMain(name: string): boolean {
    const s=state.statuses[name];
    return !!s && s.seenAt >= ports.now()-3000 && s.map === "main" && Math.hypot(Number(s.x),Number(s.y))<=90;
  }
  function observePosition(name: string, body: Record<string, unknown>): void {
    const status = state.statuses[name];
    if (
      status &&
      typeof body.map === "string" &&
      Number.isFinite(Number(body.x)) &&
      Number.isFinite(Number(body.y))
    ) {
      status.map = body.map;
      status.x = Number(body.x);
      status.y = Number(body.y);
    }
  }
  function acknowledgeReturn(
    name: string,
    body: Record<string, unknown>,
    res: HttpResponse,
  ): unknown {
    const recovery = state.eventReturn,
      pending = state.deferredEventReturns[name];
    if (
      (!recovery || body.cycleId !== recovery.cycleId) &&
      pending &&
      body.cycleId === pending.cycleId
    ) {
      deferred.town(name, pending);
      ports.persist();
      return res.json({ ok: true, deferred: true });
    }
    if (!recovery || body.cycleId !== recovery.cycleId) return res.json({ ok: true, stale: true });
    if (body.mapEvent === recovery.event)
      return res.status(409).json({ error: "character is still inside the ended event" });
    // Town finishes between heartbeats; destination selection must see its acknowledged position.
    observePosition(name, body);
    recovery.pending = recovery.pending.filter((member) => member !== name);
    delete state.deferredEventReturns[name];
    const routedLeader = recovery.pending.length === 0 && !!ports.selectedDestination(state.leader);
    ports.finishReturn();
    return res.json({
      ok: true,
      pending: state.eventReturn ? state.eventReturn.pending : [],
      routedLeader,
    });
  }
  function returnComplete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character);
    if (!ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    if (Number(body.navigationRevision || 0) !== ports.intent(name).revision)
      return res.status(409).json({ error: "stale navigation revision" });
    if (!atMain(name) && !mainReport(body))
      return res.status(409).json({error:"waiting for Main town arrival"});
    return acknowledgeReturn(name, body, res);
  }
  function mainReport(body: Record<string, unknown>): boolean {
    return body.map === "main" && typeof body.x === "number" && typeof body.y === "number" && Math.hypot(body.x,body.y)<=90;
  }
  function currentLeader(name: string, target: EngagementTarget): boolean {
    if (state.partyFarmingMode === "scatter" || name === state.leader) return true;
    const status = state.statuses[String(state.leader)],
      lock = status?.combatSelection;
    return (
      !!lock &&
      lock.id === target.id &&
      lock.map === target.map &&
      !(ports.now() - status!.seenAt > 3000)
    );
  }
  function engagement(
    name: string,
    body: Record<string, unknown>,
    command: ReturnCommand,
  ): string | null {
    const target = body.engagedTarget as EngagementTarget;
    if (!currentLeader(name, target)) return "leader target changed or became stale";
    const radius = Number(state.monsterSearchRadiusByCharacter[state.leader || name]) || 400;
    if (
      target.map !== command.location!.map ||
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y) ||
      !ports.contains(command.location!, target, 0, radius)
    )
      return "target outside destination hunt area";
    recordEngagement(name, body, command);
    return null;
  }
  function recordEngagement(
    name: string,
    body: Record<string, unknown>,
    command: ReturnCommand,
  ): void {
    for (const owner of [
      state.anniversary.eventCycle,
      state.eventReturn,
      ...Object.values(state.eventSessions),
    ]) {
      const route = owner?.returnRoutes?.[name];
      if (
        route &&
        route.commandId === command.id &&
        route.revision === Number(body.navigationRevision)
      )
        route.engagedAt = ports.now();
    }
  }
  function currentResume(
    command: ReturnCommand | undefined,
    body: Record<string, unknown>,
    name: string,
  ): command is ReturnCommand {
    return (
      !!command &&
      command.type === "event-resume-travel" &&
      command.id === Number(body.commandId) &&
      Number(body.navigationRevision || 0) === ports.intent(name).revision
    );
  }
  function resumeComplete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character);
    if (!ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    const command = state.commands[name];
    if (!currentResume(command, body, name)) return res.json({ ok: true, stale: true });
    if (command.convoyHandoff && body.engagedTarget) {
      const error = engagement(name, body, command);
      if (error) return res.status(409).json({ error });
    }
    deferred.resumed(name, command);
    ports.persist();
    return res.json({ ok: true });
  }
  return { townComplete, returnComplete, resumeComplete, progress: createReturnProgressRoute(state, ports) };
}

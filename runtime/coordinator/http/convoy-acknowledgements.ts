import { recordConvoyHistory } from "../navigation/convoy-history.ts";
import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { RouteConvoy } from "../navigation/route-types.ts";
import type { ReturnLocation } from "../events/return-types.ts";
import type { StoredCombatLogEntry } from "../telemetry/combat-log.ts";
import { completeSharedWalkMember } from "../navigation/shared-walk.ts";
import { sharedArrivalReady } from "../navigation/shared-route-store.ts";

interface ExitReturn {
  exitConvoyId?: string;
  exited?: string[];
  cycleId: string;
  event: string;
  checkpoint: ReturnLocation | null;
}
interface ConvoyAcknowledgementState {
  statuses?: Record<string, { seenAt?: number; convoyNavigation?: { phase?: string } } | undefined>;
  lastConvoyEngagement?: {
    convoyId: string;
    epoch: number;
    reports?: Record<string, { commandId: number; runtimeId?: string } | undefined>;
  } | null;
  activeConvoy: RouteConvoy | null;
  eventReturn: ExitReturn | null;
  commands: Record<string, unknown>;
  combatLogs: Record<string, StoredCombatLogEntry[] | undefined>;
}
interface ConvoyAcknowledgementPorts {
  now(): number;
  owned(name: string): unknown;
  valid(body: Record<string, unknown>): boolean;
  nextCommand(): number;
  persist(): void;
  history(): void;
  hold(message: string, code: string): void;
  error(message: string): void;
}

export function createConvoyAcknowledgementRoutes(
  state: ConvoyAcknowledgementState,
  ports: ConvoyAcknowledgementPorts,
) {
  function superseded(name: string, body: Record<string, unknown>): boolean {
    const handoff = state.lastConvoyEngagement,
      report = handoff?.reports?.[name];
    return (
      !!handoff &&
      handoff.convoyId === body.convoyId &&
      handoff.epoch === Number(body.epoch) &&
      report?.commandId === Number(body.commandId) &&
      !!report.runtimeId &&
      report.runtimeId === body.runtimeId
    );
  }
  function arrived(name: string, active: RouteConvoy): void {
    const continuation = completeSharedWalkMember(active, name);
    const recovery =
      active.purpose === "franky-exit" && state.eventReturn?.exitConvoyId === active.id
        ? state.eventReturn
        : null;
    delete state.commands[name];
    if (continuation) state.commands[name] = continuation;
    if (recovery) {
      recovery.exited = [...new Set((recovery.exited || []).concat(name))];
      state.commands[name] = {
        id: ports.nextCommand(),
        type: "event-return-town",
        cycleId: recovery.cycleId,
        event: recovery.event,
        checkpoint: recovery.checkpoint,
      };
    }
    active.completed = [...new Set((active.completed || []).concat(name))];
    if (active.participants.every((member) => active.completed!.includes(member))) {
      recordConvoyHistory(state, active, "completed", ports.now());
      state.activeConvoy = null;
    }
    ports.persist();
  }
  function complete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character);
    if (!ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    // A racing completion for the former convoy must not delete its combat replacement command.
    if (superseded(name, body)) return res.json({ ok: true, superseded: true });
    if (
      !ports.valid(body) ||
      !["scheduled", "travel"].includes(state.activeConvoy!.phase) ||
      ports.now() < state.activeConvoy!.departAt!
    )
      return res.status(409).json({ error: "stale convoy completion" });
    const c = state.activeConvoy!;
    if (c.routeProtocol === 4 && !sharedArrivalReady(state, ports.now())) return res.json({ ok: false, waiting: true });
    arrived(name, c);
    return res.json({ ok: true });
  }
  function failed(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character || "");
    if (!ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    const active = state.activeConvoy;
    if (!ports.valid({ ...body, character: name }))
      return res.status(409).json({ error: "stale convoy generation" });
    const reason = requestText(body.reason || "navigation stalled");
    (state.combatLogs[name] ||= []).push({
      at: ports.now(),
      type: "navigation",
      message: "!!! CONVOY STOPPED !!! " + reason,
      details: body.details || {},
    });
    active!.failureDetails = body.details || null;
    ports.hold(
      name + ": " + reason,
      ["town-unavailable", "runtime-lost", "owner-lost"].includes(requestText(body.failureCode))
        ? requestText(body.failureCode)
        : "route-failed",
    );
    ports.history();
    ports.persist();
    ports.error("[convoy] " + name + ": " + reason);
    return res.json({ ok: true });
  }
  return { complete, failed };
}

import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { AnniversaryCycle } from "../anniversary/contracts.ts";
import type { ReturnLocation, Waypoints } from "../events/return-types.ts";

interface AnniversaryNavigationState {
  eventCycle?: AnniversaryCycle | null;
  returnReady?: Record<string, unknown>;
  returnDestination?: ReturnLocation | null;
}
interface AnniversaryNavigationPorts {
  now(): number;
  owned(name: string): unknown;
  merchant(): string | null;
  leader(): string | null;
  revision(name: string): number;
  persist(): void;
  scheduleReturn(): void;
  huntOwns(): boolean;
  supersede(cycle: AnniversaryCycle | null | undefined): void;
  convoy(): {
    id: string;
    label?: string;
    purpose?: string | null;
    nonPreemptible?: boolean;
  } | null;
  cancelConvoy(): void;
  log(message: string, level: string): void;
  location(): ReturnLocation | null;
  fallback(candidate: ReturnLocation): ReturnLocation | null;
  participants(): string[];
  capture(names: string[]): Waypoints;
}

function invalidDeadline(starts: number, ends: number, now: number): boolean {
  return (
    !Number.isFinite(starts) ||
    !Number.isFinite(ends) ||
    ends <= starts ||
    ends - starts > 360000 ||
    ends < now - 60000
  );
}

function validLocation(candidate: ReturnLocation): boolean {
  return !!candidate.map && Number.isFinite(candidate.x) && Number.isFinite(candidate.y);
}

function abortedRound(cycle: AnniversaryCycle | null | undefined, startsAt: unknown): boolean {
  return !!cycle?.abortedAt && Number(startsAt) <= Number(cycle.startsAt) + 60000;
}

export function createAnniversaryNavigationRoutes(
  state: AnniversaryNavigationState,
  ports: AnniversaryNavigationPorts,
) {
  function validCharacter(name: string): unknown {
    return ports.owned(name) && name !== ports.merchant();
  }

  function staleReady(
    cycle: AnniversaryCycle | null | undefined,
    name: string,
    body: Record<string, unknown>,
  ): boolean {
    return (
      !cycle ||
      !!cycle.returnCompletedAt ||
      !!cycle.supersededAt ||
      ![String(cycle.id), String(cycle.liveRound)].includes(requestText(body.round)) ||
      Number(body.navigationRevision || 0) !== ports.revision(name)
    );
  }

  function ready(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character || "");
    if (!validCharacter(name)) return res.status(400).json({ error: "invalid anniversary return" });
    if (staleReady(state.eventCycle, name, body)) return res.json({ ok: true, stale: true });
    state.returnReady ||= {};
    state.returnReady[name] = { at: ports.now(), round: body.round || null };
    ports.persist();
    ports.scheduleReturn();
    return res.json({ ok: true });
  }

  function preemptConvoy(res: HttpResponse): unknown {
    const convoy = ports.convoy();
    const interrupted = convoy && { id: convoy.id, label: convoy.label };
    if (convoy && ["anniversary-return", "event-return"].includes(convoy.purpose || ""))
      return res.json({ ok: true, cancelled: false, alreadyReturning: true });
    if (convoy?.nonPreemptible) return res.json({ ok: true, cancelled: false, huntTurnIn: true });
    if (interrupted) {
      ports.cancelConvoy();
      ports.log(
        "Cancelled " +
          (interrupted.label || "farming") +
          " convoy so the party can attend the anniversary round",
        "info",
      );
      ports.persist();
    }
    return res.json({ ok: true, cancelled: !!interrupted });
  }

  function preempt(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character || "");
    if (!validCharacter(name))
      return res.status(400).json({ error: "invalid anniversary navigation preemption" });
    if (Number(body.navigationRevision || 0) !== ports.revision(name))
      return res.status(409).json({ error: "stale navigation revision" });
    if (ports.huntOwns()) return res.json({ ok: true, cancelled: false, huntTurnIn: true });
    const cycle = state.eventCycle;
    if (abortedRound(cycle, body.startsAt))
      return res.json({ ok: true, cancelled: false, skipped: true });
    if (cycle && Number(body.startsAt) > Number(cycle.startsAt) + 60000) ports.supersede(cycle);
    return preemptConvoy(res);
  }

  function startCycle(
    name: string,
    body: Record<string, unknown>,
    candidate: ReturnLocation,
    startsAt: number,
    endsAt: number,
  ): void {
    ports.supersede(state.eventCycle);
    const destination = ports.fallback(
      name === ports.leader() ? candidate : ports.location() || candidate,
    );
    state.eventCycle = {
      id: requestText(body.round || startsAt),
      startsAt,
      endsAt,
      destination,
      participants: ports.participants(),
      waypoints: ports.capture(ports.participants()),
      stagedAt: ports.now(),
      returnDispatchedAt: null,
    };
    state.returnReady = {};
  }

  function acceptStaging(
    name: string,
    body: Record<string, unknown>,
    candidate: ReturnLocation,
    starts: number,
    ends: number,
    res: HttpResponse,
  ): unknown {
    const existing = state.eventCycle;
    if (existing && starts < Number(existing.startsAt) - 60000)
      return res.status(409).json({ error: "stale anniversary round" });
    const same = existing && Math.abs(Number(existing.startsAt) - starts) < 60000;
    if (same && existing.abortedAt) return res.json({ ok: true, skipped: true, cycle: existing });
    if (!same) startCycle(name, body, candidate, starts, ends);
    else updateLeaderDestination(existing, name, candidate, starts);
    const cycle = state.eventCycle!;
    cycle.participants = [...new Set([...(cycle.participants || []), ...ports.participants()])];
    state.returnDestination = cycle.destination;
    ports.persist();
    return res.json({ ok: true, cycle });
  }

  function updateLeaderDestination(
    cycle: AnniversaryCycle,
    name: string,
    candidate: ReturnLocation,
    starts: number,
  ): void {
    if (name === ports.leader() && ports.now() < starts && !cycle.returnDispatchedAt)
      cycle.destination = ports.fallback(candidate);
  }

  function staging(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character || "");
    if (!validCharacter(name))
      return res.status(400).json({ error: "invalid anniversary staging report" });
    if (Number(body.navigationRevision || 0) !== ports.revision(name))
      return res.status(409).json({ error: "stale navigation revision" });
    const candidate = {
      map: requestText(body.map || ""),
      x: Number(body.x),
      y: Number(body.y),
      label: requestText(body.label || "the pre-event farming location"),
      capturedAt: ports.now(),
    };
    if (!validLocation(candidate))
      return res.status(400).json({ error: "invalid pre-event location" });
    const starts = Number(body.startsAt),
      ends = Number(body.endsAt);
    if (invalidDeadline(starts, ends, ports.now()))
      return res.status(400).json({ error: "invalid anniversary cycle deadline" });
    return acceptStaging(name, body, candidate, starts, ends, res);
  }
  return { ready, preempt, staging };
}

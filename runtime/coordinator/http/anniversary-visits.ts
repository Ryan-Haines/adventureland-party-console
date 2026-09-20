import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import {
  anniversaryLabels as labels,
  anniversarySlices as slices,
  type AnniversaryRound,
  type AnniversarySchedule,
} from "../anniversary/contracts.ts";

interface VisitState {
  rounds: Record<string, AnniversaryRound | undefined>;
  abortedRounds: Record<string, unknown>;
  nativeSlice: string | null;
  attempts: Record<string, Record<string, number>>;
}
interface VisitPorts {
  now(): number;
  owned(name: string): unknown;
  enabled(name: string): boolean;
  merchant(): string | null;
  revision(name: string): number;
  snapshot(): { live?: AnniversarySchedule | null };
  abort(body: Record<string, unknown>): Record<string, unknown>;
  log(message: string, level: string, details?: unknown): void;
  persist(): void;
}

function sliceLabel(slice: string | null | undefined): string {
  return requestText(labels[slice || ""] || slice);
}

export function createAnniversaryVisitRoutes(state: VisitState, ports: VisitPorts) {
  function recordClaim(name: string, roundId: string, body: Record<string, unknown>): void {
    const round = state.rounds[roundId] || {
      claims: {},
      target: (body.target || null) as string | null,
    };
    round.claims![name] = { at: ports.now(), slice: (body.slice || null) as string | null };
    state.rounds[roundId] = round;
    if (typeof body.slice === "string" && slices.includes(body.slice))
      state.nativeSlice = body.slice;
    ports.log(
      name +
        " kissed " +
        requestText(body.target || "the featured player") +
        (body.slice ? " and received " + sliceLabel(body.slice as string) + " Slice" : ""),
      "success",
    );
    ports.persist();
  }

  function claim(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character || ""),
      roundId = requestText(body.round || "");
    if (!ports.owned(name) || !roundId)
      return res.status(400).json({ error: "invalid anniversary claim" });
    if (state.abortedRounds[roundId]) return res.json({ ok: true, skipped: true });
    recordClaim(name, roundId, body);
    return res.json({ ok: true, anniversary: ports.snapshot() });
  }

  function staleAttempt(name: string, round: string, body: Record<string, unknown>): boolean {
    const live = ports.snapshot().live;
    return (
      !ports.owned(name) ||
      !ports.enabled(name) ||
      !live ||
      String(live.round) !== round ||
      live.target !== body.target ||
      Number(body.navigationRevision) !== ports.revision(name)
    );
  }

  function attempt(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character || ""),
      round = requestText(body.round || "");
    if (staleAttempt(name, round, body))
      return res.status(409).json({ error: "stale anniversary attempt" });
    const counts = (state.attempts[round] ||= {});
    if ((counts[name] || 0) >= 2) return res.json({ exhausted: true, attempt: 2 });
    counts[name] = (counts[name] || 0) + 1;
    ports.persist();
    return res.json({ attempt: counts[name] });
  }

  function failure(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character || "");
    if (!ports.owned(name)) return res.status(400).json({ error: "invalid anniversary character" });
    const message =
      name +
      " anniversary kiss failed for " +
      requestText(body.target || "the featured player") +
      "— " +
      requestText(body.error || "unknown server response");
    ports.log(message, "error", {
      round: body.round || null,
      failureReason: body.failureReason || null,
      responses: Array.isArray(body.responses) ? body.responses.slice(-10) : [],
    });
    const result = ports.abort(body);
    return res.json({ ok: true, ...result, anniversary: ports.snapshot() });
  }

  function handoff(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = requestText(body.character || ""),
      roundId = requestText(body.round || "");
    if (!ports.owned(name) || name === ports.merchant())
      return res.status(400).json({ error: "invalid anniversary handoff" });
    const round = state.rounds[roundId] || { claims: {}, target: null };
    const claim = round.claims![name] || {
      at: ports.now(),
      slice: (body.slice || null) as string | null,
      recovered: true,
    };
    round.claims![name] = claim;
    state.rounds[roundId] = round;
    if (claim.handedOff) return res.json({ ok: true, duplicate: true });
    claim.handedOff = true;
    claim.handedOffAt = ports.now();
    ports.log(
      name + " delivered " + sliceLabel(claim.slice) + " Slice to " + ports.merchant(),
      "success",
    );
    ports.persist();
    return res.json({ ok: true });
  }
  return { claim, attempt, failure, handoff };
}

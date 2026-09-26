import { measureStatusStage } from '../telemetry/transport-timing.ts';
import { acceptTravelReport, sequencedTravelReport, travelReportFields } from './travel-report.ts';
import { requestObject, type HttpResponse } from "../http/contracts.ts";
import { createCombatChannel } from "./combat-channel.ts";
interface Report {
  name: string;
  seenAt?: number;
}
interface Ports<T extends Report> {
  now(): number;
  groupedCombat(): void;
  response(name: string, mode?: "combat"): unknown;
  rareReport?(name: string, report: T): void;
  rareTick?(): void;
}
function preserveRare<T extends Report>(body: T, previous: T | undefined): T {
  const before = requestObject(requestObject(previous).rareObservation);
  const next = requestObject(requestObject(body).rareObservation);
  const runtime = requestObject(requestObject(body).combatSelection).runtimeId;
  if (before.runtimeId === runtime && Number(before.at) > Number(next.at || 0))
    return {...body, rareObservation: before};
  return body;
}
export function preserveNewerCombat<T extends Report>(body: T, previous: T | undefined, now = Date.now()): T {
  body = preserveRare(body, previous);
  if (sequencedTravelReport(body)) return acceptTravelReport(body, previous, now);
  const before = requestObject(requestObject(previous).groupedCombat);
  const next = requestObject(requestObject(body).groupedCombat);
  if (typeof before.reportedAt === "number" && before.reportedAt > Number(next.reportedAt || 0))
    return { ...body, groupedCombat: before };
  return body;
}
export function createCombatIngestion<T extends Report>(
  statuses: Record<string, T | undefined>,
  ports: Ports<T>,
) {
  const channel = createCombatChannel((name, mode) => ports.response(name, mode));
  function report(name: string, raw: Record<string, unknown>, res: HttpResponse) {
    const receivedAt=ports.now();
    const previous = statuses[name];
    if (!previous) return res.status(409).json({ error: "full status required" });
    const runtime = requestObject(requestObject(previous).combatSelection).runtimeId;
    const incoming = requestObject(raw.combatSelection).runtimeId;
    if (runtime && incoming && runtime !== incoming)
      return res.status(409).json({ error: "combat report belongs to a replaced runtime" });
    const update: Record<string, unknown> = {};
    for (const key of [...travelReportFields, 'rareObservation'])
      if (key in raw) update[key] = raw[key];
    statuses[name] = preserveNewerCombat({ ...previous, ...update, seenAt: ports.now() }, previous, ports.now());
    measureStatusStage('fast-groupedCombat', () => ports.groupedCombat());
    ports.rareReport?.(name, statuses[name]!);
    ports.rareTick?.();
    channel.flush();
    return res.json({...channel.snapshot(name),combatReportReceipt:{receivedAt,evaluatedAt:ports.now(),sequence:requestObject(raw.travelSample).sequence}});
  }
  function handle(name: string, raw: Record<string, unknown>, res: HttpResponse) {
    if (raw.combatWait === true)
      return channel.wait(
        name,
        typeof raw.combatRevision === "string" ? raw.combatRevision : "",
        res,
      );
    return report(name, raw, res);
  }
  return { handle, flush: () => channel.flush() };
}

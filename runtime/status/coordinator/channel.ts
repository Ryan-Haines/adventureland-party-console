// The combat channel: the combat-only report
// and the parked combat poll, one waiter per character. Its reply is table R's `combat` sections,
// The hunting owner's farming section among them, and its revision covers every one, so a farming mode change wakes
// a parked poll between heartbeats. Moved from runtime/coordinator/status/combat-channel.ts
// and combat-ingestion.ts.
import type { IndependentConfirmation } from '../../movement/api/character.ts';
import { acceptTravelReport, sequencedTravelReport, travelReportFields } from '../../movement/api/coordinator.ts';
import { preserveRare } from '../../hunting/coordinator/api.ts';
import { requestObject, type HttpResponse } from '../../lifecycle/api.ts';
import { measureStatusStage, type StatusReply } from './reply.ts';

const semanticGrant = (grant: { expiresAt: number } | undefined) => grant ? { ...grant, expiresAt: undefined } : undefined;
type Group = {
  queueRevision?: string; independentApproach?: boolean; independentConfirmation?: Pick<IndependentConfirmation, 'id'>;
  pairRevision?: string; successorGrant?: { expiresAt: number }; selection?: string; committed?: boolean;
  pursuit?: { revoking?: string }; formationRecovery?: { id: string; phase: string; attempt: number };
  seenAt?: number; observers?: { seenAt?: number; [key: string]: unknown }[]; target?: { x: number; y: number; state?: string };
};

// A revision compare reads the sections; only a reply the character gets is sent (reply.ts `send`).
export function createCombatChannel(reply: StatusReply) {
  // `reported`: the waiter's own character sent one combat report while it was parked.
  const waiting = new Map<string, { res: HttpResponse; revision: string; reported?: boolean }>();
  const snapshot = (name: string, build: 'read' | 'send' = 'read') => {
    const { serverNow, groupedCombat, ...control } = reply[build](name, 'combat') as Record<string, unknown> & {
      consoleMaintenance?: { expires?: number } | null; convoySignal?: { validUntil?: number } | null };
    control.convoySignal ||= null;
    // The revision leaves out the lease's expiry and the walk signal's validity, which move without
    // a change a combat poll waits for.
    const revisionControl = { ...control,
      consoleMaintenance: control.consoleMaintenance && { ...control.consoleMaintenance, expires: undefined },
      convoySignal: control.convoySignal && { ...control.convoySignal, validUntil: undefined } };
    const group = groupedCombat as Group | null | undefined;
    if (!group) return { ...control, serverNow, groupedCombat: null, combatRevision: JSON.stringify(['null', revisionControl]) };
    const target = group.target;
    return { ...control, serverNow, groupedCombat: group, combatRevision: JSON.stringify([
      group.queueRevision, group.pairRevision, semanticGrant(group.successorGrant), group.selection, group.committed,
      group.independentApproach, group.independentConfirmation?.id, group.pursuit?.revoking, group.formationRecovery,
      target ? [target.state, target.x, target.y] : null,
      group.observers?.map(({ seenAt: _seenAt, ...observer }) => observer),
      revisionControl,
    ]) };
  };
  function finish(name: string) {
    const w = waiting.get(name);
    if (!w) return;
    waiting.delete(name);
    w.res.json(snapshot(name, 'send'));
  }
  // A parked poll waits for the next change: it answers when a report changes its revision, and
  // when its own character sends a full report. Its own character's combat report reply carries the
  // same sections (`replied`), so the poll takes that reply's revision and stays parked, and the
  // client sends no second request for the same reply. Its own character's next report answers it,
  // so the park lasts at most two report intervals.
  function flush(reporter?: string, replied = false) {
    for (const [name, w] of waiting) {
      if (name !== reporter) { if (snapshot(name).combatRevision !== w.revision) finish(name); }
      else if (!replied || w.reported) finish(name);
      else { w.reported = true; w.revision = snapshot(name).combatRevision; }
    }
  }
  function wait(name: string, revision: string, res: HttpResponse) {
    const current = snapshot(name);
    if (current.combatRevision !== revision) return res.json(snapshot(name, 'send'));
    finish(name);
    waiting.set(name, { res, revision });
  }
  return { snapshot, flush, wait };
}

interface Report { name: string; seenAt?: number }
interface ChannelPorts<T extends Report> {
  now(): number;
  groupedCombat(): void;
  reply: StatusReply;
  rareReport?(name: string, report: T): void;
  rareTick(): void;
}
// A combat report never overwrites a newer grouped combat sample or a newer travel sample.
export function preserveNewerCombat<T extends Report>(body: T, previous: T | undefined, now = Date.now()): T {
  body = preserveRare(body, previous);
  if (sequencedTravelReport(body)) return acceptTravelReport(body, previous, now);
  const before = requestObject(requestObject(previous).groupedCombat);
  const next = requestObject(requestObject(body).groupedCombat);
  if (typeof before.reportedAt === 'number' && before.reportedAt > Number(next.reportedAt || 0))
    return { ...body, groupedCombat: before };
  return body;
}
/** The combat-only report and the combat poll, apart from the full status intake. */
export function createCombatIntake<T extends Report>(statuses: Record<string, T | undefined>, ports: ChannelPorts<T>) {
  const channel = createCombatChannel(ports.reply);
  function report(name: string, raw: Record<string, unknown>, res: HttpResponse) {
    const receivedAt = ports.now();
    const previous = statuses[name];
    if (!previous) return res.status(409).json({ error: 'full status required' });
    const runtime = requestObject(requestObject(previous).combatSelection).runtimeId;
    const incoming = requestObject(raw.combatSelection).runtimeId;
    if (runtime && incoming && runtime !== incoming)
      return res.status(409).json({ error: 'combat report belongs to a replaced runtime' });
    const update: Record<string, unknown> = {};
    for (const key of [...travelReportFields, 'rareObservation'])
      if (key in raw) update[key] = raw[key];
    statuses[name] = preserveNewerCombat({ ...previous, ...update, seenAt: ports.now() }, previous, ports.now());
    measureStatusStage('fast-groupedCombat', () => ports.groupedCombat());
    ports.rareReport?.(name, statuses[name]!);
    ports.rareTick();
    channel.flush(name, true);
    return res.json({ ...channel.snapshot(name, 'send'), combatReportReceipt: { receivedAt, evaluatedAt: ports.now(), sequence: requestObject(raw.travelSample).sequence } });
  }
  function handle(name: string, raw: Record<string, unknown>, res: HttpResponse) {
    if (raw.combatWait === true) return channel.wait(name, typeof raw.combatRevision === 'string' ? raw.combatRevision : '', res);
    return report(name, raw, res);
  }
  return { handle, flush: (reporter: string) => channel.flush(reporter) };
}

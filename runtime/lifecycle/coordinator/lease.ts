// The deploy lease on the coordinator: the one
// reader of the host's lease, the fight it captures for the drain, and the participants table R
// waits on. The host is the lease's only writer (rules.ts `LEASE_FILE`).
import { mkdirSync, readFileSync, watch } from 'node:fs';
import path from 'node:path';
import { fresh } from '../../protocol/reports.ts';
import { LEASE_FILE, parseLease, participates, waiting, type FightTarget, type Lease } from '../rules.ts';
import { requestObject as record } from '../http.ts';
import type { MemberHold } from '../../hooks/registry.ts';

export type Statuses = Record<string, Record<string, unknown> | undefined>;
interface LeaseStatus { id: string | null; ready: boolean; waiting: string[]; participants: string[]; lost: string[] }
/** A member whose reports stopped, by the walk reading against its own `reportIntervalMs` with no
 *  attacker test: `member.holder` lets it go, and the drain names it lost. */
const reportsStopped = (report: Record<string, unknown>, now: number) =>
  !fresh(report.seenAt, now, { reading: 'walk', attackerKnown: false, intervalMs: report.reportIntervalMs });

export function createLease(directory: string | undefined, ports: { now(): number; paused(): boolean;
  log(message: string, level: 'warning'): void;
  notify(hook: 'lifecycle.drainStarted' | 'lifecycle.drainEnded', payload: Record<string, unknown>): void }) {
  // The participants belong to one lease: a new lease starts an empty set.
  const participants = new Set<string>();
  // Stopped workers, with when (table W's stop row): each stays out until it reports again
  // after its stop. A stop shortly before a lease counts too, since its last report is still fresh
  // when the lease starts, as for the merchant a BankBoi switch logs out.
  const left = new Map<string, number>();
  let participantsOf: string | undefined;
  let capturedId: string | undefined, fightTargets: FightTarget[] = [];
  // The fight each fresh member is in when a lease starts, which the drain lets it finish. Under
  // the console Pause the characters act not at all, so no fight is kept to finish.
  function capture(statuses: Statuses, active: Lease | null) {
    if (!active || capturedId === active.id) return;
    capturedId = active.id; fightTargets = [];
    if (ports.paused()) return;
    for (const raw of Object.values(statuses)) {
      const report = record(raw), target = record(report.engagedCombatTarget);
      if (fresh(report.seenAt, ports.now(), 'recent', 0, true) && typeof target.id === 'string' && typeof target.map === 'string') fightTargets.push({ id: target.id, map: target.map,
        ...(['string', 'number'].includes(typeof target.in) ? { in: target.in as string | number } : {}), ...(typeof target.server === 'string' ? { server: target.server } : {}) });
    }
  }
  // The file is read again only after it changes: the host writes it by
  // rename, so a change of its name in the folder is a new lease, a renewal or its removal. Each ask
  // parses the record it holds, so an expired lease is no lease. A watch that fails (the folder
  // removed, EPERM on a Windows data directory) closes, and every later ask reads the file, as
  // b9b5c91e console-maintenance.ts did. The coordinator's shutdown closes it (`close`).
  let saved: unknown, stale = true, noticed: string | undefined;
  let watcher: ReturnType<typeof watch> | null = null;
  if (directory) {
    const folder = path.join(directory, path.dirname(LEASE_FILE));
    mkdirSync(folder, { recursive: true });
    watcher = watch(folder, (_event, name) => { if (!name || name === path.basename(LEASE_FILE)) stale = true; }).unref();
    watcher.on('error', error => {
      ports.log(`Deploy lease watch failed; the lease is read on each ask: ${error.message}`, 'warning');
      close();
    });
  }
  function close() { watcher?.close(); watcher = null; }
  function current(): Lease | null {
    if (!directory) return null;
    if (stale || !watcher) {
      stale = false;
      try { saved = JSON.parse(readFileSync(path.join(directory, LEASE_FILE), 'utf8')); } catch { saved = null; }
    }
    const lease = parseLease(saved, ports.now());
    // The drain's notices at the first read that sees the lease begin or end. The read
    // records the lease before it notifies: a listener that reads `lifecycle.state` reads the
    // lease again, and that read sends nothing.
    if (lease?.id !== noticed) {
      const ended = noticed;
      noticed = lease?.id;
      if (ended) ports.notify('lifecycle.drainEnded', { lease: ended, by: 'host' });
      if (lease) ports.notify('lifecycle.drainStarted', { lease: lease.id, mode: lease.mode, loadMode: lease.loadMode, by: 'host' });
    }
    if (lease && lease.id !== participantsOf) { participants.clear(); participantsOf = lease.id; }
    return lease;
  }
  /** The lease with the fight it captured, for the heartbeat reply. */
  function served(statuses: Statuses): (Lease & { fightTargets: FightTarget[] }) | null {
    const active = current();
    capture(statuses, active);
    return active ? { ...active, fightTargets } : null;
  }
  // Table R: the participants are the expected names and every character with a fresh report;
  // a Steam handoff in progress keeps the drain waiting too.
  function status(statuses: Statuses, expected: readonly (string | null)[] = [], handoff = false): LeaseStatus {
    const active = current();
    if (!active) return { ready: false, waiting: [], id: null, participants: [], lost: [] };
    for (const name of expected) if (name) participants.add(name);
    for (const [name, report] of Object.entries(statuses)) if (participates(record(report), ports.now())) participants.add(name);
    // A stopped worker the roster still assigns stays waited on: aac30d45 console-maintenance.ts
    // `observeParticipants` retires only the stopped names it no longer expects.
    for (const [name, at] of left) {
      if (Number(record(statuses[name]).seenAt) > at) left.delete(name);
      else if (!expected.includes(name)) participants.delete(name);
    }
    const names = [...participants], unready = names.filter(name => waiting(record(statuses[name]), active, ports.now()));
    if (handoff) unready.push('active Steam handoff');
    // A waiting participant whose reports stopped is lost: the deploy host keeps waiting for it,
    // and the update's pause ends on it (tools/update/transaction.ts).
    const lost = unready.filter(name => name in statuses && reportsStopped(record(statuses[name]), ports.now()));
    return { id: active.id, ready: unready.length === 0, waiting: unready, participants: names, lost };
  }
  /** Table W's stop row: a stopped worker leaves the lease's participants until it reports again,
   *  unless the roster still assigns it (`status`). */
  function leave(name: string) { left.set(name, ports.now()); }
  return { current, served, status, leave, close };
}

/** `member.holder` for the members 13 holds.
 * It reads table P, as the member's acknowledgement reports it, and the
 *  report freshness, and adds no rule:
 *  - a member under a deploy lease, or whose CODE reload runs, is waited on until it reloads, before
 *  the silence test, since a reloading member stops reporting while its new CODE loads;
 *  - a member whose reports stopped (the walk reading against its own `reportIntervalMs`, with no
 *  attacker test), or whose headless worker exited, is let go: the walk goes on and the member
 *  catches up once its runtime is back;
 *  - a held member is waited on until Play. A held member's lease or reload still reads as held. */
export function memberHolds(member: string, facts: { now(): number; startedAt?: number; report(name: string): Record<string, unknown> | undefined;
  worker(name: string): { instance?: unknown; lastExit?: unknown; codeReloadRunning?: boolean } | undefined }): MemberHold[] {
  const worker = facts.worker(member);
  // The coordinator keeps no reports across its restart, so a member it has not heard from yet is
  // silent since the coordinator started: the walk a restart restores waits that one report window
  // before it lets the member go.
  const report = facts.report(member) ?? (facts.startedAt === undefined ? undefined : { seenAt: facts.startedAt });
  const acknowledgement = record(report?.consoleMaintenance);
  if (!acknowledgement.held && (acknowledgement.id || worker?.codeReloadRunning))
    return [{ owner: '13', reason: 'loading', coming: true, endsOn: 'lifecycle.reloaded' }];
  if (!report || reportsStopped(report, facts.now()) || worker && !worker.instance && worker.lastExit)
    return [{ owner: '13', reason: 'runtime-lost', coming: false, endsOn: 'worker.started' }];
  if (acknowledgement.held) return [{ owner: '13', reason: 'paused', coming: true, endsOn: 'lifecycle.holdChanged' }];
  return [];
}

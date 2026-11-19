// A satisfied restock ends, a stopped job goes back
// under a new id, a job the merchant deferred for an event keeps its place, and a coordinator
// restart brings the saved queue and current job back stripped of their run.
import type { InventoryEntry } from '../../coordinator/contracts/item.ts';
import { merchantKind, JOB_LIVE_MS, endingWaitMs } from '../rules.ts';
import { boundFired } from '../../status/coordinator/api.ts';
import type { LadderPort } from '../../tasks/api.ts';
import { type PauseBy, pauseMerchantJob, endMerchantJob, stripRun, type MerchantWork } from './owner.ts';

export interface MerchantCommandReport {
  commandId: number;
  jobId: string;
  // `running` names the job the merchant runs, on each report (runner.ts `report.sent`).
  state: "accepted" | "deferred" | "running";
  reason?: string | null;
  at: number;
}

export interface RecoverableWork extends MerchantWork {
  phase?: string;
  startedAt?: number;
  heartbeatAt?: number;
  resumedFrom?: string;
  commandId?: number;
  commandReport?: MerchantCommandReport;
  recoveryAttempts?: number;
  firstDeferredAt?: number;
  lastDeferredReason?: string;
}

interface RecoveryState {
  current: RecoverableWork | null;
  queue: RecoverableWork[];
}
interface RecoveryPorts {
  now(): number;
  nextCommand(): number;
  // The one end of the job (endMerchantJob), with its code.
  end(job: RecoverableWork, code: string): void;
  // The tasks owner's merchant-job ladder: a satisfied restock is progress, as a completion is.
  ladder?: LadderPort;
  restockSatisfied(name: string, items: (InventoryEntry | null)[] | undefined): boolean;
  stamp(job: RecoverableWork): RecoverableWork;
  log(message: string, level: string, details?: unknown): void;
  persist(): void;
  dispatch(): void;
  // the call budget owner's never-replay end of the ALData sale.
  recoverSale(): void;
  // `jobs.pause` (3.4).
  pause(job: RecoverableWork, by: PauseBy): RecoverableWork;
  // The lifecycle owner's table D `recovery` row: no recovery while paused or under a deploy lease.
  recovers(): boolean;
  // The lifecycle owner's roster answer for the merchant: no slot holds it online.
  offline(name: string): boolean;
}

// The silence safety bound on a merchant that still reports (rules.ts JOB_LIVE_MS), read against the
// last report that named the running job: the system
// stopped the job while the merchant stays online. A firing tells the status owner's bound record with the job's
// state. A commerce step needs no bound of its own: each of its game calls ends at the call's reply bound
// (items calls.ts `itemCall`), and each walk on movement's ladder.
function workerExpired(job: RecoverableWork, name: string, now: number): boolean {
  if (!["assigned", "processing"].includes(job.phase || "")) return false;
  const heartbeatAge = now - Number(job.heartbeatAt || job.startedAt || 0);
  if (heartbeatAge <= JOB_LIVE_MS) return false;
  boundFired({ bound: 'JOB_LIVE_MS', owner: '08', subject: name, state: { jobId: job.id, reason: job.reason, phase: job.phase,
    heartbeatAge, commandReport: job.commandReport ?? null } });
  return true;
}

function reportChanged(
  previous: MerchantCommandReport | undefined,
  report: MerchantCommandReport,
): boolean {
  return previous?.state !== report.state || previous?.reason !== report.reason;
}

/** Only merchant heartbeats recover jobs; completed restocks can dispatch the next job immediately. */
export function createMerchantRecovery(state: RecoveryState, ports: RecoveryPorts) {
  function completeRestock(name: string, items: (InventoryEntry | null)[] | undefined): void {
    const job = state.current;
    if (!job || job.reason !== "restock" || job.target !== name || !ports.restockSatisfied(name, items)) return;
    ports.end(job, 'restock-satisfied');
    ports.ladder?.progress();
    ports.log("Merchant potion restock completed", "success", { character: name, jobId: job.id });
    ports.persist();
    ports.dispatch();
  }

  // A stopped job goes back to the queue under a new id that names the old one, with
  // the `recovery` wait, and its failure is booked on the tasks owner's ladder at the next claim
  //. No count drops it.
  function requeue(name: string, message: string): void {
    const current = state.current;
    if (!current) return;
    const recovered: RecoverableWork = {
      ...ports.pause(current, 'recovery'),
      resumedFrom: current.id,
      id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
    };
    recovered.recoveryAttempts = Number(current.recoveryAttempts || 0) + 1;
    recovered.retryAt = ports.now() + endingWaitMs('recovery', recovered.recoveryAttempts);
    boundFired({ bound: 'RECOVERY_RETRY_MS', owner: '08', subject: String(current.target), state: { jobId: current.id, attempt: recovered.recoveryAttempts } });
    recovered.ladderDue = 'job-unresponsive';
    state.queue.push(ports.stamp(recovered));
    ports.log(message + recovered.reason, "info");
    ports.persist();
  }

  function currentReport(job: RecoverableWork, report: MerchantCommandReport): boolean {
    return (
      report.jobId === job.id &&
      report.commandId === job.commandId &&
      report.at >= Number(job.startedAt || 0) &&
      report.at <= ports.now() + 5000 &&
      ports.now() - report.at < 10000
    );
  }

  // A job deferred for an event before its first heartbeat keeps its id and place.
  function releaseAnniversary(job: RecoverableWork, nameForMerchant: string): void {
    const queued = ports.pause(job, 'event');
    delete queued.firstDeferredAt;
    if (!state.queue.some(entry => entry.id === job.id)) state.queue.push(queued);
    ports.log('Merchant job released while anniversary owns movement', 'info', {jobId: job.id});
    ports.persist();
  }

  function acceptReport(
    job: RecoverableWork | null,
    report: MerchantCommandReport | undefined,
    nameForMerchant: string,
  ): boolean {
    if (job && report && currentReport(job, report)) {
      if (reportChanged(job.commandReport, report))
        ports.log(
          "Merchant command " + report.state + (report.reason ? ": " + report.reason : ""),
          "info",
          report,
        );
      job.commandReport = report;
      // The merchant's report names its running job on each report (runner.ts `report.sent`), so
      // the job's life is the age of that report.
      if (report.state === "running") {
        job.heartbeatAt = Math.max(Number(job.heartbeatAt) || 0, Math.min(ports.now(), report.at));
        if (job.phase === "assigned") job.phase = "processing";
        return false;
      }
      if (report.state === "deferred" && !job.heartbeatAt) {
        job.lastDeferredReason = deferralReason(report);
        job.firstDeferredAt ??= ports.now();
        if (eventDeferral(report.reason)) {
          releaseAnniversary(job, nameForMerchant);
          return true;
        }
        ports.persist();
        return false;
      }
    }
    return false;
  }

  function observe(
    name: string,
    items: (InventoryEntry | null)[] | undefined,
    report?: MerchantCommandReport,
  ): void {
    completeRestock(name, items);
    if (acceptReport(state.current, report, name)) return;
    if (state.current && workerExpired(state.current, name, ports.now()))
      requeue(name, recoveryMessage(state.current));
  }
  // For a merchant the lifecycle owner's roster holds offline or exited, a job that may replay goes
  // back to the queue, and the ALData sale ends without replay through 09. A merchant that is online
  // and reporting keeps its job; its own reports and the attempt bounds end it (BC-11). The dispatch
  // pass asks this, so the lifecycle owner's answer is read when the party's reports arrive.
  function expire(name: string): void {
    const job = state.current;
    if (!job || job.phase === 'switching party realm' || !ports.recovers() || !ports.offline(name)) return;
    if (merchantKind(job.reason).interrupt === 'never') return ports.recoverSale();
    requeue(name, 'Merchant went offline; retry scheduled for ');
  }
  return { observe, expire };
}

function recoveryMessage(job: RecoverableWork): string {
  if (job.commandReport?.state === 'deferred')
    return 'Command deferred (' + (job.commandReport.reason || 'unspecified') + '); retry scheduled for ';
  return job.heartbeatAt ? 'Worker stalled; retry scheduled for ' : 'Command not acknowledged; retry scheduled for ';
}

function deferralReason(report: MerchantCommandReport): string {
  return report.reason || 'unspecified';
}

function eventDeferral(reason: string | null | undefined): boolean {
  return reason === 'anniversary' || reason === 'event';
}

// The recovery on the coordinator's records.
type ComposedRecoveryState = Parameters<typeof createMerchantRecovery>[0];
type ComposedRecoveryPorts = Parameters<typeof createMerchantRecovery>[1];
interface CoordinatorState {
  merchantCurrent: ComposedRecoveryState["current"];
  merchantQueue: ComposedRecoveryState["queue"];
  nextCommandId: number;
  merchantCharacter: string | null;
  commands: Record<string, unknown>;
}
type RecoveryCompositionPorts = Omit<ComposedRecoveryPorts, "nextCommand" | "end" | "pause">;

/** Recovery ends a job through the one end, which clears only the slot write of that job. */
export function createCoordinatorMerchantRecovery(
  state: CoordinatorState,
  ports: RecoveryCompositionPorts,
) {
  return createMerchantRecovery(
    {
      get current() {
        return state.merchantCurrent;
      },
      set current(value) {
        state.merchantCurrent = value;
      },
      get queue() {
        return state.merchantQueue;
      },
    },
    {
      ...ports,
      nextCommand: () => state.nextCommandId++,
      end: (job, code) => endMerchantJob(state, job, { decision: 'ended', code }),
      pause: (job, by) => pauseMerchantJob(state, job, by) as RecoverableWork,
    },
  );
}

// The restart (3.4): the saved queue and the saved current job come back stripped of their run.
interface RestartJob {
  [key: string]: unknown;
  reason?: string;
  target?: string | null;
  queuedAt?: number;
  handoff?: { banked?: unknown[]; gold?: unknown };
  order?: { buys?: unknown[]; crafts?: unknown[] };
}
interface RestartState<T extends RestartJob> {
  merchantCharacter?: string | null;
  commands?: Record<string, unknown>;
  merchantCurrent: T | null;
  merchantQueue: T[];
  merchantCargo: { bank: { owner?: string | null; mark: unknown }[]; gold: number };
}

/** Recover durable cargo and intent after process exit, then collapse repeated commerce orders. */
export function recoverMerchantQueue<T extends RestartJob>(
  state: RestartState<T>,
  now: () => number,
  stamp: (job: T) => T,
): void {
  const current = state.merchantCurrent;
  if (current) {
    if (current.handoff) {
      for (const mark of current.handoff.banked || [])
        state.merchantCargo.bank.push({ owner: current.target, mark });
      state.merchantCargo.gold += Number(current.handoff.gold) || 0;
    }
    // The job keeps its id and place in line, and the one pause strips its run.
    const resumed: T = { ...stripRun(current), reason: current.reason || "resumed service", queuedAt: current.queuedAt || now() };
    state.merchantQueue.unshift(resumed);
    state.merchantCurrent = null;
  }
  const seen = new Set<string>();
  state.merchantQueue = state.merchantQueue.filter((job) => retainCommerce(job, seen)).map(stamp);
}

function retainCommerce(job: RestartJob, seen: Set<string>): boolean {
  if (job.reason !== "merchant commerce" || !job.order) return true;
  const signature = JSON.stringify({ buys: job.order.buys || [], crafts: job.order.crafts || [] });
  if (seen.has(signature)) return false;
  seen.add(signature);
  return true;
}

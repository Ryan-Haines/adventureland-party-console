// The character's reply apply (rules.ts `TABLE_A`).
// Each row is its owner's function, called by
// name here and never written in the status owner's code; shared.js builds this at its install and hands it one
// port per row.
import { TABLE_A, type ApplyRow } from '../rules.ts';
import { boundsSent } from './bounds.ts';

type Reply = Record<string, unknown>;
// A row's port answers true when it ends the apply (an `ends` row).
type RowPorts = Record<ApplyRow, (state: Reply) => unknown>;

interface ApplyPorts {
  /** The hunting owner's farming mode computation (runtime/hunting/character/farm.ts `observeType`). */
  farmingMode(): void;
  /** The survival owner's death handler for a death whose packet this client missed. */
  deathSeen(): void;
  /** The status owner's telemetry (character/telemetry.ts): the bag its potion line compares with. Its queues go
   *  on the lifecycle owner's report notice. */
  telemetry(): void;
  /** the merchant jobs owner's gathering cooldown read for one skill (merchant-jobs/character/gathering.ts). */
  gatheringCooldown(skill: 'fishing' | 'mining'): void;
  /** Table A's rows, one port each. */
  rows: RowPorts;
  /** The report itself: the game window's realm, where the report's attempt
   *  time and the items owner's pin in flight are kept; the lifecycle owner's run (current, held, the report loop); the items owner's bank visit
   *  look and Tracktrix pin; the status owner's snapshot, the coordinator request and the failure record; the hunting owner's
   *  per-report observe and the merchant jobs owner's gathering wake after the reply. */
  host(): Record<string, unknown>;
  current(): boolean;
  held(): boolean;
  startReports(each: () => void): void;
  observeVisit(): void;
  pin(): Promise<unknown> | null;
  snapshot(): unknown;
  request(path: string, options: { method: string; body: unknown }): Promise<Reply>;
  failed(error: unknown, phase: string): void;
  observe(): void;
  reported(): void;
  log(message: string, color: string): void;
}

export function createApply(p: ApplyPorts) {
  let phase = 'snapshot';
  // The rows before each report, the tick's and the gathering publish's, so the report reads only.
  function beforeReport(): void {
    p.farmingMode();
    p.deathSeen();
    p.telemetry();
    p.gatheringCooldown('fishing');
    p.gatheringCooldown('mining');
  }
  async function run(state: Reply, channel: boolean, rows: RowPorts): Promise<void> {
    for (const row of TABLE_A) {
      if (channel && !('channel' in row)) continue;
      if (!channel) phase = row.phase;
      const ends = await rows[row.row](state);
      if ('ends' in row && ends === true) {
        if (!channel) for (const kept of TABLE_A) if ('kept' in kept) await rows[kept.row](state);
        return;
      }
    }
  }
  // One report post, the heartbeat's and the gathering publish's: the rows before it, the snapshot and
  // the request. The bound firings the body carries leave the queue once the coordinator took it.
  // A window's posts run one at a time: a post takes its snapshot after the last one answered, so
  // the coordinator stores this window's reports in the order they were built and no two carry the
  // same queued firings.
  let posting: Promise<unknown> = Promise.resolve();
  function post(step: (name: string) => void): Promise<Reply> {
    const next = posting.then(async () => {
      step('snapshot');
      beforeReport();
      const body = p.snapshot() as Reply;
      step('request status');
      const state = await p.request('/status', { method: 'POST', body });
      boundsSent((body.boundsFired as unknown[]).length);
      return state;
    });
    posting = Promise.allSettled([next]);
    return next;
  }
  // One report at a time: the items owner's Tracktrix pin, the rows before the report, the report, then table A on
  // its reply. The dashboard is optional; combat goes on when the report fails.
  let busy = false;
  async function tick(): Promise<void> {
    if (!p.current()) return;
    p.observeVisit();
    if (busy) return;
    busy = true;
    const host = p.host();
    host.__partyStatusAttemptAt = Date.now();
    try {
      phase = 'Tracktrix inventory position';
      // The report skips the pin while table P holds the character: the pin's swap waits the job band,
      // whose held row would hold this report, and the heartbeat with it, until Play (REVIEW-QUEUE
      // RWK-13 "The Tracktrix pin under the Pause", default, unconfirmed).
      host.__partyTracktrixMove = p.held() ? null : p.pin();
      try { await host.__partyTracktrixMove; }
      catch (error) { p.log('Tracktrix positioning retry: ' + String((error as { reason?: unknown })?.reason || (error as Error)?.message || error), 'red'); }
      finally { host.__partyTracktrixMove = null; }
      const state = await post(step => { phase = step; });
      if (!p.current()) return;
      await run(state, false, p.rows);
    } catch (error) {
      if (p.current()) p.failed(error, phase);
    } finally {
      busy = false;
      if (p.current()) p.reported();
    }
  }
  return {
    tick,
    /** The lifecycle owner's run part: the first report at the start, then one on each of the lifecycle owner's report
     *  notices after the hunting owner's per-report observe. */
    start(): void { void tick(); p.startReports(() => { p.observe(); void tick(); }); },
    /** The bank's and the gathering's publish: a report outside the heartbeat. Its reply carries the
     *  command slot as any reply does, and the slot drops a one-shot from the slot on that delivery,
     *  so the lifecycle owner's `command` row takes it here too. */
    publish: async () => { const state = await post(() => undefined); await p.rows.command(state); return state; },
    /** A heartbeat reply: every row in order. */
    reply: (state: Reply) => run(state, false, p.rows),
    /** A combat channel reply: the `channel` rows, the hunting owner's farming section before the targeting owner's lock;
     *  The targeting owner's row there is the queue client's own apply. */
    channel: (state: Reply, combat: (state: Reply) => void) => run(state, true, { ...p.rows, combat }),
    /** The phase a heartbeat failure names: the report's own steps, then the row that threw. */
    phase: () => phase,
    reporting: (step: string) => { phase = step; },
  };
}

const status = ((globalThis as { partyStatus?: Record<string, unknown> }).partyStatus ||= {});
status.apply = createApply;

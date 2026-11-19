// The merchant row on the character:
// the event and anniversary reservation of the merchant, its job's yield at
// a production boundary, and the hand-off of its own work before an event move. Moved from
// characters/shared.js (`merchantAnniversaryCompletedRound`, `merchantEventWorkReserved`,
// `yieldMerchantForEvent`, `merchantAnniversaryWorkReserved`, and the poll's `merchantYield` port).
// The reservation is the merchant's report field `merchantEventReserved`, which the merchant jobs owner's dispatcher
// reads a report before the coordinator admits the merchant (correction 21); the coordinator's half
// is the merchant group's live task. shared.js calls `installEventMerchant` once in the
// routine's install.
import type { AnniversaryPlan, AnniversaryRound } from './anniversary.ts';
import { merchantAnniversaryReserved } from '../rules.ts';

interface Character { name: string; ctype?: string; s?: { anniversary_visit?: { round?: unknown; id?: unknown } } }
interface Job { jobId?: unknown; commandId?: unknown; commerceCycle?: unknown }
interface Gathering { cancelled?: string; phase?: string }
// the merchant jobs owner's anniversary control (runtime/merchant-jobs/rules.ts `merchantAnniversaryControl`), as the merchant jobs owner's
// character door publishes it (`partyMerchant.jobs.anniversaryControl`).
type Control = (name: string, selected: boolean, status: Record<string, unknown>, aborted: Record<string, unknown>, now: number) =>
  { featured?: boolean; reserved?: boolean; kissDue?: boolean; busy?: boolean };

export interface EventMerchantPorts {
  now(): number;
  character(): Character;
  // The attendance (attend.ts), the exit (exit.ts) and the legacy event flag.
  attend: { selected(name: string): boolean; joined(): string | null; traveling(): unknown; active(): unknown };
  exitPending(): boolean;
  eventsEnabled(): boolean;
  // Movement's intent was cancelled by the player.
  intentCancelled(): boolean;
  // The coordinator's last reply held the merchant in the event's work (the merchant jobs owner's
  // `merchantEventRecoveryReserved`, kept on the CODE frame's root across a reload).
  coordinatorHolds(): boolean;
  // The anniversary on the character (anniversary.ts) and the clock's round.
  anniversary: { roundId(event: AnniversaryRound, visit?: { round?: unknown; id?: unknown }): string; plan(): AnniversaryPlan | null;
    completed(): Record<string, unknown>; merchantState(): { busy: boolean; mode: string; retryAt: number } };
  round(): AnniversaryRound | null | undefined;
  epoch(value: unknown): number;
  // The merchant's round released at the end of its featured hold (anniversary.ts writes it).
  releasedRound(): string | null | undefined;
  control(): Control | null | undefined;
  // the merchant jobs owner's job runner and gathering, and the items owner's errands that hold the merchant.
  job(): Job | null | undefined;
  holder(): unknown;
  standReturning(): boolean;
  leaveStand(): Promise<unknown>;
  errand(): boolean;
  gathering(): Gathering | null | undefined;
  stopGathering(): Promise<unknown>;
  request(path: string, options: { method: string; body: Record<string, unknown> }): Promise<{ yield?: boolean }>;
}

export function installEventMerchant(ports: EventMerchantPorts) {
  const merchant = () => ports.character().ctype === 'merchant';

  // The round the merchant kissed: its own record, the coordinator's claim of it, or its release at
  // the end of the featured hold.
  function completedRound(): string | null {
    const event = ports.round(), c = ports.character();
    const round = event && ports.anniversary.roundId(event, c.s?.anniversary_visit);
    const plan = ports.anniversary.plan(), done = ports.anniversary.completed();
    const recorded = plan?.live && String(plan.live.round) === String(round) && plan.round?.claims?.[c.name];
    if (round && recorded) done[round] = recorded;
    return round && (done[round] || ports.releasedRound() === round) ? round : null;
  }
  // The merchant's event work holds it: it joined or travels to an event, an exit is pending, the
  // coordinator holds it, or a selected event is live while the player has not cancelled the intent.
  function reserved(): boolean {
    return merchant() && (!!ports.attend.joined() || !!ports.attend.traveling() || ports.exitPending() || ports.coordinatorHolds() ||
      ports.eventsEnabled() && !ports.intentCancelled() && !!ports.attend.active());
  }
  // A production job yields at its boundary: the journals settle, and no further operation starts
  // once the event reserved the merchant.
  async function yieldJob(): Promise<void> {
    const active = ports.job();
    if (!active || active.commerceCycle || !reserved()) return;
    const result = await ports.request('/merchant/checkpoint', { method: 'POST', body: { jobId: active.jobId, commandId: active.commandId, eventOnly: true } });
    // The code the items owner's commerce matches (items/character/production.ts merchantCommerce).
    if (result.yield) throw Object.assign(Error('merchant_yield'), { reason: 'merchant_yield', code: 'merchant_yield' });
  }
  // The event reservation, or the merchant jobs owner's anniversary control: featured, reserved, due to kiss or busy.
  function anniversaryReserved(): boolean {
    if (reserved()) return true;
    const control = ports.control();
    if (!merchant() || !control) return false;
    const event = ports.round(), visit = ports.character().s?.anniversary_visit;
    const round = event && ports.anniversary.roundId(event, visit);
    const done = completedRound() === round, state = ports.anniversary.merchantState();
    const answer = control(ports.character().name, ports.attend.selected('anniversary'), {
      anniversaryServer: event && { ...event, round, next: ports.epoch(event.next), expires: ports.epoch(event.expires) },
      anniversaryState: { busy: state.busy, mode: done ? 'complete' : state.mode, completedRound: done ? round : null, retryAt: state.retryAt },
      anniversaryVisit: visit,
    }, ports.anniversary.plan()?.abortedRounds || {}, ports.now());
    return merchantAnniversaryReserved(answer);
  }
  // Before the poll moves a reserved merchant: its own work settles first. A job, an errand or a
  // stand return holds the move; a gathering trip is cancelled and the move waits for it; then the
  // stand closes. True when the move may go.
  async function yieldForMove(): Promise<boolean> {
    if (!merchant() || !reserved()) return true;
    if (ports.holder() || ports.standReturning() || ports.errand()) return false;
    const attempt = ports.gathering();
    if (attempt) {
      attempt.cancelled = 'event attendance';
      if (attempt.phase !== 'cast') await ports.stopGathering();
      return false;
    }
    await ports.leaveStand();
    return true;
  }

  return { completedRound, reserved, yieldJob, anniversaryReserved, yieldForMove };
}
Object.assign(globalThis, { installEventMerchant });

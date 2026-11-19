// The basic attack's bookings (E04-b): targeting hears the turns owner's `skills.sent` and
// `skills.settled` for each send that carries the attack context and books, in the notice's own
// synchronous turn, what the attack controller booked: the queue evidence at the send and at its
// rejection (so no queue report reads the send without it), `noteAttack` on an accepted attack on a
// selection that still holds, and the crab range recovery's rejection on a fresh `too_far` reply.
import type { AttackContext } from '../../hooks/registry.ts';
import type { createCrabRangeRecovery } from './gates.ts';
import type { CombatState, Target } from '../turns/api.ts';
import type { TargetingMap } from './install.ts';
import { pick } from './saved-fields.ts';

type Recovery = ReturnType<typeof createCrabRangeRecovery>;
type Sample = Parameters<Recovery['reject']>[0];
type Notice = Record<string, unknown>;
// The crab recovery reacts only to a reply of this send: a `too_far` that comes within W12's
// `crabReplyMs` of it (b9b5c91e attack-controller.ts:86).

export function createAttackBookings(ports: { recovery: Recovery; state(): CombatState; module: TargetingMap }) {
  const m = ports.module;
  // The evidence action of the attack in flight; the attack family has one flight at a time.
  let action: string | null = null;
  const context = (notice: Notice) => notice.context as AttackContext<Target, Sample> | undefined;
  return {
    sent(notice: Notice) {
      const c = context(notice);
      if (c) action = c.passing ? null : m.queueEvidence(c.target, "pending") ?? null;
    },
    settled(notice: Notice) {
      const c = context(notice);
      if (!c) return;
      if (notice.outcome === 'accepted') {
        if (!c.passing && c.current()) m.noteAttack(c.target);
        return;
      }
      if (notice.outcome !== 'rejected' && notice.outcome !== 'lost') return;
      if (action) m.queueEvidence(c.target, "rejected", action);
      if (notice.reason === 'too_far' && c.range && Date.now() - Number(notice.sentAt) <= pick('crabReplyMs') && c.current()) {
        ports.recovery.reject(c.range, notice.reply, Date.now());
        ports.state().rangeRecovery = ports.recovery.diagnostic();
      }
    },
  };
}
